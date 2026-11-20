/**
 * Ground-truth evaluation harness (P3-CORE) — docs/CORE_AI_SPEC.md §7.
 *
 * This is NOT a product test suite. It runs the SAME pipeline as production —
 * `lib/core/**` (registry, SQL validator/executor, FTS5 retrieval, answer
 * composer) and `lib/ai/**` (classifier, extraction, output decision,
 * guardrails, grounding) — against four labelled fixtures and twelve cases,
 * then reports pass/fail per stage. No stage is mocked and no result is
 * massaged to look green: a failing stage is the point of the exercise.
 *
 * The workspace DB is redirected to a fresh temporary directory by the caller
 * (scripts/eval-ground-truth.mjs) before this module is imported, so the eval
 * never touches the real workspace or seed data.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { CORE_SCHEMA_SQL, SEED_DB, WORKSPACE_DB } from '../db/paths';
import { createDataset, emptySchema, emptyQualityReport } from '../core/registry';
import { answerQuestion } from '../core/query';
import { classifyDocument } from '../ai/classifier';
import { extractFields, findPasalByKeyword } from '../ai/extraction';
import { decideOutput, inferQuestionKind } from '../ai/output';
import { checkGuardrails } from '../ai/guardrails';
import { verifyGrounding } from '../ai/llm';
import type { DocType, OutputType } from '../ai/types';

/* ------------------------------------------------------------------ types */

type Json = Record<string, any>;

export type StageResult = {
  stage: string;
  metric: string;
  value: number;
  threshold: number;
  direction: 'min' | 'max';
  pass: boolean;
  detail: string;
};

export type CaseStage = { pass: boolean; detail: string };

export type CaseResult = {
  id: string;
  fixture: string;
  tags: string[];
  question: string;
  stages: Record<string, CaseStage>;
  observed: {
    doc_type?: string;
    output_type?: string;
    sql?: string | null;
    sql_rows?: unknown[][];
    citations?: string[];
    answer?: string;
    guardrail?: string | null;
    numeric_grounding?: number;
    foreign_numbers?: string[];
  };
};

export type EvalReport = {
  generatedAt: string;
  workspaceDb: string;
  fixtures: string[];
  caseCount: number;
  stages: StageResult[];
  cases: CaseResult[];
  byFixture: Record<string, { cases: number; passed: number; failed: number }>;
  overallPass: boolean;
  notes: string[];
};

const THRESHOLDS: Record<string, { metric: string; threshold: number; direction: 'min' | 'max' }> = {
  classification: { metric: 'accuracy', threshold: 0.90, direction: 'min' },
  extraction_precision: { metric: 'precision', threshold: 0.85, direction: 'min' },
  extraction_recall: { metric: 'recall', threshold: 0.80, direction: 'min' },
  retrieval: { metric: 'citation_hit_rate', threshold: 0.90, direction: 'min' },
  sql: { metric: 'execution_match', threshold: 0.90, direction: 'min' },
  output: { metric: 'appropriateness', threshold: 0.90, direction: 'min' },
  generation: { metric: 'hallucination_rate', threshold: 0.02, direction: 'max' },
  guardrail: { metric: 'accuracy', threshold: 0.90, direction: 'min' },
};

/* ------------------------------------------------------------------ helpers */

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Json;
}

function compactSignature(value: unknown, unit: unknown, currency: unknown, period: unknown): string {
  return [value, unit, currency, period]
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(String)
    .join('|');
}

function numericRows(rows: Array<Record<string, unknown>>): number[][] {
  return rows.map((row) => Object.values(row)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v)));
}

function sameNumbers(actual: number[][], expected: number[][], rel: number): boolean {
  const flatA = actual.flat().sort((a, b) => a - b);
  const flatE = expected.flat().sort((a, b) => a - b);
  if (flatA.length !== flatE.length) return false;
  return flatA.every((v, i) => Math.abs(v - flatE[i]) <= Math.max(rel, rel * Math.abs(flatE[i])));
}

function ratio(num: number, den: number): number {
  return den === 0 ? 1 : Number((num / den).toFixed(4));
}

/* ------------------------------------------------------------ db bootstrap */

type Prepared = { datasetId: string; fixture: Json; cases: Json[] };

function adaptSchema(fixture: Json): Json {
  const tables = (fixture.schema?.tables ?? []).map((t: Json) => ({
    name: t.name,
    // sourceName is the human-readable source label the generic rule builder
    // matches against the question. For the tabular fixture it is "transaksi",
    // taken from the fixture id — not a hardcoded intent or channel name.
    sourceName: fixture.id === 'transaksi' ? 'transaksi' : (t.sourceName ?? t.name),
    rowCount: t.row_count ?? 0,
    dateColumn: t.date_column ?? null,
    columns: (t.columns ?? []).map((c: Json) => ({
      name: c.name,
      sourceName: c.name,
      inferred_type: c.type === 'number' ? 'number' : 'text',
      semantic_role: c.semantic_role ?? 'text',
      nullable: true,
      distinct_count: (c.enum ?? []).length,
      sample_values: c.enum ?? [],
      unit: c.unit ?? null,
      description: c.description ?? null,
    })),
  }));
  return {
    version: 1,
    hash: `eval-${fixture.id}`,
    tables,
    relations: [],
    enums: fixture.schema?.enums ?? {},
  };
}

function prepareWorkspace(fixturesDir: string, casesFile: Json): Prepared[] {
  fs.mkdirSync(path.dirname(WORKSPACE_DB), { recursive: true });
  const db = new Database(WORKSPACE_DB);
  db.pragma('journal_mode = DELETE');
  db.exec(fs.readFileSync(CORE_SCHEMA_SQL, 'utf8'));

  const prepared: Prepared[] = [];
  const byFixture = new Map<string, Json[]>();
  for (const c of casesFile.cases as Json[]) {
    const list = byFixture.get(c.fixture) ?? [];
    list.push(c);
    byFixture.set(c.fixture, list);
  }

  for (const [rel, cases] of byFixture) {
    const fixture = readJson(path.join(fixturesDir, rel));
    const isTabular = Boolean(fixture.schema?.tables?.length);
    const dataset = createDataset(db, {
      id: `eval-${fixture.id}`,
      name: fixture.title ?? fixture.id,
      kind: isTabular ? 'tabular' : 'document',
      source_type: isTabular ? 'sqlite' : 'txt',
      doc_type: fixture.doc_type as DocType,
      status: 'READY',
      schema_json: isTabular ? adaptSchema(fixture) : emptySchema(),
      row_count: (fixture.rows ?? []).length,
      period_start: null,
      period_end: null,
      quality_report: emptyQualityReport(),
      is_demo: false,
    });

    if (isTabular) {
      // Copy the real seed rows into a physical table named after the fixture
      // schema. Ground-truth numbers in EVALUATION_QA.md come from this seed;
      // the fixture's 20-row aggregate preview is not the ground truth source.
      const table = dataset.schema_json.tables[0].name;
      const cols = dataset.schema_json.tables[0].columns.map((c: Json) => c.name as string);
      const defs = cols.map((c) => `"${c}" ${c === 'count' ? 'INTEGER' : 'TEXT'}`).join(', ');
      db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${defs})`);
      if (fs.existsSync(SEED_DB)) {
        db.prepare(`ATTACH DATABASE ? AS seedsrc`).run(SEED_DB);
        db.exec(
          `INSERT INTO "${table}" ("${cols[0]}", "${cols[1]}", "${cols[2]}", "${cols[3]}")
           SELECT transaction_date, status, 1, amount FROM seedsrc.transactions`,
        );
        db.exec('DETACH DATABASE seedsrc');
      } else {
        const insert = db.prepare(`INSERT INTO "${table}" VALUES (?, ?, ?, ?)`);
        for (const row of fixture.rows ?? []) insert.run(...(row as unknown[]));
      }
    } else {
      const docId = `doc-${fixture.id}`;
      db.prepare(
        `INSERT INTO core_documents(id, dataset_id, doc_type, mime, pages, sections_json, source_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(docId, dataset.id, fixture.doc_type, 'text/plain', 10, '[]', rel, new Date().toISOString());

      const idMap = new Map<string, number>();
      const insertChunk = db.prepare(
        `INSERT INTO core_chunks(document_id, dataset_id, section_path, page, text, token_count, char_count, level, parent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      // Parents first so child parent_id can reference a real rowid.
      for (const chunk of fixture.chunks ?? []) {
        if (chunk.parent_id) continue;
        const info = insertChunk.run(
          docId, dataset.id, chunk.section_path, chunk.page ?? null, chunk.text,
          Math.ceil(String(chunk.text).length / 4), String(chunk.text).length, 'parent', null,
        );
        idMap.set(chunk.id, Number(info.lastInsertRowid));
      }
      for (const chunk of fixture.chunks ?? []) {
        if (!chunk.parent_id) continue;
        insertChunk.run(
          docId, dataset.id, chunk.section_path, chunk.page ?? null, chunk.text,
          Math.ceil(String(chunk.text).length / 4), String(chunk.text).length, 'child',
          idMap.get(chunk.parent_id) ?? null,
        );
      }
    }
    prepared.push({ datasetId: dataset.id, fixture, cases });
  }
  db.close();
  return prepared;
}

/* ------------------------------------------------------------ stage graders */

function gradeClassification(fixture: Json, question: string): { pass: boolean; detail: string; docType: string } {
  const result = classifyDocument({
    text: fixture.sample_text ?? '',
    headings: (fixture.blocks ?? [])
      .filter((b: Json) => b.kind === 'heading' || b.kind === 'title')
      .map((b: Json) => b.text),
    metadata: fixture.metadata ?? {},
  });
  const expected = fixture.doc_type as DocType;
  return {
    pass: result.doc_type === expected,
    detail: `expected=${expected} got=${result.doc_type} conf=${result.confidence.toFixed(2)}`,
    docType: result.doc_type,
  };
}

function gradeExtraction(fixture: Json, testCase: Json): {
  pass: boolean; detail: string; tp: number; extracted: number; expectedN: number;
} {
  const expected = (testCase.expected.extracted_fields ?? {}) as Record<string, string>;
  const expectedN = Object.keys(expected).length;
  if (!expectedN) return { pass: true, detail: 'n/a', tp: 0, extracted: 0, expectedN: 0 };

  const result = extractFields(fixture.doc_type as DocType, fixture.blocks ?? []);
  const actual: Record<string, string> = {};

  if (fixture.doc_type === 'legal') {
    const topic = testCase.expected.topic as string | undefined;
    const wantedNo = expected.pasal;
    const pasal = topic
      ? findPasalByKeyword(result, topic)
      : result.pasal.find((p) => p.no === wantedNo) ?? null;
    if (pasal) {
      if (expected.pasal) actual.pasal = pasal.no;
      if (expected.ayat) actual.ayat = pasal.ayat.map((a) => a.no).join(',');
    }
  } else if (fixture.doc_type === 'technical_report') {
    for (const f of result.parameter) {
      actual[f.name] = compactSignature(f.value, f.unit, null, null);
    }
  } else if (fixture.doc_type === 'financial') {
    for (const f of result.metrik) {
      actual[f.name] = compactSignature(f.value, null, f.currency, f.period);
    }
  }

  let tp = 0;
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] === value) tp += 1;
  }
  const precision = ratio(tp, Object.keys(actual).length);
  const recall = ratio(tp, expectedN);
  return {
    pass: precision >= 0.85 && recall >= 0.80,
    detail: `tp=${tp} extracted=${Object.keys(actual).length} expected=${expectedN} P=${precision} R=${recall}`,
    tp, extracted: Object.keys(actual).length, expectedN,
  };
}

function gradeCitation(testCase: Json, citations: Array<{ section_path: string; document_id: string | null }>): {
  pass: boolean; detail: string; hit: number; total: number;
} {
  const expected = (testCase.expected.citations ?? []) as Json[];
  if (!expected.length) return { pass: true, detail: 'n/a', hit: 0, total: 0 };
  let hit = 0;
  for (const exp of expected) {
    const found = citations.some((c) => {
      const sectionOk = String(c.section_path).toLowerCase().includes(String(exp.section).toLowerCase());
      const docOk = !exp.doc || String(c.document_id ?? '').includes(String(exp.doc)) ||
        String(c.section_path).toLowerCase().includes(String(exp.doc).toLowerCase());
      if (!sectionOk || !docOk) return false;
      if (!exp.ayat) return true;
      return (exp.ayat as number[]).every((n) =>
        citations.some((x) => x.section_path.includes(`Ayat (${n})`) && x.section_path.includes(String(exp.section))));
    });
    if (found) hit += 1;
  }
  return { pass: hit === expected.length, detail: `${hit}/${expected.length} sitasi cocok`, hit, total: expected.length };
}

function gradeSql(testCase: Json, sqlRows: number[][] | null, sql: string | null): {
  pass: boolean; detail: string;
} {
  const expected = testCase.expected.sql_result;
  if (!expected) return { pass: true, detail: 'n/a' };
  if (!sqlRows) return { pass: false, detail: 'tidak ada eksekusi SQL (kandidat ditolak/tidak dibuat)' };
  const rel = Number(testCase.tolerance?.numeric_rel ?? 0);
  const ok = sameNumbers(sqlRows, expected.rows, rel);
  return { pass: ok, detail: `expected=${JSON.stringify(expected.rows)} got=${JSON.stringify(sqlRows)} sql=${sql ?? 'null'}` };
}

function gradeOutput(testCase: Json, docType: DocType, question: string, rowCount: number, citationCount: number): {
  pass: boolean; detail: string; outputType: string;
} {
  const expected = testCase.expected.output_type as OutputType;
  const kind = inferQuestionKind(question, docType);
  const decision = decideOutput({
    question,
    questionKind: kind,
    docType,
    dataType: rowCount > 0 ? 'structured' : citationCount > 0 ? 'document' : 'none',
    rowCount,
    categoryCount: rowCount > 1 ? rowCount : 0,
    entityCount: rowCount > 1 ? rowCount : 0,
    hasTime: /bulan|tahun|hari|Q[1-4]|2026/i.test(question),
    hasPeriod: /Q[1-4]|2026|bulan/i.test(question),
    hasCurrency: /IDR|Rp|rupiah/i.test(question),
    hasUnit: /m\b|psi|bbl|kedalaman|tekanan/i.test(question),
    hasVerifiableDate: /2026-\d{2}-\d{2}|harian/i.test(question),
    evidenceCount: citationCount + (rowCount > 0 ? 1 : 0),
  });
  return {
    pass: decision.type === expected,
    detail: `expected=${expected} got=${decision.type} kind=${kind} reason=${decision.reason}`,
    outputType: decision.type,
  };
}

function gradeGeneration(answer: string, allowed: number[]): {
  pass: boolean; detail: string; rate: number; foreign: string[];
} {
  const tokens = answer.match(/\d+(?:[.,]\d+)*/g) ?? [];
  const foreign = tokens.filter((t) => !verifyGrounding(t, allowed));
  const rate = ratio(foreign.length, tokens.length);
  return { pass: rate <= 0.02, detail: `foreign=${JSON.stringify(foreign)} tokens=${tokens.length}`, rate, foreign };
}

function gradeGuardrail(testCase: Json, question: string): { pass: boolean; detail: string; type: string | null } {
  const expected = testCase.expected.guardrail as string | undefined;
  const result = checkGuardrails({ question });
  if (!expected) {
    return { pass: !result.triggered, detail: `expected=none got=${result.type ?? 'none'}`, type: result.type };
  }
  return {
    pass: result.triggered && result.type === expected,
    detail: `expected=${expected} got=${result.type ?? 'none'}`,
    type: result.type,
  };
}

/* -------------------------------------------------------------------- main */

export async function runEval(options: { fixturesDir: string; casesFile: string }): Promise<EvalReport> {
  const casesFile = readJson(options.casesFile);
  const prepared = prepareWorkspace(options.fixturesDir, casesFile);
  const db = new Database(WORKSPACE_DB, { readonly: true, fileMustExist: true });
  db.pragma('query_only = 1');

  const notes: string[] = [];
  const cases: CaseResult[] = [];
  const counters: Record<string, { hit: number; total: number; tp: number; extracted: number; expectedN: number }> = {
    classification: { hit: 0, total: 0, tp: 0, extracted: 0, expectedN: 0 },
    extraction: { hit: 0, total: 0, tp: 0, extracted: 0, expectedN: 0 },
    retrieval: { hit: 0, total: 0, tp: 0, extracted: 0, expectedN: 0 },
    sql: { hit: 0, total: 0, tp: 0, extracted: 0, expectedN: 0 },
    output: { hit: 0, total: 0, tp: 0, extracted: 0, expectedN: 0 },
    generation: { hit: 0, total: 0, tp: 0, extracted: 0, expectedN: 0 },
    guardrail: { hit: 0, total: 0, tp: 0, extracted: 0, expectedN: 0 },
  };

  for (const entry of prepared) {
    for (const testCase of entry.cases) {
      const question = String(testCase.question ?? '');
      const stages: Record<string, CaseStage> = {};
      const observed: CaseResult['observed'] = {};

      const cls = gradeClassification(entry.fixture, question);
      stages.classification = { pass: cls.pass, detail: cls.detail };
      observed.doc_type = cls.docType;
      counters.classification.hit += cls.pass ? 1 : 0;
      counters.classification.total += 1;

      const ext = gradeExtraction(entry.fixture, testCase);
      stages.extraction = { pass: ext.pass, detail: ext.detail };
      counters.extraction.tp += ext.tp;
      counters.extraction.extracted += ext.extracted;
      counters.extraction.expectedN += ext.expectedN;

      const period = /bulan ini/i.test(question) && entry.fixture.id === 'transaksi'
        ? { start: '2026-11-01', end: '2026-11-18' }
        : null;
      const query = await answerQuestion(db, {
        datasetId: entry.datasetId,
        question,
        lang: 'id',
        context: period ? { period } : null,
        evaluate: true,
      });

      const citations = query.citations.map((c) => ({
        section_path: c.section_path,
        document_id: c.document_id,
      }));
      observed.citations = citations.map((c) => c.section_path);
      observed.sql = query.generated_sql;
      observed.answer = query.answer;
      observed.guardrail = query.guardrail?.type ?? null;
      observed.numeric_grounding = query.evaluation?.metrics.numeric_grounding ?? 1;

      const cit = gradeCitation(testCase, citations);
      if (cit.total) {
        stages.retrieval = { pass: cit.pass, detail: cit.detail };
        counters.retrieval.hit += cit.hit;
        counters.retrieval.total += cit.total;
      }

      const sqlRows = query.generated_sql ? numericRows(query.result_json.rows) : null;
      observed.sql_rows = sqlRows ?? [];
      const sqlGrade = gradeSql(testCase, sqlRows, query.generated_sql);
      if (testCase.expected.sql_result) {
        stages.sql = { pass: sqlGrade.pass, detail: sqlGrade.detail };
        counters.sql.hit += sqlGrade.pass ? 1 : 0;
        counters.sql.total += 1;
      }

      const out = gradeOutput(
        testCase,
        entry.fixture.doc_type as DocType,
        question,
        query.result_json.rowCount,
        citations.length,
      );
      stages.output = { pass: out.pass, detail: out.detail };
      observed.output_type = out.outputType;
      counters.output.hit += out.pass ? 1 : 0;
      counters.output.total += 1;

      const allowed = [
        ...(sqlRows?.flat() ?? []),
        ...(query.citations ?? []).flatMap((c) => `${c.section_path} ${c.quote ?? ''}`.match(/\d+(?:[.,]\d+)*/g) ?? [])
          .map((t) => Number(t.replace(/\./g, '').replace(',', '.')))
          .filter(Number.isFinite),
      ];
      const gen = gradeGeneration(query.answer, allowed);
      stages.generation = { pass: gen.pass, detail: gen.detail };
      observed.foreign_numbers = gen.foreign;
      counters.generation.hit += gen.pass ? 1 : 0;
      counters.generation.total += 1;

      const gr = gradeGuardrail(testCase, question);
      stages.guardrail = { pass: gr.pass, detail: gr.detail };
      counters.guardrail.hit += gr.pass ? 1 : 0;
      counters.guardrail.total += 1;

      cases.push({
        id: String(testCase.id),
        fixture: String(testCase.fixture).split('/')[0],
        tags: (testCase.tags ?? []).map(String),
        question,
        stages,
        observed,
      });
    }
  }
  db.close();

  const stageResults: StageResult[] = [];
  const push = (stage: string, metric: string, value: number, threshold: number, direction: 'min' | 'max', detail: string) => {
    stageResults.push({
      stage, metric, value, threshold, direction,
      pass: direction === 'min' ? value >= threshold : value <= threshold,
      detail,
    });
  };

  const c = counters;
  push('classification', 'accuracy', ratio(c.classification.hit, c.classification.total), 0.90, 'min',
    `${c.classification.hit}/${c.classification.total} kasus`);
  push('extraction', 'precision', ratio(c.extraction.tp, c.extraction.extracted), 0.85, 'min',
    `${c.extraction.tp}/${c.extraction.extracted} field`);
  push('extraction', 'recall', ratio(c.extraction.tp, c.extraction.expectedN), 0.80, 'min',
    `${c.extraction.tp}/${c.extraction.expectedN} field`);
  push('retrieval', 'citation_hit_rate', ratio(c.retrieval.hit, c.retrieval.total), 0.90, 'min',
    `${c.retrieval.hit}/${c.retrieval.total} sitasi (hanya kasus dokumen)`);
  push('sql', 'execution_match', ratio(c.sql.hit, c.sql.total), 0.90, 'min',
    `${c.sql.hit}/${c.sql.total} kasus SQL`);
  push('output', 'appropriateness', ratio(c.output.hit, c.output.total), 0.90, 'min',
    `${c.output.hit}/${c.output.total} kasus`);
  push('generation', 'hallucination_rate', ratio(c.generation.total - c.generation.hit, c.generation.total), 0.02, 'max',
    `${c.generation.total - c.generation.hit}/${c.generation.total} kasus mengandung angka asing`);
  push('guardrail', 'accuracy', ratio(c.guardrail.hit, c.guardrail.total), 0.90, 'min',
    `${c.guardrail.hit}/${c.guardrail.total} kasus`);

  const byFixture: EvalReport['byFixture'] = {};
  for (const name of ['transaksi', 'legal', 'drilling', 'finansial']) {
    const list = cases.filter((x) => x.fixture === name);
    const passed = list.filter((x) => Object.values(x.stages).every((s) => s.pass)).length;
    byFixture[name] = { cases: list.length, passed, failed: list.length - passed };
  }

  notes.push('Eval dijalankan sekali pada workspace DB sementara; seed analytics.db disalin ke tabel fisik tx_daily untuk kasus transaksi.');
  notes.push('Kasus TX-03 sengaja diharapkan gagal bila rule builder tidak memiliki pola rate — ini temuan, bukan bug harness.');
  notes.push('FIN-03 memuat instruksi injeksi; guardrail AI lane diuji terpisah dari guardrail core.');

  return {
    generatedAt: new Date().toISOString(),
    workspaceDb: WORKSPACE_DB,
    fixtures: prepared.map((p) => String(p.fixture.id)),
    caseCount: cases.length,
    stages: stageResults,
    cases,
    byFixture,
    overallPass: stageResults.every((s) => s.pass),
    notes,
  };
}

export { THRESHOLDS };
