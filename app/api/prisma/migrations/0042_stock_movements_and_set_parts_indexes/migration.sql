-- 0042 Indexes on StockMovement (sale_id, purchase_id) and GroupSetPart (company_id, status, variation_id)
--
-- Performance audit VF-07:
-- 1. stock_movements: document voids and revisions (documents.ts:530, 745) filter by
--    (company_id, sale_id, movement_type) and (company_id, purchase_id, movement_type), and
--    measure.ts:727 filters by (sale_id, variation_id, movement_type). Without indexes on
--    sale_id and purchase_id, PostgreSQL must scan all movements for the company.
-- 2. group_set_parts: the catalog rollup CTE 'insets' (inventory-query.ts:98) aggregates
--    WHERE company_id = $1 AND status = 'ALLOCATED' GROUP BY variation_id. The existing index
--    (variation_id, status) cannot be used because variation_id is not filtered. Adding
--    (company_id, status, variation_id) allows an index scan and eliminates the sort step.

CREATE INDEX "stock_movements_sale_id_idx" ON "stock_movements"("sale_id");
CREATE INDEX "stock_movements_purchase_id_idx" ON "stock_movements"("purchase_id");
CREATE INDEX "group_set_parts_company_id_status_variation_id_idx" ON "group_set_parts"("company_id", "status", "variation_id");
