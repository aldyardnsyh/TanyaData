import { Skeleton } from '@/components/ui/skeleton';

/** B-04: kerangka Asisten — panel sesi 3 baris + thread 2 bubble + composer. */
export default function AssistantLoading() {
  return (
    <div className="flex h-[calc(100vh-3.5rem)]" aria-hidden="true">
      <aside className="hidden w-66 shrink-0 border-r border-outline-variant bg-surface-container-lowest p-3 lg:block">
        <Skeleton className="mb-3 h-7 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-lowest px-4 py-2.5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex-1 px-4 py-4">
          <div className="mx-auto max-w-[820px] space-y-5">
            <div className="flex justify-end">
              <Skeleton className="h-10 w-2/3" />
            </div>
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
        <div className="border-t border-outline-variant bg-surface-container-lowest px-4 py-3">
          <div className="mx-auto max-w-[820px]">
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
      </section>
    </div>
  );
}
