import fs from 'node:fs';
import path from 'node:path';
import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { AppError, validationError } from '@/lib/errors';
import { MAX_UPLOAD_BYTES, detectFormat, sanitizeFilename } from '@/lib/ingest/validate';
import { createSource, listSources, newSourceId, sourceToDto, storagePathFor } from '@/lib/ingest/store';
import { processSource } from '@/lib/ingest/pipeline';
import { sourceKindSchema, sourceStatusSchema } from '@/lib/api/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleRoute(() => {
    const db = ensureWorkspaceReady();
    const url = new URL(request.url);
    const kindParam = url.searchParams.get('kind');
    const statusParam = url.searchParams.get('status');
    const kind = kindParam ? sourceKindSchema.safeParse(kindParam) : null;
    const status = statusParam ? sourceStatusSchema.safeParse(statusParam) : null;
    if (kind && !kind.success) throw validationError('kind harus "dataset" atau "document"');
    if (status && !status.success) throw validationError('status tidak dikenal');

    const result = listSources(db, { kind: kind?.data ?? null, status: status?.data ?? null });
    return jsonResponse({ items: result.items, total: result.items.length, counts: result.counts });
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Gunakan multipart/form-data dengan field file dan kind');
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw validationError('Multipart body tidak dapat dibaca');
    }

    const file = form.get('file');
    if (!(file instanceof File)) throw validationError('Field "file" wajib diunggah');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError(413, 'FILE_TOO_LARGE', 'Ukuran file melebihi 25 MB', { maxBytes: MAX_UPLOAD_BYTES });
    }
    if (file.size === 0) throw validationError('File kosong');

    const kindParsed = sourceKindSchema.safeParse(form.get('kind'));
    if (!kindParsed.success) throw validationError('Field "kind" harus "dataset" atau "document"');
    const kind = kindParsed.data;

    const buffer = Buffer.from(await file.arrayBuffer());
    const originalName = sanitizeFilename(file.name || 'upload');
    const format = detectFormat(kind, originalName, file.type || '', buffer);

    const rawName = (form.get('name') ?? '').toString().trim();
    const name = (rawName || path.parse(originalName).name || 'upload').slice(0, 120);

    const sourceId = newSourceId();
    const storagePath = storagePathFor(sourceId, format);
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    fs.writeFileSync(storagePath, buffer);

    createSource(db, {
      id: sourceId,
      kind,
      name,
      originalName,
      format,
      mime: file.type || 'application/octet-stream',
      sizeBytes: buffer.length,
      storagePath,
    });

    const processed = await processSource(db, sourceId, buffer);
    return jsonResponse({ source: sourceToDto(processed.row), job: processed.job }, 202);
  });
}
