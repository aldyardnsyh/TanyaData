'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MetaResponse, SettingsResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { useI18n } from '@/lib/ui/i18n-provider';
import { formatDateId } from '@/lib/ui/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';

const PRESETS = [
  { id: 'bulan_ini', label: 'Bulan ini' },
  { id: '7_hari', label: '7 hari' },
  { id: '30_hari', label: '30 hari' },
  { id: 'kustom', label: 'Kustom' },
];

export default function SettingsPage() {
  const settings = useApi<SettingsResponse>('/api/settings');
  const meta = useApi<MetaResponse>('/api/meta');
  const { lang, setLang } = useI18n();

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [activeDataset, setActiveDataset] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [preset, setPreset] = useState('bulan_ini');
  const [denseTables, setDenseTables] = useState(true);
  const [chartDefault, setChartDefault] = useState('bar');
  const [saving, setSaving] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [dangerText, setDangerText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [status, setStatus] = useState('');

  const resetForm = useCallback((data: SettingsResponse | null) => {
    setName(data?.profile.name ?? '');
    setRole(data?.profile.role ?? '');
    setActiveDataset(data?.activeDatasetId ?? '');
    setStart(data?.dateRange.start ?? '');
    setEnd(data?.dateRange.end ?? '');
    setPreset(data?.dateRange.preset ?? 'bulan_ini');
    setDenseTables(data?.preferences.denseTables ?? true);
    setChartDefault(data?.preferences.chartDefault ?? 'bar');
  }, []);

  useEffect(() => {
    if (!settings.data) return;
    resetForm(settings.data);
  }, [settings.data, resetForm]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lang,
          profile: { name, role },
          activeDatasetId: activeDataset,
          dateRange: { start, end, preset },
          preferences: { chartDefault: chartDefault as 'bar' | 'line' | 'pie', denseTables },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Gagal menyimpan pengaturan.');
      }
      toast({ status: 'success', message: 'Pengaturan disimpan.' });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal menyimpan pengaturan.' });
    } finally {
      setSaving(false);
    }
  };

  const changeLang = async (next: 'id' | 'en') => {
    setLang(next);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: next }),
      });
      if (!res.ok) throw new Error('Gagal menyimpan bahasa.');
      settings.retry();
      toast({ status: 'success', message: 'Bahasa diperbarui.' });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal memperbarui bahasa.' });
    }
  };

  const clearWorkspace = useCallback(async () => {
    if (dangerText.trim() !== 'HAPUS') return;
    setClearing(true);
    try {
      // Tidak ada endpoint reset workspace di kontrak; laporkan keterbatasan secara jujur.
      toast({ status: 'info', message: 'Penghapusan workspace tidak tersedia pada build ini.' });
      setDangerOpen(false);
      setDangerText('');
    } finally {
      setClearing(false);
    }
  }, [dangerText]);

  if (settings.loading) {
    return (
      <div className="mx-auto max-w-[720px] space-y-4 px-6 py-8">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (settings.error) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-8">
        <div className="rounded-md bg-error-container p-4 text-center">
          <p className="font-body text-body-md text-on-error-container">{settings.error}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={settings.retry}>Coba lagi</Button>
        </div>
      </div>
    );
  }

  const datasets = settings.data?.datasets ?? meta.data?.data.datasetChoices ?? [];

  return (
    <div className="mx-auto max-w-[720px] space-y-6 px-6 py-8">
      <div>
        <h1 className="font-display text-headline-xl font-bold tracking-tight text-on-surface">Pengaturan</h1>
        <p className="mt-0.5 font-body text-body-md text-on-surface-variant">Preferensi workspace yang tersimpan lokal.</p>
      </div>

      {/* Tampilan */}
      <Card title="Tampilan" subtitle="Bahasa dan format tampilan angka.">
        <div className="space-y-4">
          <div>
            <p className="mb-1 font-body text-label-md font-semibold text-on-surface">Bahasa</p>
            <div className="flex gap-2">
              {(['id', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => void changeLang(l)}
                  disabled={l === 'en'}
                  className={`rounded-md px-3 py-1.5 font-body text-label-md transition-colors duration-[var(--motion-fast)] focus-ring ${
                    lang === l ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                  } ${l === 'en' ? 'cursor-not-allowed opacity-45' : ''}`}
                >
                  {l === 'id' ? 'Indonesia' : 'English'}
                </button>
              ))}
            </div>
            {/* C-28 / DECISION-010: bilingual dibekukan; hanya Indonesia pada versi ini. */}
            <p className="mt-1 font-body text-body-sm text-on-surface-variant">Satu bahasa pada versi ini.</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-body text-label-md font-semibold text-on-surface">Format angka</p>
              <p className="font-body text-body-sm text-on-surface-variant">id-ID · titik ribuan, koma desimal</p>
            </div>
            <StatusBadge status="neutral" label="id-ID" />
          </div>
          <label className="flex items-center justify-between">
            <div>
              <p className="font-body text-label-md font-semibold text-on-surface">Kurangi animasi</p>
              <p className="font-body text-body-sm text-on-surface-variant">Mengikuti preferensi sistem operasi.</p>
            </div>
            <input type="checkbox" disabled className="h-4 w-4 accent-primary" aria-label="Kurangi animasi (mengikuti sistem)" />
          </label>
        </div>
      </Card>

      {/* Data */}
      <Card title="Data" subtitle="Dataset aktif dan rentang tanggal default.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Dataset aktif" value={activeDataset} onChange={(e) => setActiveDataset(e.target.value)}>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select label="Preset periode" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
          <label className="flex flex-col gap-1">
            <span className="font-body text-label-md font-semibold text-on-surface">Mulai</span>
            <input type="date" value={start} min={meta.data?.data.activeDataset.minDate} max={meta.data?.data.activeDataset.maxDate} onChange={(e) => setStart(e.target.value)} className="h-9 rounded-md border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface focus:border-primary focus:shadow-[var(--focus-ring)] focus:outline-none" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-body text-label-md font-semibold text-on-surface">Selesai</span>
            <input type="date" value={end} min={meta.data?.data.activeDataset.minDate} max={meta.data?.data.activeDataset.maxDate} onChange={(e) => setEnd(e.target.value)} className="h-9 rounded-md border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface focus:border-primary focus:shadow-[var(--focus-ring)] focus:outline-none" />
          </label>
          <div className="sm:col-span-2">
            <p className="font-body text-body-sm text-on-surface-variant">Pratinjau: {start && end ? `${formatDateId(start)} – ${formatDateId(end)}` : '—'}</p>
          </div>
        </div>
      </Card>

      {/* Preferensi */}
      <Card title="Preferensi" subtitle="Tampilan tabel dan grafik.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Grafik bawaan" value={chartDefault} onChange={(e) => setChartDefault(e.target.value)}>
            <option value="bar">Batang</option>
            <option value="line">Garis</option>
            <option value="pie">Lingkaran</option>
          </Select>
          <label className="flex items-center justify-between rounded-md bg-surface-container-low p-3">
            <span className="font-body text-label-md font-semibold text-on-surface">Tabel padat</span>
            <input type="checkbox" checked={denseTables} onChange={(e) => setDenseTables(e.target.checked)} className="h-4 w-4 accent-primary" aria-label="Tabel padat" />
          </label>
        </div>
      </Card>

      {/* Profil */}
      <Card title="Profil" subtitle="Disimpan tanpa login.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-body text-label-md font-semibold text-on-surface">Nama</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-9 rounded-md border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface focus:border-primary focus:shadow-[var(--focus-ring)] focus:outline-none" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-body text-label-md font-semibold text-on-surface">Peran</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} className="h-9 rounded-md border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface focus:border-primary focus:shadow-[var(--focus-ring)] focus:outline-none" />
          </label>
        </div>
      </Card>

      {/* Tentang */}
      <Card title="Tentang" subtitle="Informasi mesin dan sumber data.">
        <dl className="space-y-2">
          <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Aplikasi</dt><dd className="text-on-surface">{meta.data?.app.name ?? 'TanyaData'} {meta.data?.app.version ?? ''}</dd></div>
          <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Mesin</dt><dd className="text-on-surface">SQLite · SQL + FTS5</dd></div>
          <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Dataset aktif</dt><dd className="text-on-surface">{meta.data?.data.activeDataset.name ?? '—'}</dd></div>
          <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Dokumen terindeks</dt><dd className="tabular text-on-surface">{meta.data?.data.documents.indexed ?? '—'} / {meta.data?.data.documents.total ?? '—'}</dd></div>
        </dl>
      </Card>

      {/* Zona berbahaya */}
      <Card title="Zona berbahaya" subtitle="Tindakan yang tidak dapat dibatalkan.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-body text-body-md text-on-surface-variant">Hapus semua data workspace. Data seed tidak terhapus.</p>
          <Button variant="danger" onClick={() => setDangerOpen(true)}>Hapus semua data workspace</Button>
        </div>
      </Card>

      {/* Simpan */}
      <div className="sticky bottom-4 flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-3 shadow-md">
        <p aria-live="polite" className="font-body text-body-sm text-on-surface-variant empty:hidden">{status}</p>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              resetForm(settings.data);
              setStatus('Perubahan dibatalkan.');
            }}
          >
            Batalkan
          </Button>
          <Button variant="primary" loading={saving} onClick={() => { setStatus(''); void save(); }}>Simpan perubahan</Button>
        </div>
      </div>

      <Dialog
        open={dangerOpen}
        onOpenChange={(o) => !o && setDangerOpen(false)}
        title="Hapus semua data workspace?"
        description="Ketik HAPUS untuk mengonfirmasi. Tindakan ini tidak dapat dibatalkan."
      >
        <input
          value={dangerText}
          onChange={(e) => setDangerText(e.target.value)}
          placeholder="HAPUS"
          aria-label="Ketik HAPUS untuk mengonfirmasi"
          autoFocus
          className="h-9 w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface focus:border-primary focus:shadow-[var(--focus-ring)] focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { setDangerOpen(false); setDangerText(''); }}>Batal</Button>
          <Button variant="danger" disabled={dangerText.trim() !== 'HAPUS'} loading={clearing} onClick={() => void clearWorkspace()}>Hapus</Button>
        </div>
      </Dialog>
    </div>
  );
}
