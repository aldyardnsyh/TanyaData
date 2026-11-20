'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { MetaResponse, SettingsResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { useI18n } from '@/lib/ui/i18n-provider';
import { formatDateRangeId, formatNumber } from '@/lib/ui/format';
import { PageHeading } from '@/components/signal/page-heading';
import { BentoGrid, type BentoItem } from '@/components/signal/bento-grid';
import { SpotlightCard } from '@/components/signal/spotlight-card';
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
  { id: 'data', label: 'Data' },
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
 * Settings: satu kolom form 8 kolom, `s4` antar grup (UI_REFACTOR_DESIGN §5).
 * Semua nilai berasal dari /api/settings + /api/meta. Field kosong dibiarkan
 * kosong dengan placeholder jujur, bukan identitas rekaan (P7).
 */
export default function SettingsPage() {
  const settings = useApi<SettingsResponse>('/api/settings');
  const meta = useApi<MetaResponse>('/api/meta');
  const { lang, setLang } = useI18n();

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [activeDataset, setActiveDataset] = useState('');
  const [preset, setPreset] = useState<string>('this_month');
  const [chartDefault, setChartDefault] = useState<string>('bar');
  const [denseTables, setDenseTables] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>('hidden');
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback((data: SettingsResponse | null) => {
    setName(data?.profile.name ?? '');
    setRole(data?.profile.role ?? '');
    setActiveDataset(data?.activeDatasetId ?? '');
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
        profile: { name, role },
        activeDatasetId: activeDataset,
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

  const datasets = settings.data?.datasets ?? meta.data?.data.datasetChoices ?? [];
  const activeDatasetName = datasets.find((dataset) => dataset.id === activeDataset)?.name ?? null;
  const activeRowCount = datasets.find((dataset) => dataset.id === activeDataset)?.rowCount ?? null;
  const documentsTotal = meta.data?.data.documents.total ?? null;
  const bounds = meta.data?.data.activeDataset;
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
        id: 'dataset',
        label: 'Dataset aktif',
        value: activeRowCount !== null ? formatNumber(activeRowCount) : 'Belum tersedia',
        source: activeDatasetName ?? 'Belum dipilih',
        span: 'hero',
        active: Boolean(activeDataset),
      },
      { id: 'lang', label: 'Bahasa', value: lang === 'id' ? 'ID' : 'EN', source: 'ANTARMUKA' },
      { id: 'range', label: 'Rentang bawaan', value: rangeLabel, source: presetLabel.toUpperCase() },
      {
        id: 'documents',
        label: 'Dokumen',
        value: documentsTotal !== null ? formatNumber(documentsTotal) : 'Belum tersedia',
        source: 'TERINDEKS',
      },
      { id: 'chart', label: 'Grafik', value: chartLabel, source: 'BAWAAN' },
    ],
    [activeRowCount, activeDatasetName, activeDataset, lang, rangeLabel, presetLabel, documentsTotal, chartLabel],
  );

  if (settings.loading) {
    return (
      <div className="page-container py-s5" aria-busy="true">
        <div className="skeleton mb-s3 h-10 w-1/3" />
        <div className="skeleton mb-s5 h-4 w-2/3" />
        <BentoGrid items={[]} state="loading" />
        <div className="mt-s5 flex gap-s2">
          {TABS.map((tab) => <div key={tab.id} className="skeleton h-s5 w-24" />)}
        </div>
        <div className="mt-s5 grid grid-cols-1 gap-s3 md:grid-cols-2">
          {[0, 1, 2, 3].map((index) => <div key={index} className="skeleton h-32 w-full" />)}
        </div>
      </div>
    );
  }

  if (settings.error) {
    return (
      <div className="page-container py-s5">
        <PageHeading title="Pengaturan" caption="Atur bahasa, dataset aktif, dan preferensi tampilan workspace." />
        <div className="surface flex flex-col items-start gap-s3 p-s4" role="alert">
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
      </div>
    );
  }

  return (
    <div className="page-container py-s5">
      <PageHeading
        title="Pengaturan"
        caption="Atur bahasa, dataset aktif, dan preferensi tampilan workspace."
        meta="PENGATURAN LOKAL · TANPA AKUN"
        actions={
          <>
            {notice !== 'hidden' && (
              <StatusBadge
                label={notice === 'saved' ? 'Tersimpan' : 'Perubahan belum disimpan'}
                tone={notice === 'saved' ? 'active' : 'loading'}
              />
            )}
            <button
              type="button"
              onClick={discard}
              disabled={!dirty}
              className="touch-44 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink-72 hover:border-forest hover:text-forest focus-ring disabled:cursor-not-allowed disabled:opacity-45"
            >
              Buang
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty}
              aria-busy={saving}
              className="touch-44 rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving ? 'Menyimpan' : 'Simpan perubahan'}
            </button>
          </>
        }
      />

      {/* Purpose Gate: bento menyatakan konfigurasi mana yang paling berpengaruh. */}
      <BentoGrid items={bentoItems} className="mb-s4" />

      {/* Purpose Gate: halo menandakan kartu bisa diklik untuk membuka pengaturan data. */}
      <SpotlightCard
        active={Boolean(activeDataset)}
        onClick={() => setActiveTab('data')}
        label="Buka pengaturan data"
        className="mb-s5"
      >
        <span className="mono-meta">SUMBER DATA</span>
        <span className="font-display text-title text-ink">{activeDatasetName ?? 'Belum dipilih'}</span>
        <span className="font-body text-caption text-ink-72">
          {activeRowCount !== null ? `${formatNumber(activeRowCount)} baris` : 'Jumlah baris belum tersedia'}
          {bounds?.minDate && bounds.maxDate ? ` · ${formatDateRangeId(bounds.minDate, bounds.maxDate)}` : ''}
        </span>
      </SpotlightCard>

      <AnimatedTabs
        tabs={TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as TabId)}
        className="mb-s4"
      />

      {activeTab === 'general' && (
        <section className="flex flex-col gap-s4" aria-labelledby="panel-general">
          <h2 id="panel-general" className="font-display text-title text-ink">
            Umum
          </h2>
          <SectionRule />
          <div className="grid grid-cols-1 gap-s4 md:grid-cols-2">
            <Field id="ws-name" label="Nama workspace">
              <input
                id="ws-name"
                type="text"
                value={name}
                maxLength={80}
                placeholder="Belum diisi"
                onChange={(event) => {
                  setName(event.target.value);
                  markDirty();
                }}
                className={INPUT_CLASS}
              />
            </Field>
            <Field id="ws-role" label="Peran">
              <input
                id="ws-role"
                type="text"
                value={role}
                maxLength={80}
                placeholder="Belum diisi"
                onChange={(event) => {
                  setRole(event.target.value);
                  markDirty();
                }}
                className={INPUT_CLASS}
              />
            </Field>
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

      {activeTab === 'data' && (
        <section className="flex flex-col gap-s4" aria-labelledby="panel-data">
          <h2 id="panel-data" className="font-display text-title text-ink">
            Data
          </h2>
          <SectionRule />
          {datasets.length === 0 ? (
            <div className="surface flex flex-col items-start gap-s2 p-s4">
              <StatusBadge label="Kosong" tone="neutral" />
              <p className="font-body text-body text-ink">Belum ada dataset yang tersedia.</p>
              <p className="font-body text-caption text-ink-72">Unggah berkas untuk memilih dataset aktif.</p>
              <Link href="/data-sources" className="touch-44 inline-flex items-center font-display text-label font-semibold text-forest focus-ring">
                Buka sumber data
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-s4 md:grid-cols-2">
              <Field id="dataset-select" label="Dataset aktif">
                <select
                  id="dataset-select"
                  value={activeDataset}
                  onChange={(event) => {
                    setActiveDataset(event.target.value);
                    markDirty();
                  }}
                  className={INPUT_CLASS}
                >
                  {datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name} ({formatNumber(dataset.rowCount)} baris)
                    </option>
                  ))}
                </select>
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
              <dl className="flex flex-col gap-s2 md:col-span-2">
                <InfoRow label="Dokumen terindeks" value={documentsTotal !== null ? formatNumber(documentsTotal) : 'Belum tersedia'} />
                {activeRowCount !== null && <InfoRow label="Baris dataset aktif" value={`${formatNumber(activeRowCount)} BARIS`} />}
                {bounds?.minDate && bounds.maxDate && <InfoRow label="Rentang data" value={formatDateRangeId(bounds.minDate, bounds.maxDate)} />}
              </dl>
            </div>
          )}
        </section>
      )}

      {activeTab === 'assistant' && (
        <section className="flex flex-col gap-s4" aria-labelledby="panel-assistant">
          <h2 id="panel-assistant" className="font-display text-title text-ink">
            Asisten
          </h2>
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
        <section className="flex flex-col gap-s4" aria-labelledby="panel-about">
          <h2 id="panel-about" className="font-display text-title text-ink">
            Tentang
          </h2>
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

      <div className="sticky bottom-s3 z-sticky mt-s5 flex flex-col gap-s2 rounded-control border border-[var(--border-hairline)] bg-porcelain p-s2 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-body text-caption text-ink-72">Perubahan hanya berlaku setelah disimpan.</p>
        <div className="flex flex-wrap items-center gap-s2">
          <button
            type="button"
            onClick={discard}
            disabled={!dirty}
            className="touch-44 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink-72 hover:border-forest hover:text-forest focus-ring disabled:cursor-not-allowed disabled:opacity-45"
          >
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
    </div>
  );
}
