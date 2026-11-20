/**
 * Sampel bukti untuk S5 (kolom kanan timeline): satu contoh jawaban angka yang
 * cocok dan satu contoh penolakan guardrail. Semua string nyata dari berkas uji
 * (docs/ROBUSTNESS_REAL_DOCS.md): SQL-03 (success rate 94,39% dari eksekusi SQL)
 * dan GR-02 (pertanyaan "Siapa CEO perusahaan ini?" ditolak not_in_sources).
 * Statis, bukan kontrol: tujuannya menunjukkan dua sisi jejak audit.
 */
export function LandingEvidenceSamples() {
  return (
    <div className="flex flex-col gap-s3">
      <div className="rounded-card-lg border border-[var(--border-hairline)] bg-porcelain p-s4 shadow-lift">
        <div className="flex items-center justify-between gap-s2">
          <span className="mono-meta">SQL · SUCCESS RATE</span>
          <span className="inline-flex items-center gap-s1">
            <span className="state-dot state-dot-active" aria-hidden="true" />
            <span className="font-body text-caption text-ink-72">Cocok</span>
          </span>
        </div>
        <pre className="mt-s2 overflow-x-auto rounded-control bg-forest-08 px-s2 py-s2 font-mono text-caption leading-relaxed text-ink">
          <code>{`SELECT ROUND(SUM(CASE WHEN status = ? THEN 1
ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2)
AS value FROM core_…`}</code>
        </pre>
        <div className="mt-s3 flex flex-wrap items-end gap-x-s5 gap-y-s2">
          <div>
            <p className="font-body text-label text-ink-72">Success rate</p>
            <p className="font-body text-metric tabular text-ink">94,39%</p>
          </div>
          <span className="inline-flex min-h-11 items-center rounded-chip border border-[var(--border-hairline)] px-s3">
            <span className="mono-meta">SITASI · TRANSACTIONS.CSV</span>
          </span>
        </div>
        <p className="mt-s3 border-t border-[var(--border-hairline)] pt-s2 font-body text-caption text-ink-72">
          Durasi dan jumlah baris tercatat pada setiap query angka.
        </p>
      </div>
      <div className="rounded-card-lg border border-[var(--border-hairline)] bg-porcelain p-s4 shadow-lift">
        <div className="flex items-center justify-between gap-s2">
          <span className="mono-meta">GUARDRAIL · NOT_IN_SOURCES</span>
          <span className="inline-flex items-center gap-s1">
            <span className="state-dot state-dot-error" aria-hidden="true" />
            <span className="font-body text-caption text-ink-72">Ditolak</span>
          </span>
        </div>
        <p className="mt-s2 font-display text-label font-semibold text-ink">
          Siapa CEO perusahaan ini?
        </p>
        <p className="mt-s1 font-body text-body text-ink-72">
          Pertanyaan di luar sumber dijawab dengan keterbatasan, bukan angka rekaan.
        </p>
      </div>
    </div>
  );
}
