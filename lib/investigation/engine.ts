import { randomUUID } from 'node:crypto';
import type { DB } from '@/lib/db/client';
import type {
  AnomaliesResponse,
  AnomalyItem,
  ContributionChannel,
  FailureCodeContribution,
  Investigation,
  InvestigationDetailResponse,
  InvestigationListItem,
  InvestigationsListResponse,
  InvestigationsOverviewResponse,
  Lang,
  Period,
  SourceCitation,
  TemporalPoint,
  TemporalSeries,
} from '@/lib/contracts/http';
import type { Scope } from '@/lib/analytics/scope';
import type { AnalyticsFilters } from '@/lib/analytics/filters';
import { buildFilters, combine, dateClause } from '@/lib/analytics/filters';
import { allRows, num, oneRow, str } from '@/lib/analytics/sql';
import { metricsForRange } from '@/lib/analytics/queries';
import { addDays, diffDays, formatDateLabel, monthStart, nowJakartaIso, round1, round2, safeRatio, weekStart } from '@/lib/date';
import { notFound } from '@/lib/errors';

type ChannelRow = {
  channelId: string;
  channelName: string;
  total: number;
  failed: number;
  rate: number;
};

function channelsIn(
  db: DB,
  scope: Scope,
  start: string,
  end: string,
  filters: AnalyticsFilters,
): Map<string, ChannelRow> {
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
  const map = new Map<string, ChannelRow>();
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

function daysInMonth(iso: string): number {
  return Number(new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate());
}

function monthWindow(iso: string): { start: string; end: string } {
  const start = monthStart(iso);
  const end = addDays(monthStart(addDays(start, 32)), -1);
  return { start, end };
}

function prevMonthWindow(iso: string, back: number): { start: string; end: string } {
  const current = monthStart(iso);
  const prevEnd = addDays(current, -1);
  for (let i = 1; i < back; i += 1) {
    return monthWindow(addDays(monthStart(prevEnd), -1));
  }
  return monthWindow(prevEnd);
}

function ratePer1000(db: DB, scope: Scope, start: string, end: string, code: string, filters: AnalyticsFilters): number {
  const where = combine([
    dateClause(scope, start, end),
    buildFilters(filters),
    { sql: 'status = ?', params: ['FAILED'] },
    { sql: 'failure_code = ?', params: [code] },
  ]);
  const failed = oneRow(db, `SELECT COUNT(*) AS n FROM ${scope.table} WHERE ${where.sql}`, where.params);
  const totalWhere = combine([dateClause(scope, start, end), buildFilters(filters)]);
  const total = oneRow(db, `SELECT COUNT(*) AS n FROM ${scope.table} WHERE ${totalWhere.sql}`, totalWhere.params);
  const totalN = num(total?.n);
  return totalN ? round2((num(failed?.n) / totalN) * 1000) : 0;
}

function contributionChannels(
  db: DB,
  scope: Scope,
  period: Period,
  filters: AnalyticsFilters,
): ContributionChannel[] {
  const current = channelsIn(db, scope, period.start, period.end, filters);
  const baselineWindow = prevMonthWindow(addDays(monthStart(period.start), -1), 2);
  const baseline = channelsIn(db, scope, baselineWindow.start, baselineWindow.end, filters);

  const rows: ContributionChannel[] = [];
  for (const [id, stat] of current) {
    if (stat.total < 50) continue;
    const base = baseline.get(id);
    const baselineRate = base ? base.rate : 0;
    const excess = ((stat.rate - baselineRate) / 100) * stat.total;
    if (excess <= 0) continue;
    rows.push({
      channelName: stat.channelName,
      failureRate: stat.rate,
      baselineFailureRate: baselineRate,
      excessFailures: round1(excess),
      shareOfExcess: 0,
    });
  }
  const totalExcess = rows.reduce((sum, r) => sum + r.excessFailures, 0);
  for (const row of rows) row.shareOfExcess = totalExcess ? round2(row.excessFailures / totalExcess) : 0;
  rows.sort((a, b) => b.excessFailures - a.excessFailures);
  return rows.slice(0, 5);
}

function failureCodeContributions(
  db: DB,
  scope: Scope,
  period: Period,
  filters: AnalyticsFilters,
): FailureCodeContribution[] {
  const sep = prevMonthWindow(addDays(monthStart(period.start), -1), 2);
  const oct = prevMonthWindow(addDays(monthStart(period.start), -1), 1);
  const nov = { start: period.start, end: period.end };

  const where = combine([
    dateClause(scope, period.start, period.end),
    buildFilters(filters),
    { sql: "status = 'FAILED' AND failure_code IS NOT NULL", params: [] },
  ]);
  const top = allRows(
    db,
    `SELECT failure_code, COUNT(*) AS n FROM ${scope.table} WHERE ${where.sql} GROUP BY failure_code ORDER BY n DESC LIMIT 6`,
    where.params,
  );

  const names = new Map<string, string>();
  try {
    const rows = allRows(db, 'SELECT failure_code, failure_name FROM seed.failure_codes');
    for (const row of rows) names.set(str(row.failure_code), str(row.failure_name));
  } catch {
    // tidak fatal
  }

  return top.map((row) => {
    const code = str(row.failure_code);
    return {
      failureCode: code,
      failureName: names.get(code) ?? code,
      per1000: {
        sep: ratePer1000(db, scope, sep.start, sep.end, code, filters),
        oct: ratePer1000(db, scope, oct.start, oct.end, code, filters),
        nov: ratePer1000(db, scope, nov.start, nov.end, code, filters),
      },
    };
  });
}

function concentration(
  db: DB,
  scope: Scope,
  period: Period,
  filters: AnalyticsFilters,
  topChannels: string[],
): Investigation['concentration'] {
  const where = combine([dateClause(scope, period.start, period.end), buildFilters(filters)]);
  const catRows = allRows(
    db,
    `SELECT channel_name, category, COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed
       FROM ${scope.table}
      WHERE ${where.sql}
      GROUP BY channel_id, category
     HAVING total >= 20
      ORDER BY failed DESC
      LIMIT 40`,
    where.params,
  );

  const byChannelCategory = catRows
    .map((row) => ({
      channelName: str(row.channel_name),
      category: str(row.category),
      failureRate: safeRatio(num(row.failed), num(row.total)),
    }))
    .filter((row) => !topChannels.length || topChannels.includes(row.channelName))
    .sort((a, b) => b.failureRate - a.failureRate)
    .slice(0, 6);

  const hourRows = allRows(
    db,
    `SELECT channel_name,
            CASE
              WHEN CAST(substr(created_at, 12, 2) AS INTEGER) < 6 THEN '00:00-05:59'
              WHEN CAST(substr(created_at, 12, 2) AS INTEGER) < 12 THEN '06:00-11:59'
              WHEN CAST(substr(created_at, 12, 2) AS INTEGER) < 18 THEN '12:00-17:59'
              ELSE '18:00-23:59'
            END AS bucket,
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed
       FROM ${scope.table}
      WHERE ${where.sql}
      GROUP BY channel_id, bucket
      HAVING total >= 20
      ORDER BY failed DESC
      LIMIT 12`,
    where.params,
  );

  const byHour = hourRows
    .map((row) => ({
      channelName: str(row.channel_name),
      bucket: str(row.bucket),
      failureRate: safeRatio(num(row.failed), num(row.total)),
    }))
    .filter((row) => !topChannels.length || topChannels.includes(row.channelName))
    .slice(0, 4);

  return { byChannelCategory, byHour };
}

function detectChangePoints(
  db: DB,
  scope: Scope,
  period: Period,
  channelNames: string[],
): { channelName: string; date: string }[] {
  if (!channelNames.length) return [];
  const expandedStart = addDays(period.start, -45);
  const where = combine([
    { sql: 'transaction_date BETWEEN ? AND ?', params: [expandedStart, period.end] },
    buildFilters({}),
  ]);
  const rows = allRows(
    db,
    `SELECT channel_name, transaction_date AS d, COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed
       FROM ${scope.table}
      WHERE ${where.sql}
      GROUP BY channel_id, transaction_date
      ORDER BY channel_id, transaction_date`,
    where.params,
  );

  const points: { channelName: string; date: string }[] = [];
  const byChannel = new Map<string, { date: string; rate: number; total: number }[]>();
  for (const row of rows) {
    const name = str(row.channel_name);
    if (!channelNames.includes(name)) continue;
    const list = byChannel.get(name) ?? [];
    list.push({ date: str(row.d), rate: safeRatio(num(row.failed), num(row.total)), total: num(row.total) });
    byChannel.set(name, list);
  }

  for (const [name, series] of byChannel) {
    if (series.length < 14) continue;
    const baseline = series.slice(0, 14).reduce((sum, p) => sum + p.rate, 0) / 14;
    let lastFlagged = '';
    for (let i = 14; i < series.length - 2; i += 1) {
      const point = series[i];
      const next1 = series[i + 1];
      const next2 = series[i + 2];
      const sustained = next1.rate > baseline + 3 && next2.rate > baseline + 3;
      const jump = point.rate > baseline + 5 && sustained;
      if (jump && (!lastFlagged || diffDays(lastFlagged, point.date) >= 7)) {
        points.push({ channelName: name, date: point.date });
        lastFlagged = point.date;
      }
    }
  }
  return points.slice(0, 6);
}

function temporalSeries(
  db: DB,
  scope: Scope,
  period: Period,
  channelNames: string[],
  filters: AnalyticsFilters,
): TemporalSeries[] {
  if (!channelNames.length) return [];
  const start = addDays(period.start, -35);
  const where = combine([dateClause(scope, start, period.end), buildFilters(filters)]);
  const rows = allRows(
    db,
    `SELECT channel_name,
            date(transaction_date, 'weekday 0', '-6 days') AS bucket,
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed
       FROM ${scope.table}
      WHERE ${where.sql}
      GROUP BY channel_id, bucket
      ORDER BY bucket`,
    where.params,
  );

  const grouped = new Map<string, { bucket: string; failureRate: number }[]>();
  for (const row of rows) {
    const name = str(row.channel_name);
    if (!channelNames.includes(name)) continue;
    const list = grouped.get(name) ?? [];
    list.push({ bucket: str(row.bucket), failureRate: safeRatio(num(row.failed), num(row.total)) });
    grouped.set(name, list);
  }

  return channelNames
    .slice(0, 2)
    .map((name) => ({ channelName: name, grain: 'week' as const, rows: grouped.get(name) ?? [] }))
    .filter((s) => s.rows.length > 0);
}

function incidentPoints(db: DB, period: Period, channelNames: string[]): TemporalPoint[] {
  try {
    const rows = allRows(
      db,
      `SELECT i.channel_id, c.channel_name, date(i.started_at) AS started, date(i.ended_at) AS ended
         FROM seed.incident_log i
         LEFT JOIN seed.channels c ON c.channel_id = i.channel_id
        WHERE date(i.started_at) BETWEEN ? AND ? AND i.incident_type <> 'Planned Maintenance'
        ORDER BY i.started_at`,
      [addDays(period.start, -45), period.end],
    );
    const points: TemporalPoint[] = [];
    for (const row of rows) {
      const name = str(row.channel_name);
      if (!channelNames.includes(name)) continue;
      points.push({ channelName: name, date: str(row.started), kind: 'start' });
      if (row.ended) points.push({ channelName: name, date: str(row.ended), kind: 'resolved' });
    }
    return points;
  } catch {
    return [];
  }
}

function retrieveDocuments(
  db: DB,
  question: string,
  channelNames: string[],
  lang: Lang,
): SourceCitation[] {
  const terms = [
    ...channelNames.slice(0, 2),
    ...(question.match(/F\d{2}/gi) ?? []),
    'failure rate',
    'timeout',
  ]
    .map((term) => term.replace(/[^a-zA-Z0-9 ]/g, ' ').trim())
    .filter(Boolean);
  const match = terms.map((term) => `"${term}"`).join(' OR ');

  try {
    const rows = allRows(
      db,
      `SELECT c.id, c.source_id, c.doc_title, c.section, c.page, c.content, bm25(document_chunks_fts) AS score
         FROM document_chunks_fts f
         JOIN document_chunks c ON c.id = f.rowid
        WHERE document_chunks_fts MATCH ?
        ORDER BY score
        LIMIT 3`,
      [match],
    );
    return rows.map((row) => ({
      kind: 'document' as const,
      sourceId: str(row.source_id),
      docTitle: str(row.doc_title),
      sectionNo: null,
      section: str(row.section) || null,
      page: row.page === null ? null : num(row.page),
      quote: buildQuote(str(row.content), channelNames[0], 240),
      chunkId: num(row.id),
      score: round2(1 / (1 + Math.abs(num(row.score)))),
    }));
  } catch {
    return [];
  }
}

function buildQuote(content: string, channel: string | undefined, max: number): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (channel) {
    const at = clean.toLowerCase().indexOf(channel.toLowerCase());
    if (at > 0) {
      const start = Math.max(0, at - 60);
      return `${start > 0 ? '...' : ''}${clean.slice(start, start + max)}`;
    }
  }
  return clean.slice(0, max);
}

function detectClaimLevel(documents: SourceCitation[], channel: string | undefined): Investigation['conclusion']['claimLevel'] {
  const causal = /disebabkan|akibat|karena|root cause|migrasi|rate limit|perubahan endpoint|deploy|rilis/i;
  for (const doc of documents) {
    if (!doc.quote) continue;
    if (!causal.test(doc.quote)) continue;
    if (channel && !doc.quote.toLowerCase().includes(channel.toLowerCase())) continue;
    return 'proven';
  }
  return 'indication';
}

export type AnalyzeInput = {
  db: DB;
  scope: Scope;
  period: Period;
  filters: AnalyticsFilters;
  question: string;
  persist: boolean;
  lang: Lang;
};

export function analyzeInvestigation(input: AnalyzeInput): Investigation {
  const { db, scope, period, filters, question, persist, lang } = input;

  const current = metricsForRange(db, scope, period.start, period.end, filters);
  const previous = period.compare
    ? metricsForRange(db, scope, period.compare.start, period.compare.end, filters)
    : null;

  const channels = contributionChannels(db, scope, period, filters);
  const failureCodes = failureCodeContributions(db, scope, period, filters);
  const topNames = channels.slice(0, 3).map((c) => c.channelName);

  const concentrationData = concentration(db, scope, period, filters, topNames);
  const changePoints = detectChangePoints(db, scope, period, topNames);
  const series = temporalSeries(db, scope, period, topNames, filters);
  const incident = incidentPoints(db, period, topNames);
  const documents = retrieveDocuments(db, question, topNames, lang);

  const points: TemporalPoint[] = [];
  for (const point of incident) points.push(point);
  for (const change of changePoints) {
    if (!points.some((p) => p.channelName === change.channelName && p.date === change.date)) {
      points.push({ channelName: change.channelName, date: change.date, kind: 'worsened' });
    }
  }
  points.sort((a, b) => a.date.localeCompare(b.date));

  const top = channels[0];
  const claimLevel = detectClaimLevel(documents, top?.channelName);

  const notes: string[] = [];
  if (period.isPartial) {
    notes.push(
      lang === 'id'
        ? `${period.end} adalah bulan berjalan (${Number(period.end.slice(8, 10))}/${daysInMonth(period.end)} hari); angka bersifat sementara.`
        : `${period.end} is a partial month (${Number(period.end.slice(8, 10))}/${daysInMonth(period.end)} days); figures are provisional.`,
    );
  }
  if (series.length && period.dayCount > 14) {
    notes.push(lang === 'id' ? 'Seri mingguan dapat memuat minggu parsial di kedua ujung.' : 'Weekly series may include partial weeks at both ends.');
  }

  const conclusionText =
    lang === 'id'
      ? top
        ? `Kenaikan failure rate tidak merata: kontribusi terbesar dari ${top.channelName} (${top.failureRate.toFixed(
            2,
          )}%, baseline ${top.baselineFailureRate.toFixed(2)}%). ${
            claimLevel === 'proven'
              ? 'Penyebab didukung kutipan dokumen.'
              : 'Data menunjukkan indikasi, bukan sebab terbukti.'
          }`
        : 'Tidak ada kenaikan kegagalan yang material pada periode ini.'
      : top
        ? `The failure-rate increase is uneven: ${top.channelName} contributes most (${top.failureRate.toFixed(
            2,
          )}%, baseline ${top.baselineFailureRate.toFixed(2)}%). ${
            claimLevel === 'proven' ? 'Cause is supported by document quotes.' : 'Data indicates correlation, not proven cause.'
          }`
        : 'No material failure-rate increase in this period.';

  const caveats =
    lang === 'id'
      ? [
          'Analisis memakai agregasi SQL, bukan inferensi kausal.',
          claimLevel === 'proven'
            ? 'Tingkat "proven" hanya karena ada kutipan dokumen yang menyatakan sebab; verifikasi manual tetap disarankan.'
            : 'Sebab terbukti memerlukan pernyataan dokumen/insiden; saat ini hanya indikasi.',
        ]
      : [
          'Analysis uses SQL aggregation, not causal inference.',
          claimLevel === 'proven'
            ? 'The "proven" level comes only from a document quote stating the cause; manual verification is still advised.'
            : 'A proven cause requires a document/incident statement; currently this is an indication.',
        ];

  const periodLabel = formatDateLabel(period.start, period.end, lang);
  const investigation: Investigation = {
    id: `inv_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
    question,
    createdAt: nowJakartaIso(),
    period: { ...period, label: periodLabel },
    dataset: scope.ref,
    comparison: {
      failureRate: {
        current: current.failureRate,
        previous: previous ? previous.failureRate : 0,
        deltaPctPoints: round2(current.failureRate - (previous ? previous.failureRate : 0)),
      },
      total: {
        current: current.total,
        previous: previous ? previous.total : 0,
        changePct: previous && previous.total ? round2(((current.total - previous.total) / previous.total) * 100) : null,
      },
    },
    contribution: { channels, failureCodes },
    concentration: concentrationData,
    temporal: { points, series, notes },
    documents,
    conclusion: { text: conclusionText, claimLevel, caveats },
    evidence: {
      sql: [
        `SELECT channel_name, COUNT(*) total, SUM(status='FAILED') failed FROM ${scope.table} WHERE transaction_date BETWEEN '${period.start}' AND '${period.end}' GROUP BY channel_id`,
        `SELECT failure_code, COUNT(*) n FROM ${scope.table} WHERE status='FAILED' AND transaction_date BETWEEN '${period.start}' AND '${period.end}' GROUP BY failure_code`,
      ],
      sourceIds: [...new Set(documents.map((d) => d.sourceId))],
    },
  };

  if (persist) {
    db.prepare(
      `INSERT INTO investigations
         (id, question, dataset_id, period_start, period_end, compare_start, compare_end, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      investigation.id,
      question,
      scope.id,
      period.start,
      period.end,
      period.compare?.start ?? null,
      period.compare?.end ?? null,
      JSON.stringify(investigation),
      investigation.createdAt,
    );
  }

  return investigation;
}

export function getOverview(
  db: DB,
  scope: Scope,
  period: Period,
  filters: AnalyticsFilters,
  lang: Lang,
): InvestigationsOverviewResponse {
  const current = metricsForRange(db, scope, period.start, period.end, filters);
  const previous = period.compare
    ? metricsForRange(db, scope, period.compare.start, period.compare.end, filters)
    : null;

  const currentChannels = channelsIn(db, scope, period.start, period.end, filters);
  const prevMonth = prevMonthWindow(addDays(monthStart(period.start), -1), 1);
  const prevMonthChannels = channelsIn(db, scope, prevMonth.start, prevMonth.end, filters);
  const baselineWindow = prevMonthWindow(addDays(monthStart(period.start), -1), 2);
  const baselineChannels = channelsIn(db, scope, baselineWindow.start, baselineWindow.end, filters);

  const topChannels = [...currentChannels.values()]
    .map((stat) => {
      const base = baselineChannels.get(stat.channelId);
      const baselineRate = base ? base.rate : 0;
      const excess = ((stat.rate - baselineRate) / 100) * stat.total;
      return {
        channelName: stat.channelName,
        failureRate: stat.rate,
        previousFailureRate: prevMonthChannels.get(stat.channelId)?.rate ?? 0,
        excessFailures: round1(Math.max(0, excess)),
        severity: severity(stat.rate, baselineRate),
      };
    })
    .filter((row) => row.excessFailures > 0)
    .sort((a, b) => b.excessFailures - a.excessFailures)
    .slice(0, 3);

  const changePoints = detectChangePoints(
    db,
    scope,
    period,
    topChannels.map((c) => c.channelName),
  );

  const saved = oneRow(db, 'SELECT COUNT(*) AS n FROM investigations');

  return {
    period,
    failureRate: {
      current: current.failureRate,
      previous: previous ? previous.failureRate : 0,
      deltaPctPoints: round2(current.failureRate - (previous ? previous.failureRate : 0)),
    },
    topChannels,
    changePoints,
    saved: num(saved?.n),
  };
}

function severity(rate: number, baseline: number): 'high' | 'medium' | 'low' {
  const delta = rate - baseline;
  if (rate >= 10 || delta >= 5) return 'high';
  if (rate >= 5 || delta >= 2) return 'medium';
  return 'low';
}

export function getAnomalies(
  db: DB,
  scope: Scope,
  period: Period,
  filters: AnalyticsFilters,
  lang: Lang,
): AnomaliesResponse {
  const items: AnomalyItem[] = [];
  const current = channelsIn(db, scope, period.start, period.end, filters);
  const previous = period.compare
    ? channelsIn(db, scope, period.compare.start, period.compare.end, filters)
    : new Map<string, ChannelRow>();

  for (const [id, stat] of current) {
    const prev = previous.get(id);
    if (!prev || prev.total < 50 || stat.total < 50) continue;
    const delta = round2(stat.rate - prev.rate);
    const doubled = prev.rate > 0 && stat.rate >= prev.rate * 2;
    if (delta < 2 && !doubled) continue;
    items.push({
      id: `an_${id.toLowerCase()}`,
      severity: severity(stat.rate, prev.rate),
      kind: 'channel_failure_spike',
      channelName: stat.channelName,
      metric: 'failure_rate',
      baseline: prev.rate,
      current: stat.rate,
      deltaPctPoints: delta,
      detectedAt: period.end,
      window: `${period.start}..${period.end}`,
      evidence: {
        sql: `SELECT channel_name, COUNT(*) total, SUM(status='FAILED') failed FROM ${scope.table} WHERE transaction_date BETWEEN '${period.start}' AND '${period.end}' GROUP BY channel_id`,
      },
    });
  }

  if (period.compare) {
    const curWhere = combine([
      dateClause(scope, period.start, period.end),
      buildFilters(filters),
      { sql: "status='FAILED' AND failure_code IS NOT NULL", params: [] },
    ]);
    const prevWhere = combine([
      dateClause(scope, period.compare.start, period.compare.end),
      buildFilters(filters),
      { sql: "status='FAILED' AND failure_code IS NOT NULL", params: [] },
    ]);
    const cur = allRows(
      db,
      `SELECT failure_code, COUNT(*) n FROM ${scope.table} WHERE ${curWhere.sql} GROUP BY failure_code`,
      curWhere.params,
    );
    const prev = allRows(
      db,
      `SELECT failure_code, COUNT(*) n FROM ${scope.table} WHERE ${prevWhere.sql} GROUP BY failure_code`,
      prevWhere.params,
    );
    const prevMap = new Map(prev.map((row) => [str(row.failure_code), num(row.n)]));
    for (const row of cur) {
      const code = str(row.failure_code);
      const n = num(row.n);
      const base = prevMap.get(code) ?? 0;
      if (n < 20 || base === 0 || n < base * 2) continue;
      items.push({
        id: `an_code_${code.toLowerCase()}`,
        severity: n >= base * 3 ? 'high' : 'medium',
        kind: 'failure_code_spike',
        metric: 'failure_count',
        baseline: base,
        current: n,
        deltaPctPoints: round2(((n - base) / base) * 100),
        detectedAt: period.end,
        window: `${period.start}..${period.end}`,
        evidence: {
          sql: `SELECT failure_code, COUNT(*) n FROM ${scope.table} WHERE status='FAILED' AND transaction_date BETWEEN '${period.start}' AND '${period.end}' GROUP BY failure_code`,
        },
      });
    }

    const curCats = allRows(
      db,
      `SELECT category, COUNT(*) n FROM ${scope.table} WHERE ${combine([dateClause(scope, period.start, period.end), buildFilters(filters)]).sql} GROUP BY category`,
      combine([dateClause(scope, period.start, period.end), buildFilters(filters)]).params,
    );
    const prevCats = allRows(
      db,
      `SELECT category, COUNT(*) n FROM ${scope.table} WHERE ${combine([dateClause(scope, period.compare.start, period.compare.end), buildFilters(filters)]).sql} GROUP BY category`,
      combine([dateClause(scope, period.compare.start, period.compare.end), buildFilters(filters)]).params,
    );
    const prevCatMap = new Map(prevCats.map((row) => [str(row.category), num(row.n)]));
    for (const row of curCats) {
      const name = str(row.category);
      const n = num(row.n);
      const base = prevCatMap.get(name) ?? 0;
      if (base < 200 || n < 200) continue;
      const pct = round2(((n - base) / base) * 100);
      if (Math.abs(pct) < 10) continue;
      items.push({
        id: `an_cat_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`,
        severity: Math.abs(pct) >= 25 ? 'medium' : 'low',
        kind: 'category_volume_change',
        metric: 'volume',
        baseline: base,
        current: n,
        deltaPctPoints: pct,
        detectedAt: period.end,
        window: `${period.start}..${period.end}`,
        evidence: {
          sql: `SELECT category, COUNT(*) n FROM ${scope.table} WHERE transaction_date BETWEEN '${period.start}' AND '${period.end}' GROUP BY category`,
        },
      });
    }
  }

  const rank = { high: 3, medium: 2, low: 1 };
  items.sort((a, b) => rank[b.severity] - rank[a.severity] || Math.abs(b.deltaPctPoints) - Math.abs(a.deltaPctPoints));
  const unique = new Map<string, AnomalyItem>();
  for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);
  return { items: [...unique.values()].slice(0, 10), total: unique.size };
}

export function listInvestigations(db: DB, limit: number, offset: number): InvestigationsListResponse {
  const total = num(oneRow(db, 'SELECT COUNT(*) AS n FROM investigations')?.n);
  const rows = allRows(
    db,
    'SELECT id, question, period_start, period_end, payload_json, created_at FROM investigations ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset],
  );
  const items: InvestigationListItem[] = rows.map((row) => {
    let topChannel: string | null = null;
    let claimLevel: InvestigationListItem['claimLevel'] = 'indication';
    let datasetId: string | null = null;
    let datasetName: string | null = null;
    try {
      const payload = JSON.parse(str(row.payload_json)) as Investigation;
      topChannel = payload.contribution?.channels?.[0]?.channelName ?? null;
      claimLevel = payload.conclusion?.claimLevel ?? 'indication';
      datasetId = payload.dataset?.id ?? null;
      datasetName = payload.dataset?.name ?? null;
    } catch {
      // payload rusak tetap ditampilkan
    }
    return {
      id: str(row.id),
      question: str(row.question),
      period: `${str(row.period_start)}..${str(row.period_end)}`,
      datasetId,
      datasetName,
      topChannel,
      claimLevel,
      createdAt: str(row.created_at),
    };
  });
  return { items, total, limit, offset };
}

export function getInvestigation(db: DB, id: string): InvestigationDetailResponse {
  const row = oneRow(db, 'SELECT payload_json FROM investigations WHERE id = ?', [id]);
  if (!row) throw notFound('Investigasi tidak ditemukan');
  try {
    return { investigation: JSON.parse(str(row.payload_json)) as Investigation };
  } catch {
    throw notFound('Investigasi tidak dapat dibaca');
  }
}

export { weekStart };
