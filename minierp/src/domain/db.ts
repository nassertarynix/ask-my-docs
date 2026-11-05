import type { BindParams, Database } from 'sql.js';

export type Param = number | string | null;

/**
 * A thin, typed wrapper around a sql.js Database.
 * - `transaction` nests safely (SAVEPOINTs), and rolls back everything if the callback throws.
 *   That is what keeps a failed "confirm order" from leaving half its stock moves behind.
 */
export class Db {
  private depth = 0;

  constructor(readonly raw: Database) {
    raw.run('PRAGMA foreign_keys = ON');
  }

  all<T>(sql: string, params: Param[] = []): T[] {
    const statement = this.raw.prepare(sql);
    try {
      statement.bind(params as BindParams);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally {
      statement.free();
    }
  }

  get<T>(sql: string, params: Param[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  /** Run one statement and return the id of the row it inserted (0 for statements that insert nothing). */
  run(sql: string, params: Param[] = []): number {
    this.raw.run(sql, params as BindParams);
    return Number(this.get<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  transaction<T>(work: () => T): T {
    const name = `sp${this.depth}`;
    this.raw.run(`SAVEPOINT ${name}`);
    this.depth += 1;
    try {
      const result = work();
      this.raw.run(`RELEASE ${name}`);
      return result;
    } catch (error) {
      this.raw.run(`ROLLBACK TO ${name}`);
      this.raw.run(`RELEASE ${name}`);
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  /**
   * The whole database as a real SQLite file.
   * sql.js closes and reopens the connection while exporting, which silently resets PRAGMAs,
   * so foreign keys are switched back on afterwards (a test guards this).
   */
  export(): Uint8Array {
    const bytes = this.raw.export();
    this.raw.run('PRAGMA foreign_keys = ON');
    return bytes;
  }

  close(): void {
    this.raw.close();
  }
}
