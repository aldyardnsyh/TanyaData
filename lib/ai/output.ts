/**
 * Adaptive output decision engine (P3-CORE) — docs/CORE_AI_SPEC.md §6.
 *
 * A decision table maps (question kind × data type × document type × data
 * shape) to one output type. Anti-patterns are enforced as hard checks, not
 * suggestions: no chart for a legal quote, no chart for a single number, no
 * donut for two categories, no forced visualisation for prose.
 */
import type { DataType, DocType, OutputDecision, OutputType, QuestionKind } from './types';

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
  const entities = input.entityCount ?? 0;

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

  // 7. Distribution → donut only for 3–4 compositional categories, else bar.
  if (kind === 'distribution' && cats >= 3) {
    if (cats <= 4) {
      return decision('donut', 'Komposisi 3–4 kategori yang berjumlah 100%; donut + tabel.', 0.80,
        [noDonutForTwo, noChartForOne]);
    }
    return decision('bar', `${cats} kategori terlalu banyak untuk donut; bar + tabel lebih terbaca.`, 0.84,
      [noDonutForTwo, noChartForOne]);
  }
  if (kind === 'distribution' && cats === 2) {
    return decision('table', 'Dua kategori cukup dinyatakan sebagai tabel/KPI ganda; donut dilarang.', 0.88,
      [noDonutForTwo]);
  }

  // 8. Comparison → bar for 2–8 entities.
  if (kind === 'comparison' && entities >= 2 && entities <= 8) {
    return decision('bar', `${entities} entitas dibandingkan; bar diurutkan berdasarkan nilai.`, 0.85,
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

  // 11. Procedure / prose → narrative text.
  if (kind === 'procedure' || kind === 'unknown') {
    return decision('text', 'Jawaban berupa narasi/kutipan; visualisasi dipaksakan dilarang.', 0.72,
      [noChartForText, noForcedViz]);
  }

  return decision('table', 'Bentuk data tidak memenuhi syarat chart; tabel ringkas dipilih.', 0.65,
    [noForcedViz, noChartForOne]);
}

