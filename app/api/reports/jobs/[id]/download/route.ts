import { handleRoute } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { renderReportArtifact } from '@/lib/core/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const artifact = await renderReportArtifact(db, id);
    return new Response(new Uint8Array(artifact.bytes), {
      status: 200,
      headers: {
        'content-type': artifact.contentType,
        'content-disposition': `attachment; filename="${artifact.filename}"`,
        'cache-control': 'no-store, max-age=0',
      },
    });
  });
}
