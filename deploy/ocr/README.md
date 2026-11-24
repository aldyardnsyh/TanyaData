# OCR on-demand — PP-OCRv6 tiny di VPS

Lingkup: **DECISION-034** poin 1–3 dan **ADR-11** (`docs/CORE_V2_ARCHITECTURE.md`).
Kontrak HTTP mengikuti `tanyadata/lib/ingest/ocr.ts:120-170` — service ini
hanya menggantikan adapter lama yang mengirim nomor halaman tanpa piksel.

Service memakai `onnxocr` (Python, **ONNX Runtime saja, tanpa PaddlePaddle**),
model **PP-OCRv6 tiny**. Berjalan sebagai microservice terpisah, **on-demand**:
hidup hanya saat Fase A ingestion dokumen image-only, lalu dimatikan.

> Agent tidak menjalankan Docker, service OCR, dev server, atau watcher.
> Semua perintah di bawah dijalankan **manual oleh operator di VPS**.

## 0. Peringatan resource (baca dulu)

VPS target: **2 vCPU / 2 GB RAM**. DECISION-034 mencatat puncak RAM PP-OCRv6
tiny **1,3–1,4 GB** pada benchmark 4 vCPU. Konsekuensi:

- **JANGAN** menyalakan OCR dan embedding/Qdrant bersamaan. Keduanya memuat
  model dan akan saling berebut RAM → OOM.
- Jalankan OCR **sendiri**, selesai Fase A, matikan, baru lanjut Fase B/C.
- Default `mem_limit=1g` di compose adalah plafon aman. Bila OCR terkena OOM
  kill, ukur RSS lalu naikkan lewat `OCR_MEM_LIMIT=1400m` — jangan menebak.
- Jangan jalankan reindex Qdrant atau render PDF bersamaan dengan OCR.

## 1. Setup dari nol

```bash
# 1. Secret — jangan pernah commit. Sama dengan OCR_API_KEY di aplikasi.
export OCR_API_KEY='<dari secret manager>'

# 2. Jalankan container (detached — TIDAK ada watcher / foreground).
cd /srv/tanyadata/deploy/ocr
docker compose up -d --build

# 3. Verifikasi readiness. Model dimuat sekali saat startup.
curl -fsS http://127.0.0.1:6334/healthz
# → {"status":"ok","model":"PP-OCRv6 tiny","concurrency":1}
#    HTTP 503 berarti model gagal dimuat — cek `docker compose logs --tail 20 ocr`.
```

Lalu di aplikasi Next.js (file `.env.local` di VPS, **bukan** `NEXT_PUBLIC_*`):

```env
OCR_ENABLED=true
OCR_ENDPOINT=http://127.0.0.1:6334/ocr
OCR_API_KEY=<sama dengan secret di atas>
OCR_TIMEOUT_MS=5000
```

`OCR_TIMEOUT_MS` klien (5000 ms) **harus lebih besar** dari `OCR_TIMEOUT_S`
service (default 4000 ms) agar service sempat mengembalikan `504` sebelum
klien membatalkan request.

## 2. Kontrak endpoint

### `POST /ocr`

Request:

```json
{
  "image": "<base64 PNG, 150 DPI, sisi terpanjang ≈1754 px, ≤2 MB>",
  "page": 1,
  "docId": "kb01",
  "width": 1240,
  "height": 1754
}
```

Response `200`:

```json
{ "text": "teks hasil OCR, satu baris per region", "confidence": 0.91, "page": 1 }
```

- `confidence` = rata-rata skor region (0..1). `0` bila tidak ada teks.
- Klien menandai `confidence < 0.70` sebagai `ocr_review`, dan `text` kosong
  sebagai `ocr_skipped` — jangan mengarang isi scan.

Error (format seragam `{"error":{"code","message"}}`, tanpa stack trace):

| Status | code | Sebab |
|---|---|---|
| 400 | `invalid_request` | Body gagal validasi tipe/range |
| 400 | `invalid_image` | base64 bukan PNG yang bisa didekode |
| 401 | `unauthorized` | Bearer token salah/kosong saat `OCR_API_KEY` diset |
| 413 | `image_too_large` | Gambar terdekode > 2 MB |
| 415 | `unsupported_image` | Bukan PNG |
| 503 | `model_unavailable` | Model gagal dimuat / inference error |
| 504 | `inference_timeout` | Inference melewati `OCR_TIMEOUT_S` |

### `GET /healthz`

`200` bila model siap, `503` bila tidak. Tidak memuat model, tidak menerima data.

### Contoh curl

```bash
# Ganti <BASE64_PNG> dengan base64 PNG uji. Jangan tempel data asli ke log.
curl -fsS -X POST http://127.0.0.1:6334/ocr \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $OCR_API_KEY" \
  -d '{"image":"<BASE64_PNG>","page":1,"docId":"kb01","width":1240,"height":1754}'
```

## 3. Urutan fase ingestion (WAJIB berurutan)

| Fase | Proses | Model di RAM | Selesai |
|---|---|---|---|
| **A** | OCR → teks per halaman | PP-OCRv6 tiny | `docker compose down` |
| **B** | Embedding e5-small q8 384d → vektor | e5-small | worker dimatikan |
| **C** | Upsert Qdrant | tidak ada model | — |

Antar fase, worker dimatikan/dibebaskan agar puncak RAM tidak bertumpuk.
FTS5 tetap jalur fallback bila Qdrant/embedding tidak tersedia (DECISION-034
poin 5). Teks hasil OCR disimpan dengan `ocr_status` dan `confidence` agar
rendah confidence bisa ditandai review, bukan dianggap bukti pasti.

## 4. Variabel environment

| Var | Default | Catatan |
|---|---|---|
| `OCR_API_KEY` | kosong | Bearer token. Kosong = loopback tanpa auth. |
| `OCR_TIMEOUT_S` | `4.0` | Timeout inference; harus < `OCR_TIMEOUT_MS` klien. |
| `OCR_MAX_IMAGE_BYTES` | `2097152` | Batas gambar terdekode (2 MB). |
| `OCR_MEM_LIMIT` | `1g` | Plafon RAM compose; naikkan setelah ukur RSS. |
| `OCR_CPUS` | `1` | Batas CPU compose. |
| `OCR_LOG_LEVEL` | `INFO` | Log hanya metadata, **tanpa gambar/teks**. |

## 5. Matikan & cleanup

```bash
cd /srv/tanyadata/deploy/ocr
docker compose down          # setelah Fase A selesai
# Volume ocr_model_cache sengaja dipertahankan (cache model).
```

## 6. Troubleshooting ringkas

- `healthz` 503 → cek log startup; kemungkinan `onnxocr` gagal import/model
  rusak. Service tetap up tapi `/ocr` balas 503.
- `504` → turunkan DPI/ukuran gambar atau naikkan `OCR_TIMEOUT_S` (maks < 5 s).
- `413` → `renderPagePng` di `ocr.ts` seharusnya sudah menurunkan ke ~120 DPI;
  bila masih besar, halaman memang ditandai `unreadable` (jujur).
- `401` → `OCR_API_KEY` di aplikasi dan container berbeda.

## 7. Catatan keamanan

- Port 6334 **tidak boleh** dipublikasikan. TLS/otentikasi publik ditangani
  reverse proxy di depan aplikasi, bukan di service OCR.
- Service tidak pernah menulis base64, piksel, atau teks OCR ke log — hanya
  ukuran byte, nomor halaman, jumlah baris, confidence, latency, dan kode error.
- Kredensial hanya dari env/secret manager, tidak ada di image maupun repo.
