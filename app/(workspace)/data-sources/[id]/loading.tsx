import { Skeleton } from '@/components/ui/skeleton';

/** B-04: kerangka Detail Sumber — breadcrumb + header + meta strip + tabel 5 baris. */
export default function DataSourceDetailLoading() {
  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-6 py-8" aria-hidden="true">
      <Skeleton className="h-5 w-48" />

      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-12" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
        <Skeleton className="mb-3 h-5 w-32" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
