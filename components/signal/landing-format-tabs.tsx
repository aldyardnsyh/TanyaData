'use client';

import { useState } from 'react';
import { AnimatedTabs, type TabItem } from '@/components/signal/animated-tabs';

/**
 * S4 Kapabilitas dokumen (LANDING_COPY_SEO §2-S4, komponen C-04 Context Tabs).
 * Purpose Gate: tab dipakai karena dua kelompok format punya perlakuan
 * berbeda (query SQL untuk data terstruktur, sitasi halaman untuk dokumen),
 * bukan untuk menghias daftar. Dua tab, bukan tiga sampai lima: produk hanya
 * menerima dua kelompok format, kelompok tambahan berarti klaim rekaan.
 * Panel hanya menampilkan format yang disebut kontrak; tanpa deskripsi
 * tambahan supaya tidak lahir klaim baru di luar kontrak.
 */
const TABS: TabItem[] = [
  { id: 'structured', label: 'Data terstruktur' },
  { id: 'documents', label: 'Dokumen' },
];

const FORMATS: Record<string, readonly string[]> = {
  structured: ['CSV', 'XLSX', 'SQL'],
  documents: ['PDF', 'DOCX', 'TXT'],
};

export function LandingFormatTabs() {
  const [activeId, setActiveId] = useState<string>('structured');
  const formats = FORMATS[activeId] ?? FORMATS.structured;

  return (
    <div>
      <AnimatedTabs tabs={TABS} activeId={activeId} onChange={setActiveId} />
      <ul className="mt-s3 flex flex-wrap gap-s2">
        {formats.map((format) => (
          <li
            key={format}
            className="touch-44 inline-flex items-center rounded-control bg-forest-08 px-s3 font-display text-label font-semibold text-ink"
          >
            {format}
          </li>
        ))}
      </ul>
    </div>
  );
}
