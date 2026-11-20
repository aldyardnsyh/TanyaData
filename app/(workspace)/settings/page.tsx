'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MetaResponse, SettingsResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { useI18n } from '@/lib/ui/i18n-provider';
import { formatNumber } from '@/lib/ui/format';
import { Icon } from '@/components/ui/icons';
import { MonoMeta } from '@/components/ui/mono-meta';
import { MeasurementRule } from '@/components/ui/measurement-rule';
import { StatusDot } from '@/components/ui/status-dot';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';

/** Nilai preset mengikuti kontrak API (§9.1), bukan label panjang rekaan. */
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

type Notice = 'hidden' | 'draft' | 'saved';

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
  const [activeSection, setActiveSection] = useState('general');
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>('hidden');
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback((data: SettingsResponse | null) => {
    setName(data?.profile.name ?? '');
    setRole(data?.profile.role ?? '');
    setActiveDataset(data?.activeDatasetId ?? '');
    setPreset(data && PRESETS.some((p) => p.id === data.dateRange.preset) ? data.dateRange.preset : 'this_month');
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
      const res = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Bahasa gagal diperbarui.');
      }
      settings.retry();
    } catch (err) {
      setLang(next === 'en' ? 'id' : 'en');
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Bahasa gagal diperbarui.' });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lang,
          profile: { name, role },
          activeDatasetId: activeDataset,
          dateRange: { start: settings.data?.dateRange.start ?? '', end: settings.data?.dateRange.end ?? '', preset },
          preferences: { chartDefault, denseTables },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Pengaturan gagal disimpan.');
      }
      setDirty(false); setNotice('saved'); settings.retry();
      window.setTimeout(() => setNotice('hidden'), 2500);
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Pengaturan gagal disimpan.' });
    } finally { setSaving(false); }
  };

  const discard = () => { resetForm(settings.data); setDirty(false); setNotice('hidden'); };
  const switchTab = (id: string) => {
    setActiveSection(id);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (settings.loading) {
    return <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 p-4 sm:p-6 lg:p-8"><Skeleton className="h-10 w-1/3" /><div className="grid grid-cols-1 gap-6 lg:grid-cols-12"><Skeleton className="h-64 lg:col-span-3" /><Skeleton className="h-96 lg:col-span-9" /></div></div>;
  }
  if (settings.error) {
    return <div className="mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-8"><div className="rounded-card border border-signal-terracotta bg-surface p-4"><p className="font-body text-body-md text-error-text">{settings.error}</p><Button size="sm" onClick={settings.retry} className="mt-2">Coba lagi</Button></div></div>;
  }

  const datasets = settings.data?.datasets ?? meta.data?.data.datasetChoices ?? [];
  const activeRowCount = datasets.find((dataset) => dataset.id === activeDataset)?.rowCount ?? null;
  const documentsTotal = meta.data?.data.documents.total ?? null;

  const navItems = [
    { id: 'general', label: 'Umum', icon: 'tune' },
    { id: 'data', label: 'Data', icon: 'database' },
    { id: 'assistant', label: 'Asisten', icon: 'forum' },
    { id: 'about', label: 'Tentang', icon: 'info' },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Pengaturan"
        subtitle="Atur bahasa, dataset aktif, dan preferensi tampilan workspace."
        meta="PENGATURAN LOKAL · TANPA AKUN"
        actions={
          <>
            {notice !== 'hidden' && (
              <span className="inline-flex min-h-11 items-center gap-2 px-2">
                <StatusDot state={notice === 'saved' ? 'active' : 'neutral'} label={notice === 'saved' ? 'Tersimpan' : 'Perubahan belum disimpan'} />
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={discard} disabled={!dirty}>Buang</Button>
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving || !dirty}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <aside className="lg:col-span-3">
          <nav className="flex flex-col gap-1" aria-label="Kategori pengaturan">
            {navItems.map((item) => {
              const active = item.id === activeSection;
              return (
                <button key={item.id} type="button" aria-current={active ? 'true' : undefined} onClick={() => switchTab(item.id)} className={`flex min-h-11 items-center justify-between gap-2 rounded-control px-3 text-left font-body text-label-md transition-colors focus-ring ${active ? 'bg-primary/10 font-semibold text-primary' : 'text-ink-muted-strong hover:bg-row-hover hover:text-ink'}`}>
                  <span className="inline-flex items-center gap-2"><Icon name={item.icon} className="text-[20px]" aria-hidden="true" />{item.label}</span>
                  {active && <span className="state-dot state-dot-active" aria-hidden="true" />}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex flex-col gap-6 lg:col-span-9">
          {/* UMUM */}
          <section id="section-general" className="rounded-card border border-border-hairline bg-surface p-5">
            <header className="measurement-rule -mx-5 -mt-5 mb-5 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Umum</h2></header>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="font-body text-label-md font-semibold text-ink">Nama workspace</span>
                <input id="ws-name" type="text" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); markDirty(); }} className="min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink focus-ring" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-body text-label-md font-semibold text-ink">Peran</span>
                <input id="ws-role" type="text" value={role} maxLength={80} onChange={(e) => { setRole(e.target.value); markDirty(); }} className="min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink focus-ring" />
              </label>
              <div className="flex flex-col gap-1">
                <span className="font-body text-label-md font-semibold text-ink">Bahasa antarmuka</span>
                <div className="grid grid-cols-2 gap-2">
                  {(['id', 'en'] as const).map((code) => (
                    <button key={code} type="button" onClick={() => void changeLang(code)} aria-pressed={lang === code} className={`min-h-11 rounded-control border font-body text-label-md transition-colors focus-ring ${lang === code ? 'border-primary bg-primary font-semibold text-on-primary' : 'border-border-control bg-surface text-ink-muted-strong hover:border-primary'}`}>
                      {code === 'id' ? 'Bahasa Indonesia' : 'English'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-body text-label-md font-semibold text-ink">Zona waktu</span>
                <div className="flex min-h-11 items-center rounded-control border border-border-hairline bg-canvas px-3 font-body text-body-md text-ink-muted-strong">UTC+07:00 · Jakarta</div>
              </div>
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="font-body text-label-md font-semibold text-ink">Rentang tanggal bawaan</span>
                <select id="ws-daterange" value={preset} onChange={(e) => { setPreset(e.target.value); markDirty(); }} className="min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink focus-ring">
                  {PRESETS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                <span className="font-body text-body-sm text-ink-muted-strong">Diterapkan pada dashboard dan pertanyaan baru.</span>
              </label>
            </div>
          </section>

          {/* DATA */}
          <section id="section-data" className="rounded-card border border-border-hairline bg-surface p-5">
            <header className="measurement-rule -mx-5 -mt-5 mb-5 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Data</h2></header>
            <div className="flex flex-col gap-5">
              <label className="flex flex-col gap-1">
                <span className="font-body text-label-md font-semibold text-ink">Dataset aktif</span>
                <select id="dataset-select" value={activeDataset} onChange={(e) => { setActiveDataset(e.target.value); markDirty(); }} className="min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink focus-ring">
                  {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} ({formatNumber(dataset.rowCount)} baris)</option>)}
                </select>
              </label>
              <label className="flex min-h-11 items-start gap-3 rounded-control border border-border-hairline bg-canvas p-3">
                <input type="checkbox" checked={denseTables} onChange={(e) => { setDenseTables(e.target.checked); markDirty(); }} className="mt-1 h-4 w-4 accent-primary" />
                <span className="flex flex-col"><span className="font-body text-body-md font-semibold text-ink">Tabel ringkas</span><span className="font-body text-body-sm text-ink-muted-strong">Gunakan jarak baris lebih rapat pada tabel analitik.</span></span>
              </label>
              <div className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-border-hairline bg-canvas px-3">
                <span className="font-body text-body-md text-ink-muted-strong">Dokumen terindeks</span>
                <MonoMeta>{documentsTotal ?? '—'}</MonoMeta>
              </div>
              {activeRowCount != null && <div className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-border-hairline bg-canvas px-3"><span className="font-body text-body-md text-ink-muted-strong">Baris dataset aktif</span><MonoMeta>{formatNumber(activeRowCount)} ROWS</MonoMeta></div>}
            </div>
          </section>

          {/* ASISTEN */}
          <section id="section-assistant" className="rounded-card border border-border-hairline bg-surface p-5">
            <header className="measurement-rule -mx-5 -mt-5 mb-5 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Asisten</h2></header>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <span className="font-body text-label-md font-semibold text-ink">Jenis grafik bawaan</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {CHART_TYPES.map((type) => (
                    <button key={type.id} type="button" onClick={() => { setChartDefault(type.id); markDirty(); }} aria-pressed={chartDefault === type.id} className={`min-h-11 rounded-control border font-body text-label-md transition-colors focus-ring ${chartDefault === type.id ? 'border-primary bg-primary font-semibold text-on-primary' : 'border-border-control bg-surface text-ink-muted-strong hover:border-primary'}`}>{type.label}</button>
                  ))}
                </div>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-border-hairline bg-canvas px-3">
                <span className="font-body text-body-md text-ink-muted-strong">Mesin pengambilan data</span>
                <MonoMeta>{meta.data ? `${meta.data.capabilities.sql.toUpperCase()} · ${meta.data.capabilities.rag.toUpperCase()}` : '—'}</MonoMeta>
              </div>
            </div>
          </section>

          {/* TENTANG */}
          <section id="section-about" className="rounded-card border border-border-hairline bg-surface p-5">
            <header className="measurement-rule -mx-5 -mt-5 mb-5 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Tentang</h2></header>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                ['Aplikasi', meta.data?.app.name ?? 'TanyaData'],
                ['Versi', meta.data?.app.version ?? '—'],
                ['Mesin data', 'SQLite · SQL + FTS5'],
                ['Akses', 'Hanya baca (read-only)'],
                ['Akun', 'Tidak ada · satu workspace lokal'],
                ['Zona waktu', 'Asia/Jakarta'],
              ].map(([label, value]) => (
                <div key={label} className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-border-hairline bg-canvas px-3">
                  <dt className="font-body text-body-md text-ink-muted-strong">{label}</dt>
                  <dd className="text-right font-mono text-body-sm text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 font-body text-body-sm text-ink-muted-strong">Perubahan disimpan di workspace lokal ini. Tidak ada data yang dikirim ke layanan eksternal.</p>
          </section>

          <div className="flex flex-col gap-3 border-t border-border-hairline pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-body text-body-sm text-ink-muted-strong">Perubahan hanya berlaku setelah disimpan.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={discard} disabled={!dirty}>Buang</Button>
              <Button variant="primary" onClick={() => void save()} disabled={saving || !dirty}>{saving ? 'Menyimpan…' : 'Simpan perubahan'}</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
