#!/usr/bin/env node
/**
 * QA ONLY — ingest 3 transfer PDFs into a SEPARATE workspace via the real
 * production pipeline (lib/core/ingest.ts). No core source is edited.
 *
 * Run (via safe_exec.py, timeout 600):
 *   node tanyadata/scripts/qa-transfer-ingest.mjs
 *
 * Env:
 *   QA_TRANSFER_WS  optional override for the workspace directory
 *                   (default: <tmp>/opencode/tanyadata-transfer-ws)
 *
 * Output:
 *   <workspace>/qa-transfer-ingest-manifest.json
 *
 * HARD RULE: the *_qa.json files are NEVER read here. Corpus comes from PDF
 * bytes only. If a PDF has no text layer, the failure is recorded honestly —
 * there is NO gt_text_fallback reconstruction.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..');
const ws = path.resolve(process.env.QA_TRANSFER_WS
  || path.join(os.tmpdir(), 'opencode', 'tanyadata-transfer-ws'));

// Guard: only ever clear the dedicated QA transfer workspace.
const allowedParent = path.join(os.tmpdir(), 'opencode');
if (path.dirname(ws) !== allowedParent || !path.basename(ws).startsWith('tanyadata-transfer-ws')) {
  throw new Error(`Refusing to touch workspace outside ${allowedParent}: ${ws}`);
}
fs.rmSync(ws, { recursive: true, force: true });
const DATA_DIR = path.join(ws, 'data');
const KB_COPY = path.join(DATA_DIR, 'kb');
fs.mkdirSync(KB_COPY, { recursive: true });
fs.mkdirSync(ws, { recursive: true });

process.env.DATA_DIR = DATA_DIR;
process.env.WORKSPACE_DIR = ws;
process.env.LLM_MODE = 'off';
process.env.RETRIEVAL_MODE = 'fts5';
process.env.QDRANT_MODE = 'off';
process.env.EMBEDDING_PROVIDER = 'off';
delete process.env.LLM_API_KEY;
delete process.env.LLM_BASE_URL;

/* runtime-only syntax shim — identical to eval/bridge.mjs, NO source edit */
const ingestSourcePath = path.join(root, 'lib/core/ingest.ts');
const ingestPatchedPath = path.join(ws, 'ingest.runtime-patch.ts');
{
  const src = fs.readFileSync(ingestSourcePath, 'utf8');
  const needle = "await mark('indexing', () => {";
  const patched = src.includes(needle)
    ? src.replace(needle, "await mark('indexing', async () => {")
    : src;
  fs.writeFileSync(ingestPatchedPath, patched, 'utf8');
}
const runtimePatched = fs.readFileSync(ingestPatchedPath, 'utf8') !== fs.readFileSync(ingestSourcePath, 'utf8');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const abs = path.join(root, specifier.slice(2)) + '.ts';
      if (path.resolve(abs) === ingestSourcePath && runtimePatched) {
        return nextResolve(pathToFileURL(ingestPatchedPath).href, context);
      }
      return nextResolve(pathToFileURL(abs).href, context);
    }
    if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
      try { return nextResolve(specifier + '.ts', context); } catch { /* fall through */ }
    }
    return nextResolve(specifier, context);
  },
});

const Database = (await import(pathToFileURL(path.join(root, 'node_modules/better-sqlite3/lib/index.js')).href)).default;
const { CORE_SCHEMA_SQL, WORKSPACE_DB } = await import(pathToFileURL(path.join(root, 'lib/db/paths.ts')).href);
const { validateUpload, ingestIntoDataset } = await import(pathToFileURL(runtimePatched ? ingestPatchedPath : ingestSourcePath).href);
const { createDataset } = await import(pathToFileURL(path.join(root, 'lib/core/registry.ts')).href);
const { getDocumentProxy } = await import(pathToFileURL(path.join(root, 'node_modules/unpdf/dist/index.mjs')).href);
const { layoutAwarePdfTexts } = await import(pathToFileURL(path.join(root, 'lib/ingest/extract.ts')).href);

const TRANSFER_DIR = path.join(repoRoot, 'tanyadata', 'eval', 'transfer_set');
const DOCS = [
  { key: 'CUTI', pdf: 'kebijakan_cuti.pdf' },
  { key: 'TI', pdf: 'keamanan_ti.pdf' },
  { key: 'PD', pdf: 'pengadaan_barang.pdf' },
];

fs.mkdirSync(path.dirname(WORKSPACE_DB), { recursive: true });
const db = new Database(WORKSPACE_DB);
db.pragma('journal_mode = DELETE');
db.exec(fs.readFileSync(CORE_SCHEMA_SQL, 'utf8'));

const records = [];
try {
  for (const doc of DOCS) {
    const src = path.join(TRANSFER_DIR, doc.pdf);
    if (!fs.existsSync(src)) throw new Error(`PDF tidak ditemukan: ${src}`);
    const buffer = fs.readFileSync(src);
    fs.copyFileSync(src, path.join(KB_COPY, doc.pdf));

    // Text-layer probe with the SAME layout-aware extractor used by production.
    let textLayer = 'UNKNOWN';
    let pageStats = [];
    let layout = null;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const items = [];
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const content = await (await pdf.getPage(i)).getTextContent();
        items.push(content.items);
      }
      const pages = layoutAwarePdfTexts(items);
      pageStats = pages.map((p, i) => ({
        page: i + 1,
        chars: p.text.replace(/\s/g, '').length,
        columns: p.layout?.columns ?? null,
        readingOrder: p.layout?.readingOrder ?? null,
        tables: p.layout?.tables ?? null,
      }));
      layout = pages.map((p) => p.layout);
      textLayer = pageStats.every((p) => p.chars >= 40) ? 'YES' : 'PARTIAL_OR_NONE';
    } catch (err) {
      textLayer = `PROBE_ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }

    const validated = validateUpload({
      filename: doc.pdf, mime: 'application/pdf', size: buffer.length, buffer,
    });
    const dataset = createDataset(db, {
      name: doc.pdf.replace(/\.pdf$/i, ''), kind: 'document', source_type: 'pdf',
      doc_type: 'general', status: 'UPLOADED', size_bytes: buffer.length,
      sha256: validated.sha256,
    });
    let ingestMode = 'pdf';
    let ingestError = null;
    try {
      await ingestIntoDataset(db, {
        dataset, buffer, format: 'pdf', originalName: validated.originalName,
        storagePath: path.join(KB_COPY, doc.pdf),
      });
    } catch (err) {
      ingestMode = 'FAILED';
      ingestError = err instanceof Error ? err.message : String(err);
      // Deliberately NO fallback: transfer QA must never become corpus text.
    }
    const row = db.prepare('SELECT quality_report FROM core_datasets WHERE id = ?').get(dataset.id);
    let quality = {};
    try { quality = JSON.parse(row?.quality_report || '{}'); } catch { /* keep empty */ }
    const chunks = db.prepare('SELECT COUNT(*) AS n FROM core_chunks WHERE dataset_id = ?').get(dataset.id)?.n ?? 0;
    records.push({
      key: doc.key, pdf: doc.pdf, datasetId: dataset.id, sha256: validated.sha256,
      ingestMode, ingestError, chunkCount: chunks,
      textLayer, pageStats, layout,
      quality: {
        ocrUsed: quality.ocrUsed ?? null,
        ocrPages: quality.ocrPages ?? [],
        ocrStatuses: quality.ocrStatuses ?? [],
        issues: quality.issues ?? [],
      },
      gtFallbackUsed: false,
    });
    console.log(`[ingest] ${doc.key} ${doc.pdf}: mode=${ingestMode} chunks=${chunks} textLayer=${textLayer} ocrUsed=${quality.ocrUsed ?? 'n/a'}`);
  }
  db.close();
  const manifest = {
    generatedAt: new Date().toISOString(),
    role: 'qa', type: 'transfer_ingest_manifest',
    workspace: ws, workspaceDb: WORKSPACE_DB,
    runtimePatchApplied: runtimePatched,
    corpusSource: 'PDF bytes only — *_qa.json NOT read by this script',
    gtFallbackUsed: false,
    documents: records,
  };
  const out = path.join(ws, 'qa-transfer-ingest-manifest.json');
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`QA_TRANSFER_INGEST_OK docs=${records.length} out=${out}`);
  process.exit(0);
} catch (err) {
  db.close();
  console.error('QA_TRANSFER_INGEST_ERROR', err instanceof Error ? err.stack : String(err));
  process.exit(1);
}
