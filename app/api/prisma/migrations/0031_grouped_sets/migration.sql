-- 0031 Grouped products (sets), V3.1 plan docs\GROUPED-PRODUCTS-V3-PLAN.md §1.
--
-- A grouped product (product_type 'grouped', one variation holding its SKU and set price) is a
-- set: one main component (a Simple product created with it and owned by it) plus linked
-- by-products (simple / variable / measured, required or optional). Each physical set is a
-- group_sets row; its parts stay in the normal stock of their own products and are only
-- marked as taken (group_set_parts ALLOCATED), so:
--     free stock (variation) = stock_balances.quantity − SUM(ALLOCATED part quantity)
-- Warehouses come later (warehouse_id stays NULL until then).

-- Main component owned by a grouped product (D2–D4).
ALTER TABLE "product_groups" ADD COLUMN "owner_group_id" TEXT;
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_owner_group_id_fkey"
  FOREIGN KEY ("owner_group_id") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "product_groups_owner_group_id_key" ON "product_groups"("owner_group_id");
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_owner_is_simple" CHECK (
  "owner_group_id" IS NULL OR ("product_type"::text = 'simple' AND "owner_group_id" <> "id")
);

CREATE TYPE "SetStatus" AS ENUM ('IN_STOCK', 'HELD', 'SOLD', 'CANCELLED');
CREATE TYPE "SetSource" AS ENUM ('PURCHASE', 'OPENING');
CREATE TYPE "PartRole" AS ENUM ('MAIN', 'BY');
CREATE TYPE "PartStatus" AS ENUM ('ALLOCATED', 'RELEASED', 'SOLD');
CREATE TYPE "PartChangeType" AS ENUM ('REPLACE', 'ADD', 'REMOVE');

-- By-product links (D5, D6). A removed link is inactive; sets keep their parts.
CREATE TABLE "group_byproducts" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  CONSTRAINT "group_byproducts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_byproducts_not_self" CHECK ("group_id" <> "product_id")
);
CREATE UNIQUE INDEX "group_byproducts_group_id_product_id_key" ON "group_byproducts"("group_id", "product_id");
CREATE INDEX "group_byproducts_product_id_idx" ON "group_byproducts"("product_id");
ALTER TABLE "group_byproducts" ADD CONSTRAINT "group_byproducts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_byproducts" ADD CONSTRAINT "group_byproducts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_byproducts" ADD CONSTRAINT "group_byproducts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One physical set (D8, D17).
CREATE TABLE "group_sets" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "warehouse_id" TEXT,
  "status" "SetStatus" NOT NULL DEFAULT 'IN_STOCK',
  "source" "SetSource" NOT NULL,
  "purchase_id" TEXT,
  "purchase_line_no" INTEGER,
  "rate" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "order_id" TEXT,
  "order_line_no" INTEGER,
  "sale_id" TEXT,
  "sale_line_no" INTEGER,
  "notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "group_sets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_sets_rate_nonneg" CHECK ("rate" >= 0),
  CONSTRAINT "group_sets_source_purchase" CHECK (("source" = 'PURCHASE') = ("purchase_id" IS NOT NULL)),
  CONSTRAINT "group_sets_sold_has_sale" CHECK (("status" = 'SOLD') = ("sale_id" IS NOT NULL)),
  CONSTRAINT "group_sets_held_has_order" CHECK ("status" <> 'HELD' OR "order_id" IS NOT NULL)
);
CREATE UNIQUE INDEX "group_sets_company_id_code_key" ON "group_sets"("company_id", "code");
CREATE INDEX "group_sets_company_id_group_id_status_idx" ON "group_sets"("company_id", "group_id", "status");
CREATE INDEX "group_sets_purchase_id_idx" ON "group_sets"("purchase_id");
CREATE INDEX "group_sets_sale_id_idx" ON "group_sets"("sale_id");
CREATE INDEX "group_sets_order_id_idx" ON "group_sets"("order_id");
ALTER TABLE "group_sets" ADD CONSTRAINT "group_sets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_sets" ADD CONSTRAINT "group_sets_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_sets" ADD CONSTRAINT "group_sets_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_sets" ADD CONSTRAINT "group_sets_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_sets" ADD CONSTRAINT "group_sets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Which physical part is in a set (no cost per part, D11).
CREATE TABLE "group_set_parts" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "set_id" TEXT NOT NULL,
  "role" "PartRole" NOT NULL,
  "byproduct_id" TEXT,
  "variation_id" TEXT NOT NULL,
  "piece_id" TEXT,
  "quantity" DECIMAL(14,3) NOT NULL,
  "status" "PartStatus" NOT NULL DEFAULT 'ALLOCATED',
  "allocated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMP(3),
  CONSTRAINT "group_set_parts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_set_parts_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "group_set_parts_role" CHECK (("role" = 'MAIN') = ("byproduct_id" IS NULL)),
  CONSTRAINT "group_set_parts_main_one" CHECK ("role" <> 'MAIN' OR ("quantity" = 1 AND "piece_id" IS NULL))
);
CREATE INDEX "group_set_parts_set_id_idx" ON "group_set_parts"("set_id");
CREATE INDEX "group_set_parts_variation_id_status_idx" ON "group_set_parts"("variation_id", "status");
CREATE UNIQUE INDEX "group_set_parts_one_main" ON "group_set_parts"("set_id") WHERE "status" = 'ALLOCATED' AND "role" = 'MAIN';
CREATE UNIQUE INDEX "group_set_parts_one_per_byproduct" ON "group_set_parts"("set_id", "byproduct_id") WHERE "status" = 'ALLOCATED' AND "role" = 'BY';
CREATE UNIQUE INDEX "group_set_parts_one_owner_per_piece" ON "group_set_parts"("piece_id") WHERE "status" = 'ALLOCATED' AND "piece_id" IS NOT NULL;
ALTER TABLE "group_set_parts" ADD CONSTRAINT "group_set_parts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_set_parts" ADD CONSTRAINT "group_set_parts_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "group_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_set_parts" ADD CONSTRAINT "group_set_parts_byproduct_id_fkey" FOREIGN KEY ("byproduct_id") REFERENCES "group_byproducts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_set_parts" ADD CONSTRAINT "group_set_parts_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "product_variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_set_parts" ADD CONSTRAINT "group_set_parts_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "measurement_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- History of every part change made in a sale (spec §10). Append-only.
CREATE TABLE "group_set_part_changes" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "set_id" TEXT NOT NULL,
  "sale_id" TEXT NOT NULL,
  "change_type" "PartChangeType" NOT NULL,
  "old_part_id" TEXT,
  "new_part_id" TEXT,
  "old_piece_id" TEXT,
  "new_source_piece_id" TEXT,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  CONSTRAINT "group_set_part_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_set_part_changes_parts" CHECK (
    ("change_type" = 'REPLACE' AND "old_part_id" IS NOT NULL AND "new_part_id" IS NOT NULL)
    OR ("change_type" = 'ADD' AND "old_part_id" IS NULL AND "new_part_id" IS NOT NULL)
    OR ("change_type" = 'REMOVE' AND "old_part_id" IS NOT NULL AND "new_part_id" IS NULL)
  )
);
CREATE INDEX "group_set_part_changes_set_id_idx" ON "group_set_part_changes"("set_id");
CREATE INDEX "group_set_part_changes_sale_id_idx" ON "group_set_part_changes"("sale_id");
ALTER TABLE "group_set_part_changes" ADD CONSTRAINT "group_set_part_changes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_set_part_changes" ADD CONSTRAINT "group_set_part_changes_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "group_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_set_part_changes" ADD CONSTRAINT "group_set_part_changes_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION group_set_part_changes_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'group_set_part_changes rows are never changed (% blocked)', TG_OP;
END $$;
CREATE TRIGGER group_set_part_changes_no_update_delete BEFORE UPDATE OR DELETE ON "group_set_part_changes"
  FOR EACH ROW EXECUTE FUNCTION group_set_part_changes_append_only();

-- A measured piece inside a set (NULL = free stock, pickers use free pieces only).
ALTER TABLE "measurement_pieces" ADD COLUMN "set_id" TEXT;
-- A chain bought or entered inside a set is a Cut piece with no parent roll (plan §3 step 4); it
-- keeps set_origin after it is released to free stock (D13). Every other Cut piece has a parent.
ALTER TABLE "measurement_pieces" ADD COLUMN "set_origin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "measurement_pieces" DROP CONSTRAINT "measurement_pieces_cut_has_parent";
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_cut_has_parent" CHECK (
  ("parent_id" IS NULL OR "kind" = 'CUT')
  AND ("kind" <> 'CUT' OR "parent_id" IS NOT NULL OR "set_origin")
  AND (NOT "set_origin" OR ("kind" = 'CUT' AND "parent_id" IS NULL))
);
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "group_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "measurement_pieces_set_id_idx" ON "measurement_pieces"("set_id");

-- Ledger rows for fitting a piece into / taking it out of a set (no length change); a release
-- made by a sale part change carries that sale.
ALTER TABLE "measurement_piece_ledger" DROP CONSTRAINT "measurement_piece_ledger_links";
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_links" CHECK (
  ("action" IN ('SALE', 'SALE_VOID') AND "sale_id" IS NOT NULL AND "purchase_id" IS NULL)
  OR ("action" IN ('RECEIVE', 'PURCHASE_VOID') AND "purchase_id" IS NOT NULL AND "sale_id" IS NULL)
  OR ("action" IN ('ADD', 'OPEN', 'CUT', 'WRITE_OFF', 'CORRECTION', 'EDIT') AND "sale_id" IS NULL AND "purchase_id" IS NULL)
  OR ("action" IN ('SET_ALLOCATE', 'SET_RELEASE') AND "purchase_id" IS NULL AND "change" = 0));

-- A grouped product never has stock of its own: its stock is its sets (plan §1 table).
CREATE FUNCTION stock_movements_not_grouped() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
    WHERE v."id" = NEW."variation_id" AND g."product_type"::text = 'grouped'
  ) THEN
    RAISE EXCEPTION 'GROUPED_NO_STOCK: a grouped product holds sets, not stock of its own';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_movements_not_grouped BEFORE INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_not_grouped();

-- Check 1 (plan §1.3): free stock never below zero, whatever the negative-stock policy.
-- Deferred: a set sale writes its SALE movements and marks its parts SOLD in one transaction.
CREATE FUNCTION set_parts_free_stock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  in_sets NUMERIC;
  stock NUMERIC;
BEGIN
  SELECT COALESCE(SUM("quantity"), 0) INTO in_sets FROM "group_set_parts"
    WHERE "variation_id" = NEW."variation_id" AND "status" = 'ALLOCATED';
  IF in_sets = 0 THEN RETURN NULL; END IF;
  SELECT COALESCE((SELECT "quantity" FROM "stock_balances" WHERE "variation_id" = NEW."variation_id"), 0) INTO stock;
  IF stock < in_sets THEN
    RAISE EXCEPTION 'PARTS_IN_SETS: % in stock but % is inside sets for variation %', stock, in_sets, NEW."variation_id";
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER stock_movements_set_parts_free AFTER INSERT ON "stock_movements"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION set_parts_free_stock();
CREATE CONSTRAINT TRIGGER group_set_parts_free_stock AFTER INSERT OR UPDATE ON "group_set_parts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION set_parts_free_stock();

-- Checks 2–3: an ALLOCATED measured part owns its piece exactly (same set, variation, length,
-- still active); a piece marked as in a set has that ALLOCATED part.
CREATE FUNCTION set_part_piece_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bad TEXT;
BEGIN
  IF TG_TABLE_NAME = 'group_set_parts' THEN
    IF NEW."status" = 'ALLOCATED' AND NEW."piece_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "measurement_pieces" p
      WHERE p."id" = NEW."piece_id" AND p."set_id" = NEW."set_id" AND p."variation_id" = NEW."variation_id"
        AND p."status" = 'ACTIVE' AND p."remaining_length" = NEW."quantity"
    ) THEN
      RAISE EXCEPTION 'SET_PART_PIECE: part % does not match its piece', NEW."id";
    END IF;
    IF NEW."status" = 'ALLOCATED' AND NEW."piece_id" IS NULL AND EXISTS (
      SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
      WHERE v."id" = NEW."variation_id" AND g."product_type"::text = 'measured'
    ) THEN
      RAISE EXCEPTION 'SET_PART_PIECE: a measured part needs its piece';
    END IF;
    IF NEW."status" = 'ALLOCATED' AND NEW."piece_id" IS NULL AND NEW."quantity" <> 1 THEN
      RAISE EXCEPTION 'SET_PART_QUANTITY: a counted part is always 1 per set';
    END IF;
  ELSE
    IF NEW."set_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "group_set_parts" sp
      WHERE sp."piece_id" = NEW."id" AND sp."set_id" = NEW."set_id" AND sp."status" = 'ALLOCATED'
    ) THEN
      bad := NEW."code";
      RAISE EXCEPTION 'SET_PART_PIECE: piece % is marked in a set without its part', bad;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER group_set_parts_piece_consistent AFTER INSERT OR UPDATE ON "group_set_parts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION set_part_piece_consistent();
CREATE CONSTRAINT TRIGGER measurement_pieces_set_consistent AFTER INSERT OR UPDATE ON "measurement_pieces"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION set_part_piece_consistent();

-- Drift check (plan §1.3 item 7): rows here mean a set and stock disagree.
CREATE VIEW "set_allocation_drift" AS
SELECT sp."company_id", sp."variation_id", SUM(sp."quantity") AS in_sets, COALESCE(MAX(b."quantity"), 0) AS stock
FROM "group_set_parts" sp
LEFT JOIN "stock_balances" b ON b."variation_id" = sp."variation_id"
WHERE sp."status" = 'ALLOCATED'
GROUP BY sp."company_id", sp."variation_id"
HAVING SUM(sp."quantity") > COALESCE(MAX(b."quantity"), 0);
