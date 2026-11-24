/**
 * Backend-owned redaction helpers (P6-FIX / B8 / B10 / SEC-006).
 *
 * Dipakai sebelum menulis ke log dan sebelum menyimpan/mengembalikan pesan error
 * ke klien. Tidak mengimpor modul AI — jadi aman dipakai dari lapisan API,
 * ingest, dan route handler tanpa menarik dependency berat.
 *
 * Aturan: alamat email, angka panjang (NIK/no. rekening), bearer token, secret,
 * dan path absolut tidak boleh muncul di log maupun di field `error` yang
 * terekspos lewat `GET /api/sources/:id`.
 */

const EMAIL_RE = /([\w.+-]+)@([\w-]+\.[\w.]+)/g;
const LONG_NUMBER_RE = /\b\d{12,19}\b/g;
const BEARER_RE = /(Bearer\s+)\S+/gi;
const SECRET_RE = /(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi;
const WIN_PATH_RE = /\b[A-Za-z]:\\[^\s"'`]+/g;
const UNIX_PATH_RE = /(^|[\s"'(=])\/(?:srv|home|var|tmp|Users|usr|opt)\/[^\s"'`]+/g;
const STACK_LINE_RE = /\bat\s+[\w.$]+\s+\([^)]*\)/g;

/** Bersihkan teks sebelum `console.*`. Memotong output agar tidak membanjiri log. */
export function redactForLog(value: unknown): string {
  let out = String(value ?? '');
  out = out
    .replace(EMAIL_RE, '[email]')
    .replace(LONG_NUMBER_RE, '[number]')
    .replace(BEARER_RE, '$1[redacted]')
    .replace(SECRET_RE, '$1=[redacted]')
    .replace(WIN_PATH_RE, '[path]')
    .replace(UNIX_PATH_RE, '$1[path]')
    .replace(STACK_LINE_RE, '[stack-frame]');
  return out.length > 2000 ? `${out.slice(0, 2000)}…[truncated]` : out;
}

/**
 * Versi untuk nilai yang disimpan di DB / dikirim ke klien.
 * Lebih konservatif: path dibuang total, panjang dibatasi 300 karakter.
 */
export function sanitizeStoredError(value: unknown): string {
  const cleaned = redactForLog(value instanceof Error ? value.message : value)
    .replace(WIN_PATH_RE, '[path]')
    .replace(UNIX_PATH_RE, '$1[path]')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned;
}

/**
 * Sanitasi `AppError.details` sebelum dikirim ke klien.
 * Field yang berisi stack/stderr/cause/path dibuang; string lain diredaksi.
 */
export function sanitizeForClient(details: unknown): unknown {
  if (details === undefined) return undefined;
  const DROP_KEYS = new Set(['stack', 'stderr', 'stdout', 'cause', 'path', 'filePath', 'storagePath']);

  const walk = (value: unknown, depth: number): unknown => {
    if (depth > 4) return '[truncated]';
    if (typeof value === 'string') return redactForLog(value);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => walk(item, depth + 1));
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (DROP_KEYS.has(key)) continue;
        out[key] = walk(item, depth + 1);
      }
      return out;
    }
    return '[unserializable]';
  };

  return walk(details, 0);
}
