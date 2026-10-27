-- Audit B04: at most one OPENING movement per variation (decision D17: opening stock once,
-- later corrections are adjustments). The API also locks the variation before checking;
-- this index is the guarantee for every path.
--
-- Existing duplicates are never changed automatically: the migration stops with a clear
-- message so an operator can review them (correct with ADJUSTMENT movements, then re-run).
DO $$
DECLARE
  dup int;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT variation_id FROM "stock_movements" WHERE "movement_type" = 'OPENING'
    GROUP BY variation_id HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION '0006_opening_once: % variation(s) already have more than one OPENING movement; review before migrating', dup;
  END IF;
END $$;

CREATE UNIQUE INDEX "stock_movements_one_opening_per_variation"
  ON "stock_movements" ("variation_id") WHERE "movement_type" = 'OPENING';
