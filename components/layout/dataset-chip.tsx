'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon } from '@/components/ui/icons';
import { useI18n } from '@/lib/ui/i18n-provider';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type DatasetChoice = { id: string; name: string; rowCount?: number };

export interface DatasetChipProps {
  name: string;
  choices: DatasetChoice[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function DatasetChip({ name, choices, activeId, onSelect }: DatasetChipProps) {
  const { t } = useI18n();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t('label.activeDataset')}
          className="flex h-9 max-w-[190px] items-center gap-space-xs rounded-lg bg-surface-container-low px-space-sm text-on-surface transition-colors hover:bg-surface-container focus-ring"
        >
          <Icon name="dataset" className="text-[16px] text-primary" />
          <span className="truncate font-label-md font-semibold">{name}</span>
          <Icon name="expand_more" className="text-[16px] text-on-surface-variant" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-dropdown min-w-64 rounded-lg border border-outline-variant bg-surface-container-lowest p-space-xs shadow-lg"
        >
          <div className="px-space-sm py-space-xs font-label-sm uppercase tracking-wider text-on-surface-variant">
            {t('label.activeDataset')}
          </div>
          {choices.map((choice) => (
            <DropdownMenu.Item
              key={choice.id}
              onSelect={() => onSelect(choice.id)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-space-sm rounded-md px-space-sm py-2 font-label-md text-on-surface outline-none data-[highlighted]:bg-surface-container',
                choice.id === activeId && 'font-bold text-primary',
              )}
            >
              <span className="truncate">{choice.name}</span>
              {choice.id === activeId && <Icon name="check" className="text-[16px]" />}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-space-xs h-px bg-outline-variant" />
          <DropdownMenu.Item asChild>
            <Link
              href="/settings"
              className="flex cursor-pointer items-center gap-space-sm rounded-md px-space-sm py-2 font-label-md text-on-surface outline-none data-[highlighted]:bg-surface-container"
            >
              <Icon name="settings" className="text-[16px]" />
              {t('shell.viewSettings')}
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
