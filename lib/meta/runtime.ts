/**
 * TanyaData — derivasi status runtime untuk `GET /api/meta` (P6-UI-HONESTY,
 * DECISION-035, API_CONTRACT §9.3.1).
 *
 * Aturan mengikat:
 *   1. Tidak ada nilai hafalan. Setiap field diturunkan dari env + helper yang
 *      benar-benar dipakai jalur query (`getRetrievalMode`, `getQdrantConfig`,
 *      `circuitState`, `getEmbeddingConfig`, `llmAvailable`/`llmMode`).
 *   2. Tidak ada network call yang memblokir request. `qdrantReachable` dibaca
 *      dari cache proses dan diperbarui di latar belakang (lihat di bawah).
 *   3. Tidak pernah melempar error ke response: probe menangkap semua kegagalan
 *      dan mengembalikan `false` (tidak terjangkau), bukan exception.
 *   4. `capabilities.rag` = `runtime.effectiveRetrieval`, jadi nilai ini harus
 *      mencerminkan perilaku yang dialami pengguna — bukan mode terkonfigurasi.
 */
import { getRetrievalMode } from '@/lib/ai/retrieval';
import { circuitState, getQdrantConfig as getQueryQdrantConfig } from '@/lib/ai/hybrid';
import { getQdrantConfig as getClientQdrantConfig } from '@/lib/qdrant/client';
import { getEmbeddingConfig } from '@/lib/ai/embedding';
import { llmAvailable, llmMode } from '@/lib/ai/llm';
import type { SystemRuntime } from '@/lib/contracts/http';

/* -------------------------------------------------- fallback terakhir diamati */

/**
 * Alasan fallback retrieval terakhir yang diamati in-process.
 *
 * Pemilik nilai ini adalah jalur retrieval (`lib/ai/adapter.ts:523` →
 * `dispatch.meta.fallbackReason`). Hook di bawah sudah tersedia, tetapi BELUM
 * disambungkan karena `lib/ai/*` berada di luar file scope lane backend pada
 * fase ini (tiket follow-up: aiml/backend). Sampai disambungkan,
 * `resolveFallbackReason()` memakai aturan derivasi deterministik dari circuit
 * breaker + konfigurasi, sehingga tidak ada alasan yang dikarang.
 */
let observedFallbackReason: string | null = null;

/** Rekam alasan fallback retrieval yang baru saja diamati (null = tidak ada). */
export function recordRetrievalFallback(reason: string | null | undefined): void {
  observedFallbackReason = reason ?? null;
}

/** Alasan fallback terakhir yang terekam di proses ini, bila ada. */
export function lastObservedFallbackReason(): string | null {
  return observedFallbackReason;
}

/* ---------------------------------------------------- probe Qdrant non-blocking */

/** Batas keras probe: lebih ketat dari `qdrantHealth()` (clamp minimum 500 ms). */
const QDRANT_PROBE_TIMEOUT_MS = 250;
/** Umur cache sebelum probe dijadwalkan ulang (stale-while-revalidate). */
const QDRANT_PROBE_TTL_MS = 30_000;

type ProbeCache = { ready: boolean; at: number };

let probeCache: ProbeCache | null = null;
let probeInflight: Promise<void> | null = null;

/**
 * Semantik `qdrantReachable`:
 *   - `null` → tidak relevan (`QDRANT_MODE=off` atau `QDRANT_URL` kosong) ATAU
 *     belum pernah diprobe pada proses ini. UI wajib menulis "Tidak diukur".
 *   - `true`/`false` → hasil probe `/readyz` terakhir, di-cache 30 detik.
 *
 * Probe memakai endpoint dan header yang sama dengan `qdrantHealth()` di
 * `lib/qdrant/client.ts:198-245`, tetapi tidak memanggil helper itu karena
 * timeout minimumnya 500 ms (clamp `QDRANT_TIMEOUT_MS`) — melebihi anggaran
 * 250 ms. Probe tidak pernah di-await oleh request: cache kosong/kedaluwarsa
 * hanya menjadwalkan refresh di latar belakang.
 */
function scheduleQdrantProbe(): void {
  if (probeInflight) return;
  probeInflight = probeQdrantReady()
    .then((ready) => {
      probeCache = { ready, at: Date.now() };
    })
    .finally(() => {
      probeInflight = null;
    });
}

async function probeQdrantReady(): Promise<boolean> {
  const cfg = getClientQdrantConfig();
  if (!cfg.url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QDRANT_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${cfg.url.replace(/\/$/, '')}/readyz`, {
      headers: cfg.apiKey ? { 'api-key': cfg.apiKey } : {},
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    // Timeout / DNS / TLS / HTTP error → tidak terjangkau. Tidak pernah dilempar.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Reset cache probe. Dipakai test/eval yang mengganti env tanpa reload modul. */
export function resetQdrantProbeCache(): void {
  probeCache = null;
  probeInflight = null;
}

function readQdrantReachable(mode: SystemRuntime['qdrantMode'], configured: boolean): boolean | null {
  if (mode === 'off' || !configured) return null;
  if (probeCache) {
    if (Date.now() - probeCache.at > QDRANT_PROBE_TTL_MS) scheduleQdrantProbe();
    return probeCache.ready;
  }
  scheduleQdrantProbe();
  return null; // belum diukur — jangan menebak
}

/* ------------------------------------------------------------- derivasi runtime */

function readSeedProfile(): 'none' | 'demo' {
  const raw = String(process.env.SEED_PROFILE ?? 'none').trim().toLowerCase();
  // Fail-closed seperti scripts/lib/seed-profile.mjs, tetapi payload TIDAK boleh
  // 500: nilai asing dilaporkan `none`, bukan melempar error.
  return raw === 'demo' ? 'demo' : 'none';
}

function readOcrEnabled(): boolean {
  const enabled = String(process.env.OCR_ENABLED ?? '').trim().toLowerCase() === 'true';
  return enabled && Boolean(String(process.env.OCR_ENDPOINT ?? '').trim());
}

type FallbackContext = {
  retrievalMode: SystemRuntime['retrievalMode'];
  effectiveRetrieval: SystemRuntime['effectiveRetrieval'];
  qdrantMode: SystemRuntime['qdrantMode'];
  qdrantConfigured: boolean;
  qdrantReachable: boolean | null;
  circuitOpen: boolean;
  requiredKeyMissing: boolean;
};

/**
 * Alasan fallback yang jujur, berurutan:
 *   1. Operator memilih `RETRIEVAL_MODE=fts5` → bukan fallback, `null`.
 *   2. Circuit breaker terbuka (`lib/ai/hybrid.ts:148-155`) → `qdrant_circuit_open`.
 *   3. Alasan terakhir yang diamati in-process (bila hook sudah disambungkan).
 *   4. Backend efektif hybrid/qdrant → tidak ada fallback.
 *   5. Selain itu, turunkan penyebab konfigurasi yang pasti.
 */
function resolveFallbackReason(ctx: FallbackContext): string | null {
  if (ctx.retrievalMode === 'fts5') return null;
  if (ctx.circuitOpen) return 'qdrant_circuit_open';

  const observed = lastObservedFallbackReason();
  if (observed) return observed;

  if (ctx.effectiveRetrieval !== 'fts5') return null;

  if (ctx.requiredKeyMissing) return 'qdrant_unavailable';
  if (ctx.qdrantMode === 'off') return 'qdrant_disabled';
  if (!ctx.qdrantConfigured) return 'qdrant_unavailable';
  // Divergensi default yang didokumentasikan (SYSTEM_OVERVIEW §4.1): jalur query
  // memperlakukan `QDRANT_MODE` yang tidak diset sebagai off, sedangkan
  // `lib/qdrant/client.ts` menganggapnya on. Laporkan penyebab sebenarnya.
  if (!String(process.env.QDRANT_MODE ?? '').trim()) return 'qdrant_mode_unset';
  if (ctx.qdrantReachable === false) return 'qdrant_unavailable';
  return null;
}

/**
 * Bangun `system.runtime` sesuai API_CONTRACT §9.3.1. Sinkron dan tanpa I/O
 * jaringan — aman dipanggil dari route handler mana pun.
 */
export function deriveSystemRuntime(): SystemRuntime {
  const retrievalMode = getRetrievalMode();
  const clientCfg = getClientQdrantConfig();
  const qdrantMode = clientCfg.mode;
  const qdrantConfigured = Boolean(clientCfg.url);

  // `getQdrantConfig('*')` = gate yang benar-benar dipakai `lib/ai/retrieval.ts`
  // (`lib/ai/hybrid.ts:124-140`): null bila mode off/kosong atau URL kosong.
  const queryCfg = getQueryQdrantConfig('*');
  const requiredKeyMissing = qdrantMode === 'required' && !clientCfg.apiKey;
  const qdrantReachable = readQdrantReachable(qdrantMode, qdrantConfigured);
  const circuitOpen = circuitState().open;

  // EFEKTIF = yang dialami pengguna: fallback ke FTS5 bila gate query null,
  // mode fts5 eksplisit, `required` tanpa API key, circuit terbuka, atau probe
  // baru-baru ini menyatakan Qdrant tidak terjangkau. `null` (belum diukur)
  // TIDAK menurunkan mode — jangan menebak.
  const effectiveRetrieval: SystemRuntime['effectiveRetrieval'] =
    queryCfg === null || retrievalMode === 'fts5' || requiredKeyMissing || circuitOpen || qdrantReachable === false
      ? 'fts5'
      : retrievalMode;

  return {
    retrievalMode,
    effectiveRetrieval,
    qdrantMode,
    qdrantConfigured,
    qdrantReachable,
    embeddingProvider: getEmbeddingConfig().provider,
    llm: { enabled: llmAvailable(), mode: llmMode() },
    ocrEnabled: readOcrEnabled(),
    seedProfile: readSeedProfile(),
    fallbackReason: resolveFallbackReason({
      retrievalMode,
      effectiveRetrieval,
      qdrantMode,
      qdrantConfigured,
      qdrantReachable,
      circuitOpen,
      requiredKeyMissing,
    }),
  };
}
