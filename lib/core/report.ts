/**
 * Report job — FR-B.3–4, CORE_V2_ARCHITECTURE §5/§6.
 *
 * Angka HANYA dari `core_queries.result_json` yang sudah dihitung. Tidak ada
 * query ulang, tidak ada OCR ulang. Row cap 500. Narasi dengan angka asing
 * diganti template deterministik (AC-B.4.1). 0 baris ≠ angka 0 (AC-B.4.2).
 *
 * Chart: PDF memakai primitif pdf-lib; Excel memakai chart raster PNG yang
 * disisipkan via addImage — ExcelJS 4.4.0 yang terpasang TIDAK memiliki
 * `addChart`, sehingga ini mengikuti ASSUMPTION-V2-006 (fallback raster).
 */

import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { DB } from '@/lib/db/client';
import { nowJakartaIso } from '@/lib/date';
import { notFound, validationError } from '@/lib/errors';
import { getQuery } from '@/lib/core/store';
import type { DocType, Query } from '@/lib/core/contracts';
import type { ReportDetail } from '@/lib/contracts/http';
import { encodePng } from '@/lib/ingest/png';

export const REPORT_ROW_CAP = 500;

export type ReportJob = {
  id: string;
  queryId: string;
  conversationId: string | null;
  docType: DocType;
  format: 'pdf' | 'xlsx';
  status: 'QUEUED' | 'DONE' | 'FAILED';
  chartSpec: Record<string, unknown>;
  identity: Record<string, unknown>;
  rowCap: number;
  artifactPath: string | null;
  error: string | null;
  createdAt: string;
};

type JobRow = {
  id: string;
  query_id: string;
  conversation_id: string | null;
  doc_type: DocType;
  format: 'pdf' | 'xlsx';
  status: 'QUEUED' | 'DONE' | 'FAILED';
  result_json_ref: string;
  chart_spec: string;
  identity_json: string;
  row_cap: number;
  artifact_path: string | null;
  error: string | null;
  created_at: string;
};

function rowToJob(row: JobRow): ReportJob {
  return {
    id: row.id,
    queryId: row.query_id,
    conversationId: row.conversation_id,
    docType: row.doc_type,
    format: row.format,
    status: row.status,
    chartSpec: JSON.parse(row.chart_spec) as Record<string, unknown>,
    identity: JSON.parse(row.identity_json) as Record<string, unknown>,
    rowCap: row.row_cap,
    artifactPath: row.artifact_path,
    error: row.error,
    createdAt: row.created_at,
  };
}

function numericTokens(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? [];
}

function allowedNumbers(query: Query): Set<string> {
  const values = new Set<string>();
  for (const row of query.result_json.rows) {
    for (const value of Object.values(row)) {
      if (typeof value === 'number' && Number.isFinite(value)) values.add(String(value));
      else if (typeof value === 'string') for (const t of numericTokens(value)) values.add(t);
    }
  }
  values.add(String(query.result_json.rowCount));
  for (const citation of query.citations) {
    for (const t of numericTokens(`${citation.section_path} ${citation.quote ?? ''}`)) values.add(t);
  }
  return values;
}

/** Narasi aman: angka asing → template deterministik. */
export function guardNarrative(query: Query): string {
  const allowed = allowedNumbers(query);
  const answer = query.answer || '';
  const foreign = numericTokens(answer).filter((t) => !allowed.has(t) && !allowed.has(t.replace(',', '.')));
  if (foreign.length) {
    return query.result_json.rowCount === 0
      ? 'Tidak ada baris yang memenuhi filter ini.'
      : `Analisis menghasilkan ${query.result_json.rowCount} baris. Seluruh angka berasal dari result_json.`;
  }
  return answer;
}

function identityFor(docType: DocType, query: Query): Record<string, unknown> {
  const first = query.result_json.rows[0] ?? {};
  const section = query.citations[0]?.section_path ?? null;
  if (docType === 'legal') {
    return {
      kind: 'legal',
      pasal: section,
      ayat: query.citations.map((c) => c.section_path).filter((s) => /Ayat/i.test(s)),
      page: query.citations[0]?.page ?? null,
      quote: query.citations[0]?.quote ?? null,
      chart: false,
    };
  }
  if (docType === 'technical_report') {
    return {
      kind: 'technical_report',
      parameters: Object.entries(first).map(([name, value]) => ({ name, value, unit: null, page: query.citations[0]?.page ?? null })),
      page: query.citations[0]?.page ?? null,
      chart: true,
    };
  }
  if (docType === 'financial') {
    return {
      kind: 'financial',
      metrics: Object.entries(first).map(([name, value]) => ({ name, value })),
      currency: 'IDR',
      period: query.result_json.columns.find((c) => /periode|period|tanggal|date/i.test(c)) ?? null,
      chart: true,
    };
  }
  return { kind: 'general', chart: true };
}

function chartSpecFor(query: Query, docType: DocType): Record<string, unknown> {
  if (docType === 'legal') return { type: 'none', reason: 'dokumen legal tanpa chart' };
  const numericColumns = query.result_json.columns.filter((column) =>
    query.result_json.rows.some((row) => typeof row[column] === 'number' && Number.isFinite(row[column])),
  );
  const labelColumn = query.result_json.columns.find((c) => !numericColumns.includes(c)) ?? query.result_json.columns[0] ?? null;
  return {
    type: numericColumns.length ? 'bar' : 'none',
    labelColumn,
    valueColumns: numericColumns.slice(0, 3),
    rows: query.result_json.rows.slice(0, REPORT_ROW_CAP),
    reason: numericColumns.length ? 'chart dari kolom numerik result_json' : 'tidak ada kolom numerik',
  };
}

export function createReportJob(
  db: DB,
  input: { queryId: string; conversationId?: string | null; format: 'pdf' | 'xlsx'; docType?: DocType },
): ReportJob {
  if (input.format !== 'pdf' && input.format !== 'xlsx') {
    throw validationError('format harus "pdf" atau "xlsx"', { field: 'format' });
  }
  const query = getQuery(db, input.queryId);
  if (!query) throw notFound('Query tidak ditemukan');
  const docType = input.docType ?? 'general';
  const id = `rj_${randomBytes(8).toString('hex')}`;
  const now = nowJakartaIso();
  db.prepare(
    `INSERT INTO core_report_jobs
       (id, query_id, conversation_id, doc_type, format, status, result_json_ref, chart_spec,
        identity_json, row_cap, artifact_path, error, created_at)
     VALUES (?, ?, ?, ?, ?, 'DONE', ?, ?, ?, ?, NULL, NULL, ?)`,
  ).run(
    id,
    input.queryId,
    input.conversationId ?? null,
    docType,
    input.format,
    input.queryId,
    JSON.stringify(chartSpecFor(query, docType)),
    JSON.stringify(identityFor(docType, query)),
    REPORT_ROW_CAP,
    now,
  );
  return getReportJob(db, id);
}

export function getReportJob(db: DB, id: string): ReportJob {
  const row = db.prepare('SELECT * FROM core_report_jobs WHERE id = ?').get(id) as JobRow | undefined;
  if (!row) throw notFound('Report job tidak ditemukan');
  return rowToJob(row);
}

export function listReportJobs(db: DB, queryId?: string): ReportJob[] {
  const rows = queryId
    ? (db.prepare('SELECT * FROM core_report_jobs WHERE query_id = ? ORDER BY created_at DESC').all(queryId) as JobRow[])
    : (db.prepare('SELECT * FROM core_report_jobs ORDER BY created_at DESC LIMIT 50').all() as JobRow[]);
  return rows.map(rowToJob);
}

/* ------------------------------------------------------------ chart drawing */

type Bar = { label: string; value: number };

function chartBars(job: ReportJob, query: Query): Bar[] {
  const spec = job.chartSpec;
  const valueColumns = Array.isArray(spec.valueColumns) ? (spec.valueColumns as string[]) : [];
  const labelColumn = typeof spec.labelColumn === 'string' ? spec.labelColumn : query.result_json.columns[0];
  if (!valueColumns.length || !labelColumn) return [];
  return query.result_json.rows.slice(0, 12).flatMap((row) => {
    const value = row[valueColumns[0]];
    if (typeof value !== 'number' || !Number.isFinite(value)) return [];
    return [{ label: String(row[labelColumn] ?? ''), value }];
  });
}

/** Chart raster sederhana (bar) untuk Excel — angka dari result_json. */
async function barChartPng(bars: Bar[]): Promise<Uint8Array> {
  const width = 480;
  const height = 240;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255;
  }
  const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  };
  const baseline = height - 24;
  for (let x = 20; x < width - 10; x += 1) {
    for (let t = 0; t < 2; t += 1) setPixel(x, baseline + t, 120, 120, 120);
  }
  if (bars.length) {
    const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
    const slot = (width - 40) / bars.length;
    const barWidth = Math.max(6, Math.floor(slot * 0.6));
    bars.forEach((bar, index) => {
      const h = Math.max(1, Math.round((Math.abs(bar.value) / max) * (height - 60)));
      const x0 = 20 + Math.floor(index * slot + (slot - barWidth) / 2);
      for (let x = x0; x < x0 + barWidth; x += 1) {
        for (let y = baseline - h; y < baseline; y += 1) setPixel(x, y, 47, 111, 232);
      }
    });
  }
  return encodePng(rgba, width, height);
}

/* --------------------------------------------------------------- renderers */

export async function renderReportDetailXlsx(report: ReportDetail): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();

  const parseNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    let text = value.trim().replace(/Rp\.?\s*/gi, '').replace(/%/g, '').replace(/\s/g, '');
    if (!/\d/.test(text)) return null;
    const hasDot = text.includes('.');
    const hasComma = text.includes(',');
    if (hasDot && hasComma) {
      const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
      const group = decimal === '.' ? ',' : '.';
      text = text.split(group).join('').split(decimal).join('.');
    } else if (hasDot || hasComma) {
      const separator = hasDot ? '.' : ',';
      const parts = text.split(separator);
      text = parts.length > 2 || parts[parts.length - 1].length === 3 ? parts.join('') : parts.join('.');
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const numberFormat = (format: string | undefined): string | undefined => {
    if (format === 'number') return '#,##0';
    if (format === 'percent') return '0,00%';
    if (format === 'currency') return '"Rp "#,##0';
    return undefined;
  };

  const unitFor = (format: string): string => (format === 'percent' ? '%' : format === 'currency' ? 'Rp' : '');

  const columnLetter = (index: number): string => {
    let letters = '';
    let current = index;
    while (current > 0) {
      letters = String.fromCharCode(65 + ((current - 1) % 26)) + letters;
      current = Math.floor((current - 1) / 26);
    }
    return letters;
  };

  const addHeader = (sheet: ReturnType<typeof workbook.addWorksheet>, labels: string[], widths: number[]) => {
    const header = sheet.addRow(labels);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    header.alignment = { vertical: 'middle' };
    header.height = 22;
    widths.forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  };

  const ringkasan = workbook.addWorksheet('Ringkasan');
  addHeader(ringkasan, ['Keterangan', 'Nilai'], [24, 110]);
  const periodLabel = report.period?.label ?? (report.period ? `${report.period.start} sampai ${report.period.end}` : '');
  const overview: [string, string][] = [
    ['Judul', report.title],
    ['Pertanyaan', report.question],
    ['Periode', periodLabel],
    ['Dibuat', report.createdAt],
    ['Ringkasan', report.summary],
  ];
  for (const [label, value] of overview) {
    const row = ringkasan.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(1).alignment = { vertical: 'top' };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    if (value.length > 90) row.height = Math.ceil(value.length / 90) * 15;
  }
  report.keyFindings.forEach((finding, index) => {
    const row = ringkasan.addRow([`Temuan ${index + 1}`, finding.text]);
    row.getCell(1).font = { bold: true };
    row.getCell(1).alignment = { vertical: 'top' };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    if (finding.text.length > 90) row.height = Math.ceil(finding.text.length / 90) * 15;
  });

  const metrik = workbook.addWorksheet('Metrik');
  addHeader(metrik, ['Metrik', 'Nilai', 'Satuan'], [36, 22, 12]);
  for (const metric of report.metrics) {
    const numeric = parseNumber(metric.value);
    const asNumber = numeric !== null && metric.format !== 'text';
    const row = metrik.addRow([metric.label, asNumber ? numeric : (metric.value ?? ''), unitFor(metric.format)]);
    const valueCell = row.getCell(2);
    const format = numberFormat(metric.format);
    if (asNumber && format) {
      valueCell.numFmt = format;
      valueCell.alignment = { horizontal: 'right' };
    }
    row.getCell(3).alignment = { horizontal: 'center' };
  }
  if (report.metrics.length) {
    metrik.autoFilter = { from: { row: 1, column: 1 }, to: { row: report.metrics.length + 1, column: 3 } };
  }

  const data = workbook.addWorksheet('Data');
  const table = report.supportingTable;
  const columns = table?.columns ?? [];
  if (!columns.length) {
    addHeader(data, ['Keterangan'], [80]);
    data.addRow(['Tidak ada tabel pendukung.']);
  } else {
    addHeader(data, ['Keterangan', ...columns.map((column) => column.label)], [18, ...columns.map((column) => Math.max(14, Math.min(32, column.label.length + 6)))]);
    const rows = (table?.rows ?? []).slice(0, REPORT_ROW_CAP);
    const numericColumns = columns.filter((column) => {
      if (column.format === 'number' || column.format === 'percent' || column.format === 'currency') return true;
      if (column.format && column.format !== 'text') return true;
      return rows.length > 0 && rows.every((row) => {
        const raw = row[column.key];
        return raw === '' || raw === null || raw === undefined || parseNumber(raw) !== null;
      });
    });
    const numericKeys = new Set(numericColumns.map((column) => column.key));
    rows.forEach((sourceRow, rowIndex) => {
      const values = [`Baris ${rowIndex + 1}`, ...columns.map((column) => {
        const raw = sourceRow[column.key] ?? '';
        if (!numericKeys.has(column.key)) return raw;
        const parsed = parseNumber(raw);
        return parsed === null ? raw : parsed;
      })];
      const row = data.addRow(values);
      columns.forEach((column, index) => {
        if (!numericKeys.has(column.key)) return;
        const cell = row.getCell(index + 2);
        if (typeof cell.value !== 'number') return;
        const format = numberFormat(column.format) ?? '#,##0';
        if (format) cell.numFmt = format;
        cell.alignment = { horizontal: column.align === 'left' ? 'left' : 'right' };
      });
    });
    if (rows.length) {
      const lastDataRow = rows.length + 1;
      const totalRow = data.addRow([]);
      totalRow.getCell(1).value = 'TOTAL';
      totalRow.getCell(1).font = { bold: true };
      const averageRow = data.addRow([]);
      averageRow.getCell(1).value = 'RATA-RATA';
      averageRow.getCell(1).font = { bold: true };
      numericColumns.forEach((column) => {
        const index = columns.findIndex((item) => item.key === column.key) + 2;
        const letter = columnLetter(index);
        const format = numberFormat(column.format) ?? '#,##0';
        const totalCell = totalRow.getCell(index);
        totalCell.value = { formula: `SUM(${letter}2:${letter}${lastDataRow})` };
        totalCell.font = { bold: true };
        if (format) totalCell.numFmt = format;
        const averageCell = averageRow.getCell(index);
        averageCell.value = { formula: `AVERAGE(${letter}2:${letter}${lastDataRow})` };
        averageCell.font = { bold: true };
        if (format) averageCell.numFmt = format;
      });
      data.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastDataRow, column: columns.length + 1 } };
    }
  }

  const bukti = workbook.addWorksheet('Bukti');
  addHeader(bukti, ['Judul Dokumen', 'Bagian', 'Halaman', 'Kutipan'], [36, 28, 12, 90]);
  for (const source of report.sources) {
    const title = source.docTitle ?? source.table ?? source.sourceId;
    const section = source.section ?? (source.sectionNo === null || source.sectionNo === undefined ? '' : String(source.sectionNo));
    const quote = source.quote ?? '';
    const row = bukti.addRow([title, section, source.page ?? '', quote]);
    row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    if (quote.length > 90) row.height = Math.ceil(quote.length / 90) * 15;
  }
  if (report.sources.length) {
    bukti.autoFilter = { from: { row: 1, column: 1 }, to: { row: report.sources.length + 1, column: 4 } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export async function renderReportArtifact(
  db: DB,
  jobId: string,
): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
  const job = getReportJob(db, jobId);
  const query = getQuery(db, job.queryId);
  if (!query) throw notFound('Query tidak ditemukan');
  const narrative = guardNarrative(query);
  const bars = chartBars(job, query);
  const filename = `tanyadata-${job.id}.${job.format === 'pdf' ? 'pdf' : 'xlsx'}`;

  if (job.format === 'pdf') {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    let page = doc.addPage([595.28, 841.89]);
    let y = 793.89;
    const margin = 48;
    const draw = (text: string, size: number, isBold = false) => {
      const lines = String(text).match(/.{1,95}(\s|$)/g) ?? [String(text)];
      for (const line of lines) {
        if (y < margin + 20) {
          page = doc.addPage([595.28, 841.89]);
          y = 793.89;
        }
        page.drawText(line, { x: margin, y, size, font: isBold ? bold : font, color: rgb(0, 0, 0) });
        y -= size * 1.5;
      }
    };
    draw(`Laporan — ${job.docType}`, 16, true);
    draw(`Dibuat: ${job.createdAt}`, 8);
    y -= 8;
    draw(query.nl_question, 11, true);
    y -= 6;
    draw(narrative, 10);
    y -= 10;
    draw('Identitas dokumen', 12, true);
    draw(JSON.stringify(job.identity), 8);
    y -= 10;
    if (bars.length) {
      draw('Grafik (dari result_json)', 12, true);
      const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
      const slot = 480 / bars.length;
      bars.forEach((bar, index) => {
        const h = Math.max(1, (Math.abs(bar.value) / max) * 120);
        const x = margin + index * slot + 4;
        page.drawRectangle({ x, y: y - h, width: Math.max(6, slot - 10), height: h, color: rgb(0.18, 0.44, 0.91) });
        page.drawText(bar.label.slice(0, 12), { x, y: y - h - 12, size: 7, font, color: rgb(0, 0, 0) });
      });
      y -= 160;
    }
    draw('Tabel hasil', 12, true);
    draw(query.result_json.columns.join(' | '), 8, true);
    for (const row of query.result_json.rows.slice(0, 40)) {
      draw(query.result_json.columns.map((c) => String(row[c] ?? '')).join(' | '), 8);
    }
    if (query.citations.length) {
      y -= 8;
      draw('Sitasi', 12, true);
      for (const citation of query.citations.slice(0, 20)) {
        draw(`${citation.section_path} (hal. ${citation.page ?? '?'}): ${citation.quote ?? ''}`, 8);
      }
    }
    return { bytes: new Uint8Array(await doc.save()), contentType: 'application/pdf', filename };
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Hasil');
  const columns = query.result_json.columns.length ? query.result_json.columns : ['value'];
  sheet.addRow(columns);
  for (const row of query.result_json.rows.slice(0, REPORT_ROW_CAP)) {
    sheet.addRow(columns.map((c) => (row[c] === null || row[c] === undefined ? '' : row[c])));
  }
  sheet.getRow(1).font = { bold: true };
  if (bars.length) {
    const png = await barChartPng(bars);
    const imageId = workbook.addImage({ buffer: Buffer.from(png) as never, extension: 'png' });
    sheet.addImage(imageId, { tl: { col: 0, row: columns.length + 2 }, ext: { width: 480, height: 240 } });
  }
  const info = workbook.addWorksheet('Info');
  info.addRow(['Field', 'Nilai']);
  info.addRow(['Pertanyaan', query.nl_question]);
  info.addRow(['Ringkasan', narrative]);
  info.addRow(['Jumlah baris', query.result_json.rowCount]);
  info.addRow(['Identitas', JSON.stringify(job.identity)]);
  info.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    bytes: new Uint8Array(buffer as ArrayBuffer),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename,
  };
}
