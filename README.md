# TanyaData

Aplikasi analitik tanya-jawab: unggah dataset tabular (CSV/XLSX/SQLite) atau dokumen (PDF/DOCX/TXT/MD), lalu ajukan pertanyaan dalam bahasa natural. Jawaban disusun dari data - eksekusi SQL baca-saja atau kutipan dokumen bersitasi `[n]` - dan dilengkapi chart, tabel, serta ekspor laporan CSV/PDF. LLM opsional: default `LLM_MODE=off`, jadi aplikasi berjalan penuh tanpa API key. Dirancang untuk **satu operator di satu mesin atau satu VPS**, bukan produk multi-tenant.

Sumber kebenaran teknis: `docs/SYSTEM_OVERVIEW.md`. Status, tiket, dan gate rilis: `docs/STATE.json`.

---

## 1. Status proyek (jujur)

**Sudah berjalan dan terverifikasi di repo:**

- Ingest 7 format (CSV, XLSX, SQLite/DB, PDF, DOCX, TXT, MD) dengan validasi ukuran dan magic bytes.
- Retrieval dua lapis: FTS5 (BM25) selalu terisi; Qdrant sebagai indeks turunan dengan fusi RRF (default aktif, fallback otomatis ke FTS5).
- Jawaban deterministik + chart deterministik + sitasi + laporan CSV/PDF + share snapshot read-only ber-TTL.
- Dashboard KPI/trend dihitung SQL agregat (bukan LLM) dan empat suite eval offline berjalan tanpa API key.

**Belum selesai / belum terverifikasi:**

- **Target presisi 0,99 belum tercapai.** Run terakhir yang terdokumentasi (`docs/KB_GT_REPORT.md`, 2026-11-24) mencatat precision keseluruhan **0,4811** dan abstention **0,8201** pada 139 soal. `docs/STATE.json` masih menyimpan angka holdout lama (**0,8571**); keduanya belum diselaraskan dan tidak boleh dikutip sebagai "akurasi >99%".
- **OCR belum dijalankan di VPS.** KB01/KB04 adalah PDF image-only; evaluasi masih memakai transkrip GT, bukan hasil OCR (tiket `OCR-01`).
- **Qdrant belum dijalankan di mesin dev ini.** Yang terverifikasi hanya circuit breaker dan fallback ke FTS5.
- **Jalur split deploy (Vercel) belum berfungsi penuh** - sebagian `fetch('/api/...')` di frontend masih relatif (tiket SP-4). QA dan Security berstatus `paused`; `release_gate.release_ready = false`.

---

## 2. Cara menjalankan (lokal)

**Prasyarat:** Node.js **>= 22** (`engines` di `package.json`), npm, dan toolchain build native untuk `better-sqlite3`. Tidak perlu API key LLM. Setelah `npm run start`, buka `http://localhost:3000` (port default 3000).

```bash
npm install
cp .env.example .env.local        # Windows: copy .env.example .env.local
npm run db:init                   # buat workspace DB + ekstrak dokumen sesuai SEED_PROFILE
npm run check:seed                # verifikasi hasil seed
npm run build                     # next build + postbuild (salin standalone)
npm run start                     # node .next/standalone/server.js
```

| `SEED_PROFILE` | Isi | Dipakai untuk |
|---|---|---|
| `none` (default, wajib produksi) | Image kosong: 0 dokumen, 0 transaksi, Qdrant 0 point. Keadaan benar, bukan kegagalan. | VPS produksi |
| `demo` (development) | 11 dokumen (6 lama + 4 KB-SOP + Perpres 76/2013) dan 46.952 transaksi R&D. | Development, evaluasi |

`db:init` membaca `SEED_PROFILE` dari environment proses, bukan dari `.env.local`. Untuk data demo, jalankan `npm run seed:demo` (cross-platform: menyetel profil demo lalu bootstrap), atau set variabel di shell sebelum `db:init` (`$env:SEED_PROFILE='demo'` di PowerShell, `SEED_PROFILE=demo` di bash). `npm run bootstrap:production` memang membaca `.env.local`. Nilai selain `none|demo` ditolak fail-closed.

Perintah lain dari `package.json`: `npm run dev` (Turbopack), `npm run typecheck`, `npm run db:reset` (menghapus state workspace, hanya development), `npm run reindex:docs`, `npm run db:extract`, `npm run bootstrap:production`, `npm run test:qdrant-bootstrap`, `npm run eval:qdrant-parity`. `npm run start` mensyaratkan `npm run build` lebih dulu; `db:init` dan `reindex:docs` idempoten.

---

## 3. Arsitektur

Dua topologi didukung: **satu proses** (lokal/VPS) dan **split deploy** (frontend Vercel, backend VPS) sesuai DECISION-029.

```
Browser
   |  HTTPS
   v
+-----------------------------+   HTTP/JSON   +---------------------------------------+
| FRONTEND - Vercel           | ------------> | BACKEND - VPS (2 vCPU / 2 GB / 40 GB) |
| Next.js App Router, UI, RSC | <------------ | Next.js standalone: app/api/**, lib/**|
| tanpa app/api, lib/db,      |               | SQLite seed (RO) + workspace (RW), FTS5|
| better-sqlite3, Chromium    |               | Qdrant :6333, OCR :6334, Chromium PDF |
+-----------------------------+               +---------------------------------------+
```

Tidak ada filesystem bersama dan tidak ada akses browser langsung ke Qdrant/OCR. Pada mode satu proses, semua komponen berjalan di satu `node server.js`.

### Pipeline 4 tahap

**1. Ingest.** Satu file maksimal 25 MB divalidasi nama (anti path-traversal), ukuran, dan magic bytes, lalu diklasifikasikan sebagai tabular atau dokumen. PDF diekstrak sadar-layout, DOCX via mammoth, XLSX via exceljs, CSV via csv-parse. Teks dibersihkan dari mojibake dan header/footer berulang, lalu dipotong menjadi chunk 900 karakter dengan overlap 150 (dokumen hukum memakai struktur parent-child). Hasil ditulis idempoten ke `core_documents`/`core_chunks` dan diindeks ke FTS5; sinkronisasi Qdrant lewat outbox, dan **kegagalan Qdrant tidak menggagalkan ingest**.

**2. Retrieval.** Guardrail deterministik berjalan lebih dulu dan menolak permintaan destruktif, PII, di luar jangkauan, atau ambigu tanpa eksekusi; cache query ber-TTL 30 menit dicek setelahnya. Jalur tabular memakai generator SQL (LLM opsional, fallback rule-based) yang divalidasi read-only: hanya `SELECT`/`WITH`, `EXPLAIN` dry-run, cap 500 baris, timeout 8 detik. Jalur dokumen mengambil kandidat lebar, melakukan entity boost dan rerank, lalu memotong top-8. Mode hybrid menjalankan beberapa varian query dan memfusikan leg FTS5, BM25 Qdrant, dan dense e5-small dengan RRF; teks sitasi selalu dihidrasi dari SQLite.

**3. Penyusunan jawaban.** Draft deterministik dibentuk lebih dulu: segmen klaim plus marker sitasi `[n]`. LLM hanya dipanggil bila gate memutuskan perlu (confidence tidak `strong`, grounding angka di bawah 0,99, atau key-fact di bawah 0,60). Angka dari LLM divalidasi terhadap angka bukti, marker `[n]` wajib ada, dan sanitasi anti-slop/mojibake diterapkan tanpa mengubah angka. LLM gagal/timeout/429 -> jawaban deterministik tetap dikirim dengan `meta.fallbackReason`.

**4. Keluaran.** `vizSpec` dipilih deterministik dari bentuk data (`kpi|line|bar|donut|table|quote|none`), pesan dan laporan dipersist, respons JSON dirender UI, dan pengguna dapat mengekspor CSV/PDF atau membuat share snapshot read-only yang kedaluwarsa sesuai `SHARE_TTL_DAYS`.

### Teknologi (versi dari `package.json`)

| Teknologi | Versi | Peran |
|---|---|---|
| `next` | 16.4.6 | App Router, route handlers, satu proses |
| `react` / `react-dom` | 19.3.1 | UI runtime |
| `typescript` | 5.9.3 | bahasa, `tsc --noEmit` |
| `better-sqlite3` | 13.2.0 | SQLite + FTS5, sumber kebenaran |
| `zod` | 4.6.7 | validasi request/output |
| `unpdf` | 2.2.1 | ekstraksi teks PDF sadar-layout |
| `mammoth` | 1.13.0 | ekstraksi DOCX |
| `exceljs` / `csv-parse` | 4.4.0 / 7.0.3 | baca XLSX / CSV |
| `@qdrant/js-client-rest` | 1.20.0 | indeks sekunder Qdrant (diatur lewat env) |
| `@huggingface/transformers` | 4.3.2 | embedding lokal `Xenova/multilingual-e5-small` 384d |
| `recharts` / `pdf-lib` | 3.11.0 / 1.17.1 | chart / ekspor PDF |

OCR PP-OCRv6 tiny berjalan sebagai microservice Python terpisah (`deploy/ocr/`), bukan dependency `package.json`. LLM dipanggil lewat HTTP `fetch` tanpa SDK. Runtime: Node.js >= 22.

---

## 4. Alasan keputusan teknis

| Keputusan | Alasan | Konsekuensi |
|---|---|---|
| **DECISION-002** - Next.js satu proses + SQLite sumber kebenaran | Menghindari operasi database eksternal dan menjaga jawaban deterministik | Single-user; state lokal bisa hilang di serverless ephemeral |
| **DECISION-029** - frontend di Vercel, backend di VPS | Native module, filesystem writable, dan Chromium tidak tersedia di serverless | Perlu CORS, base URL API, origin eksplisit; tidak ada filesystem bersama |
| **DECISION-031 + 033** - Qdrant indeks sekunder, hybrid BM25 + dense, default aktif | Meningkatkan retrieval semantik tanpa kehilangan determinisme | Butuh Qdrant + model embedding; gagal -> FTS5 + `fallbackReason` |
| **DECISION-034** - OCR PP-OCRv6 tiny sebagai microservice on-demand | OCR di dalam proses Next.js akan melewati anggaran RAM 2 GB | Ingest dibagi tiga fase (OCR, embedding, upsert); OCR belum jalan di VPS |
| **DECISION-035** - tidak ada kontrol UI yang tidak mengubah perilaku | User menilai kontrol "gimmick" lebih buruk daripada tidak ada | Settings disederhanakan; tab Tentang diisi server dari `/api/meta` |
| **DECISION-036** - `preferences` dideprecate, `dateRange` disambungkan ke dashboard | Field tersimpan tapi tidak dikonsumsi siapa pun | Frontend berhenti mengirim `preferences`; dashboard membaca `settings.dateRange` |

Detail dan konteks lengkap: `docs/DECISIONS.md`.

---

## 5. Mode & konfigurasi

Salin `.env.example` menjadi `.env.local`. Semua nilai di bawah adalah placeholder, bukan rahasia.

| Variabel | Default | Efek | Wajib produksi |
|---|---|---|---|
| `SEED_PROFILE` | `none` | `none` = image kosong; `demo` = 11 dokumen + 46.952 transaksi | ya (`none`) |
| `RETRIEVAL_MODE` | `hybrid` | `fts5` \| `qdrant` \| `hybrid`; nilai asing jatuh ke `fts5` | ya |
| `QDRANT_MODE` | `on` | `off` \| `on` \| `local` \| `required`; `required` fail-closed tanpa API key | ya |
| `QDRANT_API_KEY` | *(kosong)* | Rahasia; hanya di VPS | bila Qdrant aktif |
| `EMBEDDING_PROVIDER` | `local` | `local` = e5-small 384d q8 tanpa API key; `off` = BM25 saja | ya |
| `LLM_MODE` | `off` | `off` = deterministik penuh; `assist` = fallback penutup; `full` = composer utama | tidak |
| `OCR_ENABLED` / `OCR_ENDPOINT` | `false` / `http://127.0.0.1:6334/ocr` | OCR on-demand, endpoint wajib loopback; gagal ditandai `ocr_skipped` | tidak |
| `APP_ORIGIN` | *(kosong)* | Canonical URL + allow-list navigasi PDF; tidak boleh dari header `Host` | ya |
| `CORS_ALLOWED_ORIGINS` | *(kosong)* | Origin frontend yang diizinkan, exact match; kosong -> `APP_ORIGIN` | ya (split deploy) |
| `NEXT_PUBLIC_API_BASE_URL` | *(kosong)* | Origin backend tanpa `/api` dan tanpa trailing slash | ya (Vercel) |
| `PUBLIC_DEPLOY` | `0` | `1` = tolak semua API bila `API_ACCESS_TOKEN` kosong | ya bila publik |
| `API_ACCESS_TOKEN` | *(kosong)* | Rahasia bearer token; jangan pernah di `NEXT_PUBLIC_*` | bila publik |
| `BROWSER_PDF_EXECUTABLE` | *(kosong)* | Binary Chromium/Chrome headless untuk ekspor PDF | untuk ekspor PDF |
| `SHARE_TTL_DAYS` | `30` | Umur share link sebelum kedaluwarsa | tidak |

- **Selalu set `QDRANT_MODE` eksplisit** - nilai kosong diperlakukan berbeda oleh jalur sync dan jalur query. `NEXT_PUBLIC_*` juga tertanam saat build, jadi mengubahnya memerlukan rebuild.
- Frontend tidak boleh memiliki `API_ACCESS_TOKEN`, `LLM_API_KEY`, `OCR_API_KEY`, `QDRANT_API_KEY`, `DATA_DIR`, `WORKSPACE_DIR`, atau `BROWSER_PDF_EXECUTABLE`.

---

## 6. Deploy

### (a) Vercel (frontend) + VPS (backend)

Rujukan lengkap: `docs/ARCHITECTURE_SPLIT_DEPLOY.md`.

1. **Backend di VPS.** `npm ci` -> `npm run build` -> isi `.env.local` dari secret manager -> `npm run bootstrap:production` -> `node .next/standalone/server.js` (port 3000, di belakang Caddy/Nginx untuk TLS). Stack container tersedia di `deploy/docker-compose.prod.yml` (app + Qdrant + OCR opsional). Env wajib: `SEED_PROFILE=none`, `APP_ORIGIN`, `CORS_ALLOWED_ORIGINS`, `QDRANT_MODE`, `QDRANT_API_KEY`, `RETRIEVAL_MODE`, `EMBEDDING_PROVIDER`, dan `PUBLIC_DEPLOY=1` + `API_ACCESS_TOKEN` bila publik.
2. **Frontend di Vercel.** Set `NEXT_PUBLIC_API_BASE_URL` ke origin backend (**sebelum build**, tanpa `/api`, tanpa trailing slash). `next.config.ts` menurunkan `connect-src` CSP dari env ini saat build, jadi nilai yang salah memblokir request di browser.
3. **Verifikasi.** `curl -fsS http://127.0.0.1:3000/api/meta` di VPS; pastikan `CORS_ALLOWED_ORIGINS` cocok persis dengan origin Vercel dan preflight `OPTIONS` mengembalikan 204.

Domain target `tanyadata.web.id` disebut sebagai konteks produk saja; konfigurasi DNS dan TLS tidak diatur di repo ini.

> **Peringatan jujur:** jalur (a) belum bisa dinyatakan berfungsi penuh. Artefak build frontend-only dan migrasi pemanggilan `fetch` ke `NEXT_PUBLIC_API_BASE_URL` masih pekerjaan terbuka (SP-4). Uji di staging sebelum mengandalkannya.

### (b) Lokal / standalone satu mesin

Ikuti bagian 2. Untuk VPS satu mesin, tambahan yang wajib:

- `WORKSPACE_DIR` dan `BACKUP_DIR` harus **path absolut persisten**, bukan `os.tmpdir()`.
- `better-sqlite3` adalah native module; pastikan toolchain build tersedia saat `npm install`.
- `APP_ORIGIN` valid (https di produksi). Ekspor PDF **gagal fail-closed** bila origin tidak valid.
- Hanya jalankan **satu** proses backend per `WORKSPACE_DIR`.

---

## 7. Demonstrasi pengujian

Tabel ini sengaja dikosongkan. Isi kolom **Hasil** dan **Bukti** setelah pengujian manual lewat UI - jangan menyalin hasil dari dokumen lain.

| # | Pertanyaan | Jenis | Hasil | Bukti (screenshot) |
|---|---|---|---|---|
| 1 | Berapa total transaksi pada bulan ini? | dapat dijawab (data) | _(diisi setelah pengujian manual)_ | _(diisi setelah pengujian manual)_ |
| 2 | Berapa target respons awal untuk tiket P1? | dapat dijawab (dokumen KB-SOP) | _(diisi setelah pengujian manual)_ | _(diisi setelah pengujian manual)_ |
| 3 | Sejak kapan peningkatan kegagalan VA Mandiri mulai terjadi? | dapat dijawab (data + dokumen) | _(diisi setelah pengujian manual)_ | _(diisi setelah pengujian manual)_ |
| 4 | Kanal terbaik? | ambigu | _(diisi setelah pengujian manual)_ | _(diisi setelah pengujian manual)_ |
| 5 | Berapa proyeksi jumlah transaksi bulan depan? | tidak didukung | _(diisi setelah pengujian manual)_ | _(diisi setelah pengujian manual)_ |

Jawaban acuan: pertanyaan 1 di `docs/EVALUATION_QA.md` bagian A1, pertanyaan 2 di bagian D/F1, pertanyaan 3 di bagian E2. Pertanyaan 4 diuji sebagai guardrail ambigu (F3); pertanyaan 5 menyentuh non-goal forecasting (`docs/SPEC.md`).

---

## 8. Catatan evaluasi

**Yang berjalan.** Empat suite eval offline berjalan tanpa API key dan tanpa panggilan LLM: tiga menyetel `LLM_MODE=off`, sedangkan `eval:extraction-gt` murni menguji ekstraksi (`eval:ground-truth`, `eval:extraction-gt`, `eval:holdout`, `eval:real-docs`; hasil di `docs/*_RESULT.json`). Gate anti-slop/mojibake lulus 2/2, guardrail pada 12 kasus negatif global mencapai precision dan recall 1,0, dan pelanggaran forbidden-claim pada run terakhir 0.

**Yang kurang akurat** (`docs/KB_GT_REPORT.md`, 139 soal, mode LLM):

| Metrik | Hasil | Target |
|---|---|---|
| Precision keseluruhan | 0,4811 | 0,99 |
| Precision split holdout | 0,5833 | 0,99 |
| Abstention accuracy | 0,8201 | 0,99 |
| Precision `cross_doc` | 0,1379 | - |
| Citation precision / recall | 0,3973 / 0,5059 | - |

Mode kegagalan terbanyak: `CITATION_MISMATCH` (108), `KEY_FACT_MISS` (60), `EVIDENCE_GROUNDING` (49), `FALSE_ABSTAIN` pada soal yang seharusnya terjawab (15), `FALSE_ANSWER` pada soal yang seharusnya abstain (10).

**Prioritas perbaikan.** (1) Retrieval lintas dokumen - perbaiki chunking dan entity boost di `lib/ai/retrieval.ts`, bukan menurunkan ambang. (2) `FALSE_ABSTAIN` pada parafrasa sah - periksa `answerabilitySupport` dan sinonim di `lib/ai/guardrails.ts`. (3) Grounding sitasi agar menunjuk chunk yang memuat bukti. (4) OCR asli untuk KB01/KB04. (5) Ukur ulang embedding dan Qdrant di VPS 2 GB, lalu jalankan `eval:qdrant-parity`. Catatan: `docs/STATE.json` masih memuat angka holdout lama (0,8571) yang berbeda dari run terakhir; selisih itu inkonsistensi yang belum diselaraskan, bukan peningkatan.

---

## 9. Keterbatasan saat ini

1. **Tanpa autentikasi dan multi-tenancy.** Satu workspace lokal; guard token opsional hanya untuk deploy publik.
2. **Presisi belum mencapai target 0,99.** Angka terakhir 0,4811 keseluruhan dan 0,5833 pada holdout.
3. **OCR belum berjalan di VPS.** KB01/KB04 masih memakai transkrip ground truth pada evaluasi.
4. **Qdrant harus disediakan sendiri.** Belum ada Qdrant yang berjalan di mesin dev ini; yang teruji adalah fallback-nya.
5. **Jalur split deploy belum penuh.** Sebagian `fetch` frontend masih relatif.
6. **Tidak ada streaming/real-time dan tanpa forecasting.** Satu respons JSON per pesan; prediksi tren masa depan adalah non-goal.
7. **Share link bersifat bearer dan belum bisa dicabut.** Perlakukan sebagai informasi sensitif.
8. **Belum ada script backup/restore.** `db:reset` menghapus state workspace dan bukan prosedur restore.
9. **`capabilities.rag` dan `dateRange` masih bisa menyesatkan.** `capabilities.rag` belum diturunkan dari env (`META-01`) dan dashboard belum membaca `dateRange` di semua tempat (`SET-01`).
10. **Status QA dan Security `paused`.** Re-test penuh setelah migrasi Qdrant belum dijalankan.

---

## 10. Dokumen rujukan

Status: `docs/STATE.json`. Pipeline dan peta klaim->bukti: `docs/SYSTEM_OVERVIEW.md`. Keputusan: `docs/DECISIONS.md`. Split deploy: `docs/ARCHITECTURE_SPLIT_DEPLOY.md`. Kontrak API: `docs/API_CONTRACT.md`. Evaluasi: `docs/EVALUATION_QA.md`, `docs/KB_GT_REPORT.md`. Produksi: `docs/PRODUCTION_READY.md`. Baseline QA/keamanan: `docs/TEST_REPORT.md`, `docs/SECURITY_REPORT.md`.
