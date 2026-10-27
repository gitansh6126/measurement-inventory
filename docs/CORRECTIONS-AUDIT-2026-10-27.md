# Corrections audit: undo, void, edit and delete (2026-10-27)

Objective: list every place a daily mistake can be corrected today, for all 4 product types
(Simple, Variable, Measured, Grouped), for product setup and for sale and purchase, and say where
a correction option is missing.

Scope: inspection only. No code was changed.

Sources read:
- `D:\client works\rs new\measurement-inventory\app\api\src\routes\products.ts`
- `D:\client works\rs new\measurement-inventory\app\api\src\lib\products.ts` (`assertAttributeEditSafe`, body schemas)
- `D:\client works\rs new\measurement-inventory\app\api\src\lib\documents.ts` (void, edit, edit preview)
- `D:\client works\rs new\measurement-inventory\app\api\src\lib\measure.ts` (rolls, cut, write-off, correct)
- `D:\client works\rs new\measurement-inventory\app\api\src\lib\sets.ts` (opening sets, set cancel)
- `D:\client works\rs new\measurement-inventory\app\api\src\routes\inventory.ts` (adjustments, stock-in)
- `D:\client works\rs new\measurement-inventory\app\api\src\lib\permissions.ts`
- `D:\client works\rs new\measurement-inventory\app\web\components\products\VariationBuilder.tsx`, `DocumentView.tsx`

## 1. How corrections work today

The app never deletes business records. There are three ways to correct a mistake:

| Way | Where it exists | Who can do it |
|---|---|---|
| Archive / Restore (hide, can bring back) | Product, Variation, Category, Party, Warehouse | Product and variation: admin only |
| Cancel (void) with a reason; stock is reversed | Sale, Purchase, Stock transfer, Opening set, Order | admin, sales_manager |
| Edit as a new revision (`-R1`, `-R2`; old one is marked replaced) | Sale and Purchase with Simple / Variable items only | admin, sales_manager |
| Correction entry | Stock adjustment (any qty), roll length correction, roll write-off | admin, sales_manager |

Old bills keep their own copy of product name, short name, SKU and attributes
(`SaleLine.productNameSnapshot` and friends), so renaming a product never changes a printed bill.
This makes a rename or attribute-rename safe to add.

## 2. Product setup: what you can and cannot fix

### 2.1 Matrix

| Field / action | Simple | Variable | Measured | Grouped (set) |
|---|---|---|---|---|
| Product name, description, unit, images, categories | Edit | Edit | Edit (unit follows length unit) | Edit |
| Short Name / Official SKU | Edit on product | Edit per variation | Edit per variation | Edit on product |
| Base short name | Follows Short Name | Edit | Edit | Follows Short Name |
| **Attribute name** (e.g. "Colur" → "Colour") | n/a | **Locked once any variation exists** | **Locked once any variation exists** | n/a |
| **Attribute value** (e.g. "Redd" → "Red") | n/a | **Cannot rename.** Add new value: yes. Remove a used value: refused (`VALUE_IN_USE`) | Same as Variable | n/a |
| Variation's own combination (it was saved as Red/10mm, should be Blue/10mm) | n/a | **No option** | **No option** | n/a |
| Add variations | n/a (exactly one) | Yes | Yes | n/a |
| Reorder variations | n/a | Yes | Yes | n/a |
| Archive variation | Archive the product instead | Yes, admin, not the last active one | Yes, admin | n/a |
| Length unit (m ↔ ft/in) | n/a | n/a | Only while the product has no stock history | n/a |
| Roll name, default roll length | n/a | n/a | Edit | n/a |
| Set definition (which by-products) | n/a | n/a | n/a | Edit (`PUT /sets/definition/:id`) |
| **Change product type** (made Simple, should be Variable) | **No option** | **No option** | **No option** | **No option** |
| **Delete product made by mistake** (never used) | **No option, archive only** | **No option** | **No option** | **No option** |
| **Delete variation made by mistake** (never used) | n/a | **No option, archive only** | **No option** | n/a |
| Archive / Restore product | admin | admin | admin | admin (main component follows) |

### 2.2 Gaps in product setup

P1. **Rename an attribute name or value (typo fix).** Today one wrong spelling in an attribute
forces archiving every variation and creating them again. Archived duplicates then clutter search,
reports and vendor prices. Proposed: "Rename" next to each attribute name and value in
`VariationBuilder.tsx`. Server rewrites `attributeDefinitions`, every variation's `attributes`
JSON and `attributeKey` in one transaction, refuses if the new name collides, and offers to
regenerate Short Names that were auto-generated. Old bills are safe (snapshots). Audit entry
`ATTRIBUTE_RENAME`.

P2. **Delete a product or variation that was never used.** "Never used" = no stock movement, no
sale, purchase, order or draft line, no vendor price, no set or set part, not a by-product of a
set. Then a real delete is harmless and keeps lists clean. Anything used keeps "Archive" as today.
The button should explain why it is disabled ("Used in 3 sales — archive instead").

P3. **Change a variation's combination while unused.** Same "never used" rule; lets you fix a
variation saved with the wrong value without archive + re-add.

P4. **Change product type while unused** (Simple ↔ Variable mainly; Measured and Grouped carry
extra setup, so allow only into/out of them when the product has no stock history at all).
Lower value than P1–P3 because P2 (delete and recreate) covers it.

P5. **Archive by sales_manager** (optional). Archive is admin-only. If the shop manager makes most
daily product mistakes, consider a separate permission. Owner's decision.

## 3. Sale and purchase: what you can and cannot fix

### 3.1 Matrix

| Action | Simple | Variable | Measured | Grouped (set) |
|---|---|---|---|---|
| **Sale: cancel (void)** | Yes, stock comes back | Yes | Yes, cut lengths go back to their pieces | Yes, sets come back with parts they were sold with |
| **Sale: edit (revision)** | Yes: items, qty, price, discount, note, party, payment, date in same FY | Yes | **No** — "cancel and re-enter" | **No** — "cancel and re-enter" |
| Sale from an order: edit | Price, discount, note, payment only; qty locked | Same | No | No |
| **Purchase: cancel (void)** | Yes, refused if that stock is already sold | Yes, same rule | Yes, refused once any roll was opened, cut or sold | Yes, refused once any set was changed, held or sold |
| **Purchase: edit (revision)** | Yes; reducing qty refused if already sold | Yes | **No** | **No** |
| Change financial year of a bill | No (cancel and re-enter) | No | No | No |
| Draft (unsaved cart) | Discard | Discard | Discard | Discard |
| "Cancel and re-enter" helper (re-open the cancelled bill pre-filled) | **No** | **No** | **No** | **No** |

### 3.2 Gaps in sale and purchase

S1. **Header-only edit for Measured and Grouped bills.** Today any bill with even one Measured or
Grouped line cannot be edited at all — not even a wrong price, discount, note, customer or
payment. These changes do not touch stock, rolls or sets, so they are safe. Proposed: allow edit
when every line keeps the same item, quantity, piece / roll / set choice; refuse only when stock
lines change. This removes most "cancel and re-enter" cases. Highest value item in this audit.

S2. **"Cancel and re-enter" in one step.** When an edit is not allowed, `DocumentView.tsx` shows
an `alert()` telling the user to cancel and re-enter. Proposed: a button that cancels with a
reason and opens Checkout pre-filled with the same party, lines, prices and note, so the user
only fixes the mistake. Works for all 4 types (Measured and Grouped re-pick rolls / sets).

S3. **Explain why a purchase cannot be cancelled.** `STOCK_ALREADY_USED` says stock was used but
not by which sale. Show the sale numbers (and roll / set codes) that used it, so the user can
cancel those first or decide to use a return / adjustment instead.

S4. **Edit Measured / Grouped bill lines (full edit).** Changing cut length, roll or set on a saved
bill is the hard part (pieces are cut, sets have part changes). Recommend not building this;
S1 + S2 cover daily mistakes.

S5. **Sale return / purchase return (partial).** Not present. Today a customer returning 2 of 10
pieces needs a full cancel and re-enter. This is new scope (credit note / debit note), not a
correction — list it for the owner, do not build under "undo".

## 4. Stock corrections outside bills

| Action | Simple / Variable | Measured | Grouped |
|---|---|---|---|
| Opening stock | Once per item per warehouse; fix with an adjustment | Add rolls | Add opening sets |
| Adjustment / Stock In | Yes, any time (new correcting entry) | Refused, use rolls | Refused, use sets |
| **Undo a wrong adjustment** | **No direct undo**, enter the opposite adjustment by hand | n/a | n/a |
| **Remove a roll added by mistake** | n/a | **No option**; only length correction (cannot exceed original) or write-off (counts as loss) | n/a |
| Undo a cut (not from a sale) | n/a | **No option** | n/a |
| Cancel opening set | n/a | n/a | Yes (`cancel-opening`), only while in stock |
| Stock transfer | Cancel | Cancel | Cancel |

Gaps:

K1. **"Reverse" button on a stock adjustment / Stock In row**, posting the exact opposite entry
with reason "Reversal of …", allowed while the stock is still there. Simple and fast.

K2. **Cancel a roll added by mistake** (opening roll / added roll), same rule as
`cancelOpeningSet`: only while still sealed and untouched. Today write-off is the only option and
it shows up as loss.

K3. **Undo last cut** of a roll when the cut piece is untouched (optional, lower value).

## 5. Recommended build order

| # | Item | Types affected | Effort | Risk |
|---|---|---|---|---|
| 1 | S1 Header-only edit for Measured / Grouped bills | Measured, Grouped | M | Low |
| 2 | P1 Rename attribute name and value | Variable, Measured | M | Low (bills snapshot) |
| 3 | P2 Delete never-used product / variation | All 4 | S–M | Low with the "never used" check |
| 4 | S2 Cancel and re-enter in one step | All 4 | M | Low |
| 5 | K2 Cancel roll added by mistake | Measured | S | Low |
| 6 | K1 Reverse a stock adjustment | Simple, Variable | S | Low |
| 7 | S3 Show what blocks a purchase cancel | All 4 | S | None |
| 8 | P3 Edit unused variation combination | Variable, Measured | S | Low |
| later | P4 change type, K3 undo cut, S4 full measured/set edit, S5 returns | — | L | Higher / new scope |

Every new correction should keep the current rules: reason required, audit entry with before /
after, permission check, and version lock (`lockVersion`) like the existing edits.

## 6. Cross-version note

Inspection only; no code changed, so no entry in
`D:\client works\rs new\references for final inven\AI_CONTEXT\15-cross-version-change-propagation.md`
yet. When an item above is built in `measurement-inventory` (V3.2+), log it there and check
`standardapp\` for the same gap.

## 7. Build status

First batch built 2026-10-27 (owner approved S1, P1, P2):

- **S1** Header edit of Measured / grouped bills. "Edit" on such a bill opens
  `app\web\components\DocumentHeaderEdit.tsx` (prices, discounts, line notes, party, notes,
  payment). Server: `editDocument` in `app\api\src\lib\documents.ts` (header mode,
  `moveStockToRevision`). Changing items or quantities still means cancel and re-enter.
- **P1** Rename attribute name or value: `POST /api/products/:id/attributes/rename`
  (`app\api\src\lib\product-corrections.ts`); "Fix mistakes" card on the product edit page
  (`app\web\components\products\ProductCorrections.tsx`).
- **P2** Delete never-used product / variation: `GET /api/products/:id/usage`,
  `DELETE /api/products/:id`, `DELETE /api/products/:id/variations/:variationId` (admin and
  sales manager); same card.

Known limits: on a header edit, set part movements keep their old rate (history only); the edit
preview endpoint compares lines by item, so two lines of one Measured item show as one.
Tests: `app\api\tests\integration\corrections.test.ts` (7); full integration suite 220/220 on the
no-reset config. Not yet checked in the browser.

Next candidates from section 5: S2 (cancel and re-enter in one step), K2, K1, S3, P3.
