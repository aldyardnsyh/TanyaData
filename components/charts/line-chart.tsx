'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useMediaQuery } from '@/lib/ui/media-query';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

const SERIES_COLORS = ['#0B4433', '#A8C9B8', '#68270D', '#7E8880', '#CF7656'];
const TOOLTIP_STYLE = { backgroundColor: '#FFFFFF', border: '1px solid #DDE2DA', borderRadius: 12, color: '#1B211D', fontSize: 12, boxShadow: '0 8px 24px rgb(27 33 29 / 0.12)' };

export interface LineChartProps {
  data: Record<string, any>[];
  xKey: string;
  series: { key: string; label: string; color?: string }[];
  title: string;
  height?: number;
  summary?: string;
  emptyText?: string;
  className?: string;
  tableData?: { header: string[]; rows: string[][] };
}

/** Motion #3: draw-in 320ms; tooltip fade 80ms hanya saat hover/fokus. */
export function LineChart({ data, xKey, series, title, height = 280, summary, emptyText, className, tableData }: LineChartProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const chartHeight = isMobile ? 200 : height;
  const isEmpty = data.length === 0 || data.every((d) => series.every((s) => !d[s.key]));

  return (
    <figure className={cn('w-full', className)} aria-label={title}>
      <figcaption className="sr-only">{summary ?? title}</figcaption>
      {tableData && tableData.rows.length > 0 && (
        <table className="sr-only">
          <thead><tr>{tableData.header.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{tableData.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
        </table>
      )}
      <div className="w-full" style={{ height: chartHeight }}>
        {isEmpty ? (
          <div className="flex h-full items-center justify-center font-body text-body-md text-ink-muted-strong">{emptyText ?? 'Tidak ada data pada filter ini.'}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#DDE2DA" strokeWidth={1} vertical={false} />
              <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: '#636C65' }} tickLine={false} axisLine={{ stroke: '#DDE2DA' }} />
              <YAxis tick={{ fontSize: 12, fill: '#636C65' }} tickLine={false} axisLine={{ stroke: '#DDE2DA' }} domain={[0, 'auto']} />
              <Tooltip animationDuration={80} contentStyle={TOOLTIP_STYLE} labelStyle={{ fontWeight: 600 }} formatter={(value: any) => (typeof value === 'number' ? value.toLocaleString('id-ID') : value)} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#636C65' }} iconSize={8} />
              {series.map((s, i) => (
                <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} fill={s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.15} animationDuration={320} animationEasing="ease-out" isAnimationActive={!prefersReduced} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}
