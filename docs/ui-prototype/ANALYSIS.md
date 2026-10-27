# Architecture & Screen Inventory Analysis (RS Inventory V3)

**Date:** 2026-10-19  
**Repository Workspace:** `d:\client works\rs new`  
**Active Application Baseline:** `v3/app` (inherited from V2 baseline, V3-specific DB/package configurations)

---

## 1. Executive Summary & Repository Status

### 1.1 Git Status & Workspace Boundaries
- **Workspace Boundary:** `d:\client works\rs new` is the shared workspace root.
- **Git Status:** Inspected prior to any modifications. Working tree contains pre-existing uncommitted work in `v2/`, `v3/`, and reference folders. All existing changes have been strictly preserved.
- **Prototype Location:** `v3/docs/ui-prototype/` (linked at `docs/ui-prototype/` via directory junction for seamless accessibility from root or app contexts). Production application code in `v3/app/` remains untouched.

### 1.2 Verification Commands & Results
- **Unit Tests:** `npm test` executed in `v3/app` -> **123 passed** across 11 test files (0 failures).
  - `variation-parity.test.ts`: 31 tests passed
  - `piece-id.test.ts`: 19 tests passed
  - `env.test.ts`: 12 tests passed
  - `stock.test.ts`: 5 tests passed
  - `format-attributes.test.ts`: 9 tests passed
  - `product-activity.test.ts`: 4 tests passed
  - `products.test.ts`: 13 tests passed
  - `documents.test.ts`: 4 tests passed
  - `measure.test.ts`: 16 tests passed
  - `permissions.test.ts`: 5 tests passed
  - `numbering.test.ts`: 5 tests passed
- **Typecheck:** `npm run typecheck` executed in `v3/app` -> **0 errors** across `@rs-v3/api` and `@rs-v3/web`.

---

## 2. Technology Stack & Design System

### 2.1 Backend (`v3/app/api`)
- **Runtime & Framework:** Node.js `>=22`, Express 5, `tsx watch`.
- **Database ORM:** Prisma 6.19.3 with PostgreSQL 18.
- **Authentication:** HttpOnly cookie-based server session tokens, hashed in `sessions` table; PBKDF2/bcrypt password hashing.
- **Shared Code:** `@rs-v3/shared` handles variation combination key generation, short name composition (`autoShortName`), SKU formatting, and measurement unit conversions.

### 2.2 Frontend (`v3/app/web`)
- **Framework:** Next.js 15 (App Router), React 19, TypeScript 5.9.3.
- **Styling:** Tailwind CSS 3 + Vanilla CSS layer (`globals.css`).
- **Design Tokens (Marble 2110 System):**
  - **Brand Palette:** Orange primary `#ea580c` (`brand-600`), `#c2410c` (`brand-700`), `#fff7ed` (`brand-50`).
  - **Neutral / Slate:** `#0f172a` (slate-900), `#1e293b` (slate-800), `#334155` (slate-700), `#64748b` (slate-500), `#e2e8f0` (slate-200), `#f8fafc` (slate-50).
  - **Accent Tones:** Emerald (Active / Paid), Amber (Min-Active / Partial), Rose (Danger / Low / Out / Cancelled), Sky (Info), Violet (Never Sold).
  - **Layout Shell:** Collapsible icon sidebar (64px wide on desktop expanding to 240px on hover/focus), sticky topbar (36px height) with IST date and user account pill, environment banner (28px height).
  - **Typography:** System font stack (`system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`).
  - **Component Library:** `components/ui.tsx` (PageHeader, StatStrip, StatCell, Toolbar, SearchInput, Segmented, PeriodFilter, Pagination, Avatar, EmptyState, Modal, Switch, Menu, TableSkeleton, DeliveryDatePicker).

---

## 3. Core Data Models & Relationships

| Model | Table | Purpose & Key Fields |
|---|---|---|
| **Company** | `companies` | Business boundary entity; stores company name and `negativeStockPolicy` (`WARN_AND_ALLOW`). |
| **User** | `users` | Staff credentials; `role` (`admin`, `sales_manager`, `sales_staff`), `email`, `active`. |
| **Category** | `categories` | Product classification with image and sorting order. |
| **ProductGroup** | `product_groups` | Product catalog header; `productType` (`simple`, `variable`, `measured`), `baseShortName`, `unit`, `attributeDefinitions`, `gallery`, `lengthUnit`, `rollName`, `scrapBelow`. |
| **ProductVariation** | `product_variations` | The actual sellable SKU; `shortName`, `officialSku`, `attributes` JSON, `salePrice`, `minSalePrice`, `purchaseCost`, `lowStockThreshold`, `sortOrder`. |
| **StockBalance** | `stock_balances` | Maintained running balance = SUM(movements); quantity signed decimal. |
| **StockMovement** | `stock_movements` | Append-only ledger; `movementType` (`OPENING`, `PURCHASE`, `SALE`, `ADJUSTMENT`, `SALE_VOID`, `PURCHASE_VOID`), `quantity`, `unit`, `rate`, `reason`. |
| **MeasurementPiece** | `measurement_pieces` | Physical roll / cut tracking for measured goods; `kind` (`CLOSED`, `OPEN`, `CUT`), `status` (`ACTIVE`, `USED_UP`), `remainingLength`, `pieceNumber`. |
| **Party** | `parties` | Customers and suppliers; `type` (`CUSTOMER`, `SUPPLIER`, `BOTH`), `name`, `phone`, `email`, `address`, `creditScore`. |
| **Sale** | `sales` | Sale invoice; `number` (`SAL/2026-27/0001`), `subtotal`, `total`, `paymentMode`, `paymentStatus`, `amountPaid`, `clientRef`, `revision`. |
| **SaleLine** | `sale_lines` | Invoice item with historical snapshot of product name, short name, and attributes. |
| **Purchase** | `purchases` | Purchase bill; `number` (`PUR/2026-27/0001`), `subtotal`, `total`, `lines`. |
| **Order** | `orders` | Sale or Purchase order before fulfillment; `kind` (`SALE`, `PURCHASE`), `status` (`DRAFT`, `PLACED`, `ON_DELIVERY`, `PARTIALLY_FULFILLED`, `COMPLETED`, `CANCELLED`), `expectedDate`, `deliveryAddress`. |
| **VendorPrice** | `vendor_prices` | Supplier rate cards; variation, supplier, agreed unit rate. |
| **DraftOrder** | `draft_orders` | Parked/held cart; line items in JSON, does not affect stock. |

---

## 4. Screen Inventory & Workflow Map

### Screen 1: Products (`/products`)
- **Route:** `/products` | **File:** `app/(app)/products/page.tsx`
- **Views:**
  - **Grid View (`ShopLayout`):** Product cards with category rail, thumbnail, stock badge, price range.
  - **Table View:** Grouped table with expandable variation sub-rows, drag-and-drop variation reordering.
- **KPI Strip:** Total Products, Total Variations, In Stock, Low Stock, Out of Stock, Inventory Valuation.
- **Toolbar:** Search bar, Category selector, Sales Activity filter (`Active`, `Min-Active`, `Inactive`, `Never Sold`), Quick chips (`All`, `Low`, `Out`), Columns selector, Export CSV/PDF.
- **Modals:**
  - `ProductDetailModal`: Overview, variation list, and chronological Action Log.
  - `ProductModal`: Add/Edit product (Simple, Variable, Measured) with 4-Step `VariationBuilder`.
  - `StockAdjustModal`: Quick manual stock adjustments (+ / -) with reason.
  - `VendorPricingModal`: View and configure supplier rate cards.

### Screen 2: Categories (`/products/categories`)
- **Route:** `/products/categories` | **File:** `app/(app)/products/categories/page.tsx`
- **Features:** Category grid and table list, active product count, sort order, Add/Edit Category modal.

### Screen 3: Stock In / Inventory Status (`/inventory`)
- **Route:** `/inventory` | **File:** `app/(app)/inventory/page.tsx`
- **Features:**
  - Bulk stock in updating new stock levels, selling prices, min selling prices, and reorder thresholds in a single atomic transaction.
  - Stage filters: `All`, `Low`, `Out`, `Negative`.
  - Pre-defined reason dropdown: `Stock Received`, `Opening Stock`, `Manual Count`, `Return to Stock`, `Purchase Add`, `Correction`, `Other`.
  - Inline change indicators (e.g. `+20`, `−5`).
  - Measured stock roll entry (`AddRollsModal`, `MeasuredStockPanel`).

### Screen 4: New Sale (`/sales/new`)
- **Route:** `/sales/new` | **Files:** `components/TransactionBuilder.tsx`, `components/ProductBrowser.tsx`, `components/PartySelectionDrawer.tsx`
- **Features:**
  - Mandatory party selection drawer (Walk-in vs Regular Customer search / creation) before browsing.
  - Product catalog browser with category tabs, search, stock badges, min/selling rates.
  - Bottom `ProductDrawer` with interactive attribute selector pills (Size, Brand, etc.), stock check, quantity, price, discount.
  - Floating `CartPill` indicating live item count and total.
  - Slide-out `CartSidebar` showing lines, unit prices, quantity increment/decrement, and checkout button.

### Screen 5: Sales Checkout (`/sales/checkout`)
- **Route:** `/sales/checkout` | **File:** `components/Checkout.tsx`
- **Features:**
  - Customer profile summary with credit score badge.
  - Detailed line items table (thumbnail, code, attributes, unit price, quantity, discount, line total, notes, edit button, remove button).
  - Shortage detection banner with explicit "Sell anyway" confirmation under Warn & Allow policy.
  - Payment details: Mode (`Cash`, `UPI`, `Bank transfer`, `Cheque`, `Credit`), Amount Paid, and Remaining Balance calculation.
  - Actions:
    - **Complete Sale:** Commits invoice and atomic stock deduction.
    - **Save as Order:** Creates a Sale Order (`DRAFT` or `PLACED`) with expected delivery date and address.
    - **Hold Cart:** Parks the transaction as a draft.

### Screen 6: Sale Orders (`/sales/orders`)
- **Route:** `/sales/orders` | **File:** `components/orders/OrderList.tsx`
- **Features:**
  - Tabs: `Open`, `Draft`, `Placed`, `On Delivery`, `Partially Fulfilled`, `Completed`, `Cancelled`, `All`.
  - One-click status advancement (e.g., Mark Placed, Dispatch, Complete).
  - Search by order number or customer name, date period filter.

### Screen 7: Sale Order Detail (`/sales/orders/[id]`)
- **Route:** `/sales/orders/[id]` | **File:** `components/orders/OrderView.tsx`
- **Features:**
  - Status progression stepper, order metadata, delivery address, timeline of events.
  - Line items breakdown with ordered vs fulfilled quantities and shortage status.
  - Actions: Fulfill / Create Delivery, Cancel Order (with reason), Edit Items (re-opens cart).

### Screen 8: Sale History (`/sales`)
- **Route:** `/sales` | **File:** `components/DocumentHistory.tsx`
- **Features:**
  - Invoices list with invoice number (`SAL/2026-27/0001`), date, customer, payment status pill (`Paid`, `Part Paid`, `Pending`), total amount.
  - Filters: Date period (Today, 7 days, This Month, FY, Custom), Status (`All`, `Completed`, `Cancelled`, `Replaced`).

### Screen 9: Sale Document Detail / Invoice (`/sales/[id]`)
- **Route:** `/sales/[id]` | **File:** `components/DocumentView.tsx`
- **Features:**
  - Printable A4 layout with company header, customer details, line items table with historical snapshots.
  - Subtotal, discounts, total, payment status.
  - Revisions history (if edited) and Void / Cancellation audit details.
  - Actions: Print, Edit Document (creates new revision), Cancel / Void (with reason).

### Screen 10: Purchases Suite (`/purchases`, `/purchases/new`, `/purchases/checkout`, `/purchases/orders`)
- **Routes:** `/purchases/...`
- **Features:** Mirrored supplier workflows:
  - New Purchase with supplier drawer.
  - Supplier Price suggestions displayed on product drawer and checkout lines.
  - Purchase Orders tracking goods received and supplier bills.
  - Purchase History with bill view and cancellation audit.

### Screen 11: Supplier Prices (`/supplier-prices`)
- **Route:** `/supplier-prices` | **File:** `app/(app)/supplier-prices/page.tsx`
- **Features:** Variation-by-supplier pricing matrix, history of price changes, Add/Edit rate modal.

### Screen 12: Customers & Suppliers (`/customers`, `/suppliers`, `/[id]`)
- **Routes:** `/customers`, `/suppliers` | **Files:** `components/PartyList.tsx`, `components/PartyProfile.tsx`
- **Features:**
  - Searchable directory of parties with credit scores, contact info, active toggle.
  - Add / Edit Party modal with name, phone, email, address, contact person.
  - Profile page with contact details and embedded document history table.

### Screen 13: Administration & Settings
- **Users (`/users`):** Admin user management (Admin, Sales Manager, Sales Staff), active toggles, reset password.
- **Backup & Restore (`/backup`):** Download JSON backup, restore point upload.
- **Settings (`/settings`):** Company profile, Negative stock policy documentation.
- **Glossary (`/glossary`):** Interactive inventory and trade dictionary with group filters.
- **Login (`/login`):** Authentication page with role quick-fill buttons and password reset flow.

---

## 5. Prototype Design Plan
The standalone prototype is constructed in `v3/docs/ui-prototype/` (accessible also via `docs/ui-prototype/`) with:
1. `index.html`: Complete, structured markup for the entire application shell, navigation, page views, modals, drawers, toasts, and popovers.
2. `styles.css`: High-fidelity vanilla CSS implementing Marble 2110 design tokens, responsive breakpoints, tables, animations, and print view.
3. `fixtures/sample-data.js`: Rich, realistic machinery domain fixtures (Wire ropes, bearings, pulleys, belts, rolls, parties, orders, sales).
4. `app.js`: Modular vanilla JS handling state, routing, dynamic table rendering, cart operations, checkout calculations, dialogs, and drawer toggles.
5. `README.md`, `SCREEN-MAP.md`, and `INTERACTIONS.md`: Full handoff specifications.
