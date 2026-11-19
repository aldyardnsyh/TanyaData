import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import type { ReportDetail, SupportingTable } from '@/lib/contracts/http';
import { formatDateLabel, formatNumber, formatPercent, formatCurrency } from '@/lib/date';

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

export async function reportToPdf(report: ReportDetail): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lang: 'id' | 'en' = 'id';

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 48;
  const width = pageWidth - margin * 2;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  const ensure = (height: number) => {
    if (y - height < margin) newPage();
  };

  const draw = (text: string, size: number, useBold = false, color = rgb(0, 0, 0)) => {
    const lines = wrap(useBold ? bold : font, size, text, width);
    const lineHeight = size * 1.4;
    for (const line of lines) {
      ensure(lineHeight);
      page.drawText(line, { x: margin, y: y - size, size, font: useBold ? bold : font, color });
      y -= lineHeight;
    }
  };

  draw(report.title, 18, true);
  y -= 4;
  draw(
    `${report.period ? formatDateLabel(report.period.start, report.period.end, lang) : 'n/a'}  ·  ${report.dataset.name}`,
    9,
  );
  draw(`TanyaData · ${report.createdAt}`, 8);
  y -= 10;

  draw('Ringkasan', 12, true);
  draw(report.summary || 'n/a', 10);
  y -= 6;

  if (report.keyFindings.length) {
    draw('Temuan Utama', 12, true);
    for (const finding of report.keyFindings) draw(`• ${finding.text}`, 10);
    y -= 6;
  }

  if (report.metrics.length) {
    draw('Metrik', 12, true);
    for (const metric of report.metrics) {
      draw(`${metric.label}: ${display(metric.value, metric.format, lang)}`, 10);
    }
    y -= 6;
  }

  if (report.supportingTable && report.supportingTable.rows.length) {
    draw('Tabel Pendukung', 12, true);
    for (const row of report.supportingTable.rows.slice(0, 40)) {
      const line = report.supportingTable.columns
        .map((c) => `${c.label}=${row[c.key] ?? 'n/a'}`)
        .join('  |  ');
      draw(line, 8);
    }
    y -= 6;
  }

  if (report.sources.length) {
    draw('Sitasi', 12, true);
    for (const source of report.sources) {
      const label =
        source.kind === 'document'
          ? `${source.docTitle ?? source.sourceId}${source.section ? ` — ${source.section}` : ''}`
          : `${source.sourceId}${source.table ? ` (${source.table})` : ''} ${source.period ?? ''}`;
      draw(label, 8);
      if (source.quote) draw(`"${source.quote.slice(0, 300)}"`, 8);
    }
  }

  return doc.save();
}
