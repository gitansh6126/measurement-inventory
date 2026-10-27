# Screen-to-Production Architecture Mapping

**Prototype Location:** `v3/docs/ui-prototype/` (accessible via `docs/ui-prototype/`)  
**Production Source Target:** `v3/app/web` (Next.js 15) & `v3/app/api` (Express 5 + Prisma)

This document establishes the exact mapping between each prototype screen/workflow and the corresponding production routes, React components, backend controllers, and database models.

---

## 1. Inventory & Products Domain

### 1.1 Products Catalog (`/products`)
| Prototype Screen | Production Route | Production Frontend Files | Backend API Routes | Database Models |
|---|---|---|---|---|
| **Products List & Catalog** | `/products` | `app/(app)/products/page.tsx`<br>`components/catalog/ShopLayout.tsx`<br>`components/catalog/CategoryRail.tsx`<br>`components/catalog/ViewToggle.tsx`<br>`components/ColumnsMenu.tsx` | `GET /api/inventory?status=all`<br>`GET /api/categories?stats=1`<br>`PATCH /api/products/variations/reorder` | `ProductGroup`<br>`ProductVariation`<br>`Category`<br>`StockBalance` |
| **Product Detail Modal** | Modal dialog | `components/products/ProductDetailModal.tsx`<br>`components/products/ProductDetailView.tsx` | `GET /api/products/:id`<br>`GET /api/products/:id/activity` | `ProductGroup`<br>`ProductVariation`<br>`StockMovement`<br>`AuditEvent` |
| **Product Form & 4-Step Builder** | Modal / Drawer | `components/products/ProductModal.tsx`<br>`components/products/ProductForm.tsx`<br>`components/products/VariationBuilder.tsx` | `POST /api/products`<br>`PATCH /api/products/:id` | `ProductGroup`<br>`ProductVariation`<br>`Category` |
| **Stock Adjust Modal** | Modal dialog | `components/products/StockAdjustModal.tsx` | `POST /api/inventory/adjust` | `StockMovement`<br>`StockBalance` |
| **Vendor Pricing Modal** | Modal dialog | `components/vendor/VendorPricingModal.tsx` | `GET /api/vendor-prices?variationId=`<br>`POST /api/vendor-prices` | `VendorPrice`<br>`VendorPriceHistory` |

**Differences / Notes:**
- **Prototype:** Simulates all four steps of the `VariationBuilder` (Define Attributes -> Data & Abbr -> Auto-generate SKUs -> Pricing/Stock) in-memory with live table rendering.
- **Production:** Validates unique `shortName` against company scope in Postgres; enforces optimistic concurrency using integer `version` field.

---

### 1.2 Categories (`/products/categories`)
| Prototype Screen | Production Route | Production Frontend Files | Backend API Routes | Database Models |
|---|---|---|---|---|
| **Category List & Detail** | `/products/categories`<br>`/products/categories/[id]` | `app/(app)/products/categories/page.tsx`<br>`app/(app)/products/categories/[id]/page.tsx`<br>`components/products/CategoryModal.tsx` | `GET /api/categories`<br>`POST /api/categories`<br>`PATCH /api/categories/:id` | `Category`<br>`ProductGroup` |

**Differences / Notes:**
- **Prototype:** Instant state toggling and inline rename prompt.
- **Production:** Verifies case-insensitive category name uniqueness per company.

---

### 1.3 Stock In / Inventory Bulk Updater (`/inventory`)
| Prototype Screen | Production Route | Production Frontend Files | Backend API Routes | Database Models |
|---|---|---|---|---|
| **Stock In Table & Bulk Save** | `/inventory` | `app/(app)/inventory/page.tsx`<br>`components/products/StockEditDrawer.tsx`<br>`components/measure/MeasuredStock.tsx`<br>`components/measure/RollActions.tsx` | `GET /api/inventory?state=&q=&categoryId=`<br>`POST /api/inventory/stock-in` | `StockBalance`<br>`StockMovement`<br>`ProductVariation`<br>`MeasurementPiece` |

**Differences / Notes:**
- **Prototype:** Inline table inputs compute live delta badges (`+20`, `−5`) and commit updates in one batch across the in-memory array.
- **Production:** Executes a single PostgreSQL transaction with row locks, preventing negative oversells and recording append-only `StockMovement` rows with audit triggers.

---

### 1.4 Image Studio & Cropper (`/image-editor`)
| Prototype Screen | Production Route | Production Frontend Files | Backend API Routes | Database Models |
|---|---|---|---|---|
| **Image Studio & Cropper** | _(removed — no standalone page)_ | `components/products/ImageEditorModal.tsx`<br>`components/products/ImageCropper.tsx`<br>`lib/cropImage.ts` | `POST /api/images` | Local Storage / Static Images |

**Differences / Notes:**
- **Prototype:** Interactive HTML5 Canvas cropper supporting drag/pan, zoom out down to 0.2x with automatic pure white background padding (`#ffffff`), 90° rotation, live preview, JPEG download, and one-click assign to catalog product.
- **Production:** The standalone `/image-editor` page was removed (2026-10-20). Cropping lives only in `ImageEditorModal.tsx` (opened from product images, variations and categories), utilizing `react-easy-crop` with `minZoom={0.2}`, `restrictPosition={false}`, white container backing, and canvas destination-offset drawing in `cropImage.ts` ensuring clean JPEG uploads with white background padding to `/api/images`.

---

## 2. Sales Domain

### 2.1 New Sale (`/sales/new`)
| Prototype Screen | Production Route | Production Frontend Files | Backend API Routes | Database Models |
|---|---|---|---|---|
| **Sale Transaction Builder** | `/sales/new` | `app/(app)/sales/new/page.tsx`<br>`components/TransactionBuilder.tsx`<br>`components/PartySelectionDrawer.tsx`<br>`components/ProductBrowser.tsx`<br>`components/ProductDrawer.tsx`<br>`components/CartPill.tsx`<br>`components/CartSidebar.tsx` | `GET /api/catalog`<br>`GET /api/parties?role=customer`<br>`GET /api/inventory/products/:id` | `Party`<br>`ProductGroup`<br>`ProductVariation`<br>`StockBalance` |

**Differences / Notes:**
- **Prototype:** Bottom drawer allows selecting variation, quantity, unit rate, and flat discount, immediately reflecting in the floating `CartPill` and slide-out `CartSidebar`.
- **Production:** Uses Next.js React Context (`CartContext.tsx`) and persists temporary carts in localStorage/server drafts (`draft_orders`).

---

### 2.2 Sales Checkout (`/sales/checkout`)
| Prototype Screen | Production Route | Production Frontend Files | Backend API Routes | Database Models |
|---|---|---|---|---|
| **Checkout & Settlement** | `/sales/checkout` | `app/(app)/sales/checkout/page.tsx`<br>`components/Checkout.tsx`<br>`components/CreditScoreBadge.tsx` | `POST /api/sales`<br>`POST /api/orders`<br>`POST /api/drafts` | `Sale`<br>`SaleLine`<br>`StockMovement`<br>`Order`<br>`DraftOrder` |

**Differences / Notes:**
- **Prototype:** Performs client-side shortage detection and displays the Warn & Allow warning banner. Allows "Complete Sale" (creates invoice + decrements stock), "Save as Order" (creates SO), and "Hold Cart" (saves draft).
- **Production:** Enforces client-generated idempotency key (`clientRef`), computes atomic financial numbering (`SAL/2026-27/0001`), and writes append-only ledger movements.

---

### 2.3 Sale Orders (`/sales/orders` & `/sales/orders/[id]`)
| Prototype Screen | Production Route | Production Frontend Files | Backend API Routes | Database Models |
|---|---|---|---|---|
| **Sale Orders Management** | `/sales/orders`<br>`/sales/orders/[id]` | `app/(app)/sales/orders/page.tsx`<br>`app/(app)/sales/orders/[id]/page.tsx`<br>`components/orders/OrderList.tsx`<br>`components/orders/OrderView.tsx` | `GET /api/orders?kind=SALE`<br>`GET /api/orders/:id`<br>`PATCH /api/orders/:id/status`<br>`POST /api/orders/:id/deliver` | `Order`<br>`OrderLine`<br>`OrderEvent`<br>`Sale` |

**Differences / Notes:**
- **Prototype:** Status advancement stepper (Draft -> Placed -> On Delivery -> Completed) and order cancellation with audit note.
- **Production:** Tracks physical piece allocation, delivery address, transporter notes, and partial order fulfillment linking back to `Sale` documents.

---

### 2.4 Sale History & Invoices (`/sales` & `/sales/[id]`)
| Prototype Screen | Production Route | Production Frontend Files | Backend API Routes | Database Models |
|---|---|---|---|---|
| **Sale History & Detail** | `/sales`<br>`/sales/[id]` | `app/(app)/sales/page.tsx`<br>`app/(app)/sales/[id]/page.tsx`<br>`components/DocumentHistory.tsx`<br>`components/DocumentView.tsx` | `GET /api/sales`<br>`GET /api/sales/:id`<br>`POST /api/sales/:id/void` | `Sale`<br>`SaleLine`<br>`DocumentVoid`<br>`StockMovement` |

**Differences / Notes:**
- **Prototype:** Renders an A4-proportioned printable invoice, historical snapshot attributes, payment status, and void cancellation with stock rollback.
- **Production:** Generates server-side PDF and enforces append-only void records via `document_voids`.

---

## 3. Purchases Domain

### 3.1 Purchases Suite
| Prototype Screen | Production Route | Production Frontend Files | Backend API Routes | Database Models |
|---|---|---|---|---|
| **New Purchase** | `/purchases/new` | `components/TransactionBuilder.tsx`<br>`components/ProductBrowser.tsx` | `GET /api/catalog`<br>`GET /api/vendor-prices` | `Party`<br>`ProductGroup` |
| **Purchase Checkout** | `/purchases/checkout` | `components/Checkout.tsx` | `POST /api/purchases`<br>`POST /api/orders` | `Purchase`<br>`PurchaseLine`<br>`StockMovement` |
| **Purchase Orders** | `/purchases/orders`<br>`/purchases/orders/[id]` | `components/orders/OrderList.tsx`<br>`components/orders/OrderView.tsx` | `GET /api/orders?kind=PURCHASE`<br>`PATCH /api/orders/:id/status` | `Order`<br>`OrderLine` |
| **Purchase History** | `/purchases`<br>`/purchases/[id]` | `components/DocumentHistory.tsx`<br>`components/DocumentView.tsx` | `GET /api/purchases`<br>`GET /api/purchases/:id` | `Purchase`<br>`PurchaseLine` |
| **Supplier Prices** | `/supplier-prices` | `app/(app)/supplier-prices/page.tsx`<br>`components/vendor/VendorPricingModal.tsx` | `GET /api/vendor-prices`<br>`POST /api/vendor-prices` | `VendorPrice`<br>`VendorPriceHistory` |

---

## 4. Directory & Administration

| Prototype Screen | Production Route | Production Frontend Files | Backend API Routes | Database Models |
|---|---|---|---|---|
| **Customers Directory** | `/customers` | `components/PartyList.tsx`<br>`components/PartyProfile.tsx` | `GET /api/parties?role=customer`<br>`POST /api/parties` | `Party` |
| **Suppliers Directory** | `/suppliers` | `components/PartyList.tsx`<br>`components/PartyProfile.tsx` | `GET /api/parties?role=supplier`<br>`POST /api/parties` | `Party` |
| **Users Management** | `/users` | `app/(app)/users/page.tsx`<br>`components/ChangePasswordModal.tsx` | `GET /api/users`<br>`POST /api/users`<br>`PATCH /api/users/:id` | `User` |
| **Backup & Restore** | `/backup` | `app/(app)/backup/page.tsx` | `GET /api/backup/export`<br>`POST /api/backup/restore` | All models |
| **Company Settings** | `/settings` | `app/(app)/settings/page.tsx` | `GET /api/company/settings` | `Company` |
| **Glossary** | `/glossary` | `app/(app)/glossary/page.tsx` | Static UI (no backend endpoint) | — |
| **Login Screen** | `/login` | `app/login/page.tsx` | `POST /api/auth/login`<br>`POST /api/auth/logout` | `Session`<br>`User` |
