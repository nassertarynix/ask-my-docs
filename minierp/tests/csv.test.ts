import { describe, expect, it } from 'vitest';
import { contactsCsv, createContact, createProduct, invoicesCsv, productsCsv, seedDemoData, toCsv } from '../src/domain';
import { newCtx } from './helpers';

describe('csv', () => {
  it('quotes fields with commas, quotes and line breaks', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', 'two\nlines']])).toBe('a,"b,c","say ""hi""","two\nlines"\r\n');
  });

  it('neutralises spreadsheet formulas typed into names', () => {
    expect(toCsv([['=HYPERLINK("x")', '+1', '-1', '@a', 'ok']])).toBe(`"'=HYPERLINK(""x"")",'+1,'-1,'@a,ok\r\n`);
  });

  it('leaves numbers alone, including negatives', () => {
    expect(toCsv([[-5, 2.5, null]])).toBe('-5,2.5,\r\n');
  });

  it('exports products with decimal prices rather than cents', async () => {
    const ctx = await newCtx();
    createProduct(ctx, { sku: 'A', name: 'Soap, large', price_cents: 1250, tax_bps: 1500 });
    const lines = productsCsv(ctx).trim().split('\r\n');
    expect(lines[1]).toBe('A,"Soap, large",pcs,12.50,0.00,15,0,0.00,0');
  });

  it('exports every invoice and every contact', async () => {
    const ctx = await newCtx('2026-11-05');
    seedDemoData(ctx, '2026-11-05', 60);
    expect(invoicesCsv(ctx).trim().split('\r\n').length).toBeGreaterThan(10);
    createContact(ctx, { kind: 'customer', name: '=cmd' });
    expect(contactsCsv(ctx)).toContain("'=cmd");
  });
});
