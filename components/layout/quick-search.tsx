'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icons';
import { useI18n } from '@/lib/ui/i18n-provider';
import { NAV_ITEMS } from './nav-config';

export function QuickSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const items = NAV_ITEMS.filter((item) =>
    t(item.key).toLowerCase().includes(query.trim().toLowerCase()),
  );

  const go = (href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('shell.quickSearch')}
        className="flex h-9 items-center gap-space-sm rounded-lg bg-surface-container-low px-space-sm text-on-surface-variant transition-colors hover:bg-surface-container focus-ring"
      >
        <Icon name="search" className="text-[18px]" />
        <span className="hidden w-28 text-left font-label-md lg:inline">{t('shell.searchPlaceholder')}</span>
        <kbd className="hidden rounded bg-surface-container px-1.5 py-0.5 font-label-sm font-mono lg:inline">⌘K</kbd>
      </button>

      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-inverse-surface/32" />
          <DialogPrimitive.Content
            aria-label={t('shell.commandPalette')}
            className="fixed left-1/2 top-[12%] z-modal w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md shadow-xl focus:outline-none"
          >
            <DialogPrimitive.Title className="sr-only">{t('shell.commandPalette')}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">{t('shell.searchPlaceholder')}</DialogPrimitive.Description>
            <div className="flex items-center gap-space-sm rounded-lg bg-surface-container-low px-space-sm">
              <Icon name="search" className="text-[18px] text-on-surface-variant" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('shell.searchPlaceholder')}
                className="h-11 w-full bg-transparent font-body-md text-on-surface outline-none placeholder:text-on-surface-variant"
              />
            </div>
            <ul className="mt-space-sm max-h-72 overflow-y-auto">
              {items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => go(item.href)}
                    className="flex w-full items-center gap-space-sm rounded-lg px-space-sm py-2 text-left font-label-md text-on-surface transition-colors hover:bg-surface-container focus-ring"
                  >
                    <Icon name={item.icon} className="text-[18px] text-primary" />
                    <span className="flex-1">{t(item.key)}</span>
                    <span className="font-label-sm text-on-surface-variant">{t('shell.goTo')}</span>
                  </button>
                </li>
              ))}
              {items.length === 0 && (
                <li className="px-space-sm py-4 text-center font-body-sm text-on-surface-variant">
                  {t('empty.noData')}
                </li>
              )}
            </ul>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
