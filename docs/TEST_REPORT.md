# TEST_REPORT — TanyaData (P5-VERIFY)

**Versi:** 1.0 · **Tanggal:** 2026-11-23 · **Oleh:** qa · **Fase:** P5-VERIFY
**Input:** `docs/SPEC.md` (39 AC), `docs/EVALUATION_QA.md`, `docs/ARCHITECTURE_REVIEW_P4.md`, `docs/SECURITY_REPORT.md`
**Sumber bukti:** sesi browser QA `C:\Users\aldya\.browserqa\artifacts\20261123-160948-tanyadata-p5-qa\` (screenshot `01-…` s.d. `26-…` dan `fail-step*.png`) serta snapshot teks di `C:\Users\aldya\.browserqa\artifacts\snaps\snap-1795425*.txt`.
**Metode:** eksplorasi UI nyata via browser automation (Chromium, `http://127.0.0.1:3210`), viewport 1440 / 1024 / 768 / 390 px. Laporan ini disusun **dari artefak sesi yang sudah ada**; tidak ada restart server, tidak ada eksekusi shell/browser baru, tidak ada kode yang diubah.
**Konvensi bukti:** `fail-step*.png` = langkah suite yang gagal → **FAIL / NOT_TESTED**, bukan PASS. Screenshot bernomor yang menampilkan halaman/keadaan yang berbeda dari nama filenya juga dicatat sebagai bukti kegagalan langkah (mis. `06-overview-redirect.png` justru menampilkan `/data-sources`).

---

## 1. Ringkasan eksekutif

### Verdict: **DO-NOT-SHIP** — 11 bug FAIL pada jalur inti, 0 bug Critical/High boleh dibiarkan terbuka untuk P7.

| Metrik | Nilai |
|---|---|
| Total acceptance criteria (FR-01…FR-07) | **39** |
| PASS penuh | **4** (10,3 %) |
| PARTIAL | **5** (12,8 %) |
| FAIL | **11** (28,2 %) |
| NOT_TESTED | **19** (48,7 %) |
| Pass rate ketat (PASS/39) | **10,3 %** |
| Pass rate dengan kredit parsial (PASS + ½·PARTIAL)/39 | **16,7 %** |
| Bug Critical | 3 (BUG-001, BUG-002, BUG-003) |
| Bug High | 4 (BUG-004…BUG-007) |
| Bug Medium | 4 (BUG-008…BUG-011) |
| Bug Low / perlu konfirmasi | 1 (BUG-012) |
| AC Must (M-01…M-13) yang PASS penuh | **0 dari 13** |

**Temuan utama:** aplikasi **berjalan dan dapat dinavigasi** (landing, assistant, data-sources, investigations, reports, settings semuanya render), tetapi **mesin jawabannya tidak memenuhi spesifikasi**. Tiga kegagalan saling memperparah:

1. **Angka SQL salah** — jawaban "Berapa total transaksi pada bulan ini?" menampilkan **7674**, bukan **8.125**, dan tabel pendukungnya bukan hasil agregasi yang diminta (AC-02.1, G-02).
2. **Routing intent salah** — pertanyaan metrik/tren/perbandingan (A3, B1, B2, C1, C2) diberi label `rag` dan dijawab dari dokumen, bukan dari database (AC-AI-01, G-02).
3. **Korpus seed tercemar** — 9 dokumen terindeks, bukan 6; tiga dokumen asing (Perpres_76_2013, Pemantauan_Apnea IoT, skripsi inventory `src_e122d5ce`) muncul sebagai sitasi di jawaban chat **dan** di laporan yang diekspor (AC-03.1, NFR-09).

Dampak hilir: investigasi memakai angka yang berbeda dari acuan (VA Mandiri +121 vs ±119; OVO +64 vs ±56,8), laporan tersimpan memakai template "LAPORAN RISET DOKUMEN" dengan kutipan skripsi, dan guardrail F3-1 (Desember 2026) justru mengarang kutipan Perpres 2013.

**Area yang benar-benar lolos:** sitasi dokumen dengan nama+bagian+potongan teks (AC-04.2, AC-04.3), pelabelan korelasi vs kausalitas sebagai "Indikasi" pada investigasi (AC-05.4), daftar investigasi tersimpan (AC-05.5), navigasi keyboard "Lewati ke konten utama" (NFR-12 dasar), dan tampilan responsif landing 390 px (NFR-11 sebagian).

**Kaitan dengan lane lain:** temuan ini mengonfirmasi kekhawatiran `ARCHITECTURE_REVIEW_P4.md` (dual engine K-4/N-1, AC-07.2 tidak terpenuhi K-2) dan `SECURITY_REPORT.md` (share bearer/noindex SEC-002). QA tidak memperbaiki kode; semua ticket diserahkan ke owner.

---

## 2. Matriks AC → Status → Bukti

Status: **PASS** = criteria terpenuhi penuh · **PARTIAL** = sebagian terpenuhi · **FAIL** = terbukti salah · **NOT_TESTED** = tidak ada bukti/langkah tidak mencapai state.

### FR-01 — Analytics Dashboard (AC-01.1…01.6)

| AC | Status | Bukti / catatan |
|---|---|---|
| AC-01.1 KPI 8.125 / 7.537 / 399 / 92,76 % / 4,91 % | **NOT_TESTED** | Tidak ada snapshot `/overview` di artefak. `06-overview-redirect.png` justru menampilkan halaman `/data-sources` → navigasi Overview tidak mencapai target (BUG-009). |
| AC-01.2 Filter status `FAILED` → Total 399, SR 0 % | **NOT_TESTED** | Tidak ada snapshot interaksi filter apa pun. |
| AC-01.3 Granularitas weekly | **NOT_TESTED** | Tidak ada snapshot pilihan tren. |
| AC-01.4 Label periode parsial "1–18 Nov 2026, bulan berjalan belum lengkap" | **NOT_TESTED** | Label "1–18 Nov 2026" tampil di Settings (`snap-1795425199765.txt:51-53`), bukan di Overview. |
| AC-01.5 Empty state "tidak ada data" | **NOT_TESTED** | Tidak ada skenario 0 baris yang terekam. |
| AC-01.6 Recent Insights ≥ 3 temuan | **NOT_TESTED** | Tidak ada snapshot kartu Recent Insights. |

### FR-02 — AI Chat Assistant (AC-02.1…02.7)

| AC | Status | Bukti / catatan |
|---|---|---|
| AC-02.1 Jawaban memuat 8.125 + periode + catatan parsial | **FAIL** | `snap-1795424997687.txt:43-132` — jawaban berisi kutipan dokumen, tabel "Data pendukung" = **7674**, tanpa 8.125. Visual: `07-assistant-answers.png`, `fail-step36.png`. (BUG-001) |
| AC-02.2 Query transparency: SQL SELECT aktual tampil | **NOT_TESTED** | Footer "SQL · 1–18 Nov 2026" ada, tetapi teks SQL tidak terekam; `08-sql-transparency.png` menampilkan percakapan, bukan panel SQL. |
| AC-02.3 Follow-up merujuk VA Mandiri lalu OVO tanpa ulang konteks | **FAIL** | `snap-1795425081436.txt:719-734` menyebut VA Mandiri (tanpa angka/OVO); `:735-763` "Sejak kapan perubahan itu terjadi?" dijawab dengan F12 + kutipan apnea monitor. Visual `08-sql-transparency.png`. (BUG-005) |
| AC-02.4 Pertanyaan di luar data → nyatakan keterbatasan | **FAIL** | "Siapa CEO…?" benar (`:693-699`), tetapi "Berapa total transaksi Desember 2026?" dijawab dengan kutipan Perpres 2013 + angka 7674 (`:645-692`). (BUG-004) |
| AC-02.5 Riwayat ≥ 2, buka lama, buat/hapus | **PARTIAL** | 3 percakapan tampil, tombol "Baru" dan menu ada (`snap-1795424997687.txt:29-39`; `11-assistant-history.png`); buka percakapan lama & hapus tidak terekam. |
| AC-02.6 Klik sitasi → nama dokumen, bagian, kutipan | **PARTIAL** | Link sitasi memuat nama+bagian di URL dan kutipan tampil inline (`snap-1795424997687.txt:50-118`); drawer pratinjau tidak terekam (`09-citation-drawer.png` menampilkan chat biasa). |
| AC-02.7 Tabel ↔ grafik identik | **NOT_TESTED** | Tidak ada snapshot toggle grafik. |

### FR-03 — Data Sources Management (AC-03.1…03.6)

| AC | Status | Bukti / catatan |
|---|---|---|
| AC-03.1 7 sumber seed (1 dataset + 6 dokumen) `Ready` | **FAIL** | `snap-1795424994603.txt:33-47,72-81` — **10 sumber / 9 dokumen**, termasuk Perpres_76_2013, Pemantauan_Apnea…, dan (halaman 2) skripsi inventory. Visual `12-data-sources.png`. (BUG-003) |
| AC-03.2 Upload CSV valid → `Uploaded → Processing → Ready` | **NOT_TESTED** | `14-upload-valid.png` menampilkan `/data-sources` tanpa hasil upload; tidak ada snapshot status `Ready` baru. |
| AC-03.3 File invalid ditolak dengan pesan spesifik, status `Failed` | **NOT_TESTED** | Tidak ada bukti UI. (Catatan: security lane membuktikan `evil.exe → 415` via curl, bukan UI QA.) |
| AC-03.4 Dataset Detail: skema, sample ≥ 5, kualitas (missing/duplikat) | **FAIL** | `snap-1795425195653.txt:29-56` menampilkan 14 kolom & 20 sample, tetapi **tanpa ringkasan kualitas**; "Potongan terindeks: Belum dihitung", "Ukuran berkas: 0 B". `13-dataset-detail.png` justru menampilkan `/data-sources`. (BUG-010) |
| AC-03.5 Hapus sumber → konfirmasi, hilang dari daftar & selector | **NOT_TESTED** | `15-delete-confirm.png` menampilkan `/data-sources` tanpa dialog konfirmasi. |
| AC-03.6 Dokumen `Processing` tidak bisa dipakai | **NOT_TESTED** | Tidak ada dokumen berstatus `Processing` dalam artefak ("Sumber diproses 0"). |

### FR-04 — Document Intelligence (AC-04.1…04.5)

| AC | Status | Bukti / catatan |
|---|---|---|
| AC-04.1 7 langkah SOP + SOP-TRX-003 bagian 4 | **FAIL** | `snap-1795425014577.txt:442-464` memberi narasi ringkas + sitasi "Prosedur Umum Penanganan Transaksi Gagal"; daftar di `snap-1795425000177.txt:148-209` hanya **Langkah 1–6**; tidak ada sebutan "bagian 4". (BUG-011) |
| AC-04.2 SLA 4 kanal + ≥ 2 sitasi | **PASS** | `snap-1795425016522.txt:468-522` — VA 3 hari kerja, E-Wallet 2×24 jam, QRIS 2 hari kerja, Kartu Kredit 7–14 hari kerja, sitasi [1][2][3]. |
| AC-04.3 Jawaban tidak ada di dokumen → tidak mengarang | **PASS** | `snap-1795425081436.txt:693-699` — "Pertanyaan ini di luar cakupan dataset…". (Catatan: kasus Desember 2026 gagal dan ditanggung AC-02.4/BUG-004.) |
| AC-04.4 Document Management: format, ukuran, status, chunk, reindex/hapus | **NOT_TESTED** | Tidak ada snapshot `/data-sources/documents`; daftar sumber hanya menampilkan format+ukuran. |
| AC-04.5 Upload `.docx`/`.pdf` user dapat dikutip | **NOT_TESTED** | Tidak ada bukti upload dokumen user. |

### FR-05 — Investigation & Insights (AC-05.1…05.5)

| AC | Status | Bukti / catatan |
|---|---|---|
| AC-05.1 4,91 % vs 3,30 % Okt + selisih | **FAIL** | `snap-1795425198156.txt:48-54` — "Failure rate **4,9 %** / BASELINE **3,0 %**" (1 desimal, bukan 4,91/3,30). (BUG-006) |
| AC-05.2 VA Mandiri 16,17 %, ±119; OVO 9,29 %, ±56,8 | **FAIL** | `snap-1795425198156.txt:61-66` — "VA Mandiri **+121 gagal**, 16,2 %"; "OVO **+64 gagal**, 9,3 %". Detail sumber: "+120.6 gagal" (`snap-1795425195653.txt:416`). (BUG-006) |
| AC-05.3 VA Mandiri ≈15 Okt / ≈3 Nov; OVO 6 Nov + agregasi | **PARTIAL** | `snap-1795425198156.txt:134-163` — 2026-10-15 start, 2026-11-06 OVO start, tetapi "3 Nov" tidak eksplisit (ada 11-02, 11-09). |
| AC-05.4 Label "indikasi/dugaan", bukan sebab terbukti | **PASS** | `snap-1795425198156.txt:44-46,123-126` — "Indikasi", "Data menunjukkan indikasi, bukan sebab terbukti", "bukan inferensi kausal". |
| AC-05.5 Investigasi tersimpan di `/investigations` + tautan bukti | **PASS** | `snap-1795425191070.txt:42-48` — 2 dossier dengan pertanyaan, periode, "Indikasi", tanggal, link detail. |

### FR-06 — Reports & Analysis (AC-06.1…06.5)

| AC | Status | Bukti / catatan |
|---|---|---|
| AC-06.1 Simpan laporan berisi ringkasan, findings, metrik, tabel/grafik, referensi | **FAIL** | `snap-1795425198636.txt:89-130` — "LAPORAN RISET DOKUMEN", "Ditarik dari isi dokumen terindeks", 4 temuan berupa kutipan, sitasi `src_e122d5ce` (skripsi inventory); tidak ada tabel metrik. Toast "Laporan disimpan" di `10-share-modal.png`. (BUG-007) |
| AC-06.2 Buka ulang, angka identik tanpa drift | **NOT_TESTED** | Pratinjau laporan tidak memuat angka metrik yang bisa dibandingkan dengan jawaban asal. |
| AC-06.3 Ekspor CSV (tabular) + PDF (ringkasan) | **PARTIAL** | Tautan "Unduh PDF", "Ekspor CSV", "Ekspor XLSX" ada (`snap-1795425198636.txt:131-136`); unduhan aktual tidak terekam. |
| AC-06.4 File ekspor konsisten dengan tampilan | **NOT_TESTED** | Tidak ada artefak file hasil unduhan. |
| AC-06.5 Empty state `/reports` + tautan ke Assistant | **NOT_TESTED** | 4 laporan sudah ada; tautan "Buat dari asisten" tampil (`snap-1795425198636.txt:33-36`), empty state tidak teramati. |

### FR-07 — Workspace Settings (AC-07.1…07.5)

| AC | Status | Bukti / catatan |
|---|---|---|
| AC-07.1 Bahasa EN mengubah nav, tombol, pesan sistem | **FAIL** | `snap-1795425224390.txt:10-20,57-82` + `22-settings-en.png` — nav & tombol tetap ID ("Asisten, Sumber Data, Investigasi, Laporan, Pengaturan", "Simpan perubahan", "Buang", "Dokumen, Bahasa, Rentang bawaan, Grafik, Umum"); hanya "English/EN" yang berubah. (BUG-008) |
| AC-07.2 Default date range 1 Sep–18 Nov berlaku di Overview + header | **FAIL** | UI hanya menyediakan "Bulan ini / 7 hari / 30 hari / Kustom" (`snap-1795425199765.txt:73-79`); tidak ada snapshot penerapan di Overview. Diperkuat `ARCHITECTURE_REVIEW_P4.md` K-2: `lib/api/dashboard.ts:30-49` mengabaikan `settings.dateRange`. |
| AC-07.3 Ganti dataset aktif → seluruh modul memakainya | **NOT_TESTED** | Hanya 1 dataset tersedia di seed; prasyarat tidak terpenuhi. |
| AC-07.4 Profil tersimpan setelah reload | **PARTIAL** | Status "Tersimpan · PENGATURAN LOKAL · TANPA AKUN" dan pilihan EN bertahan antar-snapshot (`snap-1795425199765.txt` → `snap-1795425224390.txt`); kolom profil tidak ada. |
| AC-07.5 EN aktif + pertanyaan ID tetap dijawab benar | **NOT_TESTED** | Tidak ada snapshot pertanyaan Bahasa Indonesia saat UI EN. (Mobile EN justru menampilkan "Ask about **0** indexed documents" — `05-assistant-390.png`, bagian BUG-008.) |

### Ringkasan per requirement

| Requirement | PASS | PARTIAL | FAIL | NOT_TESTED | Total |
|---|---|---|---|---|---|
| FR-01 Dashboard | 0 | 0 | 0 | 6 | 6 |
| FR-02 Chat | 0 | 2 | 3 | 2 | 7 |
| FR-03 Data Sources | 0 | 0 | 2 | 4 | 6 |
| FR-04 Documents | 2 | 0 | 1 | 2 | 5 |
| FR-05 Investigations | 2 | 1 | 2 | 0 | 5 |
| FR-06 Reports | 0 | 1 | 1 | 3 | 5 |
| FR-07 Settings | 0 | 1 | 2 | 2 | 5 |
| **TOTAL** | **4** | **5** | **11** | **19** | **39** |

---

## 3. Daftar bug

> Satu bug = satu ticket. Sudah dicek duplikat: BUG-001 (angka) berbeda dengan BUG-002 (routing) berbeda dengan BUG-003 (korpus), meski ketiganya muncul di jawaban yang sama. BUG-006 (angka investigasi) tidak sama dengan BUG-001 (angka chat).

### BUG-001 — Jawaban SQL mengembalikan angka salah dan kutipan dokumen asing

- **ID:** BUG-001
- **Judul:** Jawaban "total transaksi bulan ini" = 7674 dan narasi RAG, bukan 8.125 dari SQL
- **Severity:** **Critical**
- **Requirement:** AC-02.1, AC-AI-04, G-02, NFR-09, M-03
- **Lingkungan:** Chromium (browser-qa-py), `http://127.0.0.1:3210/assistant`, 1440 px, 2026-11-23, sesi `20261123-160948-tanyadata-p5-qa`
- **Langkah reproduksi:**
  1. Buka `/assistant` dan klik **Baru** (percakapan baru).
  2. Ketik `Berapa total transaksi pada bulan ini?` lalu kirim.
  3. Tunggu jawaban selesai, lalu lihat bagian "Data pendukung" dan narasi jawaban.
- **Expected:** angka **8.125**, periode **1–18 Nov 2026**, catatan bulan berjalan parsial, tabel hasil agregasi `COUNT(*)` (AC-02.1 / `EVALUATION_QA.md` A1).
- **Actual:** narasi "Berikut kutipan dari sumber: **Catatan Interpretasi Metrik** … **Pelaporan** … **Catatan Insiden** … **BAB II** skripsi inventory …"; tabel "Data pendukung" berisi satu baris **`value = 7674`**; tidak ada 8.125 dan tidak ada catatan parsial di jawaban langsung.
- **Bukti:** `snap-1795424997687.txt:43-132`; `snap-1795425000177.txt:122-131`; `07-assistant-answers.png`; `fail-step36.png`.
- **Dugaan file:line (perlu verifikasi owner):** perakitan jawaban jalur SQL mencampur potongan RAG — `lib/ai/adapter.ts` (composer jawaban) dan/atau `lib/core/query.ts`; angka 7674 vs 8125 mengindikasikan filter periode/definisi metrik yang berbeda dari `EVALUATION_QA.md` A1. Lihat juga dual-engine `ARCHITECTURE_REVIEW_P4.md` K-4 / N-1.
- **Status:** Open

### BUG-002 — Intent routing salah: pertanyaan metrik/tren diklasifikasikan `rag`

- **ID:** BUG-002
- **Judul:** A3/B1/B2/C1/C2 diberi label `rag`, dijawab dari dokumen bukan dari database
- **Severity:** **Critical**
- **Requirement:** AC-AI-01, AC-02.1, G-02, M-02, M-03
- **Lingkungan:** sama dengan BUG-001
- **Langkah reproduksi:**
  1. Di `/assistant`, kirim berturut-turut: `Kanal mana yang memiliki volume transaksi tertinggi?`, `Bagaimana perbandingan volume transaksi bulan ini dengan bulan sebelumnya?`, `Apakah tingkat keberhasilan transaksi mengalami perubahan dalam tiga bulan terakhir?`, `Mengapa tingkat kegagalan transaksi meningkat dibandingkan bulan sebelumnya?`, `Faktor apa yang paling berkontribusi terhadap penurunan keberhasilan transaksi?`.
  2. Perhatikan label intent di kepala setiap jawaban dan isi jawabannya.
- **Expected:** intent `sql` untuk A3/B1/B2/C2 (dan `hybrid`/`sql` untuk C1), disertai angka dari `analytics.db` sesuai `EVALUATION_QA.md` A3/B1/B2/C1/C2.
- **Actual:** kelima jawaban berlabel **`rag`**. A3 menjawab "kenaikan volume terbesar pada E‑commerce serta Top‑up Pulsa/Saldo" (kategori, bukan 5 kanal GoPay→QRIS→VA BCA→DANA→OVO) tanpa tabel. C2 dijawab dengan kutipan apnea monitor & skripsi inventory.
- **Bukti:** `snap-1795425003687.txt:247-262`; `snap-1795425005655.txt:263-334`; `snap-1795425009591.txt:335-396`; `snap-1795425011578.txt:397-441`; `fail-step103.png`, `fail-step133.png`.
- **Dugaan file:line:** registry/router intent — `lib/ai/intents.ts` (legacy) vs `lib/core/query.ts` (core); konflik dua engine tercatat di `ARCHITECTURE_REVIEW_P4.md` K-4 / N-1 / ADR-P4-05.
- **Status:** Open

### BUG-003 — Korpus seed tercemar tiga dokumen asing (9 dokumen, bukan 6)

- **ID:** BUG-003
- **Judul:** Dokumen seed tidak sesuai SPEC; dokumen skripsi/apnea/Perpres ikut terindeks dan dikutip
- **Severity:** **Critical**
- **Requirement:** AC-03.1, AC-04.1…04.3, AC-06.1, NFR-09, M-08
- **Lingkungan:** `http://127.0.0.1:3210/data-sources` dan `/assistant`, 1440 px
- **Langkah reproduksi:**
  1. Buka `/data-sources`, lihat ringkasan "Dokumen terindeks" dan daftar sumber.
  2. Buka halaman 2 daftar sumber.
  3. Kembali ke `/assistant`, ajukan pertanyaan analitik apa pun (mis. A1/C2), lalu perhatikan sitasi.
- **Expected:** **7 sumber** = 1 dataset + **6 dokumen** sesuai `SPEC.md` §7.1; tidak ada dokumen di luar SOP-TRX-003, 2 laporan operasional, katalog kode, catatan insiden, FAQ.
- **Actual:** **10 sumber / 9 dokumen**. Tiga dokumen asing tampil: `Perpres_76_2013` (1,6 MB), `Pemantauan_Apnea_Berbasis_Internet_of_Things_denga` (938,6 KB), dan skripsi inventory `src_e122d5ce`. Kutipan "BAB II", "Tabel 4 UAT", "Activity Diagram Goods Receipt", "Pengukuran Respirasi" muncul di jawaban chat **dan** di laporan tersimpan.
- **Bukti:** `snap-1795424994603.txt:33-47,72-81`; `snap-1795425011578.txt:397-439`; `snap-1795425198636.txt:124-129`; `12-data-sources.png`.
- **Dugaan file:line:** daftar seed dokumen / direktori ingest — `data/seed/documents/`, `lib/ingest/*`, `scripts/seed*` (perlu verifikasi owner). Ini juga menjelaskan angka 7674: dataset aktif mungkin bukan `analytics.db` acuan.
- **Status:** Open

### BUG-004 — Guardrail F3-1 gagal: pertanyaan Desember 2026 dijawab dengan karangan sitasi

- **ID:** BUG-004
- **Judul:** "Berapa total transaksi Desember 2026?" tidak menyatakan batas data 18 Nov 2026
- **Severity:** **High**
- **Requirement:** F3-1 (`SPEC.md` §6.6), AC-02.4, AC-AI-02, M-04
- **Lingkungan:** `/assistant`, 1440 px
- **Langkah reproduksi:**
  1. Di percakapan yang sudah berisi jawaban A1–E3, kirim `Berapa total transaksi Desember 2026?`.
  2. Perhatikan label intent, narasi, dan tabel pendukung.
- **Expected:** menyatakan data hanya tersedia sampai **18 Nov 2026**; tidak mengarang angka maupun sitasi.
- **Actual:** label **`sql`**, narasi mengutip **Pasal 21 Perpres 2013** ("Ditetapkan di Jakarta pada tanggal 6 Desember 2013…"), Ringkasan KPI Sep/Okt, FAQ OVO; tabel "Data pendukung" = **7674**. Tidak ada pernyataan batas data.
- **Bukti:** `snap-1795425081436.txt:645-692`; `fail-step218.png`, `fail-step219.png`.
- **Dugaan file:line:** pemeriksaan batas periode pada guardrail — `lib/ai/guardrails.ts` dan/atau `lib/core/query.ts` (bandingkan dengan F3-2/F3-5/F3-7 yang benar di `snap-1795425081436.txt:693-718`).
- **Status:** Open

### BUG-005 — Resolusi konteks multi-turn gagal pada F2 turn ke-3

- **ID:** BUG-005
- **Judul:** "Sejak kapan perubahan itu terjadi?" dijawab dengan dokumen tidak relevan
- **Severity:** **High**
- **Requirement:** AC-02.3, AC-AI-05, G-04, F2, M-03
- **Lingkungan:** `/assistant`, 1440 px
- **Langkah reproduksi:**
  1. Kirim `Mengapa tingkat kegagalan transaksi meningkat dibandingkan bulan lalu?`
  2. Kirim `Kanal mana yang paling berkontribusi terhadap peningkatan kegagalan itu?`
  3. Kirim `Sejak kapan perubahan itu terjadi?`
  4. Perhatikan jawaban turn ke-3.
- **Expected:** menganalisis **VA Mandiri** (entitas dari turn sebelumnya) dan menyebut **15 Okt / 3 Nov** (E2).
- **Actual:** jawaban `rag` berisi "12. Kapan layanan dalam pemeliharaan (F12)?" + kutipan **apnea monitor** ("Pulldown resistor", "Gambar. 6 Low Pass Filter") + tabel UAT skripsi inventory. Tidak ada 15 Okt/3 Nov.
- **Bukti:** `snap-1795425081436.txt:735-763`; `08-sql-transparency.png`; `fail-step244.png`, `fail-step247.png`.
- **Dugaan file:line:** context store / query rewrite — `lib/core/query-rewrite.ts` (disebut `ARCHITECTURE_REVIEW_P4.md` K-5), `lib/ai/adapter.ts`.
- **Status:** Open

### BUG-006 — Angka investigasi tidak cocok dengan angka acuan SPEC

- **ID:** BUG-006
- **Judul:** Failure rate dan kelebihan gagal dibulatkan/dihitung berbeda dari §7.3
- **Severity:** **High**
- **Requirement:** AC-05.1, AC-05.2, AC-AI-04, M-09
- **Lingkungan:** `/investigations/inv_11183b1c0d` dan `/data-sources/seed`, 1440 px
- **Langkah reproduksi:**
  1. Buka `/investigations`, klik dossier "Mengapa tingkat kegagalan transaksi meningkat?".
  2. Lihat region "Perbandingan" dan "Kontribusi per kanal".
  3. Bandingkan dengan `SPEC.md` §7.3 dan `EVALUATION_QA.md` E1.
- **Expected:** 4,91 % vs 3,30 % Okt; VA Mandiri 16,17 %, kelebihan gagal **±119**; OVO 9,29 %, **±56,8**.
- **Actual:** "Failure rate **4,9 %** / BASELINE **3,0 %**"; "VA Mandiri **+121 gagal**, **16,2 %** failure, baseline 1,93 %"; "OVO **+64 gagal**, **9,3 %**"; halaman detail sumber menampilkan "+120.6 gagal".
- **Bukti:** `snap-1795425198156.txt:48-66,114-133`; `snap-1795425195653.txt:414-419`; `17-investigation-result.png`.
- **Dugaan file:line:** `app/api/investigations/route.ts` (analisis) dan `lib/analytics/*` / `lib/core/query.ts`; definisi baseline 1,93 % tidak sama dengan 2,12 % di `EVALUATION_QA.md` C1. Lihat juga `app/api/investigations/analyze/route.ts:24-25` (`ARCHITECTURE_REVIEW_P4.md` D-5).
- **Status:** Open

### BUG-007 — Laporan tersimpan memakai template riset dokumen dan sitasi tercemar

- **ID:** BUG-007
- **Judul:** "Simpan sebagai laporan" menghasilkan LAPORAN RISET DOKUMEN, bukan ringkasan analitik
- **Severity:** **High**
- **Requirement:** AC-06.1, AC-06.2, NFR-09, M-10
- **Lingkungan:** `/assistant` → `/reports`, 1440 px
- **Langkah reproduksi:**
  1. Pada jawaban chat, klik **Simpan sebagai laporan** (toast "Laporan disimpan" muncul).
  2. Buka `/reports`, pilih laporan "Berapa total transaksi pada bulan ini?".
  3. Perhatikan pratinjau dokumen dan bagian "BUKTI & SITASI".
- **Expected:** ringkasan, key findings, metrik pendukung, tabel/grafik, referensi sumber sesuai jawaban asal (AC-06.1), angka identik (AC-06.2).
- **Actual:** header "TanyaData **LAPORAN RISET DOKUMEN**", sub-teks "Ditarik dari isi dokumen terindeks dengan kutipan asli", 4 temuan berupa potongan kutipan, dan sitasi mencakup `src_e122d5ce · BAB II` serta `Activity Diagram Goods Receipt (GR)` dari skripsi inventory. Tidak ada tabel metrik 8.125.
- **Bukti:** `snap-1795425198636.txt:89-130`; `snap-1795425198991.txt:89-130`; `10-share-modal.png` (toast tersimpan).
- **Dugaan file:line:** pemilihan template laporan di `lib/reports/*` dan DTO `app/api/reports/**`; konten berasal dari snapshot jawaban yang sudah tercemar (BUG-001/BUG-003).
- **Status:** Open

### BUG-008 — Lokalisasi English tidak lengkap dan menghitung 0 dokumen

- **ID:** BUG-008
- **Judul:** UI EN menyisakan label Bahasa Indonesia; assistant mobile menampilkan "0 indexed documents"
- **Severity:** **Medium**
- **Requirement:** AC-07.1, NFR-10, M-11
- **Lingkungan:** `/settings` 1440 px dan `/assistant` 390 px
- **Langkah reproduksi:**
  1. Buka `/settings`, pilih **English**, klik **Simpan perubahan**.
  2. Perhatikan nav samping, tombol, kartu ringkasan, dan tab.
  3. Buka `/assistant` pada viewport 390 px.
- **Expected:** label navigasi, tombol, dan pesan sistem berubah ke English; istilah teknis (SQL, failure code) tidak diterjemahkan; jumlah dokumen tetap 9.
- **Actual:** nav tetap "Asisten / Sumber Data / Investigasi / Laporan / Pengaturan"; tombol "Buang" dan "Simpan perubahan"; kartu "Dokumen / Bahasa / Rentang bawaan / Grafik / Umum"; tab "Umum / Asisten / Tentang". Di mobile EN: "Hi, what can I help you analyze?" tetapi "Ask about **0** indexed documents or transaction data."
- **Bukti:** `snap-1795425224390.txt:10-20,57-82`; `22-settings-en.png`; `05-assistant-390.png`; `snap-1795425199765.txt` (kondisi ID sebagai pembanding).
- **Dugaan file:line:** katalog terjemahan `messages/id.json` / `messages/en.json` (atau `lib/i18n/*`) dan komponen shell; penghitungan dokumen di header assistant mobile memakai sumber yang berbeda dari "9 dokumen terindeks" di header desktop.
- **Status:** Open

### BUG-009 — Navigasi Overview tidak menghasilkan halaman Overview/KPI

- **ID:** BUG-009
- **Judul:** Tidak ada bukti UI dashboard Overview; screenshot redirect menampilkan `/data-sources`
- **Severity:** **Medium** (bisa dinaikkan jika terkonfirmasi redirect permanen)
- **Requirement:** AC-01.1…01.6, G-01, M-01
- **Lingkungan:** shell aplikasi, 1440 px
- **Langkah reproduksi:**
  1. Dari landing klik "Coba dengan data contoh" atau dari shell cari entri Overview.
  2. Amati URL dan konten halaman yang tampil.
- **Expected:** `/overview` dengan 5 KPI (8.125 / 7.537 / 399 / 92,76 % / 4,91 %) dan 5 blok visual sesuai `SPEC.md` §7.3.
- **Actual:** `06-overview-redirect.png` menampilkan halaman **Sumber Data** (`/data-sources`); tidak ada satu pun snapshot `/overview` dalam 49 snapshot artefak. Seluruh AC-01.x tidak dapat diverifikasi.
- **Bukti:** `06-overview-redirect.png`; absennya `url: …/overview` pada grep seluruh `snap-1795425*.txt`.
- **Dugaan file:line:** rute/redirect di `app/page.tsx`, `app/overview/page.tsx`, atau konfigurasi nav shell. **Catatan jujur:** bisa juga merupakan keterbatasan urutan langkah suite; perlu konfirmasi owner sebelum menutup.
- **Status:** Open (butuh konfirmasi)

### BUG-010 — Dataset Detail tidak menampilkan ringkasan kualitas data

- **ID:** BUG-010
- **Judul:** Halaman detail sumber menampilkan skema & sample, tetapi tanpa missing value/duplikat; ukuran berkas 0 B
- **Severity:** **Medium**
- **Requirement:** AC-03.4, M-07
- **Lingkungan:** `/data-sources/seed`, 1440 px
- **Langkah reproduksi:**
  1. Buka `/data-sources`, pilih sumber "Transaksi QRIS 2026" → detail.
  2. Perhatikan "Metadata sumber", "Pratinjau data", dan bagian kualitas.
- **Expected:** nama file, tipe, jumlah baris, daftar kolom + tipe, sample ≥ 5 record, ringkasan kualitas (missing value, duplikat).
- **Actual:** nama/tipe/46.952 baris/14 kolom/20 sample tampil; **"Potongan terindeks: Belum dihitung"**, **"Ukuran berkas: 0 B"**, dan **tidak ada** ringkasan missing value/duplikat. Screenshot bernama `13-dataset-detail.png` malah menampilkan `/data-sources`.
- **Bukti:** `snap-1795425195653.txt:29-56,401-419`; `13-dataset-detail.png`.
- **Dugaan file:line:** DTO `app/api/sources/[id]/route.ts` dan komponen `app/data-sources/[id]/page.tsx` (field kualitas tidak diisi untuk sumber SQLite seed).
- **Status:** Open

### BUG-011 — Jawaban SOP tidak memenuhi 7 langkah dan tidak menyebut "bagian 4"

- **ID:** BUG-011
- **Judul:** D1 menghasilkan ringkasan naratif + 6 langkah, bukan 7 langkah SOP-TRX-003 bagian 4
- **Severity:** **Medium**
- **Requirement:** AC-04.1, G-03, D1
- **Lingkungan:** `/assistant`, 1440 px
- **Langkah reproduksi:**
  1. Kirim `Apa prosedur yang harus dilakukan ketika transaksi gagal?`
  2. Hitung langkah yang tercantum dan periksa penyebutan bagian dokumen.
- **Expected:** 7 langkah lengkap (deteksi → klasifikasi → verifikasi dana → tindakan → komunikasi → rekonsiliasi/refund → pencatatan) dan sitasi **SOP-TRX-003 bagian 4**.
- **Actual:** jawaban berupa 3 kalimat naratif dengan sitasi "Prosedur Umum Penanganan Transaksi Gagal" (chunk 1854/1855); variasi jawaban lain menampilkan daftar **Langkah 1–6** saja; tidak ada sebutan "bagian 4".
- **Bukti:** `snap-1795425014577.txt:442-464`; `snap-1795425000177.txt:148-209`.
- **Dugaan file:line:** template ekstraksi/perakitan jawaban dokumen — `lib/ai/adapter.ts` (`composeDocumentAnswer`) dan chunker `lib/core/store.ts` / `lib/ingest/chunker.ts` (dua pipeline live, `ARCHITECTURE_REVIEW_P4.md` C-10).
- **Status:** Open

### BUG-012 — Halaman share kosong saat dibuka di sesi incognito (perlu konfirmasi)

- **ID:** BUG-012
- **Judul:** `23-share-incognito.png` menampilkan halaman putih kosong
- **Severity:** **Low** — perlu konfirmasi ulang
- **Requirement:** fitur "Bagikan" (landing §"Cara kerja" langkah 04), terkait SEC-002
- **Lingkungan:** sesi browser incognito, 1440 px
- **Langkah reproduksi:**
  1. Dari modal "Bagikan sesi ini" (`10-share-modal.png`), salin tautan hasil.
  2. Buka tautan tersebut di sesi incognito.
  3. Amati konten halaman.
- **Expected:** halaman read-only dengan ringkasan jawaban + sitasi (dan `noindex` sesuai rekomendasi SEC-002).
- **Actual:** screenshot `23-share-incognito.png` seluruhnya putih kosong. Modal konfirmasi sendiri tampil benar dengan peringatan sensitivitas dan checkbox sitasi/identitas.
- **Bukti:** `23-share-incognito.png`; `10-share-modal.png`; `snap-1795425198636.txt:131-137` (tautan share/ekspor).
- **Dugaan file:line:** `app/share/[id]/page.tsx` dan `app/api/share/[id]/route.ts` (juga disebut `SECURITY_REPORT.md` SEC-002). **Catatan jujur:** bisa berupa race condition saat screenshot; QA tidak mengklaim ini PASS maupun FAIL definitif.
- **Status:** Open (butuh konfirmasi)

---

## 4. Cakupan tak teruji dan alasan

| Area | AC / item | Alasan tidak diuji |
|---|---|---|
| Dashboard Overview | AC-01.1…01.6 | Halaman tidak pernah terekam; `06-overview-redirect.png` menunjukkan navigasi berakhir di `/data-sources` (BUG-009). |
| Filter & empty state dashboard | AC-01.2, AC-01.3, AC-01.5 | Tidak ada snapshot interaksi filter/granularitas/0 baris. |
| Query transparency | AC-02.2 | Teks SQL aktual tidak terekam; screenshot bernama demikian tidak menampilkan panel SQL. |
| Visualisasi tabel↔grafik | AC-02.7 | Tidak ada toggle grafik yang terekam. |
| Upload & validasi file | AC-03.2, AC-03.3, AC-04.5 | `14-upload-valid.png` tidak menunjukkan hasil upload; tidak ada artefak file uji (CSV/XLSX/DOCX/PDF) maupun status `Failed`. Bukti `evil.exe → 415` milik lane security, bukan UI QA. |
| Hapus sumber & dokumen Processing | AC-03.5, AC-03.6 | `15-delete-confirm.png` tidak menampilkan dialog; tidak ada sumber berstatus `Processing`. |
| Document Management | AC-04.4 | Tidak ada snapshot `/data-sources/documents`; chunk count per dokumen & tombol reindex/hapus tidak terekam. |
| Unduhan laporan | AC-06.3 (sebagian), AC-06.4 | Tautan ekspor ada, tetapi tidak ada file hasil unduhan di artefak untuk dibandingkan. |
| Empty state laporan | AC-06.5 | Sudah ada 4 laporan tersimpan. |
| Ganti dataset aktif | AC-07.3 | Hanya satu dataset tersedia di seed; prasyarat tidak terpenuhi. |
| EN + pertanyaan Indonesia | AC-07.5 | Tidak ada snapshot kombinasi tersebut. |
| D1–D8 lengkap, E1–E3, F1, F2 penuh | G-03, G-04, G-05 | Sebagian pertanyaan dijawab (D1, D4, D8, C1, C2, E1, E2, F2 sebagian) tetapi kualitasnya gagal/tercemar; tidak ada evaluasi 21/21 maupun 7/7 F3 yang bersih. F3-4 ("Berapa success rate bulan ini?") dan F3-6 ("Ringkas SOP penanganan fraud") tidak ditemukan dalam snapshot. |
| NFR-01…NFR-03 (timing) | Performa | Tidak ada pengukuran waktu muat/respons/timeout dalam artefak. |
| NFR-04…NFR-06, NFR-08 | Keamanan & persistensi restart | Domain lane security; restart tidak dilakukan sesuai batas eksekusi. Lihat `SECURITY_REPORT.md`. |
| NFR-11 tablet 1024/768 | Responsif | Screenshot `02-landing-1024.png`, `03-landing-768.png` ada, tetapi tidak ada verifikasi horizontal-scroll/nav drawer selain visual landing 390 px. |
| NFR-12 kontras & label | Aksesibilitas | Hanya `26-a11y-focus.png` (skip-link + focus ring) yang terverifikasi; audit kontras/ARIA penuh tidak dilakukan. |
| Kompatibilitas browser | NFR | Hanya Chromium yang dipakai; Firefox/Safari/Edge tidak diuji. |
| Jaringan lambat/offline | Non-fungsional | Tidak ada simulasi throttling/offline. |
| Fitur AI dengan input aneh/sangat panjang | AI | Tidak ada input emoji, karakter khusus, atau prompt sangat panjang dalam artefak. |
| LLM opsional aktif | AC-AI-09 | `LLM_MODE=off`; tidak ada kredensial. Sesuai `SECURITY_REPORT.md` §6. |

---

## 5. Rekomendasi per owner

| Owner | Prioritas | Aksi |
|---|---|---|
| **backend + aiml** | P0 | Tutup BUG-001, BUG-002, BUG-004, BUG-005: perbaiki routing intent, agregasi SQL (target 8.125), batas periode guardrail, dan resolusi konteks. Jadikan `lib/core/**` satu-satunya jalur produksi (ADR-P4-05) agar perbaikan tidak duplikat di `lib/ai/**`. |
| **backend / data** | P0 | Tutup BUG-003: bersihkan seed menjadi 6 dokumen sesuai `SPEC.md` §7.1, pastikan dataset aktif = `analytics.db` acuan, lalu rebuild indeks. Verifikasi ulang seluruh A1–E3 setelah korpus bersih. |
| **backend + aiml** | P1 | Tutup BUG-006 dan BUG-011: samakan definisi metrik/baseline dengan `EVALUATION_QA.md` (4,91/3,30; 16,17; ±119; ±56,8) dan lengkapi 7 langkah SOP + sebutan "bagian 4". |
| **frontend + backend** | P1 | Tutup BUG-007: pilih template laporan analitik untuk jawaban SQL/HYBRID, bukan "LAPORAN RISET DOKUMEN"; pastikan angka laporan = angka jawaban. |
| **frontend** | P1 | Tutup BUG-008: lengkapi katalog EN untuk nav/tombol/kartu/pesan, dan perbaiki hitungan dokumen di header mobile (0 → 9). |
| **frontend** | P2 | Tutup BUG-009, BUG-010: konfirmasi rute `/overview` dan tampilkan KPI §7.3; tambahkan ringkasan kualitas (missing/duplikat) di Dataset Detail. |
| **backend + security** | P2 | Konfirmasi BUG-012 (share blank) bersama re-test SEC-002 (`noindex`, expiry/revoke). |
| **designer** | P2 | Fidelity review: nav mobile memakai bottom tab bar, bukan drawer yang disebut NFR-11; minta keputusan apakah ini diterima atau diubah. |
| **analyst** | P2 | Putuskan apakah "0 indexed documents" dan angka investigasi (4,9 %/3,0 %) merupakan bug atau perubahan definisi yang disengaja; kunci jawaban ke `SPEC.md` §7.2/§7.3. |
| **qa (lane ini)** | P0 | Setelah patch: jalankan ulang **langkah reproduksi asli** BUG-001…BUG-012 + regresi A1–E3, F3 7/7, dan seluruh 39 AC. Hanya qa yang menutup ticket fungsional/UI. |

**Gate P7:** 100 % AC Must lulus, 0 bug Critical/High terbuka, dan `docs/TEST_REPORT.md` versi 1.1 memuat bukti re-test. Saat ini **tidak memenuhi gate**.

---

## 6. Handoff

```yaml
from: qa
to: agentic
phase: P5
type: deliverable
refs:
  - docs/TEST_REPORT.md
  - docs/SPEC.md
  - docs/EVALUATION_QA.md
  - docs/ARCHITECTURE_REVIEW_P4.md
  - docs/SECURITY_REPORT.md
summary: >
  Dari 39 AC hanya 4 PASS (10,3%), 5 PARTIAL, 11 FAIL, 19 NOT_TESTED; 0 dari 13 AC Must
  lulus penuh. 12 bug tercatat: 3 Critical (angka SQL salah 7674 vs 8125, routing intent
  metrik ke RAG, korpus seed tercemar 9 dokumen asing), 4 High (guardrail F3-1, konteks
  multi-turn, angka investigasi, template laporan), 4 Medium, 1 Low. Alur yang gagal:
  chat analitik A1–C2, F2 turn 3, F3-1, dashboard Overview (tidak terekam), dan ekspor
  laporan. Verdict DO-NOT-SHIP; gate P7 tidak terpenuhi.
evidence: >
  docs/TEST_REPORT.md + C:\Users\aldya\.browserqa\artifacts\20261123-160948-tanyadata-p5-qa\
  (07-assistant-answers.png, 08-sql-transparency.png, 10-share-modal.png,
  12-data-sources.png, 22-settings-en.png, 23-share-incognito.png, 26-a11y-focus.png,
  fail-step36.png, fail-step103.png, fail-step218.png, fail-step244.png) + snapshot teks
  snap-1795424997687.txt, snap-1795425003687.txt, snap-1795425011578.txt,
  snap-1795425081436.txt, snap-1795425198156.txt, snap-1795425198636.txt,
  snap-1795425224390.txt, snap-1795425195653.txt.
blocking: true
needs: >
  (1) Orchestrator menugaskan BUG-001/002/003 ke backend+aiml/data dan BUG-004/006/007
      ke owner terkait sebelum iterasi re-verify. (2) Bersihkan seed ke 6 dokumen dan
      satukan jalur eksekusi ke lib/core sesuai ADR-P4-05. (3) QA melakukan re-test
      dengan langkah reproduksi asli + regresi 39 AC; hanya qa yang menutup ticket
      fungsional/UI. (4) Konfirmasi BUG-009/BUG-012 dan keputusan analyst untuk definisi
      angka investigasi.
```
