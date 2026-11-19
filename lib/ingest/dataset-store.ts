import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { UPLOADS_DIR } from '@/lib/db/paths';
import { unprocessable } from '@/lib/errors';

declare global {
  // eslint-disable-next-line no-var
  var __tanyadataAttached: Map<string, string> | undefined;
}

export function datasetDbPath(sourceId: string): string {
  const safe = sourceId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(UPLOADS_DIR, `${safe}.db`);
}

function aliasRegistry(): Map<string, string> {
  if (!globalThis.__tanyadataAttached) globalThis.__tanyadataAttached = new Map();
  return globalThis.__tanyadataAttached;
}

export function attachDataset(db: Database.Database, sourceId: string): string {
  const registry = aliasRegistry();
  const existing = registry.get(sourceId);
  if (existing) return existing;

  const file = datasetDbPath(sourceId);
  if (!fs.existsSync(file)) {
    throw unprocessable(`Dataset ${sourceId} tidak ditemukan di storage`);
  }

  let attempt = 0;
  const base = `ds_${sourceId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'upload'}`;
  let alias = base;
  const attachedNames = new Set(registry.values());
  while (attachedNames.has(alias)) {
    attempt += 1;
    alias = `${base}_${attempt}`;
  }

  db.prepare(`ATTACH DATABASE ? AS ${alias}`).run(file);
  registry.set(sourceId, alias);
  return alias;
}

export function detachDataset(db: Database.Database, sourceId: string): void {
  const registry = aliasRegistry();
  const alias = registry.get(sourceId);
  if (!alias) return;
  try {
    db.exec(`DETACH DATABASE ${alias}`);
  } finally {
    registry.delete(sourceId);
  }
}

export function resetAttachmentRegistry(): void {
  globalThis.__tanyadataAttached = new Map();
}
