/**
 * Dynamic text-to-SQL (P3-CORE) — docs/CORE_AI_SPEC.md §4,
 * docs/CORE_ARCHITECTURE.md §5.
 *
 * No aggregate SQL, table name or column name is hardcoded. Candidates are
 * built from `schema_json` + the question; every candidate passes the same
 * 7-layer fail-closed validator. Numbers are NEVER written by a model — they
 * come only from `executeSql`. When generation is unavailable or untrusted,
 * the rule builder returns an explicitly labelled `mode: "limited"` plan.
 */
import type {
  SchemaColumn, SchemaJson, SqlExecution, SqlPlan, SqlValidation,
} from './types';

const MAX_SQL_CHARS = 2000;
const ROW_CAP = 500;

const FORBIDDEN = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate',
  'attach', 'detach', 'pragma', 'vacuum', 'replace', 'load_extension',
  'reindex', 'analyze', 'begin', 'commit', 'rollback',
];

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'group', 'by', 'order', 'having', 'limit', 'offset',
  'as', 'and', 'or', 'not', 'in', 'is', 'null', 'like', 'between', 'case',
  'when', 'then', 'else', 'end', 'distinct', 'with', 'join', 'on', 'inner',
  'left', 'right', 'outer', 'cross', 'union', 'all', 'asc', 'desc', 'exists',
  'cast', 'collate', 'escape', 'filter', 'over', 'partition', 'rows', 'range',
  'sum', 'count', 'avg', 'min', 'max', 'round', 'coalesce', 'substr', 'strftime',
  'date', 'abs', 'ifnull', 'length', 'lower', 'upper', 'trim', 'printf',
  'true', 'false', 'current_date', 'current_timestamp',
]);

function stripLiterals(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/g, "''").replace(/"(?:[^"])*"/g, '""');
}

function allColumns(schema: SchemaJson): SchemaColumn[] {
  return schema.tables.flatMap((t) => t.columns ?? []);
}

/* ------------------------------------------------------------- validation */

/**
 * L1–L7 validator. Returns the normalised SQL (with LIMIT) on success.
 * `db` is optional: when supplied, L7 runs EXPLAIN QUERY PLAN as a dry run.
 */
export function validateSql(
  sqlRaw: string,
  schema: SchemaJson,
  db?: { prepare: (s: string) => { all: (...a: unknown[]) => unknown[] } },
  bindings: unknown[] = [],
): SqlValidation {
  const fail = (layer: string, message: string): SqlValidation => ({
    ok: false, errors: [message], failed_layer: layer,
  });

  let sql = String(sqlRaw ?? '').trim();

  // L1 lexical
  if (!sql || sql.length > MAX_SQL_CHARS) return fail('L1', 'sql_length_invalid');
  const bare = stripLiterals(sql);
  if (bare.includes('--') || bare.includes('/*') || bare.includes('*/')) {
    return fail('L1', 'sql_comment_forbidden');
  }
  const semi = (bare.match(/;/g) ?? []).length;
  if (semi > 1 || (semi === 1 && !bare.trimEnd().endsWith(';'))) {
    return fail('L1', 'multi_statement_forbidden');
  }
  sql = sql.replace(/;\s*$/, '').trim();

  // L2 statement
  if (!/^(select|with)\b/i.test(sql)) return fail('L2', 'statement_must_be_select');

  // L3 keyword
  for (const kw of FORBIDDEN) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(bare)) return fail('L3', `forbidden_keyword:${kw}`);
  }

  // L4 object
  const tableNames = new Set(schema.tables.map((t) => t.name.toLowerCase()));
  const objectMatches = bare.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w]*)/gi);
  for (const m of objectMatches) {
    if (!tableNames.has(m[1].toLowerCase())) return fail('L4', `table_not_in_schema:${m[1]}`);
  }
  if (/\b(?:from|join)\s+[a-zA-Z_][\w]*\s*\./i.test(bare)) {
    return fail('L4', 'qualified_table_forbidden');
  }

  // L5 column
  const columnNames = new Set(allColumns(schema).map((c) => c.name.toLowerCase()));
  const aliases = new Set(
    [...bare.matchAll(/\bas\s+([a-zA-Z_][\w]*)/gi)].map((m) => m[1].toLowerCase()),
  );
  const bareNoLiterals = stripLiterals(sql);
  for (const m of bareNoLiterals.matchAll(/\b[a-zA-Z_][\w]*\b/g)) {
    const id = m[0].toLowerCase();
    if (SQL_KEYWORDS.has(id) || tableNames.has(id) || columnNames.has(id) || aliases.has(id)) continue;
    if (FORBIDDEN.includes(id)) continue;
    return fail('L5', `identifier_not_in_schema:${m[0]}`);
  }

  // L6 limit
  const limitMatch = sql.match(/\blimit\s+(\d+)\b/i);
  if (!limitMatch) {
    sql = `${sql} LIMIT ${ROW_CAP}`;
  } else {
    const n = Number(limitMatch[1]);
    if (!Number.isFinite(n) || n > ROW_CAP) {
      sql = sql.replace(/\blimit\s+\d+\b/i, `LIMIT ${ROW_CAP}`);
    }
  }

  // L7 dry-run
  if (db) {
    try {
      db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings);
    } catch (e) {
      return fail('L7', `dry_run_failed:${(e as Error).message.slice(0, 120)}`);
    }
  }

  return { ok: true, errors: [], sql };
}

/* ------------------------------------------------------------ rule builder */

export interface RuleInput {
  question: string;
  schema: SchemaJson;
  /** Distinct values of the time column, ascending. Enables "bulan ini". */
  timeValues?: string[];
  context?: Record<string, unknown>;
}

function latestPeriod(input: RuleInput): string | null {
  const ctxPeriod = input.context?.period;
  if (typeof ctxPeriod === 'string' && ctxPeriod) return ctxPeriod;
  const values = input.timeValues ?? [];
  if (!values.length) return null;
  return [...values].sort().at(-1) ?? null;
}

function findTimeColumn(schema: SchemaJson): SchemaColumn | null {
  for (const t of schema.tables) {
    const c = t.columns.find((x) => x.semantic_role === 'time' || x.name === t.date_column);
    if (c) return c;
  }
  return null;
}

function findDimension(question: string, schema: SchemaJson): SchemaColumn | null {
  const q = question.toLowerCase();
  const dims = allColumns(schema).filter((c) => c.semantic_role === 'dimension');
  return dims.find((c) => q.includes(c.name.toLowerCase())) ?? null;
}

function findMeasure(question: string, schema: SchemaJson): SchemaColumn | null {
  const q = question.toLowerCase();
  const measures = allColumns(schema).filter((c) => c.semantic_role === 'measure');
  return measures.find((c) => q.includes(c.name.toLowerCase())) ?? measures[0] ?? null;
}

function matchEnumValue(question: string, dim: SchemaColumn): string | null {
  const q = question.toLowerCase();
  for (const v of dim.enum ?? dim.sample_values?.map(String) ?? []) {
    const s = String(v);
    if (s.length >= 3 && q.includes(s.toLowerCase())) return s;
  }
  return null;
}

/**
 * Generic rule builder. Supports count/sum, group, filter, rate and time-bucket
 * patterns. Anything outside these patterns returns a low-confidence plan that
 * the caller must treat as a clarification request, not an answer.
 */
export function buildRuleSql(input: RuleInput): SqlPlan {
  const { question, schema } = input;
  const q = question.toLowerCase();
  const table = schema.tables[0];
  if (!table) {
    return {
      sql: '', explanation: 'Tidak ada tabel pada skema aktif.', confidence: 0,
      referenced_tables: [], referenced_columns: [], params: {}, bindings: [],
      mode: 'limited', reason: 'no_table', supported_patterns: ['count', 'group', 'filter', 'rate', 'time'],
    };
  }

  const time = findTimeColumn(schema);
  const dim = findDimension(question, schema);
  const measure = findMeasure(question, schema);
  const period = latestPeriod(input);
  const bindings: unknown[] = [];
  const params: Record<string, string | number> = {};
  const where: string[] = [];

  if (time && period && /(bulan ini|this month|periode aktif|current|terbaru|latest)/i.test(q)) {
    where.push(`${time.name} = ?`);
    bindings.push(period);
    params.period = period;
  }

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const assumptions: string[] = [];
  if (where.length) assumptions.push(`periode=${period}`);

  // rate pattern: "<value> rate" resolved from a dimension enum, never hardcoded
  if (/\brate\b|\brasio\b|persentase/i.test(q) && dim) {
    const enumValue = matchEnumValue(question, dim);
    if (enumValue && measure) {
      bindings.unshift(enumValue);
      params.match = enumValue;
      const sql = `SELECT ROUND(100.0 * SUM(CASE WHEN ${dim.name} = ? THEN ${measure.name} ELSE 0 END) / SUM(${measure.name}), 2) AS rate FROM ${table.name}${whereSql}`;
      return {
        sql, explanation: `Menghitung rasio ${enumValue} terhadap total ${measure.name} pada ${table.name}${where.length ? ` (${where.join(', ')})` : ''}.`,
        confidence: 0.82, referenced_tables: [table.name],
        referenced_columns: [dim.name, measure.name], params, bindings,
        mode: 'limited', reason: 'rule_based', supported_patterns: ['count', 'group', 'filter', 'rate', 'time'],
      };
    }
  }

  // distribution / group pattern
  if (dim && measure && /(distribusi|distribution|per\s|group|komposisi|breakdown)/i.test(q)) {
    const sql = `SELECT ${dim.name}, SUM(${measure.name}) AS jumlah FROM ${table.name}${whereSql} GROUP BY ${dim.name} ORDER BY jumlah DESC`;
    return {
      sql, explanation: `Mengelompokkan ${measure.name} per ${dim.name} dari ${table.name}${where.length ? ` pada periode ${period}` : ''}.`,
      confidence: 0.80, referenced_tables: [table.name],
      referenced_columns: [dim.name, measure.name], params, bindings,
      mode: 'limited', reason: 'rule_based', supported_patterns: ['count', 'group', 'filter', 'rate', 'time'],
    };
  }

  // filter pattern: explicit dimension value in question
  if (dim && measure) {
    const enumValue = matchEnumValue(question, dim);
    if (enumValue) {
      where.push(`${dim.name} = ?`);
      bindings.push(enumValue);
      params[dim.name] = enumValue;
      const sql = `SELECT SUM(${measure.name}) AS total FROM ${table.name} WHERE ${where.join(' AND ')}`;
      return {
        sql, explanation: `Menjumlahkan ${measure.name} pada ${table.name} dengan filter ${dim.name}=${enumValue}.`,
        confidence: 0.78, referenced_tables: [table.name],
        referenced_columns: [dim.name, measure.name], params, bindings,
        mode: 'limited', reason: 'rule_based', supported_patterns: ['count', 'group', 'filter', 'rate', 'time'],
      };
    }
  }

  // count / sum pattern
  if (measure && /(total|jumlah|berapa|sum|count|banyak)/i.test(q)) {
    const sql = `SELECT SUM(${measure.name}) AS total FROM ${table.name}${whereSql}`;
    return {
      sql, explanation: `Menjumlahkan ${measure.name} dari ${table.name}${where.length ? ` pada periode ${period}` : ''}.`,
      confidence: 0.76, referenced_tables: [table.name],
      referenced_columns: [measure.name], params, bindings,
      mode: 'limited', reason: 'rule_based', supported_patterns: ['count', 'group', 'filter', 'rate', 'time'],
    };
  }

  return {
    sql: '', explanation: 'Pola pertanyaan tidak didukung builder deterministik; diperlukan klarifikasi.',
    confidence: 0.30, referenced_tables: [], referenced_columns: [], params, bindings,
    mode: 'limited', reason: 'unsupported_pattern',
    supported_patterns: ['count', 'group', 'filter', 'rate', 'time'],
  };
}

export interface GenerateSqlInput extends RuleInput {
  /** Optional untrusted generator. Its output is always validated. */
  llm?: {
    generate: (prompt: string) => Promise<{ sql: string; explanation: string; confidence: number } | null>;
  } | null;
  db?: Parameters<typeof validateSql>[2];
}

/** Generate → validate → fall back. Never trusts an unvalidated candidate. */
export async function generateSql(input: GenerateSqlInput): Promise<SqlPlan> {
  const fallback = buildRuleSql(input);
  if (!input.llm) return fallback;

  try {
    const candidate = await input.llm.generate(
      `Schema: ${JSON.stringify(input.schema)}\nQuestion: ${input.question}\nReturn one SELECT statement only.`,
    );
    if (!candidate || typeof candidate.sql !== 'string') return fallback;
    const check = validateSql(candidate.sql, input.schema, input.db, fallback.bindings);
    if (!check.ok || candidate.confidence < 0.60 || !check.sql) return fallback;
    return {
      sql: check.sql,
      explanation: candidate.explanation || fallback.explanation,
      confidence: candidate.confidence,
      referenced_tables: fallback.referenced_tables,
      referenced_columns: fallback.referenced_columns,
      params: fallback.params,
      bindings: fallback.bindings,
      mode: 'generated',
    };
  } catch {
    return fallback;
  }
}

/** Execute a validated plan on a read-only connection. Numbers come from here. */
export function executeSql(
  db: { prepare: (s: string) => { columns: () => { name: string }[]; all: (...a: unknown[]) => unknown[] } },
  plan: SqlPlan,
): SqlExecution {
  const started = Date.now();
  if (!plan.sql) {
    return { columns: [], rows: [], duration_ms: 0, row_count: 0, error: 'empty_sql' };
  }
  try {
    const stmt = db.prepare(plan.sql);
    const columns = stmt.columns().map((c) => c.name);
    const raw = stmt.all(...plan.bindings);
    const rows = raw.map((r) => {
      if (Array.isArray(r)) return r;
      return columns.map((c) => (r as Record<string, unknown>)[c] ?? null);
    }).slice(0, ROW_CAP);
    return { columns, rows, duration_ms: Date.now() - started, row_count: rows.length };
  } catch (e) {
    return { columns: [], rows: [], duration_ms: Date.now() - started, row_count: 0, error: (e as Error).message };
  }
}

/* ------------------------------------------------------- numeric grounding */

const NUMBER_TOKEN_RE = /\d+(?:[.,]\d+)*/g;

function interpretations(token: string): number[] {
  const out = new Set<number>();
  if (/^\d{1,3}(\.\d{3})+$/.test(token)) out.add(Number(token.replace(/\./g, '')));
  else out.add(Number(token.replace(',', '.')));
  if (/^\d{1,3}(,\d{3})+$/.test(token)) out.add(Number(token.replace(/,/g, '')));
  else out.add(Number(token));
  return [...out].filter(Number.isFinite);
}

/** True when every numeric token in `text` maps to an allowed value. */
export function verifyNumericGrounding(text: string, allowedNumbers: number[]): boolean {
  const tokens = text.match(NUMBER_TOKEN_RE) ?? [];
  for (const token of tokens) {
    const ok = interpretations(token).some((c) => allowedNumbers.some((a) => Math.abs(a - c) < 0.011));
    if (!ok) return false;
  }
  return true;
}

export function collectNumbers(rows: unknown[][]): number[] {
  const out = new Set<number>();
  for (const row of rows) {
    for (const cell of row) {
      if (typeof cell === 'number' && Number.isFinite(cell)) out.add(cell);
    }
  }
  return [...out];
}
