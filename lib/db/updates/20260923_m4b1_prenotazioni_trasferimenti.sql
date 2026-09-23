-- M4B.1: una prenotazione appartiene a una Bolla oppure a un Trasferimento.
-- Conserva senza conversione tutte le prenotazioni e i trasferimenti storici.
ALTER TABLE prenotazioni_magazzino ALTER COLUMN bolla_id DROP NOT NULL;
ALTER TABLE prenotazioni_magazzino ALTER COLUMN riga_bolla_id DROP NOT NULL;
ALTER TABLE prenotazioni_magazzino ADD COLUMN IF NOT EXISTS trasferimento_id integer;
ALTER TABLE prenotazioni_magazzino ADD COLUMN IF NOT EXISTS riga_trasferimento_id integer;
ALTER TABLE trasferimenti ADD COLUMN IF NOT EXISTS motivo_annullamento varchar(500);

CREATE UNIQUE INDEX IF NOT EXISTS bolla_righe_id_bolla_unique ON bolla_righe(id, bolla_id);
CREATE UNIQUE INDEX IF NOT EXISTS trasferimento_righe_id_trasferimento_unique
  ON trasferimento_righe(id, trasferimento_id);

DO $$ BEGIN
  ALTER TABLE prenotazioni_magazzino ADD CONSTRAINT prenotazioni_magazzino_trasferimento_id_fk
    FOREIGN KEY (trasferimento_id) REFERENCES trasferimenti(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE prenotazioni_magazzino ADD CONSTRAINT prenotazioni_magazzino_riga_trasferimento_id_fk
    FOREIGN KEY (riga_trasferimento_id) REFERENCES trasferimento_righe(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE prenotazioni_magazzino ADD CONSTRAINT prenotazioni_magazzino_bolla_riga_owner_fk
    FOREIGN KEY (riga_bolla_id, bolla_id) REFERENCES bolla_righe(id, bolla_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE prenotazioni_magazzino ADD CONSTRAINT prenotazioni_magazzino_trasferimento_riga_owner_fk
    FOREIGN KEY (riga_trasferimento_id, trasferimento_id)
    REFERENCES trasferimento_righe(id, trasferimento_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE prenotazioni_magazzino ADD CONSTRAINT prenotazioni_magazzino_owner_exclusive CHECK (
    (bolla_id IS NOT NULL AND riga_bolla_id IS NOT NULL
      AND trasferimento_id IS NULL AND riga_trasferimento_id IS NULL)
    OR
    (bolla_id IS NULL AND riga_bolla_id IS NULL
      AND trasferimento_id IS NOT NULL AND riga_trasferimento_id IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS prenotazioni_magazzino_trasferimento_stato_idx
  ON prenotazioni_magazzino(trasferimento_id, stato);
CREATE INDEX IF NOT EXISTS prenotazioni_magazzino_riga_trasferimento_idx
  ON prenotazioni_magazzino(riga_trasferimento_id);
