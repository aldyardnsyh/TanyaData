'use client';

import { useCallback, useEffect, useState } from 'react';
import { normalizeShareSnapshot, type ShareSnapshotView } from '@/lib/ui/share-contract';
import { ShareSection } from './share-section';
import { ShareHeader } from './share-header';
import { ShareSummary } from './share-summary';
import { ShareTranscript } from './share-transcript';
import { ShareResults } from './share-results';
import { CitationDrawer, CitationPanels } from './share-citations';
import { ShareFooter } from './share-footer';
import { ShareSkeleton } from './share-skeleton';
import { ShareExpired, ShareLoadError, ShareNotFound } from './share-state';

type LoadState = 'loading' | 'ready' | 'notfound' | 'expired' | 'error';

/**
 * Halaman /share/[id]. Fetch snapshot statis dari GET /api/share/[id].
 * Read-only: tidak ada composer, filter, sidebar, atau mutasi (S-1…S-5).
 */
export function ShareView({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>('loading');
  const [snapshot, setSnapshot] = useState<ShareSnapshotView | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState('loading');

    fetch(`/api/share/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return { kind: 'notfound' as const };
        if (response.status === 410) return { kind: 'expired' as const };
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const code = body?.error?.code;
          if (code === 'EXPIRED' || code === 'REVOKED') return { kind: 'expired' as const };
          return { kind: 'error' as const };
        }
        const json = await response.json();
        return { kind: 'ready' as const, data: normalizeShareSnapshot(json) };
      })
      .then((result) => {
        if (cancelled) return;
        if (result.kind === 'ready') {
          setSnapshot(result.data);
          setState('ready');
        } else {
          setState(result.kind);
        }
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setState('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  if (state === 'loading') return <ShareSkeleton />;
  if (state === 'notfound') return <ShareNotFound />;
  if (state === 'expired') return <ShareExpired />;
  if (state === 'error' || !snapshot) return <ShareLoadError onRetry={retry} />;

  const showCitations = snapshot.includeCitations && snapshot.citations.length > 0;

  return (
    <main className="animate-share-enter mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 gap-8 min-[1440px]:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-8 min-[1440px]:col-span-8">
          <ShareSection label="SESI · SHARED VIEW">
            <ShareHeader title={snapshot.title} createdAt={snapshot.createdAt} identity={snapshot.identity} />
          </ShareSection>

          {snapshot.summary && (
            <ShareSection label="RINGKASAN EKSEKUTIF">
              <ShareSummary text={snapshot.summary} />
            </ShareSection>
          )}

          <ShareSection label="PERTANYAAN & JAWABAN">
            <ShareTranscript
              messages={snapshot.messages}
              citations={snapshot.citations}
              includeCitations={snapshot.includeCitations}
            />
          </ShareSection>

          <ShareSection label="HASIL VISUAL">
            <ShareResults
              messages={snapshot.messages}
              citations={snapshot.citations}
              includeCitations={snapshot.includeCitations}
            />
          </ShareSection>
        </div>

        {showCitations && (
          <div className="min-w-0 min-[1440px]:col-span-4 min-[1440px]:sticky min-[1440px]:top-8 min-[1440px]:self-start">
            <ShareSection label="SITASI">
              <div className="hidden lg:block">
                <CitationPanels citations={snapshot.citations} />
              </div>
              <CitationDrawer citations={snapshot.citations} open={drawerOpen} onOpenChange={setDrawerOpen} />
            </ShareSection>
          </div>
        )}
      </div>

      <ShareFooter createdAt={snapshot.createdAt} />
    </main>
  );
}
