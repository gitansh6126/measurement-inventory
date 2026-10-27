# V3 — Grouped Products (sets) plan

Date: 2026-10-20 (revision 2, owner flow) · Status: **phase 1 built** (2026-10-21, see `v3.1\HANDOFF.md`): tables, create / edit, opening sets, free-stock rule, Sets tab, backup, demo. Phase 2 = purchase sets, phase 3 = sale with part changes ·
Folder: `D:\client works\rs new\v3.1\app\`

Revision 2 replaces revision 1 (recipe with default variations, virtual kits built from loose
stock, donor-set swaps). The owner described the real business flow; this plan follows it.

Inputs: owner spec "Grouped Product Component Replacement and Inventory Reallocation" v2.0;
owner answers in chat 2026-10-20; `v3.1\docs\WAREHOUSE-V3-PLAN.md`; V3 baseline schema
`v3.1\app\api\prisma\schema.prisma` (migrations up to `0029`).

---

## 0. Owner decisions

| # | Decision |
|---|---|
| D1 | A grouped product is a **set**, e.g. Chain Hoist = Hoist (main) + Chain (by-product). |
| D2 | The **main component is always created new** inside the grouped product form; never an existing product. |
| D3 | The main component is **always a Simple product**. Quantity 1 per set. |
| D4 | In V3 the main component exists **only inside sets**: not sold, bought or stock-edited loose. Loose selling may come in V4 (ask then). |
| D5 | **By-products** are linked as products only (existing, or created new inline): Simple, Variable or Measured. Create never fixes a variation, quantity or length. |
| D6 | By-products can be **required or optional**. |
| D7 | Counted by-products are always **1 per set**. Measured by-products: length typed per set at purchase. |
| D8 | **Sets are created only by purchase.** Each set row picks every by-product's variation (and length for measured). |
| D9 | Stock shows as a whole set on the grouped product, and the same parts show on their own products (variation rows, piece columns) as "In sets". |
| D10 | In a sale the user picks a set from the product drawer and may **edit it**: changing a by-product returns the old one to free stock (measured → Cut Piece) and takes the new one through the measured / variation picker; stock reduces on save. |

| D11 | **No part costs.** A set has one purchase rate; by-products inside a set carry no cost of their own. A part returned to free stock has no piece cost (stock value uses the variation's purchase cost as today). |
| D12 | **Changing a part in a sale reprices the line**: set price − (old part sale rate × qty/length) + (new part sale rate × qty/length), using each variation's current sale price. Staff can still edit; min price applies. |
| D13 | A fitted part returned to stock keeps **exactly the same length** (no editing, no write-off). |
| D14 | In V3 parts change **only inside a sale** (anyone who can sell). Changing parts outside a sale (repairs, preparing a set) is **moved to V4** (owner, 2026-10-20). |
| D15 | Sale void (customer return) brings back **the same set** with the parts it was sold with. |
| D16 | Purchase void / edit is **blocked** once any of its sets was changed, held or sold. |
| D17 | **Set code** generated like roll stock IDs: `{SET SKU}-{part attributes + lengths}-{D-M-YY}-{seq}`, e.g. `CH-4MM-3M-20-10-26-01`, `CH-4MM-3M-HK-20-10-26-02`. Fixed for life even if parts change. |
| D18 | On screens a set is named **by its current contents** ("Chain Hoist · 4 mm 3 m · Hook"); the code appears only on print, history and search. |
| D19 | Several sets in one sale: **one line "Chain Hoist × 3"** with 3 sets ticked; each can be edited. |
| D20 | **Opening sets**: admin-only "Add opening sets" on the grouped product page / Stock In, same set sheet as purchase, no supplier or bill. |
| D21 | Purchase warehouse **per set**, default from "Receive into". |
| D22 | Public catalog shows the grouped product with set price, in stock yes/no and the chain sizes available as options; no set codes or warehouses. |
| D23 | **Sale orders hold sets**: sets are chosen when the order is taken and are hidden from other sales until delivered or the order is cancelled. |
| D24 | **Vendor pricing for grouped products is not in V3** (owner: "we will see in V4"). Supplier Rates page and the purchase set sheet show "Supplier rates for sets — not available yet"; no rate cards, no rate chips and no auto-update from set purchases. Loose by-product purchases keep normal vendor pricing. |

Not in V3 (dropped from revision 1): building sets from loose stock, taking a part from another
set (donor swap B1 / B2), incomplete sets, default variations, assembling in the shop.

---

## 1. Concepts and data

| Concept | Meaning | Table |
|---|---|---|
| Grouped product | Name, SKU, category, sale price per set. Product type `grouped`, one variation (holds SKU / price, like Simple). Never has stock movements of its own. | `product_groups` + `product_variations` |
| Main component | A Simple product created with the set and owned by it (`owner_group_id`). Hidden from loose cart, Stock In editing and public catalog. | `product_groups.owner_group_id` |
| By-product link | Grouped product → by-product product, required / optional, order. No variation. | `group_byproducts` |
| Set | One physical set: code `CH-3MM-3M-20-10-26-01` (D17), warehouse, status, source (purchase / opening), rate, held-by order. | `group_sets` |
| Set part | Which physical part is in the set now: role, variation, piece (measured), quantity, status. | `group_set_parts` |
| Part change | History of every part replaced / added / removed (spec §10). | `group_set_part_changes` |

### 1.1 Stock rule

Parts stay in the **normal stock** of their own products (`stock_balances`, pieces). A set
only marks them as taken:

```
free stock (variation, warehouse) = balance − SUM(quantity of ALLOCATED set parts)
```

- Loose sale, loose adjustment and shift lines can use **free stock only**; set parts can
  never be oversold, whatever the negative-stock policy (trigger).
- Measured: an in-set piece has `measurement_pieces.set_id`; pickers skip it. The rule
  "SUM of ACTIVE pieces = balance" is unchanged (in-set pieces are still ACTIVE stock).
- Main component: all its stock is always in sets in V3 (free = 0).

### 1.2 Migrations `0030_grouped_type` (enum values) + `0031_grouped_sets` (built before warehouses, owner 2026-10-21)

```prisma
enum ProductType { simple variable measured grouped }

// product_groups: owner_group_id String? — set on the main component (Simple) of a grouped
// product. CHECK: grouped products have no length_unit; owner points at a grouped product.

model GroupByproduct {
  id             String  @id @default(cuid())
  companyId      String  @map("company_id")
  groupId        String  @map("group_id")            // the grouped product
  productId      String  @map("product_id")          // by-product (simple/variable/measured)
  required       Boolean @default(true)
  sortOrder      Int     @default(0) @map("sort_order")
  active         Boolean @default(true)              // removed link = inactive, history kept
  @@unique([groupId, productId])
  @@map("group_byproducts")
}

enum SetStatus { IN_STOCK HELD SOLD CANCELLED }     // HELD = on a sale order (D23); CANCELLED = purchase voided
enum SetSource { PURCHASE OPENING }
enum PartRole  { MAIN BY }
enum PartStatus { ALLOCATED RELEASED SOLD }

model GroupSet {
  id            String    @id @default(cuid())
  companyId     String    @map("company_id")
  code          String                              // D17 "CH-4MM-3M-20-10-26-01", fixed, never reused
  groupId       String    @map("group_id")
  warehouseId   String?   @map("warehouse_id")      // NULL while warehousing is off
  status        SetStatus
  source        SetSource
  purchaseId    String?   @map("purchase_id")       // NULL for OPENING
  purchaseLineNo Int?     @map("purchase_line_no")
  rate          Decimal   @db.Decimal(14, 2)        // purchase / opening rate of this set (D11)
  orderId       String?   @map("order_id")          // set while HELD (D23)
  orderLineNo   Int?      @map("order_line_no")
  saleId        String?   @map("sale_id")           // D19: many sets per sale line
  saleLineNo    Int?      @map("sale_line_no")
  version       Int       @default(1)
  createdAt     DateTime  @default(now()) @map("created_at")
  createdById   String    @map("created_by")
  parts         GroupSetPart[]
  @@unique([companyId, code])
  @@index([companyId, groupId, status, warehouseId])
  @@map("group_sets")
}

model GroupSetPart {
  id           String     @id @default(cuid())
  companyId    String     @map("company_id")
  setId        String     @map("set_id")
  role         PartRole
  byproductId  String?    @map("byproduct_id")      // NULL for MAIN
  variationId  String     @map("variation_id")
  pieceId      String?    @map("piece_id")          // measured only
  quantity     Decimal    @db.Decimal(14, 3)        // 1 for counted; length for measured
  status       PartStatus                           // no cost per part (D11)
  allocatedAt  DateTime   @default(now()) @map("allocated_at")
  releasedAt   DateTime?  @map("released_at")
  @@map("group_set_parts")
  // partial uniques WHERE status='ALLOCATED': (set_id, byproduct_id) ; (set_id) for MAIN ; (piece_id)
}

enum PartChangeType { REPLACE ADD REMOVE }

model GroupSetPartChange {                         // append-only
  id            String         @id @default(cuid())
  companyId     String         @map("company_id")
  setId         String         @map("set_id")
  saleId        String         @map("sale_id")     // V3: always a sale (V4 may allow NULL for changes from inventory)
  changeType    PartChangeType @map("change_type")
  oldPartId     String?        @map("old_part_id")
  newPartId     String?        @map("new_part_id")
  oldPieceId    String?        @map("old_piece_id")  // where the old part went (now free)
  newSourcePieceId String?     @map("new_source_piece_id") // roll / piece it was cut from
  reason        String?
  createdAt     DateTime       @default(now()) @map("created_at")
  createdById   String         @map("created_by")
  @@map("group_set_part_changes")
}
```

Changed tables: `measurement_pieces.set_id` (NULL = free); `PieceAction` add `SET_ALLOCATE`,
`SET_RELEASE`; sale / purchase / order lines keep the grouped variation and link their sets via `group_sets` (sale_id + line, order_id + line, purchase_id + line); child
rows in `group_sets`; `stock_transfer_lines.set_id` (warehouse shift of a whole set).

### 1.3 Database checks (deferred triggers, like 0007 / 0020)

1. Free stock never below 0 for any (variation, warehouse) — every movement type.
2. One ALLOCATED owner per piece; ALLOCATED part's piece has `set_id` = that set and
   remaining length = part quantity; free pieces have `set_id` NULL.
3. Part variation = piece variation; MAIN part is the group's main component, quantity 1.
4. IN_STOCK set has exactly one ALLOCATED MAIN and one ALLOCATED part for every **required**
   active by-product link that existed when it was bought; at most one per by-product.
5. Set, its parts' pieces and stock all in the set's warehouse.
6. No stock movement on a `grouped` variation; no loose movement on a main component
   except through set purchase / sale / void.
7. Append-only on `group_set_part_changes`; view `set_allocation_drift` returns 0 rows.

---

## 2. Create and edit

### Create (`POST /api/products` with `productType: "grouped"`)

Body: set details, `main: { name, shortName, unit, … }` (Simple; same validation as product
create), `byproducts: [{ productId | newProduct, required }]`.

One transaction:
1. Create the main component Simple product (`owner_group_id` set after step 2).
2. Create the grouped product + its single variation.
3. Create inline by-products through the normal product create logic
   (`lib\products.ts`; Variable / Measured builders unchanged).
4. Insert `group_byproducts`. Audit `GROUPED_PRODUCT_CREATED`.

Validation: at least one by-product; a by-product cannot be grouped, a main component of any
set, or duplicated; active only.

### Edit

- Set details and main component details edited on the grouped product page (versioned, 409
  on stale). The main component can't be swapped or unlinked.
- Add a by-product link: applies to sets bought from now on.
- Remove a link: `active = false`; existing sets keep their part. Change required ↔ optional:
  applies to new sets and to new edits in sales.
- Deactivate grouped product = also hides its main component; sets in stock stay sellable
  only after reactivation.

---

## 3. Purchase

Cart: picking Chain Hoist opens the **set entry sheet**: number of sets, then one row per set:

| Set | Chain Roll (required) | Length | Hook (optional) | Rate | Warehouse |
|---|---|---|---|---|---|
| 1 | 3 mm | 3.000 m | Hook | ₹ 6,200 | W1 |
| 2 | 4 mm | 4.500 m | — | ₹ 7,400 | W1 |

Body: purchase line `{ variationId: <grouped>, quantity: 2, sets: [{ rate, warehouseId?,
parts: [{ byproductId, variationId, length? }] }] }`.

Server, in the purchase transaction:
1. Validate: every required by-product present, optional ones at most once, variation belongs
   to the linked product, counted quantity 1, measured length > 0.
2. Line amount = Σ set rates; the document shows "Chain Hoist × 2".
3. Per set: build the code (D17) from the set short name, each fitted by-product's
   attribute values (+ length for measured, optional parts only when fitted) and the purchase
   date; sequence from `piece_counters` with that prefix as key (same concurrency-safe
   allocation as roll IDs); insert `group_sets`.
4. Per part: `PURCHASE` movement +1 (main and counted) or + length (measured, in the set's
   warehouse); measured creates a **CUT** piece (no parent, `purchase_id`, `set_id`) with ledger
   `RECEIVE` + `SET_ALLOCATE`; insert `group_set_parts` ALLOCATED.
5. No cost split (D11): movements carry the set rate on the MAIN part only; by-product
   movements and pieces have no rate / `unit_cost`.
6. Audit `PURCHASE_CREATED` with set codes.

**Opening sets (D20)**: `POST /api/sets/opening` (admin), same body as a purchase line's
`sets[]` without supplier; `OPENING` movements; `source = OPENING`; audit `SET_OPENING`.
Correcting a wrong opening set = admin "Cancel opening set" while it is untouched.

Void purchase: allowed only while every set from it is IN_STOCK, not held, with its original
parts (otherwise `409 SET_CHANGED_OR_SOLD`, "cancel the sale / order first"). Reverses the movements, pieces
→ USED_UP via `PURCHASE_VOID`, sets → CANCELLED. Edit purchase: same rule, reverse + repost.

Purchase orders: a Chain Hoist order line holds the number of sets; set rows are entered when
receiving.

### 3.1 Sale orders hold sets (D23)

- Taking a sale order for Chain Hoist × 2: the drawer lists IN_STOCK sets; the user ticks 2
  (and may plan part changes, stored on the order line, not applied yet).
- Save: sets → `HELD` with `order_id`; hidden from sale drawers and shifts
  (other than through the order). Concurrency: lock + status check, `409 SET_NOT_AVAILABLE`.
- Delivery: the held sets are pre-selected; planned changes are applied then (§5.3); sets → SOLD.
- Order edit: swap / add / remove held sets. Order cancel or close: sets → IN_STOCK.
- Purchase void, deactivating a warehouse and set shifts treat HELD like IN_STOCK (blocked /
  allowed the same way) but a held set can only be shifted from the order page.
- This is the only stock hold in the app; counted / measured order lines keep "no reservation".

---

## 4. Inventory screens

| Where | Shows |
|---|---|
| Chain Hoist product page → **Sets** | count by warehouse; set tiles (code, warehouse, main, each by-product variation + length); per set: history, Shift. |
| Chain Roll → each variation's piece columns | Sealed · In use · Cut · **In sets** (tile with set code badge, not pickable). |
| Variable / Simple by-product rows | Total · Free · In sets. |
| Stock In | By-product rows: Free editable, In sets read-only. Main component row read-only ("only through sets"). Grouped row: set count, no New Stock. |
| Low stock | free stock only. |

**Change parts outside a sale** — not in V3; moved to V4 (see §11).

---

## 5. Sale

### 5.1 Pick a set

Product drawer for Chain Hoist lists IN_STOCK sets in the take-from warehouse (other
warehouses shown greyed with "shift first"). Tick a set ("Chain Hoist · 3 mm 3 m") → its parts list:

| Part | Fitted | Action |
|---|---|---|
| Hoist | Hoist | — |
| Chain Roll (required) | 3 mm · 3.0 m | Change |
| Hook (optional) | Hook | Change · Remove |
| (optional not fitted) | — | Add |

### 5.2 Edit the set in the sale

- **Change** opens the same picker as a normal sale of that by-product: variation chooser,
  then for measured the piece columns (Cut / In use / Sealed, free pieces in the set's
  warehouse only) and a length; one piece per part (DM-4).
- **Add** (optional by-product not fitted): same picker.
- **Remove** (optional only): old part goes back to free stock.
- Required by-products can be changed but not removed.
- The line shows "Chain Hoist · 4 mm 3 m (was 3 mm)" — named by contents (D18).
- **Price (D12)**: line price = set price − old part (its variation's sale rate × qty/length)
  + new part (sale rate × qty/length). Example ₹8,500 − 3 mm 3 m (₹900) + 4 mm 3 m (₹1,320)
  = ₹8,920. Add = + new; Remove = − old. Still editable; min price applies.
- **Several sets (D19)**: one line "Chain Hoist × 3"; the drawer ticks 3 sets; each set row has
  its own Change / Add / Remove; line price = sum of the repriced sets.

Nothing changes in stock until the sale is saved.

### 5.3 On save (one transaction)

1. Lock the set (`FOR UPDATE`, version check), the chosen pieces and variations (id order).
   Anything changed since it was picked → `409 SET_CHANGED`, nothing saved.
2. For each removed / replaced part: part → RELEASED; measured piece `set_id` = NULL, ledger
   `SET_RELEASE` → it is now a free **Cut Piece** of its own variation (same piece, exactly
   the same length — D13, same history); counted → back to free stock. No movement needed (it was already in
   the balance).
3. For each new / replacement part: measured — cut the length from the chosen piece (normal
   `CUT`), new piece `set_id` = set, ledger `SET_ALLOCATE`; counted — allocate 1. Insert part
   ALLOCATED and the `group_set_part_changes` row.
4. `SALE` movements for every final part (main + by-products, in the set's warehouse), so
   product sales reports and future Tally export see the real items. Parts → SOLD, set → SOLD
   with `sale_id`.
5. Snapshot of the final parts on the sale line (`sale_line_parts` view over parts + changes).

Example — set CH-3MM-3M-20-10-26-01 sold with the chain changed 3 mm → 4 mm (3 m):

| | Before | After |
|---|---|---|
| Hoist | 2 (in sets 2) | 1 (in sets 1) |
| Chain 3 mm | 84.5 m, free 81.5 | 84.5 m, **free 84.5** (piece came back) |
| Chain 4 mm | 80 m, free 77 | 77 m, free 74 |

### 5.4 Void and edit

- **Void**: `SALE_VOID` movements; set back to IN_STOCK with the parts it was sold with (4 mm).
  Released parts stay free — part changes are not undone (in V3 the next sale can change them again).
- **Edit (revision)**: price, discount, party, date, payment only. Changing the set or its parts
  → cancel the sale and sell again (same rule as V2 `ORDER_QTY_LOCKED`).
- Sale orders: sets are held from order time (§3.1); delivery applies planned changes.

---

## 6. Warehousing

| # | Rule |
|---|---|
| GW-1 | A set lives in one warehouse (chosen per set at purchase; default = "Receive into"). All its parts and pieces are there. |
| GW-2 | Sale shows sets of the take-from warehouse; replacement parts come from free stock of the set's warehouse; released parts return there. |
| GW-3 | Shift line type **Set**: the set and all its parts move together (`warehouse_id` on set and pieces; free/in-set balances per warehouse move with it). Cancel only while the set is still IN_STOCK in the To warehouse. |
| GW-4 | Free stock check is per warehouse; per-warehouse "In sets" column on Stock In. |
| GW-5 | A warehouse with IN_STOCK sets cannot be deactivated. |
| GW-6 | `enableWarehousing()` assigns existing sets and their pieces to the first warehouse. |
| GW-7 | Public catalog (D22): set price, in stock yes/no, available chain sizes as options; no set codes, counts per warehouse or held sets. |
| GW-8 | Warehousing off: all warehouse fields NULL, rules apply company-wide. |

---

## 7. API / code touch points (`v3.1\app\api\src`)

| File | Change |
|---|---|
| `lib\products.ts`, `routes\products.ts` | grouped create / edit (§2); hide owned main components from lists / cart / catalog. |
| new `lib\sets.ts`, `routes\sets.ts` | `GET /api/sets?groupId&status&warehouseId`, `GET /api/sets/:id` (parts + history), `POST /api/sets/:id/preview`. |
| `lib\documents.ts` | purchase `sets[]` (§3); sale line `setId` + `partChanges[]` (§5); void / edit rules. |
| `lib\stock.ts` | free-stock check; `freeBalances()`, `inSetBalances()`. |
| `lib\measure.ts` | pickers exclude `set_id` pieces; `SET_ALLOCATE` / `SET_RELEASE`. |
| `lib\inventory-query.ts`, `routes\inventory.ts` | Free / In sets columns; main component read-only. |
| `lib\transfers.ts` (warehouse plan) | Set lines. |
| `lib\orders.ts` | grouped order lines; purchase orders: sets entered at receive; sale orders: hold sets (§3.1), release on cancel / close. |
| `lib\permissions.ts` | no new permission in V3: changing parts inside a sale = whoever can sell (`set.edit` comes with V4). |
| `lib\numbering.ts` / piece counters | set codes per D17 (prefix key in `piece_counters`). |
| `routes\catalog.ts` | GW-7. |
| `routes\backup.ts` | new tables / columns; triggers in `RESTORE_TRIGGERS`. |
| `scripts\seed-demo.ts` | Demo Company: Chain Hoist (main Hoist, by Chain Roll 3 / 4 mm required, Hook optional); purchase of 3 sets across W1 / W2; one sale with a chain change. |
| `shared\src\index.ts` | `GroupedProduct`, `GroupSet`, `SetPart`, labels. |

Web (`v3.1\app\web`), prototype first in `v3.1\docs\ui-prototype`: product form type Grouped
(4 steps: set details · new main component · by-products · review), purchase set sheet,
Sets tab, In sets piece column, sale set drawer + Change / Add / Remove, checkout line,
invoice ("Chain Hoist with 4 mm chain, 3 m"; internal copy adds set code and warehouse),
shift Set line.

---

## 8. Tests (`v3.1\app\api\tests`, warehousing off and on)

1. Create: main always new Simple; by-product validation; inline new by-product; rollback on error.
2. Purchase 2 sets: movements, CUT pieces with `set_id`, parts, codes; missing required → 400;
   optional twice → 400; counted quantity ≠ 1 → 400.
3. Free stock: loose sale / adjustment / shift cannot use in-set stock under any policy.
4. Sale of a set unchanged: SALE movements per part, set SOLD.
5. Sale with chain change: 3 mm piece free as Cut Piece (same id, length, variation); 4 mm cut;
   history row; totals as §5.3 example.
6. Add / remove optional Hook in a sale; remove required → 400.
7. Concurrency: two sales of the same set; two sets taking the same 4 mm piece → 409, nothing
   partial.
8. Void sale → set IN_STOCK with 4 mm; released 3 mm stays free.
9. Void purchase blocked after a set changed or sold; allowed before.
10. Warehouses: replacement from other warehouse rejected; released part lands in set's
    warehouse; shift a set and cancel; deactivate blocked; enableWarehousing assigns sets.
11. Backup / restore round trip; catalog leaks nothing; drift views empty.
12. Repricing on change / add / remove (D12) per set and for a 3-set line (D19).
13. Set code built from parts + date, unique under parallel purchases, unchanged after a part change (D17).
14. Opening sets: admin only, OPENING movements, cancel while untouched (D20).
15. Sale order holds sets: hidden from other sales, 409 on double hold, delivery applies planned
    changes, cancel releases; purchase void blocked while held (D23, D16).

Commands (record in handoff): in `v3.1\app` → `npm run typecheck`, `npm test`,
`npm run test:integration` (needs owner consent to reset `rs_v31_test`).

---

## 9. Build order

Owner 2026-10-21: grouped products first, warehouses after (warehouse fields stay NULL, GW-8).

1. **Done (phase 1, 2026-10-21):** `0030_grouped_type` + `0031_grouped_sets` + triggers;
   create (main always new Simple, by-products existing or inline) / edit links; admin opening
   sets (`set.opening`) + cancel untouched; set codes (D17) and names (D18); free-stock rule in
   `recordMovements` + inventory screens (free / In sets, sets in stock); Sets tab; backup /
   restore of all set tables; demo "Chain Hoist Set" with 3 opening sets; tests
   `tests\integration\grouped.test.ts` (1, 3, 11 partly, 13, 14).
   Added to the design: `measurement_pieces.set_origin` (a Cut piece made in a set has no
   parent roll); ledger links allow `SET_ALLOCATE` / `SET_RELEASE`.
2. **Done (phase 2, 2026-10-21):** purchase sets — migration `0032_grouped_documents` (a
   grouped product may repeat on a document; `documents_consistent` counts set parts and checks
   grouped line quantity = sets on the line); purchase line `sets[]` (all sets on a line share the
   line price, so sets at different rates become separate lines — the cart does this
   automatically; deviation from one line "× 3" with mixed rates, needed because a document line
   has one price); purchase void releases and retires the sets, refused with
   `SET_CHANGED_OR_SOLD` once a set changed / held / sold (D16); editing a document with sets →
   `SETS_NOT_EDITABLE` (cancel and re-enter); no supplier rates for sets (D24); sets on orders
   refused (`SETS_ORDER_NOT_READY`) until phase 3. Web: "Enter sets" in the purchase cart
   (`components\sets\PurchaseSetsModal.tsx`, shared `SetSheet.tsx`), set lines in checkout /
   cart sidebar / held carts, set codes on the purchase page. Test: `grouped.test.ts` "buys sets
   on a purchase…" (tests 2, 9).
3. **Done (phase 3, 2026-10-22):** sale set + part changes + repricing + void (migration
   `0036_set_sales`; `prepareSaleSets` / `sellSets` / `restoreSaleSets`; web `SaleSetsModal.tsx`;
   sets at different prices go on separate lines, like purchase); Stock In "+ Add sets"; tests 4–6,
   8, 12 in `grouped.test.ts`. **Done 2026-10-22:** sale orders hold sets (D23, test 15) and
   purchase orders receive sets (migration `0037_set_orders`, `order_lines.sets`). Deviation: a
   sale order's set line is delivered whole (`WHOLE_SETS`). Still open: concurrency test 7.
   **Done 2026-10-23:** sale drawer "Build set" — choose the contents, the system uses a Ready
   set or changes the best set on the spot (`docs\SET-BUILD-IN-SALE-PLAN.md`, shared `planSets`).
4. Catalog GW-7 / public card; prototype screens for owner review.
5. After warehouses (`0032_warehouses`): shift Set lines, warehouse rules; test 10.

## 10. Open questions

Answered 2026-10-20 → D11–D23. Still open:

1. Warehouse plan open questions (`WAREHOUSE-V3-PLAN.md` §7).
2. Code format detail — **built as proposed, owner to confirm**: each attribute value with its
   unit, spaces removed, upper case ("8" mm → `8MM`, abbreviation map wins); a Simple part by its
   Short Name (`SH-1T`); measured length without trailing zeros + `M` / `IN` (`2.5M`); optional
   parts only when fitted. Example: `CHS-8MM-2.5M-SH-1T-21-10-26-01`.

## 11. Other versions

- **V4**: **Vendor pricing for grouped products** (D24): rate per set per supplier, how mixed set rates on one line update the card, one rate per set vs per contents — decide in V4.
- **V4**: **Change parts outside a sale** (moved from V3, D14): Sets tab action "Change parts" with the same picker as the sale, permission `set.edit` (admin + sales_manager), part change saved with `sale_id` NULL, blocked while a set is HELD; `POST /api/sets/:id/parts`.
- **V4**: ask whether the main component can be sold / bought loose (D4); Tally export of sets
  (item per part or BOM); QR label per set code; scan a set in shifts.
- **V2**: frozen; descriptive bundles (BR-23) unchanged. **V1 / main v2**: N/A.
