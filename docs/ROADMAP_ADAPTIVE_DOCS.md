# ROADMAP — Adaptive Document Intelligence (All-in-One)

> Dibuat: 2026-11-25 oleh orchestrator `agentic` dari brief user.
> Status: PLANNED. Eksekusi DIMULAI HANYA setelah tiket prasyarat selesai (lihat §Urutan).
> Prinsip: yang belum terbukti mungkin → masuk lane riset dulu, bukan dijanjikan langsung.

## 1. Visi

TanyaData menjadi sistem dokumen adaptif: perilaku ingest → retrieval → penyusunan
jawaban → UI menyesuaikan **tipe dokumen, kelompok dokumen, dan isi dokumennya**.
Bukan hanya dokumen teks/SOP, tetapi juga id-card/KTP/paspor/SIM/kartu keluarga/NPWP/
tagihan utilitas/rekening koran — menjadi knowledge base terstruktur.

## 2. Workstream

### WS-A — Taksonomi dokumen (fondasi, wajib duluan)
- Tabel/registry tipe dokumen: `group` (finance, sop, legal, identity, transactional),
  `type` (laporan keuangan, KTP, paspor, ...), `id`.
- Classifier extend (`lib/ai/classifier.ts`) → hasil tipe tersimpan di metadata chunk.
- Semua workstream lain membaca registry ini. Tanpa ini, sisa epik = hardcode.

### WS-B — Composer & respons adaptif per tipe
- finance → jawaban + **dashboard per dokumen** (chart dari isi dokumen; owner backend+frontend).
- sop/legal → prosa terstruktur, sitasi pasal/bagian (sudah dekat; perlu diformalkan per tipe).
- sql/database → tampilan teknis (query ringkas, kolom, hasil tabular; persona engineer).
- Output template registry: per group/type, fallback = general.

### WS-C — OCR identity documents (KTP, paspor, SIM, KK, NPWP, tagihan/rekening)
- Extend pipeline OCR-01 (PP-OCRv6 + preprocessing + column-aware yang sudah selesai lokal):
  deskew/perspective correction, crop, glare/blur/occlusion detection saat capture,
  panduan retake real-time di UI.
- Field extraction per template (NIK, nama, TTL, dll.) dengan validasi format.
- Kualitas gambar buruk tetap harus bisa diekstrak sebanyak mungkin + label confidence per field.

### WS-D — UI adaptif + landing
- UI menyesuaikan tipe/kelompok dokumen: grouping, ikon, layout detail per tipe.
- **Landing page dikerjakan PALING AKHIR** (setelah WS-A..WS-C selesai dan ter-deploy):
  landing hanya boleh mengiklankan kemampuan yang benar-benar sudah ada, bukan janji.
- Isi pembaruan landing: copywriting kemampuan baru (identity OCR dengan koreksi
  skew/glare/blur + panduan retake, dashboard per dokumen finance, respons adaptif
  per tipe/kelompok dokumen), plus asset ikon baru yang konsisten dengan design system.
- Gate antislop/impeccable berlaku penuh; verifikasi wajib di browser (qa_app.py),
  bukan asumsi.

## 3. Urutan eksekusi (prasyarat keras)

**DEPLOY = PALING AKHIR.** Semua pekerjaan yang bisa diselesaikan lokal dikerjakan
lebih dulu; VPS/Vercel disentuh sekali di akhir.

**FASE 1 — tiket eksisting (lokal):** UI-LANDING-01 ✅, SEC-011 ✅, KB-GT-03(b) ✅,
KB-GT-05 (aiml, cross_doc recall).

**FASE 2 — epik adaptif (lokal):** WS-A (taksonomi dokumen) → WS-B (composer respons
adaptif per tipe: finance→dashboard, sop→prosa, sql→tampilan teknis) dan WS-C
(identity OCR: deskew/glare/blur/occlusion detection, panduan retake, field extraction
per template + confidence). WS-B dan WS-C boleh paralel setelah WS-A selesai.

**FASE 3 — UI adaptif:** grouping/ikon/layout per tipe & kelompok dokumen.

**FASE 4 — landing page:** paling akhir dari pekerjaan kode, karena landing hanya boleh
mengiklankan kemampuan yang sudah ada.

**FASE 5 — DEPLOY (terakhir, sekali jalan):**
- Rotasi/isi env VPS + Vercel.
- Backend VPS: `git pull` → `npm install` → migrasi DB → `npm run build` → restart service.
- Frontend Vercel: push → auto/Redeploy.
- Setelah deploy, baru jalankan verifikasi yang butuh infra: OCR-01 (service OCR hidup),
  QDRANT-01 (ukur RAM 2GB), QDRANT-02 (re-test live/circuit breaker/auth),
  KB-GT-04 (eval `--split all --mode llm` comparable), KB-GT-03(a) + GT-078 (KB01 OCR + hybrid).

Setiap fase diakhiri: verifikasi sekali (typecheck/build/eval/browser QA) → update
`docs/STATE.json` → handoff.

## 3.1 Di luar scope (keputusan user 2026-11-25, jangan dimasukkan ke fase/dokumen)

- Fairness audit lintas negara/geografi.
- On-device variants.
- Red-team suite dokumen tampered/recapture.
- (Semua di atas butuh dataset lintas geografi dan tim riset khusus — bukan scope
  aplikasi web ini.)

## 4. Deployment (untuk setiap rilis epik ini)

- VPS backend: `git pull` → `npm install` → migrasi DB (jika ada) → `npm run build` → restart service.
- Vercel frontend: push → auto/Redeploy; env baru ditambahkan di Project Settings dulu.
- Ditutor-kan step-by-step saat eksekusi, tidak dihafalkan sekarang.
