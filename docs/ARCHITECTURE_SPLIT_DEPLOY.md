# ARCHITECTURE SPLIT DEPLOY — TanyaData

**Versi:** 1.0 · **Tanggal:** 2026-11-23 · **Oleh:** architect · **Fase:** P4-REVIEW (lanjutan)
**Pemicu:** `docs/DECISIONS.md` → **DECISION-029** (user: frontend di Vercel, backend/API/SQLite/OCR/PDF di VPS pribadi).
**Input dibaca:** `docs/ARCHITECTURE_REVIEW_P4.md`, `docs/DECISIONS.md` (001–029), `docs/API_CONTRACT.md`, `docs/ARCHITECTURE.md` (v1), `tanyadata/next.config.ts`, `tanyadata/vercel.json`, `tanyadata/lib/api/**`, `tanyadata/lib/db/paths.ts`, `tanyadata/lib/reports/print-pdf.ts`, `tanyadata/lib/core/share.ts`, `tanyadata/app/api/reports/[id]/export/route.ts`, `tanyadata/app/share/[id]/page.tsx`, `tanyadata/.env.example`, dan grep pola `fetch(` di frontend.
**Metode:** baca kode + grep statis. Tidak menjalankan app, build, server, atau test. Tidak mengubah kode dan dokumen role lain.

---

## 1. Ringkasan & Verdict

**Verdict akhir untuk rilis produk: `FEASIBLE_WITH_CHANGES`.**

DECISION-029 menghilangkan alasan lama `NOT_FEASIBLE` untuk Vercel: native module `better-sqlite3`, filesystem writable, dan browser binary PDF tidak lagi dijalankan di serverless. Ketiganya kini berada di VPS yang dikontrol user. Namun verdict belum `FEASIBLE` karena blocker keamanan dan durabilitas lama tetap hidup, dan split deploy memperkenalkan tiga kewajiban baru yang belum ada di kode: **pemisahan artefak build**, **CORS + base URL API**, dan **origin PDF yang tidak bergantung pada frontend**.

**DECISION-032 (2026-11-23)** menambah satu komponen di sisi VPS: **Qdrant** sebagai secondary index retrieval. Qdrant berada **di VPS bersama backend, tidak di Vercel**. Tidak ada `NEXT_PUBLIC_QDRANT_*`, tidak ada koneksi browser ke port 6333, dan SQLite tetap source of truth dengan FTS5 sebagai default/fallback. Detail arsitektur retrieval ada di `docs/ARCHITECTURE.md` §13 dan `docs/ADR_QDRANT.md` (ADR-QD-01..06).

**DECISION-034 (2026-11-23)** menambah komponen kedua di sisi VPS: **OCR PP-OCRv6 tiny** sebagai microservice `deploy/ocr/` (FastAPI + `onnxocr`, ONNX Runtime saja). OCR berada **di VPS bersama backend dan Qdrant, tidak di Vercel**, dan **tidak berjalan di dalam proses Next.js**. OCR hidup on-demand hanya saat fase ingestion dokumen image-only, konkurensi = 1, lalu dimatikan. Detail resource budget, tiga fase ingestion, watchdog, dan fallback jujur ada di `docs/ARCHITECTURE.md` §13.9 dan ADR-RES-01 di §13.10.

> **Resolusi konflik (architect):** `docs/CORE_V2_ARCHITECTURE.md` §2 baris "Privasi" masih menyebut
> dokumen dikirim keluar VPS ke OCR remote. DECISION-034 (lebih baru, arahan user) menetapkan OCR
> sebagai microservice **di dalam VPS** — nilai inilah yang mengikat. Baris "Privasi" tersebut perlu
> diselaraskan oleh role pemiliknya; laporan ini tidak mengubah dokumen itu. Kontrak request/respons
> ADR-11 (`POST ${OCR_ENDPOINT}`, PNG base64 ≤2 MB, timeout 5 s, konkurensi=1) tetap berlaku apa adanya.

> Kontrak payload di `docs/API_CONTRACT.md` **tetap mengikat apa adanya**. Laporan ini hanya menambahkan **lapis transport** (origin, CORS, auth, upload, download, share) di atas kontrak tersebut. Tidak ada endpoint yang diubah bentuk responsnya.

---

## 2. Topologi & boundary

```
Browser user
   │  HTML/RSC/CSS/JS  (port 443)
   ▼
┌──────────────────────────────┐        ┌──────────────────────────────────────┐
│ FRONTEND — Vercel            │        │ BACKEND — VPS user (2 vCPU / 2 GB)   │
│ app/(workspace)/**, app/page │        │ app/api/**, lib/**, data/**          │
│ components/**, lib/ui/**,    │        │ Next.js standalone                   │
│ public/**, app/share/[id]    │        │ node .next/standalone/server.js      │
│                              │        │                                      │
│ TIDAK ADA: app/api/**,       │        │ SQLite: seed (RO) + workspace (RW)   │
│ lib/db/**, lib/core/**,      │        │ FTS5, LLM adapter (client Groq)      │
│ better-sqlite3, browser PDF  │        │ Qdrant v1.20.0 — secondary index     │
│ TIDAK ADA: Qdrant / :6333 /  │        │ bind 127.0.0.1:6333 + API key        │
│ NEXT_PUBLIC_QDRANT_*         │        │ OCR microservice deploy/ocr/         │
│ TIDAK ADA: OCR / OCR_* /     │        │   PP-OCRv6 tiny, on-demand, konkr=1   │
│ deploy/ocr/                  │        │ Chromium headless + BROWSER_PDF_*    │
└──────────────┬───────────────┘        │ Caddy/Nginx: TLS + reverse proxy     │
                │                        └──────────────┬───────────────────────┘
               │ fetch(`${NEXT_PUBLIC_API_BASE_URL}/api/...`)
               │ Authorization: Bearer <token>   (kecuali GET /api/share/:id)
               │ CORS: Allow-Origin eksplisit + Allow-Credentials tidak dipakai
               ▼                                       │
               └─────────────── cross-origin ──────────┘
```

**Aturan boundary (mengikat):**

| Aspek | Frontend (Vercel) | Backend (VPS) |
|---|---|---|
| Artefak | build frontend-only | `output: 'standalone'` (sudah di `next.config.ts:4`) |
| State | **nol**. Tidak ada DB, tidak ada upload, tidak ada cookie session | satu `WORKSPACE_DIR` persisten + seed read-only |
| Akses FS | hanya aset statis | `DATA_DIR`, `WORKSPACE_DIR`, `UPLOADS_DIR`, `BACKUP_DIR` |
| Rahasia | hanya `NEXT_PUBLIC_*` (bukan rahasia) | `API_ACCESS_TOKEN`, `LLM_API_KEY`, kredensial backup |
| Retrieval / Qdrant | **tidak ada**. Tidak ada `NEXT_PUBLIC_QDRANT_*`, tidak ada fetch ke `:6333` | Qdrant container di VPS; secondary index aditif; SQLite source of truth; FTS5 default/fallback (DECISION-032, `ARCHITECTURE.md` §13) |
| Rahasia Qdrant | tidak ada | `QDRANT_API_KEY` (secret manager), `MODEL_DIR` untuk embedding lokal |
| OCR (DECISION-034) | **tidak ada**. Tidak ada `NEXT_PUBLIC_OCR_*`, tidak ada fetch ke `OCR_ENDPOINT` | microservice `deploy/ocr/` di VPS, di luar proses Next.js; PP-OCRv6 tiny via `onnxocr`; on-demand, konkurensi=1, timeout/halaman, dimatikan setelah Fase A; env `OCR_*` (§7) |
| PDF | tidak pernah render | render HTML internal + Chromium |
| Share | halaman `/share/[id]` (tampilan) | `GET /api/share/:id` (snapshot, publik) |

**Tidak ada filesystem bersama.** Frontend tidak pernah membaca `analytics.db`, `documents.json`, atau `uploads/`. Semua angka dan teks datang dari HTTP.

**Tidak ada jaringan bersama ke Qdrant.** Frontend tidak pernah menghubungi port 6333; hanya backend
VPS yang memanggil Qdrant lewat `127.0.0.1` / Caddy dengan `QDRANT_API_KEY`. Qdrant bukan origin
CORS dan tidak masuk `connect-src` CSP. Lihat `ARCHITECTURE.md` §13.6 untuk daftar env lengkap.

**Tidak ada OCR di Vercel dan tidak ada OCR di proses Next.js.** Frontend tidak pernah memanggil
`OCR_ENDPOINT`; hanya phase runner di backend VPS yang menghubungi microservice `deploy/ocr/` lewat
loopback. OCR bukan origin CORS, tidak masuk `connect-src` CSP, dan tidak punya `NEXT_PUBLIC_OCR_*`.
Microservice hidup on-demand, konkurensi = 1, lalu dimatikan — tidak resident bersama embedding/Qdrant
(DECISION-034, `ARCHITECTURE.md` §13.9).

---

## 3. Kontrak HTTP lintas origin

### 3.1 Base URL

- `NEXT_PUBLIC_API_BASE_URL` = **origin saja**, tanpa trailing slash, tanpa `/api`.
  Contoh non-rahasia: `https://api.contoh.local`. Jangan `https://api.contoh.local/api/` — base path `/api` sudah ada di `API_CONTRACT.md` §1.
- Fallback `''` (string kosong) dipertahankan agar mode lokal/standalone tetap memanggil `/api/...` relatif.
- **Fakta kode:** grep 34 pemanggilan `fetch('/api/...')` di `app/(workspace)/**`, `components/share/**`, dan `lib/ui/i18n-provider.tsx`. **Tidak ada satu pun** yang memakai `NEXT_PUBLIC_API_BASE_URL`. Ini harus diganti sebelum rilis (SP-4).
- `NEXT_PUBLIC_*` tertanam saat **`next build`**, bukan saat runtime. Mengubahnya di Vercel wajib diikuti rebuild.

### 3.2 CORS (wajib di backend)

`next.config.ts:3-6` saat ini hanya berisi `output` + `serverExternalPackages`; tidak ada header CORS dan tidak ada `middleware.ts`. Backend wajib menambahkan, untuk semua `/api/**` termasuk preflight `OPTIONS`:

| Header | Nilai |
|---|---|
| `Access-Control-Allow-Origin` | origin frontend yang diizinkan, **eksplisit** (bukan `*`) |
| `Vary` | `Origin` |
| `Access-Control-Allow-Methods` | `GET, POST, PUT, DELETE, OPTIONS` |
| `Access-Control-Allow-Headers` | `content-type, authorization, x-request-id` |
| `Access-Control-Expose-Headers` | `content-disposition` (agar filename PDF/XLSX/CSV terbaca saat download via blob) |
| `Access-Control-Max-Age` | `600` |
| `Cache-Control` | `no-store, max-age=0` (sudah ada di `lib/api/respond.ts:4-13`) |

`Access-Control-Allow-Credentials` **tidak dipakai** — desain auth memakai bearer, bukan cookie (§3.3). Mengizinkan `*` bersama kredensial dilarang.

**Alternatif ditolak:** Vercel `rewrites` `/api/* → VPS`. Alasan: menambah hop, kena batas durasi function Vercel (query LLM `LLM_TIMEOUT_MS=12000` di `.env.example:17` bisa melewati batas hobby), dan menyembunyikan CORS bukan menyelesaikannya. Direct cross-origin lebih sederhana dan bisa diuji dengan satu `curl -i -X OPTIONS`.

### 3.3 Auth lintas origin

S-1 tetap blocker. Untuk split deploy, mekanisme yang dipilih:

- Backend memverifikasi `Authorization: Bearer <API_ACCESS_TOKEN>` dengan perbandingan `timingSafeEqual` pada middleware/helper bersama. Token **hanya** di env VPS, tidak pernah di `NEXT_PUBLIC_*`, tidak pernah di log.
- Frontend menyimpan token di **memory/sessionStorage** setelah form login lokal, lalu mengirimkannya di setiap request. Bukan `localStorage` (mengurangi persistensi).
- **Satu-satunya endpoint publik:** `GET /api/share/:id`. Endpoint lain menolak tanpa token dengan `401` ber-envelope `API_CONTRACT.md` §1.1.
- `app/share/[id]/page.tsx:1-7` **belum** punya `export const metadata = { robots: { index: false } }` (grep `robots|noindex` = 0). Wajib ditambahkan.
- Share link tetap bearer permanen tanpa revoke (`lib/core/share.ts:199`, token 96-bit; Q-02). Ini **risiko yang belum tertutup**, bukan klaim selesai.

**Alternatif ditolak:** (a) cookie `SameSite=None; Secure` — butuh `Allow-Credentials`, domain induk, dan permukaan CSRF; (b) OAuth/OIDC — over-engineering untuk satu user; (c) IP allow-list — browser user tidak punya IP statis dan egress Vercel tidak bisa dijadikan jaminan.

### 3.4 Upload file

- Kontrak tetap `API_CONTRACT.md` §8.2: `POST /api/sources`, `multipart/form-data`, field `file` (≤ 25 MB), `kind`, `name` opsional. Bukti kode: `app/api/sources/route.ts:34-56` memanggil `request.formData()` dan `file.arrayBuffer()`.
- Frontend **dilarang** men-set `Content-Type` manual saat `FormData` — browser yang menentukan boundary. CORS `Allow-Headers` harus memuat `content-type`.
- Reverse proxy VPS wajib mengizinkan body ≥ 26 MB. Ini keuntungan split deploy: tidak ada batas 4,5 MB Vercel di jalur upload.
- Validasi MIME + magic bytes dan sanitasi nama file tetap wajib sesuai kontrak; tidak dilonggarkan karena sekarang lintas origin.
- Progres tetap **polling** `GET /api/sources/:id` tiap 1 s (sudah ada di `app/(workspace)/data-sources/page.tsx:112`), bukan streaming.

### 3.5 Streaming & download

- **Tidak ada token streaming.** Ini sesuai DECISION-002 / `ARCHITECTURE.md` C-10: satu JSON per pesan, `LLM_MODE=full` pun tidak mengalirkan token. Tidak ada `ReadableStream` / `text/event-stream` di kode (grep = 0). Jangan menjanjikan SSE/WebSocket di rilis ini.
- Download biner (`GET /api/reports/:id/export?format=csv|pdf|xlsx`, `GET /api/reports/jobs/:id/download`) harus lewat `fetch` + `Authorization` → `blob()` → `URL.createObjectURL` → `<a download>`. Navigasi langsung (`window.location`) **tidak bisa** mengirim header auth.
- Karena itu `Access-Control-Expose-Headers: content-disposition` wajib, agar nama file `tanyadata_<slug>_<periode>_<id>.<ext>` (`DECISION-027`) tetap terbaca.

### 3.6 Share link

- Frontend Vercel: `/share/[id]` → `fetch(\`${API_BASE}/api/share/${id}\`)` **tanpa** Authorization. Bukti: `components/share/share-view.tsx:32` dan `signal-share-view.tsx:459` masih memakai path relatif.
- Backend VPS: `GET /api/share/:id` mengembalikan snapshot statis sesuai `API_CONTRACT.md` §13.7; tidak ada query ulang, tidak ada OCR/SQL saat baca (`lib/core/share.ts:1-7, 209-213`).
- Tambahkan `robots: noindex` dan banner konfirmasi/PII yang tidak bisa dilewati. Expiry/revoke masuk ADR terpisah — belum diimplementasi.

---

## 4. Status temuan P4 lama pasca-DECISION-029

### 4.1 Gugur sebagai blocker

| ID | Temuan lama | Status baru | Catatan |
|---|---|---|---|
| **V-1** | Seed tidak ter-bundle di Vercel (`next.config.ts` tanpa `outputFileTracingIncludes`) | **Gugur** | Seed tidak pernah dikirim ke Vercel. `outputFileTracingIncludes` tetap dipakai untuk build standalone di VPS bila diperlukan, bukan untuk Vercel. Kembali relevan hanya jika backend someday dipindah ke serverless. |
| **V-2** | Browser binary PDF tidak ada di Vercel | **Gugur** | Chromium/Chrome dipasang di VPS dan dipilih lewat `BROWSER_PDF_EXECUTABLE` (`lib/reports/print-pdf.ts:11-33`). Kembali relevan hanya untuk serverless. |
| V-4 | FS ephemeral Vercel → riwayat/upload/share hilang | **Gugur sebagian** | State kini persisten di VPS. Kewajiban README dua jalur deploy tetap berlaku (DECISION-029 konsekuensi 2). |
| ADR-P4-01 | "Vercel = demo-only" | **Dicabut** | Digantikan ADR-SD-01 (§6): Vercel = frontend-only, bukan demo. |

### 4.2 Tetap blocker (tidak terselesaikan oleh split deploy)

| ID | Severity | Mengapa tetap | Owner / tenggat |
|---|---|---|---|
| **S-1** | **blocker** | Backend VPS dapat diakses publik; tidak ada auth di mana pun; share bearer permanen; `noindex` belum ada. Split deploy **memperparah** paparan. | backend + security · sebelum P7 |
| **S-3 / V-3** | **blocker** | `app/api/reports/[id]/export/route.ts:50-52` masih membangun origin dari `Host` + `x-forwarded-proto` (dikendalikan klien), lalu `print-pdf.ts:37,50` menavigasikan headless browser ke origin itu dengan `--no-sandbox` (`:44`). SSRF + isolasi dilemahkan. | backend + security · sebelum P7 |
| **D-1** | **blocker** | Seluruh state di satu `WORKSPACE_DB` (`lib/db/paths.ts:43-45`). Tidak ada backup/restore/health. Di VPS, kehilangan disk = kehilangan semua riwayat; tidak ada cold-start yang menyelamatkan. | backend · sebelum P7 |
| **K-2** | **blocker** | AC-07.2 tidak terpenuhi: `lib/api/dashboard.ts:30-49` memakai `settings.lang` dan `activeDatasetId`, tetapi mengabaikan `settings.dateRange`. Murni logika backend, tidak tersentuh deploy. | backend · sebelum P7 |
| **S-5** | **blocker** | Validator SQL lebih lemah dari kontrak: `FORBIDDEN` tanpa `sqlite_master`/`sqlite_schema`/`readfile`/`writefile`, token `quoted` lolos, subquery `FROM (` memotong rekursi. Eksploitasi terbatas pada SQL yang dihasilkan LLM mode `full`. | backend + aiml · sebelum P7 |
| **S-6** | **blocker** | Tidak ada `db.interrupt()` / progress handler; better-sqlite3 sinkron memblokir event loop. Di VPS satu query patologis = seluruh instance hang. | backend · sebelum P7 |
| S-2 | **blocker** | `TEST_REPORT.md` / `SECURITY_REPORT.md` belum ada; `zero_critical_high_vulns=false`. Tidak berubah oleh DECISION-029. | qa + security · P7 |

### 4.3 Blocker baru yang diperkenalkan split deploy

| ID | Severity | Temuan (bukti kode) | Konsekuensi |
|---|---|---|---|
| **SP-1** | **blocker** | Satu Next app masih memuat UI **dan** `app/api/**` + `lib/db/**` + `better-sqlite3`. `vercel.json:4-6` tetap `npm run build` seluruh app. | Jika Vercel tetap membangun app yang sama, route handler ber-native module ikut ter-deploy dan `ensureWorkspaceReady()` jalan di serverless — split hanya kosmetik. **Artefak harus dipisah.** |
| **SP-2** | **blocker** | `renderReportPdf(origin, id)` menavigasi ke `${origin}/reports/${id}?print=1` (`print-pdf.ts:35-37`). Halaman report ada di frontend Vercel dan butuh auth ke API VPS. | Browser headless tidak punya token → PDF 401/blank, atau PDF gagal saat Vercel down. Perlu endpoint HTML print internal di VPS. |
| **SP-3** | **blocker** | Tidak ada CORS/preflight di `next.config.ts` dan tidak ada `middleware.ts`. | Semua `fetch` lintas origin dari Vercel ditolak browser. |
| **SP-4** | **blocker** | 34 `fetch('/api/...')` masih relatif; `NEXT_PUBLIC_API_BASE_URL` tidak ada. | Frontend Vercel memanggil dirinya sendiri, bukan VPS. |

---

## 5. Daftar perubahan wajib (ringkas, untuk orchestrator)

1. **Pisahkan artefak build (SP-1):** `web/` = frontend-only (tanpa `app/api/**`, `lib/db/**`, `lib/core/**`, `lib/ai/**`, `better-sqlite3`); `server/` = Next standalone seperti sekarang. Satu repo boleh, dua build target boleh, tapi **tidak boleh satu build untuk dua peran**.
2. **Lapis transport (SP-3/SP-4):** helper `apiFetch()` di frontend yang menggabungkan `NEXT_PUBLIC_API_BASE_URL` + `Authorization`; CORS + preflight + `OPTIONS` di backend.
3. **Auth (S-1):** `API_ACCESS_TOKEN` + guard, endpoint share dikecualikan, `robots: noindex`.
4. **PDF (S-3/SP-2):** `APP_ORIGIN` menggantikan `Host`; halaman print HTML internal di VPS; tinjau `--no-sandbox`.
5. **Durabilitas (D-1):** online backup + `/api/health` + runbook restore + version gate skema.
6. **Logika (K-2, S-5, S-6):** fallback `settings.dateRange` di `dashboardContext`; perbaiki validator SQL; interrupt + progress handler.
7. **Bukti (S-2):** QA + Security report sebelum gate ditutup.

---

## 6. ADR ringkas

### ADR-SD-01 — Split deploy Vercel (frontend) + VPS (backend)
- **Konteks:** DECISION-029; `better-sqlite3`, FS writable, dan Chromium tidak tersedia di serverless.
- **Opsi:** (a) full-stack di Vercel — ditolak, alasan NOT_FEASIBLE lama; (b) **frontend Vercel + backend VPS** — dipilih; (c) semua di VPS — ditolak karena user ingin Vercel untuk frontend.
- **Keputusan:** dua artefak terpisah; kontrak `API_CONTRACT.md` tetap mengikat; frontend tidak menyimpan state.
- **Konsekuensi:** perlu `NEXT_PUBLIC_API_BASE_URL`, CORS, dan auth bearer; tidak ada filesystem bersama; README wajib memuat dua jalur deploy.

### ADR-SD-02 — Auth backend VPS
- **Konteks:** backend dapat diakses publik, single-user, tanpa session store, share link harus tetap publik.
- **Opsi:** cookie `SameSite=None` (ditolak: CSRF + domain induk), OAuth/OIDC (ditolak: over-engineering), IP allow-list (ditolak: IP tidak statis).
- **Keputusan:** bearer token statis `API_ACCESS_TOKEN`, diverifikasi `timingSafeEqual`, dikirim di header; hanya `GET /api/share/:id` yang publik.
- **Konsekuensi:** token tidak boleh masuk `NEXT_PUBLIC_*` atau log; logout = hapus token di klien; expiry/revoke share masih utang (Q-02).

### ADR-SD-03 — PDF generation di VPS
- **Konteks:** origin dari `Host` header = SSRF; browser headless butuh binary; halaman report ada di frontend yang butuh auth.
- **Opsi:** (a) navigasi ke Vercel dengan token di query (ditolak: token bocor di log, Vercel harus online); (b) **endpoint HTML print internal di VPS** — dipilih; (c) `pdf-lib` portabel (ditolak: DECISION-027 sudah meninggalkannya, layout drift).
- **Keputusan:** `APP_ORIGIN` / `API_ORIGIN` dari config, bukan header klien; render HTML dari `payload_json` yang sudah beku di VPS; Chromium lewat `BROWSER_PDF_EXECUTABLE`.
- **Konsekuensi:** PDF tidak bergantung pada Vercel; `--no-sandbox` hanya boleh dipertahankan dengan justifikasi tertulis dan pembuktian di VPS; angka PDF identik dengan laporan (AC-06.4).

### ADR-SD-04 — Backup & restore SQLite
- **Konteks:** satu `tanyadata.db` menampung semua state; WAL aktif; `cp` saat WAL aktif menghasilkan file inkonsisten.
- **Opsi:** (a) `cp` file (ditolak), (b) dump CSV manual (ditolak: kehilangan FTS & relasi), (c) **SQLite online backup API + jadwal + restore runbook** — dipilih.
- **Keputusan:** `BACKUP_DIR` di luar `WORKSPACE_DIR`, rotasi harian, `/api/health` menjalankan `PRAGMA integrity_check`, `SCHEMA_VERSION` dibandingkan saat boot (expand-contract untuk kolom baru).
- **Konsekuensi:** ada runbook restore yang diuji sebelum P7; upgrade skema gagal jujur, bukan diam-diam; backup tidak ikut terhapus saat `db:reset`.

---

## 7. Variabel environment baru (tanpa nilai rahasia)

### Frontend — Vercel

| Nama | Wajib | Contoh bukan-rahasia | Fungsi |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | ya | `https://api.contoh.local` | Origin backend; tanpa `/api`, tanpa trailing slash. Fallback `''` = relatif (lokal). |
| `NEXT_PUBLIC_APP_ORIGIN` | ya | `https://tanyadata.contoh.app` | Origin frontend untuk canonical URL & share link absolut. |
| `NEXT_PUBLIC_LOGIN_MODE` | opsional | `token` | Penanda UI bahwa login memakai token (bukan cookie). |

> Frontend **tidak boleh** memiliki `LLM_API_KEY`, `DATA_DIR`, `WORKSPACE_DIR`, `BROWSER_PDF_EXECUTABLE`, atau `API_ACCESS_TOKEN`.

### Backend — VPS

| Nama | Wajib | Contoh bukan-rahasia | Fungsi |
|---|---|---|---|
| `APP_ORIGIN` | ya | `https://tanyadata.contoh.app` | Origin Vercel untuk CORS allow-list + canonical share URL. Bisa daftar dipisah koma untuk lokal. |
| `API_ORIGIN` | ya | `http://127.0.0.1:3000` | Origin internal untuk halaman print PDF; tidak boleh dari `Host` header. |
| `CORS_ALLOWED_ORIGINS` | ya | `https://tanyadata.contoh.app,http://localhost:3000` | Daftar origin yang diizinkan; exact match + `Vary: Origin`. |
| `API_ACCESS_TOKEN` | ya | `<diisi dari secret manager>` | Bearer token statis; **rahasia**, tidak pernah di log/frontend. |
| `PORT` | opsional | `3000` | Port listen backend di belakang reverse proxy. |
| `DATA_DIR` | ya | `/srv/tanyadata/data` | Path absolut seed + generated (bukan relatif cwd). |
| `WORKSPACE_DIR` | ya | `/srv/tanyadata/workspace` | Path absolut persisten; **jangan** `os.tmpdir()`. |
| `BROWSER_PDF_EXECUTABLE` | ya | `/usr/bin/chromium` | Binary Chromium/Chrome headless untuk PDF. |
| `BACKUP_DIR` | ya | `/srv/tanyadata/backups` | Direktori backup online, di luar `WORKSPACE_DIR`. |
| `BACKUP_RETENTION_DAYS` | opsional | `14` | Rotasi backup harian. |
| `LOG_LEVEL` | opsional | `info` | Logging terstruktur tanpa PII (K-3). |
| `LLM_MODE`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TIMEOUT_MS`, `LLM_MAX_OUTPUT_TOKENS` | sesuai `.env.example` | — | Tetap **hanya di backend**; tidak berpindah ke Vercel. |

### Backend — VPS: Qdrant (DECISION-032)

Semua variabel ini **hanya di VPS**, bersama backend. Frontend Vercel **dilarang** memiliki
`NEXT_PUBLIC_QDRANT_*` atau `NEXT_PUBLIC_EMBEDDING_*` — tidak ada satu pun yang boleh bocor ke bundle
`web/`. Default aman: `QDRANT_MODE=off`, `RETRIEVAL_MODE=fts5`, `EMBEDDING_PROVIDER=local` (dormant
selama Qdrant off).

| Nama | Wajib | Contoh bukan-rahasia | Fungsi |
|---|---|---|---|
| `QDRANT_MODE` | ya | `off` | `off \| local \| required`; default `off` |
| `QDRANT_URL` | ya | `http://127.0.0.1:6333` | Origin internal; tidak pernah origin publik/browser |
| `QDRANT_API_KEY` | ya | `<diisi dari secret manager>` | **Rahasia**; tidak di log, URL, atau frontend |
| `QDRANT_COLLECTION` | ya | `td_chunks` | Alias yang dipakai aplikasi |
| `QDRANT_COLLECTION_VERSION` | ya | `v1` | Collection fisik `td_chunks_v1` |
| `QDRANT_VECTOR_SIZE` | ya | `384` | Harus sama dengan model embedding lokal |
| `QDRANT_TIMEOUT_MS` | opsional | `5000` | Timeout client + health |
| `QDRANT_WAIT` | opsional | `true` | `wait: true` saat upsert/delete |
| `QDRANT_BATCH_SIZE` | opsional | `64` | Batch upsert |
| `QDRANT_HEALTH_CACHE_MS` | opsional | `30000` | Cache hasil `/readyz` |
| `QDRANT_SNAPSHOT_DIR` | opsional | `/srv/tanyadata/backups/qdrant` | Snapshot, di luar volume Qdrant |
| `RETRIEVAL_MODE` | ya | `fts5` | `fts5 \| qdrant \| hybrid`; default `fts5` |
| `EMBEDDING_PROVIDER` | ya | `local` | `off \| local \| local-hash \| openai-compatible` |
| `MODEL_DIR` | Fase B | `/srv/tanyadata/models` | Model lokal; `allowRemoteModels=false` |
| `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` / `EMBEDDING_API_KEY` / `EMBEDDING_DIM` | opsional | — | Hanya `openai-compatible`; API key **rahasia**, bukan default |

> Deploy: satu container `qdrant/qdrant:v1.20.0`, bind `127.0.0.1:6333`, TLS di Caddy yang sudah ada,
> port 6334 (gRPC) tidak dipublish, named volume persisten. Qdrant **tidak** berada di Vercel dan
> **tidak** menambah entri CORS/CSP. Rincian di `ARCHITECTURE.md` §13.6 dan `ADR_QDRANT.md` §10.1.

### Backend — VPS: OCR (DECISION-034)

Semua variabel ini **hanya di VPS**, bersama backend dan Qdrant. Frontend Vercel **dilarang** memiliki
`NEXT_PUBLIC_OCR_*` — microservice OCR bukan origin CORS dan tidak masuk `connect-src` CSP.
`OCR_ENABLED` dan `OCR_ENDPOINT` disebut eksplisit di DECISION-034; sisanya adalah turunan operasional
dari aturan konkurensi=1, timeout per halaman, dan watchdog 1,2 GB (`ARCHITECTURE.md` §13.9).

| Nama | Wajib | Contoh bukan-rahasia | Fungsi |
|---|---|---|---|
| `OCR_ENABLED` | ya | `false` | Nyalakan jalur OCR; default off sampai puncak RSS terukur di VPS |
| `OCR_ENDPOINT` | ya | `http://127.0.0.1:8090` | Origin internal microservice `deploy/ocr/`; loopback saja, bukan origin publik/browser |
| `OCR_MODEL_TIER` | opsional | `tiny` | `tiny \| small`; `small` hanya bila RAM dinaikkan ≥4 GB; `medium` **DITOLAK** di VPS 2 GB |
| `OCR_TIMEOUT_MS` | opsional | `5000` | Timeout **5 detik keras** per halaman dengan abort (ADR-11, `CORE_V2_ARCHITECTURE.md` §2); hentikan halaman macet, jangan ulang tanpa batas |
| `OCR_CONCURRENCY` | opsional | `1` | Konkurensi ingestion; **jangan dinaikkan** tanpa DECISION baru |
| `OCR_RSS_WATCHDOG_MB` | opsional | `1200` | Watchdog RSS worker OCR/embedding; selaras ambang 1,2 GB, tidak dinaikkan tanpa DECISION |

> Bila `OCR_ENABLED=true` tetapi puncak RSS terukur melewati anggaran, jangan menaikkan watchdog:
> untuk dokumen image-only pakai `gt_transcript` dengan label jujur (`ocrAvailable: false`), dan
> untuk retrieval pakai FTS5 + `meta.fallbackReason`. Rincian di `ARCHITECTURE.md` §13.9.5.

---

## 8. Syarat yang harus dibuktikan sebelum P7

Verdict berubah menjadi `FEASIBLE` hanya bila semua poin ini punya bukti nyata (bukan asumsi):

| # | Bukti | Menutup |
|---|---|---|
| 1 | Dua artefak build terpisah; build Vercel **tidak** mengandung `app/api/**` atau `better-sqlite3`; build VPS menghasilkan `standalone/server.js` yang jalan. | SP-1 |
| 2 | `curl -i -X OPTIONS https://api.<domain>/api/settings -H 'Origin: https://<app>.vercel.app'` → 204 dengan header CORS eksplisit; request tanpa token → 401; `GET /api/share/:id` tanpa token → 200. | SP-3, S-1 |
| 3 | Satu alur end-to-end dari browser Vercel: login token → dashboard → chat → upload CSV → polling job → download PDF. Semua lewat `NEXT_PUBLIC_API_BASE_URL`, bukan path relatif. | SP-4, SP-2 |
| 4 | PDF di VPS: HTTP 200, file valid, 3 halaman, angka identik dengan laporan; origin berasal dari `APP_ORIGIN`, bukan `Host`; keputusan `--no-sandbox` terdokumentasi. | S-3, SP-2 |
| 5 | Backup: `PRAGMA integrity_check` → `ok` di `/api/health`; backup harian terbentuk; **restore ke DB kosong berhasil** dan angka invariant `ARCHITECTURE.md` §5.7 kembali cocok. | D-1 |
| 6 | Overview tanpa query `start/end` memakai `settings.dateRange` (AC-07.2). | K-2 |
| 7 | Validator SQL menolak `sqlite_master`, `sqlite_schema`, `readfile`, `writefile`, identifier berkutip, dan subquery; query patologis ter-interrupt < 8 s tanpa hang. | S-5, S-6 |
| 8 | `robots: noindex` aktif di `/share/[id]`; risiko bearer permanen tercatat sebagai utang dengan owner. | S-1 |
| 9 | `docs/TEST_REPORT.md` dan `docs/SECURITY_REPORT.md` ada; `zero_critical_high_vulns = true`. | S-2 |
| 10 | README memuat dua jalur deploy + daftar env di §7 + peringatan share bearer. | DECISION-029 |
| 11 | Qdrant di VPS: `/readyz` dengan api-key → ready, port 6333 tidak publik; `eval:qdrant-parity` + 4 suite hijau di ambang sama; simulasi Qdrant mati → FTS5 + `meta.fallbackReason`; RAM puncak terukur (Fase B ≥4 GB atau worker terpisah). | DECISION-032, Q-B1..Q-B4, Q-R3 |
| 12 | **OCR tiny terukur di VPS**: puncak RSS + latensi per halaman dicatat (bukan estimasi); bila > anggaran, fallback `gt_transcript` berlabel (`ocrAvailable: false`, banner "transkrip referensi, bukan hasil OCR") diuji; microservice `deploy/ocr/` tidak berjalan di Vercel maupun di proses Next.js. | DECISION-034, ADR-RES-01 |
| 13 | **Embedding terukur**: puncak RSS e5-small q8 384d ≤ watchdog 1,2 GB dan latensi batch encode dicatat; tiga fase ingestion berjalan serial (OCR → embedding → upsert Qdrant), konkurensi=1, worker dilepaskan antar fase. | DECISION-034, ADR-RES-01 |

**Blocker terbuka saat laporan ini ditulis: S-1, S-3/V-3, D-1, K-2, S-5, S-6, S-2, SP-1, SP-2, SP-3, SP-4**, ditambah **Q-B1, Q-B2, Q-B3, Q-B4** dari DECISION-032 dan **tiga blocker resource DECISION-034** (OCR tiny terukur di VPS, embedding terukur, Qdrant parity eval hijau). Owner dan tenggat: backend + security, sebelum P7; qa + security di P7; owner Q-B1..Q-B4 di `docs/ADR_QDRANT.md` §7; resource — architect + backend + aiml/qa sebelum Fase B / P7 (`ARCHITECTURE.md` §13.9.6, ADR-RES-01 di §13.10). Verdict rilis **tetap `FEASIBLE_WITH_CHANGES`** sampai syarat §8 (termasuk baris 12–13) dan `ARCHITECTURE.md` §13.8/§13.9 terbukti.

---

## 9. Handoff

```yaml
from: architect
to: agentic
phase: P4
type: deliverable
refs:
  - docs/ARCHITECTURE_SPLIT_DEPLOY.md
  - docs/ARCHITECTURE.md
  - docs/ARCHITECTURE_REVIEW_P4.md
  - docs/DECISIONS.md
  - docs/API_CONTRACT.md
summary: >
  DECISION-029 mengubah target menjadi frontend Vercel + backend VPS, sehingga V-1 dan V-2 gugur
  dan verdict naik menjadi FEASIBLE_WITH_CHANGES. S-1, S-3, D-1, K-2, S-5/S-6 tetap blocker,
  ditambah empat kewajiban baru: pemisahan artefak build, CORS + base URL, auth bearer, dan origin
  PDF internal di VPS. Kontrak API_CONTRACT.md tidak berubah; hanya lapis transport yang ditambahkan.
evidence: >
  Audit statis: next.config.ts:3-6, vercel.json:4-6, lib/api/{respond,validate,schemas,dashboard}.ts,
  lib/db/paths.ts:43-45, lib/reports/print-pdf.ts:11-50, lib/core/share.ts:199,
  app/api/reports/[id]/export/route.ts:50-55, app/share/[id]/page.tsx:1-7, .env.example:10-18,
  serta grep 34 fetch('/api/...') relatif dan nol middleware/CORS/robots/streaming.
blocking: true
needs: >
  (1) Orchestrator menugaskan backend memisahkan artefak build dan memasang CORS + apiFetch.
  (2) Security+backend menutup S-1/S-3 dengan bearer token, noindex, dan APP_ORIGIN.
  (3) Backend menutup D-1/K-2/S-5/S-6 dengan backup+health, dateRange, validator, interrupt.
  (4) QA+security menghasilkan TEST_REPORT.md dan SECURITY_REPORT.md sebelum P7 ditutup.
  (5) User menyediakan domain/TLS VPS dan path absolut WORKSPACE_DIR/BACKUP_DIR.
```
