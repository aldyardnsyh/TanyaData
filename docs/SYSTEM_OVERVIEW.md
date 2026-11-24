# SYSTEM_OVERVIEW — TanyaData

Sumber kebenaran tunggal untuk tab **Pengaturan → Tentang**.
Setiap klaim wajib punya anchor `file:line` atau nama env var. Klaim yang tidak bisa
dibuktikan ditandai `UNVERIFIED` dan **dilarang tampil di UI** (DECISION-035 konteks 4 & keputusan 4).

- Lane: `architect`, fase **P6-UI-HONESTY** (DECISION-035).
- Dibaca oleh: `backend` (payload `/api/meta.system`), `frontend` (tab Tentang), `illustrator` (diagram), `qa` (audit anti-klaim-palsu).
- Versi library diambil dari `tanyadata/package.json` (bukan hafalan). Bila versi berubah, tabel §3 wajib ikut berubah.

> **Aturan emas:** kalau sebuah kalimat tidak ada di §6 (peta klaim→bukti), kalimat itu tidak boleh dirender.

---

## 1. Ringkasan (5 kalimat)

1. TanyaData adalah aplikasi analitik tanya-jawab **Next.js 16 satu proses** dengan **SQLite** sebagai sumber kebenaran (DECISION-002; `tanyadata/package.json:47`, `tanyadata/lib/meta.ts:20-26`).
2. Pengguna mengunggah **dataset tabular** (CSV/XLSX/SQLite) atau **dokumen** (PDF/DOCX/TXT/MD) ≤25 MB; sistem mengekstrak, membersihkan, memotong menjadi chunk, lalu mengindeksnya (`tanyadata/lib/core/ingest.ts:51-62,204-302,607-633,896-1031`).
3. Retrieval bersifat **deterministik lebih dulu**: **FTS5 (BM25)** selalu terisi; **Qdrant** hanya indeks turunan opsional (BM25 + dense e5-small) yang difusikan dengan **RRF**, dan **selalu jatuh ke FTS5** bila Qdrant/embedding gagal (`tanyadata/lib/ai/retrieval.ts:1167-1310`, `tanyadata/lib/ai/hybrid.ts:59-89`).
4. Jawaban disusun **dari data** (eksekusi SQL baca-saja atau kutipan dokumen ber-sitasi `[n]`); **LLM bersifat opsional** dan hanya dipakai sebagai *composer* atau *fallback penutup* yang wajib ter-grounding + ber-marker sitasi (`tanyadata/lib/ai/adapter.ts:669-774`, `tanyadata/lib/ai/answer-gate.ts:74-154`).
5. Keluaran berupa jawaban terstruktur + visualisasi deterministik + sitasi + laporan (CSV/PDF) + share snapshot read-only ber-TTL (`tanyadata/lib/core/answer.ts:222-282`, `tanyadata/lib/reports/export.ts:1,91`, `tanyadata/lib/core/share.ts:26-31`).

---

## 2. Pipeline 4 tahap

> Catatan arsitektur penting: ada **dua lapis** retrieval.
> Lapis **core** (`lib/core/query.ts`) selalu memakai FTS5 sinkron.
> Lapis **AI port** (`lib/ai/adapter.ts:511-523`) melakukan retrieval *mode-aware* (Qdrant/hybrid/FTS5) via `retrieveWithQueryVariants`. Jawaban AI dipakai bila tersedia; jika tidak, jawaban deterministik core yang dipakai (`lib/core/query.ts:381-423`).

### Tahap 1 — Ingest
- **Input:** satu file ≤25 MB; ekstensi CSV/XLSX/SQLite/DB/PDF/DOCX/TXT/MD (`lib/core/ingest.ts:51,53-62`).
- **Proses:**
  1. Validasi nama (anti path-traversal) + ukuran + **magic bytes** (PDF `%PDF-`, XLSX/DOCX `PK`, SQLite header, teks tanpa byte biner) → `415`/`413`/`422` (`ingest.ts:76-119`).
  2. Klasifikasi tabular vs dokumen + `doc_type` (legal/technical/financial/general) dari sinyal teks (`ingest.ts:136-174`).
  3. Ekstraksi: PDF **sadar-layout** via `layoutAwarePdfTexts` + `unpdf` (`ingest.ts:217-233`, `lib/ingest/extract.ts`); DOCX via `mammoth` (`ingest.ts:293-300`); TXT/MD dibaca UTF-8 (`ingest.ts:301`); tabel via `parseCsv`/`parseXlsx`/`parseSqlite` (`ingest.ts:793-796`).
  4. **OCR on-demand** hanya untuk halaman image-only/berderau, **berurutan (konkurensi 1)**, default **MATI** (DECISION-034; `ingest.ts:235-290`, `lib/ingest/ocr.ts:127-206`).
  5. Perbaikan **mojibake** + dedup header/footer (`ingest.ts:607-633`, `lib/ingest/mojibake.ts`).
  6. Chunking target **900 char, overlap 150**; dokumen hukum parent-child (`lib/ingest/chunker.ts:5-6`, `ingest.ts:647-692,902`).
  7. Tulis `core_documents` + `core_chunks` idempoten (`documentId = doc_<sha256-12>`) (`ingest.ts:896-1003`).
  8. Indexing: stem ringan FTS5 (maks 2000 chunk) + kuras outbox Qdrant (gagal Qdrant **tidak** menggagalkan ingest) (`ingest.ts:1005-1046`).
- **Teknologi + versi:** `unpdf` 2.2.1, `mammoth` 1.13.0, `exceljs` 4.4.0, `csv-parse` 7.0.3, `better-sqlite3` 13.2.0 (SQLite + FTS5), `@huggingface/transformers` 4.3.2 (embedding, opsional), `@qdrant/js-client-rest` 1.20.0 (opsional), microservice OCR PP-OCRv6 tiny (service Python terpisah, bukan dependency `package.json`).
- **Output:** dataset `READY` + tabel fisik (tabular) / chunk terindeks FTS5 (+ Qdrant bila aktif) + `quality_report`.
- **File implementasi:** `lib/core/ingest.ts:76-1088`, `lib/ingest/chunker.ts:5-6`, `lib/ingest/ocr.ts:127-206`, `lib/qdrant/sync.ts` (`enqueueUpserts`/`drainOutbox`).
- **Kegagalan & fallback:**
  - Format tak dikenal → `415`; file rusak/terenkripsi → `422 PARSE_ERROR` (`ingest.ts:88-92,221-223`).
  - Dokumen tanpa text layer → `422 NO_TEXT_LAYER` (bukan jawaban diam-diam) (`ingest.ts:837-843`).
  - OCR mati/gagal/timeout/kosong → halaman ditandai `ocr_skipped` + `[halaman tidak terbaca]`, tidak dikarang (`lib/ingest/ocr.ts:109-120,130-133,197-205`).
  - Qdrant gagal saat sync → ingest tetap sukses, FTS5 tetap terisi (`ingest.ts:1033-1045`).

### Tahap 2 — Retrieval
- **Input:** pertanyaan natural + `datasetId` + opsional `context`/`attachmentId`/`conversationId` (`app/api/query/route.ts:13-31,47-58`).
- **Proses:**
  1. **Guardrail deterministik** lebih dulu: `destructive`/`pii`/`out_of_range`/`not_in_sources`/`ambiguous` ditolak **tanpa eksekusi** (`lib/core/query.ts:195-206`; `lib/core/answer.ts:84`; `lib/ai/guardrails.ts:145-159,431-457`).
  2. **Cache** query (SQLite, TTL **30 menit**) dicek setelah guardrail, sebelum generator LLM/FTS (`lib/core/query.ts:210-238`; `lib/core/cache.ts:20`).
  3. **Jalur SQL** (tabular): follow-up SQL bila anafora (`query.ts:87-93,243-255`) → generator LLM **opsional** bila ada tabel (`query.ts:256-271`) → fallback **rule-based** (`query.ts:280`) → validasi + eksekusi **read-only** (hanya `SELECT`/`WITH`, `EXPLAIN` dry-run, cap **500 baris**, timeout **8 s**, `readonly`+`query_only`) (`lib/core/sql.ts:23-25,118-255,262-343`).
  4. **Jalur dokumen** (FTS5 core): kandidat lebar 20 + entity boost → rerank deterministik → potong top-8 → jendela kalimat (`query.ts:282-326`; `lib/ai/retrieval.ts:792-817,754-783`; `lib/core/answer.ts:353`).
  5. **Jalur hybrid (AI port)**: `retrieveWithQueryVariants` menjalankan ≤7 varian (asli + parafrasa + aksi diagnostik) → tiap varian `retrieveWithEntityBoostDetailed` memilih `fts5|qdrant|hybrid`, memfusikan leg FTS5 + Qdrant-BM25 + dense dengan **RRF k=2**, lalu RRF antar-varian (`lib/ai/adapter.ts:511-523`; `lib/ai/retrieval.ts:1356-1389,1221-1310`; `lib/ai/hybrid.ts:59-89`).
  6. **Pemilihan jalur efektif** ditentukan `RETRIEVAL_MODE` + `QDRANT_MODE` + `EMBEDDING_PROVIDER` (lihat §4). Teks sitasi Qdrant **selalu dihidrasi dari SQLite** (`lib/ai/retrieval.ts:1184-1207`).
- **Teknologi + versi:** SQLite **FTS5** (bawaan `better-sqlite3` 13.2.0, wajib); `@qdrant/js-client-rest` 1.20.0 (opsional, circuit breaker **3 gagal / 60 s**); `@huggingface/transformers` 4.3.2 + `Xenova/multilingual-e5-small` (384d, q8, watchdog RSS 700 MB, opsional); `zod` 4.6.7 (validasi).
- **Output:** `citations` tervalidasi (deep-link, fail-closed) + `meta.retrievalBackend` + `meta.fallbackReason` + `embeddingUsed` (`lib/ai/retrieval.ts:1172-1181,1302-1309`; `lib/ai/adapter.ts:752-759`).
- **File implementasi:** `lib/core/query.ts:195-326`, `lib/ai/adapter.ts:511-523`, `lib/ai/retrieval.ts:1167-1389`, `lib/ai/hybrid.ts:59-303`, `lib/ai/embedding.ts:68-88`, `lib/qdrant/client.ts:198-257`, `lib/core/sql.ts:118-343`.
- **Kegagalan & fallback:**
  - Qdrant mati/timeout/circuit-open/URL kosong → FTS5 penuh + `fallbackReason` ∈ {`qdrant_unavailable`,`qdrant_timeout`,`qdrant_circuit_open`,`qdrant_empty`} (`lib/ai/retrieval.ts:1229-1252`; `lib/ai/hybrid.ts:144-170,201-303`).
  - Embedding gagal / dimatikan → BM25 saja + `embedding_unavailable` / `qdrant_dense_unavailable` (`lib/ai/hybrid.ts:293-299`).
  - SQL ditolak/gagal → `sql_rejected` jujur, bukan angka karangan (`lib/core/query.ts:352-367`).
  - Aplikasi **tidak pernah mati** karena Qdrant/embedding (DECISION-033 poin 1).

### Tahap 3 — Penyusunan jawaban
- **Input:** hasil SQL dan/atau `citations`.
- **Proses:**
  1. Draft **deterministik**: segmen klaim + marker sitasi `[n]` (`lib/core/answer.ts:403-509`).
  2. **Gate keputusan LLM**: `needsLlmFallback` hanya bila ada bukti, bukan `refused`, dan `confidenceLevel` bukan `strong` **atau** grounding angka < **0,99** **atau** key-fact < **0,60** (`lib/ai/answer-gate.ts:140-154`; dipanggil `lib/ai/adapter.ts:682-688`).
  3. **LLM opsional**: `LLM_MODE=full` → composer utama dokumen; `assist/full` → fallback penutup bila gate memutuskan (`lib/ai/adapter.ts:697-774`; `lib/ai/llm.ts:26-35`).
  4. **Validasi angka** LLM terhadap himpunan angka bukti; angka asing → tolak (`lib/ai/llm.ts:104-168`; `lib/ai/answer-gate.ts:97-127`).
  5. **Postcheck marker `[n]`** wajib; hilang → retry sekali → gagal → deterministik (`lib/ai/adapter.ts:940-980`).
  6. **Sanitasi anti-slop + mojibake** (U+FFFD, `â€™`, pembuka "Berikut adalah", klaim "live") diterapkan ke **SEMUA** jawaban, idempoten, tanpa mengubah angka (`lib/ai/answer-gate.ts:74-91`; `lib/ai/adapter.ts:51-54,669,744`).
- **Teknologi + versi:** HTTP [OI]-compatible via `fetch` (tanpa SDK; versi N/A), rantai fallback ≤4 model + backoff kecil (`lib/ai/llm.ts:54-91`), tanpa streaming.
- **Output:** jawaban final + `vizSpec` + `citations` + `meta` (`confidenceLevel`, `fallbackReason`, `queryUnderstanding`).
- **File implementasi:** `lib/core/answer.ts:403-509`, `lib/ai/adapter.ts:480-774,940-980`, `lib/ai/answer-gate.ts:74-189`, `lib/ai/llm.ts:26-168`.
- **Kegagalan & fallback:** LLM off/gagal/429/timeout/invalid/ungrounded → jawaban deterministik tetap dikirim + `fallbackReason` (`llm_fallback_failed` dsb.), tanpa error ke user (`lib/ai/adapter.ts:692-759`; `lib/ai/llm.ts:93-102`). Tanpa bukti → abstain jujur.

### Tahap 4 — Keluaran
- **Input:** objek `Query` lengkap.
- **Proses:**
  1. `vizSpec` **deterministik** dari bentuk data: `kpi|line|bar|donut|table|quote|none` (teks hukum → `quote`) (`lib/core/answer.ts:222-282`).
  2. Persist `messages`/`reports`/`query_log` (`app/api/query/route.ts:59-62`; `lib/core/store.ts`).
  3. Respons JSON `/api/query` → UI merender chart (`recharts`) + tabel + sitasi (`app/api/query/route.ts:63`).
  4. Laporan & ekspor CSV/PDF (`/api/reports/[id]/export`; `pdf-lib` 1.17.1 di `lib/reports/export.ts:1,91`, `lib/core/report.ts:15,436`).
  5. **Share snapshot read-only** ber-TTL `/api/share/[id]`, TTL dari `SHARE_TTL_DAYS` (default 30) (`lib/core/share.ts:26-31,228`; `app/api/share/route.ts`, `app/api/share/[id]/route.ts`).
- **Teknologi + versi:** `recharts` 3.11.0, `pdf-lib` 1.17.1, `date-fns` 4.4.0, `lucide-react` 1.75.0, Radix UI (dialog/dropdown-menu/select/tabs/tooltip).
- **Output:** jawaban terstruktur + chart + laporan + share link.
- **Jalur dashboard (terpisah dari chat):** KPI/trend/distribusi dihitung **SQL agregat deterministik**, bukan LLM — `lib/analytics/queries.ts:31-49,84-141` (summary) + `:160-243` (trends) + `lib/analytics/sql.ts:13-27` (allRows/oneRow) + `lib/api/dashboard.ts:30-49` (scope+periode). Periode default `this_month` bila tidak ada query param (`dashboard.ts:36-47`).
- **Kegagalan & fallback:** guardrail tetap HTTP **200** + penjelasan (API_CONTRACT §10.1); ekspor PDF butuh `BROWSER_PDF_EXECUTABLE` di VPS (`.env.example:41-46`).

---

## 3. Tabel teknologi per tahap (versi persis dari `tanyadata/package.json`)

| Tahap | Teknologi | Versi | Peran | Wajib? |
|---|---|---|---|---|
| Platform | `next` | 16.4.6 | App Router, Route Handlers, satu proses | wajib |
| Platform | `react` / `react-dom` | 19.3.1 | UI runtime | wajib |
| Platform | `typescript` | 5.9.3 | bahasa, `tsc --noEmit` | wajib (build) |
| Platform | `tailwindcss` + `@tailwindcss/postcss` | 4.3.5 | styling token | wajib |
| Platform | `better-sqlite3` | 13.2.0 | SQLite + FTS5, sumber kebenaran | wajib |
| Platform | `zod` | 4.6.7 | validasi request/output | wajib |
| Platform | Node.js | `>=22` (`engines`) | runtime | wajib |
| Ingest | `unpdf` | 2.2.1 | ekstraksi teks PDF sadar-layout | wajib (PDF) |
| Ingest | `mammoth` | 1.13.0 | ekstraksi DOCX | wajib (DOCX) |
| Ingest | `exceljs` | 4.4.0 | baca XLSX | wajib (XLSX) |
| Ingest | `csv-parse` | 7.0.3 | parse CSV | wajib (CSV) |
| Ingest | OCR PP-OCRv6 tiny (`onnxocr`, ONNX Runtime) | service terpisah (bukan dep `package.json`) | OCR image-only on-demand | opsional (DECISION-034) |
| Retrieval | SQLite FTS5 | bawaan `better-sqlite3` 13.2.0 | BM25 jalur default + fallback | wajib |
| Retrieval | `@qdrant/js-client-rest` | 1.20.0 | secondary index BM25 + dense | opsional (`QDRANT_MODE`) |
| Retrieval | `@huggingface/transformers` + `Xenova/multilingual-e5-small` | 4.3.2 / 384d q8 | embedding lokal | opsional (`EMBEDDING_PROVIDER`) |
| Compose | LLM [OI]-compatible (mis. Groq) | — (HTTP `fetch`, tanpa SDK) | composer/fallback penutup | opsional (`LLM_MODE`) |
| Compose | `date-fns` | 4.4.0 | aritmetika periode | wajib |
| Output | `recharts` | 3.11.0 | chart | wajib |
| Output | `pdf-lib` | 1.17.1 | ekspor PDF | wajib |
| Output | `lucide-react` | 1.75.0 | ikon | wajib |
| Output | `@radix-ui/react-dialog` / `-dropdown-menu` / `-select` / `-tabs` / `-tooltip` | `^1.1.15` / `^2.1.16` / `^2.2.6` / `^1.1.13` / `^1.2.8` | primitif UI aksesibel | wajib |
| Output | `clsx` / `tailwind-merge` | 2.1.1 / 3.7.0 | komposisi className | wajib |

> `@fontsource/inter`, `@fontsource/plus-jakarta-sans`, `material-symbols` juga ada di `package.json` tetapi hanya aset visual; tidak relevan untuk klaim pipeline.
> `sql` di `capabilities` selalu `'sqlite'` — benar, tidak perlu diturunkan dari env.

---

## 4. Matriks mode runtime

### 4.1 Variabel, nilai, dan default (dari `.env.example` + kode)

| Env | Nilai sah | Default `.env.example` | Default kode | Anchor |
|---|---|---|---|---|
| `RETRIEVAL_MODE` | `fts5` \| `qdrant` \| `hybrid` | `hybrid` | `hybrid` (nilai asing → `fts5`) | `.env.example:121-123`; `lib/ai/retrieval.ts:1167-1170` |
| `QDRANT_MODE` | `off` \| `on` \| `local` \| `required` | `on` | **berbeda**: sync/health `on`, adapter query `off` | `.env.example:98-102`; `lib/qdrant/client.ts:96-102`; `lib/ai/hybrid.ts:124-128` |
| `EMBEDDING_PROVIDER` | `off` \| `local` | `local` | `off` | `.env.example:125-128`; `lib/ai/embedding.ts:68-70` |
| `LLM_MODE` | `off` \| `assist` \| `full` | `off` | `off` | `.env.example:52-55`; `lib/ai/llm.ts:26-35` |
| `OCR_ENABLED` | `true` \| `false` | `false` | `false` (butuh `OCR_ENDPOINT` juga) | `.env.example:65-78`; `lib/ingest/ocr.ts:130-133` |
| `SEED_PROFILE` | `none` \| `demo` | `none` | `none` (nilai lain fail-closed) | `.env.example:15-20` |

> **Divergensi QDRANT_MODE (jujur):** `lib/qdrant/client.ts:96-102` memperlakukan kosong = `on`, sedangkan `lib/ai/hybrid.ts:124-128` memperlakukan kosong/`off` = Qdrant dimatikan untuk jalur query. Agar perilaku deterministik, **selalu set `QDRANT_MODE` eksplisit** (`.env.example` melakukannya). Payload runtime wajib melaporkan nilai yang dipakai jalur query, bukan asumsi.

### 4.2 Perilaku efektif retrieval (`RETRIEVAL_MODE` × `QDRANT_MODE` × `EMBEDDING_PROVIDER`)

| `RETRIEVAL_MODE` | `QDRANT_MODE` | `EMBEDDING_PROVIDER` | Perilaku efektif | Fallback / `fallbackReason` |
|---|---|---|---|---|
| `hybrid` (default) | `on` | `local` (default) | FTS5 + Qdrant BM25 + dense e5-small, RRF k=2 | Qdrant gagal → FTS5 + `qdrant_*`; embedding gagal → BM25-only + `embedding_unavailable` |
| `hybrid` | `on` | `off` | FTS5 + Qdrant BM25 saja | Qdrant gagal → FTS5 + `qdrant_*` |
| `qdrant` | `on` | `local`/`off` | hanya kandidat Qdrant; teks dihidrasi dari SQLite | gagal → FTS5 |
| `fts5` | apa pun | apa pun | jalur deterministik legacy; tanpa model/jaringan | — |
| `hybrid`/`qdrant` | `off` atau URL kosong | apa pun | `getQdrantConfig()` = `null` → FTS5 | `qdrant_unavailable` |
| `hybrid`/`qdrant` | `required` + API key kosong | — | fail-closed saat klien dibuat → FTS5 | `qdrant_unavailable` |

### 4.3 `LLM_MODE`

| Nilai | Perilaku |
|---|---|
| `off` (default) | deterministik penuh; tidak ada panggilan jaringan |
| `assist` | LLM hanya **fallback penutup** bila gate `needsLlmFallback` bernilai true (`lib/ai/adapter.ts:682-688`) |
| `full` | LLM sebagai **composer utama** dokumen (`lib/ai/adapter.ts:697-774`) |

Semua kegagalan LLM → jawaban deterministik + `fallbackReason` (`lib/ai/adapter.ts:692-759`).

### 4.4 `OCR_ENABLED`

| Nilai | Perilaku |
|---|---|
| `false` (default) | adapter tidak dipanggil; halaman butuh-OCR ditandai `ocr_skipped` jujur (`lib/ingest/ocr.ts:131-132`) |
| `true` + `OCR_ENDPOINT` | OCR per halaman image-only, konkurensi 1, timeout 5 s; confidence <0,70 → `ocr_review` (`lib/ingest/ocr.ts:23-29,127-206`) |
| `true` tanpa `OCR_ENDPOINT` | tetap `ocr_skipped` (fail-closed) (`lib/ingest/ocr.ts:130-133`) |

### 4.5 `SEED_PROFILE`

| Nilai | Perilaku |
|---|---|
| `none` (default, produksi) | image kosong: 0 dokumen, 0 transaksi, Qdrant 0 point — `no_documents`, bukan FAIL (`.env.example:15-20`) |
| `demo` (dev saja) | 4 KB-SOP + Perpres + 46.952 transaksi R&D (`.env.example:18`) |
| lainnya | ditolak fail-closed → `none` (`.env.example:19`) |

### 4.6 `qdrantReachable` (dilaporkan, bukan ditebak)

- `null` bila `QDRANT_MODE=off` **atau** `QDRANT_URL` kosong (`lib/qdrant/client.ts:198-210`).
- Selain itu = hasil probe `/readyz` + info collection (`qdrantHealth()`), dengan timeout `QDRANT_TIMEOUT_MS` (`lib/qdrant/client.ts:198-245`).
- **Jangan pernah** mengklaim "Qdrant hidup" tanpa probe. Di mesin dev Qdrant belum dijalankan (`docs/STATE.json` `qdrant_migration.status`).

---

## 5. Batasan jujur (boleh tampil sebagai "batasan", bukan disembunyikan)

1. **Tanpa auth / multi-tenant.** Single workspace lokal; guard token opsional `PUBLIC_DEPLOY`/`API_ACCESS_TOKEN` (`.env.example:35-39`; DECISION-002).
2. **Target presisi KB-GT 0,99 BELUM tercapai.** `holdout_precision=0.8571`, `dev_precision=0.5915`, `target=0.99`, `target_met=false` (`docs/STATE.json` `kb_ground_truth`). Catatan: `release_gate.notes` menulis agregat berbeda (`0.4811`) — inkonsistensi internal STATE.json yang wajib diselaraskan, bukan dikutip sebagai angka UI.
3. **KB01/KB04 masih memakai transkrip GT (`gt_transcript`), bukan OCR asli.** OCR sudah diimplementasikan sebagai microservice tetapi belum dijalankan di VPS (`docs/STATE.json` `kb_ground_truth.known_limitations`; tiket `OCR-01`).
4. **Qdrant belum dijalankan di mesin dev ini.** Circuit breaker → FTS5 terverifikasi (`docs/STATE.json` `qdrant_migration.status`).
5. **Dashboard belum mengonsumsi `dateRange` settings** — periode dipaku `'this_month'` bila tidak ada query param (`lib/api/dashboard.ts:36-47`; tiket `SET-01`).
6. **`capabilities.rag` masih dipaku `'fts5'`** di kode saat ini (`lib/meta.ts:50`) — menyesatkan; wajib diturunkan dari env + status (tiket `META-01`, §4 & API_CONTRACT §9.3.1).
7. **Tidak ada streaming / real-time.** Satu respons JSON per pesan (ARCHITECTURE C-10).
8. **Presisi lintas-dokumen rendah; FALSE_ABSTAIN parafrasa masih 11 di holdout** (`docs/STATE.json` `known_limitations`).
9. **Vercel ephemeral:** state workspace lokal bisa hilang saat cold start (DECISION-002 konsekuensi 3).
10. **`app.version` dipaku `'1.0.0'`** di `lib/meta.ts:31` (kebetulan sama dengan `package.json`); sebaiknya diturunkan dari `package.json` seperti `system.stack`.

---

## 6. Peta klaim → bukti (audit anti-klaim-palsu)

| Kalimat yang BOLEH tampil di UI | Bukti (`file:line` / env) |
|---|---|
| Menerima CSV/XLSX/SQLite/PDF/DOCX/TXT/MD ≤25 MB dengan validasi isi | `lib/core/ingest.ts:51-62,76-119` |
| PDF diekstrak sadar-layout; DOCX via mammoth; XLSX via exceljs; CSV via csv-parse | `lib/core/ingest.ts:217-301,793-796`; `package.json:41,43,45,53` |
| OCR PP-OCRv6 tiny opsional, default mati, halaman gagal ditandai jujur | `lib/ingest/ocr.ts:23-29,109-133,185-191`; `.env.example:65-78`; DECISION-034 |
| Chunk 900 char overlap 150; dokumen hukum parent-child | `lib/ingest/chunker.ts:5-6`; `lib/core/ingest.ts:647-692,902` |
| FTS5 selalu terisi; Qdrant indeks turunan via outbox; gagal Qdrant tak menggagalkan ingest | `lib/core/ingest.ts:1005-1046`; `lib/qdrant/sync.ts` |
| Retrieval default hybrid (FTS5 + BM25 Qdrant + dense e5-small) dengan RRF | `lib/ai/retrieval.ts:1167-1310,1356-1389`; `lib/ai/hybrid.ts:59-89`; `lib/ai/adapter.ts:511-523` |
| Circuit breaker → fallback FTS5 + `fallbackReason` jujur | `lib/ai/retrieval.ts:1229-1252`; `lib/ai/hybrid.ts:144-170,293-299`; `.env.example:86-94` |
| Teks sitasi Qdrant selalu dihidrasi dari SQLite (Qdrant bukan sumber teks) | `lib/ai/retrieval.ts:1183-1207` |
| SQL baca-saja: hanya SELECT/WITH, EXPLAIN dry-run, cap 500 baris, timeout 8 s | `lib/core/sql.ts:23-25,118-255,262-343` |
| Guardrail menolak destructive/PII/off-topic/ambiguous tanpa eksekusi | `lib/ai/guardrails.ts:145-159,431-457`; `lib/core/query.ts:195-206` |
| Cache query 30 menit (bukan 60 detik) | `lib/core/cache.ts:20`; `lib/core/query.ts:210-238` |
| Jawaban deterministik dari data; LLM opsional, wajib marker `[n]` + anti-slop/mojibake | `lib/core/answer.ts:403-509`; `lib/ai/adapter.ts:669-774,940-980`; `lib/ai/answer-gate.ts:74-154` |
| Angka jawaban LLM divalidasi terhadap bukti (grounding 0,99 / key-fact 0,60) | `lib/ai/answer-gate.ts:140-154,175-189`; `lib/ai/llm.ts:104-168` |
| Chart dipilih deterministik dari bentuk data | `lib/core/answer.ts:222-282` |
| Angka dashboard/KPI dihitung SQL agregat deterministik (bukan LLM) | `lib/analytics/queries.ts:31-49,84-141,160-243`; `lib/analytics/sql.ts:13-27`; `lib/api/dashboard.ts:30-49` |
| Laporan CSV/PDF + share snapshot read-only ber-TTL | `app/api/reports/[id]/export/route.ts`; `lib/reports/export.ts:1,91`; `lib/core/share.ts:26-31,228`; `.env.example:48-50` |
| Mode runtime efektif = §4 (dibaca dari env, bukan klaim statis) | `.env.example`; `lib/ai/retrieval.ts:1167-1170`; `lib/qdrant/client.ts:96-102,198-245`; `lib/ai/hybrid.ts:124-140`; `lib/ai/embedding.ts:68-83` |
| Tidak ada auth/tenancy; single-user lokal | DECISION-002; `.env.example:35-39` |
| Presisi 0,99 belum tercapai; OCR/Qdrant belum diuji di VPS | `docs/STATE.json` `kb_ground_truth`, `qdrant_migration` |

### 6.1 Klaim yang DILARANG tampil (salah / `UNVERIFIED`)

| Kalimat | Status | Alasan |
|---|---|---|
| "Tidak ada data yang dikirim ke layanan eksternal" | **SALAH** | LLM (Groq) opsional, microservice OCR, dan Qdrant bisa aktif (`.env.example:52-78,80-134`). Saat ini dirender di `app/(workspace)/settings/page.tsx:512-514` → wajib dihapus/diganti. |
| "Retrieval = FTS5" (statis) | **SALAH** | Default `RETRIEVAL_MODE=hybrid` + `QDRANT_MODE=on` (`lib/ai/retrieval.ts:1168`; `.env.example:102,123`). Saat ini dirender via `capabilities.rag` di `settings/page.tsx:466,481`. |
| "Real-time / live / data langsung" | **SALAH** | Tidak ada streaming; `answer-gate.ts:62-68` bahkan memblokir klaim "live". |
| "Akurasi >99%" | **UNVERIFIED/SALAH** | Holdout 0,8571 < target 0,99 (`docs/STATE.json`). |

---

## 7. Verdict — `preferences.chartDefault` & `preferences.denseTables` (Deliverable 3)

**Pertanyaan:** aman menghapus keduanya dari kontrak `/api/settings`?

**Konsumen terverifikasi** (grep rekursif seluruh `tanyadata/`):

| Lokasi | Peran | Perilaku? |
|---|---|---|
| `lib/settings.ts:17` (tipe state), `:43` (GET), `:54` (tipe patch), `:109-115` (merge + validasi) | baca/tulis + validasi | tidak — hanya menyimpan |
| `lib/contracts/http.ts:609` | tipe `SettingsResponse` | tidak |
| `lib/api/schemas.ts:75-76` | zod validasi `PUT /api/settings` | tidak |
| `lib/db/migrate.ts:52` | default seed `{ chartDefault:'bar', denseTables:false }` | tidak |
| `scripts/init-workspace-db.mjs:130` | default seed yang sama | tidak |
| `app/(workspace)/settings/page.tsx:123-124,132-133,172,210,415,473` | state form, load, simpan, label, checkbox, select | tidak — hanya kontrol UI |

**Tidak ada konsumen perilaku.** Tidak ada di `lib/core`, `lib/ai`, `lib/api/dashboard`, chart, maupun tabel yang membaca nilai ini untuk mengubah keluaran. (Ini konsisten dengan DECISION-035 konteks 2 & tiket `SET-01`.)

**Verdict:**
- ❌ **Tidak aman** menghapus **hanya** dari tipe/kontrak (`contracts/http.ts:609`) sambil meninggalkan `settings.ts`/halaman: `getSettings` mengembalikan literal `preferences` (excess-property TS error) dan halaman masih membaca `data.preferences.chartDefault` (type error). Ini akan memecahkan typecheck.
- ✅ **Aman dihapus total** sebagai **satu perubahan terkoordinasi** (multi-file, bukan satu baris): hapus field di `contracts/http.ts:609`, `lib/api/schemas.ts:75-76`, `lib/settings.ts:17,43,54,109-115`, kontrol+state di `app/(workspace)/settings/page.tsx:123-124,132-133,172,210,415,473`, dan default di `lib/db/migrate.ts:52` + `scripts/init-workspace-db.mjs:130`. **Dampak perilaku: nol** (tidak ada konsumen). Baris settings lama di DB tetap valid (JSON.parse mengabaikan field ekstra).
- **Rekomendasi:** **HAPUS** (sesuai aturan keras DECISION-035 keputusan 2: kontrol yang tidak mengubah perilaku harus dihapus). Menyambungkan `chartDefault` justru bertabrakan dengan `buildVizSpec` yang deterministik dari bentuk data (`lib/core/answer.ts:222-282`), jadi opsi "sambungkan" lebih invasif dan berisiko.

**Konsumen "tak terlihat" yang wajib disebut:** seed/init scripts (`lib/db/migrate.ts:52`, `scripts/init-workspace-db.mjs:130`) dan zod schema (`lib/api/schemas.ts:75-76`). Penghapusan kontrak saja akan melewatkan keduanya dan meninggalkan data mati.

> Catatan terkait (bukan bagian verdict): `settings.dateRange` juga tidak dikonsumsi dashboard (`lib/api/dashboard.ts:36-47` memaku `this_month`). Itu tiket `SET-01` terpisah.

---

## 8. Catatan koreksi terhadap dokumen/klaim lama

- Cache query adalah **30 menit** (`lib/core/cache.ts:20`), bukan 60 detik.
- Retrieval *mode-aware* (Qdrant/hybrid) dipanggil di **`lib/ai/adapter.ts:511-523`**, bukan di `lib/core/query.ts` (core memakai FTS5 sinkron).
- `capabilities.rag` ada di **`lib/meta.ts:50`** (bukan `:31`); `capabilities` blok = `lib/meta.ts:47-52`.
- STATE.json punya dua angka presisi yang berbeda (`kb_ground_truth.holdout_precision=0.8571` vs `release_gate.notes=0.4811`); UI hanya boleh memakai satu sumber setelah diselaraskan.
