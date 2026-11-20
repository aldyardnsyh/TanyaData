#!/usr/bin/env node
/**
 * Ground-truth evaluation — ONE command, ONE report.
 *
 *   npm run eval:ground-truth
 *
 * Prints a compact pass/fail table per stage and per fixture. Full detail
 * (answer, citations, SQL, numbers, latency) is written to --out and to
 * docs/EVAL_RESULTS.md. Exit 0 only when every stage clears its threshold.
 *
 * Node 22 type-stripping runs the TypeScript pipeline directly. Resolve hooks
 * map the project's `@/` alias and extensionless relative imports to `.ts`.
 * No API key is required; LLM_MODE is forced off for determinism.
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

const fixturesDir = path.resolve(root, arg('--fixtures', 'data/fixtures'));
const casesFile = path.resolve(root, arg('--cases', 'data/fixtures/cases.json'));
const outFile = path.resolve(root, arg('--out', 'docs/EVAL_GROUND_TRUTH_RESULT.json'));
const mdFile = path.resolve(root, 'docs/EVAL_RESULTS.md');
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS || arg('--timeout', '300000'));

// Fresh workspace before any core module reads WORKSPACE_DB at import time.
const workspaceDir = path.join(os.tmpdir(), `tanyadata-eval-${process.pid}-${Date.now()}`);
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
        // fall through to default resolution
      }
    }
    return nextResolve(specifier, context);
  },
});

function fmt(value) {
  return typeof value === 'number' ? value.toFixed(4) : String(value);
}

function markdown(report) {
  const lines = [];
  lines.push('# EVAL_RESULTS — Ground Truth AI Core');
  lines.push('');
  lines.push(`- Dijalankan: ${report.generatedAt}`);
  lines.push(`- Kasus: ${report.caseCount} (3 per fixture)`);
  lines.push(`- Workspace: \`${report.workspaceDb}\` (sementara, dibuat ulang tiap run)`);
  lines.push(`- Hasil keseluruhan: **${report.overallPass ? 'PASS' : 'FAIL'}**`);
  lines.push('');
  lines.push('## Hasil per tahap');
  lines.push('');
  lines.push('| Tahap | Metrik | Nilai | Ambang | Hasil |');
  lines.push('|---|---|---:|---:|---|');
  for (const s of report.stages) {
    lines.push(`| ${s.stage} | ${s.metric} | ${fmt(s.value)} | ${s.direction === 'min' ? '≥' : '≤'} ${fmt(s.threshold)} | ${s.pass ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('');
  lines.push('## Ringkasan per fixture');
  lines.push('');
  lines.push('| Fixture | Kasus | Lulus | Gagal |');
  lines.push('|---|---:|---:|---:|');
  for (const [name, v] of Object.entries(report.byFixture)) {
    lines.push(`| ${name} | ${v.cases} | ${v.passed} | ${v.failed} |`);
  }
  lines.push('');
  lines.push('## Detail kegagalan');
  lines.push('');
  const failed = report.cases.filter((c) => Object.values(c.stages).some((s) => !s.pass));
  if (!failed.length) {
    lines.push('_Tidak ada kasus yang gagal._');
  } else {
    for (const c of failed) {
      lines.push(`### ${c.id} — ${c.fixture} [${c.tags.join(', ')}]`);
      lines.push('');
      lines.push(`> ${c.question}`);
      lines.push('');
      for (const [stage, s] of Object.entries(c.stages)) {
        if (!s.pass) lines.push(`- **${stage} FAIL**: ${s.detail}`);
      }
      lines.push('');
    }
  }
  lines.push('## Catatan');
  lines.push('');
  for (const n of report.notes) lines.push(`- ${n}`);
  lines.push('');
  lines.push('Detail lengkap (jawaban, sitasi, SQL, angka, latensi) ada di `docs/EVAL_GROUND_TRUTH_RESULT.json`.');
  lines.push('');
  return lines.join('\n');
}

const timer = setTimeout(() => {
  console.error(`EVAL_TIMEOUT after ${timeoutMs}ms`);
  process.exit(1);
}, timeoutMs);

try {
  const { runEval } = await import('../lib/eval/harness.ts');
  const report = runEval({ fixturesDir, casesFile });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdFile, markdown(report), 'utf8');

  console.log('GROUND TRUTH EVAL — pass/fail per tahap');
  console.log('─'.repeat(72));
  console.log('Tahap            Metrik                  Nilai    Ambang   Hasil');
  console.log('─'.repeat(72));
  for (const s of report.stages) {
    const stage = s.stage.padEnd(16);
    const metric = s.metric.padEnd(23);
    const value = fmt(s.value).padStart(7);
    const threshold = `${s.direction === 'min' ? '≥' : '≤'}${fmt(s.threshold)}`.padStart(8);
    console.log(`${stage} ${metric} ${value} ${threshold}   ${s.pass ? 'PASS' : 'FAIL'}`);
  }
  console.log('─'.repeat(72));
  console.log('Ringkasan per fixture');
  for (const [name, v] of Object.entries(report.byFixture)) {
    console.log(`  ${name.padEnd(12)} ${String(v.passed).padStart(2)}/${v.cases} lulus  ${v.failed ? `(${v.failed} gagal)` : ''}`);
  }
  console.log('─'.repeat(72));
  console.log(`KESELURUHAN: ${report.overallPass ? 'PASS' : 'FAIL'}  |  ${report.caseCount} kasus  |  detail: ${path.relative(root, outFile)}`);
  console.log(`Laporan: ${path.relative(root, mdFile)}`);

  clearTimeout(timer);
  process.exit(report.overallPass ? 0 : 1);
} catch (error) {
  clearTimeout(timer);
  console.error('EVAL_ERROR', error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
