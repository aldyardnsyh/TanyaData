'use client';

import { useState } from 'react';
import { AnimatedTabs, type TabItem } from '@/components/signal/animated-tabs';

/**
 * S4 Format diterima: SATU panel gelap penuh lebar berisi penjelasan (kiri) dan
 * tab dua kelompok format (C-04 tone dark) dengan ubin per format di kanan.
 * Purpose Gate: tab dipakai karena dua kelompok format punya perlakuan berbeda
 * (dihitung untuk data, disitasi untuk dokumen). Keterangan per ubin menjelaskan
 * apa yang terjadi pada berkas tersebut agar section tidak menggantung.
 * Ubin hanya menampilkan format yang benar-benar diterima produk.
 */
const TABS: TabItem[] = [
  { id: 'structured', label: 'Data terstruktur' },
  { id: 'documents', label: 'Dokumen' },
];

const GROUPS: Record<string, readonly { name: string; note: string }[]> = {
  structured: [
    { name: 'CSV', note: 'Metrik dan distribusi dihitung langsung.' },
    { name: 'XLSX', note: 'Sheet dibaca sebagai tabel data.' },
    { name: 'SQL', note: 'Struktur sumber untuk pertanyaan data.' },
  ],
  documents: [
    { name: 'PDF', note: 'Dibaca per halaman; jawaban menyertakan sitasi.' },
    { name: 'DOCX', note: 'Isi bagian dicari dan dikutip.' },
    { name: 'TXT', note: 'Teks dibaca dan dikutip per bagian.' },
  ],
};

export function LandingFormatPanel() {
  const [activeId, setActiveId] = useState<string>('structured');
  const formats = GROUPS[activeId] ?? GROUPS.structured;

  return (
    <div className="relative overflow-hidden rounded-card-lg border border-hairline-dark bg-forest p-s4 text-porcelain md:p-s5">
      <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
      <div
        aria-hidden="true"
        className="glow-radial-lime absolute -right-24 -top-28 h-[320px] w-[440px]"
      />
      <div className="relative grid gap-s5 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
            Format diterima
          </p>
          <h2 className="mt-s2 font-display text-title text-porcelain">Enam format yang diterima</h2>
          <p className="mt-s2 max-w-[48ch] font-body text-body text-dark-muted">
            Data terstruktur dihitung langsung dari sumbernya. Dokumen dibaca per halaman dan bagian,
            lalu dikutip di jawaban.
          </p>
          <p className="mt-s3 inline-flex items-center rounded-chip border border-hairline-dark px-s3 py-1 font-body text-caption text-dark-muted">
            Berkas MD diperlakukan sebagai teks.
          </p>
        </div>
        <div className="lg:col-span-7">
          <AnimatedTabs tabs={TABS} activeId={activeId} onChange={setActiveId} tone="dark" />
          <div className="mt-s4 grid gap-s2 sm:grid-cols-3">
            {formats.map((format) => (
              <div
                key={format.name}
                className="rounded-control border border-hairline-dark px-s3 py-s2 transition-colors duration-[var(--motion-fast)] hover:border-porcelain"
              >
                <span className="font-mono text-caption uppercase tracking-[0.06em] text-porcelain">
                  {format.name}
                </span>
                <p className="mt-s1 font-body text-caption text-dark-muted">{format.note}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
