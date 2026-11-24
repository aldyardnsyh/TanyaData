/**
 * TanyaData — Qdrant collection bootstrap (P3-MIGRATION / DECISION-032).
 *
 * Satu collection fisik versioned (`td_chunks_v1`) + alias stabil (`td_chunks`)
 * yang dipakai aplikasi dan adapter AIML. Idempoten: aman dipanggil tiap kali
 * backend start. Tidak ada recreate otomatis — beda dimensi vector = error
 * eksplisit (Q-R4).
 *
 * CATATAN DESAIN (deviasi terdokumentasi, lihat docs/QDRANT_BACKEND_IMPL.md):
 * ticket menyebut "sparse vector text_fts (BM25)". Kami memakai **full-text
 * payload index dengan BM25 scoring** pada field `text_fts`, karena:
 *   1. ADR-QD-03 / ADR_QDRANT.md §2.3 menolak sparse BM25 server-side dan
 *      memilih full-text index (rekomendasi resmi Qdrant).
 *   2. AIML lib/ai/hybrid.ts:237 sudah memanggil
 *      `query({ text }, using: 'text_fts')` TANPA `model` — itu adalah bentuk
 *      kueri full-text index, bukan sparse-vector inference (yang butuh
 *      `model: 'qdrant/bm25'` dan unduhan model di server).
 *   3. Full-text index bekerja offline, tanpa model, cocok untuk VPS 2 GB.
 * Stemming Bahasa Indonesia tetap dilakukan di aplikasi (normalizeForFts),
 * karena Snowball Qdrant tidak punya Indonesian.
 *
 * PERBAIKAN BOOTSTRAP (P4): @qdrant/js-client-rest@1.20.0 mengembalikan
 * `{ exists: boolean }` dari `collectionExists()`, bukan `boolean`. Pemeriksaan
 * truthiness naif (`if (!exists)`) selalu bernilai false untuk objek tersebut,
 * sehingga create dilewati pada Qdrant fresh dan `getCollection()` berikutnya
 * melempar "Not Found". Semua pembacaan dinormalkan lewat `collectionIsPresent()`,
 * dengan verifikasi ulang + retry singkat untuk menutup race create/exists.
 */

import {
  getQdrantClient,
  getQdrantConfig,
  isQdrantEnabled,
  redactQdrantError,
  type QdrantClientLike,
} from '@/lib/qdrant/client';

export interface QdrantCollectionSummary {
  enabled: boolean;
  alias: string;
  physical: string;
  created: boolean;
  aliasCreated: boolean;
  indexesCreated: string[];
  vectorSize: number;
}

const KEYWORD_FIELDS = [
  'source_id',
  'dataset_id',
  'doc_id',
  'chunk_id', // disimpan juga sebagai payload untuk filter/observability
  'section_path',
  'rev',
  'level',
] as const;

const INTEGER_FIELDS = ['page'] as const;
const BOOL_FIELDS = ['parse_ok'] as const;

type CollectionInfo = Awaited<ReturnType<QdrantClientLike['getCollection']>>;

function fieldSchema(field: string): Record<string, unknown> {
  if ((INTEGER_FIELDS as readonly string[]).includes(field)) return { type: 'integer' };
  if ((BOOL_FIELDS as readonly string[]).includes(field)) return { type: 'bool' };
  return { type: 'keyword' };
}

function disabledSummary(): QdrantCollectionSummary {
  const cfg = getQdrantConfig();
  return {
    enabled: false,
    alias: cfg.collection,
    physical: cfg.physicalCollection,
    created: false,
    aliasCreated: false,
    indexesCreated: [],
    vectorSize: cfg.vectorSize,
  };
}

function readVectorSize(info: CollectionInfo): number | null {
  const vectors = info?.config?.params?.vectors as
    | { dense?: { size?: unknown } }
    | { size?: unknown }
    | undefined;
  if (!vectors || typeof vectors !== 'object') return null;
  const named = (vectors as { dense?: { size?: unknown } }).dense;
  const raw = named && typeof named === 'object' ? named.size : (vectors as { size?: unknown }).size;
  return typeof raw === 'number' ? raw : null;
}

/* --------------------------------------------------------------- helpers */

/**
 * SDK 1.20 → `{ exists: boolean }`. Implementasi lama/mock → `boolean`.
 * Keduanya diterima; `undefined`/`null` dianggap "tidak ada".
 */
function collectionIsPresent(raw: boolean | { exists: boolean } | null | undefined): boolean {
  if (typeof raw === 'boolean') return raw;
  return Boolean(raw && typeof raw === 'object' && raw.exists === true);
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  const status = e.status ?? e.statusCode ?? e.response_status;
  if (status === 404 || status === '404') return true;
  for (const key of ['data', 'response'] as const) {
    const nested = e[key] as Record<string, unknown> | undefined;
    if (nested && (nested.status === 404 || nested.status === '404')) return true;
  }
  const message = String(e.message ?? '').toLowerCase();
  return message.includes('not found') || message.includes('404');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Baca collection dengan retry singkat untuk eventual consistency pasca-create. */
async function readCollection(client: QdrantClientLike, name: string, attempts = 3): Promise<CollectionInfo> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await client.getCollection(name);
    } catch (error) {
      last = error;
      if (!isNotFound(error) || i === attempts - 1) throw error;
      await sleep(150 * (i + 1));
    }
  }
  throw last;
}

/* ------------------------------------------------------------------ main */

/**
 * Pastikan collection + alias + payload index siap dipakai. Tidak melakukan
 * apa pun saat QDRANT_MODE=off (mengembalikan ringkasan enabled:false).
 */
export async function ensureQdrantCollection(): Promise<QdrantCollectionSummary> {
  if (!isQdrantEnabled()) return disabledSummary();

  const cfg = getQdrantConfig();
  const client = await getQdrantClient();
  const summary: QdrantCollectionSummary = {
    enabled: true,
    alias: cfg.collection,
    physical: cfg.physicalCollection,
    created: false,
    aliasCreated: false,
    indexesCreated: [],
    vectorSize: cfg.vectorSize,
  };

  try {
    // 1. Collection fisik. Normalisasi WAJIB — lihat catatan di header file.
    const present = collectionIsPresent(await client.collectionExists(cfg.physicalCollection));
    if (!present) {
      try {
        await client.createCollection(cfg.physicalCollection, {
          vectors: {
            [cfg.denseVector]: { size: cfg.vectorSize, distance: 'Cosine' },
          },
        });
      } catch (error) {
        // Tutup race: proses lain bisa membuat collection di antara EXISTS
        // dan CREATE. Verifikasi ulang sebelum memutuskan ini kegagalan.
        const nowPresent = collectionIsPresent(
          await client.collectionExists(cfg.physicalCollection).catch(() => null),
        );
        if (!nowPresent) throw error;
      }
      summary.created = true;
    }

    // 2. Tunggu collection benar-benar terlihat sebelum membuat index/alias.
    const info = await readCollection(client, cfg.physicalCollection);
    const size = readVectorSize(info);
    if (size !== null && size !== cfg.vectorSize) {
      throw new Error(
        `dimensi vector ${size} != QDRANT_VECTOR_SIZE=${cfg.vectorSize}; ` +
          'jangan auto-recreate, gunakan collection version baru',
      );
    }

    // 3. Payload index HARUS dibuat sebelum ingest agar filter-aware HNSW ikut
    //    terbangun. text_fts memakai full-text index + BM25 scoring.
    const existing = new Set(Object.keys(info?.payload_schema ?? {}));
    const wanted: Array<[string, Record<string, unknown>]> = [
      ...KEYWORD_FIELDS.map((field) => [field, fieldSchema(field)] as [string, Record<string, unknown>]),
      ...INTEGER_FIELDS.map((field) => [field, fieldSchema(field)] as [string, Record<string, unknown>]),
      ...BOOL_FIELDS.map((field) => [field, fieldSchema(field)] as [string, Record<string, unknown>]),
      [
        cfg.textField,
        {
          type: 'text',
          tokenizer: 'word',
          lowercase: true,
          scoring: { type: 'bm25' },
        },
      ],
    ];
    for (const [field, schema] of wanted) {
      if (existing.has(field)) continue;
      try {
        await client.createPayloadIndex(cfg.physicalCollection, {
          field_name: field,
          field_schema: schema,
          wait: true,
        });
      } catch (error) {
        // Idempoten: index bisa dibuat bersamaan proses lain. Baca ulang
        // schema; bila field sudah ada, anggap berhasil.
        const refreshed = await client.getCollection(cfg.physicalCollection).catch(() => null);
        if (refreshed && Object.prototype.hasOwnProperty.call(refreshed.payload_schema ?? {}, field)) {
          continue;
        }
        throw error;
      }
      summary.indexesCreated.push(field);
    }

    // 4. Alias stabil → collection fisik versioned.
    const aliases = await client.getAliases();
    const current = aliases.aliases.find((a) => a.alias_name === cfg.collection);
    if (!current) {
      try {
        await client.updateCollectionAliases({
          actions: [
            {
              create_alias: {
                collection_name: cfg.physicalCollection,
                alias_name: cfg.collection,
              },
            },
          ],
        });
      } catch (error) {
        const refreshed = await client.getAliases().catch(() => null);
        const nowCurrent = refreshed?.aliases.find((a) => a.alias_name === cfg.collection);
        if (!nowCurrent || nowCurrent.collection_name !== cfg.physicalCollection) throw error;
      }
      summary.aliasCreated = true;
    } else if (current.collection_name !== cfg.physicalCollection) {
      throw new Error(
        `alias ${cfg.collection} sudah menunjuk ${current.collection_name}, ` +
          `tidak akan dialihkan ke ${cfg.physicalCollection} secara otomatis`,
      );
    }

    return summary;
  } catch (error) {
    throw new Error(`ensureQdrantCollection gagal: ${redactQdrantError(error)}`);
  }
}
