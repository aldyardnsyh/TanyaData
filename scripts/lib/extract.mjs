import fs from 'node:fs';
import path from 'node:path';

export const DOCS_DIR = path.join(process.cwd(), 'data', 'seed', 'documents');
export const GENERATED_DIR = path.join(process.cwd(), 'data', 'generated');
export const DOCUMENTS_JSON = path.join(GENERATED_DIR, 'documents.json');

/**
 * Anti-kebocoran: indeks HANYA boleh berasal dari PDF. OCR on-demand dipakai
 * bila diaktifkan; bila tidak, dokumen image-only ditandai jujur dan tidak
 * boleh memakai transkrip `corpus_sections` GT sebagai pengganti teks PDF.
 */
export const OCR_AVAILABLE =
  process.env.OCR_ENABLED === 'true' && Boolean(process.env.OCR_ENDPOINT);

export const DOC_META = [
  {
    id: 'catatan-insiden-okt-nov-2026',
    file: 'Catatan_Insiden_Okt-Nov_2026.txt',
    title: 'Catatan Insiden Operasional Okt-Nov 2026',
    format: 'txt',
    kind: 'incident_log',
  },
  {
    id: 'faq-customer-support',
    file: 'FAQ_Customer_Support.md',
    title: 'FAQ Customer Support - Transaksi Gagal',
    format: 'md',
    kind: 'faq',
  },
  {
    id: 'katalog-kode-kegagalan',
    file: 'Katalog_Kode_Kegagalan_Transaksi.docx',
    title: 'Katalog Kode Kegagalan Transaksi dan Panduan Diagnosis',
    format: 'docx',
    kind: 'catalog',
  },
  {
    id: 'laporan-operasional-2026-09',
    file: 'Laporan_Operasional_2026-09.pdf',
    title: 'Laporan Operasional Bulanan - September 2026',
    format: 'pdf',
    kind: 'monthly_report',
  },
  {
    id: 'laporan-operasional-2026-10',
    file: 'Laporan_Operasional_2026-10.pdf',
    title: 'Laporan Operasional Bulanan - Oktober 2026',
    format: 'pdf',
    kind: 'monthly_report',
  },
  {
    id: 'sop-trx-003',
    file: 'SOP-TRX-003_Penanganan_Transaksi_Gagal.pdf',
    title: 'SOP-TRX-003 Penanganan Transaksi Gagal',
    format: 'pdf',
    kind: 'sop',
  },
  // --- DECISION-033: dataset kb-sop (4 PDF SOP layanan) --------------------
  // KB01/KB04 adalah PDF image-only tanpa text layer. Sumber ingest SELALU
  // PDF asli. Bila OCR tidak tersedia, keduanya ditandai `ocr_unavailable` +
  // `needsReview` dan TIDAK diisi dari `corpus_sections` GT (hanya validasi).
  {
    id: 'kb-01-penanganan-tiket-layanan',
    file: 'KB_01_Penanganan_Tiket_Layanan.pdf',
    title: 'KB-01 Penanganan Tiket Layanan',
    format: 'pdf',
    kind: 'sop',
    dataset: 'kb-sop',
    ingestMode: OCR_AVAILABLE ? 'pdf_ocr' : 'ocr_unavailable',
    needsReview: true,
  },
  {
    id: 'kb-02-pengelolaan-keluhan-pelanggan',
    file: 'KB_02_Pengelolaan_Keluhan_Pelanggan.pdf',
    title: 'KB-02 Pengelolaan Keluhan Pelanggan',
    format: 'pdf',
    kind: 'sop',
    dataset: 'kb-sop',
    ingestMode: 'pdf_text',
  },
  {
    id: 'kb-03-panduan-operasional-layanan',
    file: 'KB_03_Panduan_Operasional_Layanan.pdf',
    title: 'KB-03 Panduan Operasional Layanan',
    format: 'pdf',
    kind: 'sop',
    dataset: 'kb-sop',
    ingestMode: 'pdf_text',
  },
  {
    id: 'kb-04-eskalasi-dan-insiden',
    file: 'KB_04_Eskalasi_dan_Insiden.pdf',
    title: 'KB-04 Eskalasi dan Insiden',
    format: 'pdf',
    kind: 'sop',
    dataset: 'kb-sop',
    ingestMode: OCR_AVAILABLE ? 'pdf_ocr' : 'ocr_unavailable',
    needsReview: true,
  },
  // --- Fixture eval:extraction-gt (src_6a30b004) ---------------------------
  // GT tidak diubah. PDF ini adalah sumber teks untuk pipeline ekstraksi yang
  // diukur eval; sebelumnya hilang dari workspace sehingga eval FAIL.
  {
    id: '6a30b004',
    file: 'Perpres_76_2013.pdf',
    title: 'Perpres No. 76 Tahun 2013 tentang Pengelolaan Pengaduan Pelayanan Publik',
    format: 'pdf',
    kind: 'legal_fixture',
    dataset: 'eval-fixture',
    ingestMode: 'pdf_text',
  },
];

const PAGE_ARTIFACT = /dokumen dummy untuk technical test ai engineer halaman \d+/i;

export function cleanLine(line) {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  if (PAGE_ARTIFACT.test(trimmed)) {
    const rest = trimmed.replace(PAGE_ARTIFACT, '').trim();
    return rest.length > 3 ? rest : '';
  }
  return trimmed;
}

export async function readPdfLines(file) {
  const { getDocumentProxy } = await import('unpdf');
  const buffer = new Uint8Array(fs.readFileSync(file));
  const pdf = await getDocumentProxy(buffer);
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      text += item.str;
      if (item.hasEOL) text += '\n';
    }
    pages.push({ page: i, text });
  }
  return pages;
}

export async function readDocxText(file) {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: fs.readFileSync(file) });
  return result.value;
}

const NUMBERED_HEADING = /^(\d{1,2})\.\s+([A-Z0-9][^.]{1,79})$/;

function numberedSections(lines, fallbackTitle) {
  const sections = [];
  let current = null;

  const start = (no, title, page) => {
    current = { no, title, page, lines: [] };
    sections.push(current);
  };

  for (const { text, page } of lines) {
    const line = cleanLine(text);
    if (!line) continue;
    const match = NUMBERED_HEADING.exec(line);
    if (match) {
      start(Number(match[1]), match[2].trim(), page);
      continue;
    }
    if (!current) start(null, fallbackTitle, page);
    current.lines.push(line);
  }

  return sections
    .map((s) => ({
      no: s.no,
      title: s.title,
      page: s.page,
      text: s.lines.join('\n').trim(),
    }))
    .filter((s) => s.text.length > 0 || s.no !== null);
}

function markdownSections(text) {
  const sections = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^#{1,2}\s+/.test(line)) {
      const title = line.replace(/^#{1,2}\s+/, '').trim();
      const numbered = /^(\d+)\.\s+(.*)$/.exec(title);
      current = {
        no: numbered ? Number(numbered[1]) : null,
        title: numbered ? numbered[2] : title,
        page: 1,
        lines: [],
      };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { no: null, title: 'Ikhtisar', page: 1, lines: [] };
      sections.push(current);
    }
    if (line) current.lines.push(line);
  }
  return sections
    .map((s) => ({ no: s.no, title: s.title, page: s.page, text: s.lines.join('\n').trim() }))
    .filter((s) => s.text.length > 0);
}

/** TXT insiden: blok dipisah garis `=====`, header = baris INC + metadata. */
function incidentSections(text, fallbackTitle) {
  const blocks = text
    .split(/\n={10,}\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const sections = [];
  let index = 0;

  if (blocks.length <= 1) {
    return numberedSections(
      text.split('\n').map((t) => ({ text: t, page: 1 })),
      fallbackTitle,
    );
  }

  const preamble = blocks[0].split('\n').filter(Boolean);
  sections.push({ no: null, title: fallbackTitle, page: 1, text: preamble.join('\n') });

  while (index + 1 < blocks.length + 1) {
    const header = blocks[index + 1] ?? '';
    const body = blocks[index + 2] ?? '';
    if (!header) break;
    const headerLines = header.split('\n').map((l) => l.trim()).filter(Boolean);
    const titleLine = headerLines[0] ?? `Bagian ${index + 1}`;
    const metaLine = headerLines.slice(1).join(' ') || null;
    const bodyLines = [metaLine, body].filter(Boolean).join('\n');
    sections.push({
      no: null,
      title: titleLine,
      page: 1,
      text: bodyLines,
    });
    index += 2;
  }

  return sections.filter((s) => s.text.trim().length > 0);
}

async function extractDocumentBase(meta) {
  const file = path.join(DOCS_DIR, meta.file);
  if (!fs.existsSync(file)) {
    throw new Error(`Dokumen tidak ditemukan: ${meta.file}`);
  }
  const sizeBytes = fs.statSync(file).size;

  if (meta.format === 'pdf') {
    const pages = await readPdfLines(file);
    const lines = pages.flatMap((p) => p.text.split('\n').map((text) => ({ text, page: p.page })));
    const sections = numberedSections(lines, meta.title);
    return {
      id: meta.id,
      title: meta.title,
      file: meta.file,
      format: meta.format,
      kind: meta.kind,
      sizeBytes,
      pages: pages.map((p) => ({
        page: p.page,
        text: p.text
          .split('\n')
          .map(cleanLine)
          .filter(Boolean)
          .join('\n'),
      })),
      sections,
    };
  }

  const raw =
    meta.format === 'docx' ? await readDocxText(file) : fs.readFileSync(file, 'utf8');

  if (meta.format === 'md') {
    return {
      id: meta.id,
      title: meta.title,
      file: meta.file,
      format: meta.format,
      kind: meta.kind,
      sizeBytes,
      pages: [{ page: 1, text: raw }],
      sections: markdownSections(raw),
    };
  }

  if (meta.id.startsWith('catatan-insiden')) {
    const sections = incidentSections(raw, meta.title);
    return {
      id: meta.id,
      title: meta.title,
      file: meta.file,
      format: meta.format,
      kind: meta.kind,
      sizeBytes,
      pages: [{ page: 1, text: raw }],
      sections,
    };
  }

  const lines = raw.split('\n').map((text) => ({ text, page: 1 }));
  return {
    id: meta.id,
    title: meta.title,
    file: meta.file,
    format: meta.format,
    kind: meta.kind,
    sizeBytes,
    pages: [{ page: 1, text: raw }],
    sections: numberedSections(lines, meta.title),
  };
}

/**
 * Bungkus hasil ekstraksi dengan metadata asal yang jujur. `ingestMode` dan
 * `needsReview` dipakai seed script dan UI untuk menandai PDF image-only yang
 * tidak bisa dibaca tanpa OCR. Teks GT TIDAK pernah dipakai sebagai pengganti
 * teks PDF — GT hanya untuk validasi.
 */
export async function extractDocument(meta) {
  const doc = await extractDocumentBase(meta);
  return {
    ...doc,
    ...(meta.dataset ? { dataset: meta.dataset } : {}),
    ...(meta.ingestMode ? { ingestMode: meta.ingestMode } : {}),
    ...(meta.needsReview ? { needsReview: true } : {}),
  };
}

export async function extractAll() {
  const documents = [];
  const warnings = [];
  for (const meta of DOC_META) {
    try {
      const doc = await extractDocument(meta);
      const chars = doc.sections.reduce((sum, s) => sum + s.text.length, 0);
      if (chars < 200) warnings.push(`${meta.file}: hanya ${chars} karakter terdeteksi`);
      documents.push(doc);
    } catch (error) {
      warnings.push(`${meta.file}: ${error?.message ?? error}`);
    }
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    documents,
    warnings,
  };
}

export function writeDocumentsJson(payload) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(DOCUMENTS_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return DOCUMENTS_JSON;
}
