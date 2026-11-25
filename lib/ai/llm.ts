/**
 * TanyaData AI — adapter LLM opsional (lib/ai/llm.ts).
 *
 * Baca env: LLM_MODE, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TIMEOUT_MS,
 * LLM_MAX_OUTPUT_TOKENS. Endpoint OpenAI-compatible chat completions via fetch.
 * Tidak ada nama model/provider di kode/UI/docs; kunci hanya dari process.env.
 *
 * Aturan grounding: LLM HANYA boleh merapikan narasi. Setiap token numerik di
 * output LLM harus cocok dengan himpunan angka evidence (hasil SQL/dokumen).
 * Bila ada angka asing, output tidak valid, timeout, atau HTTP error →
 * fallback deterministik + meta.fallbackReason.
 */
import { z } from 'zod';
import type { Lang } from '@/lib/contracts/http';
import type { DraftResult } from '@/lib/ai/compose';
import type { LlmCallMeta, LlmConfig, LlmFallback, LlmOutcome } from './types';

export type LlmMode = 'off' | 'assist' | 'full';
export type LlmFallbackReason = 'llm_timeout' | 'llm_error' | 'llm_invalid';

export type LlmRefineOutcome = {
  draft: DraftResult | null;
  reason?: LlmFallbackReason;
};

export function llmMode(): LlmMode {
  const v = process.env.LLM_MODE;
  if (v === 'assist' || v === 'full') return v;
  if (v === 'off') return 'off';
  // Default cerdas: bila kredensial LLM tersedia, aktifkan mode `assist`
  // (fallback penutup) tanpa perlu set LLM_MODE eksplisit. Arah produk:
  // LLM memperbaiki respons bila ada; deterministik tetap jadi fondasi bila tidak.
  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL) return 'assist';
  return 'off';
}

export function llmAvailable(): boolean {
  const mode = llmMode();
  return mode !== 'off' && Boolean(process.env.LLM_BASE_URL) && Boolean(process.env.LLM_MODEL);
}

export function llmTimeout(): number {
  const v = Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 12000;
}

export function llmMaxTokens(): number {
  const v = Number(process.env.LLM_MAX_OUTPUT_TOKENS);
  return Number.isFinite(v) && v > 0 ? v : 900;
}

/* ---------------------------------------------------- rantai fallback model */

/**
 * Urutan fallback DEFAULT (tanpa model utama — model utama tetap dari LLM_MODEL).
 * Diambil dari daftar model Chat Completions yang disediakan. Model utama saat ini
 * (`openai/gpt-oss-120b`) sengaja TIDAK dimasukkan agar tidak dicoba dua kali.
 */
const DEFAULT_FALLBACK_MODELS: readonly string[] = [
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'allam-2-7b',
];

/** Model utama + maksimal 3 fallback = 4 percobaan (batas keras). */
const MAX_LLM_MODELS = 4;

/** Backoff kecil antar pergantian model — bukan retry agresif per model. */
const FALLBACK_BACKOFF_MS: readonly number[] = [200, 400, 200];

/**
 * Baca `LLM_FALLBACK_MODELS` (comma-separated). Kosong → default di atas.
 * Dipangkas ke MAX_LLM_MODELS - 1 supaya total model tidak pernah melebihi 4.
 */
export function llmFallbackModels(): string[] {
  const raw = process.env.LLM_FALLBACK_MODELS;
  const list = raw == null || raw.trim() === ''
    ? [...DEFAULT_FALLBACK_MODELS]
    : raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.slice(0, MAX_LLM_MODELS - 1);
}

/** Rantai unik: model utama lebih dulu, lalu fallback. Tanpa duplikat. */
function buildModelChain(config: LlmConfig): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined): void => {
    const model = value?.trim();
    if (!model || seen.has(model)) return;
    seen.add(model);
    chain.push(model);
  };
  add(config.model);
  for (const fallback of llmFallbackModels()) add(fallback);
  return chain.slice(0, MAX_LLM_MODELS);
}

/**
 * Fallback hanya untuk kegagalan yang memang masalah model/transport.
 * `llm_ungrounded` adalah masalah konten (angka asing) — mengganti model tidak
 * akan memperbaikinya dan berisiko menyembunyikan halusinasi.
 */
function isFallbackable(outcome: LlmOutcome<unknown>): boolean {
  const reason = outcome.fallbackReason;
  if (reason === 'llm_ungrounded') return false;
  return reason === 'llm_error' || reason === 'llm_timeout' || reason === 'llm_invalid';
}

/* ---------------------------------------------------- grounding angka */

const NUMBER_TOKEN_RE = /\d+(?:[.,]\d+)*/g;

function numberTokens(text: string): string[] {
  return text.match(NUMBER_TOKEN_RE) ?? [];
}

/** Interpretasi ganda (locale id: "8.125"=8125, "92,76"=92.76; en kebalikan). */
function interpretations(token: string): number[] {
  const out = new Set<number>();
  // id-style: titik = pemisah ribuan bila pola 1-3 digit + kelompok 3 digit
  if (/^\d{1,3}(\.\d{3})+$/.test(token)) {
    out.add(Number(token.replace(/\./g, '')));
  } else {
    const idDecimal = Number(token.replace(',', '.'));
    if (Number.isFinite(idDecimal)) out.add(idDecimal);
  }
  // en-style: koma = pemisah ribuan
  if (/^\d{1,3}(,\d{3})+$/.test(token)) {
    out.add(Number(token.replace(/,/g, '')));
  } else {
    const enDecimal = Number(token);
    if (Number.isFinite(enDecimal)) out.add(enDecimal);
  }
  return [...out];
}

function collectTextNumbers(text: string, into: Set<number>): void {
  for (const token of numberTokens(text)) {
    for (const n of interpretations(token)) into.add(n);
  }
}

/**
 * Himpunan angka yang boleh muncul di narasi LLM: nilai mentah dari tabel &
 * visual (hasil query), plus angka yang sudah tertulis di draft deterministik
 * (termasuk tanggal/tahun yang disebut).
 */
export function buildAllowNums(draft: DraftResult, sqlRows: unknown[][] = []): number[] {
  const nums = new Set<number>();
  const addRaw = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) nums.add(v);
  };
  for (const row of sqlRows) for (const cell of row) addRaw(cell);
  if (draft.supportingTable) {
    for (const row of draft.supportingTable.rows) for (const v of Object.values(row)) addRaw(v);
  }
  for (const viz of draft.visualizations) {
    for (const row of viz.rows) for (const v of Object.values(row)) addRaw(v);
  }
  collectTextNumbers(draft.answer, nums);
  for (const k of draft.keyFindings) collectTextNumbers(k.text, nums);
  for (const f of draft.followUps) collectTextNumbers(f, nums);
  return [...nums];
}

function numbersGrounded(text: string, allowed: number[]): boolean {
  for (const token of numberTokens(text)) {
    const candidates = interpretations(token);
    const ok = candidates.some((c) => allowed.some((a) => Math.abs(a - c) < 0.011));
    if (!ok) return false;
  }
  return true;
}

/* ---------------------------------------------------- adapter HTTP */

const ChatCompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

const MAX_ANSWER_WORDS = 120;

/**
 * Refine narasi saja. keyFindings/followUps/supportingTable/sql/sources tetap
 * dari jalur deterministik agar angka & sitasi tidak pernah diubah LLM.
 */
export async function llmRefine(
  mode: LlmMode,
  draft: DraftResult,
  lang: Lang,
  allowedNumbers: number[],
): Promise<LlmRefineOutcome> {
  if (mode === 'off') return { draft: null };
  if (allowedNumbers.length === 0) return { draft: null };

  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !model) return { draft: null, reason: 'llm_error' };

  const system = [
    lang === 'id'
      ? 'Anda merapikan jawaban analitik transaksi menjadi Bahasa Indonesia formal yang lancar dan ringkas (maksimal 3 kalimat).'
      : 'You polish a transaction-analytics answer into fluent, concise formal English (at most 3 sentences).',
    lang === 'id'
      ? 'ATURAN MUTLAK: pertahankan SEMUA angka persis seperti aslinya; jangan menambah, mengubah, membulatkan ulang, atau menghilangkan angka apa pun; jangan menambah fakta, sebab, atau klaim baru.'
      : 'ABSOLUTE RULES: keep EVERY number exactly as given; do not add, change, re-round, or drop any number; do not add new facts, causes, or claims.',
    lang === 'id'
      ? 'Bedakan indikasi (korelasi data) dari sebab terbukti (pernyataan dokumen). Jangan menyebut nama model atau penyedia.'
      : 'Distinguish indication (data correlation) from proven cause (document statement). Never mention model or provider names.',
    lang === 'id'
      ? `Himpunan angka yang diizinkan: ${allowedNumbers.join(', ')}.`
      : `Allowed number set: ${allowedNumbers.join(', ')}.`,
  ].join('\n');

  const user = [
    `${lang === 'id' ? 'Pertanyaan pengguna' : 'User question'}: ${draft.answer ? '' : ''}`,
    `${lang === 'id' ? 'Jawaban deterministik yang harus dirapikan' : 'Deterministic answer to polish'}:`,
    draft.answer,
    '',
    `${lang === 'id' ? 'Temuan utama (konteks, jangan diubah angkanya)' : 'Key findings (context, do not change numbers)'}:`,
    ...draft.keyFindings.map((k) => `- ${k.text}`),
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), llmTimeout());
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: llmMaxTokens(),
      }),
    });
    if (!response.ok) return { draft: null, reason: 'llm_error' };

    const raw: unknown = await response.json();
    const parsed = ChatCompletionSchema.safeParse(raw);
    if (!parsed.success) return { draft: null, reason: 'llm_invalid' };

    const text = parsed.data.choices[0].message.content.trim();
    if (!text) return { draft: null, reason: 'llm_invalid' };
    if (text.split(/\s+/).length > MAX_ANSWER_WORDS) return { draft: null, reason: 'llm_invalid' };
    if (!numbersGrounded(text, allowedNumbers)) return { draft: null, reason: 'llm_invalid' };

    return {
      draft: {
        ...draft,
        answer: text,
        keyFindings: draft.keyFindings.slice(0, 4),
        followUps: draft.followUps.slice(0, 4),
      },
    };
  } catch (error) {
    const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    return { draft: null, reason: aborted ? 'llm_timeout' : 'llm_error' };
  } finally {
    clearTimeout(timer);
  }
}

/* ========================================================================== */
/* GENERAL CORE (P3-CORE) — docs/CORE_AI_SPEC.md §8                            */
/* Env-only configuration. No key, model or provider name is hardcoded.        */
/* The block above is the legacy demo adapter, untouched.                      */
/* ========================================================================== */

export function getLlmConfig(): LlmConfig {
  const modeRaw = process.env.LLM_MODE;
  const mode: LlmConfig['mode'] = modeRaw === 'assist' || modeRaw === 'full' ? modeRaw : 'off';
  const timeout = Number(process.env.LLM_TIMEOUT_MS);
  const maxTokens = Number(process.env.LLM_MAX_OUTPUT_TOKENS);
  return {
    mode,
    baseUrl: process.env.LLM_BASE_URL || null,
    apiKey: process.env.LLM_API_KEY || null,
    model: process.env.LLM_MODEL || null,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 12000,
    maxOutputTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 900,
  };
}

export function isLlmEnabled(config: LlmConfig = getLlmConfig()): boolean {
  return config.mode !== 'off' && Boolean(config.baseUrl) && Boolean(config.model);
}

/** Remove secrets and long identifiers before anything is written to a log. */
export function redactForLog(text: string): string {
  return String(text ?? '')
    .replace(/([\w.+-]+)@([\w-]+\.[\w.]+)/g, '[email]')
    .replace(/\b\d{12,19}\b/g, '[number]')
    .replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/(api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

const GENERAL_NUMBER_RE = /\d+(?:[.,]\d+)*/g;

export function numberCandidates(token: string): number[] {
  const out = new Set<number>();
  if (/^\d{1,3}(\.\d{3})+$/.test(token)) out.add(Number(token.replace(/\./g, '')));
  else out.add(Number(token.replace(',', '.')));
  if (/^\d{1,3}(,\d{3})+$/.test(token)) out.add(Number(token.replace(/,/g, '')));
  else out.add(Number(token));
  return [...out].filter(Number.isFinite);
}

/** Every numeric token in `text` must map to an allowed value (locale tolerant). */
export function verifyGrounding(text: string, allowedNumbers: number[]): boolean {
  const tokens = String(text ?? '').match(GENERAL_NUMBER_RE) ?? [];
  for (const token of tokens) {
    const ok = numberCandidates(token).some((c) => allowedNumbers.some((a) => Math.abs(a - c) < 0.011));
    if (!ok) return false;
  }
  return true;
}

/**
 * SEMANTIC COMPOSITION V2 — LLM_MODE=full menjadikan LLM composer utama,
 * bukan sekadar fallback penutup. Mode `assist` mempertahankan perilaku lama.
 */
export function isFullComposerMode(config: LlmConfig = getLlmConfig()): boolean {
  return config.mode === 'full' && isLlmEnabled(config);
}

const MOJIBAKE_RE = /[\uFFFD]|â€|Ã©|Ã¨|Ã¡|Ã±|Ã´|Ã»|Ã¼|Â /;

/**
 * Verifier akhir untuk jawaban composer. Marker `[n]` wajib pada setiap klaim,
 * tidak ada mojibake/U+FFFD, dan semua angka harus berasal dari bukti.
 * Dipakai adapter sebelum jawaban LLM diterima; kegagalan → regenerate 1x →
 * deterministik. Tidak pernah melempar dan tidak mencatat prompt/secret.
 */
export function validateComposedAnswer(
  text: string,
  allowedNumbers: number[],
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const value = String(text ?? '').trim();
  if (!value) failures.push('empty');
  if (!/\[\d+\]/.test(value)) failures.push('missing_marker');
  if (MOJIBAKE_RE.test(value)) failures.push('mojibake');
  if (!verifyGrounding(value, allowedNumbers)) failures.push('foreign_number');
  return { ok: failures.length === 0, failures };
}

export interface StructuredCallInput<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Numeric allow-list; a single foreign number rejects the whole response. */
  allowedNumbers?: number[];
  config?: LlmConfig;
}

/* ---------------------------------------------------- rate-limit throttle */
// Penyedia free-tier membatasi panggilan per menit. Eval ground-truth memanggil
// LLM berturut-turut untuk ~70 soal; tanpa jeda sebagian besar kena HTTP 429
// (`llm_error`) sehingga fallback tidak pernah berkontribusi. Jeda minimum ini
// menjaga laju panggilan tetap berada di bawah ambang penyedia. Tidak ada kunci
// atau prompt yang dicatat — hanya waktu lokal.
let lastStructuredCallAt = 0;
const MIN_STRUCTURED_CALL_INTERVAL_MS = 1500;

async function throttleStructuredCall(): Promise<void> {
  const now = Date.now();
  const wait = MIN_STRUCTURED_CALL_INTERVAL_MS - (now - lastStructuredCallAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastStructuredCallAt = Date.now();
}

/**
 * Parse JSON dari content LLM dengan tiga bentuk umum: JSON murni, code-fence
 * ```json … ```, atau JSON yang dibungkus narasi pendek. Model free-tier sering
 * membalas fenced JSON meski sudah diminta `response_format=json_object`;
 * menolaknya mentah-mentah adalah penyebab `llm_invalid` (18 kasus di baseline).
 */
export function parseJsonLoose(content: string): unknown {
  const trimmed = String(content ?? '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // lanjut ke bentuk lain
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // lanjut
    }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // lanjut
    }
  }
  return null;
}

type LlmAttempt<T> = { outcome: LlmOutcome<T>; status: number | null };

/** Satu panggilan HTTP. Tidak pernah mencatat kunci, header, atau body. */
async function callLlmOnce<T>(
  input: StructuredCallInput<T>,
  config: LlmConfig,
  model: string,
  opts: { responseFormat: boolean; timeoutMs: number },
): Promise<LlmAttempt<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl!.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? ''}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        // Retry 400 memakai max_tokens lebih kecil untuk mengatasi payload besar.
        max_tokens: opts.responseFormat ? config.maxOutputTokens : Math.min(config.maxOutputTokens, 600),
        ...(opts.responseFormat ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      }),
    });
    // Hanya status code yang dicatat — aman untuk log, tidak ada kunci/body.
    if (!response.ok) {
      return {
        outcome: { ok: false, data: null, fallbackReason: 'llm_error', detail: `http_${response.status}` },
        status: response.status,
      };
    }

    const raw: unknown = await response.json();
    const envelope = z.object({
      choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
    }).safeParse(raw);
    if (!envelope.success) {
      return { outcome: { ok: false, data: null, fallbackReason: 'llm_invalid', detail: 'envelope_invalid' }, status: response.status };
    }
    const parsedJson = parseJsonLoose(envelope.data.choices[0].message.content);
    if (parsedJson === null) {
      return { outcome: { ok: false, data: null, fallbackReason: 'llm_invalid', detail: 'json_unparseable' }, status: response.status };
    }
    const validated = input.schema.safeParse(parsedJson);
    if (!validated.success) {
      return { outcome: { ok: false, data: null, fallbackReason: 'llm_invalid', detail: 'schema_invalid' }, status: response.status };
    }
    if (input.allowedNumbers && input.allowedNumbers.length) {
      const serialised = JSON.stringify(validated.data);
      if (!verifyGrounding(serialised, input.allowedNumbers)) {
        return {
          outcome: { ok: false, data: null, fallbackReason: 'llm_ungrounded', detail: 'foreign_number' },
          status: response.status,
        };
      }
    }
    return {
      outcome: { ok: true, data: validated.data, fallbackReason: null },
      status: response.status,
    };
  } catch (error) {
    const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    const reason: LlmFallback = aborted ? 'llm_timeout' : 'llm_error';
    return {
      outcome: { ok: false, data: null, fallbackReason: reason, detail: aborted ? 'timeout' : 'network' },
      status: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Structured LLM call dengan rantai fallback model (LLM_FALLBACK_MODELS).
 *
 * Perilaku:
 *  - Mencoba model utama, lalu tiap fallback secara berurutan bila gagal karena
 *    429 / 5xx / network / timeout / llm_invalid.
 *  - `llm_ungrounded` TIDAK di-fallback: itu masalah konten (angka asing), bukan
 *    model — mengganti model hanya menyembunyikan halusinasi.
 *  - Total waktu terikat: maksimal 4 model × LLM_TIMEOUT_MS + backoff kecil
 *    (200ms, 400ms). Tidak ada retry tak berbatas di lapisan ini.
 *  - Tidak pernah melempar exception. Selalu fail-closed ke LlmOutcome.
 *  - `meta` berisi observability (model, attempts, alasan gagal) TANPA kunci,
 *    header, body, atau teks prompt.
 *
 * System instructions dan teks dokumen tak tepercaya tetap berada di field
 * terpisah (`input.system` vs `input.user`) — tidak ada prompt injection lintas
 * field, dan tidak ada model/provider yang disebut ke end user.
 */
export async function callLlmStructured<T>(input: StructuredCallInput<T>): Promise<LlmOutcome<T>> {
  const config = input.config ?? getLlmConfig();
  if (config.mode === 'off') return { ok: false, data: null, fallbackReason: 'llm_off' };
  if (!isLlmEnabled(config)) return { ok: false, data: null, fallbackReason: 'llm_unconfigured' };

  const models = buildModelChain(config);
  const failures: LlmCallMeta['failures'] = [];
  const modelsTried: string[] = [];
  let attempts = 0;

  try {
    await throttleStructuredCall();

    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      modelsTried.push(model);

      if (i > 0) {
        const backoff = FALLBACK_BACKOFF_MS[(i - 1) % FALLBACK_BACKOFF_MS.length];
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }

      const attempt = await callLlmOnce(input, config, model, {
        responseFormat: true,
        timeoutMs: config.timeoutMs,
      });
      attempts += 1;

      if (attempt.outcome.ok) {
        return {
          ...attempt.outcome,
          meta: { model, attempts, modelsTried: [...modelsTried], failures: [...failures] },
        };
      }

      const reason = attempt.outcome.fallbackReason ?? 'llm_error';
      failures.push({
        model,
        reason,
        ...(attempt.outcome.detail ? { detail: attempt.outcome.detail } : {}),
      });

      // Konten tidak grounded = angka asing/halusinasi. Jangan coba model lain.
      if (!isFallbackable(attempt.outcome)) {
        return {
          ...attempt.outcome,
          meta: { model, attempts, modelsTried: [...modelsTried], failures: [...failures] },
        };
      }
    }

    const last = failures[failures.length - 1];
    return {
      ok: false,
      data: null,
      fallbackReason: 'llm_all_models_failed',
      detail: last ? `${last.reason}:${last.detail ?? 'unknown'}` : 'no_attempt',
      meta: {
        model: models[models.length - 1] ?? null,
        attempts,
        modelsTried: [...modelsTried],
        failures: [...failures],
      },
    };
  } catch {
    // Guard terakhir: tidak ada exception yang boleh bocor ke adapter/UI.
    return {
      ok: false,
      data: null,
      fallbackReason: 'llm_all_models_failed',
      detail: 'unexpected_error',
      meta: {
        model: models[models.length - 1] ?? null,
        attempts,
        modelsTried: [...modelsTried],
        failures: [...failures],
      },
    };
  }
}
