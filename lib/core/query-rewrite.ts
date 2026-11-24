import type { DB } from '@/lib/db/client';
import type { Citation } from '@/lib/core/contracts';

const TOKEN_RE = /[a-z]+/g;
const STOPWORDS = new Set([
  'yang', 'dan', 'dengan', 'untuk', 'dalam', 'pada', 'dari', 'ini', 'itu', 'atau',
  'tidak', 'juga', 'sebagai', 'oleh', 'agar', 'apa', 'apa', 'mana', 'kapan', 'siapa',
  'berapa', 'bagaimana', 'mengapa', 'kenapa', 'didalamnya', 'tersebut', 'adalah',
]);

function tokens(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(TOKEN_RE)
    ?.filter((word) => word.length >= 4 && !STOPWORDS.has(word)) ?? [];
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length];
}

/**
 * Koreksi ejaan berbasis kosakata korpus aktif. Beda dengan peta statis:
 * kata apa pun yang salah ketik didekati ke token dokumen terdekat.
 */
export function correctQueryWithVocabulary(db: DB, datasetIds: string[], question: string): string {
  if (!datasetIds.length || !question.trim()) return question;
  const placeholders = datasetIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT text, section_path FROM core_chunks
       WHERE dataset_id IN (${placeholders}) AND level = 'child' LIMIT 1500`,
    )
    .all(...datasetIds) as Array<{ text: string; section_path: string }>;
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const token of tokens(`${row.text} ${row.section_path}`)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  if (!counts.size) return question;
  const vocabulary = [...counts.keys()];
  return String(question)
    .split(/\s+/)
    .map((word) => {
      const clean = word.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (clean.length < 4 || /[0-9]/.test(clean) || STOPWORDS.has(clean) || counts.has(clean)) return word;
      const limit = 2;
      let best = clean;
      let bestDistance = limit + 1;
      let bestFrequency = 0;
      for (const candidate of vocabulary) {
        const distance = editDistance(clean, candidate);
        if (distance > limit || distance >= bestDistance) continue;
        const frequency = counts.get(candidate) ?? 0;
        if (distance < bestDistance || frequency > bestFrequency) {
          best = candidate;
          bestDistance = distance;
          bestFrequency = frequency;
        }
      }
      return best === clean ? word : best;
    })
    .join(' ');
}

const DEMONSTRATIVE_RE = /\b(ini|itu|nya|tersebut|kinerjanya|hasilnya|alatnya|metodenya|sistemnya)\b/i;
/**
 * BUG-005: jangkar tanggal dari jawaban sebelumnya ("15 Okt", "3 Nov",
 * "2026-11-15") harus ikut ke rewrite. Regex lama membuang SEMUA digit
 * (`/[\[\]0-9]/g`) sehingga konteks waktu hilang pada turn lanjutan.
 */
const DATE_ANCHOR_RE =
  /\b(?:\d{1,2}\s*(?:Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Aug|Sep|Okt|Nov|Des)[a-z]*\.?|(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{1,2}|\d{4}-\d{2}-\d{2})\b/gi;

/** Standalone query untuk follow-up pendek, memakai judul dokumen sebagai topik. */
export function standaloneQuestion(
  question: string,
  history: Array<{ role?: string; content?: string }> | undefined,
  documentTitle: string,
): string {
  const trimmed = String(question ?? '').trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 6 || !DEMONSTRATIVE_RE.test(trimmed)) return trimmed;
  const reversed = [...(history ?? [])].reverse();
  const lastAssistant = reversed.find((h) => h.role === 'assistant')?.content ?? '';
  const lastUser = reversed.find((h) => h.role === 'user')?.content ?? '';
  // Hapus penanda sitasi [n] SAJA — digit tanggal sengaja dipertahankan.
  const anchor = lastAssistant
    .replace(/\[\d+\]/g, '')
    .split(/[.,;\n]/)[0]
    .split(/\s+/)
    .slice(0, 12)
    .join(' ')
    .trim();
  // Kumpulkan jangkar tanggal dari SELURUH assistant turn, bukan hanya yang
  // terakhir, supaya "Sejak kapan perubahan itu terjadi?" tetap menemukan
  // 15 Okt / 3 Nov yang disebut dua turn sebelumnya.
  const dateAnchors = [...new Set(
    (history ?? [])
      .filter((h) => h.role === 'assistant')
      .flatMap((h) => String(h.content ?? '').match(DATE_ANCHOR_RE) ?? [])
      .map((s) => s.trim()),
  )].slice(0, 6);
  const topic = String(documentTitle ?? '')
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .slice(0, 6)
    .join(' ')
    .trim();
  const fallback = lastUser.replace(/^(apa|bagaimana|kenapa|mengapa|berapa|siapa|kapan)\s+/i, '').slice(0, 60);
  return [topic || fallback, anchor, ...dateAnchors, trimmed].filter(Boolean).join(' ').trim();
}

/** Reciprocal rank fusion untuk kanal query orisinal dan rewrite. */
export function rrfFuse(lists: Citation[][], k = 60): Citation[] {
  const merged = new Map<string, { citation: Citation; score: number }>();
  for (const list of lists) {
    list.forEach((citation, index) => {
      const key = String(citation.chunk_id ?? `${citation.section_path ?? ''}:${citation.quote ?? ''}`);
      const prior = merged.get(key);
      merged.set(key, {
        citation,
        score: (prior?.score ?? 0) + 1 / (k + index + 1),
      });
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).map((entry) => entry.citation);
}
