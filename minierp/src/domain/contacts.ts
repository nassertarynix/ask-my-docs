import { Ctx, requireText } from './context';
import { DomainError } from './errors';

export type ContactKind = 'customer' | 'supplier';

export interface Contact {
  id: number;
  kind: ContactKind;
  name: string;
  email: string;
  phone: string;
  address: string;
  created_at: string;
}

export interface ContactInput {
  kind: ContactKind;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

export function createContact(ctx: Ctx, input: ContactInput): number {
  const name = requireText(input.name);
  return ctx.db.run(
    'INSERT INTO contacts (kind, name, email, phone, address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [input.kind, name, input.email?.trim() ?? '', input.phone?.trim() ?? '', input.address?.trim() ?? '', ctx.today()],
  );
}

export function updateContact(ctx: Ctx, id: number, input: Omit<ContactInput, 'kind'>): void {
  getContact(ctx, id);
  ctx.db.run('UPDATE contacts SET name = ?, email = ?, phone = ?, address = ? WHERE id = ?', [
    requireText(input.name), input.email?.trim() ?? '', input.phone?.trim() ?? '', input.address?.trim() ?? '', id,
  ]);
}

export function getContact(ctx: Ctx, id: number): Contact {
  const row = ctx.db.get<Contact>('SELECT * FROM contacts WHERE id = ?', [id]);
  if (!row) throw new DomainError('not_found', { what: 'contact', id });
  return row;
}

export function listContacts(ctx: Ctx, kind?: ContactKind): Contact[] {
  return kind
    ? ctx.db.all<Contact>('SELECT * FROM contacts WHERE kind = ? ORDER BY name COLLATE NOCASE', [kind])
    : ctx.db.all<Contact>('SELECT * FROM contacts ORDER BY name COLLATE NOCASE');
}

/** A contact that already appears on a document cannot be deleted: the history must keep its name. */
export function deleteContact(ctx: Ctx, id: number): void {
  const contact = getContact(ctx, id);
  const used =
    contact.kind === 'customer'
      ? ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sales_orders WHERE customer_id = ?', [id])
      : ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM purchase_orders WHERE supplier_id = ?', [id]);
  if ((used?.n ?? 0) > 0) throw new DomainError('in_use', { what: 'contact' });
  ctx.db.run('DELETE FROM contacts WHERE id = ?', [id]);
}

export interface CustomerBalance extends Contact {
  invoiced_cents: number;
  paid_cents: number;
  balance_cents: number;
}

/** Customers with how much they have been invoiced, have paid, and still owe (void invoices ignored). */
export function customerBalances(ctx: Ctx): CustomerBalance[] {
  return ctx.db.all<CustomerBalance>(
    `SELECT c.*,
            COALESCE(SUM(i.total_cents), 0) AS invoiced_cents,
            COALESCE(SUM((SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p WHERE p.invoice_id = i.id)), 0) AS paid_cents,
            COALESCE(SUM(i.total_cents), 0)
              - COALESCE(SUM((SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p WHERE p.invoice_id = i.id)), 0) AS balance_cents
       FROM contacts c
       LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'open'
      WHERE c.kind = 'customer'
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE`,
  );
}
