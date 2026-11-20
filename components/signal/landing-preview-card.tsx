/**
 * Pratinjau alur jawaban di hero: pertanyaan dan SQL nyata dari uji produksi
 * (SQL-01 di docs/ROBUSTNESS_REAL_DOCS.md), angka dari hasil query (46.952 dan
 * success rate 94,39% dari SQL-01/SQL-03). Semua string nyata dari berkas uji,
 * bukan rekaan (R-17). Statis dan bukan kontrol: tujuannya menunjukkan mekanisme
 * "SQL tampil, angka dari hasil query" sebelum pembaca diminta mencoba.
 */
export function LandingPreviewCard() {
  return (
    <div className="rounded-card-lg border border-hairline-dark bg-porcelain p-s4 text-left shadow-float sm:p-s5">
      <div className="flex items-center justify-between gap-s2">
        <span className="mono-meta">SQL · TRANSACTIONS.CSV</span>
        <span className="inline-flex items-center gap-s1">
          <span className="state-dot state-dot-active" aria-hidden="true" />
          <span className="font-body text-caption text-ink-72">Selesai</span>
        </span>
      </div>
      <p className="mt-s3 font-display text-label font-semibold text-ink">Berapa total transaksi?</p>
      <pre className="mt-s2 overflow-x-auto rounded-control bg-forest-08 px-s2 py-s2 font-mono text-caption leading-relaxed text-ink">
        <code>{`SELECT COUNT(*) AS value
FROM core_data_… LIMIT 500`}</code>
      </pre>
      <div className="mt-s3 flex flex-wrap items-end gap-x-s5 gap-y-s2">
        <div>
          <p className="font-body text-label text-ink-72">Total transaksi</p>
          <p className="font-body text-metric tabular text-ink">46.952</p>
        </div>
        <div>
          <p className="font-body text-label text-ink-72">Success rate</p>
          <p className="font-body text-metric tabular text-ink">94,39%</p>
        </div>
        <span className="inline-flex min-h-11 items-center rounded-chip border border-[var(--border-hairline)] px-s3">
          <span className="mono-meta">SITASI · TRANSACTIONS.CSV</span>
        </span>
      </div>
      <p className="mt-s3 border-t border-[var(--border-hairline)] pt-s2 font-body text-caption text-ink-72">
        Angka dari eksekusi SQL pada data contoh. Durasi dan jumlah baris tercatat.
      </p>
    </div>
  );
}
