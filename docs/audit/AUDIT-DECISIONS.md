# AUDIT DECISIONS & RECONCILIATION REPORT
**Project:** RS Machinery Inventory Management System  
**Audit Date:** 2026-10-29  
**Scope:** Critical Reconciliation of Previous Audit Findings Against Codebase V3.1/V3.2  
**Location:** `measurement-inventory/docs/audit/AUDIT-DECISIONS.md`

---

## 1. Executive Summary of Audit Reconciliation

The preliminary audit concluded that while the database ledger foundation is solid, several application-layer transaction workflows accumulated accidental complexity. This follow-up audit examined the actual codebase to verify or refute those findings.

### Summary of Decisions
- **Accepted (5):**
  - **AF-02 (Pricing Authority Unification):** Confirmed defect. Unify dual pricing into `group_set_types`.
  - **AF-03 (Catalog Query & In-Sets Indexing):** Confirmed performance issue. Add composite index and cache allocated quantities.
  - **AF-05 (Modularize Monolithic Documents Engine):** Confirmed architectural weakness. Refactor `documents.ts` into single-responsibility helpers.
  - **AF-06 (Eliminate Asymmetric Client Planning):** Confirmed usability friction. Make server piece planning authoritative.
  - **AF-07 (Automate Post-Restore Drift Verification):** Confirmed disaster recovery gap. Verify `stock_balance_drift` post-restore.
- **Modified (1):**
  - **AF-01 (Set Customization in Sales Checkout):** Previously recommended forcing customization into a separate shop-floor screen. **Modified:** Maintain a seamless single-click cashier experience in the UI, but decouple backend execution into two distinct transactional steps (auto-customization call followed by clean single-phase sale).
- **Rejected / Deferred (1):**
  - **AF-04 (Fine-Grained Roll Piece Locking):** Previously recommended locking individual `measurement_pieces` rows instead of `product_variations`. **Rejected:** In PostgreSQL, the row trigger `stock_movements_maintain_balance` updates the *same* `stock_balances` row for that variation anyway. Fine-grained piece locking does not prevent serialization at the balance trigger and risks deadlocks unless balance triggers are rewritten. Parent variation locking remains the simplest, deadlock-free solution.

---

## 2. Consolidated Decision Table

| Finding ID | Existing Finding | Source Evidence | Relevant Business Workflow | Business Impact | Frequency (Measured / Estimated) | Data Integrity Risk | Existing Test Coverage | Previous Audit Recommendation | Is Recommendation Valid? | Unresolved Questions | Final Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AF-01** | Dual-phase coupling of component replacement inside sales checkout | `documents.ts:398, 461`<br/>`sets.ts:427, 541`<br/>`Checkout.tsx:206` | Sales Checkout with Custom Chain / Parts | Invoice transaction widened; edge-case return complexity | **Estimated <2%** of sales (custom hoists). 85% standard sales. | Medium (Widened lock window, cut roll scrap tracking) | `grouped.test.ts` Phase 3 (542 lines) | Isolate set customization to a separate endpoint `POST /api/sets/:id/customize` | **Partially Valid:** Transaction decoupling is essential; forcing cashier out of POS screen is unacceptable. | Does the owner want counter staff to sell custom chain lengths on the fly, or should custom lengths be pre-rigged and tagged by technicians? | **MODIFY:** Keep single cashier UX in `SaleSetsModal.tsx`, but execute customization as a dedicated API pre-call before standard checkout. |
| **AF-02** | Grouped product pricing authority bifurcated across two tables | `schema.prisma:355, 1245`<br/>`set-types.ts:83-110`<br/>`inventory-query.ts:100-130` | Product Pricing, Catalog Browsing, POS Drawer | Price discrepancies between catalog and cart; staff quote wrong rates | **100% of grouped products** | Low (Commercial confusion, no stock drift) | `grouped.test.ts:193` (migration 0041 test) | Deprecate `product_variations.sale_price`; establish `group_set_types` as sole authority | **Completely Valid:** Having two competing sources of truth violates normalization. | Should the default set type price auto-sync to the base variation row for backward compatibility with external APIs? | **ACCEPT:** Make `group_set_types` authoritative; auto-sync base variation price to default set type on edit. |
| **AF-03** | Heavy CTE full-table scan on `group_set_parts` in catalog queries | `inventory-query.ts:54-150` | Catalog Search, Category Filtering, Inventory KPIs | Response times degrade from 20ms to 500ms+ as set history grows | **Frequent:** Every search keystroke and filter change | None (Read performance only) | `inventory.test.ts`, unit `inventory-query` | Add index on `group_set_parts(company_id, status, variation_id)` and cached counter | **Completely Valid:** Unscalable as historical transaction records accumulate. | What is the maximum acceptable unpaged export size for PDF reports? | **ACCEPT:** Implement composite index on `group_set_parts` and add `allocated_in_sets` counter to `stock_balances`. |
| **AF-04** | Coarse-grained locking on parent variation blocks parallel roll cutting | `measure.ts:655`<br/>`stock.ts:109` | Multi-counter Continuous Goods Sales | Cashiers at different counters cutting different rolls of same item serialize | **Moderate:** Peak sales hours across multi-counter shops | Low (Concurrency contention) | `measure.test.ts:650` | Replace variation locks with row-level locks on `measurement_pieces` | **Invalid:** PostgreSQL trigger `stock_movements_maintain_balance` locks the variation's `stock_balances` row anyway. | Does POS counter sales volume currently experience lock wait timeouts in production? | **REJECT / DEFER:** Retain parent variation locking. It prevents deadlocks and enforces strict balance-to-piece equality. |
| **AF-05** | Monolithic God-Module architecture in core document engine | `documents.ts:1-1235`<br/>`sets.ts:1-956`<br/>`Checkout.tsx:1-1150` | Invoicing, Purchasing, Revisions, Voids, Vendor Pricing | High developer cognitive load; elevated regression risk during edits | **All transactions** | Medium (Cross-domain regression risk) | 15 unit test files (149 tests), 3 integration suites | Extract numbering, payments, revisions, and voids into focused domain modules | **Completely Valid:** Violates Single Responsibility Principle. | Should document numbering follow fiscal-year sequences per warehouse or remain company-wide? | **ACCEPT:** Refactor `documents.ts` into a lightweight coordinator delegating to dedicated domain helpers. |
| **AF-06** | Asymmetric shared planning heuristic vs backend database verification | `shared/src/sets.ts:200`<br/>`sets.ts:470-520` | Dynamic Set Selection in Sales Modal | Backend throws 409 `PIECE_CHANGED` when client and server heuristics diverge | **Rare:** Edge cases with equal-length rolls | Low (POS cashier UX friction) | `unit/set-plan.test.ts` (13 tests) | Client requests desired specs; server resolves and returns authoritative plan | **Completely Valid:** Duplicated selection heuristics across client and server. | Should the server lock the selected piece during cart drafting or only at final checkout? | **ACCEPT:** Standardize selection contract with server-authoritative allocation. |
| **AF-07** | Disaster recovery restore bypasses balance triggers without drift verification | `backup.ts:180-250`<br/>`0007_stock_balances.sql:75` | Backup Restoration & Migration | Silent balance drift if backup archive has pre-existing corruption | **Occasional:** Disaster recovery and staging clones | High (Silent stock corruption) | `backup.test.ts`, `backup-v2.test.ts` | Automatically query `stock_balance_drift` post-restore; recalculate if count > 0 | **Completely Valid:** Disaster recovery must guarantee mathematical consistency. | Should automatic recalculation overwrite balances or abort the restore if drift is detected? | **ACCEPT:** Add automated post-restore check querying `stock_balance_drift`; automatically sync balances from ledger if drift > 0. |

---

## 3. Deep Reconciliation of Specific Subsystems

### 3.1 Set Customization Inside Sales Checkout (AF-01)
- **The Conflict:** In `documents.ts:398`, `writeDocument()` executes `prepareSaleSets()`. Inside the same database transaction, an old chain is returned to free stock (`RELEASED`), a new chain is cut from bulk roll (`cutPiece()`), and allocated to the set (`ALLOCATED`). Then `sellSets()` converts them to `SOLD`.
- **Previous Audit Proposal:** Remove component swapping from checkout entirely and force staff to use a separate "Shop Floor Assembly" page.
- **Critical Re-Evaluation:** While technically clean, forcing counter cashiers to leave the checkout screen when a customer requests a standard 6m hoist instead of a 3m hoist causes friction.
- **Reconciled Decision:** **Decouple the backend transaction while preserving the frontend workflow.**
  When the cashier clicks "Confirm" in `SaleSetsModal.tsx`:
  1. The client executes an atomic background call to `POST /api/sets/:id/customize` (isolated assembly transaction).
  2. The customized hoist is returned with its new configuration and set to `IN_STOCK`.
  3. The cashier's cart now contains an ordinary, ready-to-sell set.
  4. Standard checkout runs cleanly through `sellSets()` without dual-phase cutting or dynamic re-pricing logic.

### 3.2 Grouped Product Pricing Authority (AF-02)
- **The Conflict:** `ProductVariation` contains `salePrice`, `minSalePrice`, and `purchaseCost`. Migration `0041` added `GroupSetType` with its own `salePrice`, `minSalePrice`, and `lowStockThreshold`.
- **Root Cause:** Migration `0041` was added to support distinct prices for 3m vs 6m hoists without breaking existing catalog screens that queried `product_variations`.
- **Reconciled Decision:** `GroupSetType` is the single source of truth for grouped product pricing.
  1. When viewing a grouped product, catalog displays the price range across its active set types (`min(sale_price)` to `max(sale_price)`).
  2. When an admin updates the price of a standard set type, the base variation's `salePrice` is automatically updated to match the default standard set type for backward compatibility.
  3. Direct editing of `salePrice` on grouped product variations is deprecated.

### 3.3 Measurement-Piece Concurrency Locking (AF-04)
- **The Conflict:** In `measure.ts:655`, `cutForSale()` locks `product_variations` rows (`SELECT ... FOR UPDATE`).
- **Previous Audit Proposal:** Lock only the specific `measurement_pieces` rows being cut.
- **Why Previous Audit Was Flawed:** PostgreSQL table `stock_balances` has a single row per `variation_id`. When a cut is committed, trigger `stock_movements_maintain_balance` updates that exact `stock_balances` row. Therefore, two simultaneous cuts on the same variation will always serialize at the `stock_balances` row lock. Locking individual pieces provides zero concurrency gain while risking deadlocks if lock orders differ.
- **Reconciled Decision:** **Reject piece-level locking refactor.** Retain alphabetical variation locking. It guarantees deadlock-free serialization and protects the mathematical invariant:
  $$\sum \text{ACTIVE measurement\_pieces.remaining\_length} = \text{stock\_balances.quantity}$$

---

## 4. Unresolved Business Questions & Minimum Information Needed

1. **Physical Set Customization Protocol:**
   - *Question:* Does shop management allow counter cashiers to cut and swap chains, or must all chain modifications be performed and inspected by certified shop-floor riggers before billing?
   - *Minimum Information Needed:* Confirmation from the owner on shop operating procedures.
2. **Pricing Policy for Altered Hoists:**
   - *Question:* When a 3m hoist is converted to 6m, should the price formula strictly be `BasePrice - (3m * ChainRate) + (6m * ChainRate)`, or is an assembly/labor surcharge added?
   - *Minimum Information Needed:* Standard pricing rule from the owner.
3. **Multi-Warehouse Set Lineage:**
   - *Question:* If a warehouse transfer moves a hoist from Main Godown to Shop Floor, do all constituent parts move with it automatically?
   - *Minimum Information Needed:* Confirmation that sets are always moved as indivisible containers (currently enforced by `0035_warehouses`).
