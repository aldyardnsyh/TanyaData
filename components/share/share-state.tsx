import Link from 'next/link';
import { ShareStateHeader } from './share-header';
import { Button } from '@/components/ui/button';

type StateProps = { onRetry?: () => void };

function StateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <ShareStateHeader />
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        {children}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/" className="inline-flex min-h-11 items-center rounded-control border border-border-control px-4 font-body text-label-md font-semibold text-ink transition-colors hover:border-primary focus-ring">
      Kembali ke TanyaData
    </Link>
  );
}

/** 404 branded: penyebab + satu aksi, tanpa angka atau identitas rekaan. */
export function ShareNotFound() {
  return (
    <StateShell>
      <h1 className="max-w-[36ch] font-display text-headline-lg text-ink">Tautan berbagi tidak ditemukan</h1>
      <p className="max-w-[52ch] font-body text-body-md text-ink-muted-strong">
        Periksa kembali alamat atau minta tautan baru.
      </p>
      <BackLink />
    </StateShell>
  );
}

/** Link kedaluwarsa / dicabut: dot terracotta + teks error-text. */
export function ShareExpired() {
  return (
    <StateShell>
      <span className="state-dot state-dot-error" aria-hidden="true" />
      <h1 className="max-w-[36ch] font-display text-headline-lg text-error-text">Tautan berbagi ini sudah tidak berlaku</h1>
      <p className="max-w-[52ch] font-body text-body-md text-ink-muted-strong">
        Minta tautan baru dari pembuatnya.
      </p>
      <BackLink />
    </StateShell>
  );
}

/** Gagal memuat (5xx / jaringan): banner + retry nyata. */
export function ShareLoadError({ onRetry }: StateProps) {
  return (
    <StateShell>
      <div role="alert" className="flex max-w-[52ch] flex-col items-center gap-3 rounded-card border border-signal-terracotta bg-surface p-5">
        <p className="font-body text-headline-sm text-error-text">Halaman gagal dimuat. Coba lagi.</p>
        {onRetry && <Button variant="secondary" onClick={onRetry}>Coba lagi</Button>}
      </div>
    </StateShell>
  );
}
