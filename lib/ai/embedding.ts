/**
 * TanyaData AI — local embedding provider (P3-MIGRATION / DECISION-032 ADR-QD-03).
 *
 * Model: multilingual-e5-small (384 dim, dtype q8) via transformers.js.
 * Default: `EMBEDDING_PROVIDER=off` — this module NEVER loads a model in off
 * mode, so the four offline eval suites (LLM_MODE=off, no Qdrant) are untouched.
 *
 * Memory watchdog (DECISION-034 item 4): load and inference are refused when
 * process RSS exceeds `EMBEDDING_MAX_RSS_MB` (default 700). A refusal returns
 * `null` — never an exception — so the hybrid dispatcher degrades to FTS5 with
 * `meta.fallbackReason='embedding_unavailable'`. Inference is serialised
 * (concurrency 1) to keep the ONNX session's peak RSS predictable.
 *
 * Model repo note (verified 2026-11-23 via HF API + installed transformers.js
 * 4.3.2 `DEFAULT_DTYPE_SUFFIX_MAPPING.q8 === '_quantized'`): `dtype:'q8'` hard-
 * requires `onnx/model_quantized.onnx`. The upstream `intfloat/multilingual-e5-
 * small` repo only ships `onnx/model_qint8_avx512_vnni.onnx`, so a q8 load from
 * it 404s. `Xenova/multilingual-e5-small` is the SAME model weights converted
 * to ONNX by the transformers.js maintainers and does ship `model_quantized.onnx`.
 * Operators can still override with `EMBEDDING_MODEL`.
 *
 * Contract (honest fallback): every public function returns `null` when the
 * provider is off, the package is absent, the model files are missing, the
 * load/inference times out, or the output shape is unexpected. No exception
 * escapes to the caller and no vector is fabricated.
 *
 * API verified 2026-11-23 against the installed-target docs:
 *   - transformers.js `pipeline('feature-extraction', model, { dtype: 'q8' })`
 *   - `extractor(text|texts, { pooling: 'mean', normalize: true }) -> Tensor`
 *     with flat `.data` (Float32Array), `.dims` and `.tolist()`.
 *   - `env.localModelPath` / `env.allowRemoteModels` for offline model files.
 * The package is imported through a `string`-typed specifier on purpose: it is
 * an optional dependency owned by the backend lane, so a static literal import
 * would make `tsc --noEmit` fail before the backend installs it.
 */
import path from 'node:path';

export type EmbeddingProvider = 'off' | 'local';

export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
export const EMBEDDING_DIM = 384;
export const EMBEDDING_DTYPE = 'q8' as const;
/** Default RSS ceiling for the local ONNX session (DECISION-034 item 4). */
export const EMBEDDING_MAX_RSS_MB = 700;

/** Optional peer dependency; typed as string so TS does not resolve it eagerly. */
const HF_PACKAGE: string = '@huggingface/transformers';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  dim: number;
  dtype: 'q8';
  cacheDir: string | null;
  allowRemote: boolean;
  timeoutMs: number;
  /** Refuse load/infer when process RSS (MiB) is above this ceiling. */
  maxRssMb: number;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Read env lazily on every call so tests/eval can switch mode without reload. */
export function getEmbeddingConfig(): EmbeddingConfig {
  const raw = String(process.env.EMBEDDING_PROVIDER ?? 'off').trim().toLowerCase();
  const provider: EmbeddingProvider = raw === 'local' ? 'local' : 'off';
  const cacheDir = String(process.env.EMBEDDING_CACHE_DIR ?? '').trim() || null;
  const allowRemote = /^(1|true|yes)$/i.test(String(process.env.EMBEDDING_ALLOW_REMOTE ?? ''));
  return {
    provider,
    model: String(process.env.EMBEDDING_MODEL ?? EMBEDDING_MODEL).trim() || EMBEDDING_MODEL,
    dim: clampInt(process.env.EMBEDDING_DIM, EMBEDDING_DIM, 1, 4096),
    dtype: EMBEDDING_DTYPE,
    cacheDir,
    allowRemote,
    timeoutMs: clampInt(process.env.EMBEDDING_TIMEOUT_MS, 15000, 1000, 120000),
    maxRssMb: clampInt(process.env.EMBEDDING_MAX_RSS_MB, EMBEDDING_MAX_RSS_MB, 128, 8192),
  };
}

/** True only when the local model is actually configured to be used. */
export function isEmbeddingEnabled(): boolean {
  return getEmbeddingConfig().provider === 'local';
}

/** Shared hard-bounded wait; used by the Qdrant adapter too. */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT_${ms}MS`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 200);
  return String(error).slice(0, 200);
}

/** Current resident set size in MiB. Never throws — a probe failure reads 0. */
export function currentRssMb(): number {
  try {
    const rss = process.memoryUsage?.().rss;
    return typeof rss === 'number' && Number.isFinite(rss) ? rss / (1024 * 1024) : 0;
  } catch {
    return 0;
  }
}

/**
 * Watchdog: true when RSS is above the configured ceiling. The caller records
 * the reason in `lastError` and returns `null`; no exception escapes.
 */
function rssGuardTripped(cfg: EmbeddingConfig): boolean {
  return currentRssMb() > cfg.maxRssMb;
}

function noteRssGuard(cfg: EmbeddingConfig): void {
  lastError = `EMBEDDING_RSS_GUARD_${Math.round(currentRssMb())}MB_GT_${cfg.maxRssMb}MB`;
}

/**
 * Serialise inference to concurrency 1. The ONNX session is shared, so two
 * overlapping `run()` calls would double the transient working set and defeat
 * the RSS budget. The chain never rejects: a failed task cannot poison the
 * queue. The model load itself is already a single shared promise.
 */
let inferTail: Promise<unknown> = Promise.resolve();

function serializeInfer<T>(work: () => Promise<T>): Promise<T> {
  const run = inferTail.then(work, work);
  inferTail = run.then(() => undefined, () => undefined);
  return run;
}

interface ExtractorOutput {
  data?: ArrayLike<number>;
  dims?: number[];
  tolist?: () => unknown;
}

type Extractor = (
  texts: string | string[],
  options?: Record<string, unknown>,
) => Promise<ExtractorOutput>;

let extractorPromise: Promise<Extractor | null> | null = null;
let lastError: string | null = null;

async function createExtractor(): Promise<Extractor | null> {
  const cfg = getEmbeddingConfig();
  if (cfg.provider !== 'local') return null;
  if (rssGuardTripped(cfg)) {
    noteRssGuard(cfg);
    return null;
  }
  try {
    const mod: any = await import(HF_PACKAGE);
    if (typeof mod?.pipeline !== 'function') throw new Error('transformers.pipeline_missing');

    const env = mod.env;
    if (env && typeof env === 'object') {
      if (cfg.cacheDir) {
        env.localModelPath = path.resolve(cfg.cacheDir);
        env.allowLocalModels = true;
      }
      // Offline by default: no network call and no API key at inference time.
      env.allowRemoteModels = cfg.allowRemote;
    }

    const extractor = await withTimeout(
      Promise.resolve(mod.pipeline('feature-extraction', cfg.model, { dtype: cfg.dtype })),
      cfg.timeoutMs,
      'embedding_model_load',
    );
    if (typeof extractor !== 'function') throw new Error('extractor_invalid');
    lastError = null;
    return extractor as Extractor;
  } catch (error) {
    lastError = describe(error);
    return null;
  }
}

/** Lazy singleton. A failed load is cached as `null` — no retry storm. */
function getExtractor(): Promise<Extractor | null> {
  if (!extractorPromise) extractorPromise = createExtractor();
  return extractorPromise;
}

/** Convert a transformers.js Tensor into one vector per input text. */
function tensorToVectors(output: ExtractorOutput | null, count: number, dim: number): Array<number[] | null> | null {
  if (!output || count < 1) return null;
  const dims = Array.isArray(output.dims) ? output.dims : null;
  const perRow = dims && dims.length >= 2 ? Number(dims[dims.length - 1]) : dim;
  if (perRow !== dim) return null;

  const build = (row: ArrayLike<number>): number[] | null => {
    const vec: number[] = [];
    for (let j = 0; j < dim; j += 1) {
      const value = Number(row[j]);
      if (!Number.isFinite(value)) return null;
      vec.push(value);
    }
    return vec;
  };

  const data = output.data;
  if (data && typeof data.length === 'number' && data.length >= count * dim) {
    const flat = Array.from(data);
    const out: Array<number[] | null> = [];
    for (let i = 0; i < count; i += 1) {
      out.push(build(flat.slice(i * dim, (i + 1) * dim)));
    }
    return out;
  }

  // Fallback for builds that only expose tolist().
  const listed = typeof output.tolist === 'function' ? output.tolist() : null;
  if (!Array.isArray(listed)) return null;
  const rows: unknown[] = count === 1 && typeof listed[0] === 'number' ? [listed] : listed;
  if (rows.length < count) return null;
  return rows.slice(0, count).map((row) => (
    Array.isArray(row) && row.length === dim ? build(row as ArrayLike<number>) : null
  ));
}

/** Embed a query with the mandatory E5 `query: ` prefix. `null` = unavailable. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const cfg = getEmbeddingConfig();
  if (cfg.provider !== 'local' || !String(text ?? '').trim()) return null;
  return serializeInfer(async () => {
    if (rssGuardTripped(cfg)) {
      noteRssGuard(cfg);
      return null;
    }
    const extractor = await getExtractor();
    if (!extractor) return null;
    // Re-check after load: the ONNX session itself may have crossed the ceiling.
    if (rssGuardTripped(cfg)) {
      noteRssGuard(cfg);
      return null;
    }
    try {
      const output = await withTimeout(
        Promise.resolve(extractor(`query: ${String(text).trim()}`, { pooling: 'mean', normalize: true })),
        cfg.timeoutMs,
        'embedding_query',
      );
      return tensorToVectors(output, 1, cfg.dim)?.[0] ?? null;
    } catch (error) {
      lastError = describe(error);
      return null;
    }
  });
}

/** Embed documents with the mandatory E5 `passage: ` prefix (batched). */
export async function embedDocuments(texts: string[]): Promise<Array<number[] | null> | null> {
  const cfg = getEmbeddingConfig();
  if (cfg.provider !== 'local') return null;
  const list = (texts ?? []).map((t) => String(t ?? ''));
  if (!list.length) return [];
  return serializeInfer(async () => {
    if (rssGuardTripped(cfg)) {
      noteRssGuard(cfg);
      return null;
    }
    const extractor = await getExtractor();
    if (!extractor) return null;
    if (rssGuardTripped(cfg)) {
      noteRssGuard(cfg);
      return null;
    }
    try {
      const output = await withTimeout(
        Promise.resolve(extractor(list.map((t) => `passage: ${t}`), { pooling: 'mean', normalize: true })),
        cfg.timeoutMs,
        'embedding_documents',
      );
      return tensorToVectors(output, list.length, cfg.dim);
    } catch (error) {
      lastError = describe(error);
      return null;
    }
  });
}

/** Observability only — never exposes model files, paths or credentials. */
export function embeddingStatus(): {
  provider: EmbeddingProvider;
  model: string;
  dim: number;
  dtype: 'q8';
  loaded: boolean;
  lastError: string | null;
  /** Watchdog ceiling and current RSS, both MiB — safe to log, no paths. */
  maxRssMb: number;
  rssMb: number;
} {
  const cfg = getEmbeddingConfig();
  return {
    provider: cfg.provider,
    model: cfg.model,
    dim: cfg.dim,
    dtype: cfg.dtype,
    loaded: extractorPromise !== null,
    lastError,
    maxRssMb: cfg.maxRssMb,
    rssMb: Math.round(currentRssMb() * 10) / 10,
  };
}
