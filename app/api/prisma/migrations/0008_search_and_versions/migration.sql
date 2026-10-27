-- V2 plan §1.2 (backlog E1): trigram indexes so ILIKE '%term%' search uses an index.
-- V2 plan §1.5 (backlog C2): version columns for optimistic concurrency on editable masters.

-- pg_trgm is a trusted extension (PostgreSQL 13+): the database owner may create it without
-- superuser rights, so this works for the rs_v3 role locally and the Docker superuser on the VPS.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "product_groups" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "product_variations" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "parties" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "product_groups_name_trgm_idx" ON "product_groups" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "product_variations_short_name_trgm_idx" ON "product_variations" USING GIN ("short_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "product_variations_official_sku_trgm_idx" ON "product_variations" USING GIN ("official_sku" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "parties_name_trgm_idx" ON "parties" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "parties_phone_trgm_idx" ON "parties" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "sales_number_trgm_idx" ON "sales" USING GIN ("number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "purchases_number_trgm_idx" ON "purchases" USING GIN ("number" gin_trgm_ops);

-- Version positivity (hand-written).
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_version_positive" CHECK ("version" >= 1);
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_version_positive" CHECK ("version" >= 1);
ALTER TABLE "parties" ADD CONSTRAINT "parties_version_positive" CHECK ("version" >= 1);
