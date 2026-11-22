import { z } from 'zod';
import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { listReports } from '@/lib/reports/store';
import { parseJsonBody, parsePagination } from '@/lib/api/validate';
import { createReportJob } from '@/lib/core/report';
import type { DocType } from '@/lib/core/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reportJobSchema = z.object({
  queryId: z.string().trim().min(1, 'queryId wajib diisi'),
  conversationId: z.string().trim().min(1).nullable().optional(),
  format: z.enum(['pdf', 'xlsx']),
  docType: z.enum(['legal', 'technical_report', 'financial', 'general']).optional(),
});

export async function GET(request: Request) {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const params = new URL(request.url).searchParams;
    const { limit, offset } = parsePagination(params, 20, 100);
    const q = (params.get('q') ?? '').slice(0, 120);
    return jsonResponse(listReports(db, limit, offset, q));
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const body = await parseJsonBody(request, reportJobSchema);
    const job = createReportJob(db, {
      queryId: body.queryId,
      conversationId: body.conversationId,
      format: body.format,
      docType: body.docType as DocType | undefined,
    });
    return jsonResponse(
      {
        job: {
          id: job.id,
          queryId: job.queryId,
          format: job.format,
          status: job.status,
          downloadUrl: `/api/reports/jobs/${job.id}/download`,
          rowCap: job.rowCap,
          createdAt: job.createdAt,
        },
      },
      201,
    );
  });
}
