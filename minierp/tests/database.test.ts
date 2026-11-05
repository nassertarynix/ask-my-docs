import { describe, expect, it } from 'vitest';
import { MIGRATIONS, openDatabase, schemaVersion, createProduct, createContact, DomainError, looksLikeSqlite } from '../src/domain';
import { loadSql, newCtx } from './helpers';

describe('database', () => {
  it('starts at the latest schema version', async () => {
    const ctx = await newCtx();
    expect(schemaVersion(ctx.db)).toBe(MIGRATIONS.length);
  });

  it('survives a round trip through a real .sqlite file, keeping data and the schema version', async () => {
    const SQL = await loadSql();
    const ctx = await newCtx();
    createProduct(ctx, { sku: 'OIL-1', name: 'Olive oil', price_cents: 1250 });
    const bytes = ctx.db.export();
    expect(looksLikeSqlite(bytes)).toBe(true);

    const reopened = openDatabase(SQL, bytes);
    expect(reopened.db.get<{ name: string }>('SELECT name FROM products')?.name).toBe('Olive oil');
    expect(schemaVersion(reopened.db)).toBe(MIGRATIONS.length);
  });

  it('keeps foreign keys switched on after an export (sql.js resets pragmas on export)', async () => {
    const ctx = await newCtx();
    ctx.db.export();
    expect(ctx.db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
    expect(() => ctx.db.run("INSERT INTO sales_orders (number, customer_id, status, order_date) VALUES ('X', 999, 'draft', '2026-01-01')")).toThrow();
  });

  it('rejects a file that is not a SQLite database', async () => {
    const SQL = await loadSql();
    expect(() => openDatabase(SQL, new TextEncoder().encode('this is not a database, just text'))).toThrow(DomainError);
  });

  it('rolls back everything in a transaction when something inside throws, including nested ones', async () => {
    const ctx = await newCtx();
    expect(() =>
      ctx.db.transaction(() => {
        createContact(ctx, { kind: 'customer', name: 'Kept?' });
        ctx.db.transaction(() => createContact(ctx, { kind: 'customer', name: 'Inner' }));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM contacts')?.n).toBe(0);
  });

  it('upgrades an older database in place instead of discarding it', async () => {
    const SQL = await loadSql();
    // a database that is at version 0 with nothing in it gets the full schema
    const empty = new SQL.Database();
    const reopened = openDatabase(SQL, empty.export());
    expect(schemaVersion(reopened.db)).toBe(MIGRATIONS.length);
  });

  it('refuses a database made by a newer version of the app', async () => {
    const SQL = await loadSql();
    const raw = new SQL.Database();
    raw.run(`PRAGMA user_version = ${MIGRATIONS.length + 5}`);
    expect(() => openDatabase(SQL, raw.export())).toThrow(/newer version/);
  });
});
