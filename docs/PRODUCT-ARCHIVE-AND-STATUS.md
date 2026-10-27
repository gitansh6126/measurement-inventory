# Products: archive and automatic stock status (V3.1, as built)

Written 2026-10-24 from the code (owner question: "how archive product works and auto status of
products"). Line references are to `D:\client works\rs new\v3.1\app\`.

## 1. Archive

| Question | Answer (V3.1) | Code |
|---|---|---|
| Who can archive / restore? | **Admin only** (`product.archive`). Managers can edit products but not archive them. | `api\src\lib\permissions.ts`, `routes\products.ts` PATCH `/:id` |
| What is archived? | The **product** (all its variations), or one **variation** of a Variable / Measured product. A Simple product has one variation: archive the product. The **last active variation** cannot be archived — archive the product instead (`LAST_VARIATION`). | `routes\products.ts` PATCH `/:id/variations/:variationId` |
| Grouped products (sets) | Archiving a grouped product archives its main component with it; the main component cannot be archived on its own (`MAIN_FOLLOWS_SET`). By-products are normal products and stay as they are. | `routes\products.ts` |
| Is anything deleted? | **No.** Archive sets `active = false`. Stock, rolls, sets, sales, purchases, orders, vendor prices and history all stay. Restore sets it back; audit events `PRODUCT_ARCHIVE` / `PRODUCT_RESTORE` / `VARIATION_ARCHIVE` / `VARIATION_RESTORE`. | |
| Where does it disappear? | Sale / purchase product selection (catalog cards), new sale / purchase / order lines (`INACTIVE_ITEM` "… is archived"), import rows ("… is archived"). | `lib\documents.ts:241`, `lib\orders.ts:232`, `lib\import.ts` |
| Where can it still be seen? | The **Products** page lists active and archived together (like main v2): archived = faded with an **Inactive** badge, filter All / Active / Inactive; archived variations are faded inside the product. Old documents and orders show it unchanged; backups and exports include it. | `webpp\(app)\products\page.tsx` (`/inventory?status=all`) |
| Stock of an archived product | Kept and still counted in its product's roll-up. Archive does **not** move, zero or value-off the stock — sell or adjust it first if it should be gone. | |
| Product roll-up with archived variations | Quantity, low-stock threshold and value use **active variations only**; when every variation is archived the archived ones are used. | `lib\inventory-query.ts` (CASE … `bool_or(vs.active)`) |

## 2. Automatic stock status

Nobody sets a product's status by hand: every screen computes it from stock at the moment it is
shown, with one rule (`api\src\lib\stock.ts` `stockState`):

| Status | Rule | Shown as |
|---|---|---|
| **Negative** | quantity < 0 (an allowed oversell, V2 §1.8) | red "Negative" |
| **Out of stock** | quantity = 0 | "Out" |
| **Low stock** | 0 < quantity ≤ the variation's **low-stock threshold** ("Minimum stock", default 0, set per variation on the product form) | amber "Low" |
| **In stock** | quantity > threshold | normal |

- A **product** card / row uses the roll-up: total quantity of active variations against the
  **lowest** threshold among them, and also counts how many variations are low / out / negative
  ("2 variations low"). Stock In tabs, catalog rail counts and product cards read the same SQL, so
  they always agree (`lib\catalog.ts`).
- **Measured** products: quantity = total free length in the product's unit (cut pieces + open and
  sealed rolls), same rule against the threshold.
- **Grouped** products: quantity = number of complete **sets** in stock; parts fitted in sets are
  not free stock of their own products ("In sets").
- **Warehouses on:** the status follows the warehouse filter (stock of that warehouse); the
  company total is used when "All warehouses" is chosen.
- The status changes **immediately** after any sale, purchase, adjustment, import, shift or
  cancellation — there is no job or nightly update.

## 3. What does NOT happen automatically (candidates for V3.2, see V3.2-BACKLOG.md)

- No auto-archive when stock reaches 0 or a product is unused for N months.
- No "reorder" status from sale orders waiting on stock (backorders are shown on the order, not on
  the product card).
- No alert / notification when an item turns Low or Negative.
- Archive does not warn when the product still has stock, open orders or held sets.
