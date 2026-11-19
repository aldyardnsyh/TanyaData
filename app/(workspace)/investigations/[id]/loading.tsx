import { Skeleton } from '@/components/ui/skeleton';

/** B-04: kerangka detail Investigasi: kembali + judul + kesimpulan + 2 metrik + tabel + timeline + langkah. */
export default function InvestigationDetailLoading() {
  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-6 py-8" aria-hidden="true">
      <Skeleton className="h-4 w-44" />

      <div className="space-y-2">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-6 w-full" />
        <Skeleton className="mt-2 h-6 w-4/5" />
        <div className="mt-3 flex gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-32" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-2 h-8 w-24" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
        ))}
      </div>

      <div>
        <Skeleton className="mb-2 h-6 w-40" />
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>

      <div>
        <Skeleton className="mb-2 h-6 w-24" />
        <div className="space-y-2 border-l-2 border-outline-variant pl-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-3/4" />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
        <Skeleton className="h-6 w-40" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-5/6" />
          ))}
        </div>
      </div>
    </div>
  );
}
