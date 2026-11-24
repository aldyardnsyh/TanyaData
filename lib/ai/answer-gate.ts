/**
 * Anti-slop + mojibake gate dan keputusan LLM fallback penutup (DECISION-033
 * poin 3 & 5). Modul murni, deterministik, tanpa jaringan dan tanpa model.
 *
 * Dipakai oleh `lib/ai/adapter.ts` untuk:
 *  1. Membersihkan SETIAP jawaban (deterministik maupun LLM) dari U+FFFD,
 *     mojibake, dan pola AI-slop yang dilarang — tanpa mengubah angka.
 *  2. Memutuskan apakah jawaban deterministik perlu ditutup oleh LLM.
 *
 * Angka sengaja TIDAK disentuh di sini. Pemeriksaan "tidak ada angka di luar
 * evidence" dilakukan terpisah (`hasForeignNumber`) terhadap himpunan angka
 * bukti, supaya normalisasi teks tidak pernah mengubah nilai numerik.
 */

/* ------------------------------------------------------------- mojibake */

/**
 * Pasangan mojibake → karakter benar. Hanya ranah yang benar-benar rusak yang
 * diganti; teks bersih tidak berubah (idempoten).
 */
const MOJIBAKE_MAP: Array<[RegExp, string]> = [
  [/â€œ/g, '"'],
  [/â€\u009d/g, '"'],
  [/â€\u009c/g, '"'],
  [/â€"/g, '"'],
  [/â€¦/g, '…'],
  [/â€™/g, "'"],
  [/â€˜/g, "'"],
  [/â€“/g, '–'],
  [/â€”/g, '—'],
  [/Ã©/g, 'é'], [/Ã¨/g, 'è'], [/Ã¡/g, 'á'], [/Ã±/g, 'ñ'],
  [/Ã´/g, 'ô'], [/Ã»/g, 'û'], [/Ã¼/g, 'ü'], [/Ã¢/g, 'â'],
  [/Ãª/g, 'ê'], [/Ã®/g, 'î'], [/Ã³/g, 'ó'], [/Ãº/g, 'ú'],
  [/Ã§/g, 'ç'], [/Ã£/g, 'ã'], [/Ãµ/g, 'õ'], [/Ã /g, ' '],
  [/Â /g, ' '],
];

/** Character replacement (U+FFFD) tidak pernah boleh sampai ke user. */
const REPLACEMENT_CHAR = /\uFFFD/g;

/* ------------------------------------------------------------------ slop */

/** Pembuka AI-slop yang dilarang eksplisit oleh DECISION-033 poin 5. */
const SLOP_OPENERS: RegExp[] = [
  /^berikut\s+adalah\s*/i,
  /^berikut\s+ini\s*(?:adalah\s*)?/i,
  // Hentikan filler di koma/titik koma PERTAMA — jangan sampai memakan isi
  // kalimat (angka/bukti) yang mengikuti basa-basi.
  /^dalam\s+dunia\s+yang\s+semakin[^\n.!?:,]*[:,]?\s*/i,
  /^dalam\s+era[^\n.!?:,]*[:,]?\s*/i,
  /^di\s+dunia\s+yang\s+semakin[^\n.!?:,]*[:,]?\s*/i,
  /^sebagai\s+(?:sebuah|suatu)\s+/i,
  /^perlu\s+dicatat[^\n.!?:,]*[:,]?\s*/i,
  /^penting\s+untuk\s+dicatat[^\n.!?:,]*[:,]?\s*/i,
  /^secara\s+umum[,\s]*/i,
  /^singkatnya[,\s]*/i,
  /^kesimpulannya[,\s]*/i,
  /^mari\s+kita[^\n.!?:,]*[:,]?\s*/i,
];

/** Klaim "live"/fiktif yang dilarang (tidak ada data real-time di sini). */
const FICTIVE_CLAIMS: RegExp[] = [
  /\b(?:data|informasi|pembaruan|status|nilai)\s+live\b/gi,
  /\bsecara\s+live\b/gi,
  /\bterhubung\s+langsung\b/gi,
  /\bpembaruan\s+langsung\b/gi,
  /\b(?:sedang|saat\s+ini)\s+berlangsung\b/gi,
];

/**
 * Bersihkan jawaban dari mojibake, U+FFFD, dan AI-slop. Idempoten dan aman
 * untuk teks yang sudah bersih. TIDAK mengubah token angka apa pun.
 */
export function sanitizeAnswer(text: string): string {
  let out = String(text ?? '');
  for (const [re, replacement] of MOJIBAKE_MAP) out = out.replace(re, replacement);
  out = out.replace(REPLACEMENT_CHAR, '');
  // Ulangi sampai stabil: pembuka berantai ("Dalam dunia..., berikut adalah...")
  // harus hilang semua, tetapi setiap langkah selalu memendekkan teks.
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of SLOP_OPENERS) {
      const next = out.replace(re, '');
      if (next !== out) { out = next; changed = true; }
    }
  }
  for (const re of FICTIVE_CLAIMS) out = out.replace(re, '');
  // Rapikan spasi yang ditinggalkan penghapusan, tanpa menyentuh isi kalimat.
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/* -------------------------------------------------------------- numbers */

const NUMBER_TOKEN_RE = /\d+(?:[.,]\d+)*/g;

export function answerNumberTokens(text: string): string[] {
  return String(text ?? '').match(NUMBER_TOKEN_RE) ?? [];
}

/** Himpunan token angka yang BOLEH muncul, diambil dari teks bukti. */
export function evidenceNumberSet(quotes: string[]): Set<string> {
  const set = new Set<string>();
  for (const q of quotes ?? []) {
    for (const token of answerNumberTokens(q)) {
      set.add(token);
      // Bentuk ekuivalen locale supaya "8.125" vs "8125" tidak dianggap asing.
      set.add(token.replace(/\./g, '').replace(',', '.'));
      set.add(token.replace(',', ''));
    }
  }
  return set;
}

/** true bila ada angka di jawaban yang tidak bisa ditelusur ke bukti. */
export function hasForeignNumber(text: string, allowed: Set<string>): boolean {
  for (const token of answerNumberTokens(text)) {
    const variants = [
      token,
      token.replace(/\./g, '').replace(',', '.'),
      token.replace(',', ''),
      token.replace(',', '.'),
    ];
    if (!variants.some((v) => allowed.has(v))) return true;
  }
  return false;
}

/* --------------------------------------------------------- fallback gate */

export interface FallbackSignals {
  confidenceLevel: string | null;
  citationCount: number;
  /** Fraksi token angka jawaban yang bisa ditelusur ke bukti (0..1). */
  evidenceGrounding: number;
  /** Proxy key-fact: fraksi term isi pertanyaan yang hadir di jawaban+bukti (0..1). */
  keyFactProxy: number;
}

const GROUNDING_THRESHOLD = 0.99;
const KEY_FACT_THRESHOLD = 0.60;

/**
 * LLM dipanggil HANYA sebagai fallback penutup: ada bukti, bukan abstain, dan
 * salah satu sinyal di bawah ambang. Tanpa bukti → abstain, jangan mengarang.
 */
export function needsLlmFallback(s: FallbackSignals): boolean {
  if (!s.citationCount) return false;
  if (s.confidenceLevel === 'refused') return false;
  if (s.confidenceLevel !== 'strong') return true;
  if (s.evidenceGrounding < GROUNDING_THRESHOLD) return true;
  if (s.keyFactProxy < KEY_FACT_THRESHOLD) return true;
  return false;
}

/** Proxy key-fact: fraksi term isi pertanyaan yang muncul di jawaban/bukti. */
export function keyFactProxy(question: string, answerAndEvidence: string): number {
  const stop = new Set([
    'yang', 'dan', 'atau', 'dalam', 'untuk', 'dengan', 'pada', 'dari', 'tidak',
    'ini', 'itu', 'adalah', 'wajib', 'setiap', 'semua', 'jika', 'bila', 'saat',
    'setelah', 'sebelum', 'oleh', 'kepada', 'sebagai', 'harus', 'dapat', 'akan',
    'sudah', 'belum', 'lebih', 'kurang', 'sampai', 'antara', 'karena', 'agar',
    'supaya', 'bahwa', 'bagaimana', 'berapa', 'apakah', 'dimana', 'kapan', 'mengapa',
  ]);
  const norm = (s: string) => String(s ?? '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const terms = [...new Set(norm(question).split(' ').filter((t) => t.length >= 4 && !stop.has(t)))];
  if (!terms.length) return 1;
  const hay = norm(answerAndEvidence);
  const hits = terms.filter((t) => hay.includes(t)).length;
  return Number((hits / terms.length).toFixed(4));
}

/** Fraksi token angka jawaban yang bisa ditelusur ke bukti. */
export function evidenceGrounding(answer: string, quotes: string[]): number {
  const tokens = answerNumberTokens(answer);
  if (!tokens.length) return 1;
  const allowed = evidenceNumberSet(quotes);
  const grounded = tokens.filter((token) => {
    const variants = [
      token,
      token.replace(/\./g, '').replace(',', '.'),
      token.replace(',', ''),
      token.replace(',', '.'),
    ];
    return variants.some((v) => allowed.has(v));
  }).length;
  return Number((grounded / tokens.length).toFixed(4));
}
