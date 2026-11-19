import type { DB } from '@/lib/db/client';
import type { Insight, InsightsResponse, Lang, Period } from '@/lib/contracts/http';
import type { Scope } from '@/lib/analytics/scope';
import type { AnalyticsFilters } from '@/lib/analytics/filters';
import { buildFilters, combine, dateClause } from '@/lib/analytics/filters';
import { allRows, num, str } from '@/lib/analytics/sql';
import { round1, round2, safeRatio } from '@/lib/date';
import { nowJakartaIso } from '@/lib/date';

type ChannelStat = {
  channelId: string;
  channelName: string;
  total: number;
  failed: number;
  rate: number;
};

function channelStats(
  db: DB,
  scope: Scope,
  start: string,
  end: string,
  filters: AnalyticsFilters,
): Map<string, ChannelStat> {
  const where = combine([dateClause(scope, start, end), buildFilters(filters)]);
  const rows = allRows(
    db,
    `SELECT channel_id, channel_name, COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed
       FROM ${scope.table}
      WHERE ${where.sql}
      GROUP BY channel_id, channel_name`,
    where.params,
  );
  const map = new Map<string, ChannelStat>();
  for (const row of rows) {
    const id = str(row.channel_id);
    const total = num(row.total);
    const failed = num(row.failed);
    map.set(id, {
      channelId: id,
      channelName: str(row.channel_name),
      total,
      failed,
      rate: safeRatio(failed, total),
    });
  }
  return map;
}

function codeCounts(
  db: DB,
  scope: Scope,
  start: string,
  end: string,
  filters: AnalyticsFilters,
): { total: number; counts: Map<string, number> } {
  const where = combine([
    dateClause(scope, start, end),
    buildFilters(filters),
    { sql: "status = 'FAILED' AND failure_code IS NOT NULL", params: [] },
  ]);
  const rows = allRows(
    db,
    `SELECT failure_code, COUNT(*) AS n FROM ${scope.table} WHERE ${where.sql} GROUP BY failure_code`,
    where.params,
  );
  const totals = allRows(
    db,
    `SELECT COUNT(*) AS n FROM ${scope.table} WHERE ${combine([dateClause(scope, start, end), buildFilters(filters)]).sql}`,
    combine([dateClause(scope, start, end), buildFilters(filters)]).params,
  );
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(str(row.failure_code), num(row.n));
  return { total: num(totals[0]?.n), counts };
}

function categoryVolumes(
  db: DB,
  scope: Scope,
  start: string,
  end: string,
  filters: AnalyticsFilters,
): Map<string, number> {
  const where = combine([dateClause(scope, start, end), buildFilters(filters)]);
  const rows = allRows(
    db,
    `SELECT category, COUNT(*) AS n FROM ${scope.table} WHERE ${where.sql} GROUP BY category`,
    where.params,
  );
  const map = new Map<string, number>();
  for (const row of rows) map.set(str(row.category), num(row.n));
  return map;
}

function severityForDelta(delta: number, rate: number): Insight['severity'] {
  if (delta >= 5 || rate >= 10) return 'high';
  if (delta >= 2 || rate >= 5) return 'medium';
  return 'low';
}

export function getInsights(
  db: DB,
  scope: Scope,
  period: Period,
  filters: AnalyticsFilters,
  lang: Lang,
  limit = 3,
): InsightsResponse {
  const items: Insight[] = [];
  const periodText = `${period.start}..${period.end}`;

  const current = channelStats(db, scope, period.start, period.end, filters);
  const previous = period.compare
    ? channelStats(db, scope, period.compare.start, period.compare.end, filters)
    : new Map<string, ChannelStat>();
  const baseline = period.compare
    ? channelStats(
        db,
        scope,
        shiftPeriodStart(period.compare.start, -1),
        shiftPeriodEnd(period.compare.end, -1),
        filters,
      )
    : new Map<string, ChannelStat>();

  const spikes: { stat: ChannelStat; prev: ChannelStat; delta: number }[] = [];
  for (const [id, stat] of current) {
    const prev = previous.get(id);
    if (!prev || prev.total < 50 || stat.total < 50) continue;
    const delta = round2(stat.rate - prev.rate);
    if (delta >= 2) spikes.push({ stat, prev, delta });
  }
  spikes.sort((a, b) => b.delta - a.delta);

  for (const spike of spikes.slice(0, 3)) {
    const base = baseline.get(spike.stat.channelId);
    items.push({
      id: `ins_${spike.stat.channelId.toLowerCase()}_failure`,
      severity: severityForDelta(spike.delta, spike.stat.rate),
      title:
        lang === 'id'
          ? `Failure rate ${spike.stat.channelName} naik ${formatPts(spike.delta)} poin`
          : `${spike.stat.channelName} failure rate up ${formatPts(spike.delta)} points`,
      detail:
        lang === 'id'
          ? `${formatPct(spike.prev.rate)} (${period.compare?.start.slice(0, 7)}) menjadi ${formatPct(
              spike.stat.rate,
            )} (${periodText}); ${spike.stat.failed} transaksi gagal dari ${spike.stat.total}.${
              base ? ` Baseline pra-insiden ${formatPct(base.rate)}.` : ''
            }`
          : `${formatPct(spike.prev.rate)} (${period.compare?.start.slice(0, 7)}) to ${formatPct(
              spike.stat.rate,
            )} (${periodText}); ${spike.stat.failed} failed of ${spike.stat.total}.${
              base ? ` Pre-incident baseline ${formatPct(base.rate)}.` : ''
            }`,
      metric: 'failure_rate',
      channel: spike.stat.channelName,
      period: periodText,
      evidence: {
        sql: `SELECT channel_name, COUNT(*) total, SUM(status='FAILED') failed FROM ${scope.table} WHERE transaction_date BETWEEN '${period.start}' AND '${period.end}' GROUP BY channel_id`,
        refs: ['transactions', 'channels'],
      },
      links: [
        {
          label: lang === 'id' ? 'Investigasi' : 'Investigate',
          href: `/investigations?topic=${encodeURIComponent(spike.stat.channelName)}`,
        },
        {
          label: lang === 'id' ? 'Lihat kanal' : 'View channel',
          href: `/dashboard?channel=${encodeURIComponent(spike.stat.channelId)}`,
        },
      ],
    });
  }

  const curCodes = codeCounts(db, scope, period.start, period.end, filters);
  if (period.compare) {
    const prevCodes = codeCounts(db, scope, period.compare.start, period.compare.end, filters);
    const spikesCodes: { code: string; cur: number; prev: number; ratio: number }[] = [];
    for (const [code, count] of curCodes.counts) {
      const curPer1000 = curCodes.total ? (count / curCodes.total) * 1000 : 0;
      const prevCount = prevCodes.counts.get(code) ?? 0;
      const prevPer1000 = prevCodes.total ? (prevCount / prevCodes.total) * 1000 : 0;
      if (curPer1000 >= 2 && prevPer1000 > 0 && curPer1000 >= prevPer1000 * 2) {
        spikesCodes.push({ code, cur: curPer1000, prev: prevPer1000, ratio: curPer1000 / prevPer1000 });
      }
    }
    spikesCodes.sort((a, b) => b.ratio - a.ratio);
    for (const spike of spikesCodes.slice(0, 2)) {
      items.push({
        id: `ins_code_${spike.code.toLowerCase()}_spike`,
        severity: spike.ratio >= 3 ? 'high' : 'medium',
        title:
          lang === 'id'
            ? `Kode ${spike.code} melonjak ${formatPts(spike.ratio)}x`
            : `Code ${spike.code} spiked ${formatPts(spike.ratio)}x`,
        detail:
          lang === 'id'
            ? `${formatPts(spike.cur)} per 1.000 transaksi (sebelumnya ${formatPts(spike.prev)}).`
            : `${formatPts(spike.cur)} per 1,000 transactions (previously ${formatPts(spike.prev)}).`,
        metric: 'failure_count_per_1000',
        channel: null,
        period: periodText,
        evidence: {
          sql: `SELECT failure_code, COUNT(*) n FROM ${scope.table} WHERE status='FAILED' AND transaction_date BETWEEN '${period.start}' AND '${period.end}' GROUP BY failure_code`,
          refs: ['transactions', 'failure_codes'],
        },
        links: [
          {
            label: lang === 'id' ? 'Investigasi' : 'Investigate',
            href: `/investigations?failureCode=${encodeURIComponent(spike.code)}`,
          },
        ],
      });
    }
  }

  if (period.compare) {
    const curCats = categoryVolumes(db, scope, period.start, period.end, filters);
    const prevCats = categoryVolumes(db, scope, period.compare.start, period.compare.end, filters);
    const changes: { name: string; cur: number; prev: number; pct: number }[] = [];
    for (const [name, cur] of curCats) {
      const prev = prevCats.get(name) ?? 0;
      if (prev < 200 || cur < 200) continue;
      const pct = round2(((cur - prev) / prev) * 100);
      if (Math.abs(pct) >= 10) changes.push({ name, cur, prev, pct });
    }
    changes.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    for (const change of changes.slice(0, 2)) {
      items.push({
        id: `ins_cat_${change.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}_volume`,
        severity: Math.abs(change.pct) >= 25 ? 'medium' : 'low',
        title:
          lang === 'id'
            ? `Volume kategori ${change.name} ${change.pct > 0 ? 'naik' : 'turun'} ${formatPts(Math.abs(change.pct))}%`
            : `Category ${change.name} volume ${change.pct > 0 ? 'up' : 'down'} ${formatPts(Math.abs(change.pct))}%`,
        detail:
          lang === 'id'
            ? `${change.prev} menjadi ${change.cur} transaksi dibanding rentang setara.`
            : `${change.prev} to ${change.cur} transactions versus the equivalent range.`,
        metric: 'volume',
        channel: null,
        period: periodText,
        evidence: {
          sql: `SELECT category, COUNT(*) n FROM ${scope.table} WHERE transaction_date BETWEEN '${period.start}' AND '${period.end}' GROUP BY category`,
          refs: ['transactions'],
        },
        links: [
          {
            label: lang === 'id' ? 'Lihat kategori' : 'View category',
            href: `/dashboard?category=${encodeURIComponent(change.name)}`,
          },
        ],
      });
    }
  }

  if (scope.kind === 'seed') {
    const incidents = allRows(
      db,
      `SELECT incident_id, title, channel_id, severity, started_at, status, root_cause
         FROM seed.incident_log
        WHERE date(started_at) <= ? AND (ended_at IS NULL OR date(ended_at) >= ?)
        ORDER BY started_at DESC
        LIMIT 2`,
      [period.end, period.start],
    );
    for (const incident of incidents) {
      items.push({
        id: `ins_${str(incident.incident_id).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        severity: str(incident.severity).toLowerCase() === 'high' ? 'high' : 'medium',
        title: str(incident.title),
        detail:
          lang === 'id'
            ? `Insiden ${str(incident.incident_id)} (${str(incident.status)}) aktif pada periode ini. ${str(
                incident.root_cause,
              )}`
            : `Incident ${str(incident.incident_id)} (${str(incident.status)}) overlaps this period. ${str(
                incident.root_cause,
              )}`,
        metric: 'incident',
        channel: null,
        period: periodText,
        evidence: {
          sql: `SELECT * FROM seed.incident_log WHERE date(started_at) <= '${period.end}' AND (ended_at IS NULL OR date(ended_at) >= '${period.start}')`,
          refs: ['incident_log', 'Catatan_Insiden_Okt-Nov_2026.txt'],
        },
        links: [
          {
            label: lang === 'id' ? 'Baca catatan insiden' : 'Read incident log',
            href: `/sources?doc=${encodeURIComponent('Catatan Insiden Operasional Okt-Nov 2026')}`,
          },
        ],
      });
    }
  }

  const severityRank: Record<Insight['severity'], number> = { high: 3, medium: 2, low: 1 };
  const unique = new Map<string, Insight>();
  for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);
  const ordered = [...unique.values()].sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);

  return {
    items: ordered.slice(0, Math.max(1, Math.min(limit, 10))),
    generatedAt: nowJakartaIso(),
    period,
    dataset: scope.ref,
  };
}

function formatPts(value: number): string {
  const text = round1(value).toFixed(1);
  return text.replace('.', ',');
}

function formatPct(value: number): string {
  return `${round2(value).toFixed(2).replace('.', ',')}%`;
}

function shiftIsoMonth(iso: string, delta: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const first = new Date(Date.UTC(y, m - 1 + delta, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(
    Math.min(d, lastDay),
  ).padStart(2, '0')}`;
}

function shiftPeriodStart(iso: string, months: number): string {
  return shiftIsoMonth(iso, months);
}

function shiftPeriodEnd(iso: string, months: number): string {
  return shiftIsoMonth(iso, months);
}
