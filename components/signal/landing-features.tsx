/**
 * Purpose Gate: section fitur menonjolkan kemampuan inti produk RAG
 * TanyaData (baca dokumen, analisis data, jawaban bersumber, batas jujur)
 * sebagai pengantar SaaS general use, bukan narasi riset internal.
 * Blok "Di balik jawabannya" menambahkan kemampuan yang sudah terbukti di
 * produk: respons adaptif per kelompok dokumen, OCR dokumen hasil pindai,
 * retrieval hybrid, dan sintesis multi-dokumen. Ditampilkan sebagai daftar
 * berikon (bukan kartu identik) supaya ritme section berbeda dari grid di
 * atasnya dan hierarki konten tetap terbaca.
 */
import { Icon } from '@/components/ui/icons';

/** Kemampuan lanjutan yang sudah berjalan di produk; ikon Material Symbols
 * relevan dengan isinya (kategori dokumen, pindai, pencarian, rak buku). */
const ADVANCED = [
  {
    icon: 'category',
    title: 'Respons menyesuaikan kelompok dokumen',
    copy: 'Dokumen dikelompokkan di UI (Finance, SOP/Legal, Teknis, Umum) dan bentuk jawaban mengikuti kelompoknya: laporan keuangan menjadi narasi dengan tabel atau bar dari data eksekusinya, SOP dan dokumen legal menjadi prosa terstruktur yang merujuk bagian atau pasalnya.',
  },
  {
    icon: 'document_scanner',
    title: 'Dokumen hasil pindai tetap terbaca',
    copy: 'PDF yang tidak punya lapisan teks dibaca lewat OCR peka kolom, sehingga dokumen hasil scan tetap bisa ditanya isinya seperti dokumen biasa.',
  },
  {
    icon: 'manage_search',
    title: 'Pencarian hybrid, bukan tebak-tebakan',
    copy: 'Pencarian menggabungkan kata kunci dan vektor, lalu menggabungkan hasilnya, supaya potongan yang relevan tetap ditemukan meski kata yang Anda pakai tidak persis sama dengan dokumennya.',
  },
  {
    icon: 'library_books',
    title: 'Banyak dokumen, satu jawaban',
    copy: 'Pertanyaan lintas berkas dijawab dengan menyintesis beberapa sumber sekaligus, dan setiap sumber tetap tercantum dalam sitasinya.',
  },
];

export function LandingFeatures() {
  return (
    <>
      <p className="eyebrow">Fitur utama</p>
      <h2 className="mt-s2 font-display text-title text-ink">Apa yang dilakukan TanyaData</h2>
      <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
        Kemampuan inti untuk pekerjaan analisis sehari-hari, dari membaca berkas sampai menjaga
        jawaban tetap bisa ditelusuri.
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

      {/* Di balik jawabannya: daftar berikon, komposisi berbeda dari grid kartu
          di atasnya (ritme section). Ikon mengikuti pola workspace (Material
          Symbols, 20px, di dalam kotak forest-08). */}
      <div className="mt-s5 rounded-card-lg border border-[var(--border-hairline)] p-s4 md:p-s5">
        <p className="font-display text-label font-semibold text-ink">Di balik jawabannya</p>
        <ul className="mt-s3 grid gap-s4 md:grid-cols-2">
          {ADVANCED.map((item) => (
            <li key={item.title} className="flex items-start gap-s3">
              <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-control bg-forest-08">
                <Icon name={item.icon} className="text-[20px] text-forest" />
              </span>
              <div>
                <h3 className="font-display text-label font-semibold text-ink">{item.title}</h3>
                <p className="mt-s1 font-body text-body text-ink-72">{item.copy}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
