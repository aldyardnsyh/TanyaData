/**
 * Dynamic text-to-SQL — validator 7 lapis + rule-based fallback + executor.
 * TIDAK ada SQL agregat hardcoded per domain. Semua objek berasal dari
 * `SchemaJson` (CORE_ARCHITECTURE §5, ADR-C05).
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { WORKSPACE_DB, resolveSeedDb } from '@/lib/db/paths';
import { AppError } from '@/lib/errors';
import type {
  QueryContext,
  SchemaColumn,
  SchemaJson,
  SqlCandidate,
  SqlExecution,
  ValidationOutcome,
} from '@/lib/core/contracts';

export const SQL_MAX_LENGTH = 2000;
export const ROW_CAP = 500;
export const CELL_CAP = 200;
export const SQL_TIMEOUT_MS = 8000;

/* ---------------------------------------------------------------- tokenizer */

type Token = { kind: 'word' | 'string' | 'quoted' | 'number' | 'punct'; value: string; upper: string };

function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'") {
      let value = '';
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i += 1;
          break;
        } else {
          value += sql[i];
          i += 1;
        }
      }
      out.push({ kind: 'string', value, upper: '' });
      continue;
    }
    if (ch === '"' || ch === '`') {
      const quote = ch;
      let value = '';
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) {
          value += quote;
          i += 2;
        } else if (sql[i] === quote) {
          i += 1;
          break;
        } else {
          value += sql[i];
          i += 1;
        }
      }
      out.push({ kind: 'quoted', value, upper: value.toUpperCase() });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let value = '';
      while (i < sql.length && /[0-9.]/.test(sql[i])) {
        value += sql[i];
        i += 1;
      }
      out.push({ kind: 'number', value, upper: '' });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let value = '';
      while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i])) {
        value += sql[i];
        i += 1;
      }
      out.push({ kind: 'word', value, upper: value.toUpperCase() });
      continue;
    }
    out.push({ kind: 'punct', value: ch, upper: ch });
    i += 1;
  }
  return out;
}

const FORBIDDEN = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'ATTACH', 'DETACH',
  'PRAGMA', 'VACUUM', 'REPLACE', 'GRANT', 'REVOKE', 'BEGIN', 'COMMIT', 'ROLLBACK',
  'SAVEPOINT', 'EXPLAIN', 'LOAD_EXTENSION', 'INTO', 'RETURNING', 'UPSERT',
]);

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'ON',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL', 'AND', 'OR', 'NOT', 'IN', 'IS',
  'NULL', 'LIKE', 'GLOB', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT', 'ALL',
  'WITH', 'UNION', 'EXCEPT', 'INTERSECT', 'ASC', 'DESC', 'COLLATE', 'ESCAPE', 'EXISTS',
  'CAST', 'FILTER', 'OVER', 'PARTITION', 'ROWS', 'RANGE', 'PRECEDING', 'FOLLOWING', 'CURRENT',
  'ROW', 'TRUE', 'FALSE', 'COUNT', 'AVG', 'SUM', 'TOTAL', 'MIN', 'MAX', 'ROUND', 'COALESCE',
  'IFNULL', 'NULLIF', 'ABS', 'LENGTH', 'LOWER', 'UPPER', 'TRIM', 'SUBSTR', 'STRFTIME', 'DATE',
  'DATETIME', 'PRINTF', 'GROUP_CONCAT', 'IIF', 'VALUES', 'TABLE', 'INDEXED', 'NOTHING',
]);

function reject(layer: string, reason: string, code: 'SQL_REJECTED' | 'SQL_TIMEOUT' = 'SQL_REJECTED'): ValidationOutcome {
  return { ok: false, code, reason, layer };
}

/* --------------------------------------------------------------- validation */

export function validateSql(sql: string, schema: SchemaJson): ValidationOutcome {
  // L1 — lexical
  if (typeof sql !== 'string' || sql.length > SQL_MAX_LENGTH) {
    return reject('L1', `SQL melebihi ${SQL_MAX_LENGTH} karakter`);
  }
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) i += 1;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') return reject('L1', 'Komentar SQL tidak diizinkan');
    if (ch === '/' && sql[i + 1] === '*') return reject('L1', 'Komentar SQL tidak diizinkan');
    if (ch === ';') return reject('L1', 'Hanya satu statement yang diizinkan');
  }
  if (quote) return reject('L1', 'Literal SQL tidak ditutup');

  const tokens = tokenize(sql);
  if (!tokens.length) return reject('L1', 'SQL kosong');

  // L2 — statement
  const first = tokens[0];
  if (first.kind !== 'word' || (first.upper !== 'SELECT' && first.upper !== 'WITH')) {
    return reject('L2', 'SQL harus diawali SELECT atau WITH');
  }
  if (first.upper === 'WITH' && !tokens.some((t) => t.upper === 'SELECT')) {
    return reject('L2', 'WITH harus diikuti SELECT');
  }

  // L3 — keyword berbahaya
  for (const token of tokens) {
    if (token.kind === 'word' && FORBIDDEN.has(token.upper)) {
      return reject('L3', `Kata kunci ${token.value} tidak diizinkan`);
    }
  }

  // L4 — whitelist objek (tabel)
  const allowedObjects = new Set(schema.tables.map((t) => t.name));
  const objectNames = new Set<string>();
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind !== 'word' || (token.upper !== 'FROM' && token.upper !== 'JOIN')) continue;
    let j = i + 1;
    while (j < tokens.length) {
      const candidate = tokens[j];
      if (candidate.kind === 'punct' && candidate.value === '(') break; // subquery
      if (candidate.kind === 'punct' && candidate.value === ',') {
        j += 1;
        continue;
      }
      if (candidate.kind !== 'word' && candidate.kind !== 'quoted') break;
      let name = candidate.value;
      if (tokens[j + 1]?.kind === 'punct' && tokens[j + 1].value === '.') {
        const next = tokens[j + 2];
        if (next && (next.kind === 'word' || next.kind === 'quoted')) {
          name = `${candidate.value}.${next.value}`;
          j += 2;
        }
      }
      if (!allowedObjects.has(name)) {
        return reject('L4', `Tabel "${name}" tidak ada dalam schema_json`);
      }
      objectNames.add(name);
      j += 1;
      if (tokens[j]?.kind === 'word' && tokens[j].upper === 'AS') j += 2;
      break;
    }
  }

  // L5 — whitelist kolom + role agregasi
  const columns = schema.tables.flatMap((t) => t.columns);
  const allowedColumns = new Set(columns.map((c) => c.name));
  // Bagian nama tabel berkualifikasi ("seed", "transactions" dari
  // "seed.transactions") bukan kolom.
  const objectNameParts = new Set(
    [...objectNames].flatMap((n) => (n.includes('.') ? n.split('.') : [])),
  );
  const roleByColumn = new Map<string, SchemaColumn['semantic_role']>();
  for (const col of columns) if (!roleByColumn.has(col.name)) roleByColumn.set(col.name, col.semantic_role);
  const aliases = new Set<string>();
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].upper === 'AS' && tokens[i + 1] && tokens[i + 1].kind !== 'punct') {
      aliases.add(tokens[i + 1].value);
    }
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind !== 'word') continue;
    if (KEYWORDS.has(token.upper) || FORBIDDEN.has(token.upper)) continue;
    if (tokens[i + 1]?.kind === 'punct' && tokens[i + 1].value === '(') continue; // fungsi
    if (tokens[i - 1]?.upper === 'AS') continue; // alias
    if (objectNames.has(token.value)) continue; // nama tabel
    if (objectNameParts.has(token.value)) continue; // bagian nama tabel berkualifikasi
    if (aliases.has(token.value)) continue;
    if (!allowedColumns.has(token.value)) {
      return reject('L5', `Kolom "${token.value}" tidak ada dalam schema_json`);
    }
  }
  for (let i = 0; i < tokens.length - 2; i += 1) {
    const fn = tokens[i];
    if (fn.kind !== 'word' || !['AVG', 'SUM', 'TOTAL'].includes(fn.upper)) continue;
    if (tokens[i + 1]?.value !== '(' || tokens[i + 2]?.kind !== 'word') continue;
    const role = roleByColumn.get(tokens[i + 2].value);
    if (role && role !== 'measure') {
      return reject('L5', `Agregasi ${fn.value} hanya untuk kolom bertipe measure`);
    }
  }

  // L6 — LIMIT wajib & clamp
  let limited = sql.trim().replace(/;+\s*$/, '');
  const pair = /\bLIMIT\s+(\d+)\s*,\s*(\d+)/i.exec(limited);
  if (pair) {
    const count = Math.min(Number(pair[2]), ROW_CAP);
    limited = limited.replace(pair[0], `LIMIT ${pair[1]}, ${count}`);
  } else {
    const single = /\bLIMIT\s+(\d+)/i.exec(limited);
    if (single) {
      limited = limited.replace(single[0], `LIMIT ${Math.min(Number(single[1]), ROW_CAP)}`);
    } else {
      limited = `${limited} LIMIT ${ROW_CAP}`;
    }
  }

  return { ok: true, sql: limited, params: {} };
}

/* ------------------------------------------------------------------ executor */

let executor: Database.Database | null = null;

export function openExecutor(): Database.Database {
  if (executor?.open) return executor;
  if (!fs.existsSync(WORKSPACE_DB)) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Workspace DB belum diinisialisasi');
  }
  const db = new Database(WORKSPACE_DB, { readonly: true, fileMustExist: true });
  db.pragma('query_only = 1');
  db.pragma('busy_timeout = 8000');
  try {
    const seedPath = resolveSeedDb();
    try {
      db.prepare('ATTACH DATABASE ? AS seed').run(`${pathToFileURL(seedPath).href}?mode=ro`);
    } catch {
      // Sebagian build SQLite tidak mendukung URI filename — fallback path biasa.
      db.prepare('ATTACH DATABASE ? AS seed').run(seedPath);
    }
  } catch {
    // seed tidak tersedia → kueri pada tabel core_data_* tetap jalan
  }
  executor = db;
  return db;
}

export function closeExecutor(): void {
  if (executor?.open) executor.close();
  executor = null;
}

function clampCell(value: unknown): unknown {
  if (typeof value === 'string' && value.length > CELL_CAP) return `${value.slice(0, CELL_CAP)}…`;
  if (value instanceof Uint8Array) return `[blob ${value.length} bytes]`;
  if (typeof value === 'bigint') return Number(value);
  return value;
}

/** Eksekusi read-only: EXPLAIN dulu, lalu query dengan row cap & timeout. */
export function executeSql(sql: string, params: Record<string, string | number | null> = {}): SqlExecution {
  const db = openExecutor();
  const values = Object.values(params);
  const started = performance.now();
  try {
    db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(400, 'VALIDATION_ERROR', 'SQL gagal pada dry-run EXPLAIN', {
      code: 'SQL_REJECTED',
      layer: 'L7',
      reason: message,
    });
  }
  let rows: Array<Record<string, unknown>>;
  try {
    rows = db.prepare(sql).all(...values) as Array<Record<string, unknown>>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(400, 'VALIDATION_ERROR', 'SQL gagal dieksekusi', {
      code: 'SQL_REJECTED',
      layer: 'L7',
      reason: message,
    });
  }
  const durationMs = Math.round(performance.now() - started);
  if (durationMs > SQL_TIMEOUT_MS) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Query melebihi batas waktu 8 detik', {
      code: 'SQL_TIMEOUT',
      durationMs,
    });
  }
  const capped = rows.slice(0, ROW_CAP).map((row) => {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) clean[key] = clampCell(value);
    return clean;
  });
  return {
    columns: capped.length ? Object.keys(capped[0]) : [],
    rows: capped,
    rowCount: rows.length,
    truncated: rows.length > ROW_CAP,
    durationMs,
    sql,
  };
}

/* ------------------------------------------------------------ rule builder */

const COUNT_RE = /berapa banyak|jumlah data|jumlah baris|banyak baris|how many|\bcount\b|\btotal\b|total baris/i;
const AVG_RE = /rata-rata|rata rata|rerata|average|\bmean\b/i;
const SUM_RE = /\bsum\b|akumulasi|total nilai|total amount/i;
const GROUP_RE = /berdasarkan|\bper\s+\w+|distribusi|\bgroup\b|\bby\b/i;
const MONTH_RE = /per bulan|bulanan|monthly|tiap bulan/i;
const YEAR_RE = /per tahun|tahunan|yearly|tiap tahun/i;
const DAY_RE = /per hari|harian|daily|tiap hari/i;
const RATE_PATTERNS: RegExp[] = [
  /\b(success|failure|error|completion|approval|conversion|retention)\s*[- ]?\s*rate\b/i,
  /tingkat\s+(keberhasilan|kegagalan|sukses|gagal|penyelesaian)/i,
  /\b(rasio|persentase|percentage|ratio)\b/i,
  /\b[a-z]+\s+rate\b/i,
];

function mentioned(column: SchemaColumn, lower: string): boolean {
  return lower.includes(column.name.toLowerCase()) || lower.includes(column.sourceName.toLowerCase());
}

/** Ambil nilai teks pertama yang cocok; null berarti tidak ada (boolean dilewati). */
function firstMatchingValue(
  values: Array<string | number | boolean | null>,
  predicate: (text: string) => boolean,
): string | number | null {
  for (const value of values) {
    if (value === null || typeof value === 'boolean') continue;
    const text = String(value);
    if (predicate(text)) return value;
  }
  return null;
}

/** Nilai kategori yang dihitung rate-nya, dipetakan ke enum dari schema_json. */
function rateTarget(lower: string): RegExp | null {
  if (/success|sukses|berhasil|keberhasilan/i.test(lower)) return /success|sukses|berhasil/i;
  if (/fail|gagal|kegagalan|error/i.test(lower)) return /fail|gagal|error/i;
  const generic = /\b([a-z]+)\s+rate\b/i.exec(lower);
  return generic ? new RegExp(generic[1], 'i') : null;
}

/**
 * Pola rate/rasio: persentase satu kategori terhadap seluruh baris.
 * Kategori, kolom, dan bobot diambil dari schema_json — bukan dari daftar
 * status atau nama tabel domain (CORE_ARCHITECTURE P-1).
 */
function buildRateCandidate(
  question: string,
  table: NonNullable<SchemaJson['tables'][number]>,
  lower: string,
  context: QueryContext | null,
  time: SchemaColumn | null,
): SqlCandidate | null {
  if (!RATE_PATTERNS.some((re) => re.test(question))) return null;
  const target = rateTarget(lower);
  if (!target) return null;

  const dims = table.columns.filter((c) => c.semantic_role === 'dimension' || c.semantic_role === 'text');
  const ordered = [...dims, ...table.columns.filter((c) => !dims.includes(c))];
  let category: SchemaColumn | null = null;
  let categoryValue: string | null = null;
  for (const column of ordered) {
    const hit = firstMatchingValue(column.sample_values, (text) => target.test(text));
    if (hit !== null) {
      category = column;
      categoryValue = String(hit);
      break;
    }
  }
  if (!category || categoryValue === null) return null;

  const params: Record<string, string | number | null> = { rateValue: categoryValue };
  const whereParts: string[] = [];
  for (const column of table.columns) {
    // Kolom kategori sudah dipakai sebagai pembilang; jangan difilter lagi,
    // kalau tidak numerator = denominator dan rate selalu 100%.
    if (column.name === category.name) continue;
    if (column.semantic_role !== 'dimension' && column.semantic_role !== 'identifier') continue;
    const hit = firstMatchingValue(
      column.sample_values,
      (text) => text.length >= 3 && lower.includes(text.toLowerCase()),
    );
    if (hit !== null) {
      whereParts.push(`${column.name} = ?`);
      params.filter = hit;
      break;
    }
  }
  if (context?.period?.start && time) {
    whereParts.push(`${time.name} >= ?`);
    params.periodStart = context.period.start;
  }
  if (context?.period?.end && time) {
    whereParts.push(`${time.name} <= ?`);
    params.periodEnd = context.period.end;
  }

  // BUG-SQL-03-DEF — rate SELALU count-based: JUMLAH TRANSAKSI pada kategori
  // dibagi JUMLAH TRANSAKSI seluruhnya (EVALUATION_QA.md B2, SOP Bagian 3).
  // Tabel transaksi mentah: satu baris = satu transaksi → COUNT(*).
  // Tabel agregat (mis. tx_daily) sudah punya measure jumlah transaksi →
  // pakai measure itu, jangan COUNT(*) yang hanya menghitung baris status.
  // Fallback lama ke measures[0] (amount) DILARANG: itu mengubah definisi
  // jadi amount-weighted (94.03 vs 94.39 pada data nyata).
  const countMeasure =
    table.columns.find(
      (c) => c.semantic_role === 'measure' && /count|jumlah|qty|volume|freq/i.test(c.name),
    ) ?? null;
  const numerator = countMeasure
    ? `SUM(CASE WHEN ${category.name} = ? THEN ${countMeasure.name} ELSE 0 END)`
    : `SUM(CASE WHEN ${category.name} = ? THEN 1 ELSE 0 END)`;
  const denominator = countMeasure ? `SUM(${countMeasure.name})` : 'COUNT(*)';
  const sql = `SELECT ROUND(${numerator} * 100.0 / NULLIF(${denominator}, 0), 2) AS value FROM ${table.name}${whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : ''}`;
  const explanation = `Saya menghitung persentase "${categoryValue}" dari seluruh baris pada tabel ${table.sourceName}${whereParts.length ? ' pada rentang yang diminta' : ''} berdasarkan jumlah transaksi (bukan nilai transaksi), dengan pembilang dan penyebut dihitung mesin dari data.`;

  return {
    sql,
    explanation,
    confidence: 0.6,
    referenced_tables: [table.name],
    referenced_columns: [category.name, ...(countMeasure ? [countMeasure.name] : []), ...(time ? [time.name] : [])],
    params,
    mode: 'limited',
    reason: 'rule_based_rate',
  };
}

/**
 * Pemilihan tabel rule-based. Nama tabel berkualifikasi ("seed.transactions")
 * tidak pernah cocok dengan pertanyaan ("total transaksi"), sehingga fallback
 * lama "tabel pertama" memilih channels dan SQL-nya ditolak validator. Skor:
 * kecocokan eksplisit > kata persis > awalan (Indonesia "transaksi" vs
 * Inggris "transactions") > jumlah kolom (fact table) sebagai tie-break.
 */
function pickTableForQuestion(
  question: string,
  tables: SchemaJson['tables'],
): SchemaJson['tables'][number] | null {
  if (!tables.length) return null;
  const lower = question.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  let best: { table: SchemaJson['tables'][number]; score: number } | null = null;
  for (const t of tables) {
    const parts = `${t.name} ${t.sourceName ?? ''} ${(t.columns ?? [])
      .map((c) => `${c.name} ${c.sourceName ?? ''}`)
      .join(' ')}`.toLowerCase().split(/\s+/).filter(Boolean);
    let score = 0;
    if (t.sourceName && lower.includes(t.sourceName.toLowerCase())) score += 10;
    for (const w of words) {
      for (const p of parts) {
        if (p === w) score += 4;
        else if (p.startsWith(w) || w.startsWith(p)) score += 2;
        else if (p.length >= 6 && w.length >= 6 && p.slice(0, 6) === w.slice(0, 6)) score += 1;
      }
    }
    score += Math.min(2, (t.columns ?? []).length / 7);
    if (!best || score > best.score) best = { table: t, score };
  }
  if (!best) return null;
  if (best.score <= 0) {
    return [...tables].sort((a, b) => (b.columns ?? []).length - (a.columns ?? []).length)[0] ?? null;
  }
  return best.table;
}

/**
 * Fallback deterministik. Mengembalikan `null` bila pola tidak dikenal —
 * jawaban harus klarifikasi, bukan SQL tebakan (CORE_ARCHITECTURE §5).
 */
export function buildRuleBasedCandidate(
  question: string,
  schema: SchemaJson,
  context: QueryContext | null = null,
): SqlCandidate | null {
  const table = pickTableForQuestion(question, schema.tables);
  if (!table || !table.columns.length) return null;

  const lower = question.toLowerCase();
  const measures = table.columns.filter((c) => c.semantic_role === 'measure');
  const dims = table.columns.filter((c) => c.semantic_role === 'dimension' || c.semantic_role === 'text');
  const times = table.columns.filter((c) => c.semantic_role === 'time');
  const measure = measures.find((c) => mentioned(c, lower)) ?? measures[0] ?? null;
  const dim = dims.find((c) => mentioned(c, lower)) ?? dims[0] ?? null;
  const time = times.find((c) => mentioned(c, lower)) ?? times[0] ?? null;

  const rate = buildRateCandidate(question, table, lower, context, time);
  if (rate) return rate;

  let aggregate: 'count' | 'avg' | 'sum' | null = null;
  if (AVG_RE.test(lower) && measure) aggregate = 'avg';
  else if (SUM_RE.test(lower) && measure) aggregate = 'sum';
  else if (COUNT_RE.test(lower)) aggregate = 'count';

  let groupExpr: string | null = null;
  let groupLabel: string | null = null;
  if (MONTH_RE.test(lower) && time) {
    groupExpr = `substr(${time.name}, 1, 7)`;
    groupLabel = 'bulan';
  } else if (YEAR_RE.test(lower) && time) {
    groupExpr = `substr(${time.name}, 1, 4)`;
    groupLabel = 'tahun';
  } else if (DAY_RE.test(lower) && time) {
    groupExpr = time.name;
    groupLabel = 'hari';
  } else if (GROUP_RE.test(lower) && dim) {
    groupExpr = dim.name;
    groupLabel = dim.sourceName;
  }

  if (!aggregate && !groupExpr) return null;

  const params: Record<string, string | number | null> = {};
  const whereParts: string[] = [];
  for (const column of table.columns) {
    if (column.semantic_role !== 'dimension' && column.semantic_role !== 'identifier') continue;
    const hit = firstMatchingValue(
      column.sample_values,
      (text) => text.length >= 3 && lower.includes(text.toLowerCase()),
    );
    if (hit !== null) {
      whereParts.push(`${column.name} = ?`);
      params.filter = hit;
      break;
    }
  }
  if (context?.period?.start && time) {
    whereParts.push(`${time.name} >= ?`);
    params.periodStart = context.period.start;
  }
  if (context?.period?.end && time) {
    whereParts.push(`${time.name} <= ?`);
    params.periodEnd = context.period.end;
  }

  const selects: string[] = [];
  if (groupExpr) selects.push(`${groupExpr} AS bucket`);
  if (aggregate === 'avg' && measure) selects.push(`AVG(${measure.name}) AS value`);
  else if (aggregate === 'sum' && measure) selects.push(`SUM(${measure.name}) AS value`);
  else selects.push('COUNT(*) AS value');

  const sql = `SELECT ${selects.join(', ')} FROM ${table.name}${whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : ''}${groupExpr ? ' GROUP BY bucket' : ''}`;
  const aggText =
    aggregate === 'avg'
      ? `rata-rata kolom ${measure?.sourceName ?? ''}`
      : aggregate === 'sum'
        ? `total kolom ${measure?.sourceName ?? ''}`
        : 'jumlah baris';
  const explanation = `Saya menghitung ${aggText} dari tabel ${table.sourceName}${groupLabel ? ` dikelompokkan per ${groupLabel}` : ''}${whereParts.length ? ' dengan filter yang cocok dari pertanyaan' : ''}.`;

  return {
    sql,
    explanation,
    confidence: 0.55,
    referenced_tables: [table.name],
    referenced_columns: selects.length ? table.columns.filter((c) => sql.includes(c.name)).map((c) => c.name) : [],
    params,
    mode: 'limited',
    reason: 'rule_based',
  };
}

/** Validasi + eksekusi kandidat dari generator maupun rule builder. */
export function runCandidate(candidate: SqlCandidate, schema: SchemaJson): SqlExecution {
  const validation = validateSql(candidate.sql, schema);
  if (!validation.ok) {
    throw new AppError(400, 'VALIDATION_ERROR', `SQL ditolak (${validation.layer}): ${validation.reason}`, {
      code: validation.code,
      layer: validation.layer,
      reason: validation.reason,
    });
  }
  return executeSql(validation.sql, candidate.params);
}
