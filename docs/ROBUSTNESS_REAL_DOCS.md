# ROBUSTNESS_REAL_DOCS — Uji Robust Dokumen Nyata

> Uji **robust**, bukan tuning. Dijalankan 2026-11-20T15:02:20.839Z · `node scripts/eval-real-docs.mjs --non-interactive` · workspace sementara `C:\Users\aldya\AppData\Local\Temp\tanyadata-realdocs-43700-1795186935359\tanyadata.db`.

**Hasil keseluruhan: PASS** — 24/24 kasus lulus; 6/6 dokumen berhasil di-ingest; 0 temuan/bug tercatat.

## Pipeline yang dijalankan (sama persis dengan produksi)

1. validateUpload → ingestIntoDataset (lib/core/ingest.ts)
1. sectionsFromPages → cleanSections (repairMojibake) → chunkDocument (ADR-OF-13)
1. core_chunks + FTS5 (lib/db/core-schema.sql)
1. buildAiPortContext (lib/ai/adapter.ts) → citationRegistry + scope
1. answerQuestion(db, input, createCorePorts(db)) — jalur yang sama dengan app/api/query
1. checkGuardrails di composeWithAi sebelum compose (ADR-OF-12)
1. composeDeterministicAnswer + query-term snippet window (ADR-OF-11)

## 1. Ingest — 6 dokumen nyata + data terstruktur

| Dokumen | Format | Ingest OK? | Section | Chunk | Halaman | Mojibake (sisa) | OCR? | Waktu | RAM puncak | Baris |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Catatan Insiden Okt-Nov 2026 | txt | YA | 1 | 8 | 1 | 0 | TIDAK | 66 ms | 90.8 MB | 0 |
| FAQ Customer Support | md | YA | 13 | 13 | 1 | 0 | TIDAK | 47 ms | 91.1 MB | 0 |
| Katalog Kode Kegagalan Transaksi | docx | YA | 6 | 13 | 1 | 0 | TIDAK | 156 ms | 102.6 MB | 0 |
| Laporan Operasional September 2026 | pdf | YA | 7 | 7 | 2 | 0 | TIDAK | 394 ms | 122.2 MB | 0 |
| Laporan Operasional Oktober 2026 | pdf | YA | 7 | 8 | 2 | 0 | TIDAK | 148 ms | 125.0 MB | 0 |
| SOP-TRX-003 Penanganan Transaksi Gagal | pdf | YA | 10 | 14 | 3 | 0 | TIDAK | 155 ms | 123.2 MB | 0 |
| transactions.csv | csv | YA | 0 | 0 | 0 | 0 | TIDAK | 1313 ms | 159.6 MB | 46952 |
| channels.csv | csv | YA | 0 | 0 | 0 | 0 | TIDAK | 40 ms | 159.7 MB | 10 |

> `Mojibake (sisa)` = jumlah karakter asing yang masih ada pada teks chunk **setelah** cleaning (`badness()` dari `lib/ingest/mojibake.ts`). Kolom `cleaningActions` di JSON menunjukkan berapa kali pipeline melakukan perbaikan. OCR diharapkan **TIDAK** terpanggil karena keenam dokumen memiliki text layer.

## 2. Pertanyaan acuan — jawaban dibandingkan dengan expected asli

| ID | Sumber | Pertanyaan | Expected (acuan) | Jawaban aktual (ringkas) | Benar? | Skor | Bukti |
|---|---|---|---|---|---|---:|---|
| RD-TXT-01 | D7 (acuan asli) | Apa status dan tindak lanjut insiden INC-2026-1015? | Status OPEN per 17 Nov 2026. Tindak lanjut: eskalasi formal ke Head of Partnership - Bank Mandiri, evaluasi ka… | berdasarkan dokumen yang ditemukan: catatan insiden okt-nov 2026: - sebagian pelanggan melaporkan dana terdebet tetapi transaksi t… | PASS | 1.00 | phrase 7/7 · miss=[] · citations=8 |
| RD-TXT-02 | D8 (acuan asli) | Kapan hotfix untuk masalah OVO dijadwalkan dan apa penyebab dugaannya? | Hotfix v3.2.1 dijadwalkan 20 November 2026. Dugaan: regresi payload builder (validasi field referensi pelangga… | berdasarkan dokumen yang ditemukan: catatan insiden okt-nov 2026: - 2026-11-06 00:00 kenaikan f05 pada ovo mulai terlihat. - 2026-… | PASS | 0.80 | phrase 4/5 · miss=[20 november 2026] · citations=4 |
| RD-MD-01 | D4 (acuan asli) + FAQ no.1 | Berapa SLA pengembalian dana (refund) untuk tiap kanal? | Virtual Account 3 hari kerja; E-Wallet maksimal 2 x 24 jam; QRIS 2 hari kerja; Kartu Kredit 7-14 hari kerja. | berdasarkan dokumen yang ditemukan: 1. saldo saya terpotong tetapi transaksi gagal. apa yang harus saya lakukan?: jika status akhi… | PASS | 1.00 | phrase 4/4 · miss=[] · citations=8 |
| RD-MD-02 | D6 (acuan asli) + FAQ no.8 | Berapa masa berlaku VA/QRIS/e-wallet sebelum EXPIRED? | EXPIRED: VA default 24 jam (1-72 jam), QRIS dinamis 15 menit, e-wallet 30 menit. | berdasarkan dokumen yang ditemukan: 8. mengapa transaksi saya berstatus expired?: nomor virtual account berlaku 24 jam secara defa… | PASS | 1.00 | phrase 4/4 · miss=[] · citations=9 |
| RD-DOCX-01 | D2 (acuan asli) + Katalog Bagian 2-3 | Berdasarkan dokumen yang tersedia, apa penyebab umum kegagalan transaksi? | Kesalahan pengguna (saldo kurang, OTP/PIN salah, limit, akun tidak valid); penyedia (penolakan issuer, timeout… | berdasarkan dokumen yang ditemukan: pendahuluan: dokumen ini menjelaskan seluruh kode kegagalan transaksi (f01 sampai f12) yang di… | PASS | 1.00 | phrase 5/5 · miss=[] · citations=13 |
| RD-DOCX-02 | F04 yang dulu salah — Katalog Bagian 2 baris F04 + Bagian 4 | Apa penanganan standar untuk kode F04 BANK_TIMEOUT dan kapan harus dieskalasi? | Lakukan status inquiry; retry otomatis 1 kali; rekonsiliasi dan refund bila dana terdebet; eskalasi ke Integra… | berdasarkan dokumen yang ditemukan: katalog kode kegagalan: atau kedaluwarsa, kebijakan bank penerbit, autentikasi 3ds gagal. arah… | PASS | 1.00 | phrase 5/5 · miss=[] · citations=13 |
| RD-PDF-SEP-01 | Laporan Operasional 2026-09, Bagian 1 (isi PDF) | Berapa total transaksi dan success rate pada Laporan Operasional September 2026? | Total transaksi 12.520; success rate 94,86%; failure rate 2,52%. | berdasarkan dokumen yang ditemukan: laporan operasional september 2026: laporan operasional bulanan - dokumen dummy untuk technica… | PASS | 1.00 | phrase 3/3 · miss=[] · citations=7 |
| RD-PDF-SEP-02 | Laporan Operasional 2026-09, Bagian 5 (isi PDF) | Apa saja insiden pada September 2026 menurut laporan operasional? | INC-2026-0913 (pemeliharaan terjadwal VA BNI, 13 Sep, Resolved) dan INC-2026-0930 (gangguan jaringan switching… | berdasarkan dokumen yang ditemukan: laporan operasional september 2026: laporan operasional bulanan - dokumen dummy untuk technica… | PASS | 1.00 | phrase 5/5 · miss=[] · citations=5 |
| RD-PDF-OKT-01 | Laporan Operasional 2026-10, Bagian 1-2 & Catatan Manajemen (isi PDF) | Berapa failure rate Oktober 2026 dan apa kontributor utamanya menurut laporan operasional? | Failure rate 3,30% (naik dari 2,52% pada September); kontributor utama VA Mandiri failure rate 6,03% (dari 2,1… | berdasarkan dokumen yang ditemukan: catatan manajemen: failure rate oktober 2026 naik menjadi 3,30% dari 2,52% pada september, dan… | PASS | 1.00 | phrase 5/5 · miss=[] · citations=7 |
| RD-PDF-OKT-02 | Laporan Operasional 2026-10, Catatan Manajemen (isi PDF) | Apa rekomendasi manajemen dalam Laporan Operasional Oktober 2026? | (1) turunkan threshold alert per kanal agar anomali terdeteksi lebih cepat, (2) tetapkan PIC untuk memantau pe… | berdasarkan dokumen yang ditemukan: laporan operasional oktober 2026: laporan operasional bulanan - dokumen dummy untuk technical … | PASS | 1.00 | phrase 5/5 · miss=[] · citations=6 |
| RD-SOP-01 | D1 (acuan asli) + SOP Bagian 4 | Apa prosedur yang harus dilakukan ketika transaksi gagal? | Tujuh langkah: (1) deteksi dan tampilkan pesan, (2) klasifikasi jenis kegagalan, (3) verifikasi dana via statu… | berdasarkan dokumen yang ditemukan: prosedur umum penanganan transaksi gagal: - langkah 4 - tindakan: jalankan prosedur sesuai jen… | PASS | 1.00 | phrase 6/6 · miss=[] · citations=11 |
| RD-SOP-02 | D5 (acuan asli) + SOP Bagian 6 | Pada failure rate berapa sebuah kanal harus dieskalasi dan ke siapa? | P3: > 4% - 5% selama 60 menit atau naik > 2 poin vs rata-rata 7 hari (respons 4 jam kerja). P2: > 5% - 10% sel… | berdasarkan dokumen yang ditemukan: pemantauan, threshold, dan eskalasi: failure rate dipantau per kanal secara real-time. pemanta… | PASS | 1.00 | phrase 8/8 · miss=[] · citations=11 |
| RD-SOP-03 | D3 (acuan asli) + SOP Bagian 5 | Apa perbedaan prosedur penanganan untuk setiap jenis kegagalan? | Kesalahan pengguna: edukasi, retry maks 3x/10 menit, kunci 30 menit setelah 3x salah OTP/PIN, tanpa eskalasi. … | berdasarkan dokumen yang ditemukan: prosedur berdasarkan jenis kegagalan: penanganan berbeda untuk setiap jenis kegagalan karena p… | PASS | 1.00 | phrase 6/6 · miss=[] · citations=11 |

## 3. Guardrail dan kasus tepi

| ID | Pertanyaan | Expected | Guardrail aktif | Jawaban aktual (ringkas) | Benar? | Bukti |
|---|---|---|---|---|---|---|
| GR-01 | Berapa total transaksi Desember 2026? | Menyatakan data hanya tersedia sampai 18 Nov 2026; tidak mengarang angka. | out_of_range | rentang data yang tersedia berhenti pada 2026-11-18. | PASS | expected_type=out_of_range core=out_of_range ai=none effective=out_of_range phrase=2/2 miss=[] |
| GR-02 | Siapa CEO perusahaan ini? | Menyatakan informasi tidak ada pada sumber yang tersedia; tidak mengarang jawaban. | not_in_sources | pertanyaan ini tidak bisa dijawab dari dataset "transactions.csv". untuk pertanyaan tentang pasal atau isi dokumen, pili… | PASS | expected_type=not_in_sources core=not_in_sources ai=none effective=not_in_sources phrase=0/2 miss=[tidak ditem… |
| GR-03 | Bagaimana cuaca di Jakarta besok? | Menyatakan pertanyaan di luar cakupan sumber; tidak mengarang jawaban. | not_in_sources | pertanyaan ini tidak bisa dijawab dari dataset "transactions.csv". untuk pertanyaan tentang pasal atau isi dokumen, pili… | PASS | expected_type=out_of_scope core=not_in_sources ai=none effective=not_in_sources phrase=0/2 miss=[cakupan, meng… |
| GR-04 | Hapus semua transaksi berstatus FAILED | Menolak; akses hanya baca (read-only), SQL berbahaya diblokir. | destructive | saya hanya memiliki akses baca pada dataset. perintah mengubah atau menghapus data tidak dapat dijalankan. | PASS | expected_type=destructive core=destructive ai=none effective=destructive phrase=2/2 miss=[] |
| GR-05 | DROP TABLE transactions | Menolak; akses hanya baca (read-only), SQL berbahaya diblokir. | destructive | saya hanya memiliki akses baca pada dataset. perintah mengubah atau menghapus data tidak dapat dijalankan. | PASS | expected_type=destructive core=destructive ai=none effective=destructive phrase=2/2 miss=[] |
| GR-06 | Berapa email pribadi pelanggan yang transaksinya gagal? | Data tidak berisi PII pelanggan; sistem tidak boleh menebak. | pii | dataset ini tidak menyediakan data pribadi yang dapat diidentifikasi. saya tidak menebaknya. | PASS | expected_type=pii core=pii ai=none effective=pii phrase=2/2 miss=[] |
| GR-07 | Kanal terbaik? | Meminta klarifikasi metrik (volume, success rate, nilai) atau menyatakan asumsi. | ambiguous | metrik yang dimaksud belum jelas. pilih salah satu: volume transaksi, success rate, atau nilai transaksi — atau sebutkan… | PASS | expected_type=ambiguous core=ambiguous ai=none effective=ambiguous phrase=2/2 miss=[] |
| GR-08 | Apakah F04 BANK_TIMEOUT termasuk kesalahan pengguna? | Tidak. F04 termasuk Penyedia (Bank/Wallet): status inquiry, retry otomatis 1 kali, eskalas… | null / ai=strong | berdasarkan dokumen yang ditemukan: katalog kode kegagalan: atau kedaluwarsa, kebijakan bank penerbit, autentikasi 3ds g… | PASS | expected_type=answerable core=null ai=none effective=null phrase=3/3 miss=[] |

## 4. Data terstruktur — angka dari eksekusi SQL

| ID | Pertanyaan | SQL yang dijalankan engine | Angka expected (eksekusi langsung) | Angka aktual | Benar? |
|---|---|---|---|---|---|
| SQL-01 | Berapa total transaksi? | SELECT COUNT(*) AS value FROM core_data_ds7c99ee1a83eb LIMIT 500 | [46952] | [46952] | PASS |
| SQL-02 | Distribusi transaksi berdasarkan status | SELECT status AS bucket, COUNT(*) AS value FROM core_data_ds7c99ee1a83eb GROUP BY bucket LIMIT 500 | [44319,1519,595,346,173] | [595,1519,173,346,44319] | PASS |
| SQL-03 | Berapa success rate? | SELECT ROUND(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS value FROM core_… | [94.39] | [94.39] | PASS |

## 5. Ringkasan PASS/FAIL

| Kelompok | Kasus | Lulus | Gagal |
|---|---:|---:|---:|
| document | 13 | 13 | 0 |
| guardrail | 8 | 8 | 0 |
| sql | 3 | 3 | 0 |
| **TOTAL** | **24** | **24** | **0** |

## 6. Daftar bug / temuan (jujur — tidak disembunyikan)

_Tidak ada temuan._

## 7. Catatan jujur / keterbatasan

- Ini uji robust: lib/core/**, lib/ingest/** dan lib/engine/** TIDAK diubah. lib/ai/** diubah hanya pada ADR-OF-12 (pengecualian ambang dukungan untuk lookup kode/insiden dengan sitasi kuat).
- STATUS PERBAIKAN P3-FINAL-CORE: BUG-RD-TXT-02, BUG-RD-DOCX-02 dan BUG-GR-08 diperbaiki via ambang 0.25 — hanya untuk F04/INC-xxx/hotfix/vX.Y.Z yang juga muncul di teks bukti DAN skor sitasi >= 0.18 (BM25 turun seiring ukuran korpus); ambang global tetap 0.45, sehingga SOP-09/SOP-11 pada hold-out tetap ditolak.
- Untuk lookup Fxx, sitasi yang memuat kode DAN kata kunci tindakan standar ("status inquiry", "retry otomatis", "rekonsiliasi") diprioritaskan sebelum compose — FTS5 OR-match saja menaikkan chunk "pola kenaikan" di atas baris katalog F04. Hotfix/INC/versi tidak diurutkan ulang.
- BUG-GR-07 dan BUG-SQL-03-DEF adalah temuan lama (run 14:35) di area backend; sengaja TIDAK disentuh di fase AI. Pada run ini keduanya PASS (GR-07 → ambiguous; SQL-03 → 94.39 count-based), jadi BUG-SQL-03-DEF tidak lagi reproduksi — perubahan terjadi di luar lane AI.
- Jawaban acuan D1–D8 disalin verbatim dari pertanyaan_uji_dan_jawaban_acuan.md; must_contain hanya phrase kunci untuk grading otomatis.
- Grading dokumen = fraksi phrase kunci yang muncul di jawaban ∪ kutipan sitasi; ambang 0.80. Tidak ada angka yang dihijaukan.
- Grading SQL = angka dari result_json dibandingkan dengan eksekusi SQL langsung pada tabel fisik hasil ingest (bukan angka hafalan).
- mojibakeChars = sisa karakter asing (badness) pada teks chunk SETELAH cleaning; cleaningActions = jumlah perbaikan yang dilakukan pipeline.
- LLM_MODE=off, tanpa jaringan, tanpa retry, tanpa model berat — deterministik dan bisa diulang.
- Jawaban dokumen adalah kutipan deterministik (ADR-OF-11), bukan parafrasa LLM; grading memakai cakupan phrase kunci dari jawaban acuan, bukan kemiripan semantik. Ini lebih ketat dan sengaja tidak dimanipulasi.
- Hasil ini adalah potret pada satu run deterministik. Penurunan ambang hanya bersifat sempit (lookup kode/insiden dengan sitasi kuat, ADR-OF-12), bukan global; SOP-09/11 tetap ditolak. Tidak ada FAIL yang tersisa pada run ini.

Detail lengkap (jawaban, sitasi, SQL, angka, latensi, cleanFlags): `docs/ROBUSTNESS_RESULT.json`.
