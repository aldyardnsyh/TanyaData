'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { Icon } from '@/components/ui/icons';
import { useI18n } from '@/lib/ui/i18n-provider';

export interface UserMenuProps {
  name: string;
  role: string;
}

export function UserMenu({ name, role }: UserMenuProps) {
  const { t } = useI18n();
  const initials =
    name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'TD';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t('shell.profile')}
          className="flex items-center gap-space-sm rounded-lg p-1 transition-colors hover:bg-surface-container focus-ring"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container font-label-sm font-bold text-on-primary">
            {initials}
          </span>
          <span className="hidden text-left lg:block">
            <span className="block max-w-[120px] truncate font-label-md font-semibold text-on-surface">{name}</span>
            <span className="block max-w-[120px] truncate font-label-sm text-on-surface-variant">{role}</span>
          </span>
          <Icon name="expand_more" className="hidden text-[16px] text-on-surface-variant lg:inline-block" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-dropdown w-56 rounded-lg border border-outline-variant bg-surface-container-lowest p-space-xs shadow-lg"
        >
          <div className="px-space-sm py-space-xs">
            <p className="truncate font-label-md font-bold text-on-surface">{name}</p>
            <p className="truncate font-label-sm text-on-surface-variant">{role}</p>
          </div>
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
