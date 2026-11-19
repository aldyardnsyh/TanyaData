import type { DB } from '@/lib/db/client';
import { getWorkspaceDb } from '@/lib/db/client';
import type { MetaResponse } from '@/lib/contracts/http';
import { resolveScope, datasetChoices } from '@/lib/analytics/scope';
import { resolvePeriod } from '@/lib/analytics/period';
import { readSettingsState } from '@/lib/settings';
import { oneRow, num } from '@/lib/analytics/sql';
import { nowJakartaIso } from '@/lib/date';

function llmMode(): 'off' | 'assist' | 'full' {
  const value = (process.env.LLM_MODE ?? 'off').toLowerCase();
  return value === 'assist' || value === 'full' ? value : 'off';
}

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

  const mode = llmMode();

  return {
    app: { name: 'TanyaData', version: '1.0.0', build: process.env.BUILD_ID ?? 'local' },
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
      llm: mode !== 'off',
      llmMode: mode,
      rag: 'fts5',
      sql: 'sqlite',
    },
    generatedAt: nowJakartaIso(),
  };
}
