import Link from 'next/link';
import { HeroHighlight } from '@/components/signal/hero-highlight';
import { SectionRule } from '@/components/signal/section-rule';
import { LandingCTA } from '@/components/signal/landing-cta';
import { LandingNav } from '@/components/signal/landing-nav';
import { LandingFeatures } from '@/components/signal/landing-features';
import { LandingWorkflow } from '@/components/signal/landing-workflow';
import { LandingEvidenceBand } from '@/components/signal/landing-evidence-band';
import { LandingAudit } from '@/components/signal/landing-audit';
import { LandingFormatPanel } from '@/components/signal/landing-format-panel';
import { FaqAccordion, type FaqItem } from '@/components/signal/landing-faq';
import { ScrollReveal } from '@/components/signal/scroll-reveal';
import { LandingPreviewCard } from '@/components/signal/landing-preview-card';

/*
 * Landing TanyaData. Susunan feature-forward sesuai arahan user: fitur ditonjolkan
 * dengan mini-demo (bukan narasi), angka uji menjadi bukti kompak. Setiap section
 * dirancang oleh subagent terpisah lalu diintegrasikan. Copy inti dari
 * docs/LANDING_COPY_SEO.md; semua angka dari berkas uji tercatat
 * (tanyadata/docs/ROBUSTNESS_REAL_DOCS.md dan tanyadata/docs/EVAL_RESULTS.md).
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

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSONLD) }}
      />
      <LandingNav />
      <main>
        {/* S1 Hero: band gelap dua kolom. Kiri = janji + CTA; kanan = pratinjau produk
            (kartu SQL + kartu sitasi menumpuk) sebagai hook visual, bukan white space. */}
        <section className="relative overflow-hidden bg-forest text-porcelain">
          <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
          <div
            aria-hidden="true"
            className="glow-radial-lime absolute -top-32 left-1/4 h-[460px] w-[760px] max-w-none -translate-x-1/2"
          />
          <div className="page-container relative pb-16 pt-32 md:pb-20 md:pt-44">
            <div className="grid items-center gap-s5 lg:grid-cols-12">
              <ScrollReveal className="lg:col-span-7">
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
                    href="#fitur"
                    className="touch-44 inline-flex items-center rounded-button-lg border border-hairline-dark px-s4 font-display text-label font-semibold text-porcelain transition-colors duration-[var(--motion-fast)] hover:border-porcelain focus-ring"
                  >
                    Lihat fiturnya
                  </Link>
                </div>
                <p className="mt-s4 inline-flex items-center rounded-chip border border-hairline-dark px-s3 py-1 font-body text-caption tabular text-dark-muted">
                  Data contoh: 46.952 transaksi · 1 sampai 18 November 2026.
                </p>
              </ScrollReveal>
              <ScrollReveal className="relative lg:col-span-5" delay={120}>
                <div
                  aria-hidden="true"
                  className="glow-radial-lime absolute -inset-8 hidden lg:block"
                />
                <div className="relative">
                  <LandingPreviewCard />
                  <div className="mt-3 inline-flex items-center gap-s2 rounded-card-lg border border-hairline-dark bg-porcelain px-s3 py-s2 shadow-float md:absolute md:-right-3 md:-top-6 md:mt-0">
                    <span className="state-dot state-dot-active" aria-hidden="true" />
                    <div>
                      <p className="mono-meta">SITASI · LAPORAN SEPT 2026 · BAGIAN 1</p>
                      <p className="font-body text-caption text-ink-72">Halaman, bagian, dan kutipan asal</p>
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </section>

        {/* S2 Fitur utama: tiga jaminan jawaban dengan mini-demo (subagent, komponen LandingFeatures). */}
        <section id="fitur" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <LandingFeatures />
          </ScrollReveal>
        </section>

        <SectionRule className="page-container" />

        {/* S3 Cara kerja: lima FR sebagai daftar editorial bernomor (subagent, LandingWorkflow). */}
        <section id="cara-kerja" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <LandingWorkflow />
          </ScrollReveal>
        </section>

        <SectionRule className="page-container" />

        {/* S4 Bukti uji: banner angka utama + strip stat kompak (subagent, LandingEvidenceBand). */}
        <section id="bukti" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <LandingEvidenceBand />
          </ScrollReveal>
        </section>

        <SectionRule className="page-container" />

        {/* S5 Kapabilitas dokumen: panel gelap dengan tabs dua kelompok format (C-04 tone dark). */}
        <section id="format" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <p className="eyebrow">Format diterima</p>
            <h2 className="mt-s2 font-display text-title text-ink">Enam format yang diterima</h2>
            <p className="mt-s2 max-w-[68ch] font-body text-body text-ink-72">
              Data terstruktur: CSV, XLSX, dan SQL. Dokumen: PDF, DOCX, dan TXT. Uji robust memakai 6 dokumen
              nyata berupa TXT, MD, DOCX, dan tiga PDF. Berkas MD diperlakukan sebagai teks.
            </p>
            <div className="mt-s5 max-w-3xl">
              <LandingFormatPanel />
            </div>
          </ScrollReveal>
        </section>

        <SectionRule className="page-container" />

        {/* S6 Jejak audit: garis waktu + sampel nyata dua sisi (subagent, LandingAudit). */}
        <section id="audit" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <LandingAudit />
          </ScrollReveal>
        </section>

        <SectionRule className="page-container" />

        {/* S7 Privasi dan batas: dua kolom, copy kiri dan FAQ kanan. FAQ = kontrak §2-S6. */}
        <section id="privasi" className="page-container py-16 md:py-24">
          <div className="grid gap-s5 lg:grid-cols-12">
            <ScrollReveal className="lg:col-span-5">
              <p className="eyebrow">Privasi</p>
              <h2 className="mt-s2 font-display text-title text-ink">Apa yang dibagikan, dan apa yang tidak</h2>
              <p className="mt-s2 max-w-[52ch] font-body text-body text-ink-72">
                Tombol Bagikan memunculkan ringkasan jumlah pesan, nama berkas, serta ada tidaknya angka dan
                kutipan. Anda memilih lanjut atau batal sebelum tautan dibuat. Halaman hasil bersifat read-only
                dan tidak meminta login. Tautan adalah salinan statis: perubahan setelahnya tidak muncul di
                tautan lama, dan tautan tidak bisa dicabut pada versi ini.
              </p>
            </ScrollReveal>
            <ScrollReveal className="lg:col-span-7" delay={100}>
              <h3 className="font-display text-label font-semibold text-ink">
                Pertanyaan yang sering muncul
              </h3>
              <div className="mt-s2 rounded-card-lg border border-[var(--border-hairline)] px-s4 py-s2 shadow-lift">
                <FaqAccordion items={FAQ_ITEMS} />
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* S8 CTA akhir: band gelap penutup; CTA menyala lime di atas forest (P2 tetap: satu per layar). */}
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

        {/* S9 Footer: penutup dan navigasi internal yang nyata. Tanpa heading, tanpa empat kolom template. */}
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
                  href="#fitur"
                  className="touch-44 inline-flex items-center font-body text-body text-ink-72 underline-offset-2 transition-colors duration-[var(--motion-fast)] hover:text-forest hover:underline focus-ring"
                >
                  Fitur
                </Link>
                <Link
                  href="#cara-kerja"
                  className="touch-44 inline-flex items-center font-body text-body text-ink-72 underline-offset-2 transition-colors duration-[var(--motion-fast)] hover:text-forest hover:underline focus-ring"
                >
                  Cara kerja
                </Link>
                <Link
                  href="#bukti"
                  className="touch-44 inline-flex items-center font-body text-body text-ink-72 underline-offset-2 transition-colors duration-[var(--motion-fast)] hover:text-forest hover:underline focus-ring"
                >
                  Bukti nyata
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
