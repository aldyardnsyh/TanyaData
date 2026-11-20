'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { PieChart as RechartsPieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useMediaQuery } from '@/lib/ui/media-query';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: '#0B4433',
  FAILED: '#CF7656',
  PENDING: '#A8C9B8',
  EXPIRED: '#DDE2DA',
  REFUNDED: '#7E8880',
};
const TOOLTIP_STYLE = { backgroundColor: '#FFFFFF', border: '1px solid #DDE2DA', borderRadius: 12, color: '#1B211D', fontSize: 12, boxShadow: '0 8px 24px rgb(27 33 29 / 0.12)' };

export interface PieChartProps {
  data: { name: string; value: number; percent: number }[];
  title: string;
  summary?: string;
  emptyText?: string;
  className?: string;
  onClick?: (data: any) => void;
  tableData?: { header: string[]; rows: string[][] };
}

/** Motion #3: draw-in 320ms; tooltip fade 80ms hanya saat hover/fokus. */
export function PieChart({ data, title, summary, emptyText, className, onClick, tableData }: PieChartProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const isEmpty = data.length === 0 || data.every((d) => d.value === 0);

  return (
    <figure className={cn('w-full', className)} aria-label={title}>
      <figcaption className="sr-only">{summary ?? title}</figcaption>
      {tableData && tableData.rows.length > 0 && (
        <table className="sr-only">
          <thead><tr>{tableData.header.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{tableData.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
        </table>
      )}
      <div className="w-full" style={{ height: isMobile ? 200 : 280 }}>
        {isEmpty ? (
          <div className="flex h-full items-center justify-center font-body text-body-md text-ink-muted-strong">{emptyText ?? 'Tidak ada data pada filter ini.'}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RechartsPieChart onClick={onClick}>
              <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value" label={(entry) => `${entry.name}: ${(entry.percent ?? 0).toFixed(1)}%`} labelLine={false} animationDuration={320} isAnimationActive={!prefersReduced}>
                {data.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name] ?? '#0B4433'} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} animationDuration={80} formatter={(value, name) => [`${(value ?? 0).toLocaleString('id-ID')} (${(data.find((d) => d.name === name)?.percent ?? 0).toFixed(1)}%)`, name]} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#636C65' }} iconSize={8} />
            </RechartsPieChart>
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}
