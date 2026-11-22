/**
 * Adaptive output decision engine (P3-CORE) — docs/CORE_AI_SPEC.md §6.
 *
 * A decision table maps (question kind × data type × document type × data
 * shape) to one output type. Anti-patterns are enforced as hard checks, not
 * suggestions: no chart for a legal quote, no chart for a single number, no
 * donut for two categories, no forced visualisation for prose.
 */
import type { EvidenceConfidenceLevel } from '@/lib/core/contracts';
import {
  extractRetrievalEntities, queryTerms, validateCitationDeepLink,
  type CitationRegistry,
} from './retrieval';
import type { DataType, DocType, OutputDecision, OutputType, QuestionKind } from './types';

import { domainPreference } from './domain-profile';

export interface DecideInput {
  question: string;
  questionKind?: QuestionKind;
  docType: DocType;
  dataType: DataType;
  rowCount?: number;
  categoryCount?: number;
  entityCount?: number;
  hasTime?: boolean;
  hasPeriod?: boolean;
  hasCurrency?: boolean;
  hasUnit?: boolean;
  hasVerifiableDate?: boolean;
  hasPasalNumber?: boolean;
  evidenceCount?: number;
  /** POV domain (finance/engineering/hr/general) — menyusun ulang preferensi
   * saat keputusan ambigu; tidak pernah memaksa chart tanpa data. */
  domain?: import('./domain-profile').OutputDomain;
}

/** Generic question-kind inference. No domain intents or entity names. */
export function inferQuestionKind(question: string, docType: DocType): QuestionKind {
  const q = question.toLowerCase();
  if (/(bunyi|berbunyi|definisi|apa\s+itu|makna|mengatur|diatur|pasal\s+\d+)/i.test(q) && docType === 'legal') {
    return 'definition';
  }
  if (/(distribusi|komposisi|breakdown|per\s+\w+\s*$|dalam\s+setiap)/i.test(q)) return 'distribution';
  if (/(bandingkan|perbandingan|vs\b|versus|dibanding)/i.test(q)) return 'comparison';
  if (/(tren|kecenderungan|dari\s+waktu|per\s+(hari|minggu|bulan|tahun)|selama\s+\d)/i.test(q)) return 'trend';
  if (/(parameter|spesifikasi|kedalaman|tekanan|laju|satuan|nilai\s+\w+)/i.test(q) && docType === 'technical_report') {
    return 'parameter';
  }
  if (/(ringkas\s+hasil\s+harian|kronologi|linimasa|timeline|sejak\s+kapan|urutan\s+kejadian)/i.test(q)) {
    return 'sequence';
  }
  if (/(dan\s+menurut|sesuai\s+(aturan|dokumen)|berdasarkan\s+aturan|hybrid)/i.test(q)) return 'hybrid';
  if (/(prosedur|langkah|bagaimana|caranya|sop)/i.test(q) && docType === 'general') return 'procedure';
  if (/(berapa|total|jumlah|nilai|rate|rasio|persentase)/i.test(q)) return 'single_number';
  return 'unknown';
}

function decision(
  type: OutputType, reason: string, confidence: number, checked: string[],
): OutputDecision {
  return { type, reason, confidence, anti_patterns_checked: checked };
}

/**
 * Choose the output shape. The first matching rule wins; every rule records
 * which anti-patterns it explicitly considered.
 */
export function decideOutput(input: DecideInput): OutputDecision {
  const kind = input.questionKind ?? inferQuestionKind(input.question, input.docType);
  const evidence = input.evidenceCount ?? 0;
  const rows = input.rowCount ?? 0;
  const cats = input.categoryCount ?? 0;
  let entities = input.entityCount ?? 0;

  // Dimensi domain/POV (arah user): urutan preferensi tipe output saat
  // keputusan ambigu. Hanya menyusun ulang di antara tipe yang sah untuk
  // bentuk data — guard ketersediaan data di bawah tetap berlaku (P-1/P-2).
  const preferenceFor = (kindKey: string, allowed: OutputType[]): { type: OutputType; domainApplied: boolean } => {
    const order = input.domain && input.domain !== 'general' ? domainPreference(input.domain, kindKey) : [];
    const pick = order.find((t) => allowed.includes(t as OutputType));
    return pick
      ? { type: pick as OutputType, domainApplied: true }
      : { type: allowed[0], domainApplied: false };
  };

  // A document-backed comparison produces no SQL rows, so callers cannot
  // always derive entityCount from the data shape. Infer it from distinct
  // period anchors in the question ("Q2 dan Q3 2026") before the financial
  // metadata guard runs — otherwise a valid comparison is mislabelled `table`.
  if (kind === 'comparison' && entities < 2) {
    const anchors = input.question.match(
      /\bQ[1-4]\b|\b(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\b|\b20\d{2}\b/gi,
    ) ?? [];
    const distinct = new Set(anchors.map((a) => a.toUpperCase()));
    if (distinct.size >= 2) entities = distinct.size;
  }

  const noChartForText = 'no_chart_for_prose_or_quote';
  const noChartForOne = 'no_chart_for_single_number';
  const noDonutForTwo = 'no_donut_for_two_categories';
  const quoteNeedsNumber = 'quote_requires_pasal_or_ayat';
  const paramNeedsUnit = 'parameter_requires_unit';
  const financeNeedsMeta = 'financial_requires_currency_and_period';
  const timelineNeedsDate = 'timeline_requires_verifiable_date';
  const noForcedViz = 'no_forced_visualisation';

  // 1. No evidence → honest text, no numbers, no chart.
  if (kind === 'no_evidence' || evidence === 0) {
    return decision('none', 'Tidak ada bukti yang dapat dikutip; jawaban jujur tanpa angka.', 0.95,
      [noChartForText, noForcedViz]);
  }

  // 2. Legal definition → verbatim quote, never a chart.
  if (input.docType === 'legal' && (kind === 'definition' || kind === 'procedure')) {
    return decision('quote', 'Teks hukum dikutip apa adanya dengan nomor pasal/ayat; bukan metrik.', 0.95,
      [noChartForText, quoteNeedsNumber, noForcedViz]);
  }

  // 3. Technical parameter → parameter table with units.
  if (input.docType === 'technical_report' && kind === 'parameter') {
    return decision('parameter_table', 'Parameter teknis disajikan sebagai tabel dengan satuan dan halaman.', 0.90,
      [paramNeedsUnit, noChartForText, noForcedViz]);
  }

  // 4. Sequence with verifiable dates → timeline.
  if (kind === 'sequence' && input.hasVerifiableDate) {
    return decision('timeline', 'Kejadian berurutan dengan tanggal terverifikasi dari sumber.', 0.85,
      [timelineNeedsDate, noForcedViz]);
  }
  if (kind === 'sequence' && !input.hasVerifiableDate) {
    return decision('table', 'Urutan diketahui tetapi tanggal tidak terverifikasi; tabel tanpa timeline.', 0.70,
      [timelineNeedsDate]);
  }

  // 5. Single number → KPI, no chart.
  if (kind === 'single_number' && rows <= 1) {
    return decision('kpi', 'Satu angka dari eksekusi SQL; KPI + tabel ringkas, tanpa chart.', 0.92,
      [noChartForOne, noForcedViz]);
  }

  // 6. Hybrid: number + rule → KPI plus citation.
  if (kind === 'hybrid') {
    return decision('kpi_quote', 'Angka dari SQL dipasangkan dengan kutipan aturan; indikasi dibedakan dari terbukti.', 0.82,
      [noChartForOne, quoteNeedsNumber]);
  }

  // 7. Distribution → komposisi 3–4 kategori donut (default); 5+ bar; 2 table.
  //    Domain menyusun ulang preferensi (engineering membaca tabel, dsb.).
  if (kind === 'distribution' && cats >= 3) {
    if (cats <= 4) {
      const pick = preferenceFor('distribution', ['donut', 'bar', 'table']);
      return decision(pick.type,
        pick.domainApplied
          ? `Komposisi 3–4 kategori; domain ${input.domain} lebih mudah membaca ${pick.type}.`
          : 'Komposisi 3–4 kategori yang berjumlah 100%; donut + tabel.',
        pick.domainApplied ? 0.78 : 0.80,
        [noDonutForTwo, noChartForOne]);
    }
    const pick = preferenceFor('distribution', ['bar', 'table']);
    return decision(pick.type,
      pick.domainApplied
        ? `${cats} kategori; domain ${input.domain} lebih mudah membaca ${pick.type}.`
        : `${cats} kategori terlalu banyak untuk donut; bar + tabel lebih terbaca.`,
      0.84,
      [noDonutForTwo, noChartForOne]);
  }
  if (kind === 'distribution' && cats === 2) {
    return decision('table', 'Dua kategori cukup dinyatakan sebagai tabel/KPI ganda; donut dilarang.', 0.88,
      [noDonutForTwo]);
  }

  // 8. Comparison → bar untuk 2–8 entitas (default); domain bisa memilih tabel.
  if (kind === 'comparison' && entities >= 2 && entities <= 8) {
    const pick = preferenceFor('comparison', ['bar', 'table']);
    return decision(pick.type,
      pick.domainApplied
        ? `${entities} entitas dibandingkan; domain ${input.domain} lebih mudah membaca ${pick.type}.`
        : `${entities} entitas dibandingkan; bar diurutkan berdasarkan nilai.`,
      0.85,
      [noChartForOne]);
  }

  // 9. Time trend → line.
  if (kind === 'trend' && input.hasTime) {
    return decision('line', 'Tren waktu dengan granularitas dan periode yang dinyatakan.', 0.85,
      [noChartForOne]);
  }

  // 10. Financial prose/number with missing metadata → table, not chart.
  if (input.docType === 'financial' && (!input.hasCurrency || !input.hasPeriod)) {
    return decision('table', 'Angka finansial tanpa mata uang/periode lengkap; tabel dengan flag incomplete.', 0.70,
      [financeNeedsMeta, noForcedViz]);
  }

  // 10b. Engineering POV: parameter teknis tetap parameter_report meski
  //      doc_type sumber bukan technical_report (domain menyusun ulang).
  if (input.domain === 'engineering' && kind === 'parameter') {
    return decision('parameter_table', 'Parameter teknis disajikan sebagai tabel dengan satuan dan halaman; domain engineering membaca spesifikasi lewat tabel.', 0.88,
      [paramNeedsUnit, noChartForText, noForcedViz]);
  }

  // 11. Procedure / prose → narrative text.
  if (kind === 'procedure' || kind === 'unknown') {
    return decision('text', 'Jawaban berupa narasi/kutipan; visualisasi dipaksakan dilarang.', 0.72,
      [noChartForText, noForcedViz]);
  }

  return decision('table', 'Bentuk data tidak memenuhi syarat chart; tabel ringkas dipilih.', 0.65,
    [noForcedViz, noChartForOne]);
}

/* ------------------------------------------- three-level evidence confidence */

export interface EvidenceConfidenceInput {
  question: string;
  /** Document citations only; dataset/SQL citations are not evidence here. */
  citations: Array<{
    score?: number | null;
    section_path?: string | null;
    quote?: string | null;
    /** Additive FR-D fields. Invalid deep links never count as strong evidence. */
    deep_link?: string | null;
    deep_link_status?: 'valid' | 'invalid' | 'unchecked';
    chunk_id?: string | null;
    doc?: string | null;
    page?: number | null;
  }>;
  /** Known channel names, when the caller has a seed/schema to resolve them. */
  knownChannels?: string[];
  /** Optional registry: re-validate every deep link before grading. */
  citationRegistry?: CitationRegistry | null;
}

export interface EvidenceConfidence {
  confidenceLevel: EvidenceConfidenceLevel;
  alternativeKeywords: string[];
}

/** Both retrieval paths normalise FTS5 scores into 0..1. */
const STRONG_SCORE = 0.60;

function sectionIsPrecise(
  haystack: string,
  entities: ReturnType<typeof extractRetrievalEntities>,
  terms: string[],
): boolean {
  const hay = haystack.toLowerCase();
  if (entities.pasal.some((p) => new RegExp(`pasal\\s*0*${p}\\b`, 'i').test(hay))) return true;
  if (entities.failureCodes.some((c) => hay.includes(c.toLowerCase()))) return true;
  if (entities.channels.some((c) => hay.includes(c.toLowerCase()))) return true;
  if (entities.ayat.some((n) => hay.includes(`ayat (${n})`) || hay.includes(`ayat ${n}`))) return true;
  // No explicit entity in the question: a citation is precise when its section
  // or quote carries a content term from the question.
  return terms.some((t) => t.length >= 4 && hay.includes(t));
}

/**
 * rag-ids-style evidence grading. `strong` needs BOTH a high FTS5 score and a
 * citation that matches what was asked; weak-but-present evidence is `limited`;
 * zero evidence is `refused` and returns keywords the user can try instead of
 * an invented answer. Purely deterministic — no model call, no extra latency.
 */
export function classifyEvidenceConfidence(input: EvidenceConfidenceInput): EvidenceConfidence {
  const citations = input.citations ?? [];
  const entities = extractRetrievalEntities(input.question, input.knownChannels ?? []);
  const terms = queryTerms(input.question, 8);
  const alternatives = [...new Set([...entities.keywords, ...terms])].slice(0, 6);

  // FR-D.1: a citation that carries an invalid/unverifiable deep link is not
  // evidence at all. Legacy citations without deep-link fields keep the old
  // behaviour, so existing callers and the 8/8 baseline are unaffected.
  const usable = citations.filter((c) => {
    if (c.deep_link_status === 'invalid') return false;
    if (c.deep_link_status === 'valid') return true;
    if (c.deep_link) {
      if (!input.citationRegistry) return false;
      return validateCitationDeepLink(c.deep_link, input.citationRegistry, c.quote ?? null).valid;
    }
    return true;
  });

  if (!usable.length) {
    return { confidenceLevel: 'refused', alternativeKeywords: alternatives };
  }

  const topScore = Math.max(0, ...usable.map((c) =>
    typeof c.score === 'number' && Number.isFinite(c.score) ? c.score : 0));
  const precise = usable.some((c) =>
    sectionIsPrecise(`${c.section_path ?? ''} ${c.quote ?? ''}`, entities, terms));

  if (topScore >= STRONG_SCORE && precise) {
    return { confidenceLevel: 'strong', alternativeKeywords: [] };
  }
  return { confidenceLevel: 'limited', alternativeKeywords: alternatives };
}

/* ------------------------------------------------- share snapshot citations */

export interface ShareCitation {
  deep_link?: string | null;
  section_path?: string | null;
  quote?: string | null;
  chunk_id?: string | null;
  doc?: string | null;
  page?: number | null;
}

export interface ShareCitationValidation {
  valid: boolean;
  rejected: Array<{ index: number; reason: string }>;
}

/**
 * AC-E.2.2: every citation embedded in a share snapshot must still resolve to
 * a real chunk. The snapshot is static, so validation happens at creation —
 * not when the (possibly deleted) attachment is opened later.
 */
export function validateShareCitations(
  citations: ShareCitation[],
  registry: CitationRegistry,
): ShareCitationValidation {
  const rejected: Array<{ index: number; reason: string }> = [];
  (citations ?? []).forEach((c, index) => {
    if (!c.deep_link) {
      rejected.push({ index, reason: 'MISSING_CHUNK' });
      return;
    }
    const verdict = validateCitationDeepLink(c.deep_link, registry, c.quote ?? null);
    if (!verdict.valid) rejected.push({ index, reason: verdict.reason ?? 'INVALID' });
  });
  return { valid: rejected.length === 0, rejected };
}

