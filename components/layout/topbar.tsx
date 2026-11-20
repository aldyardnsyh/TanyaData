'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/icons';
import { useI18n } from '@/lib/ui/i18n-provider';
import type { DictionaryKey } from '@/lib/i18n/dictionary';
import { DatasetChip, type DatasetChoice } from './dataset-chip';
import { QuickSearch } from './quick-search';
import { LangToggle } from './lang-toggle';
import { NotificationMenu } from './notification-menu';
import { UserMenu } from './user-menu';

export interface TopbarProps {
  activeKey: DictionaryKey;
  datasetName: string;
  datasetChoices: DatasetChoice[];
  activeDatasetId: string;
  onSelectDataset: (id: string) => void;
  engineOnline: boolean;
  documents?: number;
  onOpenMenu: () => void;
}

export function Topbar({
  datasetName,
  datasetChoices,
  activeDatasetId,
  onSelectDataset,
  engineOnline,
  documents,
  onOpenMenu,
}: TopbarProps) {
  const { t } = useI18n();

  return (
    <header className="fixed left-0 right-0 top-0 z-sticky flex h-14 items-center justify-between gap-space-sm border-b border-border-structural bg-surface-container-lowest px-space-sm md:left-sidebar-rail md:px-space-md xl:left-sidebar">
      <div className="flex min-w-0 items-center gap-space-sm">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label={t('shell.openMenu')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container focus-ring md:hidden"
        >
          <Icon name="menu" className="text-[22px]" />
        </button>
        {/* Breadcrumb hanya tampil di xl. Di 1024 sidebar rail 72px + topbar
            membuat ruang breadcrumb terpotong mid-word ("PLATFORM" → "PL"),
            jadi disembunyikan sampai ada ruang penuh. */}
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-space-xs xl:flex">
          <span className="font-label-sm uppercase tracking-wider text-on-surface-variant">
            {t('shell.platform')}
          </span>
          <Icon name="chevron_right" className="text-[14px] text-on-surface-variant" />
          <span className="font-label-sm uppercase tracking-wider text-on-surface">
            {t('shell.telemetry')}
          </span>
        </nav>
        <DatasetChip
          name={datasetName}
          choices={datasetChoices}
          activeId={activeDatasetId}
          onSelect={onSelectDataset}
        />
      </div>

      <div className="flex shrink-0 items-center gap-space-xs">
        <QuickSearch />
        <Link
          href="/assistant"
          className="hidden items-center gap-space-xs rounded-lg bg-primary-container px-space-md py-2 font-label-md text-on-primary shadow-sm transition-all hover:bg-primary focus-ring sm:flex"
        >
          <Icon name="bolt" className="text-[16px] text-secondary-fixed" />
          <span>{t('shell.askTanyaData')}</span>
        </Link>
        <LangToggle />
        <NotificationMenu engineOnline={engineOnline} documents={documents} />
        <UserMenu />
      </div>
    </header>
  );
}
