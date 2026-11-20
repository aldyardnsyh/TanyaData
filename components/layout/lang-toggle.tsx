'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Lang } from '@/lib/contracts/http';
import { useI18n } from '@/lib/ui/i18n-provider';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function LangToggle() {
  const { lang, setLang, t } = useI18n();

  const choose = (next: Lang) => {
    if (next === lang) return;
    setLang(next);
    void fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: next }),
    }).catch(() => {
      /* label UI tetap berubah walau penyimpanan server gagal */
    });
  };

  return (
    <div
      role="group"
      aria-label={t('shell.switchLanguage')}
      className="flex items-center rounded-lg bg-surface-container-low p-0.5"
    >
      {(['id', 'en'] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => choose(code)}
          aria-pressed={lang === code}
          className={cn(
            'min-w-9 rounded-md px-2 py-1 font-label-sm font-bold uppercase transition-colors focus-ring',
            lang === code
              ? 'bg-primary-container text-on-primary'
              : 'text-on-surface-variant hover:text-on-surface',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
