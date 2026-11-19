import type { DB } from '@/lib/db/client';
import { AppError } from '@/lib/errors';
import { randomUUID } from 'node:crypto';
import { nowJakartaIso } from '@/lib/date';

export type QueryTiming = {
  rows: Record<string, unknown>[];
  durationMs: number;
  rowCount: number;
  sql: string;
};

export function allRows(
  db: DB,
  sql: string,
  params: (string | number | null)[] = [],
): Record<string, unknown>[] {
  return db.prepare(sql).all(...params) as Record<string, unknown>[];
}

export function oneRow(
  db: DB,
  sql: string,
  params: (string | number | null)[] = [],
): Record<string, unknown> | undefined {
  return db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
}

export function timedQuery(
  db: DB,
  sql: string,
  params: (string | number | null)[] = [],
  log?: { conversationId?: string | null; messageId?: string | null },
): QueryTiming {
  const started = performance.now();
  try {
    const rows = allRows(db, sql, params);
    const durationMs = Math.round(performance.now() - started);
    if (log) {
      db.prepare(
        `INSERT INTO query_log(id, conversation_id, message_id, sql, params_json, row_count, duration_ms, ok, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)`,
      ).run(
        randomUUID(),
        log.conversationId ?? null,
        log.messageId ?? null,
        sql,
        JSON.stringify(params),
        rows.length,
        durationMs,
        nowJakartaIso(),
      );
    }
    return { rows, durationMs, rowCount: rows.length, sql };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (log) {
      try {
        db.prepare(
          `INSERT INTO query_log(id, conversation_id, message_id, sql, params_json, row_count, duration_ms, ok, error, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)`,
        ).run(
          randomUUID(),
          log.conversationId ?? null,
          log.messageId ?? null,
          sql,
          JSON.stringify(params),
          message,
          nowJakartaIso(),
        );
      } catch {
        // logging tidak boleh menutupi error asli
      }
    }
    throw new AppError(500, 'INTERNAL_ERROR', 'Query analitik gagal dijalankan', { cause: message });
  }
}

export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export function bucketExpression(grain: 'day' | 'week' | 'month'): string {
  if (grain === 'month') return "substr(transaction_date, 1, 7) || '-01'";
  if (grain === 'week') return "date(transaction_date, 'weekday 0', '-6 days')";
  return 'transaction_date';
}

export function pickGrain(dayCount: number): 'day' | 'week' | 'month' {
  if (dayCount <= 45) return 'day';
  if (dayCount <= 150) return 'week';
  return 'month';
}
