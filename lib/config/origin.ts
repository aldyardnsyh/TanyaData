/**
 * Resolver origin server-side (P6-FIX / SEC-003 / V-3 / SP-3).
 *
 * PRINSIP: origin untuk render PDF dan allow-list CORS TIDAK PERNAH berasal
 * dari header yang dikendalikan klien (`Host`, `x-forwarded-host`,
 * `x-forwarded-proto`). Semua berasal dari environment server.
 *
 * `APP_ORIGIN` boleh berisi daftar origin dipisah koma. Entri yang tidak valid
 * dibuang (fail-closed). Di produksi hanya `https:` yang diterima.
 */

const DEV_ORIGINS = ['http://127.0.0.1:3000', 'http://localhost:3000'];

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Normalisasi + validasi satu origin. Mengembalikan `origin` URL atau null. */
export function normalizeOrigin(value: string): string | null {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (isProduction() && url.protocol !== 'https:') return null;
    // Origin murni: tidak boleh ada path/query/fragment/userinfo.
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseList(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? '').split(',')) {
    const origin = normalizeOrigin(part);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/** Allow-list untuk CORS. `CORS_ALLOWED_ORIGINS` menggantikan `APP_ORIGIN`. */
export function getCorsOrigins(): string[] {
  const configured = parseList(process.env.CORS_ALLOWED_ORIGINS || process.env.APP_ORIGIN);
  if (configured.length) return configured;
  return isProduction() ? [] : DEV_ORIGINS;
}

/** Allow-list origin untuk keperluan server (canonical URL, PDF). */
export function getAllowedOrigins(): string[] {
  const configured = parseList(process.env.APP_ORIGIN);
  if (configured.length) return configured;
  return isProduction() ? [] : [DEV_ORIGINS[0]];
}

/**
 * Origin tunggal untuk navigasi headless browser saat ekspor PDF.
 * Melempar bila tidak ada konfigurasi valid — fail-closed, jangan jatuh ke
 * `Host` header.
 */
export function getPdfOrigin(): string {
  const origins = getAllowedOrigins();
  if (!origins.length) {
    throw new Error(
      'APP_ORIGIN belum dikonfigurasi dengan origin https yang valid. Ekspor PDF ditolak untuk mencegah SSRF.',
    );
  }
  return origins[0];
}
