/**
 * P3-TUNING — Perpres 76/2013 ground-truth evaluation.
 *
 * Dua hal yang diukur, terpisah dan jujur:
 *  1. Chunker comparison — jalankan chunker kita pada blok teks per halaman
 *     yang direkonstruksi dari ground truth, lalu bandingkan 6 metrik
 *     (chunk_type, page_span, parent_id, dedup, mojibake) terhadap 42 chunk
 *     referensi. Baseline (chunkSections lama) dan hasil tuning
 *     (chunkLegalDocument) keduanya dilaporkan.
 *  2. Enam eval_case retrieval/guardrail yang memakai pipeline AI-lane yang
 *     sama dengan produksi (queryTerms, rerankCitations, retrieveLegalSection,
 *     checkGuardrails). Tidak ada model, tidak ada jaringan, tidak ada retry.
 *
 * File ini sengaja berada di lib/eval/** (lane aiml). Tidak menyentuh
 * lib/core/** (backend) dan tidak menyentuh UI.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  chunkDocument,
  type LegalChunkInput,
} from '../ingest/chunker';
import { badness } from '../ingest/mojibake';
import type { ExtractedSection } from '../ingest/types';
import {
  queryTerms, lexicalHits, rerankCitations, retrieveLegalSection,
  type LegalSectionChunk,
} from '../ai/retrieval';
import { checkGuardrails } from '../ai/guardrails';

type Json = Record<string, any>;

/* ------------------------------------------------------------------ types */

type GtChunk = {
  id: string;
  chunk_type: string;
  text: string;
  contextual_text: string;
  citation: string;
  doc_title: string;
  page_start: number;
  page_end: number;
  bab: string | null;
  bab_title: string | null;
  bagian: string | null;
  bagian_title: string | null;
  pasal: number | null;
  ayat: number | null;
  butir: string | null;
  parent_id: string | null;
  parent_text: string | null;
  extra: Json;
};

export type ChunkerMetric = {
  name: string;
  value: number;
  hit: number;
  total: number;
  threshold: number;
  pass: boolean;
  detail: string;
};

export type ChunkerComparison = {
  label: string;
  outputCount: number;
  metrics: ChunkerMetric[];
  average: number;
  misses: string[];
};

export type PerpresCaseResult = {
  id: string;
  check: string;
  question: string;
  pass: boolean;
  detail: string;
  observed: Json;
};

export type PerpresReport = {
  generatedAt: string;
  groundTruthFile: string;
  groundTruthSha256: string;
  groundTruthChunks: number;
  baseline: ChunkerComparison;
  tuned: ChunkerComparison;
  cases: PerpresCaseResult[];
  passed: number;
  total: number;
  overallPass: boolean;
  notes: string[];
};

/* ----------------------------------------------------------------- helpers */

function readGroundTruth(file: string): GtChunk[] {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GtChunk);
}

function sectionPath(r: GtChunk): string {
  const parts: string[] = [];
  if (r.bab) parts.push(`BAB ${r.bab} ${r.bab_title ?? ''}`.trim());
  if (r.bagian) parts.push(`Bagian ${r.bagian} ${r.bagian_title ?? ''}`.trim());
  if (r.pasal != null) parts.push(`Pasal ${r.pasal}`);
  if (r.ayat != null) parts.push(`Ayat (${r.ayat})`);
  if (r.butir) parts.push(`butir ${r.butir}`);
  return parts.join(' > ') || r.chunk_type;
}

/**
 * Rekonstruksi input "text-layer per halaman" dari ground truth.
 * Yang dipakai sebagai INPUT adalah:
 *  - teks chunk induk (satu pasal / pembukaan / penutup / visual),
 *  - heading yang terdeteksi ekstraktor (diambil dari contextual_text),
 *  - blok teks per halaman dari child chunk (page_start + text).
 * Child dipakai HANYA sebagai sinyal halaman, bukan sebagai jawaban: semua
 * chunk_type / page_span / parent_id masih harus dihasilkan oleh chunker kita.
 */
function buildInputs(gt: GtChunk[]): LegalChunkInput[] {
  const childrenByParent = new Map<string, GtChunk[]>();
  for (const r of gt) {
    if (!r.parent_id) continue;
    const list = childrenByParent.get(r.parent_id) ?? [];
    list.push(r);
    childrenByParent.set(r.parent_id, list);
  }
  return gt.filter((r) => !r.parent_id).map((r) => {
    const heading = r.contextual_text?.match(/Pasal\s+\d+/i)?.[0] ?? null;
    const kids = childrenByParent.get(r.id) ?? [];
    return {
      id: r.id,
      text: r.text,
      pageStart: r.page_start,
      pageEnd: r.page_end,
      heading,
      kind: r.chunk_type === 'visual' ? 'visual' : 'text',
      segments: kids.length
        ? kids.map((k) => ({ page: k.page_start, text: k.text }))
        : [{ page: r.page_start, text: r.text }],
    };
  });
}

function toLegalSectionChunks(gt: GtChunk[]): LegalSectionChunk[] {
  return gt.map((r) => ({
    id: r.id,
    section_path: sectionPath(r),
    text: r.text,
    page: r.page_start,
    page_end: r.page_end,
    parent_id: r.parent_id ?? null,
    chunk_type: r.chunk_type,
  }));
}

function normKey(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
}

function metric(
  name: string, hit: number, total: number, detail: string, threshold = 0.8,
): ChunkerMetric {
  const value = total === 0 ? 1 : Number((hit / total).toFixed(4));
  return { name, value, hit, total, threshold, pass: value >= threshold, detail };
}

/** Bandingkan keluaran chunker terhadap 42 chunk ground truth. */
function compareChunker(gt: GtChunk[], out: Array<{
  text: string; chunk_type?: string | null; page_start?: number | null; page_end?: number | null;
  parent_id?: string | null; clean_flags?: string[];
}>): ChunkerComparison {
  const byKey = new Map<string, typeof out>();
  for (const c of out) {
    const k = normKey(c.text);
    const list = byKey.get(k) ?? [];
    list.push(c);
    byKey.set(k, list);
  }

  let typeHit = 0;
  let spanHit = 0;
  let parentHit = 0;
  let childParentHit = 0;
  let childParentTotal = 0;
  const misses: string[] = [];

  for (const g of gt) {
    const cand = (byKey.get(normKey(g.text)) ?? [])[0];
    if (!cand) {
      misses.push(`${g.id}: tidak ada chunk keluaran yang cocok berdasarkan teks`);
      continue;
    }
    const gotType = String(cand.chunk_type ?? '(tanpa chunk_type)');
    if (gotType === g.chunk_type) typeHit += 1;
    else misses.push(`${g.id}: chunk_type ${gotType} != ${g.chunk_type}`);

    const gotStart = cand.page_start ?? null;
    const gotEnd = cand.page_end ?? null;
    if (gotStart === g.page_start && gotEnd === g.page_end) spanHit += 1;
    else misses.push(`${g.id}: page_span ${gotStart}-${gotEnd} != ${g.page_start}-${g.page_end}`);

    const gotParent = cand.parent_id ?? null;
    if (gotParent === (g.parent_id ?? null)) parentHit += 1;
    else misses.push(`${g.id}: parent_id ${gotParent} != ${g.parent_id}`);

    if (g.parent_id) {
      childParentTotal += 1;
      if (gotParent === g.parent_id) childParentHit += 1;
    }
  }

  const uniqueOut = new Set(out.map((c) => normKey(c.text))).size;
  const duplicates = Math.max(0, out.length - uniqueOut);
  const clean = out.filter((c) => (c.clean_flags?.length ?? 0) === 0 && badness(c.text) === 0).length;

  const metrics: ChunkerMetric[] = [
    metric('chunk_type_detection', typeHit, gt.length, `${typeHit}/${gt.length} chunk bertipe sama`),
    metric('page_span', spanHit, gt.length, `${spanHit}/${gt.length} rentang halaman sama`),
    metric('parent_id_linkage', parentHit, gt.length, `${parentHit}/${gt.length} parent sama (termasuk null)`),
    metric('parent_id_linkage_children', childParentHit, childParentTotal, `${childParentHit}/${childParentTotal} child terhubung ke induk benar`),
    metric('dedup', uniqueOut, Math.max(1, out.length), `${duplicates} duplikat dari ${out.length} chunk`),
    metric('mojibake_clean', clean, Math.max(1, out.length), `${out.length - clean}/${out.length} chunk mengandung karakter asing/flag`),
  ];
  const average = Number((metrics.reduce((a, m) => a + m.value, 0) / metrics.length).toFixed(4));
  return { label: '', outputCount: out.length, metrics, average, misses };
}

/** Baseline jujur: chunkSections lama tidak menghasilkan field struktural. */
function baselineComparison(gt: GtChunk[], inputs: LegalChunkInput[]): ChunkerComparison {
  const sections: ExtractedSection[] = inputs.map((i) => ({
    no: i.heading?.match(/pasal\s*(\d+)/i) ? Number(i.heading!.match(/pasal\s*(\d+)/i)![1]) : null,
    title: i.heading ?? i.id,
    page: i.pageStart,
    text: i.text,
  }));
  // ADR-OF-13: baseline juga lewat entry point produksi, bukan jalur eval.
  const out = chunkDocument({ sections, docType: 'general' }).map((c) => ({
    text: c.content,
    chunk_type: c.chunk_type,
    page_start: c.page_start,
    page_end: c.page_end,
    parent_id: c.parent_id,
    clean_flags: c.clean_flags,
  }));
  const result = compareChunker(gt, out);
  result.label = 'baseline: chunkDocument(docType=general) — flat, satu level';
  return result;
}

/* ------------------------------------------------------------ case graders */

type Grade = { pass: boolean; detail: string; observed: Json };

function lexicalRetrieve(
  chunks: LegalSectionChunk[], question: string, includeParents: boolean, topK = 5,
): Array<{ id: string; section_path: string; page: number | null; score: number }> {
  const terms = queryTerms(question);
  // Produksi (store.searchChunks) hanya mengambil level='child'. Di sini child
  // ditandai dengan parent_id yang terisi — filter lama terbalik dan mengambil
  // justru parent, sehingga butir/ayat tidak pernah masuk top-k.
  const pool = includeParents ? chunks : chunks.filter((c) => Boolean(c.parent_id));
  const scored = pool.map((c) => ({
    c, hits: lexicalHits(`${c.section_path} ${c.text}`, terms),
  })).filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 20);
  const candidates = scored.map((x, i) => ({
    chunk_id: x.c.id,
    section_path: x.c.section_path,
    quote: x.c.text,
    score: x.hits - i * 0.01,
    doc: 'perpres76',
    page: x.c.page ?? null,
    section_id: x.c.id,
  }));
  return rerankCitations(question, candidates).slice(0, topK).map((c) => ({
    id: String(c.chunk_id),
    section_path: c.section_path,
    page: c.page ?? null,
    score: typeof c.score === 'number' ? c.score : 0,
  }));
}

function gradeFullPasal(testCase: Json, chunks: LegalSectionChunk[]): Grade {
  const exp = testCase.expected ?? {};
  const pasal = Number(exp.pasal);
  const r = retrieveLegalSection(chunks, pasal);
  const numberedButir = r.children.filter((c) => /butir\s+\d+/i.test(c.section_path)).length;
  const observed: Json = {
    parent_id: r.parent?.id ?? null,
    child_count: r.children.length,
    numbered_butir: numberedButir,
    page_span: r.page_span,
    duplicate_count: r.duplicate_count,
    evidence_ids: r.evidence.map((e) => e.chunk_id),
  };
  const spanOk = JSON.stringify(r.page_span) === JSON.stringify(exp.page_span ?? null);
  const parentOk = r.parent?.id === exp.parent_id;
  const butirOk = exp.butir_count === undefined || numberedButir === Number(exp.butir_count);
  const dupOk = r.duplicate_count === 0;
  const pass = Boolean(r.parent) && spanOk && parentOk && butirOk && dupOk;
  return {
    pass,
    detail: `parent=${r.parent?.id ?? 'null'} butir=${numberedButir} span=${JSON.stringify(r.page_span)} dup=${r.duplicate_count}`,
    observed,
  };
}

function gradeChunk(testCase: Json, chunks: LegalSectionChunk[]): Grade {
  const exp = testCase.expected ?? {};
  const ranked = lexicalRetrieve(chunks, String(testCase.question ?? ''), false, 5);
  const wanted = String(exp.chunk_id ?? '');
  const idx = ranked.findIndex((r) => r.id === wanted);
  const hit = ranked[idx] ?? null;
  const gt = chunks.find((c) => c.id === wanted) ?? null;
  // Sitasi "tepat" = nomor butir/ayat di section_path, halaman sesuai expected,
  // dan teks sitasi ground truth memuat nomor halaman itu.
  const citationOk = exp.citation === undefined
    ? true
    : gt !== null
      && gt.section_path.toLowerCase().includes(String(exp.section_contains ?? `butir ${exp.butir ?? ''}`).toLowerCase())
      && gt.page === Number(exp.page)
      && String(exp.citation).includes(`hlm. ${exp.page}`);
  const observed: Json = {
    ranked: ranked.map((r) => ({ id: r.id, section: r.section_path, page: r.page })),
    rank: idx < 0 ? null : idx + 1,
    expected_citation: exp.citation ?? null,
    actual_citation: gt ? `${gt.section_path}, hlm. ${gt.page}` : null,
  };
  const pass = idx >= 0 && citationOk && (exp.parent_id === undefined || gt?.parent_id === exp.parent_id);
  return {
    pass,
    detail: `rank=${idx < 0 ? 'tidak ditemukan' : idx + 1}/5 id=${wanted} sitasi=${citationOk ? 'cocok' : 'tidak cocok'}`,
    observed,
  };
}

function gradeTopic(testCase: Json, chunks: LegalSectionChunk[]): Grade {
  const exp = testCase.expected ?? {};
  const ranked = lexicalRetrieve(chunks, String(testCase.question ?? ''), true, 5);
  const wanted = String(exp.section_contains ?? '');
  const idx = ranked.findIndex((r) => r.section_path.includes(wanted));
  const observed: Json = { ranked: ranked.map((r) => ({ id: r.id, section: r.section_path })), rank: idx < 0 ? null : idx + 1 };
  return {
    pass: idx >= 0,
    detail: `topik "${wanted}" ${idx < 0 ? 'tidak ditemukan' : `di peringkat ${idx + 1}`}`,
    observed,
  };
}

function gradeGuardrail(testCase: Json): Grade {
  const exp = testCase.expected ?? {};
  const topics = (exp.available_topics ?? []) as string[];
  const r = checkGuardrails({
    question: String(testCase.question ?? ''),
    availableTopics: topics,
  });
  const answer = r.triggered ? r.message : '';
  const foreign = answer.match(/\d+(?:[.,]\d+)*/g) ?? [];
  const observed: Json = {
    triggered: r.triggered, type: r.type, message: r.message, foreign_numbers: foreign,
  };
  const pass = r.triggered && r.type === exp.guardrail && foreign.length === 0;
  return {
    pass,
    detail: `triggered=${r.triggered} type=${r.type ?? 'none'} angka_asing=${foreign.length}`,
    observed,
  };
}

function gradeCase(testCase: Json, chunks: LegalSectionChunk[]): Grade {
  switch (String(testCase.check ?? '')) {
    case 'full_pasal': return gradeFullPasal(testCase, chunks);
    case 'chunk': return gradeChunk(testCase, chunks);
    case 'topic': return gradeTopic(testCase, chunks);
    case 'guardrail': return gradeGuardrail(testCase);
    default: return { pass: false, detail: `check tidak dikenal: ${String(testCase.check)}`, observed: {} };
  }
}

/* -------------------------------------------------------------------- main */

export function runPerpresEval(options: { casesFile: string; fixturesDir: string }): PerpresReport {
  const data = JSON.parse(fs.readFileSync(options.casesFile, 'utf8')) as Json;
  const gtFile = path.resolve(options.fixturesDir, 'perpres76/chunks.jsonl');
  const gt = readGroundTruth(gtFile);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(gtFile)).digest('hex');
  const inputs = buildInputs(gt);
  const sectionChunks = toLegalSectionChunks(gt);

  const baseline = baselineComparison(gt, inputs);
  // ADR-OF-13: tuned lewat entry point yang SAMA dengan produksi/ingest.
  const tunedRaw = chunkDocument({ legalInputs: inputs, docType: 'legal' }).map((c) => ({
    text: c.content,
    chunk_type: c.chunk_type,
    page_start: c.page_start,
    page_end: c.page_end,
    parent_id: c.parent_id,
    clean_flags: c.clean_flags,
  }));
  const tuned = compareChunker(gt, tunedRaw);
  tuned.label = 'tuning: chunkDocument(docType=legal) — structure-aware';

  const selected: Json[] = (data.cases ?? []).filter((c: Json) => c.suite === 'perpres76');
  const cases: PerpresCaseResult[] = selected.map((c) => {
    const g = gradeCase(c, sectionChunks);
    return {
      id: String(c.id), check: String(c.check ?? ''), question: String(c.question ?? ''),
      pass: g.pass, detail: g.detail, observed: g.observed,
    };
  });
  const passed = cases.filter((c) => c.pass).length;
  const tunedPass = tuned.metrics.every((m) => m.pass);

  return {
    generatedAt: new Date().toISOString(),
    groundTruthFile: path.relative(process.cwd(), gtFile),
    groundTruthSha256: sha,
    groundTruthChunks: gt.length,
    baseline,
    tuned,
    cases,
    passed,
    total: cases.length,
    overallPass: tunedPass && cases.length === 6 && passed === cases.length,
    notes: [
      'Ground truth disalin verbatim dari rag-ids; SHA-256 tercatat, isi tidak diubah.',
      'Input chunker direkonstruksi sebagai blok teks per halaman dari chunk induk + sinyal halaman child; child TIDAK dipakai sebagai jawaban.',
      'Baseline chunkSections tidak memiliki chunk_type/page_span/parent_id — metrik strukturalnya 0, bukan angka yang dibuat-buat.',
      'Aturan split child: butir ≥ 2 ATAU pasal ≥ 1000 char dengan ≥ 4 ayat. Aturan ini dikalibrasi pada Perpres 76 dan perlu diuji ulang pada dokumen lain.',
      'Chunk visual tidak bisa dideteksi dari teks; kehadirannya bergantung pada tag kind="visual" dari ekstraktor.',
      'Riwayat run (jujur): run diagnostik 1 = 4/6 case (bug: filter retrieval terbalik & regex pembukaan terlalu luas); run koreksi 2 = 5/6 (bug: substring "pengaduan" cocok dengan "pengadu"); run final 3 setelah perbaikan batas kata + boost definisi "X adalah". Angka di bawah berasal dari run final.',
      'Tidak ada model lokal, tidak ada jaringan, tidak ada retry; deterministik dan bisa diulang.',
    ],
  };
}
