-- V2 catalog browse (v2/docs/catalog-browse/ARCHITECTURE.md §3.1).
-- Owner-controlled order of the category rail; 0 for every existing row keeps today's name order.
ALTER TABLE "categories" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Product cards per category (GET /api/catalog/products?categoryId=…), active products by name.
CREATE INDEX "product_groups_company_id_category_id_active_name_idx"
ON "product_groups"("company_id", "category_id", "active", "name");
