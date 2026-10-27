-- CreateEnum
CREATE TYPE "DocumentVoidKind" AS ENUM ('CANCELLED', 'REPLACED');

-- AlterTable document_voids
ALTER TABLE "document_voids" ADD COLUMN "kind" "DocumentVoidKind" NOT NULL DEFAULT 'CANCELLED';
ALTER TABLE "document_voids" ADD COLUMN "replaced_by_sale_id" TEXT;
ALTER TABLE "document_voids" ADD COLUMN "replaced_by_purchase_id" TEXT;

-- AlterTable sales
ALTER TABLE "sales" ADD COLUMN "replaces_id" TEXT;
ALTER TABLE "sales" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable purchases
ALTER TABLE "purchases" ADD COLUMN "replaces_id" TEXT;
ALTER TABLE "purchases" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

-- Unique constraints for 1-to-1 replaces
CREATE UNIQUE INDEX "sales_replaces_id_key" ON "sales"("replaces_id");
CREATE UNIQUE INDEX "purchases_replaces_id_key" ON "purchases"("replaces_id");

-- Foreign key constraints (same-company)
ALTER TABLE "document_voids" ADD CONSTRAINT "document_voids_replaced_by_sale_same_company_fkey"
  FOREIGN KEY ("replaced_by_sale_id", "company_id") REFERENCES "sales" ("id", "company_id") ON DELETE RESTRICT;

ALTER TABLE "document_voids" ADD CONSTRAINT "document_voids_replaced_by_purchase_same_company_fkey"
  FOREIGN KEY ("replaced_by_purchase_id", "company_id") REFERENCES "purchases" ("id", "company_id") ON DELETE RESTRICT;

ALTER TABLE "sales" ADD CONSTRAINT "sales_replaces_same_company_fkey"
  FOREIGN KEY ("replaces_id", "company_id") REFERENCES "sales" ("id", "company_id") ON DELETE RESTRICT;

ALTER TABLE "purchases" ADD CONSTRAINT "purchases_replaces_same_company_fkey"
  FOREIGN KEY ("replaces_id", "company_id") REFERENCES "purchases" ("id", "company_id") ON DELETE RESTRICT;

-- Consistency checks on document_voids
ALTER TABLE "document_voids" ADD CONSTRAINT "document_voids_replaced_target" CHECK (
  ("kind" = 'CANCELLED' AND "replaced_by_sale_id" IS NULL AND "replaced_by_purchase_id" IS NULL)
  OR ("kind" = 'REPLACED' AND "sale_id" IS NOT NULL AND "replaced_by_sale_id" IS NOT NULL AND "replaced_by_purchase_id" IS NULL)
  OR ("kind" = 'REPLACED' AND "purchase_id" IS NOT NULL AND "replaced_by_purchase_id" IS NOT NULL AND "replaced_by_sale_id" IS NULL)
);

-- Consistency checks on revision
ALTER TABLE "sales" ADD CONSTRAINT "sales_revision_nonneg" CHECK ("revision" >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_revision_consistent" CHECK (
  ("replaces_id" IS NULL AND "revision" = 0) OR ("replaces_id" IS NOT NULL AND "revision" > 0)
);

ALTER TABLE "purchases" ADD CONSTRAINT "purchases_revision_nonneg" CHECK ("revision" >= 0);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_revision_consistent" CHECK (
  ("replaces_id" IS NULL AND "revision" = 0) OR ("replaces_id" IS NOT NULL AND "revision" > 0)
);

ALTER TABLE "sales" DROP CONSTRAINT "sales_number_format";
ALTER TABLE "sales" ADD CONSTRAINT "sales_number_format" CHECK ("number" ~ '^SAL/[0-9]{4}-[0-9]{2}/[0-9]{4,}(-R[1-9][0-9]*)?$');

ALTER TABLE "purchases" DROP CONSTRAINT "purchases_number_format";
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_number_format" CHECK ("number" ~ '^PUR/[0-9]{4}-[0-9]{2}/[0-9]{4,}(-R[1-9][0-9]*)?$');

-- Commit-time check: if replaces_id is set, the replaced document must have a REPLACED void pointing to this row
CREATE FUNCTION sales_replace_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."replaces_id" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "document_voids"
      WHERE "sale_id" = NEW."replaces_id"
        AND "kind" = 'REPLACED'
        AND "replaced_by_sale_id" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'sale % replaces % but no corresponding REPLACED void found', NEW."id", NEW."replaces_id";
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER sales_replace_consistent AFTER INSERT ON "sales"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales_replace_consistent();

CREATE FUNCTION purchases_replace_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."replaces_id" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "document_voids"
      WHERE "purchase_id" = NEW."replaces_id"
        AND "kind" = 'REPLACED'
        AND "replaced_by_purchase_id" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'purchase % replaces % but no corresponding REPLACED void found', NEW."id", NEW."replaces_id";
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER purchases_replace_consistent AFTER INSERT ON "purchases"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION purchases_replace_consistent();
