# EVAL_RESULTS — Ground Truth AI Core

- Dijalankan: 2026-11-20T08:59:48.229Z
- Kasus: 12 (3 per fixture)
- Workspace: `C:\Users\aldya\AppData\Local\Temp\tanyadata-eval-23632-1795165187491\tanyadata.db` (sementara, dibuat ulang tiap run)
- Hasil keseluruhan: **PASS**

## Hasil per tahap

| Tahap | Metrik | Nilai | Ambang | Hasil |
|---|---|---:|---:|---|
| classification | accuracy | 1.0000 | ≥ 0.9000 | PASS |
| extraction | precision | 1.0000 | ≥ 0.8500 | PASS |
| extraction | recall | 0.8000 | ≥ 0.8000 | PASS |
| retrieval | citation_hit_rate | 1.0000 | ≥ 0.9000 | PASS |
| sql | execution_match | 1.0000 | ≥ 0.9000 | PASS |
| output | appropriateness | 1.0000 | ≥ 0.9000 | PASS |
| generation | hallucination_rate | 0.0000 | ≤ 0.0200 | PASS |
| guardrail | accuracy | 1.0000 | ≥ 0.9000 | PASS |

## Ringkasan per fixture

| Fixture | Kasus | Lulus | Gagal |
|---|---:|---:|---:|
| transaksi | 3 | 3 | 0 |
| legal | 3 | 1 | 2 |
| drilling | 3 | 3 | 0 |
| finansial | 3 | 3 | 0 |

## Detail kegagalan

### LEG-01 — legal [legal, quote, normal]

> Pasal 33 UUD 1945 berbunyi apa?

- **extraction FAIL**: tp_question=1 tp_document=2 extracted=2 expected=2 P=1 R=0.5

### LEG-02 — legal [legal, quote, normal]

> Bunyi Pasal 31 Ayat (1) UUD 1945?

- **extraction FAIL**: tp_question=1 tp_document=2 extracted=2 expected=2 P=1 R=0.5

## Catatan

- Eval dijalankan pada workspace DB sementara; seed analytics.db disalin ke tabel fisik tx_daily untuk kasus transaksi.
- Riwayat eksekusi lengkap dicatat di docs/EVAL_RESULTS.md. Bug produk sengaja DIBIARKAN agar laporan ini menjadi diagnosis jujur, bukan hasil yang dihijaukan.
- Kasus TX-03 gagal karena rule builder core tidak memiliki pola rate — temuan produk, bukan bug harness.
- FIN-03 memuat instruksi injeksi; guardrail AI lane diuji terpisah dari guardrail core.

Detail lengkap (jawaban, sitasi, SQL, angka, latensi) ada di `docs/EVAL_GROUND_TRUTH_RESULT.json`.
