# API_CONTRACT — TanyaData

**Versi:** 1.0 · **Tanggal:** 2026-11-19 · **Pemilik:** architect · **Fase:** P1
**Status:** mengikat untuk frontend, backend, aiml. Perubahan wajib lewat `docs/DECISIONS.md`.
**Sumber requirement:** `docs/SPEC.md` (FR/AC), `docs/ARCHITECTURE.md` §3–§8.

---

## 1. Konvensi

| Aspek | Aturan |
|---|---|
| Base path | `/api` |
| Format | JSON UTF-8, `Content-Type: application/json` (kecuali upload & export) |
| Sukses | Status 2xx, **tanpa envelope**; resource keys berada di top-level |
| List | `{ items: T[], total: number, limit: number, offset: number }` |
| Error | `{ "error": { "code": string, "message": string, "details"?: unknown } }` |
| Tanggal | `YYYY-MM-DD` (tanggal) ; ISO-8601 dengan offset `+07:00` (timestamp) |
| Angka | JSON `number`, **bukan string**. Persen 2 desimal; IDR integer tanpa pemisah |
| `null` | Dipakai eksplisit untuk "tidak tersedia" (mis. perubahan dari basis 0). UI menampilkan `n/a` |
| Bahasa | `lang=id|en` (query/body). Default dari `settings.lang`. Mengikat seluruh string yang dihasilkan server, termasuk pesan error & guardrail |
| Timezone | `Asia/Jakarta` untuk label; perhitungan tanggal murni (tanpa jam) |
| Cache | Semua endpoint `Cache-Control: no-store` (data dinamis) |
| Auth | Tidak ada (single-user workspace) |
| Runtime | Node.js (`better-sqlite3`), bukan Edge |
| ID | `crypto.randomUUID()` untuk conversation/message/report/investigation; `src_<8>` untuk source |
| Read-only | `analytics.db` tidak pernah ditulis. Tidak ada endpoint yang menerima SQL dari klien |

### 1.1 Kode error

| HTTP | `code` | Kapan |
|---|---|---|
| 400 | `VALIDATION_ERROR` | query/body tidak lolos zod (`details` = daftar field) |
| 404 | `NOT_FOUND` | conversation/report/source/investigation tidak ada |
| 405 | `METHOD_NOT_ALLOWED` | method tidak didukung pada path |
| 409 | `CONFLICT` | hapus dataset yang sedang aktif; hapus sumber saat job berjalan |
| 413 | `FILE_TOO_LARGE` | upload > 25 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | ekstensi/MIME di luar whitelist |
| 422 | `UNPROCESSABLE_SOURCE` | file valid secara format tapi gagal validasi isi (kolom wajib hilang, XLSX rusak, PDF tanpa text layer) |
| 429 | `RATE_LIMITED` | kuota in-process per-IP terlampaui; header `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (P6-FIX / B2) |
| 500 | `INTERNAL_ERROR` | kegagalan tak terduga (`details` hanya di log server) |
| 503 | `PUBLIC_DEPLOY_BLOCKED` | `PUBLIC_DEPLOY` aktif tanpa `API_ACCESS_TOKEN` — seluruh endpoint API ditolak (P6-FIX / SEC-001) |

**Tidak ada** kode untuk "LLM gagal": kegagalan LLM selalu menghasilkan 200 dengan jawaban deterministik dan `meta.fallbackReason`.

### 1.2 Parameter filter standar (dashboard, insights, investigasi)

| Param | Tipe | Default | Validasi |
|---|---|---|---|
| `start` | `YYYY-MM-DD` | `settings.default_start` (`2026-11-01`) | dalam `DATA_MIN..DATA_NOW` |
| `end` | `YYYY-MM-DD` | `settings.default_end` (`2026-11-18`) | `start ≤ end`, rentang ≤ 400 hari |
| `compare` | `like_for_like \| previous \| none` | `like_for_like` bila periode parsial, `previous` bila penuh | enum |
| `status` | `SUCCESS\|FAILED\|PENDING\|EXPIRED\|REFUNDED` | semua | enum |
| `channel` | nama kanal persis (`VA Mandiri`, `OVO`, …) | semua | harus ada di `channels` |
| `category` | nama kategori persis | semua | harus ada di dataset |
| `dataset` | `seed` atau `data_sources.id` | `settings.active_dataset_id` | harus `status='READY'` |
| `lang` | `id\|en` | `settings.lang` | enum |

---

## 2. Peta endpoint

| # | Method | Path | Handler | FR/AC |
|---|---|---|---|---|
| 1 | GET | `/api/dashboard/summary` | `analytics.metrics.summary` | FR-01 / AC-01.1, 01.4, 01.5 |
| 2 | GET | `/api/dashboard/trends` | `analytics.metrics.trend` | FR-01 / AC-01.3 |
| 3 | GET | `/api/dashboard/status-distribution` | `analytics.metrics.statusDistribution` | FR-01 / AC-01.2, AI-03 |
| 4 | GET | `/api/dashboard/channel-performance` | `analytics.metrics.channelPerformance` | FR-01 / AC-01.2 |
| 5 | GET | `/api/dashboard/category-performance` | `analytics.metrics.categoryPerformance` | FR-01 / AC-01.2 |
| 6 | GET | `/api/dashboard/insights` | `analytics.insights.scan` | FR-01 / AC-01.6 |
| 7 | GET | `/api/sources` | `ingest.sources.list` | FR-03 / AC-03.1 |
| 8 | POST | `/api/sources` | `ingest.sources.create` | FR-03 / AC-03.2, 03.3 |
| 9 | GET | `/api/sources/:id` | `ingest.sources.detail` | FR-03 / AC-03.4, 04.4 |
| 10 | DELETE | `/api/sources/:id` | `ingest.sources.remove` | FR-03 / AC-03.5 |
| 11 | GET | `/api/sources/:id/preview` | `ingest.sources.preview` | FR-03 / AC-03.4 |
| 12 | POST | `/api/sources/:id/reindex` | `ingest.sources.reindex` | FR-04 / AC-04.4, 04.5 |
| 13 | GET | `/api/conversations` | `chat.conversations.list` | FR-02 / AC-02.5 |
| 14 | POST | `/api/conversations` | `chat.conversations.create` | FR-02 / AC-02.5 |
| 15 | GET | `/api/conversations/:id` | `chat.conversations.detail` | FR-02 / AC-02.5 |
| 16 | DELETE | `/api/conversations/:id` | `chat.conversations.remove` | FR-02 / AC-02.5 |
| 17 | POST | `/api/conversations/:id/messages` | `chat.messages.create` | FR-02, AI-01..07 / AC-02.1..7, AC-AI-01..09 |
| 18 | POST | `/api/conversations/:id/messages/:msgId/report` | `reports.createFromMessage` | FR-06 / AC-06.1 |
| 19 | GET | `/api/investigations` | `investigation.list` | FR-05 / AC-05.5 |
| 20 | GET | `/api/investigations/overview` | `investigation.overview` | FR-05 / AC-05.1 |
| 21 | POST | `/api/investigations/analyze` | `investigation.analyze` | FR-05 / AC-05.1..4 |
| 22 | GET | `/api/investigations/anomalies` | `investigation.anomalies` | FR-05 / AC-01.6 |
| 23 | GET | `/api/investigations/:id` | `investigation.detail` | FR-05 / AC-05.5 |
| 24 | GET | `/api/reports` | `reports.list` | FR-06 / AC-06.5 |
| 25 | GET | `/api/reports/:id` | `reports.detail` | FR-06 / AC-06.2 |
| 26 | GET | `/api/reports/:id/export` | `reports.export` | FR-06 / AC-06.3, 06.4 |
| 27 | GET | `/api/settings` | `settings.get` | FR-07 / AC-07.1..4 |
| 28 | PUT | `/api/settings` | `settings.update` | FR-07 / AC-07.1..4 |
| 29 | GET | `/api/meta` | `meta.get` | FR-01, FR-07 / AC-01.4, 07.3 |

> #19, #23 wajib meski tidak disebut di ringkasan brief: SPEC menetapkan rute `/investigations/[id]` dan AC-05.5 mengharuskan investigasi tersimpan dapat dibuka kembali.

---

## 3. Tipe bersama

Didefinisikan di `tanyadata/lib/contracts/http.ts` (backend menulis saat scaffold; lane lain read-only).

```ts
type Period = {
  start: string; end: string; label: string;      // "1–18 Nov 2026"
  isPartial: boolean; dayCount: number;
  compare: null | { start: string; end: string; label: string;
                    strategy: 'like_for_like' | 'previous' | 'none' };
};

type DatasetRef = {
  id: string; name: string; kind: 'seed' | 'upload';
  rowCount: number; minDate: string; maxDate: string;
};

type Kpi = {
  key: 'total'|'successful'|'failed'|'successRate'|'failureRate'|'successValue';
  label: string;
  value: number | null;
  format: 'number' | 'percent' | 'currency';
  changePct: number | null;                       // null → "n/a"
  direction: 'up' | 'down' | 'flat' | null;
  compareValue: number | null;
};

type SourceCitation = {
  kind: 'document' | 'dataset';
  sourceId: string;
  docId?: string;          docTitle?: string;
  sectionNo?: number | null; section?: string | null; page?: number | null;
  quote?: string; chunkId?: number; score?: number;
  table?: string;          // untuk dataset: 'transactions'
  period?: string;
  sql?: string;
};

type SupportingTable = {
  columns: { key: string; label: string;
             align?: 'left'|'right'; format?: 'number'|'percent'|'currency'|'text' }[];
  rows: Record<string, string | number | null>[];
  totalRows: number; truncated: boolean;
};

type Visualization = {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'kpi';
  title: string;
  dataKey: string;                                // kolom nilai utama
  xKey: string;                                   // kolom kategori/waktu
  series: { key: string; label: string;
            unit?: '%' | 'IDR' | 'tx';
            colorToken?: string }[];
  rows: Record<string, string | number | null>[];
  orientation?: 'vertical' | 'horizontal';
  stacked?: boolean;
  format?: 'number' | 'percent' | 'currency';
};
```

---

## 4. Dashboard

Semua menerima §1.2 dan mengembalikan `period` + `dataset`. Bila hasil 0 baris: `kpis[].value = null`, `items = []`, `empty: true`, dan `notes` menyatakan "tidak ada data pada filter ini" (AC-01.5).

### 4.1 `GET /api/dashboard/summary`

Response:
```json
{
  "period": {
    "start": "2026-11-01", "end": "2026-11-18",
    "label": "1–18 Nov 2026", "isPartial": true, "dayCount": 18,
    "compare": { "start": "2026-10-01", "end": "2026-10-18",
                 "label": "1–18 Okt 2026", "strategy": "like_for_like" }
  },
  "dataset": { "id": "seed", "name": "analytics.db — Transaksi", "kind": "seed",
               "rowCount": 46952, "minDate": "2026-08-01", "maxDate": "2026-11-18" },
  "kpis": [
    { "key": "total", "label": "Total Transaksi", "value": 8125, "format": "number",
      "changePct": 9.65, "direction": "up", "compareValue": 7410 },
    { "key": "successful", "label": "Transaksi Sukses", "value": 7537, "format": "number",
      "changePct": 12.1, "direction": "up", "compareValue": 6723 },
    { "key": "failed", "label": "Transaksi Gagal", "value": 399, "format": "number",
      "changePct": 63.5, "direction": "up", "compareValue": 244 },
    { "key": "successRate", "label": "Success Rate", "value": 92.76, "format": "percent",
      "changePct": -2.4, "direction": "down", "compareValue": 95.06 },
    { "key": "failureRate", "label": "Failure Rate", "value": 4.91, "format": "percent",
      "changePct": 1.63, "direction": "up", "compareValue": 3.28 },
    { "key": "successValue", "label": "Nilai Transaksi Sukses", "value": 4389541500,
      "format": "currency", "changePct": null, "direction": null, "compareValue": null }
  ],
  "empty": false,
  "notes": ["Periode 1–18 Nov 2026 adalah bulan berjalan (18/30 hari).",
            "Pembanding memakai rentang setara 1–18 Okt 2026 (like-for-like)."]
}
```
`changePct` dihitung terhadap `period.compare`; `null` bila `compareValue = 0` atau `compare=null`.

### 4.2 `GET /api/dashboard/trends?grain=day|week|month`

Default `grain=day`. Response:
```json
{
  "grain": "day",
  "points": [
    { "bucket": "2026-11-01", "label": "1 Nov", "total": 402, "successful": 380,
      "failed": 12, "successRate": 94.53, "failureRate": 2.99 }
  ],
  "totals": { "total": 8125, "successful": 7537, "failed": 399 },
  "truncated": false,
  "period": { "...": "..." },
  "dataset": { "...": "..." }
}
```
Batas: `points.length ≤ 120`. Bila periode > 120 bucket pada grain terpilih → agregasi Naik ke grain lebih kasar otomatis dan `truncated: true` + `notes`. Total pada semua grain identik.

### 4.3 `GET /api/dashboard/status-distribution`

```json
{
  "items": [
    { "status": "SUCCESS",  "count": 7537, "percent": 92.76 },
    { "status": "FAILED",   "count": 399,  "percent": 4.91 },
    { "status": "EXPIRED",  "count": 90,   "percent": 1.11 },
    { "status": "REFUNDED", "count": 64,   "percent": 0.79 },
    { "status": "PENDING",  "count": 35,   "percent": 0.43 }
  ],
  "total": 8125,
  "period": { "...": "..." }
}
```
`EXPIRED/PENDING/REFUNDED` **tidak** masuk `failureRate` (AI-03).

### 4.4 `GET /api/dashboard/channel-performance?metric=volume|failure_rate&limit=10`

```json
{
  "metric": "volume",
  "items": [
    { "channelId": "CH05", "channelName": "GoPay", "total": 1290, "successful": 1250,
      "failed": 40, "successRate": 96.9, "failureRate": 3.1, "share": 15.88,
      "changePct": 6.2 }
  ],
  "total": 8125,
  "truncated": false
}
```
`limit` 1..10 default 10 (10 kanal).

### 4.5 `GET /api/dashboard/category-performance`

Sama bentuknya dengan 4.4, field `categoryName`, 7 kategori, ditambah `avgTicket` (IDR) per kategori.

### 4.6 `GET /api/dashboard/insights?limit=3`

```json
{
  "items": [
    {
      "id": "ins_va_mandiri_failure",
      "severity": "high",
      "title": "Failure rate VA Mandiri naik 12,1 poin",
      "detail": "6,03% (Okt) → 16,17% (Nov 1–18), terkonsentrasi pada F04 BANK_TIMEOUT.",
      "metric": "failure_rate",
      "channel": "VA Mandiri",
      "period": "2026-11-01..2026-11-18",
      "evidence": { "sql": "SELECT ...", "refs": ["transactions", "failure_codes"] },
      "links": [{ "label": "Investigasi", "href": "/investigations?topic=va_mandiri" }]
    }
  ],
  "generatedAt": "2026-11-19T08:00:00+07:00",
  "period": { "...": "..." }
}
```
Minimal 3 item (AC-01.6); aturan deteksi: perubahan failure rate kanal ≥ 2 poin vs pembanding, lonjakan kode ≥ 2× baseline, atau perubahan volume kategori ≥ 10%.

---

## 5. Chat

### 5.1 Tipe pesan (dipakai #15, #17, #18)

```ts
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: string;                              // ISO +07:00
  content: string;                                // teks polos (render fallback, pencarian)
  answer?: string;                                // direct answer (1–3 kalimat)
  keyFindings?: { text: string; ref?: string }[];
  supportingTable?: SupportingTable | null;
  visualizations?: Visualization[];
  sql?: { query: string; durationMs: number; rowCount: number; error?: string } | null;
  sources?: SourceCitation[];
  followUps?: string[];
  meta?: {
    period: Period | null;
    dataset: DatasetRef;
    partial: boolean;                             // data/periode tidak lengkap
    rowCount: number;                             // baris yang mendasari jawaban
    mode: 'sql' | 'rag' | 'hybrid' | 'guardrail' | 'smalltalk';
    latencyMs: number;
    contextApplied?: ('period'|'channel'|'category'|'failureCode')[];
    assumed?: boolean;                            // asumsi metrik/periode dinyatakan
    fallbackReason?: 'llm_timeout' | 'llm_error' | 'llm_invalid' | 'sql_rejected';
  };
  guardrail?: {
    type: 'out_of_range' | 'not_in_sources' | 'destructive' | 'pii' | 'ambiguous' | 'unsupported';
    explanation: string;
  };
};
```

Aturan: untuk `mode: 'guardrail'`, `sql` = `null`, `sources` = `[]` (kecuali `ambiguous` yang menampilkan opsi), dan **tidak ada angka hasil karangan**. Angka yang tetap boleh muncul adalah batas data (`maxDate`) — bukan nilai metrik.

### 5.2 `GET /api/conversations?limit=50&offset=0&q=`

```json
{
  "items": [{
    "id": "c1f0…", "title": "Analisis kegagalan November", "lang": "id",
    "dataset": { "id": "seed", "name": "analytics.db — Transaksi" },
    "messageCount": 11, "lastMessageAt": "2026-11-19T08:12:44+07:00",
    "createdAt": "2026-11-19T07:40:02+07:00",
    "preview": "Failure rate VA Mandiri 16,17%…"
  }],
  "total": 3, "limit": 50, "offset": 0
}
```

### 5.3 `POST /api/conversations`

Body: `{ "title"?: string, "dataset"?: string, "lang"?: "id"|"en" }`
→ `201`
```json
{ "conversation": { "id": "c1f0…", "title": "Percakapan baru", "lang": "id",
                    "dataset": { "id": "seed", "name": "analytics.db — Transaksi" },
                    "messageCount": 0, "createdAt": "2026-11-19T08:00:00+07:00",
                    "updatedAt": "2026-11-19T08:00:00+07:00" } }
```
Judul otomatis dari pesan pertama bila `title` kosong (maks 60 karakter).

### 5.4 `GET /api/conversations/:id`

`200` → `{ conversation: {...}, messages: ChatMessage[] }` (urut `seq` naik, payload utuh termasuk sitasi). `404` bila tidak ada. Percakapan lama **tidak** terhapus saat sumber data dihapus (AC-03.5) — pesan menyimpan snapshot.

### 5.5 `DELETE /api/conversations/:id`

`204`. `messages` ikut terhapus (cascade). Laporan yang lahir dari percakapan itu tetap ada (`conversation_id` → `NULL`).

### 5.6 `POST /api/conversations/:id/messages`

Body:
```json
{ "content": "Berapa total transaksi pada bulan ini?",
  "lang": "id",
  "period": { "start": "2026-11-01", "end": "2026-11-18" },
  "dataset": "seed" }
```
`content` wajib, 1–2000 karakter. `period`/`dataset` opsional (menimpa konteks). `lang` opsional.

`200`:
```json
{
  "message": {
    "id": "m_9a2…",
    "role": "assistant",
    "createdAt": "2026-11-19T08:12:44+07:00",
    "content": "Total transaksi 1–18 Nov 2026 adalah 8.125 transaksi, dengan nilai transaksi sukses IDR 4.389.541.500.",
    "answer": "Ada 8.125 transaksi pada 1–18 Nov 2026 (bulan berjalan, 18 dari 30 hari).",
    "keyFindings": [
      { "text": "Success rate 92,76%; failure rate 4,91%.", "ref": "sql:summary" },
      { "text": "Nilai transaksi sukses IDR 4.389.541.500.", "ref": "sql:summary" },
      { "text": "Periode masih parsial — jangan dibandingkan dengan bulan penuh.", "ref": "period" }
    ],
    "supportingTable": {
      "columns": [
        { "key": "metric", "label": "Metrik" },
        { "key": "value", "label": "Nilai", "align": "right" }
      ],
      "rows": [
        { "metric": "Total", "value": 8125 },
        { "metric": "Sukses", "value": 7537 },
        { "metric": "Gagal", "value": 399 }
      ],
      "totalRows": 3, "truncated": false
    },
    "visualizations": [
      { "id": "v_total", "type": "kpi", "title": "Total Transaksi",
        "dataKey": "value", "xKey": "label", "series": [],
        "rows": [{ "label": "Total", "value": 8125 },
                 { "label": "Sukses", "value": 7537 },
                 { "label": "Gagal", "value": 399 }],
        "format": "number" }
    ],
    "sql": {
      "query": "SELECT COUNT(*) AS total, SUM(CASE WHEN status='SUCCESS' THEN amount ELSE 0 END) AS value FROM seed.transactions WHERE transaction_date BETWEEN '2026-11-01' AND '2026-11-18'",
      "durationMs": 6, "rowCount": 1
    },
    "sources": [
      { "kind": "dataset", "sourceId": "seed", "table": "transactions",
        "period": "2026-11-01..2026-11-18",
        "sql": "SELECT COUNT(*) AS total, …" }
    ],
    "followUps": [
      "Bagaimana distribusi statusnya?",
      "Bandingkan dengan 1–18 Okt 2026",
      "Kanal mana yang paling berkontribusi pada kegagalan?"
    ],
    "meta": {
      "period": { "start": "2026-11-01", "end": "2026-11-18",
                  "label": "1–18 Nov 2026", "isPartial": true, "dayCount": 18,
                  "compare": null },
      "dataset": { "id": "seed", "name": "analytics.db — Transaksi", "kind": "seed",
                   "rowCount": 46952, "minDate": "2026-08-01", "maxDate": "2026-11-18" },
      "partial": true,
      "rowCount": 8125,
      "mode": "sql",
      "latencyMs": 38,
      "contextApplied": ["period"]
    }
  },
  "conversation": { "id": "c1f0…", "title": "Berapa total transaksi pada bulan ini?",
                    "updatedAt": "2026-11-19T08:12:44+07:00",
                    "messageCount": 2 }
}
```

Contoh guardrail (HTTP tetap `200`):
```json
{
  "message": {
    "id": "m_a01…", "role": "assistant", "createdAt": "2026-11-19T08:20:10+07:00",
    "content": "Data yang tersedia hanya mencakup 1 Agustus–18 November 2026, sehingga total Desember 2026 tidak dapat dihitung.",
    "answer": "Saya tidak bisa menghitung Desember 2026: data berhenti pada 18 November 2026.",
    "keyFindings": [], "supportingTable": null, "visualizations": [],
    "sql": null, "sources": [],
    "followUps": ["Total transaksi November 2026", "Tren 3 bulan terakhir"],
    "meta": { "period": null, "partial": true, "rowCount": 0, "mode": "guardrail",
              "latencyMs": 4, "dataset": { "...": "..." } },
    "guardrail": { "type": "out_of_range",
                   "explanation": "Rentang data: 2026-08-01 s.d. 2026-11-18." }
  }
}
```

### 5.7 `POST /api/conversations/:id/messages/:msgId/report`

Body: `{ "title"?: string }` (maks 120 karakter). `201`:
```json
{ "report": { "id": "r_7c…", "title": "Total transaksi November 2026",
              "messageId": "m_9a2…", "conversationId": "c1f0…",
              "createdAt": "2026-11-19T08:15:00+07:00" } }
```
Snapshot `payload_json` dibekukan dari pesan; perubahan dataset tidak mengubah laporan (AC-06.2). `404` bila `msgId` bukan bagian percakapan atau bukan pesan assistant.

---

## 6. Investigations

### 6.1 `GET /api/investigations/overview`

Ringkasan untuk halaman `/investigations`:
```json
{
  "period": { "start": "2026-11-01", "end": "2026-11-18", "label": "1–18 Nov 2026",
              "isPartial": true, "dayCount": 18,
              "compare": { "start": "2026-10-01", "end": "2026-10-18",
                           "label": "1–18 Okt 2026", "strategy": "like_for_like" } },
  "failureRate": { "current": 4.91, "previous": 3.28, "deltaPctPoints": 1.63 },
  "topChannels": [
    { "channelName": "VA Mandiri", "failureRate": 16.17, "previousFailureRate": 6.03,
      "excessFailures": 119, "severity": "high" },
    { "channelName": "OVO", "failureRate": 9.29, "previousFailureRate": 3.24,
      "excessFailures": 56.8, "severity": "high" }
  ],
  "changePoints": [{ "channelName": "VA Mandiri", "date": "2026-10-15" },
                   { "channelName": "VA Mandiri", "date": "2026-11-03" },
                   { "channelName": "OVO", "date": "2026-11-06" }],
  "saved": 0
}
```

### 6.2 `POST /api/investigations/analyze`

Body:
```json
{ "question": "Mengapa tingkat kegagalan transaksi meningkat bulan ini?",
  "period": { "start": "2026-11-01", "end": "2026-11-18" },
  "compare": "like_for_like",
  "focus": { "channel": null, "category": null },
  "persist": true }
```
`201` (atau `200` bila `persist:false`):
```json
{
  "investigation": {
    "id": "inv_3d…",
    "question": "Mengapa tingkat kegagalan transaksi meningkat bulan ini?",
    "createdAt": "2026-11-19T09:00:00+07:00",
    "period": { "...": "..." },
    "comparison": {
      "failureRate": { "current": 4.91, "previous": 3.28, "deltaPctPoints": 1.63 },
      "total": { "current": 8125, "previous": 7410, "changePct": 9.65 }
    },
    "contribution": {
      "channels": [
        { "channelName": "VA Mandiri", "failureRate": 16.17, "baselineFailureRate": 2.12,
          "excessFailures": 119, "shareOfExcess": 0.58 },
        { "channelName": "OVO", "failureRate": 9.29, "baselineFailureRate": 3.08,
          "excessFailures": 56.8, "shareOfExcess": 0.28 }
      ],
      "failureCodes": [
        { "failureCode": "F04", "failureName": "BANK_TIMEOUT",
          "per1000": { "sep": 1.9, "oct": 6.9, "nov": 15.9 } },
        { "failureCode": "F05", "failureName": "GATEWAY_ERROR",
          "per1000": { "sep": 1.8, "oct": 2.5, "nov": 8.9 } }
      ]
    },
    "concentration": {
      "byChannelCategory": [
        { "channelName": "VA Mandiri", "category": "Tagihan & Utilitas", "failureRate": 16.6 },
        { "channelName": "OVO", "category": "Top-up Pulsa & Saldo", "failureRate": 23.5 }
      ],
      "byHour": [{ "channelName": "VA Mandiri", "bucket": "18:00–22:59",
                   "failureRate": 16.4 }]
    },
    "temporal": {
      "points": [
        { "channelName": "VA Mandiri", "date": "2026-10-15", "kind": "start" },
        { "channelName": "VA Mandiri", "date": "2026-11-03", "kind": "worsened" },
        { "channelName": "OVO", "date": "2026-11-06", "kind": "start" }
      ],
      "series": [{ "channelName": "VA Mandiri", "grain": "week",
                   "rows": [{ "bucket": "2026-10-12", "failureRate": 3.81 }] }],
      "notes": ["Minggu 16 Nov hanya 3 hari (parsial)."]
    },
    "documents": [{ "kind": "document", "sourceId": "src_incident",
                    "docTitle": "Catatan Insiden Okt–Nov 2026",
                    "section": "INC-2026-1015", "page": null,
                    "quote": "Rate limit endpoint v2 diterapkan bank pada 3 Nov…",
                    "score": 0.78 }],
    "conclusion": {
      "text": "Kenaikan failure rate tidak merata: indikasi terkuat pada VA Mandiri dan OVO…",
      "claimLevel": "indication",
      "caveats": ["Data hanya menunjukkan korelasi; sebab terbukti memerlukan pernyataan dokumen/insiden."]
    },
    "evidence": { "sql": ["SELECT ..."], "sourceIds": ["src_sop_trx_003", "src_incident"] }
  }
}
```
`claimLevel ∈ {'measured','indication','proven'}`; `proven` hanya bila ada kutipan dokumen yang menyatakan sebab (AC-05.4).

### 6.3 `GET /api/investigations/anomalies`

```json
{
  "items": [{
    "id": "an_01", "severity": "high", "kind": "channel_failure_spike",
    "channelName": "VA Mandiri", "metric": "failure_rate",
    "baseline": 6.03, "current": 16.17, "deltaPctPoints": 10.14,
    "detectedAt": "2026-11-03", "window": "2026-11-01..2026-11-18",
    "evidence": { "sql": "SELECT ..." }
  }],
  "total": 4
}
```
Aturan deteksi deterministik (tanpa ML): `delta ≥ 2` poin, atau `current ≥ 2 × baseline` dengan volume ≥ 50, atau perubahan volume kategori ≥ 10% vs like-for-like.

### 6.4 `GET /api/investigations?limit=20&offset=0`

```json
{ "items": [{ "id": "inv_3d…", "question": "…", "period": "2026-11-01..2026-11-18",
              "topChannel": "VA Mandiri", "claimLevel": "indication",
              "createdAt": "2026-11-19T09:00:00+07:00" }],
  "total": 1, "limit": 20, "offset": 0 }
```

### 6.5 `GET /api/investigations/:id`

`200` → `{ investigation }` (bentuk sama dengan 6.2, tanpa `persist`). `404` bila tidak ada.

---

## 7. Reports

### 7.1 `GET /api/reports?limit=20&offset=0`

```json
{ "items": [{ "id": "r_7c…", "title": "Total transaksi November 2026",
              "period": "2026-11-01..2026-11-18", "dataset": { "id": "seed", "name": "…" },
              "createdAt": "2026-11-19T08:15:00+07:00" }],
  "total": 1, "limit": 20, "offset": 0 }
```
Kosong → `items: []`; UI wajib empty state dengan tautan ke `/assistant` (AC-06.5).

### 7.2 `GET /api/reports/:id`

```json
{
  "report": {
    "id": "r_7c…", "title": "…", "createdAt": "2026-11-19T08:15:00+07:00",
    "dataset": { "...": "..." },
    "period": { "...": "..." },
    "question": "Berapa total transaksi pada bulan ini?",
    "summary": "…",
    "keyFindings": [{ "text": "…" }],
    "metrics": [{ "key": "total", "label": "Total Transaksi", "value": 8125,
                  "format": "number" }],
    "supportingTable": { "...": "..." },
    "visualizations": [{ "...": "..." }],
    "sources": [{ "...": "..." }],
    "sql": [{ "query": "SELECT …" }]
  }
}
```

### 7.3 `GET /api/reports/:id/export?format=csv|pdf`

| Format | Content-Type | Isi |
|---|---|---|
| `csv` | `text/csv; charset=utf-8` | `supportingTable` (atau `metrics` bila tabel null), UTF-8 BOM, delimiter `,`, desimal `.` |
| `pdf` | `application/pdf` | 1 kolom A4: judul, periode, dataset, ringkasan, key findings, tabel metrik, sitasi |

Header: `Content-Disposition: attachment; filename="tanyadata-<id>.<ext>"`.
`400 VALIDATION_ERROR` untuk format lain. Angka CSV/PDF identik dengan `7.2` (AC-06.4) — keduanya membaca `payload_json`, bukan query ulang.

---

## 8. Sources

### 8.1 `GET /api/sources?kind=dataset|document&status=READY`

```json
{
  "items": [{
    "id": "seed", "kind": "dataset", "name": "analytics.db — Transaksi",
    "format": "seed-dataset", "sizeBytes": 10788864, "status": "READY",
    "rowCount": 46952, "tableCount": 5, "chunkCount": null,
    "createdAt": "2026-11-19T00:00:00+07:00",
    "meta": { "minDate": "2026-08-01", "maxDate": "2026-11-18" }
  }, {
    "id": "src_sop", "kind": "document",
    "name": "SOP-TRX-003 Penanganan Transaksi Gagal",
    "format": "pdf", "sizeBytes": 9216, "status": "READY",
    "rowCount": null, "chunkCount": 9, "pageCount": 3,
    "createdAt": "2026-11-19T00:00:00+07:00"
  }],
  "total": 7,
  "counts": { "dataset": 1, "document": 6, "processing": 0, "failed": 0 }
}
```
7 sumber seed (AC-03.1): 1 dataset + 6 dokumen, semua `READY`.

### 8.2 `POST /api/sources` (multipart)

| Field | Tipe | Wajib | Aturan |
|---|---|---|---|
| `file` | binary | ya | ≤ 25 MB |
| `kind` | `dataset\|document` | ya | menentukan pipeline |
| `name` | string | tidak | default = nama file tanpa ekstensi |

Whitelist: `dataset` → `.csv`, `.xlsx`; `document` → `.pdf`, `.docx`, `.txt`, `.md`. Validasi MIME **dan** magic bytes (`.pdf` = `%PDF-`, `.xlsx/.docx` = ZIP `PK\x03\x04`). Nama file disanitasi (`[^a-zA-Z0-9._-]` → `_`), path traversal ditolak.

`202`:
```json
{ "source": { "id": "src_a1b2c3d4", "kind": "dataset", "name": "transaksi_q4",
              "format": "csv", "status": "PROCESSING", "sizeBytes": 1048576,
              "createdAt": "2026-11-19T09:30:00+07:00" },
  "job": { "id": "job_…", "status": "RUNNING", "step": "parsing", "progress": 10 } }
```
Status transisi: `UPLOADED → PROCESSING → READY|FAILED` (AC-03.2). Frontend melakukan polling `GET /api/sources/:id` setiap 1 s sampai terminal.

Error:
- `415 UNSUPPORTED_MEDIA_TYPE` — ekstensi/MIME di luar whitelist (`.exe`).
- `413 FILE_TOO_LARGE`.
- `422 UNPROCESSABLE_SOURCE` — CSV tanpa kolom wajib `transaction_date` & `status`; XLSX rusak; PDF tanpa text layer. `details: { reason: 'MISSING_COLUMNS', missing: ['status'] }`.

### 8.3 `GET /api/sources/:id`

Untuk dataset:
```json
{
  "source": { "id": "src_a1b2c3d4", "kind": "dataset", "status": "READY",
              "name": "transaksi_q4", "format": "csv", "sizeBytes": 1048576,
              "rowCount": 51234, "createdAt": "…", "updatedAt": "…" },
  "schema": { "tableName": "ds_ab12cd34ef56",
              "columns": [{ "name": "transaction_date", "type": "TEXT", "nullable": false },
                          { "name": "status", "type": "TEXT", "nullable": false },
                          { "name": "amount", "type": "REAL", "nullable": true }] },
  "quality": { "missingByColumn": { "amount": 12 }, "duplicateRows": 0,
               "rowsParsed": 51234, "rowsRejected": 0 },
  "bounds": { "minDate": "2026-01-01", "maxDate": "2026-06-30" },
  "active": false
}
```
Untuk dokumen:
```json
{
  "source": { "id": "src_sop", "kind": "document", "status": "READY",
              "name": "SOP-TRX-003 Penanganan Transaksi Gagal", "format": "pdf",
              "pageCount": 3, "chunkCount": 9, "sizeBytes": 9216 },
  "sections": [{ "no": 4, "title": "Prosedur Umum Penanganan Transaksi Gagal", "page": 1,
                 "chunkCount": 2 }],
  "index": { "indexed": true, "indexedAt": "2026-11-19T00:00:00+07:00",
             "engine": "fts5-bm25" },
  "job": null
}
```

`index.engine` adalah enum dokumenter: `fts5-bm25 | qdrant-bm25 | qdrant-hybrid` (DECISION-032 / ADR-QD-05).
Nilainya **mencerminkan engine yang benar-benar aktif**, bukan konfigurasi yang diharapkan:

| Nilai | Syarat |
|---|---|
| `fts5-bm25` | `QDRANT_MODE=off` atau `RETRIEVAL_MODE=fts5` (default). Jalur lama, tanpa Qdrant. |
| `qdrant-bm25` | Qdrant aktif (`RETRIEVAL_MODE=qdrant\|hybrid`) dan `EMBEDDING_PROVIDER=off`. Hanya BM25. |
| `qdrant-hybrid` | Qdrant aktif **dan** `EMBEDDING_PROVIDER=local` (dense dipakai). Tidak pernah diklaim bila dense mati. |

Perubahan ini bersifat **non-breaking**: bentuk respons tidak berubah, frontend hanya menampilkan string.
Dengan default aman (`QDRANT_MODE=off`, `RETRIEVAL_MODE=fts5`, `EMBEDDING_PROVIDER=off`) nilai yang
dikembalikan tetap `fts5-bm25`, identik dengan kontrak sebelum migrasi.

> **Catatan (DECISION-033, 2026-11-23):** default runtime **kini** `QDRANT_MODE=on`, `RETRIEVAL_MODE=hybrid`, `EMBEDDING_PROVIDER=local`. Tabel `index.engine` di atas tetap benar sebagai pemetaan per-nilai; frasa "default aman" pada paragraf ini adalah baseline DECISION-032 yang sudah digantikan. Lihat §9.3.1 untuk derivasi `capabilities.rag` yang efektif.

### 8.4 `GET /api/sources/:id/preview?limit=5`

```json
{ "columns": [{ "key": "transaction_id", "label": "transaction_id", "type": "TEXT" }],
  "rows": [{ "transaction_id": "TRX…", "transaction_date": "2026-11-01",
             "status": "SUCCESS", "amount": 125000 }],
  "rowCount": 46952, "limit": 5, "truncated": true }
```
`limit` 1..50. Untuk dokumen: `rows` = potongan chunk teratas, `columns` = `[{key:'section'},{key:'page'},{key:'quote'}]`.

### 8.5 `DELETE /api/sources/:id`

`204` — menghapus metadata, chunk, FTS row, tabel `ds_*`, file upload. Riwayat chat/report **tidak** dihapus (snapshot). `409 CONFLICT` bila `id` = dataset aktif atau job sedang `RUNNING`.

### 8.6 `POST /api/sources/:id/reindex`

`202` → `{ "job": { "id": "job_…", "status": "RUNNING", "step": "chunking", "progress": 0 } }`.
Dokumen: parse ulang dari `storage_path` → chunk → FTS. Dataset: hitung ulang row count, bounds, quality. `409` bila job lain berjalan.

> **Sinkronisasi turunan (non-blocking):** setelah reindex, outbox `qdrant_outbox` dikuras
> (`drainOutbox`). Qdrant adalah indeks turunan — kegagalan koneksi **tidak** menggagalkan
> reindex: baris ditandai retry/tombstone dan FTS5 tetap menjadi sumber jawaban. Kontrak
> respons tidak berubah; `index.engine` tetap melaporkan engine faktual (§8.4).

---

## 9. Settings & meta

### 9.1 `GET /api/settings`

```json
{
  "profile": { "name": "Analyst", "role": "Operations" },
  "lang": "id",
  "dateRange": { "start": "2026-11-01", "end": "2026-11-18", "preset": "this_month" },
  "activeDatasetId": "seed",
  "preferences": { "chartDefault": "bar", "denseTables": true },
  "datasets": [{ "id": "seed", "name": "analytics.db — Transaksi", "rowCount": 46952 }],
  "updatedAt": "2026-11-19T08:00:00+07:00"
}
```

> **Status `preferences` (verdict P6-UI-HONESTY, lihat `docs/SYSTEM_OVERVIEW.md` §7):**
> `preferences.chartDefault` dan `preferences.denseTables` **tersimpan tetapi tidak dikonsumsi perilaku apa pun** (tidak ada pembaca di `lib/core`, `lib/ai`, dashboard, chart, atau tabel). Konsumen yang ada hanya: `lib/settings.ts:17,43,54,109-115`, `lib/contracts/http.ts:609`, `lib/api/schemas.ts:75-76`, seed `lib/db/migrate.ts:52` + `scripts/init-workspace-db.mjs:130`, dan form `app/(workspace)/settings/page.tsx:123-133,172,210,415,473`.
> **Rekomendasi: hapus total sebagai satu perubahan terkoordinasi** (bukan hapus field kontrak saja — itu memecahkan typecheck). Menyambungkan `chartDefault` bertabrakan dengan `buildVizSpec` yang deterministik. Detail + daftar file ada di SYSTEM_OVERVIEW §7.

### 9.2 `PUT /api/settings`

Body parsial (semua opsional, minimal satu field):
```json
{ "lang": "en",
  "dateRange": { "start": "2026-09-01", "end": "2026-11-18" },
  "activeDatasetId": "seed",
  "profile": { "name": "Analyst", "role": "Operations" } }
```
`200` → objek sama dengan `9.1`.
Validasi: `lang ∈ {id,en}`; `start ≤ end` dan dalam bounds dataset aktif; `activeDatasetId` harus `READY`. Perubahan `lang` mengubah seluruh label server pada request berikutnya (AC-07.1). Perubahan `activeDatasetId` berlaku untuk dashboard, chat baru, dan investigasi (AC-07.3); percakapan lama tetap memakai `dataset_id`-nya.

### 9.3 `GET /api/meta`

```json
{
  "app": { "name": "TanyaData", "version": "1.0.0", "build": "local" },
  "data": {
    "activeDataset": { "id": "seed", "name": "analytics.db — Transaksi", "kind": "seed",
                       "rowCount": 46952, "minDate": "2026-08-01",
                       "maxDate": "2026-11-18", "tables": 5 },
    "periodDefaults": { "start": "2026-11-01", "end": "2026-11-18",
                        "label": "1–18 Nov 2026", "isPartial": true },
    "documents": { "total": 6, "indexed": 6, "chunks": 41 },
    "datasetChoices": [{ "id": "seed", "name": "analytics.db — Transaksi", "rowCount": 46952 }]
  },
  "capabilities": { "llm": false, "llmMode": "off", "rag": "fts5", "sql": "sqlite" },
  "generatedAt": "2026-11-19T08:00:00+07:00"
}
```
`capabilities.llm` hanya boolean — tidak pernah membocorkan URL/model/kunci.

#### 9.3.1 `GET /api/meta` — payload `system` (P6-UI-HONESTY, aditif, DECISION-035)
Field lama TIDAK berubah. Field baru `system?` mengisi tab Tentang:

```ts
export type SystemStackItem = { name: string; version: string; role: string;
  stage: 'platform'|'ingest'|'retrieval'|'compose'|'output'; required: boolean };
export type SystemPipelineStage = { id: 'ingest'|'retrieval'|'compose'|'output';
  label: string; summary: string; inputs: string[]; outputs: string[]; fallback?: string };
export type SystemRuntime = {
  retrievalMode: 'fts5'|'qdrant'|'hybrid';        // TERKONFIGURASI (getRetrievalMode)
  effectiveRetrieval: 'fts5'|'qdrant'|'hybrid';   // EFEKTIF (yang benar-benar dipakai)
  qdrantMode: 'off'|'on'|'local'|'required';
  qdrantConfigured: boolean;      // false bila QDRANT_URL kosong (beda dari mode off)
  qdrantReachable: boolean|null;  // null = tidak relevan (off/tak dikonfigurasi)
  embeddingProvider: 'off'|'local';
  llm: { enabled: boolean; mode: 'off'|'assist'|'full' };
  ocrEnabled: boolean;
  seedProfile: string;            // 'none' | 'demo'
  fallbackReason: string|null;    // alasan fallback/circuit terakhir, jujur
};
export type MetaSystemPayload = { stack: SystemStackItem[]; pipeline: SystemPipelineStage[];
  runtime: SystemRuntime; limits: { id: string; label: string; detail: string }[] };
MetaResponse += system?: MetaSystemPayload
```

**Aturan derivasi (deterministik, wajib):**
- `retrievalMode` = `getRetrievalMode()` (`lib/ai/retrieval.ts:1167-1170`): env `hybrid|qdrant` diterima, selain itu `fts5`. Ini nilai **terkonfigurasi**.
- `qdrantMode` = parse `QDRANT_MODE` (`lib/qdrant/client.ts:96-102`): `on|local|required` diterima, selain itu `off`.
- `qdrantConfigured` = `Boolean(QDRANT_URL)`; `off` dan "URL kosong" adalah dua kondisi berbeda dan tidak boleh dilebur.
- `qdrantReachable` = `null` bila mode `off` **atau** `qdrantConfigured=false`; else `qdrantHealth().ready` (`client.ts:198-245`) dengan timeout — jangan pernah menebak.
- `effectiveRetrieval` = `'fts5'` bila `getQdrantConfig()` mengembalikan `null` (`lib/ai/hybrid.ts:124-140`: mode off **atau** URL kosong) **atau** `retrievalMode==='fts5'`; selain itu `retrievalMode`. Inilah backend yang benar-benar dipakai (`lib/ai/adapter.ts:511-523`).
- **Divergensi default `QDRANT_MODE` (wajib ditangani):** `lib/qdrant/client.ts:96-102` memperlakukan kosong = `on`, sedangkan `lib/ai/hybrid.ts:124-128` memperlakukan kosong = `off`. Payload wajib memakai `effectiveRetrieval` untuk klaim perilaku; backend sebaiknya menyatukan kedua helper atau selalu mensyaratkan `QDRANT_MODE` eksplisit.
- `embeddingProvider` = `getEmbeddingConfig().provider` (`lib/ai/embedding.ts:68-70`).
- `llm` = `{ enabled: llmAvailable(), mode: llmMode() }` (`lib/ai/llm.ts:26-35`).
- `ocrEnabled` = `OCR_ENABLED==='true' && OCR_ENDPOINT` terisi (`lib/ingest/ocr.ts:130-133`).
- `seedProfile` = env `SEED_PROFILE` ∈ {none,demo}, selain itu `none` (fail-closed).
- `fallbackReason` = `qdrant_circuit_open` bila circuit terbuka (`lib/ai/hybrid.ts:148-155`); else alasan fallback retrieval **terakhir yang diamati in-process** (diisi backend di sekitar `lib/ai/adapter.ts:523` dari `dispatch.meta.fallbackReason`); else `null`. Backend wajib menyimpan nilai terakhir di variabel modul — jangan mengarang.
- `stack`: nilainya WAJIB berasal dari `package.json` (generate saat build atau konstanta server + test kesetaraan), bukan angka hafalan.
- **`capabilities.rag` LAMA (`lib/meta.ts:50` paku `'fts5'`) WAJIB diturunkan dari env + status, bukan string mati.** Aturan deterministik: `capabilities.rag = system.runtime.effectiveRetrieval`.
  - Qdrant hidup → `'hybrid'` (default) atau `'qdrant'`.
  - **Qdrant mati / tak terjangkau / circuit terbuka → `capabilities.rag = 'fts5'`** (backend efektif), dengan `system.runtime.qdrantReachable=false` + `fallbackReason` (mis. `qdrant_unavailable`). Ini yang dialami pengguna, jadi ini yang dilaporkan — bukan mode yang cuma terkonfigurasi.
  - Nilai **terkonfigurasi** tetap tersedia di `system.runtime.retrievalMode` untuk audit.
  - `capabilities.sql` tetap `'sqlite'` (benar, tidak perlu diturunkan dari env).

**Contoh respons:**
```json
{ "app": { "name": "TanyaData", "version": "1.0.0", "build": "local" },
  "data": { ... },
  "capabilities": { "llm": false, "llmMode": "off", "rag": "fts5", "sql": "sqlite" },
  "generatedAt": "2026-11-24T08:00:00+07:00",
  "system": {
    "stack": [
      { "name": "next", "version": "16.4.6", "role": "App Router / satu-proses", "stage": "platform", "required": true },
      { "name": "react", "version": "19.3.1", "role": "UI runtime", "stage": "platform", "required": true },
      { "name": "better-sqlite3", "version": "13.2.0", "role": "SQLite + FTS5 source of truth", "stage": "platform", "required": true },
      { "name": "SQLite FTS5", "version": "bawaan", "role": "BM25 jalur default + fallback", "stage": "retrieval", "required": true },
      { "name": "@qdrant/js-client-rest", "version": "1.20.0", "role": "secondary index BM25 + dense", "stage": "retrieval", "required": false },
      { "name": "@huggingface/transformers", "version": "4.3.2", "role": "embedding lokal e5-small 384d q8", "stage": "retrieval", "required": false },
      { "name": "unpdf", "version": "2.2.1", "role": "ekstraksi teks PDF sadar-layout", "stage": "ingest", "required": true },
      { "name": "mammoth", "version": "1.13.0", "role": "ekstraksi DOCX", "stage": "ingest", "required": true },
      { "name": "recharts", "version": "3.11.0", "role": "visualisasi deterministik", "stage": "output", "required": true }
    ],
    "pipeline": [
      { "id": "ingest", "label": "Ingest", "summary": "Unggah file ≤25 MB → ekstraksi teks + chunk → indeks FTS5 (selalu) + Qdrant opsional + outbox.",
        "inputs": ["file CSV/XLSX/SQLite/PDF/DOCX/TXT/MD"], "outputs": ["dataset READY + fragment terindeks + quality_report"] },
      { "id": "retrieval", "label": "Retrieval", "summary": "Pertanyaan → guardrail → kandidat SQL (opsional LLM + fallback rule) → kandidat dokumen (FTS5 + Qdrant BM25 + dense, RRF) → rerank + excerpt.",
        "inputs": ["pertanyaan natural + scope dataset"], "outputs": ["citations tervalidasi + meta.retrievalBackend + fallbackReason"] },
      { "id": "compose", "label": "Compose", "summary": "Draft deterministik + marker sitasi [n] → LLM opsional sebagai fallback penutup hanya bila sinyal rendah → angka divalidasi vs bukti → sanitasi anti-slop/mojibake.",
        "inputs": ["hasil SQL + citations"], "outputs": ["jawaban final + vizSpec + citations + meta fallback"] },
      { "id": "output", "label": "Keluaran", "summary": "Jawaban yang dirender sebagai chart (recharts) + tabel + sitasi; laporan CSV/PDF; share snapshot read-only ber-TTL.",
        "inputs": ["objek Query lengkap"], "outputs": ["chat answer + chart + laporan + share link"] }
    ],
    "runtime": {
      "retrievalMode": "hybrid",
      "effectiveRetrieval": "fts5",
      "qdrantMode": "on",
      "qdrantConfigured": false,
      "qdrantReachable": null,
      "embeddingProvider": "local",
      "llm": { "enabled": false, "mode": "off" },
      "ocrEnabled": false,
      "seedProfile": "none",
      "fallbackReason": "qdrant_unavailable"
    },
    "limits": [
      { "id": "no_auth", "label": "Tanpa auth/multi-tenant", "detail": "Single workspace lokal; guard token opsional PUBLIC_DEPLOY/API_ACCESS_TOKEN (.env.example:35-39)." },
      { "id": "precision_target", "label": "Target presisi KB-GT belum tercapai", "detail": "Holdout 0,8571 (target 0,99); dev 0,5915. Lihat docs/STATE.json kb_ground_truth." },
      { "id": "kb_ocr_gap", "label": "KB01/KB04 masih pakai transkrip GT", "detail": "OCR PP-OCRv6 tiny belum dijalankan di VPS; korpus memakai gt_transcript, bukan OCR asli." },
      { "id": "qdrant_dev", "label": "Qdrant belum dijalankan di mesin dev", "detail": "Circuit breaker terverifikasi; fallback FTS5 deterministik." },
      { "id": "dashboard_range", "label": "Dashboard belum konsumsi dateRange settings", "detail": "Dipaku 'this_month' (lib/api/dashboard.ts:36-47); ditunda ke SET-01." },
      { "id": "no_streaming", "label": "Tanpa streaming/real-time", "detail": "Satu respons JSON per pesan (ARCHITECTURE C-10)." },
      { "id": "vercel_ephemeral", "label": "State workspace lokal bisa hilang di Vercel", "detail": "Cold start menghapus workspace writable (DECISION-002 konsekuensi 3)." }
    ]
  } }
```

> **Catatan contoh:** contoh di atas menggambarkan kondisi jujur di mesin dev — `RETRIEVAL_MODE=hybrid` **terkonfigurasi**, tetapi Qdrant belum dikonfigurasi (`qdrantConfigured=false`), sehingga backend **efektif** `fts5` dan `capabilities.rag='fts5'` dengan `fallbackReason='qdrant_unavailable'`. Saat Qdrant hidup, `effectiveRetrieval` dan `rag` menjadi `hybrid`/`qdrant` dan `fallbackReason` menjadi `null`.

---

## 10. Kontrak guardrail & read-only

### 10.1 Guardrail (selalu `200`, bukan error)

| `guardrail.type` | Pemicu | Perilaku wajib |
|---|---|---|
| `out_of_range` | periode di luar `minDate..maxDate` | sebut rentang data; `sql=null`; tanpa angka metrik |
| `not_in_sources` | pertanyaan di luar dataset & dokumen (CEO, cuaca) | nyatakan tidak ada di sumber; tawarkan topik valid |
| `destructive` | `hapus`, `delete`, `drop`, `truncate`, `update`, `insert` | tolak; sebut akses hanya-baca; **tidak ada eksekusi** |
| `pii` | email/telepon/NIK/nama pelanggan | nyatakan dataset tidak memuat PII; tidak menebak |
| `ambiguous` | metrik tidak jelas ("kanal terbaik") | tawarkan 2–3 metrik + asumsi default; `assumed=true` |
| `unsupported` | di luar cakupan produk | jelaskan batas + saran |

`guardrail` tidak boleh disertai `supportingTable` berisi angka hasil karangan. Bila klarifikasi dijawab user, pesan berikutnya kembali ke `mode` analitik normal.

### 10.2 Aturan read-only

1. Tidak ada endpoint yang menjalankan SQL dari klien. Tidak ada `POST /api/query`.
2. `analytics.db` dibuka `readonly: true` + `PRAGMA query_only=1` pada koneksi eksekutor SQL.
3. `DELETE /api/sources/:id` hanya menghapus metadata/chunk/tabel upload — bukan baris seed.
4. `PUT /api/settings` tidak mengubah data transaksi.
5. `sql` pada respons chat bersifat **output** dan hanya berisi `SELECT`/`WITH` yang lolos validator.
6. Semua mutasi memakai transaksi SQLite pendek (`BEGIN IMMEDIATE` … `COMMIT`) dengan `busy_timeout=5000`.

### 10.3 Urutan & konsistensi

- `POST /messages` menulis `messages` (user), `messages` (assistant), dan `query_log` dalam satu transaksi. Bila composer gagal, pesan user tetap tersimpan dengan `system` note agar tidak ada kehilangan input.
- `POST /report` membaca `messages.payload_json` apa adanya; tidak menghitung ulang.
- `seq` pesan dibuat dari `MAX(seq)+1` di dalam transaksi yang sama (tidak ada duplikat).

---

## 11. Traceability requirement

| Endpoint | Requirement | Acceptance |
|---|---|---|
| `/api/dashboard/*` | FR-01, AI-03 | AC-01.1..6 |
| `/api/conversations/*`, `/messages` | FR-02, AI-01..07 | AC-02.1..7, AC-AI-01..09 |
| `/api/sources` (GET/POST/DELETE), `/preview` | FR-03, NFR-06 | AC-03.1..6 |
| `/api/sources/:id` (dokumen), `/reindex` | FR-04 | AC-04.1..5 |
| `/api/investigations/*` | FR-05 | AC-05.1..5 |
| `/api/reports/*` | FR-06 | AC-06.1..5 |
| `/api/settings`, `/api/meta` | FR-07, NFR-10 | AC-07.1..5 |
| seluruh endpoint | NFR-04 (read-only), NFR-07 (error manusiawi), NFR-09 (traceability) | F3-3, F3-7 |

---

## 12. Contoh error

```json
{ "error": { "code": "VALIDATION_ERROR",
             "message": "Parameter 'end' tidak valid.",
             "details": [{ "field": "end", "issue": "harus >= start (2026-11-18)" }] } }
```

```json
{ "error": { "code": "UNPROCESSABLE_SOURCE",
             "message": "File tidak dapat diproses: kolom wajib 'status' tidak ditemukan.",
             "details": { "reason": "MISSING_COLUMNS", "missing": ["status"] } } }
```

```json
{ "error": { "code": "CONFLICT",
             "message": "Dataset ini sedang aktif dan tidak dapat dihapus. Pilih dataset lain di Settings terlebih dahulu." } }
```

Pesan error mengikuti `lang`: `id` default, `en` bila diminta. `code` selalu bahasa Inggris (stabil untuk frontend).

---

## 13. CORE V2 — kontrak aditif (P3-CORE-V2)

Bersifat **aditif**: endpoint lama tidak berubah. Sumber: `docs/CORE_V2_ARCHITECTURE.md` §5, `docs/CORE_V2_SPEC.md` FR-A..E, DECISION-016. Konvensi error §1.1 tetap berlaku. Semua endpoint baru `runtime=nodejs`, `dynamic=force-dynamic`, `Cache-Control: no-store`.

### 13.1 Peta endpoint baru

| Method | Path | Handler | FR/AC | Catatan |
|---|---|---|---|---|
| GET | `/api/attachments` | `core.attachment.list` | FR-C.1–2 | Daftar attachment scope; filter `datasetId`, `status` |
| POST | `/api/attachments` | `core.attachment.create` | FR-C.1–2 | Daftarkan dataset sebagai attachment; `201` |
| GET | `/api/attachments/:id` | `core.attachment.detail` | FR-C.2.3 | Gate `READY`; `422` bila belum READY |
| POST | `/api/reports` | `core.report.create` | FR-B.3–4 | Buat `ReportJob` PDF/XLSX dari `result_json`; `201` |
| GET | `/api/reports/jobs/:id` | `core.report.job` | FR-B.3 | Status + `downloadUrl` |
| GET | `/api/share` | `core.share.list` | FR-E.4 | Daftar snapshot (tanpa payload penuh) |
| POST | `/api/share` | `core.share.create` | FR-E.3 | Butuh `confirmed:true`; `201` |
| GET | `/api/share/:id` | `core.share.resolve` | FR-E.1–2, E.4 | **Publik, tanpa login**, read-only; `X-Robots-Tag: noindex, nofollow` |
| DELETE | `/api/share/:id` | `core.share.revoke` | P6-FIX / SEC-002 | Cabut link (idempoten); `200` + `{ share: { id, revokedAt, revokedReason } }` |

### 13.2 `GET /api/attachments?datasetId=&status=&limit=&offset=`

```json
{ "items": [{ "id": "att_…", "datasetId": "ds_…", "sourceId": "src_…", "name": "Laporan Q3",
              "docType": "financial", "status": "READY", "activeInConversation": "c_…" | null,
              "qualityReportRef": "ds_…", "createdAt": "…" }],
  "total": 1, "limit": 50, "offset": 0 }
```

### 13.3 `POST /api/attachments`

Body: `{ "datasetId": string, "sourceId"?: string, "name"?: string, "activeInConversation"?: string }`.
`datasetId` wajib dan harus ada. `201` → `{ "attachment": {…} }`. Idempoten pada `(datasetId, sourceId)`.

### 13.4 `POST /api/reports`

Body:
```json
{ "queryId": "q_…", "conversationId": "c_…", "format": "pdf" | "xlsx",
  "docType": "financial" | "legal" | "technical_report" | "general" }
```
`queryId` wajib dan harus ada; `format` wajib. Angka **hanya** dari `core_queries.result_json` — tidak ada query ulang, tidak ada OCR ulang. Row cap 500. `201`:
```json
{ "job": { "id": "rj_…", "queryId": "q_…", "format": "pdf", "status": "DONE",
           "downloadUrl": "/api/reports/jobs/rj_…/download", "rowCap": 500, "createdAt": "…" } }
```
`status = QUEUED|DONE|FAILED`. 0 baris → teks "tidak ada baris yang memenuhi", **bukan** `0`. Identitas mengikuti `docType` (legal = pasal/ayat + kutipan tanpa chart; technical_report = parameter + satuan + halaman; financial = metrik + mata uang + periode).

### 13.5 `GET /api/reports/jobs/:id` dan `GET /api/reports/jobs/:id/download`

`download` mengembalikan `application/pdf` atau `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` dengan `Content-Disposition: attachment`. Excel ≥ 1 sheet + chart native yang merujuk sheet yang sama. PDF memuat narasi + chart primitif dari data yang sudah dihitung.

### 13.6 `POST /api/share`

Body:
```json
{ "conversationId": "c_…", "confirmed": true,
  "options": { "includeCitations": true, "includeIdentity": true } }
```
`confirmed` wajib `true` — tanpa itu `400 VALIDATION_ERROR` dan **tidak ada snapshot yang dibuat** (AC-E.3.2). Batas snapshot: ≤ 2 MB payload, ≤ 50 pesan, ≤ 500 baris per `result_json`, ≤ 20 sitasi. Kuota total 200 MB; penuh → `409 CONFLICT` dengan pesan jujur, link lama tidak dihapus. `201`:
```json
{ "share": { "id": "sh_<token>", "url": "/share/sh_<token>", "byteSize": 18432,
             "messageCount": 4, "createdAt": "…" } }
```
Token stabil, bukan `query_id`. Snapshot mandiri: tetap terbaca setelah attachment dihapus. Link bersifat **bearer** — konfirmasi + peringatan PII wajib. Respons `share` juga memuat `expiresAt` (ISO +07:00, default 30 hari, env `SHARE_TTL_DAYS`).

**P6-FIX / SEC-002:** `DELETE /api/share/:id` mencabut link (idempoten). `GET /api/share/:id` menolak snapshot yang expired/revoked dengan `404 NOT_FOUND` berpesan seragam. Halaman `/share/[id]` dan response API mengirim `X-Robots-Tag: noindex, nofollow`. Endpoint revoke **belum** dilindungi auth in-app — lihat §14 dan SEC-001 sebelum eksposur publik.

### 13.7 `GET /api/share/:id`

Tanpa autentikasi. `200` — bentuk **flat** agar cocok dengan normalizer `lib/ui/share-contract.ts`:
```json
{ "id": "sh_…", "createdAt": "…", "options": { "includeCitations": true, "includeIdentity": true },
  "payload": { "title": "…", "summary": "…", "identity": {…},
               "messages": [{ "id": "…", "role": "assistant", "createdAt": "…",
                              "question": null, "answer": "…", "outputs": […],
                              "citations": […], "guardrail": null, "meta": {…} }],
               "generatedAt": "…" } }
```
`outputs` memuat `visualizations` + `supportingTable` dari `result_json` (row cap 500). `citations` diambil dari `sources` pesan; bila `includeCitations=false`, array kosong. `identity` null bila `includeIdentity=false`. Read-only: tidak ada mutasi saat GET, tidak ada input chat. `404` bila token tidak ada, expired, atau dicabut (pesan seragam — tidak membedakan ketiganya). Respons menyertakan `expiresAt` dan header `X-Robots-Tag: noindex, nofollow`.

### 13.8 Sitasi deep-link (format + validasi)

Format: `docId#page=3&pageEnd=4&section=Pasal%2033%2FAyat%20(1)&chunk=chk_7f2a&rev=a1b2c3d4`.
`docId` = `source_id` stabil; `page` 1-indexed; `pageEnd` hanya untuk hasil stitch; `chunk` = child chunk id; `rev` = prefix SHA-256 konten. Validasi fail-closed 8 langkah (RAG_ROBUSTNESS_RESEARCH §7): doc READY → chunk ada & `parse_ok` & bukan `ocr_skipped` → halaman valid → `section_path` cocok → `rev` cocok → `quote` substring → skema URL internal/https → model hanya alias `[n]`. Gagal satu saja → sitasi dibuang, jawaban turun ke `evidence_limited`.

### 13.9 Perubahan skema (aditif, idempoten, reversible)

- `core_chunks` + `content_hash`, `page_span` (JSON `[start,end]`), `clean_version`, `clean_flags` (JSON array), `ocr_status`, `confidence`.
- `core_citations` + `page_end`, `rev`, `deep_link`, `status`.
- Tabel baru: `core_attachments`, `core_readjustment_ops` (append-only), `core_report_jobs`, `core_share_snapshots`, `core_citation_deeplinks`.
- Semua kolom baru punya DEFAULT → aman untuk DB lama; `DROP COLUMN`/`DROP TABLE` = rollback.

---

## 14. P6-FIX — lapis transport & keamanan (aditif)

Bagian ini menambahkan **lapis transport** di atas kontrak yang sudah mengikat. Tidak ada bentuk respons endpoint lama yang diubah (kecuali penambahan field opsional `expiresAt` pada share). Sumber: `docs/SECURITY_REPORT.md`, `docs/ARCHITECTURE_SPLIT_DEPLOY.md`, `docs/BACKEND_FIX_REPORT.md`.

### 14.1 Rate limiting (B2 / SEC-005)

| Endpoint | Policy | Kuota |
|---|---|---|
| `POST /api/query` | `query` | 10 req/menit per-IP |
| `/api/share`, `/api/share/:id` | `share` | 30 req/menit per-IP |
| `GET /api/reports/:id/export` | `export` | 10 req/menit per-IP |

Limiter in-process (token bucket) per proses. Kembalikan `429 RATE_LIMITED` + `Retry-After` (detik) + header `RateLimit-*`. Untuk multi-instance/VPS cluster, ganti penyimpanan bucket dengan Redis — **belum** diimplementasi.

### 14.2 CORS & preflight (SP-3 / DECISION-029)

Backend VPS menerima request lintas origin dari frontend Vercel:

| Header | Nilai |
|---|---|
| `Access-Control-Allow-Origin` | origin eksplisit dari `CORS_ALLOWED_ORIGINS` (fallback `APP_ORIGIN`); **bukan `*`** |
| `Vary` | `Origin` |
| `Access-Control-Allow-Methods` | `GET, POST, PUT, DELETE, OPTIONS` |
| `Access-Control-Allow-Headers` | `content-type, authorization, x-request-id` |
| `Access-Control-Expose-Headers` | `content-disposition` |
| `Access-Control-Max-Age` | `600` |

`OPTIONS /api/**` → `204` dengan header di atas bila origin terdaftar; tanpa `Access-Control-Allow-Credentials`. Origin tidak terdaftar → `204` tanpa header allow (browser memblokir). Env dibaca saat build; rebuild diperlukan setelah mengubah allow-list.

> **Follow-up SP-4 (belum dikerjakan):** 34 pemanggilan `fetch('/api/...')` di frontend masih relatif dan belum memakai `NEXT_PUBLIC_API_BASE_URL`. Ini bukan perubahan kontrak payload, melainkan pekerjaan frontend terpisah.

### 14.3 Guard deploy publik (SEC-001)

Bila `PUBLIC_DEPLOY` bernilai benar (`1|true|yes|on`) dan `API_ACCESS_TOKEN` kosong, **semua** endpoint API ditolak dengan `503 PUBLIC_DEPLOY_BLOCKED` + banner fatal di log server. Bila token terkonfigurasi, request diproses; verifikasi token penuh (bearer + tenancy) masih menjadi utang ADR-SD-02 dan wajib sebelum eksposur publik nyata.

### 14.4 Ekspor PDF (SEC-003 / V-3)

Origin navigasi headless browser **hanya** berasal dari `APP_ORIGIN` (allow-list tervalidasi, `https` di produksi). Header `Host`, `x-forwarded-host`, dan `x-forwarded-proto` **tidak pernah** dipakai. `--no-sandbox` dimatikan secara default; hanya diaktifkan lewat `PDF_BROWSER_NO_SANDBOX=1` pada container VPS terpercaya. `APP_ORIGIN` tidak valid → ekspor PDF gagal (fail-closed), bukan jatuh ke header klien.

### 14.5 Sanitasi error & log (B8 / B10 / SEC-006)

- `AppError.details` disanitasi (field `stack`/`stderr`/`cause`/path dibuang) sebelum dikirim ke klien.
- Error tak terduga dicatat tanpa stack trace dan sudah diredaksi (email, angka panjang, bearer token, secret, path absolut).
- Pesan error yang disimpan ke `data_sources.error` / `ingestion_jobs.error` juga disanitasi sebelum tampil di `GET /api/sources/:id`.
