# Mobile UI/UX pass using RMS Tech as a reference (2026-10-27)

Task brief: `docs\TASK-2026-10-28-UI-UX-RMSTECH-REFERENCE.md`. The owner started it on 2026-10-27 with
"more focus for mobile". Reference material: 14 phone screenshots in `D:\client works\rs new\rms.tech\`
(WhatsApp images, 10:37–10:38 pm). There are no recordings or notes.

Branch: `feature/variation-builder-merged-data` (left uncommitted; it already had other people's uncommitted work).

## 1. Audit: RS Inventory web (`app\web\`)

- **Stack:** Next.js 15 App Router, React 19, Tailwind 3, TanStack Query. No component library: shared
  pieces are in `components\ui.tsx` and `components\icons.tsx`, and global classes (`.btn-*`, `.card`,
  `.input`, `.table`) are in `app\globals.css`. Brand colour is orange (`brand-*` in `tailwind.config.js`).
  Bottom-sheet keyframes already existed (`sheet-in/out`), and `motion-reduce:` is used throughout.
- **Shell:** `app\(app)\layout.tsx`. On desktop there's an icon sidebar that widens on hover (lg+).
  Below lg the sidebar slides in from a hamburger in a 36 px top bar. A floating dark cart pill
  (`CartPill.tsx`) sits bottom-right.
- **Sale flow:** `/sales/new` (`TransactionBuilder` → `ProductBrowser`), then `ShopLayout` + `CategoryRail`
  (category rail on the left, card grid on the right). Tapping a card opens the `ProductDrawer` bottom
  sheet (options, quantity stepper, price, guide chips), then `/sales/checkout` (`Checkout.tsx`).
  `ShopLayout` / `CategoryRail` are also used by `/products` and `/inventory`.
- **Tests:** API unit and integration tests only (`app\api\tests`). The web app has no tests;
  `npm run typecheck` is the web check.

### Mobile problems found (375 × 812, demo data)

1. **Horizontal overflow on New Sale:** the page was 395 px wide on a 375 px screen. Product cards,
   the sort select and the stock chips were cut off at the right edge. Cause: plain CSS grid
   columns (`grid` with an implicit `auto` column) grow to their children's minimum width.
2. The category rail took about 84 px of the 375 px width, so product cards were about 126 px wide.
3. No quick navigation: every move went through the hamburger menu. The cart pill covered content
   in the bottom-right corner.
4. The checkout total and Complete Sale were only at the very end of a long page.
5. In the sale drawer the quantity, price and total were far apart. The subtotal had no working
   shown, and the stepper buttons were 40 px.

## 2. Reference analysis (RMS Tech, com.rmstech.app)

Everything below is observed in the screenshots unless marked *assumed*.

| Screen (files) | Observed |
|---|---|
| Categories (`10.39.16 PM (2)`, `(3)`) | Full-width cards, each with a 48 px thumbnail, a name and a round chevron. Tapping expands it as an accordion of sub-categories (thumbnail, left accent bar, → button). The open card gets a blue border and a filled chevron. Bottom tab bar: Home, Categories, Cart, History. The active tab is a pill with an icon and label; inactive tabs show only the icon. |
| Product grid (`10.39.17 PM`) | Back + "All Products" + search icon. Underlined section headings per sub-category. 3-column cards with an image and a 2-line name (truncated with an ellipsis). No price on the card. |
| Product details (`10.39.12 PM (1)`, `14 PM`, `15 PM`, `16 PM`, `16 PM (1)`) | Image card and price card. "Select options" with "3-Level Variant Matched". Each attribute row shows its label on the left and the chosen value on the right in brand colour; values are chips, filled when selected. Quantity stepper with a unit (Mtr/Pcs), "Minimum order: N", "Estimated Total ₹22,200" and "₹7.40 × 3000" underneath. Fixed bottom bar: View Cart (outline) + Add to Cart (filled). The cart icon in the header has a count badge. The minus button is disabled at the minimum quantity. |
| Product update dialog (`15 PM (2)`) | Centered modal with a truck icon, a "Select products to proceed" checkbox card (warehouse, expected date, expected price, "On the Way" pill), a "View message" disclosure, and Cancel / Continue. The Add to Cart button shows a spinner behind the modal. |
| Cart (`12 PM`, `14 PM (1)`, `15 PM (1)`) | Title, "N items", "+ Add More" pill. Line cards: image, name, variant, "GST: 18% Extra" chip, "Read Details ›", red delete square, stepper, Unit Price, Amount. Promo code accordion with an empty state ("No offers available"). A sticky footer has "Grand Total ▾ ₹…" that expands to Net / GST / Grand, plus a full-width "Order Process" button. |
| Drawer (`17 PM (1)`, `18 PM`) | Left drawer with a profile header, a category list with thumbnails and ›, and a Logout row in red. |

Not established by the evidence: transitions and animation timing, loading skeletons, error states,
and the tablet/desktop layout. *Assumed:* the accordion expands in place, and the drawer is a slide-in.

## 3. Comparison

Effort: S under 1 h, M up to half a day, L more than that. Risk is regression risk.

| # | RS Inventory now | RMS Tech reference | Problem / opportunity | Proposed improvement | Benefit | Effort | Risk | Evidence / confidence |
|---|---|---|---|---|---|---|---|---|
| 1 | New Sale wider than a phone; cards and filters cut off | Content always fits the width | Bug: hidden controls, sideways scrolling | `minmax(0,1fr)` columns in `ShopLayout` | Everything visible and tappable | S | Low | Measured 395 → 375 px · high |
| 2 | Vertical category rail eats ~84 px | Categories are a full-width list / separate screen | Narrow cards, cramped prices | Phones: sticky horizontal category strip; rail kept on sm+ | Wider cards, one-thumb category switch | S | Low | Screens 16 PM (2)/(3) · high |
| 3 | Hamburger only; floating pill over content | 4-tab bottom bar, cart badge | Extra taps for frequent moves | Bottom tab bar (Products, New Sale, Cart + badge, Orders, Menu) below lg; pill desktop-only | 1 tap to main areas, no covered content | M | Low–med | All tab screens · high |
| 4 | Total + Complete Sale only at page end | Sticky Grand Total + Order Process | Scroll to finish; total not visible while editing | Sticky total/action bar above the tab bar (below lg) | Total always visible, faster completion | S | Low | 12 PM, 15 PM (1) · high |
| 5 | Drawer subtotal without working; 40 px stepper | Estimated total + "₹7.40 × 3000"; large stepper | Hard to sanity-check a line | Line total + "price × qty"; 44 px stepper; grab handle | Fewer pricing mistakes | S | Low | 12 PM (1), 16 PM (1) · high |
| 6 | Price field empty ("0") until a guide chip is tapped | Price shown and used immediately | One extra tap per line | **Rejected by owner 2026-10-28:** keep the price empty so staff choose it each line | — | — | — | 15 PM · medium |
| 7 | Attribute chips without a "chosen value" summary | Label left, chosen value right | Choice not obvious on long option lists | Show the chosen value beside each attribute label | Clarity | S | Low | 12 PM (1) · high |
| 8 | Checkout lines: amount and price stacked | Unit Price / Amount columns on the line card | Scanning many lines | Two labelled columns on the line card | Faster review | M | Low–med (Checkout is busy) | 12 PM · high |
| 9 | Products page on phones: many toolbar buttons before data | Minimal header, search icon | Data starts below the first screen | Collapse KPI/table controls into a "View" menu on phones | Data visible sooner | M | Med | Screenshot of `/products` · medium |
| 10 | Top bar crowded on phones (unit toggle, user, role, logout) | Clean title header | Visual noise | Hide role and move Logout into the menu on phones | Clarity | S | Low | — · medium |
| — | (not recommended) Promo codes, points, "Read details" shop pages | Present in RMS | Shopping patterns, not inventory work | Do not copy | — | — | — | — |

## 4. Plan (grouped)

- **Quick visual:** 1, 5 (done); 7, 10.
- **Component-level:** 5 (done); 8.
- **Navigation / workflow:** 3, 4 (done); 6 declined by the owner (price stays empty).
- **Responsive layout:** 1, 2 (done); 9.
- **Animation / interaction:** keep the existing sheet animation (already reduced-motion aware).
  The new pieces use colour transitions only. No new animation was added.

**Business logic check before coding:** none of the implemented items touch inventory calculations,
stock movements, cart contents, pricing, authentication, persistence or API contracts. They are
layout/CSS changes, plus a display-only line total (`subtotal` was already computed). Item 6 *would*
change pricing behaviour, so it is not implemented and is left for the owner to decide.

## 5. Implemented (this pass)

| File | Change | Why |
|---|---|---|
| `app\web\components\catalog\ShopLayout.tsx` | `minmax(0,1fr)` columns; on phones the rail sits in a sticky strip under the top bar | Fix overflow (#1), full-width cards (#2) |
| `app\web\components\catalog\CategoryRail.tsx` | Horizontal swipe row with snap on phones, vertical from sm | #2 |
| `app\web\components\ProductBrowser.tsx` | Toolbar: search full width, then sort and stock chips (the chips no longer overlap the select) | #1 |
| `app\web\components\BottomNav.tsx` (new) | Tab bar below lg: Products, New Sale, Cart (count badge, amber when a line is short), Orders, Menu. Respects permissions, `aria-current`, safe-area inset, `no-print` | #3 |
| `app\web\app\(app)\layout.tsx` | Renders `BottomNav`; Menu opens/closes the existing sidebar | #3 |
| `app\web\components\CartPill.tsx` | Pill shown on lg+ only (phones use the Cart tab) | #3 |
| `app\web\app\(app)\supplier-prices\page.tsx` | Floating "Save all" bar lifted above the tab bar below lg | Avoid overlap with #3 |
| `app\web\components\ProductDrawer.tsx` | Grab handle (phones), footer with "Line total / ₹x × qty" and a 44 px Add button, 44 px stepper, safe-area padding | #5 |
| `app\web\components\Checkout.tsx` | Total + actions sticky above the tab bar below lg; Save as order + Complete Sale on one row; desktop unchanged (`lg:static`) | #4 |

Also changed, outside the repo: `D:\client works\rs new\.claude\launch.json` now has `uiux-api` (4520)
and `uiux-web` (3520, `.next-uiux`) dev configs.

## 6. Verification

- `npx tsc --noEmit` in `app\web`: no errors.
- `npm test` in `app` (API unit tests): 15 files, 147 tests passed. No API code was changed.
- Browser, demo data (`rs_v31_demo`), 375 × 812:
  - `/sales/new`, `/products`, `/inventory` and `/sales/checkout` all have `scrollWidth` = 375 (was 395 on New Sale).
  - Category strip scrolls and stays sticky.
  - Drawer: picked options, price chip and quantity 2 → footer "Line total ₹19,000 · ₹9,500 × 2".
  - Add to cart → Cart tab badge shows 1.
  - Checkout bar pinned above the tab bar.
  - Menu tab opens the sidebar.
  - No console errors.
  - The test cart line was cleared afterwards.
- Desktop (1024 wide): vertical rail, cart pill and sidebar as before; tab bar hidden (`display: none`).

## 7. Known limitations and open items

- Not committed, on purpose: the branch already holds other uncommitted work in `Checkout.tsx`,
  `ProductDrawer`-adjacent files and the API. Commit these files separately, or together with that
  work, once the owner has reviewed them.
- Real devices were not tested (only emulated). iOS safe-area insets were not seen on a device.
- The Next.js dev indicator (bottom-left, dev only) overlaps the first tab in dev mode.
- Purchase-side screens get the same layout fixes. The tab bar's New Sale / Orders tabs are
  sale-oriented; purchase users reach their screens through Menu.
- Items 7–10 in the table are not done. Item 6 (pre-filled selling price) was declined by the owner on
  2026-10-28: the drawer price stays empty until staff pick or type it. Do not reopen it.
- Category accordion / sub-category screens (RMS) were not adopted: RS has a flat category list.

## 8. Sticky mini product bar (2026-10-28)

Owner request: on the single product page, keep the product name visible while scrolling, like the
RMS Tech product details (`rms.tech\10.39.16 PM` / `16 PM (1)`: on scroll the image shrinks to a
thumbnail beside a compact name + price card).

- File: `measurement-inventory\app\web\components\products\ProductDetailView.tsx` (used by
  `/products/[id]` and `/inventory/[id]`).
- Once the hero price row scrolls under the app header (IntersectionObserver, 64 px offset), a
  compact bar pins at `top-16`: 40 px thumbnail, product name (one line, ellipsis), chosen option
  and short name (or "Select options"), price, and an "Options ↑" / "Top ↑" button that scrolls back
  to the option buttons. sm+: price and stock badge on the right plus "Manage stock" (when allowed).
  Phones: the price moves under the name so the name keeps the full width.
- The bar sits in an `h-0` sticky wrapper, so the page does not jump when it appears; hidden in print.
- Checks: `npx tsc --noEmit` in `app\web` clean. Preview (`uiux-web`, demo DB) on Chain Hoist at
  375×812 and 1280×800: bar hidden at top, shown after scroll with the picked option, "Options ↑"
  returns to top and hides it.
- Cart product sheet (`measurement-inventorypp\web\components\ProductDrawer.tsx`, opened from
  New Sale / New Purchase / cart edit): its header was already pinned; now it shrinks once the form
  scrolls (64 → 40 px thumbnail, "Add sale" label hidden, one-line truncated name, option + stock
  badge on the second line) and grows back at the top. It only compacts when the form overflows by
  more than 72 px, so short forms cannot flicker. Verified at 375×640 on Chain Hoist (2 ton / 5).
  `components\cart\ProductOptionsPage.tsx` is not imported anywhere (dead code), so it was left alone.
  Measured products use `MeasuredDrawer` and are unchanged.
- Seed: no change needed; every demo product shows the bar.
