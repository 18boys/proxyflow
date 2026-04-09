import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA } from './schema';

const DB_PATH = path.join(__dirname, '..', 'proxyflow.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    try {
      db = new Database(DB_PATH);
    } catch (err: unknown) {
      const sqliteErr = err as { code?: string };
      // Handle orphaned WAL/SHM files from unclean shutdown (kill -9 etc.)
      if (sqliteErr.code === 'SQLITE_IOERR_SHORT_READ' || sqliteErr.code === 'SQLITE_CORRUPT') {
        console.warn('[db] Detected corrupt WAL/SHM files, cleaning up and retrying...');
        fs.rmSync(DB_PATH + '-shm', { force: true });
        fs.rmSync(DB_PATH + '-wal', { force: true });
        db = new Database(DB_PATH);
      } else {
        throw err;
      }
    }
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

/**
 * 根据 schema.ts 的定义，自动同步数据库结构：
 *   - 表不存在 → CREATE TABLE
 *   - 列不存在 → ALTER TABLE ADD COLUMN
 *   - 列已存在 → 跳过
 */
export function initializeDb(): void {
  const database = getDb();
  syncSchema(database);
}

function syncSchema(database: Database.Database): void {
  // 获取当前数据库中所有表名
  const existingTables = new Set(
    (database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[])
      .map(r => r.name)
  );

  for (const [tableName, columns] of Object.entries(SCHEMA)) {
    if (!existingTables.has(tableName)) {
      // 表不存在 → 整张表建出来
      const columnDefs = Object.entries(columns)
        .map(([col, def]) => `      ${col} ${def}`)
        .join(',\n');
      const sql = `CREATE TABLE ${tableName} (\n${columnDefs}\n    )`;
      database.exec(sql);
      console.log(`[db] ✅ Created table: ${tableName}`);
    } else {
      // 表已存在 → 检查缺少的列
      const existingCols = new Set(
        (database.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[])
          .map(r => r.name)
      );

      for (const [colName, colDef] of Object.entries(columns)) {
        if (!existingCols.has(colName)) {
          database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`);
          console.log(`[db] ✅ Added column: ${tableName}.${colName}`);
        }
      }
    }
  }

  console.log('[db] Schema sync complete.');
}

export default getDb;
