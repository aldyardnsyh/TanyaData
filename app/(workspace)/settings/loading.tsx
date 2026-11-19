import { Skeleton } from '@/components/ui/skeleton';

/** B-04: kerangka Pengaturan: header + 5 kartu + bilah simpan. */
export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-[720px] space-y-6 px-6 py-8" aria-hidden="true">
      <div className="space-y-2">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-4 w-72" />
      </div>

      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-outline-variant bg-surface-container-lowest">
          <div className="border-b border-outline-variant p-5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-1 h-3 w-56" />
          </div>
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      ))}

      <div className="sticky bottom-4 flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-3 shadow-md">
        <div className="flex justify-end gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
    </div>
  );
}
