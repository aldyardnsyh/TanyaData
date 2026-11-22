import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { deleteReport, getReport, renameReport } from '@/lib/reports/store';
import { reportPatchSchema } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    return jsonResponse({ report: getReport(db, id) });
  });
}

/** Ganti judul laporan (mis. disesuaikan dengan nama dokumen sumbernya). */
export async function PATCH(request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const body = await parseJsonBody(request, reportPatchSchema);
    return jsonResponse({ report: renameReport(db, id, body.title) });
  });
}

/** Hapus laporan tersimpan (permanen). */
export async function DELETE(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    deleteReport(db, id);
    return jsonResponse({ deleted: true }, 200);
  });
}
