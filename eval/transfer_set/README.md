# Transfer Set — aturan keras (FASE 1C)

Kumpulan ini adalah **set uji generalisasi lintas domain**, bukan bagian dari korpus tuning.

## LARANGAN (keras)

1. **DILARANG** menggunakan dokumen di folder ini — `kebijakan_cuti.pdf`, `keamanan_ti.pdf`, `pengadaan_barang.pdf` — untuk **tuning parameter apa pun** (threshold abstain, bobot retrieval, prompt, chunk size, OCR flag, dan sejenisnya).
2. **DILARANG** memasukkan dokumen atau QA di folder ini ke dalam indeks produksi, `dev`, `holdout`, `knowledge_tuning_sop.json`, atau GT `KB01`–`KB04`.
3. **DILARANG** menyalin pertanyaan di `*_qa.json` ke file tuning/GT, dan sebaliknya.
4. Dokumen ini **hanya boleh dipakai untuk mengukur generalisasi** setelah parameter dikunci dari set tuning asli. Hasilnya dilaporkan terpisah dari angka `dev`/`holdout`.

## Tujuan

Menguji apakah pipeline tetap benar saat menghadapi:
- domain baru (SDM, keamanan TI, pengadaan) di luar 4 dokumen SOP layanan;
- variasi layout: dua kolom, tabel, penomoran berjenjang tak konsisten + header/footer berulang;
- pertanyaan answerable, partial, tidak ada (abstain), dan umum/general.

## Isi

| File | Layout | QA |
|---|---|---|
| `kebijakan_cuti.pdf` + `kebijakan_cuti_qa.json` | dua kolom (kiri #1–#4, kanan #5–#8) | 22 |
| `keamanan_ti.pdf` + `keamanan_ti_qa.json` | tabel `Bagian \| Ketentuan` | 22 |
| `pengadaan_barang.pdf` + `pengadaan_barang_qa.json` | penomoran 1, 2, 2.1, 2.1.1, 3, 3.2.1, 4, 4.1 + header/footer berulang, 2 halaman | 22 |

`generate.py` meregenerasi ketiga PDF secara deterministik (jalankan lewat `safe_exec.py`, timeout 300). Teks di PDF adalah sumber kebenaran untuk `evidence_spans`; jangan mengubah teks tanpa memperbarui QA.

## Catatan keterbatasan

- Variasi "hasil scan satu halaman" **tidak dibuat**: tidak ada runtime OCR/image-gen yang tersedia di role ini. Ketiga PDF memiliki text layer, sehingga menguji generalisasi layout/struktur, bukan jalur OCR.
- `evidence_spans` diverifikasi sebagai substring persis dari teks yang dicetak di PDF masing-masing (bukan dari GT, bukan dari ingatan).
