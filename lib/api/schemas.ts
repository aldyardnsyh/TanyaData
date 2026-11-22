import { z } from 'zod';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD');
export const langSchema = z.enum(['id', 'en']);
export const statusSchema = z.enum(['SUCCESS', 'FAILED', 'PENDING', 'EXPIRED', 'REFUNDED']);
export const compareSchema = z.enum(['like_for_like', 'previous', 'none']);
export const grainSchema = z.enum(['day', 'week', 'month']);
export const sourceKindSchema = z.enum(['dataset', 'document']);
export const sourceStatusSchema = z.enum(['UPLOADED', 'PROCESSING', 'READY', 'FAILED']);

export const conversationCreateSchema = z.object({
  title: z.string().trim().max(120).optional(),
  dataset: z.string().trim().min(1).optional(),
  lang: langSchema.optional(),
});

export const conversationPatchSchema = z.object({
  title: z.string().trim().min(1, 'Judul tidak boleh kosong').max(60, 'Judul maksimal 60 karakter').optional(),
  group: z.string().trim().max(40, 'Nama grup maksimal 40 karakter').nullable().optional(),
  pinned: z.boolean().optional(),
});

export const messageCreateSchema = z.object({
  content: z.string().trim().min(1, 'Pesan tidak boleh kosong').max(2000, 'Pesan maksimal 2000 karakter'),
  lang: langSchema.optional(),
  period: z.object({ start: isoDate, end: isoDate }).optional(),
  dataset: z.string().trim().min(1).optional(),
});

export const reportCreateSchema = z.object({
  title: z.string().trim().max(120).optional(),
});

export const reportPatchSchema = z.object({
  title: z.string().trim().min(1, 'Judul tidak boleh kosong').max(120, 'Judul maksimal 120 karakter'),
});

export const messagePatchSchema = z.object({
  content: z.string().trim().min(1, 'Pesan tidak boleh kosong').max(2000, 'Pesan maksimal 2000 karakter'),
});

export const investigateSchema = z.object({
  question: z.string().trim().min(3, 'Pertanyaan minimal 3 karakter').max(500),
  period: z.object({ start: isoDate, end: isoDate }).optional(),
  compare: compareSchema.optional(),
  focus: z
    .object({
      channel: z.string().trim().max(60).nullable().optional(),
      category: z.string().trim().max(60).nullable().optional(),
    })
    .optional(),
  persist: z.boolean().optional(),
  dataset: z.string().trim().min(1).optional(),
  lang: langSchema.optional(),
});

export const settingsPatchSchema = z.object({
  lang: langSchema.optional(),
  dateRange: z
    .object({
      start: isoDate,
      end: isoDate,
      preset: z.string().trim().max(20).optional(),
    })
    .optional(),
  activeDatasetId: z.string().trim().min(1).optional(),
  profile: z
    .object({
      name: z.string().trim().max(80).optional(),
      role: z.string().trim().max(80).optional(),
    })
    .optional(),
  preferences: z
    .object({
      chartDefault: z.enum(['bar', 'line', 'pie']).optional(),
      denseTables: z.boolean().optional(),
    })
    .optional(),
});

export const sourcePostSchema = z.object({
  kind: sourceKindSchema,
  name: z.string().trim().max(120).optional(),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().max(120).optional(),
});

export type ConversationCreateBody = z.infer<typeof conversationCreateSchema>;
export type MessageCreateBody = z.infer<typeof messageCreateSchema>;
export type InvestigateBody = z.infer<typeof investigateSchema>;
export type SettingsPatchBody = z.infer<typeof settingsPatchSchema>;
