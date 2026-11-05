import { Ctx, setSetting } from './context';
import { addDays } from './dates';
import { createContact } from './contacts';
import { adjustStock } from './stock';
import { createProduct, getProduct } from './products';
import { createPurchaseOrder, placePurchaseOrder, receivePurchaseOrder } from './purchases';
import {
  checkAvailability, confirmSalesOrder, createInvoice, createSalesOrder, getInvoice, recordPayment, SalesLineInput,
} from './sales';

/** A tiny deterministic random generator, so the demo business is the same every time it is created. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRODUCTS = [
  { sku: 'SOAP-ALP', name: 'Aleppo laurel soap', price: 650, cost: 280, tax: 1000, reorder: 40 },
  { sku: 'OIL-EVO-1L', name: 'Extra virgin olive oil 1 L', price: 1850, cost: 1100, tax: 0, reorder: 30 },
  { sku: 'ZAATAR-250', name: 'Za’atar blend 250 g', price: 575, cost: 260, tax: 0, reorder: 40 },
  { sku: 'TAHINI-500', name: 'Tahini 500 g', price: 825, cost: 450, tax: 0, reorder: 30 },
  { sku: 'COFFEE-CARD', name: 'Arabic coffee with cardamom 250 g', price: 1250, cost: 700, tax: 1000, reorder: 25 },
  { sku: 'DATES-MED', name: 'Medjool dates 500 g', price: 1450, cost: 820, tax: 0, reorder: 20 },
  { sku: 'MOLASSES-PM', name: 'Pomegranate molasses 300 ml', price: 725, cost: 360, tax: 0, reorder: 25 },
  { sku: 'SUMAC-200', name: 'Ground sumac 200 g', price: 495, cost: 210, tax: 0, reorder: 30 },
  { sku: 'HALAWA-400', name: 'Halawa with pistachio 400 g', price: 950, cost: 520, tax: 1000, reorder: 20 },
  { sku: 'ROSEWATER', name: 'Rose water 250 ml', price: 690, cost: 310, tax: 1000, reorder: 20 },
  { sku: 'LABNEH-JAR', name: 'Labneh in olive oil 400 g', price: 1190, cost: 680, tax: 1500, reorder: 15 },
  { sku: 'BASKET-GIFT', name: 'Gift basket (soap, oil, za’atar)', price: 3900, cost: 2050, tax: 1500, reorder: 10 },
];

const CUSTOMERS = [
  ['Cafe Damascus', 'orders@cafedamascus.example'],
  ['Olive & Thyme Deli', 'buyer@oliveandthyme.example'],
  ['Souk Market', 'purchasing@soukmarket.example'],
  ['Qasioun Hotel', 'kitchen@qasioun.example'],
  ['Mezze House', 'hello@mezzehouse.example'],
  ['Barada Bakery', 'office@baradabakery.example'],
  ['Nour Gift Shop', 'nour@giftshop.example'],
  ['Fig Tree Restaurant', 'chef@figtree.example'],
] as const;

const SUPPLIERS = [
  ['Idlib Olive Growers', 'sales@idlibolive.example'],
  ['Aleppo Soap Works', 'export@aleppo-soap.example'],
  ['Levant Spice Trading', 'orders@levantspice.example'],
] as const;

/**
 * Fills an empty database with a believable small business: about six months of purchases, deliveries,
 * invoices and payments, created through the same domain functions the app uses (so every rule is
 * exercised), plus a few open items to look at: overdue invoices, low stock, a draft order, an order on the way.
 */
export function seedDemoData(ctx: Ctx, today: string = ctx.today(), days = 365): void {
  const random = mulberry32(2026);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

  // Walk a private clock from the past up to `today`, so documents get realistic dates.
  let now = addDays(today, -days);
  const clock: Ctx = { db: ctx.db, today: () => now };

  ctx.db.transaction(() => {
    setSetting(clock, 'business_name', 'Levant Pantry Co.');
    setSetting(clock, 'currency', 'USD');
    setSetting(clock, 'payment_terms_days', '30');

    const suppliers = SUPPLIERS.map(([name, email]) => createContact(clock, { kind: 'supplier', name, email }));
    const customers = CUSTOMERS.map(([name, email]) => createContact(clock, { kind: 'customer', name, email }));
    const products = PRODUCTS.map((p) =>
      createProduct(clock, { sku: p.sku, name: p.name, price_cents: p.price, tax_bps: p.tax, reorder_level: p.reorder }),
    );
    const costOf = new Map(products.map((id, i) => [id, (PRODUCTS[i] as (typeof PRODUCTS)[number]).cost]));

    const buy = (lines: { productId: number; qty: number }[]) => {
      const id = createPurchaseOrder(clock, {
        supplierId: pick(suppliers),
        lines: lines.map((l) => ({ ...l, unitCostCents: Math.round((costOf.get(l.productId) as number) * (0.96 + random() * 0.1)) })),
      });
      placePurchaseOrder(clock, id);
      receivePurchaseOrder(clock, id);
    };

    // opening stock
    buy(products.map((productId) => ({ productId, qty: 60 + Math.floor(random() * 60) })));

    const invoices: number[] = [];
    for (let day = 0; day <= days; day += 1) {
      now = addDays(today, -days + day);
      if (random() < 0.4) continue; // not every day has an order

      const lines: SalesLineInput[] = [];
      const count = 1 + Math.floor(random() * 4);
      const chosen = new Set<number>();
      while (chosen.size < count) chosen.add(pick(products));
      for (const productId of chosen) lines.push({ productId, qty: 2 + Math.floor(random() * 14) });

      const order = createSalesOrder(clock, { customerId: pick(customers), lines });
      const shortages = checkAvailability(clock, order);
      if (shortages.length > 0) buy(shortages.map((s) => ({ productId: s.productId, qty: s.requested * 3 + 20 })));
      confirmSalesOrder(clock, order);
      invoices.push(createInvoice(clock, order));
      // like a real buyer: top up whatever has fallen to its reorder level
      const refill = products.flatMap((productId, index) => {
        const level = (PRODUCTS[index] as (typeof PRODUCTS)[number]).reorder;
        return chosen.has(productId) && getProduct(clock, productId).on_hand <= level ? [{ productId, qty: level * 3 }] : [];
      });
      if (refill.length > 0) buy(refill);
    }

    // Payments: most customers pay, some pay in parts, a few are late.
    for (const id of invoices) {
      const invoice = getInvoice(clock, id);
      const roll = random();
      const age = Math.round((Date.parse(today) - Date.parse(invoice.issue_date)) / 86_400_000);
      if (roll < 0.08 && age > 20 && age < 130) continue; // not paid yet: ends up overdue (very old ones got paid late)
      const paidOn = addDays(invoice.issue_date, 5 + Math.floor(random() * 30));
      if (paidOn > today) continue;
      now = paidOn;
      if (roll < 0.16) {
        const first = Math.floor((invoice.total_cents * (0.3 + random() * 0.4)) / 100) * 100;
        recordPayment(clock, id, { amountCents: Math.max(100, first), method: 'bank', date: paidOn });
      } else {
        recordPayment(clock, id, { amountCents: invoice.total_cents, method: pick(['bank', 'cash', 'card']), date: paidOn });
      }
    }

    now = today;
    // A few things to act on right now.
    const [soap, , zaatar, , coffee] = products as [number, number, number, number, number];
    const low = (id: number, target: number) => {
      const onHand = getProduct(clock, id).on_hand;
      if (onHand > target) adjustStock(clock, id, target - onHand, 'Stock count: shortfall found', today);
    };
    low(soap, 12);
    low(zaatar, 18);
    low(coffee, 9);

    const draft = pick(customers);
    createSalesOrder(clock, { customerId: draft, lines: [{ productId: products[1] as number, qty: 6 }, { productId: products[3] as number, qty: 10 }] });
    const incoming = createPurchaseOrder(clock, {
      supplierId: suppliers[1] as number,
      lines: [{ productId: soap, qty: 120, unitCostCents: 270 }, { productId: coffee, qty: 60, unitCostCents: 690 }],
    });
    placePurchaseOrder(clock, incoming);
  });
}
