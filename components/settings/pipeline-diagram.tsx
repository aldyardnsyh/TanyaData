'use client';

import { useEffect, useRef, useState } from 'react';
import type { SystemPipelineStage } from '@/lib/contracts/http';
import { shouldAnimate } from '@/lib/motion-tokens';

/**
 * Diagram pipeline 4 tahap untuk tab Tentang (DESIGN_SYSTEM §J.4/J.5).
 *
 * Dua varian di-inline dari `design/assets/tentang-pipeline.svg` (960x200) dan
 * `-mobile.svg` (360x520). Id tiap varian diberi prefix `d-` / `m-` supaya tidak
 * bertabrakan saat keduanya ada di DOM. Label tahap dirender sebagai HTML di
 * atas node (bukan teks di dalam SVG), diambil dari `system.pipeline[].label`.
 *
 * Warna: di permukaan terang rail memakai `--color-forest` (10,06:1). Lime
 * dilarang sebagai garis/teks di atas porcelain (1,48:1). Motion: rail menyala
 * sekali saat masuk viewport (IntersectionObserver, threshold 0,3) dengan
 * transform scaleX/scaleY; `branch-qdrant` putus-putus dianimasikan lewat
 * opacity saja supaya pola `4 4` tidak bergeser. Reduced-motion: semua rail
 * tampil penuh tanpa transform.
 */

const DIAGRAM_CSS = `
.tp-figure [data-rail] { transform-box: fill-box; }
.tp-figure[data-animate="true"] .tp-rail {
  transform: scaleX(0);
  transform-origin: left center;
  opacity: 0;
  transition: transform var(--motion-slow) var(--ease-smooth), opacity var(--motion-slow) var(--ease-smooth);
}
.tp-figure[data-animate="true"] .tp-rail--v {
  transform: scaleY(0);
  transform-origin: center top;
}
.tp-figure[data-animate="true"] .tp-rail--fade {
  transform: none;
  opacity: 0;
}
.tp-figure[data-animate="true"][data-lit="true"] .tp-rail { transform: scaleX(1); opacity: 1; }
.tp-figure[data-animate="true"][data-lit="true"] .tp-rail--v { transform: scaleY(1); }
.tp-figure[data-animate="true"][data-lit="true"] .tp-rail--fade { opacity: 1; }

@media (prefers-reduced-motion: reduce) {
  .tp-figure .tp-rail { transform: none !important; opacity: 1 !important; transition: none !important; }
}
`;

type Variant = 'desktop' | 'mobile';

type LabelBox = { left: number; top: number; width: number; height: number };

const LABEL_BOXES: Record<Variant, LabelBox[]> = {
  desktop: [
    { left: 0, top: 34, width: 16.6667, height: 32 },
    { left: 25, top: 34, width: 16.6667, height: 32 },
    { left: 58.3333, top: 34, width: 16.6667, height: 32 },
    { left: 83.3333, top: 34, width: 16.6667, height: 32 },
  ],
  mobile: [
    { left: 16.6667, top: 6.9231, width: 66.6667, height: 12.3077 },
    { left: 16.6667, top: 28.4615, width: 66.6667, height: 12.3077 },
    { left: 16.6667, top: 59.2308, width: 66.6667, height: 12.3077 },
    { left: 16.6667, top: 80.7692, width: 66.6667, height: 12.3077 },
  ],
};

const STAGE_HINT = ['Ingest', 'Retrieval', 'Penyusunan jawaban', 'Keluaran'];

function StageLabels({ variant, stages }: { variant: Variant; stages: SystemPipelineStage[] }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {LABEL_BOXES[variant].map((box, index) => (
        <span
          key={index}
          className="absolute flex items-center justify-center text-center font-mono text-[11px] leading-4 tracking-[0.06em] text-forest"
          style={{
            left: `${box.left}%`,
            top: `${box.top}%`,
            width: `${box.width}%`,
            height: `${box.height}%`,
          }}
        >
          {stages[index]?.label ?? STAGE_HINT[index]}
        </span>
      ))}
    </div>
  );
}

function DesktopSvg() {
  return (
    <svg
      data-variant="desktop"
      viewBox="0 0 960 200"
      aria-hidden="true"
      focusable="false"
      shapeRendering="geometricPrecision"
      style={{ width: '100%', height: 'auto', color: 'var(--color-forest)' }}
    >
      <g id="d-rails" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="butt">
        <path id="d-trunk-1" className="tp-rail" data-rail style={{ transitionDelay: '0ms' }} pathLength="1" d="M160 100H240" />
        <path id="d-branch-sql" className="tp-rail" data-rail style={{ transitionDelay: '400ms' }} pathLength="1" d="M400 100C412 100 412 76 424 76H536C548 76 548 100 560 100" />
        <path id="d-branch-fts5" className="tp-rail" data-rail style={{ transitionDelay: '400ms' }} pathLength="1" d="M400 100H560" />
        <path id="d-branch-qdrant" className="tp-rail tp-rail--fade" data-rail style={{ transitionDelay: '400ms' }} strokeDasharray="4 4" d="M400 100C412 100 412 124 424 124H536C548 124 548 100 560 100" />
        <path id="d-trunk-2" className="tp-rail" data-rail style={{ transitionDelay: '800ms' }} pathLength="1" d="M720 100H800" />
      </g>
      <g id="d-nodes" fill="#F3F4EF" stroke="currentColor" strokeWidth="1">
        <rect id="d-node-1" x="0" y="68" width="160" height="64" rx="6" />
        <rect id="d-node-2" x="240" y="68" width="160" height="64" rx="6" />
        <rect id="d-node-3" x="560" y="68" width="160" height="64" rx="6" />
        <rect id="d-node-4" x="800" y="68" width="160" height="64" rx="6" />
      </g>
    </svg>
  );
}

function MobileSvg() {
  return (
    <svg
      data-variant="mobile"
      viewBox="0 0 360 520"
      aria-hidden="true"
      focusable="false"
      shapeRendering="geometricPrecision"
      style={{ width: '100%', height: 'auto', color: 'var(--color-forest)' }}
    >
      <g id="m-rails" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="butt">
        <path id="m-trunk-1" className="tp-rail tp-rail--v" data-rail style={{ transitionDelay: '0ms' }} pathLength="1" d="M180 100V148" />
        <path id="m-branch-sql" className="tp-rail tp-rail--v" data-rail style={{ transitionDelay: '400ms' }} pathLength="1" d="M180 212C180 224 156 224 156 236V284C156 296 180 296 180 308" />
        <path id="m-branch-fts5" className="tp-rail tp-rail--v" data-rail style={{ transitionDelay: '400ms' }} pathLength="1" d="M180 212V308" />
        <path id="m-branch-qdrant" className="tp-rail tp-rail--fade" data-rail style={{ transitionDelay: '400ms' }} strokeDasharray="4 4" d="M180 212C180 224 204 224 204 236V284C204 296 180 296 180 308" />
        <path id="m-trunk-2" className="tp-rail tp-rail--v" data-rail style={{ transitionDelay: '800ms' }} pathLength="1" d="M180 372V420" />
      </g>
      <g id="m-nodes" fill="#F3F4EF" stroke="currentColor" strokeWidth="1">
        <rect id="m-node-1" x="60" y="36" width="240" height="64" rx="6" />
        <rect id="m-node-2" x="60" y="148" width="240" height="64" rx="6" />
        <rect id="m-node-3" x="60" y="308" width="240" height="64" rx="6" />
        <rect id="m-node-4" x="60" y="420" width="240" height="64" rx="6" />
      </g>
    </svg>
  );
}

function LegendSwatch({ dashed }: { dashed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block"
      style={{
        width: 'var(--spacing-s4)',
        borderTop: dashed ? '2px dashed var(--color-forest)' : '2px solid var(--color-forest)',
      }}
    />
  );
}

export function PipelineDiagram({ stages }: { stages: SystemPipelineStage[] }) {
  const figureRef = useRef<HTMLElement>(null);
  const [armed, setArmed] = useState(false);
  const [lit, setLit] = useState(false);

  useEffect(() => {
    if (!shouldAnimate()) return;
    setArmed(true);
    const el = figureRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setLit(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLit(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <style>{DIAGRAM_CSS}</style>
      <figure
        ref={figureRef}
        className="tp-figure m-0 flex flex-col gap-s3"
        data-animate={armed ? 'true' : 'false'}
        data-lit={lit ? 'true' : 'false'}
      >
        <div className="relative hidden md:block">
          <DesktopSvg />
          <StageLabels variant="desktop" stages={stages} />
        </div>
        <div className="relative md:hidden">
          <MobileSvg />
          <StageLabels variant="mobile" stages={stages} />
        </div>
        <div className="flex flex-wrap items-center gap-x-s4 gap-y-s1 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-72">
          <span className="inline-flex items-center gap-s2"><LegendSwatch /> SQL</span>
          <span className="inline-flex items-center gap-s2"><LegendSwatch /> FTS5</span>
          <span className="inline-flex items-center gap-s2"><LegendSwatch dashed /> Qdrant (opsional)</span>
        </div>
        <figcaption className="font-body text-caption text-ink-72">
          Empat tahap: Ingest, Retrieval, Penyusunan jawaban, Keluaran. Di tahap Retrieval alur bercabang ke SQL, FTS5,
          dan Qdrant (opsional), lalu menyatu kembali di Penyusunan jawaban.
        </figcaption>
      </figure>
    </>
  );
}
