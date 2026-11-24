# Generalisasi lintas domain — hasil pengukuran (QA, P4)

**Tanggal:** 2026-11-24 · **Role:** qa · **Status:** PERFORMED · **Verdict:** GAGAL menargetkan stabilitas ≤5 poin.

## 1. Setup & integritas pengukuran

| Item | Nilai |
|---|---|
| Workspace terpisah | `C:\Users\aldya\AppData\Local\Temp\opencode\tanyadata-transfer-ws` |
| `data/workspace` asli | TIDAK disentuh (LastWriteTime 13:23:50, sebelum run 13:31) |
| Korpus | 3 PDF di `eval/transfer_set/`, diindeks dari **bytes PDF** via `validateUpload → ingestIntoDataset` (`lib/core/ingest.ts`) |
| Ground truth | 66 QA (`*_qa.json`) — **hanya** sebagai daftar soal + label metrik, tidak pernah menjadi teks indeks |
| `gt_text_fallback` | TIDAK dipakai (manifest: `gtFallbackUsed=false`) |
| Parameter | Tidak ada yang diubah. Tidak ada tuning threshold/bobot/prompt/chunk/OCR memakai transfer set |
| Mode | `LLM_MODE=off`, `RETRIEVAL_MODE=fts5`, `QDRANT_MODE=off`, `EMBEDDING_PROVIDER=off`, tanpa dev server/HTTP |
| Wrapper | `safe_exec.py --timeout 600` untuk setiap perintah; retry maks 2× (1 retry terjadi pada probe teks, bukan pada pipeline) |

### OCR / text layer — pernyataan jujur

Ketiga PDF **memiliki text layer**; OCR **tidak diperlukan dan tidak terpicu** (`quality_report.ocrUsed=false`, `ocrPages=[]`). Tidak ada halaman scan di transfer set, jadi **jalur OCR tidak diuji** — yang diuji adalah generalisasi layout/struktur.

| Dokumen | Layout terdeteksi | Chunk | OCR |
|---|---|---|---|
| `kebijakan_cuti.pdf` | 2 kolom, `readingOrder=column` (deteksi kolom berhasil) | 2 | tidak |
| `keamanan_ti.pdf` | 1 kolom, tabel `Bagian \| Ketentuan` **tidak** terdeteksi (`tables=0`) | 2 | tidak |
| `pengadaan_barang.pdf` | 2 halaman, 1 kolom; header/footer berulang **tidak** dibuang | 4 | tidak |

## 2. Gap vs baseline 4 KB — 66 soal transfer terindeks

Target: `|delta| ≤ 5 poin persentase`. `delta = (transfer − baseline) × 100`.

| Metrik | Transfer | Baseline 4KB | Δ (pp) | ≤5pp |
|---|---:|---:|---:|:---:|
| section_recovery | 0.1250 | 1.0000 | −87.50 | ✗ |
| self-retrieval hit@1 | 0.2083 | 1.0000 | −79.17 | ✗ |
| retrieval hit@1 (production) | 0.1864 | 0.7207 | −53.43 | ✗ |
| retrieval hit@5 (production) | 0.2203 | 0.7838 | −56.35 | ✗ |
| retrieval hit@1 (raw) | 0.2881 | 0.8468 | −55.87 | ✗ |
| retrieval hit@5 (raw) | 0.3220 | 0.9730 | −65.10 | ✗ |
| false_abstain (lower better) | 0.5085 | 0.1622 | +34.63 | ✗ |
| false_answer (lower better) | 0.8571 | 0.1786 | +67.85 | ✗ |
| faithfulness | 0.5254 | 0.5856 | −6.02 | ✗ |
| citation_source_accuracy | 0.2222 | 0.5838 | −36.16 | ✗ |
| evidence_span_F1 | 0.2838 | 0.6326 | −34.88 | ✗ |
| quote_validity | 1.0000 | 1.0000 | +0.00 | ✓ |
| inline_ratio | 0.9962 | 0.3552 | +64.10 | ✗¹ |
| end_dump_rate (lower better) | 0.0000 | 0.0000 | +0.00 | ✓ |

**Pass rate: 2/14 metrik (14,29%).** ¹ `inline_ratio` naik 64 pp — secara absolut lebih baik (hampir semua kalimat bersitasi), tetapi tetap gagal pada kriteria stabilitas ≤5 pp dan tidak mengompensasi runtuhnya akurasi sumber sitasi (0.2222).

### Temuan akar (dari artefak, bukan spekulasi)

1. **Deteksi bagian gagal pada layout baru.** Dari 24 bagian GT, hanya 3 yang dipetakan ke `section_path` hasil ekstraksi. CUTI dan TI masing-masing hanya menghasilkan **1** `section_path` (= nama file), PD 4 (salah satunya hanya berisi header berulang). `NUMBERED_HEADING` hanya mengenali pola Pasal/Ayat/Bab/Tabel/markdown — bukan `CUTI#n`, `TI#n |`, atau `2.1.1.`.
2. **Chunk boundary memotong kalimat.** Chunk CUTI ke-2 dimulai dengan `mengurangi saldo cuti tahunan. CUTI#6 ...` — bagian #5 terbelah.
3. **Pembersihan overfit.** `Patch` berubah menjadi `Pateh` pada TI#7 (hard-code `OCR_GLYPHS` untuk kosakata SOP).
4. **Header/footer 2 halaman tidak dibuang** (`stripRepeatedLines` hanya aktif untuk ≥3 halaman), menghasilkan chunk sampah pada PD.
5. **Konsekuensi:** retrieval production hit@1 0.1864 → 50,85% soal answerable di-abstain; 85,71% soal abstain-expected justru dijawab (false_answer tertinggi). Contoh: `TR-CUTI-01` dijawab "Informasi tersebut tidak ditemukan ..." padahal kalimat jawabannya ada di chunk #1.

## 3. Leave-One-Document-Out (KB01–KB04)

**PERFORMED** — 4/4 fold memakai flag harness yang sudah ada (`--ingest-kb` 3 dokumen, `--eval-kb` dokumen ke-4). Tidak ada tahap kalibrasi parameter dalam pipeline terkunci; 3 dokumen adalah satu-satunya indeks saat soal dokumen ke-4 dijawab.

| Fold (held-out) | Soal | section_rec | hit@1 prod | hit@5 prod | false_abstain | false_answer | faithfulness | cite_src_acc | span_F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| KB01 | 41 | 0.9167 | 0.1389 | 0.1944 | 0.3611 | 0.2000 | 0.5556 | 0.1379 | 0.1949 |
| KB02 | 31 | 0.9167 | 0.1304 | 0.1739 | 0.6087 | 0.1250 | 0.6957 | 0.0909 | 0.1559 |
| KB03 | 35 | 1.0000 | 0.2222 | 0.2222 | 0.5185 | 0.3750 | 0.7407 | 0.1786 | 0.2381 |
| KB04 | 32 | 0.9167 | 0.0800 | 0.0800 | 0.6400 | 0.1429 | 0.7600 | 0.0833 | 0.1137 |
| **Rata-rata** | — | **0.9375** | **0.1429** | **0.1676** | **0.5321** | **0.2107** | **0.6880** | **0.1227** | **0.1757** |

**Kaveat LODO:** KB01/KB04 adalah PDF image-only. Bila masuk ke indeks 3 dokumen, bridge memakai `gt_text_fallback` (KNOWN_BASELINE_VIOLATION) — fold KB02/KB03 mewarisi 2 pelanggaran, fold KB01/KB04 mewarisi 1. Jadi angka LODO **bukan** bukti ekstraksi PDF jujur; gunakan angka transfer terindeks sebagai ukurannya.

## 4. Yang LULUS / tidak diukur

**Lulus:** quote_validity = 1.0 (54 sitasi), end_dump_rate = 0.0, tidak ada `gt_text_fallback` pada transfer set, OCR tidak diperlukan, seluruh 66 soal selesai tanpa error/timeout, 4/4 fold LODO selesai.

**Tidak diukur (jangan diartikan 0):**
- `alias_retrieval` — alias SOP hanya untuk KB01–KB04, tidak ada untuk domain CUTI/TI/PD.
- `key_fact_coverage` & `claim_citation_recall` — skema QA transfer tidak punya `key_facts`; angka harness 1.0/0.0 bukan ukuran kualitas.
- `offset_valid` — skema `core_chunks` tidak menyimpan offset karakter (sama seperti baseline).
- `anomaly_pass` — tidak ada kategori anomaly di transfer set (lingkup P5).
- Jalur OCR / halaman scan — tidak tersedia di transfer set.

## 5. Artefak

- `tanyadata/eval/results/transfer_indexed.json` — metrik lengkap + `generalization_gap` + `measurement_notes` + 66 per-question.
- `tanyadata/eval/results/_transfer_indexed_raw.json` — output bridge mentah.
- `tanyadata/eval/results/lodo.json` — 4 fold + rata-rata.
- `tanyadata/eval/results/_lodo_KB0{1..4}.json` + `_raw.json` — artefak per fold.
- `tanyadata/scripts/qa-transfer-ingest.mjs`, `qa-transfer-bridge.mjs`, `qa_gap_report.py`, `qa_lodo_runner.py` — skrip pengukuran (tidak mengubah kode inti).
- `<tmp>/opencode/tanyadata-transfer-ws/qa-transfer-ingest-manifest.json` — bukti ingest PDF-only + text layer + OCR=false.

## 6. Kesimpulan

**Tidak ada bukti generalisasi.** Engine menghafal struktur 4 KB SOP: saat diberi dokumen baru dengan penomoran `CUTI#n` / `TI#n |` / `2.1.1.`, deteksi bagian dan chunking runtuh, lalu retrieval dan abstain mengikuti. Gap jauh melebihi target ≤5 pp pada 12 dari 14 metrik. Ini bukan masalah parameter yang bisa dinaik-turunkan di lane QA — perlu perbaikan deteksi heading generik, chunk boundary sadar bagian, dan pembersihan teks non-overfit oleh owner lane.
