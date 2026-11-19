'use client';

import { useState } from 'react';
import Link from 'next/link';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  IconLayoutDashboard,
  IconMessageSquare,
  IconDatabase,
  IconSettings,
  IconChevronDown,
  IconMenu,
  IconScanSearch,
  IconFileText,
} from './icons';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/ui/i18n-provider';
import { NAV_KEYS, type DictionaryKey } from '@/lib/i18n/dictionary';
import { Drawer } from './drawer';
import { EngineIndicator } from './engine-indicator';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ShellProps {
  children: React.ReactNode;
  engineOnline?: boolean;
  engineLabel?: string;
  engineHref?: string;
  workspaceName?: string;
}

const navIcons: Record<string, React.ReactNode> = {
  'nav.overview': <IconLayoutDashboard className="h-[18px] w-[18px] shrink-0" />,
  'nav.assistant': <IconMessageSquare className="h-[18px] w-[18px] shrink-0" />,
  'nav.dataSources': <IconDatabase className="h-[18px] w-[18px] shrink-0" />,
  // A-08: ScanSearch, bukan Search — Investigasi bukan pencarian.
  'nav.investigations': <IconScanSearch className="h-[18px] w-[18px] shrink-0" />,
  'nav.reports': <IconFileText className="h-[18px] w-[18px] shrink-0" />,
  'nav.settings': <IconSettings className="h-[18px] w-[18px] shrink-0" />,
};

const navHrefs: Record<string, string> = {
  'nav.overview': '/overview',
  'nav.assistant': '/assistant',
  'nav.dataSources': '/data-sources',
  'nav.investigations': '/investigations',
  'nav.reports': '/reports',
  'nav.settings': '/settings',
};

function currentNavKey(pathname: string): string {
  const keys = NAV_KEYS;
  if (pathname === '/') return 'nav.overview';
  const exact = keys.find((k) => navHrefs[k] === pathname);
  if (exact) return exact;
  if (pathname.startsWith('/assistant')) return 'nav.assistant';
  if (pathname.startsWith('/data-sources')) return 'nav.dataSources';
  if (pathname.startsWith('/investigations')) return 'nav.investigations';
  if (pathname.startsWith('/reports')) return 'nav.reports';
  if (pathname.startsWith('/settings')) return 'nav.settings';
  return 'nav.overview';
}

export function Shell({ children, engineOnline = true, engineLabel, engineHref, workspaceName = 'analytics.db — Transaksi' }: ShellProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeKey = currentNavKey(pathname);

  // rail = true untuk sidebar tablet (ikon saja); drawer mobile selalu berlabel.
  const navList = (rail: boolean, onNavigate?: () => void) => (
    <nav className="flex-1 space-y-0.5 p-3">
      {NAV_KEYS.map((key) => {
        const href = navHrefs[key];
        const active = activeKey === key;
        return (
          <Link
            key={key}
            href={href}
            onClick={onNavigate}
            aria-label={rail ? t(key as DictionaryKey) : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 font-body text-label-md transition-colors duration-[var(--motion-fast)] focus-ring',
              rail && 'justify-center md:px-0 xl:justify-start xl:px-2.5',
              active
                ? 'bg-primary-fixed text-primary font-semibold'
                : 'text-on-surface-variant hover:bg-surface-container',
            )}
            aria-current={active ? 'page' : undefined}
          >
            {navIcons[key]}
            <span className={cn(rail && 'md:hidden xl:inline')}>{t(key)}</span>
          </Link>
        );
      })}
    </nav>
  );

  // rail: di tablet hanya dot (teks via sr-only); label penuh kembali ≥1280.
  const engineBadge = (rail: boolean) => {
    if (!rail) {
      return <EngineIndicator online={engineOnline} label={engineLabel} href={engineHref} />;
    }
    return (
      <span className="flex justify-center xl:block" title={engineOnline ? 'Mesin: SQLite · SQL + FTS5' : 'Mesin tidak tersedia'}>
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-2 py-2 xl:px-3',
            engineOnline ? 'bg-secondary-container' : 'bg-error-container',
          )}
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', engineOnline ? 'bg-primary' : 'bg-error')} aria-hidden="true" />
          <span className={cn('hidden font-body text-label-sm font-semibold xl:inline', engineOnline ? 'text-on-secondary-fixed' : 'text-on-error-container')}>
            {engineOnline ? 'Mesin: SQLite · SQL + FTS5' : 'Mesin tidak tersedia'}
          </span>
          <span className="sr-only">{engineOnline ? 'Mesin: SQLite · SQL + FTS5' : 'Mesin tidak tersedia'}</span>
          {!engineOnline && engineHref && (
            <Link href={engineHref} className="ml-1 hidden font-body text-label-sm font-semibold text-on-error-container underline xl:inline focus-ring">
              Periksa sumber
            </Link>
          )}
        </span>
      </span>
    );
  };

  return (
    <div className="flex min-h-screen bg-surface">
      {/* C-31: skip link sebagai elemen fokus pertama. */}
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-toast focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-label-md focus:text-on-primary"
      >
        Lompat ke konten utama
      </a>
      {/* C-34: rail 72px pada tablet (768–1279), 232px hanya ≥1280. */}
      <aside
        className="fixed inset-y-0 left-0 z-sticky hidden w-sidebar-rail flex-col border-r border-outline-variant bg-surface md:flex xl:w-sidebar"
        aria-label="Sidebar"
      >
        <div className="flex h-14 items-center justify-center gap-2 border-b border-outline-variant px-2 xl:justify-start xl:px-4">
          <span className="font-display text-headline-sm font-bold tracking-tight text-primary" aria-hidden="true">
            <span className="md:hidden xl:inline">TanyaData</span>
            <span className="hidden md:inline xl:hidden">TD</span>
          </span>
          <span className="sr-only">TanyaData</span>
        </div>
        {navList(true)}
        <div className="border-t border-outline-variant p-3">{engineBadge(true)}</div>
      </aside>
      <main id="konten-utama" className="min-h-screen flex-1 md:ml-sidebar-rail xl:ml-sidebar">
        <header className="sticky top-0 z-sticky flex h-14 items-center justify-between border-b border-outline-variant bg-surface px-4 md:px-6">
          <nav className="flex items-center gap-2 text-label-sm text-on-surface-variant" aria-label="Breadcrumb">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container md:hidden focus-ring"
              aria-label="Buka menu navigasi"
              onClick={() => setMobileOpen(true)}
            >
              <IconMenu className="h-5 w-5" />
            </button>
            <span className="font-body uppercase tracking-wider">{t(activeKey as DictionaryKey)}</span>
          </nav>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-md bg-surface-container-low px-2.5 py-1.5 font-body text-label-md text-on-surface">
              <span className="max-w-[150px] truncate">{workspaceName}</span>
              <IconChevronDown className="h-4 w-4 text-on-surface-variant" />
            </div>
          </div>
        </header>
        {children}
      </main>
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen} side="left" width="280px" title="TanyaData">
        <div className="flex h-full flex-col">
          {navList(false, () => setMobileOpen(false))}
          <div className="border-t border-outline-variant pt-3">{engineBadge(false)}</div>
        </div>
      </Drawer>
    </div>
  );
}
