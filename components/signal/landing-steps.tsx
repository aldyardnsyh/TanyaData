'use client';

import { useEffect, useState } from 'react';
import { shouldAnimate } from '@/lib/motion-tokens';

/**
 * Cara kerja sebagai diagram alur interaktif: berkas & data -> inti TanyaData ->
 * jawaban yang disusun bertahap -> chip bagikan. Empat fase berputar otomatis
 * (durasi tiap fase berbeda: fase menyusun jawaban lebih panjang) dan keempat
 * langkah di bawah menyala sinkron dengan fase; mengklik langkah melompat ke
 * fase tersebut.
 * Penempatan sesuai fase: bubble pertanyaan menempel di atas inti TanyaData
 * (pertanyaan datang ke mesin), kartu jawaban menyusun baris demi baris saat
 * fase periksa, dan chip bagikan muncul dengan pop sendiri di fase akhir.
 * Interaksi nyata: mengklik langkah melompat ke fase; hover menjeda; loop
 * berhenti saat tab tersembunyi; reduced-motion menampilkan diagram final
 * statis. Server merender fase akhir (semua terlihat) supaya no-JS dan
 * screenshot full-page tetap utuh.
 */

const STEPS = [
  {
    no: '01',
    title: 'Unggah',
    copy: 'Tarik berkas data dan dokumen ke workspace. Data contoh sudah tersedia bila ingin langsung mencoba.',
  },
  {
    no: '02',
    title: 'Tanyakan',
    copy: 'Ajukan pertanyaan dalam bahasa sehari-hari, untuk satu berkas atau seluruh sumber yang aktif.',
  },
  {
    no: '03',
    title: 'Periksa',
    copy: 'Baca jawabannya beserta kutipan sumber; angka datang dari data yang diunggah.',
  },
  {
    no: '04',
    title: 'Bagikan',
    copy: 'Kirim hasil sebagai halaman read-only tanpa login, setelah ringkasan konfirmasi muncul lebih dulu.',
  },
];

const ANSWER_ROWS: [string, string][] = [
  ['Virtual Account', '3 hari kerja'],
  ['E-Wallet', 'maksimal 2 x 24 jam'],
  ['QRIS', '2 hari kerja'],
  ['Kartu Kredit', '7 sampai 14 hari kerja'],
];

/** Durasi per fase (ms): fase menyusun jawaban paling panjang agar baris terbaca. */
const PHASE_MS = [1400, 1600, 2400, 1800];

export function LandingSteps() {
  const [phase, setPhase] = useState(3);
  const [paused, setPaused] = useState(false);
  const [manual, setManual] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);

  // Loop hanya saat motion diizinkan; reduced-motion membiarkan fase akhir statis.
  useEffect(() => {
    if (!shouldAnimate()) return;
    setPhase(0);
  }, []);

  useEffect(() => {
    const onVisibility = () => setTabHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!shouldAnimate() || paused || manual || tabHidden) return;
    const timer = window.setTimeout(
      () => setPhase((p) => (p + 1) % 4),
      PHASE_MS[phase] ?? 2000,
    );
    return () => window.clearTimeout(timer);
  }, [phase, paused, manual, tabHidden]);

  const jump = (index: number) => {
    setPhase(index);
    setManual(true);
  };

  const trackClass = (active: boolean) =>
    `relative hidden h-px flex-none w-14 lg:w-32 transition-colors duration-[var(--motion-slow)] lg:block ${
      active ? 'bg-lime' : 'bg-[var(--hairline-dark)]'
    }`;
  // Alur vertikal untuk viewport < lg: penghubung antar node supaya alur tetap terbaca.
  const trackVerticalClass = (active: boolean) =>
    `relative h-10 w-px flex-none transition-colors duration-[var(--motion-slow)] lg:hidden ${
      active ? 'bg-lime' : 'bg-[var(--hairline-dark)]'
    }`;

  const composing = phase === 2;

  return (
    <>
      <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
        Cara kerja
      </p>
      <h2 className="mt-s2 font-display text-title text-porcelain">
        Empat langkah dari berkas menjadi jawaban
      </h2>
      <p className="mt-s2 max-w-[52ch] font-body text-body text-dark-muted">
        Tanpa setup, tanpa menulis query: dari unggahan ke jawaban yang bisa dibagikan.
      </p>

      {/* Diagram alur. Hover menjeda putaran supaya fase bisa diperhatikan. */}
      <div
        className="relative mt-s6"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
      >
        <div className="flex flex-col items-center gap-s3 lg:flex-row lg:justify-center lg:gap-0">
          {/* Sisi masukan: empat dokumen dengan identitas visual berbeda (arah user):
              PDF merah, DOCX biru Word, CSV hijau Excel (dipilih yang tidak
              bertabrakan dengan lime tema), dan SQL sebagai silinder bank data
              memakai warna brand. Warna merah/biru/hijau adalah warna identitas
              fungsional jenis berkas yang diminta eksplisit, di luar enam token
              palet, hanya untuk lencana kecil di ilustrasi ini. */}
          <div
            className={`flex items-start gap-s2 transition-all duration-[var(--motion-slow)] ${
              phase === 0 ? 'opacity-100' : 'opacity-50'
            }`}
          >
            {/* PDF: kertas dengan strip judul merah dan garis teks. */}
            <div className="flex flex-col items-center gap-s2">
              <div
                className={`relative w-16 rotate-[-4deg] rounded-control bg-porcelain p-s2 shadow-lift transition-transform duration-[var(--motion-slow)] motion-reduce:rotate-0 ${
                  phase === 0 ? 'scale-100' : 'scale-95'
                }`}
              >
                <div className="mb-s2 h-1.5 w-full rounded-full bg-[#C0392B]" />
                <div className="grid gap-1">
                  <span className="block h-1 w-full rounded-full bg-[color-mix(in_srgb,var(--color-ink)_18%,transparent)]" />
                  <span className="block h-1 w-3/4 rounded-full bg-[color-mix(in_srgb,var(--color-ink)_18%,transparent)]" />
                  <span className="block h-1 w-full rounded-full bg-[color-mix(in_srgb,var(--color-ink)_18%,transparent)]" />
                  <span className="block h-1 w-2/3 rounded-full bg-[color-mix(in_srgb,var(--color-ink)_18%,transparent)]" />
                </div>
                <span className="absolute -right-s1 -top-s1 rounded-chip bg-[#C0392B] px-s2 py-0.5 font-mono text-[10px] uppercase text-porcelain">
                  PDF
                </span>
              </div>
              <span className="mono-meta">LAPORAN-OKT.PDF</span>
            </div>
            {/* CSV: kartu tabel dengan baris header hijau. */}
            <div className="flex flex-col items-center gap-s2 translate-y-2">
              <div
                className={`relative w-16 rotate-[2deg] rounded-control bg-porcelain p-s1 shadow-lift transition-transform duration-[var(--motion-slow)] motion-reduce:rotate-0 ${
                  phase === 0 ? 'scale-100' : 'scale-95'
                }`}
              >
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[4px] bg-[var(--hairline-dark)]">
                  <span className="h-3 bg-[#217346]" />
                  <span className="h-3 bg-[#217346]" />
                  <span className="h-3 bg-[#217346]" />
                  <span className="h-3 bg-porcelain" />
                  <span className="h-3 bg-porcelain" />
                  <span className="h-3 bg-porcelain" />
                </div>
                <span className="absolute -right-s1 -top-s1 rounded-chip bg-[#217346] px-s2 py-0.5 font-mono text-[10px] uppercase text-porcelain">
                  CSV
                </span>
              </div>
              <span className="mono-meta">TRANSACTIONS.CSV</span>
            </div>
            {/* DOCX: kertas biru Word dengan blok judul dan paragraf menjorok. */}
            <div className="flex flex-col items-center gap-s2">
              <div
                className={`relative w-16 rotate-[3deg] rounded-control bg-porcelain p-s2 shadow-lift transition-transform duration-[var(--motion-slow)] motion-reduce:rotate-0 ${
                  phase === 0 ? 'scale-100' : 'scale-95'
                }`}
              >
                <div className="mb-s2 h-3 w-full rounded-[3px] bg-[#2B579A]" />
                <div className="grid gap-1">
                  <span className="block h-1 w-full rounded-full bg-[color-mix(in_srgb,var(--color-ink)_18%,transparent)]" />
                  <span className="block h-1 ml-2 w-5/6 rounded-full bg-[color-mix(in_srgb,var(--color-ink)_18%,transparent)]" />
                  <span className="block h-1 ml-2 w-full rounded-full bg-[color-mix(in_srgb,var(--color-ink)_18%,transparent)]" />
                </div>
                <span className="absolute -right-s1 -top-s1 rounded-chip bg-[#2B579A] px-s2 py-0.5 font-mono text-[10px] uppercase text-porcelain">
                  DOCX
                </span>
              </div>
              <span className="mono-meta">KATALOG.DOCX</span>
            </div>
            {/* SQL: silinder bank data (bentuk gentong klasik database) memakai
                warna brand, digambar SVG agar elips atas dan garis piringan rapi. */}
            <div className="flex flex-col items-center gap-s2 translate-y-2">
              <div
                className={`relative rounded-control bg-porcelain p-s1 shadow-lift transition-transform duration-[var(--motion-slow)] ${
                  phase === 0 ? 'scale-100' : 'scale-95'
                }`}
              >
                <svg viewBox="0 0 44 52" className="h-[72px] w-16" aria-hidden="true">
                  <path
                    d="M6 8 L6 44 C6 48 13 51 22 51 C31 51 38 48 38 44 L38 8"
                    fill="var(--color-porcelain)"
                    stroke="var(--color-forest)"
                    strokeWidth="2"
                  />
                  <path
                    d="M6 20 C6 24 13 26 22 26 C31 26 38 24 38 20"
                    fill="none"
                    stroke="var(--color-forest)"
                    strokeWidth="1.5"
                    opacity="0.55"
                  />
                  <path
                    d="M6 32 C6 36 13 38 22 38 C31 38 38 36 38 32"
                    fill="none"
                    stroke="var(--color-forest)"
                    strokeWidth="1.5"
                    opacity="0.55"
                  />
                  <ellipse
                    cx="22"
                    cy="8"
                    rx="16"
                    ry="6"
                    fill="var(--color-lime)"
                    stroke="var(--color-forest)"
                    strokeWidth="2"
                  />
                </svg>
                <span className="absolute -right-s1 -top-s1 rounded-chip bg-forest px-s2 py-0.5 font-mono text-[10px] uppercase text-porcelain">
                  SQL
                </span>
              </div>
              <span className="mono-meta">ANALYTICS.SQL</span>
            </div>
          </div>

          <div aria-hidden="true" className={trackClass(phase >= 1)}>
            <span
              className={`absolute right-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-lime transition-opacity duration-[var(--motion-slow)] ${
                phase >= 1 ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>
          <div aria-hidden="true" className={trackVerticalClass(phase >= 1)}>
            <span
              className={`absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-lime transition-opacity duration-[var(--motion-slow)] ${
                phase >= 1 ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>

          {/* Inti TanyaData: bubble pertanyaan menempel di atasnya (pertanyaan
              datang ke mesin), menyala saat memproses, tenang saat selesai. */}
          <div
            className={`relative flex h-16 w-16 flex-none flex-col items-center justify-center rounded-card-lg border transition-all duration-[var(--motion-slow)] ${
              phase >= 1 && phase <= 2
                ? 'border-lime glow-lime bg-[color-mix(in_srgb,var(--color-forest)_72%,var(--color-lime)_10%)]'
                : 'border-hairline-dark bg-forest-08'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute bottom-full left-1/2 mb-s2 w-max max-w-[80vw] -translate-x-1/2 transition-all duration-[var(--motion-slow)] ${
                phase === 1
                  ? 'translate-y-0 opacity-100'
                  : 'pointer-events-none translate-y-1 opacity-0'
              }`}
            >
              <span className="inline-flex items-center rounded-chip border border-hairline-dark bg-porcelain px-s3 py-1 font-body text-caption text-ink">
                &quot;Berapa SLA pengembalian dana untuk tiap kanal?&quot;
              </span>
            </span>
            <span className="state-dot state-dot-active" aria-hidden="true" />
            <span className="mt-1 font-display text-caption font-bold text-porcelain">TanyaData</span>
            {(phase === 1 || phase === 2) && (
              <span className="mt-1 flex gap-1" role="status" aria-label="Memproses pertanyaan">
                <span className="animate-typing-dot state-dot state-dot-active" aria-hidden="true" />
                <span
                  className="animate-typing-dot state-dot state-dot-active"
                  style={{ animationDelay: '150ms' }}
                  aria-hidden="true"
                />
                <span
                  className="animate-typing-dot state-dot state-dot-active"
                  style={{ animationDelay: '300ms' }}
                  aria-hidden="true"
                />
              </span>
            )}
          </div>

          <div aria-hidden="true" className={trackClass(phase >= 2)}>
            <span
              className={`absolute right-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-lime transition-opacity duration-[var(--motion-slow)] ${
                phase >= 2 ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>
          <div aria-hidden="true" className={trackVerticalClass(phase >= 2)}>
            <span
              className={`absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-lime transition-opacity duration-[var(--motion-slow)] ${
                phase >= 2 ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>

          {/* Sisi keluaran: jawaban menyusun baris demi baris saat fase periksa,
              header berubah menjadi selesai di fase akhir. */}
          <div
            className={`w-full max-w-60 flex-none rounded-card-lg border border-hairline-dark bg-porcelain p-s3 text-ink transition-all duration-[var(--motion-slow)] ${
              phase >= 2 ? 'translate-y-0 opacity-100 shadow-float' : 'pointer-events-none translate-y-2 opacity-0'
            }`}
          >
            <p className="mono-meta">
              {phase >= 3 ? 'SELESAI · DENGAN SITASI' : 'MENYUSUN JAWABAN'}
            </p>
            <div className="mt-s2 grid gap-1 font-body text-body text-ink">
              {ANSWER_ROWS.map(([kanal, sla], index) => (
                <div
                  key={kanal}
                  className={`flex items-baseline justify-between gap-s3 transition-all duration-[var(--motion-expand)] ${
                    phase >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                  }`}
                  style={{
                    transitionDelay: phase >= 2 ? `${index * 120}ms` : '0ms',
                  }}
                >
                  <span className="whitespace-nowrap text-ink-72">{kanal}</span>
                  <span className="whitespace-nowrap tabular">{sla}</span>
                </div>
              ))}
            </div>
            <span
              className={`mono-meta mt-s2 inline-flex items-center gap-s1 transition-all duration-[var(--motion-expand)] ${
                phase >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
              }`}
              style={{ transitionDelay: phase >= 2 ? '480ms' : '0ms' }}
            >
              <span className="state-dot state-dot-active" aria-hidden="true" />
              SITASI · FAQ CUSTOMER SUPPORT
            </span>
          </div>

          <div aria-hidden="true" className={trackClass(phase >= 3)}>
            <span
              className={`absolute right-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-lime transition-opacity duration-[var(--motion-slow)] ${
                phase >= 3 ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>
          <div aria-hidden="true" className={trackVerticalClass(phase >= 3)}>
            <span
              className={`absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-lime transition-opacity duration-[var(--motion-slow)] ${
                phase >= 3 ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>

          {/* Tahap keempat berdiri sendiri: halaman bagikan muncul pop dengan
              cincin lime saat fase bagikan. */}
          <div
            className={`w-full max-w-44 flex-none rounded-card-lg border transition-all duration-[var(--motion-slow)] ${
              phase >= 3
                ? 'scale-100 border-lime glow-lime bg-forest-08 opacity-100'
                : 'pointer-events-none scale-90 border-hairline-dark bg-forest-08 opacity-0'
            }`}
          >
            <div className="p-s3 text-porcelain">
              <p className="mono-meta">HALAMAN BAGIKAN</p>
              <p className="mt-s2 inline-flex items-center gap-s1 font-body text-caption text-porcelain">
                <span className="state-dot state-dot-active" aria-hidden="true" />
                TAUTAN · READ-ONLY
              </p>
              <p className="mt-s1 font-body text-caption text-dark-muted">
                Tanpa login, salinan statis.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Empat langkah: menyala mengikuti fase; diklik untuk melompat ke fase itu. */}
      <div
        role="group"
        aria-label="Empat langkah cara kerja"
        className="mt-s6 grid gap-s3 md:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-[var(--hairline-dark)]"
      >
        {STEPS.map((step, index) => {
          const active = phase === index;
          return (
            <button
              key={step.no}
              type="button"
              onClick={() => jump(index)}
              aria-pressed={active}
              className={`touch-44 text-left transition-opacity duration-[var(--motion-fast)] focus-ring lg:px-s4 first:lg:pl-0 ${
                active ? 'opacity-100' : 'opacity-55 hover:opacity-100'
              }`}
            >
              <span
                className={`font-mono text-stat-lg transition-colors duration-[var(--motion-slow)] ${
                  active ? 'text-lime text-glow-lime' : 'text-dark-muted'
                }`}
              >
                {step.no}
              </span>
              <h3
                className={`mt-s1 font-display text-label font-semibold transition-colors duration-[var(--motion-slow)] ${
                  active ? 'text-porcelain' : 'text-dark-muted'
                }`}
              >
                {step.title}
              </h3>
              <p className="mt-s2 font-body text-body text-dark-muted">{step.copy}</p>
            </button>
          );
        })}
      </div>

      {manual && (
        <button
          type="button"
          onClick={() => setManual(false)}
          className="mt-s3 inline-flex min-h-11 items-center rounded-control border border-hairline-dark px-s3 font-display text-label font-semibold text-porcelain transition-colors duration-[var(--motion-fast)] hover:border-porcelain focus-ring"
        >
          Putar ulang otomatis
        </button>
      )}
    </>
  );
}
