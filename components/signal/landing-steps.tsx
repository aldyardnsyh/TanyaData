/**
 * Purpose Gate: alur produk empat langkah dari berkas menjadi jawaban yang
 * bisa dibagikan, agar pembaca paham cara kerja sebelum mencoba. Nomor besar
 * menandai urutan, bukan dekorasi.
 */
const STEPS = [
  {
    no: '01',
    title: 'Unggah',
    copy: 'Tarik berkas data dan dokumen ke workspace. Data contoh sudah tersedia bila ingin langsung mencoba.',
  },
  {
    no: '02',
    title: 'Tanyakan',
    copy: 'Ajukan pertanyaan dalam bahasa sehari-hari, untuk satu berkas atau seluruh sumber yang aktif.',
  },
  {
    no: '03',
    title: 'Periksa',
    copy: 'Baca jawabannya beserta kutipan sumber; angka datang dari data yang diunggah.',
  },
  {
    no: '04',
    title: 'Bagikan',
    copy: 'Kirim hasil sebagai halaman read-only tanpa login, setelah ringkasan konfirmasi muncul lebih dulu.',
  },
];

export function LandingSteps() {
  return (
    <>
      <p className="eyebrow">Cara kerja</p>
      <h2 className="mt-s2 font-display text-title text-ink">Empat langkah dari berkas menjadi jawaban</h2>
      <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
        Tanpa setup, tanpa menulis query: dari unggahan ke jawaban yang bisa dibagikan.
      </p>
      <div className="mt-s5 grid gap-s3 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step) => (
          <div
            key={step.no}
            className="rounded-card-lg border border-[var(--border-hairline)] bg-porcelain p-s4 shadow-lift"
          >
            <span className="font-mono text-title tabular text-forest">{step.no}</span>
            <h3 className="mt-s2 font-display text-label font-semibold text-ink">{step.title}</h3>
            <p className="mt-s2 font-body text-body text-ink-72">{step.copy}</p>
          </div>
        ))}
      </div>
    </>
  );
}
