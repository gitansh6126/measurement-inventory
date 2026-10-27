# Interactions, Business Rules & Implementation Workflow

**Prototype Location:** `v3/docs/ui-prototype/` (accessible via `docs/ui-prototype/`)  
**Context:** RS Machinery V3 (Standalone HTML/CSS/JS Prototype)

---

## 1. Interactive Elements & Behaviors

### 1.1 Navigation & Shell
| Element | User Interaction | Expected Prototype Behavior | Production Counterpart & Rules |
|---|---|---|---|
| **Sidebar Nav Links** | Click link item | Switches active screen view dynamically without page reloads; updates URL hash (`#products`, `#sales-new`). | Next.js App Router (`Link` & `usePathname`). |
| **Hover Sidebar** | Mouse hover on desktop (`>= 1024px`) | Expands sidebar width from `64px` to `240px` with 100ms delay, revealing text labels and section headers. | Pure CSS transition (`transition-[width]`). |
| **Mobile Hamburger** | Tap icon (`< 1024px`) | Slides in sidebar from left (`translate-x-0`) with dark backdrop overlay. | React state `menuOpen` in `app/(app)/layout.tsx`. |
| **Role Switcher** | Click "Switch Role" in env banner | Prompts to switch between `admin`, `sales_manager`, and `sales_staff`, updating header user pill and permissions. | `GET /api/auth/me` with session cookie. |

---

### 1.2 Products & Catalog
| Element | User Interaction | Expected Prototype Behavior | Business Rules & Production Validation |
|---|---|---|---|
| **View Toggle** | Click "Grid" or "Table" | Toggles between card view (`ShopLayout` with category rail) and grouped expandable table view. | Stored in `localStorage` & `user_preferences` (`products.view_mode`). |
| **Expand Chevron** | Click product row in table | Expands variation sub-table showing all variations, SKU codes, stock, and commercial prices. | Main v2 / V3 grouped product design; variation rows expand inline. |
| **Variation Drag & Drop** | Click & drag table variation row | HTML5 native drag-and-drop reorders variations within parent product and saves order. | `PATCH /api/products/variations/reorder`. |
| **Search Input** | Type query in search bar | Real-time filter across product name, base short name, and variation SKUs with clear button (`×`). | Trigram GIN index in Postgres (`gin_trgm_ops`). |
| **Quick Filter Chips** | Click "Low Stock" / "Out of Stock" | Filters products containing variations at or below threshold. | Low stock rule: `stock <= lowStockThreshold && stock > 0`; Out of stock: `stock <= 0`. |
| **Add Product Button** | Click "+ Add Product" | Opens 4-Step VariationBuilder modal (Define Attributes -> Data -> Generate SKUs -> Pricing & Stock). | Enforces unique `shortName` (BR-04), non-empty attribute names, and auto SKU composition. |
| **Adjust Stock** | Click "Adjust" on row | Opens modal to add or reduce stock with reason. Immediately updates in-memory count and logs toast. | `POST /api/inventory/adjust`. Cannot make stock negative via adjustment (adjustments require `quantity > 0` and stock on hand checks). |

---

### 1.3 Stock In / Bulk Inventory
| Element | User Interaction | Expected Prototype Behavior | Business Rules & Production Validation |
|---|---|---|---|
| **New Stock Input** | Change numeric value in table cell | Calculates and renders live delta badge (e.g. `+50`, `−10`). Stored in pending edits. | `POST /api/inventory/stock-in` (single atomic transaction). |
| **Price / Min Price Inputs** | Change price field | Stores commercial pricing changes in pending edits. Whole rupee values only. | Enforced integer/paise rounding; prices omit `.00` trailing zeros. |
| **Save Stock In** | Click "Save Stock In" | Applies all pending changes to local state, clears edit buffer, and notifies user. | Commits stock movements as `OPENING` or `PURCHASE` / `ADJUSTMENT` with row locks. |
| **Reset Changes** | Click "Reset Changes" | Discards uncommitted pending edits and reverts table values to initial state. | Client-side buffer reset. |

---

### 1.4 Sales & Checkout
| Element | User Interaction | Expected Prototype Behavior | Business Rules & Production Validation |
|---|---|---|---|
| **Select / Add to Cart** | Click product card in `/sales/new` | Opens `ProductDrawer` with variation picker, quantity input, unit price, and discount. | Validates variation active status. Pre-fills selling price. |
| **Cart Pill** | Floating button at bottom right | Shows live item count and subtotal; clicking slides out `CartSidebar` drawer. | Synchronized with cart state. |
| **Customer Select** | Click "Select Customer" | Opens `PartySelectionDrawer` to choose Walk-in or regular customer with credit score. | Customer is required before checkout. |
| **Shortage Detection** | Add item where `qty > stock` | Displays red warning banner explaining negative stock under the Warn & Allow policy. | Fixed company policy: `WARN_AND_ALLOW`. Allows sale to proceed with audit record. |
| **Complete Sale** | Click "Complete Sale" in checkout | Generates `SAL/2026-27/XXXX` invoice, deducts stock, clears cart, and navigates to printable invoice. | Atomic fiscal year counter, `StockMovement` creation, append-only ledger commit. |
| **Save as Order** | Click "Save as Order" in checkout | Creates `SO/2026-27/XXXX` in `PLACED` status with expected date. Does not deduct stock. | `POST /api/orders` (orders never move stock until fulfilled). |
| **Hold Cart** | Click "Hold Cart" in checkout | Prompts for title and parks cart as draft. Clears active cart. | Saved to `draft_orders` table; can be resumed later. |

---

### 1.5 Orders & Fulfillment
| Element | User Interaction | Expected Prototype Behavior | Business Rules & Production Validation |
|---|---|---|---|
| **Order Status Filter** | Click tab (`Open`, `Placed`, etc.) | Filters orders list by status. | Order statuses: `DRAFT`, `PLACED`, `ON_DELIVERY`, `COMPLETED`, `CANCELLED`. |
| **Progress Order** | Click "Dispatch" / "Complete" | Advances order status along lifecycle and appends entry to timeline events. | `PATCH /api/orders/:id/status`. Completing triggers fulfillment bill. |
| **Cancel Order** | Click "Cancel Order" | Prompts for cancellation reason and marks order `CANCELLED`. | Cannot cancel an already `COMPLETED` order. |

---

### 1.6 Invoices & Document Void
| Element | User Interaction | Expected Prototype Behavior | Business Rules & Production Validation |
|---|---|---|---|
| **Print Invoice** | Click "Print Invoice" | Triggers browser `window.print()` using CSS `@media print` layout. | Renders clean A4 tax invoice layout without shell elements. |
| **Cancel / Void Invoice** | Click "Cancel / Void" | Prompts for void reason, marks document `CANCELLED`, and reverses all deducted stock back into inventory. | `POST /api/sales/:id/void` writes `DocumentVoid` record and reversing `SALE_VOID` movements. |

---

## 2. Mock vs. Production Operations

| Operation | Prototype (Mock) Behavior | Production Implementation Requirement |
|---|---|---|
| **Data Persistence** | In-memory JavaScript `state` object initialized from `fixtures/sample-data.js`. State persists for the browser session. | Persistent PostgreSQL 18 database accessed via Prisma ORM. |
| **Document Numbering** | `SAL/2026-27/` + timestamp slice. | Atomic SQL sequence per financial year (`DocumentCounter` table with row lock). |
| **Authentication** | Local role switcher updating `currentUser` object. | Secure HttpOnly session cookie, HMAC session verification, bcrypt password hashes. |
| **Image Uploads** | Displays SVG/text placeholder icons. | File upload to disk storage (`/api/images/:id`) with SHA-256 deduplication and square crop. |
| **CSV / JSON Export** | Generates dynamic client-side `Blob` download. | Server-side stream generation or client-side batch cursor export. |

---

## 3. Approved Implementation Workflow

When you are ready to modify the production application based on this prototype:

```
+-------------------------------------------------------------+
| Step 1: User edits and approves HTML / CSS / JS prototype   |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Step 2: Compare edited prototype against production Next.js |
|         components and Tailwind styles                      |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Step 3: Identify exact production files to update           |
|         (referencing SCREEN-MAP.md)                         |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Step 4: Implement visual / layout changes in Next.js / React|
|         preserving API contracts, validations & business    |
|         rules                                               |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Step 5: Run test suites (npm test, typecheck, integration)  |
|         and verify zero regressions                         |
+-------------------------------------------------------------+
```
