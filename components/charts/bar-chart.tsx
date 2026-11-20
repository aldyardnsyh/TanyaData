'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useMediaQuery } from '@/lib/ui/media-query';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SERIES_COLORS = ['#0b4433', '#9cd2ba', '#68270d', '#586400', '#707974'];

export interface BarChartProps {
  data: Record<string, any>[];
  xKey: string;
  series: { key: string; label: string; color?: string }[];
  title: string;
  height?: number;
  summary?: string;
  emptyText?: string;
  className?: string;
  onClick?: (data: Record<string, any>) => void;
  /** C-09: tabel alternatif sr-only untuk pembaca layar. */
  tableData?: { header: string[]; rows: string[][] };
}

export function BarChart({ data, xKey, series, title, height = 280, summary, emptyText, className, onClick, tableData }: BarChartProps) {
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
          <tbody>
            {tableData.rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="w-full" style={{ height: chartHeight }}>
        {isEmpty ? (
          <div className="flex h-full items-center justify-center text-on-surface-variant font-body text-body-md">
            {emptyText ?? 'Tidak ada data untuk filter ini.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} onClick={onClick}>
              <CartesianGrid stroke="#dee4df" strokeWidth={1} vertical={false} />
              <XAxis
                dataKey={xKey}
                tick={{ fontSize: 11, fill: '#707974' }}
                tickLine={false}
                axisLine={{ stroke: '#c0c9c2' }}
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#707974' }}
                tickLine={false}
                axisLine={{ stroke: '#c0c9c2' }}
                domain={[0, 'auto']}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#2c322f', border: 'none', borderRadius: 8, color: '#ecf2ed', fontSize: 12 }}
                labelStyle={{ fontWeight: 600 }}
                formatter={(value: any) => (typeof value === 'number' ? value.toLocaleString('id-ID') : value)}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#404944' }} iconSize={8} />
              {series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  fill={s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                  animationDuration={400}
                  animationEasing="ease-out"
                  isAnimationActive={!prefersReduced}
                />
              ))}
            </RechartsBarChart>
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}
