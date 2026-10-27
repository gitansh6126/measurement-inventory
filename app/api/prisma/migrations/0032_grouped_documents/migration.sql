-- 0032 Sets on documents (V3.1 grouped products phase 2, plan §3 / §5).
--
-- A purchase (later: sale) line of a grouped product holds whole sets: line quantity = number of
-- sets, line price = rate of each of those sets. The line's own variation never moves stock
-- (0031 stock_movements_not_grouped); its sets' parts do, with the document's purchase_id /
-- sale_id. Sets with different rates go on separate lines of the same grouped product.

-- 1. A grouped product may appear on several lines of one document (one line per set rate).
CREATE OR REPLACE FUNCTION document_lines_one_per_counted_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  dup boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
    WHERE v."id" = NEW."variation_id" AND g."product_type"::text IN ('measured', 'grouped')
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'sale_lines' THEN
    SELECT EXISTS (SELECT 1 FROM "sale_lines" WHERE "sale_id" = NEW."sale_id" AND "variation_id" = NEW."variation_id") INTO dup;
  ELSE
    SELECT EXISTS (SELECT 1 FROM "purchase_lines" WHERE "purchase_id" = NEW."purchase_id" AND "variation_id" = NEW."variation_id") INTO dup;
  END IF;
  IF dup THEN
    RAISE EXCEPTION 'DUPLICATE_LINE: variation % appears twice in one document', NEW."variation_id";
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Commit-time document check (0004) with sets: the stock movements of a document equal its
-- ordinary lines plus the parts of the sets on its grouped lines (purchase: every part the sets
-- were bought with; sale: the parts sold), per variation; and every grouped line's quantity
-- equals the number of sets on that line.
CREATE OR REPLACE FUNCTION documents_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_table text := CASE TG_TABLE_NAME WHEN 'sales' THEN 'sale_lines' ELSE 'purchase_lines' END;
  fk text := CASE TG_TABLE_NAME WHEN 'sales' THEN 'sale_id' ELSE 'purchase_id' END;
  set_line text := CASE TG_TABLE_NAME WHEN 'sales' THEN 'sale_line_no' ELSE 'purchase_line_no' END;
  part_filter text := CASE TG_TABLE_NAME WHEN 'sales' THEN 'p.status = ''SOLD''' ELSE 'TRUE' END;
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
  -- Grouped lines: quantity = number of sets on the line.
  EXECUTE format(
    'SELECT count(*) FROM %I l
       JOIN product_variations v ON v.id = l.variation_id
       JOIN product_groups g ON g.id = v.group_id AND g.product_type::text = ''grouped''
     WHERE l.%I = $1 AND l.quantity <> (SELECT count(*) FROM group_sets s WHERE s.%I = $1 AND s.%I = l.line_no)',
    line_table, fk, fk, set_line)
    INTO bad USING NEW.id;
  IF bad > 0 THEN
    RAISE EXCEPTION '% % set lines do not match their sets', TG_TABLE_NAME, NEW.number;
  END IF;
  EXECUTE format(
    'SELECT count(*) FROM (
       SELECT variation_id, sum(q) AS q FROM (
         SELECT l.variation_id, l.quantity * $3 AS q FROM %I l
           JOIN product_variations v ON v.id = l.variation_id
           JOIN product_groups g ON g.id = v.group_id
         WHERE l.%I = $1 AND g.product_type::text <> ''grouped''
         UNION ALL
         SELECT p.variation_id, p.quantity * $3 FROM group_set_parts p
           JOIN group_sets s ON s.id = p.set_id
         WHERE s.%I = $1 AND %s
       ) x GROUP BY variation_id
     ) l FULL JOIN (
       SELECT variation_id, sum(quantity) AS q FROM stock_movements
       WHERE %I = $1 AND company_id = $2 AND movement_type::text IN (''SALE'', ''PURCHASE'')
       GROUP BY variation_id
     ) m USING (variation_id)
     WHERE l.q IS DISTINCT FROM m.q', line_table, fk, fk, part_filter, fk)
    INTO bad USING NEW.id, NEW.company_id, sign;
  IF bad > 0 THEN
    RAISE EXCEPTION '% % stock movements do not match its lines', TG_TABLE_NAME, NEW.number;
  END IF;
  RETURN NULL;
END;
$$;
