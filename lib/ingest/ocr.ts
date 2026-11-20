/**
 * On-demand OCR per halaman — RESOURCE_OPTIMIZED_ADR.
 *
 * Aturan keras:
 * - Text layer (unpdf) dipakai lebih dulu; OCR hanya dipanggil bila teks
 *   halaman kosong/rendah (< LOW_TEXT_THRESHOLD karakter).
 * - Satu halaman per proses, konkuren = 1 (dipanggil berurutan dengan await).
 * - Timeout keras 15 detik per halaman + AbortController.
 * - TIDAK menginstall PP-OCRv6 / engine berat. Adapter opsional lewat env
 *   OCR_ENDPOINT (+ OCR_API_KEY). Tanpa adapter → skip jujur, bukan error diam.
 * - Kegagalan ditandai `ocr_skipped` + confidence 0, teks pengganti jujur
 *   "[halaman tidak terbaca]" — tidak mengarang isi scan.
 */

import type { DB } from '@/lib/db/client';

export const OCR_TIMEOUT_MS = 15_000;
export const LOW_TEXT_THRESHOLD = 40;
export const UNREADABLE_PAGE_TEXT = '[halaman tidak terbaca]';

export type OcrOutcome = {
  text: string;
  used: boolean;
  skipped: boolean;
  confidence: number;
  reason?: string;
};

/** Kolom penanda OCR. Idempoten, reversible (DROP COLUMN / rebuild tabel). */
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

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms);
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
 * OCR satu halaman. Konkuren dijaga pemanggil (loop berurutan), bukan di sini.
 * Kontrak adapter: POST OCR_ENDPOINT → { text: string, confidence?: number }.
 */
export async function ocrPage(pageNumber: number): Promise<OcrOutcome> {
  const endpoint = process.env.OCR_ENDPOINT;
  if (process.env.OCR_ENABLED !== 'true' || !endpoint) {
    return {
      text: '',
      used: false,
      skipped: true,
      confidence: 0,
      reason: 'OCR adapter tidak tersedia (OCR_ENABLED/OCR_ENDPOINT kosong)',
    };
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
        body: JSON.stringify({ page: pageNumber }),
        signal: controller.signal,
      }),
      OCR_TIMEOUT_MS,
      `OCR halaman ${pageNumber}`,
    );
    if (!response.ok) throw new Error(`OCR HTTP ${response.status}`);
    const data = (await response.json()) as { text?: unknown; confidence?: unknown };
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    const confidence =
      typeof data.confidence === 'number' && Number.isFinite(data.confidence) ? data.confidence : 0.5;
    if (!text) {
      return { text: '', used: true, skipped: true, confidence, reason: 'OCR menghasilkan teks kosong' };
    }
    return { text, used: true, skipped: false, confidence };
  } catch (error) {
    controller.abort();
    return {
      text: '',
      used: true,
      skipped: true,
      confidence: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
