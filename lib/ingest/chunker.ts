import type { DocType } from '@/lib/core/contracts';
import type { DocumentChunk, EvidenceUnit, ExtractedSection, LayoutInfo, OcrMark } from '@/lib/ingest/types';
import { repairMojibake } from './mojibake';

export const CHUNK_TARGET = 900;
export const CHUNK_OVERLAP = 150;

/* ========================================================================== */
/* FASE 2A — struktur generik + unit bukti + offset                             */
/*                                                                             */
/* Tidak ada regex khusus KB0x / P1 / SEV. Semua aturan memakai pola umum       */
/* penomoran/Bab/Bagian/Markdown dan fallback bila struktur tidak konsisten.    */
/* ========================================================================== */

const ABBREVIATIONS = new Set([
  'mis', 'dst', 'dll', 'etc', 'no', 'nr', 'hal', 'pukul', 'jam', 'thn', 'bln', 'hr', 'sd',
]);

/**
 * Pola heading GENERIK — tidak ada hardcode KB0x / P1 / SEV.
 * `KODE#n` (CUTI#1), `KODE | judul` (TI#1 | ...), penomoran hierarkis
 * (2.1.1.), Pasal/Bab/Tabel, dan Markdown semuanya dikenali oleh aturan umum.
 */
const CODE_HASH_RE = /^([A-Z][A-Z0-9]{0,11}#\d{1,4})\s+(.+)$/;
const HIERARCHICAL_RE = /^((?:\d{1,3}\.){1,4}\d{0,3}\.?)\s+(.+)$/;
const NUMBERED_RE = /^(\d{1,3})[.)]\s+(.+)$/;
const LEGAL_RE = /^(Pasal|Ayat|Bab|Tabel|Bagian|Section|Part)\s+([IVXLC\d]+|[A-Z]|\d+[a-z]?)\s*[.:-]?\s*(.*)$/i;
const CAPITAL_TITLE_RE = /^[A-Z][A-Z0-9 ,\-/&()]{2,79}$/;
const HEADERISH_RE = /\b(DOKUMEN INTERNAL|HALAMAN|LAMPIRAN|CONFIDENTIAL|COPYRIGHT)\b/i;

export type GenericHeadingKind =
  | 'markdown' | 'code_hash' | 'hierarchical' | 'legal' | 'numbered' | 'capitalized';

export type GenericHeading = {
  no: number | null;
  title: string;
  /** Sisa baris setelah heading — dipakai sectioning inti sebagai isi bagian. */
  rest?: string;
  /** Kode/penomoran asli, mis. `CUTI#1` atau `2.1.1.`. */
  code?: string;
  kind?: GenericHeadingKind;
};

/** Pisahkan judul dari isi pada pemisah `|` (tabel) atau `:` (prosa). */
function splitTitleRest(value: string): { title: string; rest: string } {
  const s = String(value ?? '').trim();
  if (!s) return { title: '', rest: '' };
  const pipe = s.indexOf('|');
  const colon = s.indexOf(':');
  const at = pipe >= 0 && colon >= 0 ? Math.min(pipe, colon) : pipe >= 0 ? pipe : colon;
  if (at < 0) return { title: s, rest: '' };
  const title = s.slice(0, at).trim();
  const rest = s.slice(at + 1).trim();
  return title ? { title, rest } : { title: s, rest: '' };
}

/** Deteksi heading generik. Mengembalikan null untuk baris biasa. */
export function matchGenericHeading(line: string): GenericHeading | null {
  const clean = String(line ?? '').trim();
  if (!clean || clean.length > 160) return null;

  const md = /^#{1,6}\s+(.+)$/.exec(clean);
  if (md) {
    const { title, rest } = splitTitleRest(md[1]);
    if (title) return { no: null, title, rest, kind: 'markdown' };
  }

  const code = CODE_HASH_RE.exec(clean);
  if (code) {
    const { title, rest } = splitTitleRest(code[2]);
    if (title) {
      return {
        no: Number(code[1].slice(code[1].indexOf('#') + 1)),
        title: `${code[1]} ${title}`.trim(),
        rest,
        code: code[1],
        kind: 'code_hash',
      };
    }
  }

  const hier = HIERARCHICAL_RE.exec(clean);
  if (hier) {
    const { title, rest } = splitTitleRest(hier[2]);
    if (title) {
      const parts = hier[1].replace(/\.$/, '').split('.').map(Number).filter(Number.isFinite);
      return {
        no: parts.length ? parts[parts.length - 1] : null,
        title: `${hier[1]} ${title}`.trim(),
        rest,
        code: hier[1],
        kind: 'hierarchical',
      };
    }
  }

  const legal = LEGAL_RE.exec(clean);
  if (legal) {
    const { title, rest } = splitTitleRest(legal[3] || '');
    const label = `${legal[1]} ${legal[2]}`.trim();
    return {
      no: /^\d+$/.test(legal[2]) ? Number(legal[2]) : null,
      title: title ? `${label} ${title}`.trim() : label,
      rest,
      code: label,
      kind: 'legal',
    };
  }

  const numbered = NUMBERED_RE.exec(clean);
  if (numbered) {
    const { title, rest } = splitTitleRest(numbered[2]);
    if (title) {
      return {
        no: Number(numbered[1]),
        title: `${numbered[1]}. ${title}`.trim(),
        rest,
        code: `${numbered[1]}.`,
        kind: 'numbered',
      };
    }
  }

  return null;
}

export type GenericSection = {
  sectionId: string;
  no: number | null;
  title: string;
  text: string;
  charStart: number;
  charEnd: number;
};

type Line = { text: string; start: number; raw: string };

/**
 * Fallback bila struktur tidak konsisten: kelompokkan paragraf berdasarkan
 * jeda (baris kosong) DAN perubahan indentasi. Tidak pernah menggabungkan
 * dua kelompok menjadi satu bagian.
 */
function groupParagraphs(
  src: string,
  lines: Line[],
  docId: string,
  first: { no: number | null; title: string } | null,
): GenericSection[] {
  const blocks: Array<{ start: number; end: number; text: string }> = [];
  let current: { startLine: number; lines: string[]; indent: boolean } | null = null;
  const flush = (end: number) => {
    if (!current) return;
    const text = current.lines.join('\n').trim();
    if (text) blocks.push({ start: lines[current.startLine].start, end, text });
    current = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.text) {
      flush(line.start);
      continue;
    }
    const indent = /^\s/.test(line.raw);
    if (!current) {
      current = { startLine: i, lines: [line.text], indent };
      continue;
    }
    if (indent !== current.indent) {
      flush(line.start);
      current = { startLine: i, lines: [line.text], indent };
    } else {
      current.lines.push(line.text);
    }
  }
  flush(src.length);
  if (!blocks.length) {
    return [{
      sectionId: `${docId}#1`,
      no: first?.no ?? null,
      title: first?.title || 'Dokumen',
      text: src.trim(),
      charStart: 0,
      charEnd: src.length,
    }];
  }
  return blocks.map((block, i) => ({
    sectionId: `${docId}#${i + 1}`,
    no: first && i === 0 ? first.no ?? 1 : i + 1,
    title: first && i === 0
      ? first.title
      : (block.text.split('\n')[0] ?? `Bagian ${i + 1}`).slice(0, 80),
    text: block.text,
    charStart: block.start,
    charEnd: block.end,
  }));
}

/**
 * Struktur generik → bagian dengan ID stabil dan offset karakter.
 * Heading kapital diterima hanya bila tidak berulang (bukan header/footer)
 * dan diikuti baris isi — konteks tetangga mencegah sampah dijadikan judul.
 */
export function detectGenericSections(text: string, docId = 'doc'): GenericSection[] {
  const src = String(text ?? '');
  const lines: Line[] = [];
  let cursor = 0;
  for (const raw of src.split('\n')) {
    lines.push({ text: raw.trim(), start: cursor, raw });
    cursor += raw.length + 1;
  }

  const freq = new Map<string, number>();
  for (const line of lines) {
    if (!line.text) continue;
    const key = line.text.toLowerCase();
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  const heads: Array<{ index: number; no: number | null; title: string; rest: string }> = [];
  lines.forEach((line, index) => {
    if (!line.text) return;
    const hit = matchGenericHeading(line.text);
    if (hit) {
      heads.push({ index, no: hit.no, title: hit.title, rest: hit.rest ?? '' });
      return;
    }
    if (CAPITAL_TITLE_RE.test(line.text) && !HEADERISH_RE.test(line.text)
      && (freq.get(line.text.toLowerCase()) ?? 0) < 2) {
      const next = lines[index + 1]?.text ?? '';
      if (next && !CAPITAL_TITLE_RE.test(next)) {
        heads.push({ index, no: null, title: line.text, rest: '' });
      }
    }
  });

  if (heads.length < 2) {
    return groupParagraphs(src, lines, docId, heads[0] ?? null);
  }
  return heads.map((head, i) => {
    const from = lines[head.index].start;
    const to = i + 1 < heads.length ? lines[heads[i + 1].index].start : src.length;
    const body = head.rest ? `${head.rest}\n${src.slice(from, to).trim()}` : src.slice(from, to).trim();
    return {
      sectionId: `${docId}#${i + 1}`,
      no: head.no ?? i + 1,
      title: head.title,
      text: body.trim(),
      charStart: from,
      charEnd: to,
    };
  });
}

function isAbbreviationDot(src: string, dotIndex: number): boolean {
  const before = src.slice(Math.max(0, dotIndex - 16), dotIndex);
  const match = before.match(/([A-Za-z]+)$/);
  if (!match) return false;
  const word = match[1];
  if (ABBREVIATIONS.has(word.toLowerCase())) return true;
  return word.length === 1 && /[A-Z]/.test(word); // inisial, mis. "A."
}

/** Titik penomoran (`1.`, `2.1.1.`) bukan akhir kalimat. */
function isListNumberDot(src: string, dotIndex: number): boolean {
  const before = src.slice(Math.max(0, dotIndex - 12), dotIndex);
  return /(?:^|[\s;])\d{1,3}(?:\.\d{1,3})*$/.test(before);
}

/**
 * Pecah teks chunk menjadi kalimat DAN butir daftar dengan offset karakter
 * relatif terhadap teks chunk tersebut. Sadar Bahasa Indonesia:
 *  - singkatan `mis.`, `dst.`, `dll.` tidak memotong kalimat;
 *  - jam `09.00-17.00` / desimal tidak memotong;
 *  - penomoran `1.` dan label `P1:` memulai butir baru;
 *  - `;` memisahkan butir daftar.
 */
export function segmentEvidenceUnits(text: string, sectionId: string): EvidenceUnit[] {
  const src = String(text ?? '');
  if (!src.trim()) return [];
  const cuts: Array<{ at: number; kind: 'sentence' | 'list_item' }> = [];
  const addCut = (at: number, kind: 'sentence' | 'list_item') => {
    if (at > 0 && at < src.length) cuts.push({ at, kind });
  };

  for (let i = 0; i < src.length - 1; i += 1) {
    if (src[i] !== '.') continue;
    const prev = src[i - 1] ?? '';
    const next = src[i + 1] ?? '';
    if (/\d/.test(prev) && /\d/.test(next)) continue; // 09.00 / 1.5
    if (next === '.') continue; // elipsis
    if (isListNumberDot(src, i)) continue; // 1. / 2.1.1.
    if (isAbbreviationDot(src, i)) continue; // mis. dst. A.
    if (/\s/.test(next)) addCut(i + 1, 'sentence');
  }
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === ';') addCut(i + 1, 'list_item');
    else if (src[i] === '\n') addCut(i + 1, 'sentence');
  }
  const labelRe = /(?:^|[;\n]\s*)([A-Z]{1,3}\d{0,2})\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = labelRe.exec(src))) {
    addCut(match.index + match[0].lastIndexOf(match[1]), 'list_item');
  }

  cuts.sort((a, b) => a.at - b.at || (a.kind === 'list_item' ? -1 : 1));
  const merged: Array<{ at: number; kind: 'sentence' | 'list_item' }> = [];
  for (const cut of cuts) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.at - cut.at) <= 1) {
      if (cut.kind === 'list_item') last.kind = 'list_item';
      continue;
    }
    merged.push({ ...cut });
  }

  const units: EvidenceUnit[] = [];
  let start = 0;
  let seq = 0;
  let pendingKind: 'sentence' | 'list_item' = 'sentence';
  const emit = (end: number) => {
    const raw = src.slice(start, end);
    const trimmed = raw.trim();
    if (trimmed) {
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;
      const s = start + lead;
      const e = end - trail;
      if (e > s) {
        seq += 1;
        const isLabel = /^[A-Z]{1,3}\d{0,2}\s*:/.test(trimmed);
        const kind = pendingKind === 'list_item' || isLabel ? 'list_item' : 'sentence';
        units.push({
          id: `${sectionId}.${kind === 'list_item' ? 'b' : 's'}${seq}`,
          kind,
          text: src.slice(s, e),
          charStart: s,
          charEnd: e,
        });
      }
    }
    start = end;
  };
  for (const cut of merged) {
    emit(cut.at);
    pendingKind = cut.kind;
  }
  emit(src.length);
  return units;
}

function hardSplit(text: string, target: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > target) {
    const window = rest.slice(0, target + 1);
    const boundaries = [...window.matchAll(/[.!?;]\s+/g)];
    const last = boundaries[boundaries.length - 1];
    let cut = last ? (last.index ?? 0) + last[0].length : -1;
    if (cut < target * 0.5) cut = rest.lastIndexOf(' ', target);
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
  // Overlap selalu dimulai di batas kalimat, bukan di tengah kalimat.
  const boundaries = [...tail.matchAll(/[.!?;]\s+/g)];
  const last = boundaries[boundaries.length - 1];
  if (last) {
    const at = (last.index ?? 0) + last[0].length;
    if (at < tail.length) return tail.slice(at);
  }
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
      const window = current.slice(0, target + 1);
      const boundaries = [...window.matchAll(/[.!?;]\s+/g)];
      const last = boundaries[boundaries.length - 1];
      let at = last ? (last.index ?? 0) + last[0].length : -1;
      if (at < target * 0.5) {
        const cut = current.lastIndexOf(' ', target);
        at = cut > target * 0.5 ? cut : target;
      }
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
  options: { target?: number; overlap?: number; documentId?: string } = {},
): DocumentChunk[] {
  const target = options.target ?? CHUNK_TARGET;
  const overlap = options.overlap ?? CHUNK_OVERLAP;
  const documentId = options.documentId ?? 'doc';
  const out: DocumentChunk[] = [];
  let index = 0;

  const push = (section: ExtractedSection, content: string, sourceSectionIndex: number) => {
    const text = content.trim();
    if (!text) return;
    const sectionId = section.sectionId ?? `${documentId}#${sourceSectionIndex + 1}`;
    const units = segmentEvidenceUnits(text, sectionId);
    const charStart = units.length ? units[0].charStart : 0;
    const charEnd = units.length ? units[units.length - 1].charEnd : text.length;
    out.push({
      sectionNo: section.no ?? null,
      section: section.title || null,
      page: section.page ?? null,
      chunkIndex: index,
      content: text,
      charCount: text.length,
      ocrSkipped: section.ocr?.skipped === true,
      confidence: section.ocr?.confidence ?? 1,
      sourceSectionIndex,
      sectionId,
      sectionHash: stableHash(section.text ?? text),
      units,
      charStart,
      charEnd,
      readingOrder: section.readingOrder ?? null,
      layout: section.layout ?? null,
    });
    index += 1;
  };

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    const text = (section.text ?? '').trim();
    if (!text) continue;
    if (text.length <= target) {
      push(section, text, sectionIndex);
      continue;
    }
    for (const chunk of packUnits(splitUnits(text), target, overlap)) {
      push(section, chunk, sectionIndex);
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
  /** Ayat/butir eksplisit dari ekstraktor; menggantikan heuristik pemecahan. */
  children?: LegalChildInput[];
}

export interface LegalChildInput {
  id: string;
  type: 'ayat' | 'butir';
  text: string;
  page: number;
  ayat: number | null;
  butir: string | null;
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

export function stableHash(text: string): string {
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
    // OCR text-layer Perpres membaca "1." sebagai "l." (huruf el). Tanpa
    // normalisasi ini butir pertama jadi bagian "pengantar" dan tidak dihitung
    // sebagai butir — itulah sebabnya butir_count 33/34.
    const m = line.match(/^([1-9]\d*|l)\.\s+(.*)$/);
    if (m) {
      if (intro.length) {
        const text = intro.join(' ').trim();
        if (text) pieces.push({ label: 'pengantar', text, page: pageForText(text, input.segments ?? [], input.pageStart) });
        intro = [];
      }
      const label = m[1] === 'l' ? '1' : m[1];
      const text = m[1] === 'l' ? line.replace(/^l\./, '1.') : line;
      pieces.push({ label, text, page: pageForText(text, input.segments ?? [], input.pageStart) });
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
    const raw = String(c.text ?? '').trim();
    if (!raw) return;
    const cleaned = repairMojibake(raw);
    const text = cleaned.text.trim();
    if (!text) return;
    const hash = stableHash(text);
    if (seen.has(hash)) return; // dedup deterministik: hash normalisasi identik → skip
    seen.add(hash);
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

    if (input.children?.length) {
      for (const child of input.children) {
        push({
          id: child.id,
          chunk_type: child.type,
          text: child.text,
          page_start: child.page,
          page_end: child.page,
          parent_id: parentId,
          pasal: no,
          ayat: child.ayat,
          butir: child.butir,
        });
      }
      continue;
    }
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

/* ========================================================================== */
/* ADR-OF-13 — SATU entry point chunker, dipilih lewat doc_type                  */
/*                                                                             */
/* Eval dan produksi WAJIB memanggil `chunkDocument`. Tidak boleh ada jalur     */
/* khusus eval yang memanggil `chunkLegalDocument` langsung.                    */
/* ========================================================================== */

/**
 * Bentuk seksi minimal yang diterima entry point. `ExtractedSection` (ingest
 * legacy) maupun `ParsedSection` (core ingest) memenuhi struktur ini.
 */
export type ChunkableSection = {
  text: string;
  page?: number | null;
  no?: number | null;
  title?: string | null;
  section_path?: string;
  ocr?: OcrMark;
  ocrStatus?: string;
  ocrConfidence?: number;
  unreadable?: boolean;
  pageSpan?: [number, number] | null;
  cleanFlags?: string[];
  sectionId?: string;
  sectionHash?: string;
  readingOrder?: string[] | null;
  layout?: LayoutInfo | null;
};

export type ChunkDocumentInput = {
  sections?: ChunkableSection[];
  docType?: DocType | null;
  /** Id dokumen untuk legal chunk id yang stabil. */
  documentId?: string;
  /**
   * Input legal kaya dari ekstraktor (heading, segments, kind). Bila diisi,
   * dipakai apa adanya — dipakai eval Perpres agar sinyal halaman tidak hilang.
   * Jalur ini TETAP masuk lewat chunkDocument, bukan jalur eval terpisah.
   */
  legalInputs?: LegalChunkInput[];
  target?: number;
  overlap?: number;
};

/** Keluaran seragam: field legal null untuk dokumen non-legal. */
export type ChunkDocumentResult = DocumentChunk & {
  chunk_type: LegalChunkType | null;
  page_start: number | null;
  page_end: number | null;
  parent_id: string | null;
  pasal: number | null;
  ayat: number | null;
  butir: string | null;
  content_hash: string | null;
  clean_flags: string[];
  legal_id: string | null;
  ocrStatus?: string;
  ocrConfidence?: number;
  pageSpan?: [number, number] | null;
  sectionId?: string | null;
  sectionHash?: string | null;
  units?: EvidenceUnit[];
  charStart?: number | null;
  charEnd?: number | null;
  readingOrder?: string[] | null;
  layout?: LayoutInfo | null;
  embedText?: string | null;
};

function sectionsToLegalInputs(sections: ChunkableSection[], documentId?: string): LegalChunkInput[] {
  return sections.map((section, index) => {
    const heading = section.title ?? section.section_path ?? null;
    const pasal = heading?.match(/pasal\s*(\d+[a-z]?)/i);
    const id = pasal ? `pasal-${pasal[1]}` : `${documentId ?? 'doc'}-s${index}`;
    const page = section.page ?? 1;
    return {
      id,
      text: section.text,
      pageStart: page,
      pageEnd: section.pageSpan?.[1] ?? page,
      heading,
      kind: 'text',
      segments: [{ page, text: section.text }],
    };
  });
}

function legalSectionPath(chunk: LegalChunk): string {
  const parts: string[] = [];
  if (chunk.pasal != null) parts.push(`Pasal ${chunk.pasal}`);
  if (chunk.ayat != null) parts.push(`Ayat (${chunk.ayat})`);
  if (chunk.butir) parts.push(`butir ${chunk.butir}`);
  if (!parts.length) parts.push(chunk.chunk_type);
  return parts.join(' > ');
}

/**
 * Entry point tunggal untuk chunking (ADR-OF-13).
 * `doc_type === 'legal'` → `chunkLegalDocument`; selainnya → `chunkSections`.
 * Kosong/`unknown` → `general`. Deterministik, tanpa model.
 */
export function chunkDocument(input: ChunkDocumentInput): ChunkDocumentResult[] {
  const docType = input.docType ?? 'general';
  const sections = input.sections ?? [];
  const documentId = input.documentId ?? 'doc';

  let result: ChunkDocumentResult[];
  if (docType === 'legal') {
    const legalInputs = input.legalInputs ?? sectionsToLegalInputs(sections, documentId);
    result = chunkLegalDocument(legalInputs).map((chunk, index) => ({
      sectionNo: chunk.pasal ?? null,
      section: legalSectionPath(chunk),
      page: chunk.page_start ?? null,
      chunkIndex: index,
      content: chunk.text,
      charCount: chunk.text.length,
      ocrSkipped: false,
      confidence: 1,
      sourceSectionIndex: null,
      chunk_type: chunk.chunk_type,
      page_start: chunk.page_start,
      page_end: chunk.page_end,
      parent_id: chunk.parent_id,
      pasal: chunk.pasal,
      ayat: chunk.ayat,
      butir: chunk.butir,
      content_hash: chunk.content_hash,
      clean_flags: chunk.clean_flags,
      legal_id: chunk.id,
      pageSpan: [chunk.page_start, chunk.page_end],
    }));
  } else {
    const extracted: ExtractedSection[] = sections.map((section, index) => ({
      no: section.no ?? null,
      title: section.title ?? section.section_path ?? '',
      page: section.page ?? null,
      text: section.text,
      ocr: section.ocr,
      sectionId: section.sectionId ?? `${documentId}#${index + 1}`,
      readingOrder: section.readingOrder,
      layout: section.layout,
    }));
    result = chunkSections(extracted, {
      target: input.target,
      overlap: input.overlap,
      documentId,
    }).map((chunk) => {
      const source = chunk.sourceSectionIndex != null ? sections[chunk.sourceSectionIndex] : undefined;
      return {
        ...chunk,
        chunk_type: null,
        page_start: chunk.page ?? null,
        page_end: chunk.page ?? null,
        parent_id: null,
        pasal: null,
        ayat: null,
        butir: null,
        content_hash: null,
        clean_flags: [],
        legal_id: null,
        ocrStatus: source?.ocrStatus,
        ocrConfidence: source?.ocrConfidence,
        pageSpan: source?.pageSpan ?? null,
        sectionHash: source?.sectionHash ?? chunk.sectionHash,
        readingOrder: source?.readingOrder ?? chunk.readingOrder,
        layout: source?.layout ?? chunk.layout,
      };
    });
  }

  // Unit bukti + offset untuk SEMUA jalur (legal termasuk). Bila jalur sudah
  // mengisi (chunkSections), biarkan — hanya menambah yang masih kosong.
  return result.map((chunk) => {
    const sectionId = chunk.sectionId ?? chunk.legal_id ?? `${documentId}#${chunk.chunkIndex + 1}`;
    const units = chunk.units?.length ? chunk.units : segmentEvidenceUnits(chunk.content, sectionId);
    return {
      ...chunk,
      sectionId,
      sectionHash: chunk.sectionHash ?? stableHash(chunk.content),
      units,
      charStart: chunk.charStart ?? (units.length ? units[0].charStart : 0),
      charEnd: chunk.charEnd ?? (units.length ? units[units.length - 1].charEnd : chunk.content.length),
    };
  });
}
