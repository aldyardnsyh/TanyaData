import type { SourceCitation } from '@/lib/contracts/http';

/**
 * Path workspace untuk sebuah sitasi dokumen: membuka halaman detail sumber
 * dengan parameter `cite` (chunk + halaman + bagian) sehingga potongan yang
 * dirujuk bisa di-highlight langsung. Null bila sitasi tidak cukup spesifik
 * untuk ditautkan (mis. sitasi dataset) — pemanggil fallback ke drawer.
 */
export function citationTargetPath(citation: SourceCitation): string | null {
  if (citation.kind !== 'document' || !citation.sourceId) return null;
  if (citation.chunkId == null && citation.page == null && !citation.section) return null;
  const params = new URLSearchParams();
  if (citation.chunkId != null) params.set('chunk', String(citation.chunkId));
  if (citation.page != null) params.set('page', String(citation.page));
  if (citation.section) params.set('section', citation.section);
  return `/data-sources/${citation.sourceId}?cite=${encodeURIComponent(params.toString())}`;
}

/** Parse nilai parameter `cite` kembali menjadi komponennya. */
export function parseCiteParam(raw: string | null): { chunk: number | null; page: number | null; section: string | null } {
  if (!raw) return { chunk: null, page: null, section: null };
  try {
    const params = new URLSearchParams(raw);
    const chunk = Number(params.get('chunk'));
    const page = Number(params.get('page'));
    return {
      chunk: Number.isInteger(chunk) && chunk > 0 ? chunk : null,
      page: Number.isInteger(page) && page > 0 ? page : null,
      section: params.get('section'),
    };
  } catch {
    return { chunk: null, page: null, section: null };
  }
}
