import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { AppError, validationError } from '@/lib/errors';
import { getDataset, listSteps, updateDataset } from '@/lib/core/registry';
import { ingestIntoDataset, persistUpload, validateUpload } from '@/lib/core/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const { id } = await ctx.params;
    const dataset = getDataset(db, id);
    if (dataset.is_demo) {
      throw new AppError(409, 'CONFLICT', 'Dataset demo bersifat read-only dan tidak dapat di-ingest ulang');
    }
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Gunakan multipart/form-data dengan field "file"');
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw validationError('Multipart body tidak dapat dibaca');
    }
    const file = form.get('file');
    if (!(file instanceof File)) throw validationError('Field "file" wajib diunggah');

    const validated = validateUpload({
      filename: file.name,
      mime: file.type,
      size: file.size,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    const storagePath = persistUpload(id, validated.safeName, validated.buffer);
    updateDataset(db, id, {
      source_type: validated.format,
      storage_path: storagePath,
      sha256: validated.sha256,
      size_bytes: validated.buffer.length,
    });
    const ready = await ingestIntoDataset(db, {
      dataset: { ...dataset, storage_path: storagePath, source_type: validated.format },
      buffer: validated.buffer,
      format: validated.format,
      originalName: validated.originalName,
      storagePath,
    });
    return jsonResponse({ dataset: ready, steps: listSteps(db, id) }, 202);
  });
}
