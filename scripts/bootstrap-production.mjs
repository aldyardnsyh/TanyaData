#!/usr/bin/env node
/**
 * Bootstrap produksi TanyaData — idempoten, satu kali, non-interaktif.
 *
 *   npm run bootstrap:production                 # SEED_PROFILE=none (default)
 *   SEED_PROFILE=demo npm run bootstrap:production
 *
 * Urutan (none): db:init → reindex:docs → check:seed → verifikasi Qdrant.
 * Urutan (demo): db:init → db:seed:kb-sop → reindex:docs → check:seed → Qdrant.
 *
 * Prinsip:
 *  - SQLite/FTS5 adalah source of truth. Qdrant adalah indeks TURUNAN.
 *  - Bila Qdrant tidak tersedia (mode off / URL kosong / timeout), bootstrap
 *    TETAP sukses dengan catatan jujur bahwa aplikasi berjalan di FTS5.
 *  - Qdrant 0 point BUKAN kegagalan bila SEED_PROFILE=none dan tidak ada
 *    dokumen yang memang sengaja tidak di-seed. Dicatat `no_documents=true`.
 *  - Qdrant 0 point saat demo → FAIL (sinkronisasi rusak, bukan "Qdrant mati").
 *  - Tidak ada watcher / dev server. Tiap langkah punya timeout keras.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { readSeedProfile } from './lib/seed-profile.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultPath = process.env.BOOTSTRAP_RESULT_PATH
  ? path.resolve(process.env.BOOTSTRAP_RESULT_PATH)
  : path.resolve(root, '..', 'docs', 'BOOTSTRAP_RESULT.json');
const profile = readSeedProfile();
const demo = profile === 'demo';

/* ---------------------------------------------------------------- env */

// .env.local mengisi kunci yang belum ada di process.env (caller menang).
const envLocal = path.join(root, '.env.local');
if (fs.existsSync(envLocal)) {
  for (const line of fs.readFileSync(envLocal, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

/* ------------------------------------------------------------- helpers */

function runStep(name, args, timeoutMs) {
  const started = Date.now();
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return new Promise((resolve) => {
    // Node 22 menolak spawn file .cmd tanpa shell:true (EINVAL).
    // detached:true + stdio:'inherit' juga EINVAL di Windows — jangan dipakai.
    // taskkill /T /F di bawah tetap membunuh pohon proses tanpa detached.
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ name, command: `npm ${args.join(' ')}`, durationMs: Date.now() - started, ...result });
    };
    const timer = setTimeout(() => {
      if (process.platform === 'win32') {
        try { spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' }); } catch { /* already gone */ }
      } else {
        child.kill('SIGKILL');
      }
      finish({ ok: false, exitCode: 124, error: `TIMEOUT after ${timeoutMs}ms` });
    }, timeoutMs);
    child.on('error', (error) => finish({ ok: false, exitCode: -1, error: String(error) }));
    child.on('exit', (code, signal) =>
      finish({ ok: code === 0, exitCode: code ?? -1, ...(signal ? { signal } : {}) }),
    );
  });
}

/**
 * Qdrant adalah indeks TURUNAN. Bila SQLite tidak berisi dokumen sama sekali,
 * point lama hasil seed sebelumnya harus dibersihkan supaya tidak ada data
 * R&D yang tersisa di image produksi. Aman di VPS kosong (no-op bila Qdrant
 * mati / URL kosong) dan dicatat jujur bila gagal.
 */
async function clearQdrantPoints() {
  const mode = String(process.env.QDRANT_MODE ?? 'on').trim().toLowerCase();
  const url = String(process.env.QDRANT_URL ?? '').trim().replace(/\/$/, '');
  const alias = String(process.env.QDRANT_COLLECTION ?? 'td_chunks').trim() || 'td_chunks';
  const apiKey = String(process.env.QDRANT_API_KEY ?? '').trim();
  if (mode === 'off' || !url) {
    return { cleared: false, note: 'Pembersihan Qdrant dilewati (mode off / URL kosong).' };
  }
  try {
    const response = await fetch(
      `${url}/collections/${encodeURIComponent(alias)}/points/delete?wait=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'api-key': apiKey } : {}) },
        body: JSON.stringify({ filter: { must: [] } }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) {
      return { cleared: false, note: `Gagal membersihkan point Qdrant (HTTP ${response.status}); verifikasi tetap dilanjutkan.` };
    }
    return { cleared: true, note: 'Point Qdrant lama dihapus — tidak ada dokumen pada SEED_PROFILE=none.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { cleared: false, note: `Pembersihan Qdrant gagal (${message.slice(0, 120)}); FTS5 tetap dipakai.` };
  }
}

async function verifyQdrant(activeProfile) {
  const mode = String(process.env.QDRANT_MODE ?? 'on').trim().toLowerCase();
  const url = String(process.env.QDRANT_URL ?? '').trim().replace(/\/$/, '');
  const alias = String(process.env.QDRANT_COLLECTION ?? 'td_chunks').trim() || 'td_chunks';
  const apiKey = String(process.env.QDRANT_API_KEY ?? '').trim();
  const noDocuments = activeProfile === 'none';
  const base = {
    mode,
    collection: alias,
    configured: Boolean(url),
    points: null,
    status: 'unavailable',
    noDocuments,
    note: null,
  };
  if (mode === 'off') {
    return { ...base, status: 'disabled', note: 'QDRANT_MODE=off — aplikasi berjalan penuh di FTS5 (perilaku lama).' };
  }
  if (!url) {
    return { ...base, note: 'QDRANT_URL kosong — verifikasi dilewati; FTS5 tetap menjadi sumber jawaban.' };
  }
  try {
    const response = await fetch(`${url}/collections/${encodeURIComponent(alias)}/points/count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'api-key': apiKey } : {}) },
      body: JSON.stringify({ exact: true }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return { ...base, note: `Qdrant merespons HTTP ${response.status}; FTS5 dipakai sebagai fallback.` };
    }
    const payload = await response.json();
    const count = payload?.result?.count;
    if (typeof count !== 'number') {
      return { ...base, note: 'Respons count Qdrant tidak memiliki field result.count; tidak ada klaim sinkronisasi.' };
    }
    if (count > 0) {
      return { ...base, points: count, status: 'ok', note: 'Qdrant tersinkron (point count > 0).' };
    }
    if (noDocuments) {
      return {
        ...base,
        points: 0,
        status: 'ok',
        noDocuments: true,
        note: 'Tidak ada dokumen yang di-seed (SEED_PROFILE=none). Qdrant 0 point adalah keadaan awal yang benar, bukan kegagalan drain outbox.',
      };
    }
    return {
      ...base,
      points: 0,
      status: 'empty',
      note: 'Qdrant tersedia tetapi 0 point setelah reindex — drain outbox gagal; periksa qdrant_outbox.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      note: `Qdrant tidak dapat dihubungi (${message.slice(0, 160)}). Bootstrap sukses di FTS5; indeks Qdrant menyusul saat outbox dikuras.`,
    };
  }
}

function fts5Summary() {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
  const dbPath = path.join(dataDir, 'workspace', 'tanyadata.db');
  const base = { available: false, chunks: 0, ftsRows: 0, note: null };
  if (!fs.existsSync(dbPath)) {
    return { ...base, note: 'Workspace DB belum ada.' };
  }
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const chunks = db.prepare("SELECT COUNT(*) AS n FROM core_chunks WHERE level = 'child'").get().n;
    const ftsRows = db.prepare('SELECT COUNT(*) AS n FROM document_chunks_fts').get().n;
    return { available: true, chunks, ftsRows, note: 'FTS5 adalah sumber jawaban aktif.' };
  } catch (error) {
    return { ...base, note: `Gagal membaca workspace DB: ${String(error).slice(0, 160)}` };
  } finally {
    db?.close();
  }
}

function documentCount() {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
  const file = path.join(dataDir, 'generated', 'documents.json');
  if (!fs.existsSync(file)) return 0;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).documents?.length ?? 0;
  } catch {
    return 0;
  }
}

function writeJsonEverywhere(target, payload) {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, json, 'utf8');
  const mirror = path.resolve(root, 'docs', path.basename(target));
  if (path.resolve(mirror) !== path.resolve(target)) {
    fs.mkdirSync(path.dirname(mirror), { recursive: true });
    fs.writeFileSync(mirror, json, 'utf8');
  }
}

/* ------------------------------------------------------------------ main */

const steps = [];
const notes = [];
const startedAt = new Date().toISOString();

console.log(`=== bootstrap:production (SEED_PROFILE=${profile}) ===`);
steps.push(await runStep('db:init', ['run', 'db:init'], 5 * 60_000));
if (demo) {
  steps.push(await runStep('db:seed:kb-sop', ['run', 'db:seed:kb-sop'], 15 * 60_000));
} else {
  console.log('SKIP db:seed:kb-sop — SEED_PROFILE=none (tidak ada dokumen R&D di produksi).');
}
steps.push(await runStep('reindex:docs', ['run', 'reindex:docs'], 30 * 60_000));
steps.push(await runStep('check:seed', ['run', 'check:seed'], 5 * 60_000));

if (!demo) {
  const cleared = await clearQdrantPoints();
  if (cleared.note) notes.push(cleared.note);
}
const qdrant = await verifyQdrant(profile);
const fts5 = fts5Summary();
if (qdrant.note) notes.push(qdrant.note);
if (fts5.note) notes.push(`FTS5: ${fts5.note}`);
if (!demo) notes.push('SEED_PROFILE=none - produksi dimulai tanpa PDF KB-SOP, Perpres, dan transaksi dummy.');

const stepsOk = steps.every((s) => s.ok);
const success = stepsOk && qdrant.status !== 'empty';
const status = success ? 'PASS' : 'FAIL';
const finishedAt = new Date().toISOString();

const result = {
  generatedAt: startedAt,
  finishedAt,
  status,
  seedProfile: profile,
  noDocuments: !demo,
  steps,
  qdrant,
  fts5,
  env: {
    seedProfile: profile,
    qdrantMode: String(process.env.QDRANT_MODE ?? 'on'),
    retrievalMode: String(process.env.RETRIEVAL_MODE ?? 'hybrid'),
    embeddingProvider: String(process.env.EMBEDDING_PROVIDER ?? 'local'),
  },
  notes,
};

writeJsonEverywhere(resultPath, result);

// Bukti gabungan kedua profil. Mode lain dipertahankan apa adanya supaya
// `SEED_PROFILE_RESULT.json` selalu berisi none + demo setelah keduanya dijalankan.
const profileResultPath = path.join(path.dirname(resultPath), 'SEED_PROFILE_RESULT.json');
let profileResult = { version: 1, modes: {} };
if (fs.existsSync(profileResultPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(profileResultPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.modes && typeof parsed.modes === 'object') {
      profileResult = parsed;
    }
  } catch { /* tulis ulang dari nol */ }
}
profileResult.version = 1;
profileResult.updatedAt = finishedAt;
profileResult.modes[profile] = {
  status,
  seedProfile: profile,
  documents: documentCount(),
  noDocuments: !demo,
  qdrant: {
    status: qdrant.status,
    points: qdrant.points,
    noDocuments: qdrant.noDocuments ?? !demo,
    note: qdrant.note,
  },
  fts5: { chunks: fts5.chunks, ftsRows: fts5.ftsRows },
  steps: steps.map((s) => ({ name: s.name, ok: s.ok, exitCode: s.exitCode, durationMs: s.durationMs })),
  notes,
  finishedAt,
};
writeJsonEverywhere(profileResultPath, profileResult);

console.log(`\nSTATUS: ${status} — ditulis ke ${resultPath}`);
if (!stepsOk) {
  for (const s of steps.filter((x) => !x.ok)) {
    console.error(`FAIL ${s.name}: exit=${s.exitCode}${s.error ? ` ${s.error}` : ''}`);
  }
}
if (qdrant.status === 'empty') console.error('FAIL qdrant: 0 point setelah reindex.');

process.exit(success ? 0 : 1);
