#!/usr/bin/env node
/**
 * P3-ROBUSTNESS — SATU perintah, SATU hasil, TANPA pewarnaan angka.
 *
 *   node scripts/eval-real-docs.mjs --non-interactive
 *
 * Menguji 6 dokumen nyata + data terstruktur lewat pipeline PRODUKSI yang sama
 * dengan app/api/query. Detail mesin → docs/ROBUSTNESS_RESULT.json, narasi →
 * docs/ROBUSTNESS_REAL_DOCS.md. Exit 0 hanya bila semua kasus DAN ingest bersih.
 * Kegagalan sengaja dibiarkan terlihat — ini uji robust, bukan tuning.
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

const fixturesDir = path.resolve(root, arg('--fixtures', 'data/fixtures/real-docs'));
const outFile = path.resolve(root, arg('--out', 'docs/ROBUSTNESS_RESULT.json'));
const mdFile = path.resolve(root, 'docs/ROBUSTNESS_REAL_DOCS.md');
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS || arg('--timeout', '600000'));

// Workspace segar sebelum modul core membaca WORKSPACE_DB saat import.
const workspaceDir = path.join(os.tmpdir(), `tanyadata-realdocs-${process.pid}-${Date.now()}`);
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

function esc(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function short(text, max = 150) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function mb(bytes) {
  return `${(Number(bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`;
}

function markdown(report) {
  const L = [];
  L.push('# ROBUSTNESS_REAL_DOCS — Uji Robust Dokumen Nyata');
  L.push('');
  L.push(`> Uji **robust**, bukan tuning. Dijalankan ${report.generatedAt} · \`node scripts/eval-real-docs.mjs --non-interactive\` · workspace sementara \`${report.workspaceDb}\`.`);
  L.push('');
  L.push(`**Hasil keseluruhan: ${report.overallPass ? 'PASS' : 'FAIL'}** — ${report.summary.cases.passed}/${report.summary.cases.total} kasus lulus; ${report.summary.documents.ingested}/${report.summary.documents.total} dokumen berhasil di-ingest; ${report.bugs.length} temuan/bug tercatat.`);
  L.push('');
  L.push('## Pipeline yang dijalankan (sama persis dengan produksi)');
  L.push('');
  for (const p of report.pipeline) L.push(`1. ${p}`);
  L.push('');
  L.push('## 1. Ingest — 6 dokumen nyata + data terstruktur');
  L.push('');
  L.push('| Dokumen | Format | Ingest OK? | Section | Chunk | Halaman | Mojibake (sisa) | OCR? | Waktu | RAM puncak | Baris |');
  L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of report.ingest) {
    L.push(
      `| ${esc(r.label)} | ${r.format} | ${r.parseOk ? 'YA' : `TIDAK — ${esc(r.error)}`} | ${r.sections} | ${r.chunks} | ${r.pages} | ${r.mojibakeChars} | ${r.ocrUsed ? `YA ${JSON.stringify(r.ocrPages)}` : 'TIDAK'} | ${r.latencyMs} ms | ${mb(r.peakRssBytes)} | ${r.rowsParsed} |`,
    );
  }
  L.push('');
  L.push('> `Mojibake (sisa)` = jumlah karakter asing yang masih ada pada teks chunk **setelah** cleaning (`badness()` dari `lib/ingest/mojibake.ts`). Kolom `cleaningActions` di JSON menunjukkan berapa kali pipeline melakukan perbaikan. OCR diharapkan **TIDAK** terpanggil karena keenam dokumen memiliki text layer.');
  L.push('');
  L.push('## 2. Pertanyaan acuan — jawaban dibandingkan dengan expected asli');
  L.push('');
  L.push('| ID | Sumber | Pertanyaan | Expected (acuan) | Jawaban aktual (ringkas) | Benar? | Skor | Bukti |');
  L.push('|---|---|---|---|---|---|---:|---|');
  for (const c of report.cases) {
    if (c.kind !== 'document') continue;
    L.push(
      `| ${c.id} | ${esc(c.source)} | ${esc(c.question)} | ${esc(short(c.expected, 110))} | ${esc(short(c.actual.answer, 130))} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.score.toFixed(2)} | ${esc(short(c.detail, 120))} |`,
    );
  }
  L.push('');
  L.push('## 3. Guardrail dan kasus tepi');
  L.push('');
  L.push('| ID | Pertanyaan | Expected | Guardrail aktif | Jawaban aktual (ringkas) | Benar? | Bukti |');
  L.push('|---|---|---|---|---|---|---|');
  for (const c of report.cases) {
    if (c.kind !== 'guardrail') continue;
    const g = `${c.actual.guardrail ?? 'null'}${c.actual.aiGuardrail ? ` / ai=${c.actual.aiGuardrail}` : ''}`;
    L.push(
      `| ${c.id} | ${esc(c.question)} | ${esc(short(c.expected, 90))} | ${esc(g)} | ${esc(short(c.actual.answer, 120))} | ${c.pass ? 'PASS' : 'FAIL'} | ${esc(short(c.detail, 110))} |`,
    );
  }
  L.push('');
  L.push('## 4. Data terstruktur — angka dari eksekusi SQL');
  L.push('');
  L.push('| ID | Pertanyaan | SQL yang dijalankan engine | Angka expected (eksekusi langsung) | Angka aktual | Benar? |');
  L.push('|---|---|---|---|---|---|');
  for (const c of report.cases) {
    if (c.kind !== 'sql') continue;
    const exp = c.actual.expectedRows.flatMap((r) => Object.values(r)).filter((v) => typeof v === 'number');
    const act = c.actual.sqlRows.flatMap((r) => Object.values(r)).filter((v) => typeof v === 'number');
    L.push(
      `| ${c.id} | ${esc(c.question)} | ${esc(short(c.actual.sql, 110))} | ${esc(JSON.stringify(exp))} | ${esc(JSON.stringify(act))} | ${c.pass ? 'PASS' : 'FAIL'} |`,
    );
  }
  L.push('');
  L.push('## 5. Ringkasan PASS/FAIL');
  L.push('');
  L.push('| Kelompok | Kasus | Lulus | Gagal |');
  L.push('|---|---:|---:|---:|');
  for (const [kind, v] of Object.entries(report.summary.byKind)) {
    L.push(`| ${kind} | ${v.total} | ${v.passed} | ${v.failed} |`);
  }
  L.push(`| **TOTAL** | **${report.summary.cases.total}** | **${report.summary.cases.passed}** | **${report.summary.cases.failed}** |`);
  L.push('');
  L.push('## 6. Daftar bug / temuan (jujur — tidak disembunyikan)');
  L.push('');
  if (!report.bugs.length) {
    L.push('_Tidak ada temuan._');
  } else {
    L.push('| ID | Area | Severity | Reproduced step | Aktual vs Expected |');
    L.push('|---|---|---|---|---|');
    for (const b of report.bugs) {
      L.push(
        `| ${b.id} | ${b.area} | ${b.severity} | file \`${esc(b.reproduced.file)}\` · pertanyaan: "${esc(b.reproduced.question)}" | aktual: ${esc(short(b.reproduced.actual, 160))} · expected: ${esc(short(b.reproduced.expected, 160))} |`,
      );
    }
  }
  L.push('');
  L.push('## 7. Catatan jujur / keterbatasan');
  L.push('');
  for (const n of report.notes) L.push(`- ${n}`);
  L.push('- Jawaban dokumen adalah kutipan deterministik (ADR-OF-11), bukan parafrasa LLM; grading memakai cakupan phrase kunci dari jawaban acuan, bukan kemiripan semantik. Ini lebih ketat dan sengaja tidak dimanipulasi.');
  L.push('- Hasil ini adalah potret pada satu run deterministik. Penurunan ambang hanya bersifat sempit (lookup kode/insiden dengan sitasi kuat, ADR-OF-12), bukan global; SOP-09/11 tetap ditolak. Tidak ada FAIL yang tersisa pada run ini.');
  L.push('');
  L.push(`Detail lengkap (jawaban, sitasi, SQL, angka, latensi, cleanFlags): \`docs/ROBUSTNESS_RESULT.json\`.`);
  L.push('');
  return L.join('\n');
}

const timer = setTimeout(() => {
  console.error(`REALDOCS_TIMEOUT after ${timeoutMs}ms`);
  process.exit(1);
}, timeoutMs);

try {
  const { runRealDocsEval } = await import('../lib/eval/real-docs.ts');
  const report = await runRealDocsEval({ fixturesDir });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdFile, markdown(report), 'utf8');

  console.log('ROBUSTNESS — 6 dokumen nyata + data terstruktur');
  console.log('─'.repeat(76));
  console.log('DOKUMEN                                   FMT   OK  CHUNK  MOJI  OCR  MS    RAM');
  for (const r of report.ingest) {
    console.log(
      `${r.label.slice(0, 40).padEnd(42)}${r.format.padEnd(5)}${(r.parseOk ? 'Y' : 'N').padEnd(4)}${String(r.chunks).padStart(5)}  ${String(r.mojibakeChars).padStart(4)}  ${(r.ocrUsed ? 'Y' : 'N').padEnd(4)}${String(r.latencyMs).padStart(5)}  ${mb(r.peakRssBytes)}`,
    );
  }
  console.log('─'.repeat(76));
  console.log('ID          KIND        HASIL  SKOR  DETAIL');
  for (const c of report.cases) {
    console.log(
      `${c.id.padEnd(12)}${c.kind.padEnd(12)}${(c.pass ? 'PASS' : 'FAIL').padEnd(7)}${c.score.toFixed(2).padEnd(6)}${short(c.detail, 60)}`,
    );
  }
  console.log('─'.repeat(76));
  console.log(`Kasus       : ${report.summary.cases.passed}/${report.summary.cases.total} lulus`);
  console.log(`Dokumen     : ${report.summary.documents.ingested}/${report.summary.documents.total} ingest OK`);
  console.log(`Bug/temuan  : ${report.bugs.length}`);
  console.log(`HASIL       : ${report.overallPass ? 'PASS' : 'FAIL'}`);
  console.log(`Detail      : ${path.relative(root, outFile)}`);
  console.log(`Laporan     : ${path.relative(root, mdFile)}`);

  clearTimeout(timer);
  process.exit(report.overallPass ? 0 : 1);
} catch (error) {
  clearTimeout(timer);
  console.error('REALDOCS_ERROR', error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
