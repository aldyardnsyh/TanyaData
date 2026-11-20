/**
 * TanyaData AI — readjustment intent → deterministic operations (P3-CORE-V2).
 *
 * Source: docs/CORE_V2_SPEC.md §3 (FR-B.1), docs/CORE_V2_ARCHITECTURE.md §3/ADR-12,
 * docs/RAG_ROBUSTNESS_RESEARCH.md §6. A readjustment ("cuma bagian X",
 * "group by Y", "klasifikasikan Z", "buatkan report") is translated by regex
 * into a `ReadjustmentOp` resolved against the ACTIVE registry. No LLM chooses
 * a filter, a column, a category, or an output type — that would be
 * non-deterministic and unauditable.
 *
 * COORDINATION NOTE (honest): the backend owns `lib/core/contracts.ts` and that
 * file is intentionally NOT edited here. As of this commit it does not yet
 * declare `ReadjustmentOp`; the interface below is a structural mirror of the
 * contract in docs/CORE_V2_ARCHITECTURE.md §5. Once backend lands the type,
 * this module should re-export it instead of declaring it locally.
 */
import type { SchemaJson } from '@/lib/core/contracts';

export type ReadjustmentOpType = 'filter' | 'group_by' | 'classify' | 'report';

/** Structural mirror of the backend `ReadjustmentOp` contract (append-only). */
export interface ReadjustmentOp {
  /** Append-only sequence within one conversation; two ops = two rows. */
  seq: number;
  op_type: ReadjustmentOpType;
  input_fragment: string;
  resolved_filters?: Record<string, string | number>;
  resolved_columns?: string[];
  categories?: Array<string | number>;
  /** Where the numbers come from. Never an LLM free-form value. */
  source?: 'result_json' | 'schema_json' | 'section_registry';
  before_json?: unknown;
  after_json?: unknown;
  reason: string;
  needs_clarification?: boolean;
  valid_options?: string[];
}

export interface ReadjustmentRegistry {
  /** Whitelisted SQL column names (from schema_json). */
  columns: string[];
  /** Valid section_path values (from the active document registry). */
  sectionPaths: string[];
  /** Valid document ids (source_id, immutable). */
  docIds: string[];
  /** column → values that actually occur in data/schema. No invented labels. */
  enumValues?: Record<string, Array<string | number>>;
}

export interface ReadjustmentPlan {
  ops: ReadjustmentOp[];
  needs_clarification: boolean;
  valid_columns: string[];
  reason: string;
}

/** Derive a registry from the backend SchemaJson without modifying it. */
export function registryFromSchema(
  schema: SchemaJson | null | undefined,
  sectionPaths: string[] = [],
  docIds: string[] = [],
): ReadjustmentRegistry {
  const columns: string[] = [];
  const enumValues: Record<string, Array<string | number>> = {};
  for (const table of schema?.tables ?? []) {
    for (const col of table.columns ?? []) {
      if (!columns.includes(col.name)) columns.push(col.name);
      const values = (col.sample_values ?? []).filter(
        (v): v is string | number => typeof v === 'string' || typeof v === 'number',
      );
      if (values.length) enumValues[col.name] = values;
    }
  }
  for (const [key, values] of Object.entries(schema?.enums ?? {})) {
    if (Array.isArray(values)) enumValues[key] = values;
  }
  return { columns, sectionPaths, docIds, enumValues };
}

type Candidate = { index: number; op: Omit<ReadjustmentOp, 'seq'> };

function canonicalColumn(raw: string, columns: string[]): string | null {
  const needle = raw.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^\w]/g, '');
  return columns.find((c) => c.toLowerCase().replace(/[^\w]/g, '') === needle) ?? null;
}

function matchRegistryValue(raw: string, values: string[]): string | null {
  const needle = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  return values.find((v) => v.toLowerCase().replace(/\s+/g, ' ').trim() === needle)
    ?? values.find((v) => v.toLowerCase().includes(needle) || needle.includes(v.toLowerCase()))
    ?? null;
}

/**
 * Detect every readjustment phrase in the question, resolve each against the
 * registry, and return ops in the order the user wrote them. Unknown columns
 * or sections produce `needs_clarification` with the valid options — never a
 * guessed column, category, or number.
 */
export function detectReadjustment(question: string, registry: ReadjustmentRegistry): ReadjustmentPlan {
  const q = String(question ?? '');
  const columns = registry.columns ?? [];
  const candidates: Candidate[] = [];

  // 1) "cuma/hanya bagian X" → filter section_path / page / doc_id.
  const sectionRe = /(?:cuma|hanya|khusus|tampilkan\s+saja|batasi)\s+(?:tampilkan\s+)?(?:bagian\s+)?(pasal\s*\d+(?:\s*\/\s*ayat\s*\(?\d+\)?)?)/gi;
  for (const m of q.matchAll(sectionRe)) {
    const target = m[1].trim();
    const resolved = matchRegistryValue(target, registry.sectionPaths ?? []);
    candidates.push({
      index: m.index ?? 0,
      op: resolved
        ? {
            op_type: 'filter',
            input_fragment: m[0],
            resolved_filters: { section_path: resolved },
            source: 'section_registry',
            before_json: { sectionPaths: registry.sectionPaths },
            after_json: { section_path: resolved },
            reason: `Dibatasi ke bagian "${resolved}" yang terdaftar di registry.`,
          }
        : {
            op_type: 'filter',
            input_fragment: m[0],
            source: 'section_registry',
            needs_clarification: true,
            valid_options: (registry.sectionPaths ?? []).slice(0, 8),
            reason: `Bagian "${target}" tidak ada di registry; tidak mengarang bagian.`,
          },
    });
  }

  const pageRe = /(?:cuma|hanya|khusus|batasi)\s+(?:tampilkan\s+)?halaman\s*(\d+)/gi;
  for (const m of q.matchAll(pageRe)) {
    const page = Number(m[1]);
    candidates.push({
      index: m.index ?? 0,
      op: {
        op_type: 'filter',
        input_fragment: m[0],
        resolved_filters: { page },
        source: 'section_registry',
        before_json: { scope: 'all_pages' },
        after_json: { page },
        reason: `Dibatasi ke halaman ${page}.`,
      },
    });
  }

  const docRe = /(?:cuma|hanya|khusus|batasi)\s+(?:tampilkan\s+)?(?:dokumen|doc)\s+([\w.-]+)/gi;
  for (const m of q.matchAll(docRe)) {
    const resolved = matchRegistryValue(m[1], registry.docIds ?? []);
    candidates.push({
      index: m.index ?? 0,
      op: resolved
        ? {
            op_type: 'filter',
            input_fragment: m[0],
            resolved_filters: { doc_id: resolved },
            source: 'section_registry',
            after_json: { doc_id: resolved },
            reason: `Dibatasi ke dokumen "${resolved}" yang terdaftar.`,
          }
        : {
            op_type: 'filter',
            input_fragment: m[0],
            source: 'section_registry',
            needs_clarification: true,
            valid_options: (registry.docIds ?? []).slice(0, 8),
            reason: `Dokumen "${m[1]}" tidak ada di registry; tidak mengarang dokumen.`,
          },
    });
  }

  // 2) "group by Y" / "kelompokkan per Y" → whitelisted GROUP BY column.
  const groupRe = /(?:group\s+by|kelompokkan\s+(?:per|berdasarkan)|dikelompokkan\s+(?:per|berdasarkan)|grup\s+per)\s+([\w]+)/gi;
  for (const m of q.matchAll(groupRe)) {
    const col = canonicalColumn(m[1], columns);
    candidates.push({
      index: m.index ?? 0,
      op: col
        ? {
            op_type: 'group_by',
            input_fragment: m[0],
            resolved_columns: [col],
            source: 'schema_json',
            before_json: { groupBy: null },
            after_json: { groupBy: col },
            reason: `Agregasi dibuat ulang dengan GROUP BY "${col}" dari skema aktif.`,
          }
        : {
            op_type: 'group_by',
            input_fragment: m[0],
            source: 'schema_json',
            needs_clarification: true,
            valid_options: columns.slice(0, 10),
            reason: `Kolom "${m[1]}" tidak ada di schema_json; tidak mengarang kolom.`,
          },
    });
  }

  // 3) "klasifikasikan Z" → categories from real data/schema values only.
  const classifyRe = /klasifikasikan\s+([\w]+)/gi;
  for (const m of q.matchAll(classifyRe)) {
    const col = canonicalColumn(m[1], columns);
    const categories = col ? (registry.enumValues?.[col] ?? []) : [];
    candidates.push({
      index: m.index ?? 0,
      op: col && categories.length
        ? {
            op_type: 'classify',
            input_fragment: m[0],
            resolved_columns: [col],
            categories,
            source: 'schema_json',
            before_json: { labels: null },
            after_json: { column: col, categories },
            reason: `Kategori diambil dari nilai "${col}" yang benar-benar ada di data/skema.`,
          }
        : {
            op_type: 'classify',
            input_fragment: m[0],
            source: 'schema_json',
            needs_clarification: true,
            valid_options: col ? [] : columns.slice(0, 10),
            reason: col
              ? `Kolom "${col}" tidak punya nilai terdaftar; tidak mengarang kategori.`
              : `Kolom "${m[1]}" tidak ada di schema_json; tidak mengarang kategori.`,
          },
    });
  }

  // 4) "buatkan report / ringkas jadi tabel" → report op sourced from result_json.
  const reportRe = /(?:buatkan|ringkas|unduh|ekspor|export)\s+(?:sebuah\s+)?(?:report|laporan|tabel|pdf|excel|ringkasan)|\b(report|laporan)\b/gi;
  const reportMatch = reportRe.exec(q);
  if (reportMatch) {
    const format = /excel|xlsx|\bxls\b/i.test(q) ? 'xlsx' : /pdf/i.test(q) ? 'pdf' : 'pdf+xlsx';
    candidates.push({
      index: reportMatch.index ?? 0,
      op: {
        op_type: 'report',
        input_fragment: reportMatch[0],
        source: 'result_json',
        before_json: { report: null },
        after_json: { format, from: 'result_json' },
        reason: 'Report disusun dari result_json yang sudah ada; tidak mengulang OCR/SQL dan tidak menulis angka baru.',
      },
    });
  }

  if (!candidates.length) {
    return { ops: [], needs_clarification: false, valid_columns: columns, reason: 'Bukan permintaan readjustment.' };
  }

  const ops = candidates
    .sort((a, b) => a.index - b.index || (a.op.op_type < b.op.op_type ? -1 : 1))
    .map((c, i) => ({ ...c.op, seq: i + 1 }));

  return {
    ops,
    needs_clarification: ops.some((o) => o.needs_clarification === true),
    valid_columns: columns,
    reason: ops.map((o) => o.reason).join(' '),
  };
}
