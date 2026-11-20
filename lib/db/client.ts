import Database from 'better-sqlite3';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  CORE_SCHEMA_SQL,
  SCHEMA_SQL,
  WORKSPACE_DB,
  ensureDirs,
  resolveSeedDb,
} from '@/lib/db/paths';

export type DB = Database.Database;

declare global {
  // eslint-disable-next-line no-var
  var __tanyadataDb: DB | undefined;
  // eslint-disable-next-line no-var
  var __tanyadataSchemaApplied: boolean | undefined;
}

let attached = false;
let attachMode: 'uri' | 'plain' | 'unavailable' = 'unavailable';

function applySchema(db: DB): void {
  if (globalThis.__tanyadataSchemaApplied) return;
  db.exec(fs.readFileSync(SCHEMA_SQL, 'utf8'));
  db.exec(fs.readFileSync(CORE_SCHEMA_SQL, 'utf8'));
  globalThis.__tanyadataSchemaApplied = true;
}

function attachSeed(db: DB): void {
  if (attached) return;
  let seedPath: string;
  try {
    seedPath = resolveSeedDb();
  } catch {
    attachMode = 'unavailable';
    return;
  }
  try {
    const uri = `${pathToFileURL(seedPath).href}?mode=ro`;
    db.prepare('ATTACH DATABASE ? AS seed').run(uri);
    attachMode = 'uri';
  } catch {
    db.prepare('ATTACH DATABASE ? AS seed').run(seedPath);
    attachMode = 'plain';
  }
  attached = true;
}

export function getWorkspaceDb(): DB {
  const cached = globalThis.__tanyadataDb;
  if (cached) return cached;

  ensureDirs();
  const db = new Database(WORKSPACE_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  applySchema(db);
  attachSeed(db);

  globalThis.__tanyadataDb = db;
  return db;
}

export function seedAttachMode(): 'uri' | 'plain' | 'unavailable' {
  getWorkspaceDb();
  return attachMode;
}

export function seedAvailable(db: DB = getWorkspaceDb()): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM seed.sqlite_master WHERE type='table' AND name='transactions'")
      .get() as { name?: string } | undefined;
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

type SqliteMasterRow = { name: string };

export function listTables(db: DB, schema: 'main' | 'seed'): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM ${schema}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as SqliteMasterRow[];
  return rows.map((r) => r.name);
}
