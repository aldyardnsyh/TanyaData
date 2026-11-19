'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Lang } from '@/lib/contracts/http';
import type { SettingsResponse } from '@/lib/contracts/http';
import {
  dictionaries,
  t,
  type DictionaryKey,
} from '@/lib/i18n/dictionary';

type I18nContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: DictionaryKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLang(): Lang {
  if (typeof window === 'undefined') return 'id';
  try {
    const stored = window.localStorage.getItem('tanyadata.lang');
    return stored === 'en' ? 'en' : 'id';
  } catch {
    return 'id';
  }
}

export function I18nProvider({
  children,
  defaultLang = 'id',
}: {
  children: React.ReactNode;
  defaultLang?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(defaultLang);

  // Hydration-safe: sinkronisasi preferensi lokal + server sekali saat mount.
  useEffect(() => {
    const stored = readStoredLang();
    if (stored !== defaultLang) setLangState(stored);
    let cancelled = false;
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: SettingsResponse | null) => {
        if (cancelled || !s) return;
        const serverLang: Lang = s.lang === 'en' ? 'en' : 'id';
        setLangState(serverLang);
        try {
          window.localStorage.setItem('tanyadata.lang', serverLang);
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem('tanyadata.lang', l);
    } catch {
      /* ignore */
    }
  };

  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: (key: DictionaryKey, vars?: Record<string, string | number>) =>
        t(lang, key, vars),
    }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

export { dictionaries };
