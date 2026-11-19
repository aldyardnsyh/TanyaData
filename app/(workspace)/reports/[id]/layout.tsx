import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dokumen Laporan' };

export default function ReportDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
