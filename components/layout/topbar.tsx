'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/icons';
import { useI18n } from '@/lib/ui/i18n-provider';
import type { DictionaryKey } from '@/lib/i18n/dictionary';
import { DatasetChip, type DatasetChoice } from './dataset-chip';
import { QuickSearch } from './quick-search';
import { LangToggle } from './lang-toggle';
import { NAV_ITEMS } from './nav-config';

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

/** L-06: breadcrumb mengikuti rute aktif. U-03: satu CTA primer per layar. */
export function Topbar({
  activeKey,
  datasetName,
  datasetChoices,
  activeDatasetId,
  onSelectDataset,
  engineOnline: _engineOnline,
  documents: _documents,
  onOpenMenu,
}: TopbarProps) {
  const { t } = useI18n();
  const currentLabel = t(activeKey);
  const activeIcon = NAV_ITEMS.find((item) => item.key === activeKey)?.icon ?? 'dashboard';

  return (
    <header className="fixed left-0 right-0 top-0 z-sticky flex h-14 items-center justify-between gap-3 border-b border-border-hairline bg-surface px-3 md:left-sidebar-rail md:px-4 xl:left-sidebar">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label={t('shell.openMenu')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-muted-strong transition-colors hover:bg-row-hover focus-ring md:hidden"
        >
          <Icon name="menu" className="text-[22px]" />
        </button>

        {/* < md: breadcrumb disembunyikan, diganti ikon halaman aktif (tanpa truncate). */}
        <span role="img" aria-label={currentLabel} className="flex h-11 w-11 shrink-0 items-center justify-center md:hidden">
          <Icon name={activeIcon} className="text-[20px] text-ink" aria-hidden="true" />
        </span>
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 md:flex">
          <span className="hidden font-body text-body-sm text-ink-muted-strong xl:inline">{t('shell.platform')}</span>
          <Icon name="chevron_right" className="hidden text-[14px] text-ink-muted-strong xl:inline" aria-hidden="true" />
          <Link
            href="/overview"
            aria-label="Kembali ke Ringkasan"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-muted-strong transition-colors hover:bg-row-hover focus-ring lg:flex xl:hidden"
          >
            <Icon name="arrow_back" className="text-[20px]" />
          </Link>
          <span className="truncate font-body text-label-md font-semibold text-ink">{currentLabel}</span>
        </nav>

        <DatasetChip
          name={datasetName}
          choices={datasetChoices}
          activeId={activeDatasetId}
          onSelect={onSelectDataset}
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <QuickSearch />
        <Link
          href="/assistant"
          aria-label={t('shell.askTanyaData')}
          className="flex h-11 w-11 items-center justify-center rounded-control bg-primary text-on-primary transition-colors duration-[var(--motion-fast)] hover:bg-[#0A3A2C] focus-ring-forest"
        >
          <Icon name="forum" className="text-[20px]" />
        </Link>
        <LangToggle />
      </div>
    </header>
  );
}
