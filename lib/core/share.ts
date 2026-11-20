/**
 * Share snapshot — ADR-13 / CORE_V2_ARCHITECTURE §5, FR-E.
 *
 * Snapshot statis mandiri: dibekukan saat konfirmasi, tidak pernah render ulang
 * OCR/SQL saat dibaca. Token stabil (bukan query_id). Bearer link tanpa login —
 * konfirmasi + opsi sembunyikan sitasi/identitas wajib. Tanpa revoke (Q-02).
 */

import { randomBytes } from 'node:crypto';
import type { DB } from '@/lib/db/client';
import { nowJakartaIso } from '@/lib/date';
import { conflict, notFound, validationError } from '@/lib/errors';
import { getConversationRow, type MessageRow } from '@/lib/chat/conversations';
import { findDataset } from '@/lib/core/registry';

export const SHARE_MAX_BYTES = 2 * 1024 * 1024;
export const SHARE_MAX_MESSAGES = 50;
export const SHARE_MAX_ROWS = 500;
export const SHARE_MAX_CITATIONS = 20;
export const SHARE_QUOTA_BYTES = 200 * 1024 * 1024;

export type ShareOptions = { includeCitations: boolean; includeIdentity: boolean };

export type ShareSnapshot = {
  id: string;
  conversationId: string;
  options: ShareOptions;
  payload: SharePayload;
  byteSize: number;
  createdAt: string;
};

export type SharePayload = {
  title: string | null;
  summary: string | null;
  identity: {
    docType: string;
    fileName: string | null;
    page: number | null;
    documentIncluded: boolean;
    anchorId: string | null;
  } | null;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    createdAt: string;
    question: string | null;
    answer: string | null;
    outputs: unknown[];
    citations: unknown[];
    guardrail: { type: string; explanation: string; keywords: string[] } | null;
    meta: { source: string | null; period: string | null; rowCount: number | null } | null;
  }>;
  generatedAt: string;
};

type SnapshotRow = {
  id: string;
  conversation_id: string;
  payload_json: string;
  options: string;
  byte_size: number;
  created_at: string;
};

function parseOptions(raw: string): ShareOptions {
  try {
    const value = JSON.parse(raw) as Partial<ShareOptions>;
    return {
      includeCitations: value.includeCitations !== false,
      includeIdentity: value.includeIdentity !== false,
    };
  } catch {
    return { includeCitations: true, includeIdentity: true };
  }
}

function rowToSnapshot(row: SnapshotRow): ShareSnapshot {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    options: parseOptions(row.options),
    payload: JSON.parse(row.payload_json) as SharePayload,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

function hydrateMessage(row: MessageRow): Record<string, unknown> {
  if (!row.payload_json) return {};
  try {
    return JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function capRows(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.rows) && obj.rows.length > SHARE_MAX_ROWS) {
    return { ...obj, rows: obj.rows.slice(0, SHARE_MAX_ROWS), truncated: true };
  }
  return obj;
}

export function createShareSnapshot(
  db: DB,
  input: { conversationId: string; confirmed?: boolean; options?: Partial<ShareOptions> },
): ShareSnapshot {
  if (input.confirmed !== true) {
    throw validationError('Konfirmasi wajib sebelum membuat share link', { field: 'confirmed' });
  }
  const conversation = getConversationRow(db, input.conversationId);
  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC')
    .all(input.conversationId) as MessageRow[];
  if (!rows.length) throw validationError('Percakapan kosong tidak dapat dibagikan');

  const options: ShareOptions = {
    includeCitations: input.options?.includeCitations !== false,
    includeIdentity: input.options?.includeIdentity !== false,
  };

  const dataset = findDataset(db, conversation.dataset_id);
  const identity = options.includeIdentity
    ? {
        docType: dataset?.doc_type ?? 'unknown',
        fileName: dataset?.name ?? null,
        page: null,
        documentIncluded: dataset?.kind === 'document' || dataset?.kind === 'mixed',
        anchorId: null,
      }
    : null;

  const messages: SharePayload['messages'] = [];
  let citationCount = 0;
  for (const row of rows.slice(0, SHARE_MAX_MESSAGES)) {
    const payload = hydrateMessage(row);
    const isAssistant = row.role === 'assistant';
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    const citations = options.includeCitations ? sources.slice(0, SHARE_MAX_CITATIONS - citationCount) : [];
    citationCount += citations.length;
    const meta = payload.meta as Record<string, unknown> | undefined;
    const viz = Array.isArray(payload.visualizations) ? payload.visualizations : [];
    const outputs = isAssistant
      ? [
          ...viz.map((v) => ({ ...(v as Record<string, unknown>), data: capRows((v as Record<string, unknown>).rows) })),
          ...(payload.supportingTable
            ? [{ type: 'table', data: capRows(payload.supportingTable) }]
            : []),
        ]
      : [];
    const guardrail = payload.guardrail as Record<string, unknown> | undefined;
    messages.push({
      id: row.id,
      role: isAssistant ? 'assistant' : 'user',
      createdAt: row.created_at,
      question: isAssistant ? null : row.content,
      answer: isAssistant ? String(payload.answer ?? row.content ?? '') : null,
      outputs,
      citations,
      guardrail: guardrail
        ? {
            type: String(guardrail.type ?? 'unsupported'),
            explanation: String(guardrail.explanation ?? ''),
            keywords: Array.isArray(guardrail.keywords) ? guardrail.keywords.map(String) : [],
          }
        : null,
      meta: meta
        ? {
            source: meta.dataset ? String((meta.dataset as Record<string, unknown>).name ?? '') : null,
            period: meta.period ? String((meta.period as Record<string, unknown>).label ?? '') : null,
            rowCount: typeof meta.rowCount === 'number' ? meta.rowCount : null,
          }
        : null,
    });
  }

  const assistantAnswer = messages.find((m) => m.role === 'assistant' && m.answer)?.answer ?? null;
  const payload: SharePayload = {
    title: conversation.title || messages.find((m) => m.role === 'user' && m.question)?.question || null,
    summary: assistantAnswer,
    identity,
    messages,
    generatedAt: nowJakartaIso(),
  };

  const serialized = JSON.stringify(payload);
  const byteSize = Buffer.byteLength(serialized, 'utf8');
  if (byteSize > SHARE_MAX_BYTES) {
    throw validationError('Snapshot melebihi batas 2 MB', { byteSize, maxBytes: SHARE_MAX_BYTES });
  }
  const used = (db.prepare('SELECT COALESCE(SUM(byte_size), 0) AS n FROM core_share_snapshots').get() as { n: number }).n;
  if (used + byteSize > SHARE_QUOTA_BYTES) {
    throw conflict('Kuota share 200 MB penuh. Link lama tidak dihapus; hapus share lama secara manual bila diperlukan.');
  }

  const id = `sh_${randomBytes(12).toString('hex')}`;
  const createdAt = nowJakartaIso();
  db.prepare(
    `INSERT INTO core_share_snapshots(id, conversation_id, payload_json, options, byte_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.conversationId, serialized, JSON.stringify(options), byteSize, createdAt);

  return { id, conversationId: input.conversationId, options, payload, byteSize, createdAt };
}

export function getShareSnapshot(db: DB, id: string): ShareSnapshot {
  const row = db.prepare('SELECT * FROM core_share_snapshots WHERE id = ?').get(id) as SnapshotRow | undefined;
  if (!row) throw notFound('Share link tidak ditemukan');
  return rowToSnapshot(row);
}

export function listShareSnapshots(
  db: DB,
  options: { limit?: number; offset?: number } = {},
): { items: Array<Omit<ShareSnapshot, 'payload'>>; total: number; limit: number; offset: number } {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const total = (db.prepare('SELECT COUNT(*) AS n FROM core_share_snapshots').get() as { n: number }).n;
  const rows = db
    .prepare('SELECT * FROM core_share_snapshots ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as SnapshotRow[];
  return {
    items: rows.map((row) => {
      const snapshot = rowToSnapshot(row);
      const { payload: _payload, ...rest } = snapshot;
      return rest;
    }),
    total,
    limit,
    offset,
  };
}
