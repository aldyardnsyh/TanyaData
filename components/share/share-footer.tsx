import Link from 'next/link';
import { MonoMeta } from '@/components/ui/mono-meta';
import { formatShareTimestamp } from '@/lib/ui/share-contract';

/** Section 6 footer: satu baris, satu tautan keluar, tanpa kolom template (SHARE_PAGE_SPEC §2.6). */
export function ShareFooter({ createdAt }: { createdAt: string }) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-hairline pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-body text-body-sm text-ink-muted-strong">dibagikan dari TanyaData</span>
        <Link href="/" className="inline-flex min-h-11 items-center font-body text-body-sm font-semibold text-primary underline-offset-2 hover:underline focus-ring">
          Buka TanyaData
        </Link>
      </div>
      <MonoMeta>{formatShareTimestamp(createdAt)}</MonoMeta>
    </footer>
  );
}
