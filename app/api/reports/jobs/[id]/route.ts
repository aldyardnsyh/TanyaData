import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { getReportJob } from '@/lib/core/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const job = getReportJob(db, id);
    return jsonResponse({
      job: {
        id: job.id,
        queryId: job.queryId,
        format: job.format,
        status: job.status,
        downloadUrl: `/api/reports/jobs/${job.id}/download`,
        rowCap: job.rowCap,
        createdAt: job.createdAt,
      },
    });
  });
}
