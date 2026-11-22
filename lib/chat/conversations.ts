import { randomUUID } from 'node:crypto';
import type { DB } from '@/lib/db/client';
import type {
  ChatMessage,
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationSummary,
} from '@/lib/contracts/http';
import { notFound, validationError } from '@/lib/errors';
import { nowJakartaIso, truncateText } from '@/lib/date';
import { datasetName, resolveScope } from '@/lib/analytics/scope';
import { activeAttachmentForConversation, activeAttachmentsForConversation } from '@/lib/core/attachment-scope';

type ConversationRow = {
  id: string;
  title: string;
  dataset_id: string;
  lang: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  seq: number;
  role: ChatMessage['role'];
  content: string;
  payload_json: string | null;
  created_at: string;
};

export const DEFAULT_TITLE = 'Percakapan baru';

function summaryFrom(
  db: DB,
  row: ConversationRow & { group_name?: string | null; pinned?: number | null },
  counts: { messageCount: number; lastMessageAt: string | null; preview: string | null },
): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    lang: row.lang === 'en' ? 'en' : 'id',
    dataset: { id: row.dataset_id, name: datasetName(row.dataset_id, db) },
    messageCount: counts.messageCount,
    lastMessageAt: counts.lastMessageAt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    groupName: row.group_name ?? null,
    pinned: Boolean(row.pinned),
    ...(counts.preview ? { preview: counts.preview } : {}),
  };
}

export function getConversationRow(db: DB, id: string): ConversationRow {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
  if (!row) throw notFound('Percakapan tidak ditemukan');
  return row;
}

export function listConversations(db: DB, limit: number, offset: number, q?: string | null): ConversationListResponse {
  const search = q?.trim() ?? '';
  const where = search
    ? `WHERE c.title LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ?)`
    : '';
  const params = search ? [`%${search}%`, `%${search}%`] : [];

  const rows = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
              (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY seq DESC LIMIT 1) AS last_message_at,
              (SELECT content FROM messages m WHERE m.conversation_id = c.id AND m.role = 'assistant' ORDER BY seq DESC LIMIT 1) AS preview
         FROM conversations c
         ${where}
        ORDER BY c.pinned DESC, c.updated_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as (ConversationRow & {
    message_count: number;
    last_message_at: string | null;
    preview: string | null;
  })[];

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM conversations c ${where}`)
    .get(...params) as { n: number };

  return {
    items: rows.map((row) =>
      summaryFrom(db, row, {
        messageCount: row.message_count,
        lastMessageAt: row.last_message_at,
        preview: row.preview ? truncateText(row.preview, 120) : null,
      }),
    ),
    total: totalRow.n,
    limit,
    offset,
  };
}

export function createConversation(
  db: DB,
  input: { title?: string | null; dataset?: string | null; lang?: 'id' | 'en' | null },
): ConversationSummary {
  const datasetId = input.dataset ?? 'seed';
  resolveScope(datasetId, db);
  const id = randomUUID();
  const now = nowJakartaIso();
  const title = (input.title?.trim() || DEFAULT_TITLE).slice(0, 60);
  const lang = input.lang ?? 'id';

  db.prepare(
    'INSERT INTO conversations(id, title, dataset_id, lang, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, title, datasetId === 'seed' ? 'seed' : datasetId, lang, now, now);

  return summaryFrom(db, getConversationRow(db, id), { messageCount: 0, lastMessageAt: null, preview: null });
}

export function conversationDetail(db: DB, id: string): ConversationDetailResponse {
  const row = getConversationRow(db, id);
  const messages = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC')
    .all(id) as MessageRow[];
  // FR-C: attachment aktif menentukan konteks chat; diekspos agar UI bisa
  // menunjukkan dokumen mana yang sedang berada dalam lingkup percakapan.
  // Kelompok (plural) = basis pengetahuan percakapan, NotebookLM-style.
  const actives = activeAttachmentsForConversation(db, id);
  const active = actives[actives.length - 1] ?? null;

  return {
    conversation: summaryFrom(db, row, {
      messageCount: messages.length,
      lastMessageAt: messages.length ? messages[messages.length - 1].created_at : null,
      preview: [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? null,
    }),
    activeAttachment: active ? { id: active.id, name: active.name, docType: active.docType } : null,
    activeAttachments: actives.map((a) => ({ id: a.id, name: a.name, docType: a.docType })),
    messages: messages.map(hydrateMessage),
  };
}

export function hydrateMessage(row: MessageRow): ChatMessage {
  const base: ChatMessage = {
    id: row.id,
    role: row.role,
    createdAt: row.created_at,
    content: row.content,
  };
  if (!row.payload_json) return base;
  try {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    return { ...base, ...(payload as Partial<ChatMessage>), id: row.id, role: row.role, createdAt: row.created_at, content: row.content };
  } catch {
    return base;
  }
}

export function removeConversation(db: DB, id: string): void {
  getConversationRow(db, id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

/** Ganti judul / pindahkan grup / sematkan percakapan (menu ⋯ di sidebar). */
export function updateConversation(
  db: DB,
  id: string,
  patch: { title?: string; group?: string | null; pinned?: boolean },
): ConversationSummary {
  getConversationRow(db, id);
  if (patch.title !== undefined) {
    const clean = patch.title.trim().slice(0, 60);
    if (!clean) throw validationError('Judul tidak boleh kosong');
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(clean, id);
  }
  if (patch.group !== undefined) {
    const group = patch.group?.trim().slice(0, 40) || null;
    db.prepare('UPDATE conversations SET group_name = ? WHERE id = ?').run(group, id);
  }
  if (patch.pinned !== undefined) {
    db.prepare('UPDATE conversations SET pinned = ? WHERE id = ?').run(patch.pinned ? 1 : 0, id);
  }
  return summaryFrom(db, getConversationRow(db, id), {
    messageCount: 0,
    lastMessageAt: null,
    preview: null,
  });
}

/**
 * Edit isi pesan pengguna (konsep ChatGPT/Claude: pertanyaan dikoreksi di
 * tempat). Hanya role='user'; jawaban asisten tidak dapat diedit.
 */
export function updateUserMessage(db: DB, conversationId: string, msgId: string, content: string): ChatMessage {
  getConversationRow(db, conversationId);
  const row = db
    .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
    .get(msgId, conversationId) as MessageRow | undefined;
  if (!row) throw notFound('Pesan tidak ditemukan');
  if (row.role !== 'user') throw validationError('Hanya pertanyaan pengguna yang dapat diedit');
  db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, msgId);
  touchConversation(db, conversationId);
  const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId) as MessageRow;
  return hydrateMessage(updated);
}

/**
 * Hapus pertanyaan pengguna BESERTA jawaban asisten tepat setelahnya (satu
 * pasangan tanya-jawab) — menghapus pertanyaan saja meninggalkan jawaban
 * yatim yang membingungkan.
 */
export function deleteUserMessage(db: DB, conversationId: string, msgId: string): void {
  getConversationRow(db, conversationId);
  const row = db
    .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
    .get(msgId, conversationId) as MessageRow | undefined;
  if (!row) throw notFound('Pesan tidak ditemukan');
  if (row.role !== 'user') throw validationError('Hanya pertanyaan pengguna yang dapat dihapus');
  const reply = db
    .prepare("SELECT id FROM messages WHERE conversation_id = ? AND seq > ? AND role = 'assistant' ORDER BY seq LIMIT 1")
    .get(conversationId, row.seq) as { id: string } | undefined;
  db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
  if (reply) db.prepare('DELETE FROM messages WHERE id = ?').run(reply.id);
  touchConversation(db, conversationId);
}

export function touchConversation(db: DB, id: string, patch?: { title?: string }): ConversationRow {
  const now = nowJakartaIso();
  if (patch?.title) {
    db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
      patch.title.slice(0, 60),
      now,
      id,
    );
  } else {
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, id);
  }
  return getConversationRow(db, id);
}

export function countMessages(db: DB, id: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(id) as { n: number };
  return row.n;
}

export type { MessageRow };
