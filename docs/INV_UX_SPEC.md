# SPESIFIKASI UX — MEKANISME INVESTIGASI (tiket INV-01)

Fase: P6-RISET. Status: draft untuk keputusan user.
Owner: analyst. Scope: spesifikasi saja, belum implementasi.
Sumber bukti: implementasi existing (dibaca 2026-11-25), `docs/SPEC.md` FR-05, `docs/BRIEF.md`.

---

## 0. Temuan dari implementasi existing (bukti)

Apa yang SUDAH ada:

| Bukti (file) | Fakta |
|---|---|
| `app/(workspace)/investigations/page.tsx` | Halaman investigasi HANYA daftar dossier tersimpan + filter pencarian + blok penjelasan "Cara kerja investigasi" (3 langkah: pilih sumber → ajukan pertanyaan → simpan dossier). Tidak bisa memulai investigasi dari sini; CTA hanya "Mulai dari sumber data" → `/data-sources`. |
| `app/(workspace)/investigations/[id]/page.tsx` | Dossier detail: rantai Hipotesis → Bukti → Sebab → Tindakan, kesimpulan + tingkat klaim, bento perbandingan, kontribusi per kanal, kode kegagalan, bukti + jejak SQL, linimasa, tombol cetak. Hasil investigasi TAMPIL DI SINI (sesuai ekspektasi user). |
| `app/(workspace)/data-sources/[id]/page.tsx:587-643` | Section "Investigasi" MUNCUL HANYA untuk sumber kind `dataset` (`isDataset`). Form: input pertanyaan (default "Mengapa tingkat kegagalan transaksi meningkat?") + tombol "Jalankan analisis" (persist=false) + "Simpan investigasi" (persist=true). |
| `app/(workspace)/data-sources/[id]/page.tsx:178-213` | **Hasil analisis yang belum disimpan ditampilkan INLINE di halaman detail sumber** (grid tingkat klaim + kesimpulan), BUKAN di halaman investigasi. Toast "Investigasi disimpan" + link "Buka dossier" mengarah ke `/investigations/[id]` hanya setelah persist. |
| `app/(workspace)/data-sources/[id]/page.tsx:381-397` | Dokumen (PDF/DOCX) punya CTA "Tanya dokumen ini" → `/assistant?attach=...` — TIDAK punya entry investigasi. |
| `app/(workspace)/assistant/` (grep "investig" = 0 hasil) | Tidak ada entry point investigasi dari chat. |
| `docs/API_CONTRACT.md` §6 | `POST /api/investigations/analyze {question, dataset, persist, lang}`; `GET /api/investigations`, `/overview`, `/anomalies`, `/:id`. Pipeline analisis dataset-centric (failure rate, kanal, temporal, SQL trace). |
| `docs/SPEC.md` FR-05 (AC-05.1..05.5) | Investigasi = analisis kenaikan failure rate pada dataset aktif: perbandingan periode, kontributor kanal, temporal, label korelasi vs kausal ("Indikasi"), simpan → muncul di `/investigations` (AC-05.5). |

Apa yang TIDAK NYAMBUNG (akar kebingungan user):

1. **Hasil yang belum disimpan muncul di tempat lain.** User menjalankan analisis di detail sumber, hasilnya inline di sana; halaman investigasi hanya berisi dossier yang sudah disimpan. User tidak pernah diberi tahu "hasil finalmu ada di halaman investigasi".
2. **Hanya dataset yang bisa diinvestigasi**, tapi halaman investigasi tidak menjelaskan ini dengan tegas — copy "Jalankan dari halaman detail sumber" tidak mengatakan "hanya sumber bertipe dataset". User yang membuka dokumen PDF tidak menemukan menu investigasi dan menyimpulkan fiturnya "useless".
3. **Tidak ada entry point selain detail sumber.** Tidak ada tombol investigasi di baris/kartu sumber di `/data-sources`, tidak ada di chat, tidak ada di halaman investigasi sendiri.
4. **Unit investigasi tidak pernah didefinisikan ke user**: satu dataset, dengan satu pertanyaan hipotesis.
5. **Investigasi vs tanya chat tidak dibedakan** di UI — keduanya "ajukan pertanyaan, dapat jawaban".

---

## 1. Jawaban tuntas atas pertanyaan riset

### 1.1 Dari mana user memulai investigasi?

**Rekomendasi: satu entry point utama + satu pendukung.**

- **Utama (W1):** tombol "Investigasi" di kartu/baris sumber bertipe DATASET di halaman `/data-sources` (list). Klik → deep-link ke `/data-sources/[id]#investigasi` (section investigasi di-scroll, fokus ke input pertanyaan).
- **Pendukung (W2):** tombol "Investigasi sumber ini" di band aksi halaman detail `/data-sources/[id]`, hanya untuk dataset, di samping "Indeks ulang"/"Hapus".
- **Dari chat (W3, fase berikutnya, Should bukan Must):** aksi "Jadikan investigasi" pada jawaban chat yang memakai dataset aktif — membawa pertanyaan user sebagai draft. Belum wajib di fase ini karena pipeline analisis investigasi bersifat deterministik (bukan jawaban chat), jadi tidak bisa sembarang jawaban chat dijadikan investigasi.
- **Dari detail dokumen (tidak direkomendasikan):** dokumen tidak punya metrik failure rate/kanal; pipeline analisis yang ada tidak berlaku. Entry investigasi untuk dokumen = fitur baru terpisah (lihat §5 pertanyaan terbuka).

### 1.2 Apa unit yang diinvestigasi?

**Satu sumber data bertipe dataset (dataset), dengan satu pertanyaan hipotesis.** Bukan satu baris data, bukan satu dokumen, bukan satu klaim. Dasar: `POST /api/investigations/analyze` menerima `dataset` (id sumber), dan seluruh output (failure rate, kontribusi kanal, temporal, SQL) dihitung atas dataset itu. Investigasi per baris/per dokumen tidak didukung pipeline saat ini dan tidak boleh diklaim di UI.

### 1.3 Bagaimana hasil ditampilkan di page investigasi?

Aturan tunggal: **halaman `/investigations` adalah rumah semua hasil, baik yang sudah disimpan maupun yang baru dijalankan.**

- Menjalankan analisis (persist=false) dari detail sumber TIDAK lagi menampilkan hasil inline penuh. Setelah analisis selesai, UI menampilkan kartu ringkas + CTA "Buka hasil investigasi" yang mengarah ke `/investigations/[id]` dalam mode **draft/unsaved** (lihat §1.5). Hasil detail lengkap hanya ada di halaman investigasi.
- Menyimpan (persist=true) mengubah draft menjadi dossier permanen yang muncul di daftar `/investigations`.
- Halaman daftar `/investigations` mempertahankan fungsi saat ini: daftar dossier tersimpan + pencarian.

### 1.4 Apa bedanya investigasi vs tanya chat?

| | Chat (assistant) | Investigasi |
|---|---|---|
| Pertanyaan | Bebas, apa saja | Hipotesis terstruktur tentang perubahan/pola pada satu dataset |
| Mesin | Retrieval (FTS5) + LLM, jawaban naratif + sitasi | Pipeline analitik deterministik (SQL): perbandingan periode, kontribusi kanal, temporal, kode kegagalan |
| Output | Jawaban percakapan, tidak tersimpan sebagai dossier | Dossier terstruktur dengan tingkat klaim (Terbukti/Terukur/Indikasi) + jejak SQL + bukti dokumen |
| Kapan dipakai | "Bagaimana prosedur X?", "Apa isi dokumen Y?" | "Mengapa metrik Z naik, faktor apa penyebabnya?" |

Copy UI wajib membedakan ini. Label chat: "Jawaban dari dokumen & data". Label investigasi: "Analisis terstruktur satu dataset: perubahan, penyebab, bukti". Blok "Cara kerja investigasi" di `/investigations` ditambah satu kalimat pembanding: "Butuh jawaban bebas dari dokumen? Gunakan Asisten. Ingin menganalisis mengapa angka pada dataset berubah? Gunakan investigasi."

### 1.5 Draft state / deep-link dari halaman lain

- **Deep-link masuk:** `/data-sources/[id]#investigasi` (section investigasi) — cukup, karena form investigasi memang hidup di detail sumber. Tidak perlu state global.
- **Draft hasil:** investigasi yang dijalankan tanpa persist tetap punya `id` dari API (sudah demikian: response `Investigation` berisi `id` meski persist=false, lihat `runInvestigation`). Maka `/investigations/[id]` bisa membukanya dengan badge status "Draft — belum disimpan" + tombol "Simpan investigasi" di halaman dossier. Draft tidak muncul di daftar `/investigations` (daftar hanya dossier tersimpan), tapi tetap bisa diakses via deep-link dari kartu hasil di detail sumber.
- **Tidak perlu draft form:** pertanyaan investigasi selalu diketik di tempat formnya (detail sumber); tidak ada skenario pindah halaman saat mengetik.

---

## 2. User journey (alur konkret, dipilih: Alternatif A, §4)

1. User membuka `/data-sources`. Setiap kartu sumber bertipe dataset menampilkan tombol "Investigasi" (ikon `query_stats`).
2. Klik "Investigasi" → pindah ke `/data-sources/[id]#investigasi`; section Investigasi ter-scroll dan input pertanyaan mendapat fokus.
3. User melihat (a) judul section + deskripsi "Analisis mendalam atas sumber ini", (b) penjelasan singkat 1 baris apa yang akan dihasilkan (perbandingan periode, kontributor, bukti), (c) input pertanyaan (sudah ada default), tombol "Jalankan analisis".
4. Klik "Jalankan analisis" → loading. Setelah selesai, area hasil menampilkan kartu ringkas: tingkat klaim + kesimpulan 2 baris + tombol utama **"Buka hasil investigasi"** → `/investigations/[id]` (draft) dan tombol sekunder **"Simpan investigasi"**.
5. Di `/investigations/[id]`, user melihat dossier lengkap (rantai Hipotesis → Bukti → Sebab → Tindakan, kontribusi, linimasa, SQL). Jika masih draft: badge "Draft" + tombol "Simpan investigasi" di header dossier; setelah disimpan, badge berubah "Tersimpan" dan dossier masuk daftar.
6. Di `/investigations`, user menemukan kembali dossier via daftar + pencarian (fungsi existing, tidak berubah).

---

## 3. Spesifikasi UI per halaman terlibat

### 3.1 `/data-sources` (list)

- **W1 — tombol "Investigasi" pada kartu sumber dataset.** Hanya render bila `source.kind === 'dataset'`. Posisi: area aksi kartu (samping aksi existing seperti pratinjau/hapus). Ikon `query_stats`, label "Investigasi". `href` = `/data-sources/{id}#investigasi`.
- Kartu dokumen (kind `document`) TIDAK mendapat tombol ini.
- Teks bantu di header halaman (opsional, Should): satu baris "Dataset dapat diinvestigasi; dokumen dapat ditanya lewat Asisten."

### 3.2 `/data-sources/[id]` (detail)

- **W2 — tombol "Investigasi sumber ini"** di bar aksi band gelap, hanya untuk dataset, anchor `#investigasi`.
- **Section Investigasi (dataset only, existing) diubah:**
  - Tambah 1 baris copy ekspektasi hasil: "Hasil analisis dibuka di halaman Investigasi; simpan untuk menjadikannya dossier permanen."
  - Setelah `invResult` ada: render kartu ringkas (tingkat klaim, kesimpulan dipotong 2 baris, jumlah query SQL + bukti) dengan CTA utama Link `Buka hasil investigasi` → `/investigations/{invResult.id}`, dan tombol sekunder `Simpan investigasi` (perilaku persist existing).
  - **Hapus tampilan hasil inline penuh** (grid md:grid-cols-3 yang ada sekarang) — diganti kartu ringkas di atas. Ini perubahan perilaku kunci tiket ini.
- **Dokumen:** tidak ada perubahan perilaku investigasi. Opsional (Could, fase berikutnya): ubah copy CTA "Tanya dokumen ini" agar jelas itu jalur untuk dokumen.

### 3.3 `/investigations` (daftar)

- Fungsi existing tetap: daftar dossier, pencarian, blok "Cara kerja".
- **Perubahan copy "Cara kerja investigasi":**
  - Langkah 1: "PILIH SUMBER — investigasi berlaku pada satu sumber bertipe dataset. Buka Sumber Data, pilih dataset, klik Investigasi."
  - Langkah 2 (existing, dirapikan): "AJUKAN PERTANYAAN — tulis hipotesis (default disediakan), jalankan analisis."
  - Langkah 3: "LIHAT & SIMPAN — hasil dibuka di halaman Investigasi. Simpan untuk menjadikannya dossier permanen yang bisa dibuka kembali di sini."
  - Tambah kalimat pembanding chat vs investigasi (§1.4).
- **Empty state** (sudah ada) dipertahankan; teksnya sudah mengarah ke jalur benar.

### 3.4 `/investigations/[id]` (dossier)

- Mendukung dua mode berdasar status tersimpan/draft dossier (perlu field `persisted` atau setara di response — lihat §4):
  - **Tersimpan (existing):** tidak berubah.
  - **Draft:** badge "Draft — belum disimpan" dekat judul + tombol "Simpan investigasi" di header. Setelah POST persist sukses → badge "Tersimpan", tombol hilang.
- Draft yang diakses langsung via URL tanpa adanya data (id tidak valid) tetap jatuh ke state error existing.

### 3.5 `/assistant`

- Fase ini: TIDAK ada perubahan. W3 (Should, fase berikutnya): aksi "Jadikan investigasi" pada jawaban yang memakai dataset aktif, membawa pertanyaan user → `/data-sources/{activeDatasetId}#investigasi` dengan pertanyaan terisi (via query param `?q=`, sekali pakai).

---

## 4. Kontrak data minimal (satu investigasi)

Field yang sudah ada di response `Investigation` (`lib/contracts/http`, dipakai `investigations/[id]/page.tsx`):

| Field | Tipe | Catatan |
|---|---|---|
| `id` | string | sudah ada; dipakai sebagai kunci draft & dossier |
| `question` | string | pertanyaan hipotesis |
| `dataset` / `dataset.name` | objek | sumber yang diinvestigasi (daftar menampilkan `datasetName`) |
| `period`, `comparison` | objek | periode + failure rate current vs previous |
| `contribution.channels[]` | array | kontribusi per kanal (excessFailures, failureRate) |
| `contribution.failureCodes[]` | array | kode kegagalan (per1000 nov/okt) |
| `temporal.points[]`, `temporal.notes[]` | array | linimasa |
| `conclusion.text`, `conclusion.claimLevel`, `conclusion.caveats[]` | objek | klaim: proven/measured/indication |
| `documents[]` | array | bukti dokumen (docTitle, sourceId, page, quote, section) |
| `evidence.sql[]` | array | jejak SQL |
| `createdAt` | string | tanggal |

**Field baru yang dibutuhkan spesifikasi ini (satu-satunya):**

| Field | Tipe | Kebutuhan |
|---|---|---|
| `persisted` | boolean (di response `POST /api/investigations/analyze` dan `GET /api/investigations/:id`) | Untuk membedakan draft vs dossier tersimpan di `/investigations/[id]`. Alternatif: endpoint detail menerima `?persisted=true`, atau daftar hanya menampilkan yang tersimpan (sudah terjadi) dan halaman detail menerima draft id apa pun. Backend memutuskan implementasi; kontrak minimal = UI bisa mengetahui status tersimpan sebuah investigation id. |

Tidak ada skema penyimpanan baru; draft tetap disimpan di memori/proses sesuai implementasi `persist=false` saat ini.

---

## 5. Alternatif desain + rekomendasi

### Alternatif A — "Analisis dari sumber, hasil di Investigasi" (REKOMENDASI)

Entry point: tombol Investigasi di kartu dataset (list) + tombol di detail. Hasil selalu dibuka di `/investigations/[id]` (draft → simpan). Halaman investigasi = pustaka + penjelasan mekanisme.

- **Trade-off (+):** paling kecil perubahan (section investigasi existing dipertahankan, hanya dipindah tampilan hasilnya); memperbaiki langsung keluhan "hasilnya di page investigasi"; tidak menambah halaman/route baru.
- **Trade-off (−):** tetap butuh satu langkah ekstra dari list ke detail; dokumen tetap tidak bisa diinvestigasi (dengan alasan pipeline).

### Alternatif B — "Investigasi sebagai halaman layanan (form di /investigations)"

Halaman `/investigations` punya form: pilih dataset (dropdown) + pertanyaan + jalankan. Semua entry point mengarah ke sini.

- **Trade-off (+):** menjawab "menu khusus di page investigasi" secara harfiah; satu tempat untuk semua.
- **Trade-off (−):** duplikasi form; kontradiksi dengan konsep existing "analisis dijalankan dari sumbernya"; user kehilangan konteks sumber saat memilih dari dropdown; perlu endpoint daftar dataset yang siap diinvestigasi. Effort lebih besar untuk nilai yang sama.

### Alternatif C — "Investigasi dari chat (conversation-first)"

Semua investigasi dimulai dari chat: user bertanya di assistant, tombol "Jadikan investigasi" di jawaban menjalankan pipeline analitik atas dataset aktif.

- **Trade-off (+):** entry paling natural bagi user yang sudah di chat; pertanyaan user langsung jadi draft.
- **Trade-off (−):** pipeline investigasi deterministik (SQL, kanal, temporal) tidak menjawab pertanyaan bebas; banyak pertanyaan chat tidak layak jadi investigasi; risiko fitur redundant dengan chat justru memburuk; paling banyak effort (perlu klasifikasi intent).

**Rekomendasi: Alternatif A untuk fase ini**, W3 (aksi dari chat) sebagai Should di iterasi berikutnya bila metrik penggunaan menunjukkan kebutuhan.

---

## 6. Pertanyaan terbuka (butuh keputusan user)

1. **Q-INV-1 (blocking untuk implementasi):** Setujui Alternatif A? (entry dari kartu dataset di list + detail; hasil dibuka di `/investigations/[id]` sebagai draft yang bisa disimpan.)
2. **Q-INV-2:** Apakah dokumen (PDF/DOCX) perlu bisa diinvestigasi di masa depan? Jika ya, itu fitur baru (pipeline analisis dokumen) dan harus masuk SPEC terpisah — spesifikasi ini tidak mencakupnya.
3. **Q-INV-3:** Draft investigasi (belum disimpan) boleh tetap hidup berapa lama / boleh hilang saat restart? Implementasi sekarang: persist=false kemungkinan tidak menulis DB permanen. Default konservatif (ASSUMPTION-INV-01): draft boleh hilang, user diberi peringatan "belum disimpan" di halaman dossier.
4. **Q-INV-4:** Apakah tombol Investigasi di list boleh langsung menjalankan analisis dengan pertanyaan default (tanpa melewati detail)? Rekomendasi: tidak — selalu lewat form di detail supaya pertanyaan terlihat/teredit.
5. **Q-INV-5 (Should, fase berikutnya):** Prioritaskan W3 "Jadikan investigasi" dari chat sekarang atau nanti?

## 7. Asumsi

- **ASSUMPTION-INV-01:** response `POST /api/investigations/analyze` dengan `persist=false` tetap mengembalikan objek investigasi lengkap ber-`id` yang dapat dibuka via `GET /api/investigations/:id` (berdasarkan `runInvestigation` yang menyimpan `invSavedId` dan membuat Link). Perlu verifikasi backend sebelum implementasi; bila tidak, draft mode di `/investigations/[id]` tidak bisa dibuat dan hasil draft harus tetap ditampilkan di detail sumber (fallback: kartu ringkas + simpan dari sana).

---

## Handoff

```yaml
from: analyst
to: agentic
phase: P6
type: deliverable
refs: [docs/INV_UX_SPEC.md]
summary: Riset mekanisme investigasi selesai. Akar kebingungan: hasil analisis belum-disimpan tampil inline di detail sumber, bukan di page investigasi; hanya dataset yang bisa diinvestigasi tapi tidak dijelaskan; tidak ada entry point selain detail sumber. Rekomendasi Alternatif A: tombol Investigasi di kartu dataset (list + detail), hasil selalu dibuka di /investigations/[id] dengan mode draft→simpan. Satu field kontrak baru dibutuhkan (persisted).
evidence: docs/INV_UX_SPEC.md §0 (kutipan implementasi existing: investigations/page.tsx, investigations/[id]/page.tsx, data-sources/[id]/page.tsx:178-213 & 587-643, API_CONTRACT §6, SPEC FR-05)
blocking: false
needs: [keputusan user atas Q-INV-1 (setuju Alternatif A), Q-INV-2 (investigasi dokumen di luar scope), verifikasi backend untuk ASSUMPTION-INV-01]
```
