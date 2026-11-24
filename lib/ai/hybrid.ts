/**
 * TanyaData AI — hybrid retrieval fusion (P3-MIGRATION / DECISION-032 ADR-QD-05).
 *
 * Two responsibilities, kept separate on purpose:
 *   1. Pure RRF fusion (`rrfFuse`, `normalizeScore`) — deterministic, unit-testable.
 *   2. A thin Qdrant REST adapter (`fetchQdrantCandidates`) with a circuit breaker.
 *
 * Hard rules from the ADR:
 *   - RRF reorders candidates only. It is NEVER used as `citation.score`.
 *   - `citation.score` stays BM25-derived (FTS5 leg, or Qdrant BM25 leg).
 *   - Qdrant is a derived index; text for citations is hydrated from SQLite by
 *     the caller, never trusted from the Qdrant payload.
 *   - Every failure returns an honest reason; no exception escapes.
 *
 * Qdrant API verified 2026-11-23 from qdrant.tech full-text-search docs:
 *   `client.query(collection, { query: { text }, using: <text field>, ... })`
 *   and `client.query(collection, { query: number[], using: <dense vector>, ... })`.
 * The package is imported through a `string`-typed specifier because it is an
 * optional dependency owned by the backend lane.
 */
import { withTimeout } from './embedding';

export type RetrievalMode = 'fts5' | 'hybrid' | 'qdrant';

export type FallbackReason =
  | 'qdrant_unavailable'
  | 'qdrant_timeout'
  | 'qdrant_circuit_open'
  | 'qdrant_dense_unavailable'
  | 'qdrant_empty'
  | 'embedding_unavailable'
  | null;

export type CandidateLeg = 'fts5' | 'qdrant_bm25' | 'qdrant_dense';

export interface Candidate {
  /** Stable chunk id (core_chunks.id as string). */
  id: string;
  /** 1-based rank inside this leg. */
  rank: number;
  /** Raw leg score, higher = better. */
  rawScore: number;
  leg: CandidateLeg;
}

export interface FusedCandidate {
  id: string;
  rrf: number;
  legs: CandidateLeg[];
  /** Raw BM25 score from the best lexical leg — the ONLY citation.score source. */
  bm25: number | null;
  bm25Norm: number | null;
  dense: number | null;
}

const QDRANT_PACKAGE: string = '@qdrant/js-client-rest';

/** Reciprocal Rank Fusion. `k=2` is the Qdrant default; do not tune unmeasured. */
export function rrfFuse(legs: Candidate[][], k = 2): FusedCandidate[] {
  const fused = new Map<string, FusedCandidate>();
  for (const leg of legs) {
    for (const candidate of leg) {
      if (!candidate?.id || !Number.isFinite(candidate.rank) || candidate.rank < 1) continue;
      const contribution = 1 / (k + candidate.rank);
      const current = fused.get(candidate.id);
      if (current) {
        current.rrf += contribution;
        if (!current.legs.includes(candidate.leg)) current.legs.push(candidate.leg);
        if (candidate.leg === 'qdrant_bm25' || candidate.leg === 'fts5') {
          if (current.bm25 === null || candidate.rawScore > current.bm25) {
            current.bm25 = candidate.rawScore;
          }
        } else if (candidate.leg === 'qdrant_dense') {
          current.dense = candidate.rawScore;
        }
      } else {
        fused.set(candidate.id, {
          id: candidate.id,
          rrf: contribution,
          legs: [candidate.leg],
          bm25: candidate.leg === 'fts5' || candidate.leg === 'qdrant_bm25' ? candidate.rawScore : null,
          bm25Norm: null,
          dense: candidate.leg === 'qdrant_dense' ? candidate.rawScore : null,
        });
      }
    }
  }
  return [...fused.values()].sort((a, b) => b.rrf - a.rrf || a.id.localeCompare(b.id));
}

/**
 * Map a raw score onto the FTS5 citation-score scale.
 *
 * `fts5` keeps the legacy `1/(1+|raw|)` shape used by `retrieveHybrid`.
 * `qdrant_bm25` uses the same normalised shape with the leg's max magnitude so
 * the guardrail thresholds (0.45 / 0.25 / 0.18) keep their meaning.
 * `rrf` deliberately returns null: RRF is an ordinal, not a probability.
 */
export function normalizeScore(raw: number, mode: 'fts5' | 'qdrant_bm25' | 'rrf', maxAbs = 1): number | null {
  if (!Number.isFinite(raw)) return null;
  if (mode === 'rrf') return null;
  const magnitude = mode === 'fts5' ? Math.abs(raw) : Math.abs(raw) / Math.max(1e-6, maxAbs);
  return Number((1 / (1 + magnitude)).toFixed(4));
}

export interface QdrantConfig {
  url: string;
  apiKey: string | null;
  collection: string;
  timeoutMs: number;
  denseVector: string;
  textField: string;
  topK: number;
  datasetIds: string[];
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** `null` means Qdrant is disabled — callers must use the FTS5 path. */
export function getQdrantConfig(datasetId: string | string[]): QdrantConfig | null {
  const mode = String(process.env.QDRANT_MODE ?? 'off').trim().toLowerCase();
  if (mode === 'off' || mode === '') return null;
  const url = String(process.env.QDRANT_URL ?? '').trim();
  if (!url) return null;
  const ids = (Array.isArray(datasetId) ? datasetId : [datasetId]).filter(Boolean);
  return {
    url,
    apiKey: String(process.env.QDRANT_API_KEY ?? '').trim() || null,
    collection: String(process.env.QDRANT_COLLECTION ?? 'td_chunks').trim() || 'td_chunks',
    timeoutMs: clampInt(process.env.QDRANT_TIMEOUT_MS, 5000, 500, 60000),
    denseVector: String(process.env.QDRANT_DENSE_VECTOR ?? 'dense').trim() || 'dense',
    textField: String(process.env.QDRANT_TEXT_FIELD ?? 'text_fts').trim() || 'text_fts',
    topK: clampInt(process.env.QDRANT_TOP_K, 20, 1, 100),
    datasetIds: ids,
  };
}

/* ------------------------------------------------------------ circuit breaker */

const CB_THRESHOLD = 3;
const CB_COOLDOWN_MS = 60_000;
const circuit = { failures: 0, openUntil: 0 };

export function circuitState(): { failures: number; open: boolean; retryAfterMs: number } {
  const open = Date.now() < circuit.openUntil;
  return {
    failures: circuit.failures,
    open,
    retryAfterMs: open ? circuit.openUntil - Date.now() : 0,
  };
}

export function resetCircuit(): void {
  circuit.failures = 0;
  circuit.openUntil = 0;
}

function recordSuccess(): void {
  circuit.failures = 0;
  circuit.openUntil = 0;
}

function recordFailure(): void {
  circuit.failures += 1;
  if (circuit.failures >= CB_THRESHOLD) circuit.openUntil = Date.now() + CB_COOLDOWN_MS;
}

/* --------------------------------------------------------------- Qdrant fetch */

export interface QdrantFetchResult {
  bm25: Candidate[];
  dense: Candidate[];
  bm25ByChunk: Record<string, number>;
  denseByChunk: Record<string, number>;
}

export type QdrantFetchOutcome =
  | { ok: true; data: QdrantFetchResult; partialReason: FallbackReason }
  | { ok: false; reason: Exclude<FallbackReason, null> };

function isTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /TIMEOUT|ETIMEDOUT|ECONNABORTED|aborted/i.test(message);
}

function pointId(point: any): string | null {
  const payloadId = point?.payload?.chunk_id;
  const raw = payloadId ?? point?.id;
  if (raw === null || raw === undefined || raw === '') return null;
  return String(raw);
}

/**
 * Fetch BM25 (mandatory) and optional dense candidates from Qdrant.
 * BM25 failure is a hard failure because `citation.score` must stay BM25-based.
 */
export async function fetchQdrantCandidates(input: {
  question: string;
  terms: string[];
  dense: number[] | null;
  config: QdrantConfig;
}): Promise<QdrantFetchOutcome> {
  if (circuitState().open) return { ok: false, reason: 'qdrant_circuit_open' };

  const cfg = input.config;
  let client: any;
  try {
    const mod: any = await import(QDRANT_PACKAGE);
    const QdrantClientCtor = mod?.QdrantClient;
    if (typeof QdrantClientCtor !== 'function') return { ok: false, reason: 'qdrant_unavailable' };
    client = new QdrantClientCtor({
      url: cfg.url,
      ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
      timeout: cfg.timeoutMs,
    });
  } catch {
    recordFailure();
    return { ok: false, reason: 'qdrant_unavailable' };
  }

  const must: any[] = [
    { key: 'level', match: { value: 'child' } },
    { key: 'parse_ok', match: { value: true } },
  ];
  if (cfg.datasetIds.length && !cfg.datasetIds.includes('*')) {
    must.push({ key: 'dataset_id', match: { any: cfg.datasetIds } });
  }
  const filter = { must };

  let bm25Points: any[];
  try {
    const response = await withTimeout(
      Promise.resolve(client.query(cfg.collection, {
        query: { text: input.terms.join(' ') },
        using: cfg.textField,
        limit: cfg.topK,
        filter,
        with_payload: true,
      })),
      cfg.timeoutMs,
      'qdrant_bm25',
    );
    bm25Points = Array.isArray(response?.points) ? response.points : [];
  } catch (error) {
    recordFailure();
    return { ok: false, reason: isTimeout(error) ? 'qdrant_timeout' : 'qdrant_unavailable' };
  }

  if (!bm25Points.length) {
    recordSuccess();
    return { ok: false, reason: 'qdrant_empty' };
  }

  const bm25ByChunk: Record<string, number> = {};
  const bm25: Candidate[] = [];
  bm25Points.forEach((point, index) => {
    const id = pointId(point);
    const score = Number(point?.score);
    if (!id || !Number.isFinite(score)) return;
    bm25ByChunk[id] = score;
    bm25.push({ id, rank: index + 1, rawScore: score, leg: 'qdrant_bm25' });
  });

  const dense: Candidate[] = [];
  const denseByChunk: Record<string, number> = {};
  let partialReason: FallbackReason = null;
  if (input.dense && input.dense.length) {
    try {
      const response = await withTimeout(
        Promise.resolve(client.query(cfg.collection, {
          query: input.dense,
          using: cfg.denseVector,
          limit: cfg.topK,
          filter,
          with_payload: true,
        })),
        cfg.timeoutMs,
        'qdrant_dense',
      );
      const points: any[] = Array.isArray(response?.points) ? response.points : [];
      points.forEach((point, index) => {
        const id = pointId(point);
        const score = Number(point?.score);
        if (!id || !Number.isFinite(score)) return;
        denseByChunk[id] = score;
        dense.push({ id, rank: index + 1, rawScore: score, leg: 'qdrant_dense' });
      });
      if (!dense.length) partialReason = 'qdrant_dense_unavailable';
    } catch {
      // Dense is an enhancement; BM25 still answers. Never fail the query here.
      partialReason = 'qdrant_dense_unavailable';
    }
  } else {
    partialReason = 'embedding_unavailable';
  }

  recordSuccess();
  return { ok: true, data: { bm25, dense, bm25ByChunk, denseByChunk }, partialReason };
}
