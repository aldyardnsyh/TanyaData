import type { z } from 'zod';
import { validationError } from '@/lib/errors';

const MAX_JSON_BYTES = 1_000_000;

export async function parseJsonBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) {
    throw validationError('Body terlalu besar (maks 1 MB)');
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw validationError('Body harus berupa JSON yang valid');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw validationError('Payload tidak valid', formatIssues(parsed.error));
  }
  return parsed.data;
}

export function parseQueryParams<S extends z.ZodType>(searchParams: URLSearchParams, schema: S): z.infer<S> {
  const raw: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (!(key in raw)) raw[key] = value;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw validationError('Parameter query tidak valid', formatIssues(parsed.error));
  }
  return parsed.data;
}

export function formatIssues(error: z.ZodError): { field: string; issue: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    issue: issue.message,
  }));
}

export function parsePagination(searchParams: URLSearchParams, defaultLimit = 20, maxLimit = 100) {
  const limitRaw = Number(searchParams.get('limit') ?? defaultLimit);
  const offsetRaw = Number(searchParams.get('offset') ?? 0);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), maxLimit) : defaultLimit;
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0;
  return { limit, offset };
}
