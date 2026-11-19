import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const seedDbPath = path.join(dataDir, 'analytics.db');
const workspaceDir = path.resolve(process.env.WORKSPACE_DIR || path.join(dataDir, 'workspace'));
const workspaceDbPath = path.join(workspaceDir, 'tanyadata.db');
const documentsPath = path.join(dataDir, 'generated', 'documents.json');

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

const seed = new Database(seedDbPath, { readonly: true });
const totals = seed
  .prepare(
    `SELECT COUNT(*) AS rows,
            MIN(transaction_date) AS minDate,
            MAX(transaction_date) AS maxDate,
            SUM(CASE WHEN transaction_date >= '2026-11-01' THEN 1 ELSE 0 END) AS novRows
     FROM transactions`,
  )
  .get();
const statuses = seed
  .prepare(
    `SELECT status, COUNT(*) AS n FROM transactions WHERE transaction_date >= '2026-11-01' GROUP BY status`,
  )
  .all();
const novValue = seed
  .prepare(
    `SELECT COALESCE(SUM(amount), 0) AS value FROM transactions
     WHERE transaction_date >= '2026-11-01' AND status = 'SUCCESS'`,
  )
  .get();
const channels = seed.prepare('SELECT COUNT(*) AS n FROM channels').get();
const failureCodes = seed.prepare('SELECT COUNT(*) AS n FROM failure_codes').get();
const incidents = seed.prepare('SELECT COUNT(*) AS n FROM incident_log').get();

console.log('--- Seed DB ---');
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
seed.close();

console.log('--- Documents ---');
if (!fs.existsSync(documentsPath)) {
  failures += 1;
  console.log('FAIL documents.json belum ada (jalankan npm run db:extract)');
} else {
  const docs = JSON.parse(fs.readFileSync(documentsPath, 'utf8'));
  const sections = docs.documents.reduce((sum, d) => sum + d.sections.length, 0);
  check('documents', docs.documents.length, 6);
  console.log(`INFO sections=${sections}`);
}

console.log('--- Workspace ---');
if (!fs.existsSync(workspaceDbPath)) {
  console.log('INFO workspace DB belum ada (jalankan npm run db:init)');
} else {
  const db = new Database(workspaceDbPath, { readonly: true });
  const sources = db.prepare("SELECT kind, status, COUNT(*) AS n FROM data_sources GROUP BY kind, status").all();
  const chunks = db.prepare('SELECT COUNT(*) AS n FROM document_chunks').get();
  const fts = db.prepare('SELECT COUNT(*) AS n FROM document_chunks_fts').get();
  const conversations = db.prepare('SELECT COUNT(*) AS n FROM conversations').get();
  for (const row of sources) console.log(`INFO source ${row.kind}/${row.status}=${row.n}`);
  console.log(`INFO chunks=${chunks.n} fts=${fts.n} conversations=${conversations.n}`);
  if (chunks.n > 0 && fts.n !== chunks.n) {
    failures += 1;
    console.log('FAIL FTS tidak sinkron dengan document_chunks');
  }
  db.close();
}

if (failures > 0) {
  console.error(`\nHASIL: FAIL (${failures} masalah)`);
  process.exit(1);
}
console.log('\nHASIL: PASS');
