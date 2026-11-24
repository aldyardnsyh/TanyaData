# QDRANT_AI_DESIGN — Desain Pipeline Retrieval Qdrant + Embedding Lokal

- Tanggal: 2026-11-23
- Role: `aiml` · Fase: **P3-MIGRATION** (turunan DECISION-031)
- Root: `D:\Riset Pribadi\AI-Powered Data Analytics Chatbot` · app `tanyadata\`
- Mode: **riset & desain saja**. Tidak ada kode yang diubah, tidak ada build/dev server, tidak ada evaluasi yang dijalankan pada sesi ini.
- Konvensi angka: angka yang **belum diukur di mesin ini** ditandai `ESTIMASI`. Angka dari model card / dokumentasi resmi disebut sebagai sumber eksternal, bukan hasil eval lokal.

---

## 0. Pertanyaan pertama: apakah ini benar-benar butuh AI?

**Jawaban jujur: sebagian besar tidak.**

Bukti lokal: pipeline FTS5 + stem + sinonim + entity reranker saat ini **PASS di semua suite** (`docs/QA_CRITICAL_VERIFICATION.md`: 12 legacy + 2 realSeed + 11 capability + 6 perpres; `hallucination_rate = 0`). Kasus legal (`Pasal 33`, `Pasal 31 Ayat (1)`), lookup kode (`F04`, `INC-…`), dan SOP definisi adalah **operasi filter deterministik**, bukan generasi semantik. `retrieveLegalSection`, `rerankCitations`, dan `validateCitationDeepLink` sudah menyelesaikannya tanpa model.

Rekomendasi saya sebagai aiml:

1. **Jangan mengganti FTS5.** Tambahkan dense retrieval sebagai *kandidat tambahan* di jalur hybrid.
2. **Jangan menurunkan ambang** (`ANSWERABILITY_THRESHOLD = 0.45`, `CODE_LOOKUP_THRESHOLD = 0.25`, `STRONG_CITATION_SCORE = 0.18`, `output.ts::STRONG_SCORE = 0.60`). Hybrid harus **membuktikan** peningkatan di retrieval benchmark sebelum diaktifkan sebagai default.
3. Jika benchmark tidak menunjukkan perbaikan yang terukur, **tetap pakai FTS5** dan simpan Qdrant sebagai opsi opt-in. Ini bukan kegagalan migrasi; ini hasil evaluasi.

DECISION-031 meminta riset sebelum implementasi — dokumen ini adalah hasil riset itu, bukan rekomendasi "migrasi karena teknologi baru".

---

## 1. Arsitektur pipeline (target, belum diimplementasikan)

```
                    ┌──────────────────────────────────────────────┐
                    │ SQLite (source of truth, DECISION-031)       │
                    │ core_chunks / core_documents / core_queries  │
                    └───────────────┬──────────────────────────────┘
                                    │ chunk child (level='child')
                                    ▼
        ┌───────────────────────────────────────────────────────────┐
        │ INDEXER (baru, backend+aiml)                              │
        │  contentHash dedup → text_fts (normalizeForFts)           │
        │  → embed local (e5-small, prefix "passage: ")             │
        │  → Qdrant upsert (id = core_chunks.id)                    │
        └───────────────┬───────────────────────────────────────────┘
                        ▼
        ┌───────────────────────────────────────────────────────────┐
        │ QDRANT COLLECTION tanyadata_chunks_v1                     │
        │  named vector "dense" (384, cosine)                       │
        │  payload text index "text_fts" (BM25, scoring=true)       │
        │  payload indexes: dataset_id, document_id, section_path,  │
        │    doc_type, level, parse_ok, page, rev, embedding_model  │
        └───────────────┬───────────────────────────────────────────┘
                        ▼
 QUERY ─► guardrail scope (guardrails.ts, unchanged)
       ─► extractRetrievalEntities (retrieval.ts, unchanged)
       ─► [legal Pasal N eksplisit] ─► retrieveLegalSection (deterministik, lewati Qdrant)
       ─► embed query (prefix "query: ", lokal)
       ─► dense top-20  ┐
       ─► BM25 top-20   ┴─► RRF di aplikasi (pure function) ─► top-20
       ─► rerankCitations + metadataBoost (sudah ada)
       ─► small-to-big parent dedup (sudah ada)
       ─► validateCitationDeepLink fail-closed (sudah ada)
       ─► buildContextBundle (50/25/15/10, sudah ada)
       ─► guardrail answerability (ambang TIDAK diturunkan)
                        ▼
                    JAWABAN + SITASI
```

Prinsip: **Qdrant hanya menggantikan tahap kandidat retrieval**. Guardrail, reranker, deep-link validation, context budget, dan composer tetap milik kode yang sudah ada dan sudah lulus eval.

---

## 2. Pilihan embedding

### 2.1 Jalur utama yang direkomendasikan

**`@huggingface/transformers` (transformers.js) + `intfloat/multilingual-e5-small`, ONNX quantized `q8`, berjalan di Node 22 dengan `onnxruntime-node`.**

Alasan:

- **Tanpa API key, tanpa jaringan saat inferensi** (model diunduh sekali saat provisioning, lalu `env.allowRemoteModels = false` + `env.localModelPath`). Sesuai DECISION-031 dan mode `LLM_MODE=off` pada eval.
- Bahasa Indonesia **terdaftar eksplisit** di model card; MTEB `MassiveIntentClassification (id)` = 64.17% (angka model card, bukan eval lokal).
- Dimensi **384** → indeks Qdrant ringan, cocok untuk VPS 2 GB (batas RSS ingest 1,2 GB di `ingest.ts`).
- Lisensi **MIT** (model) + **Apache-2.0** (library) — aman untuk produk.
- Paket npm `@huggingface/transformers@4.3.2` memiliki `exports.node` eksplisit (`transformers.node.mjs` / `.cjs`) dan dependency `onnxruntime-node@1.30.0` → kompatibel dengan Node 22 (perlu diverifikasi sekali saat spike, lihat §9).
- Prefix `passage: ` / `query: ` wajib untuk keluarga E5 dan sudah didukung pipeline ini.

### 2.2 Perbandingan yang dipertimbangkan

| Opsi | Dimensi | Max token | Ukuran unduhan | RAM puncak (ESTIMASI) | Latensi CPU/query (ESTIMASI) | Bahasa Indonesia | Lisensi | Node 22 |
|---|---:|---:|---|---|---|---|---|---|
| **`intfloat/multilingual-e5-small`** (pilihan) | 384 | 512 | ~471 MB fp32 / ~120 MB q8 (ESTIMASI) | ~250–400 MB q8 (ESTIMASI) | 20–80 ms, 2 vCPU (ESTIMASI) | Ya (`id` di model card; MTEB id 64.17%) | MIT | Ya, via transformers.js 4.3.2 (verifikasi spike) |
| `intfloat/multilingual-e5-base` | 768 | 512 | ~1,1 GB fp32 / ~280 MB q8 (ESTIMASI) | ~500–700 MB (ESTIMASI) | 60–180 ms (ESTIMASI) | Ya, kualitas umum lebih tinggi | MIT | Ya, via transformers.js |
| `BAAI/bge-m3` | 1024 | 8192 | ~2,2 GB fp32 / ~600 MB q8 (ESTIMASI) | ~1,2–1,8 GB (ESTIMASI) — **berisiko** di VPS 2 GB | 150–400 ms (ESTIMASI) | 100+ bahasa; tidak ada angka `id` spesifik di card | MIT | Ya, via transformers.js, tapi berat |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | 384 | 128 | ~470 MB fp32 / ~120 MB q8 (ESTIMASI) | ~250–350 MB (ESTIMASI) | 15–60 ms (ESTIMASI) | Ya (`id` di daftar bahasa; angka MTEB tidak di card) | Apache-2.0 | Ya, via transformers.js |
| `fastembed` (npm, qdrant-labs) — `multilingual-e5-large` | 1024 | 512 | ~2,2 GB fp32 (ESTIMASI) | ~1,2 GB+ (ESTIMASI) | 150–400 ms (ESTIMASI) | Ya | MIT (lib) | **Perlu verifikasi**: `fastembed@3.0.0` dibangun dengan Node 18.17.1, `onnxruntime-node@1.21.0`, tanpa deklarasi `engines` |

Catatan penting soal `fastembed` JS:

- Model yang tersedia di repo `qdrant-labs/fastembed-js`: `bge-base-en`, `bge-small-en(-v1.5)`, `bge-base-zh-v1.5`, `all-MiniLM-L6-v2`, **`multilingual-e5-large`**. **Tidak ada** `multilingual-e5-small` dan **tidak ada** `bge-m3`.
- Repo adalah fork dengan aktivitas rendah (1 star, 79 commit). Package `fastembed@3.0.0` (MIT) tetap bisa dipakai, tapi pilihan modelnya tidak cocok dengan batas RAM VPS.
- FastEmbed **Python** (`qdrant-client[fastembed]`) tidak tersedia untuk client Node. Jadi tidak bisa dipakai langsung di app Next.js ini.

Kesimpulan: `e5-small` adalah titik tengah terbaik antara kualitas Indonesia, dimensi, dan RAM. `e5-base` menjadi opsi naik kelas bila benchmark membuktikan perlu; `bge-m3` ditolak untuk deploy VPS 2 GB; MiniLM menjadi cadangan bila `e5-small` gagal di spike.

### 2.3 Alternatif server-side / API (dipertimbangkan, bukan jalur utama)

| Jalur | Status untuk kasus ini |
|---|---|
| **Qdrant server-side inference** | Hanya tersedia di **Qdrant Cloud** (model hosted gratis/berbayar) atau external provider (OpenAI/Cohere/Jina/OpenRouter, butuh API key). **Self-host Qdrant di VPS tidak menyediakan inference umum** — hanya BM25 sparse di cluster. Karena DECISION-029 menetapkan VPS pribadi, jalur ini tidak tersedia. |
| **Embedding via Groq/OpenAI (`LLM_MODE`)** | Opsional, eksplisit, dan **bukan fallback**. Butuh API key, mengirim teks dokumen ke pihak ketiga (masalah privasi/PII), dan biaya. Boleh diaktifkan hanya dengan opt-in user + redaksi log. |
| **Fallback deterministik (wajib)** | FTS5 SQLite + LIKE + `retrieveWithEntityBoost` + `rerankCitations` + `retrieveLegalSection`. Sudah ada, sudah PASS, tanpa model dan tanpa jaringan. |

---

## 3. Skema payload Qdrant (usulan)

Collection: `tanyadata_chunks_v1` (nama menyimpan versi skema; ganti ke `_v2` saat model/dimensi berubah).

```ts
type ChunkPayload = {
  // anchor sitasi — WAJIB
  chunk_id: number;            // = core_chunks.id, juga dipakai sebagai point id
  document_id: string;         // immutable source_id, bukan nama file
  dataset_id: string;
  section_path: string;        // URL-encoded di deep_link
  page: number | null;         // 1-indexed
  page_end: number | null;
  rev: string;                 // prefix content_hash, cegah sitasi stale

  // teks
  text: string;                // teks child asli → sumber QUOTE sitasi
  text_fts: string;            // normalizeForFts(text), dipakai BM25 index

  // struktur & filter
  level: 'child' | 'parent';   // hanya child yang di-embed
  parent_id: number | null;
  doc_type: 'legal' | 'technical_report' | 'financial' | 'general' | 'unknown';
  parse_ok: boolean;           // false → jangan pernah disitasi
  ocr_status: string;          // 'ok' | 'ocr_skipped' | 'unreadable' | ...
  clean_version: number;
  content_hash: string;

  // observabilitas model
  embedding_model: string;     // 'intfloat/multilingual-e5-small@q8'
  embedding_dim: 384;
  embedding_truncated: boolean;
  indexed_at: string;          // ISO
};
```

**Payload indexes yang dibuat SEBELUM upsert** (Qdrant hanya membangun filter-HNSW edges untuk field yang sudah terindeks saat graf dibuat):

| Field | Tipe index | Catatan |
|---|---|---|
| `dataset_id` | keyword (`is_tenant: true` bila multi-tenant) | filter scope percakapan |
| `document_id` | keyword | filter per attachment |
| `section_path` | keyword | filter Pasal/Bab eksplisit |
| `doc_type` | keyword | filter jenis dokumen |
| `level` | keyword | selalu `child` untuk retrieval |
| `parse_ok` | bool | fail-closed |
| `page`, `chunk_id`, `parent_id` | integer | deep-link & parent expansion |
| `rev`, `embedding_model` | keyword | deteksi drift model/revisi |
| `text_fts` | text, `scoring: true`, tokenizer `word`, lowercase, ASCII folding | BM25; **stemmer Indonesia perlu diverifikasi** (lihat §8) |

Point id = `chunk_id` (integer, deterministik) → upsert idempoten, reindex aman diulang.

---

## 4. Strategi chunk → vector

1. **Source of truth tetap `core_chunks`.** Qdrant adalah indeks turunan; SQLite tidak dihapus.
2. **Hanya `level='child'` yang di-embed.** Parent dipakai untuk konteks (small-to-big), bukan sebagai sitasi — sesuai catatan di `retrieval.ts:370-382` bahwa quote harus berasal dari child agar `validateCitationDeepLink` tidak membuang sitasi `QUOTE_MISMATCH`.
3. **Input embedding**: `"passage: " + section_path + "\n" + text`. Batasi 512 token (batas e5-small). Jika `token_count > 512`, **potong hanya input embedding**, jangan ubah `text` di payload; set `embedding_truncated = true`. Quote sitasi tetap dari child utuh.
4. **Input query**: `"query: " + question` (prefix wajib E5). Jangan stem query untuk dense; stem hanya untuk `text_fts`.
5. **Dedup**: `contentHash` NFKD/lowercase/space-normalized (sudah ada di `retrieval.ts:727`). Chunk dengan hash sama dalam `document_id` yang sama → lewati, catat `duplicate_count`.
6. **Revisi**: `rev` = prefix `content_hash`. Jika dokumen di-ingest ulang dan hash berubah, upsert dengan `rev` baru; deep-link lama otomatis gugur via `REV_MISMATCH` (fail-closed, sudah ada).
7. **Ganti model**: collection baru + reindex penuh. Jangan mencampur dimensi 384 dan 1024 dalam satu collection.

---

## 5. Query flow (detail)

1. `detectEarlyGuardrail` + `checkGuardrails(scope)` — **tidak diubah**.
2. `extractRetrievalEntities(question, knownChannels)` — **tidak diubah**.
3. **Jalur cepat deterministik**: jika terdeteksi `pasal` eksplisit dengan pola "berbunyi apa" / "apa isi Pasal N", panggil `retrieveLegalSection`. Ini presisi tertinggi dan tidak perlu Qdrant.
4. Bangun filter Qdrant (diterapkan ke **kedua** leg):
   - `dataset_id IN [...]` (atau tidak ada filter bila `'*'` — hati-hati, lihat BUG-003/QA doc soal polusi workspace),
   - `parse_ok = true`,
   - `ocr_status NOT IN ['ocr_skipped','unreadable']`,
   - `level = 'child'`,
   - opsional `doc_type` dari klasifikasi.
5. **Leg A — dense**: embed query → `search` pada named vector `dense`, `limit = 20`, `score_threshold` opsional.
6. **Leg B — lexical**: `query.text` pada `text_fts` dengan BM25 (`k=1.2`, `b=0.75` default), `limit = 20`.
7. **Fusion — RRF di aplikasi** (pure function, bisa di-eval):
   `rrf(d) = Σ 1/(k + rank_i(d))`, `k = 2` (default Qdrant).
   - **Kenapa RRF, bukan weighted raw score**: cosine (0–1) dan BM25 (tidak terikat, tergantung panjang & IDF) berada di skala berbeda; bobot tetap rapuh antar query (sumber: Qdrant hybrid tuning). RRF hanya memakai **peringkat**, sehingga tidak mengubah kalibrasi `STRONG_CITATION_SCORE = 0.18` dan `ANSWERABILITY_THRESHOLD = 0.45`.
   - **Kenapa fusion di aplikasi, bukan `query: {rrf:{}}` di server**: kita perlu menyimpan `bm25_score` asli untuk dijadikan `citation.score` seperti sekarang (`max(0, -raw_bm25)`). Hasil Query API server hanya mengembalikan skor RRF, yang **bukan** probabilitas dan tidak boleh dipakai sebagai skor sitasi. Fusion di aplikasi juga mudah diuji dan tidak bergantung pada versi Qdrant ≥1.10.
   - Alternatif bila latency lebih penting: server-side RRF via `prefetch` + `query: {rrf:{}}`, dengan catatan `citation.score` harus dihitung ulang dari leg BM25 terpisah atau dari `answerabilitySupport`.
8. **Reranker deterministik yang sudah ada**: `rerankCitations` (entity boost pasal/ayat/Fnn/channel/definisi) + `metadataBoost` (docType, page, section depth). Ambil top-5.
9. **Small-to-big + dedup parent** (sudah ada) → **deep-link validation fail-closed** (sudah ada). Sitasi invalid dibuang, status → `evidence_limited`.
10. `buildContextBundle` dengan porsi 50% sitasi / 25% skema / 15% SQL / 10% instruksi — **tidak diubah**.
11. Guardrail answerability memakai `answerabilitySupport` + `citationScores` dari skor BM25 leg (bukan RRF). **Ambang tidak diturunkan.**

Catatan urutan: fusion hanya **mengurutkan ulang** kandidat. Dokumen yang tidak muncul di kedua leg tidak bisa muncul di hasil — ini sifat RRF yang harus diuji di retrieval benchmark (recall@20 dari masing-masing leg).

---

## 6. Fallback tanpa Qdrant / tanpa API key

| Kondisi | Perilaku | Jejak observabilitas |
|---|---|---|
| `QDRANT_URL` kosong / koneksi gagal / timeout | Langsung ke `searchChunks` (FTS5) + `retrieveWithEntityBoost` + `rerankCitations`. **Tidak ada error user-visible.** | `QueryMeta.fallbackReason = 'qdrant_unavailable'` |
| Model embedding belum terunduh / load gagal | Tetap pakai Qdrant **lexical-only** (BM25); bila Qdrant juga mati → FTS5 | `fallbackReason = 'embedding_unavailable'` |
| `LLM_MODE=off` (mode eval) | Jalur lokal tetap jalan; tidak ada panggilan API | `aiActive = false` bila tidak ada model dipakai |
| API key tidak ada | **Tidak masalah** — jalur utama lokal | — |
| API key ada & user opt-in | Embedding provider opsional; PII diredaksi sebelum dikirim; bukan default | `fallbackReason = 'provider_embedding_optin'` |
| Hasil RRF kosong | `no_evidence` jujur + guardrail `not_in_sources`, bukan mengarang | `status = 'no_evidence'` |

Semua fallback harus diuji oleh QA dengan input normal/aneh/kosong/panjang (lihat handoff).

---

## 7. Metrik evaluasi

### 7.1 Empat suite yang ada — **ambang tidak boleh diturunkan**

| Suite | Perintah | Baseline terakhir (dari `QA_CRITICAL_VERIFICATION.md` / script) |
|---|---|---|
| Ground truth | `npm run eval:ground-truth` | PASS: 12 legacy + 2 realSeed + 11 capability + 6 perpres; classification/extraction/retrieval/sql/output/guardrail = 1.0, hallucination 0 |
| Extraction GT | `npm run eval:extraction-gt` | `exact_text_units = 1`, `token_coverage ≥ 0.98`, `mojibake_residual = 0` |
| Hold-out | `npm run eval:holdout` | answerable/refusal/hallucination/delta sesuai `scripts/lib/holdout-gate.mjs` (baca nilai dari `docs/HOLDOUT_RESULT.json` saat implementasi) |
| Real docs | `npm run eval:real-docs` | semua kasus & ingest PASS, 0 bug tersisa pada run terakhir |

Gate: keempat suite harus **tetap PASS** setelah hybrid aktif. Satu saja FAIL → hybrid tidak diaktifkan sebagai default.

### 7.2 Retrieval benchmark baru (desain; belum dibuat, belum dijalankan)

Sumber ground truth yang sudah ada:

- `data/fixtures/perpres76/ground_truth.json` — 21 pasal, ayat, butir, metadata halaman (14 halaman).
- `data/fixtures/cases.json` — `LEG-01/02/03` dengan `expected.citations` berisi `doc`, `section`, `ayat`.
- `data/fixtures/sop-layanan/cases.json` dan `data/fixtures/real-docs/cases.json` — kasus normal/edge/adversarial tambahan.

Metrik (retrieval **dievaluasi terpisah dari generasi**):

| Metrik | Definisi | Gate |
|---|---|---|
| `recall@5`, `recall@10` | ground-truth chunk masuk dalam top-k | hybrid ≥ baseline FTS5 (tidak boleh turun) |
| `MRR@10` | 1 / peringkat pertama chunk benar | hybrid ≥ baseline |
| `nDCG@10` | peringkat dengan graded relevance (pasal > ayat > butir) | hybrid ≥ baseline |
| `citation_valid_rate` | sitasi lolos `validateCitationDeepLink` | = 1.0 (fail-closed sudah ada) |
| `duplicate_rate` | chunk dengan `contentHash` sama dalam hasil | 0 |
| `latency_p50/p95` | waktu retrieval saja | **ESTIMASI** dulu; target ditetapkan setelah diukur |

Perbandingan yang wajib dijalankan sekali: **(A) FTS5 baseline** vs **(B) dense-only** vs **(C) hybrid RRF**. Ambang numerik baru **tidak ditetapkan di dokumen ini** — harus dikalibrasi dari angka baseline yang benar-benar terukur, lalu dicatat di DECISION baru. Ini sesuai aturan "jangan mengarang angka benchmark".

Kasus uji minimal:

- **Normal**: "Pasal 33 UUD 1945 berbunyi apa?", "Kode F04 berarti apa?"
- **Edge**: parafrasa "pengaduan masuk lewat jalur apa?", "SLA refund tiap kanal?"
- **Adversarial**: instruksi injeksi di dalam teks dokumen, angka di luar rentang data, chunk duplikat, halaman `ocr_skipped`, query sangat panjang (> 512 token), query kosong.

---

## 8. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| **Drift sitasi** — RRF mengubah urutan, model mengubah relevansi | Sitasi salah/passage salah, guardrail salah menilai | Deep-link validation fail-closed tetap menjadi gate terakhir; quote selalu dari child; `rev` tidak diubah; `citation.score` tetap dari BM25, bukan RRF |
| **Duplikat chunk** — potongan halaman/footer, OCR ulang | top-k terisi duplikat, recall turun | `contentHash` dedup saat index; parent dedup saat retrieval; `duplicate_count` diekspos di eval |
| **Latency** — load model + inferensi + 2 request Qdrant | p95 naik | Singleton model (warm-up saat start), LRU cache query embedding, batch saat reindex, timeout eksplisit per request; ukur dulu sebelum optimasi |
| **RAM VPS 2 GB** — e5-small + Qdrant + Next.js | OOM | q8, `e5-small` (bukan base/m3), batas batch reindex, patuhi watchdog 1,2 GB dari `ingest.ts` |
| **BM25 Bahasa Indonesia** — Qdrant default `word` tokenizer + lowercase, **tanpa** stemmer/stopword Indonesia | Variasi `mengatur`/`atur` tidak match di leg lexical | Pakai `text_fts` hasil `normalizeForFts` (stem ringan sudah ada); atau verifikasi dukungan Snowball `indonesian` di versi Qdrant yang dipakai. **Jangan menurunkan ambang guardrail untuk mengompensasi.** |
| **Drift model** — ganti model tanpa reindex | Dimensi mismatch, skor tidak banding | `embedding_model` + `embedding_dim` di payload; collection versioned; reindex penuh |
| **Polusi workspace** (BUG-003) | Topik dokumen uji memicu `out_of_scope` seperti kasus harness lama | Eval memakai `WORKSPACE_DIR` sementara; filter `dataset_id` eksplisit, jangan `'*'` kecuali chip "Semua dokumen" |

---

## 9. Urutan implementasi (setelah desain disetujui)

1. **Architect**: ADR migrasi + DECISION-032 (verdict, batas VPS, mode Qdrant Docker di VPS).
2. **aiml**: buat `scripts/eval-retrieval.mjs` + mapping ground-truth chunk; **ukur baseline FTS5 dulu** (belum ada angka hari ini).
3. **Spike terbatas (1 kali, bukan trial-and-error)**: pasang `@huggingface/transformers@4.3.2` + `@qdrant/js-client-rest@1.20.0`, unduh `e5-small` q8, ukur dimensi nyata, RAM, latensi CPU, kompatibilitas Node 22. Ganti semua `ESTIMASI` di dokumen ini dengan angka terukur.
4. **backend**: skema collection + payload indexes + indexer idempoten (upsert by `chunk_id`), reindex CLI.
5. **aiml**: embedding adapter (singleton, prefix E5, timeout, LRU cache) + RRF pure function + hybrid adapter yang memanggil ulang `rerankCitations` & `validateCitationDeepLink`.
6. **aiml/backend**: fallback wiring + `QueryMeta.fallbackReason`.
7. **aiml**: **satu kali** jalankan 4 suite lama + retrieval benchmark; bandingkan A/B/C; tulis hasil lengkap ke file; keputusan go/no-go.
8. **frontend/designer**: state UI untuk `evidence_limited`, `no_evidence`, dan fallback (koordinasi terpisah).
9. **qa/security**: verifikasi input normal/aneh/kosong/panjang, fallback, prompt injection, dan kebocoran scope.

---

## 10. Sumber riset

**Lokal**

- `docs/DECISIONS.md` DECISION-031 (2026-11-23) — arahan migrasi & kewajiban eval.
- `docs/QA_CRITICAL_VERIFICATION.md` — baseline PASS & bug BUG-001..006.
- `lib/ai/retrieval.ts` — FTS5, `rerankCitations`, `retrieveLegalSection`, deep-link validation, `contentHash`.
- `lib/core/store.ts` — `searchChunks`, `searchTerms`, BM25 → `score`.
- `lib/core/ingest.ts` — chunking, `rev`, watchdog RSS 1,2 GB.
- `lib/core/contracts.ts` — `Chunk`, `Citation`, `QueryMeta`, `EvidenceConfidenceLevel`.
- `lib/ai/guardrails.ts` — ambang 0.45 / 0.25 / 0.18, scope gate, injection regex.
- `scripts/eval-{ground-truth,holdout,extraction-gt,real-docs}.mjs` — 4 suite existing.
- `data/fixtures/perpres76/ground_truth.json`, `data/fixtures/cases.json` — ground truth retrieval.

**Eksternal**

- Qdrant Hybrid Queries & RRF: https://qdrant.tech/documentation/search/hybrid-queries
- Qdrant Hybrid Search tuning (RRF vs DBSF, peringkat vs skor): https://qdrant.tech/documentation/search-tuning/how-to-tune-hybrid-search
- Qdrant Full-Text Search / BM25 / text processing: https://qdrant.tech/documentation/search/text-search/full-text-search/
- Qdrant Inference options (self-host vs Cloud): https://qdrant.tech/documentation/inference
- Qdrant Cloud Inference: https://qdrant.tech/documentation/embeddings/qdrant-cloud-inference
- Qdrant payload filtering & index-before-ingest: https://qdrant.tech/documentation/search-patterns/vector-search-filtering/
- transformers.js: https://github.com/huggingface/transformers.js · npm `@huggingface/transformers@4.3.2` (registry)
- fastembed-js: https://github.com/qdrant-labs/fastembed-js · npm `fastembed@3.0.0` (registry)
- Qdrant JS client: npm `@qdrant/js-client-rest@1.20.0` (`engines.node >= 22`)
- Model cards: https://huggingface.co/intfloat/multilingual-e5-small · https://huggingface.co/BAAI/bge-m3 · https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2

---

## 11. Handoff

```yaml
from: aiml
to: agentic
phase: P3
type: deliverable
refs: [docs/QDRANT_AI_DESIGN.md, docs/DECISIONS.md#DECISION-031, docs/QA_CRITICAL_VERIFICATION.md, lib/ai/retrieval.ts, lib/core/store.ts, lib/ai/guardrails.ts, scripts/eval-ground-truth.mjs, scripts/eval-holdout.mjs, scripts/eval-extraction-gt.mjs, scripts/eval-real-docs.mjs]
summary: "Riset desain retrieval Qdrant selesai: rekomendasi jalur utama e5-small lokal (384 dim, q8, tanpa API key) + BM25 Qdrant + RRF di aplikasi, dengan fallback deterministik FTS5 yang sudah PASS. Tidak ada kode diubah dan tidak ada evaluasi dijalankan; semua angka performa masih ESTIMASI dan baseline retrieval belum diukur."
evidence: docs/QDRANT_AI_DESIGN.md + sumber web (Qdrant hybrid/full-text/inference docs, transformers.js, fastembed-js, model card e5-small/bge-m3/MiniLM) + artefak lokal yang dibaca
blocking: false
needs: "Keputusan architect (ADR/DECISION-032) + spike terukur sekali untuk mengganti ESTIMASI, lalu pembuatan eval retrieval benchmark dan perbandingan A/B/C sebelum hybrid diaktifkan sebagai default. Ambang existing tidak boleh diturunkan."
```
