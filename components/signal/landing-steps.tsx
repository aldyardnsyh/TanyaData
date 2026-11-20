'use client';

import { useEffect, useState } from 'react';
import { shouldAnimate } from '@/lib/motion-tokens';

/**
 * Cara kerja sebagai diagram alur interaktif: berkas & data -> inti TanyaData ->
 * jawaban bersumber + chip bagikan. Empat fase berputar otomatis dan keempat
 * langkah di bawah menyala sinkron dengan fase; mengklik langkah melompat ke
 * fase tersebut (interaksi nyata, bukan dekorasi).
 * Purpose Gate: menggambarkan sistem bekerja sehingga alur terasa, bukan sekadar
 * dibaca. Loop dihentikan saat tab tersembunyi; hover menjeda; reduced-motion
 * menampilkan diagram final statis tanpa putaran.
 * Server merender fase akhir (semua elemen terlihat) supaya no-JS dan screenshot
 * full-page tetap utuh.
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

const PHASE_MS = 2000;

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
    const timer = window.setInterval(() => setPhase((p) => (p + 1) % 4), PHASE_MS);
    return () => window.clearInterval(timer);
  }, [paused, manual, tabHidden]);

  const jump = (index: number) => {
    setPhase(index);
    setManual(true);
  };

  const trackClass = (active: boolean) =>
    `relative hidden h-px flex-none w-14 lg:w-32 transition-colors duration-[var(--motion-slow)] md:block ${
      active ? 'bg-lime' : 'bg-[var(--hairline-dark)]'
    }`;

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
        <div
          aria-hidden="true"
          className={`flex justify-center transition-all duration-[var(--motion-slow)] ${
            phase >= 1 ? 'translate-y-0 opacity-100' : 'h-0 translate-y-1 overflow-hidden opacity-0'
          }`}
        >
          <span className="inline-flex items-center rounded-chip border border-hairline-dark bg-porcelain px-s3 py-1 font-body text-caption text-ink">
            &quot;Berapa SLA pengembalian dana untuk tiap kanal?&quot;
          </span>
        </div>

        <div className="flex flex-col items-center gap-s3 md:flex-row md:justify-center md:gap-0">
          {/* Sisi masukan: dua chip berkas. Menonjol saat fase unggah/tanya. */}
          <div
            className={`flex flex-col items-start gap-s1 transition-all duration-[var(--motion-slow)] ${
              phase <= 1 ? 'opacity-100' : 'opacity-60'
            }`}
          >
            <span
              className={`inline-flex items-center rounded-chip border px-s3 py-1 font-mono text-caption uppercase tracking-[0.06em] transition-colors duration-[var(--motion-slow)] ${
                phase === 0 ? 'border-lime text-porcelain' : 'border-hairline-dark text-dark-muted'
              }`}
            >
              LAPORAN-OKT.PDF
            </span>
            <span
              className={`inline-flex items-center rounded-chip border px-s3 py-1 font-mono text-caption uppercase tracking-[0.06em] transition-colors duration-[var(--motion-slow)] ${
                phase === 0 ? 'border-lime text-porcelain' : 'border-hairline-dark text-dark-muted'
              }`}
            >
              TRANSACTIONS.CSV
            </span>
          </div>

          <div aria-hidden="true" className={trackClass(phase >= 1)}>
            <span
              className={`absolute right-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-lime transition-opacity duration-[var(--motion-slow)] ${
                phase >= 1 ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>

          {/* Inti TanyaData: menyala saat memproses, dengan indikator berpikir. */}
          <div
            className={`relative flex h-16 w-16 flex-none flex-col items-center justify-center rounded-card-lg border transition-all duration-[var(--motion-slow)] ${
              phase >= 1 && phase <= 2
                ? 'border-lime glow-lime bg-[color-mix(in_srgb,var(--color-forest)_72%,var(--color-lime)_10%)]'
                : 'border-hairline-dark bg-forest-08'
            }`}
          >
            <span className="state-dot state-dot-active" aria-hidden="true" />
            <span className="mt-1 font-display text-caption font-bold text-porcelain">TanyaData</span>
            {phase === 1 && (
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

          {/* Sisi keluaran: jawaban + sitasi; chip bagikan muncul di fase akhir. */}
          <div
            className={`w-full max-w-48 flex-none rounded-card-lg border border-hairline-dark bg-porcelain p-s3 text-ink transition-all duration-[var(--motion-slow)] ${
              phase >= 2 ? 'translate-y-0 opacity-100 shadow-float' : 'translate-y-1 opacity-30'
            }`}
          >
            <p className="font-body text-caption leading-snug text-ink-72">
              Virtual Account: 3 hari kerja
            </p>
            <span className="mono-meta mt-s2 inline-flex items-center gap-s1">
              <span className="state-dot state-dot-active" aria-hidden="true" />
              SITASI · FAQ CUSTOMER SUPPORT
            </span>
            <span
              className={`inline-flex items-center gap-s1 transition-all duration-[var(--motion-slow)] ${
                phase >= 3 ? 'mt-s2 max-h-6 opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              <span className="state-dot state-dot-active" aria-hidden="true" />
              <span className="mono-meta">BAGIKAN · READ-ONLY</span>
            </span>
          </div>
        </div>
      </div>

      {/* Empat langkah: menyala mengikuti fase; diklik untuk melompat ke fase itu. */}
      <div
        role="group"
        aria-label="Empat langkah cara kerja"
        className="mt-s6 grid gap-s2 md:grid-cols-4 md:gap-0 md:divide-x md:divide-[var(--hairline-dark)]"
      >
        {STEPS.map((step, index) => {
          const active = phase === index;
          return (
            <button
              key={step.no}
              type="button"
              onClick={() => jump(index)}
              aria-pressed={active}
              className={`touch-44 text-left transition-opacity duration-[var(--motion-fast)] focus-ring md:px-s4 first:md:pl-0 ${
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
