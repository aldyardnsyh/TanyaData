'use client';

import { useState } from 'react';
import { DOC_TYPE_LABEL, formatShareTimestamp, type ShareIdentity } from '@/lib/ui/share-contract';
import { Icon } from '@/components/ui/icons';
import { MonoMeta } from '@/components/ui/mono-meta';

function IdentityBlock({ identity }: { identity: ShareIdentity | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!identity) {
    return <MonoMeta>Identitas dokumen disembunyikan</MonoMeta>;
  }

  const label = DOC_TYPE_LABEL[identity.docType];
  const pageText = identity.page != null ? `halaman ${identity.page}` : null;
  const fileName = identity.fileName ?? 'Nama berkas tidak tersedia';
  const hasFile = identity.fileName !== null;

  const nameNode = identity.documentIncluded && identity.anchorId ? (
    <a href={`#chunk-${identity.anchorId}`} className="font-body text-body-md text-primary underline-offset-2 hover:underline focus-ring">
      {fileName}
    </a>
  ) : (
    <span className="font-body text-body-md text-ink">{fileName}</span>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex min-h-11 items-center rounded-control border border-border-control px-2 font-body text-label-sm uppercase text-ink">
        {label}
      </span>
      {/* ≥1024: nama lengkap + halaman. 390: format ringkas, nama dibuka lewat tap. */}
      <span className="hidden items-center gap-2 lg:inline-flex">
        {nameNode}
        {pageText && <MonoMeta>{pageText}</MonoMeta>}
      </span>
      <span className="inline-flex flex-col gap-1 lg:hidden">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="inline-flex min-h-11 items-center gap-2 rounded-control font-body text-body-md text-ink focus-ring"
        >
          <span>{label}{pageText ? ` · ${pageText}` : ''}</span>
          <Icon name={expanded ? 'expand_less' : 'expand_more'} className="text-[16px] text-ink-muted-strong" aria-hidden="true" />
        </button>
        {expanded && (
          <span className="max-w-full break-words font-body text-body-sm text-ink-muted-strong">
            {hasFile ? nameNode : <MonoMeta>Nama berkas tidak tersedia</MonoMeta>}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Section 1 header. Satu `display` per halaman; badge "Shared view" adalah
 * status fungsional read-only, bukan badge dekoratif (SHARE_PAGE_SPEC §2.1).
 */
export function ShareHeader({
  title,
  createdAt,
  identity,
}: {
  title: string | null;
  createdAt: string;
  identity: ShareIdentity | null;
}) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex min-h-11 items-center rounded-control border border-border-control bg-surface px-2 font-body text-label-sm uppercase text-ink">
          Shared view
        </span>
        <MonoMeta>{formatShareTimestamp(createdAt)}</MonoMeta>
      </div>
      <h1 className="max-w-[72ch] font-display text-headline-lg leading-tight text-ink lg:text-display lg:leading-[44px]">
        {title ?? <span className="font-mono text-body-md uppercase tracking-[0.04em] text-ink-muted-strong">Sesi tanpa judul</span>}
      </h1>
      <IdentityBlock identity={identity} />
    </header>
  );
}

/** Header ringkas untuk state 404 / expired: badge tetap tampil (SHARE_PAGE_SPEC §7). */
export function ShareStateHeader() {
  return (
    <header className="flex flex-wrap items-center gap-3">
      <span className="inline-flex min-h-11 items-center rounded-control border border-border-control bg-surface px-2 font-body text-label-sm uppercase text-ink">
        Shared view
      </span>
    </header>
  );
}
