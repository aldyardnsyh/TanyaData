export default function InvestigationDetailLoading() {
  return (
    <div className="page-container py-s5" aria-busy="true">
      <div className="skeleton h-s6 w-1/2" />
      <div className="bento mt-s5">{[0, 1, 2].map((i) => <div key={i} data-cell data-span="support" className="surface p-s3"><div className="skeleton h-s2 w-2/3" /><div className="skeleton mt-s3 h-s5 w-1/2" /></div>)}</div>
      <div className="skeleton mt-s5 h-80 w-full" />
    </div>
  );
}
