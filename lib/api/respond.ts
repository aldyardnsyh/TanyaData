import type { ApiErrorCode } from '@/lib/contracts/http';
import { assertPublicDeployAllowed } from '@/lib/api/public-deploy-guard';
import { redactForLog, sanitizeForClient } from '@/lib/api/sanitize';
import { AppError, isAppError } from '@/lib/errors';

export const NO_STORE = 'no-store, max-age=0';

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': NO_STORE,
    },
  });
}

export function noContent(): Response {
  return new Response(null, {
    status: 204,
    headers: { 'cache-control': NO_STORE },
  });
}

export function errorBody(code: ApiErrorCode, message: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function errorResponse(error: unknown): Response {
  if (isAppError(error)) {
    // details disanitasi: stack/path/stderr tidak pernah dikirim ke klien.
    return jsonResponse(errorBody(error.code, error.message, sanitizeForClient(error.details)), error.status);
  }
  // B8/B10: log hanya pesan yang sudah diredaksi, tanpa stack trace dan tanpa PII.
  console.error('[api] unhandled error:', redactForLog(error instanceof Error ? error.message : error));
  return jsonResponse(errorBody('INTERNAL_ERROR', 'Terjadi kesalahan internal. Coba lagi.'), 500);
}

export async function handleRoute(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    // SEC-001: satu choke point untuk seluruh endpoint API.
    assertPublicDeployAllowed();
    return await fn();
  } catch (error) {
    return errorResponse(error);
  }
}

export function methodNotAllowed(allow: string[]): Response {
  return new Response(
    JSON.stringify(errorBody('METHOD_NOT_ALLOWED', `Metode tidak didukung. Gunakan: ${allow.join(', ')}.`)),
    {
      status: 405,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': NO_STORE,
        allow: allow.join(', '),
      },
    },
  );
}

export function notFoundRoute(): Response {
  return jsonResponse(errorBody('NOT_FOUND', 'Endpoint tidak ditemukan'), 404);
}
