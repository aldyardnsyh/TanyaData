# HOLDOUT_RESULTS — Blind Hold-out Test (dokumen NON-Perpres)

> **Uji buta.** Engine dijalankan pada `contoh-sop-layanan.md` (SOP layanan), dokumen yang **tidak dipakai** saat kalibrasi Perpres 76. Aturan `lib/ingest/chunker.ts`, `lib/ai/retrieval.ts`, dan `lib/ai/guardrails.ts` **sengaja tidak diubah**. Kegagalan di bawah adalah temuan, bukan bug harness yang disembunyikan.

- Dijalankan: `2026-11-20T13:24:40.773Z` (SATU kali, `--non-interactive`, `LLM_MODE=off`)
- Runner: `node scripts/eval-holdout.mjs --non-interactive` · exit **1** (FAIL)
- Dokumen: `data/fixtures/sop-layanan/document.txt` · 763 char · SHA-256 `ad85b8140445…`
- Chunk dihasilkan: **1** (satu halaman `.txt` tanpa heading → `pageSections` → satu section → `chunkSections`)
- Detail mesin: `docs/HOLDOUT_RESULT.json`
- Workspace DB sementara: dibuat ulang tiap run, tidak menyentuh data nyata

## Pipeline yang dijalankan (sama persis dengan produksi)

1. `sectionsFromPages(txt)` → `chunkSections` — `lib/ingest/chunker.ts` **TIDAK diubah**
2. `core_chunks` + trigger FTS5 — `lib/db/core-schema.sql`
3. `searchChunks` via `answerQuestion` — `lib/core/store.ts` **TIDAK diubah**
4. `detectGuardrail` / `notInSourcesGuardrail` — `lib/core/answer.ts` **TIDAK diubah**
5. `composeDeterministicAnswer` — `lib/core/answer.ts` **TIDAK diubah**

Tidak ada model lokal, jaringan, retry, atau tuning khusus SOP.

## Metrik agregat (jujur)

| Metrik | Nilai | Ambang | Hasil |
|---|---:|---:|---|
| Answerable accuracy (frasa kunci hadir) | **0.0000** (0/8) | ≥ 0.9000 | **FAIL** |
| Refusal accuracy | **0.3333** (1/3) | ≥ 0.9000 | **FAIL** |
| Hallucination rate (mentah, lihat catatan) | **0.9091** (10/11) | ≤ 0.0200 | **FAIL** |
| Overall accuracy | **0.0909** (1/11) | — | **FAIL** |

**Hasil keseluruhan: FAIL.** Dibanding Perpres 76/2013 yang mencapai **0.9960** (rata-rata 6 metrik struktur chunker, `docs/EVAL_RESULTS.md`), ini adalah **penurunan drastis ≈ 0.905 poin**. Engine tidak generalis ke dokumen di luar kalibrasi.

## Tabel per pertanyaan (expected vs actual)

| ID | Pertanyaan | Expected | Actual (jawaban produksi) | Hasil | Bukti |
|---|---|---|---|---|---|
| SOP-01 | Berapa lama batas waktu maksimal penyelesaian permintaan informasi? | mengandung `dua hari kerja sejak permintaan dicatat` | `…Batas waktu maksimal penyelesaian adalah dua hari kerja sejak permintaan dicatat…` | **FAIL** | `hit=true`, tapi `foreign=2` (label halaman) → lihat catatan grader |
| SOP-02 | Siapa yang bertanggung jawab mencatat setiap permintaan? | mengandung `Receiving Officer wajib mencatat setiap permintaan` | `…Receiving Officer wajib mencatat setiap permintaan pada Sistem Tiket…` | **FAIL** | `hit=true`, `foreign=2` (label halaman); AI-guardrail salah `out_of_scope` |
| SOP-03 | Apa yang dilakukan Receiving Officer saat berkas belum lengkap? | mengandung `pemohon diberi pemberitahuan tertulis` | `…pemohon diberi pemberi` (terpotong 240 char) | **FAIL** | `hit=false` — frasa di luar potongan 240 char |
| SOP-04 | Kapan berkas lengkap diteruskan ke unit yang diminta? | mengandung `diteruskan ke unit yang diminta setelah verifikasi kelengkapan berkas` | `…Bila berkas tidak lengkap, pemohon diberi pemberi` | **FAIL** | `hit=false` — tidak ada di potongan 240 char |
| SOP-05 | Permintaan informasi bisa masuk lewat jalur apa saja? | mengandung `formulir elektronik atau loket fisik` | `…Bila berkas tidak lengkap, pemohon diberi pemberi` | **FAIL** | `hit=false`; AI-guardrail salah `out_of_scope` |
| SOP-06 | Apakah prosedur berlaku untuk data pribadi pihak ketiga? | mengandung `tidak berlaku untuk permintaan yang berkaitan dengan data pribadi pihak ketiga` | `…Bila berkas tidak lengkap, pemohon diberi pemberi` | **FAIL** | `hit=false`; AI-guardrail salah `pii` (false positive) |
| SOP-07 | Apa itu SLA Penyelesaian? | mengandung `SLA Penyelesaian adalah batas waktu maksimal` | `…Bila berkas tidak lengkap, pemohon diberi pemberi` | **FAIL** | `hit=false` — definisi ada di dokumen tapi di luar potongan |
| SOP-08 | Bagaimana hasil akhir disampaikan dan dicatat? | mengandung `Hasil akhir disampaikan kepada pemohon dan dicatat pada Sistem Tiket` | `…Bila berkas tidak lengkap, pemohon diberi pemberi` | **FAIL** | `hit=false`; AI-guardrail salah `out_of_scope` |
| SOP-09 | Bagaimana cara uploading berkas ke sistem tiket? | **ditolak** (`TIDAK ADA JAWABAN`) | Menjawab dari potongan chunk yang tidak relevan | **FAIL** | `guardrail=none`, `sitasi=1` — kata `berkas/sistem/tiket` cocok → engine menjawab |
| SOP-10 | Berapa biaya pengajuan informasi layanan? | **ditolak** (`TIDAK ADA JAWABAN`) | `Pertanyaan ini tidak bisa dijawab dari dokumen "SOP Layanan"…` | **PASS** | `guardrail=not_in_sources`, `sitasi=0` — tidak ada term yang cocok |
| SOP-11 | Siapa kepala unit kerja yang menandatangani persetujuan? | **ditolak** (`TIDAK ADA JAWABAN`) | Menjawab dari potongan chunk yang tidak relevan | **FAIL** | `guardrail=none`, `sitasi=1`; AI-guardrail benar `out_of_scope` tapi **tidak dipakai** produksi |

Ringkasan: **1 PASS / 11** (hanya SOP-10). 8 answerable semua FAIL, 2 dari 3 refusal FAIL.

## Akar masalah (temuan untuk iterasi berikutnya)

1. **Satu chunk → jawaban selalu 240 char pertama.** `searchChunks` memotong `quote` ke `substr(text,1,240)` (`lib/core/store.ts:257`) dan `composeDeterministicAnswer` hanya mengutip 3 excerpt maks. 400 char (`lib/core/answer.ts:190-192`). Karena seluruh SOP menjadi satu chunk, kalimat ke-3 sampai ke-8 tidak pernah muncul. Ini **bukan** kegagalan retrieval (chunk yang benar ditemukan), melainkan kegagalan *ekstraksi potongan relevan di dalam chunk*.
2. **Tidak ada deteksi "tidak ada jawaban" bila kosakata bertabrakan.** SOP-09/SOP-11 ditolak dengan benar oleh AI-lane (`checkGuardrails` → `out_of_scope`), tetapi `answerQuestion` (jalur produksi) hanya memanggil `detectGuardrail` core yang tidak punya aturan `out_of_scope`. Selama FTS5 menemukan satu term yang cocok, engine menjawab — termasuk untuk pertanyaan yang tidak dijawab dokumen.
3. **Guardrail AI-lane menghasilkan false positive** pada SOP-02/05/06/08 (`out_of_scope`/`pii`) karena daftar topik dan regex PII terlalu luas untuk domain SOP. Ini tidak merusak jawaban produksi (tidak dipakai), tapi menunjukkan guardrail itu sendiri juga belum generalis.
4. **Chunker legal hasil tuning tidak dipakai produksi.** `chunkLegalDocument` hanya dipanggil di `lib/eval/perpres.ts`; ingest produksi (`lib/ingest/documents.ts`, `lib/core/ingest.ts`) masih memakai `chunkSections`. Jadi angka 0.996 mengukur jalur eval, bukan jalur produksi yang diuji di sini.

## Catatan jujur tentang metrik hallucination

Nilai `0.9091` **terlalu tinggi karena artefak grader**, bukan karena model mengarang angka. Dua token `1` pada setiap jawaban berasal dari label sitasi `Halaman 1` (muncul di badan teks dan di `Sumber: Halaman 1`), yang merupakan metadata halaman sah dari `section_path`, bukan angka karangan. Allow-list bukti di grader hanya memasukkan `c.quote` (teks chunk), bukan `c.section_path`. **Jumlah angka karangan sebenarnya = 0** — semua teks jawaban berasal dari potongan chunk. Metrik ini sengaja **tidak diubah/dijalankan ulang** sesuai protokol uji-buta; artefaknya dicatat di sini agar tidak menyesatkan.

Demikian pula, SOP-01 dan SOP-02 sebenarnya **memuat frasa kunci yang benar** (`hit=true`); keduanya hanya gagal karena artefak `foreign=2` yang sama. Bila artefak diabaikan, "frasa kunci hadir" = 2/8 = 0.25 — tetap jauh di bawah ambang 0.90.

## Perbandingan dengan Perpres 76

| | Perpres 76/2013 | SOP layanan (hold-out) |
|---|---:|---:|
| Metrik yang diukur | 6 metrik struktur chunker | answerable + refusal + hallucination |
| Skor | **0.9960** | **0.0909** |
| Dokumen dipakai kalibrasi? | Ya | Tidak |
| Chunker | `chunkLegalDocument` (eval-only) | `chunkSections` (produksi) |

Kesimpulan: angka 0.996 **tidak transferable**. Ia mengukur seberapa baik aturan structure-aware cocok dengan satu dokumen hukum yang memang dipakai untuk merancang aturan itu. Pada dokumen biasa, pipeline produksi jeblok. Ini adalah bukti empiris kekhawatiran overfitting user — **benar**.

## Status & langkah berikutnya (belum dikerjakan)

- **Tidak ada perbaikan kode** dalam commit ini. Sesuai instruksi, perbaikan menyusul setelah keputusan.
- Kandidat perbaikan (untuk iterasi berikutnya, bukan sekarang): (a) potong kutipan di sekitar kalimat yang paling relevan dengan pertanyaan, bukan 240 char pertama; (b) naikkan sinyal `out_of_scope` AI-lane ke jalur produksi sebelum menjawab; (c) uji ulang `chunkLegalDocument` vs `chunkSections` pada dokumen non-hukum; (d) perbaiki allow-list grader agar menyertakan `section_path`.
- Commit ini hanya menambah fixture, modul eval, runner, dan laporan. File produksi tidak disentuh.
