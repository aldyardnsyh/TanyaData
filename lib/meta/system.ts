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
 * Batasan yang krusial bagi pengguna (DESIGN_SYSTEM §J, DECISION-035).
 * Hanya yang mengubah cara kerja atau ekspektasi pengguna yang dicantumkan;
 * pekerjaan tuning internal (presisi KB-GT, OCR, pengukuran Qdrant dev)
 * dilaporkan di docs/STATE.json, bukan di UI.
 */
const LIMITS: SystemLimit[] = [
  {
    id: 'no_auth',
    label: 'Satu workspace, tanpa multi-tenant',
    detail:
      'Dirancang untuk satu operator: satu workspace bersama, dengan guard token opsional (PUBLIC_DEPLOY + API_ACCESS_TOKEN) untuk deploy publik.',
    source: 'docs/DECISIONS.md',
  },
  {
    id: 'no_streaming',
    label: 'Jawaban satu kali jadi, bukan streaming',
    detail:
      'Setiap pertanyaan menghasilkan satu respons JSON lengkap (jawaban + chart + sitasi); tidak ada streaming token per token (ARCHITECTURE C-10).',
    source: 'docs/ARCHITECTURE.md',
  },
  {
    id: 'vercel_ephemeral',
    label: 'Backend penyimpanan data, frontend tampilan',
    detail:
      'Workspace (dokumen, dataset, riwayat) hidup di backend VPS; frontend di serverless hanya tampilan sehingga tidak menyimpan state (DECISION-002/029).',
    source: 'docs/DECISIONS.md',
  },
  {
    id: 'share_link',
    label: 'Share link berumur terbatas',
    detail:
      'Snapshot share bersifat read-only dan kedaluwarsa sesuai SHARE_TTL_DAYS; perlakukan tautan sebagai informasi sensitif.',
    source: 'lib/core/share.ts',
  },
];

/** Ringkasan satu paragraf; dipadatkan dari SYSTEM_OVERVIEW §1 tanpa klaim baru. */
const SUMMARY =
  'TanyaData mengubah pertanyaan bahasa natural menjadi jawaban yang bisa dipercaya: setiap angka berasal dari eksekusi SQL baca-saja ' +
  'dan setiap klaim dokumen menyertai sitasi [n] yang menunjuk potongan sumbernya. Retrieval berlapis — FTS5 (BM25) sebagai fondasi, ' +
  'Qdrant (BM25 + dense, fusi RRF) sebagai penguat semantik — memastikan parafrasa tetap ditemukan, sementara guardrail menolak permintaan ' +
  'di luar jangkauan sebelum menjawab. LLM bersifat opsional dan hanya menutup bila sinyal kualitas rendah; jawaban deterministik selalu tersedia.';

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
