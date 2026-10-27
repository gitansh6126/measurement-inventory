# V3.1 production test — checklist

Tick each line (✔ / ✘ + a note). Test on the **V3.1 real company copy** (`:3210`) unless the
line says *Demo* (`:3310`). V2 (`:3200`) stays live during the whole test. Send this file with
the notes and `local-server\logs\` to the developer at the end.

Tested by: ____________  Dates: ____________  V3.1 package (VERSION.txt): ____________

## A. Install and start (day 1)

- [ ] `INSTALL.bat` finished; **V2 still opens** on `:3200` with its usual data afterwards
- [ ] Data copy from V2: every line `[OK]` (row counts equal, drift views empty)
- [ ] `TEST-V31.bat` → "All smoke checks passed"
- [ ] `START-SHOP-APP.bat` → opens on this PC, on 2 phones and 1 other PC (`:3210`)
- [ ] `START-DEMO.bat` → demo opens on `:3310`, Admin button signs in
- [ ] `STOP-SHOP-APP.bat` stops V3.1 only (V2 keeps working)
- [ ] `BACKUP-NOW.bat` → `OK … local + copy` (after `BACKUP_COPY_DIR` is set)
- [ ] PC restarted → V2 starts by itself, V3.1 starts with `START-SHOP-APP.bat`

## B. Data compatibility (V2 data inside V3.1)

Compare 10 random items between V2 and V3.1 side by side.

- [ ] Every user signs in to V3.1 with their V2 password; roles are the same
- [ ] Products: names, options/variations, prices, images, categories (V3.1 shows them under
      head **Product Type**)
- [ ] Stock In: quantities equal V2 for counted items; measured items show the same rolls / pieces and lengths
- [ ] Sales and purchases: same numbers, dates, parties, totals; PDF / print opens
- [ ] Customer and supplier lists, balances / credit, vendor prices
- [ ] Sale and purchase orders: same status; **shortage / backorder lines** shown on each sale order
- [ ] Held carts (drafts) open
- [ ] Product activity / history shows the V2 movements
- [ ] Warehouses are **off** (like V2) until an admin creates the first one

## C. Import — each sheet (Inventory → Import)

Download each **blank template**, fill 3–5 real rows, then: match columns → **Check** → read
every row → **Import**. Also put the filled sheets in `import-samples\` and run `TEST-V31.bat`
(checks only, nothing saved).

- [ ] **Products** sheet: new products appear with options, category, prices
- [ ] **Stock** sheet: counted quantities added; measured rows become rolls (length unit converted);
      a missing product is created when "Create missing products" is ticked
- [ ] **Purchases** sheet: one purchase per bill no.; stock goes up; supplier created if missing
- [ ] **Sales** sheet: one sale per bill no.; refused when free stock is short; customer created if missing
- [ ] Your own old Excel stock sheet (e.g. wire rope with "Godam"): column matching + "Warehouses
      not found" mapping work
- [ ] A row with an error is clearly marked and is skipped / stops its bill
- [ ] Undo check: cancel one imported sale and one imported purchase — stock goes back

## D. Backorder process (sale → purchase)

- [ ] Sale of a **counted** item with more than in stock → Save as Customer Order (Backorder)
- [ ] Sale of a **measured** length longer than any free roll → backorder offered and saved
- [ ] Sale of a **set** whose part is missing (e.g. chain length) → "Backorder <part>", order holds the set
- [ ] Sale order page → Shortage & Procurement Tracking lists the right item and quantity / length
- [ ] **Arrange purchase** → purchase cart filled, linked "For customer order SO/…" → Save as
      purchase order (counts as cover)
- [ ] Receive the purchase order → the sale order shows covered → **Complete** delivers
- [ ] Cancel paths: cancel the purchase order (shortage comes back), cancel the sale order (sets / stock freed)

## E. New V3.1 features (Demo first, then real copy)

- [ ] Grouped products (sets): create, opening sets, buy sets, sell sets with a part change, Build set in sale
- [ ] Warehouses (Demo): create W1/W2, purchase split, sale take-from, shift stock, Stock In filter
- [ ] Category heads: add head "Industry", tick categories on products and on single variations
- [ ] Vendor pricing in purchase: supplier rates cheapest first, tap to fill price
- [ ] Check Stock in sale and purchase drawers (simple, variable, measured, sets)

## F. Sign-off

- [ ] No wrong stock or money figure found — or every issue written below
- [ ] Owner decision: go live with V3.1 / fix first (list) / stay on V2

Issues found:

| # | Screen | What happened | Expected | Severity |
|---|---|---|---|---|
| 1 | | | | |
