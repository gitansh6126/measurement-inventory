-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "purchase_id" TEXT,
ADD COLUMN     "sale_id" TEXT;

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "type" "PartyType" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "sale_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "party_id" TEXT,
    "party_name" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "client_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variation_id" TEXT NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "short_name_snapshot" TEXT NOT NULL,
    "official_sku_snapshot" TEXT,
    "attributes_snapshot" JSONB NOT NULL DEFAULT '{}',
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "purchase_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "party_id" TEXT,
    "party_name" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "client_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variation_id" TEXT NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "short_name_snapshot" TEXT NOT NULL,
    "official_sku_snapshot" TEXT,
    "attributes_snapshot" JSONB NOT NULL DEFAULT '{}',
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parties_company_id_type_idx" ON "parties"("company_id", "type");

-- CreateIndex
CREATE INDEX "sales_company_id_sale_date_idx" ON "sales"("company_id", "sale_date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_company_id_number_key" ON "sales"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_company_id_client_ref_key" ON "sales"("company_id", "client_ref");

-- CreateIndex
CREATE INDEX "sale_lines_variation_id_idx" ON "sale_lines"("variation_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_lines_sale_id_line_no_key" ON "sale_lines"("sale_id", "line_no");

-- CreateIndex
CREATE INDEX "purchases_company_id_purchase_date_idx" ON "purchases"("company_id", "purchase_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_company_id_number_key" ON "purchases"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_company_id_client_ref_key" ON "purchases"("company_id", "client_ref");

-- CreateIndex
CREATE INDEX "purchase_lines_variation_id_idx" ON "purchase_lines"("variation_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_lines_purchase_id_line_no_key" ON "purchase_lines"("purchase_id", "line_no");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "product_variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "product_variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants (not expressible in schema.prisma)
-- ---------------------------------------------------------------------------

-- Parties: trimmed names, unique per company case-insensitively (D20), same-company references.
ALTER TABLE "parties" ADD CONSTRAINT "parties_name_trimmed" CHECK ("name" = btrim("name") AND "name" <> '');
CREATE UNIQUE INDEX "parties_company_name_ci_key" ON "parties" ("company_id", lower("name"));
CREATE UNIQUE INDEX "parties_id_company_key" ON "parties" ("id", "company_id");
ALTER TABLE "sales" ADD CONSTRAINT "sales_party_same_company_fkey"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_party_same_company_fkey"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties" ("id", "company_id") ON DELETE RESTRICT;

-- Numbers (D7), status, money.
ALTER TABLE "sales" ADD CONSTRAINT "sales_number_format" CHECK ("number" ~ '^SAL/[0-9]{4}-[0-9]{2}/[0-9]{4,}$');
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_number_format" CHECK ("number" ~ '^PUR/[0-9]{4}-[0-9]{2}/[0-9]{4,}$');
ALTER TABLE "sales" ADD CONSTRAINT "sales_status_known" CHECK ("status" IN ('COMPLETED'));
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_status_known" CHECK ("status" IN ('COMPLETED'));
ALTER TABLE "sales" ADD CONSTRAINT "sales_money_nonneg" CHECK ("subtotal" >= 0 AND "total" >= 0);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_money_nonneg" CHECK ("subtotal" >= 0 AND "total" >= 0);

-- Lines: positive whole quantity, non-negative price, exact line total (BR-01/BR-02).
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_amounts" CHECK (
  "line_no" > 0 AND "quantity" > 0 AND "unit_price" >= 0 AND "line_total" = "quantity" * "unit_price");
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_amounts" CHECK (
  "line_no" > 0 AND "quantity" > 0 AND "unit_cost" >= 0 AND "line_total" = "quantity" * "unit_cost");
CREATE UNIQUE INDEX "sale_lines_sale_variation_key" ON "sale_lines" ("sale_id", "variation_id");
CREATE UNIQUE INDEX "purchase_lines_purchase_variation_key" ON "purchase_lines" ("purchase_id", "variation_id");

-- A SALE movement belongs to exactly one sale, a PURCHASE movement to one purchase; others to neither.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_document_link" CHECK (
  ("movement_type" = 'SALE' AND "sale_id" IS NOT NULL AND "purchase_id" IS NULL)
  OR ("movement_type" = 'PURCHASE' AND "purchase_id" IS NOT NULL AND "sale_id" IS NULL)
  OR ("movement_type" IN ('OPENING', 'ADJUSTMENT') AND "sale_id" IS NULL AND "purchase_id" IS NULL)
);

-- Commit-time consistency of every document (deferred, so it sees the whole transaction):
-- at least one line; subtotal = total = sum of line totals (no discounts in V1, D21);
-- every line's variation is in the document's company; and the document's stock
-- movements equal its lines per variation (sale: −qty, purchase: +qty).
CREATE FUNCTION documents_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_table text := CASE TG_TABLE_NAME WHEN 'sales' THEN 'sale_lines' ELSE 'purchase_lines' END;
  fk text := CASE TG_TABLE_NAME WHEN 'sales' THEN 'sale_id' ELSE 'purchase_id' END;
  sign int := CASE TG_TABLE_NAME WHEN 'sales' THEN -1 ELSE 1 END;
  line_count int;
  line_sum numeric;
  bad int;
BEGIN
  EXECUTE format('SELECT count(*), COALESCE(sum(line_total), 0) FROM %I WHERE %I = $1', line_table, fk)
    INTO line_count, line_sum USING NEW.id;
  IF line_count = 0 THEN
    RAISE EXCEPTION '% % has no lines', TG_TABLE_NAME, NEW.number;
  END IF;
  IF NEW.subtotal <> line_sum OR NEW.total <> NEW.subtotal THEN
    RAISE EXCEPTION '% % totals do not match its lines', TG_TABLE_NAME, NEW.number;
  END IF;
  EXECUTE format('SELECT count(*) FROM %I l JOIN product_variations v ON v.id = l.variation_id
                  WHERE l.%I = $1 AND v.company_id <> $2', line_table, fk)
    INTO bad USING NEW.id, NEW.company_id;
  IF bad > 0 THEN
    RAISE EXCEPTION '% % has lines from another company', TG_TABLE_NAME, NEW.number;
  END IF;
  EXECUTE format(
    'SELECT count(*) FROM (
       SELECT variation_id, sum(quantity) * $3 AS q FROM %I WHERE %I = $1 GROUP BY variation_id
     ) l FULL JOIN (
       SELECT variation_id, sum(quantity) AS q FROM stock_movements WHERE %I = $1 AND company_id = $2 GROUP BY variation_id
     ) m USING (variation_id)
     WHERE l.q IS DISTINCT FROM m.q', line_table, fk, fk)
    INTO bad USING NEW.id, NEW.company_id, sign;
  IF bad > 0 THEN
    RAISE EXCEPTION '% % stock movements do not match its lines', TG_TABLE_NAME, NEW.number;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER sales_consistent AFTER INSERT ON "sales"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION documents_consistent();
CREATE CONSTRAINT TRIGGER purchases_consistent AFTER INSERT ON "purchases"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION documents_consistent();

-- Documents and their lines are append-only (corrections arrive with void/return, deferred D3).
CREATE FUNCTION documents_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER sales_no_update_delete BEFORE UPDATE OR DELETE ON "sales" FOR EACH ROW EXECUTE FUNCTION documents_append_only();
CREATE TRIGGER sales_no_truncate BEFORE TRUNCATE ON "sales" FOR EACH STATEMENT EXECUTE FUNCTION documents_append_only();
CREATE TRIGGER sale_lines_no_update_delete BEFORE UPDATE OR DELETE ON "sale_lines" FOR EACH ROW EXECUTE FUNCTION documents_append_only();
CREATE TRIGGER sale_lines_no_truncate BEFORE TRUNCATE ON "sale_lines" FOR EACH STATEMENT EXECUTE FUNCTION documents_append_only();
CREATE TRIGGER purchases_no_update_delete BEFORE UPDATE OR DELETE ON "purchases" FOR EACH ROW EXECUTE FUNCTION documents_append_only();
CREATE TRIGGER purchases_no_truncate BEFORE TRUNCATE ON "purchases" FOR EACH STATEMENT EXECUTE FUNCTION documents_append_only();
CREATE TRIGGER purchase_lines_no_update_delete BEFORE UPDATE OR DELETE ON "purchase_lines" FOR EACH ROW EXECUTE FUNCTION documents_append_only();
CREATE TRIGGER purchase_lines_no_truncate BEFORE TRUNCATE ON "purchase_lines" FOR EACH STATEMENT EXECUTE FUNCTION documents_append_only();
