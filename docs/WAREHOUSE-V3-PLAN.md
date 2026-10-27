# V3 — Basic Warehousing Plan (warehouses + shifting)

Date: 2026-10-20 (revision 2, owner feedback) · Status: **API and web UI built 2026-10-21 (§6 steps 2–7); a few screens still pending (see end)** — see "Build status" at the end. Migrations: **0034_warehouse_enums** (enum values) + **0035_warehouses** (0032 = grouped documents, 0033 = category heads) ·
Folder: `D:\client works\rs new\v3.1\app\`

## 0. Scope

**In V3**

- Warehousing is **off** until an admin creates the **first warehouse**. Until then the app
  works exactly like today and shows nothing about warehouses.
- Creating the first warehouse turns warehousing on: all existing stock (and every measured
  roll) is placed in it and it becomes the default. Later warehouses start empty.
- Every stock balance and stock movement then belongs to a warehouse. Company total = the
  sum of all warehouses.
- Stock can be **split per line**: one purchase / sale / Stock In line can put 3 in W1 and 2
  in W2.
- **Shifting**: move stock from one warehouse to another (numbered, audited, append-only).
- Pages: **Warehouses** (manage) and **Shifts** (list + new shift) are their own pages;
  Stock In gets a Warehouse filter and per-row warehouse dropdowns.

**Not in V3** (V4 or later): shelves, racks, bins, containers, zones; per-warehouse
low-stock thresholds or prices; locking users to one warehouse; two-step (in-transit)
transfers; transfer approvals; QR-scanned shifts. The free-text `rack` on rolls stays a note.

> `references for final inven\planning-docs\V3-V4-REQUIREMENTS.md` §6 puts warehouses in
> V4. The owner moved the basic part into V3; the V4 section remains the target for the
> items above.

---

## 1. Business rules

| # | Rule |
|---|---|
| WH-0 | **Warehousing off** (no warehouse yet): no warehouse fields, columns, filters or pickers anywhere; stock works as in V2. Only admin sees "Create first warehouse" on the Warehouses page. |
| WH-1 | **First warehouse**: creating it, in one transaction, assigns every existing movement, balance and roll to it and marks it default. This cannot be undone (but it can be renamed). From then on every stock movement must name a warehouse. |
| WH-2 | Warehouses are never deleted. Deactivate only when it holds no stock (no rolls, nothing negative) and is not the default. Inactive ones cannot be picked; their history stays. |
| WH-3 | Name unique per company (ignoring case); short code (`W1`, ≤10 chars, uppercase) unique, printed on slips. |
| WH-4 | Company stock for an item = SUM of its warehouse balances (database check). |
| WH-5 | **Purchase / receive**: a "Receive into" dropdown at the top sets all lines to one warehouse. Each line can be changed to another warehouse or **split** (e.g. 3 → W1, 2 → W2). The split must add up to the line quantity. Measured rolls: each roll picks its warehouse. |
| WH-6 | **Sale — warehouse chosen when adding to cart** (owner decision). After the user picks the variation and quantity in the product drawer and taps Add: if **only one** warehouse holds the stock, the line is added from it directly and shows a chip "from W1" (tap to change). If **two or more** hold it, a **"Take from" popup** opens: one quantity box per warehouse with stock, pre-filled default warehouse first, running "5 of 5" check; confirm → added to cart with that split. Checkout shows the splits (editable) and re-checks them. Measured items: the picked pieces decide the warehouse (no popup). |
| WH-6a | **Warehouse shortage** (owner decision): a warehouse may **not** go below zero while the company total covers the quantity — the user must split across warehouses or shift first. No extra warehouse-shortage logic in V3: when the **company total** is short, the existing V2 Warn & Allow confirmation applies unchanged and the uncovered quantity is taken from the line's auto-picked / default warehouse (which goes negative). |
| WH-7 | **Void / cancel**: reverses each split in its own warehouse; no user input. |
| WH-8 | **Edit (revision)**: the new revision may use different warehouses / splits; old is reversed where it was, new is posted where chosen, one transaction. |
| WH-9 | **Shift**: From ≠ To, both active, quantity > 0. Never takes From below zero (any policy). Net company change is always 0. |
| WH-10 | A shift is a document `TRF/2026-27/0001` (date, From, To, lines, note, user). Not editable; fixed by **cancel** (reason; only while To still holds that stock) or a shift back. |
| WH-11 | **Measured**: whole pieces move; they keep code, cut history, supplier. For part of a roll: cut first, then shift the cut piece. |
| WH-12 | **Stock In**: each row edits the stock **of one warehouse** chosen in that row's dropdown; "+ warehouse" adds another row for the same item so one save can set W1 and W2. Opening stock: once per item per warehouse. |
| WH-13 | **Orders** never move stock. **Sale order**: when adding a product that is in 2+ warehouses, the same Take-from popup appears with an extra choice **"Decide at delivery"**; a chosen split is saved on the order line (editable). On delivery, lines with a saved split use it (editable, re-checked); lines left for later get the popup / auto-pick then. **Purchase order**: preferred warehouse on the order pre-fills "Receive into" when receiving. |
| WH-14 | **Held carts** keep line splits if set; re-checked at checkout. |
| WH-15 | Low / out states stay company-wide on the total; with a warehouse filter on Stock In they are shown for that warehouse using the same threshold. |
| WH-16 | Public catalog and customer invoices never show per-warehouse stock. No printable shift slip and no per-warehouse stock PDF in V3 (owner: not needed now). |

### Permissions

| Permission | Roles |
|---|---|
| `warehouse.manage` (create first, add, rename, default, deactivate) | admin |
| `stock.transfer` / `stock.transfer.void` | admin, sales_manager (owner confirmed) |
| see per-warehouse stock | all roles |

---

## 2. Data model (Prisma + migration `0032_warehouses`)

File `v3.1\app\api\prisma\schema.prisma`; folder `prisma\migrations\0032_warehouses\`.

### 2.1 New tables

```prisma
model Warehouse {
  id          String   @id @default(cuid())
  companyId   String   @map("company_id")
  code        String                    // "W1"
  name        String                    // case-insensitive unique index per company
  address     String?
  isDefault   Boolean  @default(false) @map("is_default")   // partial unique: one per company
  active      Boolean  @default(true)
  sortOrder   Int      @default(0) @map("sort_order")
  version     Int      @default(1)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  createdById String?  @map("created_by")
  updatedById String?  @map("updated_by")
  @@unique([companyId, code])
  @@map("warehouses")
}

// Written ONLY by the movement trigger (like stock_balances).
model WarehouseStockBalance {
  variationId String   @map("variation_id")
  warehouseId String   @map("warehouse_id")
  companyId   String   @map("company_id")
  quantity    Decimal  @default(0) @db.Decimal(14, 3)
  updatedAt   DateTime @default(now()) @map("updated_at")
  @@id([variationId, warehouseId])
  @@index([companyId, warehouseId, quantity])
  @@map("warehouse_stock_balances")
}

// Per-line warehouse split of a sale / purchase line (WH-5, WH-6). One row per warehouse.
model DocumentLineSplit {
  id             String   @id @default(cuid())
  companyId      String   @map("company_id")
  saleLineId     String?  @map("sale_line_id")      // exactly one of the two is set
  purchaseLineId String?  @map("purchase_line_id")
  warehouseId    String   @map("warehouse_id")
  quantity       Decimal  @db.Decimal(14, 3)        // > 0; SUM per line = line quantity (deferred check)
  @@unique([saleLineId, warehouseId])
  @@unique([purchaseLineId, warehouseId])
  @@map("document_line_splits")
}

model StockTransfer {                // append-only document
  id              String   @id @default(cuid())
  companyId       String   @map("company_id")
  number          String                          // TRF/2026-27/0001
  transferDate    DateTime @default(now()) @map("transfer_date")
  fromWarehouseId String   @map("from_warehouse_id")
  toWarehouseId   String   @map("to_warehouse_id") // CHECK from <> to
  notes           String?
  clientRef       String?  @map("client_ref")
  createdAt       DateTime @default(now()) @map("created_at")
  createdById     String   @map("created_by")
  lines           StockTransferLine[]
  movements       StockMovement[]
  void            StockTransferVoid?              // present = cancelled
  @@unique([companyId, number])
  @@unique([companyId, clientRef])
  @@index([companyId, transferDate])
  @@map("stock_transfers")
}

model StockTransferLine {
  id                  String  @id @default(cuid())
  transferId          String  @map("transfer_id")
  lineNo              Int     @map("line_no")
  variationId         String  @map("variation_id")
  productNameSnapshot String  @map("product_name_snapshot")
  shortNameSnapshot   String  @map("short_name_snapshot")
  unit                String
  quantity            Decimal @db.Decimal(14, 3)
  pieceId             String? @map("piece_id")      // measured: one line per piece
  note                String?
  @@unique([transferId, lineNo])
  @@index([variationId])
  @@map("stock_transfer_lines")
}

model StockTransferVoid {
  id          String   @id @default(cuid())
  companyId   String   @map("company_id")
  transferId  String   @unique @map("transfer_id")
  reason      String
  createdAt   DateTime @default(now()) @map("created_at")
  createdById String   @map("created_by")
  @@map("stock_transfer_voids")
}
```

### 2.2 Changed tables

| Table | Change |
|---|---|
| `companies` | `warehousing_enabled BOOLEAN NOT NULL DEFAULT false` (set true by WH-1). |
| `stock_movements` | `warehouse_id TEXT NULL` + FK (same-company); `transfer_id TEXT NULL`; `split_id TEXT NULL` (→ `document_line_splits`, so void reverses each split). Trigger rule: `warehouse_id` must be set when the company has warehousing on, and must be NULL when off. |
| `MovementType` | add `TRANSFER_OUT`, `TRANSFER_IN`, `TRANSFER_VOID`; CHECK `transfer_id` set exactly for these. |
| `stock_balances` | **unchanged** = company total; all current readers keep working. |
| `measurement_pieces` | `warehouse_id TEXT NULL` (same on/off rule). |
| `measurement_piece_ledger` | `warehouse_id`, `to_warehouse_id`, `transfer_id`. `PieceAction` add `TRANSFER`, `TRANSFER_VOID`. |
| `sales`, `purchases` | none required (warehouses live on splits). Optional `default_warehouse_id` only to re-open the form with the same header choice. |
| `orders` | `warehouse_id NULL` (purchase order preferred warehouse). |
| `order_lines` | `splits JSONB NULL` — `[{warehouseId, quantity}]` chosen when the sale order line was added; NULL = decide at delivery. Re-validated on delivery. |
| `draft_orders` | lines JSON keeps each line's splits. |
| 0006 opening index | becomes unique on `(variation_id, COALESCE(warehouse_id,''))` where type = OPENING. |

Nullable columns are needed because of WH-0: a company with warehousing off has no warehouse
to point at. The trigger in 2.3 makes them effectively NOT NULL once warehousing is on.

### 2.3 Triggers

1. `stock_balances_maintain()` — also upsert `warehouse_stock_balances` when `warehouse_id`
   is set.
2. `stock_movements_no_negative()` — warehousing on: check the **warehouse** balance; off:
   company balance as today. Below zero only for `SALE` (policy not STRICT); never for
   TRANSFER_OUT.
3. `stock_movements_warehouse_required()` — enforce the on/off rule of 2.2.
4. `measured_stock_consistent()` — on: rolls in warehouse = warehouse balance; off: as today.
5. `transfer_consistent()` (deferred) — every line has one TRANSFER_OUT (From) and one
   TRANSFER_IN (To) of equal size; net 0.
6. `document_line_splits_consistent()` (deferred) — warehousing on: every sale/purchase line
   has splits summing to its quantity, and the line's movements match its splits.
7. Append-only on transfers, transfer lines, transfer voids, line splits.
8. Views `warehouse_balance_drift` and `warehouse_total_drift` must return 0 rows.

### 2.4 Migration `0032_warehouses` and "create first warehouse"

- The migration only adds tables, nullable columns, triggers and views. **No data changes**;
  every company stays warehousing-off.
- `POST /api/warehouses` when the company has none runs `enableWarehousing()` in one
  transaction: lock the company row; insert the warehouse (default); disable append-only
  triggers locally (`SET LOCAL session_replication_role` is not used — explicit
  `ALTER TABLE … DISABLE TRIGGER` inside the transaction, as restore does); set
  `warehouse_id` on all the company's movements and pieces; build
  `warehouse_stock_balances`; create splits for existing sale/purchase lines (one split per
  line → this warehouse) and link movements; re-enable triggers; set
  `warehousing_enabled = true`; check both drift views; audit `WAREHOUSING_ENABLED`.
  (Lines need splits so later voids / edits of old documents reverse in the warehouse.)
- `ALTER TABLE … DISABLE TRIGGER` takes a strong lock — it is a one-time admin action; show
  "This takes a moment; other users should stop billing" in the confirm dialog.

---

## 3. API / application code (`v3.1\app\api\src`)

### 3.1 Stock engine — `lib\stock.ts`
- `MovementInput` gets `warehouseId?: string`, `transferId?`, `splitId?`.
- `balances()` stays = company total. New `warehouseBalances()` and
  `balancesByWarehouse(db, companyId, ids) → Map<variationId, {warehouseId, code, qty}[]>`.
- `recordMovements()` nets and checks per **(variation, warehouse)** when warehousing is on.
  Shortage payload adds `warehouseCode` and `otherWarehouses` so the UI can say
  "W1 has 2, W2 has 10".
- Locking unchanged (`lockVariations`, id order).
- New `lib\warehouses.ts`: `isWarehousingOn(tx, companyId)`, `resolveWarehouse()`,
  `enableWarehousing()`, `validateSplits(lines, splits)`, `suggestSaleSplits()` (fill from
  default warehouse, then others by largest stock).

### 3.2 Documents — `lib\documents.ts`
- `documentBody` gets `warehouseId?` (header "all lines") and per line
  `splits?: [{ warehouseId, quantity }]`. If a line has no splits → one split = header
  warehouse (or default). Rejected with 400 when warehousing is on and splits ≠ quantity.
- `writeDocument`: insert lines, then splits, then one movement per split.
- `voidDocument`: reverse each movement in its warehouse (via `split_id`).
- `editDocument` / `previewEditDocument`: shortage preview per warehouse.
- Measured purchase: each roll in `rolls[]` gets `warehouseId`; splits are derived from rolls.
  Measured sale `cutForSale`: the picked piece's warehouse becomes the split.

### 3.3 Transfers — new `lib\transfers.ts`, `routes\transfers.ts`
```
GET  /api/transfers?warehouseId&from&to&q&dateFrom&dateTo&page
GET  /api/transfers/:id
POST /api/transfers         { fromWarehouseId, toWarehouseId, date?, notes?, clientRef,
                              lines: [{ variationId, quantity } | { pieceId }] }
POST /api/transfers/:id/cancel  { reason }
```
One transaction: idempotency → warehouses → lock variations / pieces → `TRF` number →
lines → TRANSFER_OUT/IN movements → measured pieces `warehouse_id = To` + ledger → audit
`STOCK_TRANSFER`. Cancel: reverse; `409 TRANSFER_STOCK_USED` if To no longer holds it.

### 3.4 Warehouses — new `routes\warehouses.ts`
`GET /api/warehouses` (with per-warehouse item count / value), `POST` (first one runs
`enableWarehousing`), `PATCH /:id`, `POST /:id/default`, `/:id/deactivate`, `/:id/activate`.

### 3.5 Inventory — `routes\inventory.ts`, `lib\inventory-query.ts`
- `GET /api/inventory?warehouseId=` filters by `warehouse_stock_balances`; every variation
  returns `byWarehouse: [{ warehouseId, code, qty }]` (one grouped query).
- Stock save body: `rows: [{ variationId, warehouseId, newQuantity }]` — several rows per
  variation allowed (WH-12). Opening check per warehouse.
- Measured "Add rolls" takes `warehouseId`.

### 3.6 Other touch points
| File | Change |
|---|---|
| `lib\measure.ts` | rolls created / cut / written off in the piece's warehouse; `activePieces`, ATP, shortages accept `warehouseId`. |
| `lib\orders.ts`, `routes\orders.ts` | preferred warehouse; fulfil / receive bodies accept header `warehouseId` + line splits. |
| `routes\drafts.ts` | keep splits in lines JSON. |
| `lib\permissions.ts` | `warehouse.manage`, `stock.transfer`, `stock.transfer.void`. |
| `lib\numbering.ts` | docType `TRF`. |
| `lib\product-activity.ts` | warehouse on each movement; "Shifted W1 → W2". |
| `routes\backup.ts` | export/import warehouses, splits, transfers (+lines, voids), new columns, `warehousing_enabled`; balances rebuilt by trigger; new append-only triggers in `RESTORE_TRIGGERS`; old backups restore as warehousing-off. |
| `routes\catalog.ts` | unchanged; test that nothing per-warehouse leaks. |
| `scripts\seed-demo.ts` | Demo Company: warehousing on, **W1 "Main Godown"** (default) + **W2 "Shop"**, stock split, split purchase, split sale, sale order with saved split and one "decide at delivery", sample shifts (one roll, one cancelled). |
| `app.ts` | mount `/api/warehouses`, `/api/transfers`. |
| `shared\src\index.ts` | `Warehouse`, `WarehouseQty`, `LineSplit`, `StockTransfer` types; movement labels. |

---

## 4. Web UI (`v3.1\app\web`)

Sidebar (only after warehousing is on, except Warehouses for admin):
`Stock In` · **`Shifts`** (new) · **`Warehouses`** (new, admin).

### 4.1 Warehouses page — `app\(app)\warehouses\page.tsx`
- Warehousing off: empty state "Create your first warehouse — all current stock will be
  placed in it" → name + code → confirm.
- On: table Code · Name · Items · Stock value · Status · actions (Rename, Make default,
  Deactivate / Activate). "+ Add warehouse". Clicking a row opens Stock In filtered to it.

### 4.2 Shifts page — `app\(app)\shifts\page.tsx` (+ `shifts\new`, `shifts\[id]`)
- List: Number · Date · From → To · Items · By · Status; filters warehouse / date.
- New shift: From and To dropdowns (swap button); item search showing `W1: 40 · W2: 8`;
  quantity (max = stock in From); measured items: tick roll codes; note → **Shift stock**.
- Detail: lines, Cancel (reason). (No print slip in V3.)
- Stock In rows also get a small "Shift" action that opens New shift pre-filled.

### 4.3 Stock In page — `app\(app)\inventory\page.tsx`
- **Warehouse filter** added to the existing filter bar / table settings: `All warehouses ·
  W1 · W2`. Remembered per user (`UserPreference`).
- New **"In warehouses"** column: `W1 3 · W2 2` chips.
- **All warehouses view**: product / variable-parent row shows Total plus `W1 5 · W2 6` chips.
  Each variation (or simple product) gets **one sub-row per warehouse that holds stock**
  (Warehouse · Current · New stock · Change); prices and Min Stock span the sub-rows (they
  are company-wide). "**+ add stock in another warehouse**" opens a warehouse dropdown and
  adds an empty sub-row (e.g. a new item in W2). Save Stock writes one adjustment per
  edited (item, warehouse).
- **One warehouse filtered** (e.g. W1): one row per item with "In W1", an "Other" column
  (`W2 2` chips, read-only), and New stock / Change for W1 only. Items with stock only in
  other warehouses still appear (In W1 = 0, "out") so they can be stocked here.
- Measured rows: one sub-row per warehouse with its roll count and its own "Add rolls".
- Measured "Add rolls" dialog: each roll gets a warehouse dropdown.
- Prices / Min Stock unchanged (company-wide).

### 4.4 Purchase checkout & receive order — `components\Checkout.tsx`, `components\orders\OrderView.tsx`
- Top: **Receive into [W1 ▾]** → sets every line.
- Each line: warehouse dropdown; option "**Split…**" shows rows `W1 [3]  W2 [2]` with a
  running "5 of 5" check; Save disabled until it matches.
- Measured lines: warehouse per roll.

### 4.5 Sale checkout & deliver order
- No header picker. Each line shows its split chips ("W1 3 · W2 2"), editable through the
  same Take-from popup; checkout re-checks every split against current warehouse stock.
- Order delivery: lines with a saved split use it; "decide at delivery" lines get the popup
  (or auto-pick when only one warehouse holds the stock).

### 4.6 Cart product drawer — `components\ProductDrawer.tsx` + new `components\cart\TakeFromPopup.tsx`
- **No "Selling from" picker.** Check Stock tab table gets an **In warehouses** column:
  `W1 3 · W2 2` (zero warehouses hidden); "In stock" badge stays the total. The variation
  picker also shows the same chips under the selected variation.
- Add to cart → `TakeFromPopup` when 2+ warehouses hold the variation (WH-6): one quantity
  box per warehouse, default first pre-filled, "5 of 5" check, Confirm. Only one warehouse →
  no popup, line chip "from W1". In sale-order mode the popup also has "Decide at delivery".
- Cart line (`CartSidebar.tsx`, `cart\LineSheet.tsx`) shows split chips; tap to reopen popup.
  Changing quantity reopens the popup when the split no longer adds up.

### 4.7 Other
Item detail (`inventory\[id]`) and rolls pages: warehouse column + filter. Internal print
copy and shift slip show warehouses. `lib\types.ts`, `lib\api.ts` updated. Add the screens to
`docs\ui-prototype` for owner review first.

---

## 5. Tests (`v3.1\app\api\tests`)
New `integration\warehouses.test.ts`, `integration\transfers.test.ts`, `integration\line-splits.test.ts`.
1. Warehousing off: all V2 tests pass unchanged; no warehouse fields required.
2. Create first warehouse: all stock / rolls / old lines assigned; drift views empty; totals unchanged; second create = empty warehouse.
3. Movement without warehouse after enabling → rejected by trigger.
4. Purchase split 3 → W1, 2 → W2: balances right; split ≠ quantity → 400; void reverses both.
5. Sale split; shortage per warehouse; oversell confirmed + audited; edit moving a split.
6. Stock In two rows of one item (W1, W2) in one save.
7. Shift counted / measured; over-quantity → 409; From = To / inactive → 400; cancel; cancel after use → 409.
8. Concurrency: parallel shifts and sale on the last units of W1.
9. Opening once per warehouse; deactivate blocked with stock.
10. Backup/restore round trip; old backup restores warehousing-off.
11. Catalog leaks nothing; unit tests for split validation and `suggestSaleSplits`.

Commands (record results in the handoff): `npm run typecheck`, `npm test`,
`npm run test:integration` in `v3.1\app`.

---

## 6. Build order
1. Owner confirms §7.
2. Migration `0032_warehouses` + triggers + views; `enableWarehousing`; tests 1–3.
3. Stock engine + warehouses routes + permissions.
4. Line splits in documents / measured / orders / drafts; tests 4–5.
5. Stock In API (multi-warehouse rows); transfers; tests 6–9.
6. Backup/restore + demo seed.
7. Web: Warehouses page → Stock In filter/column/dropdowns → Shifts pages → checkout splits → drawer column → orders → print.
8. Full test run, demo reset, handoff note, propagation log.

## 7. Owner decisions (2026-10-20)
1. Warehousing starts when admin creates the first warehouse (all current stock goes into it).
2. Purchase: "Receive into" for all lines + per-line dropdown / split.
3. Stock In: warehouse filter; one sub-row per warehouse holding the item; "+ add stock in another warehouse".
4. Separate Warehouses and Shifts pages.
5. Sale: warehouse chosen in a popup after selecting the product (skipped when only one warehouse holds it); cart drawer only shows an "In warehouses" column.
6. A warehouse may not go negative while the company total covers the sale — split or shift. No extra shortage logic now; company-wide shortage keeps the V2 Warn & Allow behaviour.
7. Sale orders: choose split when adding (popup only if 2+ warehouses hold it) or "Decide at delivery".
8. Shifts: admin + manager; whole pieces only for rolls.
9. Demo: "Main Godown" (W1) and "Shop" (W2). No shift slip, no per-warehouse stock PDF in V3.

Still open (non-blocking): none. Implementation can start at §6 step 2.

---

## Build status (2026-10-21, session "Warehouse work")

**Built (API, `v3.1\app\api`)** — §6 steps 2–6:

| Area | Files |
|---|---|
| DB | `prisma\migrations\0034_warehouse_enums\` (MovementType `TRANSFER_OUT/IN/VOID`, PieceAction `TRANSFER/TRANSFER_VOID`), `0035_warehouses\` (tables, columns, triggers, drift views); `schema.prisma` (`Warehouse`, `WarehouseStockBalance`, `StockTransfer(+Line, Void)`, new columns) |
| Warehouses | `src\lib\warehouses.ts` (enable on first create, default, rename, (de)activate, `balancesByWarehouse`, `inSetsByWarehouse`, `suggestSaleSplits`, `validateSplits`, `resolveWarehouse`); `src\routes\warehouses.ts` (`/api/warehouses`, `/api/transfers`) |
| Stock engine | `src\lib\stock.ts` — movements without a warehouse are placed (receipts → default; sales → default first, then largest free stock); per-warehouse check `WAREHOUSE_SHORT` (WH-6a) incl. stock in sets (GW-4) |
| Documents | `src\lib\documents.ts` — header `warehouseId` (purchase "Receive into"), line `splits`; measured lines follow rolls / pieces; sets follow their warehouse; void and edit reverse per (item, warehouse) |
| Rolls / sets | `src\lib\measure.ts` (rolls per warehouse, cut piece inherits, sale void returns to the warehouse it was sold from), `src\lib\sets.ts` (set / opening sets `warehouseId`) |
| Shifts | `src\lib\transfers.ts` — counted, whole rolls, whole sets (GW-3); cancel only while To still holds it |
| Stock In | `src\routes\inventory.ts` — rows per (item, warehouse), opening once per warehouse, `byWarehouse` on every variation (null while off), movement history shows warehouse + shift number; `src\routes\measure.ts` Add rolls `warehouseId`, piece `warehouseId` |
| Orders / drafts | `src\lib\orders.ts` (sale-order line `splits` or decide at delivery; PO `warehouseId` pre-fills receive), `src\routes\orders.ts`, `src\routes\drafts.ts` |
| Permissions, numbering | `warehouse.manage` (admin), `stock.transfer`, `stock.transfer.void` (admin, manager); `TRF` series |
| Backup | `src\routes\backup.ts` — exports / restores warehouses, shifts, every warehouse column; old archives restore warehousing-off; restore checks warehouse drift |
| Demo | `scripts\seed-demo.ts` step 13 (W1 Main Godown, W2 Shop, split purchase / sale, shifts incl. a roll and a set, a cancelled shift, sale order with saved split + one decided at delivery) — **not yet run** (see handoff) |
| Tests | `tests\integration\warehouses.test.ts` (9), `tests\unit\warehouses.test.ts` (6) |

**Deviations from this plan (decided while building):**

1. No `document_line_splits` table and no `split_id`: a counted item is one line per document, so
   its movements (one per warehouse) are its split; measured lines follow their pieces, set lines
   their sets. Voids / edits reverse per (item, warehouse); `document_voids_consistent` checks that.
2. `enableWarehousing` does not disable triggers: the 0035 `stock_movements_append_only` allows
   exactly one change (warehouse NULL → first warehouse, rest of the row identical).
3. A sale line without a split is placed automatically (default warehouse first, then largest free
   stock). The Take-from popup (WH-6) is a UI step on top; the API accepts explicit `splits`.
4. A cut piece made without a warehouse takes its parent roll's (trigger).
5. Migration numbers 0034 + 0035 (enum values must commit before use).

**Web UI (built 2026-10-21, `v3.1\app\web`):**

| Screen | Files |
|---|---|
| Sidebar | `app\(app)\layout.tsx` — Shifts (only once warehousing is on), Warehouses (admin); `components\icons.tsx` WarehouseIcon, ShiftIcon |
| Warehouses | `app\(app)\warehouses\page.tsx` — empty state + confirmed "Create first warehouse", table (items, rolls, sets, value), rename, make default, (de)activate; a row opens Stock In filtered to it |
| Shifts | `app\(app)\shifts\page.tsx` (list, search, warehouse filter), `shifts\new\page.tsx` (From / To / swap, item search with per-warehouse chips, quantity with max, roll picker, set picker; `?from=&variation=` pre-fill from Stock In), `shifts\[id]\page.tsx` (lines, cancel with reason) |
| Stock In | `app\(app)\inventory\page.tsx` — warehouse filter (remembered per user, `?warehouse=`); one stepper per warehouse + "+ another warehouse"; other warehouses as chips; shift shortcut per row; saves rows per (item, warehouse), prices stay company-wide. `components\measure\RollActions.tsx`: Add rolls picks the warehouse |
| Sale | `components\CartContext.tsx` (line `splits`, `setSplits`; adding a counted sale line opens Take-from when 2+ warehouses hold it, "from W1" when one); `components\cart\TakeFromPopup.tsx` (popup, split chips, stock chips) |
| Purchase | `components\Checkout.tsx` — "Receive into" + per-line split (same popup in receive mode); sends `warehouseId` / `splits` on documents, edits, orders (sale-order splits; PO preferred warehouse) and held carts |
| Elsewhere | `ProductDrawer.tsx` (In warehouses chips), `CartSidebar.tsx` (split chips), product history shows the warehouse and links shifts (`ProductDetailModal.tsx`, `ProductDetailView.tsx`), roll history labels (`lib\measure.ts`), `lib\types.ts`, new `lib\useWarehouses.ts`; API: roll view `setId` (`routes\measure.ts`) |

**Remaining screens (built 2026-10-22):**

| Screen | Files |
|---|---|
| Purchase roll editor | `components\measure\MeasuredDrawer.tsx` — Warehouse column per roll ("Receive into" = empty choice); a new roll copies the previous roll's warehouse; cart rolls keep `warehouseId` |
| Set sheets | `components\sets\SetSheet.tsx` — Warehouse column per set (purchase sheet: "Receive into"; opening sets: "Default (W1)"); `PurchaseSetsModal.tsx` keeps it on the cart line and in its summary; `SetsPanel.tsx` shows each set's warehouse badge; API `routes\drafts.ts` keeps it on held carts |
| Order page | `components\orders\OrderView.tsx` — each sale line shows its saved split or "decide at delivery"; the Complete dialog has a Take-from chip per counted line (opens the popup for the quantity delivered now; starts from the saved split or the automatic pick); purchase orders show and choose "Receive into"; Edit items keeps saved splits |
| Item detail | `components\products\ProductDetailView.tsx` — "In warehouses" row in Stock & prices and an "In warehouses" column in the variations table |
| Rolls | `components\measure\MeasuredStock.tsx` (warehouse filter, Add rolls pre-selects it), `PieceColumns.tsx` (warehouse badge per roll, "in set"), `app\(app)\inventory\rolls\[rollId]\page.tsx` (Warehouse row; history Warehouse column with From → To and a link to the shift); API `routes\measure.ts` history rows carry `warehouseId` / `toWarehouseId` / `transferId` |

**Still to do:** `docs\ui-prototype` screens; grouped phase 3 (set sale) must name the set's
warehouse (GW-2). Seen while testing, not warehouse work: the sale order's "Measured Shortage &
Procurement Tracking" table lists a counted item with physical stock 0 (it reads rolls only).
