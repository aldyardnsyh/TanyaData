import { Skeleton } from '@/components/ui/skeleton';

/** Loading: skeleton, bukan spinner. Tanpa angka di skeleton (SHARE_PAGE_SPEC §7). */
export function ShareSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-3">
        <div className="flex gap-3"><Skeleton className="h-11 w-28" /><Skeleton className="h-11 w-40" /></div>
        <Skeleton className="h-10 w-2/3 max-w-[520px]" />
        <Skeleton className="h-6 w-1/2 max-w-[360px]" />
      </div>
      <div className="h-px w-full bg-border-hairline" />
      <Skeleton className="h-24 w-full rounded-card" />
      <div className="h-px w-full bg-border-hairline" />
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col gap-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-20 w-full rounded-card" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
      <div className="h-px w-full bg-border-hairline" />
      <Skeleton className="h-56 w-full rounded-card" />
    </div>
  );
}
