import Link from 'next/link';
import { HeroHighlight } from '@/components/signal/hero-highlight';
import { SectionRule } from '@/components/signal/section-rule';
import { LandingCTA } from '@/components/signal/landing-cta';
import { LandingNav } from '@/components/signal/landing-nav';
import { LandingFeatures } from '@/components/signal/landing-features';
import { LandingSteps } from '@/components/signal/landing-steps';
import { LandingWorkspace } from '@/components/signal/landing-workspace';
import { FaqAccordion, type FaqItem } from '@/components/signal/landing-faq';
import { ScrollReveal } from '@/components/signal/scroll-reveal';
import { LandingPreviewCard } from '@/components/signal/landing-preview-card';

/*
 * Landing TanyaData sebagai pengantar produk SaaS RAG (arah user: general use,
 * bukan cerita riset internal). Konten lab (angka uji, ID kasus, tanggal run)
 * dihapus dari halaman ini; halaman menjual kemampuan produk: membaca dokumen,
 * menganalisis data, jawaban dengan sumber yang bisa dibuka. Data contoh tetap
 * ada di dalam produk (CTA menuju Overview), tetapi bukan materi promosi.
 */

/** FAQ produk. Sumber tunggal untuk tampilan dan JSON-LD FAQPage supaya keduanya identik. */
const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'penyimpanan',
    question: 'Apakah data saya diunggah ke layanan pihak ketiga?',
    answer: 'Tidak. Workspace berjalan di lingkungan Anda sendiri; berkas diproses di dalamnya.',
  },
  {
    id: 'sumber-jawaban',
    question: 'Apakah setiap jawaban menyertakan sumber?',
    answer:
      'Jawaban dokumen menyertakan kutipan halaman dan bagiannya; jawaban angka menyertakan data pendukungnya.',
  },
  {
    id: 'tidak-ditemukan',
    question: 'Bagaimana jika informasinya tidak ada di sumber?',
    answer:
      'Sistem menyatakan tidak ditemukan dan menawarkan topik yang tersedia, bukan mengarang jawaban.',
  },
  {
    id: 'tautan-login',
    question: 'Apakah tautan hasil perlu login?',
    answer: 'Tidak. Tautan bersifat read-only dan bisa dibuka tanpa akun.',
  },
];

/** JSON-LD FAQPage. Ditaruh di halaman ini karena FAQ hanya tampil di landing. */
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
        {/* S1 Hero: janji produk RAG dalam dua kolom. Kiri = unggah dan tanya;
            kanan = pratinjau antarmuka berlabel sebagai hook visual. */}
        <section data-nav-theme="dark" className="relative overflow-hidden bg-forest text-porcelain">
          <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
          <div
            aria-hidden="true"
            className="glow-radial-lime absolute -top-32 left-1/4 h-[460px] w-[760px] max-w-none -translate-x-1/2"
          />
          <div className="page-container relative pb-14 pt-16 md:pb-20 md:pt-20 lg:pt-24">
            <div className="grid items-center gap-s5 lg:grid-cols-12">
              <ScrollReveal className="lg:col-span-7">
                <HeroHighlight tone="dark" size="hero" highlight="Tanyakan isinya." className="mt-s4">
                  Unggah dokumen dan datanya. Tanyakan isinya.
                </HeroHighlight>
                <p className="mt-s4 max-w-[52ch] font-body text-body text-dark-muted">
                  TanyaData membaca dokumen PDF, DOCX, TXT, dan MD, menganalisis data CSV dan XLSX, lalu
                  menjawab pertanyaan Anda dalam bahasa sehari-hari dengan sumber yang bisa dibuka.
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
                      <p className="mono-meta">SITASI · FAQ CUSTOMER SUPPORT</p>
                      <p className="font-body text-caption text-ink-72">Halaman, bagian, dan kutipan asal</p>
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </section>

        {/* S2 Fitur utama: empat kemampuan inti produk. */}
        <section id="fitur" data-nav-theme="light" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <LandingFeatures />
          </ScrollReveal>
        </section>

        {/* S3 Cara kerja: band gelap (ritme selang-seling dengan fitur yang terang);
            empat langkah dalam kolom berpemisah garis, nomor lime besar. */}
        <section id="cara-kerja" data-nav-theme="dark" className="relative overflow-hidden bg-forest text-porcelain">
          <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
          <div
            aria-hidden="true"
            className="glow-radial-lime absolute -bottom-40 left-1/3 h-[320px] w-[520px] max-w-none"
          />
          <div className="page-container relative py-16 md:py-24">
            <ScrollReveal>
              <LandingSteps />
            </ScrollReveal>
          </div>
        </section>

        {/* S4 Di dalam workspace: enam halaman aplikasi yang nyata (rute asli). */}
        <section id="workspace" data-nav-theme="light" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <LandingWorkspace />
          </ScrollReveal>
        </section>

        <SectionRule className="page-container" />

        {/* S5 FAQ: band gelap (ritme selang-seling setelah workspace terang);
            header kiri, accordion kanan dengan aksen lime saat terbuka. */}
        <section id="faq" data-nav-theme="dark" className="relative overflow-hidden bg-forest text-porcelain">
          <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
          <div
            aria-hidden="true"
            className="glow-radial-lime absolute -bottom-40 right-1/4 h-[300px] w-[480px] max-w-none"
          />
          <div className="page-container relative py-16 md:py-24">
            <div className="grid gap-s5 lg:grid-cols-12">
              <ScrollReveal className="lg:col-span-5">
                <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
                  Pertanyaan umum
                </p>
                <h2 className="mt-s2 font-display text-title text-porcelain">
                  Hal yang biasa ditanyakan sebelum mulai
                </h2>
                <p className="mt-s2 max-w-[52ch] font-body text-body text-dark-muted">
                  Masih ada yang ingin ditanyakan? Coba langsung dengan data contoh di workspace.
                </p>
              </ScrollReveal>
              <ScrollReveal className="lg:col-span-7" delay={100}>
                <FaqAccordion items={FAQ_ITEMS} tone="dark" />
              </ScrollReveal>
            </div>
          </div>
        </section>

        {/* S6 CTA akhir: section terang berisi kartu CTA gelap (beda dari band gelap
            FAQ di atasnya); CTA menyala lime tetap satu-satunya per layar. */}
        <section data-nav-theme="light" className="page-container py-16 md:py-24">
          <ScrollReveal>
            <div className="relative overflow-hidden rounded-card-lg border border-hairline-dark bg-forest px-s4 py-12 text-center text-porcelain md:py-16">
              <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
              <div
                aria-hidden="true"
                className="glow-radial-lime absolute left-1/2 top-1/2 h-[320px] w-[560px] max-w-none -translate-x-1/2 -translate-y-1/2"
              />
              <div className="relative flex flex-col items-center">
                <h2 className="text-title-cta max-w-[24ch] text-porcelain">Mulai dari data contoh</h2>
                <p className="mt-s3 max-w-[52ch] font-body text-body text-dark-muted">
                  Buka workspace dengan dataset dan dokumen yang sudah siap. Tidak perlu setup untuk mencoba.
                </p>
                <div className="mt-s5">
                  <LandingCTA tone="dark" />
                </div>
              </div>
            </div>
          </ScrollReveal>
        </section>

        {/* S7 Footer: identitas + navigasi section yang nyata. Tagline dari PRD. */}
        <footer data-nav-theme="light" className="border-t border-[var(--border-hairline)]">
          <div className="page-container py-s4">
            <div className="flex flex-wrap items-start justify-between gap-s4">
              <div>
                <p className="inline-flex items-center gap-s2 font-display text-label font-bold text-ink">
                  <span className="state-dot state-dot-active" aria-hidden="true" />
                  TanyaData
                </p>
                <p className="mt-s2 max-w-[52ch] font-body text-body text-ink">
                  TanyaData. Tanyakan datanya, temukan wawasannya.
                </p>
                <p className="mt-s1 font-body text-caption text-ink-72">
                  Untuk dokumen dan data Anda, dengan jawaban yang bisa ditelusur.
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
                  href="#workspace"
                  className="touch-44 inline-flex items-center font-body text-body text-ink-72 underline-offset-2 transition-colors duration-[var(--motion-fast)] hover:text-forest hover:underline focus-ring"
                >
                  Workspace
                </Link>
                <Link
                  href="#faq"
                  className="touch-44 inline-flex items-center font-body text-body text-ink-72 underline-offset-2 transition-colors duration-[var(--motion-fast)] hover:text-forest hover:underline focus-ring"
                >
                  FAQ
                </Link>
              </nav>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
