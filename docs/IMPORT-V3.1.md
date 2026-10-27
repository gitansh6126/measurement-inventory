# Import (V3.1)

Owner, 2026-10-23: "create import system v3.1, so i can upload product data, stock data, sale and
purchase … while importing create column matching and confirmation, and also give empty data with
header column and 1 demo line" and "for testing … a stock sheet … if that stock product is not
created then the product will also be auto created".

## Screen: Inventory → Import (`/import`)

1. **Choose what to import**: Products, Stock, Purchases or Sales (only the kinds the user's role
   may record by hand). **Blank … template** downloads an .xlsx with the header row, one demo line
   and a "How to fill" sheet.
2. **Choose the file**: .xlsx or .csv (5 MB, 5,000 rows). Pick the sheet and the header row.
3. **Match the columns**: every field shows a column picker, matched automatically from the
   headers (template headers always match). "Same for every row…" types one value for all rows
   (e.g. Product name = Wire Rope). Option 1–3 take their name from the column header (Size,
   Brand…). A unit in a header ("Remaining (ft)") fills "Length typed in". The matching is
   remembered in the browser for the same headers.
4. **Check**: the server reports per row Ready / Check (warning) / Error with what will happen, plus
   what will be created (products, items, categories, parties, warehouses, documents). Nothing is
   saved.
5. **Confirm**: "Import N rows" → confirmation dialog → everything is saved in one transaction (all
   or nothing). Error rows are skipped; the result shows the counts and new sale/purchase numbers.

## Rules

| Topic | Rule |
|---|---|
| Finding the item | Item code (short name or official SKU) first; else product name (case-insensitive) + option values. |
| Creating products | Stock, Purchases and Products imports create missing products / items when "Create missing products and items" is on and the user has `product.write`. Sales never create products. Type: as typed, else **measured** when the row has a length or "Sold by length in", **variable** when options have values, else **simple**. New measured product without options gets option Variant = Standard. Codes are generated (base from the name, made unique). |
| Options | A product's options are every option column that has a value on any of its rows; a blank cell on such a product becomes "None" (warning). Blank option cells are ignored on products without options. A new value of an existing product's option is declared and the item added. |
| Category | Product Type category by name; created if missing; one per new product (first row wins, one warning). |
| Stock — counted | Quantity added per item and warehouse: OPENING the first time, else ADJUSTMENT ("Imported stock"). |
| Stock — measured | One row = one roll (Quantity n = n rolls of that length). Sealed / open: yes / sealed / closed = closed roll, other = open, column not used = closed. Roll no., rack, notes, cost per roll. Lengths converted from m / ft / in / cm / mm to the product's unit. |
| Grouped products | Refused (stock is sets: use Add opening sets / purchase). |
| Purchases / Sales | Rows with the same Bill no. (else same date + party) are one document, written with `writeDocument` like checkout. Same item + rate on one bill merge into one line (measured purchase rows become rolls of one line). A bill with any error row is skipped whole. Notes: "Imported bill …". Sales check free stock in sheet order. Dates dd/mm/yyyy, yyyy-mm-dd or 01-Oct-2026; no future dates. Rates are whole rupees (decimals rounded with a warning). |
| Parties | Matched by name; created when missing ("Create missing customers / suppliers"). A customer cannot be used as a supplier (and the reverse) unless its type is Both. |
| Warehouse names | Under the column matching, "Warehouses not found" lists sheet names that match no warehouse code or name and lets the user pick the warehouse each means (owner 2026-10-23: Godam = W1 Main Godown). The page swaps the name before sending; left unpicked it is an error, or a new warehouse when "Create missing warehouses" is on. |
| Warehouses | Matched by code or name. Unknown = error, or created with "Create missing warehouses" (admin). While warehousing is off a warehouse column is ignored with a warning; creating the first warehouse switches warehousing on (WH-1). |
| Totals | A row with a cell "Total" / "Grand total" / "Sub total" is skipped. |

## Files

| Area | Files |
|---|---|
| Shared | `app\shared\src\import.ts` (fields per kind, header matching, result types; exported as `@rs-v31/shared/import`) |
| API | `app\api\src\lib\sheet.ts` (.xlsx/.csv reader and .xlsx writer on `node:zlib`, no new dependency), `app\api\src\lib\import.ts` (check + commit), `app\api\src\routes\import.ts` (`GET /api/import/templates/:kind`, `POST /api/import/read`, `POST /api/import/:kind/check`, `POST /api/import/:kind/commit`), `app\api\src\app.ts` (mount; 5 MB JSON limit for `/api/import` only) |
| Web | `app\web\app\(app)\import\page.tsx`, nav item in `app\web\app\(app)\layout.tsx` |
| Tests | `app\api\tests\unit\sheet.test.ts`, `app\api\tests\integration\import.test.ts` |
| Samples | `docs\import-samples\*-import-template.xlsx` (blank templates), `docs\import-samples\stock-import-test.xlsx` (test sheet; last column says what each row should do) |

Permissions: Products `product.write` (prices also `inventory.configure`), Stock `stock.adjust`,
Purchases `purchase.create`, Sales `sale.create`. Every import writes an `IMPORT` audit event plus
the usual events of what it created.
