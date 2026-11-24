/** Penanda jujur untuk halaman yang tidak bisa dibaca text-layer/OCR. */
export type OcrMark = {
  used: boolean;
  skipped: boolean;
  confidence: number;
  reason?: string;
};

/**
 * Metadata layout hasil ekstraksi PDF. Dipakai untuk membuktikan urutan baca
 * dua kolom dan mendeteksi header/footer/tabel berulang (Fase 2A).
 */
export type LayoutInfo = {
  /** Jumlah kolom yang terdeteksi (1 = linear, 2 = dua kolom). */
  columns: number;
  /** Koordinat x (transform[4]) batas antar kolom; null bila linear. */
  columnSplitX: number | null;
  /** Strategi pengurutan item teks. */
  readingOrder: 'column' | 'linear';
  /** Baris header/footer berulang yang dibuang. */
  repeatedLines: string[];
  /** Nomor halaman yang terdeteksi dan dibuang dari badan teks. */
  pageNumber: number | null;
  /** Jumlah baris yang terdeteksi sebagai bagian tabel. */
  tables: number;
  /** Baris yang tampil bold/lebih besar — sinyal heading bila penomoran tidak konsisten. */
  headingLines?: string[];
};

/** Satu unit bukti (kalimat atau butir daftar) dengan offset relatif chunk. */
export type EvidenceUnit = {
  id: string;
  kind: 'sentence' | 'list_item';
  text: string;
  charStart: number;
  charEnd: number;
};

export type ExtractedPage = {
  page: number;
  text: string;
  ocr?: OcrMark;
  /** Baris dalam urutan baca final (kolom kiri dulu, lalu kanan). */
  readingOrder?: string[];
  layout?: LayoutInfo;
};

export type ExtractedSection = {
  no: number | null;
  title: string;
  page: number | null;
  text: string;
  ocr?: OcrMark;
  /** ID bagian stabil (hash judul + ordinal), bukan regex khusus dokumen. */
  sectionId?: string;
  /** Null diperbolehkan: halaman OCR/legacy tidak punya urutan baca geometris. */
  readingOrder?: string[] | null;
  layout?: LayoutInfo | null;
};

export type ExtractedDocumentJson = {
  id: string;
  title: string;
  file: string;
  format: string;
  sizeBytes?: number;
  pages: ExtractedPage[];
  sections: ExtractedSection[];
};

export type DocumentsJson = {
  version: number;
  generatedAt: string;
  documents: ExtractedDocumentJson[];
};

export type DocumentChunk = {
  sectionNo: number | null;
  section: string | null;
  page: number | null;
  chunkIndex: number;
  content: string;
  charCount: number;
  /** true bila halaman asal gagal dibaca → confidence rendah, jujur di UI. */
  ocrSkipped?: boolean;
  confidence?: number;
  /** Indeks seksi asal di array input; dipakai adapter untuk metadata OCR. */
  sourceSectionIndex?: number | null;
  /** ID bagian stabil (mis. `KB03#2`). */
  sectionId?: string | null;
  /** Hash per bagian untuk idempotensi re-index. */
  sectionHash?: string | null;
  /** Unit bukti (kalimat/butir) dengan offset relatif terhadap `content`. */
  units?: EvidenceUnit[];
  /** Offset chunk terhadap teks bagian asal. */
  charStart?: number | null;
  charEnd?: number | null;
  /** Urutan baca baris pada halaman asal. */
  readingOrder?: string[] | null;
  layout?: LayoutInfo | null;
};

export function docSourceId(docId: string): string {
  return `src_${docId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)}`;
}
