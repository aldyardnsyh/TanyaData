'use client';

import { useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { LayoutDashboard, MessageSquare, Database, Settings, ChevronDown, Menu, Search, FileText } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/ui/i18n-provider';
import { NAV_KEYS, type DictionaryKey } from '@/lib/i18n/dictionary';
import { Drawer } from './drawer';

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
  'nav.overview': <LayoutDashboard className="h-4.5 w-4.5" />,
  'nav.assistant': <MessageSquare className="h-4.5 w-4.5" />,
  'nav.dataSources': <Database className="h-4.5 w-4.5" />,
  'nav.investigations': <Search className="h-4.5 w-4.5" />,
  'nav.reports': <FileText className="h-4.5 w-4.5" />,
  'nav.settings': <Settings className="h-4.5 w-4.5" />,
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

  const navList = (onNavigate?: () => void) => (
    <nav className="flex-1 space-y-0.5 p-3">
      {NAV_KEYS.map((key) => {
        const href = navHrefs[key];
        const active = activeKey === key;
        return (
          <a
            key={key}
            href={href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 font-body text-label-md transition-colors duration-[var(--motion-fast)]',
              active
                ? 'bg-primary-fixed text-primary font-semibold'
                : 'text-on-surface-variant hover:bg-surface-container',
            )}
            aria-current={active ? 'page' : undefined}
          >
            {navIcons[key]}
            {t(key)}
          </a>
        );
      })}
    </nav>
  );

  const engineBadge = (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full px-3 py-2 text-label-sm font-semibold',
        engineOnline ? 'bg-secondary-container text-on-secondary-fixed' : 'bg-error-container text-on-error-container',
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', engineOnline ? 'bg-primary' : 'bg-error')} aria-hidden="true" />
      {engineLabel ?? (engineOnline ? 'Mesin: SQLite · SQL + FTS5' : 'Mesin tidak tersedia')}
      {engineHref && !engineOnline && (
        <a href={engineHref} className="ml-1 underline">
          Periksa sumber
        </a>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="fixed inset-y-0 left-0 z-sticky hidden w-58 flex-col border-r border-outline-variant bg-surface md:flex" aria-label="Sidebar">
        <div className="flex h-14 items-center gap-2 border-b border-outline-variant px-4">
          <span className="font-display text-headline-sm font-bold tracking-tight text-primary">TanyaData</span>
        </div>
        {navList()}
        <div className="border-t border-outline-variant p-3">{engineBadge}</div>
      </aside>
      <main className="min-h-screen flex-1 md:ml-58">
        <header className="sticky top-0 z-sticky flex h-14 items-center justify-between border-b border-outline-variant bg-surface px-4 md:px-6">
          <nav className="flex items-center gap-2 text-label-sm text-on-surface-variant" aria-label="Breadcrumb">
            <button
              type="button"
              className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container md:hidden focus-ring focus-visible:outline-none"
              aria-label="Buka menu navigasi"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="font-body uppercase tracking-wider">{t(activeKey as DictionaryKey)}</span>
          </nav>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-md bg-surface-container-low px-2.5 py-1.5 font-body text-label-md text-on-surface">
              <span className="max-w-[150px] truncate">{workspaceName}</span>
              <ChevronDown className="h-4 w-4 text-on-surface-variant" />
            </div>
          </div>
        </header>
        {children}
      </main>
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen} side="left" width="280px" title="TanyaData">
        <div className="flex h-full flex-col">
          {navList(() => setMobileOpen(false))}
          <div className="border-t border-outline-variant pt-3">{engineBadge}</div>
        </div>
      </Drawer>
    </div>
  );
}
