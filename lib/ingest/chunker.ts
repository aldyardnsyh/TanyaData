import type { DocumentChunk, ExtractedSection } from '@/lib/ingest/types';
import { repairMojibake } from './mojibake';

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

/* ========================================================================== */
/* P3-TUNING — structure-aware chunker untuk dokumen hukum Indonesia           */
/*                                                                             */
/* Fungsi lama `chunkSections` sengaja DIPERTAHANKAN (flat, satu level).        */
/* Bagian ini menambah jalur baru yang menghasilkan chunk_type, page_span,      */
/* parent_id, dedup hash, dan flag mojibake — sesuai struktur ground truth      */
/* Perpres 76/2013. Semua aturan deterministik, tanpa model dan tanpa jaringan. */
/* ========================================================================== */

export type LegalChunkType =
  | 'pembukaan' | 'pasal' | 'butir' | 'ayat' | 'penutup' | 'visual' | 'unknown';

/** Satu blok teks per halaman — bentuk keluaran text-layer PDF pada umumnya. */
export interface LegalPageSegment {
  page: number;
  text: string;
}

export interface LegalChunkInput {
  /** Id stabil dari ekstraktor (berasal dari heading yang terdeteksi). */
  id: string;
  text: string;
  pageStart: number;
  pageEnd: number;
  /** Heading terdeteksi, mis. "Pasal 1". Dipakai sebelum id sebagai sinyal. */
  heading?: string | null;
  /** Blok teks per halaman; dipakai untuk page_span child. */
  segments?: LegalPageSegment[];
  /** Elemen visual tidak punya teks; ditandai eksplisit oleh ekstraktor. */
  kind?: 'text' | 'visual';
}

export interface LegalChunk {
  id: string;
  chunk_type: LegalChunkType;
  text: string;
  page_start: number;
  page_end: number;
  parent_id: string | null;
  pasal: number | null;
  ayat: number | null;
  butir: string | null;
  content_hash: string;
  clean_flags: string[];
}

function stableHash(text: string): string {
  const s = String(text ?? '').toLowerCase().normalize('NFKD').replace(/\s+/g, ' ').trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function legalPasalNo(input: LegalChunkInput): number | null {
  const fromHeading = input.heading?.match(/pasal\s*(\d+)/i);
  if (fromHeading) return Number(fromHeading[1]);
  const fromId = input.id.match(/^pasal-(\d+)$/i);
  return fromId ? Number(fromId[1]) : null;
}

function detectLegalType(input: LegalChunkInput): LegalChunkType {
  if (input.kind === 'visual') return 'visual';
  const text = String(input.text ?? '').trim();
  // Harus spesifik: "Peraturan Presiden ini mulai berlaku..." (Pasal 21)
  // bukan pembukaan. Case-sensitive pada heading resmi berhuruf kapital.
  if (/^PERATURAN PRESIDEN REPUBLIK INDONESIA\b/.test(text) || /pembukaan/i.test(input.id)) return 'pembukaan';
  if (/^Agar setiap orang mengetahui\b/i.test(text) || /penutup/i.test(input.id)) return 'penutup';
  if (legalPasalNo(input) !== null) return 'pasal';
  return 'unknown';
}

type LegalPiece = { label: string; text: string; page: number | null };

function pageForText(text: string, segments: LegalPageSegment[], fallback: number): number {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const needle = norm(text).slice(0, 60);
  for (const seg of segments ?? []) {
    if (norm(seg.text).includes(needle)) return seg.page;
  }
  return fallback;
}

/**
 * Butir = daftar bernomor ("1. ...", "2. ...") di dalam satu pasal. Teks
 * sebelum butir pertama menjadi butir "pengantar" bila tidak kosong.
 */
function splitButir(input: LegalChunkInput): LegalPiece[] {
  const pieces: LegalPiece[] = [];
  let intro: string[] = [];
  for (const raw of String(input.text ?? '').split('\n')) {
    const line = raw.trim();
    const m = line.match(/^(\d+)\.\s+(.*)$/);
    if (m) {
      if (intro.length) {
        const text = intro.join(' ').trim();
        if (text) pieces.push({ label: 'pengantar', text, page: pageForText(text, input.segments ?? [], input.pageStart) });
        intro = [];
      }
      pieces.push({ label: m[1], text: line, page: pageForText(line, input.segments ?? [], input.pageStart) });
    } else if (pieces.length === 0) {
      if (line) intro.push(line);
    } else if (line) {
      const prev = pieces[pieces.length - 1];
      prev.text = `${prev.text} ${line}`.trim();
    }
  }
  if (intro.length) {
    const text = intro.join(' ').trim();
    if (text) pieces.push({ label: 'pengantar', text, page: pageForText(text, input.segments ?? [], input.pageStart) });
  }
  return pieces;
}

/** Ayat = penanda "(1)", "(2)", ... di dalam satu pasal. */
function splitAyat(input: LegalChunkInput): LegalPiece[] {
  const pieces: LegalPiece[] = [];
  for (const raw of String(input.text ?? '').split('\n')) {
    const line = raw.trim();
    const m = line.match(/^\((\d+)\)\s+(.*)$/);
    if (m) {
      pieces.push({ label: m[1], text: line, page: pageForText(line, input.segments ?? [], input.pageStart) });
    } else if (pieces.length && line) {
      const prev = pieces[pieces.length - 1];
      prev.text = `${prev.text} ${line}`.trim();
    }
  }
  return pieces;
}

/**
 * Aturan pemecahan child (small-to-find):
 *  - daftar butir ≥ 2 → butir child (ini yang dipakai Pasal 1);
 *  - atau pasal panjang (≥ 1000 char) dengan ≥ 4 ayat → ayat child (Pasal 8).
 * Pasal pendek tetap satu chunk — memecah semua ayat justru menurunkan
 * presisi retrieval dan bertentangan dengan ground truth referensi.
 */
export function chunkLegalDocument(inputs: LegalChunkInput[]): LegalChunk[] {
  const out: LegalChunk[] = [];
  const seen = new Set<string>();

  const push = (c: Omit<LegalChunk, 'content_hash' | 'clean_flags'>) => {
    const text = String(c.text ?? '').trim();
    if (!text) return;
    const hash = stableHash(text);
    if (seen.has(hash)) return; // dedup deterministik: hash normalisasi identik → skip
    seen.add(hash);
    const cleaned = repairMojibake(text);
    out.push({ ...c, text, content_hash: hash, clean_flags: cleaned.flags });
  };

  for (const input of inputs ?? []) {
    const type = detectLegalType(input);
    const no = legalPasalNo(input);
    const parentId = input.id;

    push({
      id: parentId,
      chunk_type: type,
      text: input.text,
      page_start: input.pageStart,
      page_end: input.pageEnd,
      parent_id: null,
      pasal: no,
      ayat: null,
      butir: null,
    });

    if (type !== 'pasal') continue;
    const text = String(input.text ?? '');
    const butir = splitButir(input);
    const ayatCount = (text.match(/^\s*\(\d+\)\s/gm) ?? []).length;

    if (butir.length >= 2) {
      for (const p of butir) {
        push({
          id: `${parentId}-b-${p.label}`,
          chunk_type: 'butir',
          text: p.text,
          page_start: p.page ?? input.pageStart,
          page_end: p.page ?? input.pageEnd,
          parent_id: parentId,
          pasal: no,
          ayat: null,
          butir: p.label,
        });
      }
    } else if (ayatCount >= 4 && text.length >= 1000) {
      for (const p of splitAyat(input)) {
        push({
          id: `${parentId}-a${p.label}`,
          chunk_type: 'ayat',
          text: p.text,
          page_start: p.page ?? input.pageStart,
          page_end: p.page ?? input.pageEnd,
          parent_id: parentId,
          pasal: no,
          ayat: Number(p.label),
          butir: null,
        });
      }
    }
  }

  return out;
}
