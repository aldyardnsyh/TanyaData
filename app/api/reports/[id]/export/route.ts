import { handleRoute } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { getReport } from '@/lib/reports/store';
import { reportToCsv, reportToPdf } from '@/lib/reports/export';
import { renderReportDetailXlsx } from '@/lib/core/report';
import { validationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const format = new URL(request.url).searchParams.get('format') ?? 'csv';
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
          'content-disposition': `attachment; filename="tanyadata-${report.id}.csv"`,
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
          'content-disposition': `attachment; filename="tanyadata-${report.id}.xlsx"`,
          'cache-control': 'no-store, max-age=0',
        },
      });
    }

    const pdf = await reportToPdf(report);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="tanyadata-${report.id}.pdf"`,
        'cache-control': 'no-store, max-age=0',
      },
    });
  });
}
