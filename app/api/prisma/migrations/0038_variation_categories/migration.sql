-- 0038 Categories on variations (owner 2026-10-23; plan v3.1\docs\VARIATION-CATEGORIES-V3-PLAN.md).
--
-- A category of a head other than Product Type applies to the whole product (product_categories,
-- 0033) or only to chosen variations of it (variation_categories, here) — never both (VC2).
-- Product Type stays one per product (product_groups.category_id, VC1).

CREATE TABLE "variation_categories" (
  "variation_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  CONSTRAINT "variation_categories_pkey" PRIMARY KEY ("variation_id", "category_id")
);
CREATE INDEX "variation_categories_category_id_product_id_idx" ON "variation_categories"("category_id", "product_id");
CREATE INDEX "variation_categories_product_id_idx" ON "variation_categories"("product_id");
CREATE INDEX "variation_categories_company_id_idx" ON "variation_categories"("company_id");

ALTER TABLE "variation_categories" ADD CONSTRAINT "variation_categories_variation_id_fkey"
  FOREIGN KEY ("variation_id") REFERENCES "product_variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variation_categories" ADD CONSTRAINT "variation_categories_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variation_categories" ADD CONSTRAINT "variation_categories_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variation_categories" ADD CONSTRAINT "variation_categories_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same company everywhere, and product_id is the variation's own product.
CREATE UNIQUE INDEX "product_variations_id_group_company_key" ON "product_variations" ("id", "group_id", "company_id");
ALTER TABLE "variation_categories" ADD CONSTRAINT "variation_categories_variation_same_product_fkey"
  FOREIGN KEY ("variation_id", "product_id", "company_id") REFERENCES "product_variations" ("id", "group_id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "variation_categories" ADD CONSTRAINT "variation_categories_category_same_company_fkey"
  FOREIGN KEY ("category_id", "company_id") REFERENCES "categories" ("id", "company_id") ON DELETE RESTRICT;

-- VC1: never a Product Type category. VC2: never alongside a whole-product link.
CREATE FUNCTION variation_categories_check() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.head_id IS NULL) THEN
    RAISE EXCEPTION 'VARIATION_CATEGORY_PRODUCT_TYPE: Product Type is set on the whole product'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = NEW.product_id AND pc.category_id = NEW.category_id) THEN
    RAISE EXCEPTION 'VARIATION_CATEGORY_WHOLE_PRODUCT: the category already applies to the whole product'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER variation_categories_check BEFORE INSERT OR UPDATE ON "variation_categories"
  FOR EACH ROW EXECUTE FUNCTION variation_categories_check();

CREATE FUNCTION product_categories_no_variation_links() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM variation_categories vc WHERE vc.product_id = NEW.product_id AND vc.category_id = NEW.category_id) THEN
    RAISE EXCEPTION 'VARIATION_CATEGORY_WHOLE_PRODUCT: remove the variation links before linking the whole product'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER product_categories_no_variation_links BEFORE INSERT OR UPDATE ON "product_categories"
  FOR EACH ROW EXECUTE FUNCTION product_categories_no_variation_links();
