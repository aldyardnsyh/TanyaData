/**
 * TanyaData — Qdrant client (P3-MIGRATION / DECISION-032, ADR-QD-02).
 *
 * Aturan mengikat:
 *   - LAZY. Tidak ada koneksi, fetch, atau modul dimuat saat import. Ini
 *     penting karena next.config.ts memakai output:'standalone' dan eval
 *     offline berjalan tanpa Qdrant / tanpa API key.
 *   - QDRANT_MODE=off → isQdrantEnabled() false dan getQdrantClient() tidak
 *     pernah dipanggil. Perilaku aplikasi identik dengan sebelum migrasi.
 *   - Kredensial hanya dari env VPS. Tidak pernah masuk log, URL, atau
 *     NEXT_PUBLIC_*.
 *
 * Paket `@qdrant/js-client-rest` diimpor lewat specifier bertipe `string`
 * (sengaja, seperti pola di lib/ai/hybrid.ts): backend menambahkannya ke
 * package.json, tetapi `tsc --noEmit` tidak boleh gagal sebelum `npm install`
 * dijalankan di VPS. Tipe minimum didefinisikan lokal di bawah.
 */

export type QdrantMode = 'off' | 'on' | 'local' | 'required';

/** Bentuk minimal client REST yang dipakai lane backend. Bukan re-ekspor tipe paket. */
export interface QdrantClientLike {
  getCollections(): Promise<{ collections: Array<{ name: string }> }>;
  /**
   * PERHATIAN: @qdrant/js-client-rest@1.20.0 mengembalikan
   * `{ exists: boolean }` (skema `CollectionExistence`), BUKAN `boolean`.
   * Versi lama/implementasi mock boleh mengembalikan boolean. Konsumen WAJIB
   * menormalkan kedua bentuk — lihat `collectionIsPresent()` di collections.ts.
   */
  collectionExists(name: string): Promise<boolean | { exists: boolean }>;
  deleteCollection(name: string): Promise<unknown>;
  getCollection(name: string): Promise<{
    config?: {
      params?: {
        vectors?: unknown;
        sparse_vectors?: unknown;
      };
    };
    payload_schema?: Record<string, unknown>;
    points_count?: number;
  }>;
  createCollection(
    name: string,
    config: Record<string, unknown>,
  ): Promise<unknown>;
  createPayloadIndex(
    name: string,
    body: { field_name: string; field_schema: Record<string, unknown>; wait?: boolean },
  ): Promise<unknown>;
  getAliases(): Promise<{ aliases: Array<{ alias_name: string; collection_name: string }> }>;
  updateCollectionAliases(body: Record<string, unknown>): Promise<unknown>;
  upsert(
    name: string,
    body: { points: QdrantPoint[]; wait?: boolean },
  ): Promise<unknown>;
  delete(
    name: string,
    body: { filter?: Record<string, unknown>; wait?: boolean },
  ): Promise<unknown>;
  count(name: string, body: { exact?: boolean; filter?: Record<string, unknown> }): Promise<{ count: number }>;
}

export interface QdrantPoint {
  id: number;
  vector: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface QdrantConfig {
  mode: QdrantMode;
  url: string;
  apiKey: string | null;
  collection: string;
  physicalCollection: string;
  vectorSize: number;
  timeoutMs: number;
  wait: boolean;
  batchSize: number;
  textField: string;
  denseVector: string;
}

const QDRANT_PACKAGE: string = '@qdrant/js-client-rest';

declare global {
  // eslint-disable-next-line no-var
  var __tanyadataQdrantClient: Promise<QdrantClientLike> | undefined;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseMode(raw: string | undefined): QdrantMode {
  const value = String(raw ?? 'on').trim().toLowerCase();
  // DECISION-033: 'on' adalah default aktif. 'local' alias lama, 'required'
  // fail-closed bila API key kosong. 'off' sengaja dipertahankan untuk debug.
  if (value === 'on' || value === 'local' || value === 'required') return value;
  return 'off';
}

/** Env dibaca setiap pemanggilan agar eval/tests bisa mengganti mode tanpa reload. */
export function getQdrantConfig(): QdrantConfig {
  const mode = parseMode(process.env.QDRANT_MODE);
  const version = String(process.env.QDRANT_COLLECTION_VERSION ?? 'v1').trim() || 'v1';
  const alias = String(process.env.QDRANT_COLLECTION ?? 'td_chunks').trim() || 'td_chunks';
  return {
    mode,
    url: String(process.env.QDRANT_URL ?? '').trim(),
    apiKey: String(process.env.QDRANT_API_KEY ?? '').trim() || null,
    collection: alias,
    physicalCollection: `${alias}_${version}`,
    vectorSize: clampInt(process.env.QDRANT_VECTOR_SIZE, 384, 1, 4096),
    timeoutMs: clampInt(process.env.QDRANT_TIMEOUT_MS, 5000, 500, 60000),
    wait: String(process.env.QDRANT_WAIT ?? 'true').trim().toLowerCase() !== 'false',
    batchSize: clampInt(process.env.QDRANT_BATCH_SIZE, 64, 1, 512),
    textField: String(process.env.QDRANT_TEXT_FIELD ?? 'text_fts').trim() || 'text_fts',
    denseVector: String(process.env.QDRANT_DENSE_VECTOR ?? 'dense').trim() || 'dense',
  };
}

/** False hanya untuk mode off/kosong — identik dengan AIML getQdrantConfig(). */
export function isQdrantEnabled(): boolean {
  return getQdrantConfig().mode !== 'off';
}

/** Jangan pernah mengembalikan API key atau URL dengan kredensial ke caller/log. */
export function redactQdrantError(error: unknown): string {
  const cfg = getQdrantConfig();
  let message = error instanceof Error ? error.message : String(error);
  if (cfg.apiKey) message = message.split(cfg.apiKey).join('[REDACTED]');
  try {
    const origin = new URL(cfg.url).origin;
    message = message.split(origin).join('[QDRANT_URL]');
  } catch {
    // URL tidak valid — jangan tambahkan informasi baru.
  }
  return message.slice(0, 200);
}

async function createClient(): Promise<QdrantClientLike> {
  const cfg = getQdrantConfig();
  if (!isQdrantEnabled()) {
    throw new Error('QDRANT_DISABLED: Qdrant sedang dimatikan (QDRANT_MODE=off)');
  }
  if (!cfg.url) {
    throw new Error('QDRANT_NOT_CONFIGURED: QDRANT_URL belum dikonfigurasi');
  }
  if (cfg.mode === 'required' && !cfg.apiKey) {
    throw new Error('QDRANT_NOT_CONFIGURED: QDRANT_API_KEY wajib untuk mode required');
  }
  const mod: any = await import(QDRANT_PACKAGE);
  const Ctor = mod?.QdrantClient;
  if (typeof Ctor !== 'function') {
    throw new Error('QDRANT_UNAVAILABLE: paket @qdrant/js-client-rest belum terpasang');
  }
  return new Ctor({
    url: cfg.url,
    ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
    timeout: cfg.timeoutMs,
  }) as QdrantClientLike;
}

/**
 * Singleton lazy. Promise di-cache di globalThis agar HMR tidak membuka
 * koneksi baru; kegagalan load dihapus dari cache supaya tidak permanen.
 */
export function getQdrantClient(): Promise<QdrantClientLike> {
  const cached = globalThis.__tanyadataQdrantClient;
  if (cached) return cached;
  const pending = createClient().catch((error) => {
    if (globalThis.__tanyadataQdrantClient === pending) {
      globalThis.__tanyadataQdrantClient = undefined;
    }
    throw error;
  });
  globalThis.__tanyadataQdrantClient = pending;
  return pending;
}

export interface QdrantHealth {
  mode: QdrantMode;
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  collection: string;
  points: number | null;
  version: string | null;
  lastError: string | null;
}

/**
 * Probe /readyz + info collection. TIDAK membuka koneksi sama sekali saat
 * mode off — mengembalikan status jujur tanpa efek samping.
 */
export async function qdrantHealth(): Promise<QdrantHealth> {
  const cfg = getQdrantConfig();
  const base: QdrantHealth = {
    mode: cfg.mode,
    enabled: cfg.mode !== 'off',
    configured: Boolean(cfg.url),
    ready: false,
    collection: cfg.collection,
    points: null,
    version: null,
    lastError: null,
  };
  if (!base.enabled || !base.configured) return base;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const response = await fetch(`${cfg.url.replace(/\/$/, '')}/readyz`, {
        headers: cfg.apiKey ? { 'api-key': cfg.apiKey } : {},
        signal: controller.signal,
      });
      base.ready = response.ok;
      if (!response.ok) base.lastError = `readyz_http_${response.status}`;
    } finally {
      clearTimeout(timer);
    }

    if (base.ready) {
      const client = await getQdrantClient();
      const info = await client.getCollection(cfg.collection).catch(() => null);
      if (info) {
        base.points = typeof info.points_count === 'number' ? info.points_count : null;
      }
      const root = await fetch(`${cfg.url.replace(/\/$/, '')}/`, {
        headers: cfg.apiKey ? { 'api-key': cfg.apiKey } : {},
        signal: AbortSignal.timeout(cfg.timeoutMs),
      }).catch(() => null);
      if (root?.ok) {
        const payload = (await root.json().catch(() => null)) as { version?: unknown } | null;
        base.version = typeof payload?.version === 'string' ? payload.version : null;
      }
    }
  } catch (error) {
    base.lastError = redactQdrantError(error);
  }
  return base;
}

/**
 * Label engine faktual untuk GET /api/sources/:id → index.engine.
 * Sinkron dan tanpa I/O. Tidak pernah mengklaim "hybrid" bila dense mati.
 */
export function getIndexEngine(): 'fts5-bm25' | 'qdrant-bm25' | 'qdrant-hybrid' {
  if (!isQdrantEnabled()) return 'fts5-bm25';
  const retrieval = String(process.env.RETRIEVAL_MODE ?? 'hybrid').trim().toLowerCase();
  if (retrieval !== 'qdrant' && retrieval !== 'hybrid') return 'fts5-bm25';
  const embedding = String(process.env.EMBEDDING_PROVIDER ?? 'local').trim().toLowerCase();
  return embedding === 'local' ? 'qdrant-hybrid' : 'qdrant-bm25';
}
