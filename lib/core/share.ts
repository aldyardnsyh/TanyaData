/**
 * Share snapshot — ADR-13 / CORE_V2_ARCHITECTURE §5, FR-E.
 *
 * Snapshot statis mandiri: dibekukan saat konfirmasi, tidak pernah render ulang
 * OCR/SQL saat dibaca. Token stabil (bukan query_id). Bearer link tanpa login —
 * konfirmasi + opsi sembunyikan sitasi/identitas wajib.
 *
 * P6-FIX / SEC-002: link kini punya expiry (default 30 hari) dan bisa dicabut
 * lewat `revokeShareSnapshot`. GET menolak snapshot yang expired/revoked.
 * `noindex` ditangani di halaman share + header X-Robots-Tag.
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

/** Umur default share link (hari). Bisa di-override lewat env SHARE_TTL_DAYS. */
const SHARE_TTL_DAYS = (() => {
  const raw = Number(process.env.SHARE_TTL_DAYS ?? 30);
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 365) : 30;
})();
const SHARE_TTL_MS = SHARE_TTL_DAYS * 24 * 60 * 60 * 1000;

export type ShareOptions = { includeCitations: boolean; includeIdentity: boolean };

export type ShareSnapshot = {
  id: string;
  conversationId: string;
  options: ShareOptions;
  payload: SharePayload;
  byteSize: number;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
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
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
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
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
    revokedReason: row.revoked_reason ?? null,
  };
}

/** Fail-closed: timestamp tidak valid dianggap kedaluwarsa. */
function isExpired(expiresAt: string | null): boolean {
  if (expiresAt === null) return false; // baris lama sudah di-backfill saat migrasi
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
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
  const expiresAt = nowJakartaIso(Date.now() + SHARE_TTL_MS);
  db.prepare(
    `INSERT INTO core_share_snapshots
       (id, conversation_id, payload_json, options, byte_size, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.conversationId, serialized, JSON.stringify(options), byteSize, createdAt, expiresAt);

  return {
    id,
    conversationId: input.conversationId,
    options,
    payload,
    byteSize,
    createdAt,
    expiresAt,
    revokedAt: null,
    revokedReason: null,
  };
}

export function getShareSnapshot(db: DB, id: string): ShareSnapshot {
  const row = db.prepare('SELECT * FROM core_share_snapshots WHERE id = ?').get(id) as SnapshotRow | undefined;
  // Pesan seragam: tidak membocorkan apakah token pernah ada / dicabut / expired.
  if (!row || row.revoked_at || isExpired(row.expires_at)) {
    throw notFound('Share link tidak ditemukan atau sudah tidak berlaku');
  }
  return rowToSnapshot(row);
}

/**
 * Cabut share link (idempoten). Dipanggil endpoint DELETE /api/share/:id.
 * Catatan: belum ada auth in-app — lihat SEC-001 / ADR-SD-02 sebelum publik.
 */
export function revokeShareSnapshot(db: DB, id: string, reason = 'revoked_by_owner'): ShareSnapshot {
  const row = db.prepare('SELECT * FROM core_share_snapshots WHERE id = ?').get(id) as SnapshotRow | undefined;
  if (!row) throw notFound('Share link tidak ditemukan');
  if (!row.revoked_at) {
    const safeReason = String(reason ?? '').replace(/[^\w.-]/g, '').slice(0, 120) || 'revoked_by_owner';
    db.prepare('UPDATE core_share_snapshots SET revoked_at = ?, revoked_reason = ? WHERE id = ?').run(
      nowJakartaIso(),
      safeReason,
      id,
    );
  }
  const updated = db.prepare('SELECT * FROM core_share_snapshots WHERE id = ?').get(id) as SnapshotRow;
  return rowToSnapshot(updated);
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
