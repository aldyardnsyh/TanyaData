'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MetaResponse, SettingsResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { apiUrl } from '@/lib/ui/api-base';
import { useI18n } from '@/lib/ui/i18n-provider';
import { formatNumber } from '@/lib/ui/format';
import { AboutPanel } from '@/components/settings/about-panel';
import { BentoGrid, type BentoItem } from '@/components/signal/bento-grid';
import { AnimatedTabs } from '@/components/signal/animated-tabs';
import { SectionRule } from '@/components/signal/section-rule';
import { StatusBadge } from '@/components/signal/status-badge';
import { toast } from '@/components/ui/toaster';

/**
 * Dua tab. Cakupan data yang dipakai asisten diatur dari page Data Sources
 * (tiket SET-03), bukan dari Pengaturan; tab Asisten dihapus beserta
 * seluruh logika dataset/rentang tanggal miliknya.
 */
const TABS = [
  { id: 'general', label: 'Umum' },
  { id: 'about', label: 'Tentang' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Settings: band gelap struktural (eyebrow, H1, status, ringkasan), lalu zona
 * terang dengan kartu form per tab. `Umum` = bahasa antarmuka (tersimpan
 * langsung saat dipilih), `Tentang` = dokumentasi sistem read-only (§J,
 * AboutPanel). Kontrol yang tidak mengubah perilaku tidak dirender.
 */
export default function SettingsPage() {
  const settings = useApi<SettingsResponse>('/api/settings');
  const meta = useApi<MetaResponse>('/api/meta');
  const { lang, setLang } = useI18n();

  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [langSaving, setLangSaving] = useState(false);
  const [langSaved, setLangSaved] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');

  useEffect(() => {
    if (!langSaved) return;
    const timer = window.setTimeout(() => setLangSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [langSaved]);

  const changeLang = async (next: 'id' | 'en') => {
    if (next === lang || langSaving) return;
    const previous = lang;
    setLang(next);
    setLangSaving(true);
    try {
      const response = await fetch(apiUrl('/api/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: next }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Bahasa gagal diperbarui.');
      }
      setLiveMessage('Bahasa diperbarui.');
      setLangSaved(true);
      settings.retry();
    } catch (error) {
      setLang(previous);
      toast({ status: 'error', message: error instanceof Error ? error.message : 'Bahasa gagal diperbarui.' });
    } finally {
      setLangSaving(false);
    }
  };

  const documentsTotal = meta.data?.data.documents.total ?? null;

  const bentoItems: BentoItem[] = useMemo(
    () => [
      {
        id: 'documents',
        label: 'Dokumen',
        value: documentsTotal !== null ? formatNumber(documentsTotal) : 'Belum tersedia',
        source: 'TERINDEKS',
        span: 'hero',
      },
      { id: 'lang', label: 'Bahasa', value: lang === 'id' ? 'ID' : 'EN', source: 'ANTARMUKA' },
    ],
    [lang, documentsTotal],
  );

  // Pasangan metrik kecil di band gelap: bacaan dari data yang benar-benar ada.
  const bandPairs = [
    { id: 'lang', label: 'Bahasa', value: lang === 'id' ? 'Bahasa Indonesia' : 'English' },
    {
      id: 'documents',
      label: 'Dokumen',
      value: documentsTotal !== null ? formatNumber(documentsTotal) : 'Tidak tersedia',
    },
  ];

  const langStatus = langSaving ? 'Menyimpan…' : langSaved ? liveMessage || 'Tersimpan' : 'Tersimpan';

  return (
    <>
      {/* Band gelap struktural: kepala halaman + status ringkas. Tanpa kontrol
          simpan: satu-satunya pengaturan mutable (bahasa) tersimpan saat dipilih. */}
      <section
        data-nav-theme="dark"
        aria-label="Pengaturan workspace"
        className="relative overflow-hidden bg-forest text-porcelain"
      >
        <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
        <div
          aria-hidden="true"
          className="glow-radial-lime absolute -right-24 -top-28 h-[320px] w-[440px] max-w-none"
        />
        <div className="page-container relative pb-s5 pt-s5">
          <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
            TanyaData
          </p>
          <h1 className="mt-s2 font-display text-display text-porcelain">Pengaturan</h1>
          <p className="mt-s2 max-w-[52ch] font-body text-body text-dark-muted">
            Atur bahasa antarmuka. Cakupan data asisten diatur dari Data Sources, dan status sistem
            ada di Tentang.
          </p>

          <div className="mt-s5 grid items-end gap-s4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-5">
              <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
                Status pengaturan
              </p>
              <p role="status" aria-live="polite" className="mt-s2 font-body text-title text-porcelain">
                {settings.loading ? (
                  <span
                    className="animate-skeleton mt-s2 block h-s6 w-44 rounded-control bg-porcelain/10"
                    aria-hidden="true"
                  />
                ) : settings.error ? (
                  'Tidak tersedia'
                ) : (
                  langStatus
                )}
              </p>
              <p className="mt-s2 font-mono text-[11px] uppercase tracking-[0.06em] text-dark-muted">
                PENGATURAN LOKAL · TANPA AKUN
              </p>
            </div>
            <dl className="grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:col-span-7">
              {bandPairs.map((pair) => (
                <div key={pair.id} className="min-w-0">
                  <dt className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
                    {pair.label}
                  </dt>
                  <dd className="mt-s1 truncate font-body text-metric tabular text-porcelain">
                    {settings.loading ? (
                      <span
                        className="animate-skeleton inline-block h-s5 w-28 rounded-control bg-porcelain/10"
                        aria-hidden="true"
                      />
                    ) : settings.error ? (
                      'Tidak tersedia'
                    ) : (
                      pair.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Zona kerja terang: ringkasan, tab, panel per tab. */}
      <div className="page-container pb-s6" data-nav-theme="light">
        {settings.loading ? (
          <div className="pt-s5" aria-busy="true">
            <BentoGrid items={[]} state="loading" />
            <div className="mt-s5 flex gap-s2">
              {TABS.map((tab) => <div key={tab.id} className="skeleton h-s5 w-24" />)}
            </div>
            <div className="mt-s5 grid grid-cols-1 gap-s3 md:grid-cols-2">
              {[0, 1, 2, 3].map((index) => <div key={index} className="skeleton h-32 w-full" />)}
            </div>
          </div>
        ) : settings.error ? (
          <div className="surface mt-s5 flex flex-col items-start gap-s3 p-s4" role="alert">
            <StatusBadge label="Gagal memuat" tone="error" />
            <p className="font-body text-body text-ink">{settings.error}</p>
            <button
              type="button"
              onClick={settings.retry}
              className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring"
            >
              Coba lagi
            </button>
          </div>
        ) : (
          <>
            <section aria-label="Ringkasan pengaturan" className="mt-s5">
              <BentoGrid items={bentoItems} />
            </section>

            <SectionRule className="mt-s5" />

            <AnimatedTabs
              tabs={TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
              activeId={activeTab}
              onChange={(id) => setActiveTab(id as TabId)}
              ariaLabel="Bagian pengaturan"
              className="mt-s5"
            />

            {activeTab === 'general' && (
              <section
                aria-labelledby="panel-general"
                className="surface rounded-card-lg mt-s4 flex flex-col gap-s4 p-s4 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none md:p-s5"
              >
                <div className="flex flex-wrap items-start justify-between gap-s2">
                  <div>
                    <h2 id="panel-general" className="font-display text-title text-ink">
                      Umum
                    </h2>
                    <p className="mt-s1 font-body text-caption text-ink-72">
                      Bahasa yang dipakai seluruh antarmuka. Tersimpan langsung saat dipilih.
                    </p>
                  </div>
                  <span className="mono-meta">ANTARMUKA · {lang === 'id' ? 'ID' : 'EN'}</span>
                </div>
                <SectionRule />
                <fieldset className="flex flex-col gap-s2" disabled={langSaving}>
                  <legend className="font-display text-label font-semibold text-ink">
                    Bahasa antarmuka
                  </legend>
                  <div className="grid grid-cols-1 gap-s2 sm:grid-cols-2">
                    {[
                      { id: 'id' as const, label: 'Bahasa Indonesia' },
                      { id: 'en' as const, label: 'English' },
                    ].map((option) => {
                      const selected = option.id === lang;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => void changeLang(option.id)}
                          className={`touch-44 rounded-control border px-s3 font-display text-label font-semibold transition-colors duration-[var(--motion-fast)] focus-ring ${
                            selected
                              ? 'border-forest bg-forest text-porcelain'
                              : 'border-[var(--border-hairline)] text-ink-72 hover:border-forest hover:text-forest'
                          } disabled:cursor-not-allowed disabled:opacity-45`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </section>
            )}

            {activeTab === 'about' && (
              <section aria-labelledby="panel-about" className="mt-s4 flex flex-col gap-s4">
                <div className="flex flex-wrap items-start justify-between gap-s2">
                  <div>
                    <h2 id="panel-about" className="font-display text-title text-ink">
                      Tentang
                    </h2>
                    <p className="mt-s1 font-body text-caption text-ink-72">
                      Cara kerja sistem, teknologi, dan batasannya. Hanya baca.
                    </p>
                  </div>
                  <span className="mono-meta">
                    VERSI · {meta.data?.app.version ?? 'BELUM TERSEDIA'}
                  </span>
                </div>
                <SectionRule />
                <AboutPanel
                  meta={meta.data}
                  loading={meta.loading}
                  error={meta.error}
                  onRetry={meta.retry}
                />
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
