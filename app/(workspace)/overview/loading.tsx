export default function OverviewLoading() {
  return (
    <div className="page-container py-s5" aria-busy="true">
      <div className="skeleton h-s6 w-1/3" />
      <div className="skeleton mt-s3 h-s3 w-1/2" />
      <div className="skeleton mt-s5 h-s5 w-full" />
      <div className="bento mt-s4">
        <div data-cell data-span="hero" className="surface p-s3"><div className="skeleton h-s2 w-2/3" /><div className="skeleton mt-s4 h-s5 w-1/2" /></div>
        {[0, 1, 2, 3].map((i) => <div key={i} data-cell data-span="support" className="surface p-s3"><div className="skeleton h-s2 w-2/3" /><div className="skeleton mt-s4 h-s5 w-1/2" /></div>)}
      </div>
    </div>
  );
}
