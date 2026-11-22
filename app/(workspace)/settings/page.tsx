'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MetaResponse, SettingsResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { useI18n } from '@/lib/ui/i18n-provider';
import { formatDateRangeId, formatNumber } from '@/lib/ui/format';
import { BentoGrid, type BentoItem } from '@/components/signal/bento-grid';
import { AnimatedTabs } from '@/components/signal/animated-tabs';
import { SectionRule } from '@/components/signal/section-rule';
import { StatusBadge } from '@/components/signal/status-badge';
import { Icon } from '@/components/ui/icons';
import { toast } from '@/components/ui/toaster';

/** Nilai preset mengikuti kontrak API §9.1, bukan label panjang rekaan. */
const PRESETS = [
  { id: 'this_month', label: 'Bulan ini' },
  { id: 'last_7_days', label: '7 hari terakhir' },
  { id: 'last_30_days', label: '30 hari terakhir' },
  { id: 'custom', label: 'Kustom' },
] as const;

const CHART_TYPES = [
  { id: 'bar', label: 'Batang' },
  { id: 'line', label: 'Garis' },
  { id: 'pie', label: 'Lingkaran' },
] as const;

const TABS = [
  { id: 'general', label: 'Umum' },
  { id: 'assistant', label: 'Asisten' },
  { id: 'about', label: 'Tentang' },
] as const;

type TabId = (typeof TABS)[number]['id'];
type Notice = 'hidden' | 'draft' | 'saved';

const INPUT_CLASS =
  'min-h-11 w-full rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 font-body text-body text-ink placeholder:text-ink-72 focus-ring';

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-s1">
      <label htmlFor={id} className="font-display text-label font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="font-body text-caption text-ink-72">{hint}</p>}
    </div>
  );
}

function ChoiceGroup({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: readonly { id: string; label: string }[];
  value: string;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-s2">
      <legend className="font-display text-label font-semibold text-ink">{label}</legend>
      <div className="grid grid-cols-1 gap-s2 sm:grid-cols-3">
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(option.id)}
              className={`touch-44 rounded-control border px-s3 font-display text-label font-semibold transition-colors duration-[var(--motion-fast)] focus-ring ${
                selected
                  ? 'border-forest bg-forest text-porcelain'
                  : 'border-[var(--border-hairline)] text-ink-72 hover:border-forest hover:text-forest'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-s2 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3">
      <dt className="font-body text-body text-ink-72">{label}</dt>
      <dd className="mono-meta text-right normal-case">{value}</dd>
    </div>
  );
}

/**
 * Settings: band gelap struktural di kepala halaman (eyebrow dataset, H1, status
 * penyimpanan ringkas, kontrol simpan tone dark), lalu zona terang dengan kartu
 * form surface rounded-card-lg per tab dan pemisah SectionRule. Semua nilai
 * berasal dari /api/settings + /api/meta. Field kosong dibiarkan kosong dengan
 * placeholder jujur, bukan identitas rekaan (P7).
 */
export default function SettingsPage() {
  const settings = useApi<SettingsResponse>('/api/settings');
  const meta = useApi<MetaResponse>('/api/meta');
  const { lang, setLang } = useI18n();

  const [preset, setPreset] = useState<string>('this_month');
  const [chartDefault, setChartDefault] = useState<string>('bar');
  const [denseTables, setDenseTables] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>('hidden');
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback((data: SettingsResponse | null) => {
    setPreset(data && PRESETS.some((item) => item.id === data.dateRange.preset) ? data.dateRange.preset : 'this_month');
    setChartDefault(data?.preferences.chartDefault ?? 'bar');
    setDenseTables(data?.preferences.denseTables ?? true);
  }, []);

  useEffect(() => {
    if (!settings.data) return;
    resetForm(settings.data);
  }, [settings.data, resetForm]);

  const markDirty = () => {
    setDirty(true);
    setNotice((current) => (current === 'saved' ? 'draft' : current === 'hidden' ? 'draft' : current));
  };

  const changeLang = async (next: 'id' | 'en') => {
    if (next === lang) return;
    setLang(next);
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: next }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Bahasa gagal diperbarui.');
      }
      settings.retry();
    } catch (error) {
      setLang(next === 'en' ? 'id' : 'en');
      toast({ status: 'error', message: error instanceof Error ? error.message : 'Bahasa gagal diperbarui.' });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const range = settings.data?.dateRange;
      const body: Record<string, unknown> = {
        lang,
        preferences: { chartDefault, denseTables },
      };
      if (range?.start && range.end) {
        body.dateRange = { start: range.start, end: range.end, preset };
      }
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? 'Pengaturan gagal disimpan.');
      }
      setDirty(false);
      setNotice('saved');
      settings.retry();
      window.setTimeout(() => setNotice('hidden'), 2500);
    } catch (error) {
      toast({ status: 'error', message: error instanceof Error ? error.message : 'Pengaturan gagal disimpan.' });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    resetForm(settings.data);
    setDirty(false);
    setNotice('hidden');
  };

  const documentsTotal = meta.data?.data.documents.total ?? null;
  const rangeLabel =
    meta.data?.data.periodDefaults.label ??
    (settings.data?.dateRange.start && settings.data.dateRange.end
      ? formatDateRangeId(settings.data.dateRange.start, settings.data.dateRange.end)
      : 'Belum tersedia');
  const presetLabel = PRESETS.find((item) => item.id === preset)?.label ?? 'Kustom';
  const chartLabel = CHART_TYPES.find((item) => item.id === chartDefault)?.label ?? 'Batang';

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
      { id: 'range', label: 'Rentang bawaan', value: rangeLabel, source: presetLabel.toUpperCase() },
      { id: 'chart', label: 'Grafik', value: chartLabel, source: 'BAWAAN' },
    ],
    [lang, rangeLabel, presetLabel, documentsTotal, chartLabel],
  );

  // Pasangan metrik kecil di band gelap: status ringkas dari data existing.
  const bandPairs = [
    { id: 'lang', label: 'Bahasa', value: lang === 'id' ? 'Bahasa Indonesia' : 'English' },
    { id: 'documents', label: 'Dokumen', value: documentsTotal !== null ? formatNumber(documentsTotal) : '—' },
    { id: 'range', label: 'Rentang bawaan', value: presetLabel },
  ];

  // Status penyimpanan untuk band: bacaan presentasi dari state dirty/saving/notice.
  const saveStatusLabel = saving ? 'Menyimpan…' : dirty ? 'Perubahan belum disimpan' : 'Tersimpan';

  return (
    <>
      {/* Band gelap struktural: kepala halaman + status pengaturan ringkas + kontrol
          simpan tone dark di dalam band, idiom grid+glow band Ringkasan/Asisten. */}
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
            Atur bahasa, preferensi tampilan, dan lihat status kapabilitas workspace.
          </p>

          <div className="mt-s5 grid items-end gap-s4 lg:grid-cols-12">
            {/* Stat kiri: status penyimpanan, bacaan dari state dirty/saving/notice existing. */}
            <div className="min-w-0 lg:col-span-5">
              <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
                Status penyimpanan
              </p>
              {settings.loading ? (
                <div aria-busy="true" aria-label="Memuat status pengaturan">
                  <span
                    className="animate-skeleton mt-s2 block h-s6 w-44 rounded-control bg-porcelain/10"
                    aria-hidden="true"
                  />
                </div>
              ) : (
                <p className="mt-s2 font-body text-title text-porcelain">
                  {settings.error ? '—' : saveStatusLabel}
                </p>
              )}
              <p className="mt-s2 font-mono text-[11px] uppercase tracking-[0.06em] text-dark-muted">
                PENGATURAN LOKAL · TANPA AKUN
              </p>
            </div>
            {/* Pasangan metrik kecil: bahasa, dataset aktif, rentang bawaan. */}
            <dl className="grid grid-cols-1 gap-s4 sm:grid-cols-3 lg:col-span-7">
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
                      '—'
                    ) : (
                      pair.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Kontrol kepala halaman, skin gelap band: badge notice + Buang (dot terracotta)
              + Simpan. Handler dan state disabled sama dengan bar simpan di bawah. */}
          <div className="mt-s5 flex flex-wrap items-center gap-s2">
            {notice !== 'hidden' && (
              <StatusBadge
                label={notice === 'saved' ? 'Tersimpan' : 'Perubahan belum disimpan'}
                tone={notice === 'saved' ? 'active' : 'loading'}
                className="bg-porcelain"
              />
            )}
            <button
              type="button"
              onClick={discard}
              disabled={!dirty}
              className="touch-44 inline-flex items-center gap-s2 rounded-control border border-hairline-dark px-s3 font-display text-label font-semibold text-porcelain transition-colors hover:border-porcelain focus-ring disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="state-dot state-dot-error" aria-hidden="true" />
              Buang
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty}
              aria-busy={saving}
              className="touch-44 rounded-control bg-lime px-s3 font-display text-label font-semibold text-ink focus-ring disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving ? 'Menyimpan' : 'Simpan perubahan'}
            </button>
          </div>
        </div>
      </section>

      {/* Zona kerja terang: bento ringkasan, kartu sumber data, form per tab, bar simpan. */}
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
            {/* Purpose Gate: bento menyatakan konfigurasi mana yang paling berpengaruh. */}
            <section aria-label="Ringkasan pengaturan" className="mt-s5">
              <BentoGrid items={bentoItems} />
            </section>

            <SectionRule className="mt-s5" />

            <AnimatedTabs
              tabs={TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
              activeId={activeTab}
              onChange={(id) => setActiveTab(id as TabId)}
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
                      Bahasa, zona waktu, dan rentang tanggal bawaan.
                    </p>
                  </div>
                  <span className="mono-meta">ANTARMUKA · {lang === 'id' ? 'ID' : 'EN'}</span>
                </div>
                <SectionRule />
                <div className="grid grid-cols-1 gap-s4 md:grid-cols-2">
                  <ChoiceGroup
                    label="Bahasa antarmuka"
                    options={[
                      { id: 'id', label: 'Bahasa Indonesia' },
                      { id: 'en', label: 'English' },
                    ]}
                    value={lang}
                    onSelect={(id) => void changeLang(id as 'id' | 'en')}
                  />
                  <Field id="ws-zone" label="Zona waktu" hint="Label waktu mengikuti Asia/Jakarta.">
                    <div id="ws-zone" className="flex min-h-11 items-center rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 font-body text-body text-ink-72">
                      UTC+07:00 · Jakarta
                    </div>
                  </Field>
                  <label className="flex min-h-11 items-start gap-s3 rounded-control border border-[var(--border-hairline)] bg-porcelain p-s3">
                    <input
                      type="checkbox"
                      checked={denseTables}
                      onChange={(event) => {
                        setDenseTables(event.target.checked);
                        markDirty();
                      }}
                      className="mt-s1 h-4 w-4 accent-forest"
                    />
                    <span className="flex flex-col gap-s1">
                      <span className="font-display text-label font-semibold text-ink">Tabel ringkas</span>
                      <span className="font-body text-caption text-ink-72">Gunakan jarak baris lebih rapat pada tabel analitik.</span>
                    </span>
                  </label>
                  <div className="md:col-span-2">
                    <Field id="ws-range" label="Rentang tanggal bawaan" hint="Diterapkan pada dashboard dan pertanyaan baru.">
                      <select
                        id="ws-range"
                        value={preset}
                        onChange={(event) => {
                          setPreset(event.target.value);
                          markDirty();
                        }}
                        className={INPUT_CLASS}
                      >
                        {PRESETS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <p className="mono-meta mt-s2">{rangeLabel}</p>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'assistant' && (
              <section
                aria-labelledby="panel-assistant"
                className="surface rounded-card-lg mt-s4 flex flex-col gap-s4 p-s4 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none md:p-s5"
              >
                <div className="flex flex-wrap items-start justify-between gap-s2">
                  <div>
                    <h2 id="panel-assistant" className="font-display text-title text-ink">
                      Asisten
                    </h2>
                    <p className="mt-s1 font-body text-caption text-ink-72">
                      Grafik bawaan jawaban dan status kapabilitas mesin.
                    </p>
                  </div>
                  <span className="mono-meta">
                    {meta.data ? `SQL · ${meta.data.capabilities.rag.toUpperCase()}` : 'KAPABILITAS · BELUM TERSEDIA'}
                  </span>
                </div>
                <SectionRule />
                <ChoiceGroup
                  label="Jenis grafik bawaan"
                  options={CHART_TYPES}
                  value={chartDefault}
                  onSelect={(id) => {
                    setChartDefault(id);
                    markDirty();
                  }}
                />
                <dl className="grid grid-cols-1 gap-s2 md:grid-cols-2">
                  <InfoRow label="Mesin SQL" value={meta.data?.capabilities.sql ?? 'Belum tersedia'} />
                  <InfoRow label="Pengambilan dokumen" value={meta.data?.capabilities.rag ?? 'Belum tersedia'} />
                  <InfoRow label="Bantuan model bahasa" value={meta.data ? (meta.data.capabilities.llm ? 'Aktif' : 'Nonaktif') : 'Belum tersedia'} />
                </dl>
              </section>
            )}

            {activeTab === 'about' && (
              <section
                aria-labelledby="panel-about"
                className="surface rounded-card-lg mt-s4 flex flex-col gap-s4 p-s4 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none md:p-s5"
              >
                <div className="flex flex-wrap items-start justify-between gap-s2">
                  <div>
                    <h2 id="panel-about" className="font-display text-title text-ink">
                      Tentang
                    </h2>
                    <p className="mt-s1 font-body text-caption text-ink-72">
                      Informasi build dan lingkup akses workspace.
                    </p>
                  </div>
                  <span className="mono-meta">VERSI · {meta.data?.app.version ?? 'BELUM TERSEDIA'}</span>
                </div>
                <SectionRule />
                <dl className="grid grid-cols-1 gap-s2 md:grid-cols-2">
                  <InfoRow label="Aplikasi" value={meta.data?.app.name ?? 'TanyaData'} />
                  <InfoRow label="Versi" value={meta.data?.app.version ?? 'Belum tersedia'} />
                  <InfoRow label="Build" value={meta.data?.app.build ?? 'Belum tersedia'} />
                  <InfoRow label="Akses" value="Hanya baca" />
                  <InfoRow label="Akun" value="Satu workspace lokal" />
                  <InfoRow label="Zona waktu" value="Asia/Jakarta" />
                </dl>
                <p className="max-w-[68ch] font-body text-caption text-ink-72">
                  Perubahan disimpan di workspace lokal ini. Tidak ada data yang dikirim ke layanan eksternal.
                </p>
              </section>
            )}

            {/* Bar simpan sticky: aksi utama tetap tersedia di ujung viewport.
                Buang diberi dot terracotta (treatment hati-hati), logika tidak berubah. */}
            <div className="sticky bottom-s3 z-sticky mt-s5 flex flex-col gap-s2 rounded-control border border-[var(--border-hairline)] bg-porcelain p-s2 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-body text-caption text-ink-72">Perubahan hanya berlaku setelah disimpan.</p>
              <div className="flex flex-wrap items-center gap-s2">
                <button
                  type="button"
                  onClick={discard}
                  disabled={!dirty}
                  className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink-72 hover:border-forest hover:text-forest focus-ring disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="state-dot state-dot-error" aria-hidden="true" />
                  Buang
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || !dirty}
                  aria-busy={saving}
                  className="touch-44 inline-flex items-center gap-s2 rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Icon name="save" className="text-[16px]" />
                  {saving ? 'Menyimpan' : 'Simpan perubahan'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
