import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Asisten' };

export default function AssistantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
