# V3.1 handoff — 2026-10-21

**Objective:** build grouped products (sets) and then basic warehousing in `v3.1\` (owner:
"start apply on v3.1" = new copy of v3; owner 2026-10-21: "Grouped products" first, "and also
demo data for it"). `D:\client works\rs new\v3\` stays unchanged as the snapshot.

## Environment (done 2026-10-20 / 21)

- `v3.1\` = copy of `v3\`; own identifiers: `@rs-v31/*`, `rs_v31_demo` / `rs_v31_test`
  (created by the owner with `app\api\scripts\setup-v31-db.sql`), web 3510 / API 4510,
  prototype 8081. Start: `local-server\START-V3-DEV.bat` or the network launcher below.
- Network / internet dev launcher: `START-V3.1-NETWORK-DEV.bat` →
  `local-server\START-NETWORK-DEV.ps1` (LAN; optional firewall rule when run as admin;
  optional Cloudflare quick tunnel, asks to install `cloudflared` via winget). `stop.ps1`
  also stops the tunnel. LAN-only run verified 2026-10-21 (`-NoInternet`): dev mode up,
  `http://192.168.1.11:3510/api/version` and `/login` answer 200 from the LAN address (log
  `local-server\logs\network-dev-trial.log`). The earlier "exit code 4" was the agent shell's
  output capture, not the script. The internet tunnel is untested (`cloudflared` not installed;
  the script asks before installing it).
- Prerequisite fixes: backup now keeps company length settings, order `version`, order-line
  `rolls` / `pieceId` / `linkedOrder*`; 3 stale integration tests fixed (purchase response
  shape, company length decimals, V1-archive converter). Old FK-name drift: `order_lines`
  names mapped in `schema.prisma`; the remaining `*_same_company_fkey` differences are the
  deliberate composite tenant FKs from 0024 (Prisma cannot model them) — leave as is.

## Grouped products — phase 1 (built 2026-10-21)

Plan: `docs\GROUPED-PRODUCTS-V3-PLAN.md` (status + §9 build order updated).

| Area | Files |
|---|---|
| DB | `app\api\prisma\migrations\0030_grouped_type\`, `0031_grouped_sets\`; `schema.prisma` (ProductType `grouped`, `ownerGroupId`, `GroupByproduct`, `GroupSet`, `GroupSetPart`, `GroupSetPartChange`, `MeasurementPiece.setId/setOrigin`, PieceAction `SET_ALLOCATE/SET_RELEASE`) |
| Create / edit | `app\api\src\lib\product-create.ts` (new; shared create + `createGroupedProduct`), `lib\products.ts` (`groupedBody`, `plainProductBody`, `serializeGroup().grouped`, `ownerGroup`), `routes\products.ts` (list hides main components; grouped edited like Simple; archive cascades to main) |
| Sets | `lib\sets.ts`, `routes\sets.ts` (mounted at `/api/sets` in `app.ts`); permission `set.opening` (admin) in `lib\permissions.ts` |
| Stock rule | `lib\stock.ts` `freeBalances()`; `recordMovements` → `SETS_ONLY`, `PARTS_IN_SETS`; `lib\measure.ts` set pieces skipped / `PIECE_IN_SET`; `lib\inventory-query.ts`, `routes\inventory.ts` (free stock, `inSets`, sets in stock, `USE_SETS`) |
| Backup | `routes\backup.ts` exports / restores all set tables, `ownerGroupId`, piece `setId/setOrigin` |
| Web | `components\products\ProductForm.tsx` (4th type), `GroupedSetCard.tsx` (new), `components\sets\SetsPanel.tsx` (new), `ProductDetailView.tsx`, `ProductBrowser.tsx` (cart card "Sets · cart coming soon"), `lib\types.ts`, `app\(app)\products\new\page.tsx` |
| Demo | `app\api\scripts\seed-demo.ts`: Load Chain 6 mm added; **Chain Hoist Set** (CHS) = Hoist Body 1 Ton + Load Chain (required, measured) + Safety Hook 1 Ton (optional, created inline); 3 opening sets; 4 loose hooks |
| Tests | `app\api\tests\integration\grouped.test.ts` (6 tests) |

Behaviour now: a grouped product is created with a new main part and linked by-products;
sets come in only as admin opening sets (purchase = phase 2); each set's parts are in their own
products' stock but not free (Stock In, cart cards and product pages show free stock and "In
sets"); nothing can sell or adjust stock fitted in sets; a set is named by contents and coded
`CHS-8MM-2.5M-SH-1T-21-10-26-01`.

## Checks (in `v3.1\app`, test DB `rs_v31_test`)

| Command | Result |
|---|---|
| `npm run typecheck` | clean (api + web) |
| `npm test` | 123/123 |
| `npx vitest run --config vitest.integration.config.ts tests/integration/grouped.test.ts tests/integration/backup-v2.test.ts` | 10/10 (twice); one earlier run hit a transient "Can't reach database server" in the backup export — passed on rerun (same local flake seen once in the numbering test) |
| full integration suite (before the backup-of-sets change) | 173/173 |
| full integration suite (final, `npx vitest run --config vitest.integration.config.ts`) | **174/174**, 19 files (`local-server\logs\integration-grouped-phase1.log`) |
| `npm run demo:reset` (api) on `rs_v31_demo` | seeded, `groupedSets: 3` |
| Browser, `http://localhost:3510` as demo admin | Add Product shows 4 types; created "Lever Hoist Set" through the form (later wiped by the reseed); Chain Hoist Set page shows contents + 3 sets; "Add opening sets" sheet saved 1 set (now 4 in the demo) |

## Grouped products — phase 2: buying sets (built 2026-10-21)

| Area | Files |
|---|---|
| DB | `prisma\migrations\0032_grouped_documents\` (grouped lines may repeat; `documents_consistent` counts set parts) |
| API | `lib\documents.ts` (line `sets[]`, `createSets(PURCHASE)`, no supplier rate for sets, `SETS_NOT_EDITABLE`, void calls `cancelPurchaseSets`), `lib\sets.ts` (`cancelPurchaseSets`, `setsOfDocument`), `lib\measure.ts` (`reversePurchaseRolls` skips set pieces), `lib\orders.ts` (`SETS_ORDER_NOT_READY`), `routes\documents.ts` (line `sets` on the document view), `routes\drafts.ts` (held carts keep sets) |
| Web | `components\sets\SetSheet.tsx` (shared sheet), `PurchaseSetsModal.tsx`, `ProductBrowser.tsx` ("Enter sets" in New Purchase; New Sale shows "Sets · selling coming soon"), `CartContext.tsx` (line `sets` / `setSummaries`, never merged), `Checkout.tsx` (set list + Edit sets), `CartSidebar.tsx`, `DraftsDrawer.tsx`, `DocumentView.tsx` (set names + codes; Edit blocked) |

Rule decided while building: sets on one document line share its price; the cart splits sets
at different rates into separate lines of the same grouped product automatically.

Checks: api `tsc` clean; web `tsc` clean; `grouped.test.ts` 7/7 + `documents.test.ts` +
`backup-v2.test.ts` = 22/22; browser (demo admin, `http://localhost:3510/purchases/new`):
"Enter sets" → 2 sets (8 mm 3 m + hook @ ₹6,200; 6 mm 4.5 m @ ₹5,800) → 2 cart lines →
checkout with Crossbee → `PUR/2026-27/0003` ₹12,000, page lists `CHS-8MM-3M-SH-1T-21-10-26-01`
and `CHS-6MM-4.5M-21-10-26-01`. Full integration suite not re-run after phase 2 (another session
was editing shared files at the time — run it once both are done).

**Parallel work:** session "Category and product relationships" is adding category heads in the
same folder (migration `0033_category_heads`; edits in `products.ts`, `product-create.ts`,
`inventory-query.ts`, `routes\products.ts`, `app.ts`, `schema.prisma`, `backup.ts`, seed, and
web product/category files). Coordinated by message; warehouses now take migration `0034`.

## Grouped products — phase 3: selling sets + Stock In (built 2026-10-22)

Owner: "only vendor pricing for grouped product not now, but purchase and sale and stock in
should run and work".

| Area | Files |
|---|---|
| DB | `app\api\prisma\migrations\0036_set_sales\` (deferred piece/part check reads rows as at commit) — applied to `rs_v31_test` and `rs_v31_demo` with `prisma migrate deploy` |
| API | `lib\sets.ts` (`saleSetInput`, `prepareSaleSets`, `sellSets`, `restoreSaleSets`), `lib\documents.ts` (sale line `saleSets[]`; part changes before loose lines, sets sold after; void restores sets), `routes\drafts.ts` (held carts keep `saleSets`), `routes\documents.ts` (set line no longer lists its chain piece) |
| Web | `components\sets\SaleSetsModal.tsx` (new), `ProductBrowser.tsx` ("Choose sets"), `CartContext.tsx` (`saleSets`, `isSetLine`), `Checkout.tsx`, `CartSidebar.tsx`, `DraftsDrawer.tsx`, `sets\SetsPanel.tsx` (`AddSetsModal`), `app\(app)\inventory\page.tsx` (grouped row: set count + "+ Add sets") |
| Tests | `tests\integration\grouped.test.ts` new "sells sets…" test; purchase test now expects `SETS_REQUIRED` for a sale without sets |

Behaviour: New Sale → Chain Hoist Set → "Choose sets" lists sets in stock; tick sets, Change a
part (variation, length, piece — auto = first free piece that fits in the set's warehouse), Add an
optional part or Remove it; price per set = set price − old part + new part (D12); sets at the same
price share one cart line. On save the old part goes back to free stock (chain = same Cut piece),
the new one is cut / taken from free stock, every part gets a SALE movement and the set is SOLD.
Cancel sale brings the sets back with the parts they were sold with (D15). Stock In: grouped row
shows its set count and "+ Add sets" (admin; managers see "By purchase"). Vendor pricing for sets
stays off (D24). Sale edit with sets still "cancel and re-enter" (`SETS_NOT_EDITABLE`).

Checks (in `v3.1\app\api`, no-reset vitest config = `vitest.integration.config.ts` without
`globalSetup`):

| Command | Result |
|---|---|
| `npx tsc --noEmit` (api, web) | clean |
| `npm test` | 129/129 |
| no-reset vitest: grouped, documents, measure, orders, warehouses, backup-v2, document-edit | 84/84 (7 files) |
| Browser, verify pair (web 3515 / API 4515, demo admin, warehousing on) | Stock In "+ Add sets" saved 1 set (8 mm 3 m); New Sale picked set CHS-6MM-3M-SH-1T-6-10-26-01, changed chain 6 mm → 8 mm (₹8,500 − 720 + 930 = ₹8,710), checkout → SAL/2026-27/0008 ₹8,710 named "8 mm 3 m · Safety Hook 1 Ton". No console errors. These rows are in `rs_v31_demo`. |

Not built yet: sale orders holding sets (D23 — orders still refuse grouped lines,
`SETS_ORDER_NOT_READY`) and purchase orders receiving sets. Full integration suite with the standard
config not run (needs owner consent for `migrate reset` of `rs_v31_test`).

## Grouped products — sets on orders (built 2026-10-22)

Owner: "build sale orders that hold sets and purchase orders that receive sets in v3.1".

| Area | Files |
|---|---|
| DB | `app\api\prisma\migrations\0037_set_orders\` (`order_lines.sets` JSONB; a grouped product may repeat on an order) — applied to `rs_v31_test` and `rs_v31_demo`. `schema.prisma` has `OrderLine.sets`, but the code reads/writes the column with SQL (`saveOrderSets`, `orderLineSets`) because `prisma generate` could not replace the engine DLL while the owner's V3.1 server (3510/4510) was running — run `npx prisma generate` once those servers are stopped (nothing depends on it) |
| API | `lib\sets.ts` (`holdOrderSets`, `releaseOrderSets`, `unholdForDelivery`, `setsOfOrder`, `checkSetRows`; set view adds `orderId`), `lib\orders.ts` (line `sets` / `saleSets`; create / edit hold, cancel releases; delivery sells the held sets with the planned part changes, whole line only `WHOLE_SETS`; receipt takes the sets typed at receipt or those on the order), `lib\documents.ts` (void of a delivery re-holds the sets for the reopened order), `routes\orders.ts` (line `productType`, `sets`, `saleSets`, `heldSets`; set lines no shortage), `lib\measure.ts` (shortage report counts held sets), `routes\backup.ts` (exports / restores `order_lines.sets`, set ids remapped) |
| Web | `components\orders\OrderView.tsx` (held sets per line, "all sets" on delivery, "Enter sets received" sheet on receipt, Edit items keeps sets), `sets\SaleSetsModal.tsx` (`orderId`: the order's held sets can be picked again when editing), `sets\PurchaseSetsModal.tsx` (`defaultRate`), `Checkout.tsx`, `ProductBrowser.tsx` |
| Tests | `tests\integration\grouped.test.ts`: "sale orders hold sets…" and "purchase orders receive sets…" |

Behaviour: a sale cart with sets → "Save as order" holds those sets (hidden from other sales and
orders, shown "Held" on the order page); editing the order releases and re-holds; Complete sells
them with the part changes planned in the cart; cancelling the delivery's sale re-holds them;
cancelling the order frees them. A purchase order carries the sets entered in the cart (received
together) or only a number of sets — then each receipt types its sets ("Enter sets received"),
partial receipts allowed. Vendor pricing for sets stays off (D24).

Checks: api + web `tsc` clean; no-reset integration (grouped, orders, backup, documents,
warehouses): 51/51; final run `npm test` 129/129 and no-reset integration (grouped, orders,
measure, measured-shortages, backup-v2, documents, document-edit, warehouses) 89/89, 8 files. Browser (verify pair, demo
admin): sale cart set → SO/2026-27/0005 held CHS-8MM-4.5M-6-10-26-01 → Complete → SAL/2026-27/0009;
PO/2026-27/0003 (2 sets, none entered) → "Enter sets received" 6 mm 3 m → PUR/2026-27/0006, order
Partially fulfilled. These rows are in `rs_v31_demo`.

## Grouped products — clean set display (built 2026-10-22)

Owner: show sets cleanly everywhere, no short names / SKU, no set codes, piece codes or
purchase/date line on screens (codes kept for search only). One form: part name → value
(`Load Chain Grade 80 → 8 mm · 3 m`; a part with no options reads `Fitted`).

Files: API `src\lib\sets.ts` (`serializeSet` part `value` + set `contents`, `setContentsByIds`,
set error messages without codes), `src\lib\transfers.ts` (shift lines `setContents`),
`src\routes\documents.ts` (set `contents`), `src\routes\drafts.ts` (`setDetails`). Web new
`components\sets\SetContents.tsx` (shared display) and `components\sets\StockInSets.tsx` (Stock In
child rows); changed `SetsPanel.tsx`, `SetSheet.tsx`, `PurchaseSetsModal.tsx`, `SaleSetsModal.tsx`,
`CartContext.tsx`, `CartSidebar.tsx`, `Checkout.tsx`, `DraftsDrawer.tsx`, `DocumentView.tsx`,
`orders\OrderView.tsx`, `products\ProductDetailView.tsx`, `app\(app)\inventory\page.tsx`,
`app\(app)\shifts\new\page.tsx`, `app\(app)\shifts\[id]\page.tsx`, `lib\types.ts`.

Behaviour: product page set cards list parts only (Cancel kept for opening sets); Details hides
Short name / SKU for grouped. Stock In grouped row has ⊕ → child rows (one column per part,
warehouse, count; identical sets merged); the set count follows the warehouse filter (it showed all
sets in W2 before). Cart lines carry `setDetails` (older held carts / drafts fall back to the old
one-line summaries). Documents show "Set n" + parts; a stray "0" under every document title is fixed.

Checks: `npx tsc --noEmit` api + web clean; `npm test` (api) 129/129. Browser on the verify pair
(3515/4515, demo admin): product page, Stock In (W2 = 0 sets, All = 5 rows / 6 sets), PUR/2026-27/0003,
sale set picker with a chain change → checkout line, new-shift set picker. Test cart lines were
deleted; nothing saved. Not run: integration suite (needs consented `rs_v31_test` reset); a saved
shift with a set (none exists in demo data). Card (grid) view of Stock In is unchanged.

**Set child rows like variations (2026-10-23).** Owner: child rows for grouped products in Stock In
and on the product pages, "take reference from variation product child rows". New shared
`components\sets\SetTypes.tsx` (replaces `StockInSets.tsx`): a *set type* = sets with the same
parts, shown like a variation — parent row badge "N set types" (violet, like "N variations"), ⊕
child table `# | parts | Stock on Hand | In warehouses | Actions`. Used by: Stock In table
(part columns, follows the warehouse filter), Stock In grid card badge + drawer ("Sets in stock"
under the price row, `StockEditDrawer` `extra` prop), Products list (⊕, part chips like
"Variation Attributes", View → set product page; Expand all includes sets; vendor-pricing and
Adjust stock buttons hidden for sets — V4 / not applicable). Set product page Sets section:
Grid | Table switch (`ViewToggle`), Table default and remembered in localStorage
(`rs-v31-sets-view`), one row per set with part columns, warehouse, status, Cancel for opening sets.
Checks: web `npx tsc --noEmit` clean; api `npm test` 133/133 (4 new tests belong to another
session's Import work). Browser on the verify pair: Products list ⊕ → 5 set types (2 sets on one
row), product page Table + Grid + Sold tab, Stock In table badge, grid card + drawer. Note: another
session was editing V3.1 at the same time (Import page: `app\(app)\import`, `layout.tsx`,
`icons.tsx`, `api\src\lib\import.ts`); one console error `ArrowInIcon is not defined` came from
that work mid-edit, not from these files.

## Grouped products — Build set in the sale (built 2026-10-23)

**Objective:** owner: in a sale of a grouped product, choose the contents like a Measured product
(options + length in any unit); the system decides whether a set in stock already has them or
which set to change on the spot (bundle chosen like the measured cut plan). Plan (approved with
all recommended answers): `docs\SET-BUILD-IN-SALE-PLAN.md`.

| Area | Files |
|---|---|
| Shared planner | `app\shared\src\sets.ts` (new; `planSets`, `setStatus`, `alternatives`, `diffSet`, `takeParts`, `wantComplete`); export `@rs-v31/shared/sets` in `app\shared\package.json` |
| Web | `app\web\components\sets\SaleSetsModal.tsx` — **revised the same day to two steps** (plan §3.4): 1 Choose combination with "Set combinations in stock" alongside (tap to fill), 2 Confirm: Ready sets first, "Not ready — create" cards only for sets still missing; manual Change / Add / Remove removed; `components\CartPill.tsx` thumbnails keyed by line (two set lines of one product gave a duplicate-key warning). First version had tabs **Build set** (default) / **Pick sets**; shared "what the customer wants" form (option chips, `LengthField` with m / cm / mm / ft / in / ft + in, optional "None"); Build set result: Ready / Needs change cards, bundle cards (Cut piece / Open roll / Sealed roll, left / leaves), Other set…, "Only N of M" reason; Pick sets: Ready / Needs change / Can't make badges, ticking a set pre-fills its changes, bundle cards in Change / Add |
| Server | unchanged — the plan becomes the existing `saleSets[].changes` (with `pieceId`); `prepareSaleSets` re-checks on save |
| Tests | `app\api\tests\unit\set-plan.test.ts` (10 tests) |

Decisions: exact length only (a typed length is rounded to the product's decimals first, so
10 ft on a 1-decimal metres product = 3.0 m); donor = fewest changes, then fewest chain cuts,
then oldest; same drawer for sale orders (`orderId`) and Checkout "Edit sets" (opens on Pick
sets); no set built from loose stock (D4) — "buy sets or add opening sets".

Checks (2026-10-23): `npm run typecheck` (api + web) clean; `npx vitest run tests/unit` in
`app\api` → 15 files / 145 tests passed. Browser (`v31-verify-api` / `v31-verify-web`, demo DB
`rs_v31_demo`, Sales staff): 8 mm 3 m none → Ready; 8 mm 4 m + hook → Needs change from the
8 mm 3 m hook set, ₹8,810, sealed roll tapped; 10 ft → "= 3 m" → Ready; quantity 3 → 2 Ready +
1 "Add Safety Hook 1 Ton"; Pick sets badges correct and ticking the 2.5 m set pre-fills
2.5 m → 3 m. Sale **SAL/2026-27/0010** completed in the demo DB: 8 mm sealed roll → open 46 m,
old 3 m chain free as a cut piece. No console / server errors. **Not run:** integration suite
(needs owner consent to reset `rs_v31_test`).

Two-step check (2026-10-23, same demo): step 1 lists 5 combinations, tapping "8 mm 3 m + hook" fills the form and marks it Ready; quantity 1 → step 2 only Ready + "Add to sale"; quantity 2 → 1 Ready + 1 "Not ready — create" (add hook), ₹17,450; 6 mm 4 m → create with bundle cards (3 m cut piece greyed "too short"); Checkout "Edit sets" reopens step 1 filled in; sale **SAL/2026-27/0011** completed (both sets sold as 8 mm 3 m + hook). Typecheck clean, unit tests 145/145.

Known limits: free stock in the drawer deducts other cart lines approximately (counted loose
lines without warehouse splits count against the company total); the server is the final check
(409 → pick again). Next: run `npm run test:integration` with consent; owner review of the
Build set screen; port decision for V3 / standardapp in the propagation log.

## Category heads (built 2026-10-21)

Owner: categories get **heads**. The built-in head is **Product Type** (all existing categories);
the client adds heads such as **Industry** with categories Agriculture, Gym… A product keeps
one Product Type and can be in **any number** of categories of the other heads. Reference:
`references for final inven\script_versions\05-correct-version-failed-attempt` (Dimensions,
"New Group" tab, `updateCategoryProducts`).

| Area | Files |
|---|---|
| DB | `app\api\prisma\migrations\0033_category_heads\`; `schema.prisma` (`CategoryHead`, `ProductCategory`, `Category.headId`) |
| API | `app\api\src\lib\category-heads.ts` (new), `routes\category-heads.ts` (new, `/api/category-heads`), `routes\categories.ts` (`?headId=product-type|<id>|all`, per-head names, bulk `productIds` attach, links for other heads), `lib\products.ts` (`categoryIds` in/out as `categories`, Product Type check `NOT_PRODUCT_TYPE`), `lib\product-create.ts`, `routes\products.ts` + `lib\inventory-query.ts` (category filter matches any head), `routes\backup.ts` (heads + links), `app.ts` |
| Web | `app\(app)\products\categories\page.tsx` (head tabs, New Head, rename/retire head), `categories\[id]\page.tsx`, `components\products\CategoryModal.tsx`, `components\products\HeadCategoryPicker.tsx` (new, chips per head on the product form), `ProductForm.tsx` (field renamed "Category (Product Type)"), `ProductDetailView.tsx` (one row per head), `products\new\page.tsx` (`?headCategoryId=`), `lib\types.ts` |
| Demo | `scripts\seed-demo.ts` step 12: Industry (Construction, Warehousing, Marine, Agriculture, Gym & Fitness) and Material (Alloy Steel, Galvanised, Stainless Steel) with products in several |
| Tests | `app\api\tests\integration\category-heads.test.ts` (4 tests) — pass (run by the warehouse session on `rs_v31_test` with a no-reset vitest config, after fixing the tests to read `body.error.code`) |

Product form dropdowns (owner follow-up, same day): every head is a searchable **multi-select
dropdown** (`components\MultiCombobox.tsx`, new: tags in the box, ticks in the list, Backspace
removes the last tag). Typing a name that does not exist offers "Add “X” as a new <head>
category": the category popup opens with the name filled in (image upload there), and on save the
category is created, ticked, and a green note says it was added. The Product Type dropdown has
the same create option. A "New category head" dropdown in the form creates a head (name only);
its own dropdown then appears. Popups are portalled to `<body>` and stop their submit, so they
never submit the product form. Head modal moved to `components\products\CategoryHeadModal.tsx`
(used by the Categories page too). Only `category.write` roles see the create options.
Browser check: created Industry → Fishing, Product Type → Slings and head Brand from the Add
Product form; saved product had Slings + Industry: Agriculture, Fishing. Test rows left in
`rs_v31_demo`: categories Fishing, Slings, head Brand; test products "Probe Plain", "Probe Cats",
"Test Fishing Sling" archived; category "Probe Delete Me" deactivated. While the warehouse
session edits API files the dev API restarts every few seconds and some requests return 500
(not a code error; retry succeeds).

Decisions: Product Type has no row (head_id NULL), cannot be renamed/retired, and "Product Type"
is reserved as a head name. The catalog rail, vendor-price sheet filter and uncategorized counts
stay Product Type only. Heads/categories are retired, never deleted.

Checks: `npm run typecheck` (api + web) clean; `npm test` 123/123. Browser on
`http://localhost:3510` as demo admin: created head Industry, categories Agriculture and Gym,
added Chain Hoist to Agriculture from the category page, ticked Gym on the product form; API
shows Product Type "Lifting Equipment" + Industry: Agriculture, Gym (these rows are now in
`rs_v31_demo`). Integration suite not run: `tests\integration\global-setup.ts` runs
`prisma migrate reset` on `rs_v31_test`, which Prisma refuses from an agent without the owner's
consent; coordinate with the warehouse session before running it. `demo:reset` not run.

## Warehouses — API (built 2026-10-21, session "Warehouse work")

Plan: `docs\WAREHOUSE-V3-PLAN.md` (status line + "Build status" section at the end list every
file and the 5 deviations). Owner chose this session to own warehouses; the parallel attempt by
session "Grouped and warehouse on V3" was stopped and its 0035 draft replaced.

Behaviour now: warehousing is off until an admin creates the first warehouse
(`POST /api/warehouses`); that warehouse takes every movement, roll and set, becomes the default,
and both drift views must come back empty. Then every movement / roll / set names a warehouse
(database trigger). Purchases take "Receive into" + per-line `splits`; sales take per-line
`splits` or are placed automatically (default warehouse first, then largest free stock); a
warehouse may not go below zero while the company total covers the sale (409 `WAREHOUSE_SHORT`
listing the other warehouses). Shifts (`/api/transfers`, `TRF/…`) move counted stock, whole rolls
and whole sets; cancel only while the destination still holds it. Stock In rows are per (item,
warehouse). Backup round-trips all of it. **No web UI yet** — the screens still look as before
(no warehouse anywhere until warehousing is switched on through the API).

Checks (in `v3.1\app\api`):

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | 129/129 (incl. new `tests\unit\warehouses.test.ts`) |
| `npx prisma migrate deploy` on `rs_v31_test` and on `rs_v31_demo` | 0034 + 0035 applied |
| `npx vitest run --config <scratch no-reset config> tests\integration\warehouses.test.ts` | 9/9 |
| same config, warehouses + orders + documents + drafts + grouped + measure | 73/73 |
| same config, warehouses + backup-v2 + backup + category-heads | 18/18 (after a test fix) |
| same config, full suite (before orders / backup tests were added) | 183/186 — the 3 were category-heads test bugs, fixed by that session, then passing |

The no-reset config = `vitest.integration.config.ts` without `globalSetup` (Prisma refuses
`migrate reset` from an agent without the owner's consent). **Not run:** full suite with the
standard config (needs a consented `rs_v31_test` reset), `npm run demo:reset` (same reason, so
seed step 13 has not executed yet), web typecheck after API changes (web unchanged), browser check.

## Not done / next

0. **Warehouses web UI — built 2026-10-21** (files in the plan's "Build status"). Checks:
   `npx tsc --noEmit` api + web clean. Browser pass on a separate dev pair (API 4515, web 3515,
   `.claude\launch.json` `v31-verify-api` / `v31-verify-web`, demo DB) because the owner's web
   server on 3510 was returning 500 for every page (Windows "UNKNOWN: open" on a file in
   `.next-local-demo` — restart it with `STOP-V3.bat` / `START-V3-DEV.bat`). Verified as demo
   admin: created W1 Main Godown (all stock moved in: 18 items, 17 rolls, 6 sets) and W2 Shop;
   Stock In added 3 Electric Hoist in W2; sale of 6 opened Take-from (5 + 1 pre-filled, "7 of 6"
   and over-stock refused), changed to 3 + 3 → W1 2, W2 0; shift TRF/2026-27/0001 (Girder Clamp
   + a 36.4 m roll) then cancelled; purchase PUR/2026-27/0004 split 3 → W1, 2 → W2. No console
   errors. **`rs_v31_demo` now has warehousing ON** with these rows; `npm run demo:reset`
   (owner consent) rebuilds it with seed step 13.
   **Remaining screens built 2026-10-22** (plan "Remaining screens"): per-roll warehouse in the
   purchase roll editor, set warehouse in the set sheets, delivery split on the order page,
   warehouse on item detail and rolls pages. Checks: api + web `tsc` clean. Browser (same
   verify pair, demo admin): rolls editor W2 for both rolls (second copied) → PUR (2 × 50 m
   Load Chain 6 mm) → 6 mm now W1 57.5 · W2 100; opening set CHS-6MM-2M-22-10-26-01 into W2
   (badge W2 on its card); sale order SO/2026-27/0004 (3 Girder Clamp, decide at delivery) →
   Complete dialog chip → 1 from W1 + 2 from W2 → W1 41→40, W2 2→0; item page "In warehouses"
   row + column; rolls panel W2 filter shows none for chain. Demo DB has these rows too. Note:
   the owner's 3510/4510 servers were not running on 2026-10-22.
   **Categories + warehouses together (2026-10-22):** no-reset integration run of
   category-heads, products, inventory, catalog, backup, backup-v2, warehouses = 56/56. Browser
   (verify pair, demo admin, warehousing on): Categories page head tabs; Stock In filtered by
   Industry: Agriculture → Chain Hoist with warehouse stock; product page shows Industry
   categories next to "In warehouses"; Add Product form shows Product Type, Industry, Brand and
   New category head. Demo DB has an empty test head "esds" (not created by this session).
1. ~~Purchase orders that receive sets~~ built 2026-10-22 (section above).
2. ~~Phase 3 — sale~~ and ~~sale orders hold sets (D23)~~ built 2026-10-22. Run `npx prisma generate` once the owner's V3.1 servers are stopped (0037 field).
3. Catalog public card (GW-7); UI prototype screens for owner review.
4. Owner to confirm the set-code format (plan §10.2, built as proposed).
5. Grouped phase 3 (set sale) must name the set's warehouse (GW-2): replacement parts from free
   stock of that warehouse, released parts back there.
6. Try the internet tunnel once `cloudflared` is installed. Nothing in `v3\` / `v3.1\` is
   committed (owner: nothing to commit for now).

## Import — products, stock, purchases, sales (built 2026-10-23)

Owner: "create import system v3.1 … column matching and confirmation … empty data with header
column and 1 demo line" + a stock test sheet where missing products are created automatically.
Spec and rules: `docs\IMPORT-V3.1.md`.

| Area | Files |
|---|---|
| Shared | `app\shared\src\import.ts` (new; `@rs-v31/shared/import` export added in `app\shared\package.json`) |
| API | `app\api\src\lib\sheet.ts` (new, xlsx/csv on `node:zlib`), `lib\import.ts` (new), `routes\import.ts` (new), `app.ts` (mount + 5 MB JSON for `/api/import`) |
| Web | `app\web\app\(app)\import\page.tsx` (new), `app\(app)\layout.tsx` (nav "Import" under Stock In) |
| Tests | `app\api\tests\unit\sheet.test.ts` (4), `app\api\tests\integration\import.test.ts` (4) |
| Samples | `docs\import-samples\` — 4 blank templates + `stock-import-test.xlsx` (last column = expected result per row) |

No migration. Checks: `npm run typecheck` clean (api + web); `npm test` 133/133; import
integration 4/4 with a no-reset config (standard config not run: it resets `rs_v31_test`).
Browser on the verify pair (3515/4515, demo admin): owner's `wire_rope_stock_coded.xlsx` matched
with only Product name = "Wire Rope" typed → 49 rows ready, 3 skipped (rows 51–52 no remaining
length, row 53 Total); with "Create missing warehouses" it plans warehouse GODAM (demo has
W1 Main Godown / W2 Shop). Test sheet → 10 ready, 6 intended errors. **Nothing was committed to
`rs_v31_demo`.**

Note: at 10:55 on 2026-10-23 the owner's port 3510 was restarted as `next start` (production
build made before this work), so `/import` is 404 there until `npm run build` is run again in
`app\web` (or the dev launcher is used). Port 4510 runs the dev API and already serves `/api/import`.

Owner decision: Godam = W1 Main Godown. Added "Warehouses not found" name matching on the Import
page (`app\webpp\(app)\import\page.tsx`, web only). Browser check (verify pair): Godam → W1 →
49 ready (36 rolls in W1, 13 in Shop), 3 skipped, no new warehouse.

Next: import the wire-rope sheet into the demo (Stock, Product name = Wire Rope, Godam → W1),
then try the purchase / sales templates.

## Categories on variations (built 2026-10-23)

Owner: "we can connect categories to multiple products, but cannot assign a category on a
specific variation in variation, measurement product, grouped set". Plan
`docs\VARIATION-CATEGORIES-V3-PLAN.md` (approved with defaults; §10 = build status).

| Area | Files |
|---|---|
| DB | `app\api\prisma\migrations\0038_variation_categories\` (applied to `rs_v31_test` and `rs_v31_demo`; `prisma generate` run); `schema.prisma` `VariationCategory` |
| API | `lib\category-heads.ts`, `lib\products.ts`, `lib\product-create.ts`, `routes\products.ts`, `routes\categories.ts`, `lib\inventory-query.ts`, `routes\inventory.ts`, `lib\sets.ts`, `routes\backup.ts` |
| Web | `components\products\VariationScopePicker.tsx` (new), `HeadCategoryPicker.tsx`, `ProductForm.tsx`, `ProductDetailView.tsx`, `app\(app)\products\categories\[id]\page.tsx`, `app\(app)\inventory\page.tsx`, `components\measure\MeasuredStock.tsx`, `components\sets\SetTypes.tsx`, `lib\types.ts` |
| Demo | `scripts\seed-demo.ts`: Marine = Wire Rope 6x19 16 mm only; Alloy Steel = Load Chain 8 mm only (so Chain Hoist Sets with an 8 mm chain are in Alloy Steel) |
| Tests | `app\api\tests\integration\variation-categories.test.ts` (4) |

Behaviour: a category of a head other than Product Type is on the whole product or on chosen
variations (never both; DB triggers). Product form: tick the category, then "All variations / Only
some" with quick picks per attribute value. Category page: "Add all" or "Choose variations", chips per
product, "Edit variations". Product page: "Industry: Gym (10 mm, 16 mm)". Stock In: the category filter
lists every head; under a variation-scoped category, rows, rolls and totals cover only those
variations ("2 of 3 variations"). Sets: a set is in a category when the set product is or a fitted part
is (G-A); `GET /api/sets?categoryId=`.

Checks (in `v3.1\app\api`, no-reset config `vitest.integration.noreset.config.ts`):

| Command | Result |
|---|---|
| `npx tsc --noEmit` (api, web) | clean |
| `npx vitest run --config vitest.integration.noreset.config.ts tests/integration/variation-categories.test.ts` | 4/4 |
| same config: category-heads, products, catalog, inventory, grouped, backup-v2, backup, import, measure, warehouses, versions-search | 106/106 (11 files) |
| `npm test` | 133/133 |
| Browser, verify pair 3515/4515, demo admin | Steel Wire Rope 6x19: Gym → Only some → 16 mm saved from the form; category page chip, Edit variations (fixed: ticks now start from the saved ones) → 10 + 16 mm; product page row; Stock In filter Gym → "2 of 3 variations", 1,636.7 m, rolls panel 10 + 16 mm only. These rows are in `rs_v31_demo`. |

Not done: `npm run demo:reset` (wipes `rs_v31_demo`; needs the owner's OK) — the new seed rows
appear only after it. Full integration suite with the reset config not run. Import has no
per-variation category column. A logout at 12:31 on the verify pair came from another session, not this work.

## Vendor pricing + Check Stock in product selection (built 2026-10-24)

Owner: "work more on seeing vendor pricing and check stock in all types of product, in purchase
product selection and in sale check stock".

| Area | Files |
|---|---|
| API | `app\api\src\routes\vendor-prices.ts` (`/best` → `rates[]`, cheapest first), `app\api\src\lib\catalog.ts` (card `vendor` for vendor-pricing roles) |
| Web | `app\web\components\vendor\SupplierRateList.tsx` (new), `ProductDrawer.tsx`, `measure\MeasuredDrawer.tsx`, `ProductBrowser.tsx`, `sets\PurchaseSetsModal.tsx`, `lib\useSupplierRates.ts`, `lib\types.ts` |
| Tests | `app\api\tests\integration\v2-commerce.test.ts` "supplier prices" (rates order, card vendor range, hidden from staff) |

Behaviour: purchase cards show "Vendor: ₹min – ₹max · N suppliers"; the purchase drawer (Simple,
Variable, Measured) lists every supplier's rate, cheapest first, marked "this supplier" / "Best"
with +₹ over best; tapping one fills the price (never on its own). Check Stock: tab on Simple
products too; sale Check Stock shows "In cart · Left" and the shortage note counts other cart
lines; Measured drawers have a Check Stock table (rate, stock, Cut · Open · Closed pieces, longest
left after the cart, warehouses); the purchase set sheet has a Check Stock section (set types in
stock). Grouped sale already showed sets in stock. Vendor pricing for sets stays off (D24).

Checks: `npm run typecheck` clean; `npm test` 145/145; no-reset integration catalog,
v2-commerce, vendor-prices 29/29 (supplier prices test has the new assertions). Browser (verify
pair 3515/4515, demo admin): purchase cards, Girder Clamp list + Check Stock, Steel Wire Rope
10 mm 2 suppliers (+₹2), Chain Hoist Set sheet 3 sets, sale Electric Hoist 2 in stock / 1 in
cart / 1 left. Test cart line removed; nothing saved. Not run: full reset integration suite.

## Set by-product backorder + Arrange purchase in the purchase cart (built 2026-10-24)

Owner: when a set's by-product is not in stock (e.g. "no free Load Chain Grade 80 8 mm bundle has
232 m") offer a backorder and confirm, highlighted like the measured backorder; the bundle must be
ordered; "Arrange purchase" for every measured shortage becomes the full purchase cart flow.

Behaviour:
- Sell sets → Confirm: the shortage is a rose box (with the longest free bundle) and a
  "Backorder <part>" button. After it, the set card is marked "Backorder — part to be bought", an
  amber notice explains it (Undo backorder), and the button reads "Confirm backorder · add N sets".
- Cart / checkout: the line shows "Backorder — part to be bought for the set"; like a measured
  backorder, only "Save as Customer Order (Backorder)" is offered. The order holds the set; the part
  is cut at delivery from the first bundle that fits.
- Sale order page: "Shortage & Procurement Tracking" lists the backordered part under its set line.
  "Arrange purchase" (header, card, or the blocked Complete dialog) puts every uncovered shortage in
  the purchase cart (measured: one bundle of max(usual bundle length, shortage); counted: quantity),
  each line linked to the sale-order line ("For customer order SO/…"), and opens
  `/purchases/checkout`: supplier, rates, more items, then Save as order (linked PO, counted as
  cover) or Complete purchase (stock arrives; no link kept).
- Fixed on the way: sale-order set changes were stored in milli and parsed again on delivery
  (a 3 m planned chain became 3000 m); counted lines were always reported short in the report.

Files: `app\shared\src\sets.ts`; `app\api\src\lib\{sets,measure,orders}.ts`,
`app\api\src\routes\{orders,drafts}.ts`; `app\web\components\{CartContext,Checkout,CartSidebar}.tsx`,
`components\cart\LineFlags.tsx` (new), `components\sets\SaleSetsModal.tsx`,
`components\orders\OrderView.tsx`; tests `app\api\tests\unit\set-plan.test.ts`,
`app\api\tests\integration\grouped-backorder.test.ts` (new).

Checks: `npx tsc --noEmit` (api, web) clean; api `npm test` 147/147; no-reset integration
(`vitest.integration.noreset.config.ts`): grouped-backorder 1/1, grouped 10/10, measured-shortages,
orders, documents, v2-commerce, measure, backup-v2, warehouses all pass. Browser (verify pair
3515/4515, demo admin): modal → backorder → checkout verified; nothing saved to `rs_v31_demo`.

Not done / limits: the Arrange purchase → cart click was not run in the browser (no demo order has
an uncovered shortage; covered by the integration test at API level). Sale orders saved before this
fix with a planned chain change keep milli lengths in `order_lines.sets` (edit + re-save the order).
Held drafts drop the purchase-line link. Whole-set backorder (no set in stock at all) is not offered.
`POST /api/orders/:id/arrange-purchase` is unused by the UI now.

## Production-test package for the client (built 2026-10-24)

**Objective:** give the client V3.1 for a production test next to their live V2 (shop PC, V2
started with START-SHOP-APP), with a one-click start, demo, V2 data copy, checklist, V3.2 notes and
CI/CD.

| Area | Files |
|---|---|
| Shop kit (ported from `v2\local-server`, V3.1 names / ports / pnpm) | `local-server\start-shop.ps1`, `setup.ps1`, `install-all.ps1`, `check.ps1`, `allow-network.ps1`, `backup.ps1`, `restore-test.ps1`, `install-autostart.ps1`, `install-update.ps1`, `UPDATE-FROM-ZIP.bat`, `client.example.env`, `demo.example.env`; `common.ps1` (+`Invoke-Pnpm`, `Install-Packages`, `$AppTitle`, `$FirewallRule`, `$TaskPrefix`); `start.ps1` stop hint |
| V2 → V3.1 data | `local-server\upgrade-from-v2.ps1`, `local-server\smoke.ps1`, `app\api\scripts\upgrade-smoke.ts` |
| ZIP | `local-server\make-package.ps1`, `local-server\package-root\` (7 .bat, `GUIDE.md`, `PRODUCTION-TEST.md`) → `dist\RS-Inventory-V3.1-2026-10-24-1144.zip` |
| CI/CD | `.github\workflows\ci.yml`, `.github\workflows\release.yml`, `docs\CI-CD.md` |
| Notes | `docs\V3.2-BACKLOG.md`, `docs\PRODUCT-ARCHIVE-AND-STATUS.md` |

Decisions: V3.1 runs **beside** V2 (client 3210/4210, demo 3310/4310, DBs `rs_v31_client` /
`rs_v31_demo_local`, firewall rule "RS Inventory V3.1 (LAN)", tasks "RS V3.1 - …"); V2 keeps the
log-on auto-start during the test (V3.1 `-StartAtLogon` at go-live). The V2 copy is read-only
(`pg_dump`); go-live = stop V2 + `UPGRADE-FROM-V2.bat` with replace. Dev launchers stay in the repo
but are left out of the ZIP. Packages install with `npx pnpm@9.15.4 install --frozen-lockfile` (no
global pnpm needed on the shop PC).

Checks (2026-10-24):

| Command | Result |
|---|---|
| `pg_dump rs_v2_demo` (V2 demo, 0028) → `pg_restore` into `rs_v31_test` → `prisma migrate deploy` | 0029–0038 applied; 0008 differs from V2 only in a comment, deploy accepts it |
| drift views on that DB | stock / set / warehouse drift all 0 |
| `upgrade-smoke.ts --url http://127.0.0.1:4599 --sheets docs\import-samples` (temporary TEST API) | 0 failures: 8 products, 5 orders, 4 shortage/backorder lines; import checks: products 1 ready, purchases 1 ready, sales 1 error (no "Wire Rope" in V2 demo, expected), stock test sheet 12 warnings + 4 intended errors |
| `npx vitest run --config vitest.integration.noreset.config.ts` on that DB | **209/209**, 25 files (incl. grouped-backorder, measured-shortages, import, backup-v2) |
| `make-package.ps1` | typecheck clean, unit 147/147, ZIP 0.8 MB / 279 files, no env / tests / dev launchers |
| extracted ZIP: `check.ps1`, `Install-Packages`, `build.ps1 -Env demo`, `start.ps1 -Env demo -Prod` (ports 3399/4399 on `rs_v31_demo`), `upgrade-smoke.ts` via the web port | OK (pnpm 1m16s, prisma generate, next build, built app up); smoke 0 failures, 9 products, 8 orders, 6 shortage lines; stopped with the package's `stop.ps1` |
| all `local-server\*.ps1` | PowerShell parser: no errors |

Not tested (needs the shop PC / postgres superuser password): `install-all.ps1` / `setup.ps1`
role + database creation, `upgrade-from-v2.ps1` end to end as one script (its steps were run by
hand above), firewall / scheduled tasks, GitHub workflows (not pushed). `rs_v31_test` now holds the
V2 demo company plus test rows (harmless; the standard integration config resets it).

Next: run `INSTALL.bat` on the shop PC with the owner, walk `PRODUCTION-TEST.md`, log findings in
`docs\V3.2-BACKLOG.md` part D; owner to decide pushing `v3.1\` so CI runs.

**Backup & Restore route checked (2026-10-24, owner asked):** V2 API (demo DB `rs_v2_demo`, 0028)
`GET /api/backup` → 11 KB ZIP → V3.1 API on `rs_v31_test`, fresh company "Restore Check Shop"
(admin `owner@restore-check.test`) → `POST /api/backup/inspect` valid (format 2.0) →
`POST /api/backup/restore?confirm=true` 200, stock drift 0. Counts equal to V2 for categories,
parties, products 9 / variations 19, movements 27, balances 16, sales 5 (same numbers SAL/…/0001–0005),
purchases 2, voids 1, orders 5 / lines 6 / events 6, drafts 2, vendor prices 5 / history 8, pieces 11 /
ledger 18, counters 4. Not carried: audit history (104 → 2); company name stays the V3.1 one; V2 users
whose email already exists are skipped (here all 3, because this test DB already had them — on a
fresh V3.1 they are created with their V2 password hashes, per `routes\backup.ts`; not tested on a
fresh DB). V2 demo has no images, so image restore was not exercised. Smoke as the new owner: 0
failures (8 products, 5 orders, 4 shortage lines). Guide section added
(`local-server\package-root\GUIDE.md` "Other way"); ZIP rebuilt `dist\RS-Inventory-V3.1-2026-10-24-1420.zip`.
