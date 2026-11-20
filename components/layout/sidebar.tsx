'use client';

import { Icon } from '@/components/ui/icons';
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

/** U-05: tanpa dialog Documentation yang mengulang nav. Rail 72px, penuh 232px. */
export function Sidebar({ activeKey, appName, version, engineOnline }: SidebarProps) {
  const { t } = useI18n();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-sticky hidden w-sidebar-rail flex-col border-r border-border-hairline bg-surface md:flex xl:w-sidebar"
      aria-label="Sidebar"
    >
      <WorkspaceSwitcher name={appName} rail />
      <nav className="flex-1 space-y-1 p-2" aria-label="Primary">
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
      <div className="border-t border-border-hairline p-2">
        <EngineBadge online={engineOnline} version={version} rail />
      </div>
    </aside>
  );
}
