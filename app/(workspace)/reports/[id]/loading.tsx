import { Skeleton } from '@/components/ui/skeleton';

/** B-04: kerangka detail Laporan: kembali + toolbar + artikel dokumen (judul, meta, metrik, tabel). */
export default function ReportDetailLoading() {
  return (
    <div className="px-6 py-8" aria-hidden="true">
      <div className="mx-auto mb-4 max-w-[760px]">
        <Skeleton className="h-4 w-36" />
      </div>

      <div className="sticky top-14 z-sticky mx-auto mb-6 flex max-w-[760px] flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
        <Skeleton className="h-4 w-56" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>

      <article className="mx-auto max-w-[760px] rounded-xl border border-outline-variant bg-surface-container-lowest p-10">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-2 h-8 w-3/4" />
        <div className="mt-3 flex flex-wrap gap-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-3 w-28" />
        </div>

        <div className="mt-8">
          <Skeleton className="h-6 w-40" />
          <div className="mt-2 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>

        <div className="mt-8">
          <Skeleton className="h-6 w-44" />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg bg-surface-container-low p-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-2 h-7 w-16" />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <Skeleton className="h-6 w-44" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>

        <div className="mt-8">
          <Skeleton className="h-6 w-32" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-5/6" />
            ))}
          </div>
        </div>
      </article>
    </div>
  );
}
