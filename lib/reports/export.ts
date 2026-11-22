import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import type { ReportDetail, SupportingTable } from '@/lib/contracts/http';
import { formatDateLabel, formatNumber, formatPercent, formatCurrency } from '@/lib/date';
import { REPORT_KIND_LABEL, reportInsights, reportKind } from '@/lib/reports/kind';

const BOM = '\uFEFF';
const TAKE = 500;

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportToCsv(report: ReportDetail): string {
  const rows: (string | number | null)[][] = [];

  if (report.supportingTable) {
    const table: SupportingTable = report.supportingTable;
    rows.push(table.columns.map((c) => c.label));
    for (const row of table.rows.slice(0, TAKE)) {
      rows.push(
        table.columns.map((c) => {
          const value = row[c.key];
          if (value === null || value === undefined) return '';
          return value;
        }),
      );
    }
  } else if (report.metrics.length) {
    rows.push(['Metrik', 'Key', 'Nilai', 'Format']);
    for (const metric of report.metrics) {
      rows.push([metric.label, metric.key, metric.value, metric.format]);
    }
  } else {
    rows.push(['Judul', report.title]);
    rows.push(['Pertanyaan', report.question]);
    rows.push(['Ringkasan', report.summary]);
    for (const finding of report.keyFindings) rows.push(['Temuan', finding.text]);
  }

  return BOM + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

type Font = PDFFont;

function wrap(font: Font, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
        if (font.widthOfTextAtSize(word, size) > width) {
          let rest = word;
          while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
            let cut = rest.length;
            while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
            lines.push(rest.slice(0, cut));
            rest = rest.slice(cut);
          }
          current = rest;
        }
      }
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [''];
}

function display(value: number | null, format: string, lang: 'id' | 'en'): string {
  if (value === null || value === undefined) return 'n/a';
  if (format === 'percent') return formatPercent(value, lang);
  if (format === 'currency') return formatCurrency(value, lang);
  return formatNumber(value, lang);
}

const FOREST = rgb(0.043, 0.267, 0.2);      // #0B4433
const LIME = rgb(0.773, 0.851, 0.294);      // #C5D94B
const PORCELAIN = rgb(0.953, 0.957, 0.937); // #F3F4EF
const INK = rgb(0.106, 0.129, 0.114);       // #1B211D
const MUTED = rgb(0.42, 0.45, 0.43);

export async function reportToPdf(report: ReportDetail): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lang: 'id' | 'en' = 'id';
  const kind = reportKind(report);
  const insights = reportInsights(report);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 48;
  const width = pageWidth - margin * 2;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight;

  const newPage = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight;
  };

  const ensure = (height: number) => {
    if (y - height < margin + 24) newPage();
  };

  const draw = (text: string, size: number, useBold = false, color = INK, x = margin, w = width) => {
    const lines = wrap(useBold ? bold : font, size, text, w);
    const lineHeight = size * 1.4;
    for (const line of lines) {
      ensure(lineHeight);
      page.drawText(line, { x, y: y - size, size, font: useBold ? bold : font, color });
      y -= lineHeight;
    }
  };

  const sectionLabel = (label: string) => {
    ensure(30);
    y -= 10;
    page.drawText(label.toUpperCase(), { x: margin, y: y - 8, size: 8, font: bold, color: FOREST });
    y -= 14;
    page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 1, color: LIME });
    y -= 10;
  };

  // ---- Band header brand (halaman 1) ----
  const bandHeight = 168;
  page.drawRectangle({ x: 0, y: pageHeight - bandHeight, width: pageWidth, height: bandHeight, color: FOREST });
  y = pageHeight - 36;
  page.drawText('TanyaData', { x: margin, y: y - 12, size: 14, font: bold, color: PORCELAIN });
  const kindLabel = REPORT_KIND_LABEL[kind];
  const chipW = bold.widthOfTextAtSize(kindLabel, 8) + 16;
  page.drawRectangle({ x: pageWidth - margin - chipW, y: y - 14, width: chipW, height: 18, color: LIME });
  page.drawText(kindLabel, { x: pageWidth - margin - chipW + 8, y: y - 9, size: 8, font: bold, color: FOREST });
  y -= 44;
  for (const line of wrap(bold, 18, report.title, width)) {
    page.drawText(line, { x: margin, y: y - 18, size: 18, font: bold, color: PORCELAIN });
    y -= 24;
  }
  y -= 2;
  if (report.question) {
    for (const line of wrap(font, 9, `Pertanyaan penelitian: "${report.question}"`, width)) {
      page.drawText(line, { x: margin, y: y - 9, size: 9, font, color: rgb(0.75, 0.78, 0.74) });
      y -= 13;
    }
  }
  y -= 4;
  const meta = `${report.period ? formatDateLabel(report.period.start, report.period.end, lang) : 'n/a'}  |  ${report.dataset.name}  |  Dibuat ${formatDateLabel(report.createdAt.slice(0, 10), report.createdAt.slice(0, 10), lang)}`;
  for (const line of wrap(font, 8, meta, width)) {
    page.drawText(line, { x: margin, y: y - 8, size: 8, font, color: rgb(0.7, 0.73, 0.69) });
    y -= 11;
  }
  y = pageHeight - bandHeight - 24;

  // ---- Sorotan (insight deterministik) ----
  if (insights.length) {
    sectionLabel('Sorotan');
    for (const insight of insights) {
      ensure(20);
      page.drawCircle({ x: margin + 3, y: y - 4, size: 2, color: LIME });
      draw(insight, 9, false, INK, margin + 12, width - 12);
      y -= 4;
    }
  }

  // ---- Ringkasan ----
  sectionLabel('Ringkasan');
  draw(report.summary || 'n/a', 10);
  y -= 6;

  // ---- Metrik utama (grid KPI) - laporan analitik data ----
  if (kind === 'data-analytics' && report.metrics.length) {
    sectionLabel('Metrik Utama');
    const colW = (width - 8) / 2;
    for (let i = 0; i < report.metrics.length; i += 2) {
      ensure(56);
      const pair = report.metrics.slice(i, i + 2);
      const rowTop = y;
      pair.forEach((metric, j) => {
        const x = margin + j * (colW + 8);
        page.drawRectangle({ x, y: rowTop - 52, width: colW, height: 52, color: PORCELAIN, borderColor: rgb(0.85, 0.86, 0.84), borderWidth: 1 });
        page.drawText(metric.label, { x: x + 8, y: rowTop - 16, size: 8, font, color: MUTED });
        page.drawText(display(metric.value, metric.format, lang), { x: x + 8, y: rowTop - 38, size: 16, font: bold, color: FOREST });
      });
      y = rowTop - 60;
    }
  }

  // ---- Bar chart (kanal) - laporan analitik data ----
  const barViz = report.visualizations.find((viz) => viz.type === 'bar');
  if (kind === 'data-analytics' && barViz?.rows.length) {
    sectionLabel(barViz.title || 'Kinerja Kanal');
    const valueKey = barViz.dataKey ?? 'value';
    const labelKey = barViz.xKey ?? 'label';
    const rows = barViz.rows.slice(0, 6);
    const max = Math.max(1, ...rows.map((row) => Number(row[valueKey]) || 0));
    for (const row of rows) {
      ensure(22);
      const label = String(row[labelKey] ?? '-').slice(0, 28);
      const raw = Number(row[valueKey]) || 0;
      page.drawText(label, { x: margin, y: y - 9, size: 8, font: bold, color: INK });
      const barX = margin + 150;
      const barMaxW = width - 190;
      page.drawRectangle({ x: barX, y: y - 10, width: barMaxW, height: 10, color: PORCELAIN });
      page.drawRectangle({ x: barX, y: y - 10, width: Math.max(2, (raw / max) * barMaxW), height: 10, color: FOREST });
      const valueText = `${raw}${barViz.series[0]?.unit ?? ''}`;
      page.drawText(valueText, { x: barX + barMaxW + 6, y: y - 9, size: 8, font, color: MUTED });
      y -= 22;
    }
    y -= 6;
  }

  // ---- Temuan utama ----
  if (report.keyFindings.length) {
    sectionLabel('Temuan Utama');
    for (let i = 0; i < report.keyFindings.length; i++) {
      ensure(20);
      page.drawRectangle({ x: margin, y: y - 11, width: 14, height: 14, color: FOREST });
      page.drawText(String(i + 1), { x: margin + 4.5, y: y - 8, size: 8, font: bold, color: PORCELAIN });
      draw(report.keyFindings[i].text, 9, false, INK, margin + 20, width - 20);
      y -= 6;
    }
  }

  // ---- Bukti & sitasi - laporan riset dokumen ----
  if (kind === 'document-research') {
    const docSources = report.sources.filter((source) => source.kind === 'document' && Boolean(source.quote)).slice(0, 6);
    if (docSources.length) {
      sectionLabel('Bukti & Sitasi');
      for (const source of docSources) {
        const quote = source.quote ?? '';
        const quoteLines = wrap(font, 8.5, `"${quote.slice(0, 320)}"`, width - 10);
        ensure(quoteLines.length * 12 + 24);
        const metaLine = [source.docTitle ?? source.sourceId, source.section, source.page != null ? `hlm ${source.page}` : null].filter(Boolean).join(' | ');
        page.drawText(metaLine.slice(0, 110), { x: margin, y: y - 8, size: 7.5, font: bold, color: MUTED });
        y -= 12;
        page.drawRectangle({ x: margin, y: y - quoteLines.length * 12 - 4, width: 3, height: quoteLines.length * 12 + 4, color: LIME });
        for (const line of quoteLines) {
          page.drawText(line, { x: margin + 10, y: y - 8.5, size: 8.5, font, color: INK });
          y -= 12;
        }
        y -= 8;
      }
    }
  }

  // ---- Tabel pendukung (ringkas) ----
  if (kind === 'data-analytics' && report.supportingTable && report.supportingTable.rows.length) {
    sectionLabel('Tabel Pendukung');
    const table = report.supportingTable;
    const cols = table.columns.slice(0, 4);
    const colW = width / cols.length;
    ensure(20 + 14 * Math.min(table.rows.length, 10));
    ensure(46);
    page.drawRectangle({ x: margin, y: y - 16, width, height: 16, color: FOREST });
    cols.forEach((column, j) => {
      page.drawText(column.label.slice(0, 24), { x: margin + j * colW + 4, y: y - 11, size: 7.5, font: bold, color: PORCELAIN });
    });
    y -= 16;
    for (const row of table.rows.slice(0, 10)) {
      ensure(14);
      cols.forEach((column, j) => {
        const value = row[column.key];
        const text = value === null || value === undefined ? '-' : String(value).slice(0, 24);
        page.drawText(text, { x: margin + j * colW + 4, y: y - 9, size: 7.5, font, color: INK });
      });
      page.drawLine({ start: { x: margin, y: y - 12 }, end: { x: margin + width, y: y - 12 }, thickness: 0.5, color: rgb(0.85, 0.86, 0.84) });
      y -= 14;
    }
  }

  // ---- Footer copyright + nomor halaman di setiap halaman ----
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: margin, y: 34 }, end: { x: pageWidth - margin, y: 34 }, thickness: 0.5, color: rgb(0.85, 0.86, 0.84) });
    p.drawText(`© ${new Date(report.createdAt).getFullYear()} TanyaData - Dihasilkan otomatis dari sumber terverifikasi`, { x: margin, y: 22, size: 7, font, color: MUTED });
    const pageLabel = `Halaman ${i + 1} dari ${pages.length}`;
    p.drawText(pageLabel, { x: pageWidth - margin - font.widthOfTextAtSize(pageLabel, 7), y: 22, size: 7, font, color: MUTED });
  });

  return doc.save();
}
