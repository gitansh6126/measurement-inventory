# Web duplication pass — 2026-10-30

Objective: remove copy-pasted UI and logic across the Products, Category and Stock In pages
without changing what the shop sees. Branch `changes-2026-10-29`, uncommitted (on top of the
owner's other uncommitted work; nothing of that was touched beyond the lines below).

## What the external analysis claimed vs the code

| Claim | Finding |
|---|---|
| Image fallback repeated per card | Already shared: `app\web\components\ProductThumb.tsx`. |
| Stock badge colours repeated | Already shared: `app\web\components\StockBadge.tsx`. But the *rule* (`stateOf`) lived in Stock In and `quantity <= lowStockThreshold` was inlined on 5 screens. **Fixed.** |
| Product card copy-pasted on Products / Category / Stock In | **True** — three ~30-line copies of the same card. **Fixed** with `ProductTile`. |
| Pagination bar duplicated | Already shared: `Pagination` in `app\web\components\ui.tsx`. |
| Debounced search duplicated | **True** — 5 copies. **Fixed**, and a bug found (below). |
| TanStack DataTable / `useTableState` | Not worth it now: tables already share `.table`, `useTableColumns`, `ColumnsMenu`, `Pagination`; each table's rows differ (child rows, sets, measured pieces). A generic grid would be a rewrite with high risk. |
| ProductPickerModal, MeasurementFields, CategorySelect, PriceTag | Pickers already exist per purpose (`PartyPicker`, `CategoryHeadSelect`, `HeadCategoryPicker`, `RateField`, `fmtSellRate`). Left as is; revisit only when a fourth copy appears. |

## Changes (all under `D:\client works\rs new\measurement-inventory\app\web\`)

- New `components\products\ProductTile.tsx`: `ProductTile` (grid card: image, name, meta, badge,
  price, note, footer, top-right actions; link or button) and `ProductKind` ("Measured · N
  variations" / "N variations" / fallback). Used by `app\(app)\products\page.tsx`,
  `app\(app)\products\categories\[id]\page.tsx`, `app\(app)\inventory\page.tsx`.
  The card is not clipped (only the image is), so the category "⋯" menu still overflows.
- New `lib\useDebounced.ts`: `useDebounced(value, ms)` and `useDebouncedSearch(search, onChange)`.
  Replaces copies in Stock In, Category add-product picker, `PartyList`, `DocumentHistory`,
  `orders\OrderList`.
- New `lib\scrollToFocus.ts`: the `?focus=` scroll (100 ms + 300 ms retry, with cleanup). Used by
  Products, Stock In, Category page (its old `setTimeout` had no cleanup), `vendor\ProductRail`.
- `components\StockBadge.tsx`: `stockState()` (moved from Stock In) and `isLowStock()`;
  `StockState` now re-exported from `lib\types.ts` instead of declared twice.
- `lib\measure.ts`: `stockLengthOf(p)` replaces the two `lenOf` copies and two inline builds.

Net: about 20 fewer lines in the pages, plus 3 small shared files.

### Bug fixed

`DocumentHistory` (Sales / Purchases) and `OrderList` called `updatePage(1)` 250 ms after the
first render, so opening `/sales?page=3` (or Back to it) jumped to page 1 and pushed an extra
history entry. `useDebouncedSearch` only resets the page when the search text changes.

### Visible change

On the Category page a Measured product card now shows the blue "Measured · N variations" like
Products and Stock In (it showed the first variation's short name).

## Validation

- `npx tsc --noEmit` in `app\web`: exit 0.
- Browser (another chat's dev server on this folder, `localhost:3520`, demo admin, 375 px):
  Products grid, Stock In grid (set-type badge, measured chip, low badge; card opens the stock
  drawer), Category "Lifting Equipment" grid ("⋯" menu opens over the card edge; search "clamp"
  filters to one card), `/sales?page=2` keeps `?page=2`, typing a search goes to `/sales`.
  No console errors.
- Not run: `BUILD-DEMO.bat -KeepData` (would stop the shared dev servers). No seed change needed
  (no new feature/field). No API change.

## Follow-up (same day): `useUrlPage`

- New `lib\useUrlPage.ts`: page number kept in `?page=` (page 1 = no param), follows
  Back / Forward; `syncUrl: false` keeps it in state only. Replaces the identical sync effect +
  `updatePage` blocks in `components\DocumentHistory.tsx` and `components\orders\OrderList.tsx`
  (those 2 files: +38 / −75 lines together with the debounce change).
- Small behaviour fix: an *embedded* history list (party profile) no longer starts on the host
  page's `?page=`; it starts at page 1 and keeps its page in state, as it already did when paging.
- Checks: web `npx tsc --noEmit` exit 0 (a first run hit `lib\types.ts` `TechSpec` from another
  session's in-progress 0044 work; clean on re-run). Browser `localhost:3520`: `/sales?page=2`
  requests `page=2` and shows "← Page 1"; clicking it goes to `/sales` (`page=1`); Back returns
  to `?page=2` and requests `page=2`; `/sales/orders?page=2` requests `page=2`.

## Next candidates

1. Other inline `metaOf({ ...(p.measure ?? {}), lengthUnit: ... })` copies in `MeasuredDrawer`,
   `StockEditDrawer`, `orders\OrderView` → `stockLengthOf` where the product is always measured.
2. `app\(app)\inventory\page.tsx` (≈1,950 lines) and `products\page.tsx` (≈1,200) — split the
   table row renderers into components before any further feature work there.
