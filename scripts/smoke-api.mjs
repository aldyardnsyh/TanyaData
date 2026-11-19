const base = process.argv[2] ?? 'http://127.0.0.1:3210';
let failed = 0;

async function call(method, path, body, expect = 200) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  let payload;
  if (ct.includes('application/json')) {
    payload = await res.json();
  } else {
    payload = `[${ct.split(';')[0]} ${(await res.text()).length}b]`;
  }
  const ok = res.status === expect;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path} -> ${res.status}`);
  if (!ok) console.log('   ', JSON.stringify(payload).slice(0, 400));
  return payload;
}

const meta = await call('GET', '/api/meta');
await call('GET', '/api/settings');
await call('GET', '/api/dashboard/summary?period=this_month');
await call('GET', '/api/dashboard/trends?period=this_month&grain=week');
await call('GET', '/api/dashboard/status-distribution?period=this_month');
await call('GET', '/api/dashboard/channel-performance?period=this_month');
await call('GET', '/api/dashboard/category-performance?period=this_month');
await call('GET', '/api/dashboard/insights?period=this_month');
await call('GET', '/api/sources');
await call('GET', '/api/investigations/overview?period=this_month');
await call('POST', '/api/investigations/analyze', { question: 'Kenapa success rate turun bulan ini?', persist: true, lang: 'id' });
const conv = await call('POST', '/api/conversations', { lang: 'id' }, 201);
const cid = conv?.conversation?.id;
if (!cid) {
  console.log('FAIL no conversation id');
  failed++;
} else {
  const msg = await call('POST', `/api/conversations/${cid}/messages`, { content: 'Kenapa success rate turun bulan ini?', lang: 'id' }, 201);
  const mid = msg?.message?.id ?? msg?.messages?.at(-1)?.id;
  if (mid) {
    await call('POST', `/api/conversations/${cid}/messages/${mid}/report`, { title: 'Smoke report' }, 201);
  }
  await call('GET', `/api/conversations/${cid}`);
}
await call('GET', '/api/reports');
const reportList = await call('GET', '/api/reports');
const rid = reportList?.items?.[0]?.id;
if (rid) {
  await call('GET', `/api/reports/${rid}`);
  await call('GET', `/api/reports/${rid}/export?format=csv`);
  await call('GET', `/api/reports/${rid}/export?format=pdf`);
}
await call('PUT', '/api/settings', { lang: 'en' });
await call('PUT', '/api/settings', { lang: 'id' });
await call('GET', '/api/nope', undefined, 404);

console.log(failed === 0 ? 'SMOKE: PASS' : `SMOKE: FAIL (${failed})`);
console.log('meta activeDataset:', meta?.activeDataset?.id ?? 'n/a');
process.exit(failed === 0 ? 0 : 1);
