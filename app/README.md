# RS Inventory V3 application

This is the V2 application source copied as V3's starting baseline. V3 grouped
products and warehouse workflows are not implemented yet. V2 remains unchanged.

`api\` uses Express 5, Prisma 6, and PostgreSQL; `web\` uses Next.js 15, React 19,
and Tailwind 3. V3 workspaces use `@rs-v31/api`, `@rs-v31/shared`, and `@rs-v31/web`;
the local database setup creates `rs_v31_demo` and `rs_v31_test`, independently of V2.

## Local development

1. Create the local V3 role and databases with
   `api\scripts\setup-local-db.sql` (requires PostgreSQL and `psql`).
2. Copy `api\.env.example` to `api\.env`, set the V3 database password and a
   unique `SESSION_SECRET`, and keep `.env` private.
3. From `v3\app\`, run `npm install`, then from `api\` run `npm run db:migrate`.
4. Run `npm run dev` in `api\` and `web\`, then open `http://localhost:3000`.

The V2 deployment and local-server configuration were not copied. Set up distinct
V3 deployment, storage, and environment names before using a shared host or real
client data.

## Front-end rebuild handoff (2026-10-13, D23)

- **Look:** marble 2110 — shell (`app\(app)\layout.tsx`), UI kit `components\ui.tsx`, icons
  `components\icons.tsx`, `Combobox`, `app\globals.css`, orange brand + system font.
- **Screens/flow: main v2** (V1 modules only): Products (`products\page.tsx`: KPI strip, All/Active/
  Inactive, toolbar, grouped table with expandable variations, admin archive switch); product
  modal + **VariationBuilder 3 steps** (`components\products\VariationBuilder.tsx`: Define
  Attributes with Sub Var + Quality, Create Variation — pick or type each value with its
  abbreviation, a new value becomes data for the next variation (V3.2 merged main v2's separate
  Data step) — and Variation Details); detail modal (Details + Action Log); Adjust Stock modal; Categories grid + detail with
  Add Existing / Add New; **Stock In** (`inventory\page.tsx`, main v2 StockInPanel).
- **Cart flow:** New sales and purchases begin with a required bottom-sheet customer/supplier
  selection before the product browser; a party created there is selected and saved with the
  active cart. The product selection drawer can expand to full size, and cart lines remain
  individually deletable. Checkout retains the existing Normal/optional-party controls.
- **Pricing:** New price entry is in whole rupees only, enforced in the web inputs and API;
  currency displays omit trailing `.00` while retaining non-zero fractional values in older data.
- **API changes:** `POST /api/inventory/stock-in` (bulk, one transaction, `expectedQuantity`
  guard, OPENING on first stock with reason "Opening Stock"); `/api/inventory?status=`;
  attribute defs accept `isQuality`/`sub`/`subName`/`subUnit`; variations returned in
  definition order. Shared: `normAttrVals`, `composeSubValue`, quality never weaves a unit.
- **Verified:** API + web `tsc` 0; unit 68/68 (30 parity incl. quality/sub vs live main v2);
  browser: Products KPIs/table, builder create (Sub Var + Quality, abbreviation, duplicate
  refused) and edit (locked names, in-use values/stars, new star + variation), Stock In focus
  (Opening Stock, 3 rows + price in one save), Sale History / New Sale / document view.
- **Not verified:** integration suite after these changes (needs reset consent); `next build`;
  integration tests for `stock-in` not yet written. Sale-line attribute chips may show in
  JSONB key order (snapshot), not definition order.

## Phase 4 handoff (2026-10-13)

- **Done:** migration `0004_documents`; `src\lib\documents.ts`; routes `documents.ts`
  (`/api/sales`, `/api/purchases`) and `parties.ts`; web cart (`CartContext`, `ProductBrowser`,
  `ProductDrawer`, `CartPill`, `Checkout`, `DocumentHistory`, `DocumentView`, `Restricted`),
  Marble `Combobox`; pages under `app\(app)\sales` and `purchases`. Decisions D18–D22.
- **References used:** cart UX `references for final inven\script_versions` (+06 pills),
  rules `main v2` (completeSale/completePurchase/addOrder, BR-01/02/24/27), architecture
  Marble 2110 (`lib\documents.ts`, `Combobox`).
- **Verified:** API + web `tsc` 0; unit 60/60; live API (totals, idempotency, oversell, party
  types, stock math) and browser end-to-end on local Demo: sale `SAL/2026-27/0003`
  (pills, disabled impossible values, cart pill, purchase-cart block, Regular customer search,
  Complete Sale) and purchase `PUR/2026-27/0002`; stock 12→10 and 21→26 as expected.
- **Not yet verified:** `tests\integration\documents.test.ts` (13 tests, needs reset consent);
  `next build` after Phase 3–4 (dev server holds `.next`; stop it first).
- **Known:** stopping the `v1-api` preview can leave a `tsx watch` child holding port 4000 on
  Windows; end it before restarting.

## Phase 3 handoff (2026-10-13)

- **Done:** migration `0003_inventory`; `src\lib\stock.ts` (state rules, balances,
  `recordMovements` with sorted row locks); `/api/inventory` list/summary, product stock,
  movement history (running balance), opening/adjustment, price/cost/threshold config;
  web Inventory Status (GAS layout, expandable variations, KPIs, low/out filters) and
  Manage page (prices, adjust, history). Decisions D16–D17.
- **Verified:** API + web `tsc` 0; unit 56/56; live API checks and browser checks on
  local Demo (opening once, oversell refused with named message, history balances,
  UI opening stock 25). Fixed: variation order was unstable for rows saved together.
- **Integration run (2026-10-13, user consent):** 42/43 — every Products and Inventory
  test passed (incl. 5-way Short Name race, 10-way concurrent stock removal). The one
  failure was a stale Phase 1 assertion (`migrationVersion` hard-coded to `0001`); the
  test now derives the newest migration folder. Not re-run after that test-only change.
- **Next:** Phase 4 Sales and Purchases — reuse `recordMovements` inside the document
  transaction; follow `..\USER-FLOW.md` (07 cart + 06 drawer).

## Local Demo instance (this machine)

- Demo company (D24): `npm run demo:reset` in `api` rebuilds "RS Machinery (Demo)" with
  seeded users, products, stock, parties and documents; see `..\demo\README.md`.

- Migrations `0001`, `0002` applied to `rs_v1_demo`; company "RS Machinery (Demo)".
- Sign-in: `DEMO_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` in `api\.env` (git-ignored).
- Start from the workspace root: `.claude\launch.json` has `v1-api` (port 4000) and
  `v1-web` (port 3000); or run `npm run dev` in `api` and `web`.
- Browser smoke test 2026-10-13: sign-in → create category → create Variable product
  (Size mm × Brand, Crossbee abbr CB) → codes `8MM-CB-ROPE`/`8-CB-ROPE`,
  `6MM-HALFEN-ROPE`/`6-Halfen-ROPE` (SKU keeps value case, as main v2) → catalog. Passed.

## Phase 2 handoff (2026-10-13, in progress)

- **Done:** `shared\` package (main v2 variation-code composer + combination key);
  migration `0002_products`; API `/api/categories` (list with counts, detail, create,
  rename, activate/deactivate, attach/detach product) and `/api/products` (search/filter
  list, detail, create Simple/Variable, identity edit, extend-only attribute edit,
  add variations, edit variation codes, admin archive/restore); web catalog (GAS layout),
  Add Product (type picker, attribute editor, one-at-a-time variation builder), product
  detail, edit, categories list and category detail. Decisions D13–D15 in `..\DECISIONS.md`.
- **Verified:** API `tsc` 0; unit tests 51/51 (22 compare V1 codes with live main v2
  functions); web `tsc` 0.
- **Not yet verified:** `tests\integration\products.test.ts` (needs the `rs_v1_test`
  reset consent); browser walk-through.
- **Known limits:** catalog loads up to 200 products per filter (no infinite scroll yet);
  product images are URLs only (no upload); prices/stock are not editable until Phase 3.

## Phase 1 handoff (2026-10-13)

- **Done:** schema + migration `0001_foundation` (companies, users, sessions,
  audit_events with append-only trigger, document_counters); env validation with
  database-name isolation; `/api/health`, `/api/health/ready`, `/api/version`;
  login/logout/me/password; admin user management; audit helper; atomic
  `SAL/2026-27/0001` numbering; GAS-style web shell with environment banner.
- **Verified (2026-10-13):** API `tsc` exit 0; `npm test` 16/16; web `tsc` exit 0;
  `npm run test:integration` **19/19** against local PostgreSQL 18 (`rs_v1_test`),
  including migration from empty, append-only audit trigger and 20-way concurrent numbering.
- **Fixed after first integration run:** login rate-limit key now uses
  `ipKeyGenerator` (IPv6 users could otherwise bypass the per-account limit).
  Verified by constructing the limiter (no `ERR_ERL_KEY_GEN_IPV6`); integration suite
  not re-run after this one-line change.
- **Integration runs reset `rs_v1_test`.** Prisma blocks `migrate reset` from AI agents
  unless the user consents each run (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`).
  Humans can run `npm run test:integration` directly.
- **Not yet verified:** `next build`; running both servers together in a browser.
- **Next:** Phase 2 (Products) following
  `D:\client works\rs new\v1\USER-FLOW.md` and `DECISIONS.md`.
