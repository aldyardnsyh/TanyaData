'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icons';
import { Dialog } from '@/components/ui/dialog';
import { useI18n } from '@/lib/ui/i18n-provider';
import type { DictionaryKey } from '@/lib/i18n/dictionary';
import { NAV_ITEMS } from './nav-config';
import { NavItemLink } from './nav-item';
import { WorkspaceSwitcher } from './workspace-switcher';
import { EngineBadge } from './engine-badge';

export interface SidebarProps {
  activeKey: DictionaryKey;
  appName: string;
  version?: string;
  engineOnline: boolean;
}

export function Sidebar({ activeKey, appName, version, engineOnline }: SidebarProps) {
  const { t } = useI18n();
  const [docsOpen, setDocsOpen] = useState(false);

  return (
    <>
      <aside
        className="fixed inset-y-0 left-0 z-sticky hidden w-sidebar-rail flex-col border-r border-outline-variant bg-surface md:flex xl:w-sidebar"
        aria-label="Sidebar"
      >
        <WorkspaceSwitcher name={appName} rail />
        <nav className="flex-1 space-y-space-xs p-space-sm" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavItemLink
              key={item.key}
              item={item}
              label={t(item.key)}
              active={activeKey === item.key}
              rail
            />
          ))}
        </nav>
        <div className="space-y-space-xs border-t border-outline-variant p-space-sm">
          <button
            type="button"
            onClick={() => setDocsOpen(true)}
            aria-label={t('shell.documentation')}
            className="flex w-full items-center gap-space-sm rounded-lg px-space-sm py-2 font-label-md text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface focus-ring md:justify-center xl:justify-start"
          >
            <Icon name="help" className="text-[18px]" />
            <span className="md:hidden xl:inline">{t('shell.documentation')}</span>
          </button>
          <EngineBadge online={engineOnline} version={version} rail />
        </div>
      </aside>

      <Dialog
        open={docsOpen}
        onOpenChange={setDocsOpen}
        title={t('shell.documentation')}
        description={t('shell.docsIntro')}
      >
        <ul className="space-y-space-sm">
          {NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                onClick={() => setDocsOpen(false)}
                className="flex items-start gap-space-sm rounded-lg p-space-sm transition-colors hover:bg-surface-container focus-ring"
              >
                <Icon name={item.icon} className="text-[18px] text-primary" />
                <span>
                  <span className="block font-label-md font-bold text-on-surface">{t(item.key)}</span>
                  <span className="block font-body-sm text-on-surface-variant">{t(item.docKey)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
