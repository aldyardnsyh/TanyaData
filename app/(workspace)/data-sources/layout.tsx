import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sumber Data' };

export default function DataSourcesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
