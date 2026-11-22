'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '@/lib/ui/i18n-provider';
import { useApi } from '@/lib/ui/fetch-hooks';
import type { MetaResponse } from '@/lib/contracts/http';
import { NAV_ITEMS, currentNavKey } from '@/components/layout/nav-config';
import { Icon } from '@/components/ui/icons';
import { FloatingDock } from '@/components/signal/floating-dock';

/**
 * C-06 Expandable Rail (dari Sidebar).
 * Purpose Gate: menghemat ruang kerja tanpa menyembunyikan label dari pembaca
 * layar. Lebar tidak dianimasikan; label muncul 120ms opacity (M1).
 * Collapse manual: rail bisa diciutkan ke ikon saja agar fokus ke konten;
 * saat ciut, hover/fokus pada ikon memunculkan tooltip nama menu.
 * Pilihan bertahan di localStorage.
 */
export function ExpandableRail({ activeKey, collapsed, onToggleCollapsed }: { activeKey: string; collapsed: boolean; onToggleCollapsed: () => void }) {
  const { t } = useI18n();

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-sticky hidden flex-col border-r border-[var(--border-hairline)] bg-porcelain md:flex ${collapsed ? 'w-rail' : 'w-rail xl:w-rail-expanded'}`}
      aria-label="Navigasi samping"
    >
      {/* Brand = pintu kembali ke landing page. */}
      <Link
        href="/"
        aria-label="TanyaData, kembali ke halaman utama"
        className="flex h-14 items-center gap-s2 px-s3 transition-colors duration-[var(--motion-fast)] hover:bg-forest-08 focus-ring"
      >
        <span className="state-dot state-dot-active" aria-hidden="true" />
        <Icon name="query_stats" className="text-[20px] text-forest" />
        {!collapsed && <span className="hidden font-display text-label font-semibold text-ink xl:inline">TanyaData</span>}
      </Link>
      <nav className="flex flex-1 flex-col gap-s1 p-s2" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = activeKey === item.key;
          return (
            <a
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={t(item.key)}
              className={`group relative flex min-h-11 items-center gap-s3 rounded-control px-s2 transition-colors duration-[var(--motion-fast)] focus-ring ${
                active ? 'bg-forest-08 text-forest' : 'text-ink-72 hover:bg-forest-08 hover:text-forest'
              }`}
            >
              {active && <span className="absolute left-0 top-1/2 h-s4 w-[2px] -translate-y-1/2 bg-forest" aria-hidden="true" />}
              <Icon name={item.icon} className="text-[20px]" />
              {!collapsed && <span className="hidden truncate font-display text-label xl:inline">{t(item.key)}</span>}
              {collapsed && (
                <span
                  className="pointer-events-none absolute left-full top-1/2 z-toast ml-s2 -translate-y-1/2 whitespace-nowrap rounded-control border border-[var(--border-hairline)] bg-ink px-s2 py-s1 font-display text-label text-porcelain opacity-0 shadow-float transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 group-focus-visible:opacity-100"
                  role="tooltip"
                >
                  {t(item.key)}
                </span>
              )}
            </a>
          );
        })}
      </nav>
      <div className="border-t border-[var(--border-hairline)] p-s2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Buka sidebar' : 'Ciutkan sidebar'}
          aria-expanded={!collapsed}
          className="flex min-h-11 w-full items-center justify-center gap-s3 rounded-control px-s2 text-ink-72 transition-colors duration-[var(--motion-fast)] hover:bg-forest-08 hover:text-forest focus-ring"
        >
          <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} className="text-[20px]" />
          {!collapsed && <span className="hidden font-display text-label xl:inline">Ciutkan</span>}
        </button>
      </div>
    </aside>
  );
}

/** Header ringkas: identitas dokumen terindeks dari API. Tanpa badge versi atau klaim live. */
export function AppHeader({ datasetName, onOpenMenu, collapsed = false }: { datasetName: string; onOpenMenu: () => void; collapsed?: boolean }) {
  return (
    <header className={`fixed inset-x-0 top-0 z-sticky flex h-14 items-center justify-between gap-s3 border-b border-[var(--border-hairline)] bg-porcelain px-s3 md:left-rail ${collapsed ? '' : 'xl:left-rail-expanded'}`}>
      <div className="flex min-w-0 items-center gap-s2">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Buka navigasi"
          className="touch-44 inline-flex items-center justify-center rounded-control text-ink focus-ring md:hidden"
        >
          <Icon name="menu" className="text-[20px]" />
        </button>
        <Link href="/" aria-label="TanyaData, kembali ke halaman utama" className="min-w-0 truncate font-display text-label font-semibold text-ink transition-colors duration-[var(--motion-fast)] hover:text-forest focus-ring">
          {datasetName}
        </Link>
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
  const [mobileOpen, setMobileOpen] = useState(false);
  // State collapse rail diangkat ke sini agar konten + header ikut menggeser.
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setRailCollapsed(window.localStorage.getItem('rail-collapsed') === '1');
  }, []);

  const toggleRailCollapsed = () => {
    setRailCollapsed((prev) => {
      window.localStorage.setItem('rail-collapsed', prev ? '0' : '1');
      return !prev;
    });
  };

  const activeKey = currentNavKey(pathname);
  // RAG-first: identitas header = dokumen terindeks, bukan dataset legacy.
  const headerLabel =
    meta.data?.data.documents.total != null
      ? `TanyaData · ${meta.data.data.documents.total} dokumen terindeks`
      : 'TanyaData';

  return (
    <div className="min-h-screen bg-porcelain">
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:absolute focus:left-s3 focus:top-s3 focus:z-toast focus:rounded-control focus:bg-forest focus:px-s3 focus:py-s2 focus:text-porcelain focus-ring"
      >
        {t('shell.skipToContent')}
      </a>

      <ExpandableRail activeKey={activeKey} collapsed={railCollapsed} onToggleCollapsed={toggleRailCollapsed} />
      <AppHeader datasetName={headerLabel} onOpenMenu={() => setMobileOpen(true)} collapsed={railCollapsed} />

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

      <main id="konten-utama" className={`min-h-screen pb-dock pt-14 md:pb-0 md:pl-rail ${railCollapsed ? '' : 'xl:pl-rail-expanded'}`}>
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
