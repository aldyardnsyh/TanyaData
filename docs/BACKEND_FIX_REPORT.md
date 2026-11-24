# Backend Fix Report — TanyaData

Ringkasan perbaikan backend/keamanan yang sudah diterapkan pada sesi sebelumnya, plus perbaikan typecheck sesi ini. **Bukan** hasil security re-test — itu lane `security` (lihat Handoff).

## 1. Perbaikan keamanan (sesi sebelumnya)

### SEC-001 — Guard deploy publik (fail-closed)
- `lib/api/public-deploy-guard.ts:28-54` — `assertPublicDeployAllowed()`: menolak (503, `PUBLIC_DEPLOY_BLOCKED`) seluruh request bila `PUBLIC_DEPLOY` aktif tanpa `API_ACCESS_TOKEN`. Banner fatal/warn sekali saat startup.
- `lib/api/respond.ts:39-47` — `handleRoute()` menjadi satu choke point: guard dipanggil sebelum handler apa pun, error ditangkap terpusat.
- `.env.example:28-32` — variabel `PUBLIC_DEPLOY` / `API_ACCESS_TOKEN` didokumentasikan sebagai rahasia VPS-only, placeholder non-rahasia.

### SEC-002 — Share snapshot: expiry, revoke, noindex
- `lib/core/share.ts:26-31` — TTL default 30 hari (`SHARE_TTL_DAYS`, clamp 1..365), fail-closed.
- `lib/core/share.ts:109-114` — `isExpired()`; timestamp invalid dianggap kedaluwarsa.
- `lib/core/share.ts:228-233` — `expires_at` ditulis saat insert snapshot.
- `lib/core/share.ts:248-255` — `getShareSnapshot()` menolak snapshot expired/revoked dengan pesar 404 seragam (tidak membocorkan keberadaan token).
- `lib/core/share.ts:257-274` — `revokeShareSnapshot()` idempoten, alasan dibatasi 120 char dan whitelist karakter.
- `app/api/share/[id]/route.ts:16-18,33` — header `x-robots-tag: noindex, nofollow` pada GET; endpoint DELETE untuk cabut link.
- `app/api/share/route.ts:11-20` — skema Zod: `confirmed` wajib `literal(true)`, opsi tervalidasi.
- `next.config.ts:45-46` — header `X-Robots-Tag: noindex, nofollow` untuk `/share/:path*`.

### SEC-003 — Origin server-side, bukan header klien (anti-SSRF)
- `lib/config/origin.ts:19-32` — `normalizeOrigin()` membuang origin non-http(s), memaksa https di produksi, menolak path/query/userinfo.
- `lib/config/origin.ts:62-70` — `getPdfOrigin()` fail-closed bila tidak ada allow-list valid; tidak pernah jatuh ke `Host` / `x-forwarded-*`.
- `app/api/reports/[id]/export/route.ts:55-65` — ekspor PDF memakai `getPdfOrigin()`, error diredaksi sebelum log.
- `.env.example:15-26` — `APP_ORIGIN`, `CORS_ALLOWED_ORIGINS`, `NEXT_PUBLIC_API_BASE_URL` didokumentasikan; dilarang diisi dari header klien.

### SEC-004 — Security headers
- `next.config.ts:17-37` — CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. `connect-src` mengikuti env build-time agar split deploy tidak diblokir.

### SEC-005 — Rate limiting
- `lib/api/rate-limit.ts:13-20` — token bucket per policy/IP: `query` 10/menit, `share` 30/menit, `export` 10/menit.
- `lib/api/rate-limit.ts:38-75` — respons 429 `RATE_LIMITED` + header `retry-after` / `ratelimit-*`.
- Dipasang di `app/api/share/route.ts:23,33`, `app/api/share/[id]/route.ts:20,40`, `app/api/reports/[id]/export/route.ts:19`.

### SEC-006 — Redaksi log & sanitasi error
- `lib/api/sanitize.ts:22-46` — `redactForLog()` / `sanitizeStoredError()`: email, angka panjang, bearer token, secret, path, stack frame dibuang/diredaksi.
- `lib/api/sanitize.ts:52-73` — `sanitizeForClient()` membuang key `stack`/`stderr`/`cause`/`path` dari `AppError.details`.
- `lib/api/respond.ts:29-37` — `errorResponse()`: detail disanitasi ke klien; error tak tertangani hanya log pesan teredaksi, tanpa stack trace / PII.

### Kontrak error
- `lib/contracts/http.ts:100-112` — `ApiErrorCode` ditambah `RATE_LIMITED` (429) dan `PUBLIC_DEPLOY_BLOCKED` (503).

## 2. Perbaikan typecheck (sesi ini)

Dua peta `ERROR_MESSAGES: Record<ApiErrorCode, string>` belum memiliki dua kode baru, sehingga `tsc --noEmit` gagal dengan TS2739.

- `app/(workspace)/data-sources/[id]/page.tsx:25-26` — menambahkan `RATE_LIMITED` dan `PUBLIC_DEPLOY_BLOCKED`.
- `app/(workspace)/data-sources/page.tsx:40-41` — menyamakan pesan kedua entri yang sudah ada dengan teks final yang ditentukan.

Pesan yang dipakai (keduanya identik):
- `RATE_LIMITED: 'Terlalu banyak permintaan. Coba lagi beberapa saat lagi.'`
- `PUBLIC_DEPLOY_BLOCKED: 'Fitur ini tidak tersedia pada deployment publik tanpa autentikasi.'`

## 3. Hasil verifikasi

```
python "C:\Users\aldya\.config\opencode\scripts\safe_exec.py" --timeout 240 -- npm run typecheck
> tanyadata@1.0.0 typecheck
> tsc --noEmit
EXIT=0 ELAPSED=6.7s
```

`npm run typecheck` **PASS (EXIT=0)**. Tidak ada build penuh yang dijalankan. Tidak ada klaim security re-test — itu bukan hasil di sini.

## 4. Cara setup dari nol (ringkas)

1. Salin `.env.example` → `.env.local`; isi `APP_ORIGIN` (https di produksi) dan, bila `PUBLIC_DEPLOY=1`, wajib isi `API_ACCESS_TOKEN` lewat secret manager/reverse proxy.
2. `npm install`
3. Jalankan migrasi workspace (skema `core_share_snapshots` sudah menyertakan `expires_at`, `revoked_at`, `revoked_reason`).
4. `npm run typecheck` → harus EXIT=0.

## 5. Handoff

```yaml
from: backend
to: qa
phase: P6
type: deliverable
refs:
  - docs/BACKEND_FIX_REPORT.md
  - lib/contracts/http.ts
  - lib/api/respond.ts
  - lib/api/public-deploy-guard.ts
  - lib/api/rate-limit.ts
  - lib/api/sanitize.ts
  - lib/config/origin.ts
  - lib/core/share.ts
  - app/api/share/route.ts
  - app/api/share/[id]/route.ts
  - app/api/reports/[id]/export/route.ts
  - next.config.ts
  - .env.example
  - app/(workspace)/data-sources/[id]/page.tsx
  - app/(workspace)/data-sources/page.tsx
summary: Kontrak error diperluas dengan RATE_LIMITED dan PUBLIC_DEPLOY_BLOCKED; kedua peta ERROR_MESSAGES UI sudah diperbarui sehingga tsc --noEmit lolos (EXIT=0). Perbaikan keamanan sesi sebelumnya (guard deploy publik, expiry/revoke share, origin fail-closed, security headers, rate limit, redaksi log) terdokumentasi dengan file:line di atas.
evidence: docs/BACKEND_FIX_REPORT.md + npm run typecheck EXIT=0 (6.7s) + cara setup dari nol di §4
blocking: false
needs: pengujian end-user lewat UI oleh qa dan security re-test / pentest oleh lane security (belum diklaim lulus di sini)
```
