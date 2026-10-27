# V3 — order edit after delivery (deferred from V2)

Decided 2026-10-16 (owner): V2 stops after steps 1–2 of
`D:\client works\rs new\v2\docs\orders\ORDER-EDIT-AFTER-DELIVERY-PLAN.md` to stay small and
production-ready. The remaining work is V3 scope. Read the V2 plan first; this list only says what
is left and what V2 already does.

## What V2 already does (inherit, do not rebuild)
- Migration `0027_order_document_lines`: every sale / purchase line made from an order records its
  `order_line_id`; backfilled for old data; backup / restore keeps the links.
- `v2\app\api\src\lib\order-sync.ts`: `syncOrderFromDocuments` — an order's delivered quantities,
  status and document link are recalculated from its live documents; `lockOrderOfDocument` (lock
  order row before the document).
- Fulfilment (partial or full) uses the sync.
- Cancelling a delivery / receipt puts stock back (or takes it back out) and **reopens the order**
  (owner answer Q2), with an order event.
- Editing a delivery keeps it linked to its order, but in V2 only price, discount, note, party,
  date and payment may change. Items and quantities are locked: `ORDER_QTY_LOCKED`, "cancel this
  document and deliver again from the order".

## V3 changes to make
1. **Quantity edits on a delivery (plan step 3).** Remove the `ORDER_QTY_LOCKED` guard
   (`assertSameOrderQuantities` in `lib\documents.ts`, used by `editDocument` and
   `previewEditDocument`) and replace it with the order-aware edit:
   - body field `orderMode: "CLOSE" | "KEEP_OPEN"` when a delivered quantity goes down. Owner answer
     **Q1: ask on each edit, "Close the order" preselected**. CLOSE lowers the ordered quantity to
     the delivered one (order stays Completed); KEEP_OPEN leaves the difference to deliver
     (Partially fulfilled);
   - delivering more than ordered raises the ordered quantity (with its price) so
     `fulfilled ≤ quantity` (0026 check) holds — `syncOrderFromDocuments` already reports
     `overDelivered`;
   - an item added in the edit that is not on the order creates a new order line;
   - recompute `orders.subtotal` / `line_count`; order event with the diff; `/edit/preview`
     returns an `order` section (status and lines before → after).
   Stock keeps moving only through the document edit (sale: reverse then re-sell; purchase:
   receive then reverse → `STOCK_ALREADY_USED` if sold).
2. **Edit the undelivered part of a partly delivered order (plan step 4).** `updateOrder` updates
   lines in place by id (never delete a line a document points to — 0027 FK is RESTRICT), new
   quantity ≥ delivered (`BELOW_DELIVERED`); price changes affect only the undelivered part.
3. **Order page actions (plan step 5).** In `OrderView` Deliveries card: "Edit delivery" (opens the
   cart edit mode with an order banner) and "Cancel delivery" per live document; Ordered /
   Delivered / To go / Returned columns; review modal shows stock effect (+ back / − out), order
   status before → after and the Q1 choice. `DocumentView`: "From order SO/…" link and a warning
   that the order will be updated.
4. **Measured items.** Document edit of measured lines is still blocked (`MEASURED_NOT_EDITABLE`);
   when measured edit (document-edit phase 2) arrives, the order follow-up must re-plan cuts with the
   original pieces.
5. **Open owner questions** (V2 plan §10): Q3 edit a delivery whose order was later cancelled
   (default: allowed, order untouched); Q4 edit window (default: none).
6. **Known gaps to fix while there:**
   - backup restore does not carry order-line `pieceId`, `rolls`, `linkedOrder*` or the order
     `version` (pre-existing);
   - `prisma migrate diff` reports constraint-name drift from 0024 / 0026 (pre-existing);
   - `latestLiveDocument` orders by `createdAt`, which is the business date (back-dated documents
     sort early) — order by id or a real insert timestamp.
7. **GST (V3 core):** once invoices are GST documents, a quantity or price change after invoicing is
   a credit / debit note, not a replace-edit. Decide this before item 1.

## Tests to add in V3
V2 plan §8 items 1–3, 5–7, 9, 11 (items 4, 8, 10 already pass in V2:
`v2\app\api\tests\integration\orders.test.ts`, `backup-v2.test.ts`).
