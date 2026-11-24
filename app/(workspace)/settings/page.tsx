'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MetaResponse, SettingsResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { useI18n } from '@/lib/ui/i18n-provider';
import { formatDateId, formatDateRangeId, formatNumber } from '@/lib/ui/format';
import { AboutPanel } from '@/components/settings/about-panel';
import { BentoGrid, type BentoItem } from '@/components/signal/bento-grid';
import { AnimatedTabs } from '@/components/signal/animated-tabs';
import { SectionRule } from '@/components/signal/section-rule';
import { StatusBadge } from '@/components/signal/status-badge';
import { Icon } from '@/components/ui/icons';
import { toast } from '@/components/ui/toaster';

/** Empat preset cepat. Nilai id mengikuti kontrak API §9.1 (`lib/settings.ts` PRESETS). */
const PRESETS = [
  { id: 'this_month', label: 'Bulan ini' },
  { id: 'last_7_days', label: '7 hari' },
  { id: 'last_30_days', label: '30 hari' },
  { id: 'custom', label: 'Kustom' },
] as const;

/** Label preset yang mungkin tersimpan (termasuk nilai di luar empat tombol cepat). */
const PRESET_LABELS: Record<string, string> = {
  this_month: 'Bulan ini',
  last_month: 'Bulan lalu',
  last_7_days: '7 hari',
  last_30_days: '30 hari',
  this_quarter: 'Kuartal ini',
  all: 'Seluruh data',
  custom: 'Kustom',
};

const TABS = [
  { id: 'general', label: 'Umum' },
  { id: 'assistant', label: 'Asisten' },
  { id: 'about', label: 'Tentang' },
] as const;

type TabId = (typeof TABS)[number]['id'];
type Notice = 'hidden' | 'draft' | 'saved';
type RangeError = { start: string | null; end: string | null };

const INPUT_CLASS =
  'min-h-11 w-full rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 font-body text-body text-ink placeholder:text-ink-72 focus-ring';
const INPUT_INVALID_CLASS = 'border-[var(--color-terracotta)]';

/* ------------------------------------------------------------ date helpers */

/** Aritmetika tanggal pada string ISO (YYYY-MM-DD), tanpa library tambahan. */
function isoToUtcMs(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function utcMsToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function shiftIsoDays(iso: string, days: number): string {
  return utcMsToIso(isoToUtcMs(iso) + days * 86_400_000);
}

function monthStartIso(iso: string): string {
  const [year, month] = iso.split('-').map(Number);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/**
 * Preset mengisi KEDUA tanggal dari `maxDate` dataset aktif (DESIGN_SYSTEM §I.2.3).
 * Preset tidak pernah dikirim tanpa tanggal: dulu `start`/`end` lama ikut terkirim.
 */
function presetRange(
  presetId: string,
  dataset: { minDate: string; maxDate: string },
): { start: string; end: string } {
  const end = dataset.maxDate;
  const clamp = (value: string) => (value < dataset.minDate ? dataset.minDate : value);
  switch (presetId) {
    case 'last_7_days':
      return { start: clamp(shiftIsoDays(end, -6)), end };
    case 'last_30_days':
      return { start: clamp(shiftIsoDays(end, -29)), end };
    case 'this_month':
    default:
      return { start: clamp(monthStartIso(end)), end };
  }
}

/* -------------------------------------------------------------- sub-pieces */

function ChoiceGroup({
  label,
  options,
  value,
  onSelect,
  disabled,
}: {
  label: string;
  options: readonly { id: string; label: string }[];
  value: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-s2" disabled={disabled}>
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
              } disabled:cursor-not-allowed disabled:opacity-45`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-start gap-s1 font-body text-caption text-ink">
      <span className="state-dot state-dot-error mt-s1 flex-none" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

/**
 * Settings: band gelap struktural (eyebrow, H1, status penyimpanan, kontrol simpan
 * tone dark), lalu zona terang dengan kartu form per tab.
 *
 * IA mengikuti DESIGN_SYSTEM §I: `Umum` = bahasa antarmuka, `Asisten` = dataset
 * aktif + rentang tanggal, `Tentang` = dokumentasi sistem read-only (§J, AboutPanel).
 * Setiap kontrol yang tampil tersimpan dan dibaca minimal satu tempat lain; kontrol
 * mati yang tidak mengubah perilaku apa pun sudah dihapus.
 */
export default function SettingsPage() {
  const settings = useApi<SettingsResponse>('/api/settings');
  const meta = useApi<MetaResponse>('/api/meta');
  const { lang, setLang } = useI18n();

  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [preset, setPreset] = useState<string>('this_month');
  const [start, setStart] = useState<string>('');
  const [end, setEnd] = useState<string>('');
  const [datasetId, setDatasetId] = useState<string>('');
  const [rangeEdited, setRangeEdited] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>('hidden');
  const [saving, setSaving] = useState(false);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<RangeError>({ start: null, end: null });
  const [liveMessage, setLiveMessage] = useState<string>('');

  const resetForm = useCallback((data: SettingsResponse | null) => {
    if (!data) return;
    setPreset(data.dateRange.preset);
    setStart(data.dateRange.start);
    setEnd(data.dateRange.end);
    setDatasetId(data.activeDatasetId);
    setRangeEdited(false);
    setDatasetError(null);
    setRangeError({ start: null, end: null });
  }, []);

  useEffect(() => {
    if (!settings.data) return;
    // Jangan timpa editan yang belum disimpan (mis. retry setelah ganti bahasa).
    if (dirty) return;
    resetForm(settings.data);
    // `dirty` sengaja tidak masuk deps: cukup dibaca saat payload baru tiba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data, resetForm]);

  const markDirty = () => {
    setDirty(true);
    setNotice((current) => (current === 'saved' ? 'draft' : current === 'hidden' ? 'draft' : current));
  };

  const announce = (message: string) => {
    setLiveMessage(message);
    setNotice('saved');
    window.setTimeout(() => {
      setLiveMessage('');
      setNotice('hidden');
    }, 2500);
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
      announce('Bahasa diperbarui.');
      settings.retry();
    } catch (error) {
      setLang(next === 'en' ? 'id' : 'en');
      toast({ status: 'error', message: error instanceof Error ? error.message : 'Bahasa gagal diperbarui.' });
    }
  };

  const activeDataset = meta.data?.data.activeDataset ?? null;
  const datasetChoices = meta.data?.data.datasetChoices ?? settings.data?.datasets ?? [];
  /**
   * Titik jangkar preset. Utamanya batas dataset aktif dari `/api/meta`; bila meta
   * gagal dimuat, pakai rentang tersimpan supaya preset tetap mengisi tanggal nyata
   * dan tidak pernah mengirim tanggal lama (bug yang diperbaiki di §I.2.3).
   */
  const rangeAnchor = activeDataset
    ? { minDate: activeDataset.minDate, maxDate: activeDataset.maxDate }
    : settings.data
      ? { minDate: settings.data.dateRange.start, maxDate: settings.data.dateRange.end }
      : null;

  const applyPreset = (id: string) => {
    setPreset(id);
    setRangeEdited(true);
    setRangeError({ start: null, end: null });
    markDirty();
    if (id !== 'custom' && rangeAnchor) {
      const next = presetRange(id, rangeAnchor);
      setStart(next.start);
      setEnd(next.end);
    }
  };

  const changeStart = (value: string) => {
    setStart(value);
    setPreset('custom');
    setRangeEdited(true);
    setRangeError({ start: null, end: null });
    markDirty();
  };

  const changeEnd = (value: string) => {
    setEnd(value);
    setPreset('custom');
    setRangeEdited(true);
    setRangeError({ start: null, end: null });
    markDirty();
  };

  const changeDataset = (value: string) => {
    setDatasetId(value);
    setDatasetError(null);
    markDirty();
  };

  const validateRange = (): boolean => {
    const min = activeDataset?.minDate;
    const max = activeDataset?.maxDate;
    let startMessage: string | null = null;
    let endMessage: string | null = null;
    if (start > end) startMessage = 'Tanggal mulai harus sebelum tanggal selesai.';
    if (min && start < min) startMessage = `Tanggal paling awal ${formatDateId(min)}.`;
    if (max && end > max) endMessage = `Tanggal paling akhir ${formatDateId(max)}.`;
    if (startMessage || endMessage) {
      setRangeError({ start: startMessage, end: endMessage });
      return false;
    }
    return true;
  };

  const save = async () => {
    const savedDatasetId = settings.data?.activeDatasetId ?? null;
    const datasetChanged = Boolean(savedDatasetId && datasetId && datasetId !== savedDatasetId);
    const hasStart = Boolean(start);
    const hasEnd = Boolean(end);

    if (hasStart !== hasEnd) {
      setRangeError({
        start: hasStart ? null : 'Isi tanggal mulai.',
        end: hasEnd ? null : 'Isi tanggal selesai.',
      });
      return;
    }
    // Saat dataset berganti tanpa sentuhan rentang, backend menyetel ulang rentang
    // ke batas dataset baru (lib/settings.ts). Mengirim tanggal lama justru 400.
    const sendRange = hasStart && hasEnd && (!datasetChanged || rangeEdited);
    if (sendRange && !validateRange()) return;

    setSaving(true);
    setDatasetError(null);
    try {
      const body: Record<string, unknown> = { lang };
      if (datasetChanged) body.activeDatasetId = datasetId;
      if (sendRange) body.dateRange = { start, end, preset };

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message: string = payload?.error?.message ?? 'Pengaturan gagal disimpan.';
        if (response.status === 400) {
          if (/activeDatasetId/i.test(message)) {
            setDatasetError('Dataset ini belum berstatus READY. Pilih dataset lain lalu simpan.');
            return;
          }
          if (/tanggal|rentang|start|end/i.test(message)) {
            setRangeError({ start: message, end: null });
            return;
          }
        }
        throw new Error(message);
      }

      setDirty(false);
      setRangeEdited(false);
      setRangeError({ start: null, end: null });
      setDatasetError(null);
      const message = datasetChanged
        ? 'Dataset aktif diperbarui.'
        : sendRange
          ? 'Rentang tanggal disimpan.'
          : 'Pengaturan disimpan.';
      announce(message);
      toast({ status: 'success', message });
      settings.retry();
      if (datasetChanged) meta.retry();
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
    setLiveMessage('');
  };

  const documentsTotal = meta.data?.data.documents.total ?? null;
  const savedPreset = settings.data?.dateRange.preset ?? '';
  const presetLabel = PRESET_LABELS[savedPreset] ?? 'Rentang tersimpan';
  const rangeLabel =
    settings.data?.dateRange.start && settings.data.dateRange.end
      ? formatDateRangeId(settings.data.dateRange.start, settings.data.dateRange.end)
      : activeDataset
        ? formatDateRangeId(activeDataset.minDate, activeDataset.maxDate)
        : 'Belum tersedia';

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
      { id: 'range', label: 'Rentang tanggal', value: rangeLabel, source: presetLabel.toUpperCase() },
    ],
    [lang, rangeLabel, presetLabel, documentsTotal],
  );

  // Pasangan metrik kecil di band gelap: bacaan dari data yang benar-benar ada.
  const bandPairs = [
    { id: 'lang', label: 'Bahasa', value: lang === 'id' ? 'Bahasa Indonesia' : 'English' },
    {
      id: 'documents',
      label: 'Dokumen',
      value: documentsTotal !== null ? formatNumber(documentsTotal) : 'Tidak tersedia',
    },
    { id: 'range', label: 'Rentang tanggal', value: presetLabel },
  ];

  const saveStatusLabel = saving ? 'Menyimpan…' : dirty ? 'Perubahan belum disimpan' : 'Tersimpan';
  const showSaveControls = activeTab !== 'about';
  const datasetChoicesLength = datasetChoices.length;
  const datasetMetaLoading = meta.loading && !meta.data;

  return (
    <>
      {/* Band gelap struktural: kepala halaman + status pengaturan ringkas + kontrol
          simpan tone dark. Kontrol simpan hanya dirender di tab yang punya state mutable. */}
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
            Atur bahasa antarmuka dan cakupan data yang dipakai asisten. Status sistem ada di Tentang.
          </p>

          <div className="mt-s5 grid items-end gap-s4 lg:grid-cols-12">
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
                <p role="status" aria-live="polite" className="mt-s2 font-body text-title text-porcelain">
                  {settings.error ? 'Tidak tersedia' : liveMessage || saveStatusLabel}
                </p>
              )}
              <p className="mt-s2 font-mono text-[11px] uppercase tracking-[0.06em] text-dark-muted">
                PENGATURAN LOKAL · TANPA AKUN
              </p>
            </div>
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
                      'Tidak tersedia'
                    ) : (
                      pair.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {showSaveControls && (
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
          )}
        </div>
      </section>

      {/* Zona kerja terang: ringkasan, tab, panel per tab, bar simpan. */}
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
                      Bahasa yang dipakai seluruh antarmuka.
                    </p>
                  </div>
                  <span className="mono-meta">ANTARMUKA · {lang === 'id' ? 'ID' : 'EN'}</span>
                </div>
                <SectionRule />
                <ChoiceGroup
                  label="Bahasa antarmuka"
                  options={[
                    { id: 'id', label: 'Bahasa Indonesia' },
                    { id: 'en', label: 'English' },
                  ]}
                  value={lang}
                  onSelect={(id) => void changeLang(id as 'id' | 'en')}
                  disabled={saving}
                />
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
                      Cakupan data yang dipakai saat menjawab dan di dashboard.
                    </p>
                  </div>
                  <span className="mono-meta max-w-[16rem] truncate">
                    {activeDataset ? `DATASET · ${activeDataset.name}` : 'DATASET · BELUM TERSEDIA'}
                  </span>
                </div>
                <SectionRule />

                {datasetMetaLoading ? (
                  <div className="grid grid-cols-1 gap-s4 md:grid-cols-2" aria-busy="true" aria-label="Memuat batas dataset">
                    {[0, 1].map((index) => (
                      <div key={index} className="flex flex-col gap-s2">
                        <div className="skeleton h-s4 w-32" />
                        <div className="skeleton h-s5 w-full" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-s4 md:grid-cols-2">
                    {/* Dataset aktif (DESIGN_SYSTEM §I.2.2) */}
                    <div className="flex flex-col gap-s1">
                      {datasetChoicesLength > 1 ? (
                        <label
                          htmlFor="ws-dataset"
                          className="font-display text-label font-semibold text-ink"
                        >
                          Dataset aktif
                        </label>
                      ) : (
                        <p className="font-display text-label font-semibold text-ink">Dataset aktif</p>
                      )}

                      {datasetChoicesLength === 0 ? (
                        <p className="flex min-h-11 items-center rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 font-body text-body text-ink-72">
                          Daftar dataset belum bisa dimuat.
                        </p>
                      ) : datasetChoicesLength === 1 ? (
                        <p className="flex min-h-11 flex-wrap items-center gap-s1 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 font-body text-body text-ink">
                          <span>Satu dataset aktif</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold">{datasetChoices[0].name}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-ink-72">{formatNumber(datasetChoices[0].rowCount)} baris</span>
                        </p>
                      ) : (
                        <select
                          id="ws-dataset"
                          value={datasetId}
                          onChange={(event) => changeDataset(event.target.value)}
                          disabled={saving}
                          aria-invalid={datasetError ? true : undefined}
                          aria-describedby={
                            datasetError ? 'ws-dataset-hint ws-dataset-error' : 'ws-dataset-hint'
                          }
                          className={`${INPUT_CLASS} ${datasetError ? INPUT_INVALID_CLASS : ''} disabled:cursor-not-allowed disabled:opacity-45`}
                        >
                          {datasetChoices.map((choice) => (
                            <option key={choice.id} value={choice.id}>
                              {choice.name} · {formatNumber(choice.rowCount)} baris
                            </option>
                          ))}
                        </select>
                      )}

                      {datasetChoicesLength > 1 && (
                        <p id="ws-dataset-hint" className="font-body text-caption text-ink-72">
                          Mengganti dataset menyetel ulang rentang tanggal ke batas dataset baru.
                        </p>
                      )}
                      <FieldError id="ws-dataset-error" message={datasetError} />
                    </div>

                    {/* Rentang tanggal (DESIGN_SYSTEM §I.2.3) */}
                    <fieldset className="flex flex-col gap-s2 md:col-span-2" disabled={saving}>
                      <legend className="font-display text-label font-semibold text-ink">
                        Rentang tanggal
                      </legend>
                      <div className="grid grid-cols-2 gap-s2 sm:grid-cols-4">
                        {PRESETS.map((option) => {
                          const selected = option.id === preset;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => applyPreset(option.id)}
                              className={`touch-44 rounded-control border px-s2 font-display text-label font-semibold transition-colors duration-[var(--motion-fast)] focus-ring ${
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

                      <div className="grid grid-cols-1 gap-s3 sm:grid-cols-2">
                        <div className="flex flex-col gap-s1">
                          <label htmlFor="ws-range-start" className="font-body text-caption text-ink-72">
                            Mulai
                          </label>
                          <input
                            id="ws-range-start"
                            type="date"
                            value={start}
                            min={activeDataset?.minDate}
                            max={activeDataset?.maxDate}
                            onChange={(event) => changeStart(event.target.value)}
                            aria-invalid={rangeError.start ? true : undefined}
                            aria-describedby={
                              rangeError.start ? 'ws-range-hint ws-range-start-error' : 'ws-range-hint'
                            }
                            className={`${INPUT_CLASS} ${rangeError.start ? INPUT_INVALID_CLASS : ''}`}
                          />
                          <FieldError id="ws-range-start-error" message={rangeError.start} />
                        </div>
                        <div className="flex flex-col gap-s1">
                          <label htmlFor="ws-range-end" className="font-body text-caption text-ink-72">
                            Selesai
                          </label>
                          <input
                            id="ws-range-end"
                            type="date"
                            value={end}
                            min={activeDataset?.minDate}
                            max={activeDataset?.maxDate}
                            onChange={(event) => changeEnd(event.target.value)}
                            aria-invalid={rangeError.end ? true : undefined}
                            aria-describedby={
                              rangeError.end ? 'ws-range-hint ws-range-end-error' : 'ws-range-hint'
                            }
                            className={`${INPUT_CLASS} ${rangeError.end ? INPUT_INVALID_CLASS : ''}`}
                          />
                          <FieldError id="ws-range-end-error" message={rangeError.end} />
                        </div>
                      </div>

                      <p id="ws-range-hint" className="font-body text-caption text-ink-72">
                        Dipakai dashboard dan pertanyaan baru.
                      </p>
                      <p className="mono-meta">{rangeLabel}</p>
                    </fieldset>
                  </div>
                )}
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

            {showSaveControls && (
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
            )}
          </>
        )}
      </div>
    </>
  );
}
