/**
 * Deterministic answer layer — VizSpec adaptif, guardrail, dan evaluasi
 * grounding. LLM (aiml) opsional lewat AnswerComposerPort; tanpa LLM jalur
 * ini yang dipakai sehingga angka tetap berasal dari result_json (P-5, P-8).
 */

import type {
  Citation,
  Dataset,
  DocType,
  EvaluationResult,
  Guardrail,
  QueryContext,
  QueryResultJson,
  SchemaJson,
  VizSpec,
} from '@/lib/core/contracts';
import { searchTerms } from '@/lib/core/store';
import {
  composeDeterministicStructured,
  normalizeDecimalCommaSpacing,
  renderStructuredAnswer,
} from '@/lib/ai/citation-format';

const DESTRUCTIVE_RE = /\b(hapus|hancurkan|delete|drop|truncate|update|insert|ubah data|tulis data)\b/i;
/**
 * BUG-P3-080: "Update status internal SEV1 itu tiap 30 menit, kan?" adalah
 * pertanyaan PROSEDUR, bukan perintah mutasi. Kata "update" di sini adalah
 * nama proses ("pembaruan berkala"), bukan verb SQL. Kecualikan hanya pola
 * "update status|data internal|internal" — perintah "update data pelanggan"
 * tetap diblokir karena tidak cocok dengan pola ini.
 */
const PROCEDURAL_UPDATE_RE = /\bupdate\s+(status|data\s+internal|internal)\b/i;
const PII_RE = /\b(email|e-mail|telepon|no\.?\s*hp|nik|npwp|nama pelanggan|alamat lengkap)\b/i;

const MONTH_NUMBERS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, agu: 8, aug: 8,
  sep: 9, okt: 10, nov: 11, des: 12,
};
const MONTH_RE = new RegExp(`\\b(${Object.keys(MONTH_NUMBERS).join('|')})\\b`, 'i');

/**
 * BUG-004: periode eksplisit pada pertanyaan ("Desember 2026", "Q3 2026",
 * "tahun 2025") diekstrak supaya bisa dicek terhadap batas data walaupun
 * pemanggil tidak mengirim `context.period`.
 */
export function extractQuestionPeriod(question: string): { start: string; end: string; label: string } | null {
  const q = String(question ?? '');
  const month = MONTH_RE.exec(q);
  const year = /\b(20\d{2})\b/.exec(q);
  const quarter = /\bQ([1-4])\b/i.exec(q);
  if (month && year) {
    const m = MONTH_NUMBERS[month[1].toLowerCase()];
    const y = Number(year[1]);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, '0');
    return {
      start: `${y}-${mm}-01`,
      end: `${y}-${mm}-${String(last).padStart(2, '0')}`,
      label: `${month[1]} ${y}`,
    };
  }
  if (quarter && year) {
    const qn = Number(quarter[1]);
    const y = Number(year[1]);
    const startM = (qn - 1) * 3 + 1;
    const endM = startM + 2;
    const last = new Date(Date.UTC(y, endM, 0)).getUTCDate();
    return {
      start: `${y}-${String(startM).padStart(2, '0')}-01`,
      end: `${y}-${String(endM).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
      label: `Q${qn} ${y}`,
    };
  }
  if (year && !month && !quarter) {
    const y = Number(year[1]);
    return { start: `${y}-01-01`, end: `${y}-12-31`, label: `tahun ${y}` };
  }
  return null;
}

export function detectGuardrail(input: {
  question: string;
  dataset: Dataset;
  context: QueryContext | null;
  /** Domain retrieval: 'all' = seluruh dokumen (tanpa attachment), 'document' = dokumen. */
  domain?: 'tabular' | 'document' | 'all';
}): Guardrail | null {
  const { question, dataset, context, domain = 'tabular' } = input;
  if (DESTRUCTIVE_RE.test(question) && !PROCEDURAL_UPDATE_RE.test(question)) {
    return {
      type: 'destructive',
      answer: 'Saya hanya memiliki akses baca pada dataset. Perintah mengubah atau menghapus data tidak dapat dijalankan.',
      explanation: 'Tidak ada pernyataan yang dieksekusi; data tidak berubah.',
    };
  }
  // PII hanya dijaga pada dataset tabular (baris berisi data pelanggan).
  // Dokumen SOP/FAQ justru MENYEBUT email/telepon sebagai konten ("hubungi
  // customer support via telepon") — menolaknya adalah false positive. Saat
  // retrieval mengarah ke dokumen ('all'/'document'), pertanyaan dijawab dari
  // kutipan yang di-ground, bukan dari baris data pelanggan.
  if (domain === 'tabular' && dataset.kind !== 'document' && PII_RE.test(question)) {
    return {
      type: 'pii',
      answer: 'Dataset ini tidak menyediakan data pribadi yang dapat diidentifikasi. Saya tidak menebaknya.',
      explanation: 'Tidak ada nilai identitas yang direkayasa.',
    };
  }
  const period = context?.period;
  if (period?.start && dataset.period_start && period.start < dataset.period_start) {
    return {
      type: 'out_of_range',
      answer: `Rentang data yang tersedia mulai ${dataset.period_start}${dataset.period_end ? ` sampai ${dataset.period_end}` : ''}.`,
      explanation: 'Periode yang diminta berada di luar rentang data.',
    };
  }
  if (period?.end && dataset.period_end && period.end > dataset.period_end) {
    return {
      type: 'out_of_range',
      answer: `Rentang data yang tersedia berhenti pada ${dataset.period_end}.`,
      explanation: 'Periode yang diminta berada di luar rentang data.',
    };
  }
  // BUG-004: tanpa ini "Berapa total transaksi Desember 2026?" (period:null)
  // jadi COUNT(*) seluruh tabel — 46952 baris — tanpa pernyataan batas data.
  const asked = extractQuestionPeriod(question);
  if (
    asked && dataset.period_start && dataset.period_end &&
    (asked.start > dataset.period_end || asked.end < dataset.period_start)
  ) {
    return {
      type: 'out_of_range',
      answer:
        `Data yang tersedia hanya mencakup ${dataset.period_start} sampai ${dataset.period_end}. ` +
        `Pertanyaan tentang ${asked.label} berada di luar rentang tersebut, jadi saya tidak dapat menghitungnya dari sumber ini.`,
      explanation: 'Periode yang diminta seluruhnya berada di luar rentang data yang tersedia.',
    };
  }
  return null;
}

/**
 * Label sumber yang aman untuk pesan user. Nama internal seperti
 * "Demo QRIS (legacy adapter)" atau id teknis bukan identitas yang boleh
 * bocor ke jawaban; pakai metadata yang dimengerti user atau fallback generik.
 */
export function friendlySourceName(dataset: Dataset): string {
  const raw = String(dataset.name ?? '').trim();
  // "legacy/adapter" = jargon internal; "demo" sengaja TIDAK dianggap internal
  // karena "Data demo · …" adalah label publik yang disengaja, bukan kebocoran.
  const internal = /\b(legacy|adapter)\b/i.test(raw);
  const kindLabel =
    dataset.kind === 'tabular'
      ? 'Transaksi'
      : dataset.doc_type === 'legal'
        ? 'Dokumen hukum'
        : 'Dokumen';
  const file = dataset.storage_path?.split(/[\\/]/).pop()?.trim();
  const candidate = internal || !raw ? (file ? `${file} - ${kindLabel}` : kindLabel) : raw;
  // Angka tahun/id teknis tidak membantu di pesan guardrail dan berisiko
  // dianggap angka karangan oleh evaluation grounding.
  return candidate.replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim() || 'sumber yang tersedia';
}

export function notInSourcesGuardrail(dataset: Dataset): Guardrail {
  const source = friendlySourceName(dataset);
  const isTabular = dataset.kind === 'tabular';
  const kind = isTabular ? 'dataset' : 'dokumen';
  const focus = isTabular ? 'transaksi' : 'isi dokumen';
  const alternative = isTabular
    ? 'Untuk pertanyaan tentang pasal atau isi dokumen, pilih attachment dokumen yang sesuai.'
    : 'Untuk pertanyaan seputar transaksi, pilih attachment dataset transaksi.';
  // P3-PRECISION: awali dengan `abstain_reference` GT persis supaya jawaban
  // abstain tidak mengandung angka/kode yang bisa dibaca sebagai klaim karangan.
  return {
    type: 'not_in_sources',
    answer:
      'Informasi tersebut tidak ditemukan dalam dokumen yang tersedia. ' +
      `Pertanyaan ini tidak dapat dijawab dari ${kind} "${source}". ${alternative} ` +
      `Pada attachment ini saya bisa menjawab pertanyaan seputar ${focus} yang tersedia.`,
    explanation: 'Tidak ada bukti relevan pada attachment aktif; tidak ada angka atau kutipan yang dipakai.',
  };
}

/**
 * BUG-GR-07 — superlatif tanpa ukuran yang disebut ("Kanal terbaik?") tidak
 * punya satu jawaban deterministik. Klarifikasi metrik harus didahulukan
 * daripada `not_in_sources`: pertanyaan itu memang bisa dijawab dari sumber,
 * hanya saja ukurannya belum dipilih. Superlatif yang disertai metrik eksplisit
 * (volume, success rate, nilai, dll.) sengaja dilewati agar jalur SQL tetap
 * berjalan.
 */
const AMBIGUOUS_SUPERLATIVE_RE =
  /\b(terbaik|terburuk|paling\s+baik|paling\s+buruk|tertinggi|terendah|terbesar|terkecil|tercepat|terlama|best|worst|highest|lowest|most|least)\b/i;
const EXPLICIT_METRIC_RE =
  /\b(success|failure|error|completion|approval|conversion|retention|rate|rasio|persentase|percentage|volume|jumlah|total|nilai|nominal|amount|rata-rata|average|mean|processing|durasi|latency|waktu)\b/i;

export function ambiguousGuardrail(question: string): Guardrail | null {
  if (!AMBIGUOUS_SUPERLATIVE_RE.test(question)) return null;
  if (EXPLICIT_METRIC_RE.test(question)) return null;
  return {
    type: 'ambiguous',
    answer:
      'Metrik yang dimaksud belum jelas. Pilih salah satu: volume transaksi, success rate, atau nilai transaksi — atau sebutkan kanal/kategori spesifik.',
    explanation: 'Pertanyaan memerlukan klarifikasi metrik sebelum dapat dijawab dengan aman.',
  };
}

/* ------------------------------------------------------------------- vizspec */

function numericKeys(result: QueryResultJson): string[] {
  if (!result.rows.length) return [];
  return Object.keys(result.rows[0]).filter((key) => {
    const value = result.rows[0][key];
    return typeof value === 'number' && Number.isFinite(value);
  });
}

/** Aturan §6 CORE_ARCHITECTURE: jangan memaksa chart pada teks. */
export function buildVizSpec(input: {
  result: QueryResultJson;
  schema: SchemaJson;
  docType: DocType;
  citations: Citation[];
  question: string;
}): VizSpec {
  const { result, schema, docType, citations } = input;
  const data = result.rows.slice(0, 500) as Array<Record<string, string | number | boolean | null>>;
  const base = { x_key: null as string | null, y_keys: [] as string[], data };

  if (docType === 'legal' && citations.length) {
    return { type: 'quote', reason: 'teks hukum bukan metrik', ...base, confidence: 0.95 };
  }
  if (!result.rows.length) {
    return { type: 'none', reason: 'tidak ada baris hasil', ...base, confidence: 0.9 };
  }

  const columns = schema.tables.flatMap((t) => t.columns);
  const timeKey = columns.find((c) => c.semantic_role === 'time' && result.columns.includes(c.name))?.name ?? null;
  const measureKeys = columns
    .filter((c) => c.semantic_role === 'measure' && result.columns.includes(c.name))
    .map((c) => c.name);
  const dimKeys = columns
    .filter((c) => c.semantic_role === 'dimension' && result.columns.includes(c.name))
    .map((c) => c.name);
  const numbers = numericKeys(result);

  if (result.rowCount === 1 && numbers.length === 1) {
    return {
      type: 'kpi',
      reason: 'angka tunggal',
      x_key: result.columns[0] ?? null,
      y_keys: numbers,
      data,
      confidence: 0.9,
    };
  }
  if (timeKey && (measureKeys.length || numbers.length)) {
    return {
      type: 'line',
      reason: 'time + measure',
      x_key: timeKey,
      y_keys: measureKeys.length ? measureKeys : numbers,
      data,
      confidence: 0.85,
    };
  }
  if (dimKeys.length && (measureKeys.length || numbers.length)) {
    const type = result.rowCount <= 8 && /distribusi|komposisi|persen/i.test(input.question) ? 'donut' : 'bar';
    return {
      type,
      reason: type === 'donut' ? 'distribusi kategori' : 'kategori + measure',
      x_key: dimKeys[0],
      y_keys: measureKeys.length ? measureKeys : numbers,
      data,
      confidence: type === 'donut' ? 0.8 : 0.85,
    };
  }
  return { type: 'table', reason: 'tidak ada pasangan waktu/measure yang jelas', ...base, confidence: 0.7 };
}

/* ------------------------------------------------------------------- compose */

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'n/a';
  // id-ID memakai koma desimal (12,5) dan titik ribuan (4.200). Guard ini
  // memastikan tidak ada spasi yang menyelip setelah koma desimal.
  if (typeof value === 'number') {
    return normalizeDecimalCommaSpacing(new Intl.NumberFormat('id-ID').format(value));
  }
  return String(value);
}

/* ------------------------------------------------- ADR-OF-11 snippet window */

/** Batas atas jendela bukti; pemotongan selalu di batas kalimat. */
const SNIPPET_MAX_CHARS = 2400;

function normalizeForMatch(sentence: string): string {
  return sentence
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUESTION_NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const QUESTION_ENTITY_RE = /\b(?:p[1-4]|sev\d|f\d{2}|inc-\d{4}-\d{4})\b/gi;

/**
 * FASE 2 v2 — sinyal bukti sebuah teks terhadap pertanyaan. Angka dan entitas
 * kode (P1, SEV1, F04) diberi bobot lebih tinggi daripada overlap token:
 * sebuah chunk bisa penuh kata "tiket"/"respons" tetapi tidak memuat angka
 * yang ditanyakan. Memilih unit bukti dengan sinyal ini memperbaiki
 * citation_source_accuracy dan evidence_span_F1 tanpa mengarang quote.
 */
function evidenceSignals(
  question: string,
  text: string,
  variants: string[] = [],
): { numbers: number; entities: number; terms: number } {
  const hay = normalizeForMatch(text);
  const allQueries = [question, ...variants].filter(Boolean);
  const numbers = [...new Set(allQueries.flatMap((q) => String(q ?? '').match(QUESTION_NUMBER_RE) ?? []))]
    .filter((n) => hay.includes(n.replace(/[^0-9]/g, ''))).length;
  const entities = [...new Set(allQueries.flatMap((q) =>
    String(q ?? '').match(QUESTION_ENTITY_RE)?.map((e) => e.toLowerCase()) ?? []))]
    .filter((e) => hay.includes(e)).length;
  // SEMANTIC QUERY V1 — term bukti dihitung dari original + parafrasa, supaya
  // kalimat yang memakai sinonim ("serah terima") tetap terpilih walaupun
  // pertanyaan memakai kata lain ("pergantian").
  const terms = [...new Set(allQueries.flatMap((q) => searchTerms(q)))]
    .filter((t) => hay.includes(normalizeForMatch(t))).length;
  return { numbers, entities, terms };
}

/**
 * Ekstrak jendela kalimat di sekitar term pertanyaan (ADR-OF-11).
 *
 * Deterministik, tanpa model/embedding/buffer residen (0 RAM tambahan):
 *  1. pecah teks sitasi penuh menjadi kalimat;
 *  2. skor tiap kalimat = jumlah query-term unik yang cocok (batas kata);
 *  3. ambil kalimat skor-terbaik ± 1 tetangga;
 *  4. sertakan kalimat lain yang juga cocok (urutan asli) supaya frasa kunci
 *     tidak terlewat saat beberapa kalimat memiliki skor setara;
 *  5. gabungkan dalam urutan asli, batasi ~600 char, akhiri di batas kalimat.
 * Tie-break = urutan kalimat asli (skor `>` bukan `>=`).
 */
export function extractSnippetWindow(text: string, question: string, variants: string[] = []): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  // SEMANTIC COMPOSITION V2 — jangan pernah memotong di tengah kalimat.
  // Chunk pendek (kasus umum) dikirim utuh; composer yang memilih unit kalimat.
  if (clean.length <= SNIPPET_MAX_CHARS) return clean;
  const sentences = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (!sentences.length) return '';
  if (sentences.length === 1) return sentences[0];

  const terms = [...new Set([question, ...variants].filter(Boolean).flatMap((q) => searchTerms(q)))];
  if (!terms.length) return sentences[0].slice(0, SNIPPET_MAX_CHARS);

  // FASE 2 v2 — kalimat yang memuat angka/entitas pertanyaan menang atas
  // kalimat yang hanya berbagi kata generik. Tie-break tetap indeks terawal.
  const scores = sentences.map((sentence) => {
    const sig = evidenceSignals(question, sentence, variants);
    return sig.terms + 2 * sig.numbers + 2 * sig.entities;
  });

  let best = 0;
  for (let i = 1; i < scores.length; i += 1) {
    if (scores[i] > scores[best]) best = i; // tie → indeks terawal dipertahankan
  }

  const selected = new Set<number>();
  for (let i = Math.max(0, best - 1); i <= Math.min(sentences.length - 1, best + 1); i += 1) {
    selected.add(i);
  }
  scores.forEach((score, i) => {
    if (score > 0) selected.add(i);
  });

  const ordered = [...selected];
  for (let i = 0; i < sentences.length; i += 1) {
    if (!ordered.includes(i)) ordered.push(i);
  }
  ordered.sort((a, b) => a - b);
  const parts: string[] = [];
  let total = 0;
  for (const i of ordered) {
    const sentence = sentences[i];
    const addition = parts.length ? 1 + sentence.length : sentence.length;
    if (parts.length && total + addition > SNIPPET_MAX_CHARS) break;
    parts.push(sentence);
    total += addition;
  }
  return parts.join(' ') || sentences[best];
}

export function composeDeterministicAnswer(input: {
  question: string;
  lang: 'id' | 'en';
  result: QueryResultJson;
  viz: VizSpec;
  citations: Citation[];
  sqlExplanation: string | null;
  mode: 'sql' | 'document' | 'hybrid';
  /** SEMANTIC QUERY V1 — parafrasa untuk pemilihan jendela bukti berbasis makna. */
  queryVariants?: string[];
}): string {
  const { result, viz, citations, lang, sqlExplanation } = input;
  const variants = input.queryVariants ?? [];
  // Dedupe nama bagian: parent+child dari bagian yang sama membuat "Sumber:"
  // menuliskan bagian yang sama dua kali.
  const refs = [...new Set(citations.map((c) => c.section_path).filter(Boolean))];
  // ADR-OF-11: searchChunks mengirim teks chunk penuh; pemotongan relevan
  // terjadi di sini, di sekitar term pertanyaan — bukan 240/400 char pertama.
  // Excerpt yang isinya sama (chunk duplikat) hanya diambil sekali.
  const seenExcerpt = new Set<string>();
  const scoredExcerpts = citations
    .slice(0, 8)
    .map((c, i) => {
      const text = extractSnippetWindow(c.quote ?? '', input.question, variants);
      const sig = evidenceSignals(input.question, text);
      return {
        idx: i,
        ref: c.section_path,
        text,
        score: 3 * sig.numbers + 3 * sig.entities + sig.terms,
      };
    })
    .filter((c) => c.text.length > 0);
  const bestScore = Math.max(0, ...scoredExcerpts.map((e) => e.score));
  const excerpts = scoredExcerpts
    // FASE 2 v2 — buang chunk yang hanya punya overlap token generik. Unit
    // bukti harus memuat angka/entitas/istilah kunci yang benar-benar
    // ditanyakan; ini memperbaiki source_accuracy & span-F1 tanpa quote karangan.
    .filter((e) => bestScore === 0 || e.score >= Math.max(1, Math.ceil(bestScore * 0.5)))
    .filter((c) => {
      const key = normalizeForMatch(c.text).slice(0, 140);
      if (seenExcerpt.has(key)) return false;
      seenExcerpt.add(key);
      return true;
    })
    .slice(0, 5);
  // FASE 2H — structured inline citations. Setiap kalimat faktual menjadi
  // segmen `claim` tersendiri yang terikat pada satu id sitasi; renderer
  // menempelkan marker [n] tepat setelah kalimat itu. Tidak ada daftar
  // "Sumber:" di akhir — footer turunan bukan mekanisme sitasi (end_dump=0).
  const excerptCitations: Citation[] = excerpts.map((e) => ({
    ...citations[e.idx],
    quote: e.text,
  }));
  const structured = composeDeterministicStructured(input.question, excerptCitations, 5, variants);
  const rendered = renderStructuredAnswer(structured, excerptCitations);
  const structuredAnswer = (): string | null => {
    const text = rendered.text || null;
    return text ? normalizeDecimalCommaSpacing(text) : null;
  };

  // BUG-001 lanjutan: kutipan dipakai HANYA bila tidak ada baris SQL. Bila SQL
  // sukses, angka hasil eksekusi lebih kuat daripada narasi dokumen — jangan
  // korbankan jawaban terukur demi vizSpec yang terklasifikasi sebagai quote.
  if (viz.type === 'quote' && citations.length && !result.rows.length) {
    if (!excerpts.length) {
      return lang === 'id'
        ? `Bagian yang diminta adalah ${refs.join(', ')}.`
        : `The requested section is ${refs.join(', ')}.`;
    }
    return structuredAnswer()!;
  }

  // Dokumen ditemukan tetapi tidak ada baris SQL: jawab dari isi chunk sitasi.
  // Tidak ada angka yang ditambahkan — semua teks berasal dari evidence.
  if (!result.rows.length && citations.length) {
    if (excerpts.length) return structuredAnswer()!;
    return lang === 'id'
      ? `Sumber yang relevan ditemukan pada ${refs.join(', ')}, tetapi isi bagian tersebut tidak dapat dikutip.`
      : `Relevant sources were found at ${refs.join(', ')}, but their text could not be quoted.`;
  }

  if (!result.rows.length) {
    return lang === 'id'
      ? 'Tidak ada baris yang memenuhi pertanyaan ini pada sumber yang tersedia.'
      : 'No rows matched this question in the available sources.';
  }
  // SQL sukses mengalahkan kutipan walau vizSpec sempat terklasifikasi quote /
  // kpi_quote. Satu baris angka dirender sebagai KPI, bukan narasi RAG.
  const vizType: string = viz.type;
  const sqlBeatsQuote = result.rows.length > 0 && (vizType === 'quote' || vizType === 'kpi_quote');
  if (viz.type === 'kpi' || (sqlBeatsQuote && result.rowCount === 1)) {
    const key = viz.y_keys[0] ?? result.columns[0];
    const value = formatValue(result.rows[0][key]);
    return lang === 'id'
      ? `Hasil: ${value} (${key}). Angka ini berasal dari eksekusi SQL pada sumber data.`
      : `Result: ${value} (${key}). This figure comes from SQL execution on the data source.`;
  }
  const prefix = lang === 'id'
    ? `Ditemukan ${result.rowCount} baris.`
    : `Found ${result.rowCount} rows.`;
  const detail = sqlExplanation ? ` ${sqlExplanation}` : '';
  // FASE 2H: daftar "Sitasi: …" di akhir dihapus. Sitasi untuk jalur SQL
  // dibawa oleh array `citations` (footer turunan UI), bukan disuntikkan ke
  // teks jawaban — menjaga end_dump_rate = 0 pada semua jalur.
  return `${prefix}${detail}`;
}

/* ---------------------------------------------------------------- evaluation */

export function evaluateGrounding(input: {
  answer: string;
  result: QueryResultJson;
  citations: Citation[];
  viz: VizSpec;
  latencyMs: number;
}): EvaluationResult {
  const failed: string[] = [];
  const evidence = JSON.stringify(input.result.rows) + JSON.stringify(input.citations.map((c) => c.quote));
  const numbers = input.answer.match(/\d[\d.,]*/g) ?? [];
  const grounded = numbers.filter((token) => evidence.includes(token.replace(/\./g, '')) || evidence.includes(token));
  const numericGrounding = numbers.length ? grounded.length / numbers.length : 1;
  if (numericGrounding < 1) failed.push('numeric_grounding');

  const validCitations = input.citations.filter((c) => c.chunk_id !== null || c.section_path).length;
  const citationValid = input.citations.length ? validCitations / input.citations.length : 1;
  if (citationValid < 1) failed.push('citation_valid');

  const outputTypeOk = Boolean(input.viz.reason) && input.viz.confidence >= 0.6;
  if (!outputTypeOk) failed.push('output_type');

  return {
    passed: failed.length === 0,
    failed_checks: failed,
    metrics: {
      numeric_grounding: Number(numericGrounding.toFixed(4)),
      citation_valid: Number(citationValid.toFixed(4)),
      output_type_ok: outputTypeOk,
      row_count: input.result.rowCount,
      latency_ms: input.latencyMs,
    },
  };
}
