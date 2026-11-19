import type { DB } from '@/lib/db/client';
import type {
  CategoryPerformanceItem,
  CategoryPerformanceResponse,
  ChannelPerformanceItem,
  ChannelPerformanceResponse,
  DashboardSummaryResponse,
  Kpi,
  KpiKey,
  Lang,
  Period,
  StatusDistributionItem,
  StatusDistributionResponse,
  TrendPoint,
  TrendsResponse,
} from '@/lib/contracts/http';
import type { Scope } from '@/lib/analytics/scope';
import type { AnalyticsFilters } from '@/lib/analytics/filters';
import { buildFilters, combine, dateClause } from '@/lib/analytics/filters';
import { allRows, bucketExpression, num, oneRow, pickGrain, str } from '@/lib/analytics/sql';
import { addDays, changePct, formatDayMonth, formatMonthLabel, round1, round2, safeRatio, weekStart } from '@/lib/date';
import { t, KPI_KEYS } from '@/lib/i18n/dictionary';

type Aggregate = {
  total: number;
  successful: number;
  failed: number;
  successValue: number;
};

function aggregate(db: DB, scope: Scope, start: string, end: string, filters: AnalyticsFilters): Aggregate {
  const where = combine([dateClause(scope, start, end), buildFilters(filters)]);
  const row = oneRow(
    db,
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END), 0) AS successful,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed,
            COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS successValue
       FROM ${scope.table}
      WHERE ${where.sql}`,
    where.params,
  );
  return {
    total: num(row?.total),
    successful: num(row?.successful),
    failed: num(row?.failed),
    successValue: num(row?.successValue),
  };
}

function rates(agg: Aggregate): { successRate: number; failureRate: number } {
  return {
    successRate: safeRatio(agg.successful, agg.total),
    failureRate: safeRatio(agg.failed, agg.total),
  };
}

function kpiValue(key: KpiKey, agg: Aggregate): number {
  switch (key) {
    case 'total':
      return agg.total;
    case 'successful':
      return agg.successful;
    case 'failed':
      return agg.failed;
    case 'successRate':
      return rates(agg).successRate;
    case 'failureRate':
      return rates(agg).failureRate;
    case 'successValue':
      return agg.successValue;
  }
}

const KPI_ORDER: { key: KpiKey; format: Kpi['format'] }[] = [
  { key: 'total', format: 'number' },
  { key: 'successful', format: 'number' },
  { key: 'failed', format: 'number' },
  { key: 'successRate', format: 'percent' },
  { key: 'failureRate', format: 'percent' },
  { key: 'successValue', format: 'currency' },
];

export function getSummary(
  db: DB,
  scope: Scope,
  period: Period,
  filters: AnalyticsFilters,
  lang: Lang,
): DashboardSummaryResponse {
  const current = aggregate(db, scope, period.start, period.end, filters);
  const previous = period.compare
    ? aggregate(db, scope, period.compare.start, period.compare.end, filters)
    : null;

  const kpis: Kpi[] = KPI_ORDER.map(({ key, format }) => {
    const value = kpiValue(key, current);
    const compareValue = previous ? kpiValue(key, previous) : null;
    const delta = compareValue === null ? null : changePct(value, compareValue);
    return {
      key,
      label: t(lang, KPI_KEYS[key]),
      value: round2(value),
      format,
      changePct: delta,
      direction: delta === null ? null : delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat',
      compareValue: compareValue === null ? null : round2(compareValue),
    };
  });

  const notes: string[] = [];
  if (period.isPartial) {
    const days = Number(period.end.slice(8, 10));
    const monthLast = Number(
      new Date(Date.UTC(Number(period.end.slice(0, 4)), Number(period.end.slice(5, 7)), 0)).getUTCDate(),
    );
    notes.push(
      lang === 'id'
        ? `Periode ${period.start}..${period.end} adalah bulan berjalan (${days}/${monthLast} hari).`
        : `Period ${period.start}..${period.end} is a partial month (${days}/${monthLast} days).`,
    );
  }
  if (period.compare) {
    notes.push(
      lang === 'id'
        ? `Pembanding memakai rentang setara ${period.compare.start}..${period.compare.end} (like-for-like).`
        : `Comparison uses the equivalent range ${period.compare.start}..${period.compare.end} (like-for-like).`,
    );
  }
  if (filters.channel || filters.category || filters.failureCode || filters.status) {
    notes.push(lang === 'id' ? 'Angka mengikuti filter aktif.' : 'Numbers reflect active filters.');
  }

  return {
    period,
    dataset: scope.ref,
    kpis,
    empty: current.total === 0,
    notes,
  };
}

function enumerateBuckets(start: string, end: string, grain: 'day' | 'week' | 'month'): string[] {
  const buckets: string[] = [];
  let cursor = grain === 'day' ? start : grain === 'week' ? weekStart(start) : `${start.slice(0, 7)}-01`;
  let guard = 0;
  while (cursor <= end && guard < 4000) {
    buckets.push(cursor);
    cursor = grain === 'day' ? addDays(cursor, 1) : grain === 'week' ? addDays(cursor, 7) : addDays(`${cursor.slice(0, 7)}-01`, 32).slice(0, 7) + '-01';
    guard += 1;
  }
  return buckets;
}

function bucketLabel(bucket: string, grain: 'day' | 'week' | 'month', lang: Lang): string {
  if (grain === 'month') return formatMonthLabel(bucket, lang);
  return formatDayMonth(bucket, lang);
}

export function getTrends(
  db: DB,
  scope: Scope,
  period: Period,
  filters: AnalyticsFilters,
  lang: Lang,
  requestedGrain?: 'day' | 'week' | 'month' | null,
): TrendsResponse {
  let grain = requestedGrain ?? pickGrain(period.dayCount);
  let truncated = false;
  let buckets = enumerateBuckets(period.start, period.end, grain);
  while (buckets.length > 120 && grain !== 'month') {
    grain = grain === 'day' ? 'week' : 'month';
    buckets = enumerateBuckets(period.start, period.end, grain);
    truncated = true;
  }

  const where = combine([dateClause(scope, period.start, period.end), buildFilters(filters)]);
  const rows = allRows(
    db,
    `SELECT ${bucketExpression(grain)} AS bucket,
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END), 0) AS successful,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed
       FROM ${scope.table}
      WHERE ${where.sql}
      GROUP BY bucket
      ORDER BY bucket`,
    where.params,
  );

  const map = new Map<string, { total: number; successful: number; failed: number }>();
  for (const row of rows) {
    map.set(str(row.bucket), {
      total: num(row.total),
      successful: num(row.successful),
      failed: num(row.failed),
    });
  }

  const points: TrendPoint[] = buckets.map((bucket) => {
    const values = map.get(bucket) ?? { total: 0, successful: 0, failed: 0 };
    return {
      bucket,
      label: bucketLabel(bucket, grain, lang),
      total: values.total,
      successful: values.successful,
      failed: values.failed,
      successRate: safeRatio(values.successful, values.total),
      failureRate: safeRatio(values.failed, values.total),
    };
  });

  const totals = points.reduce(
    (acc, p) => ({
      total: acc.total + p.total,
      successful: acc.successful + p.successful,
      failed: acc.failed + p.failed,
    }),
    { total: 0, successful: 0, failed: 0 },
  );

  const notes: string[] = [];
  if (truncated) {
    notes.push(
      lang === 'id'
        ? 'Bucket terlalu banyak; agregasi dinaikkan otomatis agar tetap terbaca.'
        : 'Too many buckets; aggregation was coarsened automatically.',
    );
  }
  if (grain !== 'day' && period.dayCount > 45 && !truncated) {
    notes.push(lang === 'id' ? 'Agregasi otomatis karena rentang panjang.' : 'Automatically aggregated for a long range.');
  }

  return {
    grain,
    points,
    totals,
    truncated,
    period,
    dataset: scope.ref,
    notes: notes.length ? notes : undefined,
  };
}

const STATUS_ORDER = ['SUCCESS', 'FAILED', 'PENDING', 'EXPIRED', 'REFUNDED'] as const;

export function getStatusDistribution(
  db: DB,
  scope: Scope,
  period: Period,
  filters: AnalyticsFilters,
): StatusDistributionResponse {
  const where = combine([dateClause(scope, period.start, period.end), buildFilters(filters)]);
  const rows = allRows(
    db,
    `SELECT status, COUNT(*) AS n FROM ${scope.table} WHERE ${where.sql} GROUP BY status`,
    where.params,
  );
  const map = new Map<string, number>();
  for (const row of rows) map.set(str(row.status), num(row.n));
  const total = [...map.values()].reduce((a, b) => a + b, 0);

  const items: StatusDistributionItem[] = STATUS_ORDER.filter((s) => (map.get(s) ?? 0) > 0).map((status) => ({
    status,
    count: map.get(status) ?? 0,
    percent: safeRatio(map.get(status) ?? 0, total),
  }));

  return { items, total, period, dataset: scope.ref };
}

export function getChannelPerformance(
  db: DB,
  scope: Scope,
  period: Period,
  filters: AnalyticsFilters,
  metric: 'volume' | 'failure_rate',
  limit = 10,
): ChannelPerformanceResponse {
  const where = combine([dateClause(scope, period.start, period.end), buildFilters({ ...filters })]);
  const rows = allRows(
    db,
    `SELECT channel_id, channel_name,
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END), 0) AS successful,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed
       FROM ${scope.table}
      WHERE ${where.sql}
      GROUP BY channel_id, channel_name
      ORDER BY total DESC`,
    where.params,
  );

  const previous = new Map<string, number>();
  if (period.compare) {
    const pWhere = combine([dateClause(scope, period.compare.start, period.compare.end), buildFilters({ ...filters })]);
    const prevRows = allRows(
      db,
      `SELECT channel_id, COUNT(*) AS total FROM ${scope.table} WHERE ${pWhere.sql} GROUP BY channel_id`,
      pWhere.params,
    );
    for (const row of prevRows) previous.set(str(row.channel_id), num(row.total));
  }

  const grandTotal = rows.reduce((sum, r) => sum + num(r.total), 0);
  const items: ChannelPerformanceItem[] = rows.map((row) => {
    const total = num(row.total);
    const successful = num(row.successful);
    const failed = num(row.failed);
    return {
      channelId: str(row.channel_id),
      channelName: str(row.channel_name),
      total,
      successful,
      failed,
      successRate: safeRatio(successful, total),
      failureRate: safeRatio(failed, total),
      share: safeRatio(total, grandTotal),
      changePct: changePct(total, previous.get(str(row.channel_id)) ?? null),
    };
  });

  items.sort((a, b) =>
    metric === 'failure_rate' ? b.failureRate - a.failureRate || b.total - a.total : b.total - a.total,
  );

  return {
    metric,
    items: items.slice(0, limit),
    total: grandTotal,
    truncated: items.length > limit,
    period,
    dataset: scope.ref,
  };
}

export function getCategoryPerformance(
  db: DB,
  scope: Scope,
  period: Period,
  filters: AnalyticsFilters,
  limit = 15,
): CategoryPerformanceResponse {
  const where = combine([dateClause(scope, period.start, period.end), buildFilters(filters)]);
  const rows = allRows(
    db,
    `SELECT category,
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END), 0) AS successful,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed,
            COALESCE(AVG(CASE WHEN status = 'SUCCESS' THEN amount END), 0) AS avgTicket
       FROM ${scope.table}
      WHERE ${where.sql}
      GROUP BY category
      ORDER BY total DESC`,
    where.params,
  );

  const previous = new Map<string, number>();
  if (period.compare) {
    const pWhere = combine([dateClause(scope, period.compare.start, period.compare.end), buildFilters(filters)]);
    const prevRows = allRows(
      db,
      `SELECT category, COUNT(*) AS total FROM ${scope.table} WHERE ${pWhere.sql} GROUP BY category`,
      pWhere.params,
    );
    for (const row of prevRows) previous.set(str(row.category), num(row.total));
  }

  const grandTotal = rows.reduce((sum, r) => sum + num(r.total), 0);
  const all: CategoryPerformanceItem[] = rows.map((row) => {
    const total = num(row.total);
    const successful = num(row.successful);
    const failed = num(row.failed);
    return {
      categoryName: str(row.category),
      total,
      successful,
      failed,
      successRate: safeRatio(successful, total),
      failureRate: safeRatio(failed, total),
      share: safeRatio(total, grandTotal),
      avgTicket: total > 0 ? Math.round(num(row.avgTicket)) : null,
      changePct: changePct(total, previous.get(str(row.category)) ?? null),
    };
  });

  return {
    items: all.slice(0, limit),
    total: grandTotal,
    truncated: all.length > limit,
    period,
    dataset: scope.ref,
  };
}

export function metricsForRange(
  db: DB,
  scope: Scope,
  start: string,
  end: string,
  filters: AnalyticsFilters,
): Aggregate & { successRate: number; failureRate: number } {
  const agg = aggregate(db, scope, start, end, filters);
  return { ...agg, ...rates(agg) };
}

export { round1 };
