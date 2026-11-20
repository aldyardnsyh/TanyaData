/**
 * Purpose Gate: lima kemampuan FR-A..FR-E tampil sebagai daftar editorial bernomor
 * dengan nomor besar dan kode FR sebagai penanda kasus uji, agar tiap kriteria
 * terbaca penuh tanpa klik dan tanpa kartu dekoratif.
 */

/* Copy lima FR disalin persis dari kontrak §2-S3 (docs/LANDING_COPY_SEO.md);
 * tidak ada kata yang diubah dan tidak ada klaim tambahan. */
const CAPABILITIES = [
  {
    id: 'fr-a',
    no: '01',
    fr: 'FR-A',
    title: 'Ingest tangguh',
    copy: 'PDF ber-text-layer dibaca langsung. Halaman hasil pindai yang tidak terbaca ditandai dengan nomor halaman dan tidak dipakai sebagai sitasi.',
  },
  {
    id: 'fr-b',
    no: '02',
    fr: 'FR-B',
    title: 'Readjustment dan laporan',
    copy: 'Minta "tampilkan bagian X saja" atau "group by kanal". Langkah filter, cleaning, grouping, dan agregasi tercatat. PDF dan Excel memakai angka yang sama dengan tampilan.',
  },
  {
    id: 'fr-c',
    no: '03',
    fr: 'FR-C',
    title: 'Chat per attachment',
    copy: 'Pertanyaan hanya memakai berkas yang sedang aktif. Dua berkas berisi angka berbeda tidak saling mencampur.',
  },
  {
    id: 'fr-d',
    no: '04',
    fr: 'FR-D',
    title: 'Sitasi dan guardrail',
    copy: 'Klik sitasi untuk membuka halaman, bagian, dan potongan asal. Pertanyaan di luar sumber dijawab dengan keterbatasan, bukan angka rekaan.',
  },
  {
    id: 'fr-e',
    no: '05',
    fr: 'FR-E',
    title: 'Tautan hasil',
    copy: 'Bagikan percakapan sebagai halaman read-only tanpa login. Konfirmasi muncul lebih dulu, dan tautan berisi salinan yang tidak berubah.',
  },
];

export function LandingWorkflow() {
  return (
    <>
      <div>
        <p className="eyebrow">Cara kerja</p>
        <h2 className="mt-s2 font-display text-title text-ink">
          Lima kemampuan yang bisa diuji satu per satu
        </h2>
        <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
          Setiap kemampuan punya kriteria yang bisa Anda coba sendiri.
        </p>
      </div>
      <ol className="mt-s5 border-t border-[var(--border-hairline)]">
        {CAPABILITIES.map((cap) => (
          <li
            key={cap.id}
            className="group grid gap-s2 border-b border-[var(--border-hairline)] py-s4 transition-colors duration-[var(--motion-fast)] hover:bg-forest-08 md:grid-cols-12 md:gap-s4 md:px-s2"
          >
            <div className="md:col-span-2">
              <span className="font-mono text-title tabular text-forest">{cap.no}</span>
              <span className="mono-meta mt-s1 block">{cap.fr}</span>
            </div>
            <h3 className="font-display text-title text-ink md:col-span-4">{cap.title}</h3>
            <p className="max-w-[52ch] font-body text-body text-ink-72 md:col-span-6">
              {cap.copy}
            </p>
          </li>
        ))}
      </ol>
      <p className="mono-meta mt-s3">DIUJI OLEH 24 KASUS UJI PRODUKSI · 11 KASUS FR-A..FR-E</p>
    </>
  );
}
