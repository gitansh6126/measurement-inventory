# Customer booking prototype

Standalone HTML prototype of a customer-facing app whose only job is **booking** products.
Open `index.html` in a browser (no build, no server needed; bookings are saved in the browser's localStorage).

Goal: customers can explore the catalog and every variation easily.

- Shop: search (also matches option values such as `M16`, `6x24`, `2 ton`), category chips with counts,
  "In stock only" filter, price sort; cards list every option value of variable products.
- Product page: option buttons plus an **All N options** table (price and stock per variation; tap a row
  to pick it, "+ Add" books 1 straight away).
- Booking list -> booking form (name, mobile, pickup or delivery, date, note; no payment) -> confirmation.
- My bookings: status steps Requested -> Confirmed -> Ready, cancel while Requested
  (a "Demo:" link simulates the shop advancing the status).

Out of scope here: grouped (set) products and measured (sold by length) products, payments, accounts.
Data mirrors `app/api/src/lib/demo-seed.ts` (Demo Company) plus a few extra simple/variable items.
