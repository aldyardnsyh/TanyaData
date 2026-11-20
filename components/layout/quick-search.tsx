'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icons';
import { IconTooltip } from '@/components/ui/icon-tooltip';
import { useApi } from '@/lib/ui/fetch-hooks';
import { useI18n } from '@/lib/ui/i18n-provider';
import type { SourcesListResponse, MetaResponse } from '@/lib/contracts/http';
import { NAV_ITEMS } from './nav-config';

type Result = { id: string; label: string; group: 'Halaman' | 'Dataset' | 'Dokumen'; href: string; icon: string };

/**
 * §5.7 + motion #4: palette ⌘K mencari halaman, dataset, dan dokumen nyata
 * dari API. scale 0,98→1 + blur 4px→0 180ms; backdrop fade 120ms; stagger 30ms.
 */
export function QuickSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const { t } = useI18n();
  const sources = useApi<SourcesListResponse>('/api/sources');
  const meta = useApi<MetaResponse>('/api/meta');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const pages: Result[] = NAV_ITEMS.map((item) => ({
      id: `page:${item.href}`,
      label: t(item.key),
      group: 'Halaman' as const,
      href: item.href,
      icon: item.icon,
    }));
    const datasets: Result[] = (sources.data?.items ?? [])
      .filter((s) => s.kind === 'dataset')
      .map((s) => ({
        id: `dataset:${s.id}`,
        label: s.name,
        group: 'Dataset' as const,
        href: '/data-sources',
        icon: 'database',
      }));
    const documents: Result[] = (sources.data?.items ?? [])
      .filter((s) => s.kind === 'document')
      .map((s) => ({
        id: `doc:${s.id}`,
        label: s.name,
        group: 'Dokumen' as const,
        href: '/data-sources',
        icon: 'description',
      }));
    const all = [...pages, ...datasets, ...documents];
    return (q ? all.filter((r) => r.label.toLowerCase().includes(q)) : all).slice(0, 8);
  }, [query, sources.data, t]);

  const go = (href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  };

  const groups: Result['group'][] = ['Halaman', 'Dataset', 'Dokumen'];

  return (
    <>
      <IconTooltip label="Cari data dan aksi">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Cari data dan aksi"
          title="Cari data dan aksi"
          className="flex h-11 min-h-11 min-w-11 items-center gap-2 rounded-control border border-border-control bg-surface px-3 text-ink-muted-strong transition-colors duration-[var(--motion-fast)] hover:border-primary hover:text-ink focus-ring"
        >
          <Icon name="search" className="text-[20px]" />
          <span className="hidden w-28 text-left font-body text-body-md lg:inline">Cari data…</span>
          <kbd className="hidden rounded-control border border-border-hairline bg-canvas px-1.5 py-0.5 font-mono text-body-sm lg:inline">⌘K</kbd>
        </button>
      </IconTooltip>

      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-ink/25 transition-opacity duration-[var(--motion-fast)] data-[state=open]:opacity-100 data-[state=closed]:opacity-0" />
          <DialogPrimitive.Content
            aria-label={t('shell.commandPalette')}
            className="animate-palette-in fixed left-1/2 top-[12%] z-modal w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-overlay border border-border-hairline bg-surface p-4 shadow-overlay focus:outline-none"
          >
            <DialogPrimitive.Title className="sr-only">{t('shell.commandPalette')}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Cari dataset, dokumen, atau halaman</DialogPrimitive.Description>
            <div className="flex items-center gap-2 rounded-control border border-border-control px-3">
              <Icon name="search" className="text-[20px] text-ink-muted-strong" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cari dataset, dokumen, atau halaman"
                className="min-h-11 w-full bg-transparent font-body text-body-md text-ink outline-none placeholder:text-ink-muted-strong"
              />
            </div>
            <ul className="mt-3 max-h-72 overflow-y-auto">
              {groups.map((group) => {
                const items = results.filter((r) => r.group === group);
                if (items.length === 0) return null;
                return (
                  <li key={group}>
                    <p className="mono-meta px-3 pb-1 pt-2">{group}</p>
                    <ul>
                      {items.map((r, i) => (
                        <li key={r.id} style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }} className="animate-message-in">
                          <button
                            type="button"
                            onClick={() => go(r.href)}
                            className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left font-body text-body-md text-ink transition-colors duration-[var(--motion-fast)] hover:bg-row-hover focus-ring"
                          >
                            <Icon name={r.icon} className="text-[20px] text-primary" />
                            <span className="min-w-0 flex-1 truncate">{r.label}</span>
                            <span className="font-body text-body-sm text-ink-muted-strong">{t('shell.goTo')}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
              {results.length === 0 && (
                <li className="px-3 py-6 text-center font-body text-body-md text-ink-muted-strong">
                  Tidak ada hasil. Coba kata kunci lain.
                </li>
              )}
            </ul>
            <div className="mt-2 border-t border-border-hairline pt-2">
              <p className="mono-meta">Enter pilih · Esc tutup</p>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
