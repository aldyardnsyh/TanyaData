import type { Scope } from '@/lib/analytics/scope';
import { validationError } from '@/lib/errors';
import { isIsoDate } from '@/lib/date';

export type AnalyticsFilters = {
  channel?: string | null;
  category?: string | null;
  failureCode?: string | null;
  status?: string | null;
};

export type WhereClause = { sql: string; params: (string | number)[] };

const STATUSES = new Set(['SUCCESS', 'FAILED', 'PENDING', 'EXPIRED', 'REFUNDED']);
const CHANNEL_ID_RE = /^CH\d{2}$/i;
const FAILURE_CODE_RE = /^F\d{2}$/i;

export function parseFilters(searchParams: URLSearchParams): AnalyticsFilters {
  const filters: AnalyticsFilters = {
    channel: searchParams.get('channel')?.trim() || null,
    category: searchParams.get('category')?.trim() || null,
    failureCode: searchParams.get('failureCode')?.trim() || null,
    status: searchParams.get('status')?.trim().toUpperCase() || null,
  };

  if (filters.status && !STATUSES.has(filters.status)) {
    throw validationError(`Status tidak dikenal: ${filters.status}`);
  }
  if (filters.failureCode && !FAILURE_CODE_RE.test(filters.failureCode)) {
    throw validationError('failureCode harus berformat F01 - F99');
  }
  if (filters.category && filters.category.length > 60) {
    throw validationError('category terlalu panjang (maks 60 karakter)');
  }
  if (filters.channel && filters.channel.length > 60) {
    throw validationError('channel terlalu panjang (maks 60 karakter)');
  }
  return filters;
}

export function buildFilters(filters: AnalyticsFilters): WhereClause {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.channel) {
    if (CHANNEL_ID_RE.test(filters.channel)) {
      clauses.push('channel_id = ? COLLATE NOCASE');
      params.push(filters.channel.toUpperCase());
    } else {
      clauses.push('channel_name = ? COLLATE NOCASE');
      params.push(filters.channel);
    }
  }
  if (filters.category) {
    clauses.push('category = ? COLLATE NOCASE');
    params.push(filters.category);
  }
  if (filters.failureCode) {
    clauses.push('failure_code = ? COLLATE NOCASE');
    params.push(filters.failureCode.toUpperCase());
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }

  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

export function dateClause(scope: Scope, start: string, end: string): WhereClause {
  if (!isIsoDate(start) || !isIsoDate(end)) {
    throw validationError('Rentang tanggal tidak valid');
  }
  return {
    sql: `transaction_date BETWEEN ? AND ?`,
    params: [start, end],
  };
}

export function combine(parts: WhereClause[]): WhereClause {
  const active = parts.filter((p) => p.sql.trim().length > 0);
  return {
    sql: active.length ? active.map((p) => `(${p.sql})`).join(' AND ') : '1=1',
    params: active.flatMap((p) => p.params),
  };
}
