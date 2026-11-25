/**
 * Unit test rate limiter token bucket (P6-FIX / SEC-011).
 *
 * Menjalankan `lib/api/rate-limit.ts` langsung lewat type stripping Node 22
 * (tanpa test runner tambahan). Alias `@/` dipetakan ke root repo lewat
 * resolve hook, karena Node tidak membaca `paths` di tsconfig.
 *
 * Jalankan: npm run test:rate-limit
 */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      let target = specifier.slice(2);
      if (!path.extname(target)) target += '.ts';
      return nextResolve(pathToFileURL(path.join(ROOT, target)).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { rateLimit } = await import(pathToFileURL(path.join(ROOT, 'lib/api/rate-limit.ts')).href);

const BASE = 1_700_000_000_000;
const realNow = Date.now;
let clock = BASE;
Date.now = () => clock;
test.after(() => {
  Date.now = realNow;
});

/** Policy `query` = 10 token / 60 detik. IP unik per test agar bucket tidak bercampur. */
function hit(ip) {
  return rateLimit(new Request('http://localhost/api/query', { headers: { 'x-forwarded-for': ip } }), 'query');
}

function drain(ip, count) {
  for (let i = 0; i < count; i += 1) {
    assert.equal(hit(ip), null, `request ke-${i + 1} untuk ${ip} seharusnya diizinkan`);
  }
}

test('11 request dalam satu window ditolak (429 + retry-after akurat)', () => {
  clock = BASE;
  drain('10.0.0.1', 10);

  const blocked = hit('10.0.0.1');
  assert.ok(blocked instanceof Response, 'request ke-11 seharusnya ditolak');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('ratelimit-remaining'), '0');
  assert.equal(blocked.headers.get('ratelimit-limit'), '10');
  // Sisa 1 token dari 10 token/60s = 6 detik, bukan sisa window.
  assert.equal(blocked.headers.get('retry-after'), '6');
});

test('idle satu window penuh memulihkan kuota', () => {
  clock = BASE;
  drain('10.0.0.2', 10);
  assert.equal(hit('10.0.0.2')?.status, 429);

  clock = BASE + 60_000;
  assert.equal(hit('10.0.0.2'), null, 'setelah 60s idle kuota harus pulih penuh');
  drain('10.0.0.2', 9);
  assert.equal(hit('10.0.0.2')?.status, 429, 'kuota pulih tepat 10, bukan lebih');
});

test('refill parsial memakai selang sejak update terakhir, tidak mereset kuota', () => {
  clock = BASE;
  drain('10.0.0.3', 10);

  // 30s = 5 token pulih. Kalau `last` tidak dimajukan (bug SEC-011), request
  // ke-6 di detik yang sama akan tetap lolos karena refill dihitung ulang
  // dari t=0 (selalu 5 token).
  clock = BASE + 30_000;
  drain('10.0.0.3', 5);
  const blocked = hit('10.0.0.3');
  assert.equal(blocked?.status, 429, 'token yang sudah dipakai tidak boleh pulih ulang');

  // 6s kemudian tepat 1 token pulih (10 token / 60s).
  clock = BASE + 36_000;
  assert.equal(hit('10.0.0.3'), null);
  assert.equal(hit('10.0.0.3')?.status, 429);
});

test('dua request berurutan mengurangi kuota, tidak saling mereset', () => {
  clock = BASE;
  drain('10.0.0.4', 8);

  // Sisa 2 token; dua request berikutnya harus menghabiskan tepat 2 token.
  assert.equal(hit('10.0.0.4'), null);
  assert.equal(hit('10.0.0.4'), null);
  const blocked = hit('10.0.0.4');
  assert.equal(blocked?.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '6');
});
