DO $update$
BEGIN
  IF to_regclass('public.beneficiari') IS NULL OR to_regclass('public.centri_di_ascolto') IS NULL THEN
    RAISE EXCEPTION 'Schema Beneficiari/Centri non disponibile';
  END IF;
END
$update$;

CREATE TABLE IF NOT EXISTS public.fse_import_batches (
  id serial PRIMARY KEY,
  nome_file varchar(255) NOT NULL,
  sha256_file varchar(64) NOT NULL CHECK (sha256_file ~ '^[0-9a-f]{64}$'),
  hash_contenuto_normalizzato varchar(64) NOT NULL CHECK (hash_contenuto_normalizzato ~ '^[0-9a-f]{64}$'),
  centro_ascolto_id integer NOT NULL REFERENCES public.centri_di_ascolto(id) ON DELETE RESTRICT,
  area_operativa_id integer NOT NULL REFERENCES public.aree_operative(id) ON DELETE RESTRICT,
  utente_id integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  numero_righe integer NOT NULL DEFAULT 0,
  creati integer NOT NULL DEFAULT 0,
  collegati integer NOT NULL DEFAULT 0,
  aggiornati integer NOT NULL DEFAULT 0,
  invariati integer NOT NULL DEFAULT 0,
  conflitti integer NOT NULL DEFAULT 0,
  errori integer NOT NULL DEFAULT 0,
  stato varchar(20) NOT NULL DEFAULT 'analizzato' CHECK (stato IN ('analizzato','confermato','parziale','fallito')),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_import_batches_counts_check CHECK (
    numero_righe >= 0 AND creati >= 0 AND collegati >= 0 AND aggiornati >= 0
    AND invariati >= 0 AND conflitti >= 0 AND errori >= 0
  )
);
CREATE INDEX IF NOT EXISTS fse_import_batches_scope_idx ON public.fse_import_batches (centro_ascolto_id, area_operativa_id);

CREATE TABLE IF NOT EXISTS public.fse_fascicoli_sociali (
  id serial PRIMARY KEY,
  beneficiario_id integer NOT NULL REFERENCES public.beneficiari(id) ON DELETE CASCADE,
  codice_fascicolo varchar(255),
  codice_fascicolo_normalizzato varchar(255),
  origine_fascicolo varchar(20) NOT NULL DEFAULT 'interno' CHECK (origine_fascicolo IN ('interno','import_fse')),
  numero_componenti_importato integer,
  donne_importate integer,
  uomini_importati integer,
  eta_0_17_importata integer,
  eta_18_29_importata integer,
  eta_30_64_importata integer,
  eta_65_plus_importata integer,
  origine_straniera_minoranze integer,
  cittadini_paesi_terzi integer,
  senza_tetto_esclusione_abitativa integer,
  tipologia_attivita_importata varchar(80),
  stato_attuale_importato varchar(80),
  ultimo_import_batch_id integer REFERENCES public.fse_import_batches(id) ON DELETE SET NULL,
  ultimo_import_at timestamptz,
  ultimo_export_at timestamptz,
  hash_ultima_riga_importata varchar(64),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_fascicoli_sociali_snapshot_check CHECK (
    (
      numero_componenti_importato IS NULL AND donne_importate IS NULL AND uomini_importati IS NULL
      AND eta_0_17_importata IS NULL AND eta_18_29_importata IS NULL
      AND eta_30_64_importata IS NULL AND eta_65_plus_importata IS NULL
    ) OR (
      numero_componenti_importato > 0 AND donne_importate >= 0 AND uomini_importati >= 0
      AND eta_0_17_importata >= 0 AND eta_18_29_importata >= 0
      AND eta_30_64_importata >= 0 AND eta_65_plus_importata >= 0
      AND donne_importate + uomini_importati = numero_componenti_importato
      AND eta_0_17_importata + eta_18_29_importata + eta_30_64_importata + eta_65_plus_importata = numero_componenti_importato
    )
  ),
  CONSTRAINT fse_fascicoli_sociali_specific_counts_check CHECK (
    (origine_straniera_minoranze IS NULL OR origine_straniera_minoranze >= 0)
    AND (cittadini_paesi_terzi IS NULL OR cittadini_paesi_terzi >= 0)
    AND (senza_tetto_esclusione_abitativa IS NULL OR senza_tetto_esclusione_abitativa >= 0)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_fascicoli_sociali_beneficiario_uidx ON public.fse_fascicoli_sociali (beneficiario_id);
CREATE UNIQUE INDEX IF NOT EXISTS fse_fascicoli_sociali_codice_norm_uidx ON public.fse_fascicoli_sociali (codice_fascicolo_normalizzato) WHERE codice_fascicolo_normalizzato IS NOT NULL;
