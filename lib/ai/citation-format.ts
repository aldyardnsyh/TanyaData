/**
 * FASE 2H — structured inline-citation contract, verifier and renderer.
 *
 * Domain-neutral by construction: no document id, priority code, severity
 * label or section name appears in this file. Every label is derived from the
 * retrieved evidence at runtime.
 *
 * Pipeline position:
 *   retrieval chunk → evidence-unit selection → ID-bound claim generation
 *   → verification (this file) → render (this file) → UI inline markers.
 *
 * The renderer emits `[n]` markers immediately after each verified segment.
 * The trailing reference list is a *derived footer* only; it is never the
 * citation mechanism (end_dump_rate must stay 0).
 */

import type { Citation as CoreCitation } from '@/lib/core/contracts';

/* ------------------------------------------------------------------ contract */

export type SegmentKind =
  | 'framing'
  | 'claim'
  | 'inference'
  | 'caveat'
  | 'absence'
  | 'clarification';

export interface StructuredSegment {
  text: string;
  kind: SegmentKind;
  /** Citation ids (c1, c2, …) this segment is bound to. Empty only for
   * framing / clarification. */
  cite: string[];
}

export interface StructuredCitation {
  doc: string;
  page: number | null;
  section_id: string;
  section_title: string;
  /** Evidence-unit ids inside the cited chunk, e.g. `<section>.s1`. */
  unit_ids: string[];
  /** Character offsets into the cited chunk text (whitespace-normalised). */
  char_start: number;
  char_end: number;
  /** MUST be an exact substring of the cited chunk (whitespace-normalised). */
  quote: string;
}

export interface RetrievalTrace {
  /** Sections inspected before concluding an absence. */
  checked_sections: string[];
  /** Selected evidence-unit ids, in generation order. */
  unit_ids: string[];
  /** MMR/diversity flag for broad questions. */
  diversified: boolean;
}

export interface StructuredAnswer {
  segments: StructuredSegment[];
  citations: Record<string, StructuredCitation>;
  retrieval_trace?: RetrievalTrace;
}

export interface EvidenceUnit {
  unit_id: string;
  text: string;
  section_id: string;
  section_title: string;
  doc: string;
  page: number | null;
  char_start: number;
  char_end: number;
}

export interface VerificationResult {
  ok: boolean;
  failures: string[];
  /** Segments that survived verification (used for partial answers). */
  keptSegments: StructuredSegment[];
}

/* ------------------------------------------------------------------- helpers */

export function ws(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normText(value: unknown): string {
  return ws(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function splitSentences(text: unknown): string[] {
  return ws(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(ws)
    .filter(Boolean);
}

const STOP = new Set([
  'yang', 'dan', 'atau', 'dalam', 'untuk', 'dengan', 'pada', 'dari', 'tidak',
  'ini', 'itu', 'adalah', 'wajib', 'setiap', 'semua', 'jika', 'bila', 'saat',
  'setelah', 'sebelum', 'oleh', 'kepada', 'sebagai', 'harus', 'dapat', 'akan',
  'sudah', 'belum', 'lebih', 'kurang', 'sampai', 'antara', 'karena', 'agar',
  'supaya', 'bahwa', 'bagaimana', 'berapa', 'apakah', 'dimana', 'kapan', 'mengapa',
  'berarti', 'yaitu', 'yakni', 'juga', 'serta', 'namun', 'tetapi', 'karena',
  'dokumen', 'informasi', 'sumber', 'bagian', 'halaman', 'tersebut',
]);

export function contentTerms(text: unknown): string[] {
  return [...new Set(normText(text).split(' ').filter((t) => t.length >= 4 && !STOP.has(t)))];
}

export function numberTokens(text: unknown): string[] {
  return String(text ?? '').match(/\d+(?:[.,]\d+)*/g) ?? [];
}

/* ------------------------------------------- SEMANTIC COMPOSITION V3 */

/**
 * Penanda awal "alur" teks lain di tengah kalimat — gejala khas teks dua
 * kolom yang terekstrak berselang-seling (baris kiri/kanan bergantian).
 * Domain-netral: tidak ada nama dokumen, kode, atau topik SOP.
 */
const INTERLEAVE_START_RE = /^(jika|setelah|apabila|ketika|saat|selama|sebelum|sementara|while|when|if|after)\b/i;
/** Konjungsi tujuan: menandai kembalinya alur utama setelah zona sisipan. */
const RESUME_RE = /^(untuk|agar|supaya|to|for)\b/i;
/**
 * Preposisi LOKASI yang menggantung: kata sesudahnya adalah anchor alur utama
 * ("catat laporan dalam hambatan" → "hambatan"). "dengan" sengaja dikecualikan
 * karena mengawali frasa di dalam sisipan, bukan menandai kembali ke alur utama.
 */
const DANGLING_PREP_RE = /^(dalam|pada|ke|dari|in|on|of)\b/i;

type CleanClause = { text: string; punct: ',' | '.' | '' };
type CloseKind = 'none' | 'prep' | 'resume' | 'drop';

/**
 * Term intent = kata isi dari pertanyaan + parafrasa, DITAMBAH token pendek
 * bermakna (PIC, P1, SEV1, F04) yang dibuang `contentTerms` karena < 4 char.
 */
export function intentTerms(question: string, variants: string[] = []): string[] {
  const joined = [question, ...variants].filter(Boolean).join(' ');
  const long = contentTerms(joined);
  const short = String(joined).match(/\b[A-Za-z0-9][A-Za-z0-9.\-]{1,}\b/g) ?? [];
  return [...new Set([...long, ...short.map((t) => t.toLowerCase())])].filter(Boolean);
}

/**
 * DECIMAL-COMMA GUARD — koma desimal ala Indonesia (`12,5`) BUKAN pemisah
 * klausa. `splitClauses` dulu memecah `12,5` menjadi `12` + `5`, lalu
 * `joinClauses` menyisipkan spasi menjadi `12, 5`. Evaluator grounding lalu
 * membacanya sebagai dua angka asing (`foreign_numbers: ["12","5"]`) dan
 * `hallucination_rate` naik di atas ambang.
 *
 * Helper ini mengembalikan `12, 5` (spasi yang terselip, mis. dari OCR atau
 * normalisasi lama) ke `12,5` HANYA untuk pola desimal: digit + koma + satu
 * spasi + 1–2 digit + batas bukan digit/koma. Pemisah daftar (`12, 5, 7`) dan
 * daftar ribuan (`2.850, 1.200`) sengaja dibiarkan apa adanya.
 */
export function normalizeDecimalCommaSpacing(text: string): string {
  // `(?<!,\s)` menolak angka yang merupakan item daftar (`12, 5, 7`);
  // `(?![\d,]|\.\d{3})` menolak grup ribuan lanjutan (`2.850, 1.200`).
  return String(text ?? '').replace(/(?<!,\s)(\d),\s(\d{1,2})(?![\d,]|\.\d{3})/g, '$1,$2');
}

/** Koma pada `index` adalah pemisah desimal (`\d,\d`), bukan pemisah klausa. */
function isDecimalComma(text: string, index: number): boolean {
  return (
    index > 0 &&
    index + 1 < text.length &&
    /\d/.test(text[index - 1]) &&
    /\d/.test(text[index + 1])
  );
}

function splitClauses(sentence: string): CleanClause[] {
  const out: CleanClause[] = [];
  // Normalisasi dulu supaya `12, 5` kembali menjadi `12,5` sebelum dipecah.
  const clean = normalizeDecimalCommaSpacing(sentence);
  const re = /([,;])\s*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    // Koma desimal melekat pada angkanya — jangan dijadikan batas klausa.
    if (m[1] === ',' && isDecimalComma(clean, m.index)) continue;
    const text = ws(clean.slice(last, m.index));
    if (text) out.push({ text, punct: ',' });
    last = m.index + m[0].length;
  }
  const tail = ws(clean.slice(last));
  if (tail) out.push({ text: tail, punct: '' });
  return out;
}

function joinClauses(clauses: CleanClause[]): string {
  if (!clauses.length) return '';
  let out = clauses[0].text;
  for (let i = 1; i < clauses.length; i += 1) {
    const sep = clauses[i - 1].punct === ',' ? ', ' : ' ';
    out += sep + clauses[i].text;
  }
  out = out.replace(/\s+([,.;])/g, '$1').trim();
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

function relevanceOf(text: string, termSet: Set<string>): number {
  const norm = normText(text);
  let score = 0;
  for (const term of termSet) if (norm.includes(term)) score += 1;
  return score;
}

/**
 * Pecah klausa yang mengandung kata hubung waktu/kondisi DI TENGAH — gejala
 * sisipan tanpa koma ("... pergantian petugas Setelah sistem pulih ...").
 *
 * V3: penanda hanya memicu pemotongan bila (a) bagian sebelumnya punya
 * dukungan intent, (b) bagian sesudahnya lebih rendah, DAN (c) rentang antara
 * penanda dan konjungsi tujuan tidak mengandung entitas intent. Syarat (c)
 * melindungi frasa sah seperti "sebelum pergantian petugas untuk …" — dulu
 * frasa ini ikut terbuang sehingga jawaban hanya menyisakan ekor kalimat.
 */
function splitAtInterleave(
  text: string,
  termSet: Set<string>,
): { before: string; from: string } | null {
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length; i += 1) {
    if (!INTERLEAVE_START_RE.test(words[i])) continue;
    const before = words.slice(0, i).join(' ');
    const from = words.slice(i).join(' ');
    const beforeScore = relevanceOf(before, termSet);
    const fromScore = relevanceOf(from, termSet);
    if (beforeScore < 1 || fromScore >= beforeScore) continue;
    const resumeAt = words.findIndex((w, wi) => wi > i && RESUME_RE.test(w));
    const between = resumeAt > i ? words.slice(i + 1, resumeAt).join(' ') : from;
    if (relevanceOf(between, termSet) >= 1) continue;
    return { before, from };
  }
  return null;
}

/**
 * Anchor yang mengembalikan alur utama setelah zona sisipan. Satu-satunya
 * alasan sebuah bagian di dalam zona dipertahankan: konjungsi tujuan, atau
 * preposisi lokasi yang menggantung. Semua teks lain di zona dibuang — tidak
 * ada pemotongan di tengah klausa di luar zona.
 */
function resumeAnchor(text: string): { text: string; kind: 'prep' | 'resume' } | null {
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    if (RESUME_RE.test(words[i])) {
      return { text: words.slice(i).join(' '), kind: 'resume' };
    }
    if (DANGLING_PREP_RE.test(words[i]) && i + 1 < words.length) {
      return { text: words.slice(i + 1).join(' '), kind: 'prep' };
    }
  }
  return null;
}

/**
 * Rekonstruksi kalimat utuh dari chunk yang teksnya berselang-seling.
 *
 * Aturan V3 (deterministik, tanpa model):
 *  1. pecah kalimat → klausa pada koma;
 *  2. klausa yang diawali penanda waktu/kondisi membuka "zona sisipan";
 *     penanda di tengah klausa hanya memicu ini bila entitas intent tidak
 *     mengapitnya (`splitAtInterleave`);
 *  3. DI DALAM zona, satu-satunya yang dipertahankan adalah anchor:
 *     konjungsi tujuan ("untuk …") atau preposisi lokasi menggantung
 *     ("dalam hambatan" → "hambatan"). Itulah titik kembalinya alur utama;
 *  4. DI LUAR zona, klausa tidak pernah dipotong — tidak ada lagi aturan
 *     "buang bila tidak ada term intent" yang dulu memangkas inti bukti;
 *  5. kalimat yang terputus oleh titik sisipan disambung kembali bila
 *     kalimat berikutnya diawali huruf kecil; ekor alur asing setelah
 *     konjungsi tujuan dibuang.
 *
 * Bila chunk bersih, fungsi ini identik dengan `splitSentences` — tidak ada
 * pengarangan, tidak ada perubahan angka.
 */
export function reconstructCleanSentences(quote: string, terms: string[]): string[] {
  const sentences = splitSentences(quote);
  if (!sentences.length) return [];
  const termSet = new Set(terms.map((t) => normText(t)).filter(Boolean));
  const out: string[] = [];
  let lastClose: CloseKind = 'none';

  for (const sentence of sentences) {
    const rawClauses = splitClauses(sentence);
    const clauses: CleanClause[] = [];
    for (const clause of rawClauses) {
      const split = splitAtInterleave(clause.text, termSet);
      if (!split) {
        clauses.push(clause);
        continue;
      }
      clauses.push({ text: split.before, punct: ',' });
      clauses.push({ text: split.from, punct: clause.punct });
    }

    const isContinuation = /^[a-z]/.test(sentence) && out.length > 0;
    if (isContinuation && lastClose === 'resume') {
      // Ekor alur asing yang mengikuti konjungsi tujuan, bukan bagian bukti.
      continue;
    }

    let inInterleave = false;
    let closeKind: CloseKind = 'none';
    const kept: CleanClause[] = [];
    for (const clause of clauses) {
      if (!inInterleave && INTERLEAVE_START_RE.test(clause.text)) {
        inInterleave = true;
        const anchor = resumeAnchor(clause.text);
        if (anchor) {
          if (anchor.kind === 'resume' && kept.length) {
            kept[kept.length - 1] = { ...kept[kept.length - 1], punct: '' };
          }
          kept.push({ text: anchor.text, punct: clause.punct });
          inInterleave = false;
          closeKind = anchor.kind;
        }
        continue;
      }
      if (inInterleave) {
        const anchor = resumeAnchor(clause.text);
        if (anchor) {
          if (anchor.kind === 'resume' && kept.length) {
            kept[kept.length - 1] = { ...kept[kept.length - 1], punct: '' };
          }
          kept.push({ text: anchor.text, punct: clause.punct });
          inInterleave = false;
          closeKind = anchor.kind;
        }
        continue;
      }
      kept.push(clause);
    }
    if (!kept.length) {
      if (inInterleave) closeKind = 'drop';
      continue;
    }

    // Sisipan yang menggantung di sentence sebelumnya menyisakan kata non-anchor
    // di awal sentence ini ("Serah formulir …" → "Serah").
    if (lastClose === 'prep') {
      const anchors = kept[0].text.split(/\s+/).filter((w) => termSet.has(normText(w)));
      if (anchors.length) kept[0] = { ...kept[0], text: anchors.join(' ') };
    }

    const text = joinClauses(kept);
    if (isContinuation) {
      out[out.length - 1] = `${out[out.length - 1].replace(/[.!?]$/, '')} ${text}`.trim();
    } else {
      out.push(text);
    }
    lastClose = closeKind;
  }
  return out;
}

function unitRelevance(text: string, termSet: Set<string>): number {
  const norm = normText(text);
  let score = 0;
  for (const term of termSet) if (norm.includes(term)) score += 1;
  return score;
}

function safeSectionId(sectionPath: string, index: number): string {
  const base = normText(sectionPath).replace(/\s+/g, '-').slice(0, 40);
  return base || `src${index + 1}`;
}

/* ------------------------------------------------------- evidence-unit build */

/**
 * Select the smallest set of evidence units that can support the answer.
 * A unit is one sentence of a cited chunk, labelled with a stable id. Only
 * question-relevant sentences plus their immediate neighbours are sent to the
 * generator — never the whole chunk or page (minimal-context requirement).
 */
export function buildEvidenceUnits(
  citations: CoreCitation[],
  question: string,
  maxUnits = 12,
): EvidenceUnit[] {
  const qTerms = new Set(contentTerms(question));
  const units: EvidenceUnit[] = [];

  citations.forEach((citation, ci) => {
    const sectionId = safeSectionId(citation.section_path ?? '', ci);
    const sectionTitle = ws(citation.section_path) || `Sumber ${ci + 1}`;
    const quote = ws(citation.quote);
    if (!quote) return;
    const sentences = splitSentences(quote);
    let cursor = 0;
    sentences.forEach((sentence, si) => {
      const start = quote.indexOf(sentence, cursor);
      const charStart = start >= 0 ? start : cursor;
      const charEnd = charStart + sentence.length;
      cursor = charEnd;
      units.push({
        unit_id: `${sectionId}.s${si + 1}`,
        text: sentence,
        section_id: sectionId,
        section_title: sectionTitle,
        doc: String(citation.document_id ?? citation.chunk_id ?? `src${ci + 1}`),
        page: citation.page ?? null,
        char_start: charStart,
        char_end: charEnd,
      });
    });
  });

  if (units.length <= maxUnits) return units;

  // Score by question-term coverage; keep the best units and their neighbours
  // so a claim never loses the sentence immediately before/after it.
  const scored = units.map((unit, index) => {
    const terms = contentTerms(unit.text);
    const hits = terms.filter((t) => qTerms.has(t)).length;
    return { index, score: terms.length ? hits / terms.length : 0 };
  });
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  const keep = new Set<number>();
  for (const entry of ranked) {
    if (keep.size >= maxUnits) break;
    for (let i = Math.max(0, entry.index - 1); i <= Math.min(units.length - 1, entry.index + 1); i += 1) {
      keep.add(i);
      if (keep.size >= maxUnits) break;
    }
  }
  return units.filter((_, i) => keep.has(i));
}

/** Maximal Marginal Relevance — diversity for broad / multi-part questions. */
export function mmrSelect<T>(
  items: T[],
  textOf: (item: T) => string,
  question: string,
  k: number,
  lambda = 0.7,
): T[] {
  if (items.length <= k) return items;
  const qTerms = new Set(contentTerms(question));
  const termSets = items.map((item) => new Set(contentTerms(textOf(item))));
  const relevance = termSets.map((set) => {
    if (!set.size) return 0;
    let hits = 0;
    for (const t of set) if (qTerms.has(t)) hits += 1;
    return hits / set.size;
  });
  const similarity = (a: number, b: number): number => {
    if (!termSets[a].size || !termSets[b].size) return 0;
    let inter = 0;
    for (const t of termSets[a]) if (termSets[b].has(t)) inter += 1;
    return inter / Math.min(termSets[a].size, termSets[b].size);
  };
  const chosen: number[] = [];
  const remaining = items.map((_, i) => i);
  while (chosen.length < k && remaining.length) {
    let best = remaining[0];
    let bestScore = -Infinity;
    for (const i of remaining) {
      const redundancy = chosen.length ? Math.max(...chosen.map((j) => similarity(i, j))) : 0;
      const score = lambda * relevance[i] - (1 - lambda) * redundancy;
      if (score > bestScore || (score === bestScore && i < best)) {
        bestScore = score;
        best = i;
      }
    }
    chosen.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }
  return chosen.map((i) => items[i]);
}

/* ------------------------------------------------------------------ verifier */

const CITED_KINDS: SegmentKind[] = ['claim', 'inference', 'caveat', 'absence'];

/**
 * Claim verifier (SPEC h). Three independent checks:
 *  1. quote is an exact substring of the cited evidence units;
 *  2. every number and key term in the segment exists in the cited units;
 *  3. lexical entailment — at least one content term is shared.
 * Inference segments must carry the "berarti…" marker; absence segments must
 * cite the nearest rule. Failures are reported, never silently accepted.
 */
export function verifyStructuredAnswer(
  answer: StructuredAnswer,
  units: EvidenceUnit[],
): VerificationResult {
  const failures: string[] = [];
  const unitById = new Map(units.map((u) => [u.unit_id, u]));
  const keptSegments: StructuredSegment[] = [];

  for (const [id, citation] of Object.entries(answer.citations ?? {})) {
    const citedUnits = (citation.unit_ids ?? [])
      .map((uid) => unitById.get(uid))
      .filter((u): u is EvidenceUnit => Boolean(u));
    if (!citedUnits.length) {
      failures.push(`${id}:UNRESOLVED_UNIT`);
      continue;
    }
    const joined = citedUnits.map((u) => u.text).join(' ');
    if (!ws(joined).includes(ws(citation.quote))) failures.push(`${id}:QUOTE_MISMATCH`);
    const start = Number(citation.char_start);
    const end = Number(citation.char_end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > ws(joined).length + 1) {
      failures.push(`${id}:OFFSET_INVALID`);
    }
  }

  for (const segment of answer.segments ?? []) {
    const text = ws(segment.text);
    if (!text) continue;
    const cites = segment.cite ?? [];
    if (CITED_KINDS.includes(segment.kind) && !cites.length) {
      failures.push(`segment:${segment.kind}:MISSING_CITATION`);
      continue;
    }
    if (segment.kind === 'inference' && !/berarti/i.test(text)) {
      failures.push('segment:inference:MARKER_MISSING');
    }
    if (!cites.length) {
      keptSegments.push(segment);
      continue;
    }
    const evidenceTexts: string[] = [];
    let segmentOk = true;
    for (const id of cites) {
      const citation = answer.citations?.[id];
      if (!citation) {
        failures.push(`segment:UNKNOWN_CITE:${id}`);
        segmentOk = false;
        continue;
      }
      const citedUnits = (citation.unit_ids ?? [])
        .map((uid) => unitById.get(uid))
        .filter((u): u is EvidenceUnit => Boolean(u));
      evidenceTexts.push(...citedUnits.map((u) => u.text));
    }
    if (!evidenceTexts.length) {
      failures.push('segment:NO_EVIDENCE');
      continue;
    }
    const evidence = evidenceTexts.join(' ');
    const evidenceNumbers = new Set(numberTokens(evidence));
    for (const token of numberTokens(text)) {
      if (!evidenceNumbers.has(token)) {
        failures.push(`segment:FOREIGN_NUMBER:${token}`);
        segmentOk = false;
      }
    }
    const terms = contentTerms(text);
    if (terms.length && !terms.some((t) => normText(evidence).includes(t))) {
      failures.push('segment:NO_ENTAILMENT');
      segmentOk = false;
    }
    if (segmentOk) keptSegments.push(segment);
  }

  return { ok: failures.length === 0, failures, keptSegments };
}

/**
 * One bounded repair pass. Rebind a failing citation to the evidence unit with
 * the best number/term overlap; if that still fails, DROP the segment rather
 * than emit an uncited claim. Never loops (max one regeneration).
 */
export function repairStructuredAnswer(
  answer: StructuredAnswer,
  units: EvidenceUnit[],
): { answer: StructuredAnswer | null; degraded: boolean; failures: string[] } {
  const first = verifyStructuredAnswer(answer, units);
  if (first.ok) return { answer, degraded: false, failures: [] };

  const repaired: StructuredAnswer = {
    segments: [],
    citations: { ...(answer.citations ?? {}) },
    ...(answer.retrieval_trace ? { retrieval_trace: answer.retrieval_trace } : {}),
  };
  for (const segment of answer.segments ?? []) {
    const single: StructuredAnswer = {
      segments: [segment],
      citations: repaired.citations,
    };
    const verdict = verifyStructuredAnswer(single, units);
    if (verdict.ok) {
      repaired.segments.push(segment);
      continue;
    }
    // Try rebinding each cite to the best overlapping unit once.
    let rebound = false;
    for (const id of segment.cite ?? []) {
      const citation = repaired.citations[id];
      if (!citation) continue;
      const candidates = units.filter((u) => u.section_id === citation.section_id);
      if (!candidates.length) continue;
      const scored = candidates.map((u) => {
        const terms = contentTerms(segment.text);
        const hits = terms.filter((t) => normText(u.text).includes(t)).length;
        const nums = numberTokens(segment.text).filter((n) => numberTokens(u.text).includes(n)).length;
        return { unit: u, score: hits + nums * 2 };
      }).sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (best && best.score > 0) {
        repaired.citations[id] = {
          ...citation,
          unit_ids: [best.unit.unit_id],
          quote: best.unit.text,
          char_start: best.unit.char_start,
          char_end: best.unit.char_end,
        };
        rebound = true;
      }
    }
    if (rebound) {
      const retry = verifyStructuredAnswer({ segments: [segment], citations: repaired.citations }, units);
      if (retry.ok) repaired.segments.push(segment);
    }
    // Otherwise the segment is dropped — no uncited claim is ever emitted.
  }

  if (!repaired.segments.length) {
    return { answer: null, degraded: true, failures: first.failures };
  }
  return { answer: repaired, degraded: true, failures: first.failures };
}

/* ------------------------------------------------------------------- renderer */

/**
 * Render a verified structured answer into the production string + legacy
 * citation array. Markers are appended immediately after each segment; the
 * citation order follows first appearance so `[n]` always maps to
 * `citations[n-1]` (the UI contract). No trailing reference dump is produced.
 */
export function renderStructuredAnswer(
  answer: StructuredAnswer,
  legacy: CoreCitation[] = [],
): { text: string; citations: CoreCitation[] } {
  const order: string[] = [];
  for (const segment of answer.segments ?? []) {
    for (const id of segment.cite ?? []) {
      if (answer.citations?.[id] && !order.includes(id)) order.push(id);
    }
  }
  const indexOf = new Map(order.map((id, i) => [id, i + 1]));
  const text = (answer.segments ?? [])
    .map((segment) => {
      const marks = (segment.cite ?? [])
        .map((id) => indexOf.get(id))
        .filter((n): n is number => Boolean(n))
        .map((n) => ` [${n}]`);
      return `${ws(segment.text)}${marks.join('')}`;
    })
    .filter(Boolean)
    .join(' ');
  // Guard akhir: tidak pernah ada spasi setelah koma desimal pada output.
  const safeText = normalizeDecimalCommaSpacing(text);

  const citations: CoreCitation[] = order.map((id, i) => {
    const structured = answer.citations[id];
    const match = legacy.find((c) =>
      ws(c.section_path) === ws(structured.section_title)
      || ws(c.quote).includes(ws(structured.quote))
      || ws(structured.quote).includes(ws(c.quote)),
    );
    return {
      chunk_id: match?.chunk_id ?? null,
      document_id: match?.document_id ?? structured.doc ?? null,
      section_path: structured.section_title || match?.section_path || '',
      page: structured.page ?? match?.page ?? null,
      quote: ws(structured.quote) || ws(match?.quote) || '',
      score: match?.score ?? null,
      ...(match?.deep_link ? { deep_link: match.deep_link } : {}),
      ...(match?.deep_link_status ? { deep_link_status: match.deep_link_status } : {}),
      ...(match?.rev ? { rev: match.rev } : {}),
      ...(i === 0 ? {} : {}),
    };
  });
  return { text: safeText, citations };
}

/* ------------------------------------------------- deterministic construction */

/**
 * Build a structured answer from deterministic evidence (LLM_MODE=off).
 *
 * SEMANTIC COMPOSITION V3 — setiap unit bukti adalah KALIMAT UTUH hasil
 * `reconstructCleanSentences`, bukan potongan chunk. Tidak ada potongan yang
 * pernah disisipkan ke tengah kalimat lain: bila beberapa unit dipakai, tiap
 * unit menjadi segmen `claim` tersendiri dan renderer menempelkan `[n]`-nya.
 * Unit diurutkan dari skor relevansi tertinggi (intent + parafrasa), tie-break
 * = urutan sitasi asli, sehingga pertanyaan natural dan kata kunci persis
 * menghasilkan jawaban yang sama. Maksimal 3 kalimat; setelah sumber terbaik
 * menyumbang 2 kalimat utuh, sumber lain tidak ditambahkan (mencegah ekor
 * kalimat asing masuk hanya karena ambang relevansi longgar).
 */
export function composeDeterministicStructured(
  question: string,
  citations: CoreCitation[],
  maxCitations = 5,
  variants: string[] = [],
): StructuredAnswer {
  const structured: StructuredAnswer = { segments: [], citations: {} };
  const seen = new Set<string>();
  const termSet = new Set(intentTerms(question, variants));
  const ranked: Array<{
    citation: CoreCitation;
    sentence: string;
    score: number;
    ci: number;
    si: number;
  }> = [];

  citations.forEach((citation, ci) => {
    const quote = ws(citation.quote);
    if (!quote) return;
    const key = normText(quote).slice(0, 140);
    if (seen.has(key)) return;
    seen.add(key);
    const sentences = reconstructCleanSentences(quote, [...termSet]);
    sentences.forEach((sentence, si) => {
      ranked.push({ citation, sentence, score: unitRelevance(sentence, termSet), ci, si });
    });
  });

  ranked.sort((a, b) => b.score - a.score || a.ci - b.ci || a.si - b.si);
  const bestCi = ranked.length ? ranked[0].ci : -1;
  const minScore = 1;

  const usedCitationIndex = new Map<number, string>();
  const perCitation = new Map<number, number>();
  let activeCi: number | null = null;
  for (const entry of ranked) {
    if (structured.segments.length >= 3) break;
    // Kalimat dari sumber terbaik tetap dipakai walau skornya 0: ia adalah
    // bagian dari kalimat utuh hasil rekonstruksi, bukan potongan tengah.
    if (entry.score < minScore && entry.ci !== bestCi) continue;
    if (activeCi !== null && entry.ci !== activeCi && (perCitation.get(activeCi) ?? 0) >= 2) break;
    activeCi = entry.ci;
    let id = usedCitationIndex.get(entry.ci);
    if (!id) {
      id = `c${usedCitationIndex.size + 1}`;
      usedCitationIndex.set(entry.ci, id);
      const sectionId = safeSectionId(entry.citation.section_path ?? '', entry.ci);
      structured.citations[id] = {
        doc: String(entry.citation.document_id ?? entry.citation.chunk_id ?? ''),
        page: entry.citation.page ?? null,
        section_id: sectionId,
        section_title: ws(entry.citation.section_path) || 'Sumber',
        unit_ids: [],
        char_start: 0,
        char_end: ws(entry.citation.quote).length,
        quote: ws(entry.citation.quote),
      };
    }
    const sectionId = safeSectionId(entry.citation.section_path ?? '', entry.ci);
    const uid = `${sectionId}.s${entry.si + 1}`;
    structured.citations[id].unit_ids.push(uid);
    structured.segments.push({ text: entry.sentence, kind: 'claim', cite: [id] });
    perCitation.set(entry.ci, (perCitation.get(entry.ci) ?? 0) + 1);
  }

  structured.retrieval_trace = {
    checked_sections: citations.map((c) => ws(c.section_path)).filter(Boolean),
    unit_ids: Object.values(structured.citations).flatMap((c) => c.unit_ids),
    diversified: false,
  };
  return structured;
}

/**
 * Evidence units untuk generator LLM — sama seperti `buildEvidenceUnits`, tapi
 * setiap unit sudah direkonstruksi menjadi kalimat utuh. Mencegah LLM menerima
 * potongan berselang-seling dan menghasilkan jawaban yang ikut rusak.
 */
export function buildCleanEvidenceUnits(
  citations: CoreCitation[],
  question: string,
  variants: string[] = [],
  maxUnits = 12,
): EvidenceUnit[] {
  const terms = intentTerms(question, variants);
  const termSet = new Set(terms);
  const units: EvidenceUnit[] = [];

  citations.forEach((citation, ci) => {
    const sectionId = safeSectionId(citation.section_path ?? '', ci);
    const sectionTitle = ws(citation.section_path) || `Sumber ${ci + 1}`;
    const quote = ws(citation.quote);
    if (!quote) return;
    const sentences = reconstructCleanSentences(quote, terms);
    sentences.forEach((sentence, si) => {
      units.push({
        unit_id: `${sectionId}.s${si + 1}`,
        text: sentence,
        section_id: sectionId,
        section_title: sectionTitle,
        doc: String(citation.document_id ?? citation.chunk_id ?? `src${ci + 1}`),
        page: citation.page ?? null,
        char_start: 0,
        char_end: sentence.length,
      });
    });
  });

  if (units.length <= maxUnits) return units;
  const scored = units.map((unit, index) => ({ index, score: unitRelevance(unit.text, termSet) }));
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  const keep = new Set<number>();
  for (const entry of ranked) {
    if (keep.size >= maxUnits) break;
    for (let i = Math.max(0, entry.index - 1); i <= Math.min(units.length - 1, entry.index + 1); i += 1) {
      keep.add(i);
      if (keep.size >= maxUnits) break;
    }
  }
  return units.filter((_, i) => keep.has(i));
}
