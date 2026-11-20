'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  IconSearch as Search,
  IconAlertTriangle as AlertTriangle,
  IconMapPin as MapPin,
  IconFileText as FileText,
  IconLoader as Loader2,
  IconSave as Save,
} from '@/components/ui/icons';
import type {
  AnomaliesResponse,
  CategoryPerformanceResponse,
  Investigation,
  InvestigationsListResponse,
  InvestigationsOverviewResponse,
  InvestigateResponse,
} from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber, formatPercent, formatDateId, formatDateTimeId } from '@/lib/ui/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge, type Status } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { InlineError } from '@/components/ui/inline-error';
import { toast } from '@/components/ui/toaster';
import { Select } from '@/components/ui/select';

const STEPS = ['Menghitung baseline', 'Membandingkan dimensi', 'Menyusun temuan'];

// C-22/DD-04: label Indonesia, tidak hanya warna (§7.4).
const SEVERITY_LABEL: Record<string, string> = { high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };
const CLAIM_LABEL: Record<string, string> = { proven: 'Terbukti', measured: 'Terukur', indication: 'Dugaan' };

function severityStatus(s: string): Status {
  return s === 'high' ? 'danger' : s === 'medium' ? 'warning' : 'neutral';
}
function claimStatus(level: string): Status {
  return level === 'proven' ? 'success' : level === 'measured' ? 'neutral' : 'warning';
}

export default function InvestigationsPage() {
  const overview = useApi<InvestigationsOverviewResponse>('/api/investigations/overview');
  const anomalies = useApi<AnomaliesResponse>('/api/investigations/anomalies');
  const saved = useApi<InvestigationsListResponse>('/api/investigations?limit=20');

  const [question, setQuestion] = useState('Mengapa tingkat kegagalan transaksi meningkat bulan ini?');
  const [channel, setChannel] = useState('');
  const [category, setCategory] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<Investigation | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async (opts?: { question?: string; channel?: string }) => {
    const q = (opts?.question ?? question).trim();
    const ch = opts?.channel ?? channel;
    if (q.length < 3) {
      toast({ status: 'error', message: 'Pertanyaan minimal 3 karakter.' });
      return;
    }
    setAnalyzing(true);
    setAnalysis(null);
    setError(null);
    setSavedId(null);
    try {
      const period = overview.data?.period;
      const res = await fetch('/api/investigations/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          ...(period ? { period: { start: period.start, end: period.end } } : {}),
          compare: 'like_for_like',
          focus: { channel: ch || null, category: category || null },
          persist: false,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: InvestigateResponse = await res.json();
      setAnalysis(json.investigation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analisis gagal.');
    } finally {
      setAnalyzing(false);
    }
  }, [question, channel, category, overview.data?.period]);

  // C-23: simpan analisis yang sudah dijalankan (persist:true → tersimpan & dapat diaudit).
  const saveInvestigation = useCallback(async () => {
    if (!analysis || saving || savedId) return;
    setSaving(true);
    try {
      const period = overview.data?.period;
      const res = await fetch('/api/investigations/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: analysis.question,
          ...(period ? { period: { start: period.start, end: period.end } } : {}),
          compare: 'like_for_like',
          focus: { channel: channel || null, category: category || null },
          persist: true,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: InvestigateResponse = await res.json();
      setSavedId(json.investigation.id);
      saved.retry();
      toast({ status: 'success', message: 'Investigasi tersimpan.', action: 'Buka dossier', onAction: () => { window.location.href = `/investigations/${json.investigation.id}`; } });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal menyimpan investigasi.' });
    } finally {
      setSaving(false);
    }
  }, [analysis, saving, savedId, channel, category, overview.data?.period, saved]);

  const topChannels = overview.data?.topChannels ?? [];
  const channelNames = [...new Set(topChannels.map((c) => c.channelName))];
  // C-20: kategori dari API (bukan hardcode). Bila tidak tersedia, sembunyikan field.
  const categoriesEndpoint = useApi<CategoryPerformanceResponse>('/api/dashboard/category-performance');
  const categories = categoriesEndpoint.data?.items ?? [];
  const categoryNames = categories.length > 0 ? categories.map((c) => c.categoryName) : [];
  const categoriesAvailable = categories.length > 0;

  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-6 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-headline-xl font-bold tracking-tight text-on-surface">Investigasi</h1>
          <p className="mt-0.5 font-body text-body-md text-on-surface-variant">
            {overview.data?.period.label ?? 'Memuat ringkasan…'} · {formatNumber(saved.data?.total ?? null)} investigasi tersimpan
          </p>
        </div>
      </div>

      {/* Ringkasan */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Tingkat kegagalan saat ini</p>
          <p className="mt-1 font-display text-metric-xl font-bold tabular text-on-surface">
            {formatPercent(overview.data?.failureRate.current ?? null)}
          </p>
          <p className="font-body text-body-sm text-on-surface-variant">
            vs {formatPercent(overview.data?.failureRate.previous ?? null)} sebelumnya
          </p>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Anomali terdeteksi</p>
          <p className="mt-1 font-display text-metric-xl font-bold tabular text-on-surface">{formatNumber(anomalies.data?.total ?? null)}</p>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Titik perubahan</p>
          <p className="mt-1 font-display text-metric-xl font-bold tabular text-on-surface">{formatNumber(overview.data?.changePoints.length ?? null)}</p>
        </div>
      </div>

      {/* Form analisis */}
      <Card title="Analisis baru" subtitle="Hitung kontribusi kanal dan kategori terhadap perubahan tingkat kegagalan.">
        <div className={`grid grid-cols-1 gap-3 ${categoriesAvailable ? 'sm:grid-cols-[1fr_200px_200px_auto]' : 'sm:grid-cols-[1fr_200px_auto]'}`}>
          <label className="flex flex-col gap-1">
            <span className="font-body text-label-md text-on-surface">Pertanyaan</span>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="h-9 rounded-md border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface focus:border-primary focus:shadow-[var(--focus-ring)] focus:outline-none"
            />
          </label>
          <Select label="Kanal" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">Semua kanal</option>
            {channelNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          {/* C-20: field kategori hanya tampil bila API menyediakan daftar (R-38: jangan mengarang). */}
          {categoriesAvailable && (
            <Select label="Kategori" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Semua kategori</option>
              {categoryNames.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}
          <div className="flex items-end">
            <Button variant="primary" loading={analyzing} onClick={() => void runAnalysis()}>
              <Search className="h-4 w-4" /> Analisis
            </Button>
          </div>
        </div>
      </Card>

      {analyzing && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5" role="status" aria-live="polite">
          <div className="flex items-center gap-2 font-body text-body-md text-on-surface">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
            Menganalisis…
          </div>
          {/* C-21: daftar langkah statis, tanpa progres palsu. Progres nyata hanya dari respons API. */}
          <div className="mt-3 space-y-2">
            {STEPS.map((s) => (
              <div key={s} className="flex items-center gap-2 font-body text-body-sm text-on-surface-variant">
                <span className="h-1.5 w-1.5 rounded-full bg-surface-container-highest" aria-hidden="true" />
                {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <InlineError title="Analisis gagal" message={error} onRetry={() => void runAnalysis()} />
      )}

      {analysis && (
        <InvestigationResult
          investigation={analysis}
          onSave={saveInvestigation}
          saving={saving}
          savedId={savedId}
        />
      )}

      {/* Top channels */}
      <Card title="Kanal dengan kenaikan terbesar" subtitle="Perbandingan periode setara.">
        {overview.loading ? (
          <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : topChannels.length === 0 ? (
          <EmptyState title="Belum ada anomali" description="Kanal tidak menunjukkan kenaikan tingkat kegagalan yang signifikan." />
        ) : (
          <DataTable
            columns={[
              { key: 'channelName', label: 'Kanal' },
              { key: 'failureRate', label: 'Tingkat gagal', align: 'right', format: (v) => formatPercent(v as number) },
              { key: 'previousFailureRate', label: 'Sebelumnya', align: 'right', format: (v) => formatPercent(v as number) },
              { key: 'excessFailures', label: 'Kelebihan gagal', align: 'right', format: (v) => formatNumber(v as number) },
              { key: 'severity', label: 'Keparahan', format: (v) => (SEVERITY_LABEL[v as string] ?? v) },
            ]}
            rows={topChannels as unknown as Record<string, any>[]}
          />
        )}
      </Card>

      {/* Anomalies */}
      <Card title="Anomali terdeteksi">
        {anomalies.loading ? (
          <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : (anomalies.data?.items ?? []).length === 0 ? (
          <EmptyState title="Tidak ada anomali" description="Tidak ada lonjakan yang melebihi ambang deteksi." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(anomalies.data?.items ?? []).map((a) => (
              <div key={a.id} className="rounded-lg border border-outline-variant bg-surface-container-low p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-body text-label-md font-semibold text-on-surface">
                    {a.channelName ?? a.kind}
                  </span>
                  <StatusBadge status={severityStatus(a.severity)} label={SEVERITY_LABEL[a.severity] ?? a.severity} />
                </div>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                  {a.metric}: {formatPercent(a.baseline)} → {formatPercent(a.current)} ({formatPercent(a.deltaPctPoints)} poin)
                </p>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                  {formatDateId(a.detectedAt)} · {a.window}
                </p>
                {/* C-23: aksi lanjutan — isi kanal lalu jalankan analisis pada anomali ini. */}
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  disabled={analyzing}
                  onClick={() => {
                    const ch = a.channelName ?? '';
                    setChannel(ch);
                    setQuestion(`Mengapa tingkat kegagalan ${ch || 'transaksi'} meningkat?`);
                    void runAnalysis({ question: `Mengapa tingkat kegagalan ${ch || 'transaksi'} meningkat?`, channel: ch });
                  }}
                >
                  Investigasi
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Change points */}
      <Card title="Titik perubahan">
        {overview.loading ? (
          <Skeleton className="h-10 w-full" />
        ) : (overview.data?.changePoints ?? []).length === 0 ? (
          <EmptyState title="Tidak ada titik perubahan" />
        ) : (
          <ul className="space-y-2">
            {(overview.data?.changePoints ?? []).map((cp, i) => (
              <li key={`${cp.channelName}-${cp.date}-${i}`} className="flex items-center gap-2 font-body text-body-md text-on-surface">
                <MapPin className="h-4 w-4 text-tertiary" aria-hidden="true" />
                {cp.channelName} · {formatDateId(cp.date)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Investigasi tersimpan */}
      <Card title="Investigasi tersimpan">
        {saved.loading ? (
          <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : (saved.data?.items ?? []).length === 0 ? (
          <EmptyState
            title="Belum ada investigasi"
            description="Mulai dari anomali teratas atau jalankan analisis baru."
          />
        ) : (
          <ul className="space-y-2">
            {(saved.data?.items ?? []).map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/investigations/${inv.id}`}
                  className="block rounded-lg border border-outline-variant bg-surface-container-low p-4 transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-body text-label-md font-semibold text-on-surface">{inv.question}</span>
                    <StatusBadge status={claimStatus(inv.claimLevel)} label={CLAIM_LABEL[inv.claimLevel] ?? inv.claimLevel} />
                  </div>
                  <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                    {inv.period}{inv.topChannel ? ` · ${inv.topChannel}` : ''} · {formatDateTimeId(inv.createdAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function InvestigationResult({
  investigation,
  onSave,
  saving,
  savedId,
}: {
  investigation: Investigation;
  onSave?: () => void;
  saving?: boolean;
  savedId?: string | null;
}) {
  const cmp = investigation.comparison;
  const claim = investigation.conclusion.claimLevel;
  return (
    <div className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Kesimpulan</p>
          <p className="mt-1 font-body text-body-lg leading-relaxed text-on-surface">{investigation.conclusion.text}</p>
        </div>
        {onSave && (
          <Button size="sm" variant="secondary" loading={saving} disabled={!!savedId} onClick={onSave}>
            <Save className="h-3.5 w-3.5" />
            {savedId ? 'Tersimpan' : 'Simpan investigasi'}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={claimStatus(claim)} label={CLAIM_LABEL[claim] ?? claim} />
        {investigation.conclusion.caveats.map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-sm bg-surface-container-low px-1.5 py-0.5 font-body text-body-sm text-on-surface-variant">
            <AlertTriangle className="h-3 w-3 text-tertiary" aria-hidden="true" /> {c}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-surface-container-low p-3">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Tingkat gagal</p>
          <p className="mt-1 font-display text-metric-md font-bold tabular text-on-surface">{formatPercent(cmp.failureRate.current)}</p>
          <p className="font-body text-body-sm text-on-surface-variant">vs {formatPercent(cmp.failureRate.previous)} ({formatPercent(cmp.failureRate.deltaPctPoints)} poin)</p>
        </div>
        <div className="rounded-lg bg-surface-container-low p-3">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Total transaksi</p>
          <p className="mt-1 font-display text-metric-md font-bold tabular text-on-surface">{formatNumber(cmp.total.current)}</p>
          <p className="font-body text-body-sm text-on-surface-variant">vs {formatNumber(cmp.total.previous)} · {cmp.total.changePct != null ? `${cmp.total.changePct > 0 ? '+' : ''}${formatPercent(cmp.total.changePct)}` : '—'}</p>
        </div>
        <div className="rounded-lg bg-surface-container-low p-3">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Kanal kontributor</p>
          <p className="mt-1 font-display text-metric-md font-bold text-on-surface">
            {investigation.contribution.channels[0]?.channelName ?? '—'}
          </p>
          <p className="font-body text-body-sm text-on-surface-variant">
            {formatNumber(investigation.contribution.channels[0]?.excessFailures ?? null)} kelebihan gagal
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Kontribusi kanal</p>
        <DataTable
          columns={[
            { key: 'channelName', label: 'Kanal' },
            { key: 'failureRate', label: 'Tingkat gagal', align: 'right', format: (v) => formatPercent(v as number) },
            { key: 'baselineFailureRate', label: 'Baseline', align: 'right', format: (v) => formatPercent(v as number) },
            { key: 'excessFailures', label: 'Kelebihan gagal', align: 'right', format: (v) => formatNumber(v as number) },
            { key: 'shareOfExcess', label: 'Pangsa', align: 'right', format: (v) => formatPercent(v as number) },
          ]}
          rows={investigation.contribution.channels as unknown as Record<string, any>[]}
        />
      </div>

      <div>
        <p className="mb-2 font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Timeline</p>
        {investigation.temporal.points.length === 0 ? (
          <p className="font-body text-body-md text-on-surface-variant">Tidak ada titik temporal.</p>
        ) : (
          <ol className="space-y-2 border-l-2 border-outline-variant pl-4">
            {investigation.temporal.points.map((p, i) => (
              <li key={`${p.channelName}-${p.date}-${i}`} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-tertiary" aria-hidden="true" />
                <span className="font-body text-label-md font-semibold text-on-surface">{p.channelName}</span>
                <span className="ml-2 font-body text-body-sm text-on-surface-variant">{formatDateId(p.date)} · {p.kind}</span>
              </li>
            ))}
          </ol>
        )}
        {investigation.temporal.notes.length > 0 && (
          <p className="mt-2 font-body text-body-sm text-on-surface-variant">{investigation.temporal.notes.join(' ')}</p>
        )}
      </div>

      {investigation.documents.length > 0 && (
        <div>
          <p className="mb-2 font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Bukti dokumen</p>
          <div className="space-y-2">
            {investigation.documents.map((d, i) => (
              <div key={`${d.sourceId}-${i}`} className="rounded-lg bg-surface-container-low p-3">
                <p className="flex items-center gap-1.5 font-body text-label-md font-semibold text-on-surface">
                  <FileText className="h-3.5 w-3.5 text-tertiary" /> {d.docTitle ?? d.sourceId}
                  {d.section && <span className="text-on-surface-variant">· {d.section}</span>}
                </p>
                {d.quote && <p className="mt-1 font-body text-body-sm italic text-on-surface-variant">“{d.quote}”</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {investigation.evidence.sql.length > 0 && (
        <div>
          <p className="mb-2 font-body text-label-sm uppercase tracking-wider text-on-surface-variant">SQL</p>
          {investigation.evidence.sql.map((q, i) => (
            <pre key={i} className="mb-2 overflow-x-auto rounded-sm bg-inverse-surface p-3 font-mono text-[12.5px] leading-5 text-inverse-on-surface">{q}</pre>
          ))}
        </div>
      )}
    </div>
  );
}
