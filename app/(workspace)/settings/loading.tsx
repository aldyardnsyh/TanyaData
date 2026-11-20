import { Skeleton } from '@/components/ui/skeleton';

/** Kerangka Pengaturan: header + bento + tab + panel + bilah simpan. Token baru, tanpa alias lama. */
export default function SettingsLoading() {
  return (
    <div className="page-container py-s5" aria-hidden="true" aria-busy="true">
      <div className="mb-s3 flex flex-col gap-s2">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="mb-s4 grid grid-cols-1 gap-s3 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="surface flex h-37 flex-col justify-between p-s3">
            <Skeleton className="h-s2 w-2/3" />
            <Skeleton className="h-s4 w-1/2" />
          </div>
        ))}
      </div>
      <div className="mb-s4 flex gap-s2">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-s5 w-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-s4 md:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="surface flex flex-col gap-s2 p-s4">
            <Skeleton className="h-s2 w-1/2" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
