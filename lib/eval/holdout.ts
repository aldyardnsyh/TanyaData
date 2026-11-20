/**
 * P3-VALIDASI — Blind hold-out evaluation on a NON-Perpres document.
 *
 * Menjawab kekhawatiran overfitting: aturan chunker/retriever/guardrail
 * DIBEKUKAN (tidak diubah sama sekali). Modul ini hanya MENJALANKAN pipeline
 * produksi yang sama persis pada dokumen SOP layanan yang tidak dipakai saat
 * kalibrasi Perpres 76:
 *
 *   sectionsFromPages → chunkSections  (lib/ingest/chunker.ts, jalur produksi)
 *   → core_chunks + FTS5 trigger       (lib/db/core-schema.sql)
 *   → searchChunks                     (lib/core/store.ts, via answerQuestion)
 *   → detectGuardrail/notInSources     (lib/core/answer.ts, via answerQuestion)
 *   → composeDeterministicAnswer       (lib/core/answer.ts, via answerQuestion)
 *
 * Tidak ada model, tidak ada jaringan, tidak ada retry, tidak ada tuning
 * khusus SOP. LLM_MODE=off dipaksa oleh runner. Failures dilaporkan apa adanya.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { CORE_SCHEMA_SQL, WORKSPACE_DB } from '../db/paths';
import { createDataset, emptySchema, emptyQualityReport } from '../core/registry';
import { answerQuestion } from '../core/query';
import { chunkSections } from '../ingest/chunker';
import { sectionsFromPages } from '../ingest/extract';
import type { ExtractedPage } from '../ingest/types';
import { checkGuardrails } from '../ai/guardrails';

type Json = Record<string, any>;

const REFUSAL_TYPES = new Set(['not_in_sources', 'out_of_scope', 'unsupported', 'sql_rejected']);
const REFUSAL_TEXT = /tidak (bisa|dapat) dijawab|tidak ditemukan|tidak akan mengarang|di luar (cakupan|sumber)|di luar rentang/i;

export type HoldoutCaseResult = {
  id: string;
  question: string;
  kind: 'answerable' | 'refusal';
  expected: string | null;
  pass: boolean;
  answer: string;
  guardrail_type: string | null;
  ai_guardrail_type: string | null;
  citations: string[];
  quote_preview: string;
  foreign_numbers: string[];
  detail: string;
};

export type HoldoutReport = {
  generatedAt: string;
  documentFile: string;
  documentSha256: string;
  documentChars: number;
  chunkCount: number;
  chunkPreview: string;
  pipeline: string[];
  metrics: {
    answerable_accuracy: number;
    refusal_accuracy: number;
    hallucination_rate: number;
    overall_accuracy: number;
  };
  thresholds: { answerable: number; refusal: number; hallucination: number };
  cases: HoldoutCaseResult[];
  passed: number;
  total: number;
  overallPass: boolean;
  notes: string[];
};

function ratio(num: number, den: number): number {
  return den === 0 ? 1 : Number((num / den).toFixed(4));
}

function norm(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function runHoldoutEval(options: { fixturesDir: string; casesFile: string }): Promise<HoldoutReport> {
  const docFile = path.resolve(options.fixturesDir, 'sop-layanan/document.txt');
  const raw = fs.readFileSync(docFile);
  const documentText = raw.toString('utf8').trim();
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  const data = JSON.parse(fs.readFileSync(options.casesFile, 'utf8')) as Json;

  /* ---- 1. CHUNKER — jalur produksi, aturan tidak diubah ------------------ */
  // Satu halaman teks → sectionsFromPages (format 'txt', tanpa heading) →
  // pageSections → satu section → chunkSections. Ini persis yang terjadi bila
  // document.txt diunggah sebagai attachment .txt di produksi.
  const pages: ExtractedPage[] = [{ page: 1, text: documentText }];
  const sections = sectionsFromPages(pages, 'txt', 'SOP Layanan');
  const chunks = chunkSections(sections);

  /* ---- 2. INDEX — schema produksi + trigger FTS5 ------------------------- */
  fs.mkdirSync(path.dirname(WORKSPACE_DB), { recursive: true });
  const db = new Database(WORKSPACE_DB);
  db.pragma('journal_mode = DELETE');
  db.exec(fs.readFileSync(CORE_SCHEMA_SQL, 'utf8'));

  const dataset = createDataset(db, {
    id: 'eval-sop-layanan',
    name: 'SOP Layanan',
    kind: 'document',
    source_type: 'txt',
    doc_type: 'general',
    status: 'READY',
    schema_json: emptySchema(),
    row_count: 0,
    quality_report: emptyQualityReport(),
    is_demo: false,
  });
  const docId = 'doc-sop-layanan';
  db.prepare(
    `INSERT INTO core_documents(id, dataset_id, doc_type, mime, pages, sections_json, source_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(docId, dataset.id, 'general', 'text/plain', 1, '[]', 'sop-layanan/document.txt', new Date().toISOString());

  const insertChunk = db.prepare(
    `INSERT INTO core_chunks(document_id, dataset_id, section_path, page, text, token_count, char_count, level, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  chunks.forEach((c, i) => {
    // chunkSections adalah chunker flat produksi: tidak ada hierarki parent,
    // sehingga semua chunk berlevel 'child' (syarat searchChunks mengindeks).
    insertChunk.run(
      docId, dataset.id, c.section ?? `chunk-${i}`, c.page ?? 1, c.content,
      Math.ceil(c.content.length / 4), c.charCount, 'child', null,
    );
  });

  /* ---- 3..5. RETRIEVAL → GUARDRAIL → ANSWER via answerQuestion ----------- */
  const cases: HoldoutCaseResult[] = [];
  for (const tc of (data.cases ?? []) as Json[]) {
    const question = String(tc.question ?? '');
    const exp = tc.expected ?? {};
    const isRefusal = exp.expected_refusal === true;
    const substring = exp.answer_substring ? String(exp.answer_substring) : null;

    const q = await answerQuestion(db, {
      datasetId: dataset.id,
      question,
      lang: 'id',
      evaluate: true,
    });

    const answer = String(q.answer ?? '');
    const guardrailType = q.guardrail?.type ?? null;
    const citations = (q.citations ?? []).map((c) => c.section_path);
    const quote = (q.citations ?? []).map((c) => String(c.quote ?? '')).join(' ');

    // Diagnostik: apa yang dikatakan guardrail AI-lane (fungsi yang sama
    // dipakai eval Perpres). TIDAK dipakai untuk mengubah jawaban produksi.
    const aiG = checkGuardrails({
      question,
      noEvidence: citations.length === 0,
      availableTopics: [
        'SOP Layanan', 'Batas waktu', 'Pencatatan', 'Berkas',
        'Sistem Tiket', 'SLA Penyelesaian', 'Receiving Officer',
      ],
    });

    // Hallucination: angka pada jawaban harus berasal dari teks sitasi.
    const tokens = answer.match(/\d+(?:[.,]\d+)*/g) ?? [];
    const foreign = tokens.filter((t) => !quote.includes(t));

    let pass: boolean;
    let detail: string;
    if (isRefusal) {
      const refused = REFUSAL_TYPES.has(guardrailType ?? '') || REFUSAL_TEXT.test(answer);
      pass = refused && foreign.length === 0;
      detail = `guardrail=${guardrailType ?? 'none'} ai_guardrail=${aiG.type ?? 'none'} refused=${refused} foreign=${foreign.length} sitasi=${citations.length}`;
    } else {
      const hit = substring ? norm(answer).includes(norm(substring)) : false;
      pass = hit && guardrailType === null && foreign.length === 0;
      detail = `substring="${substring}" hit=${hit} guardrail=${guardrailType ?? 'none'} foreign=${foreign.length} sitasi=${citations.length}`;
    }

    cases.push({
      id: String(tc.id),
      question,
      kind: isRefusal ? 'refusal' : 'answerable',
      expected: substring,
      pass,
      answer,
      guardrail_type: guardrailType,
      ai_guardrail_type: aiG.type ?? null,
      citations,
      quote_preview: quote.slice(0, 240),
      foreign_numbers: foreign,
      detail,
    });
  }
  db.close();

  const answerable = cases.filter((c) => c.kind === 'answerable');
  const refusals = cases.filter((c) => c.kind === 'refusal');
  const aHit = answerable.filter((c) => c.pass).length;
  const rHit = refusals.filter((c) => c.pass).length;
  const hallucinated = cases.filter((c) => c.foreign_numbers.length > 0).length;
  const metrics = {
    answerable_accuracy: ratio(aHit, answerable.length),
    refusal_accuracy: ratio(rHit, refusals.length),
    hallucination_rate: ratio(hallucinated, cases.length),
    overall_accuracy: ratio(aHit + rHit, cases.length),
  };
  const thresholds = { answerable: 0.90, refusal: 0.90, hallucination: 0.02 };
  const overallPass =
    metrics.answerable_accuracy >= thresholds.answerable &&
    metrics.refusal_accuracy >= thresholds.refusal &&
    metrics.hallucination_rate <= thresholds.hallucination;

  return {
    generatedAt: new Date().toISOString(),
    documentFile: path.relative(process.cwd(), docFile),
    documentSha256: sha,
    documentChars: documentText.length,
    chunkCount: chunks.length,
    chunkPreview: chunks.map((c) => c.content).join(' ').slice(0, 240),
    pipeline: [
      'sectionsFromPages(txt) → chunkSections  [lib/ingest/chunker.ts — TIDAK diubah]',
      'core_chunks + core_chunks_fts trigger  [lib/db/core-schema.sql]',
      'searchChunks via answerQuestion  [lib/core/store.ts — TIDAK diubah]',
      'detectGuardrail / notInSourcesGuardrail  [lib/core/answer.ts — TIDAK diubah]',
      'composeDeterministicAnswer  [lib/core/answer.ts — TIDAK diubah]',
    ],
    metrics,
    thresholds,
    cases,
    passed: aHit + rHit,
    total: cases.length,
    overallPass,
    notes: [
      'Uji buta: dokumen SOP layanan TIDAK dipakai saat kalibrasi Perpres 76. Aturan chunker/retriever/guardrail tidak diubah.',
      'Dokumen direkonstruksi verbatim dari 8 frasa ground_truth; 3 kasus "TIDAK ADA JAWABAN" sengaja TIDAK ditambahkan ke dokumen.',
      'Satu halaman .txt tanpa heading → pageSections → satu section → satu chunk (perilaku produksi sectionsFromPages + chunkSections).',
      'confidenceLevel="refused" adalah konsep lapisan AI-adapter; jalur deterministik produksi memakai query.guardrail. Keduanya dicatat.',
      'Guardrail AI-lane (checkGuardrails) hanya diagnostik; penilaian refusal memakai guardrail produksi dari answerQuestion.',
      'Tidak ada model lokal, tidak ada jaringan, tidak ada retry; deterministik dan bisa diulang.',
    ],
  };
}
