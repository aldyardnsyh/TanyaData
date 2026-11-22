'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { IconAlertTriangle as AlertTriangle } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';

/** B-03: error boundary segmen workspace — pesan dari error, retry, dan jalan pulang. */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const retryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    console.error(error);
    retryRef.current?.focus();
  }, [error]);

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8" role="alert">
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Halaman gagal dimuat"
        description={error.message}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button ref={retryRef} variant="primary" onClick={() => reset()}>Coba lagi</Button>
            <Link href="/data-sources">
              <Button variant="ghost">Kembali ke Dokumen</Button>
            </Link>
          </div>
        }
      />
    </div>
  );
}
