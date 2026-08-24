-- Reporting 2.0: storia FSE append-only e snapshot territoriali degli eventi.
-- Nessun backfill: i record legacy restano nullable e vengono segnalati come derivati.

ALTER TABLE public.fse_import_batches
  ADD COLUMN IF NOT EXISTS data_riferimento date;

ALTER TABLE public.fse_fascicoli_sociali
  ADD COLUMN IF NOT EXISTS persone_disabilita integer,
  ADD COLUMN IF NOT EXISTS data_riferimento date,
  ADD COLUMN IF NOT EXISTS origine_dato varchar(30),
  ADD COLUMN IF NOT EXISTS attendibilita_dato varchar(30),
  ADD COLUMN IF NOT EXISTS versione integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fse_fascicoli_sociali_versione_check') THEN
    ALTER TABLE public.fse_fascicoli_sociali
      ADD CONSTRAINT fse_fascicoli_sociali_versione_check CHECK (versione >= 1);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.fse_fascicoli_sociali_snapshot (
  id serial PRIMARY KEY,
  beneficiario_id integer NOT NULL REFERENCES public.beneficiari(id) ON DELETE CASCADE,
  data_riferimento date NOT NULL,
  origine_snapshot varchar(30) NOT NULL,
  import_batch_id integer REFERENCES public.fse_import_batches(id) ON DELETE SET NULL,
  utente_id integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  versione_profilo integer NOT NULL,
  codice_fascicolo varchar(255),
  numero_componenti integer,
  donne integer,
  uomini integer,
  eta_0_17 integer,
  eta_18_29 integer,
  eta_30_64 integer,
  eta_65_plus integer,
  origine_straniera_minoranze integer,
  persone_disabilita integer,
  cittadini_paesi_terzi integer,
  senza_tetto_esclusione_abitativa integer,
  tipologia_attivita varchar(80),
  stato_attuale varchar(80),
  attendibilita_dato varchar(30),
  hash_canonico varchar(64) NOT NULL,
  metadati_qualita jsonb NOT NULL DEFAULT '{}'::jsonb,
  riferimento_sorgente varchar(255),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_fascicoli_snapshot_origin_check CHECK (origine_snapshot IN ('import_fse','aggiornamento_manuale','export_fse','migrazione_esplicita')),
  CONSTRAINT fse_fascicoli_snapshot_version_check CHECK (versione_profilo >= 1),
  CONSTRAINT fse_fascicoli_snapshot_hash_check CHECK (hash_canonico ~ '^[0-9a-f]{64}$'),
  CONSTRAINT fse_fascicoli_snapshot_demography_check CHECK (
    (numero_componenti IS NULL AND donne IS NULL AND uomini IS NULL AND eta_0_17 IS NULL AND eta_18_29 IS NULL AND eta_30_64 IS NULL AND eta_65_plus IS NULL)
    OR
    (numero_componenti > 0 AND donne >= 0 AND uomini >= 0 AND eta_0_17 >= 0 AND eta_18_29 >= 0 AND eta_30_64 >= 0 AND eta_65_plus >= 0
      AND donne + uomini = numero_componenti
      AND eta_0_17 + eta_18_29 + eta_30_64 + eta_65_plus = numero_componenti)
  )
);

CREATE INDEX IF NOT EXISTS fse_fascicoli_snapshot_asof_idx
  ON public.fse_fascicoli_sociali_snapshot (beneficiario_id, data_riferimento DESC, versione_profilo DESC);
CREATE INDEX IF NOT EXISTS fse_fascicoli_snapshot_data_idx
  ON public.fse_fascicoli_sociali_snapshot (data_riferimento);
CREATE UNIQUE INDEX IF NOT EXISTS fse_fascicoli_snapshot_hash_uidx
  ON public.fse_fascicoli_sociali_snapshot (beneficiario_id, data_riferimento, hash_canonico);

DO $$
DECLARE
  snapshot_fk record;
BEGIN
  SELECT c.conname, c.confdeltype INTO snapshot_fk
  FROM pg_constraint c
  WHERE c.conrelid = 'public.fse_fascicoli_sociali_snapshot'::regclass
    AND c.confrelid = 'public.beneficiari'::regclass
    AND c.contype = 'f'
  LIMIT 1;
  IF snapshot_fk.conname IS NOT NULL AND snapshot_fk.confdeltype <> 'c' THEN
    EXECUTE format(
      'ALTER TABLE public.fse_fascicoli_sociali_snapshot DROP CONSTRAINT %I',
      snapshot_fk.conname
    );
    ALTER TABLE public.fse_fascicoli_sociali_snapshot
      ADD CONSTRAINT fse_fascicoli_snapshot_beneficiario_fk
      FOREIGN KEY (beneficiario_id) REFERENCES public.beneficiari(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reject_fse_fascicolo_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- La cancellazione cascata dell'intera anagrafica è un workflow distinto
  -- dalle correzioni del fascicolo e resta consentita per privacy/retention.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'fse_fascicoli_sociali_snapshot is append-only' USING ERRCODE = '55000';
END $$;

DROP TRIGGER IF EXISTS fse_fascicoli_snapshot_append_only ON public.fse_fascicoli_sociali_snapshot;
CREATE TRIGGER fse_fascicoli_snapshot_append_only
BEFORE UPDATE OR DELETE ON public.fse_fascicoli_sociali_snapshot
FOR EACH ROW EXECUTE FUNCTION public.reject_fse_fascicolo_snapshot_mutation();

ALTER TABLE public.bolle
  ADD COLUMN IF NOT EXISTS area_operativa_id_snapshot integer,
  ADD COLUMN IF NOT EXISTS centro_ascolto_id_snapshot integer,
  ADD COLUMN IF NOT EXISTS numero_componenti_nucleo_snapshot integer;
ALTER TABLE public.consegne
  ADD COLUMN IF NOT EXISTS area_operativa_id_snapshot integer,
  ADD COLUMN IF NOT EXISTS centro_ascolto_id_snapshot integer;
ALTER TABLE public.interventi
  ADD COLUMN IF NOT EXISTS centro_ascolto_id_snapshot integer;

ALTER TABLE public.bolle DROP CONSTRAINT IF EXISTS bolle_area_snapshot_fk;
ALTER TABLE public.bolle ADD CONSTRAINT bolle_area_snapshot_fk
  FOREIGN KEY (area_operativa_id_snapshot) REFERENCES public.aree_operative(id) ON DELETE SET NULL;
ALTER TABLE public.bolle DROP CONSTRAINT IF EXISTS bolle_centro_snapshot_fk;
ALTER TABLE public.bolle ADD CONSTRAINT bolle_centro_snapshot_fk
  FOREIGN KEY (centro_ascolto_id_snapshot) REFERENCES public.centri_di_ascolto(id) ON DELETE SET NULL;
ALTER TABLE public.consegne DROP CONSTRAINT IF EXISTS consegne_area_snapshot_fk;
ALTER TABLE public.consegne ADD CONSTRAINT consegne_area_snapshot_fk
  FOREIGN KEY (area_operativa_id_snapshot) REFERENCES public.aree_operative(id) ON DELETE SET NULL;
ALTER TABLE public.consegne DROP CONSTRAINT IF EXISTS consegne_centro_snapshot_fk;
ALTER TABLE public.consegne ADD CONSTRAINT consegne_centro_snapshot_fk
  FOREIGN KEY (centro_ascolto_id_snapshot) REFERENCES public.centri_di_ascolto(id) ON DELETE SET NULL;
ALTER TABLE public.interventi DROP CONSTRAINT IF EXISTS interventi_centro_snapshot_fk;
ALTER TABLE public.interventi ADD CONSTRAINT interventi_centro_snapshot_fk
  FOREIGN KEY (centro_ascolto_id_snapshot) REFERENCES public.centri_di_ascolto(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bolle_reporting_snapshot_idx
  ON public.bolle (stato, data_bolla, area_operativa_id_snapshot, centro_ascolto_id_snapshot);
CREATE INDEX IF NOT EXISTS consegne_reporting_snapshot_idx
  ON public.consegne (stato, data_effettuata, area_operativa_id_snapshot, centro_ascolto_id_snapshot);
CREATE INDEX IF NOT EXISTS interventi_reporting_snapshot_idx
  ON public.interventi (ambito, stato, data_intervento, area_operativa_id_snapshot, centro_ascolto_id_snapshot);
