# ARCHITECTURE FINDINGS & ACCIDENTAL COMPLEXITY AUDIT (REVISED)
**Project:** RS Machinery Inventory Management System  
**Audit Date:** 2026-10-29 (Revision 2 Post-Lifecycle Investigation)  
**Auditor:** Principal Software Architect & Senior Data Engineer  
**Scope:** Structural, Data Flow, and Concurrency Evaluation of `measurement-inventory/`  
**Location:** `measurement-inventory/docs/audit/ARCHITECTURE-FINDINGS.md`

---

## 1. Findings Summary & Ranking Matrix

| Finding ID | Title | Severity | Business Impact | Workflow Frequency | Integrity Risk | Refactor Value | Implementation Effort | Final Status |
|---|---|---|---|---|---|---|---|---|
| **AF-01** | Dual-Phase Coupling of Sale Commit to Dynamic Set Re-assembly | **High** | High | Rare Exception (<2%) | Medium | High | Medium | **Accepted (Modified)** |
| **AF-02** | Pricing Authority Bifurcation for Grouped Products | **Medium** | High | Core Workflow (100% of Sets) | Low | High | Low | **Accepted** |
| **AF-03** | Heavy CTE Full-Table Scans in `inventory-query.ts` | **Medium** | Medium | Frequent (Catalog Browsing) | None | High | Low | **Accepted** |
| **AF-04** | Coarse-Grained Locking Bottleneck on Parent Variations | **Low** | Low | Frequent (Multi-terminal Sales) | Low | Low | High | **Rejected / Deferred** |
| **AF-05** | Monolithic God-Module Architecture in Core Transaction Engines | **Medium** | High | All Workflows | Medium | High | Medium | **Accepted** |
| **AF-06** | Asymmetric Shared Planning Engine vs Backend Execution | **Low** | Low | Rare Exception (<2%) | Low | Medium | Low | **Accepted** |
| **AF-07** | Backup Restore Trigger Bypass & Balance Drift Exposure | **Low** | Medium | Occasional (Disaster Recovery) | High | Medium | Very Low | **Accepted** |
| **AF-08** | Attribute Definition Mutation During Open Order Holds | **Medium** | Medium | Occasional (Catalog Updates) | Medium | Medium | Very Low | **Accepted (New)** |

---

## 2. Detailed Findings

---

### Finding AF-01: Dual-Phase Coupling of Sale Commit to Dynamic Set Re-assembly
- **Finding ID:** `AF-01`
- **Severity:** **High**
- **Affected Components:**
  - `app/api/src/lib/documents.ts` (lines 385–415, 455–470)
  - `app/api/src/lib/sets.ts` (`prepareSaleSets:427`, `sellSets:541`)
  - `app/api/src/lib/measure.ts` (`cutPiece`, `ledger`)
  - `app/web/components/Checkout.tsx`
- **Evidence:**
  In `documents.ts`, before any loose lines or sale movements are recorded, `writeDocument()` executes:
  ```typescript
  // Line 398
  await prepareSaleSets(tx, { companyId, actorId, requestId }, saleRef, saleSetLines);
  ...
  // Line 461
  if (saleSetLines.length) setCodes = await sellSets(tx, { companyId, actorId, requestId }, saleRef, saleSetLines);
  ```
  `prepareSaleSets()` unallocates old parts, cuts new pieces from free warehouse roll stock, generates new `group_set_parts` rows, and logs immutable `group_set_part_changes` records. Subsequently, `sellSets()` marks all those parts `SOLD`, marks cut pieces `USED_UP`, and writes negative `SALE` stock movements for every individual component.
- **Why It Is Problematic:**
  1. **Architectural Coupling:** Invoicing is coupled to physical shop-floor re-assembly and cutting logistics.
  2. **Exceptional Workflow Over-Privileging:** Physical component swapping at the moment of billing is a rare operational event (estimated <2% of sales transactions; ~85% of sales sell standard pre-built hoists).
  3. **Compounding Revision Complexity:** When a sale containing modified sets is edited (`editDocument`) or voided (`voidDocument`), the system must replay piece length restorations (`restoreSaleCuts`), piece re-allocations (`restoreSaleSets`), and re-sell the sets under a revision document (`INV/...-R1`).
- **Status:** **Confirmed Fact**.
- **Reconciled Decision:** **MODIFY.** Decouple the backend transaction by introducing a standalone `POST /api/sets/:id/customize` endpoint. However, maintain a single-action cashier UX: when the user clicks "Confirm" in `SaleSetsModal.tsx`, the UI automatically executes the customization call behind the scenes, placing a clean, pre-configured `IN_STOCK` set into the cart for single-phase checkout.

---

### Finding AF-02: Pricing Authority Bifurcation for Grouped Products
- **Finding ID:** `AF-02`
- **Severity:** **Medium**
- **Affected Components:**
  - `app/api/prisma/schema.prisma` (`ProductVariation.salePrice` vs `GroupSetType.salePrice`)
  - `app/api/prisma/migrations/0041_set_type_prices/migration.sql`
  - `app/api/src/lib/set-types.ts` (`listSetTypes:83`)
  - `app/api/src/lib/inventory-query.ts` (lines 100–135)
  - `app/web/components/sets/SaleSetsModal.tsx`
- **Evidence:**
  Migration `0041` introduced `group_set_types` with distinct `sale_price` and `min_sale_price` per unique combination of parts. However, `ProductVariation.salePrice` remains in use as a fallback:
  ```typescript
  // listSetTypes fallback hierarchy
  const [sets, rows, own] = await Promise.all([
    listSets(...),
    db.groupSetType.findMany({ where: { companyId, groupId } }),
    db.productVariation.findFirst({ where: { groupId }, select: { salePrice: true, minSalePrice: true } })
  ]);
  ```
- **Why It Is Problematic:**
  Two competing sources of truth exist for the price of a grouped product:
  - Editing a product price in `ProductForm.tsx` updates `product_variations.sale_price`, leaving `group_set_types` stale.
  - Updating standard set prices in `StandardSetsEditor.tsx` leaves base variation price stale.
  - Catalog search and sales drawer can display divergent prices to cashiers.
- **Status:** **Confirmed Defect**.
- **Reconciled Decision:** **ACCEPT.** Establish `group_set_types` as the sole authoritative price repository for grouped products. Auto-synchronize the base variation price to the default standard set type on edit for backward compatibility.

---

### Finding AF-03: Heavy CTE Full-Table Scans in `inventory-query.ts`
- **Finding ID:** `AF-03`
- **Severity:** **Medium**
- **Affected Components:**
  - `app/api/src/lib/inventory-query.ts` (`rollup()`, `queryInventory()`)
  - `app/api/src/routes/inventory.ts`
  - `app/api/src/routes/catalog.ts`
- **Evidence:**
  `inventory-query.ts:54-150` constructs a raw SQL query with 4 Common Table Expressions (`insets`, `setcount`, `vs`, `gs`):
  ```sql
  WITH insets AS (
    SELECT variation_id, SUM(quantity) AS q FROM group_set_parts
    WHERE company_id = $1 AND status = 'ALLOCATED' GROUP BY variation_id
  ), ...
  ```
- **Why It Is Problematic:**
  The CTE scans and aggregates the entire `group_set_parts` and `group_sets` tables on every catalog page load and search keystroke, causing latency to degrade as set histories scale into tens of thousands of rows.
- **Status:** **Confirmed Performance Concern**.
- **Reconciled Decision:** **ACCEPT.** Add composite index `(company_id, status, variation_id)` on `group_set_parts` and maintain a cached `allocated_in_sets` counter on `stock_balances`.

---

### Finding AF-04: Coarse-Grained Locking on Parent Variations (Re-Evaluated)
- **Finding ID:** `AF-04`
- **Severity:** **Low (Downgraded from High)**
- **Affected Components:**
  - `app/api/src/lib/stock.ts` (`lockVariations:109`)
  - `app/api/src/lib/measure.ts` (`cutForSale:655`)
- **Critical Re-Evaluation & Reality:**
  The previous audit recommended locking individual `measurement_pieces` rows instead of `product_variations`. However, verification against PostgreSQL triggers shows:
  ```sql
  -- stock_movements_maintain_balance trigger updates stock_balances:
  UPDATE "stock_balances" SET "quantity" = "quantity" + NEW."quantity" WHERE "variation_id" = NEW."variation_id";
  ```
  Because every cut writes a `stock_movements` row, PostgreSQL's row-level trigger *must* acquire an exclusive write lock on the variation's `stock_balances` row. Two concurrent cuts on the same variation will inevitably serialize at the balance row lock regardless of whether pieces are locked individually.
- **Status:** **Invalid Refactoring Assumption**.
- **Reconciled Decision:** **REJECT / DEFER.** Retain alphabetical parent variation locking. It guarantees 100% deadlock-free serialization and protects mathematical balance equality.

---

### Finding AF-05: Monolithic God-Module Architecture in Core Transaction Engines
- **Finding ID:** `AF-05`
- **Severity:** **Medium**
- **Affected Components:**
  - `app/api/src/lib/documents.ts` (1,235 lines)
  - `app/api/src/lib/sets.ts` (956 lines)
  - `app/web/components/Checkout.tsx` (1,150 lines)
- **Evidence:**
  `documents.ts` handles financial rounding, numbering sequences, payment status, warehouse splits, roll receiving, continuous cutting, set preparation, set selling, vendor pricing auto-updates, order syncing, voiding, and revision chaining.
- **Why It Is Problematic:**
  Violates Single Responsibility Principle. Modifying vendor pricing auto-updates risks regressing roll cut validation. High developer cognitive overhead.
- **Status:** **Confirmed Architectural Weakness**.
- **Reconciled Decision:** **ACCEPT.** Refactor `documents.ts` into a lightweight orchestrator delegating to `numbering.ts`, `payments.ts`, `revisions.ts`, and `voids.ts`.

---

### Finding AF-06: Asymmetric Shared Planning Engine vs Backend Execution
- **Finding ID:** `AF-06`
- **Severity:** **Low**
- **Affected Components:**
  - `app/shared/src/sets.ts` (`planSets()`, `takeParts()`)
  - `app/api/src/lib/sets.ts` (`prepareSaleSets()`)
- **Evidence:**
  `shared/src/sets.ts` contains 250+ lines of pure TypeScript implementing combinatorial search for finding the set needing the fewest part swaps. On submit, backend re-runs independent queries. If client and server tie-breaking heuristics diverge on equal-length rolls, the backend rejects with 409 `PIECE_CHANGED`.
- **Status:** **Confirmed Usability Friction**.
- **Reconciled Decision:** **ACCEPT.** Standardize selection contract: client requests desired set specifications (`want`); server returns authoritative allocation.

---

### Finding AF-07: Backup Restore Trigger Bypass & Balance Drift Exposure
- **Finding ID:** `AF-07`
- **Severity:** **Low**
- **Affected Components:**
  - `app/api/src/routes/backup.ts` (`restore()`)
  - PostgreSQL trigger `stock_movements_maintain_balance`
  - PostgreSQL view `stock_balance_drift`
- **Evidence:**
  In `backup.ts:restore()`, triggers are disabled to allow bulk data ingestion. If the backup archive contains pre-existing balance inconsistencies, stored balances diverge from the ledger silently.
- **Status:** **Confirmed Disaster Recovery Gap**.
- **Reconciled Decision:** **ACCEPT.** Incorporate an automated post-restore check in `backup.ts` querying `stock_balance_drift`. If drift > 0, trigger automatic ledger recalculation before commit.

---

### Finding AF-08 (NEW): Attribute Definition Mutation During Open Order Holds
- **Finding ID:** `AF-08`
- **Severity:** **Medium**
- **Affected Components:**
  - `app/api/src/routes/products.ts` (`PUT /api/products/:id`)
  - `app/api/src/lib/products.ts` (`assertAttributeEditSafe()`)
- **Evidence:**
  `assertAttributeEditSafe()` checks `stock_movements` to prevent altering physical attributes on variations with past ledger movements. However, it fails to check active open orders (`orders` with `status IN ('PLACED', 'ON_DELIVERY')`). If attributes are modified while an order holds reserved stock, fulfillment generates line mismatches.
- **Status:** **Confirmed Missing Business Rule**.
- **Reconciled Decision:** **ACCEPT.** Extend `assertAttributeEditSafe()` to query active `order_lines` and reject attribute mutations when open orders exist.
