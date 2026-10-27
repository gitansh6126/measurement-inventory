-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('simple', 'variable');

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_groups" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product_type" "ProductType" NOT NULL,
    "base_short_name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL,
    "image_url" TEXT,
    "category_id" TEXT,
    "attribute_definitions" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "product_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "official_sku" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "attribute_key" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "sale_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "purchase_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "product_variations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_company_id_idx" ON "categories"("company_id");

-- CreateIndex
CREATE INDEX "product_groups_company_id_active_idx" ON "product_groups"("company_id", "active");

-- CreateIndex
CREATE INDEX "product_groups_category_id_idx" ON "product_groups"("category_id");

-- CreateIndex
CREATE INDEX "product_variations_group_id_idx" ON "product_variations"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variations_company_id_short_name_key" ON "product_variations"("company_id", "short_name");

-- CreateIndex
CREATE UNIQUE INDEX "product_variations_group_id_attribute_key_key" ON "product_variations"("group_id", "attribute_key");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants (not expressible in schema.prisma)
-- ---------------------------------------------------------------------------

-- Names and units are trimmed and non-empty.
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_trimmed" CHECK ("name" = btrim("name") AND "name" <> '');
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_name_trimmed" CHECK ("name" = btrim("name") AND "name" <> '');
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_unit_trimmed" CHECK ("unit" = btrim("unit") AND "unit" <> '');
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_base_short_name_format" CHECK ("base_short_name" = upper(btrim("base_short_name")) AND "base_short_name" <> '');
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_attribute_definitions_array" CHECK (jsonb_typeof("attribute_definitions") = 'array');

-- BR-04: Short Name stored trimmed + uppercase. BR-05: Official SKU is NULL or a trimmed non-blank value.
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_short_name_format" CHECK ("short_name" = upper(btrim("short_name")) AND "short_name" <> '');
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_official_sku_format" CHECK ("official_sku" IS NULL OR ("official_sku" = btrim("official_sku") AND "official_sku" <> ''));
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_attributes_object" CHECK (jsonb_typeof("attributes") = 'object');
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_money_nonneg" CHECK ("sale_price" >= 0 AND "purchase_cost" >= 0);
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_low_stock_nonneg" CHECK ("low_stock_threshold" >= 0);

-- BR-05: non-blank Official SKUs are unique per company, case-insensitively. Blank (NULL) is unlimited.
CREATE UNIQUE INDEX "product_variations_company_official_sku_ci_key"
  ON "product_variations" ("company_id", lower("official_sku")) WHERE "official_sku" IS NOT NULL;

-- Category names are unique per company, case-insensitively.
CREATE UNIQUE INDEX "categories_company_name_ci_key" ON "categories" ("company_id", lower("name"));

-- Company boundary: a variation and its group, and a group and its category, always share a company.
CREATE UNIQUE INDEX "product_groups_id_company_key" ON "product_groups" ("id", "company_id");
CREATE UNIQUE INDEX "categories_id_company_key" ON "categories" ("id", "company_id");
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_group_same_company_fkey"
  FOREIGN KEY ("group_id", "company_id") REFERENCES "product_groups" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_category_same_company_fkey"
  FOREIGN KEY ("category_id", "company_id") REFERENCES "categories" ("id", "company_id") ON DELETE RESTRICT;

-- Search by name / codes.
CREATE INDEX "product_groups_company_lower_name_idx" ON "product_groups" ("company_id", lower("name"));
