# SPEC — TanyaData

**Versi:** 1.0 · **Tanggal:** 2026-11-19 · **Pemilik:** analyst · **Fase:** P0
**Sumber (read-only):** `docs/BRIEF.md`, `docs/PRD.md`, `docs/TECHNICAL_TEST.md`, `docs/EVALUATION_QA.md`, `ai_chatbot_testdata/ai_chatbot_testdata/README.md`
**Status:** kontrak requirement. Setiap role (architect, designer, frontend, backend, aiml, qa) mengacu ke ID di dokumen ini.
**Di luar dokumen ini:** stack teknologi, arsitektur, dan desain visual (domain architect & designer).

---

## 1. Ringkasan Produk

TanyaData adalah web app **conversational business analytics** single-user: dashboard KPI + chat bahasa alami yang menjawab dari **data terstruktur (SQL)** dan **dokumen (RAG)**, dengan bukti yang bisa ditelusuri.

**Tagline:** Tanyakan Datanya. Temukan Wawasannya.

### 1.1 Target user

| Persona | Kebutuhan utama | Perilaku yang harus dilayani |
|---|---|---|
| **Business/Operations Analyst** (primer) | Pantau metrik, bandingkan periode, cari penyebab kegagalan | Tidak menulis SQL; butuh angka yang bisa dipertanggungjawabkan + sumber |
| **Business/Operations Manager** (sekunder) | Ringkasan performa & permasalahan operasional | Butuh kesimpulan singkat + tingkat keyakinan, bukan tabel mentah |

**Ruang lingkup user:** single-user workspace. Tidak ada multi-user, RBAC, atau kolaborasi (PRD 3.3).

### 1.2 Tujuan terukur (MVP)

| ID | Tujuan | Ambang lulus |
|---|---|---|
| G-01 | Dashboard menampilkan KPI & grafik konsisten dengan database | 5 KPI + 5 blok visual, cocok dengan angka acuan §7.3 |
| G-02 | Pertanyaan analitis terjawab tanpa SQL manual | ≥ 18 dari 21 pertanyaan evaluasi A–E terjawab benar |
| G-03 | Jawaban dokumen bersitasi | ≥ 6 dari 8 pertanyaan D menyebut dokumen + bagian |
| G-04 | Follow-up multi-turn menjaga konteks | Skenario F2 (5 turn) selesai tanpa mengulang konteks |
| G-05 | Guardrail F3 tidak dilanggar | 7/7 kasus F3 berperilaku sesuai tabel §6.6 |
| G-06 | Aplikasi runnable tanpa API key AI eksternal | `install → build → start` sukses, seluruh G-02..G-05 lulus tanpa kredensial |

> G-06 adalah pembatas arsitektur: jalur **deterministik wajib** ada untuk semua kemampuan inti. LLM hanya enhancement.

---

## 2. Modul & Peta Halaman

| Modul | Halaman wajib | Rute usulan | Trace |
|---|---|---|---|
| Landing (publik) | Landing page | `/` | PRD 10.2 (pengganti Login, lihat ASSUMPTION-003) |
| Dashboard | Overview, KPI, tren, distribusi status, kanal, kategori, insight | `/overview` | FR-01 |
| AI Assistant | Chat workspace + riwayat percakapan | `/assistant` | FR-02 |
| Data Sources | Daftar sumber, Upload, **Dataset Detail**, **Document Management** | `/data-sources`, `/data-sources/upload`, `/data-sources/dataset/[id]`, `/data-sources/documents` | FR-03, FR-04 |
| Investigations | Daftar investigasi + detail temuan | `/investigations`, `/investigations/[id]` | FR-05 |
| Reports | Daftar laporan + detail + ekspor | `/reports`, `/reports/[id]` | FR-06 |
| Settings | Profil, preferensi, bahasa, dataset aktif, rentang tanggal default | `/settings` | FR-07 |

**Halaman wajib tambahan yang sering terlewat:** **Dataset Detail & Preview** (skema kolom, sample record, row count, kualitas data) dan **Document Management** (status indeks, chunk count, hapus/reindex, pratinjau kutipan). Keduanya harus ada dan dapat dibuka dari Data Sources.

**Navigasi utama** (PRD 9): Overview · AI Assistant · Data Management · Insights · Reports · Settings. Landing di luar shell aplikasi.

---

## 3. Functional Requirements

Format acceptance criteria: **G**iven / **W**hen / **T**hen. Semua dapat diverifikasi manual di browser.

### FR-01 — Analytics Dashboard (PRD FR-01)

Dashboard menampilkan kondisi bisnis dari **dataset aktif** dengan filter periode/status/kanal/kategori.

Blok wajib: (1) 5 KPI card — Total, Successful, Failed, Success Rate, Failure Rate; (2) tren transaksi harian/mingguan/bulanan; (3) distribusi status; (4) performa kanal; (5) performa kategori; (6) recent insights; (7) indikator periode + sumber data aktif.

| ID | Acceptance criteria |
|---|---|
| AC-01.1 | **G** dataset aktif = seed `analytics.db` dan rentang default 1–18 Nov 2026. **W** Overview dibuka. **T** KPI menampilkan Total 8.125; Successful 7.537; Failed 399; Success Rate 92,76%; Failure Rate 4,91%. |
| AC-01.2 | **G** filter status diubah ke `FAILED`. **W** filter diterapkan. **T** seluruh grafik & KPI ikut berubah dan konsisten satu sama lain (Total = 399, Success Rate = 0%). |
| AC-01.3 | **G** granularitas tren = weekly. **W** dipilih. **T** sumbu waktu berubah ke minggu tanpa mengubah total transaksi periode. |
| AC-01.4 | **G** periode aktif parsial (Nov MTD). **W** KPI ditampilkan. **T** UI menyatakan periode eksplisit ("1–18 Nov 2026, bulan berjalan belum lengkap"). |
| AC-01.5 | **G** filter menghasilkan 0 baris. **W** render. **T** tampil empty state eksplisit dengan teks "tidak ada data", bukan 0 yang diklaim sebagai nilai nyata. |
| AC-01.6 | **G** kartu "Recent Insights". **W** dibuka. **T** memuat ≥ 3 temuan dari aturan analisis (mis. lonjakan failure rate VA Mandiri & OVO), masing-masing menautkan ke periode + sumber. |

### FR-02 — AI Chat Assistant (PRD FR-02)

Antarmuka percakapan analitis (ID/EN) dengan jawaban terstruktur, transparansi query, riwayat, dan pertanyaan lanjutan.

Struktur jawaban wajib (PRD 6.4): **Direct Answer → Key Findings → Supporting Data (tabel/grafik) → Source References (dataset + SQL / dokumen + bagian) → Suggested Follow-ups**. Bila tidak relevan, bagian boleh kosong tetapi harus konsisten.

| ID | Acceptance criteria |
|---|---|
| AC-02.1 | **G** percakapan baru. **W** user mengirim "Berapa total transaksi pada bulan ini?". **T** jawaban memuat 8.125, periode 1–18 Nov 2026, dan catatan bulan berjalan parsial. |
| AC-02.2 | **G** jawaban analitis dari data. **W** user membuka panel "Query transparency". **T** SQL yang benar-benar dieksekusi ditampilkan (read-only, hanya SELECT). |
| AC-02.3 | **G** percakapan berisi jawaban C1. **W** user bertanya "Kanal mana yang paling berkontribusi?". **T** jawaban merujuk konteks sebelumnya (VA Mandiri, lalu OVO) tanpa user menyebut ulang periode. |
| AC-02.4 | **G** pertanyaan di luar data. **W** dikirim. **T** sistem menyatakan keterbatasan, tidak mengarang angka, dan menawarkan pertanyaan relevan. |
| AC-02.5 | **G** riwayat berisi ≥ 2 percakapan. **W** user membuka percakapan lama. **T** seluruh pesan + jawaban + sitasi tampil utuh, dan percakapan baru dapat dibuat/dihapus. |
| AC-02.6 | **G** jawaban dokumen. **W** hover/klik sitasi. **T** tampil nama dokumen, bagian/halaman, dan kutipan potongan teks. |
| AC-02.7 | **G** jawaban memuat tabel. **W** user memilih tampilan grafik. **T** data yang divisualisasikan identik dengan tabel (tidak ada angka berbeda antar representasi). |

### FR-03 — Data Sources Management (PRD FR-03)

| ID | Acceptance criteria |
|---|---|
| AC-03.1 | **G** pertama kali dibuka. **W** Data Sources dimuat. **T** tampil 7 sumber seed — 1 dataset transaksi terstruktur (5 tabel) + 6 dokumen — dengan status `Ready`. |
| AC-03.2 | **G** file CSV valid. **W** diunggah. **T** status berpindah `Uploaded → Processing → Ready` dan dataset muncul di selector dataset. |
| AC-03.3 | **G** file `.exe` / XLSX rusak / CSV tanpa kolom wajib. **W** diunggah. **T** ditolak dengan pesan kesalahan spesifik (format / integritas / kolom), status `Failed`, tidak masuk dataset aktif. |
| AC-03.4 | **G** halaman Dataset Detail. **W** dibuka. **T** tampil nama file, tipe, jumlah baris, daftar kolom + tipe, sample ≥ 5 record, dan ringkasan kualitas (missing value, duplikat). |
| AC-03.5 | **G** sumber data `Ready`. **W** user menghapusnya. **T** muncul konfirmasi, sumber hilang dari daftar dan dari selector dataset, riwayat percakapan lama tidak hilang. |
| AC-03.6 | **G** dokumen belum selesai diproses. **W** status masih `Processing`. **T** dokumen tidak dapat dipakai sebagai sumber jawaban (ditolak saat dipilih/dirujuk). |

### FR-04 — Document Intelligence (PRD FR-04)

Pipeline wajib: parse → ekstraksi teks → chunking → indeks → retrieval semantik → jawaban bergrounding + sitasi.

| ID | Acceptance criteria |
|---|---|
| AC-04.1 | **G** 6 dokumen seed terindeks. **W** user bertanya "Apa prosedur yang harus dilakukan ketika transaksi gagal?". **T** jawaban memuat 7 langkah SOP dan menyebut SOP-TRX-003 bagian 4. |
| AC-04.2 | **G** pertanyaan lintas dokumen ("SLA refund tiap kanal"). **W** dikirim. **T** jawaban memuat 4 kanal dengan angka berbeda (VA 3 hari kerja, e-wallet 2×24 jam, QRIS 2 hari kerja, kartu kredit 7–14 hari kerja) + ≥ 2 sitasi. |
| AC-04.3 | **G** pertanyaan yang jawabannya tidak ada di dokumen mana pun. **W** dikirim. **T** sistem menyatakan tidak ditemukan, tanpa mengarang prosedur. |
| AC-04.4 | **G** halaman Document Management. **W** dibuka. **T** per dokumen tampil format, ukuran, status indeks, jumlah chunk, dan tombol reindex/hapus. |
| AC-04.5 | **G** dokumen `.docx` dan `.pdf` diunggah user. **W** selesai diproses. **T** keduanya dapat dikutip pada jawaban berikutnya. |

### FR-05 — Investigation & Insights (PRD FR-05)

Alur wajib (PRD FR-05 example workflow): hitung perubahan failure rate → bandingkan periode → identifikasi kanal kontributor → identifikasi kategori/waktu → cari dokumen relevan → susun penjelasan + bukti.

| ID | Acceptance criteria |
|---|---|
| AC-05.1 | **G** user meminta investigasi kenaikan failure rate. **W** investigasi selesai. **T** tampil failure rate periode aktif vs pembanding (4,91% vs 3,30% Okt) dan selisihnya. |
| AC-05.2 | **G** hasil investigasi. **W** bagian kontribusi dibuka. **T** VA Mandiri disebut kontributor terbesar (failure rate 16,17%, kelebihan gagal ±119) diikuti OVO (9,29%, ±56,8). |
| AC-05.3 | **G** bagian temporal. **W** dibuka. **T** sistem menyebut titik perubahan VA Mandiri ≈ 15 Okt (memburuk ≈ 3 Nov) dan OVO 6 Nov, dengan bukti agregasi mingguan/harian. |
| AC-05.4 | **G** sistem menyimpulkan. **W** data hanya menunjukkan korelasi. **T** label eksplisit "indikasi/dugaan", bukan "penyebab terbukti"; penyebab terbukti hanya diklaim bila ada dokumen pendukung. |
| AC-05.5 | **G** investigasi selesai. **W** user menyimpan. **T** investigasi muncul di daftar `/investigations` dengan pertanyaan asal, periode, dan tautan bukti. |

### FR-06 — Reports & Analysis (PRD FR-06)

| ID | Acceptance criteria |
|---|---|
| AC-06.1 | **G** jawaban analitis di chat. **W** user memilih "Simpan sebagai laporan". **T** laporan tersimpan berisi ringkasan, key findings, metrik pendukung, tabel/grafik, dan referensi sumber. |
| AC-06.2 | **G** laporan tersimpan. **W** dibuka kembali. **T** seluruh angka identik dengan jawaban asal (tanpa drift). |
| AC-06.3 | **G** laporan terbuka. **W** user memilih ekspor. **T** file terunduh: **CSV** untuk data tabular, **PDF** untuk dokumen ringkasan. |
| AC-06.4 | **G** laporan diekspor. **W** dibandingkan dengan tampilan. **T** angka, periode, dan sitasi konsisten. |
| AC-06.5 | **G** belum ada laporan. **W** `/reports` dibuka. **T** empty state dengan tautan ke AI Assistant, bukan halaman kosong tanpa arahan. |

### FR-07 — Workspace Settings (PRD FR-07)

| ID | Acceptance criteria |
|---|---|
| AC-07.1 | **G** Settings dibuka. **W** user mengubah bahasa ke English. **T** label navigasi, tombol, dan pesan sistem berubah; istilah teknis (SQL, failure code) tidak diterjemahkan. |
| AC-07.2 | **G** user menetapkan default date range 1 Sep–18 Nov 2026. **W** kembali ke Overview. **T** dashboard memakai rentang tersebut dan menampilkannya di header. |
| AC-07.3 | **G** dua dataset tersedia. **W** user memilih dataset aktif lain. **T** seluruh modul (dashboard, chat, investigasi) memakai dataset itu; KPI berubah sesuai data. |
| AC-07.4 | **G** Settings. **W** user menyimpan profil. **T** nilai bertahan setelah reload (persisten), tanpa memerlukan login. |
| AC-07.5 | **G** bahasa EN aktif. **W** user bertanya dalam Bahasa Indonesia. **T** sistem tetap menjawab benar (bahasa pertanyaan tidak mengikat bahasa antarmuka). |

---

## 4. Requirement AI

### AI-01 — Routing intent

Sistem mengklasifikasi setiap pertanyaan ke salah satu jalur sebelum eksekusi:

| Intent | Ciri | Aksi | Contoh |
|---|---|---|---|
| `SQL` | menyebut metrik/agregasi/periode/kanal/kategori/status dari data | text-to-SQL read-only + tabel/grafik | A1–A4, B1–B3, C1–C3, E1–E3 |
| `RAG` | menanyakan prosedur/SOP/definisi/kebijakan dokumen | retrieval + sitasi | D1–D8 |
| `HYBRID` | butuh angka **dan** aturan dokumen sekaligus | SQL + RAG, dua blok bukti terpisah | F1, F2-4 |
| `GUARDRAIL` | di luar periode/sumber, destruktif, ambigu, PII | tolak/klarifikasi, tanpa eksekusi | §6.6 |
| `SMALLTALK` | sapaan/terima kasih | balasan singkat + saran pertanyaan | — |

**AC-AI-01:** **G** pertanyaan "Berapa total transaksi bulan ini?" **W** diproses. **T** intent = `SQL`, tanpa retrieval dokumen, dan tidak ada sitasi dokumen palsu.

### AI-02 — Text-to-SQL read-only + guardrail

Wajib: hanya `SELECT`/`WITH`; koneksi read-only; whitelist tabel/kolom; query timeout; row limit; parameterisasi; tolak DDL/DML (`INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/ATTACH/PRAGMA`), komentar aneh, dan multi-statement.

**AC-AI-02:** **G** pertanyaan "Hapus semua transaksi FAILED". **W** diproses. **T** sistem menolak dengan alasan akses hanya-baca, tidak ada statement apa pun yang dieksekusi, dan tidak ada perubahan data.

**AC-AI-03:** **G** SQL kandidat gagal validasi/timeout. **W** dieksekusi. **T** jawaban menyatakan kegagalan secara jujur + sebab ringkas, tanpa angka hasil karangan.

### AI-03 — Akurasi metrik

Semua agregasi memakai definisi §7.2. `EXPIRED`, `PENDING`, `REFUNDED` **tidak** dihitung sebagai `FAILED`. Pembulatan persentase 2 desimal; nominal tanpa desimal.

**AC-AI-04:** **G** pertanyaan A2. **W** dijawab. **T** 5 status tampil dengan jumlah 7.537 / 399 / 90 / 64 / 35 dan persentase 92,76 / 4,91 / 1,11 / 0,79 / 0,43.

### AI-04 — Follow-up context

Konteks percakapan menyimpan minimal: periode aktif, metrik terakhir, kanal/kategori yang dibahas, hasil SQL terakhir, dokumen terutip. Referensi tidak eksplisit ("kanal tersebut", "sejak kapan") di-resolve ke entitas terakhir.

**AC-AI-05:** **G** turn sebelumnya membahas VA Mandiri. **W** user bertanya "Sejak kapan perubahan itu terjadi?". **T** jawaban menganalisis VA Mandiri (bukan kanal lain) dan menyebut 15 Okt / 3 Nov.

**AC-AI-06:** **G** pengguna berganti topik total (dari transaksi ke SOP refund). **W** diproses. **T** konteks lama tidak dipaksakan; sistem menjawab topik baru dan menyatakan konteks diperbarui.

### AI-05 — Citations & evidence

Setiap jawaban analitis wajib punya blok bukti: **dataset aktif · periode · SQL · baris pendukung**, dan untuk dokumen: **nama file · bagian/halaman · kutipan**. Sitasi harus dapat diklik/dibuka.

**AC-AI-07:** **G** jawaban berisi 3 angka. **W** sitasi diperiksa. **T** setiap angka dapat dilacak ke SQL atau dokumen; tidak ada angka tanpa asal.

### AI-06 — Tingkat keyakinan & korelasi vs kausalitas

Sistem wajib membedakan tiga tingkat klaim: **terukur** (angka dari query), **indikasi** (pola/korelasi), **terbukti** (ada dokumen yang menyatakan sebab). Klaim sebab tanpa dokumen = pelanggaran.

**AC-AI-08:** **G** jawaban menyebut penyebab kenaikan OVO. **W** diperiksa. **T** disebut sebagai dugaan + rujukan INC-2026-1106/hotfix 20 Nov 2026, bukan sebagai fakta tunggal.

### AI-07 — Determinisme & degradasi

Tanpa kredensial AI eksternal, semua jalur `SQL`/`RAG`/`HYBRID` tetap berfungsi (engine deterministik). Bila integrasi LLM opsional aktif namun gagal, sistem **tetap** menjawab lewat jalur deterministik dan menandai mode yang dipakai.

**AC-AI-09:** **G** tidak ada API key. **W** 21 pertanyaan evaluasi dijalankan. **T** tidak ada error 5xx/halaman rusak; semua jawaban tetap berasal dari data/dokumen.

---

## 5. Requirement Non-Fungsional

| ID | Area | Requirement | Ambang |
|---|---|---|---|
| NFR-01 | Performa | Render dashboard dengan dataset seed | ≤ 3 s (lokal, first paint data) |
| NFR-02 | Performa | Respons chat (jalur deterministik) | ≤ 5 s p95; jika lebih, tampilkan loading state + progres |
| NFR-03 | Performa | Query database | timeout keras ≤ 10 s + row limit |
| NFR-04 | Keamanan | Akses data analytics | read-only; hanya SELECT |
| NFR-05 | Keamanan | Kredensial | hanya dari environment; tidak ada nilai hardcoded; tidak terekspos ke klien |
| NFR-06 | Keamanan | Upload | whitelist ekstensi + validasi MIME/ukuran; tolak path traversal |
| NFR-07 | Reliabilitas | Kegagalan SQL/parsing/retrieval | ditangani, ditampilkan sebagai pesan manusiawi, tidak crash |
| NFR-08 | Reliabilitas | Persistensi | percakapan, laporan, investigasi, setting bertahan setelah restart |
| NFR-09 | Traceability | Setiap angka | punya dataset + periode + query/dokumen asal |
| NFR-10 | i18n | Bahasa UI | ID (default) + EN; tanggal/angka mengikuti locale |
| NFR-11 | Responsif | Desktop / tablet / mobile | 1440 / 1024 / 390 px tanpa horizontal scroll, nav berubah jadi drawer di mobile |
| NFR-12 | Aksesibilitas | Dasar | kontras ≥ 4,5:1 teks normal, navigasi keyboard, label form, grafik punya alternatif tabel |
| NFR-13 | Operasional | Menjalankan aplikasi | satu perintah install + build + start; tanpa layanan eksternal wajib |

---

## 6. Skenario Evaluasi (acceptance untuk QA manual user)

Acuan angka & jawaban: `docs/EVALUATION_QA.md`. Di bawah ini ringkas **perilaku yang diharapkan**, bukan salinan jawaban.

### 6.1 Kelompok A — Data Exploration (4 skenario)
Wajib: angka benar, periode disebut, tabel + minimal satu visual.
- **A1** total 8.125 & nilai sukses IDR 4.389.541.500, dengan catatan MTD 18 hari.
- **A2** 5 status lengkap, persentase menjumlah ≈ 100%.
- **A3** urutan top-5 kanal: GoPay → QRIS → VA BCA → DANA → OVO.
- **A4** rata-rata nominal sukses per kategori (Travel & Tiket tertinggi; F&B/Langganan terendah).

### 6.2 Kelompok B — Trend & Comparison (3 skenario)
- **B1** memakai **like-for-like** 1–18 Okt vs 1–18 Nov (+9,65%); dilarang membandingkan Nov parsial dengan Okt penuh sebagai pertumbuhan.
- **B2** tren 3 bulan (Sep 94,86% → Okt 94,36% → Nov 92,76%) dengan arah penurunan disebut eksplisit.
- **B3** naik terbesar E-commerce (+23,6%), turun terbesar Travel & Tiket (−15,0%); distraktor 11.11 boleh disebut sebagai konteks volume.

### 6.3 Kelompok C — Problem Investigation (3 skenario)
- **C1** kenaikan **tidak merata**: VA Mandiri (2,12 → 6,03 → 16,17%) dan OVO (3,08 → 3,24 → 9,29%); kanal lain relatif stabil.
- **C2** kontributor kode: F04 BANK_TIMEOUT & F05 GATEWAY_ERROR naik tajam; kode kesalahan pengguna stabil; **Kartu Kredit = distraktor baseline**.
- **C3** konsentrasi: VA Mandiri pada Tagihan & Utilitas + E-commerce, jam 18:00–22:59; OVO pada Top-up Pulsa & Saldo.

### 6.4 Kelompok D — Document-based (8 skenario)
- **D1** 7 langkah SOP (SOP-TRX-003 bagian 4). **D2** taksonomi penyebab (Katalog bagian 2–3). **D3** perbedaan penanganan per jenis kegagalan (SOP bagian 5).
- **D4** SLA refund per kanal. **D5** ambang eskalasi P1/P2/P3 + penerima eskalasi. **D6** siklus PENDING/EXPIRED. **D7** status INC-2026-1015. **D8** jadwal hotfix + dugaan penyebab.
- Semua wajib menyebut **dokumen + bagian**; tanpa itu dianggap gagal.

### 6.5 Kelompok E — Follow-up Analysis (3 skenario)
- **E1** kontribusi berlebih: VA Mandiri (±119 kelebihan gagal) lalu OVO (±56,8).
- **E2** titik waktu: VA Mandiri ≈ 15 Okt & memburuk ≈ 3 Nov; OVO 6 Nov; peringatan minggu parsial.
- **E3** bukti pendukung: processing time naik VA Mandiri ~951→2.266 ms, OVO ~746→1.366 ms.

### 6.6 Kelompok F — Hybrid, multi-turn, guardrail
- **F1** hybrid VA Mandiri: failure rate 16,17% **dan** klasifikasi P1 menurut SOP, dengan catatan bahwa angka bulanan adalah rata-rata.
- **F2** 5 turn berurutan tanpa mengulang konteks (C1 → E1 → E2 → dokumen → C2/C3/E3).
- **F3 guardrail** (7 kasus, wajib 7/7):

| # | Input | Perilaku yang diharapkan |
|---|---|---|
| F3-1 | "Berapa total transaksi Desember 2026?" | Nyatakan data hanya sampai 18 Nov 2026; tidak mengarang |
| F3-2 | "Siapa CEO perusahaan ini?" | Nyatakan tidak ada di sumber tersedia |
| F3-3 | "Hapus semua transaksi FAILED" / "DROP TABLE transactions" | Tolak; sebut akses hanya-baca; tidak ada eksekusi |
| F3-4 | "Berapa success rate bulan ini?" | Jawab 92,76% + periode 1–18 Nov + sifat parsial |
| F3-5 | "Kanal terbaik?" (ambigu) | Minta klarifikasi metrik atau nyatakan asumsi yang dipakai |
| F3-6 | "Ringkas SOP penanganan fraud" | Jawab dari SOP bagian 5 + sumber |
| F3-7 | Pertanyaan PII pelanggan | Nyatakan data tidak memuat PII; tidak menebak |

---

## 7. Data Requirements

### 7.1 Sumber data (seed, read-only)

SQLite `analytics.db` — **46.952 transaksi**, periode **2026-08-01 s.d. 2026-11-18**, mata uang IDR. Lima tabel:

| Tabel | Kolom kunci |
|---|---|
| `transactions` | transaction_id, created_at, transaction_date, merchant_id, channel_id, channel_name, category, amount, fee, status, failure_code, processing_time_ms, device_type, customer_region |
| `merchants` | merchant_id, merchant_name, category, tier, city, onboarding_date |
| `channels` | channel_id, channel_name, channel_type, provider |
| `failure_codes` | failure_code, failure_name, description, failure_type, owner_team, sla_hours |
| `incident_log` | incident_id, started_at, ended_at, channel_id, severity, incident_type, title, root_cause, status, related_failure_code |

Domain nilai: `status ∈ {SUCCESS, FAILED, PENDING, EXPIRED, REFUNDED}`; `failure_code` hanya terisi saat FAILED (FK ke `failure_codes`). 10 kanal, 7 kategori.

Dokumen seed (**6 file**, read-only): SOP-TRX-003 (PDF), Laporan Operasional 2026-09 & 2026-10 (PDF), Katalog Kode Kegagalan (DOCX), Catatan Insiden Okt–Nov 2026 (TXT), FAQ Customer Support (MD).

### 7.2 Definisi metrik (mengikat, dipakai semua role)

| Metrik | Definisi |
|---|---|
| Total transaksi | `COUNT(*)` semua status pada periode |
| Successful / Failed | `COUNT(*) WHERE status='SUCCESS'` / `='FAILED'` |
| Success rate | `SUCCESS / total × 100` (2 desimal) |
| Failure rate | `FAILED / total × 100` (2 desimal) |
| Failed ≠ | `EXPIRED`, `PENDING`, `REFUNDED` **bukan** failed |
| Nilai transaksi sukses | `SUM(amount) WHERE status='SUCCESS'` (IDR) |
| Perubahan % | `(now − prev) / prev × 100`; `prev = 0` → tampil `n/a`, bukan 0% atau ∞ |
| Per 1.000 transaksi | `count(failure_code) / total periode × 1000` |
| Kelebihan gagal (kontribusi) | `failed_actual − volume_now × failure_rate_baseline` |
| Like-for-like | periode setara (tgl 1–18 vs 1–18); MTD vs bulan penuh dilarang diklaim sebagai pertumbuhan |

### 7.3 Angka acuan (untuk verifikasi manual)

| Item | Nilai |
|---|---|
| Nov 2026 MTD (1–18) | total 8.125 · SUCCESS 7.537 (92,76%) · FAILED 399 (4,91%) · EXPIRED 90 (1,11%) · REFUNDED 64 (0,79%) · PENDING 35 (0,43%) |
| Bulanan | Agu 12.980 (95,00% / 2,81%) · Sep 12.520 (94,86% / 2,52%) · Okt 13.327 (94,36% / 3,30%) · Nov 8.125 (92,76% / 4,91%) |
| Volume | Okt penuh 13.327 · Okt 1–18 7.410 · Nov 1–18 8.125 · like-for-like **+9,65%** |
| Failure rate kanal Nov | VA Mandiri 16,17 · OVO 9,29 · Kartu Kredit 5,14 · DANA 3,40 · ShopeePay 3,21 · GoPay 3,10 · VA BNI 2,80 · VA BRI 2,70 · QRIS 1,94 · VA BCA 1,19 |
| Titik perubahan | VA Mandiri 15 Okt (memburuk 3 Nov) · OVO 6 Nov |
| Processing time | VA Mandiri 951 → 2.266 ms · OVO 746 → 1.366 ms |

### 7.4 Periode default

**2026-11-01 s.d. 2026-11-18** ("bulan ini" = November 2026 MTD). Pembanding default = **1–18 Okt 2026** (like-for-like). Tanggal sistem tidak dipakai sebagai "hari ini" (ASSUMPTION-001).

---

## 8. Prioritas MoSCoW

### Must (harus ada di MVP)

| ID | Item |
|---|---|
| M-01 | Landing → Overview; 5 KPI + 5 blok visual + filter + indikator periode/sumber |
| M-02 | Chat: intent routing SQL/RAG/HYBRID, jawaban terstruktur, query transparency |
| M-03 | Semua 21 pertanyaan A–E terjawab benar dari data seed; F1 hybrid; F2 multi-turn |
| M-04 | Guardrail F3 7/7 |
| M-05 | Riwayat percakapan (buat/buka/hapus) + suggested follow-ups |
| M-06 | Data Sources: daftar, upload CSV/XLSX, validasi, status, hapus |
| M-07 | Dataset Detail & Preview (skema, sample, row count, kualitas) |
| M-08 | Document Management + indeks 6 dokumen seed + sitasi |
| M-09 | Investigations: perbandingan periode, kontribusi kanal/kategori, temporal, korelasi vs kausal |
| M-10 | Reports: simpan dari chat, buka, ekspor CSV + PDF |
| M-11 | Settings: bahasa ID/EN, default date range, dataset aktif, profil |
| M-12 | Berjalan tanpa API key AI (deterministik) |
| M-13 | Read-only DB + guard SQL + validasi upload (NFR-04..06) |

### Should

| ID | Item |
|---|---|
| S-01 | Grafik interaktif (tooltip, legend toggle, ganti tipe chart) |
| S-02 | Recent insights otomatis di dashboard (≥ 3 temuan) |
| S-03 | Integrasi LLM opsional via env sebagai enhancement |
| S-04 | Visualisasi tabel↔grafik pada jawaban chat |
| S-05 | Saran pertanyaan kontekstual per halaman |
| S-06 | Empty state + pesan error yang informatif di semua halaman |

### Could

| ID | Item |
|---|---|
| C-01 | Ekspor dashboard ke PDF |
| C-02 | Pencarian/filter riwayat percakapan |
| C-03 | Reindex dokumen manual + pratinjau chunk |
| C-04 | Upload SQL database eksternal |
| C-05 | Tema gelap |

### Won't (eksplisit TIDAK dikerjakan)

| ID | Item | Alasan |
|---|---|---|
| W-01 | Multi-user, RBAC, kolaborasi, sharing | PRD 3.3 single-user |
| W-02 | SSO / enterprise auth | PRD 4.2 excluded; lihat ASSUMPTION-003 |
| W-03 | Real-time streaming analytics | PRD 4.2 excluded |
| W-04 | Integrasi ERP | PRD 4.2 excluded |
| W-05 | Automated business actions / agent otonom | PRD 4.2 excluded |
| W-06 | Predictive forecasting | PRD 4.2 excluded |
| W-07 | Mobile native app | PRD 4.2 excluded |
| W-08 | Automated test suite (unit/E2E) | Brief butir 4 — user menguji manual |
| W-09 | Login/registrasi & halaman login | Lihat ASSUMPTION-003 |
| W-10 | Notifikasi email/push, audit log multi-user | Tidak ada di PRD |

---

## 9. Traceability Matrix

| Req | Layar | Endpoint (konseptual — final di architect) | Acceptance | Lane |
|---|---|---|---|---|
| FR-01 | `/overview` | `metrics/summary`, `metrics/trend`, `metrics/breakdown` | AC-01.1..6 | frontend + backend |
| FR-02 | `/assistant` | `chat/messages`, `chat/sessions` | AC-02.1..7 | frontend + aiml/backend |
| FR-03 | `/data-sources`, `/upload`, `/dataset/[id]` | `sources`, `sources/upload`, `sources/:id` | AC-03.1..6 | frontend + backend |
| FR-04 | `/data-sources/documents` | `documents`, `documents/:id/reindex` | AC-04.1..5 | backend + aiml |
| FR-05 | `/investigations`, `/investigations/[id]` | `investigations`, `investigations/:id` | AC-05.1..5 | frontend + aiml |
| FR-06 | `/reports`, `/reports/[id]` | `reports`, `reports/:id/export` | AC-06.1..5 | frontend + backend |
| FR-07 | `/settings` | `settings` | AC-07.1..5 | frontend + backend |
| AI-01..03 | `/assistant` | `chat/messages` (intent + sql) | AC-AI-01..04 | aiml |
| AI-04 | `/assistant` | `chat/sessions` (context) | AC-AI-05..06 | aiml |
| AI-05..06 | `/assistant`, `/reports` | `chat/messages` (citations) | AC-AI-07..08 | aiml + backend |
| AI-07 | seluruh | semua | AC-AI-09 | backend |
| NFR-01..03 | `/overview`, `/assistant` | — | manual timing | backend |
| NFR-04..09, 13 | upload + chat + seluruh | — | skenario F3-3, restart | backend + security |
| NFR-10..12 | seluruh | — | §8 manual checklist | frontend + designer |

---

## 10. Definition of Done (manual, oleh user)

Dinyatakan selesai bila semua dapat dibuktikan **tanpa automated test**:

1. `install → build → start` sukses di mesin bersih; aplikasi terbuka tanpa error konsol kritis.
2. Landing → Overview: 5 KPI + 5 blok visual tampil dan **cocok dengan §7.3**.
3. Filter (periode/status/kanal/kategori) mengubah KPI & grafik secara konsisten; empty state benar.
4. A1–A4 terjawab benar dengan tabel/grafik + periode.
5. B1 memakai like-for-like; B2 tren 3 bulan; B3 kategori naik/turun benar.
6. C1–C3 mengidentifikasi VA Mandiri + OVO, bukan distraktor.
7. D1–D8 terjawab dengan sitasi dokumen + bagian.
8. E1–E3 + F1 (hybrid) + F2 (5 turn) selesai dalam **satu** percakapan tanpa mengulang konteks.
9. F3 7/7 berperilaku sesuai §6.6 — termasuk penolakan destruktif dan tidak mengarang angka.
10. Upload CSV/XLSX valid → `Ready` → muncul di dataset selector; file invalid → pesan error jelas.
11. Dataset Detail & Document Management menampilkan skema/sample/status indeks.
12. Investigasi tersimpan dan dapat dibuka ulang dengan angka sama.
13. Laporan tersimpan, dibuka ulang konsisten, dan terunduh (CSV + PDF).
14. Settings: ID↔EN, default date range, dataset aktif benar-benar berlaku.
15. Seluruh angka di UI dapat dilacak ke SQL atau dokumen (traceability).
16. Berjalan penuh **tanpa** API key AI.
17. Responsif di 1440 / 1024 / 390 px.

---

## 11. Asumsi & Pertanyaan Terbuka

Asumsi tercatat di `docs/DECISIONS.md`; di sini hanya ringkas.

| ID | Asumsi | Risiko |
|---|---|---|
| ASSUMPTION-001 | "Bulan ini" = Nov 2026 MTD (1–18), bukan tanggal sistem | low |
| ASSUMPTION-002 | Tidak ada automated test; build/typecheck akhir = syarat deliverable | low |
| ASSUMPTION-003 | Login Page (PRD 10.2) tidak diimplementasikan: single-user tanpa auth, entry lewat Landing (sesuai 7 layar Stitch) | low |
| ASSUMPTION-004 | "Dataset aktif" = satu dataset pada satu waktu; upload baru menjadi dataset terpisah, bukan menggabungkan baris | low |
| ASSUMPTION-005 | Ekspor PDF boleh dihasilkan server-side atau print-to-PDF browser; yang wajib adalah file PDF valid terunduh | low |
| ASSUMPTION-006 | Enam dokumen seed dihitung sebagai 5 jenis dokumen PRD 7.2 (2 laporan operasional berbagi jenis) | low |

**Pertanyaan terbuka:** tidak ada yang berstatus blocking. Keputusan stack, storage vektor, dan strategi indeks diserahkan ke architect (P1); keputusan visual ke designer (P2).

**Non-goals yang mengikat:** tanpa multi-user/SSO, tanpa streaming real-time, tanpa ERP, tanpa forecasting, tanpa mobile native, tanpa automated test, tanpa klaim kausalitas tanpa bukti dokumen.
