import { Skeleton } from '@/components/ui/skeleton';

/** B-04: kerangka Laporan: header + bilah filter + daftar 5 baris. */
export default function ReportsLoading() {
  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-6 py-8" aria-hidden="true">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
        <div className="flex gap-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-20" />
        </div>
        <Skeleton className="h-8 w-48" />
      </div>

      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
        <div className="divide-y divide-outline-variant">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
