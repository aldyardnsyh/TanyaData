/**
 * Utilitas analytics.db untuk dua profil seed.
 *
 * - `none`: buat DB dengan skema lengkap tapi NOL baris (backup dulu bila ada
 *   data R&D, supaya tidak ada yang hilang permanen).
 * - `demo`: regenerate DB dari data/seed/structured/*.csv — sumber kanonik R&D.
 *
 * Semua operasi bersifat lokal, non-interaktif, dan tidak menyentuh jaringan.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';

export const SEED_SCHEMA_PATH = path.join(process.cwd(), 'lib', 'db', 'seed-schema.sql');

const TABLES_IN_FK_ORDER = ['merchants', 'channels', 'failure_codes', 'transactions', 'incident_log'];

export function countTransactions(dbPath) {
  if (!fs.existsSync(dbPath)) return 0;
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'").get();
    if (!row) return 0;
    return db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

/** Backup R&D sekali saja; tidak pernah menimpa backup yang sudah ada. */
export function backupSeedDb(dbPath, backupPath) {
  if (!fs.existsSync(dbPath) || countTransactions(dbPath) === 0) return null;
  if (fs.existsSync(backupPath)) return backupPath;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

/**
 * Reset analytics.db menjadi 0 baris dengan skema lengkap.
 *
 * Sengaja TIDAK menghapus file: di Windows file yang sedang di-ATTACH proses
 * lain (mis. dev server) tidak bisa di-unlink (EBUSY). Drop + recreate DDL
 * in-place tetap bekerja selama tidak ada penulis aktif, dan backup R&D sudah
 * dibuat lebih dulu oleh caller.
 */
export function createEmptySeedDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.pragma('busy_timeout = 10000');
    db.pragma('foreign_keys = OFF');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    for (const { name } of tables) {
      db.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
    }
    db.exec(fs.readFileSync(SEED_SCHEMA_PATH, 'utf8'));
  } finally {
    db.close();
  }
  return dbPath;
}

/**
 * Kosongkan workspace DB in-place (tanpa unlink — lihat catatan
 * createEmptySeedDb). Skema dibuat ulang oleh lib/db/client.ts setelah ini.
 */
export function resetWorkspaceDbInPlace(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.pragma('busy_timeout = 10000');
    db.pragma('foreign_keys = OFF');
    const objects = db
      .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('trigger','view','table')")
      .all();
    for (const kind of ['trigger', 'view', 'table']) {
      for (const obj of objects.filter((o) => o.type === kind)) {
        db.exec(`DROP ${kind.toUpperCase()} IF EXISTS "${obj.name.replace(/"/g, '""')}"`);
      }
    }
  } finally {
    db.close();
  }
  return dbPath;
}

function normalize(value) {
  return value === '' || value === undefined ? null : value;
}

/** Isi analytics.db kosong dari CSV R&D. Dipakai hanya oleh profil demo. */
export function restoreSeedDbFromCsv(dbPath, structuredDir) {
  const missing = TABLES_IN_FK_ORDER.filter(
    (table) => !fs.existsSync(path.join(structuredDir, `${table}.csv`)),
  );
  if (missing.length) {
    throw new Error(`CSV seed tidak lengkap: ${missing.join(', ')}`);
  }

  createEmptySeedDb(dbPath);
  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = OFF');
    for (const table of TABLES_IN_FK_ORDER) {
      const rows = parse(fs.readFileSync(path.join(structuredDir, `${table}.csv`), 'utf8'), {
        columns: true,
        skip_empty_lines: true,
        bom: true,
      });
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const quoted = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const insert = db.prepare(`INSERT INTO ${table} (${quoted}) VALUES (${placeholders})`);
      db.transaction(() => {
        for (const row of rows) insert.run(...columns.map((c) => normalize(row[c])));
      })();
    }
  } finally {
    db.close();
  }
  return dbPath;
}
