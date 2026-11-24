import { handleRoute } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rate-limit';
import { redactForLog } from '@/lib/api/sanitize';
import { getPdfOrigin } from '@/lib/config/origin';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { getReport } from '@/lib/reports/store';
import { reportToCsv } from '@/lib/reports/export';
import { reportFileName } from '@/lib/reports/naming';
import { renderReportPdf } from '@/lib/reports/print-pdf';
import { renderReportDetailXlsx } from '@/lib/core/report';
import { validationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const limited = rateLimit(request, 'export');
  if (limited) return limited;
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const format = url.searchParams.get('format') ?? 'csv';
    if (format !== 'csv' && format !== 'pdf' && format !== 'xlsx') {
      throw validationError('format harus "csv", "pdf", atau "xlsx"');
    }
    const report = getReport(db, id);

    if (format === 'csv') {
      const csv = reportToCsv(report);
      return new Response(csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${reportFileName(report, 'csv')}"`,
          'cache-control': 'no-store, max-age=0',
        },
      });
    }

    if (format === 'xlsx') {
      const xlsx = await renderReportDetailXlsx(report);
      return new Response(new Uint8Array(xlsx), {
        status: 200,
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${reportFileName(report, 'xlsx')}"`,
          'cache-control': 'no-store, max-age=0',
        },
      });
    }

    // SEC-003 / V-3: origin HARUS dari konfigurasi server (APP_ORIGIN), bukan
    // dari Host / x-forwarded-proto / x-forwarded-host yang dikendalikan klien.
    // getPdfOrigin() fail-closed bila tidak ada allow-list yang valid.
    const origin = getPdfOrigin();
    let pdf: Uint8Array<ArrayBuffer>;
    try {
      pdf = await renderReportPdf(origin, id);
    } catch (error) {
      console.error('[export] PDF failed:', redactForLog(error instanceof Error ? error.message : error));
      throw error;
    }
    return new Response(pdf, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${reportFileName(report, 'pdf')}"`,
        'cache-control': 'no-store, max-age=0',
      },
    });
  });
}
