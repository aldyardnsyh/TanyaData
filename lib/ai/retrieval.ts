/**
 * TanyaData AI — retrieval dokumen (lib/ai/retrieval.ts).
 *
 * FTS5 `document_chunks_fts` + fallback LIKE. Query expansion sinonim
 * (via normalize.ts). Top 3–5 chunk. Sitasi wajib:
 * {kind:'document', sourceId, docTitle, sectionNo, section, page, quote, chunkId, score}.
 */
import type { DB } from '@/lib/db/client';
import type { Lang, SourceCitation } from '@/lib/contracts/http';
import { allRows, num, str } from '@/lib/analytics/sql';
import { normalizeText, stopwordTokens } from '@/lib/ai/normalize';
import { truncateText } from '@/lib/date';

const MAX_TERMS = 12;

function ftsTerms(question: string): string[] {
  const q = normalizeText(question);
  return stopwordTokens(q).filter((t) => t.length >= 3).slice(0, MAX_TERMS);
}

function toCitation(row: Record<string, unknown>): SourceCitation {
  const rawScore = row.score;
  const score =
    typeof rawScore === 'number' && Number.isFinite(rawScore)
      ? Math.round((1 / (1 + Math.abs(rawScore))) * 1000) / 1000
      : undefined;
  return {
    kind: 'document',
    sourceId: str(row.source_id),
    docTitle: str(row.doc_title),
    sectionNo: row.section_no === null || row.section_no === undefined ? null : num(row.section_no),
    section: str(row.section) || null,
    page: row.page === null || row.page === undefined ? null : num(row.page),
    quote: truncateText(str(row.content).replace(/\s+/g, ' '), 240),
    chunkId: num(row.id),
    ...(score === undefined ? {} : { score }),
  };
}

function likeQuery(terms: string[], requireAll: boolean): string {
  const conds = terms.map(() => 'c.content LIKE ?');
  return `SELECT c.id, c.source_id, c.doc_title, c.section_no, c.section, c.page, c.content
            FROM document_chunks c
           WHERE ${conds.join(requireAll ? ' AND ' : ' OR ')}
           LIMIT 500`;
}

export function retrieveDocuments(db: DB, question: string, lang: Lang): SourceCitation[] {
  const terms = ftsTerms(question);
  if (!terms.length) return [];

  // 1) FTS5 MATCH dengan OR
  const match = terms.map((t) => `"${t}"`).join(' OR ');
  try {
    const rows = allRows(
      db,
      `SELECT c.id, c.source_id, c.doc_title, c.section_no, c.section, c.page, c.content, bm25(document_chunks_fts) AS score
         FROM document_chunks_fts f
         JOIN document_chunks c ON c.id = f.rowid
        WHERE document_chunks_fts MATCH ?
        ORDER BY score
        LIMIT 5`,
      [match],
    );
    if (rows.length) return rows.map(toCitation);
  } catch {
    // fallback ke LIKE
  }

  // 2) LIKE fallback: AND antar-term, lalu OR
  for (const requireAll of [true, false]) {
    try {
      const rows = allRows(db, likeQuery(terms, requireAll), terms.map((t) => `%${t}%`));
      if (rows.length) return rows.slice(0, 5).map(toCitation);
    } catch {
      // lanjut
    }
  }
  return [];
}
