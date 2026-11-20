#!/usr/bin/env node
/**
 * Blind hold-out evaluation — SATU perintah, SATU hasil.
 *
 *   node scripts/eval-holdout.mjs --non-interactive
 *
 * Menjalankan pipeline PRODUKSI yang sama persis (chunker → index → retrieval
 * → guardrail → answer) pada dokumen SOP layanan yang tidak dipakai kalibrasi.
 * Tidak ada tuning khusus SOP. Detail lengkap → docs/HOLDOUT_RESULT.json.
 * Exit 0 hanya bila semua ambang terpenuhi; kegagalan sengaja tidak dihijaukan.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { evaluateHoldoutGate } from './lib/holdout-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const fixturesDir = path.resolve(root, arg('--fixtures', 'data/fixtures'));
const casesFile = path.resolve(root, arg('--cases', 'data/fixtures/sop-layanan/cases.json'));
const outFile = path.resolve(root, arg('--out', 'docs/HOLDOUT_RESULT.json'));
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS || arg('--timeout', '300000'));

// Workspace segar sebelum modul core membaca WORKSPACE_DB saat import.
const workspaceDir = path.join(os.tmpdir(), `tanyadata-holdout-${process.pid}-${Date.now()}`);
process.env.WORKSPACE_DIR = workspaceDir;
process.env.LLM_MODE = 'off';
delete process.env.LLM_API_KEY;
delete process.env.LLM_BASE_URL;

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

function fmt(value) {
  return typeof value === 'number' ? value.toFixed(4) : String(value);
}

const timer = setTimeout(() => {
  console.error(`HOLDOUT_TIMEOUT after ${timeoutMs}ms`);
  process.exit(1);
}, timeoutMs);

try {
  const { runHoldoutEval, perpresLikeBaseline } = await import('../lib/eval/holdout.ts');
  const report = await runHoldoutEval({ fixturesDir, casesFile });

  // ADR-OF-15 — gate sejenis memakai helper backend (pure, fail-closed).
  // `report.overallPass` dari modul eval hanya menutup allow-list hallucination;
  // di sini digabung dengan gate answerable/refusal/delta.
  const gate = evaluateHoldoutGate({
    perpres: perpresLikeBaseline(),
    holdout: report.metrics,
  });
  report.delta = {
    answerable: gate.deltaAnswerable,
    refusal: gate.deltaRefusal,
  };
  report.gate = gate;
  report.overallPass = gate.overallPass && report.metrics.hallucination_rate <= report.thresholds.hallucination;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('BLIND HOLD-OUT — SOP layanan (bukan Perpres 76)');
  console.log('─'.repeat(78));
  console.log(`Dokumen : ${report.documentFile} · ${report.documentChars} char · ${report.chunkCount} chunk · SHA-256 ${report.documentSha256.slice(0, 12)}…`);
  console.log('Pipeline:');
  for (const p of report.pipeline) console.log(`  • ${p}`);
  console.log('─'.repeat(78));
  console.log('ID      KIND        HASIL  DETAIL');
  for (const c of report.cases) {
    console.log(`${c.id.padEnd(8)}${c.kind.padEnd(12)}${(c.pass ? 'PASS' : 'FAIL').padEnd(7)}${c.detail}`);
  }
  console.log('─'.repeat(78));
  console.log(`Answerable accuracy : ${fmt(report.metrics.answerable_accuracy)}  (ambang ≥ ${fmt(report.thresholds.answerable)})`);
  console.log(`Refusal accuracy    : ${fmt(report.metrics.refusal_accuracy)}  (ambang ≥ ${fmt(report.thresholds.refusal)})`);
  console.log(`Hallucination rate  : ${fmt(report.metrics.hallucination_rate)}  (ambang ≤ ${fmt(report.thresholds.hallucination)})`);
  console.log(`Overall accuracy    : ${fmt(report.metrics.overall_accuracy)}  (${report.passed}/${report.total})`);
  console.log(`Baseline sejenis    : answerable ${fmt(report.baseline.answerable_accuracy)} · refusal ${fmt(report.baseline.refusal_accuracy)}  [${report.baseline.source}]`);
  console.log(`Delta (Perpres−hold): answerable ${fmt(report.delta.answerable)} · refusal ${fmt(report.delta.refusal)}  (ambang ≤ ${fmt(report.thresholds.delta)})`);
  if (report.gate.reasons.length) console.log(`Gate reasons        : ${report.gate.reasons.join(' | ')}`);
  console.log(`HASIL KESELURUHAN   : ${report.overallPass ? 'PASS' : 'FAIL'}`);
  console.log(`Detail lengkap     : ${path.relative(root, outFile)}`);

  clearTimeout(timer);
  process.exit(report.overallPass ? 0 : 1);
} catch (error) {
  clearTimeout(timer);
  console.error('HOLDOUT_ERROR', error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
