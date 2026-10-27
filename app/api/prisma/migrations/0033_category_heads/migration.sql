-- 0033 Category heads (owner 2026-10-21; reference: script_versions "Dimensions" / category groups).
--
-- A category head groups categories: the built-in head "Product Type" (head_id NULL, every
-- existing category) and heads the company adds, e.g. "Industry" → Agriculture, Gym.
--   * Product Type: at most one per product (product_groups.category_id, unchanged).
--   * Any other head: a product may sit in any number of its categories (product_categories).
-- Heads, like categories, are never hard-deleted: active=false retires one.

CREATE TABLE "category_heads" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "category_heads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "category_heads_company_id_idx" ON "category_heads"("company_id");
ALTER TABLE "category_heads" ADD CONSTRAINT "category_heads_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "category_heads" ADD CONSTRAINT "category_heads_name_trimmed" CHECK ("name" = btrim("name") AND "name" <> '');
-- "Product Type" is the built-in head's name, so no stored head may take it.
ALTER TABLE "category_heads" ADD CONSTRAINT "category_heads_name_not_builtin" CHECK (lower("name") <> 'product type');
CREATE UNIQUE INDEX "category_heads_company_name_ci_key" ON "category_heads" ("company_id", lower("name"));
CREATE UNIQUE INDEX "category_heads_id_company_key" ON "category_heads" ("id", "company_id");

-- Categories belong to a head (NULL = Product Type). Names are unique within a head, so
-- "General" may exist under Product Type and under Industry.
ALTER TABLE "categories" ADD COLUMN "head_id" TEXT;
ALTER TABLE "categories" ADD CONSTRAINT "categories_head_id_fkey"
  FOREIGN KEY ("head_id") REFERENCES "category_heads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_head_same_company_fkey"
  FOREIGN KEY ("head_id", "company_id") REFERENCES "category_heads" ("id", "company_id") ON DELETE RESTRICT;
CREATE INDEX "categories_head_id_idx" ON "categories"("head_id");
DROP INDEX "categories_company_name_ci_key";
CREATE UNIQUE INDEX "categories_company_head_name_ci_key" ON "categories" ("company_id", COALESCE("head_id", ''), lower("name"));

-- Product ↔ category links for heads other than Product Type (checked in the API).
CREATE TABLE "product_categories" (
  "product_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  CONSTRAINT "product_categories_pkey" PRIMARY KEY ("product_id", "category_id")
);
CREATE INDEX "product_categories_category_id_idx" ON "product_categories"("category_id");
CREATE INDEX "product_categories_company_id_idx" ON "product_categories"("company_id");
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_same_company_fkey"
  FOREIGN KEY ("product_id", "company_id") REFERENCES "product_groups" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_same_company_fkey"
  FOREIGN KEY ("category_id", "company_id") REFERENCES "categories" ("id", "company_id") ON DELETE RESTRICT;
