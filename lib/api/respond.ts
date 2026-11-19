import type { ApiErrorCode } from '@/lib/contracts/http';
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
    return jsonResponse(errorBody(error.code, error.message, error.details), error.status);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error('[api] unhandled error:', message);
  return jsonResponse(errorBody('INTERNAL_ERROR', 'Terjadi kesalahan internal. Coba lagi.'), 500);
}

export async function handleRoute(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
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
