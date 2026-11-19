/**
 * TanyaData AI — guardrail (lib/ai/guardrails.ts).
 *
 * Selalu menghasilkan HTTP 200 (via AnswerQuestionResult), sql=null,
 * tanpa angka karangan. Tujuh kasus F3: out_of_range, not_in_sources,
 * destructive, pii, ambiguous, unsupported (+ smalltalk tidak guardrail).
 */
import type { DB } from '@/lib/db/client';
import type { Scope } from '@/lib/analytics/scope';
import type {
  AnswerQuestionInput,
  AnswerQuestionResult,
  GuardrailType,
  Lang,
} from '@/lib/contracts/http';
import { freshContext } from '@/lib/ai/compose';

type GuardrailText = { answer: string; explanation: string; followUps: string[] };

function texts(type: GuardrailType, lang: Lang, bounds: { minDate: string; maxDate: string }, question: string): GuardrailText {
  const id = lang === 'id';
  const min = bounds.minDate;
  const max = bounds.maxDate;
  switch (type) {
    case 'destructive':
      return {
        answer: id
          ? 'TanyaData hanya memiliki akses baca (read-only). Saya bisa menganalisis data, tetapi tidak bisa menghapus, mengubah, atau menjalankan perintah yang merusak data.'
          : 'TanyaData is read-only. I can analyze data but cannot delete, modify, or run commands that damage data.',
        explanation: id
          ? 'Perintah yang mengubah atau menghapus data diblokir; tidak ada statement yang dieksekusi.'
          : 'Commands that modify or delete data are blocked; no statement was executed.',
        followUps: id
          ? ['Berapa total transaksi bulan ini?', 'Analisis failure rate per kanal', 'Jelaskan SOP penanganan transaksi gagal']
          : ['What is total volume this month?', 'Analyze failure rate by channel', 'Explain the failed-transaction SOP'],
      };
    case 'pii':
      return {
        answer: id
          ? 'Dataset transaksi tidak memuat data pribadi pelanggan (email, nomor telepon, NIK, atau nama). Saya tidak akan menebak atau mengarangnya.'
          : 'The transaction dataset contains no customer PII (email, phone, national ID, or names). I will not guess.',
        explanation: id
          ? 'Tidak ada kolom identitas pelanggan di dataset.'
          : 'There is no customer identity column in the dataset.',
        followUps: id
          ? ['Berapa distribusi status transaksi?', 'Analisis kanal dengan failure rate tertinggi', 'SLA refund tiap kanal?']
          : ['What is the status distribution?', 'Analyze the highest failure-rate channel', 'Refund SLA by channel?'],
      };
    case 'out_of_range':
      return {
        answer: id
          ? `Data yang tersedia hanya mencakup ${min} sampai ${max}. Periode yang diminta berada di luar rentang tersebut, sehingga tidak dapat dihitung.`
          : `Available data only covers ${min} to ${max}. The requested period is outside that range and cannot be computed.`,
        explanation: id ? `Rentang data: ${min} s.d. ${max}.` : `Data range: ${min} to ${max}.`,
        followUps: id
          ? ['Total transaksi bulan ini', 'Tren tiga bulan terakhir', 'Perbandingan volume bulan ini vs bulan lalu']
          : ['Total transactions this month', 'Three-month trend', 'Volume comparison this month vs last month'],
      };
    case 'ambiguous':
      return {
        answer: id
          ? 'Metrik yang dimaksud belum jelas. Pilih salah satu: volume transaksi, success rate, atau nilai transaksi — atau sebutkan kanal/kategori spesifik.'
          : 'The metric is ambiguous. Choose one: transaction volume, success rate, or transaction value — or name a specific channel/category.',
        explanation: id
          ? 'Pertanyaan "kanal terbaik" memerlukan klarifikasi metrik.'
          : 'A "best channel" question requires metric clarification.',
        followUps: id
          ? ['Kanal dengan volume transaksi terbesar', 'Kanal dengan success rate tertinggi', 'Kanal dengan nilai transaksi sukses terbesar']
          : ['Channel with the largest volume', 'Channel with the highest success rate', 'Channel with the largest successful value'],
      };
    case 'unsupported':
      return {
        answer: id
          ? 'Pertanyaan ini di luar cakupan data transaksi dan dokumen operasional yang tersedia. Saya bisa menjawab metrik transaksi, perbandingan periode, investigasi kegagalan, atau prosedur dari dokumen.'
          : 'This question is outside the available transaction data and operational documents. I can answer transaction metrics, period comparisons, failure investigations, or document procedures.',
        explanation: id ? 'Tidak ada sumber yang mendukung pertanyaan ini.' : 'No source supports this question.',
        followUps: id
          ? ['Berapa success rate bulan ini?', 'Kanal mana yang failure rate-nya naik?', 'Apa SOP penanganan transaksi gagal?']
          : ['What is this month success rate?', 'Which channel failure rate increased?', 'What is the failed-transaction SOP?'],
      };
    case 'not_in_sources':
    default:
      return {
        answer: id
          ? 'Informasi tersebut tidak ditemukan pada dataset maupun dokumen operasional yang tersedia (SOP, FAQ, katalog kode, laporan, dan catatan insiden). Saya tidak akan mengarang jawaban.'
          : 'That information is not present in the available dataset or operational documents (SOP, FAQ, code catalog, reports, and incident notes). I will not fabricate an answer.',
        explanation: id ? 'Tidak ada chunk dokumen yang relevan.' : 'No relevant document chunks were found.',
        followUps: id
          ? ['Apa prosedur transaksi gagal?', 'Kode kegagalan F04 berarti apa?', 'Berapa SLA refund tiap kanal?']
          : ['What is the failed-transaction procedure?', 'What does failure code F04 mean?', 'What is the refund SLA by channel?'],
      };
  }
}

export function buildGuardrail(
  input: AnswerQuestionInput,
  type: GuardrailType,
  lang: Lang,
  scope: Scope | null,
  startedAt: number,
): AnswerQuestionResult {
  const bounds = { minDate: scope?.ref.minDate ?? '2026-08-01', maxDate: scope?.ref.maxDate ?? '2026-11-18' };
  const t = texts(type, lang, bounds, input.question);
  const latencyMs = Math.round(performance.now() - startedAt);
  const dataset = scope?.ref ?? {
    id: input.datasetId || 'seed',
    name: 'analytics.db - Transaksi',
    kind: 'seed' as const,
    rowCount: 0,
    minDate: bounds.minDate,
    maxDate: bounds.maxDate,
  };
  const context = freshContext((input.context?.turn ?? 0) + 1);
  context.lastDomain = 'guardrail';
  return {
    content: t.answer,
    answer: t.answer,
    keyFindings: [],
    supportingTable: null,
    visualizations: [],
    sql: null,
    sources: [],
    followUps: t.followUps,
    meta: {
      period: null,
      dataset,
      partial: true,
      rowCount: 0,
      mode: 'guardrail',
      latencyMs,
    },
    guardrail: { type, explanation: t.explanation },
    context,
    mode: 'guardrail',
    latencyMs,
  };
}

/** Deteksi awal guardrail yang dievaluasi paling dulu. */
export type EarlyGuardrail = GuardrailType | 'smalltalk' | null;

const DESTRUCTIVE_RE = /\b(hapus|hapuskan|delete|drop|truncate|update|insert|alter|create\s+table|replace|ganti\s+data|timpa|reset\s+data|remove\s+all|清空)\b/i;
const PII_RE = /([\w.+-]+@[\w-]+\.[\w.]+)|\b(0\d{2,3}[- ]?\d{3,4}[- ]?\d{3,4})\b|\b\d{16}\b|\bNIK\b|\bno\s*ktp\b|\bnomor\s*hp\b|\bemail\s*(pelanggan|customer)\b/i;
const OFF_TOPIC_RE = /\b(CEO|CTO|direktur utama|presiden direktur|cuaca|harga saham|prediksi saham|olahraga|天涯|siapa\s+pemilik|gaji\s+karyawan)\b/i;
const AMBIGUOUS_RE = /\b(kanal\s+terbaik|best\s+channel|metrik\s+terbaik|channel\s+terbaik|kanal\s+paling\s+baik|metrik\s+paling\s+baik)\b/i;
const GREETING_RE = /^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam)|terima\s+kasih|thanks|makasih)\b/i;

export function detectEarlyGuardrail(db: DB, question: string): EarlyGuardrail {
  const q = question.trim();
  if (DESTRUCTIVE_RE.test(q)) return 'destructive';
  if (PII_RE.test(q)) return 'pii';
  if (AMBIGUOUS_RE.test(q)) return 'ambiguous';
  if (OFF_TOPIC_RE.test(q)) return 'not_in_sources';
  if (GREETING_RE.test(q) && q.length < 40) return 'smalltalk';
  return null;
}

export function isSqlInjectionLike(question: string): boolean {
  return /\b(select\s+.+\s+from|union\s+select|;\s*drop|or\s+1\s*=\s*1|--|\/\*|\*\/)\b/i.test(question);
}
