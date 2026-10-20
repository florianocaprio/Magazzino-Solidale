-- The Area is the operational boundary; the Centre is an optional reference.
-- Unknown legacy Areas are retained for explicit assignment, never made global.
ALTER TABLE volontari ADD COLUMN IF NOT EXISTS area_operativa_id integer
  REFERENCES aree_operative(id);
CREATE INDEX IF NOT EXISTS volontari_area_idx ON volontari(area_operativa_id);
UPDATE volontari v SET area_operativa_id = c.area_operativa_id
FROM centri_di_ascolto c WHERE v.centro_ascolto_id = c.id
  AND v.area_operativa_id IS NULL AND c.area_operativa_id IS NOT NULL;

-- Keep older writers/seeds compatible when a reference Centre has a known Area.
-- The API requires a known Area for new registrations and edits.
CREATE OR REPLACE FUNCTION volontari_reference_area_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE reference_area integer;
BEGIN
  IF NEW.centro_ascolto_id IS NOT NULL THEN
    SELECT area_operativa_id INTO reference_area FROM centri_di_ascolto
      WHERE id = NEW.centro_ascolto_id;
    IF NEW.area_operativa_id IS NULL THEN
      NEW.area_operativa_id := reference_area;
    ELSIF reference_area IS DISTINCT FROM NEW.area_operativa_id THEN
      RAISE EXCEPTION 'Centro di riferimento non coerente con Area del volontario'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS volontari_reference_area_check ON volontari;
CREATE TRIGGER volontari_reference_area_check
BEFORE INSERT OR UPDATE OF area_operativa_id, centro_ascolto_id ON volontari
FOR EACH ROW EXECUTE FUNCTION volontari_reference_area_check();
