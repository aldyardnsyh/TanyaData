import { Skeleton } from '@/components/ui/skeleton';

/** B-04: kerangka Overview — header + 5 KPI + 2 panel chart 280px + baris kanal/insight + kategori. */
export default function OverviewLoading() {
  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8" aria-hidden="true">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-56" />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-8 w-20" />
            <Skeleton className="mt-1 h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-outline-variant bg-surface-container-lowest">
            <div className="border-b border-outline-variant px-5 py-4">
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="p-5">
              <Skeleton className="h-[200px] w-full" />
            </div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
            <Skeleton className="mb-4 h-5 w-40" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
        <Skeleton className="mb-4 h-5 w-40" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    </div>
  );
}
