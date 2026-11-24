import fs from 'node:fs';
import path from 'node:path';
import { readSeedProfile } from './lib/seed-profile.mjs';

const ROOT = process.cwd();
const STANDALONE = path.join(ROOT, '.next', 'standalone');
const profile = readSeedProfile();
const demo = profile === 'demo';

// ANTI-KEBOCORAN: ground truth dan tuning artifact TIDAK boleh masuk image
// produksi. data/seed berisi *.gt.txt (transkrip resmi) yang dipakai hanya
// untuk evaluasi — bukan teks indeks. Lihat docs/PRODUCTION_READY.md.
const EXCLUDED = [
  /\.gt\.txt$/i,
  /\.rnd-backup$/i,
  /(^|[\\/])(gt|ground[-_]?truth|tuning|tuning[-_]?artifacts)([\\/]|$)/i,
];
const isExcluded = (name) => EXCLUDED.some((re) => re.test(name));

// Artefak R&D yang HANYA boleh ikut pada profil demo.
const SEED_ONLY = new Set([
  'data/analytics.db',
  'data/analytics.db.rnd-backup',
  'data/generated',
  'data/seed',
]);

// Next.js output file tracing ikut menyalin data/fixtures (GT, hold-out,
// ground_truth.json, chunks.jsonl) dan data/workspace (DB lokal lama) ke
// standalone meski tidak ada di daftar `items`. Keduanya TIDAK boleh ada di
// image — dibersihkan pada kedua profil, bukan hanya saat none.
const ALWAYS_PURGE = ['data/fixtures', 'data/eval', 'data/corpus_sections', 'data/workspace'];

function removeIfExists(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  console.warn(`copy-standalone: PURGE ${path.relative(ROOT, target)} (SEED_PROFILE=${profile})`);
}

/** Hapus tanpa log: dipakai untuk membuang salinan artefak terlarang di tujuan. */
function removeQuiet(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * Fail-closed: image produksi harus benar-benar bebas dari seed R&D.
 * Pemeriksaan ini juga menangkap sisa build demo sebelumnya yang kebetulan
 * masih tertinggal di .next/standalone.
 */
function assertNoForbiddenArtifacts(checkSeed) {
  const violations = [];
  const forbiddenDirs = [...ALWAYS_PURGE, ...(checkSeed ? [...SEED_ONLY] : [])];
  for (const rel of forbiddenDirs) {
    if (fs.existsSync(path.join(STANDALONE, rel))) violations.push(rel);
  }

  const forbiddenFiles = [
    /\.gt\.txt$/i,
    /ground_truth\.json$/i,
    /chunks\.jsonl$/i,
    /cases\.json$/i,
    ...(checkSeed ? [/^KB_0\d.*\.pdf$/i, /Perpres_76_2013\.pdf/i] : []),
  ];

  const dataDir = path.join(STANDALONE, 'data');
  if (fs.existsSync(dataDir)) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (forbiddenFiles.some((re) => re.test(entry.name))) {
          violations.push(path.relative(STANDALONE, full));
        }
      }
    };
    walk(dataDir);
  }

  if (violations.length) {
    throw new Error(
      `copy-standalone: artefak terlarang masih ada di image: ${violations.join(', ')}`,
    );
  }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (isExcluded(e.name)) {
      // Jangan hanya MELEWATI. Output file tracing Next sudah menyalin berkas
      // ini ke .next/standalone SEBELUM postbuild berjalan, jadi salinannya
      // harus dibuang di sini. Tanpa ini, build SEED_PROFILE=demo gagal di
      // assertNoForbiddenArtifacts (mis. data/seed/documents/*.gt.txt).
      removeQuiet(d);
      console.warn(`copy-standalone: SKIP excluded ${path.join(src, e.name)}`);
      continue;
    }
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Bersihkan artefak yang tidak pernah boleh masuk image (GT/eval/workspace
// lokal) pada kedua profil. Default produksi = none juga membersihkan sisa
// seed R&D dari build demo sebelumnya, supaya hasil build deterministik.
for (const rel of ALWAYS_PURGE) removeIfExists(path.join(STANDALONE, rel));
if (!demo) {
  for (const rel of SEED_ONLY) removeIfExists(path.join(STANDALONE, rel));
}

const items = [
  ['data/analytics.db', 'data/analytics.db'],
  ['data/generated', 'data/generated'],
  ['data/seed', 'data/seed'],
  ['lib/db/schema.sql', 'lib/db/schema.sql'],
  ['public/fonts', 'public/fonts'],
  ['.env.example', '.env.example'],
  // KRITIS: standalone tidak menyalin .next/static secara otomatis.
  // Tanpa ini semua halaman tampil tanpa CSS (Material Symbols jadi teks mentah).
  ['.next/static', '.next/static'],
];

for (const [src, dst] of items) {
  if (!demo && SEED_ONLY.has(src)) {
    console.warn(`copy-standalone: SKIP seed ${src} (SEED_PROFILE=none)`);
    continue;
  }
  if (isExcluded(src)) {
    console.warn(`copy-standalone: SKIP excluded ${src}`);
    continue;
  }
  const s = path.join(ROOT, src);
  const d = path.join(STANDALONE, dst);
  if (!fs.existsSync(s)) {
    console.warn(`copy-standalone: skip missing ${src}`);
    continue;
  }
  if (fs.statSync(s).isDirectory()) copyDir(s, d);
  else {
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
  }
  console.log(`copied ${src}`);
}

assertNoForbiddenArtifacts(!demo);
console.log(`standalone copy done (SEED_PROFILE=${profile})`);
