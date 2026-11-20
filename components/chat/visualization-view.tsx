import type { Visualization } from '@/lib/contracts/http';
import { BarChart } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import { PieChart } from '@/components/charts/pie-chart';
import { formatIdr, formatNumber, formatPercent } from '@/lib/ui/format';

function fmtValue(v: number | null, format?: Visualization['format']): string {
  if (format === 'currency') return formatIdr(v);
  if (format === 'percent') return formatPercent(v);
  return formatNumber(v);
}

/** Renderer untuk `Visualization` dari chat/report sesuai kontrak (bar/line/pie/kpi). */
export function VisualizationView({ viz }: { viz: Visualization }) {
  const rows = viz.rows ?? [];
  const series =
    viz.series.length > 0
      ? viz.series.map((s) => ({ key: s.key, label: s.label }))
      : [{ key: viz.dataKey, label: viz.title }];

  if (viz.type === 'kpi') {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={viz.title}>
        {rows.map((row, i) => {
          const label = String(row[viz.xKey] ?? '');
          const raw = row[viz.dataKey];
          const value = typeof raw === 'number' ? raw : null;
          return (
            <div key={`${label}-${i}`} className="rounded-card border border-border-hairline bg-surface p-3">
              <p className="font-body text-label-sm uppercase text-ink-muted-strong">{label}</p>
              <p className="mt-1 font-body text-metric-md tabular text-ink">
                {fmtValue(value, viz.format)}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  if (viz.type === 'pie') {
    const total = rows.reduce((acc, r) => acc + (typeof r[viz.dataKey] === 'number' ? (r[viz.dataKey] as number) : 0), 0);
    const data = rows.map((r) => {
      const value = typeof r[viz.dataKey] === 'number' ? (r[viz.dataKey] as number) : 0;
      return {
        name: String(r[viz.xKey] ?? ''),
        value,
        percent: total > 0 ? (value / total) * 100 : 0,
      };
    });
    return <PieChart data={data} title={viz.title} />;
  }

  const data = rows.map((r) => {
    const out: Record<string, string | number | null> = { ...r };
    return out;
  });

  if (viz.type === 'line') {
    return <LineChart data={data} xKey={viz.xKey} series={series} title={viz.title} height={220} />;
  }

  return <BarChart data={data} xKey={viz.xKey} series={series} title={viz.title} height={220} />;
}
