/**
 * TanyaData — katalog `system` untuk tab Tentang (P6-UI-HONESTY, DECISION-035).
 *
 * Sumber:
 *   - Versi: `package.json` (diimpor statis, sehingga di-inline saat build dan
 *     TIDAK bergantung `process.cwd()` maupun file di image standalone).
 *   - Teks pipeline + batasan: `docs/SYSTEM_OVERVIEW.md` §2/§5 dan
 *     `docs/STATE.json`. Tidak ada klaim yang tidak punya anchor.
 *
 * Field `source?` disediakan untuk chip provenance (DESIGN_SYSTEM §J.3).
 */
import pkg from '../../package.json';
import type {
  MetaSystemPayload,
  SystemLimit,
  SystemPipelineStage,
  SystemRuntime,
  SystemStackItem,
} from '@/lib/contracts/http';

const deps = pkg.dependencies as Record<string, string>;

/** Versi persis dari `package.json`; `unknown` bila dependency hilang (jujur). */
function depVersion(name: string): string {
  return deps[name] ?? 'unknown';
}

/**
 * Tabel teknologi per tahap (SYSTEM_OVERVIEW §3). Versi diambil dari
 * `package.json`; `SQLite FTS5` adalah fitur runtime `better-sqlite3` sehingga
 * dilaporkan sebagai `bawaan`, bukan nomor versi karangan.
 */
const STACK: SystemStackItem[] = [
  {
    name: 'next',
    version: depVersion('next'),
    role: 'App Router / satu-proses',
    stage: 'platform',
    required: true,
    source: 'package.json',
  },
  {
    name: 'react',
    version: depVersion('react'),
    role: 'UI runtime',
    stage: 'platform',
    required: true,
    source: 'package.json',
  },
  {
    name: 'better-sqlite3',
    version: depVersion('better-sqlite3'),
    role: 'SQLite + FTS5 source of truth',
    stage: 'platform',
    required: true,
    source: 'package.json',
  },
  {
    name: 'SQLite FTS5',
    version: 'bawaan',
    role: 'BM25 jalur default + fallback',
    stage: 'retrieval',
    required: true,
    source: 'lib/db/schema.sql',
  },
  {
    name: '@qdrant/js-client-rest',
    version: depVersion('@qdrant/js-client-rest'),
    role: 'secondary index BM25 + dense',
    stage: 'retrieval',
    required: false,
    source: 'lib/qdrant/client.ts',
  },
  {
    name: '@huggingface/transformers',
    version: depVersion('@huggingface/transformers'),
    role: 'embedding lokal e5-small 384d q8',
    stage: 'retrieval',
    required: false,
    source: 'lib/ai/embedding.ts',
  },
  {
    name: 'unpdf',
    version: depVersion('unpdf'),
    role: 'ekstraksi teks PDF sadar-layout',
    stage: 'ingest',
    required: true,
    source: 'lib/ingest/extract.ts',
  },
  {
    name: 'mammoth',
    version: depVersion('mammoth'),
    role: 'ekstraksi DOCX',
    stage: 'ingest',
    required: true,
    source: 'lib/core/ingest.ts',
  },
  {
    name: 'recharts',
    version: depVersion('recharts'),
    role: 'visualisasi deterministik',
    stage: 'output',
    required: true,
    source: 'package.json',
  },
];

/** Empat tahap pipeline; teks dari SYSTEM_OVERVIEW §2 (dipadatkan, tanpa klaim baru). */
const PIPELINE: SystemPipelineStage[] = [
  {
    id: 'ingest',
    label: 'Ingest',
    summary:
      'Unggah file ≤25 MB → ekstraksi teks + chunk → indeks FTS5 (selalu) + Qdrant opsional + outbox.',
    inputs: ['file CSV/XLSX/SQLite/PDF/DOCX/TXT/MD'],
    outputs: ['dataset READY + fragment terindeks + quality_report'],
    fallback:
      'Format tak dikenal 415; file rusak/terenkripsi 422; tanpa text layer 422 NO_TEXT_LAYER; OCR mati → ocr_skipped; Qdrant gagal tidak menggagalkan ingest.',
    source: 'lib/core/ingest.ts',
  },
  {
    id: 'retrieval',
    label: 'Retrieval',
    summary:
      'Pertanyaan → guardrail → kandidat SQL (opsional LLM + fallback rule) → kandidat dokumen (FTS5 + Qdrant BM25 + dense, RRF) → rerank + excerpt.',
    inputs: ['pertanyaan natural + scope dataset'],
    outputs: ['citations tervalidasi + meta.retrievalBackend + fallbackReason'],
    fallback: 'Qdrant/embedding gagal, timeout, atau circuit terbuka → FTS5 deterministik + fallbackReason.',
    source: 'lib/ai/retrieval.ts',
  },
  {
    id: 'compose',
    label: 'Compose',
    summary:
      'Draft deterministik + marker sitasi [n] → LLM opsional sebagai fallback penutup hanya bila sinyal rendah → angka divalidasi vs bukti → sanitasi anti-slop/mojibake.',
    inputs: ['hasil SQL + citations'],
    outputs: ['jawaban final + vizSpec + citations + meta fallback'],
    fallback: 'LLM off/gagal/429/timeout/ungrounded → draft deterministik tetap dikirim.',
    source: 'lib/ai/adapter.ts',
  },
  {
    id: 'output',
    label: 'Keluaran',
    summary:
      'Jawaban dirender sebagai chart (recharts) + tabel + sitasi; laporan CSV/PDF; share snapshot read-only ber-TTL.',
    inputs: ['objek Query lengkap'],
    outputs: ['chat answer + chart + laporan + share link'],
    fallback: 'Ekspor PDF butuh BROWSER_PDF_EXECUTABLE; tanpa itu ekspor PDF tidak tersedia.',
    source: 'lib/core/answer.ts',
  },
];

/**
 * Batasan yang terbukti. Setiap entri merujuk STATE.json / dokumen yang ada.
 * Entri `dashboard_range` dari contoh kontrak DIHAPUS karena SET-01
 * menyambungkan dashboard ke `settings.dateRange` (batasan itu tidak berlaku lagi).
 */
const LIMITS: SystemLimit[] = [
  {
    id: 'no_auth',
    label: 'Tanpa auth/multi-tenant',
    detail: 'Single workspace lokal; guard token opsional PUBLIC_DEPLOY/API_ACCESS_TOKEN (.env.example:35-39).',
    source: 'docs/STATE.json',
  },
  {
    id: 'precision_target',
    label: 'Target presisi KB-GT belum tercapai',
    detail: 'Holdout 0,8571 dan dev 0,5915 (target 0,99; target_met=false). Lihat docs/STATE.json kb_ground_truth.',
    source: 'docs/STATE.json',
  },
  {
    id: 'kb_ocr_gap',
    label: 'KB01/KB04 masih pakai transkrip GT',
    detail:
      'OCR PP-OCRv6 tiny sudah diimplementasikan tetapi belum dijalankan di VPS; korpus eval memakai gt_transcript, bukan OCR asli.',
    source: 'docs/STATE.json',
  },
  {
    id: 'cross_doc_precision',
    label: 'Presisi lintas-dokumen rendah',
    detail: 'FALSE_ABSTAIN pada parafrasa masih 11 di holdout; sintesis lintas dokumen belum stabil.',
    source: 'docs/STATE.json',
  },
  {
    id: 'qdrant_dev',
    label: 'Qdrant belum dijalankan di mesin dev',
    detail: 'Circuit breaker terverifikasi; fallback FTS5 deterministik.',
    source: 'docs/STATE.json',
  },
  {
    id: 'no_streaming',
    label: 'Tanpa streaming/real-time',
    detail: 'Satu respons JSON per pesan (ARCHITECTURE C-10).',
    source: 'docs/ARCHITECTURE.md',
  },
  {
    id: 'vercel_ephemeral',
    label: 'State workspace lokal bisa hilang di Vercel',
    detail: 'Cold start menghapus workspace writable (DECISION-002 konsekuensi 3).',
    source: 'docs/DECISIONS.md',
  },
];

/** Ringkasan satu paragraf; dipadatkan dari SYSTEM_OVERVIEW §1 tanpa klaim baru. */
const SUMMARY =
  'TanyaData adalah aplikasi analitik tanya-jawab Next.js satu proses dengan SQLite sebagai sumber kebenaran. ' +
  'Retrieval deterministik lebih dulu: FTS5 (BM25) selalu terisi, Qdrant hanya indeks turunan opsional (BM25 + dense) yang difusikan dengan RRF dan selalu jatuh ke FTS5 bila gagal. ' +
  'Jawaban disusun dari data (SQL baca-saja atau kutipan dokumen ber-sitasi); LLM opsional dan wajib ter-grounding.';

/** Bangun payload `system` lengkap dengan runtime yang sudah diturunkan. */
export function buildSystemPayload(runtime: SystemRuntime): MetaSystemPayload {
  return {
    summary: SUMMARY,
    stack: STACK,
    pipeline: PIPELINE,
    runtime,
    limits: LIMITS,
  };
}
