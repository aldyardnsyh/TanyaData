# PRODUCTION_READY — TanyaData (backend, P4)

- **Tanggal:** 2026-11-24 · **Role:** `backend` · **Fase:** P4
- **Root:** `D:\Riset Pribadi\AI-Powered Data Analytics Chatbot` · app `tanyadata/`
- **Pemicu:** perbaikan sinkronisasi Qdrant (`reindexSource` tidak pernah menguras
  outbox) + bootstrap collection dari nol (`collectionExists()` SDK 1.20
  mengembalikan `{exists}`, bukan `boolean`) + permintaan bootstrap produksi.
- **Status:** siap untuk dijalankan operator di VPS. Agent TIDAK menjalankan
  `docker compose up` produksi, dev server, atau watcher apa pun.

---

## 1. Apa yang ikut ter-deploy

Default produksi adalah **`SEED_PROFILE=none`** — image benar-benar kosong:
tanpa 4 PDF KB-SOP, tanpa Perpres 76/2013, tanpa 46.952 transaksi dummy, dan
tanpa dokumen di FTS5/Qdrant. Profil `demo` hanya untuk development; tidak
pernah dipakai oleh deploy produksi.

| Artefak | `none` (default) | `demo` (development) | Catatan |
|---|---|---|---|
| **Next standalone** | ya | ya | `.next/standalone/` (+ `.next/static/` via `postbuild`). Image `tanyadata-app:1.0.0`, `deploy/app/Dockerfile`. Satu proses `node server.js`, port 3000, bind loopback. |
| **Seed PDF / dokumen** | **TIDAK** | ya | `data/seed/documents/*.pdf`, `*.txt`, `*.md`, `*.docx` (13 file, termasuk 4 KB-SOP + Perpres). `copy-standalone.mjs` melewati **dan menghapus sisa direktori** saat `none`. |
| **Seed terstruktur** | **TIDAK** | ya | `data/seed/structured/*.csv` (sumber 46.952 transaksi). |
| **DB seed** | **TIDAK** | ya | `data/analytics.db`. Saat `none`, `db:init` membuatnya dengan skema lengkap tapi **0 baris**; data R&D dibackup sekali ke `analytics.db.rnd-backup` (tidak ikut image). |
| **Manifes dokumen** | **TIDAK** | ya | `data/generated/documents.json`. Saat `none` ditulis dengan `documents: []`. |
| **Font** | ya | ya | `public/fonts/`. Diperlukan render PDF. |
| **Workspace DB** | dibuat di VPS | dibuat di VPS | `data/workspace/tanyadata.db` oleh `npm run bootstrap:production` (`db:init`), bukan dikirim dari lokal. `none`: skema lengkap, 0 chunk, `app_meta.seed_profile=none`. |
| **Indeks Qdrant** | 0 point | > 0 point | `td_chunks_v1` + alias `td_chunks`, derived index dari SQLite. Saat `none`, point lama dihapus; 0 point adalah keadaan benar, **bukan FAIL**. |
| **OCR service** | ya (opt-in) | ya (opt-in) | `deploy/ocr/` → `tanyadata-ocr:1.0.0`. Model PP-OCRv6 tiny sudah dibundel di wheel; tidak ada unduhan runtime. |

### Anti-kebocoran — yang TIDAK ikut

| Artefak | Alasan |
|---|---|
| `data/seed/**`, `data/analytics.db`, `data/generated/**` | Seed R&D. Dilewati saat `none` dan sisa build demo sebelumnya di-purge dari `.next/standalone`. |
| `*.gt.txt` di `data/seed/documents/` (`KB_01…`, `KB_04…`) | Transkrip ground truth. Dipakai hanya untuk evaluasi, **bukan** teks indeks. Ditolak oleh filter `EXCLUDED` pada kedua profil. |
| `data/fixtures/**`, `data/eval/**`, `data/corpus_sections/**` | GT / hold-out / tuning set. Next.js file tracing ikut menyalinnya ke standalone; `copy-standalone.mjs` sekarang **mem-purge** direktori ini pada kedua profil. |
| `data/workspace/**` dari lokal | DB + upload R&D. Dibuat ulang di VPS oleh bootstrap; tidak pernah dikirim dari lokal. |
| `ground_truth.json`, `chunks.jsonl`, `cases.json`, `*tuning*` | GT / tuning artifact. Ditolak oleh filter `EXCLUDED` + pemeriksaan fail-closed `assertNoForbiddenArtifacts()`. |
| `.env.local`, `.env`, API key, token | Rahasia. Di VPS dibuat manual / secret manager, di-mount sebagai `env_file`, tidak di-commit (`.gitignore`). |
| `node_modules/`, `.git/`, source `.ts` | Tidak diperlukan standalone. |
| File OCR GT / model tambahan | OCR memakai model bawaan wheel; tidak ada unduhan saat runtime. |

> Verifikasi anti-kebocoran: `npm run build` (menjalankan `postbuild`) lalu
> pastikan `.next/standalone/data/{seed,generated,fixtures,workspace}` tidak ada
> dan `KB_01*.pdf`, `Perpres_76_2013.pdf`, `*.gt.txt`, `ground_truth.json`,
> `chunks.jsonl` berjumlah 0. `npm run check:seed` juga memastikan
> `gt_transcript documents: 0` pada korpus indeks. Bukti: `docs/SEED_PROFILE_RESULT.json`.

---

## 2. Bootstrap dari VPS kosong

Prasyarat: Node ≥ 22, npm, Docker + Compose plugin, akses secret manager,
reverse proxy Caddy (TLS di-terminate di host). `SEED_PROFILE` **wajib `none`**
(default) di produksi.

```bash
# 0. Checkout HANYA artefak produksi (tanpa GT/tuning).
git clone <repo> /srv/tanyadata
cd /srv/tanyadata/tanyadata

# 1. Dependensi + build standalone. Default none → TIDAK ada seed di image.
npm ci
npm run build

# 2. Secret — JANGAN commit. Isi .env.local dari secret manager.
#    Lihat §3 untuk daftar wajib (termasuk SEED_PROFILE=none).
install -m 600 /dev/null .env.local
# ... isi .env.local ...

# 3. Bootstrap idempoten (none): db:init → reindex:docs → check:seed → Qdrant.
#    db:seed:kb-sop sengaja dilewati. Point Qdrant lama dihapus.
#    Qdrant 0 point = PASS dengan no_documents=true, bukan kegagalan.
#    Bila Qdrant mati/URL kosong, tetap sukses di FTS5 dengan catatan jujur.
npm run bootstrap:production

# 4. Verifikasi hasil bootstrap.
cat ../docs/BOOTSTRAP_RESULT.json
cat ../docs/SEED_PROFILE_RESULT.json   # bukti kedua profil (none + demo)
# status harus PASS; qdrant.status = ok | unavailable | disabled.
# qdrant.status = empty → FAIL (drain outbox rusak; hanya mungkin pada demo).

# 5. Verifikasi bootstrap collection dari nol (opsional, collection uji,
#    otomatis dihapus). Hanya bila Qdrant aktif.
npm run test:qdrant-bootstrap

# 6. Nyalakan stack. OCR opt-in lewat profile — jalankan hanya saat ingestion
#    dokumen image-only, lalu `docker compose stop ocr` lagi.
cd deploy
docker compose up -d
# docker compose --profile ocr up -d   # bila butuh OCR

# 7. Cek kesehatan (semua bind loopback).
curl -fsS http://127.0.0.1:3000/api/meta
curl -fsS -H "api-key: $QDRANT_API_KEY" http://127.0.0.1:6333/readyz
curl -fsS http://127.0.0.1:6334/healthz   # hanya bila profile ocr aktif

# 8. Verifikasi sinkronisasi (Qdrant aktif, setelah ada dokumen).
cd ..
node scripts/reindex-documents.mjs --qdrant-verify
# → OK qdrant=<n> sqlite=<n> delta=0 (n=0 pada produksi kosong)
```

### Profil seed

| Profil | Perilaku | Dipakai untuk |
|---|---|---|
| `none` (default) | 0 dokumen, 0 chunk, analytics.db 0 baris, Qdrant 0 point (`no_documents=true`). `db:seed:kb-sop` dilewati. | **Produksi** — VPS kosong. |
| `demo` | 4 KB-SOP + Perpres (11 dokumen), 46.952 transaksi, Qdrant > 0. `db:seed:kb-sop` dijalankan. | Development / evaluasi R&D. |

Seed R&D tidak hilang: `db:init` mode `none` menyimpan backup sekali ke
`data/analytics.db.rnd-backup`, dan mode `demo` dapat regenerate analytics.db
langsung dari `data/seed/structured/*.csv` (sumber kanonik).

```bash
# Development saja — JANGAN dijalankan di VPS produksi:
npm run seed:demo
# ekuivalen dengan: SEED_PROFILE=demo npm run bootstrap:production
# → 4 dokumen KB-SOP, 11 dokumen total, Qdrant > 0.
```

**Rollback cepat:** set `RETRIEVAL_MODE=fts5` (atau `QDRANT_MODE=off`) lalu
`cd deploy && docker compose restart app`. `core_chunks` + FTS5 tidak pernah
dihapus; jawaban tetap tersedia. Outbox sengaja dipertahankan agar sinkronisasi
bisa dilanjutkan. Untuk kembali ke produksi kosong dari demo, jalankan
`npm run bootstrap:production` dengan `SEED_PROFILE=none`.

---

## 3. Environment wajib (VPS-only, `.env.local`)

| Variabel | Wajib | Nilai / catatan |
|---|---|---|
| `SEED_PROFILE` | ya | `none` (default, **wajib produksi**) / `demo` (development). Nilai lain ditolak fail-closed. |
| `APP_ORIGIN` | ya | `https://…`, canonical + allow-list. |
| `CORS_ALLOWED_ORIGINS` | ya | Origin frontend Vercel, exact match. |
| `NEXT_PUBLIC_API_BASE_URL` | ya | Origin backend tanpa `/api`. |
| `PUBLIC_DEPLOY` | ya | `1` + `API_ACCESS_TOKEN` bila publik. |
| `API_ACCESS_TOKEN` | kondisional | Rahasia; wajib bila `PUBLIC_DEPLOY=1`. |
| `QDRANT_MODE` | ya | `on` (default) / `required` (fail-closed) / `off` (debug). |
| `QDRANT_URL` | ya bila aktif | `http://127.0.0.1:6333`. |
| `QDRANT_API_KEY` | **ya** | Rahasia; **sama** dengan `QDRANT_API_KEY` di compose. |
| `QDRANT_COLLECTION` / `_VERSION` | ya | `td_chunks` / `v1` → fisik `td_chunks_v1`. |
| `QDRANT_VECTOR_SIZE` | ya | `384` (e5-small). |
| `RETRIEVAL_MODE` | ya | `hybrid` / `qdrant` / `fts5` (fallback). |
| `EMBEDDING_PROVIDER` | ya | `local` / `off`. Model gagal → fallback FTS5. |
| `OCR_ENABLED` | ya | `false` default; `true` hanya saat ingestion image-only. |
| `OCR_ENDPOINT` | ya bila aktif | `http://127.0.0.1:6334/ocr`. |
| `OCR_API_KEY` | **ya** bila OCR aktif | Rahasia; sama dengan compose. |
| `OCR_TIMEOUT_MS` | ya | `5000` (> `OCR_TIMEOUT_S=4.0` di service). |
| `UID` / `GID` | disarankan | UID/GID user VPS pemilik `data/workspace`. |
| `LLM_MODE` | opsional | `off` default; aplikasi penuh tanpanya. |

Compose juga mewajibkan `QDRANT_API_KEY` dan `OCR_API_KEY` di lingkungan shell
saat `docker compose` dijalankan (`${VAR:?…}`). Tidak ada `NEXT_PUBLIC_QDRANT_*`
atau `NEXT_PUBLIC_EMBEDDING_*` — frontend tidak pernah membuka 6333/6334.

---

## 4. Perubahan kode pada putaran ini (ringkas)

| File | Perubahan |
|---|---|
| `lib/ingest/sources.ts` | `reindexSource()` memanggil `drainOutbox(db)` setelah tiap sumber; kegagalan Qdrant tidak menggagalkan reindex (tombstone + log jujur). |
| `lib/qdrant/client.ts` | Tipe `collectionExists` dikoreksi ke `boolean \| {exists}`; tambah `deleteCollection`. |
| `lib/qdrant/collections.ts` | Bootstrap dari nol: normalisasi `exists`, verifikasi ulang race, retry baca collection, index + alias idempoten. |
| `scripts/test-qdrant-bootstrap.mjs` | Uji bootstrap pada `td_bootstrap_test`, lalu hapus. |
| `scripts/bootstrap-production.mjs` | Urutan bootstrap idempoten + status JSON + fallback FTS5 jujur. |
| `scripts/copy-standalone.mjs` | Filter anti-kebocoran GT/tuning. |
| `deploy/docker-compose.prod.yml`, `deploy/app/Dockerfile` | Stack produksi 3 service. |
| `package.json` | Script `bootstrap:production`, `test:qdrant-bootstrap`, `seed:demo`. |
| `docs/API_CONTRACT.md` | Catatan kontrak: drain outbox non-blocking pasca-reindex. |

### Perubahan putaran ini — profil seed kosong (P4)

| File | Perubahan |
|---|---|
| `scripts/lib/seed-profile.mjs` | Satu sumber kebenaran `SEED_PROFILE` (`none`\|`demo`), default `none`, fail-closed. |
| `scripts/lib/seed-db.mjs` | Reset analytics.db/workspace DB in-place (tanpa `unlink`, tahan EBUSY saat file di-ATTACH proses lain), backup R&D, regenerate demo dari CSV. |
| `lib/db/seed-schema.sql` | DDL analytics.db tanpa data — dipakai mode `none`. |
| `scripts/copy-standalone.mjs` | `none`: skip + purge `data/seed`, `data/analytics.db`, `data/generated`; purge GT/eval/workspace pada kedua profil; `assertNoForbiddenArtifacts()` fail-closed. |
| `scripts/init-workspace-db.mjs` | `none`: analytics.db 0 baris + manifest kosong + workspace DB skema lengkap; `demo`: restore CSV + extract 11 dokumen. |
| `scripts/check-seed.mjs` | Validasi ekspektasi kosong pada `none`; pengecekan `ocr_unavailable`/`pdf_ocr` jujur pada `demo`. |
| `scripts/bootstrap-production.mjs` | `none`: lewati `db:seed:kb-sop`, hapus point Qdrant lama, 0 point = PASS + `no_documents=true`; tulis `SEED_PROFILE_RESULT.json` untuk kedua mode. |
| `scripts/seed-demo.mjs` | Shortcut cross-platform `npm run seed:demo`. |
| `docs/SEED_PROFILE_RESULT.json` | Bukti: `none` PASS/0 dokumen/0 point; `demo` PASS/11 dokumen/183 point. |
