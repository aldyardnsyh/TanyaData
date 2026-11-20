import type { Metadata } from 'next';
import './globals.css';
import { inter, jakarta } from '@/lib/fonts';

export const metadata: Metadata = {
  title: {
    default: 'TanyaData',
    template: '%s · TanyaData',
  },
  description: 'Ask the data. Find the insight.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      <body>{children}</body>
    </html>
  );
}
