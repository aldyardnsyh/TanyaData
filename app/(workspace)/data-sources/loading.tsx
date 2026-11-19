import { Skeleton } from '@/components/ui/skeleton';

/** B-04: kerangka Sumber Data — header + strip 3 angka + dropzone + 5 baris. */
export default function DataSourcesLoading() {
  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-6 py-8" aria-hidden="true">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-8 w-16" />
          </div>
        ))}
      </div>

      <Skeleton className="h-36 w-full rounded-lg" />

      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
        <div className="border-b border-outline-variant p-4">
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="divide-y divide-outline-variant">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="h-4 w-4 shrink-0" />
              <Skeleton className="h-10 flex-1" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
