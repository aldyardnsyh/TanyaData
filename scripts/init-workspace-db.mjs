import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { extractAll, writeDocumentsJson, DOCUMENTS_JSON } from './lib/extract.mjs';

const root = process.cwd();
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const workspaceDir = path.resolve(
  process.env.WORKSPACE_DIR || path.join(dataDir, 'workspace'),
);
const workspaceDbPath = path.join(workspaceDir, 'tanyadata.db');
const seedDbPath = path.join(dataDir, 'analytics.db');
const schemaPath = path.join(root, 'lib', 'db', 'schema.sql');

if (!fs.existsSync(seedDbPath)) {
  console.error(`FAIL: seed DB tidak ditemukan di ${seedDbPath}`);
  process.exit(1);
}

fs.mkdirSync(workspaceDir, { recursive: true });
fs.mkdirSync(path.join(workspaceDir, 'uploads'), { recursive: true });

if (!fs.existsSync(DOCUMENTS_JSON)) {
  console.log('INFO: documents.json belum ada, mengekstrak dokumen...');
  const payload = await extractAll();
  writeDocumentsJson(payload);
  console.log(`OK extract documents=${payload.documents.length}`);
}

const seed = new Database(seedDbPath, { readonly: true });
const bounds = seed
  .prepare(
    `SELECT COUNT(*) AS rows, MIN(transaction_date) AS minDate, MAX(transaction_date) AS maxDate
     FROM transactions`,
  )
  .get();
seed.close();

if (!bounds?.rows) {
  console.error('FAIL: tabel transactions kosong');
  process.exit(1);
}

const maxDate = bounds.maxDate;
const start = `${maxDate.slice(0, 7)}-01`;
const nowIso = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19);

const db = new Database(workspaceDbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

const setMeta = db.prepare(
  'INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);
setMeta.run('schema_version', '1');
setMeta.run('seeded_at', nowIso);

const settings = {
  profile: { name: 'Rani Prameswari', role: 'Operations Analyst' },
  lang: 'id',
  dateRange: { start, end: maxDate, preset: 'this_month' },
  activeDatasetId: 'seed',
  preferences: { chartDefault: 'bar', denseTables: false },
  updatedAt: `${nowIso}+07:00`,
};
db.prepare(
  'INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
).run('app', JSON.stringify(settings), `${nowIso}+07:00`);

db.prepare(
  `INSERT INTO data_sources
     (id, kind, name, original_name, format, mime, size_bytes, status, row_count,
      chunk_count, error, storage_path, meta_json, created_at, updated_at)
   VALUES ('seed','dataset','analytics.db - Transaksi','analytics.db','seed-dataset','application/vnd.sqlite3',0,'READY',?,NULL,NULL,'analytics.db',?,?,?)
   ON CONFLICT(id) DO UPDATE SET row_count=excluded.row_count, meta_json=excluded.meta_json, updated_at=excluded.updated_at`,
).run(
  bounds.rows,
  JSON.stringify({ tables: 5, minDate: bounds.minDate, maxDate: bounds.maxDate }),
  `${nowIso}+07:00`,
  `${nowIso}+07:00`,
);

const docs = JSON.parse(fs.readFileSync(DOCUMENTS_JSON, 'utf8'));
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);

db.close();

console.log(`OK workspace=${path.relative(root, workspaceDbPath)}`);
console.log(`   seed rows=${bounds.rows} range=${bounds.minDate}..${bounds.maxDate}`);
console.log(`   tables=${tables.length} [${tables.join(', ')}]`);
console.log(`   documents=${docs.documents.length} (diindeks ke FTS saat aplikasi pertama start)`);
console.log('NEXT npm run check:seed');
