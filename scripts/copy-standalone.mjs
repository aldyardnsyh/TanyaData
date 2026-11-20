import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STANDALONE = path.join(ROOT, '.next', 'standalone');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
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
console.log('standalone copy done');
