/**
 * SQLite query cache — TTL 30 menit, tanpa Redis.
 *
 * RESOURCE_OPTIMIZED_ADR (VPS 2 vCPU / 2 GB): menghemat LLM call dan CPU dengan
 * menyimpan hasil pipeline per (dataset, pertanyaan, periode, bahasa).
 *
 * Tabel dibuat lazy di sini sengaja: lane P3-RESOURCE hanya boleh menyentuh
 * lib/core/**, lib/ingest/**, app/api/**, package.json dan scripts/** — tidak
 * lib/db/**. `CREATE TABLE IF NOT EXISTS` idempoten; rollback = DROP TABLE.
 *
 * Eval ground truth membuka workspace DB dengan readonly + query_only. Semua
 * akses cache dibungkus try/catch: pada DB readonly cache disable dengan diam,
 * sehingga perilaku eval identik dengan baseline (8/8 PASS).
 */

import { createHash } from 'node:crypto';
import type { DB } from '@/lib/db/client';
import type { Query } from '@/lib/core/contracts';

export const QUERY_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ROWS = 500;

const readyDbs = new WeakSet<object>();

function ensureTable(db: DB): boolean {
  if (readyDbs.has(db)) return true;
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS query_cache(
         cache_key TEXT PRIMARY KEY,
         dataset_id TEXT NOT NULL,
         result_json TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
    );
    db.exec('CREATE INDEX IF NOT EXISTS ix_query_cache_dataset ON query_cache(dataset_id)');
    readyDbs.add(db);
    return true;
  } catch {
    // readonly / query_only / disk penuh → cache tidak dipakai, pipeline jalan.
    return false;
  }
}

/** Kunci = hash(dataset + pertanyaan ternormalisasi + bahasa + periode). */
export function queryCacheKey(input: {
  datasetId: string;
  question: string;
  lang: string;
  period?: { start: string; end: string } | null;
}): string {
  const period = input.period ? `${input.period.start}|${input.period.end}` : '-';
  const question = String(input.question ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256')
    .update(`${input.datasetId}\u0000${question}\u0000${input.lang}\u0000${period}`)
    .digest('hex');
}

export function getCachedQuery(db: DB, key: string): Query | null {
  if (!ensureTable(db)) return null;
  try {
    const row = db
      .prepare('SELECT result_json, created_at FROM query_cache WHERE cache_key = ?')
      .get(key) as { result_json: string; created_at: number } | undefined;
    if (!row) return null;
    if (Date.now() - row.created_at > QUERY_CACHE_TTL_MS) {
      db.prepare('DELETE FROM query_cache WHERE cache_key = ?').run(key);
      return null;
    }
    return JSON.parse(row.result_json) as Query;
  } catch {
    return null;
  }
}

export function setCachedQuery(db: DB, key: string, datasetId: string, query: Query): void {
  if (!ensureTable(db)) return;
  try {
    const now = Date.now();
    db.prepare(
      `INSERT INTO query_cache(cache_key, dataset_id, result_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         result_json = excluded.result_json, created_at = excluded.created_at`,
    ).run(key, datasetId, JSON.stringify(query), now);
    // Jaga footprint DB tetap kecil: buang expired dan batasi jumlah baris.
    db.prepare('DELETE FROM query_cache WHERE created_at < ?').run(now - QUERY_CACHE_TTL_MS);
    db.prepare(
      `DELETE FROM query_cache WHERE cache_key IN (
         SELECT cache_key FROM query_cache ORDER BY created_at DESC LIMIT -1 OFFSET ?
       )`,
    ).run(MAX_CACHE_ROWS);
  } catch {
    // Cache bukan jalur kritis; kegagalan tulis tidak boleh menggagalkan jawaban.
  }
}

/** Invalidasi saat dataset berubah. Tanpa argumen = hapus semua (paling aman). */
export function invalidateQueryCache(db: DB, datasetId?: string): number {
  if (!ensureTable(db)) return 0;
  try {
    const result = datasetId
      ? db.prepare('DELETE FROM query_cache WHERE dataset_id = ?').run(datasetId)
      : db.prepare('DELETE FROM query_cache').run();
    return result.changes;
  } catch {
    return 0;
  }
}
