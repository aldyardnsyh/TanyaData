import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import Database from 'better-sqlite3';
import { readSeedProfile } from './lib/seed-profile.mjs';
import {
  backupSeedDb,
  countTransactions,
  createEmptySeedDb,
  resetWorkspaceDbInPlace,
  restoreSeedDbFromCsv,
} from './lib/seed-db.mjs';
import { extractAll, writeDocumentsJson, DOCUMENTS_JSON } from './lib/extract.mjs';

const root = process.cwd();
const profile = readSeedProfile();
const demo = profile === 'demo';

// lib/db/client.ts adalah satu-satunya tempat yang menjamin skema lengkap
// (schema.sql + migrate-v2 + core-schema.sql + ATTACH seed). Pakai itu, jangan
// duplikasi urutan migrasi di sini.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return nextResolve(pathToFileURL(path.join(root, specifier.slice(2)) + '.ts').href, context);
    }
    if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
      try { return nextResolve(specifier + '.ts', context); } catch { /* fall through */ }
    }
    return nextResolve(specifier, context);
  },
});
const { getWorkspaceDb } = await import(
  pathToFileURL(path.join(root, 'lib', 'db', 'client.ts')).href
);

const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const workspaceDir = path.resolve(
  process.env.WORKSPACE_DIR || path.join(dataDir, 'workspace'),
);
const seedDbPath = path.join(dataDir, 'analytics.db');
const seedBackupPath = `${seedDbPath}.rnd-backup`;
const structuredDir = path.join(dataDir, 'seed', 'structured');

console.log(`=== db:init (SEED_PROFILE=${profile}) ===`);

/* --------------------------------------------------- 1. analytics.db + manifest */

if (demo) {
  // Profil demo harus mandiri: kalau analytics.db kosong (misal setelah
  // bootstrap produksi), regenerate dari CSV R&D — bukan dari backup opsional.
  if (countTransactions(seedDbPath) === 0) {
    restoreSeedDbFromCsv(seedDbPath, structuredDir);
    console.log(`RESTORE analytics.db dari ${path.relative(root, structuredDir)}/*.csv`);
  }
  let docs = [];
  if (fs.existsSync(DOCUMENTS_JSON)) {
    try { docs = JSON.parse(fs.readFileSync(DOCUMENTS_JSON, 'utf8')).documents ?? []; } catch { /* regenerate */ }
  }
  if (!docs.length) {
    const payload = await extractAll();
    writeDocumentsJson(payload);
    console.log(`OK extract documents=${payload.documents.length}`);
  }
} else {
  // Jangan pernah membuang data R&D secara permanen. Backup sekali, lalu
  // analytics.db dibuat ulang dari DDL dengan 0 baris.
  const backedUp = backupSeedDb(seedDbPath, seedBackupPath);
  if (backedUp) console.log(`BACKUP seed R&D → ${path.relative(root, backedUp)}`);
  createEmptySeedDb(seedDbPath);
  writeDocumentsJson({
    version: 1,
    generatedAt: new Date().toISOString(),
    documents: [],
    warnings: ['SEED_PROFILE=none — produksi dimulai tanpa dokumen R&D.'],
  });
  console.log('OK analytics.db kosong (0 transaksi) + manifest dokumen kosong');

  // Workspace DB lokal (bila ada) mengandung 190 chunk R&D dari build
  // sebelumnya. Reset in-place sebelum getWorkspaceDb() membuat skema segar.
  resetWorkspaceDbInPlace(path.join(workspaceDir, 'tanyadata.db'));
  const uploadsDir = path.join(workspaceDir, 'uploads');
  if (fs.existsSync(uploadsDir)) {
    for (const entry of fs.readdirSync(uploadsDir)) {
      fs.rmSync(path.join(uploadsDir, entry), { recursive: true, force: true });
    }
  }
  console.log('OK workspace DB direset (0 chunk, 0 dokumen)');
}

/* --------------------------------------------------------- 2. bounds & workspace */

const seed = new Database(seedDbPath, { readonly: true, fileMustExist: true });
const bounds = seed
  .prepare(
    `SELECT COUNT(*) AS rows, MIN(transaction_date) AS minDate, MAX(transaction_date) AS maxDate
     FROM transactions`,
  )
  .get();
seed.close();

const rowCount = bounds?.rows ?? 0;
if (demo && !rowCount) {
  console.error('FAIL: profil demo tetapi tabel transactions kosong');
  process.exit(1);
}

const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const maxDate = bounds?.maxDate || today;
const start = `${maxDate.slice(0, 7)}-01`;
const nowIso = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19);

const db = getWorkspaceDb();
const setMeta = db.prepare(
  'INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);
setMeta.run('schema_version', '1');
setMeta.run('seeded_at', nowIso);
setMeta.run('seed_profile', profile);

const docs = JSON.parse(fs.readFileSync(DOCUMENTS_JSON, 'utf8'));
const settings = {
  profile: { name: 'Rani Prameswari', role: 'Operations Analyst' },
  lang: 'id',
  dateRange: { start, end: maxDate, preset: 'this_month' },
  // Produksi kosong tidak punya dataset 'seed'; jangan arahkan UI ke entitas
  // yang tidak ada. Frontend seharusnya menampilkan empty state / upload.
  activeDatasetId: demo ? 'seed' : '',
  preferences: { chartDefault: 'bar', denseTables: false },
  updatedAt: `${nowIso}+07:00`,
};
db.prepare(
  'INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
).run('app', JSON.stringify(settings), `${nowIso}+07:00`);

if (demo) {
  db.prepare(
    `INSERT INTO data_sources
       (id, kind, name, original_name, format, mime, size_bytes, status, row_count,
        chunk_count, error, storage_path, meta_json, created_at, updated_at)
     VALUES ('seed','dataset','analytics.db - Transaksi','analytics.db','seed-dataset','application/vnd.sqlite3',0,'READY',?,NULL,NULL,'analytics.db',?,?,?)
     ON CONFLICT(id) DO UPDATE SET row_count=excluded.row_count, meta_json=excluded.meta_json, updated_at=excluded.updated_at`,
  ).run(
    rowCount,
    JSON.stringify({ tables: 5, minDate: bounds.minDate, maxDate: bounds.maxDate }),
    `${nowIso}+07:00`,
    `${nowIso}+07:00`,
  );
}

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);
db.close();

console.log(`OK workspace=${path.relative(root, path.join(workspaceDir, 'tanyadata.db'))}`);
console.log(`   seed rows=${rowCount} range=${bounds?.minDate ?? '-'}..${bounds?.maxDate ?? '-'}`);
console.log(`   tables=${tables.length} [${tables.join(', ')}]`);
console.log(`   documents=${docs.documents.length} (diindeks ke FTS saat aplikasi pertama start)`);
console.log('NEXT npm run check:seed');
