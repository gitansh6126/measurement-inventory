# Mobile tables pass (2026-10-28)

Owner: "find all tables in pages and popups, make a task list, then do all" — make table-only
screens responsive and easy to use on a phone. Branch `feature/variation-builder-merged-data`.

## How

- `table-stack` class (`app\web\app\globals.css`): below 768 px the header row is hidden and
  every row becomes a card. The first visible cell is the card title; every other cell shows
  "COLUMN NAME ..... value". Desktop is unchanged.
- `app\web\components\TableStackLabels.tsx` (mounted in `app\(app)\layout.tsx`) copies each
  column header into its cells' `data-label`, so tables need no per-cell labels. A `<th
  data-label="…">` overrides the header text (headers holding a toggle).
- Cell helpers: `stack-hide` (not shown on phone, e.g. "#"), `stack-full` (full width, left
  aligned, e.g. a cell of inputs). Cells with `colSpan` (expanded child rows) are full width.

## Task list (42 tables in 34 files)

Status: DONE = converted, GRID = screen has a Grid view (opens in Grid on phones now), FITS = 3–4
narrow columns that already fit at 375 px, SKIP = not a phone screen.

| # | Screen / popup | File | Status |
|---|---|---|---|
| 1 | Sale History | `components\DocumentHistory.tsx` | DONE (cards) |
| 2 | Purchase History, party profile histories | `components\DocumentHistory.tsx` | DONE (cards) |
| 3 | Sale / Purchase Orders list | `components\orders\OrderList.tsx` | DONE |
| 4 | Customers / Suppliers | `components\PartyList.tsx` | DONE |
| 5 | Users | `app\(app)\users\page.tsx` | DONE |
| 6 | Warehouses | `app\(app)\warehouses\page.tsx` | DONE |
| 7 | Shifts list | `app\(app)\shifts\page.tsx` | DONE |
| 8 | Shift detail | `app\(app)\shifts\[id]\page.tsx` | DONE |
| 9 | Roll history | `app\(app)\inventory\rolls\[rollId]\page.tsx` | DONE |
| 10 | Sale / Purchase document items | `components\DocumentView.tsx` (items) | DONE |
| 11 | Document revisions | `components\DocumentView.tsx` (revisions) | DONE |
| 12 | Order items | `components\orders\OrderView.tsx` (items) | DONE |
| 13 | Order fulfilment / shortage | `components\orders\OrderView.tsx` (fulfilment) | DONE |
| 14 | Import: match columns | `app\(app)\import\page.tsx` (mapping) | DONE |
| 15 | Import: preview | `app\(app)\import\page.tsx` (preview) | DONE |
| 16 | Supplier Prices sheet | `app\(app)\supplier-prices\page.tsx` (main) | DONE |
| 17 | Supplier Prices variation rows | `app\(app)\supplier-prices\page.tsx` (child) | DONE |
| 18 | Sale / purchase variation picker (popup) | `components\ProductDrawer.tsx` | DONE |
| 19 | Measured stock check (popup) | `components\measure\MeasuredDrawer.tsx` (stock) | DONE |
| 20 | Shift item picker (popup) | `components\shifts\ShiftItemDrawer.tsx` | DONE |
| 21 | Stock edit (popup) | `components\products\StockEditDrawer.tsx` | DONE |
| 22 | Product stock log (popup) | `components\products\ProductDetailModal.tsx` (log) | DONE |
| 23 | Vendor price history (popup) | `components\vendor\PriceHistoryModal.tsx` | DONE |
| 24 | Add rolls (popup) | `components\measure\RollActions.tsx` | DONE |
| 25 | Measured stock by variation | `components\measure\MeasuredStock.tsx` | DONE |
| 26 | Set entry sheet (popup) | `components\sets\SetSheet.tsx` | DONE |
| 27 | Set types | `components\sets\SetTypes.tsx` | DONE |
| 28 | Supplier price by product | `components\vendor\ProductPriceView.tsx` | already had phone cards |
| 29 | Purchase rolls entry (popup) | `components\measure\MeasuredDrawer.tsx` (rolls) | FITS |
| 30 | Take from / receive into warehouse (popup) | `components\cart\TakeFromPopup.tsx` | FITS |
| 31 | Edit diff: line items / stock impact (popup) | `components\Checkout.tsx` ×2 | FITS |
| 32 | Complete order (popup) | `components\orders\OrderView.tsx` (complete) | FITS |
| 33 | Product supplier rates (popup) | `components\products\ProductDetailModal.tsx` (rates) | FITS |
| 34 | New shift lines | `app\(app)\shifts\new\page.tsx` | FITS (no header, 3 cells) |
| 35 | Products table + variation rows | `app\(app)\products\page.tsx` ×2 | GRID |
| 36 | Inventory table + variation rows | `app\(app)\inventory\page.tsx` ×2 | GRID |
| 37 | Categories / category products | `products\categories\page.tsx`, `[id]\page.tsx` | GRID |
| 38 | Product variations | `components\products\ProductDetailView.tsx` | GRID |
| 39 | Grouped product sets | `components\sets\SetsPanel.tsx` | GRID |
| 40 | Catalog DataView | `components\catalog\DataView.tsx` | GRID |
| 41 | Inventory PDF | `app\(app)\inventory\pdf\page.tsx` | SKIP (print) |

## Checks (2026-10-28)

- `npx tsc --noEmit -p .` in `measurement-inventory\app\web`: clean.
- Browser at 375 px (demo, dev server :3520): Warehouses, Suppliers, Users, Shifts, Sale / Purchase
  History, sale document, Sale Orders list and order view (fulfilment + items), Supplier Prices,
  New Sale → Chain Hoist → Check Stock popup: one card per row, header labels, no page overflow.
  At 1024 px the same tables are normal tables.
- Not clicked through on a phone: Import, Roll history, Shift detail, Add rolls, Set sheet,
  Set types, Stock edit, Shift item picker, stock log, price history, document revisions (same
  class, same labeler).

## Notes

- The labeler uses a short timer, not requestAnimationFrame (that stalls in background tabs).
- Headers named Action / Actions / Edit give no label (the button says it).
- The card layout is `screen` only; printing from a phone still prints the real table.
- Length switch (m / ft) placed inside a column header is not shown on phones in Supplier
  Prices and Measured Stock (the header row is hidden there).
