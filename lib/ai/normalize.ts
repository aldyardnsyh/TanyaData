/**
 * TanyaData AI — normalisasi teks & deteksi entitas (lib/ai/normalize.ts).
 *
 * Pipeline: lowercase → NFKD + strip diakritik → tanda baca jadi spasi →
 * rapikan spasi → strip kata tanya di awal. Sinonim ID/EN diekspansi.
 * Deteksi entitas: kanal (10), kategori (7), failure code F01–F12,
 * bulan/tahun, INC-2026-xxxx.
 */
import { allRows, str } from '@/lib/analytics/sql';
import type { DB } from '@/lib/db/client';

const DIACRITIC_RE = /[\u0300-\u036f]/g;

const TYPO_CORRECTIONS: Record<string, string> = {
  'succes ratenya': 'success rate',
  succesratenya: 'success rate',
  'succes rate': 'success rate',
  succesrate: 'success rate',
  succes: 'success',
  'falure rate': 'failure rate',
  falure: 'failure',
  'transakasi': 'transaksi',
  'persentasi': 'persentase',
  alay: 'alat',
  'didalamnya': 'di dalamnya',
  'kinerjanya': 'kinerja',
  'efisiennya': 'efisien',
  'hasilnya': 'hasil',
};

const TYPO_KEYS = Object.keys(TYPO_CORRECTIONS).sort((a, b) => b.length - a.length);

export function correctQueryTypos(text: string): string {
  let out = String(text ?? '').toLowerCase();
  for (const from of TYPO_KEYS) {
    const pattern = new RegExp(`\\b${from.replace(/\s+/g, '\\s+')}\\b`, 'g');
    if (pattern.test(out)) out = out.replace(pattern, TYPO_CORRECTIONS[from]);
  }
  return out;
}

export function normalizeText(text: string): string {
  return correctQueryTypos(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(DIACRITIC_RE, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUESTION_WORD_RE =
  /^(berapa|bagaimana|apakah|mengapa|kenapa|sejak|siapa|kapan|kapankah|apa|mana|mana\s+saja|which|how|why|what|when|who|where|berapa\s+banyak|bagaimana\s+dengan)/;

export function stripQuestionWords(text: string): string {
  return text.replace(QUESTION_WORD_RE, '').trim();
}

/** Sinonim ID/EN → bentuk kanonik yang dipakai oleh intent & query. */
const SYNONYMS: Record<string, string> = {
  transaksi: 'transaksi',
  transaction: 'transaksi',
  kanal: 'kanal',
  channel: 'kanal',
  gagal: 'gagal',
  failure: 'gagal',
  failed: 'gagal',
  omzet: 'nilai',
  nilai: 'nilai',
  amount: 'nilai',
  gmv: 'nilai',
  'bulan ini': 'bulan_ini',
  'this month': 'bulan_ini',
  bandingkan: 'bandingkan',
  compare: 'bandingkan',
  'sejak kapan': 'sejak_kapan',
  'when did': 'sejak_kapan',
  prosedur: 'prosedur',
  sop: 'prosedur',
  langkah: 'prosedur',
  'pengembalian dana': 'refund',
  refund: 'refund',
  ambang: 'ambang',
  threshold: 'ambang',
  batas: 'ambang',
  'waktu proses': 'processing',
  'processing time': 'processing',
  durasi: 'processing',
  total: 'total',
  jumlah: 'jumlah',
  volume: 'volume',
  sukses: 'sukses',
  success: 'sukses',
  rate: 'rate',
  'failure rate': 'failure_rate',
  'success rate': 'success_rate',
  kontribusi: 'kontribusi',
  kelebihan: 'kelebihan',
  eskalasi: 'eskalasi',
  'level eskalasi': 'eskalasi',
  pendapatan: 'nilai',
};

const SYNONYM_KEYS = Object.keys(SYNONYMS).sort((a, b) => b.length - a.length);

export function expandSynonyms(text: string): string {
  let out = text;
  for (const key of SYNONYM_KEYS) {
    const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    out = out.replace(re, SYNONYMS[key]);
  }
  return out;
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

const STOPWORDS = new Set([
  'yang', 'di', 'pada', 'untuk', 'dari', 'ini', 'itu', 'the', 'of', 'for', 'in', 'is',
  'dan', 'atau', 'dengan', 'oleh', 'ke', 'saya', 'kita', 'mereka', 'anda', 'kamu',
  'apa', 'siapa', 'kapan', 'mana', 'bagaimana', 'mengapa', 'kenapa', 'sejak', 'berapa',
  'banyak', 'tersebut', 'itu', 'ini', 'sudah', 'telah', 'masih', 'belum', 'per',
]);

export function stopwordTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

/** Deteksi nama kanal persis dari seed.channels (case-insensitive + CHxx code). */
export function detectChannel(db: DB, text: string): string | null {
  const q = normalizeText(text);
  if (!q) return null;
  const rows = allRows(db, 'SELECT channel_id, channel_name FROM seed.channels ORDER BY channel_name');
  for (const row of rows) {
    const name = str(row.channel_name).toLowerCase();
    if (name && q.includes(name)) return str(row.channel_name);
  }
  const code = q.match(/\bch\d{2}\b/);
  if (code) {
    const row = allRows(db, 'SELECT channel_name FROM seed.channels WHERE channel_id = ?', [code[0].toUpperCase()]);
    if (row[0]) return str(row[0].channel_name);
  }
  return null;
}

/** Deteksi kategori persis dari seed.transactions DISTINCT category. */
export function detectCategory(db: DB, text: string): string | null {
  const q = normalizeText(text);
  if (!q) return null;
  const rows = allRows(db, 'SELECT DISTINCT category FROM seed.transactions');
  for (const row of rows) {
    const name = str(row.category).toLowerCase();
    if (name && q.includes(name)) return str(row.category);
  }
  return null;
}

export function detectFailureCode(text: string): string | null {
  const m = normalizeText(text).match(/\bf\d{2}\b/);
  return m ? m[0].toUpperCase() : null;
}

/**
 * Deteksi kode kegagalan dari NAMA kanonik di seed.failure_codes
 * (mis. "BANK_TIMEOUT" → F04, "GATEWAY_ERROR" → F05). Dipakai supaya
 * "failure code BANK_TIMEOUT" diperlakukan sama dengan "failure code F04".
 */
export function detectFailureCodeByName(db: DB, text: string): string | null {
  const candidates = text.toUpperCase().match(/\b[A-Z][A-Z0-9_]{3,}\b/g);
  if (!candidates?.length) return null;
  const rows = allRows(db, 'SELECT failure_code, failure_name FROM seed.failure_codes');
  for (const row of rows) {
    const name = str(row.failure_name).toUpperCase();
    if (name && candidates.includes(name)) return str(row.failure_code).toUpperCase();
  }
  return null;
}

/** Kata kunci yang menandakan pertanyaan meminta DEFINISI/PENJELASAN kode. */
const FAILURE_CODE_DEF_RE =
  /\b(berarti|artinya|apa\s+itu|itu\s+apa|jelaskan|penjelasan|definisi|maksud|kode|code|what|mean|means|explain|define|stands\s+for)\b/i;

/** Kata kunci agregasi: tetap SQL, bukan lookup definisi. */
const FAILURE_CODE_AGG_RE =
  /\b(paling\s+sering|paling\s+banyak|terbanyak|dominan|teratas|top|frekuensi|per\s+1000|kontribusi|paling\s+berkontribusi|most\s+frequent|frequency|count)\b/i;

/**
 * True bila pertanyaan meminta penjelasan satu kode kegagalan yang JELAS
 * (F01–F12 atau nama kanoniknya), bukan agregat statistik.
 */
export function isFailureCodeLookup(
  db: DB,
  text: string,
  code: string | null = detectFailureCode(text) ?? detectFailureCodeByName(db, text),
): boolean {
  if (!code) return false;
  if (FAILURE_CODE_AGG_RE.test(text)) return false;
  return FAILURE_CODE_DEF_RE.test(text);
}

export function detectIncidentId(text: string): string | null {
  const m = normalizeText(text).match(/\binc-2026-\d{4}\b/);
  return m ? m[0].toUpperCase() : null;
}

const MONTH_ALIASES: Record<string, string> = {
  januari: '01', jan: '01',
  februari: '02', feb: '02',
  maret: '03', mar: '03',
  april: '04', apr: '04',
  mei: '05',
  juni: '06', jun: '06',
  juli: '07', jul: '07',
  agustus: '08', agu: '08', aug: '08',
  september: '09', sep: '09', sept: '09',
  oktober: '10', okt: '10', oct: '10',
  november: '11', nov: '11',
  desember: '12', des: '12', dec: '12',
};

/** Deteksi "Desember 2026" → {month:'2026-12', year:2026}; null bila tidak ada bulan eksplisit. */
export function detectMonthPhrase(text: string): { month: string; year: number } | null {
  const q = normalizeText(text);
  const m = q.match(/(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|mei|jun|jul|agu|sep|sept|okt|nov|des|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{4})/);
  if (m) {
    const month = MONTH_ALIASES[m[1]];
    if (month) return { month: `${m[2]}-${month}`, year: Number(m[2]) };
  }
  return null;
}

/** Deteksi frasa periode dari teks pertanyaan (bulan ini, sejak 15 Oktober, …). */
export function detectPeriodPhrase(text: string): string | null {
  const q = normalizeText(text);
  if (/(bulan ini|this month|bulan berjalan|mtd)/.test(q)) return 'this_month';
  if (/(bulan lalu|last month|bulan sebelumnya)/.test(q)) return 'last_month';
  if (/(3 bulan terakhil|last 3 months|3 bulan terakhir)/.test(q)) return 'last_3_months';
  if (/(minggu ini|this week)/.test(q)) return 'this_week';
  if (/(7 hari terakhil|last 7 days)/.test(q)) return 'last_7_days';
  if (/(sejak 15 oktober|since oct 15|sejak 15\s+oktober)/.test(q)) return 'since_oct_15';
  if (/(september 2026|sep 2026|sept 2026|september\s+2026)/.test(q)) return 'september_2026';
  if (/(oktober 2026|okt 2026|oct 2026)/.test(q)) return 'oktober_2026';
  if (/(november 2026|nov 2026)/.test(q)) return 'november_2026';
  if (/(desember 2026|dec 2026)/.test(q)) return 'desember_2026';
  if (/(agustus 2026|agu 2026|aug 2026)/.test(q)) return 'agustus_2026';
  if (/(mei 2026)/.test(q)) return 'mei_2026';
  if (/(juni 2026|juli 2026)/.test(q)) return 'juni_2026';
  if (/(april 2026)/.test(q)) return 'april_2026';
  if (/(februari 2026|maret 2026)/.test(q)) return 'februari_2026';
  return null;
}

export type Normalized = {
  raw: string;
  text: string;
  tokens: string[];
  channel: string | null;
  category: string | null;
  failureCode: string | null;
  /** True bila pertanyaan meminta definisi kode (bukan agregat SQL). */
  failureCodeLookup: boolean;
  incidentId: string | null;
  monthPhrase: { month: string; year: number } | null;
  periodPhrase: string | null;
};

export function normalizeQuestion(db: DB, question: string): Normalized {
  const raw = question;
  // Teks untuk scoring: lowercase + strip diakritik saja. Sinonim & strip kata
  // tanya TIDAK dipakai di sini agar frasa trigger multi-kata ("sejak kapan",
  // "failure rate", "processing time") tetap utuh saat dicocokkan.
  const text = normalizeText(question);
  const failureCode = detectFailureCode(question) ?? detectFailureCodeByName(db, question);
  return {
    raw,
    text,
    tokens: tokenize(text),
    channel: detectChannel(db, question),
    category: detectCategory(db, question),
    failureCode,
    failureCodeLookup: isFailureCodeLookup(db, question, failureCode),
    incidentId: detectIncidentId(question),
    monthPhrase: detectMonthPhrase(question),
    periodPhrase: detectPeriodPhrase(question),
  };
}
