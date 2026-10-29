# Plan: grouped sets, measured pieces and child-row order (2026-10-28)

Owner requests (2026-10-28, this session):

1. Products page: under a measured product's variation rows, a second level of child rows showing
   the Cut / Open / Closed pieces like Stock In, but read-only (no add, cut, open, correct, write off).
2. Stock In, grouped product: remove the "Sets ↗" button; edit stock, selling price, min selling price
   and min stock **on each set-type child row**. No standard price on the grouped product itself.
3. Add sets sheet: selling price, min selling price and min stock per set.
4. Standard sets: defined while creating a grouped product. In **Stock In and Purchase** the user only
   types a number of sets and the sets are made from the standard set (parts come in as new stock with
   the set). Not in Sale.
5. The original problem: every child row (variations, measured variations, set types) gets the Order
   control (drag + dropdown, like variations), saved in the database and the same on Stock In and Products.

Decisions taken in chat: own prices per set type (new table, migration 0041); lowering a set count in
Stock In only undoes sets added in Stock In (opening sets), purchase sets go with their purchase;
standard sets: yes; parts for auto-made sets come in as new stock (Stock In and Purchase only).

---

## Phase 0 — Already built in this session (uncommitted, not yet checked in the browser)

| # | What | Files |
|---|------|-------|
| 0.1 | Products: measured variation rows have a ▸ toggle that opens a read-only Cut / Open / Closed panel (a piece only opens its record page) | `app\web\components\measure\MeasuredStock.tsx` (`VariationPieces`), `app\web\app\(app)\products\page.tsx` |
| 0.2 | Migration **0041** `group_set_types`: per set type `sale_price`, `min_sale_price`, `low_stock_threshold`, `sort_order`, plus `standard`, `name`, `parts` for standard sets | `app\api\prisma\migrations\0041_set_type_prices\migration.sql`, `schema.prisma` |
| 0.3 | API: `GET /api/sets/types/:groupId` (standard sets + types in stock, counts, prices), `PUT /api/sets/types/:groupId/standard` (product form), `POST /api/sets/types/:groupId/stock-in` (new count builds / undoes sets, prices); sets carry `typeKey`; `GET /api/sets` returns `typePrices`; opening sets take prices | `app\api\src\lib\set-types.ts` (new), `lib\sets.ts`, `routes\sets.ts` |
| 0.4 | Backup / restore / wipe include `group_set_types` (keys rebuilt on restore) | `app\api\src\routes\backup.ts` |
| 0.5 | Stock In: "Sets ↗" removed; grouped parent row has no price fields; set-type child rows edit New count (stepper), Selling, Min selling, Min stock; one **Save Stock** saves items and sets | `app\web\app\(app)\inventory\page.tsx`, `components\sets\SetTypes.tsx` |
| 0.6 | Products list: grouped price = range over its set types; child rows show each set type's price / min / stock, standard sets even at 0 | `products\page.tsx`, `SetTypes.tsx` |
| 0.7 | Add sets sheet: Selling / Min selling / Min stock columns; "Standard set × N" quick fill (also on the purchase set sheet) | `components\sets\SetSheet.tsx`, `SetsPanel.tsx`, `PurchaseSetsModal.tsx` |
| 0.8 | Standard sets editor on the grouped product edit page; a new grouped product goes to "Step 4 · Standard sets" | `components\sets\StandardSetsEditor.tsx` (new), `products\[id]\edit\page.tsx`, `products\new\page.tsx` |
| 0.9 | Sale set drawer prices a set from its set type | `components\sets\SaleSetsModal.tsx` |
| 0.10 | Demo seed: 3 standard sets with prices, one built through Stock In; integration test written | `app\api\scripts\seed-demo.ts`, `tests\integration\grouped.test.ts` |

Checks so far: API + web `tsc --noEmit` clean; API unit tests 149/149 pass. Integration tests **not run**:
Prisma refuses `migrate reset` of the test database when an agent starts it (needs the owner's yes).

---

## Phase 1 — Finish and verify the set work (next, ~1 session)

| # | Task | Why / detail | Done when |
|---|------|--------------|-----------|
| 1.1 | Browser check on the verify server (ports 3515 / 4515) | Stock In grouped ⊕ rows, edit + save, Products measured ▸ pieces, Add sets prices, standard sets editor | Screenshots, no console errors |
| 1.2 | Run integration tests | Owner says yes for the test-database reset, or runs `npm run test:integration` in `app\api` | `grouped.test.ts` green incl. new 0041 test |
| 1.3 | Purchase: standard set **count** input | Today the purchase sheet fills N rows from a standard set; owner wants "type a number" — add a compact "Standard sets" tab: one row per standard set with a quantity box | 5 typed → 5 sets on the line |
| 1.4 | Stock In grid drawer and mobile layout for set rows | Set child table has 6–9 columns; check `table-stack` on 375 px | Usable on phone |
| 1.5 | Product page (`ProductDetailView`) for grouped | Still shows the old single price; show set types with their prices | No "standard price" left in the UI |
| 1.6 | Low-stock for grouped | Parent row Low/Out state still uses the product's old min stock; switch to "any set type at or below its min stock" (API `lib\stock.ts` state + Stock In tabs) | Low tab lists a grouped product when a set type is low |
| 1.7 | Cart / documents | Sale cart line price comes from the type (done); check PDF / invoice names show the standard set name | Name on document |
| 1.8 | Docs + propagation log | `docs\GROUPED-PRODUCTS-V3-PLAN.md`, `V3.2-BACKLOG.md`, `references for final inven\AI_CONTEXT\15-cross-version-change-propagation.md` | Entries written |
| 1.9 | Demo rebuild | Owner double-clicks "Build + Demo" (agent may only run `-KeepData`) | Demo shows standard sets |

### Phase 1 status (2026-10-29)

- 1.1 Done: browser check on the verify server (3515/4515) — Stock In set rows edit + save (+1 set, ₹9,300 shown on Products too), Products set rows, read-only measured pieces (another session's Cut / Open / Closed summary rows), edit-page standard sets, Add sets "Standard set × N" fill.
- 1.2 Done (owner said yes 2026-10-29): full integration suite 216/217, the one failure was the new test expecting a sales manager to be refused set prices — wrong expectation (sales managers have `inventory.configure`; only adding/removing sets is admin-only). Test fixed; `grouped.test.ts` 14/14 pass.
- 1.3 Done for now: purchase and Add sets sheets fill N rows from a standard set (type a number, press Add). A separate quantity-only table stays open (question 1).
- 1.4 Done: phones — child panels were as wide as the whole parent table, so stacked values sat off-screen; `.table-wrap` is now a size container and `.child-panel` is sticky at the visible width (`app\webpp\globals.css`); parts chips get a min width on desktop.
- 1.5 Done: grouped product page shows the price range over set types and a per-set-type stock / price list.
- 1.6 Done: Stock In Low / Out tabs count a grouped product when a standard or priced set type is at or below its own min stock (`apppi\src\lib\inventory-query.ts`, set keys rebuilt in SQL); the parent stock badge still uses the total.
- 1.7 Deferred: documents keep the product name and list each set's parts; adding the standard set name to stored line snapshots changes the document format.
- 1.8 Done: this file and the cross-version log.
- 1.10 Done (owner 2026-10-29: "Step 4 should be on the same page for creating"): Add Product → Grouped now has **Step 4 · Standard sets** inside the form; "Create Set Product" saves the product and its standard sets together (checked before the product is created; draft by-product keys are mapped to the saved links). The edit page keeps its own "Standard sets" editor; no more redirect. Shared UI: `components\sets\StandardSetsEditor.tsx` (`StandardSetsFields` with the Cards / Table view, `DraftStandardSets`, `saveDraftStandardSets`). Browser check: created "Test Hoist Set" with "Std 2 m" (8 mm · 2 m, ₹5,000 / ₹4,500 / min 2) in one click.
- 1.9 The demo database already holds the new seed (standard sets visible); a fresh "Build + Demo" by the owner is still the final check.

## Phase 2 — Child-row order everywhere (the original problem, A2 in the backlog)

Today: variation rows have `VariationOrderCell` (drag + move menu) on Products and Stock In and save
to `product_variations.display_order` (0017), so those two pages already share one order.

| # | Task | Detail |
|---|------|--------|
| 2.1 | One shared component | Reuse `VariationOrderCell` for every child table; add a small "Position" dropdown (1…N) next to the drag handle, as asked, keyboard friendly |
| 2.2 | Measured variations in Stock In | `MeasuredStockPanel` rows layout has no order cell; add it (same `PUT /products/:id/variations/order`) |
| 2.3 | Set-type rows | Add `PUT /api/sets/types/:groupId/order` writing `group_set_types.sort_order` (rows without a stored row get one); Products, Stock In, drawer, sale picker and set sheets list in that order |
| 2.4 | By-product (part column) order | `group_byproducts.sort_order` already exists; add the order control in the product edit "Set contents" |
| 2.5 | Sync | All pages read the order from the API, and any write clears the query cache, so the order is the same on both pages after a save — add a test that reorders on one endpoint and reads both lists |
| 2.6 | Seed + tests | Demo with a non-alphabetical order; integration test per row kind |

### Phase 2 status (2026-10-29)

- 2.1 Done: `components\VariationOrderCell.tsx` has a **position dropdown** (1…N, shown from 3 rows) next to ⋮⋮ ↑ ↓; every child table uses it. New `lib\useRowOrder.ts` (drag-to-reorder hook + `moved`).
- 2.2 Done: measured variation rows (Stock In and Products, `MeasuredStockPanel` rows layout) have the Order column, saved with `PUT /api/products/:id/variations/order`. **Bug fixed:** `GET /api/measure/products/:id/pieces` listed variations by creation date, so measured rows ignored the saved order (`app\api\src\routes\measure.ts`).
- 2.3 Done: set-type rows have the Order column (`SetTypesTable`, used by Stock In, the Stock In drawer and Products); `PUT /api/sets/types/:groupId/order` saves `group_set_types.sort_order` (a type never placed gets a row that keeps its shown prices). Under a warehouse or category filter only the shown rows move.
- 2.4 Done: "Change by-products" dialog (product page → Sets) has ↑ ↓ and a position dropdown; the order is saved with the list (existing API). Standard sets list their parts in the by-product order.
- 2.5 Sync: every page reads the order from the API and each save clears the cached lists. Browser check: Workshop 6 mm moved to 1 on Stock In showed first on Products; Load Chain 8 mm moved up on Stock In showed first on Products.
- 2.6 Seed: the demo's Chain Hoist Set saves "Workshop 6 mm" first. Integration test added (`grouped.test.ts`, "child-row order"); run with the owner's yes 2026-10-29: `grouped.test.ts` 15/15 pass.
- Not done: Step 3 by-product order on Add Product (list order is used), sale set picker order.

## Phase 3 — Wider system improvements (proposed, owner to pick)

| # | Area | Proposal | Value |
|---|------|----------|-------|
| 3.1 | One "child rows" component | Stock In and Products each build their own variation / measured / set child tables (≈ 400 duplicated lines). One `ChildRows` component with `mode: "edit" | "view"` | Fewer bugs where the two pages drift apart (this request's root cause) |
| 3.2 | Set types as first-class | Use `group_set_types` for vendor set rates (A3 now stores them on the product's own variation) and for set backorders | One price model for sets |
| 3.3 | Stock In for sets in warehouses | With "All warehouses", adding sets goes to the default warehouse; add a warehouse picker per set row like counted items | Correct receipts |
| 3.4 | Undo any set from Stock In | Today only opening sets can be lowered; optional "dismantle into free parts" action with a reason (audit) | Fix counting mistakes on purchased sets |
| 3.5 | Test gate | Let the owner run `test:integration` from a desktop shortcut (like Build + Demo) so agents can ask for one click | Integration tests run on every feature |
| 3.6 | Mobile pass for child tables | Continue `docs\MOBILE-TABLES-2026-10-28.md` for the new set and piece rows | Shop staff on phones |
| 3.7 | Performance | Set-type badge, price range and child rows each call `/sets/types` (shared cache, one request per product); with 100+ grouped products add `GET /api/sets/types?groupIds=` batch | Faster lists |

## Open questions for the owner

1. Purchase: is "fill N rows from a standard set" enough, or do you want a pure quantity table (1.3)?
2. Grouped Low stock: per set type (1.6) — confirm.
3. Order control: drag handle **and** a position dropdown, or the dropdown only?
4. Phase 3: which items, and in what order?

## Handoff

- `git status`: many earlier uncommitted changes in `measurement-inventory\` from other sessions, plus the
  files in Phase 0. Nothing committed.
- Next step: Phase 1.1 browser check, then 1.2 with the owner's yes.
