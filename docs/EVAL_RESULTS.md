# EVAL_RESULTS — Ground Truth AI Core

- Dijalankan: 2026-11-20T11:23:34.983Z
- Kasus: 12 legacy (3 per fixture) + 11 capability CORE V2
- Workspace: `C:\Users\aldya\AppData\Local\Temp\tanyadata-eval-14792-1795173813733\tanyadata.db` (sementara, dibuat ulang tiap run)
- Hasil keseluruhan: **PASS**

## Hasil per tahap

| Tahap | Metrik | Nilai | Ambang | Hasil |
|---|---|---:|---:|---|
| classification | accuracy | 1.0000 | ≥ 0.9000 | PASS |
| extraction | precision | 1.0000 | ≥ 0.8500 | PASS |
| extraction | recall | 1.0000 | ≥ 0.8000 | PASS |
| retrieval | citation_hit_rate | 1.0000 | ≥ 0.9000 | PASS |
| sql | execution_match | 1.0000 | ≥ 0.9000 | PASS |
| output | appropriateness | 1.0000 | ≥ 0.9000 | PASS |
| generation | hallucination_rate | 0.0000 | ≤ 0.0200 | PASS |
| guardrail | accuracy | 1.0000 | ≥ 0.9000 | PASS |

## Ringkasan per fixture

| Fixture | Kasus | Lulus | Gagal |
|---|---:|---:|---:|
| transaksi | 3 | 3 | 0 |
| legal | 3 | 3 | 0 |
| drilling | 3 | 3 | 0 |
| finansial | 3 | 3 | 0 |

## Detail kegagalan

_Tidak ada kasus yang gagal._

## Per-case gate (extraction recall)

- Ambang: recall ≥ 0.80 per kasus (hanya kasus dengan expected extraction fields).
- Dievaluasi: 7 kasus · Gagal: 0 · Hasil: **PASS**

## Eval_case CORE V2 (FR-A..FR-E)

- Hasil: **11/11 lulus** (target ≥ 8/11) — PASS

| ID | FR | Kemampuan | Hasil | Bukti |
|---|---|---|---|---|
| EV-A01 | A | ingest | PASS | ocr_pages=[] unreadable=[1] ocrUsed=false \| notice_ok=true |
| EV-A02 | A | ingest | PASS | ocr_pages=[2] unreadable=[] ocrUsed=true \| numeric_ok=true |
| EV-A03 | A | ingest | PASS | chunks=1 unique=true spans=[[1,2]] |
| EV-B01 | B | readjustment | PASS | ops=[{"op_type":"filter","resolved_filters":{"section_path":"Pasal 33"},"resolved_columns":null,"categories":null,"needs_clarification":false,"source":"section_registry"},{"op_type":"group_by","resolved_filters":null,"resolved_columns":["kanal"],"categories":null,"needs_clarification":false,"source":"schema_json"}] clarification=false \| invalid=[{"op_type":"group_by","resolved_filters":null,"resolved_columns":null,"categories":null,"needs_clarification":true,"source":"schema_json"}] |
| EV-B02 | B | readjustment | PASS | ops=[{"op_type":"report","resolved_filters":null,"resolved_columns":null,"categories":null,"needs_clarification":false,"source":"result_json"}] clarification=false |
| EV-C01 | C | scope | PASS | allowed=false type=scope_violation violations=["EVIDENCE_LEAK:sql:dataset=ds-b","EVIDENCE_LEAK:sql:source=doc-b"] |
| EV-C02 | C | scope | PASS | allowed=false type=cross_attachment_ref violations=["CROSS_ATTACHMENT_REFERENCE"] |
| EV-D01 | D | citation | PASS | valid \| rejected:MISSING_CHUNK |
| EV-D02 | D | citation | PASS | rejected:QUOTE_MISMATCH \| rejected:REV_MISMATCH |
| EV-E01 | E | share | PASS | scenario1:citations=true,link=true,self=true |
| EV-E02 | E | share | PASS | scenario1:citations=true,link=false,self=false \| scenario2:citations=true,link=true,self=true |

| FR | Kasus | Lulus |
|---|---:|---:|
| A | 3 | 3 |
| B | 2 | 2 |
| C | 2 | 2 |
| D | 2 | 2 |
| E | 2 | 2 |

## Implementasi AI V2 (P3-CORE-V2)

- **Readjustment deterministik** (`lib/ai/readjustment.ts`): regex → `ReadjustmentOp` (filter/group_by/classify/report) yang di-resolve terhadap `schema_json`/registry. Kolom atau bagian tak dikenal → `needs_clarification` + daftar nilai valid, bukan tebakan. `ReadjustmentOp` saat ini didefinisikan secara lokal karena `lib/core/contracts.ts` (milik backend) belum memilikinya; file itu sengaja tidak diubah.
- **Sitasi deep-link** (`lib/ai/retrieval.ts` + `lib/ai/output.ts`): `docId#page=&section=&chunk=&rev=` divalidasi fail-closed (doc READY, chunk nyata & parseable, halaman/section/rev/kutipan cocok). Sitasi tanpa chunk ditolak; sitasi invalid tidak bisa menaikkan level ke `strong`.
- **Scope per attachment** (`lib/ai/guardrails.ts`): hanya chunk/SQL dari attachment aktif yang boleh masuk; attachment belum `READY` dan referensi "dokumen sebelumnya" ditolak dengan pesan jujur.
- **Keterbatasan jujur:** FR-A/FR-E pada eval ini menguji permukaan kontrak AI-lane (perencanaan OCR, notifikasi halaman gagal, validasi sitasi di snapshot). OCR sungguhan, PDF/Excel, dan halaman share tetap lane backend/frontend dan diverifikasi manual di P5. Tidak ada model lokal, tidak ada panggilan jaringan saat eval.

## Catatan

- Eval dijalankan pada workspace DB sementara; seed analytics.db disalin ke tabel fisik tx_daily untuk kasus transaksi.
- Riwayat eksekusi lengkap dicatat di docs/EVAL_RESULTS.md. Bug produk sengaja DIBIARKAN agar laporan ini menjadi diagnosis jujur, bukan hasil yang dihijaukan.
- Kasus TX-03 gagal karena rule builder core tidak memiliki pola rate — temuan produk, bukan bug harness.
- FIN-03 memuat instruksi injeksi; guardrail AI lane diuji terpisah dari guardrail core.
- Per-case gate: extraction recall ≥ 0,80 diwajibkan per kasus; kasus di bawah ambang tetap FAIL walau semua metrik agregat PASS.
- Koreksi ground truth P3-TUNING: LEG-01/02 expected.extracted_fields.ayat diubah dari subset (1,2,3 / 1) menjadi 1,2,3,4,5 sesuai isi fixture legal/uud.json — Pasal 33 dan Pasal 31 masing-masing memuat 5 ayat. Untuk "Pasal 33 UUD 1945 berbunyi apa?" jawaban hukum yang benar adalah seluruh pasal. Ini koreksi label, BUKAN pelonggaran ambang: threshold recall agregat & per-case tetap 0,80 dan pipeline ekstraksi tidak diubah.
- 11 eval_case baru dari docs/CORE_V2_SPEC.md §10 (EV-A01…EV-E02).
- FR-A/FR-E dinilai pada permukaan kontrak AI-lane; OCR penuh & share UI tetap lane backend/frontend (P5 manual).
- Tidak ada model lokal, tidak ada jaringan, tidak ada retry; deterministik dan bisa diulang.

Detail lengkap (jawaban, sitasi, SQL, angka, latensi) ada di `docs/EVAL_GROUND_TRUTH_RESULT.json`.
