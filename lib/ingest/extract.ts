import mammoth from 'mammoth';
import { getDocumentProxy } from 'unpdf';
import { unprocessable } from '@/lib/errors';
import type { ExtractedPage, ExtractedSection, LayoutInfo, OcrMark } from '@/lib/ingest/types';
import { LOW_TEXT_THRESHOLD, UNREADABLE_PAGE_TEXT, ocrPage, type OcrOutcome } from '@/lib/ingest/ocr';
import { matchGenericHeading, type GenericHeading } from '@/lib/ingest/chunker';

const PAGE_ARTIFACT = /dokumen dummy untuk technical test ai engineer halaman \d+/i;
const LINE_TOLERANCE = 3;
const MD_HEADING = /^#{1,6}\s+(.{1,120})$/;
const PAGE_NUMBER_RE = /^(?:halaman|page|hal)\s*[:.]?\s*\d{1,4}(?:\s*(?:dari|of|\/)\s*\d{1,4})?$|^\d{1,4}$/i;
const PAGE_NUMBER_INLINE_RE = /\s*(?:halaman|page|hal)\s*[:.]?\s*\d{1,4}\s*(?:dari|of|\/)\s*\d{1,4}\s*/gi;

type Positioned = {
  str: string;
  x: number;
  y: number;
  fontName?: string;
  height?: number;
};

function cleanLine(line: string): string {
  let trimmed = line.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  if (PAGE_ARTIFACT.test(trimmed)) {
    const rest = trimmed.replace(PAGE_ARTIFACT, '').trim();
    return rest.length > 3 ? rest : '';
  }
  // "Halaman 1 dari 2" sering menempel di akhir baris hasil text-layer.
  const withoutPage = trimmed.replace(PAGE_NUMBER_INLINE_RE, ' ').replace(/\s+/g, ' ').trim();
  if (withoutPage) trimmed = withoutPage;
  return trimmed;
}

const COLUMN_CLUSTER_TOLERANCE = 2;

/**
 * Rentang x yang tahan-outlier. Satu item tunggal di tepi (nomor halaman,
 * tanda stray) melebarkan rentang mentah sehingga jurang antar-kolom jatuh di
 * luar pita tengah: KB03 punya item "1" di x=542 sehingga jurang 48→306 berada
 * di posisi relatif 0,26 (butuh >0,3) dan halaman dua kolom dibaca linear —
 * heading kiri "1. Jam Layanan" menempel ke heading kanan "7. Pelaporan
 * Mingguan". Tepi kolom selalu dipakai banyak baris, jadi cluster x yang sangat
 * jarang (≤3% item) dan terpisah lebar dari bulk diperlakukan sebagai noise.
 */
function robustExtent(xs: number[]): { min: number; max: number } {
  const first = xs[0];
  const last = xs[xs.length - 1];
  const span = last - first;
  if (!(span > 0)) return { min: first, max: last };
  const maxSparse = Math.max(1, Math.ceil(xs.length * 0.03));
  const gapLimit = span * 0.1;
  const clusters: Array<{ min: number; max: number; n: number }> = [];
  for (const x of xs) {
    const tail = clusters[clusters.length - 1];
    if (tail && x - tail.max <= COLUMN_CLUSTER_TOLERANCE) {
      tail.max = x;
      tail.n += 1;
    } else {
      clusters.push({ min: x, max: x, n: 1 });
    }
  }
  let lo = 0;
  let hi = clusters.length - 1;
  while (lo < hi && clusters[lo].n <= maxSparse
    && clusters[lo + 1].min - clusters[lo].max > gapLimit) lo += 1;
  while (hi > lo && clusters[hi].n <= maxSparse
    && clusters[hi].min - clusters[hi - 1].max > gapLimit) hi -= 1;
  return { min: clusters[lo].min, max: clusters[hi].max };
}

/**
 * Temukan batas dua kolom dari distribusi koordinat x (transform[4]).
 * Dipakai bila ada jurang lebar di tengah halaman dan kedua sisi cukup padat.
 * Mengembalikan null untuk halaman satu kolom / linear.
 */
function detectColumnSplit(items: Positioned[]): number | null {
  if (items.length < 8) return null;
  const xs = items.map((item) => item.x).sort((a, b) => a - b);
  const { min, max } = robustExtent(xs);
  const width = max - min;
  if (width < 150) return null;

  let bestGap = 0;
  let bestX: number | null = null;
  for (let i = 1; i < xs.length; i += 1) {
    const gap = xs[i] - xs[i - 1];
    const mid = (xs[i] + xs[i - 1]) / 2;
    const relative = (mid - min) / width;
    if (relative > 0.3 && relative < 0.7 && gap > bestGap) {
      bestGap = gap;
      bestX = mid;
    }
  }
  // Jurang antar-kolom jauh lebih lebar daripada celah antar-kata/antar-kolom
  // tabel. Ambang lama (6% lebar) mengira halaman satu kolom Perpres/SOP sebagai
  // dua kolom hanya karena ada celah 24–28 pt di tengah baris teks.
  if (bestX === null || bestGap <= Math.max(40, width * 0.25)) return null;

  const left = items.filter((item) => item.x < bestX);
  const right = items.filter((item) => item.x >= bestX);
  if (left.length < 2 || right.length < 2) return null;

  // Bukti bimodal: hampir tidak ada item di zona tengah. Dokumen satu kolom
  // menyebarkan item ke seluruh lebar (≈30–50% di zona ini), sedangkan dua
  // kolom nyata mengosongkannya. Ini pembeda utama terhadap tabel/legal.
  const middle = items.filter((item) => {
    const relative = (item.x - min) / width;
    return relative > 0.3 && relative < 0.7;
  }).length;
  if (middle / items.length > 0.15) return null;

  // Baris sejajar: ≥2 baris memiliki item di KEDUA sisi jurang. Satu baris
  // tabel atau nomor halaman di tepi tidak cukup untuk disebut dua kolom.
  const leftRows = new Set(left.map((item) => Math.round(item.y / LINE_TOLERANCE)));
  const rightRows = new Set(right.map((item) => Math.round(item.y / LINE_TOLERANCE)));
  const parallelRows = [...leftRows].filter((y) => rightRows.has(y)).length;
  if (parallelRows < 2) return null;

  return bestX;
}

/**
 * Urutkan item SATU kolom: kumpulkan per baris memakai y (transform[5]) dengan
 * toleransi LINE_TOLERANCE, lalu baca baris dari ATAS (y terbesar) ke BAWAH
 * (y terkecil); item dalam satu baris dibaca KIRI (x terkecil) → KANAN.
 * Mengelompokkan per baris mencegah interleave yang terjadi pada sort per-item
 * (comparator lama tidak transitif ketika dua pasangan jatuh di sisi toleransi
 * berbeda). Ini yang membuat bagian 7–8 di kolom kanan terbaca berurutan.
 */
function sortColumn(items: Positioned[]): Positioned[] {
  const rows: Array<{ y: number; items: Positioned[] }> = [];
  for (const item of [...items].sort((a, b) => b.y - a.y)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= LINE_TOLERANCE);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows.flatMap((row) => [...row.items].sort((a, b) => a.x - b.x));
}

/** Baris yang terdeteksi sebagai tabel: ≥3 item sejajar dengan jarak x merata. */
function countTableRows(items: Positioned[]): number {
  const rows = new Map<number, number[]>();
  for (const item of items) {
    const key = Math.round(item.y / LINE_TOLERANCE);
    const bucket = rows.get(key) ?? [];
    bucket.push(item.x);
    rows.set(key, bucket);
  }
  let tables = 0;
  for (const xs of rows.values()) {
    if (xs.length < 3) continue;
    const sorted = [...xs].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((x, i) => x - sorted[i]).filter((g) => g > 4);
    if (gaps.length >= 2) tables += 1;
  }
  return tables;
}

type RawPositioned = {
  str: string;
  x: number;
  y: number;
  fontName: string | undefined;
  height: number | undefined;
};

function toPositioned(rawItems: unknown[]): Positioned[] {
  return rawItems
    .map((raw): RawPositioned | null => {
      const item = raw as unknown as {
        str?: unknown;
        transform?: number[];
        fontName?: unknown;
        height?: unknown;
      };
      if (typeof item.str !== 'string' || !item.str.trim()) return null;
      return {
        str: item.str,
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        fontName: typeof item.fontName === 'string' ? item.fontName : undefined,
        height: typeof item.height === 'number' ? item.height : undefined,
      };
    })
    .filter((item): item is RawPositioned => item !== null);
}

/**
 * Dipakai oleh `lib/core/ingest.ts` supaya jalur eval/produksi memakai urutan
 * baca yang SAMA dengan jalur workspace. Menerima array `content.items` per
 * halaman, mengembalikan teks + urutan baca + metadata layout per halaman.
 */
export function layoutAwarePdfTexts(
  pagesItems: unknown[][],
): Array<{ text: string; readingOrder: string[]; layout: LayoutInfo }> {
  const analyses = pagesItems.map((items) => analyzePage(toPositioned(items)));
  stripRepeatedLines(analyses);
  return analyses.map((analysis) => ({
    text: analysis.lines.join('\n'),
    readingOrder: analysis.lines,
    layout: analysis.layout,
  }));
}

function linesFromOrdered(items: Positioned[]): string[] {
  const lines: string[] = [];
  let lineY: number | null = null;
  let parts: string[] = [];
  for (const item of items) {
    if (lineY === null || Math.abs(item.y - lineY) > LINE_TOLERANCE) {
      if (parts.length) lines.push(parts.join(' ').replace(/\s+/g, ' ').trim());
      lineY = item.y;
      parts = [item.str];
    } else {
      parts.push(item.str);
    }
  }
  if (parts.length) lines.push(parts.join(' ').replace(/\s+/g, ' ').trim());
  return lines.map(cleanLine).filter(Boolean);
}

type PageAnalysis = { lines: string[]; layout: LayoutInfo };

/**
 * Baris dengan font bold/lebih besar dari median halaman. Disimpan sebagai
 * metadata (bukan diubah pada teks) supaya sectioning bisa memakainya sebagai
 * sinyal tambahan saat pola penomoran tidak konsisten.
 */
function detectHeadingLines(items: Positioned[], lines: string[]): string[] {
  if (!items.length) return [];
  const heights = items.map((i) => i.height ?? 0).filter((h) => h > 0).sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const emphasized = items
    .filter((i) => /bold|black|semibold/i.test(i.fontName ?? '')
      || (median > 0 && (i.height ?? 0) >= median * 1.25))
    .map((i) => cleanLine(i.str))
    .filter((text) => text.length >= 3);
  if (!emphasized.length) return [];
  return lines.filter((line) => emphasized.some((text) =>
    line === text || line.startsWith(text) || text.startsWith(line)));
}

function analyzePage(items: Positioned[]): PageAnalysis {
  const splitX = detectColumnSplit(items);
  // Bangun baris PER KOLOM lalu gabungkan: kiri atas→bawah, lalu kanan
  // atas→bawah. Menggabungkan item dua kolom sebelum linesFromOrdered() bisa
  // menyatukan baris terakhir kiri dengan baris pertama kanan bila y-nya
  // kebetulan sama — itulah interleave yang merusak bagian 7–8 KB01.
  const columns = splitX === null
    ? [items]
    : [items.filter((item) => item.x < splitX), items.filter((item) => item.x >= splitX)];
  const lines = columns.flatMap((column) => linesFromOrdered(sortColumn(column)));
  const pageNumberLine = lines.find((line) => PAGE_NUMBER_RE.test(line.trim())) ?? null;
  const pageNumber = pageNumberLine ? Number(pageNumberLine.match(/\d{1,4}/)?.[0] ?? 0) || null : null;
  return {
    lines,
    layout: {
      columns: splitX === null ? 1 : 2,
      columnSplitX: splitX,
      readingOrder: splitX === null ? 'linear' : 'column',
      repeatedLines: [],
      pageNumber,
      tables: countTableRows(items),
      headingLines: detectHeadingLines(items, lines),
    },
  };
}

/**
 * Header/footer berulang: baris identik di zona atas/bawah yang muncul pada
 * ≥2 halaman. Dokumen 2 halaman pun harus dibersihkan — ambang lama (≥3)
 * membiarkan header PD masuk ke chunk sampah. Nomor halaman dibuang juga.
 */
function stripRepeatedLines(analyses: PageAnalysis[]): void {
  if (analyses.length < 2) return;
  const counts = new Map<string, number>();
  for (const analysis of analyses) {
    const zone = new Set<string>();
    for (const line of analysis.lines.slice(0, 3)) zone.add(line.toLowerCase());
    for (const line of analysis.lines.slice(-3)) zone.add(line.toLowerCase());
    for (const line of zone) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(analyses.length / 2));
  const repeated = new Set(
    [...counts.entries()].filter(([, n]) => n >= threshold).map(([line]) => line),
  );
  for (const analysis of analyses) {
    const kept = analysis.lines.filter((line) => {
      if (PAGE_NUMBER_RE.test(line.trim())) return false;
      return !repeated.has(line.toLowerCase());
    });
    analysis.layout.repeatedLines = analysis.lines
      .filter((line) => !kept.includes(line))
      .slice(0, 6);
    analysis.lines = kept;
  }
}

export async function extractPages(format: string, buffer: Buffer): Promise<ExtractedPage[]> {
  if (format === 'pdf') {
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(new Uint8Array(buffer));
    } catch {
      throw unprocessable('PDF tidak dapat dibaca (rusak atau terenkripsi)');
    }

    const pagesItems: unknown[][] = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pagesItems.push(content.items);
    }
    const layouts = layoutAwarePdfTexts(pagesItems);

    const pages: ExtractedPage[] = [];
    for (let i = 0; i < layouts.length; i += 1) {
      const pageNo = i + 1;
      const analysis = layouts[i];
      const text = analysis.text;
      // Text layer dipakai lebih dulu. OCR hanya untuk halaman kosong/rendah,
      // satu halaman per proses, berurutan (konkuren = 1), timeout 5s di ocrPage.
      if (text.trim().length < LOW_TEXT_THRESHOLD) {
        const outcome: OcrOutcome = await ocrPage({ page: pageNo, docId: `src_${pageNo}`, pdf });
        if (outcome.skipped) {
          pages.push({
            page: pageNo,
            text: UNREADABLE_PAGE_TEXT,
            ocr: { used: outcome.used, skipped: true, confidence: 0, reason: outcome.reason },
            readingOrder: [],
            layout: analysis.layout,
          });
        } else {
          pages.push({
            page: pageNo,
            text: outcome.text,
            ocr: { used: true, skipped: false, confidence: outcome.confidence },
            readingOrder: outcome.text.split(/\r?\n/).map(cleanLine).filter(Boolean),
            // Metadata kolom dari service OCR (deteksi box): dua kolom dibaca
            // kiri penuh dulu, jadi urutan baris sudah benar sebelum chunking.
            layout: {
              columns: outcome.columns ?? 1,
              columnSplitX: outcome.columnSplitX ?? null,
              readingOrder: (outcome.columns ?? 1) === 2 ? 'column' : 'linear',
              repeatedLines: [],
              pageNumber: null,
              tables: 0,
            },
          });
        }
      } else {
        pages.push({
          page: pageNo,
          text,
          readingOrder: analysis.readingOrder,
          layout: analysis.layout,
        });
      }
    }
    // Halaman gagal OCR tidak menggagalkan dokumen: ditandai jujur di bawah.
    return pages;
  }

  if (format === 'docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return [{ page: 1, text: result.value }];
    } catch {
      throw unprocessable('DOCX tidak dapat dibaca (rusak)');
    }
  }

  if (format === 'txt' || format === 'md') {
    return [{ page: 1, text: buffer.toString('utf8') }];
  }

  throw unprocessable(`Format dokumen .${format} tidak didukung`);
}

type Draft = {
  no: number | null;
  title: string;
  page: number | null;
  lines: string[];
  ocr?: OcrMark;
  sectionId?: string;
  readingOrder?: string[];
  layout?: LayoutInfo | null;
};

function headingOf(line: string, markdown: boolean): GenericHeading | null {
  const md = markdown ? MD_HEADING.exec(line) : null;
  if (md) return { no: null, title: md[1].trim(), rest: '', kind: 'markdown' };
  return matchGenericHeading(line);
}

function lineSections(pages: ExtractedPage[], fallbackTitle: string, markdown: boolean): ExtractedSection[] {
  const drafts: Draft[] = [];
  let current: Draft | null = null;

  for (const page of pages) {
    for (const raw of page.text.split(/\r?\n/)) {
      const line = cleanLine(raw);
      if (!line) continue;
      const heading = headingOf(line, markdown);
      if (heading) {
        current = {
          no: heading.no ?? drafts.length + 1,
          title: heading.title,
          page: page.page,
          // Heading dan isi sering berada di baris yang sama (CUTI#1 Tujuan: ...).
          // Sisa setelah pemisah harus ikut ke bagian baru, bukan dibuang.
          lines: heading.rest ? [heading.rest] : [],
          ocr: page.ocr,
          sectionId: `${fallbackTitle}#${drafts.length + 1}`,
          readingOrder: page.readingOrder,
          layout: page.layout ?? null,
        };
        drafts.push(current);
        continue;
      }
      if (!current) {
        current = {
          no: null,
          title: fallbackTitle,
          page: page.page,
          lines: [],
          ocr: page.ocr,
          sectionId: `${fallbackTitle}#1`,
          readingOrder: page.readingOrder,
          layout: page.layout ?? null,
        };
        drafts.push(current);
      }
      current.lines.push(line);
    }
  }

  return drafts
    .map((d) => ({
      no: d.no,
      title: d.title,
      page: d.page,
      text: d.lines.join('\n').trim(),
      ocr: d.ocr,
      sectionId: d.sectionId,
      readingOrder: d.readingOrder,
      layout: d.layout,
    }))
    .filter((s) => s.text.length > 0 || s.no !== null);
}

function pageSections(pages: ExtractedPage[]): ExtractedSection[] {
  return pages
    .map((page) => {
      const lines = page.text.split(/\r?\n/).map(cleanLine).filter(Boolean);
      return {
        no: page.page,
        title: `Halaman ${page.page}`,
        page: page.page,
        text: lines.join('\n').trim(),
        ocr: page.ocr,
        sectionId: `halaman#${page.page}`,
        readingOrder: page.readingOrder,
        layout: page.layout ?? null,
      };
    })
    .filter((s) => s.text.length > 0);
}

export function sectionsFromPages(pages: ExtractedPage[], format: string, docTitle: string): ExtractedSection[] {
  const hasHeading = pages.some((p) =>
    p.text
      .split(/\r?\n/)
      .map(cleanLine)
      .some((line) => Boolean(headingOf(line, format === 'md'))),
  );
  if (hasHeading) {
    const sections = lineSections(pages, docTitle, format === 'md');
    if (sections.length) return sections;
  }
  const byPage = pageSections(pages);
  if (byPage.length) return byPage;
  const whole = pages.map((p) => p.text).join('\n').trim();
  return whole
    ? [{
        no: null,
        title: docTitle,
        page: pages[0]?.page ?? 1,
        text: whole,
        ocr: pages[0]?.ocr,
        sectionId: `${docTitle}#1`,
        readingOrder: pages.flatMap((p) => p.readingOrder ?? []),
        layout: pages[0]?.layout ?? null,
      }]
    : [];
}
