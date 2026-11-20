/**
 * Purpose Gate: section ini memperkenalkan isi workspace (enam halaman aplikasi
 * yang benar-benar ada, dengan rute aslinya) agar pembaca paham produk lebih
 * dari sekadar percakapan. Deskripsi disarikan dari PRD dan modul yang
 * di-shipping, tanpa klaim baru.
 */
const SURFACES = [
  {
    route: '/OVERVIEW',
    title: 'Ringkasan',
    copy: 'Metrik transaksi, tren, dan temuan dalam satu dashboard.',
  },
  {
    route: '/ASSISTANT',
    title: 'Asisten',
    copy: 'Percakapan dengan jawaban yang menyertakan kutipan sumber.',
  },
  {
    route: '/DATA-SOURCES',
    title: 'Sumber data',
    copy: 'Kelola unggahan dan lihat status indeks setiap berkas.',
  },
  {
    route: '/INVESTIGATIONS',
    title: 'Investigasi',
    copy: 'Telusuri penyebab anomali lintas data dan dokumen.',
  },
  {
    route: '/REPORTS',
    title: 'Laporan',
    copy: 'Susun temuan menjadi laporan yang bisa diekspor.',
  },
  {
    route: '/SHARE',
    title: 'Bagikan',
    copy: 'Kirim hasil sebagai halaman read-only tanpa login.',
  },
];

export function LandingWorkspace() {
  return (
    <>
      <p className="eyebrow">Di dalam workspace</p>
      <h2 className="mt-s2 font-display text-title text-ink">Semua yang dibutuhkan analisis harian</h2>
      <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
        Bukan hanya percakapan: enam halaman saling menyambung dari unggahan sampai hasil yang
        dibagikan.
      </p>
      <div className="mt-s5 grid gap-s3 md:grid-cols-2 lg:grid-cols-3">
        {SURFACES.map((surface) => (
          <article
            key={surface.route}
            className="surface rounded-card-lg flex flex-col gap-s2 p-s4 shadow-lift transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest motion-reduce:transform-none"
          >
            <span className="mono-meta">{surface.route}</span>
            <h3 className="font-display text-label font-semibold text-ink">{surface.title}</h3>
            <p className="font-body text-body text-ink-72">{surface.copy}</p>
          </article>
        ))}
      </div>
    </>
  );
}
