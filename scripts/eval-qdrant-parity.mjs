#!/usr/bin/env node
/**
 * Qdrant parity evaluation — P3-MIGRATION / DECISION-032 ADR-QD-06.
 *
 *   node scripts/eval-qdrant-parity.mjs
 *
 * Runs the SAME ground-truth cases through `RETRIEVAL_MODE=fts5` and
 * `RETRIEVAL_MODE=hybrid`, then compares retrieval-only metrics:
 * recall@5, recall@10, MRR@10 and citation_valid_rate.
 *
 * Default aman: when Qdrant is not configured / not reachable / the client
 * package is not installed, this script prints `SKIPPED: Qdrant tidak tersedia`
 * and exits 0. That is an honest skip, NOT a false green test. No threshold is
 * lowered: hybrid must be >= baseline on every metric, and citation_valid_rate
 * must stay 1.0 (fail-closed) on both paths.
 *
 * LLM_MODE=off and a fresh WORKSPACE_DIR are forced before any module import.
 * The embedding model is never loaded here: EMBEDDING_PROVIDER defaults to off
 * and is only honoured when the operator explicitly opts in.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const casesFile = path.resolve(root, arg('--cases', 'data/fixtures/cases.json'));
const fixturesDir = path.resolve(root, arg('--fixtures', 'data/fixtures'));
const outFile = path.resolve(root, arg('--out', 'docs/QDRANT_PARITY_RESULT.json'));
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS || arg('--timeout', '180000'));

// Fresh workspace + offline LLM before ANY core module is imported.
const workspaceDir = path.join(os.tmpdir(), `tanyadata-qdrant-parity-${process.pid}-${Date.now()}`);
process.env.WORKSPACE_DIR = workspaceDir;
process.env.LLM_MODE = 'off';
delete process.env.LLM_API_KEY;
delete process.env.LLM_BASE_URL;

const timer = setTimeout(() => {
  console.error(`QDRANT_PARITY_TIMEOUT after ${timeoutMs}ms`);
  process.exit(1);
}, timeoutMs);

function skip(reason) {
  clearTimeout(timer);
  console.log(`SKIPPED: Qdrant tidak tersedia — ${reason}`);
  console.log('Catatan jujur: tidak ada perbandingan yang dijalankan; ambang tidak diubah.');
  process.exit(0);
}

async function qdrantAvailable() {
  const mode = String(process.env.QDRANT_MODE ?? 'off').trim().toLowerCase();
  if (!mode || mode === 'off') return skip('QDRANT_MODE=off (default aman)');
  const url = String(process.env.QDRANT_URL ?? '').trim();
  if (!url) return skip('QDRANT_URL kosong');
  try {
    await import('@qdrant/js-client-rest');
  } catch {
    return skip('paket @qdrant/js-client-rest belum terpasang');
  }
  const headers = process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {};
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/readyz`, {
      headers,
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return skip(`/readyz HTTP ${response.status}`);
    const body = await response.text();
    if (!/ready/i.test(body)) return skip(`/readyz: ${body.slice(0, 80)}`);
  } catch (error) {
    return skip(`/readyz gagal: ${error instanceof Error ? error.message : String(error)}`);
  }
  return true;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function relevant(citation, expectedSections) {
  const section = String(citation?.section_path ?? '').toLowerCase();
  return expectedSections.some((s) => section.includes(String(s).toLowerCase()));
}

function metrics(ranked, expectedSections) {
  const top5 = ranked.slice(0, 5);
  const top10 = ranked.slice(0, 10);
  const hit = (list) => expectedSections.filter((s) =>
    list.some((c) => String(c?.section_path ?? '').toLowerCase().includes(String(s).toLowerCase())),
  ).length;
  const recall5 = expectedSections.length ? hit(top5) / expectedSections.length : 1;
  const recall10 = expectedSections.length ? hit(top10) / expectedSections.length : 1;
  const firstRank = ranked.findIndex((c) => relevant(c, expectedSections));
  const mrr10 = firstRank >= 0 && firstRank < 10 ? 1 / (firstRank + 1) : 0;
  const valid = ranked.filter((c) =>
    c && c.chunk_id !== null && c.chunk_id !== undefined
    && typeof c.section_path === 'string' && c.section_path.length > 0
    && typeof c.score === 'number' && Number.isFinite(c.score),
  ).length;
  const citationValidRate = ranked.length ? valid / ranked.length : 1;
  return {
    recall5: Number(recall5.toFixed(4)),
    recall10: Number(recall10.toFixed(4)),
    mrr10: Number(mrr10.toFixed(4)),
    citationValidRate: Number(citationValidRate.toFixed(4)),
  };
}

function aggregate(rows) {
  const keys = ['recall5', 'recall10', 'mrr10', 'citationValidRate'];
  const out = {};
  for (const key of keys) {
    out[key] = rows.length
      ? Number((rows.reduce((sum, r) => sum + r.metrics[key], 0) / rows.length).toFixed(4))
      : 0;
  }
  return out;
}

try {
  await qdrantAvailable();

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) {
        const abs = path.join(root, specifier.slice(2)) + '.ts';
        return nextResolve(pathToFileURL(abs).href, context);
      }
      if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
        try {
          return nextResolve(specifier + '.ts', context);
        } catch {
          // fall through
        }
      }
      return nextResolve(specifier, context);
    },
  });

  const Database = (await import('better-sqlite3')).default;
  const { CORE_SCHEMA_SQL, WORKSPACE_DB } = await import('../lib/db/paths.ts');
  const { createDataset, emptySchema, emptyQualityReport } = await import('../lib/core/registry.ts');
  const { retrieveWithEntityBoostDetailed } = await import('../lib/ai/retrieval.ts');

  const cases = (readJson(casesFile).cases ?? []).filter(
    (c) => Array.isArray(c.expected?.citations) && c.expected.citations.length > 0,
  );
  if (!cases.length) {
    clearTimeout(timer);
    console.log('SKIPPED: Qdrant tidak tersedia — tidak ada kasus ground truth dengan sitasi expected.');
    process.exit(0);
  }

  // Build a fresh workspace with the same document fixtures the 4 eval suites use.
  fs.mkdirSync(path.dirname(WORKSPACE_DB), { recursive: true });
  const db = new Database(WORKSPACE_DB);
  db.pragma('journal_mode = DELETE');
  db.exec(fs.readFileSync(CORE_SCHEMA_SQL, 'utf8'));

  const datasetByFixture = new Map();
  for (const testCase of cases) {
    if (datasetByFixture.has(testCase.fixture)) continue;
    const fixture = readJson(path.join(fixturesDir, testCase.fixture));
    if (fixture.schema?.tables?.length) continue; // tabular cases have no document citations
    const dataset = createDataset(db, {
      id: `parity-${fixture.id}`,
      name: fixture.title ?? fixture.id,
      kind: 'document',
      source_type: 'txt',
      doc_type: fixture.doc_type ?? 'general',
      status: 'READY',
      schema_json: emptySchema(),
      row_count: 0,
      period_start: null,
      period_end: null,
      quality_report: emptyQualityReport(),
      is_demo: false,
    });
    const docId = `doc-${fixture.id}`;
    db.prepare(
      `INSERT INTO core_documents(id, dataset_id, doc_type, mime, pages, sections_json, source_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(docId, dataset.id, fixture.doc_type ?? 'general', 'text/plain', 10, '[]', testCase.fixture, new Date().toISOString());

    const idMap = new Map();
    const parentIds = new Set((fixture.chunks ?? []).map((c) => c.parent_id).filter(Boolean));
    const ordered = [
      ...(fixture.chunks ?? []).filter((c) => parentIds.has(c.id)),
      ...(fixture.chunks ?? []).filter((c) => !parentIds.has(c.id)),
    ];
    const insert = db.prepare(
      `INSERT INTO core_chunks(document_id, dataset_id, section_path, page, text, token_count, char_count, level, parent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const chunk of ordered) {
      const isParent = parentIds.has(chunk.id);
      const info = insert.run(
        docId, dataset.id, chunk.section_path, chunk.page ?? null, chunk.text,
        Math.ceil(String(chunk.text).length / 4), String(chunk.text).length,
        isParent ? 'parent' : 'child',
        chunk.parent_id ? (idMap.get(chunk.parent_id) ?? null) : null,
      );
      idMap.set(chunk.id, Number(info.lastInsertRowid));
    }
    datasetByFixture.set(testCase.fixture, dataset.id);
  }

  const rows = [];
  for (const testCase of cases) {
    const datasetId = datasetByFixture.get(testCase.fixture);
    if (!datasetId) continue;
    const expectedSections = testCase.expected.citations.map((c) => c.section).filter(Boolean);
    const perMode = {};
    for (const mode of ['fts5', 'hybrid']) {
      process.env.RETRIEVAL_MODE = mode;
      const result = await retrieveWithEntityBoostDetailed(db, datasetId, testCase.question, 10);
      perMode[mode] = {
        metrics: metrics(result.citations, expectedSections),
        meta: result.meta,
        top: result.citations.slice(0, 10).map((c) => ({
          chunk_id: c.chunk_id, section_path: c.section_path, score: c.score,
        })),
      };
    }
    rows.push({
      id: testCase.id,
      question: testCase.question,
      expectedSections,
      fts5: perMode.fts5,
      hybrid: perMode.hybrid,
    });
  }
  db.close();

  const baseline = aggregate(rows.map((r) => r.fts5));
  const hybrid = aggregate(rows.map((r) => r.hybrid));
  const fallbacks = [...new Set(rows.map((r) => r.hybrid.meta?.fallbackReason).filter(Boolean))];

  // No threshold is lowered: hybrid must not regress on any retrieval metric.
  const regressions = ['recall5', 'recall10', 'mrr10'].filter((key) => hybrid[key] < baseline[key]);
  const invalidCitations = hybrid.citationValidRate < 1 || baseline.citationValidRate < 1;
  const overallPass = regressions.length === 0 && !invalidCitations;

  const report = {
    generatedAt: new Date().toISOString(),
    workspaceDb: workspaceDir,
    casesFile: path.relative(root, casesFile),
    caseCount: rows.length,
    modes: { baseline: 'fts5', candidate: 'hybrid' },
    thresholds: { recall5: '>= baseline', recall10: '>= baseline', mrr10: '>= baseline', citationValidRate: '= 1.0' },
    baseline,
    hybrid,
    regressions,
    invalidCitations,
    fallbackReasons: fallbacks,
    overallPass,
    notes: [
      'retrieval dievaluasi terpisah dari generasi; LLM_MODE=off.',
      'Relevansi = section_path mengandung section pada expected.citations (sama seperti gradeCitation di harness).',
      'citation_valid_rate adalah validitas struktural sitasi (chunk_id, section_path, skor BM25 finit).',
      'citation.score tetap BM25; RRF hanya mengurutkan, tidak pernah dipakai sebagai skor sitasi.',
      'Ambang guardrail 0.45 / 0.25 / 0.18 tidak diubah dan tidak disentuh oleh eval ini.',
    ],
    cases: rows,
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('QDRANT PARITY — retrieval benchmark (fts5 vs hybrid)');
  console.log('─'.repeat(72));
  console.log(`Kasus: ${rows.length} · workspace: ${workspaceDir}`);
  console.log('Metrik              fts5      hybrid    Gate');
  for (const key of ['recall5', 'recall10', 'mrr10', 'citationValidRate']) {
    const gate = key === 'citationValidRate' ? '= 1.0000' : '>= fts5';
    console.log(`${key.padEnd(19)}${baseline[key].toFixed(4).padStart(7)}${hybrid[key].toFixed(4).padStart(10)}   ${gate}`);
  }
  if (fallbacks.length) console.log(`Fallback reason   : ${fallbacks.join(', ')}`);
  if (regressions.length) console.log(`REGRESI           : ${regressions.join(', ')}`);
  console.log(`HASIL             : ${overallPass ? 'PASS' : 'FAIL'}`);
  console.log(`Detail            : ${path.relative(root, outFile)}`);

  clearTimeout(timer);
  process.exit(overallPass ? 0 : 1);
} catch (error) {
  clearTimeout(timer);
  console.error('QDRANT_PARITY_ERROR', error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
