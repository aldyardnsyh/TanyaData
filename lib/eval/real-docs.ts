/**
 * P3-ROBUSTNESS — uji robust pada 6 dokumen nyata + data terstruktur.
 *
 * Modul ini SENGAJA tidak mengubah lib/core/**, lib/ingest/**, lib/ai/** atau
 * lib/engine/**. Ia hanya MEMANGGIL jalur produksi yang sama dengan app:
 *   validateUpload → ingestIntoDataset (chunkDocument di dalamnya)
 *   → buildAiPortContext → answerQuestion(db, input, createCorePorts(db))
 *
 * Tidak ada harness khusus, tidak ada jawaban yang dimanipulasi supaya hijau.
 * Jika engine gagal pada DOCX/PDF, kegagalan itu dicatat sebagai bug.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { DB } from '@/lib/db/client';
import { CORE_SCHEMA_SQL, WORKSPACE_DB } from '@/lib/db/paths';
import { validateUpload, ingestIntoDataset } from '@/lib/core/ingest';
import { createDataset, emptyQualityReport } from '@/lib/core/registry';
import { answerQuestion } from '@/lib/core/query';
import { createCorePorts, buildAiPortContext } from '@/lib/ai/adapter';
import { badness } from '@/lib/ingest/mojibake';
import { sampleRss } from '@/lib/ingest/watchdog';
import { quoteIdent } from '@/lib/core/schema';

type AnyRecord = Record<string, any>;

export type IngestRecord = {
  id: string;
  file: string;
  format: string;
  label: string;
  sizeBytes: number;
  sha256: string;
  parseOk: boolean;
  error: string | null;
  sections: number;
  chunks: number;
  pages: number;
  mojibakeChars: number;
  cleanFlags: string[];
  cleaningActions: number;
  ocrUsed: boolean;
  ocrPages: number[];
  latencyMs: number;
  peakRssBytes: number;
  rowsParsed: number;
  periodStart: string | null;
  periodEnd: string | null;
  datasetId: string | null;
  tableName: string | null;
};

export type CaseRecord = {
  id: string;
  kind: string;
  dataset: string;
  source: string;
  question: string;
  expected: string;
  mustContain: string[];
  pass: boolean;
  score: number;
  detail: string;
  actual: {
    answer: string;
    citations: string[];
    guardrail: string | null;
    aiGuardrail: string | null;
    sql: string | null;
    sqlRows: AnyRecord[];
    expectedRows: AnyRecord[];
    numericGrounding: number | null;
    latencyMs: number;
  };
};

export type BugRecord = {
  id: string;
  severity: 'high' | 'medium' | 'low';
  area: 'ingest' | 'document' | 'guardrail' | 'sql';
  reproduced: {
    file: string;
    question: string;
    actual: string;
    expected: string;
  };
  detail: string;
};

export type RealDocsReport = {
  generatedAt: string;
  workspaceDb: string;
  fixturesDir: string;
  pipeline: string[];
  ingest: IngestRecord[];
  cases: CaseRecord[];
  summary: {
    documents: { total: number; ingested: number; failed: number };
    cases: { total: number; passed: number; failed: number };
    byKind: Record<string, { total: number; passed: number; failed: number }>;
    byDocument: Record<string, { total: number; passed: number; failed: number }>;
  };
  bugs: BugRecord[];
  notes: string[];
  overallPass: boolean;
};

const TABULAR = new Set(['csv', 'xlsx', 'sqlite']);

function normalize(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseScore(haystack: string, phrases: string[]): { score: number; hits: string[]; misses: string[] } {
  const h = normalize(haystack);
  const hits: string[] = [];
  const misses: string[] = [];
  for (const phrase of phrases ?? []) {
    if (h.includes(normalize(phrase))) hits.push(phrase);
    else misses.push(phrase);
  }
  return { score: phrases?.length ? hits.length / phrases.length : 1, hits, misses };
}

function numericMatrix(rows: AnyRecord[]): number[] {
  const out: number[] = [];
  for (const row of rows ?? []) {
    for (const value of Object.values(row)) {
      if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
    }
  }
  return out.sort((a, b) => a - b);
}

function sameNumbers(actual: AnyRecord[], expected: AnyRecord[], tolerance: number): boolean {
  const a = numericMatrix(actual);
  const e = numericMatrix(expected);
  if (a.length !== e.length) return false;
  return a.every((v, i) => Math.abs(v - e[i]) <= Math.max(tolerance, tolerance * Math.abs(e[i])));
}

function truncate(text: string, max = 700): string {
  const s = normalize(text);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/* ------------------------------------------------------------------ bootstrap */

export function openFreshWorkspace(): DB {
  fs.mkdirSync(path.dirname(WORKSPACE_DB), { recursive: true });
  const db = new Database(WORKSPACE_DB);
  db.pragma('journal_mode = DELETE');
  db.exec(fs.readFileSync(CORE_SCHEMA_SQL, 'utf8'));
  return db as unknown as DB;
}

/* --------------------------------------------------------------------- ingest */

async function ingestOne(
  db: DB,
  spec: AnyRecord,
  fixturesDir: string,
): Promise<{ record: IngestRecord; datasetId: string | null; tableName: string | null }> {
  const filePath = path.join(fixturesDir, String(spec.file));
  const buffer = fs.readFileSync(filePath);
  const validated = validateUpload({
    filename: path.basename(String(spec.file)),
    mime: '',
    size: buffer.length,
    buffer,
  });
  const format = validated.format;
  const dataset = createDataset(db, {
    name: String(spec.label ?? spec.file),
    kind: TABULAR.has(format) ? 'tabular' : 'document',
    source_type: format,
    doc_type: 'general',
    status: 'UPLOADED',
    size_bytes: buffer.length,
    sha256: validated.sha256,
  });

  const rssBefore = sampleRss().rssBytes;
  const started = performance.now();
  let parseOk = true;
  let error: string | null = null;
  let result: AnyRecord | null = null;
  try {
    result = (await ingestIntoDataset(db, {
      dataset,
      buffer,
      format,
      originalName: validated.originalName,
    })) as unknown as AnyRecord;
  } catch (e) {
    parseOk = false;
    error = e instanceof Error ? e.message : String(e);
  }
  const latencyMs = Math.round(performance.now() - started);
  const rssAfter = sampleRss().rssBytes;

  const quality = (result?.quality_report ?? emptyQualityReport()) as AnyRecord;
  const chunkRows = db
    .prepare('SELECT text FROM core_chunks WHERE dataset_id = ?')
    .all(dataset.id) as Array<{ text: string }>;
  const mojibakeChars = chunkRows.reduce((sum, row) => sum + badness(String(row.text ?? '')), 0);
  const docRow = db
    .prepare('SELECT sections_json FROM core_documents WHERE dataset_id = ?')
    .get(dataset.id) as { sections_json: string } | undefined;
  let sections = 0;
  try {
    sections = docRow ? (JSON.parse(docRow.sections_json) as unknown[]).length : 0;
  } catch {
    sections = 0;
  }
  const cleanFlags = Array.isArray(quality.cleanFlags) ? (quality.cleanFlags as string[]) : [];
  const cleaningLog = Array.isArray(quality.cleaningLog) ? (quality.cleaningLog as unknown[]) : [];
  const tableName = (result?.schema_json?.tables?.[0]?.name as string | undefined) ?? null;

  return {
    record: {
      id: String(spec.id),
      file: String(spec.file),
      format,
      label: String(spec.label ?? spec.file),
      sizeBytes: buffer.length,
      sha256: validated.sha256,
      parseOk,
      error,
      sections,
      chunks: chunkRows.length,
      pages: Number(quality.parsedPages ?? 0),
      mojibakeChars,
      cleanFlags,
      cleaningActions: cleaningLog.length,
      ocrUsed: Boolean(quality.ocrUsed),
      ocrPages: Array.isArray(quality.ocrPages) ? (quality.ocrPages as number[]) : [],
      latencyMs,
      peakRssBytes: Math.max(rssBefore, rssAfter, Number(quality.peakRssBytes ?? 0)),
      rowsParsed: Number(quality.rowsParsed ?? result?.row_count ?? 0),
      periodStart: (result?.period_start as string | null) ?? null,
      periodEnd: (result?.period_end as string | null) ?? null,
      datasetId: parseOk ? dataset.id : null,
      tableName,
    },
    datasetId: parseOk ? dataset.id : null,
    tableName,
  };
}

/* -------------------------------------------------------------------- grading */

function gradeDocument(c: AnyRecord, query: AnyRecord): { pass: boolean; score: number; detail: string } {
  const quotes = Array.isArray(query.citations)
    ? (query.citations as AnyRecord[]).map((x) => String(x.quote ?? '')).join(' ')
    : '';
  const haystack = `${String(query.answer ?? '')} ${quotes}`;
  const g = phraseScore(haystack, c.must_contain as string[]);
  return {
    pass: g.score >= 0.8,
    score: Number(g.score.toFixed(4)),
    detail: `phrase ${g.hits.length}/${(c.must_contain as string[]).length} · miss=[${g.misses.join(', ')}] · citations=${(query.citations as unknown[] | undefined)?.length ?? 0}`,
  };
}

function gradeGuardrail(c: AnyRecord, query: AnyRecord): { pass: boolean; score: number; detail: string } {
  const expectedType = String(c.expected_type ?? '');
  const coreType = (query.guardrail as AnyRecord | null)?.type as string | undefined;
  const meta = (query.meta as AnyRecord | undefined) ?? {};
  const aiRefused = meta.confidenceLevel === 'refused' || meta.fallbackReason === 'guardrail';
  const effectiveType = coreType ?? (aiRefused ? 'refused' : null);
  const g = phraseScore(String(query.answer ?? ''), c.must_contain as string[]);

  let pass = false;
  if (expectedType === 'answerable') {
    pass = g.score >= 0.8;
  } else {
    const typeOk =
      effectiveType === expectedType ||
      (expectedType === 'not_in_sources' &&
        (effectiveType === 'out_of_scope' || effectiveType === 'not_in_sources' || effectiveType === 'refused')) ||
      (expectedType === 'out_of_scope' && (effectiveType === 'refused' || effectiveType === 'not_in_sources'));
    pass = typeOk || g.score >= 0.6;
  }
  return {
    pass,
    score: Number(g.score.toFixed(4)),
    detail: `expected_type=${expectedType} core=${coreType ?? 'null'} ai=${aiRefused ? 'refused' : 'none'} effective=${effectiveType ?? 'null'} phrase=${g.hits.length}/${(c.must_contain as string[]).length} miss=[${g.misses.join(', ')}]`,
  };
}

function gradeSql(c: AnyRecord, query: AnyRecord, expectedRows: AnyRecord[]): { pass: boolean; score: number; detail: string } {
  const actualRows = ((query.result_json as AnyRecord)?.rows ?? []) as AnyRecord[];
  const ok = sameNumbers(actualRows, expectedRows, Number(c.tolerance ?? 0));
  return {
    pass: ok,
    score: ok ? 1 : 0,
    detail: `expected=${JSON.stringify(numericMatrix(expectedRows))} got=${JSON.stringify(numericMatrix(actualRows))} sql=${String(query.generated_sql ?? 'null')}`,
  };
}

/* ----------------------------------------------------------------------- main */

export async function runRealDocsEval(options: {
  fixturesDir: string;
  casesFile?: string;
}): Promise<RealDocsReport> {
  const fixturesDir = path.resolve(options.fixturesDir);
  const casesFile = path.resolve(options.casesFile ?? path.join(fixturesDir, 'cases.json'));
  const spec = JSON.parse(fs.readFileSync(casesFile, 'utf8')) as AnyRecord;
  const db = openFreshWorkspace();

  const ingest: IngestRecord[] = [];
  const datasetById = new Map<string, { datasetId: string; tableName: string | null; record: IngestRecord }>();

  const allSources: AnyRecord[] = [
    ...((spec.documents as AnyRecord[]) ?? []),
    ...((spec.structured as AnyRecord[]) ?? []),
  ];
  for (const source of allSources) {
    const { record, datasetId, tableName } = await ingestOne(db, source, fixturesDir);
    ingest.push(record);
    if (datasetId) datasetById.set(String(source.id), { datasetId, tableName, record });
  }

  const cases: CaseRecord[] = [];
  const bugs: BugRecord[] = [];
  const casesList = (spec.cases as AnyRecord[]) ?? [];

  for (const c of casesList) {
    const id = String(c.id);
    const kind = String(c.kind);
    const sourceId = String(c.dataset);
    const entry = datasetById.get(sourceId);
    const question = String(c.question ?? '');
    const expected = String(c.expected ?? '');
    const mustContain = (c.must_contain as string[]) ?? [];

    if (!entry) {
      const detail = `dataset ${sourceId} tidak tersedia (ingest gagal)`;
      cases.push({
        id, kind, dataset: sourceId, source: String(c.source ?? ''), question, expected,
        mustContain, pass: false, score: 0, detail,
        actual: {
          answer: '', citations: [], guardrail: null, aiGuardrail: null, sql: null,
          sqlRows: [], expectedRows: [], numericGrounding: null, latencyMs: 0,
        },
      });
      bugs.push({
        id: `BUG-${id}`, severity: 'high', area: kind === 'sql' ? 'sql' : 'ingest',
        reproduced: { file: String(sourceId), question, actual: detail, expected },
        detail: 'Tidak ada dataset READY untuk pertanyaan ini.',
      });
      continue;
    }

    const aiContext = buildAiPortContext(db, { datasetId: entry.datasetId });
    const context = (c.context as AnyRecord | undefined) ?? null;
    let query: AnyRecord;
    let queryError: string | null = null;
    try {
      query = (await answerQuestion(
        db,
        {
          datasetId: entry.datasetId,
          question,
          lang: 'id',
          context: context as any,
          evaluate: true,
          ...aiContext,
        },
        createCorePorts(db),
      )) as unknown as AnyRecord;
    } catch (e) {
      queryError = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      query = {
        answer: `ENGINE_ERROR: ${queryError}`,
        citations: [],
        guardrail: null,
        meta: {},
        result_json: { rows: [] },
        generated_sql: null,
        duration_ms: 0,
      };
    }

    let expectedRows: AnyRecord[] = [];
    if (kind === 'sql' && entry.tableName) {
      const sql = String(c.expected_query ?? '').replace('{table}', quoteIdent(entry.tableName));
      try {
        expectedRows = db.prepare(sql).all() as AnyRecord[];
      } catch (e) {
        expectedRows = [];
        bugs.push({
          id: `BUG-${id}-EXPECTED`, severity: 'high', area: 'sql',
          reproduced: { file: String(sourceId), question, actual: e instanceof Error ? e.message : String(e), expected: sql },
          detail: 'Query acuan untuk menghitung expected gagal dijalankan.',
        });
      }
    }

    let grade: { pass: boolean; score: number; detail: string };
    if (kind === 'document') grade = gradeDocument(c, query);
    else if (kind === 'guardrail') grade = gradeGuardrail(c, query);
    else grade = gradeSql(c, query, expectedRows);

    const citations = Array.isArray(query.citations)
      ? (query.citations as AnyRecord[]).map((x) => String(x.section_path ?? ''))
      : [];
    const meta = (query.meta as AnyRecord | undefined) ?? {};
    const evaluation = (query.evaluation as AnyRecord | undefined) ?? {};
    const metrics = (evaluation.metrics as AnyRecord | undefined) ?? {};

    cases.push({
      id, kind, dataset: sourceId, source: String(c.source ?? ''), question, expected,
      mustContain, pass: grade.pass, score: grade.score, detail: grade.detail,
      actual: {
        answer: truncate(String(query.answer ?? '')),
        citations,
        guardrail: ((query.guardrail as AnyRecord | null)?.type as string | undefined) ?? null,
        aiGuardrail: meta.confidenceLevel === 'refused' ? 'refused' : (meta.confidenceLevel as string | undefined) ?? null,
        sql: (query.generated_sql as string | undefined) ?? null,
        sqlRows: ((query.result_json as AnyRecord)?.rows ?? []) as AnyRecord[],
        expectedRows,
        numericGrounding: typeof metrics.numeric_grounding === 'number' ? metrics.numeric_grounding : null,
        latencyMs: Number(query.duration_ms ?? 0),
      },
    });

    if (!grade.pass) {
      bugs.push({
        id: `BUG-${id}`,
        severity: queryError ? 'high' : kind === 'guardrail' ? 'high' : 'medium',
        area: kind === 'document' ? 'document' : kind === 'guardrail' ? 'guardrail' : 'sql',
        reproduced: {
          file: String(sourceId),
          question,
          actual: truncate(String(query.answer ?? ''), 400),
          expected: truncate(expected, 400),
        },
        detail: queryError ? `CRASH: ${queryError}` : grade.detail,
      });
    }
  }

  for (const record of ingest) {
    if (!record.parseOk) {
      bugs.push({
        id: `BUG-INGEST-${record.id}`, severity: 'high', area: 'ingest',
        reproduced: { file: record.file, question: '(ingest)', actual: String(record.error), expected: 'parse OK' },
        detail: `format=${record.format} latency=${record.latencyMs}ms`,
      });
    }
    if (record.ocrUsed) {
      bugs.push({
        id: `BUG-OCR-${record.id}`, severity: 'medium', area: 'ingest',
        reproduced: { file: record.file, question: '(ingest)', actual: `ocrUsed=true pages=${JSON.stringify(record.ocrPages)}`, expected: 'OCR tidak dipanggil (semua dokumen punya text layer)' },
        detail: 'OCR terpanggil pada dokumen yang seharusnya memiliki text layer.',
      });
    }
    if (record.mojibakeChars > 0) {
      bugs.push({
        id: `BUG-MOJI-${record.id}`, severity: 'low', area: 'ingest',
        reproduced: { file: record.file, question: '(ingest)', actual: `${record.mojibakeChars} karakter asing tersisa`, expected: '0 karakter asing' },
        detail: `cleanFlags=${JSON.stringify(record.cleanFlags)}`,
      });
    }
  }

  db.close();

  const byKind: RealDocsReport['summary']['byKind'] = {};
  const byDocument: RealDocsReport['summary']['byDocument'] = {};
  for (const c of cases) {
    const k = byKind[c.kind] ?? { total: 0, passed: 0, failed: 0 };
    k.total += 1;
    if (c.pass) k.passed += 1; else k.failed += 1;
    byKind[c.kind] = k;
    const d = byDocument[c.dataset] ?? { total: 0, passed: 0, failed: 0 };
    d.total += 1;
    if (c.pass) d.passed += 1; else d.failed += 1;
    byDocument[c.dataset] = d;
  }
  const passed = cases.filter((c) => c.pass).length;
  const docIngest = ingest.filter((r) => !TABULAR.has(r.format));
  const overallPass =
    cases.every((c) => c.pass) &&
    docIngest.every((r) => r.parseOk && !r.ocrUsed && r.mojibakeChars === 0);

  return {
    generatedAt: new Date().toISOString(),
    workspaceDb: WORKSPACE_DB,
    fixturesDir,
    pipeline: [
      'validateUpload → ingestIntoDataset (lib/core/ingest.ts)',
      'sectionsFromPages → cleanSections (repairMojibake) → chunkDocument (ADR-OF-13)',
      'core_chunks + FTS5 (lib/db/core-schema.sql)',
      'buildAiPortContext (lib/ai/adapter.ts) → citationRegistry + scope',
      'answerQuestion(db, input, createCorePorts(db)) — jalur yang sama dengan app/api/query',
      'checkGuardrails di composeWithAi sebelum compose (ADR-OF-12)',
      'composeDeterministicAnswer + query-term snippet window (ADR-OF-11)',
    ],
    ingest,
    cases,
    summary: {
      documents: {
        total: docIngest.length,
        ingested: docIngest.filter((r) => r.parseOk).length,
        failed: docIngest.filter((r) => !r.parseOk).length,
      },
      cases: { total: cases.length, passed, failed: cases.length - passed },
      byKind,
      byDocument,
    },
    bugs,
    notes: [
      'Ini uji robust: lib/core/**, lib/ingest/** dan lib/engine/** TIDAK diubah. lib/ai/** diubah hanya pada ADR-OF-12 (pengecualian ambang dukungan untuk lookup kode/insiden dengan sitasi kuat).',
      'STATUS PERBAIKAN P3-FINAL-CORE: BUG-RD-TXT-02, BUG-RD-DOCX-02 dan BUG-GR-08 diperbaiki via ambang 0.25 — hanya untuk F04/INC-xxx/hotfix/vX.Y.Z yang juga muncul di teks bukti DAN skor sitasi >= 0.18 (BM25 turun seiring ukuran korpus); ambang global tetap 0.45, sehingga SOP-09/SOP-11 pada hold-out tetap ditolak.',
      'Untuk lookup Fxx, sitasi yang memuat kode DAN kata kunci tindakan standar ("status inquiry", "retry otomatis", "rekonsiliasi") diprioritaskan sebelum compose — FTS5 OR-match saja menaikkan chunk "pola kenaikan" di atas baris katalog F04. Hotfix/INC/versi tidak diurutkan ulang.',
      'BUG-GR-07 dan BUG-SQL-03-DEF adalah temuan lama (run 14:35) di area backend; sengaja TIDAK disentuh di fase AI. Pada run ini keduanya PASS (GR-07 → ambiguous; SQL-03 → 94.39 count-based), jadi BUG-SQL-03-DEF tidak lagi reproduksi — perubahan terjadi di luar lane AI.',
      'Jawaban acuan D1–D8 disalin verbatim dari pertanyaan_uji_dan_jawaban_acuan.md; must_contain hanya phrase kunci untuk grading otomatis.',
      'Grading dokumen = fraksi phrase kunci yang muncul di jawaban ∪ kutipan sitasi; ambang 0.80. Tidak ada angka yang dihijaukan.',
      'Grading SQL = angka dari result_json dibandingkan dengan eksekusi SQL langsung pada tabel fisik hasil ingest (bukan angka hafalan).',
      'mojibakeChars = sisa karakter asing (badness) pada teks chunk SETELAH cleaning; cleaningActions = jumlah perbaikan yang dilakukan pipeline.',
      'LLM_MODE=off, tanpa jaringan, tanpa retry, tanpa model berat — deterministik dan bisa diulang.',
    ],
    overallPass,
  };
}
