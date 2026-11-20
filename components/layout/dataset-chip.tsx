'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icons';
import { Drawer } from '@/components/ui/drawer';
import { MonoMeta } from '@/components/ui/mono-meta';
import { useI18n } from '@/lib/ui/i18n-provider';
import { formatNumber } from '@/lib/ui/format';

export type DatasetChoice = { id: string; name: string; rowCount?: number };

export interface DatasetChipProps {
  name: string;
  choices: DatasetChoice[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * §4: ≥1024 nama + row count; 768 nama saja; 390 row count saja + detail sheet.
 * Tanpa text-overflow ellipsis pada nama file (L-08).
 */
export function DatasetChip({ name, choices, activeId, onSelect }: DatasetChipProps) {
  const { t } = useI18n();
  const [detailOpen, setDetailOpen] = useState(false);
  const active = choices.find((c) => c.id === activeId);
  const rows = active?.rowCount;
  const rowsLabel = rows != null ? `${formatNumber(rows)} ROWS` : '— ROWS';

  return (
    <>
      <button
        type="button"
        onClick={() => setDetailOpen(true)}
        aria-label={t('label.activeDataset')}
        className="flex min-h-11 max-w-[240px] items-center gap-2 rounded-control border border-border-hairline bg-surface px-3 text-ink transition-colors duration-[var(--motion-fast)] hover:border-primary focus-ring"
      >
        <Icon name="database" className="shrink-0 text-[16px] text-primary" aria-hidden="true" />
        <span className="hidden min-w-0 font-body text-body-md md:inline">{name}</span>
        <MonoMeta className="inline md:hidden lg:inline">{rowsLabel}</MonoMeta>
        <Icon name="expand_more" className="shrink-0 text-[16px] text-ink-muted-strong" aria-hidden="true" />
      </button>

      <Drawer open={detailOpen} onOpenChange={setDetailOpen} side="right" width="320px" title={t('label.activeDataset')}>
        <div className="space-y-4">
          <div>
            <p className="font-body text-body-sm text-ink-muted-strong">Nama dataset</p>
            <p className="break-words font-body text-body-md text-ink">{name}</p>
          </div>
          <div>
            <p className="font-body text-body-sm text-ink-muted-strong">Jumlah baris</p>
            <MonoMeta>{rowsLabel}</MonoMeta>
          </div>
          <div className="border-t border-border-hairline pt-4">
            <p className="mono-meta mb-2">Pilih dataset</p>
            {choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() => { onSelect(choice.id); setDetailOpen(false); }}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-control px-2 text-left font-body text-body-md text-ink transition-colors hover:bg-row-hover focus-ring"
              >
                <span className="min-w-0 truncate">{choice.name}</span>
                {choice.id === activeId && <Icon name="check" className="text-[16px] text-primary" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <Link href="/settings" onClick={() => setDetailOpen(false)} className="flex min-h-11 items-center gap-2 font-body text-label-md font-semibold text-primary focus-ring">
            <Icon name="settings" className="text-[16px]" aria-hidden="true" />
            {t('shell.viewSettings')}
          </Link>
        </div>
      </Drawer>
    </>
  );
}
