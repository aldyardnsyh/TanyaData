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
  lines.push(`- Kasus: ${report.caseCount} legacy (3 per fixture) + ${report.capability?.total ?? 0} capability CORE V2`);
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
  lines.push('');
  lines.push('## Per-case gate (extraction recall)');
  lines.push('');
  const gate = report.perCaseGate;
  lines.push(`- Ambang: recall ≥ ${gate.threshold.toFixed(2)} per kasus (hanya kasus dengan expected extraction fields).`);
  lines.push(`- Dievaluasi: ${gate.evaluated} kasus · Gagal: ${gate.failed} · Hasil: **${gate.pass ? 'PASS' : 'FAIL'}**`);
  if (gate.failures.length) {
    lines.push('');
    lines.push('| ID | Recall | Detail |');
    lines.push('|---|---:|---|');
    for (const f of gate.failures) {
      lines.push(`| ${f.id} | ${f.recall.toFixed(4)} | ${f.detail.replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('');
  if (report.capability) {
    const cap = report.capability;
    lines.push('## Eval_case CORE V2 (FR-A..FR-E)');
    lines.push('');
    lines.push(`- Hasil: **${cap.passed}/${cap.total} lulus** (target ≥ 8/11) — ${cap.overallPass ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push('| ID | FR | Kemampuan | Hasil | Bukti |');
    lines.push('|---|---|---|---|---|');
    for (const c of cap.cases) {
      lines.push(`| ${c.id} | ${c.fr} | ${c.capability} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.detail.replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
    lines.push('| FR | Kasus | Lulus |');
    lines.push('|---|---:|---:|');
    for (const [fr, v] of Object.entries(cap.byFr)) {
      lines.push(`| ${fr} | ${v.cases} | ${v.passed} |`);
    }
    lines.push('');
  }

  lines.push('## Implementasi AI V2 (P3-CORE-V2)');
  lines.push('');
  lines.push('- **Readjustment deterministik** (`lib/ai/readjustment.ts`): regex → `ReadjustmentOp` (filter/group_by/classify/report) yang di-resolve terhadap `schema_json`/registry. Kolom atau bagian tak dikenal → `needs_clarification` + daftar nilai valid, bukan tebakan. `ReadjustmentOp` saat ini didefinisikan secara lokal karena `lib/core/contracts.ts` (milik backend) belum memilikinya; file itu sengaja tidak diubah.');
  lines.push('- **Sitasi deep-link** (`lib/ai/retrieval.ts` + `lib/ai/output.ts`): `docId#page=&section=&chunk=&rev=` divalidasi fail-closed (doc READY, chunk nyata & parseable, halaman/section/rev/kutipan cocok). Sitasi tanpa chunk ditolak; sitasi invalid tidak bisa menaikkan level ke `strong`.');
  lines.push('- **Scope per attachment** (`lib/ai/guardrails.ts`): hanya chunk/SQL dari attachment aktif yang boleh masuk; attachment belum `READY` dan referensi "dokumen sebelumnya" ditolak dengan pesan jujur.');
  lines.push('- **Keterbatasan jujur:** FR-A/FR-E pada eval ini menguji permukaan kontrak AI-lane (perencanaan OCR, notifikasi halaman gagal, validasi sitasi di snapshot). OCR sungguhan, PDF/Excel, dan halaman share tetap lane backend/frontend dan diverifikasi manual di P5. Tidak ada model lokal, tidak ada panggilan jaringan saat eval.');
  lines.push('');

  lines.push('## Catatan');
  lines.push('');
  for (const n of report.notes) lines.push(`- ${n}`);
  if (report.capability) for (const n of report.capability.notes) lines.push(`- ${n}`);
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
  const { runCapabilityEval } = await import('../lib/eval/capability.ts');
  const report = await runEval({ fixturesDir, casesFile });
  const capability = runCapabilityEval(casesFile);
  const combined = { ...report, capability };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(combined, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdFile, markdown(combined), 'utf8');

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
  console.log(`Per-case gate (extraction recall ≥ ${report.perCaseGate.threshold.toFixed(2)}): ${report.perCaseGate.evaluated} dievaluasi, ${report.perCaseGate.failed} gagal — ${report.perCaseGate.pass ? 'PASS' : 'FAIL'}`);
  console.log('─'.repeat(72));
  console.log(`CORE V2 capability: ${capability.passed}/${capability.total} lulus (target ≥ 8/11) — ${capability.overallPass ? 'PASS' : 'FAIL'}`);
  for (const c of capability.cases) {
    console.log(`  ${c.id.padEnd(7)} FR-${c.fr} ${c.capability.padEnd(12)} ${c.pass ? 'PASS' : 'FAIL'}  ${c.detail}`);
  }
  console.log('─'.repeat(72));
  const overall = report.overallPass && capability.overallPass;
  console.log(`KESELURUHAN: ${overall ? 'PASS' : 'FAIL'}  |  ${report.caseCount} legacy + ${capability.total} capability  |  detail: ${path.relative(root, outFile)}`);
  console.log(`Laporan: ${path.relative(root, mdFile)}`);

  clearTimeout(timer);
  process.exit(overall ? 0 : 1);
} catch (error) {
  clearTimeout(timer);
  console.error('EVAL_ERROR', error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
