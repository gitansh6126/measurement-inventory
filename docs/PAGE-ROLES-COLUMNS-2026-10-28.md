# Page roles + column order (2026-10-28)

Objective (owner spec, pasted 2026-10-28): give each screen one job. Stock In changes stock and
prices, Products is a read-only overview, the product page is a hub that links out. Tables get
drag-to-reorder columns that persist.

## Current behaviour

| Screen | What changed |
|---|---|
| Stock In `D:\client works\rs new\measurement-inventory\app\web\app\(app)\inventory\page.tsx` | Columns (main rows and variation sub-tables) follow the user's order; drag a header or use Columns → ↑/↓. `New Stock` is now its own column id. `?search=` pre-fills the search (opens the filter bar). Measured child rows show editable Min Selling Price / Selling Price / Min Stock next to each variation's pieces. Reason "Damaged" added. "Add Product" button removed (catalog creation lives on Products). |
| Products `...\app\(app)\products\page.tsx` | New columns SKU, Type, Selling Price, Min. Selling Price (SKU, Type, Min hidden by default). "Adjust Stock" buttons and modal removed; each row and variation row has a "Manage stock & prices" icon → `/inventory?focus=<id>&search=<name>`. Same drag / reorder. |
| Product page `...\components\products\ProductDetailView.tsx` | Inline "Adjust stock" and its modal removed. "Manage stock & prices" in the header, in the Stock & prices card and in the measured section. Stock history, Vendor pricing, Edit product unchanged. |

Shared engine: `...\app\web\lib\useTableColumns.ts` (`mergeColumnOrder`, `moveColumn`,
`useTableColumns`) and `...\app\web\components\ColumnsMenu.tsx` (`order` / `onMove` props).
`ColumnDef.pinned` (`...\app\web\lib\inventoryColumns.ts`) marks columns that never move.
CSS `.col-drop-before / .col-drop-after` in `...\app\web\app\globals.css`.

## Decisions

- Column prefs stay in the per-user server preference (`stockin.columns`, `products.columns`,
  now `{ hidden, order }`), not the `rs_col_prefs_*_v1` localStorage keys in the spec: the shop
  PC is shared by several users and the server copy follows each user to their phone. Old
  `{ hidden }` saves keep working; new columns are inserted after their default neighbour.
- Not built: column widths; a product barcode/QR label (no product-level barcode exists; rolls
  have their own label page); `/reports/stock-ledger` (the Stock history modal covers it);
  grouped "can fulfil N sets" (sets are physical stock here, already shown as a set count).
- `...\app\web\components\products\StockAdjustModal.tsx` is now unused; left in place.
- No seed change: the demo already has simple, variable, measured and grouped products that show
  every new column and link.

## Checks

- `cd app\web && npx tsc --noEmit -p .` → clean.
- Browser, `uiux-api` + `uiux-web` (:3520), Demo Admin: Products table columns, Columns menu
  move + reload keeps order, header drag (synthetic DnD) reorders with indicator, cells aligned,
  measured child rows; Stock In via the link (search filled, product expanded), measured price
  edit counted as 1 unsaved change (not saved); product page has no "Adjust stock"; phone width
  Products unchanged. Demo Admin column prefs reset to defaults afterwards.
- `D:\client works\rs new\dev-laptop\build-demo.ps1 -KeepData` (BUILD-DEMO.bat build check):
  exit 0, production build OK, built demo running on http://localhost:3510.

## Next

Owner review on the demo, then commit on a branch with the rest of the 2026-10-27/28 work
(`git status` shows many other uncommitted files from other sessions; do not mix blindly).
