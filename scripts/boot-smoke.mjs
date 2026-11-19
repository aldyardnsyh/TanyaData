import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const server = spawn(process.execPath, ['.next/standalone/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: '3100', HOSTNAME: '127.0.0.1' },
  stdio: 'pipe',
});
let ready = false;
server.stdout.on('data', (d) => { const s = d.toString(); if (s.includes('Ready')) ready = true; process.stdout.write(s); });
server.stderr.on('data', (d) => process.stderr.write(d.toString()));

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    if (ready) return true;
    await sleep(250);
  }
  return false;
}

const ok = await waitReady();
if (!ok) { console.log('NOT READY'); server.kill(); process.exit(1); }

const checks = [
  ['GET /', 'http://127.0.0.1:3100/'],
  ['GET /overview', 'http://127.0.0.1:3100/overview'],
  ['GET /assistant', 'http://127.0.0.1:3100/assistant'],
  ['GET /api/meta', 'http://127.0.0.1:3100/api/meta'],
  ['GET /api/dashboard/summary', 'http://127.0.0.1:3100/api/dashboard/summary'],
  ['GET /api/sources', 'http://127.0.0.1:3100/api/sources'],
];
for (const [label, url] of checks) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    const snippet = label.startsWith('GET /api') ? text.slice(0, 200) : `html ${text.length}b`;
    console.log(`${res.status} ${label} :: ${snippet}`);
  } catch (e) {
    console.log(`ERR ${label} :: ${e.message}`);
  }
}

// chat smoke
try {
  const create = await fetch('http://127.0.0.1:3100/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: 'id' }) });
  const cj = await create.json();
  const cid = cj.conversation?.id ?? cj.id;
  const msg = await fetch(`http://127.0.0.1:3100/api/conversations/${cid}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Berapa total transaksi bulan ini?', lang: 'id' }) });
  const mj = await msg.json();
  console.log(`CHAT ${msg.status} :: answer=${(mj.message?.answer ?? '').slice(0, 120)} mode=${mj.message?.meta?.mode} fallback=${mj.message?.meta?.fallbackReason ?? 'none'}`);
} catch (e) { console.log('CHAT ERR :: ' + e.message); }

server.kill();
await sleep(500);
process.exit(0);
