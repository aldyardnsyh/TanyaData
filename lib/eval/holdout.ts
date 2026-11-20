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
import { chunkDocument } from '../ingest/chunker';
import { sectionsFromPages } from '../ingest/extract';
import type { ExtractedPage } from '../ingest/types';
import { buildAiPortContext, createCorePorts } from '../ai/adapter';
import { checkGuardrails, topicsFromRegistry } from '../ai/guardrails';

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
  thresholds: { answerable: number; refusal: number; hallucination: number; delta: number };
  /** ADR-OF-15 — baseline Perpres dengan METRIK SEJENIS (bukan 0,996 struktur). */
  baseline: { source: string; answerable_accuracy: number; refusal_accuracy: number };
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

/* -------------------------------------------------------------------------- */
/* ADR-OF-14 — allow-list bukti untuk grader angka asing.                       */
/*                                                                            */
/* SEBELUM: setiap token angka yang tidak ada di `c.quote` dianggap asing.      */
/* `composeDeterministicAnswer` menyisipkan `section_path` ("Halaman 1") di     */
/* badan teks DAN di `Sumber: Halaman 1`; itu metadata halaman sah, bukan       */
/* angka karangan. Akibatnya 10/11 kasus tertandai hallucinated padahal angka   */
/* karangan nyata = 0.                                                          */
/*                                                                            */
/* SESUDAH: allow-list = quote ∪ section_path ∪ label halaman dari `page` ∪     */
/* angka `result_json` (kasus tabular). Normalisasi spasi/tanda baca dulu.      */
/* Grader TETAP fail-closed: token di luar allow-list tetap dihitung asing.     */
/* -------------------------------------------------------------------------- */

type EvidenceLike = {
  section_path?: string | null;
  page?: number | null;
  quote?: string | null;
};

function numberTokens(s: string): string[] {
  return String(s ?? '').match(/\d+(?:[.,]\d+)*/g) ?? [];
}

/** "1.000"→"1000", "92,76"→"92.76", "1"→"1" — locale id, deterministik. */
function canonicalNumber(token: string): string {
  const t = String(token ?? '');
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return t.replace(/\./g, '');
  if (/^\d{1,3}(,\d{3})+$/.test(t)) return t.replace(/,/g, '');
  return t.replace(',', '.');
}

/**
 * ADR-OF-15 — baseline Perpres dengan metrik SEJENIS: answerable/refusal
 * per-case, bukan rata-rata 6 metrik struktur chunker (0,996) yang menyesatkan.
 * Sumber: hasil `npm run eval:ground-truth` yang sudah dijalankan lebih dulu.
 */
export function perpresLikeBaseline(): { source: string; answerable_accuracy: number; refusal_accuracy: number } {
  const resultFile = path.resolve(process.cwd(), 'docs/EVAL_GROUND_TRUTH_RESULT.json');
  try {
    const raw = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as Json;
    const cases = (raw?.perpres?.cases ?? []) as Json[];
    const answerable = cases.filter((c) => c.check !== 'guardrail');
    const refusal = cases.filter((c) => c.check === 'guardrail');
    return {
      source: path.relative(process.cwd(), resultFile),
      answerable_accuracy: ratio(answerable.filter((c) => c.pass === true).length, answerable.length),
      refusal_accuracy: ratio(refusal.filter((c) => c.pass === true).length, refusal.length),
    };
  } catch {
    // Fail-closed: tanpa baseline sejenis, gate tidak boleh dinyatakan lulus.
    return { source: 'MISSING:EVAL_GROUND_TRUTH_RESULT.json', answerable_accuracy: 1, refusal_accuracy: 1 };
  }
}

function evidenceAllowList(citations: EvidenceLike[], resultJson: unknown): Set<string> {
  const allowed = new Set<string>();
  const add = (s: string) => {
    for (const t of numberTokens(s)) allowed.add(canonicalNumber(t));
  };
  for (const c of citations ?? []) {
    add(String(c.quote ?? ''));
    add(String(c.section_path ?? ''));
    // Label halaman diturunkan dari metadata sitasi, bukan ditulis bebas.
    if (typeof c.page === 'number' && Number.isFinite(c.page)) {
      for (const label of [`Halaman ${c.page}`, `halaman ${c.page}`, `hal. ${c.page}`, `hlm ${c.page}`]) {
        add(label);
      }
    }
  }
  // Kasus tabular: angka sah berasal dari eksekusi SQL / result_json.
  add(JSON.stringify(resultJson ?? {}));
  return allowed;
}

export async function runHoldoutEval(options: { fixturesDir: string; casesFile: string }): Promise<HoldoutReport> {
  const docFile = path.resolve(options.fixturesDir, 'sop-layanan/document.txt');
  const raw = fs.readFileSync(docFile);
  const documentText = raw.toString('utf8').trim();
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  const data = JSON.parse(fs.readFileSync(options.casesFile, 'utf8')) as Json;

  /* ---- 1. CHUNKER — ADR-OF-13: entry point yang SAMA dengan produksi ------ */
  // Satu halaman teks → sectionsFromPages (format 'txt', tanpa heading) →
  // pageSections → satu section → chunkDocument({ docType: 'general' }).
  // TIDAK ada jalur khusus eval: backend/ingest memanggil entry point ini.
  const pages: ExtractedPage[] = [{ page: 1, text: documentText }];
  const sections = sectionsFromPages(pages, 'txt', 'SOP Layanan');
  const chunks = chunkDocument({ sections, docType: 'general', documentId: 'doc-sop-layanan' });

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
    `INSERT INTO core_chunks(document_id, dataset_id, section_path, page, text, token_count, char_count, level, parent_id, content_hash, page_span)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  chunks.forEach((c, i) => {
    // chunkDocument(docType='general') = chunkSections flat produksi: tidak
    // ada hierarki parent, semua chunk berlevel 'child' (syarat FTS5 search).
    insertChunk.run(
      docId, dataset.id, c.section ?? `chunk-${i}`, c.page ?? 1, c.content,
      Math.ceil(c.content.length / 4), c.charCount, 'child', null,
      c.content_hash ?? null, c.pageSpan ? JSON.stringify(c.pageSpan) : null,
    );
  });

  /* ---- 3..5. RETRIEVAL → GUARDRAIL → ANSWER via answerQuestion ----------- */
  // ADR-OF-12: topik dari registry dokumen aktif, BUKAN daftar hard-code.
  const registryTopics = topicsFromRegistry(
    chunks.map((c) => ({ section_path: c.section ?? null, text: c.content })),
  );
  const evidenceText = chunks.map((c) => c.content).join(' ');
  // ADR-OF-13: port produksi + registry/scope yang SAMA dengan app/api/query.
  // Tanpa citationRegistry, composeWithAi membuang SEMUA sitasi (rev=null →
  // MISSING_CHUNK) dan menjawab "tidak ditemukan" untuk setiap kasus.
  const ports = createCorePorts(db);
  const aiContext = buildAiPortContext(db, { datasetId: dataset.id });

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
      ...aiContext,
    }, ports);

    const answer = String(q.answer ?? '');
    const guardrailType = q.guardrail?.type ?? null;
    const evidence = (q.citations ?? []) as EvidenceLike[];
    const citations = evidence.map((c) => c.section_path ?? '');
    const quote = evidence.map((c) => String(c.quote ?? '')).join(' ');

    // Diagnostik: guardrail AI-lane dengan topik dari registry (bukan hardcode).
    // Sinyal ini JUGA dipakai produksi lewat createCorePorts → composeWithAi.
    const aiG = checkGuardrails({
      question,
      noEvidence: citations.length === 0,
      availableTopics: registryTopics,
      evidenceText,
    });

    // ADR-OF-14: angka pada jawaban harus masuk allow-list bukti.
    // `section_path` & label halaman adalah metadata sah, bukan angka karangan.
    const allow = evidenceAllowList(evidence, (q as { result_json?: unknown }).result_json);
    const tokens = numberTokens(answer);
    const foreign = tokens.filter((t) => !allow.has(canonicalNumber(t)));

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
  const baseline = perpresLikeBaseline();
  const thresholds = { answerable: 0.80, refusal: 0.80, hallucination: 0.02, delta: 0.15 };
  // Gate answerable/refusal/delta dihitung runner memakai helper backend
  // `evaluateHoldoutGate` (scripts/lib/holdout-gate.mjs). Modul ini menjaga
  // metrik + allow-list hallucination (ADR-OF-14); runner menimpa overallPass.
  const overallPass = metrics.hallucination_rate <= thresholds.hallucination;

  return {
    generatedAt: new Date().toISOString(),
    documentFile: path.relative(process.cwd(), docFile),
    documentSha256: sha,
    documentChars: documentText.length,
    chunkCount: chunks.length,
    chunkPreview: chunks.map((c) => c.content).join(' ').slice(0, 240),
    pipeline: [
      'sectionsFromPages(txt) → chunkDocument({docType:"general"})  [ADR-OF-13: entry point produksi]',
      'core_chunks + core_chunks_fts trigger  [lib/db/core-schema.sql]',
      'searchChunks via answerQuestion  [lib/core/store.ts]',
      'checkGuardrails via createCorePorts → composeWithAi  [ADR-OF-12: sebelum compose]',
      'composeDeterministicAnswer + query-term snippet window  [ADR-OF-11]',
    ],
    metrics,
    thresholds,
    baseline,
    cases,
    passed: aHit + rHit,
    total: cases.length,
    overallPass,
    notes: [
      'Uji buta: dokumen SOP layanan TIDAK dipakai saat kalibrasi Perpres 76. Aturan sudah diperbaiki (ADR-OF-11/12/13) lalu diuji buta di sini.',
      'Dokumen direkonstruksi verbatim dari 8 frasa ground_truth; 3 kasus "TIDAK ADA JAWABAN" sengaja TIDAK ditambahkan ke dokumen.',
      'Satu halaman .txt tanpa heading → pageSections → satu section → satu chunk (chunkDocument docType=general).',
      'ADR-OF-13: eval memakai entry point chunkDocument + createCorePorts yang SAMA dengan app/api/query dan lib/chat/messages.',
      'ADR-OF-12: checkGuardrails dipanggil di composeWithAi SEBELUM compose; availableTopics dari registry, bukan hard-code.',
      'ADR-OF-14: allow-list angka = quote ∪ section_path ∪ label halaman ∪ result_json; tetap fail-closed.',
      'ADR-OF-15: gate answerable ≥ 0,80 · refusal ≥ 0,80 · delta sejenis ≤ 0,15 masuk overallPass.',
      'Tidak ada model lokal, tidak ada jaringan, tidak ada retry; deterministik dan bisa diulang.',
    ],
  };
}
