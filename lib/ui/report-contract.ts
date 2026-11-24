/**
 * UI-facing contract untuk alur job /api/reports (CORE_V2_ARCHITECTURE §5 ReportJob).
 * Backend pemilik endpoint; modul ini hanya menormalkan wire shape.
 */

import { apiUrl } from '@/lib/ui/api-base';

export type ReportFormat = 'pdf' | 'xlsx';
export type ReportJobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

export type ReportJobView = {
  id: string;
  status: ReportJobStatus;
  format: ReportFormat;
  /** 0..100, atau null bila backend tidak mengirim progress (indeterminate). */
  progress: number | null;
  title: string | null;
  downloadUrl: string | null;
  error: string | null;
  createdAt: string | null;
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function normalizeReportJob(raw: unknown): ReportJobView {
  const root = rec(raw);
  const job = rec(pick(root, 'job', 'reportJob', 'report_job') ?? root);
  const rawStatus = str(pick(job, 'status')).toUpperCase();
  const status: ReportJobStatus = ['QUEUED', 'RUNNING', 'DONE', 'FAILED'].includes(rawStatus)
    ? (rawStatus as ReportJobStatus)
    : 'QUEUED';
  const rawFormat = str(pick(job, 'format')).toLowerCase();
  const progressValue = pick(job, 'progress', 'percent');
  const progress = typeof progressValue === 'number' && Number.isFinite(progressValue)
    ? Math.max(0, Math.min(100, progressValue))
    : null;

  return {
    id: str(pick(job, 'id', 'jobId', 'job_id')),
    status,
    format: rawFormat === 'xlsx' || rawFormat === 'excel' ? 'xlsx' : 'pdf',
    progress,
    title: nullableStr(pick(job, 'title', 'judul')),
    downloadUrl: nullableStr(pick(job, 'downloadUrl', 'download_url', 'artifactUrl', 'artifact_url')),
    error: nullableStr(pick(job, 'error', 'message')),
    createdAt: nullableStr(pick(job, 'createdAt', 'created_at')),
  };
}

/** URL unduh: pakai yang dikirim backend, jika tidak ada fallback ke route yang dikontrakkan. */
export function reportDownloadUrl(job: ReportJobView): string {
  return apiUrl(job.downloadUrl ?? `/api/reports/${encodeURIComponent(job.id)}/download`);
}
