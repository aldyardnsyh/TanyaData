import { sanitizeStoredError } from '@/lib/api/sanitize';
import type { DB } from '@/lib/db/client';
import { isAppError } from '@/lib/errors';
import { ingestDataset } from '@/lib/ingest/dataset';
import { ingestDocument } from '@/lib/ingest/documents';
import {
  createJob,
  getJob,
  getSourceRow,
  jobDto,
  updateJob,
  updateSource,
  type SourceRow,
} from '@/lib/ingest/store';
import type { IngestionJob, SourceListItem } from '@/lib/contracts/http';
import { sourceToDto } from '@/lib/ingest/store';

export type ProcessedSource = { row: SourceRow; job: IngestionJob };

export async function processSource(db: DB, sourceId: string, buffer: Buffer): Promise<ProcessedSource> {
  const row = getSourceRow(db, sourceId);
  const job = createJob(db, row.id, row.kind === 'dataset' ? 'structured' : 'document');

  try {
    updateJob(db, job.id, { step: 'parsing', progress: 10 });
    updateSource(db, row.id, { status: 'PROCESSING' });

    if (row.kind === 'dataset') {
      await ingestDataset(db, row, buffer);
    } else {
      updateJob(db, job.id, { step: 'chunking', progress: 55 });
      await ingestDocument(db, row, buffer);
    }

    updateJob(db, job.id, { status: 'DONE', step: 'done', progress: 100, finished: true });
    return { row: getSourceRow(db, row.id), job: jobDto(getJob(db, job.id)) };
  } catch (error) {
    const message = sanitizeStoredError(error);
    updateSource(db, row.id, { status: 'FAILED', error: message });
    updateJob(db, job.id, { status: 'FAILED', step: 'failed', error: message, finished: true });
    if (isAppError(error)) throw error;
    throw error;
  }
}

export function processedSourceDto(result: ProcessedSource): { source: SourceListItem; job: IngestionJob } {
  return { source: sourceToDto(result.row), job: result.job };
}
