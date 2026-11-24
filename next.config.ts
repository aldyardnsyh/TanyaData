import type { NextConfig } from 'next';

/**
 * Security headers (P6-FIX / B1 / SEC-004).
 * `connect-src` mengikuti env build-time agar split deploy (Vercel → VPS)
 * tidak diblokir CSP. `script-src 'unsafe-inline'` dipertahankan sementara
 * karena Next.js bootstrap + JSON-LD statis memakai inline script; migrasi ke
 * nonce dicatat sebagai follow-up.
 *
 * DEV-ONLY (CSP-DEV-FIX): React dev tooling (Fast Refresh / HMR) memakai eval()
 * untuk source-map & debugging. Tanpa 'unsafe-eval', browser memblokirnya dan
 * memunculkan console error "eval() is not supported in this environment".
 * 'unsafe-eval' HANYA ditambahkan saat NODE_ENV !== 'production'.
 * JANGAN pernah aktifkan di produksi — ini melemahkan CSP dan membuka celah XSS
 * berbasis eval. Build produksi tetap ketat tanpa 'unsafe-eval'.
 */
const isDev = process.env.NODE_ENV !== 'production';
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const corsOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? process.env.APP_ORIGIN ?? '')
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const connectSources = ["'self'", apiBase, ...corsOrigins].filter(Boolean).join(' ');

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${connectSources}`,
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '),
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // SEC-002: snapshot share bersifat bearer — jangan pernah diindeks.
      { source: '/share/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};

export default nextConfig;
