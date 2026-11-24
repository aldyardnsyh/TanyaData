#!/usr/bin/env node
/**
 * Verifikasi bootstrap Qdrant DARI NOL memakai collection uji.
 *
 *   node scripts/test-qdrant-bootstrap.mjs
 *
 * Urutan:
 *   1. bersihkan sisa `td_bootstrap_test` / `td_bootstrap_test_v1` (jika ada)
 *   2. ensureQdrantCollection() → collection + 10 payload index + alias
 *   3. verifikasi lewat REST (exists, alias, payload_schema, count)
 *   4. ensureQdrantCollection() lagi → idempoten (tidak ada yang dibuat)
 *   5. HAPUS collection uji + alias (finally, selalu)
 *
 * Env QDRANT_URL / QDRANT_API_KEY dibaca dari process.env, lalu .env.local
 * untuk kunci yang belum ada. Nama collection uji DIPAKSA menimpa env agar
 * tidak pernah menyentuh `td_chunks_v1` produksi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env.local hanya mengisi kunci yang belum diset caller.
const envLocal = path.join(root, '.env.local');
if (fs.existsSync(envLocal)) {
  for (const line of fs.readFileSync(envLocal, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const TEST_ALIAS = 'td_bootstrap_test';
const TEST_PHYSICAL = `${TEST_ALIAS}_v1`;
process.env.QDRANT_COLLECTION = TEST_ALIAS;
process.env.QDRANT_COLLECTION_VERSION = 'v1';
process.env.QDRANT_MODE = 'on';

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

const { ensureQdrantCollection } = await import(
  pathToFileURL(path.join(root, 'lib/qdrant/collections.ts')).href
);

const base = String(process.env.QDRANT_URL ?? '').replace(/\/$/, '');
const apiKey = String(process.env.QDRANT_API_KEY ?? '');
if (!base) {
  console.error('FAIL QDRANT_URL belum diset — tidak bisa menguji bootstrap.');
  process.exit(1);
}
const headers = { 'Content-Type': 'application/json', ...(apiKey ? { 'api-key': apiKey } : {}) };

async function rest(method, urlPath, body) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { ok: response.ok, status: response.status, payload };
}

async function cleanup(label) {
  await rest('DELETE', `/collections/${TEST_PHYSICAL}`);
  const aliases = await rest('GET', '/aliases');
  const found = aliases.payload?.result?.aliases?.find((a) => a.alias_name === TEST_ALIAS);
  if (found) {
    await rest('POST', '/collections/aliases', {
      actions: [{ delete_alias: { alias_name: TEST_ALIAS } }],
    });
  }
  console.log(`CLEAN ${label}: ${TEST_PHYSICAL} + alias ${TEST_ALIAS} dihapus`);
}

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
};

try {
  await cleanup('pre-test');

  // 1. Bootstrap dari nol.
  const first = await ensureQdrantCollection();
  check('bootstrap created collection', first.created === true, `created=${first.created}`);
  check('bootstrap created alias', first.aliasCreated === true, `aliasCreated=${first.aliasCreated}`);
  check('bootstrap created payload indexes', first.indexesCreated.length === 10,
    `indexes=${first.indexesCreated.join(',')}`);

  // 2. Verifikasi REST independen.
  const exists = await rest('GET', `/collections/${TEST_PHYSICAL}/exists`);
  check('REST collection exists', exists.payload?.result?.exists === true,
    `status=${exists.status} exists=${JSON.stringify(exists.payload?.result)}`);

  const aliases = await rest('GET', '/aliases');
  const alias = aliases.payload?.result?.aliases?.find((a) => a.alias_name === TEST_ALIAS);
  check('REST alias → physical', alias?.collection_name === TEST_PHYSICAL,
    `alias=${JSON.stringify(alias ?? null)}`);

  const info = await rest('GET', `/collections/${TEST_PHYSICAL}`);
  const schema = info.payload?.result?.payload_schema ?? {};
  const expected = [
    'source_id', 'dataset_id', 'doc_id', 'chunk_id', 'section_path', 'rev', 'level',
    'page', 'parse_ok', 'text_fts',
  ];
  const missing = expected.filter((f) => !Object.prototype.hasOwnProperty.call(schema, f));
  check('REST payload_schema lengkap', missing.length === 0,
    missing.length ? `missing=${missing.join(',')}` : `fields=${Object.keys(schema).length}`);

  const count = await rest('POST', `/collections/${TEST_PHYSICAL}/points/count`, { exact: true });
  check('REST count endpoint', count.ok && typeof count.payload?.result?.count === 'number',
    `status=${count.status} count=${count.payload?.result?.count}`);

  // 3. Idempotensi — pemanggilan kedua tidak boleh membuat apa pun.
  const second = await ensureQdrantCollection();
  check('idempoten: tidak recreate', second.created === false && second.aliasCreated === false,
    `created=${second.created} aliasCreated=${second.aliasCreated}`);
  check('idempoten: tanpa index baru', second.indexesCreated.length === 0,
    `indexes=${second.indexesCreated.join(',') || '-'}`);
} catch (error) {
  failures += 1;
  console.error(`FAIL exception: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await cleanup('post-test').catch((e) => console.warn(`WARN cleanup: ${String(e)}`));
}

if (failures) {
  console.error(`\nBOOTSTRAP TEST: FAIL (${failures} masalah)`);
  process.exit(1);
}
console.log('\nBOOTSTRAP TEST: PASS');
