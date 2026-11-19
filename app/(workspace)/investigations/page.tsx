'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, AlertTriangle, MapPin, FileText, Loader2 } from 'lucide-react';
import type {
  AnomaliesResponse,
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
import { toast } from '@/components/ui/toaster';
import { Select } from '@/components/ui/select';

const STEPS = ['Menghitung baseline', 'Membandingkan dimensi', 'Menyusun temuan'];

function severityStatus(s: string): Status {
  return s === 'high' ? 'danger' : s === 'medium' ? 'warning' : 'neutral';
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
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    if (question.trim().length < 3) {
      toast({ status: 'error', message: 'Pertanyaan minimal 3 karakter.' });
      return;
    }
    setAnalyzing(true);
    setAnalysis(null);
    setError(null);
    setStep(0);
    const stepTimer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 900);
    try {
      const period = overview.data?.period;
      const res = await fetch('/api/investigations/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          ...(period ? { period: { start: period.start, end: period.end } } : {}),
          compare: 'like_for_like',
          focus: { channel: channel || null, category: category || null },
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
      clearInterval(stepTimer);
      setAnalyzing(false);
    }
  }, [question, channel, category, overview.data?.period]);

  const topChannels = overview.data?.topChannels ?? [];
  const channelNames = [...new Set(topChannels.map((c) => c.channelName))];

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
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Failure rate saat ini</p>
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
      <Card title="Analisis baru" subtitle="Hitung kontribusi kanal dan kategori terhadap perubahan failure rate.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px_200px_auto]">
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
          <Select label="Kategori" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Semua kategori</option>
            {['E-commerce', 'Top-up Pulsa & Saldo', 'Tagihan & Utilitas', 'F&B', 'Langganan Digital', 'Travel & Tiket', 'Pendidikan'].map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <div className="flex items-end">
            <Button variant="primary" loading={analyzing} onClick={() => void runAnalysis()}>
              <Search className="h-4 w-4" /> Analisis
            </Button>
          </div>
        </div>
      </Card>

      {analyzing && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          <div className="flex items-center gap-2 font-body text-body-md text-on-surface">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {STEPS[step]}
          </div>
          <div className="mt-3 space-y-2">
            {STEPS.map((s, i) => (
              <div key={s} className={`flex items-center gap-2 font-body text-body-sm ${i <= step ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${i <= step ? 'bg-primary' : 'bg-surface-container-highest'}`} />
                {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-error-container p-4">
          <p className="font-body text-body-md text-on-error-container">{error}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void runAnalysis()}>Coba lagi</Button>
        </div>
      )}

      {analysis && <InvestigationResult investigation={analysis} />}

      {/* Top channels */}
      <Card title="Kanal dengan kenaikan terbesar" subtitle="Perbandingan periode setara.">
        {overview.loading ? (
          <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : topChannels.length === 0 ? (
          <EmptyState title="Belum ada anomali" description="Kanal tidak menunjukkan kenaikan failure rate yang signifikan." />
        ) : (
          <DataTable
            columns={[
              { key: 'channelName', label: 'Kanal' },
              { key: 'failureRate', label: 'Failure rate', align: 'right', format: (v) => formatPercent(v as number) },
              { key: 'previousFailureRate', label: 'Sebelumnya', align: 'right', format: (v) => formatPercent(v as number) },
              { key: 'excessFailures', label: 'Kelebihan gagal', align: 'right', format: (v) => formatNumber(v as number) },
              { key: 'severity', label: 'Severity', format: (v) => (v === 'high' ? 'Tinggi' : v === 'medium' ? 'Sedang' : 'Rendah') },
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
                  <StatusBadge status={severityStatus(a.severity)} label={a.severity} />
                </div>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                  {a.metric}: {formatPercent(a.baseline)} → {formatPercent(a.current)} ({formatPercent(a.deltaPctPoints)} poin)
                </p>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                  {formatDateId(a.detectedAt)} · {a.window}
                </p>
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
                  className="block rounded-lg border border-outline-variant bg-surface-container-low p-4 transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring focus-visible:outline-none"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-body text-label-md font-semibold text-on-surface">{inv.question}</span>
                    <StatusBadge status={inv.claimLevel === 'proven' ? 'success' : inv.claimLevel === 'measured' ? 'neutral' : 'warning'} label={inv.claimLevel} />
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

function InvestigationResult({ investigation }: { investigation: Investigation }) {
  const cmp = investigation.comparison;
  return (
    <div className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
      <div>
        <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Kesimpulan</p>
        <p className="mt-1 font-body text-body-lg leading-relaxed text-on-surface">{investigation.conclusion.text}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatusBadge status={investigation.conclusion.claimLevel === 'proven' ? 'success' : investigation.conclusion.claimLevel === 'measured' ? 'neutral' : 'warning'} label={investigation.conclusion.claimLevel} />
          {investigation.conclusion.caveats.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-sm bg-surface-container-low px-1.5 py-0.5 font-body text-body-sm text-on-surface-variant">
              <AlertTriangle className="h-3 w-3 text-tertiary" /> {c}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-surface-container-low p-3">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Failure rate</p>
          <p className="mt-1 font-display text-metric-md font-bold tabular text-on-surface">{formatPercent(cmp.failureRate.current)}</p>
          <p className="font-body text-body-sm text-on-surface-variant">vs {formatPercent(cmp.failureRate.previous)} ({formatPercent(cmp.failureRate.deltaPctPoints)} poin)</p>
        </div>
        <div className="rounded-lg bg-surface-container-low p-3">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Total transaksi</p>
          <p className="mt-1 font-display text-metric-md font-bold tabular text-on-surface">{formatNumber(cmp.total.current)}</p>
          <p className="font-body text-body-sm text-on-surface-variant">vs {formatNumber(cmp.total.previous)} · {cmp.total.changePct != null ? `${cmp.total.changePct > 0 ? '+' : ''}${cmp.total.changePct.toFixed(1)}%` : 'n/a'}</p>
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
            { key: 'failureRate', label: 'Failure rate', align: 'right', format: (v) => formatPercent(v as number) },
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
