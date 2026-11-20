import Link from 'next/link';
import { HeroHighlight } from '@/components/signal/hero-highlight';
import { BentoGrid, type BentoItem } from '@/components/signal/bento-grid';
import { LayoutGrid, type RevealCard } from '@/components/signal/layout-grid';
import { TimelineView, type TimelineNode } from '@/components/signal/timeline-view';
import { SectionRule } from '@/components/signal/section-rule';
import { LandingCTA } from '@/components/signal/landing-cta';
import { LandingNav } from '@/components/signal/landing-nav';
import { LandingFormatTabs } from '@/components/signal/landing-format-tabs';
import { FaqAccordion, type FaqItem } from '@/components/signal/landing-faq';
import { ScrollReveal } from '@/components/signal/scroll-reveal';
import { LandingPreviewCard } from '@/components/signal/landing-preview-card';

/*
 * Landing TanyaData. Copy disalin dari docs/LANDING_COPY_SEO.md (8 section, tanpa
 * perubahan kata). Presentasi visual mengikuti arahan user: bahasa Aceternity
 * (band gelap + grid pattern + glow lime + navbar melayang) dengan ritme band
 * dan kelembutan kanjikan.munawariz.site, dieksekusi hanya dengan enam token
 * warna dan turunan alphanya. Semua angka berasal dari berkas uji yang tercatat:
 * tanyadata/docs/ROBUSTNESS_REAL_DOCS.md (24/24, 6/6, 0 temuan, 46.952, SQL-01)
 * dan tanyadata/docs/EVAL_RESULTS.md (8/8 tahap, 11/11 kasus FR-A..E, 94,39%).
 * Landing tidak memanggil API: datanya kontrak uji yang statis, sehingga state
 * loading/empty/error pada komponen data bersifat n/a (tidak ada sumber yang bisa gagal).
 */

/** FAQ S6. Sumber tunggal untuk tampilan dan JSON-LD FAQPage supaya keduanya identik (syarat §3). */
const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'data-langsung',
    question: 'Apakah data di TanyaData diperbarui langsung?',
    answer: 'Tidak. Data contoh mencakup transaksi sampai 18 November 2026.',
  },
  {
    id: 'lihat-sql',
    question: 'Bisakah saya melihat SQL yang dipakai?',
    answer: 'Bisa, untuk pertanyaan yang dijawab dari data terstruktur.',
  },
  {
    id: 'login-tautan',
    question: 'Apakah tautan hasil perlu login?',
    answer: 'Tidak. Tautan bersifat read-only dan bisa dibuka tanpa akun.',
  },
  {
    id: 'jawaban-benar',
    question: 'Apakah jawaban selalu benar?',
    answer:
      'Tidak. Jawaban dibatasi pada sumber yang tersedia. Bila bukti tidak ada, sistem menyatakan tidak ditemukan dan menawarkan topik yang tersedia.',
  },
];

/** JSON-LD FAQPage (LANDING_COPY_SEO §3). Ditaruh di halaman ini, bukan layout, karena FAQ hanya tampil di landing. */
const FAQ_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ_ITEMS.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
};

/* S2 bukti: angka dan sumbernya disalin dari berkas uji (R-17). Tooltip C-12 menyebut sumber berkasnya. */
const EVIDENCE_ITEMS: BentoItem[] = [
  {
    id: 'kasus-lulus',
    label: 'Kasus uji produksi lulus',
    value: '24/24',
    source: 'docs/ROBUSTNESS_REAL_DOCS.md',
    tooltip: 'Sumber: docs/ROBUSTNESS_REAL_DOCS.md. Uji robust 20 November 2026: 24 kasus, 24 lulus.',
    span: 'hero',
    active: true,
  },
  {
    id: 'dokumen-terbaca',
    label: 'Dokumen terbaca',
    value: '6/6',
    source: 'docs/ROBUSTNESS_REAL_DOCS.md',
    tooltip: 'Sumber: docs/ROBUSTNESS_REAL_DOCS.md. Enam dokumen nyata berhasil di-ingest tanpa temuan.',
  },
  {
    id: 'tahap-evaluasi',
    label: 'Tahap evaluasi lulus',
    value: '8/8',
    source: 'docs/EVAL_RESULTS.md',
    tooltip: 'Sumber: docs/EVAL_RESULTS.md. Delapan tahap evaluasi kemampuan inti, semuanya lulus.',
  },
  {
    id: 'kasus-fr',
    label: 'Kasus FR-A sampai FR-E',
    value: '11/11',
    source: 'docs/EVAL_RESULTS.md',
    tooltip: 'Sumber: docs/EVAL_RESULTS.md. Sebelas kasus kemampuan CORE V2 untuk FR-A sampai FR-E.',
    span: 'wide',
  },
  {
    id: 'temuan',
    label: 'Temuan tercatat',
    value: '0',
    source: 'docs/ROBUSTNESS_REAL_DOCS.md',
    tooltip: 'Sumber: docs/ROBUSTNESS_REAL_DOCS.md. Daftar bug dan temuan pada run: tidak ada.',
    span: 'wide',
  },
];

/* S3: lima FR dari kontrak §2-S3. Kartu dikembangkan di tempat karena detail tiap FR
 * tidak muat di ringkasan tanpa menghilangkan daftar (Purpose Gate C-11). */
const CAPABILITY_CARDS: RevealCard[] = [
  {
    id: 'fr-a',
    title: 'FR-A Ingest tangguh',
    meta: 'PDF · TEXT-LAYER',
    wide: true,
    preview: null,
    detail: (
      <p className="max-w-[68ch] font-body text-body text-ink-72">
        PDF ber-text-layer dibaca langsung. Halaman hasil pindai yang tidak terbaca ditandai dengan nomor
        halaman dan tidak dipakai sebagai sitasi.
      </p>
    ),
  },
  {
    id: 'fr-b',
    title: 'FR-B Readjustment dan laporan',
    meta: 'FILTER · GROUP · AGREGASI',
    preview: null,
    detail: (
      <p className="max-w-[68ch] font-body text-body text-ink-72">
        Minta &quot;tampilkan bagian X saja&quot; atau &quot;group by kanal&quot;. Langkah filter, cleaning,
        grouping, dan agregasi tercatat. PDF dan Excel memakai angka yang sama dengan tampilan.
      </p>
    ),
  },
  {
    id: 'fr-c',
    title: 'FR-C Chat per attachment',
    meta: 'SCOPE PER BERKAS',
    preview: null,
    detail: (
      <p className="max-w-[68ch] font-body text-body text-ink-72">
        Pertanyaan hanya memakai berkas yang sedang aktif. Dua berkas berisi angka berbeda tidak saling
        mencampur.
      </p>
    ),
  },
  {
    id: 'fr-d',
    title: 'FR-D Sitasi dan guardrail',
    meta: 'SITASI · GUARDRAIL',
    preview: null,
    detail: (
      <p className="max-w-[68ch] font-body text-body text-ink-72">
        Klik sitasi untuk membuka halaman, bagian, dan potongan asal. Pertanyaan di luar sumber dijawab
        dengan keterbatasan, bukan angka rekaan.
      </p>
    ),
  },
  {
    id: 'fr-e',
    title: 'FR-E Tautan hasil',
    meta: 'READ-ONLY · TANPA LOGIN',
    preview: null,
    detail: (
      <p className="max-w-[68ch] font-body text-body text-ink-72">
        Bagikan percakapan sebagai halaman read-only tanpa login. Konfirmasi muncul lebih dulu, dan tautan
        berisi salinan yang tidak berubah.
      </p>
    ),
  },
];

/* S5: garis waktu memakai tanggal nyata dari berkas uji dan rentang data contoh
 * (footer: 1 Agustus sampai 18 November 2026; GR-01 di ROBUSTNESS_REAL_DOCS;
 * run EVAL_RESULTS 2026-11-20T14:59 dan uji robust 2026-11-20T15:02).
 * Purpose Gate: urutan kronologis adalah bukti, bukan dekorasi (C-07). */
const AUDIT_NODES: TimelineNode[] = [
  {
    id: 'rentang-mulai',
    date: '2026-08-01',
    label: 'Rentang data contoh dimulai',
    evidence: 'Data contoh mencakup transaksi sejak tanggal ini sampai 18 November 2026.',
  },
  {
    id: 'rentang-berakhir',
    date: '2026-11-18',
    label: 'Rentang data contoh berakhir',
    evidence: 'Pertanyaan di luar rentang dijawab dengan keterbatasan, bukan angka rekaan.',
  },
  {
    id: 'eval-inti',
    date: '2026-11-20',
    label: 'Kemampuan inti dievaluasi ulang',
    evidence: '8 dari 8 tahap lulus dan 11 dari 11 kasus kemampuan baru lulus.',
  },
  {
    id: 'robust-dokumen',
    date: '2026-11-20',
    label: 'Pipeline dijalankan ulang pada 6 dokumen nyata',
    evidence: 'Dari 24 kasus, 24 lulus. Tidak ada temuan yang dicatat.',
  },
];

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSONLD) }}
      />
      <LandingNav />
      <main>
        {/* S1 Hero: band gelap forest, motif grid baris-data, glow lime tunggal pada fokus.
            Sorotan frasa = lime + glow (C-10 tone dark); CTA menyala satu-satunya di hero. */}
        <section className="relative overflow-hidden bg-forest text-porcelain">
          <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
          <div
            aria-hidden="true"
            className="glow-radial-lime absolute -top-32 left-1/2 h-[440px] w-[720px] max-w-none -translate-x-1/2"
          />
          <div className="page-container relative pb-16 pt-32 md:pb-24 md:pt-40">
            <ScrollReveal className="max-w-3xl">
              <p className="inline-flex items-center rounded-chip border border-hairline-dark px-s3 py-1 font-body text-caption text-dark-muted">
                Text-to-SQL · Sitasi dokumen · Guardrail
              </p>
              <HeroHighlight
                tone="dark"
                size="hero"
                highlight="Periksa jawabannya sampai ke sumbernya."
                className="mt-s4"
              >
                Tanyakan datanya. Periksa jawabannya sampai ke sumbernya.
              </HeroHighlight>
              <p className="mt-s4 max-w-[52ch] font-body text-body text-dark-muted">
                TanyaData mengubah pertanyaan Anda menjadi query SQL yang bisa dibaca, lalu menampilkan angka
                hasilnya dan sitasi yang bisa diklik. Untuk dokumen, jawaban menunjuk ke halaman dan bagian asal.
              </p>
              <div className="mt-s5 flex flex-wrap items-center gap-s3">
                <LandingCTA tone="dark" />
                <Link
                  href="#cara-kerja"
                  className="touch-44 inline-flex items-center rounded-button-lg border border-hairline-dark px-s4 font-display text-label font-semibold text-porcelain transition-colors duration-[var(--motion-fast)] hover:border-porcelain focus-ring"
                >
                  Lihat cara kerjanya
                </Link>
              </div>
              <p className="mt-s4 inline-flex items-center rounded-chip border border-hairline-dark px-s3 py-1 font-body text-caption tabular text-dark-muted">
                Data contoh: 46.952 transaksi · 1 sampai 18 November 2026.
              </p>
            </ScrollReveal>
            <ScrollReveal className="mt-12 max-w-2xl md:mt-16" delay={120}>
              <LandingPreviewCard />
            </ScrollReveal>
          </div>
        </section>

        <SectionRule className="page-container" />

        {/* S2 Bukti nyata: bento karena 24/24 lebih berbobot dari empat angka pendukung (C-01). */}
        <section id="bukti" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <p className="eyebrow">Bukti uji</p>
            <h2 className="mt-s2 font-display text-title text-ink">Yang sudah diuji, bukan yang dijanjikan</h2>
            <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
              Pada 20 November 2026 pipeline produksi dijalankan ulang pada 6 dokumen nyata dan data transaksi.
              Dari 24 kasus, 24 lulus. Dari 6 dokumen, 6 terbaca. Tidak ada temuan yang dicatat. Evaluasi
              kemampuan inti mencatat 8 dari 8 tahap lulus dan 11 dari 11 kasus kemampuan baru lulus. Angka di
              bawah berasal dari eksekusi, bukan dari narasi.
            </p>
          </ScrollReveal>
          <div className="mt-s5">
            <BentoGrid items={EVIDENCE_ITEMS} />
          </div>
        </section>

        <SectionRule className="page-container" />

        {/* S3 Cara kerja: mekanisme lima FR, detail dibuka di tempat (C-11). */}
        <section id="cara-kerja" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <p className="eyebrow">Cara kerja</p>
            <h2 className="mt-s2 font-display text-title text-ink">Lima kemampuan yang bisa diuji satu per satu</h2>
            <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
              Setiap kemampuan punya kriteria yang bisa Anda coba sendiri.
            </p>
          </ScrollReveal>
          <div className="mt-s5">
            <LayoutGrid cards={CAPABILITY_CARDS} />
          </div>
        </section>

        <SectionRule className="page-container" />

        {/* S4 Kapabilitas dokumen: dua kelompok format dipisah secara spasial (C-04). */}
        <section id="format" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <p className="eyebrow">Format diterima</p>
            <h2 className="mt-s2 font-display text-title text-ink">Enam format yang diterima</h2>
            <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
              Data terstruktur: CSV, XLSX, dan SQL. Dokumen: PDF, DOCX, dan TXT. Uji robust memakai 6 dokumen
              nyata berupa TXT, MD, DOCX, dan tiga PDF. Berkas MD diperlakukan sebagai teks.
            </p>
          </ScrollReveal>
          <div className="mt-s5 max-w-xl">
            <LandingFormatTabs />
          </div>
        </section>

        <SectionRule className="page-container" />

        {/* S5 Audit trail: garis waktu bukti bertanggal nyata (C-07). */}
        <section id="audit" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <p className="eyebrow">Jejak audit</p>
            <h2 className="mt-s2 font-display text-title text-ink">Jejak yang bisa dibuka satu per satu</h2>
            <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
              Untuk pertanyaan angka, query SQL tampil bersama durasi dan jumlah baris. Untuk pertanyaan
              dokumen, sitasi membuka halaman, bagian, dan kutipan asal. Tautan sitasi hanya aktif bila potongan
              asal masih cocok. Yang tidak cocok ditolak.
            </p>
          </ScrollReveal>
          <div className="mt-s5 max-w-xl">
            <TimelineView nodes={AUDIT_NODES} />
          </div>
        </section>

        <SectionRule className="page-container" />

        {/* S6 Privasi dan batas: menjawab keberatan nyata sebelum CTA terakhir. FAQ = kontrak §2-S6. */}
        <section id="privasi" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <p className="eyebrow">Privasi</p>
            <h2 className="mt-s2 font-display text-title text-ink">Apa yang dibagikan, dan apa yang tidak</h2>
            <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
              Tombol Bagikan memunculkan ringkasan jumlah pesan, nama berkas, serta ada tidaknya angka dan
              kutipan. Anda memilih lanjut atau batal sebelum tautan dibuat. Halaman hasil bersifat read-only
              dan tidak meminta login. Tautan adalah salinan statis: perubahan setelahnya tidak muncul di
              tautan lama, dan tautan tidak bisa dicabut pada versi ini.
            </p>
            <h3 className="mt-s5 font-display text-label font-semibold text-ink">
              Pertanyaan yang sering muncul
            </h3>
          </ScrollReveal>
          <div className="mt-s2 max-w-2xl rounded-card-lg border border-[var(--border-hairline)] px-s4 py-s2 shadow-lift">
            <FaqAccordion items={FAQ_ITEMS} />
          </div>
        </section>

        {/* S7 CTA akhir: band gelap kedua; CTA menyala lime di atas forest (P2 tetap: satu per layar). */}
        <section className="relative overflow-hidden bg-forest text-porcelain">
          <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
          <div
            aria-hidden="true"
            className="glow-radial-lime absolute left-1/2 top-1/2 h-[380px] w-[640px] max-w-none -translate-x-1/2 -translate-y-1/2"
          />
          <div className="page-container relative flex flex-col items-center py-16 text-center md:py-24">
            <ScrollReveal className="flex flex-col items-center">
              <h2 className="text-title-cta max-w-[24ch] text-porcelain">Mulai dari data contoh</h2>
              <p className="mt-s3 max-w-[52ch] font-body text-body text-dark-muted">
                Buka Overview dengan dataset yang sudah siap. Tidak perlu mengunggah berkas untuk mencoba.
              </p>
              <div className="mt-s5">
                <LandingCTA tone="dark" />
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* S8 Footer: penutup dan navigasi internal yang nyata. Tanpa heading, tanpa empat kolom template. */}
        <footer className="border-t border-[var(--border-hairline)]">
          <div className="page-container py-s4">
            <div className="flex flex-wrap items-start justify-between gap-s4">
              <div>
                <p className="inline-flex items-center gap-s2 font-display text-label font-bold text-ink">
                  <span className="state-dot state-dot-active" aria-hidden="true" />
                  TanyaData
                </p>
                <p className="mt-s2 max-w-[52ch] font-body text-body text-ink">
                  TanyaData. Analisis data dengan SQL dan sitasi yang bisa ditelusur.
                </p>
                <p className="mt-s1 font-body text-caption text-ink-72">
                  Data contoh: 1 Agustus sampai 18 November 2026.
                </p>
              </div>
              <nav aria-label="Navigasi section landing" className="flex flex-wrap gap-s2">
                <Link
                  href="#bukti"
                  className="touch-44 inline-flex items-center font-body text-body text-ink-72 underline-offset-2 transition-colors duration-[var(--motion-fast)] hover:text-forest hover:underline focus-ring"
                >
                  Bukti nyata
                </Link>
                <Link
                  href="#cara-kerja"
                  className="touch-44 inline-flex items-center font-body text-body text-ink-72 underline-offset-2 transition-colors duration-[var(--motion-fast)] hover:text-forest hover:underline focus-ring"
                >
                  Cara kerja
                </Link>
                <Link
                  href="#privasi"
                  className="touch-44 inline-flex items-center font-body text-body text-ink-72 underline-offset-2 transition-colors duration-[var(--motion-fast)] hover:text-forest hover:underline focus-ring"
                >
                  Privasi dan batas
                </Link>
              </nav>
            </div>
            <div className="mt-s4 border-t border-[var(--border-hairline)] pt-s2">
              <p className="mono-meta">SQLite · SQL + FTS5 · READ ONLY</p>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
