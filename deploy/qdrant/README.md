# Qdrant di VPS — runbook ringkas

Lingkup: DECISION-032 / ADR-QD-02. Qdrant adalah **secondary index**; SQLite
tetap source of truth dan FTS5 tetap jalur default/fallback. File ini hanya
dijalankan **manual di VPS** oleh operator — agent tidak menjalankan Docker,
Qdrant, dev server, atau watcher.

## 0. Kapan dipakai

Default aman tetap `QDRANT_MODE=off`, `RETRIEVAL_MODE=fts5`,
`EMBEDDING_PROVIDER=off`. Aplikasi berjalan penuh tanpa container ini. Nyalakan
Qdrant hanya setelah `eval:qdrant-parity` dan 4 suite existing hijau di ambang
yang sama (ADR-QD-06). Embedding lokal **tidak** diaktifkan di VPS 2 GB —
Fase B butuh gate RAM ≥4 GB atau worker terpisah (Q-R3).

## 1. Setup dari nol (di VPS)

```bash
# 1. Secret — jangan pernah commit.
export QDRANT_API_KEY='<dari secret manager>'

# 2. Pastikan hanya loopback yang terbuka. Caddy men-terminate TLS.
#    Contoh Caddyfile:
#    qdrant.contoh.local {
#      reverse_proxy 127.0.0.1:6333
#    }

# 3. Jalankan container (detached — TIDAK ada watcher / foreground).
cd /srv/tanyadata/deploy/qdrant
docker compose up -d

# 4. Verifikasi auth + readiness. Port 6333 TIDAK boleh publik.
curl -fsS -H "api-key: $QDRANT_API_KEY" http://127.0.0.1:6333/readyz
# → "all shards are ready"
curl -fsS -H "api-key: $QDRANT_API_KEY" http://127.0.0.1:6333/
# → { "title": "qdrant - vector search engine", "version": "1.20.0", ... }
```

Lalu di aplikasi (VPS, file `.env.local` — bukan `NEXT_PUBLIC_*`):

```env
QDRANT_MODE=local
QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=<sama dengan secret di atas>
QDRANT_COLLECTION=td_chunks
QDRANT_COLLECTION_VERSION=v1
QDRANT_VECTOR_SIZE=384
RETRIEVAL_MODE=fts5
EMBEDDING_PROVIDER=off
```

Collection + alias + payload index dibuat otomatis dan idempoten oleh
`ensureQdrantCollection()` saat pertama kali outbox dikuras. Payload index
dibuat **sebelum** ingest agar filter-aware HNSW ikut terbangun.

## 2. RAM 2 GB — catatan jujur

- Fase A (BM25 + teks pra-stem) tidak memuat model; konsumsi Qdrant jauh di
  bawah dense. Batas container `1536M` mencegah berebut dengan Next.js dan
  Chromium PDF.
- Jangan jalankan reindex besar bersamaan dengan render PDF.
- `QDRANT__STORAGE__PERFORMANCE__INDEXING_THRESHOLD_GB` sengaja **tidak** diisi
  nilai. Set hanya bila pengukuran RSS menunjukkan perlu index-on-disk; rujuk
  dokumentasi resmi Qdrant, jangan menebak angka.
- Watchdog RSS 1,2 GB di `lib/ingest/watchdog.ts` tidak dinaikkan tanpa
  keputusan baru.

## 3. Snapshot & restore

Snapshot masuk named volume `qdrant_snapshots`. Salin ke `BACKUP_DIR` di luar
volume agar selamat bila container/volume dihapus. Rotasi mengikuti
`BACKUP_RETENTION_DAYS` yang sudah ada.

```bash
# Buat snapshot (wait=false untuk collection besar)
curl -fsS -X POST -H "api-key: $QDRANT_API_KEY" \
  'http://127.0.0.1:6333/collections/td_chunks_v1/snapshots?wait=false'

# Download ke BACKUP_DIR
curl -fsS -H "api-key: $QDRANT_API_KEY" \
  -o "$BACKUP_DIR/qdrant/td_chunks_v1.snapshot" \
  'http://127.0.0.1:6333/collections/td_chunks_v1/snapshots/<nama-file>'

# Restore ke collection kosong (verifikasi dulu di staging)
curl -fsS -X POST -H "api-key: $QDRANT_API_KEY" \
  -F 'snapshot=@td_chunks_v1.snapshot' \
  'http://127.0.0.1:6333/collections/td_chunks_restore/snapshots/upload?priority=snapshot'
```

## 4. Verifikasi konsistensi (Q-B2)

```bash
# Dari root tanyadata/, setelah Qdrant aktif:
node scripts/reindex-documents.mjs --qdrant-verify
# → OK   qdrant=<n> sqlite=<n> delta=0
# Saat QDRANT_MODE=off: "SKIPPED" (bukan FAIL palsu).
```

Reindex penuh: `npm run reindex:docs`. Point lama dihapus by `source_id`
sebelum ingest karena `newDocumentId()` menghasilkan `chunk_id` baru.

## 5. Rollback

Tanpa restore data:

1. Set `RETRIEVAL_MODE=fts5` (atau `QDRANT_MODE=off`) lalu restart backend.
2. FTS5 dan `core_chunks` tidak pernah dihapus — jawaban tetap tersedia.
3. Outbox `qdrant_outbox` / `qdrant_pending_deletes` sengaja dipertahankan agar
   sinkronisasi bisa dilanjutkan.
4. Hapus container + volume hanya bila Qdrant rusak total; bangun ulang dari
   SQLite lewat `npm run reindex:docs`.

## 6. Upgrade

Pin tag. `docker compose pull && docker compose up -d`. Jangan skip minor,
snapshot dulu, baca release notes tiap minor, dan **update cluster dulu — SDK
kemudian** (client dan server harus dalam satu minor version).
