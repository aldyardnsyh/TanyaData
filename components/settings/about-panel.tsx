'use client';

import type { MetaResponse, SystemPipelineStage, SystemRuntime } from '@/lib/contracts/http';
import { SectionRule } from '@/components/signal/section-rule';
import { PipelineDiagram } from '@/components/settings/pipeline-diagram';
import { formatDateRangeId, formatDateTimeId, formatNumber } from '@/lib/ui/format';

/**
 * Tab Tentang: dokumentasi sistem read-only (DESIGN_SYSTEM §J, DECISION-035).
 *
 * Semua isi berasal dari `GET /api/meta` (`system` + `app` + `data`). Tidak ada
 * klaim yang disusun UI: bila `system` tidak dikirim build ini, seksi 2 sampai 5
 * tidak diisi dan yang tampil hanya identitas workspace + satu notice jujur.
 * Setiap klaim menampilkan sumbernya sebagai chip mono (path kode dari server;
 * fallback `/api/meta` bila server tidak mengirim `source`).
 */

type Tone = 'on' | 'off' | 'degraded';

function Dot({ tone }: { tone: Tone }) {
  const cls =
    tone === 'on' ? 'state-dot' : tone === 'degraded' ? 'state-dot state-dot-error' : 'state-dot state-dot-empty';
  return <span className={cls} aria-hidden="true" />;
}

function Provenance({ source }: { source?: string }) {
  const text = source ?? '/api/meta';
  return (
    <code
      className="inline-flex h-5 max-w-full items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-control border border-[var(--border-hairline)] bg-forest-08 px-s2 font-mono text-[11px] leading-4 tracking-[0.06em] text-ink-72"
      aria-label={`Sumber: ${text}`}
    >
      {text}
    </code>
  );
}

function SectionHeading({
  id,
  title,
  note = 'Setiap klaim menyertakan sumber kode.',
}: {
  id: string;
  title: string;
  note?: string | null;
}) {
  return (
    <div className="flex flex-col gap-s1">
      <h3 id={id} className="font-display text-title text-ink">
        {title}
      </h3>
      {note && <p className="font-body text-caption text-ink-72">{note}</p>}
    </div>
  );
}

function runtimeRows(runtime: SystemRuntime): { label: string; value: string; hint?: string; tone: Tone }[] {
  const reachable =
    runtime.qdrantReachable === null
      ? 'Tidak diukur'
      : runtime.qdrantReachable
        ? 'Terjangkau'
        : 'Tidak terjangkau';
  const reachableTone: Tone =
    runtime.qdrantReachable === null ? 'off' : runtime.qdrantReachable ? 'on' : 'degraded';

  return [
    {
      label: 'Retrieval efektif',
      value: runtime.effectiveRetrieval,
      hint:
        runtime.effectiveRetrieval === runtime.retrievalMode
          ? `terkonfigurasi ${runtime.retrievalMode}`
          : `terkonfigurasi ${runtime.retrievalMode}, efektif ${runtime.effectiveRetrieval}`,
      tone: runtime.effectiveRetrieval === 'fts5' ? 'off' : 'on',
    },
    {
      label: 'Qdrant',
      value: reachable,
      hint: `mode ${runtime.qdrantMode}${runtime.qdrantConfigured ? '' : ', URL belum diset'}`,
      tone: reachableTone,
    },
    {
      label: 'Embedding',
      value: runtime.embeddingProvider === 'off' ? 'Nonaktif' : 'Lokal e5-small',
      tone: runtime.embeddingProvider === 'off' ? 'off' : 'on',
    },
    {
      label: 'Model bahasa',
      value: runtime.llm.enabled ? `Aktif (${runtime.llm.mode})` : `Nonaktif (${runtime.llm.mode})`,
      tone: runtime.llm.enabled ? 'on' : 'off',
    },
    {
      label: 'OCR',
      value: runtime.ocrEnabled ? 'Aktif' : 'Nonaktif',
      tone: runtime.ocrEnabled ? 'on' : 'off',
    },
    {
      label: 'Profil seed',
      value: runtime.seedProfile,
      tone: runtime.seedProfile === 'none' ? 'off' : 'on',
    },
  ];
}

function StageCard({ index, stage }: { index: number; stage: SystemPipelineStage }) {
  return (
    <article className="flex flex-col gap-s2 rounded-surface border border-[var(--border-hairline)] p-s3">
      <div className="flex items-baseline gap-s2">
        <span className="font-mono text-[11px] tracking-[0.06em] text-forest">{`0${index + 1}`}</span>
        <h4 className="font-display text-label font-semibold text-ink">{stage.label}</h4>
      </div>
      <p className="font-body text-caption text-ink-72">{stage.summary}</p>
      <dl className="grid gap-s1 font-body text-caption">
        <div className="flex gap-s2">
          <dt className="w-20 flex-none text-ink-72">Masukan</dt>
          <dd className="text-ink">{stage.inputs.join(', ')}</dd>
        </div>
        <div className="flex gap-s2">
          <dt className="w-20 flex-none text-ink-72">Keluaran</dt>
          <dd className="text-ink">{stage.outputs.join(', ')}</dd>
        </div>
        {stage.fallback && (
          <div className="flex gap-s2">
            <dt className="w-20 flex-none text-ink-72">Bila gagal</dt>
            <dd className="text-ink">{stage.fallback}</dd>
          </div>
        )}
      </dl>
      <div className="mt-s1 flex justify-end">
        <Provenance source={stage.source} />
      </div>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-s4" aria-busy="true" aria-label="Memuat dokumentasi sistem">
      <div className="skeleton h-s5 w-40" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-24 w-full" />
      ))}
    </div>
  );
}

export function AboutPanel({
  meta,
  loading,
  error,
  onRetry,
}: {
  meta: MetaResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) return <Skeleton />;

  if (error) {
    return (
      <div className="flex flex-col items-start gap-s3 rounded-surface border border-[var(--border-hairline)] p-s4" role="alert">
        <span className="inline-flex items-center gap-s2">
          <Dot tone="degraded" />
          <span className="font-body text-body text-ink">Status sistem belum bisa dimuat.</span>
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="flex items-start gap-s2 rounded-surface border border-[var(--border-hairline)] p-s4">
        <Dot tone="off" />
        <p className="font-body text-body text-ink">Dokumentasi sistem belum tersedia di build ini.</p>
      </div>
    );
  }

  const { app, data, system, generatedAt } = meta;
  const active = data.activeDataset;

  const identity = (
    <section aria-labelledby="about-identity" className="flex flex-col gap-s3">
      <SectionHeading id="about-identity" title="Identitas workspace" note={null} />
      <dl className="grid gap-s2 sm:grid-cols-2">
        {[
          ['Aplikasi', app.name],
          ['Versi', app.version],
          ['Build', app.build],
          ['Dokumen', `${formatNumber(data.documents.total)} total · ${formatNumber(data.documents.indexed)} terindeks · ${formatNumber(data.documents.chunks)} potongan`],
          ['Dataset aktif', `${active.name} · ${formatNumber(active.rowCount)} baris`],
          ['Rentang data', formatDateRangeId(active.minDate, active.maxDate)],
          ['Meta dibuat', formatDateTimeId(generatedAt)],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-s1 border-b border-[var(--border-hairline)] pb-s2">
            <dt className="font-body text-caption text-ink-72">{label}</dt>
            <dd className="font-body text-body text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );

  if (!system) {
    return (
      <div className="flex max-w-[960px] flex-col gap-s5">
        <div className="flex items-start gap-s2 rounded-surface border border-[var(--border-hairline)] p-s4">
          <Dot tone="off" />
          <p className="font-body text-body text-ink">Dokumentasi sistem belum tersedia di build ini.</p>
        </div>
        <SectionRule />
        {identity}
      </div>
    );
  }

  const rows = runtimeRows(system.runtime);
  const requiredLabel = (required: boolean) => (required ? 'Wajib' : 'Opsional');

  return (
    <div className="flex max-w-[960px] flex-col gap-s5">
      {/* 1. Ringkasan */}
      <section aria-labelledby="about-summary" className="flex flex-col gap-s3">
        <SectionHeading id="about-summary" title="Ringkasan sistem" />
        <p className="font-body text-body text-ink">
          {system.summary ??
            `${app.name} ${app.version} (build ${app.build}) menjalankan ${formatNumber(data.documents.total)} dokumen dengan ${formatNumber(data.documents.indexed)} terindeks. Dataset aktif ${active.name}; mode retrieval efektif ${system.runtime.effectiveRetrieval}.`}
        </p>
        <div className="flex flex-wrap gap-s2">
          <Provenance source={system.pipeline[0]?.source} />
        </div>
        <dl className="grid gap-s2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Versi', app.version],
            ['Build', app.build],
            ['Dataset aktif', active.name],
            ['Retrieval efektif', system.runtime.effectiveRetrieval],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-s1 rounded-surface border border-[var(--border-hairline)] p-s3">
              <dt className="font-body text-caption text-ink-72">{label}</dt>
              <dd className="font-body text-body text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <SectionRule />

      {/* 2. Pipeline */}
      <section aria-labelledby="about-pipeline" className="flex flex-col gap-s3">
        <SectionHeading id="about-pipeline" title="Alur sistem" />
        <PipelineDiagram />
        <p className="font-body text-caption text-ink-72">
          Rincian empat tahap inti (ingest, retrieval, penyusunan jawaban, keluaran) dari data
          server:
        </p>
        <div className="grid gap-s3 sm:grid-cols-2">
          {system.pipeline.map((stage, index) => (
            <StageCard key={stage.id} index={index} stage={stage} />
          ))}
        </div>
      </section>

      <SectionRule />

      {/* 3. Tabel teknologi */}
      <section aria-labelledby="about-stack" className="flex flex-col gap-s3">
        <SectionHeading id="about-stack" title="Teknologi per tahap" />
        {/* Desktop: tabel. Mobile: daftar baris (nama+versi / peran / status / sumber). */}
        <table className="hidden w-full border-collapse text-left md:table">
          <thead>
            <tr className="border-b border-[var(--border-hairline)]">
              {['Teknologi', 'Versi', 'Peran', 'Status', 'Sumber'].map((head) => (
                <th key={head} scope="col" className="py-s2 pr-s3 font-display text-caption font-semibold text-ink-72">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {system.stack.map((item) => (
              <tr key={`${item.name}@${item.version}`} className="border-b border-[var(--border-hairline)] align-top">
                <td className="py-s2 pr-s3 font-body text-body text-ink">{item.name}</td>
                <td className="py-s2 pr-s3 font-mono text-caption text-ink-72">{item.version}</td>
                <td className="py-s2 pr-s3 font-body text-caption text-ink-72">{item.role}</td>
                <td className="py-s2 pr-s3">
                  <span className="inline-flex items-center gap-s1 font-body text-caption text-ink">
                    <Dot tone={item.required ? 'on' : 'off'} />
                    {requiredLabel(item.required)}
                  </span>
                </td>
                <td className="py-s2">
                  <Provenance source={item.source} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="flex flex-col gap-s2 md:hidden">
          {system.stack.map((item) => (
            <li
              key={`${item.name}@${item.version}-m`}
              className="flex flex-col gap-s1 border-b border-[var(--border-hairline)] pb-s2"
            >
              <div className="flex items-baseline justify-between gap-s2">
                <span className="font-body text-body text-ink">{item.name}</span>
                <span className="font-mono text-caption text-ink-72">{item.version}</span>
              </div>
              <p className="font-body text-caption text-ink-72">{item.role}</p>
              <div className="flex items-center justify-between gap-s2">
                <span className="inline-flex items-center gap-s1 font-body text-caption text-ink">
                  <Dot tone={item.required ? 'on' : 'off'} />
                  {requiredLabel(item.required)}
                </span>
                <Provenance source={item.source} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <SectionRule />

      {/* 4. Status runtime */}
      <section aria-labelledby="about-runtime" className="flex flex-col gap-s3">
        <SectionHeading id="about-runtime" title="Status runtime" note={null} />
        <dl className="grid gap-s2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-s1 rounded-surface border border-[var(--border-hairline)] p-s3">
              <dt className="font-body text-caption text-ink-72">{row.label}</dt>
              <dd className="flex items-center gap-s2">
                <Dot tone={row.tone} />
                <span className="font-body text-body text-ink">{row.value}</span>
              </dd>
              {row.hint && <p className="font-mono text-[11px] leading-4 tracking-[0.06em] text-ink-72">{row.hint}</p>}
            </div>
          ))}
        </dl>
        {system.runtime.fallbackReason !== null && (
          <p className="rounded-surface border border-[var(--color-terracotta)] p-s3 font-body text-caption text-ink">
            {system.runtime.fallbackReason}
          </p>
        )}
      </section>

      <SectionRule />

      {/* 5. Batasan yang diketahui */}
      <section aria-labelledby="about-limits" className="flex flex-col gap-s3">
        <SectionHeading id="about-limits" title="Batasan yang diketahui" />
        <ul className="flex flex-col gap-s3">
          {system.limits.map((limit) => (
            <li key={limit.id} className="flex flex-col gap-s1">
              <p className="font-display text-label font-semibold text-ink">{limit.label}</p>
              <p className="font-body text-caption text-ink-72">{limit.detail}</p>
              <div className="mt-s1">
                <Provenance source={limit.source} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <SectionRule />

      {/* 6. Identitas workspace */}
      {identity}
    </div>
  );
}
