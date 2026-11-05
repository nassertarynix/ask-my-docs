import { Db } from './db';

/**
 * Schema migrations. `PRAGMA user_version` stores how many have been applied, so a database
 * saved by an older version of the app is upgraded in place instead of being thrown away.
 * Never edit an old migration: append a new one.
 */
export const MIGRATIONS: string[] = [
  /* 1 — the whole first schema */ `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL CHECK (kind IN ('customer', 'supplier')),
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    email      TEXT NOT NULL DEFAULT '',
    phone      TEXT NOT NULL DEFAULT '',
    address    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sku           TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(sku)) > 0),
    name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
    unit          TEXT NOT NULL DEFAULT 'pcs',
    price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
    cost_cents    INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
    tax_bps       INTEGER NOT NULL DEFAULT 0 CHECK (tax_bps BETWEEN 0 AND 10000),
    reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at    TEXT NOT NULL
  );

  -- The stock ledger. Stock on hand is never stored: it is SUM(qty) over this table,
  -- so it can never drift out of step with the documents that caused it.
  CREATE TABLE stock_moves (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty        INTEGER NOT NULL CHECK (qty <> 0),
    kind       TEXT NOT NULL CHECK (kind IN ('receipt', 'delivery', 'return', 'adjustment')),
    ref_type   TEXT NOT NULL DEFAULT '',
    ref_id     INTEGER,
    unit_cost_cents INTEGER NOT NULL DEFAULT 0,
    note       TEXT NOT NULL DEFAULT '',
    move_date  TEXT NOT NULL
  );
  CREATE INDEX idx_stock_moves_product ON stock_moves(product_id);

  CREATE TABLE sales_orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    number      TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES contacts(id),
    status      TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'cancelled')),
    order_date  TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE sales_order_lines (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id         INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id       INTEGER NOT NULL REFERENCES products(id),
    qty              INTEGER NOT NULL CHECK (qty > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    tax_bps          INTEGER NOT NULL CHECK (tax_bps BETWEEN 0 AND 10000),
    unit_cost_cents  INTEGER NOT NULL DEFAULT 0   -- fixed when the order is confirmed (cost of goods sold)
  );
  CREATE INDEX idx_sales_lines_order ON sales_order_lines(order_id);

  CREATE TABLE invoices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    number      TEXT NOT NULL UNIQUE,
    order_id    INTEGER NOT NULL REFERENCES sales_orders(id),
    customer_id INTEGER NOT NULL REFERENCES contacts(id),
    issue_date  TEXT NOT NULL,
    due_date    TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('open', 'void')),
    net_cents   INTEGER NOT NULL,
    tax_cents   INTEGER NOT NULL,
    total_cents INTEGER NOT NULL
  );
  -- one live invoice per order
  CREATE UNIQUE INDEX idx_invoices_live_order ON invoices(order_id) WHERE status = 'open';

  CREATE TABLE payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id   INTEGER NOT NULL REFERENCES invoices(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    method       TEXT NOT NULL DEFAULT 'cash',
    paid_date    TEXT NOT NULL,
    note         TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_payments_invoice ON payments(invoice_id);

  CREATE TABLE purchase_orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    number      TEXT NOT NULL UNIQUE,
    supplier_id INTEGER NOT NULL REFERENCES contacts(id),
    status      TEXT NOT NULL CHECK (status IN ('draft', 'ordered', 'received', 'cancelled')),
    order_date  TEXT NOT NULL,
    received_date TEXT,
    note        TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE purchase_order_lines (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id        INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    qty             INTEGER NOT NULL CHECK (qty > 0),
    unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0)
  );
  CREATE INDEX idx_purchase_lines_order ON purchase_order_lines(order_id);

  CREATE TABLE sequences (
    name TEXT NOT NULL,
    year INTEGER NOT NULL,
    last INTEGER NOT NULL,
    PRIMARY KEY (name, year)
  );
  `,
];

export function schemaVersion(db: Db): number {
  return db.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
}

/** Apply every migration the database has not seen yet. Returns the version it ended at. */
export function migrate(db: Db): number {
  const current = schemaVersion(db);
  if (current > MIGRATIONS.length) {
    throw new Error(`This database was made by a newer version of the app (schema ${current}).`);
  }
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version] as string);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
  return MIGRATIONS.length;
}
