# MiniERP: architecture

## Layers

```
UI (React)  ->  domain functions (plain TypeScript)  ->  Db wrapper  ->  sql.js (SQLite in WebAssembly)
                                                                      \->  exported to IndexedDB (autosave)
```

- **`src/domain/`** holds every business rule. It imports no React and no browser API, so the tests run in Node
  against a real in-memory SQLite database. Every function takes a `Ctx` (the database and a clock), so "today"
  is injected rather than read from `Date.now()`.
- **`src/ui/`** is a thin layer: screens call domain functions inside an `act()` helper that runs them in one
  transaction, shows a toast, and schedules a debounced save of the database file to IndexedDB.
- **Errors are codes.** The domain throws `DomainError('insufficient_stock', {...})`. The UI translates the code
  through `messages/en.ts` or `messages/ar.ts`; `ar` is typed `Record<MessageKey, string>`, so a missing
  translation is a compile error.

## Data model (SQLite)

| Table | Purpose |
| --- | --- |
| `settings` | business name, payment terms |
| `contacts` | customers and suppliers (`kind`) |
| `products` | SKU (unique, case-insensitive), price, cost, tax in basis points, reorder level, `active` |
| `stock_moves` | the stock ledger: `receipt`, `delivery`, `return`, `adjustment` (signed `qty`) |
| `sales_orders` / `sales_order_lines` | draft, confirmed, cancelled; price, tax and unit cost frozen on the line |
| `invoices` / `payments` | totals copied at creation; status derived from payments |
| `purchase_orders` / `purchase_order_lines` | draft, ordered, received, cancelled |
| `sequences` | yearly document numbers such as `INV-2026-0007` |

`CHECK` constraints and foreign keys are enforced by SQLite itself, so a UI bug cannot write a negative price.
Migrations are an ordered list; `PRAGMA user_version` stores how many have run.

## Decisions

| Decision | Why |
| --- | --- |
| Integer cents and basis points | no floating-point drift; rounding is explicit (half up, per line) |
| Stock as a ledger | on-hand is a sum, so it cannot disagree with its history |
| Derived invoice status | a stored "paid" flag could contradict the payments |
| Nested transactions with SAVEPOINTs | a failed confirm must not leave half its stock moves behind |
| HashRouter | static hosting needs no rewrite rules |
| Service worker, production only | offline use without interfering with the dev server |
| Self-hosted fonts, no CDN | the app contacts no other site; a browser test enforces it |
| CSS logical properties | Arabic mirrors without a second stylesheet |

## Tests

- `tests/` (Vitest): money and dates, products and stock, sales (stock, invoices, payments), purchases (average cost),
  reports and the seeded demo business, CSV export, database round trips and migrations.
- `e2e/` (Playwright): the full order-to-cash workflow, shortage handling, reload persistence, `.sqlite` backup and
  restore, refusing a non-database file, no foreign requests, offline reload, layout at 320 to 1280 px in two languages,
  44 px touch targets.
