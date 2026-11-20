/**
 * On-demand OCR per halaman — ADR-11 / DECISION-016 / CORE_V2_ARCHITECTURE §2.
 *
 * Aturan keras:
 * - Kirim PIKSEL halaman (PNG base64), bukan nomor halaman. Field: image, page,
 *   docId, width, height. Kredensial dari env; base64 TIDAK PERNAH ditulis ke log.
 * - PNG 150 DPI (long edge ≈ 1754 px), ≤ 2 MB. Lebih besar → turunkan ke ~120 DPI;
 *   masih lebih besar → halaman `unreadable`, tidak dikirim.
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
export const LOW_TEXT_THRESHOLD = 40;
export const UNREADABLE_PAGE_TEXT = '[halaman tidak terbaca]';
export const MAX_OCR_IMAGE_BYTES = 2 * 1024 * 1024;
export const OCR_CONFIDENCE_MIN = 0.7;
const TARGET_LONG_EDGE = 1754; // ≈150 DPI untuk A4
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
};

export type RenderedPage = { png: Uint8Array; width: number; height: number };

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
      OCR_TIMEOUT_MS,
      `OCR halaman ${page}`,
      controller,
    );
    if (!response.ok) throw new Error(`OCR HTTP ${response.status}`);
    const data = (await response.json()) as { text?: unknown; confidence?: unknown; page?: unknown };
    const text = typeof data.text === 'string' ? data.text.trim() : '';
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
