/**
 * Purpose Gate: section fitur menonjolkan empat kemampuan inti produk RAG
 * TanyaData (baca dokumen, analisis data, jawaban bersumber, batas jujur)
 * sebagai pengantar SaaS general use, bukan narasi riset internal.
 */
export function LandingFeatures() {
  return (
    <>
      <p className="eyebrow">Fitur utama</p>
      <h2 className="mt-s2 font-display text-title text-ink">Apa yang dilakukan TanyaData</h2>
      <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
        Empat kemampuan inti untuk pekerjaan analisis sehari-hari.
      </p>
      <div className="mt-s5 grid gap-s3 md:grid-cols-2 lg:grid-cols-4">
        <article className="surface rounded-card-lg flex flex-col gap-s3 p-s4 shadow-lift transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest motion-reduce:transform-none">
          <div className="rounded-control bg-forest-08 p-s2">
            <div className="flex flex-wrap gap-s1">
              {['PDF', 'DOCX', 'TXT', 'MD'].map((format) => (
                <span
                  key={format}
                  className="rounded-chip border border-[var(--border-hairline)] px-s2 py-1 font-mono text-caption uppercase tracking-[0.06em] text-ink"
                >
                  {format}
                </span>
              ))}
            </div>
            <p className="mt-s2 font-body text-caption text-ink-72">Isi dokumen diindeks per bagian.</p>
          </div>
          <h3 className="font-display text-label font-semibold text-ink">Dokumen dibaca untuk Anda</h3>
          <p className="font-body text-body text-ink-72">
            Isi dokumen dicari dan dirangkum; jawaban menunjuk halaman dan bagian asalnya.
          </p>
        </article>
        <article className="surface rounded-card-lg flex flex-col gap-s3 p-s4 shadow-lift transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest motion-reduce:transform-none">
          <div className="rounded-control bg-forest-08 p-s2">
            <div className="flex flex-wrap gap-s1">
              {['CSV', 'XLSX', 'SQL'].map((format) => (
                <span
                  key={format}
                  className="rounded-chip border border-[var(--border-hairline)] px-s2 py-1 font-mono text-caption uppercase tracking-[0.06em] text-ink"
                >
                  {format}
                </span>
              ))}
            </div>
            <p className="mt-s2 font-body text-caption text-ink-72">Metrik dihitung dari data yang diunggah.</p>
          </div>
          <h3 className="font-display text-label font-semibold text-ink">Data dianalisis</h3>
          <p className="font-body text-body text-ink-72">
            Total, distribusi, dan perbandingan antarperiode dihitung langsung dari datanya.
          </p>
        </article>
        <article className="surface rounded-card-lg flex flex-col gap-s3 p-s4 shadow-lift transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest motion-reduce:transform-none">
          <div className="rounded-control bg-forest-08 p-s2">
            <span className="inline-flex items-center gap-s2 rounded-chip border border-[var(--border-hairline)] bg-porcelain px-s3 py-1">
              <span className="state-dot state-dot-active" aria-hidden="true" />
              <span className="mono-meta">SITASI · DOKUMEN</span>
            </span>
            <p className="mt-s2 font-body text-caption text-ink-72">Kutipan asal dibuka bersama jawaban.</p>
          </div>
          <h3 className="font-display text-label font-semibold text-ink">Jawaban dengan sumber</h3>
          <p className="font-body text-body text-ink-72">
            Setiap jawaban dokumen menyertakan kutipan yang bisa dibuka satu per satu.
          </p>
        </article>
        <article className="surface rounded-card-lg flex flex-col gap-s3 p-s4 shadow-lift transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest motion-reduce:transform-none">
          <div className="rounded-control bg-terracotta-16 p-s2">
            <div className="flex items-center gap-s2">
              <span className="state-dot state-dot-error" aria-hidden="true" />
              <span className="mono-meta">TIDAK DITEMUKAN</span>
            </div>
            <p className="mt-s2 font-body text-caption text-ink-72">
              Topik yang tersedia ditawarkan menggantikannya.
            </p>
          </div>
          <h3 className="font-display text-label font-semibold text-ink">Jujur saat sumber tidak ada</h3>
          <p className="font-body text-body text-ink-72">
            Pertanyaan di luar sumber dijawab dengan keterbatasan, bukan angka rekaan.
          </p>
        </article>
      </div>
    </>
  );
}
