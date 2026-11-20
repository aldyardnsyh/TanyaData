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

export function WorkspaceSwitcher({ name, rail = false }: { name: string; rail?: boolean }) {
  const { t } = useI18n();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t('shell.workspace')}
          className={cn(
            'flex h-14 w-full items-center gap-space-sm border-b border-outline-variant px-space-sm text-left transition-colors hover:bg-surface-container focus-ring',
            rail && 'justify-center px-0 xl:justify-start xl:px-space-sm',
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary font-display text-label-md font-bold text-on-primary">
            TD
          </span>
          <span className={cn('min-w-0 flex-1', rail && 'md:hidden xl:block')}>
            <span className="block truncate font-label-md font-bold text-on-surface">{name}</span>
            <span className="block truncate font-label-sm text-on-surface-variant">{t('shell.workspace')}</span>
          </span>
          <Icon name="expand_more" className="text-[16px] text-on-surface-variant" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-dropdown min-w-56 rounded-lg border border-outline-variant bg-surface-container-lowest p-space-xs shadow-lg"
        >
          <div className="px-space-sm py-space-xs font-label-sm text-on-surface-variant">{name}</div>
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
