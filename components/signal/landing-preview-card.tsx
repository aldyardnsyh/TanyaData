/**
 * Pratinjau antarmuka di hero: menggambarkan alur produk (pertanyaan bahasa
 * sehari-hari, jawaban per kanal, chip sitasi) dengan jelas berlabel "PRATINJAU
 * ANTARMUKA" supaya tidak dibaca sebagai klaim data nyata (R-23/R-38). Isi
 * contoh diambil dari korpus contoh produk (FAQ Customer Support), bukan angka
 * pemasaran. Statis, bukan kontrol.
 */
export function LandingPreviewCard() {
  return (
    <div className="rounded-card-lg border border-hairline-dark bg-porcelain p-s4 text-left shadow-float sm:p-s5">
      <div className="flex items-center justify-between gap-s2">
        <span className="mono-meta">PRATINJAU ANTARMUKA</span>
        <span className="inline-flex items-center gap-s1">
          <span className="state-dot state-dot-active" aria-hidden="true" />
          <span className="font-body text-caption text-ink-72">Selesai</span>
        </span>
      </div>
      <p className="mt-s3 font-display text-label font-semibold text-ink">
        Berapa SLA pengembalian dana untuk tiap kanal?
      </p>
      <div className="mt-s2 rounded-control bg-forest-08 px-s2 py-s2">
        <dl className="grid gap-1 font-body text-body text-ink">
          <div className="flex items-baseline justify-between gap-s3">
            <dt className="text-ink-72">Virtual Account</dt>
            <dd className="tabular">3 hari kerja</dd>
          </div>
          <div className="flex items-baseline justify-between gap-s3">
            <dt className="text-ink-72">E-Wallet</dt>
            <dd className="tabular">maksimal 2 x 24 jam</dd>
          </div>
          <div className="flex items-baseline justify-between gap-s3">
            <dt className="text-ink-72">QRIS</dt>
            <dd className="tabular">2 hari kerja</dd>
          </div>
          <div className="flex items-baseline justify-between gap-s3">
            <dt className="text-ink-72">Kartu Kredit</dt>
            <dd className="tabular">7 sampai 14 hari kerja</dd>
          </div>
        </dl>
      </div>
      <div className="mt-s3 flex flex-wrap items-center justify-between gap-s2">
        <span className="inline-flex min-h-11 items-center rounded-chip border border-[var(--border-hairline)] px-s3">
          <span className="mono-meta">SITASI · FAQ CUSTOMER SUPPORT</span>
        </span>
        <span className="font-body text-caption text-ink-72">Jawaban menunjuk sumber asalnya.</span>
      </div>
    </div>
  );
}
