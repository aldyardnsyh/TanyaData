#!/usr/bin/env node
/**
 * Extraction ground-truth check — Perpres 76/2013.
 *
 *   npm run eval:extraction-gt
 *
 * Reindex sumber lalu bandingkan hasil OCR/cleaning/chunking/struktur dengan
 * ground truth kurasi (data/fixtures/perpres76/ground_truth.json). Exit 0
 * hanya bila semua metrik lolos. Laporan: docs/EXTRACTION_GT_RESULT.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceId = process.env.EXTRACTION_GT_SOURCE || 'src_6a30b004';
const gtFile = path.join(root, 'data/fixtures/perpres76/ground_truth.json');
const outFile = path.join(root, 'docs/EXTRACTION_GT_RESULT.json');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return nextResolve(pathToFileURL(path.join(root, specifier.slice(2)) + '.ts').href, context);
    }
    if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
      try { return nextResolve(specifier + '.ts', context); } catch { /* fall through */ }
    }
    return nextResolve(specifier, context);
  },
});

const norm = (text) => String(text ?? '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const tokens = (text) => new Set(norm(text).split(' ').filter((t) => t.length > 2));

function groundTruthUnits(gt) {
  const units = [];
  const add = (label, text) => { if (text && norm(text).length > 12) units.push({ label, text }); };
  add('metadata.judul', gt.metadata?.judul_lengkap);
  for (const key of ['menimbang', 'mengingat']) {
    for (const item of gt.pembukaan?.[key] ?? []) add(`pembukaan.${key}.${item.kode ?? item.nomor}`, item.teks);
  }
  add('pembukaan.memutuskan', gt.pembukaan?.memutuskan?.menetapkan);
  for (const pasal of gt.batang_tubuh ?? []) {
    const label = `Pasal ${pasal.nomor_pasal}`;
    add(`${label}.pengantar`, pasal.pengantar);
    add(`${label}.teks`, pasal.teks);
    for (const butir of pasal.butir ?? []) add(`${label}.butir.${butir.kode}`, butir.teks);
    for (const ayat of pasal.ayat ?? []) {
      add(`${label}.ayat.${ayat.nomor}.pengantar`, ayat.pengantar);
      add(`${label}.ayat.${ayat.nomor}.teks`, ayat.teks);
      for (const butir of ayat.butir ?? []) add(`${label}.ayat.${ayat.nomor}.butir.${butir.kode}`, butir.teks);
    }
  }
  add('penutup.perintah', gt.penutup?.perintah_pengundangan);
  add('penutup.lembaran', gt.penutup?.lembaran_negara);
  return units;
}

const { ensureWorkspaceReady } = await import(pathToFileURL(path.join(root, 'lib/db/migrate.ts')).href);
const { reindexSource } = await import(pathToFileURL(path.join(root, 'lib/ingest/sources.ts')).href);
const db = ensureWorkspaceReady();
await reindexSource(db, sourceId);

const doc = db.prepare('SELECT doc_type, pages FROM core_documents WHERE id = ?').get(sourceId);
const chunks = db.prepare('SELECT section_path, level, text FROM core_chunks WHERE dataset_id = ? ORDER BY id').all(sourceId);
db.close();

const gt = JSON.parse(fs.readFileSync(gtFile, 'utf8'));
const units = groundTruthUnits(gt);
const allText = chunks.map((c) => norm(c.text)).join(' ');
const exact = units.filter((u) => allText.includes(norm(u.text))).length;
const coverage = units.reduce((sum, u) => {
  const need = tokens(u.text);
  let best = 0;
  for (const chunk of chunks) {
    const have = tokens(chunk.text);
    let hit = 0;
    for (const token of need) if (have.has(token)) hit += 1;
    best = Math.max(best, need.size ? hit / need.size : 0);
  }
  return sum + best;
}, 0) / units.length;

const pasalPaths = new Set(chunks.map((c) => (c.section_path.match(/^Pasal\s+\d+/i) ?? [])[0]).filter(Boolean));
const ayatCount = chunks.filter((c) => /\bayat \(\d+\)/i.test(c.section_path)).length;
const butirCount = chunks.filter((c) => /\bbutir\b/i.test(c.section_path) && !/pengantar/i.test(c.section_path)).length;
const mojibakeResidual = ['clisebut', 'clibentuk', 'rnenyediakan', 'Rcpublik', 'PRES IDEN', 'kelo7ok', 'dim/sud']
  .reduce((n, pattern) => n + (allText.match(new RegExp(pattern.toLowerCase(), 'g')) ?? []).length, 0);

const metrics = {
  exact_text_units: { value: exact / units.length, threshold: 1, pass: exact === units.length, detail: `${exact}/${units.length}` },
  token_coverage: { value: Number(coverage.toFixed(4)), threshold: 0.98, pass: coverage >= 0.98 },
  doc_type: { value: doc?.doc_type, expected: 'legal', pass: doc?.doc_type === 'legal' },
  page_count: { value: doc?.pages, expected: gt.metadata?.jumlah_halaman, pass: doc?.pages === gt.metadata?.jumlah_halaman },
  pasal_count: { value: pasalPaths.size, expected: gt.metadata?.jumlah_pasal, pass: pasalPaths.size === gt.metadata?.jumlah_pasal },
  ayat_count: { value: ayatCount, expected: gt.batang_tubuh.reduce((n, p) => n + (p.ayat?.length ?? 0), 0), pass: ayatCount === gt.batang_tubuh.reduce((n, p) => n + (p.ayat?.length ?? 0), 0) },
  butir_count: { value: butirCount, expected: gt.batang_tubuh.reduce((n, p) => n + (p.butir?.length ?? 0) + (p.ayat ?? []).reduce((m, a) => m + (a.butir?.length ?? 0), 0), 0), pass: butirCount === gt.batang_tubuh.reduce((n, p) => n + (p.butir?.length ?? 0) + (p.ayat ?? []).reduce((m, a) => m + (a.butir?.length ?? 0), 0), 0) },
  hierarchy: { value: { parent: chunks.filter((c) => c.level === 'parent').length, child: chunks.filter((c) => c.level === 'child').length }, pass: chunks.some((c) => c.level === 'parent') && chunks.some((c) => c.level === 'child') },
  mojibake_residual: { value: mojibakeResidual, threshold: 0, pass: mojibakeResidual === 0 },
};

const failed = Object.entries(metrics).filter(([, m]) => !m.pass).map(([name]) => name);
const report = { generatedAt: new Date().toISOString(), sourceId, chunks: chunks.length, metrics, verdict: failed.length ? 'FAIL' : 'PASS', failed };
fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`EXTRACTION GT: ${report.verdict} | ${chunks.length} chunk | exact=${metrics.exact_text_units.detail} | ayat=${ayatCount} | butir=${butirCount}`);
if (failed.length) console.log(`Gagal: ${failed.join(', ')}`);
console.log(`Laporan: ${outFile}`);
process.exitCode = failed.length ? 1 : 0;
