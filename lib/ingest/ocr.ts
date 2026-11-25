/**
 * On-demand OCR per halaman — ADR-11 / DECISION-016 / CORE_V2_ARCHITECTURE §2.
 *
 * Aturan keras:
 * - Kirim PIKSEL halaman (PNG base64), bukan nomor halaman. Field: image, page,
 *   docId, width, height. Kredensial dari env; base64 TIDAK PERNAH ditulis ke log.
 * - PNG ≈210 DPI (long edge ≈ 2481 px), ≤ 2 MB. Lebih besar → turunkan bertahap
 *   hingga ~120 DPI; masih lebih besar → halaman `unreadable`, tidak dikirim.
 * - Timeout keras 5 detik per halaman + AbortController. Konkurensi = 1 dijaga
 *   pemanggil (loop berurutan). Watchdog RSS 1,2 GB dicek sebelum render.
 * - confidence < 0,70 → flag review, bukan bukti pasti. Teks kosong → ocr_skipped.
 * - Fallback jujur: adapter tak ada / timeout / HTTP error → UNREADABLE_PAGE_TEXT
 *   + ocr_status=ocr_skipped + nomor halaman. Tidak mengarang isi scan.
 */

import { extractImages, getDocumentProxy } from 'unpdf';

type PDFDocumentProxy = Awaited<ReturnType<typeof getDocumentProxy>>;
import type { DB } from '@/lib/db/client';
import { encodePng, downscaleRgba, type RgbaImage } from '@/lib/ingest/png';
import { assertMemoryOk } from '@/lib/ingest/watchdog';

export const OCR_TIMEOUT_MS = 5_000;

/**
 * Timeout efektif per halaman: env `OCR_TIMEOUT_MS` bila valid, fallback
 * konstanta di atas. VPS 2 vCPU dengan preprocessing bisa melewati 5 s per
 * halaman; default service (OCR_TIMEOUT_S=4) tetap harus lebih kecil dari
 * nilai ini agar service sempat membalas 504 sebelum klien menyerah.
 */
export function ocrTimeoutMs(): number {
  const v = Number(process.env.OCR_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 1000 ? Math.min(60_000, v) : OCR_TIMEOUT_MS;
}
export const LOW_TEXT_THRESHOLD = 40;
export const UNREADABLE_PAGE_TEXT = '[halaman tidak terbaca]';
export const MAX_OCR_IMAGE_BYTES = 2 * 1024 * 1024;
export const OCR_CONFIDENCE_MIN = 0.7;
const TARGET_LONG_EDGE = 2481; // ≈210 DPI untuk A4 — kualitas OCR di atas segalanya (trade-off CPU diterima operator)
const MIN_DOWNSCALE_FACTOR = 0.68; // ≈120 DPI

export type OcrStatus = 'ok' | 'ocr_skipped' | 'ocr_review' | 'not_attempted';

export type OcrOutcome = {
  text: string;
  used: boolean;
  skipped: boolean;
  confidence: number;
  status: OcrStatus;
  needsReview: boolean;
  latencyMs: number;
  reason?: string;
  width?: number;
  height?: number;
  /** Jumlah kolom halaman yang terdeteksi service OCR (1 = linear, 2 = dua kolom). */
  columns?: number;
  /** Posisi batas kolom relatif (0–1); null bila linear. */
  columnSplitX?: number | null;
};

export type RenderedPage = { png: Uint8Array; width: number; height: number };

/**
 * Post-OCR cleaning deterministik untuk dokumen Indonesia. HANYA perbaikan
 * bentuk, tidak pernah mengubah angka atau menambah konten:
 * - mojibake umum hasil PDF scan (�, â€, Ã) dibereskan atau dibuang.
 * - vokal beraksen dinormalisasi — bahasa Indonesia TIDAK punya huruf
 *   beraksen, jadi `í/é/ó/á/ú` pasti salah baca OCR (100% aman).
 * - digit "1" yang menempel langsung di huruf kecil dipulihkan ke "I"
 *   (OCR tiny sering menukar I↔1: "1kuti" → "Ikuti").
 * - spasi liar di dalam angka (RM/Rp "5 . 000") dirapikan tanpa mengubah nilai.
 * - baris tunggal yang terpotong di tengah kalimat digabung (heuristik aman).
 */
export function cleanOcrText(raw: string): string {
  let text = raw.replace(/\r\n?/g, '\n');
  // Mojibake UTF-8 dibaca sebagai Latin-1 (umum di scan hasil konversi).
  text = text
    .replace(/â€"/g, '—')
    .replace(/â€"/g, '–')
    .replace(/â€˜|â€™/g, "'")
    .replace(/â€œ|â€\x9d/g, '"')
    .replace(/Ã©/g, 'é')
    .replace(/Ã¶/g, 'ö')
    .replace(/Ã¼/g, 'ü');
  // U+FFFD (replacement char) → spasi; bukan informasi, jangan biarkan bocor ke sitasi.
  text = text.replace(/\uFFFD/g, ' ');
  // Vokal beraksen → vokal polos. Bahasa Indonesia tidak mengenal aksen; semua
  // huruf beraksen di teks Indonesia adalah salah baca OCR (í→i, é→e, dst).
  // Hanya huruf kecil (konteks kata bahasa Indonesia); kapital beraksen langka
  // dan bisa jadi nama asing, biarkan.
  text = text.replace(/[íìîï]/g, 'i').replace(/[éèêë]/g, 'e').replace(/[óòôõ]/g, 'o')
    .replace(/[áàâãä]/g, 'a').replace(/[úùûü]/g, 'u');
  // Digit "1" menempel langsung di huruf kecil (≥2 huruf) → "I" kapital.
  // Kata bahasa Indonesia tidak pernah diawali digit; pola "1kuti"/"1nformasi"
  // adalah I yang terbaca 1. Digit yang diikuti spasi ("1 hari") tidak disentuh.
  text = text.replace(/\b1(?=[a-z]{2,})/g, 'I');
  // Spasi di dalam angka: "5 . 000" → "5.000", "1 000 000" → "1.000.000" hanya bila
  // pola konsisten ribuan (kelompok 3 digit) — angka biasa tidak disentuh.
  text = text.replace(/\b(\d{1,3})\s*\.\s*(\d{3})\b(?!\s*\d)/g, '$1.$2');
  text = text.replace(/\b(\d{1,3})\s+(?=\d{3}\b)/g, '$1.'); // "1 000" → "1.000" (pola ribuan)
  // Spasi sebelum tanda baca akhir kalimat hasil OCR: "end ." → "end."
  text = text.replace(/\s+([,.;:!?])/g, '$1');
  // Gabung baris yang terpotong: baris diakhiri huruf kecil/tanda koma dan baris
  // berikutnya dimulai huruf kecil → satu kalimat yang sama, bukan dua.
  text = text.replace(/([a-z,;])\n(?=[a-z(])/g, '$1 ');
  // Rapikan spasi ganda sisa cleaning.
  text = text.replace(/[ \t]{2,}/g, ' ');
  return text.trim();
}

/** Kolom penanda OCR untuk tabel legacy `document_chunks`. Idempoten. */
export function ensureOcrColumns(db: DB): void {
  const cols = db.prepare('PRAGMA table_info(document_chunks)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('ocr_status')) {
    db.exec("ALTER TABLE document_chunks ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'ok'");
  }
  if (!names.has('confidence')) {
    db.exec('ALTER TABLE document_chunks ADD COLUMN confidence REAL NOT NULL DEFAULT 1');
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string, controller: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timeout ${ms}ms`));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Render halaman PDF → PNG ≤ 2 MB. Memakai gambar XObject terbesar pada
 * halaman (benar untuk scan, di mana halaman memang satu gambar). Tidak butuh
 * canvas native. Melempar Error bila watchdog RSS / render gagal.
 */
export async function renderPagePng(pdf: PDFDocumentProxy, pageNumber: number): Promise<RenderedPage | null> {
  assertMemoryOk();
  const images = await extractImages(pdf, pageNumber, { format: 'rgba' });
  if (!images.length) return null;
  const largest = images.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  let image: RgbaImage = { rgba: largest.data, width: largest.width, height: largest.height };

  const longEdge = Math.max(image.width, image.height);
  if (longEdge > TARGET_LONG_EDGE) {
    image = downscaleRgba(image, TARGET_LONG_EDGE / longEdge);
  }

  let png = await encodePng(image.rgba, image.width, image.height);
  let factor = 0.8;
  while (png.byteLength > MAX_OCR_IMAGE_BYTES && factor >= MIN_DOWNSCALE_FACTOR) {
    image = downscaleRgba(image, factor);
    png = await encodePng(image.rgba, image.width, image.height);
    factor *= 0.8;
  }
  if (png.byteLength > MAX_OCR_IMAGE_BYTES) return null; // jujur: terlalu besar untuk dikirim
  return { png, width: image.width, height: image.height };
}

export type OcrPageInput = { page: number; docId: string; pdf: PDFDocumentProxy };

function skipped(reason: string, used = false): OcrOutcome {
  return {
    text: '',
    used,
    skipped: true,
    confidence: 0,
    status: 'ocr_skipped',
    needsReview: false,
    latencyMs: 0,
    reason,
  };
}

/**
 * OCR satu halaman. Konkurensi dijaga pemanggil (loop berurutan, antrean 1).
 * Menerima objek `{page, docId, pdf}`; angka lama masih diterima untuk
 * kompatibilitas dengan adapter lama (tanpa pdf → skipped jujur).
 */
export async function ocrPage(input: OcrPageInput | number): Promise<OcrOutcome> {
  const started = Date.now();
  const page = typeof input === 'number' ? input : input.page;
  const endpoint = process.env.OCR_ENDPOINT;
  if (process.env.OCR_ENABLED !== 'true' || !endpoint) {
    return skipped('OCR adapter tidak tersedia (OCR_ENABLED/OCR_ENDPOINT kosong)');
  }
  if (typeof input === 'number') {
    return skipped('OCR tidak dapat merender halaman tanpa PDF proxy');
  }

  let rendered: RenderedPage | null = null;
  try {
    rendered = await renderPagePng(input.pdf, page);
  } catch (error) {
    return { ...skipped(error instanceof Error ? error.message : String(error), true), latencyMs: Date.now() - started };
  }
  if (!rendered) {
    return { ...skipped('Gambar halaman tidak tersedia atau melebihi 2 MB', true), latencyMs: Date.now() - started };
  }

  const controller = new AbortController();
  try {
    const response = await withTimeout(
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(process.env.OCR_API_KEY ? { authorization: `Bearer ${process.env.OCR_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          image: Buffer.from(rendered.png).toString('base64'),
          page,
          docId: input.docId,
          width: rendered.width,
          height: rendered.height,
        }),
        signal: controller.signal,
      }),
      ocrTimeoutMs(),
      `OCR halaman ${page}`,
      controller,
    );
    if (!response.ok) throw new Error(`OCR HTTP ${response.status}`);
    const data = (await response.json()) as {
      text?: unknown;
      confidence?: unknown;
      page?: unknown;
      columns?: unknown;
      columnSplitX?: unknown;
    };
    const text = typeof data.text === 'string' ? cleanOcrText(data.text) : '';
    const columns =
      (typeof data.columns === 'number' && (data.columns === 1 || data.columns === 2) ? data.columns : 1);
    const columnSplitX =
      typeof data.columnSplitX === 'number' && Number.isFinite(data.columnSplitX) ? data.columnSplitX : null;
    const confidence =
      typeof data.confidence === 'number' && Number.isFinite(data.confidence) ? data.confidence : 0.5;
    const latencyMs = Date.now() - started;
    if (!text) {
      return {
        ...skipped('OCR menghasilkan teks kosong', true),
        confidence,
        latencyMs,
        width: rendered.width,
        height: rendered.height,
      };
    }
    const needsReview = confidence < OCR_CONFIDENCE_MIN;
    return {
      text,
      used: true,
      skipped: false,
      confidence,
      status: needsReview ? 'ocr_review' : 'ok',
      needsReview,
      latencyMs,
      width: rendered.width,
      height: rendered.height,
      columns,
      columnSplitX,
    };
  } catch (error) {
    controller.abort();
    return {
      ...skipped(error instanceof Error ? error.message : String(error), true),
      latencyMs: Date.now() - started,
      width: rendered.width,
      height: rendered.height,
    };
  }
}
