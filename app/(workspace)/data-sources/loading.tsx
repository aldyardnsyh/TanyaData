export default function DataSourcesLoading() {
  return (
    <div className="page-container py-s5" aria-busy="true">
      <div className="skeleton h-s6 w-1/3" />
      <div className="skeleton mt-s5 h-40 w-full" />
      <div className="skeleton mt-s4 h-37 w-full" />
      <div className="mt-s5 grid-dashboard">
        {[0, 1, 2, 3].map((i) => <div key={i} className="surface col-span-4 p-s3"><div className="skeleton h-s2 w-2/3" /><div className="skeleton mt-s3 h-s5 w-full" /></div>)}
      </div>
    </div>
  );
}
