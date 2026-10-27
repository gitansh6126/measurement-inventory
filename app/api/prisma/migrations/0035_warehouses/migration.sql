-- 0035 Basic warehousing (V3.1, docs\WAREHOUSE-V3-PLAN.md §2).
--
-- Warehousing is OFF for a company until an admin creates its first warehouse (WH-0, WH-1). Off:
-- every warehouse column stays NULL and stock works exactly as before. On: every stock movement,
-- measured piece and set names a warehouse, and
--     stock_balances.quantity (company total) = SUM(warehouse_stock_balances.quantity)   (WH-4)
-- This migration changes no data; lib\warehouses.ts enableWarehousing() switches a company on.
--
-- Plan deviation (recorded in the plan): a sale / purchase line's warehouse split is not a
-- separate table. A counted item appears once per document, so its movements already are its
-- split (one movement per warehouse); measured lines follow their pieces and set lines their sets.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

ALTER TABLE "companies" ADD COLUMN "warehousing_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "warehouses" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_by" TEXT,
  CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "warehouses_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{0,9}$'),
  CONSTRAINT "warehouses_name_present" CHECK (btrim("name") <> '' AND length("name") <= 60),
  CONSTRAINT "warehouses_address_length" CHECK ("address" IS NULL OR length("address") <= 300),
  CONSTRAINT "warehouses_default_active" CHECK (NOT "is_default" OR "active")
);
CREATE UNIQUE INDEX "warehouses_company_id_code_key" ON "warehouses"("company_id", "code");
CREATE UNIQUE INDEX "warehouses_company_name_ci_key" ON "warehouses"("company_id", lower("name"));
CREATE UNIQUE INDEX "warehouses_one_default" ON "warehouses"("company_id") WHERE "is_default";
CREATE UNIQUE INDEX "warehouses_id_company_key" ON "warehouses"("id", "company_id");
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Written only by the movement trigger, like stock_balances (0007).
CREATE TABLE "warehouse_stock_balances" (
  "variation_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "warehouse_stock_balances_pkey" PRIMARY KEY ("variation_id", "warehouse_id")
);
CREATE INDEX "warehouse_stock_balances_company_id_warehouse_id_quantity_idx" ON "warehouse_stock_balances"("company_id", "warehouse_id", "quantity");
ALTER TABLE "warehouse_stock_balances" ADD CONSTRAINT "warehouse_stock_balances_variation_same_company_fkey"
  FOREIGN KEY ("variation_id", "company_id") REFERENCES "product_variations" ("id", "company_id") ON DELETE CASCADE;
ALTER TABLE "warehouse_stock_balances" ADD CONSTRAINT "warehouse_stock_balances_warehouse_same_company_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses" ("id", "company_id") ON DELETE RESTRICT;

-- Shifts (WH-9, WH-10): append-only documents TRF/2026-27/0001.
CREATE TABLE "stock_transfers" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "transfer_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "from_warehouse_id" TEXT NOT NULL,
  "to_warehouse_id" TEXT NOT NULL,
  "notes" TEXT,
  "client_ref" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT NOT NULL,
  CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_transfers_two_warehouses" CHECK ("from_warehouse_id" <> "to_warehouse_id"),
  CONSTRAINT "stock_transfers_number_format" CHECK ("number" ~ '^TRF/[0-9]{4}-[0-9]{2}/[0-9]{4,}$'),
  CONSTRAINT "stock_transfers_notes_length" CHECK ("notes" IS NULL OR length("notes") <= 500)
);
CREATE UNIQUE INDEX "stock_transfers_company_id_number_key" ON "stock_transfers"("company_id", "number");
CREATE UNIQUE INDEX "stock_transfers_company_id_client_ref_key" ON "stock_transfers"("company_id", "client_ref");
CREATE INDEX "stock_transfers_company_id_transfer_date_idx" ON "stock_transfers"("company_id", "transfer_date");
CREATE UNIQUE INDEX "stock_transfers_id_company_key" ON "stock_transfers"("id", "company_id");
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_same_company_fkey"
  FOREIGN KEY ("from_warehouse_id", "company_id") REFERENCES "warehouses" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_same_company_fkey"
  FOREIGN KEY ("to_warehouse_id", "company_id") REFERENCES "warehouses" ("id", "company_id") ON DELETE RESTRICT;

-- One line per counted item, per whole piece (WH-11) or per whole set (GW-3).
CREATE TABLE "stock_transfer_lines" (
  "id" TEXT NOT NULL,
  "transfer_id" TEXT NOT NULL,
  "line_no" INTEGER NOT NULL,
  "variation_id" TEXT NOT NULL,
  "product_name_snapshot" TEXT NOT NULL,
  "short_name_snapshot" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "piece_id" TEXT,
  "set_id" TEXT,
  "note" TEXT,
  CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_transfer_lines_quantity_positive" CHECK ("quantity" > 0 AND "line_no" > 0),
  CONSTRAINT "stock_transfer_lines_kind" CHECK ("piece_id" IS NULL OR "set_id" IS NULL),
  CONSTRAINT "stock_transfer_lines_set_one" CHECK ("set_id" IS NULL OR "quantity" = 1),
  CONSTRAINT "stock_transfer_lines_note_length" CHECK ("note" IS NULL OR length("note") <= 300)
);
CREATE UNIQUE INDEX "stock_transfer_lines_transfer_id_line_no_key" ON "stock_transfer_lines"("transfer_id", "line_no");
CREATE INDEX "stock_transfer_lines_variation_id_idx" ON "stock_transfer_lines"("variation_id");
CREATE INDEX "stock_transfer_lines_piece_id_idx" ON "stock_transfer_lines"("piece_id");
CREATE INDEX "stock_transfer_lines_set_id_idx" ON "stock_transfer_lines"("set_id");
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "product_variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "measurement_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "group_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_transfer_voids" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "transfer_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT NOT NULL,
  CONSTRAINT "stock_transfer_voids_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_transfer_voids_reason_present" CHECK (btrim("reason") <> '' AND length("reason") <= 300)
);
CREATE UNIQUE INDEX "stock_transfer_voids_transfer_id_key" ON "stock_transfer_voids"("transfer_id");
ALTER TABLE "stock_transfer_voids" ADD CONSTRAINT "stock_transfer_voids_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_voids" ADD CONSTRAINT "stock_transfer_voids_transfer_same_company_fkey"
  FOREIGN KEY ("transfer_id", "company_id") REFERENCES "stock_transfers" ("id", "company_id") ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- New columns
-- ---------------------------------------------------------------------------

ALTER TABLE "stock_movements" ADD COLUMN "warehouse_id" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "transfer_id" TEXT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_same_company_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_same_company_fkey"
  FOREIGN KEY ("transfer_id", "company_id") REFERENCES "stock_transfers" ("id", "company_id") ON DELETE RESTRICT;
CREATE INDEX "stock_movements_transfer_id_idx" ON "stock_movements"("transfer_id");
CREATE INDEX "stock_movements_variation_id_warehouse_id_idx" ON "stock_movements"("variation_id", "warehouse_id");

ALTER TABLE "measurement_pieces" ADD COLUMN "warehouse_id" TEXT;
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_warehouse_same_company_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses" ("id", "company_id") ON DELETE RESTRICT;
CREATE INDEX "measurement_pieces_warehouse_id_idx" ON "measurement_pieces"("warehouse_id");

ALTER TABLE "measurement_piece_ledger" ADD COLUMN "warehouse_id" TEXT;
ALTER TABLE "measurement_piece_ledger" ADD COLUMN "to_warehouse_id" TEXT;
ALTER TABLE "measurement_piece_ledger" ADD COLUMN "transfer_id" TEXT;
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- group_sets.warehouse_id exists since 0031 (always NULL so far).
ALTER TABLE "group_sets" ADD CONSTRAINT "group_sets_warehouse_same_company_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses" ("id", "company_id") ON DELETE RESTRICT;
CREATE INDEX "group_sets_warehouse_id_idx" ON "group_sets"("warehouse_id");

-- Purchase order: preferred "Receive into" (WH-13). Sale order line: saved Take-from split,
-- [{"warehouseId": "...", "quantity": 3}], NULL = decide at delivery. Re-checked on delivery.
ALTER TABLE "orders" ADD COLUMN "warehouse_id" TEXT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_warehouse_same_company_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "order_lines" ADD COLUMN "splits" JSONB;
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_splits_array" CHECK ("splits" IS NULL OR jsonb_typeof("splits") = 'array');

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_direction";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_direction" CHECK (
  ("movement_type"::text IN ('OPENING', 'PURCHASE', 'SALE_VOID', 'TRANSFER_IN') AND "quantity" > 0)
  OR ("movement_type"::text IN ('SALE', 'PURCHASE_VOID', 'TRANSFER_OUT') AND "quantity" < 0)
  OR ("movement_type"::text IN ('ADJUSTMENT', 'TRANSFER_VOID'))
);
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_document_link";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_document_link" CHECK (
  ("movement_type"::text IN ('SALE', 'SALE_VOID') AND "sale_id" IS NOT NULL AND "purchase_id" IS NULL AND "transfer_id" IS NULL)
  OR ("movement_type"::text IN ('PURCHASE', 'PURCHASE_VOID') AND "purchase_id" IS NOT NULL AND "sale_id" IS NULL AND "transfer_id" IS NULL)
  OR ("movement_type"::text IN ('OPENING', 'ADJUSTMENT') AND "sale_id" IS NULL AND "purchase_id" IS NULL AND "transfer_id" IS NULL)
  OR ("movement_type"::text IN ('TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_VOID') AND "transfer_id" IS NOT NULL
      AND "warehouse_id" IS NOT NULL AND "sale_id" IS NULL AND "purchase_id" IS NULL)
);

-- Opening stock once per item per warehouse (WH-12). Off: warehouse_id is NULL, same as 0006.
DROP INDEX "stock_movements_one_opening_per_variation";
CREATE UNIQUE INDEX "stock_movements_one_opening_per_variation"
  ON "stock_movements" ("variation_id", COALESCE("warehouse_id", '')) WHERE "movement_type" = 'OPENING';

ALTER TABLE "measurement_piece_ledger" DROP CONSTRAINT "measurement_piece_ledger_links";
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_links" CHECK (
  ("action"::text IN ('SALE', 'SALE_VOID') AND "sale_id" IS NOT NULL AND "purchase_id" IS NULL)
  OR ("action"::text IN ('RECEIVE', 'PURCHASE_VOID') AND "purchase_id" IS NOT NULL AND "sale_id" IS NULL)
  OR ("action"::text IN ('ADD', 'OPEN', 'CUT', 'WRITE_OFF', 'CORRECTION', 'EDIT') AND "sale_id" IS NULL AND "purchase_id" IS NULL)
  OR ("action"::text IN ('SET_ALLOCATE', 'SET_RELEASE') AND "purchase_id" IS NULL AND "change" = 0)
  OR ("action"::text IN ('TRANSFER', 'TRANSFER_VOID') AND "transfer_id" IS NOT NULL AND "to_warehouse_id" IS NOT NULL
      AND "sale_id" IS NULL AND "purchase_id" IS NULL AND "change" = 0));

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- 1. Balances: the company total as before, plus the warehouse balance when the movement names one.
CREATE OR REPLACE FUNCTION stock_balances_maintain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "stock_balances" ("variation_id", "company_id", "quantity", "updated_at")
    VALUES (NEW."variation_id", NEW."company_id", NEW."quantity", CURRENT_TIMESTAMP)
    ON CONFLICT ("variation_id") DO UPDATE
      SET "quantity" = "stock_balances"."quantity" + EXCLUDED."quantity", "updated_at" = CURRENT_TIMESTAMP;
    IF NEW."warehouse_id" IS NOT NULL THEN
      INSERT INTO "warehouse_stock_balances" ("variation_id", "warehouse_id", "company_id", "quantity", "updated_at")
      VALUES (NEW."variation_id", NEW."warehouse_id", NEW."company_id", NEW."quantity", CURRENT_TIMESTAMP)
      ON CONFLICT ("variation_id", "warehouse_id") DO UPDATE
        SET "quantity" = "warehouse_stock_balances"."quantity" + EXCLUDED."quantity", "updated_at" = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
  END IF;
  UPDATE "stock_balances" SET "quantity" = "quantity" - OLD."quantity", "updated_at" = CURRENT_TIMESTAMP
  WHERE "variation_id" = OLD."variation_id";
  IF OLD."warehouse_id" IS NOT NULL THEN
    UPDATE "warehouse_stock_balances" SET "quantity" = "quantity" - OLD."quantity", "updated_at" = CURRENT_TIMESTAMP
    WHERE "variation_id" = OLD."variation_id" AND "warehouse_id" = OLD."warehouse_id";
  END IF;
  RETURN OLD;
END;
$$;

-- 2. Stock check (same trigger name as 0003). With a warehouse it checks that warehouse's balance.
-- Below zero stays possible only for a counted SALE (the API allows it only when the company total
-- is short too, WH-6a); a shift (TRANSFER_OUT) or any other movement never goes below zero.
CREATE OR REPLACE FUNCTION stock_movements_no_negative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  balance numeric;
  measured boolean;
BEGIN
  PERFORM 1 FROM "product_variations" WHERE "id" = NEW."variation_id" FOR UPDATE;
  IF NEW."quantity" >= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW."warehouse_id" IS NOT NULL THEN
    SELECT COALESCE((SELECT "quantity" FROM "warehouse_stock_balances"
                     WHERE "variation_id" = NEW."variation_id" AND "warehouse_id" = NEW."warehouse_id"), 0) INTO balance;
  ELSE
    SELECT COALESCE((SELECT "quantity" FROM "stock_balances" WHERE "variation_id" = NEW."variation_id"), 0) INTO balance;
  END IF;
  IF balance + NEW."quantity" < 0 THEN
    SELECT g."product_type" = 'measured' INTO measured
      FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id" WHERE v."id" = NEW."variation_id";
    IF NEW."movement_type" <> 'SALE' OR measured THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % available, % requested', balance, -NEW."quantity";
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Warehousing on / off (WH-0, WH-1): with warehousing on, a movement, piece or set names a
-- warehouse of its company (a new piece or set an active one); off, it names none. A cut piece
-- made without one takes its parent roll's warehouse.
CREATE FUNCTION warehouse_on_off() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  enabled boolean;
  is_active boolean;
BEGIN
  SELECT "warehousing_enabled" INTO enabled FROM "companies" WHERE "id" = NEW."company_id";
  -- Nested IFs: a record field is resolved when the expression runs, and only pieces have parent_id.
  IF TG_TABLE_NAME = 'measurement_pieces' THEN
    IF enabled AND NEW."warehouse_id" IS NULL AND NEW."parent_id" IS NOT NULL THEN
      SELECT "warehouse_id" INTO NEW."warehouse_id" FROM "measurement_pieces" WHERE "id" = NEW."parent_id";
    END IF;
  END IF;
  IF NOT enabled AND NEW."warehouse_id" IS NOT NULL THEN
    RAISE EXCEPTION 'WAREHOUSING_OFF: % names a warehouse but warehousing is off', TG_TABLE_NAME;
  END IF;
  IF enabled AND NEW."warehouse_id" IS NULL THEN
    RAISE EXCEPTION 'WAREHOUSE_REQUIRED: % needs a warehouse (warehousing is on)', TG_TABLE_NAME;
  END IF;
  IF enabled AND TG_OP = 'INSERT' AND TG_TABLE_NAME <> 'stock_movements' THEN
    SELECT "active" INTO is_active FROM "warehouses" WHERE "id" = NEW."warehouse_id";
    IF NOT is_active THEN
      RAISE EXCEPTION 'WAREHOUSE_INACTIVE: that warehouse is inactive';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_movements_warehouse_on_off BEFORE INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION warehouse_on_off();
CREATE TRIGGER measurement_pieces_warehouse_on_off BEFORE INSERT OR UPDATE OF "warehouse_id" ON "measurement_pieces"
  FOR EACH ROW EXECUTE FUNCTION warehouse_on_off();
CREATE TRIGGER group_sets_warehouse_on_off BEFORE INSERT OR UPDATE OF "warehouse_id" ON "group_sets"
  FOR EACH ROW EXECUTE FUNCTION warehouse_on_off();

-- 4. Movements stay append-only; the one allowed change is enableWarehousing() naming the first
-- warehouse on a movement that had none (nothing else on the row may change).
CREATE OR REPLACE FUNCTION stock_movements_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."warehouse_id" IS NULL AND NEW."warehouse_id" IS NOT NULL
       AND (to_jsonb(OLD) - 'warehouse_id') = (to_jsonb(NEW) - 'warehouse_id') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'stock_movements is append-only (% blocked)', TG_OP;
END;
$$;

-- 5. Measured (0021): with warehousing on, the active pieces in each warehouse also equal that
-- warehouse's balance.
CREATE OR REPLACE FUNCTION measured_stock_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pieces numeric;
  stock numeric;
  bad text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
    WHERE v."id" = NEW."variation_id" AND g."product_type" = 'measured'
  ) THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM("remaining_length"), 0) INTO pieces FROM "measurement_pieces"
    WHERE "variation_id" = NEW."variation_id" AND "status" = 'ACTIVE';
  SELECT COALESCE((SELECT "quantity" FROM "stock_balances" WHERE "variation_id" = NEW."variation_id"), 0) INTO stock;
  IF pieces <> stock THEN
    RAISE EXCEPTION 'MEASURED_MISMATCH: rolls hold % but stock is % for variation %', pieces, stock, NEW."variation_id";
  END IF;
  IF (SELECT "warehousing_enabled" FROM "companies" WHERE "id" = NEW."company_id") THEN
    SELECT COALESCE(p.w, b.w) INTO bad FROM
      (SELECT "warehouse_id" AS w, SUM("remaining_length") AS q FROM "measurement_pieces"
        WHERE "variation_id" = NEW."variation_id" AND "status" = 'ACTIVE' GROUP BY "warehouse_id") p
      FULL JOIN
      (SELECT "warehouse_id" AS w, "quantity" AS q FROM "warehouse_stock_balances"
        WHERE "variation_id" = NEW."variation_id") b ON b.w = p.w
    WHERE COALESCE(p.q, 0) <> COALESCE(b.q, 0) LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'MEASURED_MISMATCH: rolls in warehouse % do not match its stock for variation %', bad, NEW."variation_id";
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- 6. Sets (0031 check 1): free stock never below zero, per warehouse when warehousing is on
-- (GW-4); a set's pieces are in the set's warehouse (GW-1). Also fired when a set is shifted.
CREATE OR REPLACE FUNCTION set_parts_free_stock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  in_sets NUMERIC;
  stock NUMERIC;
  bad TEXT;
  vid TEXT;
  vids TEXT[];
BEGIN
  IF TG_TABLE_NAME = 'group_sets' THEN
    SELECT array_agg(DISTINCT p."variation_id") INTO vids FROM "group_set_parts" p
      WHERE p."set_id" = NEW."id" AND p."status" = 'ALLOCATED';
  ELSE
    vids := ARRAY[NEW."variation_id"];
  END IF;
  FOREACH vid IN ARRAY COALESCE(vids, '{}'::text[])
  LOOP
    SELECT COALESCE(SUM("quantity"), 0) INTO in_sets FROM "group_set_parts"
      WHERE "variation_id" = vid AND "status" = 'ALLOCATED';
    CONTINUE WHEN in_sets = 0;
    SELECT COALESCE((SELECT "quantity" FROM "stock_balances" WHERE "variation_id" = vid), 0) INTO stock;
    IF stock < in_sets THEN
      RAISE EXCEPTION 'PARTS_IN_SETS: % in stock but % is inside sets for variation %', stock, in_sets, vid;
    END IF;
    SELECT w."code" INTO bad FROM (
      SELECT s."warehouse_id", SUM(p."quantity") AS q FROM "group_set_parts" p JOIN "group_sets" s ON s."id" = p."set_id"
      WHERE p."variation_id" = vid AND p."status" = 'ALLOCATED' AND s."warehouse_id" IS NOT NULL
      GROUP BY s."warehouse_id"
    ) a JOIN "warehouses" w ON w."id" = a."warehouse_id"
    LEFT JOIN "warehouse_stock_balances" b ON b."variation_id" = vid AND b."warehouse_id" = a."warehouse_id"
    WHERE COALESCE(b."quantity", 0) < a.q LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'PARTS_IN_SETS: warehouse % holds less than its sets need for variation %', bad, vid;
    END IF;
  END LOOP;
  IF TG_TABLE_NAME = 'group_sets' THEN
    IF EXISTS (SELECT 1 FROM "measurement_pieces" mp WHERE mp."set_id" = NEW."id" AND mp."warehouse_id" IS DISTINCT FROM NEW."warehouse_id") THEN
      RAISE EXCEPTION 'SET_WAREHOUSE: set % and its pieces are in different warehouses', NEW."code";
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER group_sets_free_stock AFTER INSERT OR UPDATE OF "warehouse_id", "status" ON "group_sets"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION set_parts_free_stock();

-- 7. A shift moves exactly its lines out of From and into To; a cancel reverses it exactly.
CREATE FUNCTION stock_transfers_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t RECORD;
  bad int;
BEGIN
  IF TG_TABLE_NAME = 'stock_transfers' THEN
    SELECT * INTO t FROM "stock_transfers" WHERE "id" = NEW."id";
  ELSE
    SELECT * INTO t FROM "stock_transfers" WHERE "id" = NEW."transfer_id";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "stock_transfer_lines" WHERE "transfer_id" = t."id") THEN
    RAISE EXCEPTION 'TRANSFER_EMPTY: shift % has no lines', t."number";
  END IF;
  IF TG_TABLE_NAME = 'stock_transfers' THEN
    -- Expected per variation: ordinary and piece lines, plus the parts of each set line.
    SELECT count(*) INTO bad FROM (
      SELECT variation_id, sum(q) AS q FROM (
        SELECT l."variation_id", l."quantity" AS q FROM "stock_transfer_lines" l
          WHERE l."transfer_id" = t."id" AND l."set_id" IS NULL
        UNION ALL
        SELECT p."variation_id", p."quantity" FROM "stock_transfer_lines" l
          JOIN "group_set_parts" p ON p."set_id" = l."set_id" AND p."status" = 'ALLOCATED'
          WHERE l."transfer_id" = t."id"
      ) x GROUP BY variation_id
    ) e FULL JOIN (
      SELECT "variation_id",
             SUM(CASE WHEN "movement_type" = 'TRANSFER_OUT' AND "warehouse_id" = t."from_warehouse_id" THEN -"quantity" END) AS o,
             SUM(CASE WHEN "movement_type" = 'TRANSFER_IN' AND "warehouse_id" = t."to_warehouse_id" THEN "quantity" END) AS i,
             COUNT(*) FILTER (WHERE "movement_type"::text IN ('TRANSFER_OUT', 'TRANSFER_IN')
                                AND "warehouse_id" NOT IN (t."from_warehouse_id", t."to_warehouse_id")) AS stray
      FROM "stock_movements" WHERE "transfer_id" = t."id" AND "movement_type"::text IN ('TRANSFER_OUT', 'TRANSFER_IN')
      GROUP BY "variation_id"
    ) m USING (variation_id)
    WHERE e.q IS DISTINCT FROM m.o OR e.q IS DISTINCT FROM m.i OR m.stray > 0;
    IF bad > 0 THEN
      RAISE EXCEPTION 'TRANSFER_MISMATCH: shift % stock movements do not match its lines', t."number";
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM "stock_transfer_voids" WHERE "transfer_id" = t."id") THEN
    SELECT count(*) INTO bad FROM (
      SELECT "variation_id", "warehouse_id" FROM "stock_movements" WHERE "transfer_id" = t."id"
      GROUP BY "variation_id", "warehouse_id" HAVING SUM("quantity") <> 0
    ) x;
    IF bad > 0 THEN
      RAISE EXCEPTION 'TRANSFER_VOID_MISMATCH: cancelling shift % does not exactly reverse it', t."number";
    END IF;
  ELSIF EXISTS (SELECT 1 FROM "stock_movements" WHERE "transfer_id" = t."id" AND "movement_type"::text = 'TRANSFER_VOID') THEN
    RAISE EXCEPTION 'TRANSFER_VOID_MISMATCH: shift % has cancel movements but no cancel record', t."number";
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER stock_transfers_consistent AFTER INSERT ON "stock_transfers"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stock_transfers_consistent();
CREATE CONSTRAINT TRIGGER stock_transfer_voids_consistent AFTER INSERT ON "stock_transfer_voids"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stock_transfers_consistent();

-- 8. A sale / purchase void reverses each warehouse's part exactly (WH-7); 0010 checked per item.
CREATE OR REPLACE FUNCTION document_voids_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bad int;
BEGIN
  IF NEW."sale_id" IS NOT NULL THEN
    SELECT count(*) INTO bad FROM (
      SELECT "variation_id", "warehouse_id",
             SUM("quantity") FILTER (WHERE "movement_type" = 'SALE') AS d,
             SUM("quantity") FILTER (WHERE "movement_type" = 'SALE_VOID') AS v
      FROM "stock_movements" WHERE "sale_id" = NEW."sale_id" GROUP BY "variation_id", "warehouse_id"
    ) t WHERE COALESCE(t.d, 0) + COALESCE(t.v, 0) <> 0 OR t.v IS NULL;
  ELSE
    SELECT count(*) INTO bad FROM (
      SELECT "variation_id", "warehouse_id",
             SUM("quantity") FILTER (WHERE "movement_type" = 'PURCHASE') AS d,
             SUM("quantity") FILTER (WHERE "movement_type" = 'PURCHASE_VOID') AS v
      FROM "stock_movements" WHERE "purchase_id" = NEW."purchase_id" GROUP BY "variation_id", "warehouse_id"
    ) t WHERE COALESCE(t.d, 0) + COALESCE(t.v, 0) <> 0 OR t.v IS NULL;
  END IF;
  IF bad > 0 THEN
    RAISE EXCEPTION 'void % does not exactly reverse the document stock movements', NEW."id";
  END IF;
  RETURN NULL;
END;
$$;

-- 9. Shifts are append-only (fixed by a cancel or a shift back, WH-10).
CREATE FUNCTION stock_transfers_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never changed (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$;
CREATE TRIGGER stock_transfers_no_update_delete BEFORE UPDATE OR DELETE ON "stock_transfers" FOR EACH ROW EXECUTE FUNCTION stock_transfers_append_only();
CREATE TRIGGER stock_transfers_no_truncate BEFORE TRUNCATE ON "stock_transfers" FOR EACH STATEMENT EXECUTE FUNCTION stock_transfers_append_only();
CREATE TRIGGER stock_transfer_lines_no_update_delete BEFORE UPDATE OR DELETE ON "stock_transfer_lines" FOR EACH ROW EXECUTE FUNCTION stock_transfers_append_only();
CREATE TRIGGER stock_transfer_lines_no_truncate BEFORE TRUNCATE ON "stock_transfer_lines" FOR EACH STATEMENT EXECUTE FUNCTION stock_transfers_append_only();
CREATE TRIGGER stock_transfer_voids_no_update_delete BEFORE UPDATE OR DELETE ON "stock_transfer_voids" FOR EACH ROW EXECUTE FUNCTION stock_transfers_append_only();
CREATE TRIGGER stock_transfer_voids_no_truncate BEFORE TRUNCATE ON "stock_transfer_voids" FOR EACH STATEMENT EXECUTE FUNCTION stock_transfers_append_only();

-- ---------------------------------------------------------------------------
-- Drift views (must return 0 rows)
-- ---------------------------------------------------------------------------

-- Stored warehouse balance vs the ledger.
CREATE VIEW "warehouse_balance_drift" AS
SELECT COALESCE(b."variation_id", s."variation_id") AS "variation_id",
       COALESCE(b."warehouse_id", s."warehouse_id") AS "warehouse_id",
       COALESCE(b."quantity", 0) AS "stored_balance",
       COALESCE(s."total", 0) AS "calculated_sum"
FROM "warehouse_stock_balances" b
FULL JOIN (SELECT "variation_id", "warehouse_id", SUM("quantity") AS "total" FROM "stock_movements"
           WHERE "warehouse_id" IS NOT NULL GROUP BY "variation_id", "warehouse_id") s
  ON s."variation_id" = b."variation_id" AND s."warehouse_id" = b."warehouse_id"
WHERE COALESCE(b."quantity", 0) <> COALESCE(s."total", 0);

-- Company total vs the sum of its warehouses (warehousing on only).
CREATE VIEW "warehouse_total_drift" AS
SELECT b."variation_id", b."company_id", b."quantity" AS "company_total", COALESCE(w."total", 0) AS "warehouse_sum"
FROM "stock_balances" b
JOIN "companies" c ON c."id" = b."company_id" AND c."warehousing_enabled"
LEFT JOIN (SELECT "variation_id", SUM("quantity") AS "total" FROM "warehouse_stock_balances" GROUP BY "variation_id") w
  ON w."variation_id" = b."variation_id"
WHERE b."quantity" <> COALESCE(w."total", 0);
