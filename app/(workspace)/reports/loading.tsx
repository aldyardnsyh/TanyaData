export default function ReportsLoading() {
  return (
    <div className="page-container py-s5" aria-busy="true">
      <div className="skeleton h-s6 w-1/3" />
      <div className="grid-dashboard mt-s5">
        <div className="surface col-span-4 p-s3"><div className="skeleton h-s5 w-full" /><div className="skeleton mt-s3 h-s5 w-full" /></div>
        <div className="col-span-4 xl:col-span-8"><div className="skeleton h-96 w-full" /></div>
      </div>
    </div>
  );
}
