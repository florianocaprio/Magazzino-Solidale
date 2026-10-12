-- Minimal Mensa provenance for the existing request aggregate. No stock or
-- historical attribution backfill, no grants or existing assignments changed.
ALTER TABLE richieste_magazzino ADD COLUMN IF NOT EXISTS mensa_id integer
  REFERENCES mense(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS richieste_magazzino_mensa_idx ON richieste_magazzino(mensa_id);
ALTER TABLE richieste_magazzino DROP CONSTRAINT IF EXISTS richieste_magazzino_mensa_check;
ALTER TABLE richieste_magazzino ADD CONSTRAINT richieste_magazzino_mensa_check
  CHECK (mensa_id IS NULL OR (tipo_destinatario='magazzino' AND sorgente='operativa' AND intervento_id IS NULL));

CREATE OR REPLACE FUNCTION mensa_request_destination_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.mensa_id IS DISTINCT FROM OLD.mensa_id OR
    (OLD.mensa_id IS NOT NULL AND (NEW.magazzino_destinatario_id IS DISTINCT FROM OLD.magazzino_destinatario_id OR NEW.area_operativa_id IS DISTINCT FROM OLD.area_operativa_id))) THEN
    RAISE EXCEPTION 'MENSA_REQUEST_ORIGIN_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NEW.mensa_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM mense m WHERE m.id=NEW.mensa_id AND m.magazzino_id=NEW.magazzino_destinatario_id AND m.area_operativa_id=NEW.area_operativa_id
  ) THEN
    RAISE EXCEPTION 'MENSA_REQUEST_DESTINATION_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS mensa_request_destination_guard ON richieste_magazzino;
CREATE TRIGGER mensa_request_destination_guard BEFORE INSERT OR UPDATE ON richieste_magazzino
  FOR EACH ROW EXECUTE FUNCTION mensa_request_destination_guard();
