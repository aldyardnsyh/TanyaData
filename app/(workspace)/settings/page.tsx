'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MetaResponse, SettingsResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { useI18n } from '@/lib/ui/i18n-provider';
import { formatNumber } from '@/lib/ui/format';
import { toast } from '@/components/ui/toaster';

/** Material Symbols self-hosted; dekoratif → aria-hidden (blueprint §2). */
function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className ?? ''}`} aria-hidden="true">
      {name}
    </span>
  );
}

const PRESETS = [
  'Last 30 Days (Rolling)',
  'Current Fiscal Quarter (Q3 to Date)',
  'Last 90 Days',
  'Year to Date (YTD)',
  'Trailing 12 Months (T12M)',
];

const CHART_TYPES = ['bar', 'line', 'pie'] as const;

type Notice = 'hidden' | 'draft' | 'saved';

export default function SettingsPage() {
  const settings = useApi<SettingsResponse>('/api/settings');
  const meta = useApi<MetaResponse>('/api/meta');
  const { lang, setLang } = useI18n();

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [activeDataset, setActiveDataset] = useState('');
  const [preset, setPreset] = useState(PRESETS[0]);
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
    setPreset(data && PRESETS.includes(data.dateRange.preset) ? data.dateRange.preset : PRESETS[0]);
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
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Could not update the language.');
      }
      settings.retry();
    } catch (err) {
      setLang(next === 'en' ? 'id' : 'en');
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Could not update the language.' });
    }
  };

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
          dateRange: {
            start: settings.data?.dateRange.start ?? '',
            end: settings.data?.dateRange.end ?? '',
            preset,
          },
          preferences: { chartDefault, denseTables },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Could not save preferences.');
      }
      setDirty(false);
      setNotice('saved');
      settings.retry();
      window.setTimeout(() => setNotice('hidden'), 2500);
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Could not save preferences.' });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    resetForm(settings.data);
    setDirty(false);
    setNotice('hidden');
  };

  const switchTab = (id: string) => {
    setActiveSection(id);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const editDetails = () => {
    switchTab('general');
    window.setTimeout(() => document.getElementById('ws-name')?.focus(), 250);
  };

  if (settings.loading) {
    return (
      <div className="px-space-md sm:px-margin py-space-md flex flex-col gap-space-lg max-w-[1440px] mx-auto w-full">
        <div className="h-10 w-1/3 rounded bg-surface-container-high animate-skeleton" />
        <div className="grid grid-cols-12 gap-space-md">
          <div className="col-span-12 lg:col-span-3 h-64 rounded-xl bg-surface-container-high animate-skeleton" />
          <div className="col-span-12 lg:col-span-9 h-96 rounded-xl bg-surface-container-high animate-skeleton" />
        </div>
      </div>
    );
  }

  if (settings.error) {
    return (
      <div className="px-space-md sm:px-margin py-space-md flex flex-col gap-space-lg max-w-[1440px] mx-auto w-full">
        <div className="content-panel bg-surface-container-lowest rounded-xl p-space-md sm:p-space-lg shadow-sm">
          <p className="font-body-md text-body-md text-error">{settings.error}</p>
          <button
            type="button"
            onClick={settings.retry}
            className="mt-space-sm px-space-md py-1.5 rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-all"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const datasets = settings.data?.datasets ?? meta.data?.data.datasetChoices ?? [];
  const activeRowCount = datasets.find((dataset) => dataset.id === activeDataset)?.rowCount ?? null;
  const documentsTotal = meta.data?.data.documents.total ?? null;

  const navItems = [
    { id: 'general', label: 'General', icon: 'tune' },
    { id: 'data', label: 'Data Preferences', icon: 'analytics' },
    { id: 'ai', label: 'AI Preferences', icon: 'psychology' },
    { id: 'account', label: 'Account & Security', icon: 'shield_person' },
  ];

  return (
    <div className="px-space-md sm:px-margin py-space-md flex flex-col gap-space-lg max-w-[1440px] mx-auto w-full">
      {/* Top Action Banner / Viewport Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-sm pb-space-sm">
        <div className="flex flex-col">
          <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-outline uppercase tracking-wider mb-1">
            <span>Enterprise Portal</span>
            <span>/</span>
            <span className="text-primary font-bold">Preferences</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">Settings</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-0.5">Manage workspace configurations, analytical parameters, and account details.</p>
        </div>
        <div className="flex items-center gap-space-xs self-start md:self-auto">
          <div
            id="saveNotice"
            aria-live="polite"
            className={`${notice === 'hidden' ? 'hidden' : 'flex'} items-center gap-1.5 px-space-sm py-1 rounded bg-secondary-fixed-dim/20 text-on-secondary-fixed text-label-sm font-label-sm font-semibold`}
          >
            {notice === 'saved' ? (
              <>
                <Icon name="done_all" className="text-[16px] text-primary" />
                <span className="text-primary font-bold">Preferences Saved</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-secondary-fixed-dim inline-block" />
                <span>Draft changes pending</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={discard}
            disabled={!dirty}
            className="px-space-md py-1.5 rounded-lg bg-surface-container-high text-on-surface-variant font-label-md text-label-md hover:bg-surface-variant transition-colors disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="px-space-md py-1.5 rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <Icon name="check_circle" className="text-[16px]" />
            <span>{saving ? 'Saving…' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Layout Grid */}
      <div className="grid grid-cols-12 gap-space-md lg:gap-space-lg items-start">
        {/* Secondary Left Navigation Rail */}
        <aside className="col-span-12 lg:col-span-3 bg-surface-container-lowest rounded-xl p-space-sm shadow-sm">
          <div className="px-space-sm py-2">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline block">Categories</span>
          </div>
          <nav className="flex flex-col gap-1" id="settings-nav" aria-label="Settings categories">
            {navItems.map((item) => {
              const active = item.id === activeSection;
              return (
                <button
                  key={item.id}
                  type="button"
                  id={`tab-btn-${item.id}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => switchTab(item.id)}
                  className={`nav-btn w-full flex items-center justify-between px-space-sm py-2.5 rounded-lg text-left transition-all ${
                    active
                      ? 'bg-primary-container text-on-primary font-semibold'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon name={item.icon} className="text-[18px]" />
                    <span className="font-label-md text-label-md">{item.label}</span>
                  </span>
                  {item.id === 'data' ? (
                    <span className="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-bold">{formatNumber(activeRowCount)}</span>
                  ) : item.id === 'ai' ? (
                    <span className="h-2 w-2 rounded-full bg-secondary-fixed-dim inline-block" />
                  ) : item.id === 'account' ? (
                    <Icon name="verified_user" className="text-[16px] text-primary" />
                  ) : (
                    <Icon name="chevron_right" className="text-[16px]" />
                  )}
                </button>
              );
            })}
          </nav>
          {/* Environment Metadata Pill dihapus: tidak ada field workspace/instance di kontrak. */}
        </aside>

        {/* Central Content Stream */}
        <main className="col-span-12 lg:col-span-9 flex flex-col gap-space-lg">
          {/* SECTION 1: General Workspace Settings */}
          <section className="content-panel bg-surface-container-lowest rounded-xl p-space-md sm:p-space-lg shadow-sm flex flex-col gap-space-md" id="section-general">
            <div className="flex items-center justify-between pb-space-sm">
              <div className="flex items-center gap-space-xs">
                <Icon name="domain" className="text-primary text-[22px]" />
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-on-surface">General Workspace Settings</h2>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">Core identity, language, and regional specifications for telemetry aggregation.</p>
                </div>
              </div>
              <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded font-bold">SEC-01</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md pt-2">
              {/* Workspace Name → profile.name */}
              <div className="flex flex-col gap-1">
                <label className="font-label-md text-label-md text-on-surface font-semibold flex items-center justify-between" htmlFor="ws-name">
                  <span>Workspace Name</span>
                  <span className="text-outline font-normal text-label-sm">Primary label</span>
                </label>
                <input
                  id="ws-name"
                  type="text"
                  value={name}
                  maxLength={80}
                  onChange={(event) => { setName(event.target.value); markDirty(); }}
                  className="h-9 px-3 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md focus:outline-none focus:bg-surface-container transition-colors"
                />
              </div>
              {/* Workspace Identifier dihapus: tidak ada field slug di kontrak. */}
              {/* Language Interface → lang (PUT /api/settings) */}
              <div className="flex flex-col gap-1">
                <span className="font-label-md text-label-md text-on-surface font-semibold">Primary Language Interface</span>
                <div className="grid grid-cols-2 p-1 rounded-lg bg-surface-container-high gap-1">
                  <button
                    type="button"
                    onClick={() => void changeLang('id')}
                    className={`lang-toggle py-1.5 rounded font-label-md text-label-md text-center transition-all ${
                      lang === 'id' ? 'text-on-primary bg-primary font-bold shadow-sm' : 'text-on-surface-variant'
                    }`}
                  >
                    Bahasa Indonesia
                  </button>
                  <button
                    type="button"
                    onClick={() => void changeLang('en')}
                    className={`lang-toggle py-1.5 rounded font-label-md text-label-md text-center transition-all ${
                      lang === 'en' ? 'text-on-primary bg-primary font-bold shadow-sm' : 'text-on-surface-variant'
                    }`}
                  >
                    English (US)
                  </button>
                </div>
              </div>
              {/* Default Timezone → konstanta kontrak Asia/Jakarta (bukan field settings). */}
              <div className="flex flex-col gap-1">
                <span className="font-label-md text-label-md text-on-surface font-semibold">Default Timezone</span>
                <div className="relative">
                  <div className="w-full h-9 px-3 pr-8 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md flex items-center">
                    (UTC+07:00) Jakarta
                  </div>
                  <Icon name="expand_more" className="absolute right-2.5 top-2 pointer-events-none text-outline text-[18px]" />
                </div>
              </div>
              {/* Default Date Range → dateRange.preset */}
              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="font-label-md text-label-md text-on-surface font-semibold" htmlFor="ws-daterange">Default Date Range for Dashboards</label>
                <div className="relative">
                  <select
                    id="ws-daterange"
                    value={preset}
                    onChange={(event) => { setPreset(event.target.value); markDirty(); }}
                    className="w-full h-9 px-3 pr-8 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md appearance-none focus:outline-none focus:bg-surface-container cursor-pointer"
                  >
                    {PRESETS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <Icon name="calendar_month" className="absolute right-2.5 top-2 pointer-events-none text-outline text-[18px]" />
                </div>
                <span className="font-body-sm text-body-sm text-outline mt-1">Applies globally across all newly synthesized executive dashboards and anomaly feeds.</span>
              </div>
            </div>
          </section>

          {/* SECTION 2: Data Preferences */}
          <section className="content-panel bg-surface-container-lowest rounded-xl p-space-md sm:p-space-lg shadow-sm flex flex-col gap-space-md" id="section-data">
            <div className="flex items-center justify-between pb-space-sm">
              <div className="flex items-center gap-space-xs">
                <Icon name="dataset" className="text-primary text-[22px]" />
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-on-surface">Data Preferences</h2>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">Default telemetry datasets and table display standards.</p>
                </div>
              </div>
              <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded font-bold">SEC-02</span>
            </div>
            {/* Default Active Dataset Selector */}
            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md text-on-surface font-semibold" htmlFor="dataset-select">Default Active Dataset</label>
              <div className="relative">
                <select
                  id="dataset-select"
                  value={activeDataset}
                  onChange={(event) => { setActiveDataset(event.target.value); markDirty(); }}
                  className="w-full h-9 px-3 pr-8 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md appearance-none focus:outline-none focus:bg-surface-container cursor-pointer"
                >
                  {datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>{dataset.name} ({formatNumber(dataset.rowCount)} rows)</option>
                  ))}
                </select>
                <Icon name="table_chart" className="absolute right-2.5 top-2 pointer-events-none text-outline text-[18px]" />
              </div>
            </div>
            {/* Compact Tables → preferences.denseTables (satu-satunya field format yang tersedia). */}
            <label className="flex items-start gap-space-sm p-space-sm rounded-lg bg-surface-container-low hover:bg-surface-container cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={denseTables}
                onChange={(event) => { setDenseTables(event.target.checked); markDirty(); }}
                className="mt-0.5 accent-primary h-4 w-4"
              />
              <div className="flex flex-col">
                <span className="font-label-md text-label-md text-on-surface font-semibold">Compact Tables</span>
                <span className="font-body-sm text-body-sm text-outline">Use denser row spacing in analytical tables.</span>
              </div>
            </label>
            {/* Number Formatting, Anomaly Sensitivity, Auto-sync dihapus: tidak ada field di kontrak. */}
            <div className="p-space-sm rounded-lg bg-surface-container-low flex items-center justify-between gap-space-sm">
              <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Indexed documents</span>
              <span className="font-label-md text-label-md text-on-surface font-semibold tabular">{documentsTotal ?? 'n/a'}</span>
            </div>
          </section>

          {/* SECTION 3: AI Assistant & Analytical Preferences */}
          <section className="content-panel bg-surface-container-lowest rounded-xl p-space-md sm:p-space-lg shadow-sm flex flex-col gap-space-md" id="section-ai">
            <div className="flex items-center justify-between pb-space-sm">
              <div className="flex items-center gap-space-xs">
                <Icon name="smart_toy" className="text-primary text-[22px]" />
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-on-surface">AI Assistant &amp; Analytical Preferences</h2>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">Default visualization behavior for analytical answers.</p>
                </div>
              </div>
              <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded font-bold">SEC-03</span>
            </div>
            {/* Default Chart Type → preferences.chartDefault (mapping dari tone control Stitch). */}
            <div className="flex flex-col gap-1.5">
              <span className="font-label-md text-label-md text-on-surface font-semibold">Default Chart Type</span>
              <div className="grid grid-cols-1 md:grid-cols-3 p-1 rounded-lg bg-surface-container-high gap-1">
                {CHART_TYPES.map((type) => {
                  const active = chartDefault === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => { setChartDefault(type); markDirty(); }}
                      className={`tone-toggle py-2 px-3 rounded font-label-md text-label-md text-center transition-all ${
                        active ? 'text-on-primary bg-primary font-bold shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Response Tone, Grounding, SQL Transparency, Causality dihapus: tidak ada field di kontrak. */}
            <div className="p-space-sm rounded-lg bg-surface-container-low flex items-center justify-between gap-space-sm">
              <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Retrieval engine</span>
              <span className="font-label-md text-label-md text-on-surface font-semibold font-mono">
                {meta.data ? `${meta.data.capabilities.sql} · ${meta.data.capabilities.rag}` : 'n/a'}
              </span>
            </div>
          </section>

          {/* SECTION 4: Account & Security */}
          <section className="content-panel bg-surface-container-lowest rounded-xl p-space-md sm:p-space-lg shadow-sm flex flex-col gap-space-md" id="section-account">
            <div className="flex items-center justify-between pb-space-sm">
              <div className="flex items-center gap-space-xs">
                <Icon name="security" className="text-primary text-[22px]" />
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-on-surface">Account &amp; Security</h2>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">Local workspace identity and profile details.</p>
                </div>
              </div>
              <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded font-bold">SEC-04</span>
            </div>
            {/* Current User Profile Card → profile.name / profile.role */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-space-md rounded-xl bg-surface-container-low gap-space-md">
              <div className="flex items-center gap-space-md">
                <div className="w-14 h-14 rounded-full object-cover shadow-sm flex-shrink-0 bg-primary-fixed text-primary flex items-center justify-center font-headline-sm text-headline-sm font-bold">
                  {(name || 'TD').trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-headline-sm text-headline-sm text-on-surface">{name || 'n/a'}</span>
                    <span className="font-label-sm text-label-sm px-2 py-0.5 rounded bg-primary-fixed text-on-primary-fixed font-bold uppercase tracking-wider">Local</span>
                  </div>
                  <span className="font-label-md text-label-md text-primary font-semibold">{role || 'n/a'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={editDetails}
                className="px-space-md py-1.5 rounded-lg bg-surface-container-highest hover:bg-surface-variant text-on-surface font-label-md text-label-md transition-colors flex items-center gap-1.5 self-stretch sm:self-auto justify-center"
              >
                <Icon name="edit" className="text-[16px]" />
                <span>Edit Details</span>
              </button>
            </div>
            {/* API tokens, SSO, Sign Out dihapus: tidak ada auth/token di arsitektur (D.001/D.002). */}

            {/* Bottom Action Suite */}
            <div className="pt-space-md mt-space-sm flex flex-col sm:flex-row items-center justify-between gap-space-sm">
              <p className="font-body-sm text-body-sm text-on-surface-variant">Changes are stored locally in this workspace.</p>
              <div className="flex items-center gap-space-xs w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={discard}
                  disabled={!dirty}
                  className="flex-1 sm:flex-initial px-space-md py-2 rounded-lg bg-surface-container-high text-on-surface-variant font-label-md text-label-md hover:bg-surface-variant transition-colors text-center disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="flex-1 sm:flex-initial px-space-lg py-2 rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  <Icon name="save" className="text-[18px]" />
                  <span>{saving ? 'Saving…' : 'Save Changes'}</span>
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
