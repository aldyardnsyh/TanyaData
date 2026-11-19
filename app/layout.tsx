import type { Metadata } from 'next';
import './globals.css';
import { inter, jakarta } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'TanyaData',
  description: 'Tanyakan Datanya. Temukan Wawasannya.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${inter.variable} ${jakarta.variable}`}>
      <body>{children}</body>
    </html>
  );
}
