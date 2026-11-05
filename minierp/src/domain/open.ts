import type { SqlJsStatic } from 'sql.js';
import { Ctx, makeCtx } from './context';
import { Db } from './db';
import { DomainError } from './errors';
import { migrate } from './schema';

/** SQLite files start with this 16-byte header; anything else is not a database. */
const MAGIC = 'SQLite format 3\u0000';

export function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  return String.fromCharCode(...bytes.subarray(0, 16)) === MAGIC;
}

/** Open (or create) a database and bring its schema up to date. */
export function openDatabase(SQL: SqlJsStatic, bytes?: Uint8Array | null, today?: () => string): Ctx {
  if (bytes && bytes.length > 0 && !looksLikeSqlite(bytes)) throw new DomainError('invalid_file');
  const db = new Db(bytes && bytes.length > 0 ? new SQL.Database(bytes) : new SQL.Database());
  try {
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return makeCtx(db, today);
}
