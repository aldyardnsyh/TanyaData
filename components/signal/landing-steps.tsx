'use client';

import { useEffect, useState } from 'react';
import { shouldAnimate } from '@/lib/motion-tokens';

/**
 * Cara kerja sebagai diagram alur interaktif: satu blok masukan (empat ubin
 * PDF/CSV/DOCX/SQL) -> inti TanyaData -> kartu jawaban -> kartu bagikan.
 *
 * Geometri mengikuti `design/cara-kerja-geometry.yaml` (DECISION-035). Baris
 * adalah grid dengan lebar node KONSTAN per tier; rail adalah sel grid di antara
 * dua node, garisnya memakai inset 0 supaya menyentuh tepi border node (0px),
 * dan dot 6px duduk di tengah rail. Tidak ada lebar node yang berasal dari
 * konten: tidak ada `w-full`, `w-max`, `flex-wrap`, atau `max-w-*` pada node.
 *
 * Empat fase berputar otomatis (durasi fase menyusun jawaban lebih panjang) dan
 * keempat langkah di bawah menyala sinkron dengan fase; mengklik langkah
 * melompat ke fase tersebut. Interaksi nyata dipertahankan: hover menjeda, klik
 * langkah melompat, loop berhenti saat tab tersembunyi, reduced-motion
 * menampilkan fase akhir statis, dan server merender fase akhir (no-JS utuh).
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

/* Empat pasangan tanya-jawab dummy dengan konten dari korpus contoh produk
 * (angka nyata dari dataset uji: 46.952, 44.319, 1.519, 3,30% vs 2,52%,
 * VA Mandiri 6,03% di Laporan Okt 2026, prosedur SOP) dan BENTUK JAWABAN
 * berbeda per pasangan (arah user): baris teks, bar chart distribusi, donut
 * chart failure rate, dan baris kontributor. Tiap putaran penuh memilih
 * pasangan secara acak tanpa mengulang yang terakhir. */
const QA_PAIRS: {
  question: string;
  source: string;
  visual: 'rows' | 'bars' | 'donut';
  rows: [string, string][];
}[] = [
  {
    question: 'Berapa SLA pengembalian dana untuk tiap kanal?',
    source: 'FAQ CUSTOMER SUPPORT',
    visual: 'rows',
    rows: [
      ['Virtual Account', '3 hari kerja'],
      ['E-Wallet', 'maksimal 2 x 24 jam'],
      ['QRIS', '2 hari kerja'],
    ],
  },
  {
    question: 'Bagaimana distribusi status transaksinya?',
    source: 'TRANSACTIONS.CSV',
    visual: 'bars',
    rows: [
      ['Sukses', '44.319'],
      ['Gagal', '1.519'],
      ['Lainnya', '1.114'],
    ],
  },
  {
    question: 'Bagaimana perbandingan dengan bulan sebelumnya?',
    source: 'LAPORAN OKT 2026',
    visual: 'donut',
    rows: [
      ['Failure rate Okt', '3,30%'],
      ['September', '2,52%'],
    ],
  },
  {
    question: 'Kanal mana yang paling berkontribusi?',
    source: 'LAPORAN OKT 2026',
    visual: 'rows',
    rows: [
      ['Kontributor utama', 'VA Mandiri'],
      ['Failure rate kanal', '6,03%'],
      ['Sumber', 'Catatan manajemen'],
    ],
  },
];

/** Durasi per fase (ms): fase menyusun jawaban paling panjang agar baris terbaca. */
const PHASE_MS = [1000, 1200, 2000, 1200];

/* Hex identitas jenis berkas: pengecualian fungsional yang diizinkan
 * DECISION-035 / H.8. Hanya untuk label 10px, tidak pernah sebagai permukaan. */
const TILE_COLOR = {
  PDF: '#C0392B',
  CSV: '#217346',
  DOCX: '#2B579A',
  SQL: 'var(--color-forest)',
} as const;

/**
 * CSS diagram. Lebar node, rail, dan baris adalah konstanta per tier dari
 * `cara-kerja-geometry.yaml`; tidak ada angka yang berasal dari konten.
 * Warna rail = lime karena diagram berada di band gelap (H.4/H.10).
 */
const DIAGRAM_CSS = `
.ck-root {
  --ck-plate: 120px;
  --ck-core: 64px;
  --ck-answer: 208px;
  --ck-share: 144px;
  --ck-rail: 24px;
  --ck-tile: 48px;
  --ck-answer-min: 176px;
  --ck-share-min: 112px;
  --ck-row: 208px;
}
@media (min-width: 768px) { .ck-root { --ck-rail: 32px; } }
@media (min-width: 1024px) {
  .ck-root {
    --ck-plate: 120px; --ck-core: 64px; --ck-answer: 224px; --ck-share: 144px;
    --ck-rail: 24px; --ck-tile: 48px; --ck-answer-min: 0px; --ck-share-min: 0px;
    --ck-row: 624px; --ck-core-center: 28.2051%;
  }
}
@media (min-width: 1280px) {
  .ck-root {
    --ck-plate: 136px; --ck-core: 64px; --ck-answer: 240px; --ck-share: 160px;
    --ck-rail: 40px; --ck-tile: 56px;
    --ck-row: 720px; --ck-core-center: 28.8889%;
  }
}
@media (min-width: 1600px) {
  .ck-root {
    --ck-plate: 136px; --ck-core: 72px; --ck-answer: 272px; --ck-share: 176px;
    --ck-rail: 64px; --ck-tile: 56px;
    --ck-row: 848px; --ck-core-center: 27.8302%;
  }
}

.ck-row {
  position: relative;
  width: var(--ck-row);
  margin-inline: auto;
  display: grid;
  grid-template-columns: var(--ck-answer);
  justify-items: center;
  align-items: center;
  gap: 0;
}
.ck-node {
  transition: opacity var(--motion-expand) var(--ease-smooth), transform var(--motion-expand) var(--ease-smooth);
}
.ck-node[data-visible="false"] {
  opacity: 0;
  transform: translateY(var(--spacing-s1));
  pointer-events: none;
}

.ck-plate {
  width: var(--ck-plate);
  padding: var(--spacing-s2);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-s2);
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--color-porcelain) 6%, transparent);
  box-shadow: inset 0 0 0 1px var(--hairline-dark);
}
.ck-tiles {
  display: grid;
  grid-template-columns: repeat(2, var(--ck-tile));
  gap: var(--spacing-s2);
}
.ck-tile {
  position: relative;
  width: var(--ck-tile);
  height: var(--ck-tile);
  overflow: hidden;
  border-radius: var(--radius-control);
  background: var(--color-porcelain);
}
.ck-tile-label {
  position: absolute;
  top: var(--spacing-s1);
  right: var(--spacing-s1);
  padding: 0 var(--spacing-s1);
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--color-porcelain) 84%, transparent);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 14px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.ck-plate-caption {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 16px;
  letter-spacing: 0.06em;
  color: var(--porcelain-72);
}

.ck-core {
  position: relative;
  width: var(--ck-core);
  height: var(--ck-core);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-card-lg);
  border: 1px solid var(--hairline-dark);
  background: var(--color-forest-08);
}
.ck-core[data-active="true"] {
  border-color: var(--color-lime);
  background: color-mix(in srgb, var(--color-forest) 72%, var(--color-lime) 10%);
}

.ck-answer {
  width: var(--ck-answer);
  min-height: var(--ck-answer-min);
  padding: var(--spacing-s3);
  border-radius: var(--radius-card-lg);
  border: 1px solid var(--hairline-dark);
  background: var(--color-porcelain);
  color: var(--color-ink);
}
.ck-share {
  width: var(--ck-share);
  min-height: var(--ck-share-min);
  border-radius: var(--radius-card-lg);
  border: 1px solid var(--hairline-dark);
  background: color-mix(in srgb, var(--color-porcelain) 6%, transparent);
}
.ck-share[data-active="true"] { border-color: var(--color-lime); }

.ck-rail {
  position: relative;
  width: 100%;
  height: var(--ck-rail);
  opacity: 0;
  transition: opacity var(--motion-fast) var(--ease-smooth);
}
.ck-rail[data-lit="true"] { opacity: 1; }
.ck-rail::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-lime);
  transform: scaleY(0);
  transform-origin: top;
  transition: transform var(--motion-expand) var(--ease-smooth);
}
.ck-rail[data-lit="true"]::before { transform: scaleY(1); }
.ck-rail::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: var(--radius-dot);
  background: var(--color-lime);
  opacity: 0;
  transition: opacity var(--motion-fast) var(--ease-smooth) var(--motion-fast);
}
.ck-rail[data-lit="true"]::after { opacity: 1; }

.ck-bubble-slot {
  height: calc(var(--spacing-s3) * 2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ck-bubble {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-chip);
  border: 1px solid var(--hairline-dark);
  background: var(--color-porcelain);
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: 12px;
  line-height: 18px;
  padding: var(--spacing-s1) var(--spacing-s3);
  white-space: nowrap;
  transition: opacity var(--motion-expand) var(--ease-smooth), transform var(--motion-expand) var(--ease-smooth);
}
.ck-bubble-slot .ck-bubble {
  max-width: calc(100vw - 2 * var(--spacing-s3));
  overflow: hidden;
  text-overflow: ellipsis;
}
.ck-bubble[data-visible="false"] {
  opacity: 0;
  transform: translateY(var(--spacing-s1));
}
.ck-bubble-lane { display: none; }

@media (min-width: 1024px) {
  .ck-row {
    grid-template-columns: var(--ck-plate) var(--ck-rail) var(--ck-core) var(--ck-rail) var(--ck-answer) var(--ck-rail) var(--ck-share);
    justify-items: stretch;
    padding-top: var(--spacing-s5);
  }
  .ck-bubble-slot { display: none; }
  .ck-bubble-lane {
    display: block;
    position: absolute;
    top: 0;
    left: var(--ck-core-center);
    transform: translateX(-50%);
    transition: opacity var(--motion-expand) var(--ease-smooth);
  }
  .ck-bubble-lane[data-visible="false"] { opacity: 0; pointer-events: none; }
  .ck-rail {
    width: auto;
    height: auto;
    align-self: stretch;
  }
  .ck-rail::before {
    left: 0;
    right: 0;
    top: 50%;
    bottom: auto;
    width: auto;
    height: 1px;
    transform: scaleX(0);
    transform-origin: left;
  }
  .ck-rail[data-lit="true"]::before { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .ck-rail { opacity: 1 !important; }
  .ck-rail::before { transform: none !important; }
  .ck-rail::after { opacity: 1 !important; }
}
`;

/** Satu ubin jenis berkas di dalam plat masukan. SVG 48x48, diskalakan ke ubin. */
function DocTile({ kind }: { kind: 'PDF' | 'CSV' | 'DOCX' | 'SQL' }) {
  return (
    <div className="ck-tile">
      {kind === 'SQL' ? (
        <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
          <rect width="48" height="48" fill="var(--color-porcelain)" />
          <path
            d="M11 15 L11 33 C11 37 16 39 24 39 C32 39 37 37 37 33 L37 15"
            fill="none"
            stroke="var(--color-forest)"
            strokeWidth="2"
          />
          <ellipse cx="24" cy="15" rx="13" ry="5" fill="var(--color-lime)" stroke="var(--color-forest)" strokeWidth="2" />
          <path d="M11 24 C11 28 16 30 24 30 C32 30 37 28 37 24" fill="none" stroke="var(--color-forest)" strokeWidth="1" opacity="0.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
          <rect width="48" height="48" fill="var(--color-porcelain)" />
          {kind === 'PDF' && (
            <>
              <rect width="48" height="8" fill="#C0392B" />
              <rect x="8" y="16" width="32" height="2" fill="var(--color-ink)" opacity="0.28" />
              <rect x="8" y="22" width="26" height="2" fill="var(--color-ink)" opacity="0.28" />
              <rect x="8" y="28" width="30" height="2" fill="var(--color-ink)" opacity="0.28" />
              <rect x="8" y="34" width="20" height="2" fill="var(--color-ink)" opacity="0.28" />
            </>
          )}
          {kind === 'CSV' && (
            <>
              <rect x="8" y="10" width="32" height="8" fill="#217346" />
              <rect x="8" y="18" width="32" height="20" fill="none" stroke="#217346" strokeWidth="1" />
              <path d="M8 26 H40 M8 32 H40 M18 18 V38 M28 18 V38" stroke="#217346" strokeWidth="1" opacity="0.55" />
            </>
          )}
          {kind === 'DOCX' && (
            <>
              <rect x="8" y="8" width="32" height="10" rx="1" fill="#2B579A" />
              <rect x="8" y="24" width="32" height="2" fill="var(--color-ink)" opacity="0.28" />
              <rect x="8" y="30" width="26" height="2" fill="var(--color-ink)" opacity="0.28" />
              <rect x="8" y="36" width="30" height="2" fill="var(--color-ink)" opacity="0.28" />
            </>
          )}
        </svg>
      )}
      <span className="ck-tile-label" style={{ color: TILE_COLOR[kind] }}>
        {kind}
      </span>
    </div>
  );
}

export function LandingSteps() {
  const [phase, setPhase] = useState(3);
  const [paused, setPaused] = useState(false);
  const [manual, setManual] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  // Pasangan tanya-jawab aktif; diacak setelah hidrasi dan tiap putaran penuh.
  const [pairIndex, setPairIndex] = useState(0);

  // Pasangan pertama diacak di tiap load (setelah hidrasi, tanpa mismatch).
  // Loop hanya saat motion diizinkan; reduced-motion membiarkan fase akhir statis.
  useEffect(() => {
    setPairIndex(Math.floor(Math.random() * QA_PAIRS.length));
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
    const timer = window.setTimeout(() => {
      const next = (phase + 1) % 4;
      if (next === 0) {
        let i = pairIndex;
        while (i === pairIndex) i = Math.floor(Math.random() * QA_PAIRS.length);
        setPairIndex(i);
      }
      setPhase(next);
    }, PHASE_MS[phase] ?? 1400);
    return () => window.clearTimeout(timer);
  }, [phase, paused, manual, tabHidden, pairIndex]);

  const jump = (index: number) => {
    setPhase(index);
    setManual(true);
  };

  // Lebar bar ilustratif distribusi status (sukses mendominasi, sisanya kecil).
  const BAR_WIDTHS = [88, 8, 6];
  const pair = QA_PAIRS[pairIndex] ?? QA_PAIRS[0];

  return (
    <>
      <style>{DIAGRAM_CSS}</style>

      <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
        Cara kerja
      </p>
      <h2 className="mt-s2 font-display text-title text-porcelain">
        Empat langkah dari berkas menjadi jawaban
      </h2>
      <p className="mt-s2 max-w-[52ch] font-body text-body text-dark-muted">
        Tanpa setup, tanpa menulis query: dari unggahan ke jawaban yang bisa dibagikan.
      </p>

      {/* Diagram alur. Hover menjeda putaran supaya fase bisa diperhatikan.
          Tidak ada padding tambahan: `page-container` di section sudah memberi
          padding, dan baris memakai lebar konstan per tier sehingga tidak luber. */}
      <div
        className="ck-root relative mt-s6"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
      >
        <div className="ck-row" aria-hidden="true">
          {/* Plat masukan: empat ubin PDF/CSV/DOCX/SQL dalam satu blok 2x2 + caption. */}
          <div className="ck-node ck-plate" data-visible="true">
            <div className="ck-tiles">
              <DocTile kind="PDF" />
              <DocTile kind="CSV" />
              <DocTile kind="DOCX" />
              <DocTile kind="SQL" />
            </div>
            <span className="ck-plate-caption">PDF · CSV · DOCX · SQL</span>
          </div>

          {/* rail-1: plat -> inti (menyala fase >= 1) */}
          <div className="ck-rail" data-lit={phase >= 1 ? 'true' : 'false'} />

          {/* Slot pertanyaan in-flow (vertikal saja): selalu menyediakan 32px. */}
          <div className="ck-bubble-slot">
            <span className="ck-bubble" data-visible={phase === 1 ? 'true' : 'false'}>
              &quot;{pair.question}&quot;
            </span>
          </div>

          {/* Inti TanyaData: border lime saat memproses (fase 1-2), tenang di fase 3. */}
          <div
            className="ck-node ck-core"
            data-visible={phase >= 1 ? 'true' : 'false'}
            data-active={phase >= 1 && phase <= 2 ? 'true' : 'false'}
          >
            <span className="state-dot state-dot-active" />
            <span className="mt-s1 font-display text-caption font-bold text-porcelain">TanyaData</span>
            {(phase === 1 || phase === 2) && (
              <span className="mt-s1 flex gap-s1">
                <span className="animate-typing-dot state-dot state-dot-active" />
                <span className="animate-typing-dot state-dot state-dot-active" style={{ animationDelay: '150ms' }} />
                <span className="animate-typing-dot state-dot state-dot-active" style={{ animationDelay: '300ms' }} />
              </span>
            )}
          </div>

          {/* rail-2: inti -> jawaban (menyala fase >= 2) */}
          <div className="ck-rail" data-lit={phase >= 2 ? 'true' : 'false'} />

          {/* Kartu jawaban: bentuk mengikuti jenis pertanyaan pasangan aktif. */}
          <div
            className={`ck-node ck-answer ${phase >= 2 ? 'shadow-float' : ''}`}
            data-visible={phase >= 2 ? 'true' : 'false'}
          >
            <p className="mono-meta">{phase >= 3 ? 'SELESAI · DENGAN SITASI' : 'MENYUSUN JAWABAN'}</p>
            {pair.visual === 'bars' ? (
              <div className="mt-s3 grid gap-s2">
                {pair.rows.map(([label, value], index) => (
                  <div key={label} className="grid grid-cols-[64px,1fr,auto] items-center gap-s2">
                    <span className="font-body text-caption text-ink-72">{label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-forest-08">
                      <span
                        className={`block h-full rounded-full transition-transform duration-[var(--motion-expand)] ease-[var(--ease-smooth)] ${
                          index === 0 ? 'bg-forest' : 'bg-terracotta'
                        } ${phase >= 2 ? 'scale-x-100' : 'scale-x-0'} origin-left motion-reduce:scale-x-100`}
                        style={{ width: `${BAR_WIDTHS[index] ?? 20}%` }}
                      />
                    </span>
                    <span className="font-mono text-caption tabular text-ink">{value}</span>
                  </div>
                ))}
              </div>
            ) : pair.visual === 'donut' ? (
              <div className="mt-s3 flex items-center gap-s3">
                <span className="relative inline-flex h-16 w-16 flex-none items-center justify-center">
                  <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90" aria-hidden="true">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-forest-08)" strokeWidth="4" />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke="var(--color-terracotta)"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray="3.22 94.42"
                      strokeDashoffset="-0"
                    />
                  </svg>
                  <span className="absolute font-body text-caption font-semibold tabular text-ink">3,30%</span>
                </span>
                <div className="grid gap-s1">
                  {pair.rows.map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-s3">
                      <span className="font-body text-caption text-ink-72">{label}</span>
                      <span className="font-mono text-caption tabular text-ink">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-s2 grid gap-s1 font-body text-body text-ink">
                {pair.rows.map(([kanal, sla]) => (
                  <div key={kanal} className="flex items-baseline justify-between gap-s3">
                    <span className="text-ink-72">{kanal}</span>
                    <span className="tabular">{sla}</span>
                  </div>
                ))}
              </div>
            )}
            <span className="mono-meta mt-s3 inline-flex items-center gap-s1">
              <span className="state-dot state-dot-active" />
              {`SITASI · ${pair.source}`}
            </span>
          </div>

          {/* rail-3: jawaban -> bagikan (menyala fase >= 3) */}
          <div className="ck-rail" data-lit={phase >= 3 ? 'true' : 'false'} />

          {/* Kartu bagikan: terminal alur, border lime saat fase bagikan. */}
          <div
            className="ck-node ck-share"
            data-visible={phase >= 3 ? 'true' : 'false'}
            data-active={phase >= 3 ? 'true' : 'false'}
          >
            <div className="p-s3 text-porcelain">
              <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-lime text-glow-lime">HALAMAN BAGIKAN</p>
              <p className="mt-s2 inline-flex items-center gap-s1 font-body text-caption text-porcelain">
                <span className="state-dot state-dot-active" />
                TAUTAN · READ-ONLY
              </p>
              <p className="mt-s1 font-body text-caption text-dark-muted">Tanpa login, salinan statis.</p>
            </div>
          </div>

          {/* Chip pertanyaan absolut (horizontal saja): duduk di lane atas,
              sejajar inti, tidak menggeser sumbu rail. */}
          <div className="ck-bubble-lane" data-visible={phase === 1 ? 'true' : 'false'}>
            <span className="ck-bubble">&quot;{pair.question}&quot;</span>
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
                className={`font-mono text-stat-lg transition-colors duration-[var(--motion-expand)] ${
                  active ? 'text-lime text-glow-lime' : 'text-dark-muted'
                }`}
              >
                {step.no}
              </span>
              <h3
                className={`mt-s1 font-display text-label font-semibold transition-colors duration-[var(--motion-expand)] ${
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
