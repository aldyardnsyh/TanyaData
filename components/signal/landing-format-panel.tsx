'use client';

import { useState } from 'react';
import { AnimatedTabs, type TabItem } from '@/components/signal/animated-tabs';

/**
 * S4 Kapabilitas dokumen dalam panel gelap (C-04 Context Tabs, tone dark).
 * Purpose Gate: tab dipakai karena dua kelompok format punya perlakuan
 * berbeda (query SQL untuk data terstruktur, sitasi halaman untuk dokumen),
 * bukan untuk menghias daftar. Dua tab saja karena produk hanya menerima dua
 * kelompok; kelompok tambahan berarti klaim rekaan.
 * Caption tiap tab adalah kutipan mekanisme dari kontrak (S5), sehingga tab
 * benar-benar mengganti konten, bukan menghias.
 */
const TABS: TabItem[] = [
  { id: 'structured', label: 'Data terstruktur' },
  { id: 'documents', label: 'Dokumen' },
];

const FORMATS: Record<string, readonly string[]> = {
  structured: ['CSV', 'XLSX', 'SQL'],
  documents: ['PDF', 'DOCX', 'TXT'],
};

const CAPTIONS: Record<string, string> = {
  structured: 'Untuk pertanyaan angka, query SQL tampil bersama durasi dan jumlah baris.',
  documents: 'Sitasi membuka halaman, bagian, dan kutipan asal.',
};

export function LandingFormatPanel() {
  const [activeId, setActiveId] = useState<string>('structured');
  const formats = FORMATS[activeId] ?? FORMATS.structured;
  const caption = CAPTIONS[activeId] ?? CAPTIONS.structured;

  return (
    <div className="relative overflow-hidden rounded-card-lg border border-hairline-dark bg-forest p-s4 text-porcelain md:p-s5">
      <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
      <div className="relative">
        <AnimatedTabs tabs={TABS} activeId={activeId} onChange={setActiveId} tone="dark" />
        <ul className="mt-s4 flex flex-wrap gap-s2">
          {formats.map((format) => (
            <li
              key={format}
              className="touch-44 inline-flex items-center rounded-chip border border-hairline-dark px-s4"
            >
              <span className="font-mono text-caption uppercase tracking-[0.06em] text-porcelain">
                {format}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-s4 border-t border-hairline-dark pt-s3 font-body text-caption text-dark-muted">
          {caption}
        </p>
      </div>
    </div>
  );
}
