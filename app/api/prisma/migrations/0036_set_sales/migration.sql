-- 0036 Selling sets (V3.1 grouped products phase 3, docs\GROUPED-PRODUCTS-V3-PLAN.md §5).
--
-- A sale that changes a set's chain cuts a new piece, fits it in the set and sells it in the same
-- transaction. The deferred 0031 check ran on NEW, the row as it was when the event was queued
-- ("piece fitted in the set"), and so refused the commit although the piece and its part are by
-- then consistently sold. The check now reads each row as it is at commit; the rules are unchanged.

CREATE OR REPLACE FUNCTION set_part_piece_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sp "group_set_parts"%ROWTYPE;
  mp "measurement_pieces"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'group_set_parts' THEN
    SELECT * INTO sp FROM "group_set_parts" WHERE "id" = NEW."id";
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF sp."status" = 'ALLOCATED' AND sp."piece_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "measurement_pieces" p
      WHERE p."id" = sp."piece_id" AND p."set_id" = sp."set_id" AND p."variation_id" = sp."variation_id"
        AND p."status" = 'ACTIVE' AND p."remaining_length" = sp."quantity"
    ) THEN
      RAISE EXCEPTION 'SET_PART_PIECE: part % does not match its piece', sp."id";
    END IF;
    IF sp."status" = 'ALLOCATED' AND sp."piece_id" IS NULL AND EXISTS (
      SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
      WHERE v."id" = sp."variation_id" AND g."product_type"::text = 'measured'
    ) THEN
      RAISE EXCEPTION 'SET_PART_PIECE: a measured part needs its piece';
    END IF;
    IF sp."status" = 'ALLOCATED' AND sp."piece_id" IS NULL AND sp."quantity" <> 1 THEN
      RAISE EXCEPTION 'SET_PART_QUANTITY: a counted part is always 1 per set';
    END IF;
  ELSE
    SELECT * INTO mp FROM "measurement_pieces" WHERE "id" = NEW."id";
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF mp."set_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "group_set_parts" x
      WHERE x."piece_id" = mp."id" AND x."set_id" = mp."set_id" AND x."status" = 'ALLOCATED'
    ) THEN
      RAISE EXCEPTION 'SET_PART_PIECE: piece % is marked in a set without its part', mp."code";
    END IF;
  END IF;
  RETURN NULL;
END $$;
