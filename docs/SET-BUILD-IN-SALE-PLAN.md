# V3.1 — Sell a set by choosing what the customer wants ("Build set")

Date: 2026-10-23 · Status: **BUILT 2026-10-23** — owner approved all recommended answers (§6); build notes in `v3.1\HANDOFF.md` ("Build set in the sale"). Tie-break added while building: fewest changes, then fewest chain cuts, then oldest.
Folder: `D:\client works\rs new\v3.1\app\`
Builds on: `v3.1\docs\GROUPED-PRODUCTS-V3-PLAN.md` (D1–D24, phase 3 sale with part changes).

## 1. What the owner asked

In a sale of a grouped product (e.g. Chain Hoist Set), the seller should not have to scroll
through sets. Like a Measured product (type the length → the system makes the cut plan), the
seller **chooses the contents the customer wants**; the system then decides:

1. **A set with exactly that combination is in stock** → use it.
2. **None is** → make it on the spot: take the best set in stock and change its parts (the
   existing D10 change logic), cutting / taking the new parts from free stock automatically.
3. **It cannot be made** → say exactly what is missing.

## 2. Today (built in phase 3)

- `web\components\sets\SaleSetsModal.tsx` lists every IN_STOCK set; the seller ticks sets and,
  per set, uses Change / Add / Remove by hand (variation, length, piece).
- Saving the sale runs `prepareSaleSets` / `sellSets` (`api\src\lib\sets.ts`): locks the sets,
  releases old parts (a chain back as the same Cut piece, D13), cuts / takes new parts from free
  stock in the set's warehouse (GW-2), sells everything. Price follows D12.
- So **all stock logic already exists**. What is missing is the *decision*: which set to use and
  which changes to make. That is what this plan adds.

## 3. New flow — "Build set" tab (default) in the sale set drawer

```
Sell sets · Chain Hoist Set                       [ Build set ] [ Pick sets ]
Hoist (main)          always included
Load Chain (req.)     Size: (6 mm) (8 mm) (10 mm)      Length: [ 3 ] m
Safety Hook (opt.)    ( none ) (1 Ton) (2 Ton)
Quantity  [ 2 ]

Result
 ✓ 1 set in stock matches exactly                       ₹ 8,500
 ✎ 1 set made on the spot from a set with 6 mm 3 m:
     Load Chain 6 mm 3 m → 8 mm 3 m (cut from a cut piece, 5.2 m left)
     6 mm 3 m goes back to free stock as a cut piece      ₹ 8,920
                                     [ Other set… ]
Total 2 sets  ₹ 17,420                         [ Add 2 sets to sale ]
```

- Option chips per by-product use the same attribute pills as variable products (only active
  variations). Measured by-products get a length field (any unit, like the Measured drawer).
  Optional by-products have a "none" chip. Main component is fixed (D3).
- The result updates live as options change (like the measured cut plan).
- **Pick sets** tab = today's screen, unchanged, for sellers who want a particular set.

### 3.1 Decision logic (shared pure function `planSets`, browser preview + tests)

Input: wanted contents (per by-product: variation + length, or none), quantity, sets in stock
(take-from warehouse when warehousing is on), free pieces / free counted stock, other cart lines.

1. **Exact matches**: IN_STOCK sets whose fitted parts equal the wanted contents (same variation
   per by-product, same length to the milli, same optional parts fitted). Oldest first (FIFO).
2. For each set still needed, **candidate donors** = remaining IN_STOCK sets. For each, the
   changes needed: REPLACE where variation or length differs, ADD where an optional part is
   wanted but not fitted, REMOVE where fitted but not wanted (optional only).
3. A donor is **feasible** if every new part can come from free stock in the set's warehouse:
   measured → a free piece long enough (Cut → Open → Closed, smallest first — same rule as
   `prepareSaleSets` / `planCuts`); counted → free quantity ≥ 1. Stock used by earlier sets in
   this plan and by other cart lines is deducted first, so two sets never count on the same piece.
4. Choose the donor with **fewest changes**, then **lowest repriced difference**, then oldest.
5. Price per set = D12 repricing (set price − old part + new part), as today.
6. If fewer than the quantity can be made: show "Only N of M possible" with the reason per part
   ("no free 8 mm piece of 3 m", "no Safety Hook 2 Ton free", "no sets in stock").

The seller can open **Other set…** to choose a different donor (list of feasible donors with their
changes), or the Pick sets tab to do it by hand.

### 3.4 Two-step flow (owner, 2026-10-23 — replaces the Build set / Pick sets tabs)

1. **Choose combination** — left: the option chips, chain length (unit dropdown) and quantity;
   right: **set combinations in stock** (sets grouped by their parts, with count and warehouse
   counts). Tapping a combination fills the form; the one matching the form is marked Ready.
   Footer: "N ready in stock · M to create". Next.
2. **Confirm** — Ready sets (exact combination) are used first, shown as one green card. Only
   for sets still missing is a **"Not ready — create"** card shown per set (from which set, the
   changes, bundle cards, price, Other set…). Button: "Add to sale", or "Create N and add to sale".
   "Only N of M possible: reason" when stock runs out. Back keeps the choice.

The manual Change / Add / Remove per set is gone (the planner makes the changes). Checkout
"Edit sets" reopens step 1 with the line's combination filled in (its first set after its changes).

### 3.3 Owner additions (2026-10-23, after the chat mockup)

- **Length unit dropdown** next to the chain length: m, cm, mm, ft, in, ft + in (same units as
  the Measured drawer, `lib\measure.ts` display units); the typed length is converted to the
  product's base unit and shown ("= 0.91 m").
- **Bundle choice like Measured**: every chain change shows the free bundles of the new size as
  cards — Cut piece / Open roll / Sealed roll, length left, "leaves X m", too-short ones greyed.
  The plan pre-selects the first that fits (Cut → Open → Sealed, smallest first); the seller can
  tap another. The chosen bundle is sent as `pieceId`.
- **Pick sets tab uses the same choice**: the options and length at the top apply to both tabs.
  Each set in stock shows a status against them:
  - **Ready** — the set already has exactly that combination;
  - **Needs change** — ticking it shows the changes (chain swap with bundle cards, hook add /
    remove) and the repriced amount;
  - **Can't make** — with the reason (e.g. no free 2 Ton hook); cannot be ticked.

### 3.2 Saving — no new server path

"Add to sale" produces the same cart line as today: `saleSets: [{ setId, version, changes[] }]`
with explicit `pieceId`s from the plan. The sale save (`prepareSaleSets` → `sellSets`) re-checks
everything under locks; if stock changed meanwhile it returns 409 and the cart asks to re-plan
(same as the measured cut plan). Nothing in stock moves before the sale is saved.

## 4. Files

| Area | File | Change |
|---|---|---|
| Shared | `v3.1\app\shared\src\sets.ts` (new) + export | `planSets()` pure function and types (wanted contents, donor, changes, problems). |
| Web | `v3.1\app\web\components\sets\SaleSetsModal.tsx` | Tabs Build set / Pick sets; Build set form + live result + Other set…; reuse `priceOf`, `summaryOf`, `detailOf`, confirm. Possibly split into `SetBuilder.tsx`. |
| Web | `components\ProductBrowser.tsx`, `components\Checkout.tsx` | none / pass existing props (modal keeps its interface). |
| API | `v3.1\app\api\src\lib\sets.ts` | optional: server endpoint not needed; `prepareSaleSets` unchanged. |
| Tests | `v3.1\app\shared` unit tests for `planSets`; `api\tests\integration\grouped.test.ts` one case: sale with a planned donor + changes saves and stock matches. |
| Docs | this file; `GROUPED-PRODUCTS-V3-PLAN.md` §5 note; `HANDOFF.md`; propagation log `15-...md`. |

Test cases for `planSets`: exact match used first (FIFO); no exact → fewest changes donor;
length-only difference = REPLACE; optional add / remove; required never removed; two sets in one
plan don't share a piece; other cart lines' stock deducted; warehouse respected; infeasible →
problems listed; quantity larger than possible → partial with reason.

## 5. Not in this plan (stays as decided)

- **Building a set from loose stock** is not possible: the main component exists only inside
  sets (D4). With no set in stock, Build set says "No sets in stock — buy or add opening sets".
- Purchase set sheet unchanged (sets are still created only by purchase / opening, D8, D20).
- Shortening a fitted chain in place: not done (D13); a different length = REPLACE.

## 6. Decisions for the owner (recommended first)

1. **Length match**: exact length only; a different length is a chain change (old chain back
   as a cut piece). *Alt*: accept a fitted chain that is longer.
2. **No exact set**: system picks the donor automatically and shows the changes; seller can
   choose another. *Alt*: system only lists donors, seller chooses every time.
3. **Where**: sale cart **and** sale orders (same drawer; orders hold the set and apply the
   changes on delivery, D23). *Alt*: sale cart only.
4. **Default tab**: Build set opens first; Pick sets stays as a second tab.
5. **V2 change made by mistake earlier today** (v2 variable products: pick any option
   combination, create the variation on the spot; files `v2\app\api\src\routes\inventory.ts`,
   `v2\app\web\components\ProductDrawer.tsx`, `v2\app\api\tests\integration\combination.test.ts`,
   `v2\docs\variation-on-the-spot\`): **remove it** and its propagation-log row. *Alt*: keep it.
