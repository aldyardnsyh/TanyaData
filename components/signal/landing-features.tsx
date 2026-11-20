/**
 * Purpose Gate: section "Fitur utama" menonjolkan tiga jaminan jawaban TanyaData
 * lewat mini-demo visual, bukan narasi, agar pembaca bisa memeriksa mekanisme
 * buktinya satu per satu sebelum mencoba. Semua string berasal dari kontrak dan
 * berkas uji nyata (docs/ROBUSTNESS_REAL_DOCS.md): SQL-01 dengan hasil query
 * 46.952, sitasi TRANSACTIONS.CSV, dan penolakan GR-02 (NOT_IN_SOURCES); bukan
 * rekaan (R-17).
 */
export function LandingFeatures() {
  return (
    <>
      <p className="eyebrow">Fitur utama</p>
      <h2 className="mt-s2 font-display text-title text-ink">
        Setiap jawaban datang dengan buktinya
      </h2>
      <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
        Tiga hal ini selalu tampil pada jawaban TanyaData, bukan opsional.
      </p>
      <div className="mt-s5 grid gap-s3 md:grid-cols-3">
        <article className="surface rounded-card-lg flex flex-col gap-s3 p-s5 shadow-lift transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest motion-reduce:transform-none">
          <div className="rounded-control bg-forest-08 p-s2 font-mono text-caption">
            <pre className="overflow-x-auto leading-relaxed text-ink">
              <code>{`SELECT COUNT(*) AS value
FROM core_data_… LIMIT 500`}</code>
            </pre>
            <div className="mt-s2 flex flex-wrap items-end justify-between gap-s2">
              <div>
                <p className="font-body text-caption text-ink-72">Total transaksi</p>
                <p className="font-body text-metric tabular text-ink">46.952</p>
              </div>
              <span className="inline-flex items-center rounded-chip border border-[var(--border-hairline)] px-s3 py-s1">
                <span className="mono-meta">SITASI · TRANSACTIONS.CSV</span>
              </span>
            </div>
          </div>
          <h3 className="font-display text-label font-semibold text-ink">SQL yang bisa dibaca</h3>
          <p className="font-body text-body text-ink-72">
            Setiap jawaban angka menyertakan query yang menghasilkannya, bersama durasi dan
            jumlah baris.
          </p>
        </article>
        <article className="surface rounded-card-lg flex flex-col gap-s3 p-s5 shadow-lift transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest motion-reduce:transform-none">
          <div className="rounded-control bg-forest-08 p-s2 font-mono text-caption">
            <div className="inline-flex items-center gap-s2 rounded-chip border border-[var(--border-hairline)] px-s3 py-s1">
              <span className="state-dot state-dot-active" aria-hidden="true" />
              <span className="mono-meta">SITASI · LAPORAN SEPT 2026 · BAGIAN 1</span>
            </div>
            <p className="mt-s2 font-body text-caption text-ink-72">
              Halaman, bagian, dan kutipan asal
            </p>
          </div>
          <h3 className="font-display text-label font-semibold text-ink">Sitasi yang bisa diklik</h3>
          <p className="font-body text-body text-ink-72">
            Klik sitasi untuk membuka halaman, bagian, dan potongan asal.
          </p>
        </article>
        <article className="surface rounded-card-lg flex flex-col gap-s3 p-s5 shadow-lift transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest motion-reduce:transform-none">
          <div className="rounded-control bg-terracotta-16 p-s2 font-mono text-caption">
            <div className="flex items-center justify-between gap-s2">
              <span className="inline-flex items-center gap-s1">
                <span className="state-dot state-dot-error" aria-hidden="true" />
                <span className="mono-meta">GUARDRAIL · NOT_IN_SOURCES</span>
              </span>
              <span className="font-body text-caption text-ink-72">Ditolak</span>
            </div>
            <p className="mt-s2 font-display text-label font-semibold text-ink">
              Siapa CEO perusahaan ini?
            </p>
          </div>
          <h3 className="font-display text-label font-semibold text-ink">Guardrail yang jujur</h3>
          <p className="font-body text-body text-ink-72">
            Pertanyaan di luar sumber dijawab dengan keterbatasan, bukan angka rekaan.
          </p>
        </article>
      </div>
    </>
  );
}
