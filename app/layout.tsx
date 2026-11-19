import type { Metadata } from 'next';
import './globals.css';
import { inter, jakarta } from '@/lib/fonts';
import { IconProvider } from '@/components/ui/icon-provider';

export const metadata: Metadata = {
  title: {
    default: 'TanyaData',
    template: '%s · TanyaData',
  },
  description: 'Tanyakan datanya. Temukan wawasannya.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${inter.variable} ${jakarta.variable}`}>
      <body>
        {/* A-07: stroke ikon 1,5 untuk seluruh aplikasi (§2.6), satu sumber. */}
        <IconProvider>{children}</IconProvider>
      </body>
    </html>
  );
}
