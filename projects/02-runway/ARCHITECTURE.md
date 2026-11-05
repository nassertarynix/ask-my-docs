# Runway: architecture

## Layers

```
React screens (App.tsx, Chart.tsx)  ->  domain functions (src/domain, plain TypeScript)
                  \-> localStorage (one JSON document, validated on the way in)
```

- **`src/domain/`** holds every rule and imports no React or browser API, so the unit tests run in Node.
  - `dates.ts`: calendar dates as `YYYY-MM-DD` strings; day and month arithmetic done on year/month/day numbers, never local-time `Date` objects.
  - `forecast.ts`: `occurrences(item, from, to)` lists the dates an item happens; `forecast(items, settings)` returns the events with a running balance, the monthly rows, the lowest point and the first date the balance goes below zero.
  - `money.ts`: strict parsing of typed amounts into integer cents, and formatting.
  - `data.ts`: the example shop, `readState` (validation of anything loaded from storage or a file), and CSV export.
- **`App.tsx`** holds state in one `useState`, updated with the functional form (`change((prev) => ...)`) so two quick edits cannot overwrite each other, and writes it to `localStorage` after each change.
- **`Chart.tsx`** draws the balance as a step line in SVG, sized to its container with a `ResizeObserver` so text stays readable on a phone.

## Data model

```
State    = { settings: { opening (cents), start (date), months }, items: Item[] }
Item     = { id, name, kind: 'in' | 'out', amountCents (> 0), every: 'once' | 'week' | 'month' | 'year',
             start (date), end (date or ''), enabled }
Forecast = { events (date, item, cents, balance), months (in, out, closing), lowest, runsOutOn, end, closing }
```

## Decisions

| Decision | Why |
| --- | --- |
| Integer cents, strict parsing | no floating-point drift; `1.234` or `12abc` is refused rather than guessed |
| Month arithmetic keeps the anchor day | the 31st becomes Feb 28 (29), then returns to the 31st in March |
| Money in before money out on one day | it decides whether a same-day payment counts as a dip below zero, so it is stated and tested |
| Month rows cover "start + n months" | a forecast need not start on the 1st, and nothing is counted twice or lost |
| `readState` drops bad items | a file or storage entry is untrusted input |
| An item can be switched off | "what if?" without deleting anything |
| Save on every valid keystroke | an edit must not depend on the field losing focus |
| No request leaves the page | fonts are self-hosted; a browser test enforces it |

## Tests

- `tests/` (Vitest, 28 tests): dates and leap years, recurrence (weekly, month-end, yearly, end dates, invalid input), the forecast (balances, lowest point, run-out date, same-day order, month sums, no lost cents), money, data validation and CSV.
- `e2e/` (Playwright, 7 flows on a phone and on desktop = 14 tests): the example, what-if switching, starting from nothing, validation, reload persistence, backup and restore, no horizontal scroll from 320 to 1280 px, no requests to other sites.
