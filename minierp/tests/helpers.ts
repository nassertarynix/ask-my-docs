import initSqlJs, { SqlJsStatic } from 'sql.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Ctx, openDatabase } from '../src/domain';

let sql: SqlJsStatic | undefined;

/** One WebAssembly SQLite shared by all tests; each test gets its own empty in-memory database. */
export async function loadSql(): Promise<SqlJsStatic> {
  if (!sql) {
    const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
    const wasmBinary = readFileSync(wasm);
    sql = await initSqlJs({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer });
  }
  return sql;
}

export interface TestCtx extends Ctx {
  setToday(date: string): void;
}

export async function newCtx(today = '2026-06-15'): Promise<TestCtx> {
  const SQL = await loadSql();
  let current = today;
  const ctx = openDatabase(SQL, null, () => current);
  return Object.assign(ctx, { setToday: (d: string) => { current = d; } });
}
