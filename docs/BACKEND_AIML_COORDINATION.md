# BACKEND → AIML COORDINATION — P3-OVERFITTING-FIX

> File koordinasi antar-lane. Backend owns `lib/core/**`, `lib/ingest/**`, `app/api/**`, `scripts/**`.
> Aiml owns `lib/ai/**`, `lib/eval/**`. Jangan edit file lane lain tanpa handoff.

## 1. ADR-OF-13 — satu entry point chunker (WAJIB, sudah tersedia)

Backend sudah menambahkan entry point tunggal di `lib/ingest/chunker.ts`:

```ts
import { chunkDocument, type ChunkDocumentInput } from '@/lib/ingest/chunker';

const chunks = chunkDocument({
  sections,                 // ExtractedSection[] | ParsedSection[] | ChunkableSection[]
  docType: 'legal',         // 'legal' → chunkLegalDocument; selainnya → chunkSections
  documentId,               // opsional, untuk id legal yang stabil
  legalInputs,              // opsional, input kaya dari ekstraktor (lihat bawah)
});
```

Keluaran `ChunkDocumentResult[]` = `DocumentChunk` + field legal opsional
(`chunk_type`, `page_start`, `page_end`, `parent_id`, `pasal`, `ayat`, `butir`,
`content_hash`, `clean_flags`, `legal_id`). Field legal bernilai `null` untuk
dokumen non-legal.

### Yang harus aiml ubah

| File | Sebelum | Sesudah |
|---|---|---|
| `lib/eval/perpres.ts` | `chunkLegalDocument(inputs)` dipanggil langsung (baris ~398) | `chunkDocument({ docType: 'legal', legalInputs: inputs })` |
| `lib/eval/perpres.ts` | `chunkSections(sections)` untuk baseline (baris ~245) | `chunkDocument({ docType: 'general', sections })` |
| `lib/eval/holdout.ts` | `chunkSections(sections)` (baris ~94) | `chunkDocument({ docType: 'general', sections })` |

`legalInputs` diteruskan apa adanya supaya sinyal `heading`/`segments`/`kind`
dari `buildInputs(gt)` tidak hilang — ini **bukan** jalur eval terpisah, tetap
masuk lewat `chunkDocument`. Tanpa itu, `page_span` Perpres bisa turun.

**Dilarang** memanggil `chunkLegalDocument` langsung dari `lib/eval/**`.
Itu jalur eval-only yang dihapus ADR-OF-13.

### Sudah dilakukan backend

- `lib/core/ingest.ts` — `ingestIntoDataset` memanggil `chunkDocument` lewat
  adapter `toChunkDrafts` (chunker lokal dihapus).
- `lib/ingest/documents.ts`, `lib/db/migrate.ts` — memanggil `chunkDocument`
  dengan `docType: 'general'` (sumber legacy tak punya metadata doc_type).

### Akibat yang disengaja

Skor Perpres 6 metrik struktur **boleh turun** — itu diukur sekarang di jalur
yang sama dengan produksi. Yang dijaga: hold-out naik dan delta mengecil
(ADR §4 / R-1). Jangan menaikkan skor Perpres dengan mengembalikan jalur eval
khusus.

---

## 2. ADR-OF-15 — gate hold-out (helper sudah tersedia)

Backend menyediakan pure helper di `scripts/lib/holdout-gate.mjs` (lane
`scripts/**`, milik backend). Aiml tinggal memanggilnya dari harness.

```js
import { evaluateHoldoutGate, GATE_THRESHOLDS } from './lib/holdout-gate.mjs';

const gate = evaluateHoldoutGate({
  perpres: { answerable_accuracy: ..., refusal_accuracy: ... },
  holdout: { answerable_accuracy: ..., refusal_accuracy: ... },
});
// gate = { answerable, refusal, deltaAnswerable, deltaRefusal, overallPass, reasons }
```

Aturan (fail-closed bila metrik tidak ada / bukan angka):

- `answerable_holdout >= 0.80`
- `refusal_holdout >= 0.80`
- `deltaAnswerable = answerable_Perpres − answerable_holdout <= 0.15`
- `deltaRefusal = refusal_Perpres − refusal_holdout <= 0.15`
- **Delta harus sejenis**: `answerable_Perpres` dan `answerable_holdout`
  keduanya metrik answerable pada jalur produksi. Membandingkan 6 metrik
  struktur (0.996) dengan answerable (0.000) dilarang (ADR §2 ADR-OF-15.4).

`overallPass` dari gate ini mengikat P3→P4 dan P5. Runner `scripts/eval-holdout.mjs`
dan `docs/HOLDOUT_RESULT.json` tetap milik aiml/qa — backend tidak menyentuhnya.

### Catatan backend untuk ADR-OF-11 (sudah selesai, untuk konteks grader)

`searchChunks` sekarang mengirim **teks chunk penuh** sebagai `Citation.quote`;
`composeDeterministicAnswer` memotong di sekitar query-term (maks 600 char,
batas kalimat). Karena `evaluateGrounding` memakai `c.quote` yang sama, angka
dalam jendela tetap grounded. Grader ADR-OF-14 (allow-list `section_path` +
label halaman) tetap menjadi tanggung jawab aiml/qa.
