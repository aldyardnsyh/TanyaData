'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
};

/**
 * Fetch hook dengan loading / error / retry.
 * Error message dibaca dari body API `{ error: { message } }` bila ada.
 */
export function useApi<T>(url: string, options?: RequestInit): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const fetchFn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, optionsRef.current);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
    } finally {
      setLoading(false);
    }
  }, [url, retryCount]);

  useEffect(() => {
    fetchFn();
  }, [fetchFn]);

  const retry = useCallback(() => setRetryCount((c) => c + 1), []);

  return { data, loading, error, retry };
}
