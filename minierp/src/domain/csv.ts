import { Ctx } from './context';
import { listContacts } from './contacts';
import { centsToInput } from './money';
import { listProducts } from './products';
import { listInvoices } from './sales';

type Cell = string | number | null;

/**
 * RFC 4180 CSV: fields containing a comma, quote or line break are quoted, and quotes are doubled.
 * A leading apostrophe stops spreadsheets from running text such as "=SUM(...)" as a formula
 * (CSV injection), which matters because customer and product names are typed by people.
 */
export function toCsv(rows: Cell[][]): string {
  const cell = (value: Cell): string => {
    if (value === null) return '';
    let text = String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function invoicesCsv(ctx: Ctx): string {
  return toCsv([
    ['number', 'customer', 'issue_date', 'due_date', 'status', 'net', 'tax', 'total', 'paid', 'balance'],
    ...listInvoices(ctx).map((i) => [i.number, i.customer_name, i.issue_date, i.due_date, i.status,
      centsToInput(i.net_cents), centsToInput(i.tax_cents), centsToInput(i.total_cents), centsToInput(i.paid_cents), centsToInput(i.balance_cents)]),
  ]);
}

export function productsCsv(ctx: Ctx): string {
  return toCsv([
    ['sku', 'name', 'unit', 'price', 'average_cost', 'tax_percent', 'on_hand', 'stock_value', 'reorder_level'],
    ...listProducts(ctx, { includeInactive: true }).map((p) => [p.sku, p.name, p.unit, centsToInput(p.price_cents), centsToInput(p.cost_cents),
      p.tax_bps / 100, p.on_hand, centsToInput(p.stock_value_cents), p.reorder_level]),
  ]);
}

export function contactsCsv(ctx: Ctx): string {
  return toCsv([
    ['type', 'name', 'email', 'phone', 'address'],
    ...listContacts(ctx).map((c) => [c.kind, c.name, c.email, c.phone, c.address]),
  ]);
}
