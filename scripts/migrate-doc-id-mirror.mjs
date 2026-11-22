/**
 * One-off idempotent migration (C2 follow-up): mirror rows created before the
 * document_id = source.id fix still carry the `doc_` prefix, which makes the
 * FR-C.1 scope gate reject every citation as EVIDENCE_LEAK. Renames
 * core_documents.id and core_chunks.document_id to the dataset (source) id.
 */
import Database from 'better-sqlite3';

const db = new Database('data/workspace/tanyadata.db');
db.pragma('foreign_keys = OFF');
const run = db.transaction(() => {
  const docs = db
    .prepare("SELECT id, dataset_id FROM core_documents WHERE id = 'doc_' || dataset_id")
    .all();
  for (const d of docs) {
    db.prepare('UPDATE core_documents SET id = ? WHERE id = ?').run(d.dataset_id, d.id);
  }
  const chunks = db
    .prepare("SELECT DISTINCT document_id, dataset_id FROM core_chunks WHERE document_id = 'doc_' || dataset_id")
    .all();
  for (const c of chunks) {
    db.prepare('UPDATE core_chunks SET document_id = ? WHERE document_id = ?').run(c.dataset_id, c.document_id);
  }
  return { documents: docs.length, chunks: chunks.length };
});
const result = run();
db.pragma('foreign_keys = ON');
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log('migrated:', JSON.stringify(result));
