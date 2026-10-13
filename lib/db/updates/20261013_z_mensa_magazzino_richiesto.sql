-- Preference expressed by the Mensa, not a stock origin constraint.
-- Existing requests remain unassigned; no backfill or inventory effect.
ALTER TABLE richieste_magazzino
  ADD COLUMN IF NOT EXISTS magazzino_richiesto_id integer REFERENCES magazzini(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS magazzino_richiesto_nome_snapshot varchar(120);
ALTER TABLE richieste_magazzino DROP CONSTRAINT IF EXISTS richieste_magazzino_fornitore_check;
ALTER TABLE richieste_magazzino ADD CONSTRAINT richieste_magazzino_fornitore_check CHECK (
  (magazzino_richiesto_id IS NULL AND magazzino_richiesto_nome_snapshot IS NULL)
  OR (magazzino_richiesto_id IS NOT NULL AND magazzino_richiesto_nome_snapshot IS NOT NULL
    AND length(btrim(magazzino_richiesto_nome_snapshot)) > 0 AND mensa_id IS NOT NULL
    AND magazzino_richiesto_id <> magazzino_destinatario_id)
);
CREATE OR REPLACE FUNCTION mensa_request_supplier_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.magazzino_richiesto_id IS DISTINCT FROM OLD.magazzino_richiesto_id
    OR NEW.magazzino_richiesto_nome_snapshot IS DISTINCT FROM OLD.magazzino_richiesto_nome_snapshot THEN
    RAISE EXCEPTION 'MENSA_REQUEST_SUPPLIER_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS mensa_request_supplier_guard ON richieste_magazzino;
CREATE TRIGGER mensa_request_supplier_guard BEFORE UPDATE ON richieste_magazzino
  FOR EACH ROW EXECUTE FUNCTION mensa_request_supplier_guard();
