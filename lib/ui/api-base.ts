/**
 * Origin backend untuk split deploy (SP-4).
 *
 * Frontend berjalan di Vercel, backend di VPS. `NEXT_PUBLIC_API_BASE_URL` berisi
 * origin saja (tanpa `/api`, tanpa trailing slash). Bila kosong, semua path
 * kembali relatif sehingga mode lokal/standalone tidak berubah.
 *
 * `NEXT_PUBLIC_*` dibaca literal agar Next meng-inline nilainya saat `next build`;
 * mengubah env di Vercel wajib diikuti rebuild, bukan cukup restart.
 */

/** Origin backend. Kosong = same-origin (mode lokal/standalone). */
export const API_BASE: string = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '')
  .trim()
  .replace(/\/+$/, '');

/** Gabungkan API_BASE dengan path /api/... ; path non-/api dikembalikan apa adanya. */
export function apiUrl(path: string): string {
  if (!path.startsWith('/api/')) return path;
  return `${API_BASE}${path}`;
}
