/**
 * Attachment scope — FR-C.1–2, CORE_V2_ARCHITECTURE §5.
 *
 * Satu conversation memetakan satu attachment aktif. Gate `READY` ditegakkan
 * di server: chunk dari attachment non-aktif / belum READY tidak boleh masuk
 * konteks. Pergantian attachment tidak menimpa conversation lama.
 */

import { randomBytes } from 'node:crypto';
import type { DB } from '@/lib/db/client';
import { nowJakartaIso } from '@/lib/date';
import { notFound, unprocessable, validationError } from '@/lib/errors';
import { findDataset } from '@/lib/core/registry';

export type AttachmentStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';

export type Attachment = {
  id: string;
  datasetId: string;
  sourceId: string | null;
  name: string;
  docType: string;
  status: AttachmentStatus;
  activeInConversation: string | null;
  qualityReportRef: string | null;
  createdAt: string;
};

type AttachmentRow = {
  id: string;
  dataset_id: string;
  source_id: string | null;
  name: string;
  doc_type: string;
  status: AttachmentStatus;
  active_in_conversation: string | null;
  quality_report_ref: string | null;
  created_at: string;
};

function rowToAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    sourceId: row.source_id,
    name: row.name,
    docType: row.doc_type,
    status: row.status,
    activeInConversation: row.active_in_conversation,
    qualityReportRef: row.quality_report_ref,
    createdAt: row.created_at,
  };
}

export function createAttachment(
  db: DB,
  input: { datasetId: string; sourceId?: string | null; name?: string | null; activeInConversation?: string | null },
): Attachment {
  const datasetId = String(input.datasetId ?? '').trim();
  if (!datasetId) throw validationError('datasetId wajib diisi', { field: 'datasetId' });
  const dataset = findDataset(db, datasetId);
  if (!dataset) throw notFound(`Dataset ${datasetId} tidak ditemukan`);
  const sourceId = input.sourceId?.trim() || null;

  const existing = db
    .prepare('SELECT * FROM core_attachments WHERE dataset_id = ? AND source_id IS ?')
    .get(datasetId, sourceId) as AttachmentRow | undefined;
  if (existing) {
    // Re-binding (FR-C): memasang konteks ke percakapan lain harus memindahkan
    // attachment aktif — bukan mengembalikan baris lama dengan percakapan usang.
    if (input.activeInConversation !== undefined && input.activeInConversation !== existing.active_in_conversation) {
      db.prepare('UPDATE core_attachments SET active_in_conversation = ? WHERE id = ?').run(
        input.activeInConversation,
        existing.id,
      );
      return rowToAttachment(
        db.prepare('SELECT * FROM core_attachments WHERE id = ?').get(existing.id) as AttachmentRow,
      );
    }
    return rowToAttachment(existing); // idempoten tanpa perubahan konteks
  }

  const id = `att_${randomBytes(8).toString('hex')}`;
  const now = nowJakartaIso();
  db.prepare(
    `INSERT INTO core_attachments
       (id, dataset_id, source_id, name, doc_type, status, active_in_conversation, quality_report_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    datasetId,
    sourceId,
    (input.name?.trim() || dataset.name).slice(0, 120),
    dataset.doc_type,
    dataset.status,
    input.activeInConversation ?? null,
    datasetId,
    now,
  );
  return rowToAttachment(db.prepare('SELECT * FROM core_attachments WHERE id = ?').get(id) as AttachmentRow);
}

export function getAttachment(db: DB, id: string): Attachment {
  const row = db.prepare('SELECT * FROM core_attachments WHERE id = ?').get(id) as AttachmentRow | undefined;
  if (!row) throw notFound('Attachment tidak ditemukan');
  return rowToAttachment(row);
}

/** Gate READY — dipakai sebelum attachment masuk konteks chat. */
export function assertAttachmentReady(db: DB, id: string): Attachment {
  const attachment = getAttachment(db, id);
  if (attachment.status !== 'READY') {
    throw unprocessable(`Attachment "${attachment.name}" belum siap (status: ${attachment.status})`, {
      reason: 'ATTACHMENT_NOT_READY',
      status: attachment.status,
    });
  }
  return attachment;
}

export function listAttachments(
  db: DB,
  options: { datasetId?: string; status?: AttachmentStatus; limit?: number; offset?: number } = {},
): { items: Attachment[]; total: number; limit: number; offset: number } {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (options.datasetId) {
    clauses.push('dataset_id = ?');
    params.push(options.datasetId);
  }
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM core_attachments ${where}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT * FROM core_attachments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as AttachmentRow[];
  return { items: rows.map(rowToAttachment), total, limit, offset };
}

/** Resolve attachment aktif untuk conversation; null bila belum dipilih. */
export function activeAttachmentForConversation(db: DB, conversationId: string): Attachment | null {
  const row = db
    .prepare('SELECT * FROM core_attachments WHERE active_in_conversation = ? ORDER BY created_at DESC LIMIT 1')
    .get(conversationId) as AttachmentRow | undefined;
  return row ? rowToAttachment(row) : null;
}

/**
 * Semua attachment aktif percakapan = kelompok dokumen (NotebookLM-style):
 * percakapan bisa berbasis SATU dokumen atau KELOMPOK dokumen tertentu.
 */
export function activeAttachmentsForConversation(db: DB, conversationId: string): Attachment[] {
  const rows = db
    .prepare('SELECT * FROM core_attachments WHERE active_in_conversation = ? ORDER BY created_at ASC')
    .all(conversationId) as AttachmentRow[];
  return rows.map(rowToAttachment);
}

/** Tempel/lepas attachment dari percakapan (FR-C.1-2): null = lepas dari konteks. */
export function setActiveInConversation(db: DB, id: string, conversationId: string | null): Attachment {
  const attachment = getAttachment(db, id);
  db.prepare('UPDATE core_attachments SET active_in_conversation = ? WHERE id = ?').run(
    conversationId,
    id,
  );
  return getAttachment(db, id);
}
