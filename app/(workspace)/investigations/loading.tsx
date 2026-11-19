import { Skeleton } from '@/components/ui/skeleton';

/** B-04: kerangka Investigasi: header + 3 metrik + form analisis + 4 kartu tabel. */
export default function InvestigationsLoading() {
  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-6 py-8" aria-hidden="true">
      <div className="space-y-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-2 h-8 w-20" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
        <div className="border-b border-outline-variant p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-4 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-[1fr_200px_200px_auto]">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-outline-variant bg-surface-container-lowest">
          <div className="border-b border-outline-variant p-5">
            <Skeleton className="h-5 w-48" />
          </div>
          <div className="space-y-2 p-5">
            {Array.from({ length: 3 }).map((_, j) => (
              <Skeleton key={j} className="h-10 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
