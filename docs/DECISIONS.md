# DECISIONS

Log keputusan, asumsi, dan eskalasi. Append-only. Semua role menulis di sini.

## Format

### DECISION-XXX
- **Tanggal:**
- **Oleh:** <role>
- **Fase:** P0..P7
- **Konteks:**
- **Keputusan:**
- **Alasan:**
- **Konsekuensi:**

### ASSUMPTION-XXX
- **Tanggal:**
- **Oleh:** <role>
- **Asumsi:**
- **Risiko:** low | medium | high

---

### DECISION-001
- **Tanggal:** 2026-11-19
- **Oleh:** agentic (orchestrator)
- **Fase:** P0
- **Konteks:** PRD merekomendasikan Next.js + FastAPI terpisah; user tidak memakai VPS dan akan menguji manual; tidak ada API key LLM di environment.
- **Keputusan:** Aplikasi dibangun sebagai Next.js full-stack (App Router, TypeScript) dengan SQLite lokal, deterministic analytics engine sebagai default, integrasi LLM opsional via env. Detail final diserahkan ke architect (P1) untuk verdict.
- **Alasan:** Satu proses, mudah dijalankan user (`npm install && npm run build && npm start`), tidak butuh VPS, tetap dapat dideploy ke Vercel.
- **Konsekuensi:** Semua fitur AI harus punya jalur deterministic yang akurat; LLM hanya enhancement.

### ASSUMPTION-001
- **Tanggal:** 2026-11-19
- **Oleh:** agentic
- **Asumsi:** "Bulan ini" untuk seluruh aplikasi = November 2026 (month-to-date 1–18 Nov), mengikuti README data uji, bukan tanggal sistem 2026-11-19.
- **Risiko:** low

### ASSUMPTION-002
- **Tanggal:** 2026-11-19
- **Oleh:** agentic
- **Asumsi:** Tidak ada proses testing otomatis yang dijalankan; build/typecheck akhir dianggap syarat deliverable, bukan testing fungsional.
- **Risiko:** low

### ASSUMPTION-003
- **Tanggal:** 2026-11-19
- **Oleh:** analyst
- **Fase:** P0
- **Asumsi:** Login Page yang tercantum di PRD 10.2 tidak diimplementasikan. MVP single-user tanpa autentikasi; pintu masuk aplikasi adalah public landing page (sesuai 7 layar Stitch) yang langsung menuju Overview.
- **Risiko:** low
- **Dampak:** W-09 pada `docs/SPEC.md`.

### ASSUMPTION-004
- **Tanggal:** 2026-11-19
- **Oleh:** analyst
- **Fase:** P0
- **Asumsi:** "Dataset aktif" berarti satu dataset dipakai pada satu waktu. Upload CSV/XLSX baru menjadi dataset terpisah yang dapat dipilih, bukan menggabungkan baris ke dataset seed.
- **Risiko:** low

### ASSUMPTION-005
- **Tanggal:** 2026-11-19
- **Oleh:** analyst
- **Fase:** P0
- **Asumsi:** Ekspor laporan PDF boleh dihasilkan server-side atau via print-to-PDF browser; yang mengikat hanya file PDF valid yang benar-benar terunduh dan konsisten dengan tampilan.
- **Risiko:** low

### ASSUMPTION-006
- **Tanggal:** 2026-11-19
- **Oleh:** analyst
- **Fase:** P0
- **Asumsi:** Paket data uji berisi 6 file dokumen (2 di antaranya laporan operasional bulanan), sehingga dianggap memenuhi 5 jenis dokumen pada PRD 7.2. Tidak perlu menambah dokumen baru.
- **Risiko:** low

### DECISION-002
- **Tanggal:** 2026-11-19
- **Oleh:** architect
- **Fase:** P1
- **Konteks:** PRD 6.1 meminta Next.js + FastAPI + PostgreSQL + pgvector + Docker. Kenyataannya: user tidak punya VPS, tidak ada API key LLM, pengujian manual, dan data uji sudah berupa SQLite 10,29 MB (5 tabel, 46.952 baris, FTS5 tersedia). DECISION-001 sudah mengunci Next.js full-stack; architect memvalidasi dan merinci konsekuensinya.
- **Keputusan:** Satu proses Next.js 16 (App Router, TypeScript). Route Handlers sebagai API (29 endpoint, `docs/API_CONTRACT.md`). SQLite via `better-sqlite3`: `data/analytics.db` di-ATTACH **read-only** sebagai schema `seed`, state aplikasi di `data/workspace/tanyadata.db` (dibuat `scripts/init-workspace-db.mjs`). Mesin analitik deterministik SQL-first (`lib/analytics/queries.ts` satu sumber SQL); retrieval dokumen BM25 lewat FTS5, bukan embedding. LLM hanya adapter opsional di belakang `lib/ai/llm.ts`; tanpa API key semua intent terjawab template deterministik. Tanpa auth, tanpa Docker, tanpa streaming, tanpa automated test (build + typecheck sebagai gate).
- **Alasan:** Satu runtime dan satu perintah jalan (`npm install && npm run build && npm start`) tanpa service eksternal. 46.952 baris dan 6 dokumen tidak membenarkan Postgres, vector DB, atau dua bahasa server. FTS5 sudah ada di SQLite 3.38.4 mesin target. Jalur deterministik menjamin angka acceptance di `docs/EVALUATION_QA.md` dapat direproduksi persis — LLM tidak boleh menjadi syarat kebenaran.
- **Alternatif ditolak:** (a) **FastAPI + PostgreSQL** — dua proses + satu service DB untuk 5 tabel; menambah mode gagal (port, venv, koneksi) tanpa manfaat NFR. (b) **DuckDB** — disebut PRD/README dan badge mockup, tetapi file seed adalah SQLite; butuh extension `sqlite_scanner` dan tidak persisten di Vercel. (c) **pgvector/embedding** — tidak ada API key, korpus 6 dokumen ±25,3k karakter; BM25 cukup dan bisa dijelaskan ke user. (d) **shadcn/ui** — menambah generator + puluhan dependensi untuk 12 halaman; primitif sendiri + Radix headless lebih ringan dan konsisten dengan arah desain.
- **Konsekuensi:** (1) Setiap fitur AI wajib punya jalur deterministic; kegagalan LLM → fallback template, bukan error 5xx. (2) Seed tidak boleh ditulis: `DELETE /api/sources/:id` hanya menyentuh metadata/chunk/tabel `ds_*`. (3) `data/workspace/` harus writable; di Vercel ephemeral, riwayat hilang saat cold start dan seed di-reindex otomatis — dinyatakan di README, target utama tetap lokal. (4) Tidak ada streaming token; satu respons per pesan. (5) Deviasi PRD C-01..C-13 tercatat di `docs/ARCHITECTURE.md` §1 dan mengikat QA saat verifikasi. (6) Tanpa auth: aplikasi tidak boleh dipublikasikan dengan data transaksi nyata.
- **Status:** accepted — verdict `FEASIBLE_WITH_CHANGES`, tanpa blocker.

### DECISION-016
- **Tanggal:** 2026-11-20
- **Oleh:** architect
- **Fase:** P1 (verdict arsitektur core V2)
- **Konteks:** User meminta sistem lebih baik dari rag-ids di VPS 2 vCPU / 2 GB dengan lima kemampuan baru: ingest tangguh, readjustment + report, chat per attachment, sitasi + guardrail, dan share link. `CORE_V2_SPEC` memuat 20 FR / 65 AC. Audit kode aktual menemukan dua fakta yang mengubah kelayakan: `lib/ingest/ocr.ts:82` mengirim `{ page }` tanpa piksel sehingga OCR tidak bisa membaca scan, dan jalur utama `lib/core/ingest.ts:171-204` tidak memanggil OCR sama sekali (teks < 40 karakter langsung `NO_TEXT_LAYER`). Selain itu timeout kode 15 s bertentangan dengan ADR-06 (5 s), watchdog belum ada, kap cache aktual 500 baris bukan 5.000, dan pustaka stemmer belum terpasang di manifest meski modulnya ada. Baseline eval 8/8 PASS dengan LEG-01/02 extraction recall 0,5.
- **Keputusan:** Terima verdict `FEASIBLE_WITH_CHANGES` per kelompok: FR-A, FR-B, FR-D, FR-E `FEASIBLE_WITH_CHANGES`; FR-C `FEASIBLE`. Terima tiga ADR baru di `docs/CORE_V2_ARCHITECTURE.md`: (ADR-11) OCR mengirim PNG base64 per halaman, 150 DPI, ≤2 MB, timeout 5 s, konkurensi 1, fallback `unreadable` jujur; (ADR-12) readjustment sebagai operasi deterministik dari `schema_json` dengan audit `ReadjustmentOp` append-only; (ADR-13) share sebagai snapshot bearer statis tanpa login dan tanpa revoke, dengan konfirmasi + peringatan PII wajib. Kontrak OCR ditetapkan sebagai P0 dan menjadi syarat masuk P3. Detail mengikat ada di `docs/CORE_V2_ARCHITECTURE.md`.
- **Alasan:** Tidak ada kelompok FR yang benar-benar tidak muat di 2 GB — yang tidak muat sudah ditolak sejak X-01…X-07 dan DECISION-015. Yang menghalangi bukan berat model, melainkan kontrak OCR yang salah dan batas resource yang belum dikunci di jalur core. Perbaikan bersifat aditif dan memakai fondasi yang sudah ada (`conversations.dataset_id`, FTS5, reranker metadata, pustaka PDF/Excel terpasang), sehingga eval 8/8 tidak perlu dikorbankan. Alternatif ditolak: OCR paralel (OOM), URL presigned (mode gagal tambahan), render ulang saat share (angka bisa drift), dan LLM memilih filter/kolom readjustment (non-deterministik).
- **Konsekuensi:** (1) Backend wajib menyatukan OCR ke jalur core dan memperbaiki payload sebelum FR-A.2 bisa diklaim selesai. (2) Watchdog RSS 1,2 GB, konkurensi 1, dan antrean ingest 1 menjadi gate P3. (3) Kap cache diselaraskan ke 5.000 baris / 50 MB dan pustaka stemmer dipasang sebelum evaluasi. (4) Share link bersifat bearer: konfirmasi dan peringatan PII tidak boleh dilewati; ketiadaan revoke (Q-02) harus dinyatakan jujur ke user. (5) Eval gabungan dijalankan sekali di P5: 8/8 tetap, minimal 8 dari 11 eval_case baru lulus, RAM puncak < 1,2 GB, share tanpa login. (6) ADR-C01..C05 dan ADR-06..ADR-10 tetap berlaku; tidak ada requirement atau desain UI yang diubah. (7) File lain tidak diubah selain `docs/CORE_V2_ARCHITECTURE.md` dan log ini.
- **Status:** accepted — verdict `FEASIBLE_WITH_CHANGES`, tanpa blocker terbuka; P0 OCR memiliki owner backend dan tenggat P3 langkah 2.

### ASSUMPTION-007
- **Tanggal:** 2026-11-19
- **Oleh:** architect
- **Fase:** P1
- **Asumsi:** State aplikasi (sumber, percakapan, pesan, laporan, investigasi, pengaturan, chunk FTS) hidup di satu file `data/workspace/tanyadata.db`; sumber seed selalu ber-`id` `seed` dan dataset seed tidak pernah dimigrasikan ke workspace. Saat boot, bila workspace DB belum ada, `migrate.ts` membuat skema lalu mendaftarkan sumber `seed` + mengekstrak 6 dokumen (idempoten).
- **Risiko:** medium
- **Dampak:** Di lingkungan ephemeral (Vercel) state hilang saat instance baru; mitigasi = auto-init + reindex, dan README menyatakan batas ini. Di lokal tidak ada dampak.


### DECISION-003
- **Tanggal:** 2026-11-19
- **Oleh:** agentic (orchestrator, atas permintaan user)
- **Fase:** P2
- **Konteks:** User meminta dashboard analitik yang menarik; motion harus intentional, bukan dekoratif.
- **Keputusan:** Motion system wajib didefinisikan di DESIGN_SYSTEM.md dan diimplementasikan dengan skill hyperframes-animation + motion-foundations/motion-patterns/motion-advanced. Animasi dibatasi pada: entrance once, transisi state filter, KPI count-up, chart draw-in, stagger list, feedback hover/press, typing indicator chat. Wajib prefers-reduced-motion, tanpa parallax/scroll-jacking/loop tak berfungsi, dan setiap animasi punya alasan satu baris (Purpose Gate R-37).
- **Alasan:** Meningkatkan persepsi kualitas dan keterbacaan data tanpa melanggar antislop.
- **Konsekuensi:** Designer menulis spek motion; frontend memuat skill sebelum coding dan memverifikasi hasil render sekali di akhir.

### DECISION-004
- **Tanggal:** 2026-11-19
- **Oleh:** designer
- **Fase:** P2
- **Konteks:** 7 mockup Stitch memuat klaim dan fitur yang tidak sesuai produk nyata (SQLite+FTS5 tanpa vector/lakehouse, tanpa auth, tanpa workflow sign-off) serta label English dan 4 KPI yang bertentangan dengan deviasi C-11/C-12/C-13. Mockup juga memakai Google Fonts/Material Symbols/Tailwind CDN yang tidak boleh dipakai (R-08, R-13).
- **Keputusan:** `docs/DESIGN_SYSTEM.md` menjadi satu-satunya sumber token (warna, tipe, spacing, radius, shadow, motion, z-index, breakpoint) dan spek 10 route. Mockup diperlakukan sebagai *referensi komposisi*, bukan kebenaran konten. Ruling deviasi: (a) klaim `Zero Data Leak`/`Lakehouse`/`Vector`/badge versi dihapus dan diganti klaim faktual; (b) KPI overview = 5 (C-11); (c) chip mesin = `SQLite · SQL + FTS5` (C-12); (d) seluruh label UI Indonesia (C-13); (e) galeri foto/network nodes/executive sign-off/convert-to-BI di investigasi & laporan dihapus karena bukan fitur; (f) `outline #707974` (4,2:1) dilarang untuk teks normal; (g) font & ikon lokal, token hanya via `@theme` Tailwind v4.
- **Alasan:** Menjaga kejujuran produk (klaim yang tidak dapat dibuktikan merusak kepercayaan), mematuhi keputusan arsitektur yang sudah mengikat, dan mencegah frontend menyalin mockup apa adanya.
- **Alternatif ditolak:** (a) Menyalin mockup 1:1 — akan mengirim klaim palsu dan fitur hantu. (b) Menulis ulang token dari nol — membuang sistem warna yang sudah konsisten dan disetujui di `DESIGN.md`. (c) Mempertahankan `outline` untuk caption — gagal WCAG AA.
- **Konsekuensi:** Frontend wajib mengikuti §8.2; deviasi Medium ke atas = 0 sebelum P5. Bila ingin mengembalikan fitur yang dihapus, buka DECISION baru lebih dulu. Landing butuh copy baru (bukan hasil terjemahan mockup).

### ASSUMPTION-008
- **Tanggal:** 2026-11-19
- **Oleh:** designer
- **Fase:** P2
- **Asumsi:** Status transaksi yang ditampilkan = empat nilai yang ada di seed (`SUCCESS`, `FAILED`, `PENDING`, `EXPIRED`); kategori laporan mengikuti field `type` pada `GET /api/reports` — bila field tidak tersedia, filter kategori disembunyikan (bukan dikarang). Kanal ditampilkan top 10 berdasarkan volume.
- **Risiko:** low
- **Dampak:** Bila backend memakai nilai status atau kategori lain, label pill/warna di §2.2 dan filter laporan harus disesuaikan sebelum implementasi; tidak ada perubahan struktur layar.

### DECISION-005
- **Tanggal:** 2026-11-19
- **Oleh:** agentic (orchestrator)
- **Fase:** P3
- **Konteks:** User menyediakan kredensial Groq (OpenAI-compatible endpoint) dan ingin LLM benar-benar dipakai, bukan hanya opsional.
- **Keputusan:** Kredensial disimpan hanya di 	anyadata/.env (gitignore), adapter LLM memakai LLM_MODE=full, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TIMEOUT_MS, LLM_MAX_OUTPUT_TOKENS. Model aktif: \openai/gpt-oss-120b\ (30 RPM / 1K req per hari / 8K TPM / 200K TPD). Semua angka tetap dihitung mesin deterministik; LLM hanya merapikan narasi & follow-up. Bila LLM gagal/timeout/rate-limit ? fallback deterministik otomatis (HTTP 200, \meta.fallbackReason\).
- **Alasan:** User ingin LLM terpakai, tetapi akurasi angka dan ketahanan tanpa koneksi tetap menjadi syarat technical test.
- **Konsekuensi:** Jangan pernah hardcode kunci; jangan tampilkan nama model/provider di UI. .env.example berisi placeholder saja.

### DECISION-006
- **Tanggal:** 2026-11-19
- **Oleh:** agentic
- **Fase:** P3
- **Konteks:** User memberi referensi https://www.rag-ids.web.id/settings (Intelligent Document Assistant) sebagai bahan pertimbangan algoritma pemahaman dokumen.
- **Keputusan:** TanyaData sudah lebih maju (Text-to-SQL + RAG hybrid + deterministic analytics engine + multi-turn). Yang diadopsi dari referensi untuk memperkuat RAG: (a) chunking sadar struktur small-to-big (pecahan + induk bagian) � sudah ada di chunker; (b) evidence gate: bila skor retrieval rendah ? label bukti terbatas / tolak + tawarkan kata kunci; (c) sitasi sampai halaman/bagian yang bisa dibuka; (d) cache jawaban. Yang TIDAK diadopsi untuk MVP: OCR PP-OCRv6 (dokumen seed sudah ber-text-layer), embedding lokal + Chroma + cross-encoder reranker (butuh model lokal, di luar scope tanpa GPU). Retrieval tetap FTS5 BM25 + fallback LIKE dengan ekspansi sinonim Indonesia.
- **Alasan:** Menjaga ketahanan tanpa model lokal dan fokus showcase; peningkatan retrieval semantik bisa jadi iterasi berikutnya bila user menyediakan embedding endpoint.
- **Konsekuensi:** RAG akurat untuk dokumen berstruktur; dokumen scan tidak didukung (sesuai data uji).

### DECISION-007
- **Tanggal:** 2026-11-20
- **Oleh:** user (via orchestrator)
- **Fase:** P7
- **Konteks:** Commit awal TanyaData dilakukan bulk (144 file dalam satu commit). User menyatakan ini bukan pola yang diinginkan.
- **Keputusan:** Kedepannya, commit WAJIB dipecah per fitur/modul yang koheren (mis. Perbaikan AI intent, halaman assistant, database schema, CI deploy — masing-masing commit sendiri), bukan satu commit besar yang memuat semua modul. Satu push boleh membawa banyak commit kecil yang tiapnya punya satu tanggung jawab.
- **Alasan:** Riwayat git yang terbaca per-fitur memudahkan review, rollback, dan pelacakan perubahan.
- **Konsekuensi:** Setiap perubahan lanjutan (termasuk perbaikan deploy Vercel) dipecah menjadi commit-commit kecil dengan pesan deskriptif. Commit awal sudah terlanjur bulk — tidak di-rewrite (reset/force-push) tanpa permintaan eksplisit.

### DECISION-008
- **Tanggal:** 2026-11-20
- **Oleh:** designer
- **Fase:** P6
- **Konteks:** Audit P6 (`docs/DESIGN_AUDIT.md`) menemukan skala tipografi §2.3 dan z-index §2.7 tidak menghasilkan utility Tailwind, dan utility `focus-ring` aktif permanen sehingga indikator fokus hilang di seluruh aplikasi.
- **Keputusan:** `@theme` di `globals.css` menjadi satu-satunya tempat deklarasi token `--text-*` (14 step §2.3 beserta line-height/weight/tracking) dan `--z-*`; utility `focus-ring` hanya aktif pada `:focus-visible`. Blok kode DESIGN_SYSTEM §2.8 diperbarui mengikuti. Komponen dilarang menambah token di file lain.
- **Alasan:** Tailwind v4 hanya menghasilkan utility dari token yang benar-benar dideklarasikan; kontrak spek harus bisa diverifikasi silang dengan CSS hasil build.
- **Konsekuensi:** Temuan A-01, A-02, A-03 (P0) dikerjakan dalam satu commit fondasi sebelum commit per halaman; verifikasi lewat computed style, bukan asumsi.

### DECISION-009
- **Tanggal:** 2026-11-20
- **Oleh:** designer
- **Fase:** P6
- **Konteks:** Dial ENERGY/RHYTHM/MOTION belum dinyatakan eksplisit di DESIGN_SYSTEM; implementasi memakai `Reveal` berbasis IntersectionObserver (scroll-driven) yang dilarang §3.2, dan count-up KPI §3.2 belum ada.
- **Keputusan:** TanyaData = **ENERGY 1 / RHYTHM 1 / MOTION 2**. Motion tetap dibatasi Purpose Gate §3.2: entrance sekali saat mount (hero landing 240ms), count-up KPI 600ms sekali per muat, chart draw-in 400ms sekali per perubahan filter, stagger maks 8 item × 30ms, typing indicator, hover/fokus. `Reveal` diganti entrance saat mount; scroll-driven reveal tetap dilarang. Dial dicatat di DESIGN_SYSTEM §1.
- **Alasan:** Produk operasional analitik mengutamakan kecepatan baca; motion hanya menandai hasil query dan kontinuitas percakapan, bukan dekorasi scroll.
- **Konsekuensi:** C-33 = ganti mekanisme, bukan hapus entrance; C-07 (count-up) dan C-08 (delay stagger blok Overview) tetap wajib diperbaiki sesuai §3.1/§3.2.

### DECISION-010
- **Tanggal:** 2026-11-20
- **Oleh:** designer
- **Fase:** P6
- **Konteks:** Implementasi menyediakan UI bilingual (kamus `en` lengkap + toggle bahasa di `/settings`), sedangkan DESIGN_SYSTEM §9 dan DECISION-004(d) mengunci UI Indonesia saja.
- **Keputusan:** Status quo dibekukan: kamus `en` boleh tetap di kode, tetapi tombol `English` di `/settings` disabled dengan catatan `Satu bahasa pada versi ini` (sesuai D.10). Mengaktifkan bilingual membutuhkan DECISION baru yang mencabut §9 dan menetapkan kriteria fidelity bahasa kedua.
- **Alasan:** Menghindari dua kebenaran desain yang bertentangan selama P6 dan verifikasi P5 ulang.
- **Konsekuensi:** Temuan C-28 selesai dengan perubahan UI saja; kamus tidak dihapus, tidak ada pekerjaan terjemahan baru.

### DECISION-011
- **Tanggal:** 2026-11-20
- **Oleh:** designer
- **Fase:** P2
- **Konteks:** User menolak hasil frontend P3 dan meminta refactor total. Seluruh tampilan WAJIB mengikuti folder `stitch_tanyadata_precision_analytics_workspace/` sebagai satu-satunya source of truth. Blueprint porting ditulis di `docs/REBUILD_BLUEPRINT.md`. Konflik dengan keputusan lama: DECISION-004 memperlakukan mockup sebagai referensi komposisi saja, mengunci UI Indonesia, chip mesin `SQLite · SQL + FTS5`, dan 5 KPI; DECISION-010 membekukan toggle English dalam keadaan disabled.
- **Keputusan:** (1) Stitch `code.html` + `DESIGN.md` menjadi satu-satunya kebenaran untuk struktur, kelas Tailwind, token, ikon, komposisi, dan bahasa label. Port 1:1, bukan interpretasi. (2) Ikon UI memakai paket npm `material-symbols` self-hosted; Lucide dihapus dari UI. (3) Seluruh label UI mengikuti Stitch, yaitu English; toggle ID/EN di topbar aktif dan mengubah label UI, default `en`. Konten jawaban AI tetap mengikuti `lang` pada request, terpisah dari bahasa label UI. (4) DECISION-004(c), DECISION-004(d), dan DECISION-010 dicabut. DECISION-008 dan DECISION-009 tetap berlaku. DECISION-004(a), (e), (f) tetap berlaku: klaim tak terbukti dan galeri foto/sign-off/Jira/convert-to-BI tidak di-port, `outline #707974` tidak dipakai untuk teks normal. (5) DECISION-004(b) digantikan: Overview memakai 4 kartu KPI sesuai Stitch, bukan 5.
- **Alasan:** User secara eksplisit meminta kesetiaan penuh pada desain awal Stitch. English adalah bahasa label di semua 7 `code.html`, sehingga mempertahankan UI Indonesia akan menghasilkan deviasi fidelity permanen. Material Symbols self-hosted menghilangkan ketergantungan CDN sekaligus memenuhi ikon eksak Stitch. Pengecualian klaim/foto dipertahankan karena user juga melarang angka fiktif dan kontrol mati.
- **Konsekuensi:** (1) Frontend mengerjakan 10 commit bertahap sesuai §6 blueprint. (2) QA wajib memperbarui ekspektasi C-11 di `docs/EVALUATION_QA.md` dari 5 KPI menjadi 4 KPI. (3) Token lama di `globals.css` yang bertentangan (radius `lg` 12px, `xl` 16px, `full` 999px, skala teks `headline-lg` 28px, `body-lg` 16px) wajib diubah ke nilai Stitch; deviasi Medium ke atas = 0 sebelum P5. (4) Kamus `en` yang sudah ada dipakai aktif, bukan lagi cadangan.   (5) Fidelity review membandingkan screenshot 1440/1024/390 terhadap `screen.png` Stitch per layar.

### DECISION-012
- **Tanggal:** 2026-11-20
- **Oleh:** designer
- **Fase:** P6
- **Konteks:** Audit `docs/UX_SLOP_AUDIT.md` menyimpulkan port 1:1 Stitch masih terasa AI-generik. DECISION-011 point (1) menjadikan `code.html` kebenaran mutlak dan REBUILD_BLUEPRINT §5.1 melarang perbaikan komposisi, sehingga kriteria "fidelity" tidak dapat mendeteksi slop. User mengonfirmasi secara eksplisit bahwa "sense dari slop UI masih sangat terasa".
- **Keputusan:** Untuk kategori elemen tertentu, **UX rationality mengalahkan Stitch verbatim**. Kategori yang dikecualikan dari DECISION-011 point (1): (a) klaim yang tidak dapat dibuktikan ("live", "AGENT ONLINE", "Final Draft", "Internal Restricted", "verified by engine"); (b) identitas dan nama fiktif ("R. Hartono", "Data Lead", "q3_transactions_prod.csv", "TD"); (c) label buzzword yang tidak menyebut fungsi ("Executive Console", "Telemetry Live", "Contextual Ledger", "Autonomous Inferences"); (d) skala teks di bawah 12px dan target sentuh di bawah 44px; (e) warna yang bertentangan dengan makna data (Lowest/Highest); (f) shadow dekoratif pada kartu statis dan ping loop di luar kuota DECISION-009. Fidelity review pasca-perbaikan membandingkan terhadap `DESIGN_SYSTEM.md` + keputusan ini, bukan terhadap `code.html`.
- **Alasan:** Fidelity adalah alat, bukan tujuan. Mengukur kemiripan dengan sumber yang slop membuat slop lolos audit. Kategori di atas merusak kepercayaan, keterbacaan, atau pengambilan keputusan user, dan tidak ada satu pun yang merupakan kebutuhan produk.
- **Alternatif ditolak:** (a) Mempertahankan verbatim demi konsistensi mockup, karena user sudah menolak hasilnya; (b) Membiarkan perbaikan tanpa ruling, karena akan menimbulkan deviasi fidelity yang dianggap cacat oleh QA; (c) Mencabut DECISION-011 seluruhnya (Opsi C audit) tanpa konfirmasi user.
- **Konsekuensi:** (1) QA memperbarui ekspektasi fidelity: deviasi pada kategori (a)–(f) adalah perbaikan, bukan temuan. (2) 8 commit perbaikan di `docs/UX_SLOP_AUDIT.md` §4 menjadi acuan urutan kerja. (3) DECISION-004(a), (e), (f) dan DECISION-008/009 tetap berlaku. (4) Elemen Stitch di luar kategori (a)–(f) tetap di-port verbatim.

### DECISION-013
- **Tanggal:** 2026-11-20
- **Oleh:** designer
- **Fase:** P2
- **Konteks:** User menolak hasil port 1:1 Stitch karena terasa "anak magang asal jadi", tanpa identitas, dan masih slop. `docs/UX_SLOP_AUDIT.md` (33 temuan) membuktikan akar masalahnya adalah DECISION-011 yang menjadikan fidelity satu-satunya kriteria dan REBUILD_BLUEPRINT §5.1 yang melarang perbaikan komposisi. User meminta designer memilih arah; arah terpilih adalah **Precision Console**, instrument presisi untuk analis data, bukan glassmorphism, neobrutalism, atau bento generik.
- **Keputusan:** (1) `docs/DESIGN_DIRECTION.md` menggantikan `docs/REBUILD_BLUEPRINT.md` sebagai kontrak visual tunggal frontend. Folder Stitch diturunkan menjadi referensi komposisi, bukan kebenaran. (2) DECISION-011 point (1) dicabut secara penuh untuk urusan visual (struktur, kelas, token, komposisi, radius, shadow, skala teks); DECISION-012 diperluas dari enam kategori menjadi seluruh permukaan visual. (3) Palet baru menggantikan token Stitch: canvas `#F5F6F1`, surface `#FFFFFF`, ink `#1B211D`, primary forest `#0B4433`, lime `#C5D94B` hanya untuk state aktif/sinyal, terracotta `#CF7656` hanya untuk isian/border error, muted `#6B746D` dengan aturan kontras terukur. (4) Motion system wajib: token 80/120/180/320ms, dua easing, sembilan motion signature, Purpose Gate satu baris, `prefers-reduced-motion` 0ms, tanpa parallax/scroll-jacking/loop dekoratif, maks 400ms untuk perubahan data. (5) Dial diubah: ENERGY 1 / **RHYTHM 2** / MOTION 2; RHYTHM naik karena asymmetric bento dan measurement rule adalah variasi disengaja. Count-up 600ms DECISION-009 dicabut menjadi 320ms. (6) Tidak ada identitas, nama, role, avatar, atau user rekaan karena produk tidak memiliki RBAC. (7) Bahasa label UI dan paket ikon tidak diubah oleh keputusan ini, masih mengikuti DECISION-011 point (2) dan (3) sampai ada ruling terpisah.
- **Alasan:** Mengukur kemiripan dengan sumber yang slop membuat slop lolos audit. Kriteria keberhasilan harus bergeser dari "sama dengan mockup" menjadi "masuk akal, terbaca, dan dipercaya analis". Identitas rekaan merusak kepercayaan lebih cepat daripada desain buruk, dan klaim "live" pada data statis adalah klaim palsu. Motion bukan dekorasi melainkan konfirmasi bahwa data baru saja berubah.
- **Alternatif ditolak:** (a) Opsi A audit, perbaiki P0 saja, karena slop struktural tetap hidup; (b) terus mempertahankan DECISION-011 demi konsistensi mockup, karena user sudah menolak hasilnya dua kali; (c) menambah dependensi animasi berat (GSAP sebagai default) tanpa alasan, karena CSS/WAAPI dan Recharts mencukupi untuk sebagian besar signature.
- **Konsekuensi:** (1) Frontend berhenti memakai REBUILD_BLUEPRINT sebagai acuan dan mengerjakan DESIGN_DIRECTION §2–§6. (2) QA mengganti baseline fidelity dari `screen.png` Stitch ke `DESIGN_DIRECTION.md`; deviasi Medium ke atas = 0 sebelum P5. (3) DECISION-004(a), (e), (f), DECISION-008, dan DECISION-012 tetap berlaku; DECISION-009 tetap berlaku kecuali dial RHYTHM dan durasi count-up. (4) Screenshot wajib di lima ukuran: 1440, 1280, 1024, 768, 390. (5) Semua angka, status, dan nama file tetap berasal dari API tanpa embellishment.

### DECISION-014
- **Tanggal:** 2026-11-20
- **Oleh:** architect (atas keputusan user via orchestrator)
- **Fase:** P1 (ulang)
- **Konteks:** User memutuskan berhenti mengejar UI dan mulai membangun core. TanyaData tidak boleh terikat pada satu kasus (transaksi QRIS). Arsitektur v1 menanam pengetahuan domain di kode: 28 intent `A1_total`–`F3` di `lib/ai/intents.ts`, SQL agregat di `lib/analytics/queries.ts`, 14 `CANONICAL_COLUMNS` di `lib/ingest/validate.ts`, chart tetap di `lib/ai/compose.ts`, serta template dokumen `D1`–`D8`. Dataset UUD, laporan drilling, dan finansial tidak dapat diproses tanpa mengubah kode. Ini bukan bug, melainkan kesalahan desain fondasi.
- **Keputusan:** Bangun core baru yang schema-driven dan dataset-agnostik di `lib/core/**`: 6 entitas data (`Dataset`, `SchemaColumn`, `Document`, `Chunk`, `Query`, `VizSpec`), pipeline 12 tahap, text-to-SQL dinamis dengan validator 7 lapis, FTS5 wajib + embedding opsional, `VizSpec` adaptif, profil dokumen per `doc_type`, dan eval harness per tahap. Arsitektur lama dipindahkan menjadi satu adapter demo `lib/adapters/qris-demo/**` dan dipertahankan sampai parity angka/sitasi tercapai. Detail mengikat ada di `docs/CORE_ARCHITECTURE.md`.
- **Alasan:** Pengetahuan domain harus dibaca dari `schema_json` dan data, bukan ditulis ulang di kode setiap kali ada domain baru. Demo QRIS sudah diverifikasi user lewat `docs/EVALUATION_QA.md`, sehingga tidak boleh rusak selama transisi.
- **Alternatif ditolak:** (a) Menambah intent baru per domain — biaya tumbuh linier dan tetap mengikat UI/API. (b) Rewrite total dengan menghapus demo — kehilangan bukti yang sudah disetujui user. (c) Core memanggil intent lama — ketergantungan balik membuat generalisasi hanya palsu.
- **Konsekuensi:** (1) Enam perubahan wajib `C-01`..`C-06` di `docs/CORE_ARCHITECTURE.md` menjadi syarat masuk P3. (2) Tidak ada blocker terbuka di P1; verdict `FEASIBLE_WITH_CHANGES`. (3) Kontrak `/api/core/**` menyusul lewat DECISION terpisah; `docs/API_CONTRACT.md` tidak diubah pada P1 ini. (4) `lib/core/**` dilarang mengimpor `lib/ai/intents.ts` atau `lib/analytics/queries.ts` (ADR-C05). (5) File lain tidak diubah selain `docs/CORE_ARCHITECTURE.md` dan log ini.
- **Status:** accepted — verdict `FEASIBLE_WITH_CHANGES`, tanpa blocker.

### DECISION-015
- **Tanggal:** 2026-11-20
- **Oleh:** architect
- **Fase:** P1 (ADR optimasi resource)
- **Konteks:** User menantang membangun sistem lebih baik dari rag-ids.web.id di VPS 2 vCPU / 2 GB RAM / 40 GB SSD / 20 Mbps. Referensi rag-ids memakai PP-OCRv6 (~600–1000 MB), e5-base 768 dim (~440 MB), Chroma (~250–400 MB), dan bge-reranker (~1 GB) — kombinasi yang akan OOM bila jalan bareng Node + SQLite di 2 GB. Audit kode aktual menunjukkan stack berat itu **sudah tidak ada** di `tanyadata/package.json`; `lib/core/store.ts` dan `lib/ai/retrieval.ts` sudah memakai FTS5 BM25 + LIKE, reranker tanpa model, dan LLM HTTP opsional. Yang belum ada adalah pengikatan batas resource: OCR per halaman belum punya timeout/konkurensi, cache belum diimplementasi (padahal `SchemaJson.hash` sudah ada), stemming Indonesia belum ada, dan dua implementasi reranker masih terduplikasi. EVAL_RESULTS baseline PASS 8/8 dengan dua kegagalan extraction recall pada kasus legal (LEG-01/LEG-02 = 0,5).
- **Keputusan:** Terima lima ADR baru di `docs/RESOURCE_OPTIMIZED_ADR.md`: (ADR-06) text-layer first, OCR on-demand per halaman, konkurensi 1, timeout 5 s, anak proses yang dimatikan, watchdog RSS 1,2 GB; (ADR-07) FTS5 BM25 wajib + Sastrawi stemming simetris di index dan query, embedding tetap opsional via env; (ADR-08) cache SQLite `core_query_cache` TTL 30 menit, kap 5.000 baris/50 MB, bukan Redis; (ADR-09) tiga level kepercayaan `bukti kuat / bukti terbatas / tolak` dipetakan dari status `ok / evidence_limited / no_evidence`; (ADR-10) reranker ringan = skor FTS5 + metadata boost + pasal/ayat, kandidat lebar 20 → top-5, bukan cross-encoder. Prinsip: text-layer dulu, OCR hanya fallback per halaman, embedding opsional, FTS5 wajib.
- **Alasan:** Menghindari OOM tanpa mengorbankan kejujuran jawaban. Semua perubahan bersifat ringan (satu dependensi JS ~20 MB, satu tabel SQLite, pembatasan alur) dan memakai fondasi yang sudah ada di kode, bukan menulis ulang arsitektur. Alternatif yang ditolak: OCR semua halaman, embedding lokal, Chroma, cross-encoder, dan Redis — semuanya menambah RAM/proses tanpa manfaat NFR pada skala satu VPS.
- **Konsekuensi:** (1) `package.json` bertambah `sastrawi`; modul ditempatkan di `lib/core/stem.ts` dan diimpor `lib/ai/**` (menjaga ADR-C05). (2) Backend menambah migrasi `core_query_cache`, watchdog, dan timeout ingest; aiml menyatukan reranker dan memetakan 3 level kepercayaan; designer memastikan renderer `none` menampilkan label bukti terbatas. (3) Titik ukur wajib: eval PASS 8/8, RAM puncak < 1,2 GB saat ingest 10 dokumen, latency query p95 < 2 s dengan `LLM_MODE=off`. (4) ADR-C01..C05 dan DECISION-014 tetap berlaku; tidak ada requirement atau desain UI yang diubah. (5) File lain tidak diubah selain `docs/RESOURCE_OPTIMIZED_ADR.md` dan log ini.
- **Status:** accepted — verdict `FEASIBLE_WITH_CHANGES`, tanpa blocker.


### DECISION-017
- **Tanggal:** 2026-11-20
- **Oleh:** agentic (orchestrator)
- **Fase:** P3-CORE-V2
- **Konteks:** Push ke GitHub gagal 4x (timeout + GIT_TERMINAL_PROMPT=0 ? 'could not read Username'). Windows Credential Manager punya entri github.com/aldyardnsyh tetapi tidak mengembalikan kredensial; GCM_INTERACTIVE=Never mengonfirmasi cache expired.
- **Keputusan:** Berhenti retry (anti-stuck: maks 2x, sudah 4x). Kode lokal aman & terverifikasi (typecheck 0, build 0, eval PASS 8/8 + 11/11). Push ditunda sampai user login GitHub lagi di mesin ini.
- **Alasan:** Memaksa push dengan kredensial rusak berisiko merusak remote; ini bukan error kode.
- **Konsekuensi:** Remote masih di 893e669, lokal di ad6a8e7. User perlu: (1) buka terminal, jalankan 'git push' di folder tanyadata saat diminta login, atau (2) jalankan 'git credential-manager reject https://github.com' lalu login ulang.

### DECISION-018
- **Tanggal:** 2026-11-20
- **Oleh:** architect
- **Fase:** P1 (review overfitting, memicu P4)
- **Konteks:** Uji buta pada dokumen non-kalibrasi (SOP layanan) menghasilkan answerable 0/8, refusal 1/3, overall 0.0909, sementara Perpres 76/2013 dilaporkan 0.9960. Audit menemukan eval mengukur `chunkLegalDocument` yang hanya dipanggil di `lib/eval/perpres.ts`, sedangkan produksi memakai `chunkSections`; `composeDeterministicAnswer` memotong kutipan di 240/400 char pertama; sinyal `out_of_scope` AI-lane tidak dikonsumsi jalur produksi; dan grader menghitung label halaman sah sebagai angka asing (artefak 0.9091, angka karangan nyata = 0). Ini cacat arsitektur — eval dan produksi adalah dua pipeline berbeda — bukan tiga bug lokal.
- **Keputusan:** Terima verdict `FEASIBLE_WITH_CHANGES` dan lima ADR di `docs/OVERFITTING_REMEDIATION_ADR.md`: (ADR-OF-11) ekstrak snippet di sekitar query-term, deterministik, 0 RAM tambahan; (ADR-OF-12) promosikan `out_of_scope` ke jalur produksi sebelum compose, dengan `availableTopics` dari registry bukan hard-code; (ADR-OF-13) satu entry point `chunkDocument`, legal → `chunkLegalDocument`, non-legal → `chunkSections`, eval wajib memakai jalur yang sama; (ADR-OF-14) allow-list grader menyertakan `section_path` dan label halaman; (ADR-OF-15) gate hold-out wajib: answerable ≥ 0,80, refusal ≥ 0,80, delta ≤ 0,15 dengan metrik sejenis. Penomoran memakai prefix `ADR-OF-*` karena `ADR-11`…`ADR-13` di `docs/CORE_V2_ARCHITECTURE.md` sudah dipakai dan tetap berlaku.
- **Alasan:** Tidak ada kelayakan yang terhalang — semua perubahan deterministik dan memakai kode yang sudah ada. Yang rusak adalah kontrak pengukuran: angka 0.996 mengukur seberapa cocok aturan dengan dokumen yang dipakai untuk merancang aturan itu. Memperbaiki gejala tanpa menyatukan jalur dan memasang gate hanya akan memindahkan overfitting ke SOP. Alternatif ditolak: menaikkan ambang, menghapus label halaman dari jawaban, classifier LLM, dan mengejar 0.996 dengan jalur eval khusus.
- **Konsekuensi:** (1) Backend owning entry point chunker, quote penuh, dan guardrail produksi; aiml menyamakan eval ke jalur produksi, memangkas regex PII, dan menyediakan metrik delta sejenis; QA owning allow-list grader dan gate hold-out. (2) Skor Perpres **boleh dan diharapkan turun**; keberhasilan diukur dari hold-out naik dan delta mengecil — kita tidak mengejar 0.996 lagi, kita mengejar generalisasi. (3) Gate mengikat P3→P4 dan P5; tuning gagal gate ditolak walau Perpres naik. (4) RAM puncak < 1,2 GB dan p95 < 2 s tetap berlaku. (5) ADR-C01..C05, ADR-06..ADR-10, dan ADR-11..ADR-13 (CORE_V2) tetap berlaku; tidak ada requirement atau desain UI yang diubah. (6) File lain tidak diubah selain `docs/OVERFITTING_REMEDIATION_ADR.md` dan log ini.
- **Status:** accepted — verdict `FEASIBLE_WITH_CHANGES`, tanpa blocker terbuka; R-2 (false positive guardrail) dan R-7 (RAM saat reindex) punya owner dan tenggat P3/P5.

### DECISION-019
- **Tanggal:** 2026-11-20
- **Oleh:** agentic (orchestrator)
- **Fase:** P3-OVERFIT-FIX
- **Konteks:** User curiga skor 0.996 pada Perpres 76 hanya 'mencocokan' (overfitting). Blind hold-out pada dokumen SOP layanan (non-kalibrasi) membuktikan: 0.0909 (1/11) � answerable 0, refusal 0.33. Akar: eval mengukur jalur chunkLegalDocument eval-only, produksi pakai chunkSections; compose memotong 240 char pertama; sinyal out_of_scope tidak dipakai produksi; citationRegistry tidak dilewatkan di harness.
- **Keputusan:** Terima penurunan skor Perpres sebagai harga generalisasi. Terapkan 5 ADR (OF-11 snippet window, OF-12 out_of_scope ke produksi, OF-13 satu entry point chunkDocument, OF-14 grader allow-list, OF-15 gate hold-out). Pasang gate: answerable =0.80, refusal =0.80, delta sejenis =0.15. Hasil akhir: hold-out 1.0000 (11/11), delta 0.0000, eval lama tetap PASS.
- **Alasan:** Angka kalibrasi yang tidak transferable adalah omong kosong. Konsistensi antara apa yang diukur dan apa yang dipakai lebih penting dari skor tertinggi.
- **Konsekuensi:** Setiap tuning ke depan WAJIB lolos uji buta dokumen non-kalibrasi sebelum disebut selesai. Fixture hold-out kedua masih diperlukan sebelum rilis (catatan QA).

### DECISION-020
- **Tanggal:** 2026-11-20
- **Oleh:** user (via orchestrator)
- **Fase:** P3 ? P6
- **Konteks:** User memberikan otonomi penuh (full access) tanpa pertanyaan antara. Dua target berurutan: (1) selesaikan core engine termasuk 5 bug dari uji 6 dokumen nyata; (2) refactor seluruh halaman dengan referensi https://ui.aceternity.com/ � hanya palet warna lama yang dipertahankan, struktur/komponen/motion dibangun ulang dari awal mengikuti fitur & modul.
- **Keputusan:** Eksekusi tanpa approval per-langkah. Priority: core dulu (akurasi > estetika), baru UI. Tiap perbaikan/core & tiap modul UI tetap commit kecil. Verifikasi: typecheck+build+eval+hold-out+robustness hijau, lalu screenshot multi-viewport untuk UI. Selesai = user tinggal mencoba.
- **Alasan:** User ingin hasil final yang bisa langsung diuji, bukan dialog pilihan.
- **Konsekuensi:** Orkestrator mengambil semua keputusan desain/teknis; tidak ada pertanyaan ke user sampai semua selesai.

### DECISION-021
- **Tanggal:** 2026-11-20
- **Oleh:** designer (via orchestrator)
- **Fase:** P2-REFACTOR
- **Konteks:** DECISION-020 memberi otonomi penuh dan menargetkan refactor seluruh halaman dengan referensi https://ui.aceternity.com/components. User menegaskan hanya palet warna lama yang dipertahankan, sedangkan struktur, komponen, motion, radius, tipografi, dan layout dibangun ulang dari awal. Dua arah visual sebelumnya, Stitch verbatim (DECISION-011) dan Precision Console (DECISION-013), sudah ditolak user karena terasa generik.
- **Keputusan:** (1) `docs/UI_REFACTOR_DESIGN.md` menjadi kontrak visual tunggal baru. DECISION-013 point (1) dan (3) dicabut untuk urusan visual, begitu pula `DESIGN_DIRECTION.md`, `REBUILD_BLUEPRINT.md`, dan folder Stitch sebagai sumber kebenaran. (2) Enam hex lama, forest `#0B4433`, lime `#C5D94B`, terracotta `#CF7656`, porcelain `#F3F4EF`, ink `#1B211D`, dan muted `#78817A`, adalah satu-satunya warisan. Turunan apa pun wajib berupa alpha dari enam token ini, bukan hex baru. (3) Sistem baru memakai 12 komponen khas, 10 motion signature, 9 modul, dan 5 breakpoint. (4) Dial ditetapkan ulang menjadi ENERGY 1 / RHYTHM 2 / MOTION 1. (5) DECISION-008, DECISION-015, DECISION-016, DECISION-018, DECISION-019, dan DECISION-020 tetap berlaku untuk urusan non-visual. DECISION-009 tetap berlaku kecuali dial dan durasi yang bertentangan dengan dokumen baru. (6) Fase ini hanya menghasilkan spesifikasi, bukan kode aplikasi.
- **Alasan:** Mengukur fidelity terhadap sumber yang sudah ditolak membuat slop lolos audit. Aceternity dipakai sebagai studi tentang arah perhatian, bukan sebagai katalog efek untuk disalin. Membatasi warisan pada enam warna memberi identitas yang dikenal sekaligus memaksa semua keputusan lain dijelaskan ulang dengan alasan satu baris.
- **Alternatif ditolak:** (a) Menyalin komponen Aceternity apa adanya, karena efek landing page akan mengganggu pembacaan data dan melanggar Purpose Gate. (b) Melanjutkan Precision Console dengan perbaikan kosmetik, karena user sudah menolak arahnya dua kali. (c) Mempertahankan Stitch sebagai baseline fidelity, karena kriteria itu justru mempertahankan masalah yang sama.
- **Konsekuensi:** (1) Frontend menulis ulang komposisi sembilan modul, menghapus 14 file komponen lama, dan memakai token baru tanpa nilai ad-hoc. (2) QA mengganti baseline fidelity ke `docs/UI_REFACTOR_DESIGN.md` dengan screenshot 1440, 1024, dan 390 per modul. (3) Deviasi Medium ke atas harus nol sebelum P5. (4) Setiap angka pada screenshot tetap berasal dari `result_json`; tidak ada klaim live, identitas rekaan, atau angka dari narasi. (5) File lain tidak diubah selain `docs/UI_REFACTOR_DESIGN.md` dan log ini.
- **Status:** accepted — tanpa blocker terbuka.

### DECISION-022
- **Tanggal:** 2026-11-22
- **Oleh:** build agent (user-provided ground truth)
- **Fase:** P3-TUNING / P5-VERIFY
- **Konteks:** User memberikan `perpres_76_2013.json` sebagai ground truth kurasi dan meminta tuning OCR/cleaning/chunking/struktur yang tetap robust pada dokumen topik lain. Audit menemukan teks PDF dibaca dalam urutan content-stream, hasil `repairMojibake` dibuang oleh chunker legal, cross-reference "Pasal 36" dijadikan pasal baru, semua chunk legal ditandai `parent` sehingga retrieval kehilangan child, dan rerank membalik urutan BM25.
- **Keputusan:** (1) Ekstraksi PDF diurutkan geometris (y lalu x, toleransi 3). (2) `legalSectionsFromPages` hanya memulai section pada heading `Pasal N` yang berdiri sendiri; ayat/butir dikirim eksplisit sebagai `LegalChildInput`; pembukaan/penutup jadi section tersendiri. (3) `mirrorChunks` menandai `parent` hanya bila ada child yang mereferensikannya. (4) Leksikon konfusi OCR generik (cl→d, rn→m, pc→pe, spasi nomor, footer) diterapkan sebelum checksum numerik dihitung. (5) Skor retrieval = `abs(bm25)` (besar = relevan); guardrail menerima `1/(1+skor)` agar kalibrasi ambang tidak berubah. (6) Angka pada hint `Pasal N` ikut menjadi term FTS. (7) Eval GT baru `npm run eval:extraction-gt` mengukur teks, 21 pasal, 41 ayat, 34 butir, hierarki, dan residu mojibake.
- **Alasan:** Urutan baca dan struktur adalah sifat dokumen, bukan topik; keduanya diperbaiki generik. Leksikon glyph berisi konfusi OCR umum, bukan kosakata Perpres. Guardrail tidak boleh berubah karena skala skor retrieval diubah.
- **Konsekuensi:** `eval:extraction-gt` PASS 94/94 teks persis + 41 ayat + 34 butir + 101 chunk; `eval:ground-truth` PASS 12+11+6; hold-out SOP PASS 11/11; `eval:real-docs` PASS 24/24; `typecheck` PASS. Lapisan guardrail diperbaiki generik: `out_of_scope` tidak lagi ditekan oleh skor sitasi, dukungan dihitung dari istilah khas (≥2 kecocokan) agar pertanyaan tanpa jawaban tetap ditolak, pola PII diperluas, jendela bukti diperlebar, dan dedupe sitasi per chunk (bukan per bagian) agar bukti dari bagian sama tetap masuk. Satu frasa RD-TXT-02 ("20 november 2026") memang tidak ada di sumber insiden (format ISO), tetapi kasus tetap PASS 0.80 ≥ ambang.
- **Status:** accepted — seluruh gate hijau.

### DECISION-023
- **Tanggal:** 2026-11-22
- **Oleh:** build agent (validasi langsung LLM Groq + QA browser)
- **Fase:** P3-TUNING / P5-VERIFY
- **Konteks:** User melaporkan dua dokumen (Perpres 76/2013 dan FAQ CS): pertanyaan lanjutan yang masih bersumber dari dokumen yang sama ditolak `out_of_scope`, pertanyaan Pasal 1 menarik Pasal 18/17/11/12, dan jawaban hanya kumpulan kutipan mentah. Juga marker sitasi inline hanya merespons klik, bukan hover popover spesifik.
- **Keputusan:** (1) `searchChunks` memfilter Pasal N secara struktural pada `section_path` (format `Pasal N`, `Pasal N/...`, dan `Pasal N > ...`), bukan sekadar skor BM25. (2) Guardrail tidak lagi membiarkan kata tanya generik (`menyebabkan`, `menjelaskan`, `terkait`, dll.) memicu penolakan; ambang turun ke 0,25 bila tidak ada istilah khas, sementara istilah aksi yang benar-benar absen tetap menolak. (3) Pertanyaan meta "per pasal-pasalnya poin utamanya..." masuk jalur `documentOverview`, dengan ringkasan per bagian hingga 24 section. (4) `answerComposer` kini memang Groq via `callLlmStructured` untuk jawaban dokumen, dengan aturan marker `[n]`, allow-list angka, dan fallback deterministik bila gagal/ungrounded. (5) `InlineCitationMark` memakai popover stateful (hover/focus, posisi fixed ter-clamp, Escape, delay 140ms) yang menampilkan kalimat kutipan paling relevan dari `citation.quote`, bukan seluruh chunk.
- **Alasan:** Evaluasi sebelumnya memakai LLM off sehingga tidak merefleksikan perilaku produksi. Semua perbaikan diuji langsung dengan `LLM_MODE=full` melalui Groq pada tujuh pertanyaan yang dilaporkan, lalu dijaga oleh suite offline dan browser QA.
- **Konsekuensi:** Tujuh kasus LLM: enam menjawab dari sitasi yang benar, meta FAQ pulih. `eval:ground-truth`, `eval:holdout`, `eval:real-docs`, `eval:extraction-gt`, `typecheck`, `build` PASS; browser QA 17/17 PASS dengan screenshot `~/.browserqa/artifacts/20261122-101447-citation-hover-trust/`. Satu fallback meta sempat terjadi saat tujuh panggilan LLM beruntun; isolasi tiga kali berturut-turut PASS, jadi flakicity penyedia bukan perubahan logika.
- **Status:** accepted.

### DECISION-024
- **Tanggal:** 2026-11-22
- **Oleh:** build agent (bug report + Groq validation + browser QA)
- **Fase:** P3-FIX / P5-VERIFY
- **Konteks:** User melaporkan duplicate React key `QRIS`/`BCA` di halaman detail sumber, jawaban laporan operasional yang masih berupa kumpulan kutipan dengan ekor "Catatan Manajemen", dan dokumen yang dihapus masih bisa menyumbang konteks lintas dokumen.
- **Keputusan:** (1) Item chart dideduplikasi berdasarkan label dengan memilih skor tertinggi sebelum render, bukan memakai index sebagai key. (2) Kartu ringkasan dokumen memakai `min-w-0` + `break-words` agar tidak overflow di 390px. (3) Prompt composer dokumen tidak lagi meminta `answer` kosong pada kasus yang sebenarnya terjawab, serta mendefinisikan "untung/rugi" pada laporan operasional sebagai arah kinerja. (4) Allow-list angka LLM memakai `numberCandidates` locale-tolerant sehingga `3,30%` tidak dianggap angka asing; ada satu retry untuk `llm_error`/`llm_timeout`/`llm_invalid`. (5) `removeSource` menghapus `core_datasets` dalam transaksi yang sama sehingga cascade membersihkan chunk, dokumen, attachment, dan indeks FTS.
- **Alasan:** Semua perbaikan bersifat generik: dedup label, pembungkus teks, grounding angka, dan konsistensi registry. Tidak ada aturan khusus Perpres/FAQ.
- **Konsekuensi:** `typecheck`, `build`, seluruh eval, dan browser QA 19/19 PASS (take screenshot `20261122-104428-datasource-duplicate-key-fix`). Uji salinan DB membuktikan setelah penghapusan: chunk 8→0, dokumen 0, attachment 0, retrieval 0.
- **Status:** accepted.

### DECISION-025
- **Tanggal:** 2026-11-22
- **Oleh:** build agent (Groq follow-up validation)
- **Fase:** P3-FIX / P5-VERIFY
- **Konteks:** Empat pertanyaan lanjutan ("analisis chartnya", "visualisasinya", "faktor penyebab", "apa yang menyebabkan rugi") ditolak `not_in_sources` karena kata kuncinya analitis dan tidak muncul persis di teks, sehingga FTS tidak mengembalikan chunk.
- **Keputusan:** (1) `searchChunks` memiliki fallback struktural: bila FTS/LIKE kosong pada dataset dokumen tertentu, ambil chunk child awal dari dataset itu sebagai bukti skor rendah, bukan dari seluruh dokumen. (2) Kata tanya analitis masuk daftar istilah generik guardrail; bila tidak ada istilah khas, ambang dukungan 0 sehingga sitasi yang ada tidak memicu penolakan. (3) Retry composer juga mencakup `llm_ungrounded`.
- **Alasan:** Pertanyaan lanjutan memakai kata meta ("analisis", "visualisasi", "faktor") yang tidak muncul persis di korpus; menolaknya bukan bukti tidak ada jawaban. Fallback tetap dibatasi dataset aktif sehingga tidak membuka kebocoran lintas dokumen.
- **Konsekuensi:** Keempat pertanyaan kini memperoleh 8 sitasi dari dataset yang sama dan mayoritas dijawab LLM dengan marker; satu kadang jatuh ke fallback deterministik karena Groq `429 TPM` saat uji beruntun, bukan karena guardrail. `typecheck`, `build`, dan seluruh eval tetap PASS.
- **Status:** accepted.

### DECISION-026
- **Tanggal:** 2026-11-22
- **Oleh:** build agent (Groq follow-up validation, laporan September)
- **Fase:** P3-FIX / P5-VERIFY
- **Konteks:** Pertanyaan lanjutan pada laporan September ditolak karena `succes ratenya` salah eja dan `kenapa faktor tersebut bisa terjadi...` memakai kata demo generik (`tersebut`, `terjadi`, `bisa`, `utamanya`) yang tidak muncul persis di korpus.
- **Keputusan:** (1) `correctQueryTypos` dinormalisasi terpusat di `lib/ai/normalize.ts` dan dipakai oleh `normalizeText`, `queryTerms`, dan `searchTerms`, sehingga retrieval dan guardrail melihat bentuk kanonik yang sama (`succes`→`success`). (2) Daftar istilah generik guardrail diperluas dengan kata demonstratif/kausal umum, sehingga hanya istilah aksi yang benar-benar absen yang memicu penolakan. (3) Mechanism self-improvement yang dipakai bersifat deterministik: normalisasi, sinonim, fallback struktural, dan regresi otomatis, bukan pembelajaran bobot yang tidak terverifikasi.
- **Alasan:** Variasi ejaan dan kata tanya adalah sifat bahasa, bukan bukti ketiadaan jawaban. Normalisasi di satu tempat mencegah retrieval dan guardrail berbeda pendapat.
- **Konsekuensi:** Validasi Groq 4/4 pertanyaan terjawab dari attachment yang sama dengan marker `[n]`; `typecheck`, `build`, dan seluruh eval PASS.
- **Status:** accepted.

### DECISION-027
- **Tanggal:** 2026-11-22
- **Oleh:** build agent (user-approved scope: all at once)
- **Fase:** P3-BUILD / P5-VERIFY
- **Konteks:** User meminta perbaikan enam area: ikon Investigasi yang sama dengan brand, arah dossier investigasi, halaman laporan yang masih inline, PDF/Excel export yang tidak sesuai web, penamaan file, dan em dash/mojibake.
- **Keputusan:** (1) Ikon nav Investigasi `fact_check`, brand tetap `query_stats`. (2) Em dash prosais di daftar investigasi diganti kalimat biasa; `—` sebagai penanda kosong tetap dipertahankan sesuai kontrak desain. (3) Judul laporan kini menuju `/reports/[id]`; aksi edit/delete diberi label terlihat di desktop; tombol XLSX ditambahkan. (4) Dossier investigasi diberi rantai Hipotesis → Bukti → Sebab → Tindakan dengan placeholder jujur bila data belum ada. (5) PDF kini di-render dari HTML `ReportDocument` via Edge/Chrome headless (`--print-to-pdf`, profil unik, origin dari Host header), bukan pdf-lib; browser resolve lewat `BROWSER_PDF_EXECUTABLE` atau path standar. (6) Excel memakai 4 sheet (Ringkasan, Metrik, Data, Bukti), sel numerik asli, format angka, autoFilter, dan formula SUM/AVERAGE. (7) Penamaan file: `tanyadata_<slug-judul>_<periode>_<8-char-id>.<ext>`.
- **Alasan:** Satu sumber tampilan untuk PDF menghilangkan drift layout; Excel harus menjadi alat analisis, bukan teks; penamaan butuh acuan yang bisa dilacak.
- **Konsekuensi:** `typecheck`, `build`, semua eval, browser QA 24/24 PASS. Ekspor terverifikasi: PDF 200, 133 KB, 3 halaman, tanpa chrome UI; XLSX 4 sheet dan 2 formula `SUM`/`AVERAGE` pada laporan bertabel; nama file mengikuti konvensi. Catatan deploy: lingkungan serverless perlu browser binary atau `BROWSER_PDF_EXECUTABLE`; fallback pdf-lib tidak dipakai lagi.
- **Status:** accepted.

### DECISION-028
- **Tanggal:** 2026-11-22
- **Oleh:** build agent (riset + user request)
- **Fase:** P3-TUNING / P5-VERIFY
- **Konteks:** Dokumen artikel IoT apnea menghasilkan penolakan untuk follow-up (`Alay`, `penyebab kinerjanya menurun`, `kinerjanya bagaimana`). Riset literatur 2026 menunjukkan bottleneck utama RAG percakapan bukan kompleksitas model, melainkan query understanding: coreference, vocabulary mismatch, rewrite yang gagal, dan answerability classification.
- **Riset acuan:** Query Understanding/Routing/Rewriting (Gaos6e 2026), EMNLP Industry 2026 "Better Together" (rewriting sebagai sumber pelengkap, confidence-gated router), SemEval 2026 Multi-Turn RAG (nested RRF + staged generation), survey RAG 2025/2026 (HyDE, RAG-Fusion, CRAG, reranking, answerability classification sebagai bottleneck end-to-end).
- **Keputusan:** (1) `lib/core/query-rewrite.ts` baru: koreksi ejaan berbasis kosakata korpus aktif dengan Levenshtein (maks 2), standalone rewrite memakai judul dokumen + anchor jawaban sebelumnya, dan RRF fusion untuk kanal query orisinal serta rewrite. (2) Retrieval dan guardrail memakai pertanyaan hasil normalisasi; pertanyaan asli tetap dipakai untuk prompt jawaban. (3) Guardrail ambigu hanya meminta klarifikasi untuk dataset tabular; dokumen tetap dijawab dari bukti. (4) Tipe guardrail diteruskan ke `meta.guardrailType` agar evaluasi tidak mengeneralisasi semua penolakan menjadi `refused`. (5) Ambang koreksi ejaan diperketat (2) setelah iterasi pertama salah mengubah `biasanya` menjadi `biaya`.
- **Alasan:** Mengikuti temuan riset: perbaikan datang dari kombinasi rewrite + fusion + answerability yang benar, bukan satu model besar. Semua tetap deterministik dan bisa diuji tanpa LLM.
- **Konsekuensi:** Delapan pertanyaan apnea kini memperoleh 8 sitasi dari dokumen aktif, tujuh dijawab LLM dengan marker pada validasi sebelum kuota habis; `typecheck`, `build`, seluruh eval offline, dan browser QA 28/28 PASS. Validasi Groq ulang terakhir terhalang `429 TPD` (200000 token/hari terpakai), jadi bukti LLM diambil dari run sebelum kuota habis, bukan klaim baru.
- **Status:** accepted dengan catatan kuota.

### DECISION-029
- **Tanggal:** 2026-11-23
- **Oleh:** user (klarifikasi arsitektur deploy)
- **Fase:** P4-REVIEW / P7
- **Konteks:** Review P4 menyatakan `NOT_FEASIBLE` untuk rilis publik/Vercel karena `better-sqlite3`, filesystem writable, dan browser binary PDF tidak tersedia di serverless. User mengklarifikasi: **frontend saja** yang di-deploy ke Vercel; backend, database, dan layanan pendukung akan dikonfigurasi di VPS pribadi.
- **Keputusan:** (1) Status Vercel diturunkan dari "full-stack ready" menjadi **frontend-only**. (2) Backend/API/SQLite/OCR/PDF berjalan di VPS milik user. (3) Arsitektur harus didokumentasikan ulang sebagai **split deployment** dengan kontrak HTTP yang jelas, CORS/origin yang dikonfigurasi, dan tidak ada asumsi filesystem bersama antara Vercel dan VPS. (4) Temuan P4 V-1/V-2 (bundling seed & browser binary di Vercel) tidak lagi blocker, tetapi tetap menjadi catatan bila backend someday dipindah ke serverless. (5) Temuan S-1/S-3 (auth & SSRF PDF) tetap blocker karena backend VPS dapat diakses publik.
- **Alasan:** Mengikuti keputusan user dan menghindari over-engineering state eksternal yang tidak diperlukan untuk VPS.
- **Konsekuensi:** `ARCHITECTURE.md` dan `ARCHITECTURE_REVIEW_P4.md` perlu direvisi oleh architect; README harus memuat dua jalur deploy. Verdict P4 untuk rilis produk lokal/VPS menjadi `FEASIBLE_WITH_CHANGES` setelah blocker keamanan ditutup.
- **Status:** accepted.

### DECISION-030
- **Tanggal:** 2026-11-23
- **Oleh:** designer (temuan fidelity) + orchestrator
- **Fase:** P5-VERIFY
- **Konteks:** `DESIGN_FIDELITY_REPORT.md` meminta perbandingan terhadap desain Stitch dan `DESIGN_SYSTEM.md`, tetapi DECISION-021 sudah menjadikan keduanya anti-referensi setelah rebuild UI. `design/tokens.json` juga masih memakai palet lama sehingga tidak cocok dengan CSS aktual.
- **Keputusan:** (1) Baseline fidelity yang berlaku adalah `docs/UI_REFACTOR_DESIGN.md` + CSS aktual, bukan Stitch/DESIGN_SYSTEM lama. (2) `design/tokens.json` wajib disinkronkan ke token yang benar-benar dipakai (`app/globals.css`). (3) `DESIGN_SYSTEM.md` ditandai sebagai arsip oleh designer. (4) Tidak ada perubahan visual besar; hanya sinkronisasi artefak.
- **Alasan:** Menghindari review yang membandingkan implementasi terhadap referensi yang sudah ditinggalkan, dan mencegah token drift.
- **Konsekuensi:** Designer memperbarui `design/tokens.json`; frontend memperbaiki 3 P1 (progress unggah artifisial, AnimatedTabs keyboard/semantik). Fidelity report tetap menjadi bukti P5.
- **Status:** accepted.

### DECISION-031
- **Tanggal:** 2026-11-23
- **Oleh:** user (perubahan arah teknologi)
- **Fase:** P6 → P3-MIGRATION
- **Konteks:** User menunda sementara re-test QA/fidelity dan meminta migrasi sistem retrieval dari FTS5 SQLite ke **Qdrant vector database**, dengan harapan meningkatkan akurasi dan performa engine. Backend/DB akan berada di VPS pribadi user (DECISION-029).
- **Keputusan:** (1) Lane QA/security/fidelity ditunda sampai migrasi selesai; laporan yang sudah ada tetap menjadi baseline. (2) Qdrant menjadi store vektor untuk chunk dokumen; SQLite tetap menjadi source of truth untuk data transaksi, metadata, percakapan, dan konfigurasi. (3) Strategi embedding, kompatibilitas client Node.js, mode deploy Qdrant (VPS Docker vs local), dan jalur fallback tanpa API key wajib diriset sebelum implementasi. (4) Semua eval yang ada harus tetap lulus atau diperbarui dengan alasan yang jujur; tidak boleh menurunkan ambang tanpa keputusan eksplisit.
- **Alasan:** Mengikuti permintaan user dan potensi peningkatan retrieval semantics; menjaga determinisme dan kemampuan berjalan tanpa kredensial eksternal.
- **Konsekuensi:** Perlu ADR baru, desain pipeline retrieval baru, perubahan `lib/core/ingest.ts`, `lib/core/store.ts`, `lib/ai/retrieval.ts`, konfigurasi env, dan prosedur migrasi/reindex. `docs/BACKLOG.md` diperbarui dengan lane migrasi.
- **Status:** accepted.

### DECISION-034 — OCR PP-OCRv6 & resource budget VPS 2GB
- **Tanggal:** 2026-11-23
- **Oleh:** user + orchestrator (riset 2026-11-23)
- **Fase:** P3-MIGRATION
- **Konteks:** KB01/KB04 image-only masih memakai transkrip GT (`gt_transcript`), bukan OCR. User mengusulkan PP-OCRv6 dan meminta dense vector onnxruntime-node tetap dipakai bila akurat, dengan syarat tidak hang/lag saat ingestion di VPS 2 vCPU/2GB.
- **Fakta riset:** PaddleOCR 3.7.0 (2026-06-11) merilis PP-OCRv6: tiny 1,5M/6,3 MB, small 7,7M/30 MB, medium 34,5M/133 MB; model ONNX tersedia. Benchmark CPU 4 vCPU (ONNX Runtime): tiny 0,26 s/halaman RAM puncak 1,3–1,4 GB; small 0,90 s 1,5–1,9 GB; medium 2,92 s 2,6–2,9 GB. `onnxruntime-node` 1.30.0 adalah rilis terbaru; kegagalan binding lokal disebabkan postinstall yang terlewat (npm RFC #868) / build DirectML pada Windows, bukan ketiadaan dukungan CPU Linux x64.
- **Keputusan:**
  1. OCR memakai **PP-OCRv6 tiny** lewat paket Python `onnxocr` (ONNX Runtime saja, tanpa PaddlePaddle), dijalankan sebagai **microservice terpisah** di VPS, bukan di proses Next.js. Tier `small` hanya bila RAM dinaikkan ≥4 GB; `medium` DITOLAK untuk VPS 2GB.
  2. OCR **on-demand**: hidup hanya saat fase ingestion dokumen image-only, konkurensi = 1, timeout per halaman, lalu dimatikan. Tidak resident bersama embedding/Qdrant.
  3. Ingestion dibagi **tiga fase bergantian** agar puncak RAM tidak bertumpuk: (A) OCR → teks, (B) embedding e5-small q8 384d → vektor, (C) upsert Qdrant. Antar fase, worker dimatikan/dibebaskan.
  4. `onnxruntime-node` diperbaiki lewat `npm rebuild onnxruntime-node` / allow-scripts; model e5-small dimuat **lazy**, satu instance bersama, batch encode, dengan memory watchdog. Bila terukur > anggaran, turunkan ke BM25-only lewat ADR baru — jangan diam-diam.
  5. Qdrant tetap vector database utama (DECISION-031/033). FTS5 hanya fallback saat Qdrant/embedding tidak tersedia.
- **Alasan:** Memberi OCR yang benar untuk KB01/KB04 dan dense vector yang benar untuk Qdrant tanpa melebihi 2GB RAM atau memblokir event loop saat ingestion.
- **Konsekuensi:** Backend membuat `deploy/ocr/` (FastAPI + onnxocr tiny), env `OCR_ENABLED`/`OCR_ENDPOINT`, phase runner ingestion, dan membetulkan binding onnxruntime. AIML mengukur embedding + menambah memory guard. Arsitek mencatat resource budget di `ARCHITECTURE.md`.
- **Status:** accepted.
- **Tanggal:** 2026-11-23
- **Oleh:** user
- **Fase:** P3-MIGRATION
- **Konteks:** Setelah benchmark dev/holdout, user menegaskan: (1) embedding lokal tidak perlu di-default off — kombinasi dense + BM25 diharapkan memaksimalkan hasil; (2) throughput tetap penting; (3) studi kasus 4 SOP PDF adalah fokus, tetapi sistem harus tetap bekerja untuk dokumen lain; (4) bila jawaban deterministik belum sempurna, LLM via Groq dipakai sebagai *fallback penutup* yang tetap ter-grounding; (5) perhatikan anti-slop, karakter asing/mojibake, dan hallucination.
- **Keputusan:**
  1. Default diubah: `QDRANT_MODE=on`, `RETRIEVAL_MODE=hybrid`, `EMBEDDING_PROVIDER=local` — dengan circuit breaker: bila Qdrant/model tidak tersedia, fallback ke FTS5 deterministik dan `meta.fallbackReason` diisi. Aplikasi tetap tidak boleh mati hanya karena Qdrant down.
  2. VPS 2 vCPU/2GB tetap dipakai; embedding e5-small 384d q8 diukur sekali untuk RAM & latensi. Bila terukur melebihi anggaran, turunkan ke mode sparse-only dengan ADR baru — bukan diam-diam.
  3. LLM Groq menjadi **fallback penutup** bila confidence rendah / key_fact tidak lengkap, dengan prompt: hanya menjawab dari evidence yang diberikan, wajib marker sitasi `[n]`, dilarang menambah angka/klaim di luar bukti, dilarang AI-slop, dan normalisasi mojibake. Fallback deterministik tetap ada bila LLM gagal/429.
  4. Korpus 4 PDF KB + GT menjadi dataset `kb-sop` di samping 6 dokumen seed existing; tidak menghapus korpus lama. GT dipakai untuk tuning (dev) dan pengukuran akhir (holdout), bukan sebagai sumber jawaban produksi kecuali PDF image-only tanpa OCR — itu harus diberi label jujur.
  5. Anti-slop + mojibake menjadi gate: tidak ada klaim "live"/angka fiktif/identitas fiktif; teks hasil harus bersih dari character replacement `U+FFFD` dan mojibake; tidak ada parafrasa yang mengubah angka.
- **Alasan:** Mengikuti arah user agar PoC mendekati presisi tinggi tanpa mengorbankan determinisme, kejujuran sitasi, dan portabilitas dokumen.
- **Konsekuensi:** Backend mengubah default env & menambah dataset kb-sop; AIML mengaktifkan hybrid + LLM fallback + anti-slop/mojibake gate; eval dijalankan ulang dengan mode LLM penuh. DECISION-032 poin default off dicabut, ADR-QD-01/05/06 tetap berlaku.
- **Status:** accepted.
- **Tanggal:** 2026-11-23
- **Oleh:** orchestrator, berdasarkan riset architect/aiml/backend (`docs/ADR_QDRANT.md`, `docs/QDRANT_AI_DESIGN.md`, `docs/QDRANT_BACKEND_PLAN.md`)
- **Fase:** P3-MIGRATION
- **Keputusan:**
  1. **ADR-QD-01** — Qdrant adalah *secondary index* aditif. SQLite tetap source of truth; FTS5 tetap jalur default dan fallback. Qdrant tidak menghapus atau mengganti FTS5.
  2. **ADR-QD-02** — Satu node Qdrant Docker di VPS, REST via `@qdrant/js-client-rest`, API key wajib, bind lokal + TLS via reverse proxy. Tidak ada akses browser langsung ke Qdrant.
  3. **ADR-QD-03** — BM25 Qdrant memakai teks yang sudah di-stem di aplikasi (Snowball Qdrant tidak punya bahasa Indonesia). Embedding lokal `@huggingface/transformers` + `intfloat/multilingual-e5-small` (384 dim, q8, MIT, tanpa API key) sebagai jalur utama; `openai-compatible` opsional. `QDRANT_VECTOR_SIZE=384`.
  4. **ADR-QD-04** — Konsistensi SQLite↔Qdrant via outbox + alias atomik; `removeSource` memakai tombstone bila Qdrant mati; `reindex` menghapus payload `source_id` dulu karena `chunk_id` berubah.
  5. **ADR-QD-05** — Kontrak sitasi tidak berubah. Skor Qdrant dinormalisasi; fusion RRF dilakukan di aplikasi agar ambang guardrail (0,45 / 0,25 / 0,18) dan `citation.score` tetap memakai BM25.
  6. **ADR-QD-06** — Gate akurasi, bukan klaim: Qdrant aktif sebagai default hanya bila `eval:qdrant-parity` + 4 suite existing hijau dan retrieval benchmark menunjukkan peningkatan. Ambang tidak boleh diturunkan.
- **Default aman:** `QDRANT_MODE=off`, `RETRIEVAL_MODE=fts5`, `EMBEDDING_PROVIDER=local`. Aplikasi tetap berjalan penuh tanpa Qdrant dan tanpa API key.
- **Alasan:** Menjaga determinisme, kemampuan offline, dan tidak merusak 31+ eval case yang sudah hijau sambil membuka jalur peningkatan retrieval.
- **Konsekuensi:** Backend mengimplementasikan koneksi/konfigurasi/sinkronisasi + docker-compose contoh; AIML mengimplementasikan embedding provider, hybrid RRF, dan eval parity. Architect merevisi `ARCHITECTURE.md`. QA/security tetap ditunda sampai migrasi selesai.
- **Status:** accepted.

## DECISION-035 — Kejujuran UI: diagram "Cara Kerja", IA halaman Pengaturan, dan seksi Tentang yang nyata

- **Tanggal:** 2026-11-24
- **Oleh:** user (brief verbatim) + orchestrator
- **Fase:** P6-UI-HONESTY
- **Konteks (bukti):**
  1. Diagram "Cara kerja" (`tanyadata/components/signal/landing-steps.tsx:192-523`) menyusun aset sebagai flex-row dengan `lg:gap-0` + track `w-14 lg:w-16 xl:w-28` (:161) sementara grup dokumen memakai `flex-wrap justify-center gap-s2 sm:gap-s3` (:202). Jarak antar node jadi bergantung pada lebar konten masing-masing, bukan pada satu ritme grid — aset tampak renggang dan titik penghubung tidak menyentuh node. User: "asset-asetnya malah jadi tidak saling connect berjarak dan spacingnya pun tidak terukur dengan matang".
  2. Halaman Pengaturan memuat kontrol yang **tersimpan tetapi tidak pernah dikonsumsi**: `preferences.chartDefault` dan `preferences.denseTables` hanya dibaca di `app/(workspace)/settings/page.tsx` (:132-133, :172) — grep seluruh `app/`, `components/`, `lib/` tidak menemukan konsumen lain. `Zona waktu` dirender sebagai kotak bergaya input yang tidak dapat diubah (`settings/page.tsx:407-411`).
  3. `dateRange` hanya dikonsumsi Asisten (`app/(workspace)/assistant/page.tsx:148`), sedangkan dashboard memaku `'this_month'` (`lib/api/dashboard.ts:40`).
  4. Tab Tentang hanya berisi InfoRow statis (`settings/page.tsx:504-514`) plus klaim "Tidak ada data yang dikirim ke layanan eksternal" yang bertentangan dengan `.env.example` (LLM Groq opsional, microservice OCR, Qdrant).
  5. `capabilities.rag` dipaku `'fts5'` (`lib/meta.ts:31`) padahal default sistem sekarang `RETRIEVAL_MODE=hybrid` + `QDRANT_MODE=on` (`lib/ai/retrieval.ts:1168`, `lib/qdrant/client.ts:253`). Info ini tampil di tab Asisten (`settings/page.tsx:481`), jadi **menyesatkan**.
- **Keputusan:**
  1. **Diagram Cara Kerja** direkonstruksi di atas satu grid terukur: node berukuran tetap, kolom penghubung lebar tetap, dan titik/garis penghubung yang benar-benar menyentuh tepi node di semua breakpoint (`<lg` vertikal, `≥lg` horizontal). Tidak boleh ada jarak yang berasal dari lebar konten. Token spacing wajib `--spacing-s1..s6` (`app/globals.css:80-89`), bukan nilai ad-hoc.
  2. **Aturan keras halaman Pengaturan: tidak ada kontrol yang tidak mengubah perilaku.** Setiap kontrol wajib (a) tersimpan, dan (b) dibaca minimal satu tempat lain. Kontrol yang gagal (b) dihapus dari UI; bila biaya menyambungkannya ≤1 perubahan kecil dan nilainya jelas, sambungkan.
  3. **Baseline IA Pengaturan** (designer boleh mengusulkan revisi dengan bukti file:line):
     - **Umum** — Bahasa antarmuka (sudah nyata, `lib/ui/i18n-provider.tsx:44`); Rentang tanggal bawaan (disambungkan ke dashboard); Dataset aktif (backend sudah mendukung `activeDatasetId` di `lib/settings.ts`, belum ada kontrolnya).
     - **Asisten** — hanya kontrol yang mengubah keluaran jawaban; status kapabilitas dipindah ke Tentang sebagai **bacaan**, bukan setting.
     - **Tentang** — dokumentasi sistem yang **diisi server**, bukan karangan: pipeline ingest → retrieval → jawaban → keluaran, tabel teknologi, dan status runtime nyata (mode retrieval efektif, mode LLM, OCR, status Qdrant/fallback).
  4. **Klaim Tentang wajib dapat dibuktikan.** Tidak boleh ada kalimat yang tidak punya sumber di kode/.env. Status runtime berasal dari `/api/meta`, bukan konstanta UI. `capabilities.rag` harus diturunkan dari `RETRIEVAL_MODE`/`QDRANT_MODE` + status circuit breaker, bukan string mati.
- **Alasan:** User mempertanyakan nilai section yang hanya jadi gimmick; halaman pengaturan harus mengatur, dan halaman yang mengklaim "beginilah sistem bekerja" harus benar atau tidak ditulis.
- **Konsekuensi:** Designer menetapkan geometri + IA; Architect menulis deskripsi sistem yang ter-ground; Backend mengekspos payload `system` di `/api/meta`; Illustrator menyediakan aset diagram; Frontend mengimplementasikan ketiganya. Gate P7 tidak berubah.
- **Status:** accepted.

## DECISION-036 — Arbitrase orchestrator atas handoff designer + architect (P6-UI-HONESTY)

- **Tanggal:** 2026-11-24
- **Oleh:** orchestrator `agentic`
- **Fase:** P6-UI-HONESTY
- **Konteks:** Designer (`docs/DESIGN_SYSTEM.md` §H/§I/§J + `design/cara-kerja-geometry.yaml`) dan architect (`docs/SYSTEM_OVERVIEW.md` + `docs/API_CONTRACT.md` §9.3.1) mengembalikan handoff. Dua titik butuh keputusan: (a) deviasi IA, (b) nasib field `preferences`.
- **Keputusan:**
  1. **Deviasi IA diterima.** Tab final 3: `Umum` (Bahasa antarmuka), `Asisten` (Dataset aktif + Rentang tanggal), `Tentang` (read-only). Alasan: baseline DECISION-035 menaruh semua kontrol nyata di `Umum` sehingga `Asisten` kosong — tab kosong adalah gimmick versi lain. Bukti konsumen: `assistant/page.tsx:148`, `api/investigations/analyze/route.ts:22-23`, `lib/api/dashboard.ts:33`, `lib/meta.ts:17`.
  2. **`preferences` dihapus dari UI, dipertahankan di backend sebagai deprecated.** Frontend berhenti mengirim `preferences`; `lib/settings.ts`, `lib/api/schemas.ts`, `lib/contracts/http.ts` menandai field `@deprecated` + komentar alasan. Pembersihan total (migrasi payload) dipisah ke tiket `SET-03` agar fase UI tidak mencampur perubahan kontrak yang tidak dibutuhkan user. **Deviasi dari rekomendasi architect** (yang menyarankan hapus total sekaligus) — alasan: tidak ada konsumen, jadi tidak ada risiko perilaku; mencampurnya menambah blast radius tanpa manfaat yang terlihat.
  3. **Rentang tanggal wajib disambungkan ke dashboard.** `lib/api/dashboard.ts:36-47` membaca `settings.dateRange` bila tidak ada parameter URL. Tanpa ini kontrolnya tetap gimmick dan hint di UI tidak boleh ditulis.
  4. **Bug preset rentang diperbaiki**: preset mengisi `start`/`end` sebelum dikirim (`settings/page.tsx:174-176` sekarang mengirim tanggal lama).
  5. **Kontras:** rail/aksen di permukaan terang wajib `--color-forest`; `--color-lime` di `--color-porcelain` terukur 1,48:1 dan dilarang sebagai garis/teks di zona terang.
- **Konsekuensi:** Backend mengerjakan `system` payload + derivasi `capabilities` + penyambungan dashboard. Illustrator membuat aset SVG pipeline. Frontend mengimplementasikan §H/§I/§J. QA mengukur assertion A-1..A-15.
- **Status:** accepted.

## DECISION-037 — KB-GT-01 iterasi 1: naturalness gate + multi-doc synthesis + answerability tuning (P6-FIX-LOOP)

- **Tanggal:** 2026-11-25
- **Oleh:** orchestrator `agentic` (eksekusi lane `aiml`)
- **Fase:** P6-FIX-LOOP
- **Konteks:** User arahkan eksekusi penuh peningkatan akurasi; prioritas mutlak kualitas bahasa/makna jawaban — respons HARUS parafrasa natural Bahasa Indonesia, bukan salinan mentah chunk retrieval, tetap ter-grounding sitasi [n]. Tradeoff CPU di VPS diterima.
- **Keputusan:**
  1. **Naturalness gate** (`lib/ai/adapter.ts`, dekat postcheck missing-marker): kalimat jawaban ≥90% trigram identik dengan satu unit bukti DAN >25 token = salinan mentah → SATU revisi LLM ("parafrasakan dengan bahasa sendiri, pertahankan makna DAN marker [n]"). Pola retry-repair existing, fail-open, budget regenerate tetap 1x. Deterministik fallback tidak diubah.
  2. **Multi-doc synthesis prompt** ditambahkan ke kedua composer; aktif otomatis bila unit bukti berasal dari >1 dokumen; klaim per-sumber ber-marker [n].
  3. **`answerabilitySupport`** (`lib/ai/guardrails.ts`) diperkaya berbasis analisis dev run — sinonim `peran↔tugas/bertugas`, `harus↔wajib/perlu`, stemmer Indonesia sederhana — TANPA menurunkan ambang global 0.45. Hasil dev (mode off): FALSE_ABSTAIN 7→5, recall 0.667→0.737, Cit-P 0.292→0.338; precision 0.483→0.452 (tradeoff jujur: kasus ex-abstain kini dijawab dengan key-fact kurang → dihitung FP metrik).
  4. **Fix lintas lane dicatat**: typo regex `lib/ingest/ocr.ts:84` (`/Ã¼/ g` → `/Ã¼/`) memblokir seluruh eval — diperbaiki minimal oleh aiml.
- **Alasan:** Salinan verbatim chunk menurunkan kualitas yang menjadi nilai jual user; gate n-gram lebih deterministik daripada mengandalkan prompt saja. Tuning threshold dilakukan eval-driven, bukan tebak-tebakan.
- **Konsekuensi:** Verifikasi orchestrator: typecheck exit 0; 4 eval regresi hijau tanpa degradasi (94/94, 10/11, 24/24, Perpres 6/6). Naturalness gate BELUM tervalidasi mode LLM (Windows lokal 429; perlu VPS/staging dengan OCR+Groq). Baseline holdout 0.8571 tidak punya artefak run tersimpan → angka run baru (mode off, KB01/04 SKIPP) tidak comparable; target >0.99 belum bisa dinyatakan tercapai/gagal. Sisa FALSE_ABSTAIN holdout butuh tiket backend (heading KB03 FQ-01 + jalur hybrid/deep-link). Re-run `--split all --mode llm` di VPS = syarat penutupan tiket.
- **Status:** accepted; tiket KB-GT-01 tetap OPEN.

## DECISION-038 — Penutupan tiket lokal P6: UI-LANDING-01, SEC-011, KB-GT-03(b)

- **Tanggal:** 2026-11-25
- **Oleh:** orchestrator `agentic`
- **Fase:** P6-FIX-LOOP
- **Konteks:** User menginstruksikan "bereskan semua phase terlebih dahulu, deploy di fase terakhir". Tiket yang tidak bergantung VPS dieksekusi lokal; tiket yang butuh infra (OCR service, Qdrant hidup, eval mode LLM) ditunda ke fase deploy.
- **Keputusan:**
  1. **UI-LANDING-01 CLOSED** — diagram "Cara kerja" dibangun di grid terukur (`components/signal/landing-steps.tsx:116-355`), rail = sel grid `inset 0` sehingga garis menyentuh tepi node di semua breakpoint; seluruh spacing token `s1..s6`; `design/cara-kerja-geometry.yaml` dibuat karena DECISION-035 merujuk file yang belum ada.
  2. **SEC-011 CLOSED** — akar kuirk: `bucket.last` tidak dimajukan pada refill parsial, sehingga refill dihitung dari waktu pembuatan bucket dan kuota pulih penuh setelah paruh window (`lib/api/rate-limit.ts:56-64`). Refill kini berbasis selang sejak update terakhir; `retry-after` dari sisa token. Test `scripts/test-rate-limit.mjs` (node:test, tanpa dep baru) 4/4 PASS.
  3. **KB-GT-03 bagian (b) heading SELESAI, tiket tetap in_progress** — akar FQ-01 bukan regex heading melainkan **deteksi kolom**: `detectColumnSplit` memakai min/max x mentah sehingga satu item nomor halaman "1" di x=542,2 melebarkan halaman 258→494, jurang kolom (x≈176,8) jatuh di posisi relatif 0,26 (di luar pita 0,3–0,7) → `columns=1` → baca linear → heading kolom kiri dan kanan menempel. Fix generik `robustExtent()` (`lib/ingest/extract.ts:35-72`): cluster x 2pt, buang cluster tepi jarang (≤3% item) yang terpisah >10% span. KB03 kini `cols=2@176.82`, 8 seksi terpisah.
  4. **Tiket baru KB-GT-05** (aiml): GT-065/GT-067 cross_doc kini `out_of_scope` padahal kontennya ada di KB03#7 — peluang recall, bukan regresi status (keduanya `pass=false` sebelum dan sesudah).
- **Alasan:** Menutup tiket yang bisa diverifikasi lokal tanpa menunggu infra; mencegah "selesai" palsu pada tiket yang sebenarnya butuh VPS.
- **Konsekuensi / bukti:** Presisi ablasi KB GT (fts5, mode off) **0.4545 → 0.6667**, F1 0.5333→0.6747, KF-cov 0.3780→0.4702, FP 24→14, FALSE_ABSTAIN 11→13 (dua kasus ex-FP yang dulu "menjawab" dari teks terinterleave). GT-032 kini `passed=true`. Semua PDF seed lain byte-identik (diverifikasi stash-ablation). Verifikasi akhir: typecheck exit 0, build exit 0 (25,5s), test:rate-limit 4/4, eval ground-truth PASS, holdout PASS (10/11, halusinasi 0.0), real-docs 24/24. `release_ready` tetap false sampai fase deploy selesai.
- **Status:** accepted.

## DECISION-039 - KB-GT-05 ditolak berbasis bukti: relaksasi guardrail menurunkan presisi

- **Tanggal:** 2026-11-25
- **Oleh:** orchestrator `agentic` (eksekusi lane `aiml`)
- **Fase:** P6-FIX-LOOP
- **Konteks:** Setelah `robustExtent()` (DECISION-038), GT-065/GT-067/GT-073 berubah dari "menjawab teks terinterleave" menjadi `out_of_scope`. Hipotesis: evidence gate terlalu ketat (kata tanya `apakah`, filler `kalau/lagi/gimana`, pertanyaan peran/tugas yang dijawab lewat kata kerja).
- **Keputusan:** Percobaan relaksasi (filter filler + relax peran-tugas) DI-REVERT PENUH. Alasan berbasis angka: presisi turun 0.6667 -> 0.6087, FALSE_ABSTAIN 13->9, recall 0.6829->0.7568, tetapi F1 tetap 0.6747 dan TIDAK ADA satu pun TP baru - empat kasus berubah fn -> fp.
- **Bukti per kasus:** KB03:GT-065 (kfCov 0.25, butuh KB04#3+KB01#4), KB03:GT-067 & KB02:GT-067 (butuh KB01#8), KB03:GT-073 (composer memilih KB03#7 "koordinator", bukan KB03#8 "formulir sementara"). Kebutuhan kunci ada di KB01/KB04 yang image-only dan OCR-nya belum hidup.
- **Alasan matematis:** `keyFactCoverage` menuntut 0.99 (semua key_fact). Baseline `tp/(tp+fp) = 28/42` tepat di 0.6667, sehingga satu kasus fn->fp saja sudah menurunkan presisi ke 0.6512. Relaksasi guardrail-only tidak mungkin memenuhi floor presisi dalam mode off tanpa OCR.
- **Konsekuensi:** `lib/ai/guardrails.ts` dipulihkan byte-identik (689 baris). Verifikasi ulang: typecheck 0, ground-truth PASS, holdout PASS 10/11 (halusinasi 0.0000), real-docs 24/24. Penutupan tiket dipindah ke fase deploy (OCR KB01/KB04 aktif + eval mode LLM) dan ke perbaikan pemilihan seksi composer untuk GT-073.
- **Catatan proses:** brief orchestrator mengklaim helper `hasActorDutyEvidence`/`ROLE_DUTY_RE`/`ACTION_VERB_RE`/`ANSWERABILITY_FILLER` "sudah ada" di file - ternyata TIDAK ter-persist dari sesi sebelumnya. Agent melaporkan ketidaksesuaian ini alih-alih mengarang; diagnosis orchestrator dicatat sebagai tidak akurat.
- **Status:** accepted.

## DECISION-040 - ADAPT-1 (WS-A) taksonomi dokumen selesai: registry tunggal + migrasi terbukti

- **Tanggal:** 2026-11-25
- **Oleh:** orchestrator `agentic` (eksekusi lane `backend`)
- **Fase:** P6 / FASE 2 epik ADAPT
- **Konteks:** Epik Adaptive Document Intelligence butuh fondasi taksonomi. Ditemukan cacat fondasi: TIGA definisi `DocType` yang bertentangan (`lib/core/contracts.ts:19`, `lib/ai/types.ts:14`, `lib/core/doc-analytics.ts:12` dengan nilai `financial-report`/`incident-report` yang tidak dikenal modul lain).
- **Keputusan:**
  1. **Registry tunggal** `lib/core/doc-taxonomy.ts`: `DocGroup` = finance|sop|technical|identity|general; `DocTypeId` = id lama + `sop` + 7 jenis identity (ktp, paspor, sim, kartu_keluarga, npwp, tagihan_utilitas, rekening_koran); alias legacy (financial-report->financial, incident-report->technical_report, kk->kartu_keluarga). `DocType` dipertahankan sebagai `string` terbuka karena `lib/ai/classifier.ts` memakai `Record<DocType, ...>` exhaustif 4 id - himpunan tertutup hidup di `DocTypeId`.
  2. **Divergensi dihapus** lewat re-export di ketiga file, sehingga impor lama tidak pecah dan tidak ada dua daftar nilai berbeda.
  3. **Persistensi `doc_group`** di `core_datasets` + `core_documents`, dengan migrasi idempoten `ensureDocTaxonomyColumns()` (`lib/db/migrate-v2.ts:235`) yang dipanggil dari `lib/db/client.ts`.
- **Bukti migrasi (bukan asumsi):** DB legacy nyata berisi 12 dataset TANPA kolom `doc_group`. Setelah aplikasi dijalankan sekali: kolom bertambah, backfill benar - `general`->`general` (9), `financial`->`finance` (2), `legal`->`sop` (1), `null doc_group` = 0, dan `core_documents` ikut ter-backfill. DB asli di-backup ke `data/workspace/tanyadata.db.bak-pre-wsa` sebelum uji.
- **Verifikasi:** typecheck 0, build 0 (30.9s), eval ground-truth PASS, holdout 10/11, real-docs 24/24, smoke browser 5/5 (`tests/ws-a-migration-smoke.yaml`).
- **Konsekuensi / serahan:** aiml memperluas `lib/ai/classifier.ts` (id `sop` + identity, menulis type/group ke metadata); frontend mengonsumsi `doc_group`/`doc_type` di UI dan mengganti cek legacy `'financial-report'`/`'incident-report'` dengan `normalizeDocType`. Temuan terbuka: `lib/ui/share-contract.ts` masih punya `ShareDocType` sendiri.
- **Status:** accepted.
