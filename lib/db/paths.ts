import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cwd = process.cwd();

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(cwd, 'data');

export const SEED_DB = path.join(DATA_DIR, 'analytics.db');
export const SEED_STRUCTURED_DIR = path.join(DATA_DIR, 'seed', 'structured');
export const SEED_DOCS_DIR = path.join(DATA_DIR, 'seed', 'documents');
export const GENERATED_DIR = path.join(DATA_DIR, 'generated');
export const DOCUMENTS_JSON = path.join(GENERATED_DIR, 'documents.json');
export const DOCUMENTS_JSON_LEGACY = path.join(GENERATED_DIR, 'documents.extracted.json');
export const SCHEMA_SQL = path.join(cwd, 'lib', 'db', 'schema.sql');
export const CORE_SCHEMA_SQL = path.join(cwd, 'lib', 'db', 'core-schema.sql');

function writable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveWorkspaceDir(): string {
  const explicit = process.env.WORKSPACE_DIR ? path.resolve(process.env.WORKSPACE_DIR) : null;
  if (explicit) {
    if (writable(explicit)) return explicit;
    return path.join(os.tmpdir(), 'tanyadata');
  }
  const local = path.join(DATA_DIR, 'workspace');
  if (writable(local)) return local;
  const fallback = path.join(os.tmpdir(), 'tanyadata');
  writable(fallback);
  return fallback;
}

export const WORKSPACE_DIR = resolveWorkspaceDir();
export const WORKSPACE_DB = path.join(WORKSPACE_DIR, 'tanyadata.db');
export const UPLOADS_DIR = path.join(WORKSPACE_DIR, 'uploads');

export function ensureDirs(): void {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

/**
 * Seed DB dibaca read-only. Bila platform tidak mengizinkan baca file bundle,
 * salin sekali ke workspace (fallback DATA_MODE=copy — ARCHITECTURE §4.4).
 */
export function resolveSeedDb(): string {
  try {
    fs.accessSync(SEED_DB, fs.constants.R_OK);
    return SEED_DB;
  } catch {
    const copy = path.join(WORKSPACE_DIR, 'analytics.db');
    if (!fs.existsSync(copy)) {
      fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
      fs.copyFileSync(SEED_DB, copy);
    }
    return copy;
  }
}

export function resolveDocumentsJson(): string | null {
  if (fs.existsSync(DOCUMENTS_JSON)) return DOCUMENTS_JSON;
  if (fs.existsSync(DOCUMENTS_JSON_LEGACY)) return DOCUMENTS_JSON_LEGACY;
  return null;
}

export function seedDocPath(file: string): string {
  return path.join(SEED_DOCS_DIR, file);
}
