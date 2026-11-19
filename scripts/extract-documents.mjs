import path from 'node:path';
import { extractAll, writeDocumentsJson } from './lib/extract.mjs';

const started = Date.now();
const payload = await extractAll();

if (payload.documents.length === 0) {
  console.error('FAIL: tidak ada dokumen yang berhasil diekstrak');
  process.exit(1);
}

const out = writeDocumentsJson(payload);
let totalSections = 0;
let totalChars = 0;
for (const doc of payload.documents) {
  totalSections += doc.sections.length;
  totalChars += doc.sections.reduce((sum, s) => sum + s.text.length, 0);
}

console.log(`OK documents=${payload.documents.length} sections=${totalSections} chars=${totalChars}`);
for (const doc of payload.documents) {
  console.log(`  - ${doc.id}: ${doc.sections.length} seksi, ${doc.format}`);
}
for (const warning of payload.warnings) console.log(`WARN ${warning}`);
console.log(`OUT=${path.relative(process.cwd(), out)} (${Date.now() - started}ms)`);
