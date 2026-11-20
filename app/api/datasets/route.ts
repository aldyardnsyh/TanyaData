import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { parsePagination } from '@/lib/api/validate';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { AppError, validationError } from '@/lib/errors';
import { createDataset, listDatasets, listSteps } from '@/lib/core/registry';
import { ingestIntoDataset, persistUpload, validateUpload } from '@/lib/core/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const { limit, offset } = parsePagination(new URL(request.url).searchParams, 50, 100);
    const result = listDatasets(db, { limit, offset });
    return jsonResponse({ items: result.items, total: result.total, limit, offset });
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
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
    const rawName = (form.get('name') ?? '').toString().trim();
    const name = (rawName || validated.safeName.replace(/\.[^.]+$/, '')).slice(0, 120);

    const dataset = createDataset(db, {
      name,
      kind: 'tabular',
      source_type: validated.format,
      status: 'UPLOADED',
      sha256: validated.sha256,
      size_bytes: validated.buffer.length,
    });
    const storagePath = persistUpload(dataset.id, validated.safeName, validated.buffer);
    const ready = await ingestIntoDataset(db, {
      dataset: { ...dataset, storage_path: storagePath },
      buffer: validated.buffer,
      format: validated.format,
      originalName: validated.originalName,
      storagePath,
    });

    return jsonResponse({ dataset: ready, steps: listSteps(db, ready.id) }, 202);
  });
}
