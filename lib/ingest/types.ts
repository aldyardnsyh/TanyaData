export type ExtractedPage = { page: number; text: string };

export type ExtractedSection = {
  no: number | null;
  title: string;
  page: number | null;
  text: string;
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
};

export function docSourceId(docId: string): string {
  return `src_${docId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)}`;
}
