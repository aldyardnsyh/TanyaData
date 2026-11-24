/**
 * Profil dokumen deterministik dari chunk inti (lib/core/doc-profile.ts).
 * Sumber jawaban pertanyaan meta ("ini dokumen terkait apa?", "apa isi
 * dokumen ini?") — tidak perlu retrieval dan tidak mungkin halusinasi:
 * judul, jumlah halaman, dan daftar bagian + kalimat pembuka tiap bagian.
 *
 * Profil ini juga menjadi INPUT port `DocumentOverviewPort` (ringkasan LLM).
 * Karena itu chunk yang jelas rusak (halaman tidak terbaca, teks terlalu
 * pendek) tidak dimasukkan sebagai bagian — bukan disembunyikan, tetapi tidak
 * dijadikan dasar ringkasan.
 */
import type { DB } from '@/lib/db/client';
import type { Dataset } from '@/lib/core/contracts';

export interface DocSectionProfile {
  title: string;
  page: number | null;
  chunkCount: number;
  excerpt: string;
  chunkId: number;
  documentId: string;
}

export interface DocProfile {
  title: string;
  pages: number;
  sections: DocSectionProfile[];
}

const UNREADABLE_RE = /^\s*\[halaman tidak terbaca\]/i;

function firstSentences(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let out = sentences[0] ?? clean;
  for (const s of sentences.slice(1)) {
    if (out.length >= 120) break;
    out += ` ${s}`;
  }
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

function usableTitle(title: string): boolean {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length < 3) return false;
  if (UNREADABLE_RE.test(t)) return false;
  // Judul hanya tanda baca/angka adalah artefak ekstraksi, bukan bagian.
  if (!/[a-zA-Z\u00C0-\u024F]/.test(t)) return false;
  return true;
}

export function buildDocumentProfile(db: DB, dataset: Dataset): DocProfile {
  const chunks = db
    .prepare(
      `SELECT id, document_id, section_path, page, text, ocr_status
         FROM core_chunks WHERE dataset_id = ? AND level = 'child'
        ORDER BY id`,
    )
    .all(dataset.id) as Array<{
    id: number;
    document_id: string;
    section_path: string;
    page: number | null;
    text: string;
    ocr_status: string | null;
  }>;

  const docRow = db
    .prepare('SELECT pages FROM core_documents WHERE dataset_id = ? ORDER BY pages DESC LIMIT 1')
    .get(dataset.id) as { pages: number } | undefined;

  const groups = new Map<string, DocSectionProfile>();
  const pages = new Set<number>();
  for (const c of chunks) {
    if (c.page != null) pages.add(c.page);
    if (c.ocr_status === 'ocr_skipped' || c.ocr_status === 'unreadable') continue;
    if (UNREADABLE_RE.test(c.text)) continue;
    if (c.text.trim().length < 40) continue;

    const rawTitle = c.section_path.replace(/\s+/g, ' ').trim();
    const title = usableTitle(rawTitle) ? rawTitle : 'Tanpa judul bagian';
    const existing = groups.get(title);
    if (existing) {
      existing.chunkCount += 1;
      continue;
    }
    groups.set(title, {
      title,
      page: c.page,
      chunkCount: 1,
      excerpt: firstSentences(c.text),
      chunkId: c.id,
      documentId: c.document_id,
    });
  }

  return {
    title: dataset.name,
    pages: Math.max(1, docRow?.pages ?? 0, ...pages, 1),
    sections: [...groups.values()],
  };
}

/** Deteksi pertanyaan meta-dokumen: tanya ISI/TENTANG/RINGKASAN dokumen itu sendiri. */
const META_DOC_PATTERNS = [
  /\bdokumen\s+(?:ini|tersebut)[^.?!]*\b(?:apa|tentang|isi|ringkas|bicara|membahas)/i,
  /\b(?:apa|apakah)\b[^.?!]*\b(?:isi|tentang)\b[^.?!]*\b(?:dokumen|file)\b/i,
  /\b(?:dokumen|file)\s+(?:apa|terkait apa)\b/i,
  /\bringkas\b[^.?!]*\b(?:dokumen|isi)\b/i,
  /\b(?:ini|dokumen)\s+terkait\s+apa\b/i,
  /\bdokumen\s+ini\s+(?:berisi|berisi apa|berisi tentang)\b/i,
  /\b(?:per|tiap|setiap)\s+pasal(?:-pasal)?\b[^.?!]*\b(?:poin|isi|utama|ringkas|menjelaskan)/i,
  /\bpoin\s+utama\b[^.?!]*\b(?:pasal|dokumen)/i,
  /\bringkas(?:an)?\b[^.?!]*\b(?:pasal|dokumen)/i,
  /\bpasal-pasal\b[^.?!]*\b(?:apa|tentang|menjelaskan)/i,
];

export function isDocumentMetaQuestion(question: string): boolean {
  const q = String(question ?? '').trim();
  if (q.length > 160) return false;
  return META_DOC_PATTERNS.some((re) => re.test(q));
}
