'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Icon } from '@/components/ui/icons';
import { useI18n } from '@/lib/ui/i18n-provider';

export interface NotificationMenuProps {
  engineOnline: boolean;
  documents?: number;
}

export function NotificationMenu({ engineOnline, documents }: NotificationMenuProps) {
  const { t } = useI18n();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t('shell.notifications')}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container focus-ring"
        >
          <Icon name="notifications" className="text-[20px]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-dropdown w-72 rounded-lg border border-outline-variant bg-surface-container-lowest p-space-sm shadow-lg"
        >
          <p className="font-label-md font-bold text-on-surface">{t('shell.notifications')}</p>
          <p className="mt-space-xs font-body-sm text-on-surface-variant">{t('shell.noNotifications')}</p>
          <div className="mt-space-sm space-y-space-xs border-t border-border-structural pt-space-sm">
            <div className="flex items-center justify-between font-label-sm text-on-surface-variant">
              <span>{t('shell.engineOnline')}</span>
              <span className={engineOnline ? 'text-primary' : 'text-error'}>
                {engineOnline ? 'OK' : '—'}
              </span>
            </div>
            {typeof documents === 'number' && (
              <div className="flex items-center justify-between font-label-sm text-on-surface-variant">
                <span>Documents</span>
                <span className="tabular">{documents}</span>
              </div>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
