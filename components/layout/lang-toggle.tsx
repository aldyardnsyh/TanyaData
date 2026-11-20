'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Lang } from '@/lib/contracts/http';
import { useI18n } from '@/lib/ui/i18n-provider';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** DECISION-013 point 7: toggle bahasa tetap aktif (DECISION-011). Target 44px. */
export function LangToggle() {
  const { lang, setLang, t } = useI18n();

  const choose = (next: Lang) => {
    if (next === lang) return;
    setLang(next);
    void fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: next }),
    }).catch(() => {});
  };

  return (
    <div role="group" aria-label={t('shell.switchLanguage')} className="flex items-center rounded-control border border-border-hairline bg-surface p-0.5">
      {(['id', 'en'] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => choose(code)}
          aria-pressed={lang === code}
          className={cn(
            'flex min-h-11 min-w-11 items-center justify-center rounded-control px-2 font-body text-label-sm font-semibold uppercase transition-colors duration-[var(--motion-fast)] focus-ring',
            lang === code
              ? 'bg-primary text-on-primary'
              : 'text-ink-muted-strong hover:text-ink',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
