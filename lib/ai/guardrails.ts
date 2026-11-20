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
import { isFailureCodeLookup } from '@/lib/ai/normalize';
import type { GuardrailResult, GuardrailType as CoreGuardrailType } from './types';

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
const AMBIGUOUS_RE = /\b(kanal\s+terbaik|best\s+channel|metrik\s+terbaik|channel\s+terbaik|kanal\s+paling\s+baik|metrik\s+paling\s+baik|performanya\s+(bagaimana|gimana)|bagaimana\s+performanya|kinerjanya\s+(bagaimana|gimana)|bagaimana\s+kinerjanya)\b/i;
const GREETING_RE = /^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam)|terima\s+kasih|thanks|makasih)\b/i;

export function detectEarlyGuardrail(db: DB, question: string): EarlyGuardrail {
  const q = question.trim();
  if (DESTRUCTIVE_RE.test(q)) return 'destructive';
  if (PII_RE.test(q)) return 'pii';
  // "Kode kegagalan F04 berarti apa?" punya entitas kode yang jelas:
  // ini document lookup, bukan klarifikasi metrik.
  if (isFailureCodeLookup(db, q)) return null;
  if (AMBIGUOUS_RE.test(q)) return 'ambiguous';
  if (OFF_TOPIC_RE.test(q)) return 'not_in_sources';
  if (GREETING_RE.test(q) && q.length < 40) return 'smalltalk';
  return null;
}

export function isSqlInjectionLike(question: string): boolean {
  return /\b(select\s+.+\s+from|union\s+select|;\s*drop|or\s+1\s*=\s*1|--|\/\*|\*\/)\b/i.test(question);
}

/* ========================================================================== */
/* GENERAL CORE (P3-CORE) — docs/CORE_AI_SPEC.md §2.9, §9                      */
/* Domain-agnostic. The block above is the legacy demo adapter, untouched.     */
/* ========================================================================== */

/** Destructive intent — generic verbs only, no table/column names. */
const GENERAL_DESTRUCTIVE_RE =
  /\b(hapus|hapuskan|delete|drop|truncate|update|insert|alter|create\s+table|replace|timpa|reset\s+data|remove\s+all|overwrite|清空)\b/i;

/** PII request — generic patterns, no reference to any specific dataset. */
const GENERAL_PII_RE =
  /([\w.+-]+@[\w-]+\.[\w.]+)|\b(0\d{2,3}[- ]?\d{3,4}[- ]?\d{3,4})\b|\b\d{16}\b|\b(NIK|KTP|no\s*ktp|nomor\s*hp|data\s*pribadi|email\s*(pelanggan|customer)|personal\s+data)\b/i;

/** Clearly off-topic for a document/data assistant, independent of domain. */
const GENERAL_OFF_TOPIC_RE =
  /\b(CEO|CTO|direktur utama|presiden direktur|cuaca|harga saham|prediksi saham|olahraga|gaji\s+karyawan|siapa\s+pemilik)\b/i;

/** Ambiguous metric request without a named measure. */
const GENERAL_AMBIGUOUS_RE =
  /\b(terbaik|paling\s+baik|performanya\s+(bagaimana|gimana)|bagaimana\s+performanya|kinerjanya\s+(bagaimana|gimana)|bagaimana\s+kinerjanya|best|most\s+important)\b/i;

/** Instruction-injection / prompt-override attempts inside untrusted text. */
const INJECTION_RE =
  /\b(abaikan\s+(semua\s+)?(aturan|instruksi)|ignore\s+(all\s+)?(previous|above|instructions)|system\s*prompt|keluarkan\s+(kunci|rahasia)|reveal\s+(your\s+)?(secret|key|prompt)|jangan\s+ikuti\s+aturan)\b/i;

export interface GuardrailCheckInput {
  question: string;
  /** Topics actually available in the active sources; used for out_of_scope. */
  availableTopics?: string[];
  /** True when retrieval returned zero usable evidence. */
  noEvidence?: boolean;
  /** True when the question cannot be served by any active source. */
  unsupported?: boolean;
  /** Optional attachment scope gate (CORE_V2 FR-C.1). Absent = legacy path. */
  scope?: AttachmentScopeInput;
}

const MESSAGES: Record<CoreGuardrailType, { message: string; explanation: string }> = {
  destructive: {
    message: 'Sistem hanya memiliki akses baca. Saya tidak dapat menghapus, mengubah, atau menjalankan perintah yang merusak data.',
    explanation: 'Permintaan bersifat destruktif; tidak ada pernyataan yang dieksekusi.',
  },
  pii: {
    message: 'Saya tidak akan menampilkan atau menebak data pribadi. Hanya informasi yang tersedia pada sumber yang dapat ditampilkan.',
    explanation: 'Permintaan mengarah pada data pribadi; tidak ada nilai yang direkayasa.',
  },
  out_of_scope: {
    message: 'Pertanyaan ini di luar cakupan sumber aktif. Pilih attachment yang relevan dengan topik Anda, atau ajukan pertanyaan yang bisa dijawab dari dokumen dan data yang tersedia.',
    explanation: 'Tidak ada sumber aktif yang relevan dengan topik ini.',
  },
  ambiguous: {
    message: 'Metrik atau objek yang dimaksud belum jelas. Silakan sebutkan ukuran, periode, atau bagian dokumen yang spesifik.',
    explanation: 'Pertanyaan memerlukan klarifikasi sebelum dapat dijawab dengan aman.',
  },
  unsupported: {
    message: 'Pertanyaan ini tidak dapat dijawab dari sumber yang tersedia saat ini.',
    explanation: 'Tidak ada komponen pipeline yang dapat memenuhi permintaan ini.',
  },
  not_in_sources: {
    message: 'Informasi tersebut tidak ditemukan pada sumber yang tersedia. Saya tidak akan mengarang jawaban; coba kata kunci lain atau pilih attachment yang sesuai dengan topik Anda.',
    explanation: 'Tidak ada bukti relevan yang dapat disitasi.',
  },
};

/**
 * General guardrail check. Order matters: destructive and PII are hard blocks,
 * injection is treated as unsupported rather than obeyed, and "no evidence"
 * is always admitted honestly.
 */
export function checkGuardrails(input: GuardrailCheckInput): GuardrailResult {
  const q = String(input.question ?? '').trim();
  let type: CoreGuardrailType | null = null;
  let scopeMessage: string | null = null;
  let scopeExplanation: string | null = null;

  // FR-C.1: scope is checked before any other rule. A leak from another
  // attachment is never allowed to reach retrieval or SQL.
  if (input.scope) {
    const scoped = checkAttachmentScope(input.scope);
    if (!scoped.allowed) {
      type = scoped.type === 'not_ready' ? 'unsupported' : 'out_of_scope';
      scopeMessage = scoped.message;
      scopeExplanation = scoped.explanation;
    }
  }

  if (!type) {
    if (GENERAL_DESTRUCTIVE_RE.test(q) || isSqlInjectionLike(q)) type = 'destructive';
    else if (GENERAL_PII_RE.test(q)) type = 'pii';
    else if (INJECTION_RE.test(q)) type = 'unsupported';
    else if (input.noEvidence) type = 'not_in_sources';
    else if (input.unsupported) type = 'unsupported';
    else if (GENERAL_AMBIGUOUS_RE.test(q)) type = 'ambiguous';
    else if (GENERAL_OFF_TOPIC_RE.test(q)) type = 'out_of_scope';
    else if (input.availableTopics && input.availableTopics.length) {
      const hit = input.availableTopics.some((t) => q.toLowerCase().includes(t.toLowerCase()));
      if (!hit && q.length > 12) type = 'out_of_scope';
    }
  }

  if (!type) return { triggered: false, type: null, message: '', explanation: '' };
  return {
    triggered: true,
    type,
    message: scopeMessage ?? MESSAGES[type].message,
    explanation: scopeExplanation ?? MESSAGES[type].explanation,
  };
}

/* ========================================================================== */
/* CORE V2 — attachment scope guardrail (FR-C.1 / AC-C.1.1–C.2.3)              */
/* Structural mirror of the backend AttachmentScope contract; the AI lane     */
/* only reads it and refuses cross-attachment evidence. lib/core is untouched. */
/* ========================================================================== */

export type AttachmentStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';

export interface AttachmentScope {
  id: string;
  dataset_id: string;
  source_id?: string | null;
  name: string;
  doc_type?: string | null;
  status: AttachmentStatus;
  active_in_conversation?: boolean;
}

export interface ScopeEvidenceRef {
  kind: 'chunk' | 'sql';
  dataset_id?: string | null;
  source_id?: string | null;
  doc_id?: string | null;
}

export interface AttachmentScopeInput {
  question: string;
  active: AttachmentScope | null;
  attachments?: AttachmentScope[];
  /** Evidence proposed for the answer; each ref must belong to `active`. */
  evidence?: ScopeEvidenceRef[];
}

export interface AttachmentScopeResult {
  allowed: boolean;
  violations: string[];
  type: 'scope_violation' | 'not_ready' | 'cross_attachment_ref' | null;
  message: string;
  explanation: string;
}

/**
 * Nama attachment yang aman ditampilkan. Label internal/teknis seperti
 * "Demo QRIS (legacy adapter)" tidak boleh bocor ke pesan user.
 */
export function friendlyAttachmentName(name: string | null | undefined): string {
  const raw = String(name ?? '').trim();
  if (!raw) return 'sumber yang tersedia';
  const cleaned = raw
    .replace(/\s*\((?:legacy\s+)?adapter\)\s*/gi, ' ')
    .replace(/\bDemo\s+QRIS\b/gi, 'Transaksi')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'sumber yang tersedia';
}

/** "Dokumen sebelumnya" must not silently pull context from another attachment. */
const CROSS_ATTACHMENT_RE =
  /\b(?:dokumen|attachment|file|data)\s+(?:sebelumnya|sebelum|lain|yang\s+lain|lalu)\b|\b(?:sebelumnya|previous\s+(?:document|attachment))\b/i;

/**
 * Fail-closed scope gate. Only the active attachment's chunks/SQL may enter
 * the answer. A not-READY attachment is refused rather than using partial
 * chunks; a cross-attachment reference asks the user to choose explicitly.
 */
export function checkAttachmentScope(input: AttachmentScopeInput): AttachmentScopeResult {
  const active = input?.active ?? null;
  const violations: string[] = [];

  if (!active) {
    return {
      allowed: false, violations: ['NO_ACTIVE_ATTACHMENT'], type: 'scope_violation',
      message: 'Silakan pilih attachment aktif terlebih dahulu.',
      explanation: 'Tidak ada attachment aktif; tidak ada chunk/SQL yang boleh dipakai.',
    };
  }
  const activeName = friendlyAttachmentName(active.name);
  if (active.status !== 'READY') {
    return {
      allowed: false, violations: [`NOT_READY:${active.status}`], type: 'not_ready',
      message: `Attachment "${activeName}" berstatus ${active.status}, belum READY.`,
      explanation: 'Chunk parsial dari attachment yang belum READY tidak dipakai sebagai bukti.',
    };
  }
  if (CROSS_ATTACHMENT_RE.test(String(input.question ?? ''))) {
    return {
      allowed: false, violations: ['CROSS_ATTACHMENT_REFERENCE'], type: 'cross_attachment_ref',
      message: `Pertanyaan merujuk dokumen/attachment lain. Silakan pilih attachment yang dimaksud; scope aktif adalah "${activeName}".`,
      explanation: 'Referensi lintas attachment tidak di-resolve dari conversation lain.',
    };
  }

  for (const ref of input.evidence ?? []) {
    if (ref.dataset_id && active.dataset_id && ref.dataset_id !== active.dataset_id) {
      violations.push(`EVIDENCE_LEAK:${ref.kind}:dataset=${ref.dataset_id}`);
    }
    if (ref.source_id && active.source_id && ref.source_id !== active.source_id) {
      violations.push(`EVIDENCE_LEAK:${ref.kind}:source=${ref.source_id}`);
    }
    if (ref.doc_id && active.source_id && ref.doc_id !== active.source_id && ref.doc_id !== active.id) {
      violations.push(`EVIDENCE_LEAK:${ref.kind}:doc=${ref.doc_id}`);
    }
  }

  if (violations.length) {
    return {
      allowed: false, violations, type: 'scope_violation',
      message: `Bukti dari attachment lain ditolak. Hanya "${activeName}" yang dipakai.`,
      explanation: `Pelanggaran scope: ${violations.join(', ')}.`,
    };
  }

  return {
    allowed: true, violations: [], type: null,
    message: '', explanation: `Scope aman: ${activeName}.`,
  };
}

/** Honest fallback text for a page whose OCR failed (AC-A.2.2 / EV-A01). */
export function unreadablePageNotice(page: number, lang: 'id' | 'en' = 'id'): string {
  return lang === 'id'
    ? `Halaman ${page} tidak terbaca (OCR gagal/timeout). Halaman ini tidak dijadikan sitasi; halaman lain tetap dipakai.`
    : `Page ${page} is unreadable (OCR failed/timed out). It is not cited; other pages are still used.`;
}

