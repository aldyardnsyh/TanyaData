import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readSeedProfile } from './lib/seed-profile.mjs';

const root = process.cwd();
const profile = readSeedProfile();
const demo = profile === 'demo';

const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const seedDbPath = path.join(dataDir, 'analytics.db');
const workspaceDir = path.resolve(process.env.WORKSPACE_DIR || path.join(dataDir, 'workspace'));
const workspaceDbPath = path.join(workspaceDir, 'tanyadata.db');
const documentsPath = path.join(dataDir, 'generated', 'documents.json');

// Skema minimal yang harus ada di workspace DB produksi maupun demo.
const REQUIRED_TABLES = [
  'app_meta', 'settings', 'conversations', 'messages', 'reports', 'investigations',
  'data_sources', 'dataset_columns', 'dataset_samples', 'document_chunks',
  'document_chunks_fts', 'ingestion_jobs', 'query_log',
  'core_datasets', 'core_schema_columns', 'core_documents', 'core_chunks',
  'core_chunks_fts', 'core_queries', 'core_citations', 'core_evaluations',
  'core_ingestion_steps', 'core_attachments', 'core_readjustment_ops',
  'core_report_jobs', 'core_share_snapshots', 'core_citation_deeplinks',
  'qdrant_outbox', 'qdrant_pending_deletes',
];

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (harus ${expected})`}`);
};

if (!fs.existsSync(seedDbPath)) {
  console.error(`FAIL seed DB tidak ditemukan: ${seedDbPath}`);
  process.exit(1);
}

const seed = new Database(seedDbPath, { readonly: true, fileMustExist: true });
const totals = seed
  .prepare(
    `SELECT COUNT(*) AS rows,
            MIN(transaction_date) AS minDate,
            MAX(transaction_date) AS maxDate,
            SUM(CASE WHEN transaction_date >= '2026-11-01' THEN 1 ELSE 0 END) AS novRows
     FROM transactions`,
  )
  .get();
const channels = seed.prepare('SELECT COUNT(*) AS n FROM channels').get();
const failureCodes = seed.prepare('SELECT COUNT(*) AS n FROM failure_codes').get();
const incidents = seed.prepare('SELECT COUNT(*) AS n FROM incident_log').get();

console.log(`--- Seed DB (SEED_PROFILE=${profile}) ---`);
if (demo) {
  const statuses = seed
    .prepare('SELECT status, COUNT(*) AS n FROM transactions WHERE transaction_date >= \'2026-11-01\' GROUP BY status')
    .all();
  const novValue = seed
    .prepare('SELECT COALESCE(SUM(amount), 0) AS value FROM transactions WHERE transaction_date >= \'2026-11-01\' AND status = \'SUCCESS\'')
    .get();
  check('seed rows', totals.rows, 46952);
  check('seed minDate', totals.minDate, '2026-08-01');
  check('seed maxDate', totals.maxDate, '2026-11-18');
  check('Nov 2026 rows', totals.novRows, 8125);
  check('Nov SUCCESS value', novValue.value, 4389541500);
  check('channels', channels.n, 10);
  check('failure codes', failureCodes.n, 12);
  check('incidents', incidents.n, 7);
  const statusMap = Object.fromEntries(statuses.map((r) => [r.status, r.n]));
  check('Nov SUCCESS rows', statusMap.SUCCESS ?? 0, 7537);
  check('Nov FAILED rows', statusMap.FAILED ?? 0, 399);
  check('Nov PENDING rows', statusMap.PENDING ?? 0, 35);
  check('Nov EXPIRED rows', statusMap.EXPIRED ?? 0, 90);
  check('Nov REFUNDED rows', statusMap.REFUNDED ?? 0, 64);
} else {
  check('seed rows', totals.rows, 0);
  check('seed minDate', totals.minDate, null);
  check('seed maxDate', totals.maxDate, null);
  check('channels', channels.n, 0);
  check('failure codes', failureCodes.n, 0);
  check('incidents', incidents.n, 0);
}
seed.close();

console.log('--- Documents ---');
if (!fs.existsSync(documentsPath)) {
  failures += 1;
  console.log('FAIL documents.json belum ada (jalankan npm run db:init)');
} else {
  const docs = JSON.parse(fs.readFileSync(documentsPath, 'utf8'));
  const sections = docs.documents.reduce((sum, d) => sum + d.sections.length, 0);
  check('no GT transcript in corpus', docs.documents.filter((d) => d.ingestMode === 'gt_transcript').length, 0);
  if (demo) {
    // 6 seed existing + 4 kb-sop + 1 fixture eval:extraction-gt (DECISION-033).
    check('documents', docs.documents.length, 11);
    check('kb-sop documents', docs.documents.filter((d) => d.dataset === 'kb-sop').length, 4);
    // KB01/KB04 adalah PDF image-only. Mode jujurnya bergantung pada OCR env:
    // `ocr_unavailable` bila OCR mati, `pdf_ocr` bila endpoint tersedia.
    // Keduanya bukan gt_transcript — itu yang benar-benar dilarang.
    const imageOnlyIds = ['kb-01-penanganan-tiket-layanan', 'kb-04-eskalasi-dan-insiden'];
    const imageOnly = docs.documents.filter((d) => imageOnlyIds.includes(d.id));
    check('KB image-only documents', imageOnly.length, 2);
    check(
      'KB image-only honest ingestMode',
      imageOnly.filter((d) => d.ingestMode === 'ocr_unavailable' || d.ingestMode === 'pdf_ocr').length,
      2,
    );
    check('extraction-gt fixture', docs.documents.filter((d) => d.id === '6a30b004').length, 1);
  } else {
    check('documents', docs.documents.length, 0);
    check('kb-sop documents', docs.documents.filter((d) => d.dataset === 'kb-sop').length, 0);
    check('Perpres fixture', docs.documents.filter((d) => d.id === '6a30b004').length, 0);
  }
  console.log(`INFO sections=${sections}`);
}

console.log('--- Workspace ---');
if (!fs.existsSync(workspaceDbPath)) {
  failures += 1;
  console.log('FAIL workspace DB belum ada (jalankan npm run db:init)');
} else {
  const db = new Database(workspaceDbPath, { readonly: true, fileMustExist: true });
  const present = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map((r) => r.name),
  );
  const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
  check('schema tables complete', missing.length, 0);
  if (missing.length) console.log(`INFO missing tables: ${missing.join(', ')}`);

  const sources = db.prepare("SELECT kind, status, COUNT(*) AS n FROM data_sources GROUP BY kind, status").all();
  const chunks = db.prepare('SELECT COUNT(*) AS n FROM document_chunks').get();
  const fts = db.prepare('SELECT COUNT(*) AS n FROM document_chunks_fts').get();
  const conversations = db.prepare('SELECT COUNT(*) AS n FROM conversations').get();
  const seedProfile = db.prepare("SELECT value FROM app_meta WHERE key = 'seed_profile'").get()?.value ?? null;
  for (const row of sources) console.log(`INFO source ${row.kind}/${row.status}=${row.n}`);
  console.log(`INFO chunks=${chunks.n} fts=${fts.n} conversations=${conversations.n}`);
  check('app_meta.seed_profile', seedProfile, profile);

  if (demo) {
    if (chunks.n > 0 && fts.n !== chunks.n) {
      failures += 1;
      console.log('FAIL FTS tidak sinkron dengan document_chunks');
    }
  } else {
    check('document chunks', chunks.n, 0);
    check('FTS rows', fts.n, 0);
    check('document sources', db.prepare("SELECT COUNT(*) AS n FROM data_sources WHERE kind = 'document'").get().n, 0);
  }
  db.close();
}

if (failures > 0) {
  console.error(`\nHASIL: FAIL (${failures} masalah)`);
  process.exit(1);
}
console.log('\nHASIL: PASS');
