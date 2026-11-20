import mammoth from 'mammoth';
import { getDocumentProxy } from 'unpdf';
import { unprocessable } from '@/lib/errors';
import type { ExtractedPage, ExtractedSection, OcrMark } from '@/lib/ingest/types';
import { LOW_TEXT_THRESHOLD, UNREADABLE_PAGE_TEXT, ocrPage, type OcrOutcome } from '@/lib/ingest/ocr';

const PAGE_ARTIFACT = /dokumen dummy untuk technical test ai engineer halaman \d+/i;
const NUMBERED_HEADING = /^(\d{1,2})[.)]\s+([A-Z0-9][^.]{1,79})$/;
const MD_HEADING = /^#{1,6}\s+(.{1,120})$/;

function cleanLine(line: string): string {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  if (PAGE_ARTIFACT.test(trimmed)) {
    const rest = trimmed.replace(PAGE_ARTIFACT, '').trim();
    return rest.length > 3 ? rest : '';
  }
  return trimmed;
}

export async function extractPages(format: string, buffer: Buffer): Promise<ExtractedPage[]> {
  if (format === 'pdf') {
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(new Uint8Array(buffer));
    } catch {
      throw unprocessable('PDF tidak dapat dibaca (rusak atau terenkripsi)');
    }
    const pages: ExtractedPage[] = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const raw of content.items) {
        const item = raw as unknown as { str?: unknown; hasEOL?: boolean };
        if (typeof item.str !== 'string') continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      // Text layer dipakai lebih dulu. OCR hanya untuk halaman kosong/rendah,
      // satu halaman per proses, berurutan (konkuren = 1), timeout 5s di ocrPage.
      if (text.trim().length < LOW_TEXT_THRESHOLD) {
        const outcome: OcrOutcome = await ocrPage({ page: i, docId: `src_${i}`, pdf });
        if (outcome.skipped) {
          pages.push({
            page: i,
            text: UNREADABLE_PAGE_TEXT,
            ocr: { used: outcome.used, skipped: true, confidence: 0, reason: outcome.reason },
          });
        } else {
          pages.push({
            page: i,
            text: outcome.text,
            ocr: { used: true, skipped: false, confidence: outcome.confidence },
          });
        }
      } else {
        pages.push({ page: i, text });
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

type Draft = { no: number | null; title: string; page: number | null; lines: string[]; ocr?: OcrMark };

function lineSections(pages: ExtractedPage[], fallbackTitle: string, markdown: boolean): ExtractedSection[] {
  const drafts: Draft[] = [];
  let current: Draft | null = null;

  for (const page of pages) {
    for (const raw of page.text.split(/\r?\n/)) {
      const line = cleanLine(raw);
      if (!line) continue;
      const md = markdown ? MD_HEADING.exec(line) : null;
      const numbered = NUMBERED_HEADING.exec(line);
      if (md || numbered) {
        const title = (md ? md[1] : numbered?.[2] ?? '').trim();
        current = {
          no: numbered ? Number(numbered[1]) : drafts.length + 1,
          title,
          page: page.page,
          lines: [],
          ocr: page.ocr,
        };
        drafts.push(current);
        continue;
      }
      if (!current) {
        current = { no: null, title: fallbackTitle, page: page.page, lines: [], ocr: page.ocr };
        drafts.push(current);
      }
      current.lines.push(line);
    }
  }

  return drafts
    .map((d) => ({ no: d.no, title: d.title, page: d.page, text: d.lines.join('\n').trim(), ocr: d.ocr }))
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
      };
    })
    .filter((s) => s.text.length > 0);
}

export function sectionsFromPages(pages: ExtractedPage[], format: string, docTitle: string): ExtractedSection[] {
  const hasHeading = pages.some((p) =>
    p.text
      .split(/\r?\n/)
      .map(cleanLine)
      .some((line) => NUMBERED_HEADING.test(line) || (format === 'md' && MD_HEADING.test(line))),
  );
  if (hasHeading) {
    const sections = lineSections(pages, docTitle, format === 'md');
    if (sections.length) return sections;
  }
  const byPage = pageSections(pages);
  if (byPage.length) return byPage;
  const whole = pages.map((p) => p.text).join('\n').trim();
  return whole
    ? [{ no: null, title: docTitle, page: pages[0]?.page ?? 1, text: whole, ocr: pages[0]?.ocr }]
    : [];
}
