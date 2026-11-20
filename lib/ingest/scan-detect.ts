/**
 * Deteksi text-layer vs scan per halaman (FR-A.1, RAG_ROBUSTNESS_RESEARCH §1).
 *
 * Sinyal murah dari data yang sudah ada: karakter teks, cakupan gambar
 * (`unpdf.inspectPages`), rasio gibberish, dan teks tak terlihat (render mode 3).
 * Sampling 5 halaman tersebar dipakai untuk klasifikasi awal dokumen, tetapi
 * keputusan OCR tetap diambil per halaman oleh pemanggil.
 */

import { getDocumentProxy, inspectPages } from 'unpdf';

type PDFDocumentProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

export type PageLabel = 'text' | 'image' | 'image+text_layer' | 'vector_only' | 'blank';

export type PageSignals = {
  page: number;
  chars: number;
  imageCoverage: number;
  gibberishRatio: number;
  invisibleTextLength: number;
  imageCount: number;
  label: PageLabel;
  /** true bila halaman ini layak dikirim ke OCR. */
  needsOcr: boolean;
};

export const LOW_TEXT_THRESHOLD = 40;
export const IMAGE_COVERAGE_THRESHOLD = 0.6;
export const GIBBERISH_THRESHOLD = 0.15;

const GIBBERISH_RE = /[\uFFFD\u0080-\u009B]|Ã|Â|â€|âœ/g;

export function gibberishRatio(text: string): number {
  if (!text) return 0;
  const hits = text.match(GIBBERISH_RE)?.length ?? 0;
  return hits / text.length;
}

export function labelPage(input: {
  chars: number;
  imageCoverage: number;
  gibberishRatio: number;
  invisibleTextLength: number;
  imageCount: number;
}): { label: PageLabel; needsOcr: boolean } {
  const { chars, imageCoverage, gibberishRatio: gib, invisibleTextLength, imageCount } = input;
  if (chars === 0 && imageCount === 0) return { label: 'blank', needsOcr: false };
  if (chars === 0 && imageCount > 0 && imageCoverage >= IMAGE_COVERAGE_THRESHOLD) {
    return { label: 'image', needsOcr: true };
  }
  if (chars < LOW_TEXT_THRESHOLD && imageCoverage >= IMAGE_COVERAGE_THRESHOLD) {
    return { label: 'image', needsOcr: true };
  }
  if (chars > 0 && gib > GIBBERISH_THRESHOLD) {
    return { label: 'image+text_layer', needsOcr: true };
  }
  if (chars > 0 && invisibleTextLength > 0 && imageCoverage >= IMAGE_COVERAGE_THRESHOLD) {
    return { label: 'image+text_layer', needsOcr: true };
  }
  if (chars === 0 && imageCount > 0) return { label: 'vector_only', needsOcr: false };
  if (chars < LOW_TEXT_THRESHOLD) return { label: 'vector_only', needsOcr: false };
  return { label: 'text', needsOcr: false };
}

/** Indeks halaman (1-indexed) yang tersebar, maks 5. */
export function samplePageNumbers(total: number, max = 5): number[] {
  if (total <= 0) return [];
  if (total <= max) return Array.from({ length: total }, (_, i) => i + 1);
  const out = new Set<number>();
  for (let i = 0; i < max; i += 1) out.add(Math.round(1 + (i * (total - 1)) / (max - 1)));
  return [...out].sort((a, b) => a - b);
}

/**
 * Hitung sinyal untuk semua halaman. `texts[page-1]` adalah text-layer mentah.
 * `inspectPages` gagal → fallback ke sinyal teks saja (jangan OCR buta).
 */
export async function detectPages(
  pdf: PDFDocumentProxy,
  texts: string[],
): Promise<PageSignals[]> {
  let inspected: Awaited<ReturnType<typeof inspectPages>>['pages'] = [];
  try {
    inspected = (await inspectPages(pdf)).pages;
  } catch {
    inspected = [];
  }
  return texts.map((text, index) => {
    const info = inspected[index];
    const chars = text.replace(/\s/g, '').length;
    const gib = gibberishRatio(text);
    const imageCoverage = info?.imageCoverage ?? 0;
    const invisibleTextLength = info?.invisibleTextLength ?? 0;
    const imageCount = info?.imageCount ?? 0;
    const { label, needsOcr } = labelPage({ chars, imageCoverage, gibberishRatio: gib, invisibleTextLength, imageCount });
    return {
      page: index + 1,
      chars,
      imageCoverage: Number(imageCoverage.toFixed(3)),
      gibberishRatio: Number(gib.toFixed(4)),
      invisibleTextLength,
      imageCount,
      label,
      needsOcr,
    };
  });
}
