export default function ReportDetailLoading() {
  return (
    <div className="page-container py-s5" aria-busy="true">
      <div className="skeleton h-s6 w-1/2" />
      <div className="mx-auto mt-s5 flex w-full max-w-[1020px] flex-col gap-s5 rounded-surface border border-[var(--border-hairline)] bg-porcelain p-s5">
        <div className="skeleton h-s6 w-2/3" />
        <div className="skeleton h-24 w-full" />
        <div className="skeleton h-48 w-full" />
      </div>
    </div>
  );
}
