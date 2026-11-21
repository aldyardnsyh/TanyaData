'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/ui/i18n-provider';
import { useApi } from '@/lib/ui/fetch-hooks';
import type { MetaResponse, SettingsResponse } from '@/lib/contracts/http';
import { NAV_ITEMS, currentNavKey } from '@/components/layout/nav-config';
import { Icon } from '@/components/ui/icons';
import { FloatingDock } from '@/components/signal/floating-dock';

/**
 * C-06 Expandable Rail (dari Sidebar).
 * Purpose Gate: menghemat ruang kerja tanpa menyembunyikan label dari pembaca
 * layar. Lebar tidak dianimasikan; label muncul 120ms opacity (M1).
 */
export function ExpandableRail({ activeKey }: { activeKey: string }) {
  const { t } = useI18n();
  return (
    <aside className="fixed inset-y-0 left-0 z-sticky hidden w-rail flex-col border-r border-[var(--border-hairline)] bg-porcelain md:flex xl:w-rail-expanded" aria-label="Navigasi samping">
      <div className="flex h-14 items-center gap-s2 border-b border-[var(--border-hairline)] px-s3">
        <span className="state-dot state-dot-active" aria-hidden="true" />
        <Icon name="query_stats" className="text-[20px] text-forest" />
        <span className="hidden font-display text-label font-semibold text-ink xl:inline">TanyaData</span>
      </div>
      <nav className="flex flex-1 flex-col gap-s1 p-s2" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = activeKey === item.key;
          return (
            <a
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={t(item.key)}
              className={`relative flex min-h-11 items-center gap-s3 rounded-control px-s2 transition-colors duration-[var(--motion-fast)] focus-ring ${
                active ? 'bg-forest-08 text-forest' : 'text-ink-72 hover:bg-forest-08 hover:text-forest'
              }`}
            >
              {active && <span className="absolute left-0 top-1/2 h-s4 w-[2px] -translate-y-1/2 bg-forest" aria-hidden="true" />}
              <Icon name={item.icon} className="text-[20px]" />
              <span className="hidden truncate font-display text-label xl:inline">{t(item.key)}</span>
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

/** Header ringkas: identitas dataset dari API. Tanpa badge versi atau klaim live. */
export function AppHeader({ datasetName, onOpenMenu }: { datasetName: string; onOpenMenu: () => void }) {
  return (
    <header className="fixed inset-x-0 top-0 z-sticky flex h-14 items-center justify-between gap-s3 border-b border-[var(--border-hairline)] bg-porcelain px-s3 md:left-rail xl:left-rail-expanded">
      <div className="flex min-w-0 items-center gap-s2">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Buka navigasi"
          className="touch-44 inline-flex items-center justify-center rounded-control text-ink focus-ring md:hidden"
        >
          <Icon name="menu" className="text-[20px]" />
        </button>
        <span className="truncate font-display text-label font-semibold text-ink">{datasetName}</span>
      </div>
      <a href="/settings" className="touch-44 inline-flex items-center rounded-control px-s2 font-display text-label text-ink-72 hover:text-forest focus-ring">
        Pengaturan
      </a>
    </header>
  );
}

/** Shell baru menggantikan workspace-shell.tsx (UI_REFACTOR_DESIGN §7.1). */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const meta = useApi<MetaResponse>('/api/meta');
  const settings = useApi<SettingsResponse>('/api/settings');
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeKey = currentNavKey(pathname);
  const datasetName =
    meta.data?.data.activeDataset.name ??
    settings.data?.datasets.find((d) => d.id === settings.data?.activeDatasetId)?.name ??
    'Dataset aktif';

  return (
    <div className="min-h-screen bg-porcelain">
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:absolute focus:left-s3 focus:top-s3 focus:z-toast focus:rounded-control focus:bg-forest focus:px-s3 focus:py-s2 focus:text-porcelain focus-ring"
      >
        {t('shell.skipToContent')}
      </a>

      <ExpandableRail activeKey={activeKey} />
      <AppHeader datasetName={datasetName} onOpenMenu={() => setMobileOpen(true)} />

      {mobileOpen && (
        <div className="fixed inset-0 z-drawer md:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <nav className="absolute inset-y-0 left-0 w-rail-expanded bg-porcelain p-s3" aria-label="Primary mobile">
            <button type="button" onClick={() => setMobileOpen(false)} aria-label="Tutup navigasi" className="touch-44 rounded-control text-ink focus-ring">
              <Icon name="close" className="text-[20px]" />
            </button>
            <div className="mt-s3 flex flex-col gap-s1">
              {NAV_ITEMS.map((item) => (
                <a
                  key={item.key}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="touch-44 flex items-center gap-s2 rounded-control px-s2 font-display text-label text-ink focus-ring"
                >
                  <Icon name={item.icon} className="text-[20px]" />
                  {t(item.key)}
                </a>
              ))}
            </div>
          </nav>
        </div>
      )}

      <main id="konten-utama" className="min-h-screen pb-dock pt-14 md:pb-0 md:pl-rail xl:pl-rail-expanded">
        {children}
      </main>

      <FloatingDock
        items={NAV_ITEMS.map((item) => ({
          id: item.key,
          label: t(item.key),
          icon: item.icon,
          href: item.href,
        }))}
        activeId={activeKey}
        className="md:hidden"
      />
    </div>
  );
}
