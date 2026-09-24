-- M4B.2: custodial transport and immutable final return reconciliation.
-- Earlier migrations and all historical inventory rows remain untouched.
ALTER TABLE bolle ADD COLUMN IF NOT EXISTS motivo_mancata_consegna varchar(500);
ALTER TABLE trasferimenti ADD COLUMN IF NOT EXISTS motivo_mancato_arrivo varchar(500);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimenti_id_bolla_party_unique') THEN
    ALTER TABLE movimenti ADD CONSTRAINT movimenti_id_bolla_party_unique
      UNIQUE (id, bolla_id, prodotto_id, lotto_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimenti_id_trasferimento_party_unique') THEN
    ALTER TABLE movimenti ADD CONSTRAINT movimenti_id_trasferimento_party_unique
      UNIQUE (id, trasferimento_id, prodotto_id, lotto_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS rientri_trasporto (
  id serial PRIMARY KEY,
  bolla_id integer CONSTRAINT rientri_trasporto_bolla_id_bolle_id_fk REFERENCES bolle(id) ON DELETE RESTRICT,
  trasferimento_id integer CONSTRAINT rientri_trasporto_trasferimento_id_trasferimenti_id_fk REFERENCES trasferimenti(id) ON DELETE RESTRICT,
  magazzino_origine_id integer NOT NULL CONSTRAINT rientri_trasporto_magazzino_origine_id_magazzini_id_fk REFERENCES magazzini(id) ON DELETE RESTRICT,
  data_rientro date NOT NULL,
  note text,
  created_by integer NOT NULL CONSTRAINT rientri_trasporto_created_by_utenti_id_fk REFERENCES utenti(id) ON DELETE RESTRICT,
  data_creazione timestamp NOT NULL DEFAULT now(),
  CONSTRAINT rientri_trasporto_owner_exclusive CHECK (
    (bolla_id IS NOT NULL AND trasferimento_id IS NULL)
    OR (bolla_id IS NULL AND trasferimento_id IS NOT NULL)
  ),
  CONSTRAINT rientri_trasporto_id_bolla_unique UNIQUE (id, bolla_id),
  CONSTRAINT rientri_trasporto_id_trasferimento_unique UNIQUE (id, trasferimento_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS rientri_trasporto_bolla_unique
  ON rientri_trasporto(bolla_id);
CREATE UNIQUE INDEX IF NOT EXISTS rientri_trasporto_trasferimento_unique
  ON rientri_trasporto(trasferimento_id);

CREATE TABLE IF NOT EXISTS rientro_trasporto_righe (
  id serial PRIMARY KEY,
  rientro_id integer NOT NULL CONSTRAINT rientro_trasporto_righe_rientro_id_rientri_trasporto_id_fk REFERENCES rientri_trasporto(id) ON DELETE RESTRICT,
  bolla_id integer,
  trasferimento_id integer,
  movimento_uscita_id integer NOT NULL CONSTRAINT rientro_trasporto_righe_movimento_uscita_id_movimenti_id_fk REFERENCES movimenti(id) ON DELETE RESTRICT,
  prodotto_id integer NOT NULL CONSTRAINT rientro_trasporto_righe_prodotto_id_prodotti_id_fk REFERENCES prodotti(id) ON DELETE RESTRICT,
  lotto_id integer NOT NULL CONSTRAINT rientro_trasporto_righe_lotto_id_lotti_id_fk REFERENCES lotti(id) ON DELETE RESTRICT,
  tipo_esito varchar(20) NOT NULL,
  quantita decimal(14,6) NOT NULL,
  nota text,
  scarico_id integer CONSTRAINT rientro_trasporto_righe_scarico_id_scarichi_id_fk REFERENCES scarichi(id) ON DELETE RESTRICT,
  movimento_rientro_id integer CONSTRAINT rientro_trasporto_righe_movimento_rientro_id_movimenti_id_fk REFERENCES movimenti(id) ON DELETE RESTRICT,
  movimento_esito_id integer CONSTRAINT rientro_trasporto_righe_movimento_esito_id_movimenti_id_fk REFERENCES movimenti(id) ON DELETE RESTRICT,
  CONSTRAINT rientro_trasporto_righe_quantita_positive CHECK (quantita > 0),
  CONSTRAINT rientro_trasporto_righe_tipo_esito_check CHECK (
    tipo_esito IN ('idonea', 'deteriorata', 'scaduta', 'mancante', 'rubata')
  ),
  CONSTRAINT rientro_trasporto_righe_owner_exclusive CHECK (
    (bolla_id IS NOT NULL AND trasferimento_id IS NULL)
    OR (bolla_id IS NULL AND trasferimento_id IS NOT NULL)
  ),
  CONSTRAINT rientro_trasporto_righe_bolla_owner_fk
    FOREIGN KEY (rientro_id, bolla_id)
    REFERENCES rientri_trasporto(id, bolla_id) ON DELETE RESTRICT,
  CONSTRAINT rientro_trasporto_righe_trasferimento_owner_fk
    FOREIGN KEY (rientro_id, trasferimento_id)
    REFERENCES rientri_trasporto(id, trasferimento_id) ON DELETE RESTRICT,
  CONSTRAINT rientro_trasporto_righe_bolla_uscita_fk
    FOREIGN KEY (movimento_uscita_id, bolla_id, prodotto_id, lotto_id)
    REFERENCES movimenti(id, bolla_id, prodotto_id, lotto_id) ON DELETE RESTRICT,
  CONSTRAINT rientro_trasporto_righe_trasferimento_uscita_fk
    FOREIGN KEY (movimento_uscita_id, trasferimento_id, prodotto_id, lotto_id)
    REFERENCES movimenti(id, trasferimento_id, prodotto_id, lotto_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS rientro_trasporto_righe_uscita_idx
  ON rientro_trasporto_righe(movimento_uscita_id);
CREATE UNIQUE INDEX IF NOT EXISTS rientro_trasporto_righe_esito_unique
  ON rientro_trasporto_righe(rientro_id, movimento_uscita_id, tipo_esito);

CREATE OR REPLACE FUNCTION validate_rientro_trasporto_riga() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_mov movimenti%ROWTYPE;
  return_doc rientri_trasporto%ROWTYPE;
BEGIN
  SELECT * INTO source_mov FROM movimenti WHERE id = NEW.movimento_uscita_id;
  SELECT * INTO return_doc FROM rientri_trasporto WHERE id = NEW.rientro_id;
  IF source_mov.id IS NULL OR return_doc.id IS NULL OR source_mov.lotto_id IS NULL
     OR source_mov.magazzino_id <> return_doc.magazzino_origine_id
     OR NOT (
       (NEW.bolla_id IS NOT NULL AND source_mov.tipo_movimento = 'scarico'
         AND source_mov.tipo_dettaglio = 'affidamento_trasporto')
       OR (NEW.trasferimento_id IS NOT NULL AND source_mov.tipo_movimento = 'trasferimento'
         AND source_mov.tipo_dettaglio = 'uscita')
     ) THEN
    RAISE EXCEPTION 'La riga di rientro non appartiene a una uscita fisica del documento origine'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rientro_trasporto_riga_source_guard ON rientro_trasporto_righe;
CREATE TRIGGER rientro_trasporto_riga_source_guard
BEFORE INSERT OR UPDATE ON rientro_trasporto_righe
FOR EACH ROW EXECUTE FUNCTION validate_rientro_trasporto_riga();
