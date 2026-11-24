import type { DB } from '@/lib/db/client';
import { getWorkspaceDb } from '@/lib/db/client';
import type { MetaResponse } from '@/lib/contracts/http';
import { resolveScope, datasetChoices } from '@/lib/analytics/scope';
import { resolvePeriod } from '@/lib/analytics/period';
import { readSettingsState } from '@/lib/settings';
import { oneRow, num } from '@/lib/analytics/sql';
import { nowJakartaIso } from '@/lib/date';
import { deriveSystemRuntime } from '@/lib/meta/runtime';
import { buildSystemPayload } from '@/lib/meta/system';
import pkg from '../package.json';

export function getMeta(db: DB = getWorkspaceDb()): MetaResponse {
  const state = readSettingsState(db);
  const scope = resolveScope(state.activeDatasetId, db);
  const period = resolvePeriod({ period: 'this_month' }, { minDate: scope.ref.minDate, maxDate: scope.ref.maxDate }, state.lang);

  const docsTotal = oneRow(db, "SELECT COUNT(*) AS n FROM data_sources WHERE kind = 'document'");
  const docsReady = oneRow(db, "SELECT COUNT(*) AS n FROM data_sources WHERE kind = 'document' AND status = 'READY'");
  const chunks = oneRow(db, 'SELECT COUNT(*) AS n FROM document_chunks');
  const tables = oneRow(
    db,
    "SELECT COUNT(*) AS n FROM data_sources WHERE kind = 'dataset' AND status = 'READY'",
  );

  // META-01: status runtime diturunkan dari env + helper jalur query, bukan
  // string mati. `capabilities.rag` = mode EFEKTIF, karena itulah yang dialami
  // pengguna (API_CONTRACT §9.3.1).
  const runtime = deriveSystemRuntime();

  return {
    app: { name: 'TanyaData', version: pkg.version, build: process.env.BUILD_ID ?? 'local' },
    data: {
      activeDataset: { ...scope.ref, tables: num(tables?.n) },
      periodDefaults: {
        start: period.start,
        end: period.end,
        label: period.label,
        isPartial: period.isPartial,
      },
      documents: {
        total: num(docsTotal?.n),
        indexed: num(docsReady?.n),
        chunks: num(chunks?.n),
      },
      datasetChoices: datasetChoices(db),
    },
    capabilities: {
      llm: runtime.llm.enabled,
      llmMode: runtime.llm.mode,
      rag: runtime.effectiveRetrieval,
      sql: 'sqlite',
    },
    generatedAt: nowJakartaIso(),
    system: buildSystemPayload(runtime),
  };
}
