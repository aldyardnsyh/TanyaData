/**
 * Purpose Gate: alur produk empat langkah dari berkas menjadi jawaban yang
 * bisa dibagikan, agar pembaca paham cara kerja sebelum mencoba.
 * Section ini sengaja band gelap agar ritme halaman selang-seling dengan
 * section fitur yang terang (arah user: variasi antar section). Nomor besar
 * lime menandai urutan langkah, bukan dekorasi.
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
      <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
        Cara kerja
      </p>
      <h2 className="mt-s2 font-display text-title text-porcelain">
        Empat langkah dari berkas menjadi jawaban
      </h2>
      <p className="mt-s2 max-w-[52ch] font-body text-body text-dark-muted">
        Tanpa setup, tanpa menulis query: dari unggahan ke jawaban yang bisa dibagikan.
      </p>
      <div className="mt-s5 grid gap-s5 md:grid-cols-4 md:gap-0 md:divide-x md:divide-[var(--hairline-dark)]">
        {STEPS.map((step) => (
          <div key={step.no} className="md:px-s4 first:md:pl-0 last:md:pr-0">
            <span className="text-stat-lg text-lime text-glow-lime">{step.no}</span>
            <h3 className="mt-s2 font-display text-label font-semibold text-porcelain">{step.title}</h3>
            <p className="mt-s2 font-body text-body text-dark-muted">{step.copy}</p>
          </div>
        ))}
      </div>
    </>
  );
}
