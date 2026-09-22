-- M4A: destinatari tipizzati e metadati necessari al documento comune.
-- Migrazione additiva: le Bolle legacy sono deterministicamente Beneficiario.

CREATE TABLE IF NOT EXISTS enti_destinatari (
  id serial PRIMARY KEY,
  denominazione varchar(200) NOT NULL,
  indirizzo varchar(250) NOT NULL,
  telefono varchar(50),
  email varchar(200),
  area_operativa_id integer NOT NULL REFERENCES aree_operative(id) ON DELETE RESTRICT,
  attivo boolean NOT NULL DEFAULT true,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enti_destinatari_area_attivo_idx
  ON enti_destinatari(area_operativa_id, attivo, denominazione);

ALTER TABLE enti_destinatari ADD COLUMN IF NOT EXISTS versione integer;
UPDATE enti_destinatari SET versione = 1 WHERE versione IS NULL;
ALTER TABLE enti_destinatari ALTER COLUMN versione SET DEFAULT 1;
ALTER TABLE enti_destinatari ALTER COLUMN versione SET NOT NULL;

ALTER TABLE bolle ADD COLUMN IF NOT EXISTS tipo_destinatario varchar(20);
ALTER TABLE bolle ADD COLUMN IF NOT EXISTS ente_destinatario_id integer;
ALTER TABLE bolle ADD COLUMN IF NOT EXISTS destinatario_nome_snapshot varchar(250);
ALTER TABLE bolle ADD COLUMN IF NOT EXISTS destinatario_indirizzo_snapshot varchar(250);
ALTER TABLE bolle ADD COLUMN IF NOT EXISTS destinatario_telefono_snapshot varchar(50);
ALTER TABLE bolle ADD COLUMN IF NOT EXISTS destinatario_email_snapshot varchar(200);
ALTER TABLE bolle ADD COLUMN IF NOT EXISTS destinatario_snapshot_congelato boolean;
ALTER TABLE bolle ADD COLUMN IF NOT EXISTS motivo_annullamento varchar(500);
ALTER TABLE bolle ADD COLUMN IF NOT EXISTS versione integer;

UPDATE bolle SET tipo_destinatario = 'beneficiario'
WHERE tipo_destinatario IS NULL;
UPDATE bolle SET versione = 1 WHERE versione IS NULL;
UPDATE bolle SET destinatario_snapshot_congelato = false
WHERE destinatario_snapshot_congelato IS NULL;

ALTER TABLE bolle ALTER COLUMN tipo_destinatario SET DEFAULT 'beneficiario';
ALTER TABLE bolle ALTER COLUMN tipo_destinatario SET NOT NULL;
ALTER TABLE bolle ALTER COLUMN versione SET DEFAULT 1;
ALTER TABLE bolle ALTER COLUMN versione SET NOT NULL;
ALTER TABLE bolle ALTER COLUMN destinatario_snapshot_congelato SET DEFAULT false;
ALTER TABLE bolle ALTER COLUMN destinatario_snapshot_congelato SET NOT NULL;
ALTER TABLE bolle ALTER COLUMN beneficiario_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE bolle ADD CONSTRAINT bolle_ente_destinatario_fk
    FOREIGN KEY (ente_destinatario_id) REFERENCES enti_destinatari(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE bolle ADD CONSTRAINT bolle_destinatario_esclusivo_check CHECK (
    (tipo_destinatario = 'beneficiario' AND beneficiario_id IS NOT NULL AND ente_destinatario_id IS NULL)
    OR
    (tipo_destinatario = 'ente' AND beneficiario_id IS NULL AND ente_destinatario_id IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS bolle_tipo_destinatario_idx
  ON bolle(tipo_destinatario, data_creazione DESC);

-- Una pianificazione può avere una sola Bolla operativa. Le Bolle annullate
-- restano nello storico e non impediscono una successiva nuova preparazione.
CREATE UNIQUE INDEX IF NOT EXISTS bolle_consegna_attiva_unique
  ON bolle(consegna_id)
  WHERE consegna_id IS NOT NULL AND stato <> 'annullato';

-- Il registro dei comandi completa l'idempotenza applicativa: effetto,
-- audit e ricevuta del comando vengono confermati nella stessa transazione.
CREATE TABLE IF NOT EXISTS comandi_operativi (
  id serial PRIMARY KEY,
  tipo_comando varchar(80) NOT NULL,
  idempotency_key varchar(120) NOT NULL,
  request_hash varchar(64) NOT NULL,
  aggregato_tipo varchar(40) NOT NULL,
  aggregato_id integer NOT NULL,
  versione_richiesta integer,
  versione_risultante integer,
  result_snapshot jsonb NOT NULL,
  actor_user_id integer NOT NULL,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comandi_operativi_tipo_chiave_unique
    UNIQUE (tipo_comando, idempotency_key),
  CONSTRAINT comandi_operativi_request_hash_check
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT comandi_operativi_versioni_check CHECK (
    (versione_richiesta IS NULL OR versione_richiesta > 0)
    AND (versione_risultante IS NULL OR versione_risultante > 0)
  )
);

CREATE INDEX IF NOT EXISTS comandi_operativi_aggregato_idx
  ON comandi_operativi(aggregato_tipo, aggregato_id, data_creazione);

-- Le ricevute sono snapshot tecnici immutabili. L'attore autorevole vive
-- nell'audit comune: nessuna FK deve trasformare/cancellare una ricevuta né
-- impedire la dismissione di un account storico.
ALTER TABLE comandi_operativi
  DROP CONSTRAINT IF EXISTS comandi_operativi_actor_user_id_fkey;
ALTER TABLE comandi_operativi ALTER COLUMN actor_user_id SET NOT NULL;

CREATE OR REPLACE FUNCTION reject_comandi_operativi_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'comandi_operativi is append-only';
END;
$$;

DROP TRIGGER IF EXISTS comandi_operativi_no_update ON comandi_operativi;
CREATE TRIGGER comandi_operativi_no_update
  BEFORE UPDATE OR DELETE ON comandi_operativi
  FOR EACH ROW EXECUTE FUNCTION reject_comandi_operativi_mutation();
