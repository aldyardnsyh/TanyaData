# KB_GT_REPORT — Presisi Ground Truth 4 KB (P3-MIGRATION)

- Dijalankan: 2026-11-24T04:03:47.708Z · role `aiml` · fase `P3-MIGRATION`
- Split: **dev** · mode: **off** · deterministik: **ya**
- Soal: **20/139** (GT: ground_truth_KB01_penanganan_tiket_layanan.json, ground_truth_KB02_pengelolaan_keluhan_pelanggan.json, ground_truth_KB03_panduan_operasional_layanan.json, ground_truth_KB04_eskalasi_dan_insiden.json)
- Workspace temporer: `C:\Users\aldya\AppData\Local\Temp\opencode\kb-gt-19004-1795493022234` (dibersihkan setelah run; `data/seed/documents/` asli TIDAK disentuh)
- TARGET_MET (precision ≥ 0.99 & abstention ≥ 0.99): **NO**

## Ringkasan metrik

| Grup | N | Precision | Recall | F1 | Strict acc | Abstention acc | Key-fact cov | Evidence grounding | Cit-P | Cit-R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **OVERALL** | 20 | 0.4706 | 0.7273 | 0.5714 | 0.0000 | 0.8500 | 0.4667 | 0.5500 | 0.3750 | 0.4531 |
| split:dev | 20 | 0.4706 | 0.7273 | 0.5714 | 0.0000 | 0.8500 | 0.4667 | 0.5500 | 0.3750 | 0.4531 |
| scope:single_doc | 14 | 0.6667 | 0.8000 | 0.7273 | 0.0000 | 0.8571 | 0.5714 | 0.6429 | 0.3462 | 0.6207 |
| scope:cross_doc | 6 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.8333 | 0.2222 | 0.3333 | 0.4286 | 0.3143 |
| dev/single_doc | 14 | 0.6667 | 0.8000 | 0.7273 | 0.0000 | 0.8571 | 0.5714 | 0.6429 | 0.3462 | 0.6207 |
| dev/cross_doc | 6 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.8333 | 0.2222 | 0.3333 | 0.4286 | 0.3143 |

- Confusion (keputusan): TP=8 · FP=9 · FN=3 · TN=0
- Transparansi metode: key-fact grounding=0.4667 vs literal_exact=0.4417 · citation grounding P=0.3750/R=0.4531 vs id_exact P=0.3889/R=0.4242
- Total forbidden-claim violation (heuristik): **0**

## Mode kegagalan

| Mode | Jumlah |
|---|---:|
| CITATION_MISMATCH | 19 |
| KEY_FACT_MISS | 12 |
| EVIDENCE_GROUNDING | 10 |
| FALSE_ABSTAIN_on_answerable_case | 3 |

## Gate anti-slop / mojibake (test case tetap)

| Test case | Input | Output | Angka terjaga | Hasil |
|---|---|---|---|---|
| mojibake + slop + live claim | `Berikut adalah data live hasilÃ© â€œanalisisâ€ � Target respons 15 menit.` | `hasilé "analisis" Target respons 15 menit.` | ya | PASS |
| slop pembuka panjang + angka tetap | `Dalam dunia yang semakin kompleks, berikut adalah jawabannya: eskalasi SEV1 dalam 30 menit…` | `jawabannya: eskalasi SEV1 dalam 30 menit.` | ya | PASS |

## Ingest korpus

| KB | PDF | Mode | Chunk | Needs review | Alasan skip |
|---|---|---|---:|---|---|
| KB01 | KB_01_Penanganan_Tiket_Layanan.pdf | pdf | 7 | tidak | — |
| KB02 | KB_02_Pengelolaan_Keluhan_Pelanggan.pdf | pdf | 9 | tidak | — |
| KB03 | KB_03_Panduan_Operasional_Layanan.pdf | pdf | 7 | tidak | — |
| KB04 | KB_04_Eskalasi_dan_Insiden.pdf | pdf | 9 | tidak | — |

OCR tersedia: **ya** · soal SKIPPED: **0** · GT dipakai untuk validasi saja, bukan teks indeks.

## Keterbatasan jujur & rekomendasi

- GT tidak diubah. Ambang tidak diturunkan. Tuning hanya memakai split dev; holdout dijalankan sekali pada --split all.
- KB01 dan KB04 adalah PDF image-only (getTextContent() = 0 item). Bila OCR tidak tersedia/gagal, keduanya ditandai ingestMode=ocr_unavailable/ocr_failed + needsReview=true dan seluruh soalnya di-SKIPP. corpus_sections GT HANYA dipakai untuk validasi, TIDAK pernah masuk korpus/indeks. KB02/KB03 memakai PDF asli.
- Semua 4 dataset dijadikan retrievalDatasetIds untuk setiap soal (mode knowledge-base). datasetId aktif = dokumen asal soal. Ini jalur produksi yang sama dengan chip "Semua dokumen".
- precision/recall/F1 dihitung dari confusion matrix keputusan: TP=answerable&benar, FP=abstain-case dijawab ATAU answerable dengan klaim terlarang/fakta kurang, FN=answerable di-abstain, TN=abstain-case di-abstain.
- Deteksi forbidden_claim bersifat heuristik-konservatif: nilai angka/kode yang tidak ada di evidence dihitung sebagai pelanggaran; klaim generik "mengarang angka/nama/prosedur" diukur lewat abstention + numeric grounding. Setiap pelanggaran dicantumkan per-soal di cases[].metrics.forbiddenViolations untuk audit.
- citation/source_section match (METODE LAMA, `citation_id_exact`) memetakan chunk_id produksi ke section_id GT lewat kesetaraan teks. Disimpan sebagai angka transparan, BUKAN lagi penentu skor.
- PERBAIKAN ADIL (P6): metode utama `citationPrecision/citationRecall` kini mengukur GROUNDING — sebuah sitasi benar bila chunk yang disitasi benar-benar mengandung evidence_spans/evidence_text GT. Recall = fraksi bukti GT yang tercakup chunk tersitasi. Ambang tidak diturunkan; bukti tetap wajib hadir.
- PERBAIKAN ADIL (P6): `keyFactCoverage` kini mengukur grounding, bukan kecocokan literal parafrasa. 249/373 key_facts GT adalah parafrasa yang tidak muncul literal di evidence manapun — menguji string literal adalah proxy cacat. Sebuah fakta dianggap terbukti bila teks bukti pendukungnya (overlap token konten ≥ 0.5) hadir di jawaban/sitasi. Tanpa bukti pendukung → jatuh ke literal. Metode lama disimpan sebagai `keyFactLiteralCoverage`.
- Exit 0 berarti evaluasi selesai terukur; TARGET_MET dicetak terpisah agar angka di bawah 99% tidak disembunyikan.

### Rekomendasi konkret (target belum tercapai)

1. Perbaiki retrieval pada mode kegagalan teratas di tabel di atas — bukan dengan menurunkan ambang, melainkan dengan menaikkan kualitas chunk/entity boost pada `lib/ai/retrieval.ts`.
2. Untuk `FALSE_ABSTAIN`, periksa `answerabilitySupport` dan sinonim di `lib/ai/guardrails.ts`; parafrasa sah harus tetap dijawab dari bukti.
3. Untuk `FALSE_ANSWER`, perketat `checkGuardrails` agar tidak menjawab dari chunk yang hanya OR-match tanpa kalimat bukti pendukung.
4. Ulangi tuning HANYA pada `dev`; jalankan `holdout` sekali setelah perubahan selesai.

Bukti per-soal (jawaban, sitasi, metrik, failure mode) ada di `docs/KB_GT_RESULT.json` → `cases[]`.

## Handoff

```yaml
from: aiml
to: agentic
phase: P3
type: deliverable
refs: [docs/KB_GT_REPORT.md, docs/KB_GT_RESULT.json, docs/QDRANT_AIML_IMPL.md, tanyadata/lib/ai/retrieval.ts, tanyadata/lib/ai/answer-gate.ts, tanyadata/lib/ai/adapter.ts, tanyadata/scripts/eval-kb-ground-truth.mjs]
summary: "Eval ground-truth 4 KB (20 soal, mode=off): precision=0.4706, abstention=0.8500, Cit-P=0.3750; gate anti-slop/mojibake 2/2 PASS; fallback FTS5 + LLM gagal → deterministik + flag jujur."
evidence: docs/KB_GT_RESULT.json cases[] + docs/QDRANT_AIML_IMPL.md + log safe_exec (typecheck + 4 eval existing)
blocking: false
needs: QA menguji input normal/aneh/kosong/panjang dan verifikasi fallback (Qdrant mati, LLM 429) di UI; target 0.99 belum terukur tercapai — jangan klaim >99%.
```
