# Measured products: sale cancel rule, per-bundle history, header unit — and partial returns (later)

Owner requests 2026-10-24. Folder: `D:\client works\rs new\v3.1\`.

## 1. Built now

### Sale cancel (void) rule for measured lines

Implemented in `D:\client works\rs new\v3.1\app\api\src\lib\measure.ts` → `restoreSaleCuts`.
Each SALE ledger row of the cancelled sale is handled on its own:

| What the sale took | What comes back on cancel |
|---|---|
| The whole bundle or cut piece (nothing was left on it) | That same bundle / cut piece, with its length. A roll that this sale opened (it was sealed before) becomes **Sealed** again (`kind = CLOSED`, `openedAt` cleared; ledger reason ends with `(sealed again)`). |
| Only part of a bundle or cut piece | A **new Cut piece** with the returned length, `parentId` = the piece it was cut from, notes `Returned by void of <sale>`. The bundle keeps its reduced length. |
| A whole piece that cannot take it back (moved to another warehouse since) | A new Cut piece, as above. |

Applies the same way when the sale came from a completed sale order (cancelling the delivery).

"Opened by this sale" = the roll's `openedAt` is no earlier than 2 s before the sale row was
created, and no other ledger row ever opened it (Open, a cut, or another sale).

### Grouped products (sets) with a measured by-product

`D:\client works\rs new\v3.1\app\api\src\lib\sets.ts` → `restoreSaleSets(…, releaseSetIds)`.
The cancel dialog (`D:\client works\rs new\v3.1\app\web\components\DocumentView.tsx`) lists every sold
set that has a measured part and asks per set:

- **Keep set together** (default): the set returns In stock with its measured piece fitted.
- **Release as cut piece**: the measured piece returns to normal stock as a free Cut piece
  (ledger `SET_RELEASE`), the set part is `RELEASED`, and the set returns without it (needs a
  part refitted at its next sale).

API: `POST /api/sales/:id/void { reason, releaseSetIds?: string[] }`. The sale view's
`lines[].sets[].measuredParts` tells the dialog which sets qualify.

### Stock history per bundle

`GET /api/measure/products/:id/bundles?status=active|used_up|all&variationId=&page=&pageSize=`
(`D:\client works\rs new\v3.1\app\api\src\routes\measure.ts`). Web:
`D:\client works\rs new\v3.1\app\web\components\measure\BundleHistory.tsx`, opened from the product
page → Stock history → "By roll" tab (the old movement table stays on "Stock movements").
Each bundle card: state chip, code, variation, warehouse, received / opened, purchase / supplier,
used bar, where the length went (sold / cut / returned / written off / corrected), a timeline of
every event with the Sealed / Open / Cut state before → after, and its cut pieces nested under it
with their own timelines.

### Length unit in the top header

`D:\client works\rs new\v3.1\app\web\components\measure\LengthUnitPicker.tsx` in the app header;
store + formatter in `D:\client works\rs new\v3.1\app\web\lib\measure.ts` (`fmtLen`,
`useDisplayUnit`, localStorage key `measure.displayUnit`). Options: Product unit, m, cm, mm, ft,
in, ft + in. Display only: typing (LengthField), the Settings preview, stored values, printed
documents and PDFs keep each product's own unit.

## 2. Deferred: partial return of a sale (owner: "move to later")

Owner's case: a bundle or cut piece is sold, and later **only part of it** (e.g. half) is
returned by the customer. The returned part must come back as a **new Cut piece**.

Why it is not built yet: V3.1 has no sales return today. A sale can only be cancelled as a
whole, and measured / grouped lines cannot be edited (`editDocument` refuses with
`MEASURED_NOT_EDITABLE` / `SETS_NOT_EDITABLE`).

Suggested design for the next agent (needs owner confirmation first):

1. New "Return items" action on a completed sale (permission like `sale.void`).
2. Pick lines and a returned quantity / length per line (≤ sold − already returned); for sets,
   pick whole sets and the same keep / release choice as cancel.
3. Stock: a `SALE_RETURN` movement type (or `SALE_VOID` with a return id) for the returned part
   only; measured length → a new Cut piece under the sold piece (always, even if the whole length
   is returned? — confirm with owner; the cancel rule returns a whole piece as itself).
4. Money: a return / credit record (credit note number series, amount = returned qty × line
   rate after discount), party balance and payment status updated. This touches invoices and
   payments, so check scope before building.
5. The sale stays Completed with "Part returned" shown; the bundle history shows the return.

Open questions for the owner: credit note numbering and printing; refund vs. party credit;
whether a returned whole piece should come back as itself or as a new cut piece; returns from
sale orders (reopen the order or not).

## Checks

See the register entry dated 2026-10-24 in
`D:\client works\rs new\references for final inven\AI_CONTEXT\15-cross-version-change-propagation.md`.
