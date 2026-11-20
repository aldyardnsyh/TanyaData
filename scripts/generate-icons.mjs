/**
 * Generator icon aplikasi TanyaData: app/icon.png (256) dan app/apple-icon.png (180).
 * Menggambar mark geometris yang sama dengan app/icon.svg (baris data porcelain +
 * sinyal lime di atas forest) langsung ke buffer piksel, lalu menulis PNG 8-bit RGBA.
 * Jalankan: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Palet (enam token absolut). */
const FOREST = [11, 68, 51];
const PORCELAIN = [243, 244, 239];
const LIME = [197, 217, 75];

/* CRC32 untuk chunk PNG. */
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* Jarak bertanda rounded-box (negatif = di dalam) untuk cakupan anti-alias. */
function sdBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/**
 * Render satu sub-sample: warna komposit di titik (u,v) dalam ruang 64 unit.
 * Lapisan: kotak forest (rounded, atau penuh untuk apple) → tiga bar porcelain
 * alpha bertingkat → dot lime.
 */
function sample(u, v, cornerRadius) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const blend = (sr, sg, sb, sa, cov) => {
    const alpha = sa * cov;
    const inv = 1 - alpha;
    r = sr * alpha + r * inv;
    g = sg * alpha + g * inv;
    b = sb * alpha + b * inv;
    a = alpha + a * inv;
  };
  // Kotak latar forest dengan sudut membulat (radius 0 untuk apple-icon).
  const boxCov = sdBox(u, v, 32, 32, 32, 32, cornerRadius) <= 0 ? 1 : 0;
  blend(FOREST[0], FOREST[1], FOREST[2], 1, boxCov);
  if (boxCov > 0) {
    const bars = [
      { x: 14, y: 15, w: 30, h: 7, alpha: 1 },
      { x: 14, y: 27.5, w: 21, h: 7, alpha: 0.62 },
      { x: 14, y: 40, w: 16, h: 7, alpha: 0.38 },
    ];
    for (const bar of bars) {
      const cov = sdBox(u, v, bar.x + bar.w / 2, bar.y + bar.h / 2, bar.w / 2, bar.h / 2, bar.h / 2) <= 0 ? 1 : 0;
      if (cov > 0) blend(PORCELAIN[0], PORCELAIN[1], PORCELAIN[2], bar.alpha, cov);
    }
    const dotCov = sdCircle(u, v, 43, 43.5, 6.5) <= 0 ? 1 : 0;
    if (dotCov > 0) blend(LIME[0], LIME[1], LIME[2], 1, dotCov);
  }
  return [r, g, b, a * 255];
}

function render(size, cornerRadius) {
  const pixels = Buffer.alloc(size * size * 4);
  const SUB = 4; // 4x4 sub-sample per piksel untuk anti-alias
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUB; sy += 1) {
        for (let sx = 0; sx < SUB; sx += 1) {
          const u = ((x + (sx + 0.5) / SUB) / size) * 64;
          const v = ((y + (sy + 0.5) / SUB) / size) * 64;
          const [sr, sg, sb, sa] = sample(u, v, cornerRadius);
          r += sr;
          g += sg;
          b += sb;
          a += sa;
        }
      }
      const n = SUB * SUB;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(r / n);
      pixels[i + 1] = Math.round(g / n);
      pixels[i + 2] = Math.round(b / n);
      pixels[i + 3] = Math.round(a / n);
    }
  }
  return pixels;
}

/* Radius dalam ruang 64-unit (maks 32). Apple-icon tanpa sudut membulat: iOS membulatkan sendiri. */
writeFileSync(join(ROOT, 'app', 'icon.png'), encodePng(256, render(256, 14)));
writeFileSync(join(ROOT, 'app', 'apple-icon.png'), encodePng(180, render(180, 0)));
console.log('icons written: app/icon.png (256), app/apple-icon.png (180)');
