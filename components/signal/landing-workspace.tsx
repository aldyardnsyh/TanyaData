/**
 * Purpose Gate: section ini memperkenalkan isi workspace (enam halaman aplikasi
 * yang benar-benar ada, dengan rute aslinya) agar pembaca paham produk lebih
 * dari sekadar percakapan. Deskripsi disarikan dari modul yang di-shipping,
 * tanpa klaim baru. Ringkasan hidup per dokumen (bukan halaman global), jadi
 * keenam kartu mengikuti navigasi workspace saat ini + halaman bagikan publik.
 */
import { Icon } from '@/components/ui/icons';

const SURFACES = [
  {
    icon: 'forum',
    title: 'Asisten',
    copy: 'Ruang chat dengan riwayat tersimpan; setiap sitasi bisa dibuka ke potongan dokumen aslinya.',
  },
  {
    icon: 'upload_file',
    title: 'Sumber data',
    copy: 'Unggah dataset dan dokumen; ringkasan serta analitik per dokumen tersusun otomatis begitu terindeks.',
  },
  {
    icon: 'fact_check',
    title: 'Investigasi',
    copy: 'Dossier analisis mendalam per sumber data: klaim, kanal dominan, dan kesimpulan.',
  },
  {
    icon: 'receipt_long',
    title: 'Laporan',
    copy: 'Dokumen cetak dengan template sendiri per jenis laporan, lengkap header, footer, dan ekspor PDF.',
  },
  {
    icon: 'tune',
    title: 'Pengaturan',
    copy: 'Atur bahasa, zona waktu, dan rentang tanggal sesuai cara kerja tim Anda.',
  },
  {
    icon: 'ios_share',
    title: 'Bagikan',
    copy: 'Kirim hasil sebagai halaman read-only yang bisa dibuka tanpa login.',
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
            key={surface.title}
            className="surface rounded-card-lg flex flex-col gap-s2 p-s4 shadow-lift transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest motion-reduce:transform-none"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-control bg-forest-08">
              <Icon name={surface.icon} className="text-[20px] text-forest" />
            </span>
            <h3 className="font-display text-label font-semibold text-ink">{surface.title}</h3>
            <p className="font-body text-body text-ink-72">{surface.copy}</p>
          </article>
        ))}
      </div>
    </>
  );
}
