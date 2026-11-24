# BRIEF — TanyaData (AI-Powered Data Analytics Chatbot)

Sumber brief asli user (2026-11-19):

> saya ingin membuat website terkait dengan ketentuan ini Technical_Test_AI_Engineer.pdf yang mana ini sudah saya buat prdnya akan seperti apa ini dibuatnya PRD.md nah desain yang dibuat dan di slicing pun ada di folder stitch_tanyadata_precision_analytics_workspace\ nah tolong buatkan ini yaa.. terakhir itu ada terkait dengan dokumen yang diujinya itu di folder ai_chatbot_testdata\, orkestrasikan semuanya dan esksekusi dengan fokus itu pada pembuatan hingga selesai tanpa proses testing otomatis, testing akan dilakukan oleh saya lansung seluruhnya

## Interpretasi brief (mengikat)

1. Bangun aplikasi web **TanyaData** sesuai `docs/PRD.md` (turunan dari `docs/TECHNICAL_TEST.md`).
2. UI/UX **wajib mengikuti** desain Stitch di `stitch_tanyadata_precision_analytics_workspace/` (7 layar: public_landing_page, overview_dashboard, ai_assistant, data_sources, investigations, reports, settings) + `tanyadata_industrial_intelligence/DESIGN.md`.
3. Data uji **wajib memakai** paket `ai_chatbot_testdata/ai_chatbot_testdata/` (SQLite `analytics.db`, 5 dokumen, evaluation set). Salinan kerja ada di `tanyadata/data/`.
4. **Tidak ada testing otomatis** (tanpa Playwright/unit test/QA run). User akan menguji manual seluruhnya. Yang wajib: aplikasi bisa di-install, di-build, dan dijalankan; build/typecheck boleh dijalankan sekali di akhir sebagai syarat deliverable.
5. Aplikasi harus **berjalan penuh tanpa API key LLM**. Integrasi LLM bersifat opsional (env), dengan **deterministic analytics engine** sebagai default agar semua pertanyaan evaluasi (A1–F3) terjawab akurat dari data.
6. Target deploy: lokal (utama) dan Vercel-ready jika memungkinkan tanpa VPS. Tidak ada kredensial yang boleh di-hardcode.
7. Fokus: **selesai, runnable, sesuai PRD + desain + data uji**, bukan menambah scope di luar PRD.

## Referensi wajib per role

| Path | Isi | Status |
|---|---|---|
| `docs/PRD.md` | PRD lengkap 16 bagian | read-only |
| `docs/TECHNICAL_TEST.md` | Teks technical test asli | read-only |
| `docs/EVALUATION_QA.md` | 20+ pertanyaan uji + jawaban acuan + guardrail | read-only |
| `tanyadata/data/analytics.db` | SQLite 46.952 transaksi, 5 tabel | read-only (seed) |
| `tanyadata/data/seed/documents/` | PDF/DOCX/TXT/MD dokumen operasional | read-only (seed) |
| `stitch_tanyadata_precision_analytics_workspace/*/code.html` + `screen.png` | Desain sumber | read-only |
| `stitch_tanyadata_precision_analytics_workspace/tanyadata_industrial_intelligence/DESIGN.md` | Design system | read-only |

## Fakta data (dari README + evaluation)

- Periode: 2026-08-01 s.d. 2026-11-18. "Bulan ini" = November 2026 (parsial, 18 hari). Mata uang IDR.
- `transactions`: 46.952 baris; status SUCCESS | FAILED | PENDING | EXPIRED | REFUNDED; `failure_code` hanya saat FAILED.
- Success rate = SUCCESS/total; failure rate = FAILED/total (EXPIRED/PENDING/REFUNDED bukan FAILED).
- Pola tertanam: VA Mandiri (F04 BANK_TIMEOUT sejak 15 Okt, memburuk 3 Nov, jam 18–22), OVO (F05 GATEWAY_ERROR sejak 6 Nov, Top-up), distraktor (Kartu Kredit baseline tinggi, maintenance F12, lonjakan 11.11).
- Evaluasi mencakup guardrail: data di luar periode, pertanyaan di luar sumber, perintah destruktif, ambiguitas metrik, PII.

## Non-goals

- Multi-user/SSO/kolaborasi, real-time streaming, integrasi ERP, predictive forecasting, mobile native.
- Automated test suite (diminta eksplisit tidak ada).
- Klaim kausalitas tanpa bukti; sistem harus membedakan korelasi vs sebab terbukti.
