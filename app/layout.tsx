import type { Metadata, Viewport } from 'next';
import './globals.css';
import { inter, jakarta } from '@/lib/fonts';
import { MotionVisibility } from '@/lib/ui/motion-visibility';
import { TooltipProvider } from '@/components/ui/icon-tooltip';

/*
 * SEO positioning SaaS RAG (arah user: general use, bukan SQL-first). Domain
 * tidak dihardcode: NEXT_PUBLIC_SITE_URL dengan fallback lokal, diganti saat
 * deploy. og:image menunjuk path relatif /og-image.png (1200x630); berkasnya
 * wajib screenshot nyata produk, bukan ilustrasi.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const TITLE = 'TanyaData: Analisis Dokumen dan Data dengan AI';
const DESCRIPTION =
  'Unggah dokumen dan data, ajukan pertanyaan dalam bahasa sehari-hari, dan dapatkan jawaban dengan sumber yang bisa dibuka.';

/** JSON-LD SoftwareApplication. Tanpa offers/aggregateRating/review: tidak ada data harga atau ulasan nyata. Tanpa publisher orang (P7). */
const SOFTWARE_APPLICATION_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'TanyaData',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web browser',
  inLanguage: 'id',
  description:
    'Unggah dokumen dan data, ajukan pertanyaan dalam bahasa sehari-hari, dan dapatkan jawaban dengan sumber yang bisa dibuka.',
  featureList: [
    'Tanya dokumen PDF, DOCX, TXT, dan MD',
    'Analisis data CSV, XLSX, dan SQL',
    'Jawaban dengan kutipan sumber yang bisa dibuka',
    'Bagikan hasil sebagai halaman read-only',
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s · TanyaData',
  },
  description: DESCRIPTION,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'TanyaData',
    locale: 'id_ID',
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'TanyaData: analisis data dengan SQL dan sitasi yang bisa ditelusur',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
};

/* Bar browser mobile ikut warna band gelap landing (token --color-forest). */
export const viewport: Viewport = {
  themeColor: '#0B4433',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${inter.variable} ${jakarta.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_APPLICATION_JSONLD) }}
        />
        <MotionVisibility />
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
