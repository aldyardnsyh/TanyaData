import type { DocumentChunk, ExtractedSection } from '@/lib/ingest/types';

export const CHUNK_TARGET = 900;
export const CHUNK_OVERLAP = 150;

function hardSplit(text: string, target: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > target) {
    let cut = rest.lastIndexOf(' ', target);
    if (cut < target * 0.5) cut = target;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitUnits(text: string): string[] {
  const units: string[] = [];
  for (const para of text.split(/\n\s*\n+/)) {
    const clean = para.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    if (clean.length <= CHUNK_TARGET) {
      units.push(clean);
      continue;
    }
    for (const sentence of splitSentences(clean)) {
      if (sentence.length <= CHUNK_TARGET) {
        units.push(sentence);
      } else {
        units.push(...hardSplit(sentence, CHUNK_TARGET));
      }
    }
  }
  return units;
}

function overlapTail(text: string, overlap: number): string {
  if (text.length <= overlap) return text;
  const tail = text.slice(text.length - overlap);
  const at = tail.indexOf(' ');
  return at >= 0 ? tail.slice(at + 1) : tail;
}

function packUnits(units: string[], target: number, overlap: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }
    if (current.length + 1 + unit.length <= target) {
      current = `${current} ${unit}`;
      continue;
    }
    chunks.push(current.trim());
    const tail = overlapTail(current, overlap);
    current = tail ? `${tail} ${unit}` : unit;
    while (current.length > target) {
      const cut = current.lastIndexOf(' ', target);
      const at = cut > target * 0.5 ? cut : target;
      chunks.push(current.slice(0, at).trim());
      current = current.slice(at).trim();
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}

/** Chunk per seksi; tidak pernah melintasi batas seksi (ARCHITECTURE §7.2). */
export function chunkSections(
  sections: ExtractedSection[],
  options: { target?: number; overlap?: number } = {},
): DocumentChunk[] {
  const target = options.target ?? CHUNK_TARGET;
  const overlap = options.overlap ?? CHUNK_OVERLAP;
  const out: DocumentChunk[] = [];
  let index = 0;

  const push = (section: ExtractedSection, content: string) => {
    const text = content.trim();
    if (!text) return;
    out.push({
      sectionNo: section.no ?? null,
      section: section.title || null,
      page: section.page ?? null,
      chunkIndex: index,
      content: text,
      charCount: text.length,
      ocrSkipped: section.ocr?.skipped === true,
      confidence: section.ocr?.confidence ?? 1,
    });
    index += 1;
  };

  for (const section of sections) {
    const text = (section.text ?? '').trim();
    if (!text) continue;
    if (text.length <= target) {
      push(section, text);
      continue;
    }
    for (const chunk of packUnits(splitUnits(text), target, overlap)) {
      push(section, chunk);
    }
  }

  return out;
}
