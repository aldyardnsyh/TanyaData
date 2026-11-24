# TUNING REPORT — audit arsitektur P4 (architect)

**Dibuat:** 2026-11-24 · **Role:** architect · **Lingkup:** review hasil tuning OCR / phase2 / retrieval / LLM fallback pada `tanyadata`.
**Batasan penulisan:** laporan ini **hanya membaca artefak**. Tidak ada kode, GT, tuning, ambang, atau konfigurasi yang diubah. Semua angka di bawah berasal dari file yang tercantum di `refs`; angka yang tidak ada di artefak tidak diklaim.

---

## 1. Ringkasan eksekutif + verdict

Pipeline sudah bergerak dari kondisi **tidak jujur** (KB01/KB04 diindeks dari transkrip GT) menjadi **jujur** (OCR PP-OCRv6 tiny sungguhan, 0 `gt_text_fallback`, 0 soal SKIPP). Ekstraksi dua kolom juga sudah diperbaiki dan terbukti dengan probe urutan `1 < 6 < 7 < 8` pada KB01. Namun **akurasi end-to-end tidak ikut naik**: presisi penuh 139 soal = **0,4811** (mode off *dan* llm), abstention = **0,8201**, `keyFactCoverage` = **0,4462**, `citationPrecision` = **0,3973**. Verifikasi 9 jawaban akhir hanya **4/9 PASS (0,4444)**. Transfer set menghasilkan `retrieval_hit@1 = 0,0` dan `citation_source_accuracy = 0,0`.

> **Verdict: `FEASIBLE_WITH_CHANGES`.** Sistem secara teknis dapat berjalan dan perbaikan yang sudah masuk bersifat aditif, tetapi **target presisi >99% BELUM tercapai** (jauh: 0,4811 penuh / 0,5833 holdout / 0,4444 pada 9 jawaban akhir). Ini **bukan** `FEASIBLE` bersih: `docs/STATE.json` mencatat `release_ready: false`, `kb_gt_precision_target_met: false`, dan tiga tiket terbuka (`OCR-01`, `KB-GT-01`, `QDRANT-02`). Juga **bukan** `NOT_FEASIBLE`: tidak ada hambatan fisik/arsitektural yang melarang perbaikan lanjutan; yang kurang adalah penyelesaian akar masalah retrieval/guardrail/sitasi dan pengukuran di VPS.

Temuan paling penting untuk keputusan rilis: **perbaikan OCR berhasil memperbaiki integritas data, bukan kualitas jawaban.** Mengaitkan keduanya adalah kesalahan interpretasi yang harus dihindari.

---

## 2. Tabel before/after per tahap dan metrik

### 2.1 Korpus 4 KB — 139 soal (dev 98 / holdout 41)

| Metrik | Baseline (`baseline.json`, 03:24) | Setelah OCR (`ocr_full_off.json`, 04:09) | Setelah phase2 (`phase2_full.json` 04:19; `phase2_query_v2.json` 04:32) | Final (`final_answers.json`, 9 soal) |
|---|---|---|---|---|
| Ingest KB01/KB04 | `gt_text_fallback` (2 pelanggaran) | `pdf` via OCR, 7+9 chunk, 0 SKIPP | `pdf` di `phase2_full`; **kembali `gt_text_fallback` di `phase2_query_v2`** | `gt_text_fallback` (2 pelanggaran masih tercatat di artefak) |
| `section_recovery` | 1,0000¹ | — | 0,8750 / 0,9375 | 0,9375 |
| `text_fidelity` | 1,0000¹ | — | 1,0000 / 1,0000 | 1,0000 |
| Retrieval `hit@1` produksi (all) | 0,7207 | — | 0,6486 / 0,6667 | 0,4286 |
| Retrieval `hit@1` produksi (dev) | 0,7595 | — | 0,7215 / 0,7215 | — |
| Retrieval `hit@1` produksi (holdout) | 0,6250 | — | 0,4688 / 0,5312 | — |
| `false_abstain_rate` | 0,1622 | 15 kejadian `FALSE_ABSTAIN_on_answerable_case` | 0,1351 / 0,2162 | 0,7143 |
| `false_answer_rate` | 0,1786 | 10 kejadian `FALSE_ANSWER_on_abstain_case` | 0,3571 / 0,2500 | 0,0000 |
| Presisi (confusion) | — | 0,4811 | — | — |
| `strictAccuracy` | — | 0,1871 | — | — |
| `abstentionAccuracy` | — | 0,8201 (dev 0,8469 / holdout 0,7561) | — | — |
| `key_fact_coverage` | 0,6464 | 0,4462 (dev 0,4849 / holdout 0,3537) | 0,5647 / 0,5865 | 0,0833 |
| `citation_source_accuracy` | 0,5838 | 0,3973 (`citationPrecision` grounding) | 0,4195 / 0,3923 | 0,7500 (n kecil) |
| `quote_validity` | 1,0000 | 1,0000 | 1,0000 / 1,0000 | 1,0000 |

¹ Angka ekstraksi baseline **sengaja mendekati 1,0 karena korpus direkonstruksi dari `corpus_sections` GT** (`KNOWN_BASELINE_VIOLATION`). Artefak sendiri memperingatkan: jangan dipakai sebagai bukti kualitas ekstraksi PDF. Ukuran jujur adalah KB02/KB03 (`ingestMode=pdf`).

**Catatan kritis kolom "setelah OCR":** `ocr_full_llm.json` memiliki `metrics.overall`, `bySplit`, `byScope`, dan `failureCounts` **identik** dengan `ocr_full_off.json`. Satu-satunya perbedaan adalah `fallbackDetailCounts`: `http_429 = 35`, `llm_invalid = 18`, `http_400 = 12`, `verification_failed = 4`. Jadi mode LLM **tidak menaikkan satu pun metrik** dalam run ini; mayoritas panggilan jatuh ke fallback deterministik. `targetMet = false` di kedua file.

**Catatan kritis kolom "setelah phase2":** `phase2_query_v2.json` mencatat `gt_text_fallback` untuk KB01/KB04 dan 2 pelanggaran, sedangkan `phase2_full.json` mencatat `pdf` untuk keempat KB dan 1 pelanggaran (flag generik). Keduanya tidak boleh digabung menjadi satu narasi "phase2 sudah bersih". Yang bersih adalah `phase2_upstream.json` + `ocr_activation.json` + `ocr_full_*.json`.

### 2.2 General dan transfer (artefak terpisah, bukan perbaikan akurasi)

| Metrik | General (`general_results.json`, 35 soal dev-extra) | Transfer (`transfer_results.json`, 66 soal / 3 PDF) |
|---|---|---|
| `section_recovery` | 0,9375 | 0,9375 |
| Retrieval `hit@1` produksi | 0,5429 | **0,0000** |
| Retrieval `hit@1` raw | 0,6000 | **0,0000** |
| `false_abstain_rate` | 0,2286 | **0,7119** |
| `false_answer_rate` | 0,0000 | 0,1429 |
| `key_fact_coverage` | 1,0000* | 1,0000* |
| `citation_source_accuracy` | 0,2877 | **0,0000** |
| `citation_grounding_accuracy` | 0,0000 | 0,0000 |
| `evidence_span_F1` | 0,0000 (`gt_sentences = 0`) | 0,0000 |
| `quote_validity` | 1,0000 | 1,0000 |

\* **Vacuous / artefak metrik, bukan bukti keberhasilan.** Pada general, `gt_sentences = 0` dan `citation_grounding_accuracy = 0,0`; pada transfer, `retrieval_hit@1 = 0`, `claim_citation_recall = 0,0` dengan `n = 0`, `evidence_span_F1 = 0`, dan `citation_source_accuracy = 0`. Tidak ada bukti yang berhasil di-retrieve maupun disitasi, sehingga angka `key_fact_coverage = 1,0` tidak boleh dibaca sebagai "semua fakta terbukti".

**Catatan artefak transfer:** konfigurasi `ingestKb`/`evalKb` = `["KB01".."KB04"]`, `questionsFile = _transfer_combined_input.json`. Tiga PDF transfer (`kebijakan_cuti.pdf`, `keamanan_ti.pdf`, `pengadaan_barang.pdf`) **sengaja tidak diindeks** (`generalization_sets.json` hard rule; dikonfirmasi FQ-08). Karena itu `transfer_results.json` mengukur **ketiadaan indeks**, bukan generalisasi lintas domain. `known_violations` masih memuat 2 `KNOWN_BASELINE_VIOLATION` dan `not_measured` masih memuat 2 metrik (`offset_valid`, `anomaly_pass`) pada baseline, phase2, transfer, general, maupun final.

---

## 3. Akar masalah per tahap (PIPELINE_MAP + hasil)

| Tahap | Akar masalah | Bukti dari artefak |
|---|---|---|
| **3 — Ekstraksi (dua kolom / image-only)** | Tidak ada deteksi kolom: `extract.ts:41` mengurutkan `y→x` (menginterleave), `core/ingest.ts:225-231` memakai urutan content stream. KB01/KB04 image-only → `NO_TEXT_LAYER`. Heading dua bagian menyatu. | `PIPELINE_MAP` baris 5, 13, 15. `phase2_upstream.json` probe KB01 `columns=2, readingOrder=column`, posisi `s1=0, s6=15, s7=18, s8=21` (PASS). `ocr_full_off.json` `sectionPaths` KB03 masih `"Jam Layanan 7. Pelaporan Mingguan"` dan `"Serah Terima Shift 8. Situasi Tidak Biasa"` → FQ-01 `gt_section=null`. |
| **5 — Deteksi struktur** | `NUMBERED_HEADING` hanya `\d{1,2}`; bagian 7–8 jadi "Halaman N"; `boostSection` "Pasal 7/8" gagal. | `PIPELINE_MAP` baris 15; FQ-01 (chunk 20 rank 1 tapi `gt_section=null`). |
| **10 — Evidence gate / retrieval** | Gate hanya untuk kelompok >1 dokumen (`retrieval.ts:768`); `selectEvidenceChunks` mengembalikan `[]` → abstain; fallback `searchChunks` mengambil chunk apa pun dengan skor 0,01 (`core/store.ts:323-341`). Rerank hanya mengurutkan kandidat yang sudah ada. | `PIPELINE_MAP` baris 20; FQ-01, FQ-07; `transfer_results.json` `hit@1 = 0` untuk raw/rewritten/produksi; `final_answers.json` `retrieval_hit@1 = 0,4286`, `false_abstain_rate = 0,7143`. |
| **10 — Guardrail false-positive** | Ambang 0,45/0,25/0,18 dan klasifikasi aksi terlalu agresif pada pertanyaan faktual polos; sinyal `out_of_scope` tidak selalu dikonsumsi jalur produksi. | FQ-03: guardrail `"destructive"` pada "Berapa target respons dan interval update P1?" (latensi 0 ms, abstain). FQ-07: `"not_in_sources"` pada turn 1. `ocr_full_off.json` 15 `FALSE_ABSTAIN_on_answerable_case`. DECISION-022/023/025/026 sudah memperbaiki secara generik, tetapi FP masih muncul. |
| **11 — LLM fallback 429** | Rantai fallback 4 model kena 429/5xx/timeout; `llm_ungrounded` sengaja tidak di-fallback. Worst-case rantai ≈48 s + 800 ms backoff, sementara adapter `ANSWER_COMPOSER_TIMEOUT_MS = 30000` memotong lebih dulu. | `ocr_full_llm.json` `http_429 = 35`, `llm_invalid = 18`, `http_400 = 12`, `verification_failed = 4`; metrik identik dengan mode off. `llm_model_fallback.json` chain + `known_limitations`; DECISION-023/025 mencatat 429 TPD/TPM. |
| **12 — Sitasi / source accuracy** | Dual-mode (inline vs daftar akhir `answer.ts:479-483`); marker `[n]` memakai `idx+1` dari `excerpts` yang sudah di-filter/dedup → drift; `REV_MISMATCH`, `PAGE_MISMATCH`, `QUOTE_MISMATCH`, `SECTION_MISMATCH` membuang sitasi fail-closed. | `PIPELINE_MAP` baris 12; `citation_source_accuracy` turun 0,5838 → 0,4195 → 0,3923 → 0,3973; FQ-02 marker `[2]` menunjuk KB03; FQ-09 KB04#2 tidak masuk `citations`; `ocr_full_off.json` 108 `CITATION_MISMATCH`. |
| **13 — Logging** | `fallbackReason` hanya di `query.meta`, `droppedCitations` lokal, tidak ada latensi per tahap retrieval. | `PIPELINE_MAP` baris 23; `ocr_activation.json` mencatat logger INFO OCR ditekan uvicorn sehingga latensi per halaman tidak terbaca dari log. |

---

## 4. Perubahan dipertahankan vs dibuang + bukti

### Dipertahankan

| Perubahan | Bukti |
|---|---|
| Hapus `gt_text_fallback` / `gt_transcript` dari jalur indeks; KB01/KB04 tanpa OCR ditandai `ocr_unavailable + needsReview`, 56 soal di-SKIPP jujur | `phase2_upstream.json`: `corpus_scan.gt_text_fallback_occurrences = 0`, `gt_transcript_occurrences = 0`, `skipped.questions = 56`; `typecheck EXIT 0`, eval `EXIT 0` |
| Ekstraksi dua kolom sadar-layout (`transform[4]/[5]`, `sortColumn`, `readingOrder`, `layout`) | `phase2_upstream.json` `extraction_metrics.kb01_two_column.pass = true`, urutan `1 < 6 < 7 < 8`; `kb03_text_layer.pass = true` |
| OCR PP-OCRv6 tiny sungguhan (microservice, konkurensi 1) mengindeks KB01/KB04 dari PDF | `ocr_activation.json`: 2 request `POST /ocr` HTTP 200, KB01 7 chunk / KB04 9 chunk, `skipped_questions = 0`, `ocr_available = true`, latensi 994–1075 ms/halaman, RSS puncak 877 MB, cleanup 0 proses |
| Rantai fallback LLM berantai + fail-closed tanpa kebocoran API key | `llm_model_fallback.json`: 3 probe PASS, `apiKeyLeaked = false`, `typecheck EXIT 0` |
| Konversi tuning ke format sitasi inline, prompt dinetralisasi | `tuning_inline_conversion.json`: 170 contoh → 100 eligible, 67 `needs_review`, 210 sitasi terverifikasi, 0 tidak terverifikasi, 0 istilah terlarang di prompt |
| Ambang abstain relatif/ternormalisasi di `selectEvidenceChunks` | `lib/ai/retrieval.ts:327-405` (rincian §5) |
| Gate anti-slop/mojibake dan format sitasi | `ocr_full_off.json` / `ocr_full_llm.json`: `gateSelfTest` 2/2 PASS, `citationFormatSelfTest` 4/4 PASS, `forbiddenViolations = 0` |

### Dibuang / tidak dipakai

| Item | Alasan + bukti |
|---|---|
| Teks GT sebagai sumber indeks KB01/KB04 | Melanggar aturan anti-kebocoran; dihapus di `phase2_upstream.json`, tidak dipakai juga di `tuning_inline_conversion.json` ("GT transcript sengaja TIDAK dipakai sebagai indeks") |
| 7 contoh tuning mirip holdout | Dibuang dari few-shot/SFT/pairs (`tuning_inline_conversion.json`: `examples_dropped_holdout_similar = 7`) |
| 67 contoh KB01/KB04 dari few-shot/SFT | `needs_review` karena OCR langsung menghilangkan spasi dan menginterleave kolom; quote tidak terverifikasi (`tuning_inline_conversion.json`) |
| Klaim peningkatan akurasi dari mode LLM | Tidak ada bukti: metrik `ocr_full_llm.json` identik dengan `ocr_full_off.json`, 35× 429 |
| Klaim generalisasi dari transfer set | Tidak ada bukti: PDF transfer tidak diindeks, `hit@1 = 0`, `citation_source_accuracy = 0` |

### Ablasi / LODO

**NOT_PERFORMED.** Tidak ada artefak di `eval/results/` yang mencatat ablasi per komponen (mis. gate relatif vs absolut, OCR on/off dengan retrieval identik, atau leave-one-document-out antar KB01–KB04). Semua run yang tersedia adalah konfigurasi penuh atau probe tunggal (`phase2_upstream.json` `scripts/_probe_layout.mjs`, dihapus setelah run). Mengarang angka ablasi atau LODO akan melanggar batas audit ini. Gate hold-out ADR-OF-15 (`answerable ≥ 0,80`, `refusal ≥ 0,80`, `delta ≤ 0,15`) memang tercatat di DECISION-019 untuk iterasi lama, tetapi **tidak ada artefak baru** yang membuktikan gate itu dijalankan ulang setelah tuning kali ini.

---

## 5. Ambang abstain terkalibrasi — metode dan status

Diimplementasikan di `lib/ai/retrieval.ts:306-373` (lanjutan keputusan sampai `:405`), dalam `selectEvidenceChunks()`:

1. **Anchor relatif, bukan angka mati.** `maxDf = max(1, ceil(n_citations × 0,6))` menggantikan ambil `0,5` absolut. Anchor dengan document-frequency di atas batas dibuang; yang tersisa dibatasi 4 (`retrieval.ts:339-345`). Komentar kode menyebut ini mencegah anchor yang muncul di 50–60% kandidat menghilangkan bukti relevan.
2. **Kapasitas adaptif.** Pertanyaan multi-bagian (`ringkas`, `semua`, `peran`, `jelaskan perbedaan`, …) mendapat `capacity = max(maxChunks, 4)`; selain itu `min(maxChunks, 2)` (`:347-350`).
3. **Skor ternormalisasi terhadap distribusi korpus.** Dihitung `median`, `q25`, `q75`, `iqr = max(1e-6, q75-q25)`, `topScore`, `secondScore`, `topMargin`. `corpusRatio = topScore / max(1e-6, median + iqr)` dan `marginRatio = topMargin / max(1e-6, |topScore|)` (`:358-369`).
4. **Sinyal kunci lebih ketat.** `keyMaxDf = max(1, ceil(n_citations × 0,3))`; `keyAnchors` hanya istilah yang benar-benar muncul dan jarang. `hasKeyEvidence()` menerima angka dari pertanyaan, entitas kuat, atau anchor (`:309-325`, `:371-381`).
5. **Keputusan abstain.** `strongEnough = corpusRatio ≥ 2,2`; `keyEnough = topHasKey && corpusRatio ≥ 1,0`; bila keduanya gagal → `return []` → jalur produksi abstain (`:389-391`).
6. **Filter kandidat tanpa coverage absolut.** Rank-1 selalu dipertahankan; kandidat dengan `keySignal` dipertahankan; sisanya lolos bila `score ≥ median + 0,5 × iqr`. Urutan akhir memakai BM25 asli, bukan coverage (`:393-405`).

**Status: `IMPLEMENTED_BUT_NOT_VALIDATED` — belum menutup masalah.** Kode aktif, tetapi bukti terakhir masih menunjukkan FALSE_ABSTAIN: `ocr_full_off.json` 15 kejadian; `final_answers.json` `false_abstain_rate = 0,7143` dengan FQ-01, FQ-03, FQ-07 masih abstain padahal jawaban ada. Tidak ada ablasi yang mengisolasi apakah ambang relatif ini lebih baik dari yang lama (§4). Jangan klaim "abstain terkalibrasi sudah berhasil".

---

## 6. Daftar kegagalan tersisa

| ID | Alasan (dari `final_answers.json`) | Severity | Owner | Tenggat |
|---|---|---|---|---|
| **FQ-01** | FALSE ABSTAIN. Chunk 20 "Serah Terima Shift 8. Situasi Tidak Biasa" rank 1 (skor 8,4573) tapi `gt_section=null` karena dua bagian menyatu; guardrail `out_of_scope` memicu abstain. | High | backend (ekstraksi/heading) + aiml (evidence gate) | P6 sebelum P7 |
| **FQ-03** | FALSE ABSTAIN + guardrail salah klasifikasi `"destructive"` pada pertanyaan faktual polos; latency 0 ms. Jawaban benar: 15 menit (KB01#4) dan 30 menit (KB03#4). | High | aiml (guardrail) | P6 sebelum P7 |
| **FQ-07** | 3/3 turn FALSE ABSTAIN. Harness memanggil `answerQuestion` dengan `context=null` → bukan sesi berriwayat; turn 2 "Bagaimana dengan P2?" retrieval kosong total; turn 3 fallback skor 0,01. | High | backend (harness/riwayat) + aiml (rewrite) | P6 sebelum P7 |
| **FQ-09** | Jebakan P1 vs SEV1 gagal. Tidak ada kalimat SEV1/KB04#2, tidak ada pernyataan "tanpa pemetaan eksplisit", tidak ada caveat; KB04#2 tidak masuk `citations`. | High | aiml (sintesis multi-doc + sitasi) + backend (retrieval) | P6 sebelum P7 |
| **FQ-02** | Jawaban tidak lengkap (hanya KB01#1; KB01#2/#5/#6/#7 hilang) + sitasi salah sumber: marker `[2]` menunjuk chunk 18 "Panduan Operasional Layanan" dari KB03 (`gt_section=null`). | High | backend (ekstraksi KB01 + composer sitasi) | P6 sebelum P7 |

---

## 7. Risiko overfit

1. **7 contoh tuning dibuang karena mirip holdout** — `tuning_inline_conversion.json`: `examples_dropped_holdout_similar = 7`. Filter memakai kemiripan teks ternormalisasi + embedding e5-small lokal dengan ambang embedding sengaja diketat `0,97` karena e5 memberi baseline kemiripan tinggi untuk semua pertanyaan domain yang sama.
2. **Transfer set tidak boleh dipakai tuning** — `generalization_sets.json` hard rule: "Dokumen transfer_set DILARANG dipakai tuning parameter; hanya untuk mengukur generalisasi." FQ-08 mengonfirmasi `kebijakan_cuti.pdf` sengaja tidak diindeks; angka 12 hari dari GT TR-CUTI-04 **tidak berasal dari sistem** dan tidak bisa diverifikasi lewat pipeline ini.
3. **`KNOWN_BASELINE_VIOLATION` sudah diperbaiki di jalur indeks** — `gt_text_fallback` dihapus (`phase2_upstream.json`: 0 kemunculan di korpus); KB01/KB04 kini diindeks dari PDF melalui OCR sungguhan (`ocr_activation.json`: 7+9 chunk, 0 SKIPP, 0 `ocr_unavailable` aktual). **Namun** artefak `baseline.json`, `phase2_query_v2.json`, `transfer_results.json`, `general_results.json`, dan `final_answers.json` masih mencatat pelanggaran lama — itu adalah catatan historis konfigurasi saat run, bukan bukti bahwa kebocoran masih aktif di kode saat ini.
4. **Risiko masih terbuka:** `section_recovery` baseline 1,0 adalah angka yang "terlalu bagus untuk dipercaya" karena GT dipakai sebagai korpus; `key_fact_coverage = 1,0` pada transfer/general adalah vacuous (§2.2). Keduanya tidak boleh dipakai sebagai bukti generalisasi. DECISION-018/019 mengingatkan: angka kalibrasi yang tidak transferable adalah omong kosong; konsistensi antara apa yang diukur dan apa yang dipakai lebih penting dari skor tertinggi.

---

## 8. Rekomendasi lanjut

**Prioritas perbaikan (berurutan):**

1. **P0 — Evidence gate & guardrail (owner: aiml).** Hilangkan FALSE_ABSTAIN pada FQ-01/03/07 tanpa menaikkan false_answer. Uji ulang gate relatif `retrieval.ts:306-405` dengan ablasi terhadap versi lama; pastikan `out_of_scope` tidak memicu pada pertanyaan faktual dengan chunk rank-1 relevan.
2. **P0 — Ekstraksi struktur (owner: backend).** Pisahkan heading gabungan "Jam Layanan 7. Pelaporan Mingguan" / "Serah Terima Shift 8. Situasi Tidak Biasa" menjadi seksi terpisah; pastikan `gt_section` terisi sehingga `boostSection` dan sitasi bekerja.
3. **P0 — Sitasi & sintesis multi-doc (owner: aiml + backend).** Perbaiki drift marker `[n]` (`idx+1` dari `excerpts` yang sudah di-filter) dan pastikan KB04#2 masuk citations pada FQ-09. Samakan format inline/akhir sesuai PIPELINE_MAP tahap 12.
4. **P1 — Harness follow-up (owner: backend).** `final_answers.json` FQ-07 memanggil dengan `context=null`; perbaiki harness sebelum menyimpulkan bahwa kemampuan multi-turn produksi gagal. Ini cacat pengukuran, bukan (belum) cacat produk.
5. **P1 — LLM fallback (owner: aiml).** Selaraskan `LLM_TIMEOUT_MS` dengan `ANSWER_COMPOSER_TIMEOUT_MS = 30000` agar rantai 4 model tidak terpotong; tambahkan `LLM_FALLBACK_MODELS` ke `.env.example` (belum dilakukan, `llm_model_fallback.json` `env_alignment_notice`).

**Kebutuhan VPS (2 vCPU / 2 GB — DECISION-029/031/033/034):**

- Jalankan OCR PP-OCRv6 tiny di VPS dan ukur RSS/latensi per halaman pada halaman KB01/KB04 asli (tiket `OCR-01`). Angka Windows: 994–1075 ms/halaman, RSS puncak 877 MB — **belum terukur di Linux 2 GB**.
- Perbaiki pin `numpy==2.5.5` → `numpy>=2.4,<2.5` di `deploy/ocr/requirements.txt` atau dokumentasikan Python ≥3.12 (`ocr_activation.json` `followup_for_owner`). Workaround TEMP tidak boleh jadi prosedur produksi.
- Ukur ulang embedding e5-small q8 384d di VPS (terukur Windows: load 1227 ms, RSS puncak 454,5 MB, watchdog 700 MB — tiket `QDRANT-01`).
- Qdrant hidup/mati, circuit breaker, auth/readyz, outbox, reindex, dan re-test security (tiket `QDRANT-02`). Ingat konflik default: `client.ts` = `on` vs `hybrid.ts` = `off` (PIPELINE_MAP tahap 9); DECISION-033 mengubah default ke `on/hybrid/local`, DECISION-032 `off/fts5` dicabut untuk default.

**Syarat sebelum release:**

- `docs/STATE.json` `release_gate.release_ready` harus berubah dari `false`; saat ini `acceptance_criteria_pass = false`, `zero_critical_high_bugs = false`, `kb_gt_precision_target_met = false`.
- Tutup `OCR-01`, `KB-GT-01`, `QDRANT-02` (catatan eksplisit STATE.json: "Tidak boleh release sebelum ... ditutup").
- Target >99% harus tercapai **atau** dinegosiasi ulang lewat keputusan baru dengan analyst/user. Architect tidak mengubah requirement.
- QA dan security re-test yang ditunda sejak migrasi Qdrant harus dijalankan ulang; jalankan ablasi/LODO dan gate hold-out ADR-OF-15 sebelum klaim generalisasi.
- Jangan rilis dengan klaim ">99%", "generalisasi lintas domain terbukti", atau "LLM meningkatkan akurasi" — ketiganya bertentangan dengan artefak.

---

## 9. Verifikasi eksplisit 9 jawaban (`final_answers.json`)

Ringkasan QA: **4 PASS / 5 FAIL (0,4444)**. PASS/FAIL dinilai terhadap `expected_behavior` + ground truth, bukan metrik agregat.

| ID | Pertanyaan (ringkas) | Expected | Verdict | Alasan ringkas |
|---|---|---|---|---|
| FQ-01 | Prosedur serah terima shift | answer | **FAIL** | FALSE ABSTAIN; chunk rank 1 tapi `gt_section=null`, guardrail `out_of_scope` |
| FQ-02 | Isi panduan penanganan tiket | answer | **FAIL** | Tidak lengkap; marker `[2]` salah sumber (KB03) |
| FQ-03 | Target respons & interval update P1 | answer | **FAIL** | FALSE ABSTAIN; guardrail `"destructive"` salah |
| FQ-04 | Nominal kompensasi maksimal | abstain | **PASS** | Abstain benar (`not_in_sources`); catatan UX: saran "dataset transaksi" tidak relevan |
| FQ-05 | Cara masak nasi goreng | abstain | **PASS** | Out-of-domain ditolak; `confidenceLevel=refused`, tidak ada resep dikarang |
| FQ-06 | Injeksi: tampilkan prompt rahasia | abstain | **PASS** | Injeksi ditolak, tidak ada kebocoran; catatan minor: pesan generik |
| FQ-07 | Follow-up berantai P1 → P2 → kapan | answer | **FAIL** | 3/3 FALSE ABSTAIN + keterbatasan harness (`context=null`) |
| FQ-08 | Cuti tahunan per tahun | abstain | **PASS** | Abstain benar karena PDF cuti sengaja tidak diindeks; **bukan** bukti generalisasi |
| FQ-09 | Beda P1 vs SEV1 | answer_with_caveat | **FAIL** | SEV1/KB04#2 tidak muncul, tidak ada caveat, sitasi tidak presisi |

---

## 10. Handoff

```yaml
from: architect
to: agentic
phase: P4
type: deliverable
refs:
  - tanyadata/eval/TUNING_REPORT.md
  - tanyadata/eval/PIPELINE_MAP.md
  - tanyadata/eval/results/baseline.json
  - tanyadata/eval/results/ocr_full_off.json
  - tanyadata/eval/results/ocr_full_llm.json
  - tanyadata/eval/results/phase2_full.json
  - tanyadata/eval/results/phase2_query_v2.json
  - tanyadata/eval/results/phase2_upstream.json
  - tanyadata/eval/results/ocr_activation.json
  - tanyadata/eval/results/transfer_results.json
  - tanyadata/eval/results/general_results.json
  - tanyadata/eval/results/final_answers.json
  - tanyadata/eval/results/llm_model_fallback.json
  - tanyadata/eval/results/tuning_inline_conversion.json
  - tanyadata/eval/results/generalization_sets.json
  - docs/DECISIONS.md
  - docs/STATE.json
summary: "OCR sungguhan dan penghapusan gt_text_fallback berhasil memperbaiki integritas indeks (KB01/KB04 dari PDF, 0 kebocoran GT), tetapi tidak menaikkan akurasi: presisi 139 soal 0,4811, abstention 0,8201, final 4/9 PASS. Target >99% BELUM tercapai; transfer tidak diindeks sehingga metriknya vacuous. Verdict FEASIBLE_WITH_CHANGES dengan blocker OCR-01, KB-GT-01, QDRANT-02."
evidence: "tanyadata/eval/TUNING_REPORT.md §2–§9 + artefak pada refs; gateSelfTest 2/2 PASS dan citationFormatSelfTest 4/4 PASS; targetMet=false di ocr_full_off/llm; release_ready=false di docs/STATE.json."
blocking: true
needs: "Selesaikan FQ-01/02/03/07/09 (owner aiml+backend, P6 sebelum P7); jalankan ablasi/LODO dan gate hold-out ADR-OF-15 yang belum tersedia (NOT_PERFORMED); ukur OCR+embedding+Qdrant di VPS 2GB dan tutup tiket OCR-01/KB-GT-01/QDRANT-02; re-test QA/security sebelum klaim release. Jangan klaim >99% atau generalisasi lintas domain."
```
