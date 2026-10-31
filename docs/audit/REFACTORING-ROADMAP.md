# REFACTORING ROADMAP & IMPLEMENTATION PLAN (REVISED)
**Project:** RS Machinery Inventory Management System  
**Audit Date:** 2026-10-29 (Revision 2 Post-Lifecycle Investigation)  
**Auditor:** Principal Software Architect & Senior Data Engineer  
**Scope:** Phased, Low-Risk Modernization Plan for `measurement-inventory/`  
**Location:** `measurement-inventory/docs/audit/REFACTORING-ROADMAP.md`

---

## 1. Prioritization Strategy & Risk Management

Work is strictly prioritized by **business data integrity**, **workflow frequency**, and **implementation safety**:

```mermaid
graph LR
    P1[Phase 1: Pricing Authority & Recovery<br/>Integrity: High | Risk: Very Low | Days: 2] --> P2[Phase 2: Decouple Set Customization<br/>Impact: High | Risk: Low | Days: 4]
    P2 --> P3[Phase 3: Modularize Document Engine<br/>Maintainability: High | Risk: Low | Days: 3]
    P3 --> P4[Phase 4: Query Optimization & Indexing<br/>Performance: High | Risk: Very Low | Days: 2]
```

---

## 2. Phase-by-Phase Implementation Plan

---

### Phase 1: Pricing Authority Unification & Recovery Hardening (Immediate ROI)
- **Primary Problems Addressed:** Resolves `AF-02` (Pricing authority bifurcation) and `AF-07` (Disaster recovery drift exposure).
- **Affected Files & Components:**
  - `app/api/src/lib/set-types.ts` (`listSetTypes`, `upsertSetTypePrices`)
  - `app/api/src/lib/products.ts` (`serializeGroup`)
  - `app/api/src/routes/backup.ts` (`restore()`)
  - `app/web/components/sets/SaleSetsModal.tsx`
  - `app/web/components/products/ProductForm.tsx`
- **Required Changes:**
  1. Deprecate direct modification of `salePrice` on grouped `product_variations`.
  2. In `ProductForm.tsx`, editing a grouped product price creates or updates the default `group_set_types` record.
  3. Simplify `SaleSetsModal.tsx` and catalog displays to read `group_set_types.sale_price` as the single authoritative source of truth.
  4. In `backup.ts:restore()`, query `SELECT count(*) FROM stock_balance_drift`. If drift > 0, trigger automatic balance synchronization from ledger before commit.
- **Dependencies:** None.
- **Risk Level:** **Very Low**.
- **Test Strategy:**
  - Unit tests: Verify `upsertSetTypePrices()` synchronizes prices reliably.
  - Integration tests: `grouped.test.ts:193` (standard sets and price resolution); `backup.test.ts`.
- **Rollback Strategy:** Revert frontend fallback reading order; underlying schema remains untouched.
- **Acceptance Criteria:**
  - Zero price discrepancies between catalog overview, product drawer, set sheet, and checkout receipt.
  - Modifying product price via admin form immediately reflects in set drawer.
  - Disaster recovery restore validates zero drift in `stock_balance_drift`.

---

### Phase 2: Decouple Set Customization from Invoice Billing (Core Architectural Value)
- **Primary Problems Addressed:** Resolves `AF-01` (Dual-phase set replacement in sales checkout) and `AF-06` (Asymmetric client planning).
- **Affected Files & Components:**
  - `app/api/src/lib/sets.ts` (extract `customizeSet()`; simplify `prepareSaleSets()`)
  - `app/api/src/routes/sets.ts` (add `POST /api/sets/:id/customize`)
  - `app/api/src/lib/documents.ts` (`writeDocument`, `editDocument`)
  - `app/web/components/sets/SaleSetsModal.tsx`
  - `app/web/components/Checkout.tsx`
- **Required Changes:**
  1. Create standalone endpoint `POST /api/sets/:id/customize`:
     - Releases old chain to free stock (`status = 'RELEASED'`).
     - Cuts new chain from bulk roll (`cutPiece()`, `status = 'ALLOCATED'`).
     - Logs immutable `group_set_part_changes` record.
     - Updates set `version`. Set remains `status = 'IN_STOCK'`.
  2. In `SaleSetsModal.tsx`, when an alternative chain is confirmed, the modal executes the customization endpoint behind the scenes before placing the set in the cart.
  3. Simplify `writeDocument()`: Remove in-line `prepareSaleSets()`. Grouped sale lines simply list the customized set ID, which is sold cleanly via `sellSets()`.
  4. Simplify `editDocument()` and `voidDocument()`: Document cancellations no longer need to unwind dynamic cutting operations.
- **Dependencies:** Phase 1 completion.
- **Risk Level:** **Low**.
- **Test Strategy:**
  - New integration test: `tests/integration/set-customization.test.ts` testing isolated part replacement.
  - Existing `grouped.test.ts` Phase 3 sales tests adapted to verify customized set selling.
- **Rollback Strategy:** The existing `prepareSaleSets()` can remain available as a fallback until the new customization flow is validated in production.
- **Acceptance Criteria:**
  - Standard hoists and customized hoists checkout through the exact same single-phase code path in `writeDocument()`.
  - Cashier checkout latency reduced; zero nested cut-planning errors during peak sales hours.
- **Expected Complexity Reduction:** Removes ~150 lines of exceptional branch logic from `documents.ts`.

---

### Phase 3: Modularize Core Commercial Document Engine
- **Primary Problem Addressed:** Resolves `AF-05` (God-module architecture in `documents.ts`).
- **Affected Files & Components:**
  - `app/api/src/lib/documents.ts` (1,235 lines)
  - New modules in `app/api/src/lib/documents/`:
    - `numbering.ts` (sequential document numbering)
    - `payments.ts` (payment status, modes, and paise calculations)
    - `revisions.ts` (revision chaining, replaced void generation)
    - `voids.ts` (compensating void movement coordination)
- **Required Changes:**
  1. Extract pure financial and payment calculations into `payments.ts`.
  2. Extract document revision and void handling into `revisions.ts` and `voids.ts`.
  3. Reduce `documents.ts` to a lean orchestrator (`writeDocument`, `createDocument`) under 400 lines of clear procedural code.
- **Dependencies:** Phase 2 completion.
- **Risk Level:** **Low**.
- **Test Strategy:**
  - Comprehensive unit test suite: `npm test` across all 15 unit test files (149 tests).
  - Integration suites: `documents.test.ts`, `document-edit.test.ts`.
- **Rollback Strategy:** Git revert of modular refactor branch; zero database schema changes involved.
- **Acceptance Criteria:**
  - All 149 existing unit tests and integration tests pass without modification.
  - Clean separation of concerns with zero circular dependencies between domain modules.
- **Expected Complexity Reduction:** Reduces cyclomatic complexity of `documents.ts` by over 60%.

---

### Phase 4: Query Optimization & Catalog Indexing
- **Primary Problem Addressed:** Resolves `AF-03` (Heavy CTE queries in catalog search).
- **Affected Files & Components:**
  - `app/api/src/lib/inventory-query.ts` (`rollup()`)
  - `app/api/prisma/schema.prisma` (targeted index additions)
- **Required Changes:**
  1. Add composite index on `group_set_parts(company_id, status, variation_id)`.
  2. Cache `allocated_in_sets` on `stock_balances`, updated directly by set allocation triggers.
  3. Replace the `WITH insets AS (SELECT SUM(...) FROM group_set_parts)` CTE in `inventory-query.ts` with direct indexed column reads.
- **Dependencies:** None.
- **Risk Level:** **Very Low**.
- **Test Strategy:**
  - Benchmark query latency on `queryInventory()` with 10,000+ mock records.
  - Integration tests in `inventory.test.ts`.
- **Rollback Strategy:** Revert index migration.
- **Acceptance Criteria:**
  - Catalog search latency reduced by >50% on datasets with extensive set histories.
  - Zero changes to external API response formats.

---

## 3. Summary of Refactoring Impact

| Metric | Current State (Baseline) | Target State (Post-Refactor) | Improvement |
|---|---|---|---|
| **Lines in `documents.ts`** | 1,235 lines | ~380 lines | **-69% reduction** |
| **Sales Checkout Phases** | 2 phases (`prepare` + `sell`) | 1 phase (`sell`) | **50% simpler execution** |
| **Entities Locked on Set Sale** | 4 tables (`variations`, `sets`, `parts`, `pieces`) | 2 tables (`variations`, `sets`) | **-50% lock surface** |
| **Grouped Pricing Sources** | 2 competing sources | 1 single authoritative source | **Zero pricing ambiguity** |
| **Disaster Recovery Balance Drift Risk** | Exposed to silent drift | Automatically validated & repaired | **100% mathematical integrity** |
| **Business Behavior Changed** | — | None | **100% preservation of guarantees** |
