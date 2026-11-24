/**
 * Rate limiter in-process untuk endpoint mahal (P6-FIX / B2 / SEC-005).
 *
 * Token bucket per policy + IP. Cocok untuk satu proses standalone di VPS.
 * Untuk multi-instance, ganti Map dengan Redis (catatan di API_CONTRACT §14).
 * Mengembalikan Response 429 bila kuota habis, otherwise `null`.
 */

import { errorBody } from '@/lib/api/respond';

type Policy = { limit: number; windowMs: number };

const POLICIES = {
  /** DB + FTS + kemungkinan panggilan LLM. */
  query: { limit: 10, windowMs: 60_000 },
  /** Buat/list/resolve/revoke share snapshot. */
  share: { limit: 30, windowMs: 60_000 },
  /** Menjalankan binary browser headless. */
  export: { limit: 10, windowMs: 60_000 },
} satisfies Record<string, Policy>;

export type RateLimitPolicy = keyof typeof POLICIES;

type Bucket = { tokens: number; last: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5_000;

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return request.headers.get('x-real-ip')?.trim().slice(0, 64) || 'local';
}

export function rateLimit(request: Request, policy: RateLimitPolicy): Response | null {
  const config = POLICIES[policy];
  const key = `${policy}:${clientIp(request)}`;
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_KEYS) buckets.clear();
    bucket = { tokens: config.limit, last: now };
    buckets.set(key, bucket);
  }

  const elapsed = now - bucket.last;
  if (elapsed >= config.windowMs) {
    bucket.tokens = config.limit;
    bucket.last = now;
  } else if (elapsed > 0) {
    bucket.tokens = Math.min(config.limit, bucket.tokens + (elapsed / config.windowMs) * config.limit);
  }

  if (bucket.tokens < 1) {
    const retryAfter = Math.max(1, Math.ceil((config.windowMs - (now - bucket.last)) / 1000));
    return new Response(JSON.stringify(errorBody('RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi nanti.')), {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'retry-after': String(retryAfter),
        'ratelimit-limit': String(config.limit),
        'ratelimit-remaining': '0',
        'ratelimit-reset': String(retryAfter),
      },
    });
  }

  bucket.tokens -= 1;
  return null;
}
