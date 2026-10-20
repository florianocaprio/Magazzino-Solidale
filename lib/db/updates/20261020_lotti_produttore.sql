-- Anagrafica separata dalle partite: nessuna quantità e nessun backfill incerto.
CREATE TABLE IF NOT EXISTS lotti_produttore (
  id serial PRIMARY KEY,
  area_operativa_id integer NOT NULL REFERENCES aree_operative(id) ON DELETE RESTRICT,
  prodotto_id integer NOT NULL REFERENCES prodotti(id) ON DELETE RESTRICT,
  codice_originale varchar(80), codice_canonico varchar(240),
  riferimento_interno varchar(80) NOT NULL UNIQUE,
  data_scadenza date, produttore varchar(200), produttore_canonico varchar(600), note text,
  origine varchar(20) CHECK (origine IS NULL OR origine IN ('MANUALE','AUTOMATICO','IMPORTATO')),
  fonte text, primo_autore_id integer REFERENCES utenti(id) ON DELETE RESTRICT,
  prima_creazione_at timestamptz, data_associazione timestamptz NOT NULL DEFAULT now(),
  idempotency_key varchar(100), request_hash varchar(64),
  CONSTRAINT lotti_produttore_codice_check CHECK ((codice_originale IS NULL) = (codice_canonico IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS lotti_produttore_codice_unique ON lotti_produttore(area_operativa_id,prodotto_id,codice_canonico) WHERE codice_canonico IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lotti_produttore_command_unique ON lotti_produttore(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE lotti ADD COLUMN IF NOT EXISTS lotto_produttore_id integer REFERENCES lotti_produttore(id) ON DELETE RESTRICT;
ALTER TABLE carico_pratica_righe ADD COLUMN IF NOT EXISTS lotto_produttore_id integer REFERENCES lotti_produttore(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS lotti_produttore_partite_idx ON lotti(lotto_produttore_id);
CREATE OR REPLACE FUNCTION protect_lotto_produttore_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.area_operativa_id,NEW.prodotto_id,NEW.codice_originale,NEW.codice_canonico,NEW.riferimento_interno,NEW.origine,NEW.fonte,NEW.primo_autore_id,NEW.prima_creazione_at,NEW.data_associazione)
 IS DISTINCT FROM ROW(OLD.area_operativa_id,OLD.prodotto_id,OLD.codice_originale,OLD.codice_canonico,OLD.riferimento_interno,OLD.origine,OLD.fonte,OLD.primo_autore_id,OLD.prima_creazione_at,OLD.data_associazione)
 THEN RAISE EXCEPTION 'Identità e origine lotto produttore immutabili' USING ERRCODE='23514'; END IF;
 IF (OLD.produttore_canonico IS NOT NULL AND NEW.produttore_canonico IS DISTINCT FROM OLD.produttore_canonico)
 OR (OLD.data_scadenza IS NOT NULL AND NEW.data_scadenza IS DISTINCT FROM OLD.data_scadenza)
 THEN RAISE EXCEPTION 'Dati lotto produttore incompatibili' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lotti_produttore_immutable ON lotti_produttore;
CREATE TRIGGER lotti_produttore_immutable BEFORE UPDATE ON lotti_produttore FOR EACH ROW EXECUTE FUNCTION protect_lotto_produttore_origin();
CREATE OR REPLACE FUNCTION protect_lotto_produttore_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m lotti_produttore; a integer;
BEGIN
 IF TG_OP='UPDATE' AND OLD.lotto_produttore_id IS NOT NULL AND NEW.lotto_produttore_id IS DISTINCT FROM OLD.lotto_produttore_id
 THEN RAISE EXCEPTION 'Collegamento anagrafico partita immutabile' USING ERRCODE='23514'; END IF;
 IF NEW.lotto_produttore_id IS NOT NULL THEN
  SELECT * INTO m FROM lotti_produttore WHERE id=NEW.lotto_produttore_id;
  SELECT area_operativa_id INTO a FROM magazzini WHERE id=NEW.magazzino_id;
  IF m.prodotto_id IS DISTINCT FROM NEW.prodotto_id OR m.area_operativa_id IS DISTINCT FROM a
  THEN RAISE EXCEPTION 'Anagrafica lotto estranea al prodotto o Area della partita' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lotti_produttore_link_guard ON lotti;
CREATE TRIGGER lotti_produttore_link_guard BEFORE INSERT OR UPDATE OF lotto_produttore_id,prodotto_id,magazzino_id ON lotti FOR EACH ROW EXECUTE FUNCTION protect_lotto_produttore_link();
