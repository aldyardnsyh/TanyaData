'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { useApi } from '@/lib/ui/fetch-hooks';
import { useI18n } from '@/lib/ui/i18n-provider';
import type { MetaResponse, SettingsResponse } from '@/lib/contracts/http';
import { NAV_ITEMS, currentNavKey } from './nav-config';
import { NavItemLink } from './nav-item';
import { EngineBadge } from './engine-badge';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const meta = useApi<MetaResponse>('/api/meta');
  const settings = useApi<SettingsResponse>('/api/settings');
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeKey = currentNavKey(pathname);
  const appName = meta.data?.app.name ?? 'TanyaData';
  const version = meta.data?.app.version;
  const engineOnline = !!meta.data && !meta.error;
  const datasetName =
    meta.data?.data.activeDataset.name ??
    settings.data?.datasets.find((d) => d.id === settings.data?.activeDatasetId)?.name ??
    'n/a';
  const datasetChoices = meta.data?.data.datasetChoices ?? settings.data?.datasets ?? [];
  const activeDatasetId =
    settings.data?.activeDatasetId ?? meta.data?.data.activeDataset.id ?? 'seed';

  const selectDataset = (id: string) => {
    void fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeDatasetId: id }),
    })
      .then(() => {
        settings.retry();
        meta.retry();
      })
      .catch(() => {
        /* state lokal tetap; pengguna dapat mencoba lagi */
      });
  };

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-toast focus:rounded-lg focus:bg-primary focus:px-space-md focus:py-space-xs focus:text-label-md focus:text-on-primary"
      >
        {t('shell.skipToContent')}
      </a>

      <Sidebar activeKey={activeKey} appName={appName} version={version} engineOnline={engineOnline} />

      <Topbar
        activeKey={activeKey}
        datasetName={datasetName}
        datasetChoices={datasetChoices}
        activeDatasetId={activeDatasetId}
        onSelectDataset={selectDataset}
        engineOnline={engineOnline}
        documents={meta.data?.data.documents.total}
        onOpenMenu={() => setMobileOpen(true)}
      />

      <main id="konten-utama" className="min-h-screen pt-14 md:pl-sidebar-rail xl:pl-sidebar">
        {children}
      </main>

      <Drawer
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        side="left"
        width="280px"
        title={appName}
      >
        <nav className="flex-1 space-y-space-xs" aria-label="Primary mobile">
          {NAV_ITEMS.map((item) => (
            <NavItemLink
              key={item.key}
              item={item}
              label={t(item.key)}
              active={activeKey === item.key}
              rail={false}
              onNavigate={() => setMobileOpen(false)}
            />
          ))}
        </nav>
        <div className="mt-space-md border-t border-outline-variant pt-space-sm">
          <EngineBadge online={engineOnline} version={version} />
        </div>
      </Drawer>
    </div>
  );
}
