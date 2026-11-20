export default function AssistantLoading() {
  return (
    <div className="page-container py-s5" aria-busy="true">
      <div className="skeleton h-s6 w-1/3" />
      <div className="skeleton mt-s3 h-s3 w-1/2" />
      <div className="skeleton mt-s5 h-40 w-full" />
      <div className="mt-s4 space-y-s4">
        <div className="skeleton ml-auto h-48 w-2/3" />
        <div className="skeleton h-80 w-full" />
      </div>
    </div>
  );
}
