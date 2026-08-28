-- Volontari 2.0: matricole automatiche, conversione e hardening scope/tempo.
-- Migration additiva. I preflight precedono ogni modifica e non fondono dati.

DO $preflight_identificativi$
DECLARE
  collisioni_matricole text;
  collisioni_cf text;
BEGIN
  SELECT string_agg(ids::text, '; ' ORDER BY ids::text)
  INTO collisioni_matricole
  FROM (
    SELECT array_agg(id ORDER BY id) AS ids
    FROM public.volontari
    WHERE matricola IS NOT NULL
      AND regexp_replace(upper(trim(matricola)), '[^A-Z0-9]', '', 'g') <> ''
    GROUP BY regexp_replace(upper(trim(matricola)), '[^A-Z0-9]', '', 'g')
    HAVING count(*) > 1
  ) duplicati;

  IF collisioni_matricole IS NOT NULL THEN
    RAISE EXCEPTION
      'Collisioni tra matricole normalizzate. Bonificare i volontari con ID: %',
      collisioni_matricole;
  END IF;

  SELECT string_agg(ids::text, '; ' ORDER BY ids::text)
  INTO collisioni_cf
  FROM (
    SELECT array_agg(id ORDER BY id) AS ids
    FROM public.volontari
    WHERE codice_fiscale_normalizzato IS NOT NULL
      AND trim(codice_fiscale_normalizzato) <> ''
    GROUP BY upper(regexp_replace(codice_fiscale_normalizzato, '[[:space:]]', '', 'g'))
    HAVING count(*) > 1
  ) duplicati;

  IF collisioni_cf IS NOT NULL THEN
    RAISE EXCEPTION
      'Codici fiscali duplicati. Query di bonifica: SELECT id FROM volontari WHERE id = ANY(<uno degli array seguenti>): %',
      collisioni_cf;
  END IF;
END
$preflight_identificativi$;

ALTER TABLE public.aree_operative
  ADD COLUMN IF NOT EXISTS codice_matricola varchar(8);

CREATE UNIQUE INDEX IF NOT EXISTS aree_operative_codice_matricola_unique
  ON public.aree_operative (codice_matricola)
  WHERE codice_matricola IS NOT NULL;

ALTER TABLE public.volontari
  ADD COLUMN IF NOT EXISTS indirizzo_domicilio varchar(240),
  ADD COLUMN IF NOT EXISTS codice_fiscale_non_disponibile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS codice_fiscale_nota varchar(240),
  ADD COLUMN IF NOT EXISTS data_iscrizione date,
  ADD COLUMN IF NOT EXISTS progressivo_registro integer;

UPDATE public.volontari
SET codice_fiscale_normalizzato = upper(regexp_replace(codice_fiscale_normalizzato, '[[:space:]]', '', 'g')),
    codice_fiscale = upper(regexp_replace(codice_fiscale, '[[:space:]]', '', 'g'))
WHERE codice_fiscale_normalizzato IS NOT NULL;

UPDATE public.volontari
SET data_iscrizione = data_inizio_importata
WHERE data_iscrizione IS NULL
  AND data_inizio_importata IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS volontari_codice_fiscale_norm_unique
  ON public.volontari (codice_fiscale_normalizzato)
  WHERE codice_fiscale_normalizzato IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS public.registro_volontari_progressivo_seq;

WITH ordinati AS (
  SELECT id, row_number() OVER (
    ORDER BY data_iscrizione, data_creazione, id
  )::integer AS progressivo
  FROM public.volontari
  WHERE progressivo_registro IS NULL
), base AS (
  SELECT COALESCE(max(progressivo_registro), 0) AS valore
  FROM public.volontari
)
UPDATE public.volontari v
SET progressivo_registro = base.valore + ordinati.progressivo
FROM ordinati, base
WHERE v.id = ordinati.id;

SELECT setval(
  'public.registro_volontari_progressivo_seq',
  COALESCE((SELECT max(progressivo_registro) FROM public.volontari), 0) + 1,
  false
);

ALTER TABLE public.volontari
  ALTER COLUMN progressivo_registro SET DEFAULT nextval('public.registro_volontari_progressivo_seq'),
  ALTER COLUMN progressivo_registro SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS volontari_progressivo_registro_unique
  ON public.volontari (progressivo_registro);

CREATE TABLE IF NOT EXISTS public.configurazioni_matricole_volontari (
  id serial PRIMARY KEY,
  scope_tipo varchar(16) NOT NULL DEFAULT 'GLOBALE'
    CHECK (scope_tipo = 'GLOBALE'),
  versione integer NOT NULL UNIQUE,
  prefisso_associazione varchar(12),
  includi_codice_area boolean NOT NULL DEFAULT true,
  segmento_fisso varchar(8),
  separatore varchar(1) NOT NULL DEFAULT '-'
    CHECK (separatore IN ('','-','/')),
  cifre_progressivo integer NOT NULL DEFAULT 3
    CHECK (cifre_progressivo BETWEEN 2 AND 8),
  numero_iniziale integer NOT NULL DEFAULT 1
    CHECK (numero_iniziale > 0),
  ambito_progressivo varchar(16) NOT NULL DEFAULT 'PER_AREA'
    CHECK (ambito_progressivo IN ('GLOBALE','PER_AREA')),
  attiva boolean NOT NULL DEFAULT true,
  aggiornata_da integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS config_matricole_attiva_scope_unique
  ON public.configurazioni_matricole_volontari (scope_tipo)
  WHERE attiva = true;

INSERT INTO public.configurazioni_matricole_volontari (
  scope_tipo, versione, prefisso_associazione, includi_codice_area,
  segmento_fisso, separatore, cifre_progressivo, numero_iniziale,
  ambito_progressivo, attiva
)
SELECT 'GLOBALE', 1, NULL, true, 'V', '-', 3, 1, 'PER_AREA', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.configurazioni_matricole_volontari WHERE attiva = true
);

CREATE TABLE IF NOT EXISTS public.progressivi_matricole_volontari (
  id serial PRIMARY KEY,
  configurazione_id integer NOT NULL
    REFERENCES public.configurazioni_matricole_volontari(id) ON DELETE RESTRICT,
  scope_tipo varchar(16) NOT NULL CHECK (scope_tipo IN ('GLOBALE','AREA')),
  scope_key varchar(80) NOT NULL,
  area_operativa_id integer REFERENCES public.aree_operative(id) ON DELETE RESTRICT,
  ultimo_numero integer NOT NULL CHECK (ultimo_numero > 0),
  versione integer NOT NULL DEFAULT 1,
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT progressivi_matricole_config_scope_unique
    UNIQUE (configurazione_id, scope_key)
);

CREATE TABLE IF NOT EXISTS public.matricole_volontari (
  id serial PRIMARY KEY,
  volontario_id integer NOT NULL REFERENCES public.volontari(id) ON DELETE RESTRICT,
  matricola varchar(40) NOT NULL,
  matricola_normalizzata varchar(40) NOT NULL UNIQUE,
  tipo_identificativo varchar(16) NOT NULL
    CHECK (tipo_identificativo IN ('TEMPORANEA','PERMANENTE','LEGACY')),
  stato varchar(16) NOT NULL CHECK (stato IN ('ATTIVA','STORICA')),
  origine varchar(16) NOT NULL
    CHECK (origine IN ('GENERATA','IMPORTATA','CONVERSIONE','BACKFILL')),
  data_inizio_validita date NOT NULL,
  data_fine_validita date,
  assegnata_da integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  configurazione_id integer
    REFERENCES public.configurazioni_matricole_volontari(id) ON DELETE RESTRICT,
  configurazione_versione integer,
  snapshot_regola jsonb NOT NULL DEFAULT '{}'::jsonb,
  note_tecniche varchar(240),
  data_assegnazione timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS matricole_volontari_attiva_unique
  ON public.matricole_volontari (volontario_id)
  WHERE stato = 'ATTIVA';
CREATE INDEX IF NOT EXISTS matricole_volontari_volontario_idx
  ON public.matricole_volontari (volontario_id, data_inizio_validita);

UPDATE public.matricole_volontari
SET data_fine_validita = data_inizio_validita
WHERE data_fine_validita < data_inizio_validita;

DO $matricole_validita_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.matricole_volontari'::regclass
      AND conname = 'matricole_volontari_validita_check'
  ) THEN
    ALTER TABLE public.matricole_volontari
      ADD CONSTRAINT matricole_volontari_validita_check
      CHECK (data_fine_validita IS NULL OR data_fine_validita >= data_inizio_validita)
      NOT VALID;
  END IF;
END
$matricole_validita_check$;
ALTER TABLE public.matricole_volontari
  VALIDATE CONSTRAINT matricole_volontari_validita_check;

INSERT INTO public.matricole_volontari (
  volontario_id, matricola, matricola_normalizzata, tipo_identificativo,
  stato, origine, data_inizio_validita, snapshot_regola, note_tecniche
)
SELECT
  v.id,
  v.matricola,
  regexp_replace(upper(trim(v.matricola)), '[^A-Z0-9]', '', 'g'),
  'LEGACY',
  'ATTIVA',
  'BACKFILL',
  COALESCE(
    v.data_iscrizione,
    (v.data_creazione AT TIME ZONE 'Europe/Rome')::date
  ),
  jsonb_build_object(
    'origine', 'BACKFILL',
    'matricolaOriginale', v.matricola,
    'dataValiditaTecnica', v.data_iscrizione IS NULL
  ),
  CASE
    WHEN v.data_iscrizione IS NULL
      THEN 'Backfill tecnico della matricola; data storica di iscrizione non disponibile'
    ELSE 'Backfill deterministico della matricola corrente preesistente'
  END
FROM public.volontari v
WHERE v.matricola IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.matricole_volontari m WHERE m.volontario_id = v.id
  );

CREATE OR REPLACE FUNCTION public.matricole_volontari_no_delete()
RETURNS trigger LANGUAGE plpgsql AS $matricole_no_delete$
BEGIN
  RAISE EXCEPTION 'Lo storico matricole volontari non consente cancellazioni';
END
$matricole_no_delete$;

DROP TRIGGER IF EXISTS matricole_volontari_no_delete_trg
  ON public.matricole_volontari;
CREATE TRIGGER matricole_volontari_no_delete_trg
BEFORE DELETE ON public.matricole_volontari
FOR EACH ROW EXECUTE FUNCTION public.matricole_volontari_no_delete();

CREATE OR REPLACE FUNCTION public.matricole_volontari_immutable_update()
RETURNS trigger LANGUAGE plpgsql AS $matricole_immutable_update$
BEGIN
  IF OLD.stato = 'ATTIVA'
     AND OLD.data_fine_validita IS NULL
     AND NEW.stato = 'STORICA'
     AND NEW.data_fine_validita IS NOT NULL
     AND (to_jsonb(NEW) - 'stato' - 'data_fine_validita')
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - 'stato' - 'data_fine_validita') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Lo storico matricole volontari non consente modifiche';
END
$matricole_immutable_update$;

DROP TRIGGER IF EXISTS matricole_volontari_immutable_update_trg
  ON public.matricole_volontari;
CREATE TRIGGER matricole_volontari_immutable_update_trg
BEFORE UPDATE ON public.matricole_volontari
FOR EACH ROW EXECUTE FUNCTION public.matricole_volontari_immutable_update();

ALTER TABLE public.importazioni_volontari
  ADD COLUMN IF NOT EXISTS hash_decisioni_finali varchar(64),
  ADD COLUMN IF NOT EXISTS scope_tipo varchar(16),
  ADD COLUMN IF NOT EXISTS scope_centro_id integer
    REFERENCES public.centri_di_ascolto(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS scope_area_operativa_id integer
    REFERENCES public.aree_operative(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS scope_centro_ids_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS scope_fingerprint varchar(64);

WITH risolti AS (
  SELECT
    i.id,
    CASE
      WHEN i.centro_ascolto_id IS NOT NULL THEN 'CENTRO'
      WHEN u.area_operativa_id IS NOT NULL THEN 'AREA'
      ELSE 'GLOBALE'
    END AS scope_tipo,
    i.centro_ascolto_id AS scope_centro_id,
    COALESCE(c.area_operativa_id, u.area_operativa_id) AS scope_area_operativa_id
  FROM public.importazioni_volontari i
  LEFT JOIN public.utenti u ON u.id = i.creato_da
  LEFT JOIN public.centri_di_ascolto c ON c.id = i.centro_ascolto_id
)
UPDATE public.importazioni_volontari i
SET scope_tipo = r.scope_tipo,
    scope_centro_id = r.scope_centro_id,
    scope_area_operativa_id = r.scope_area_operativa_id,
    scope_centro_ids_snapshot = CASE
      WHEN r.scope_tipo = 'CENTRO' THEN jsonb_build_array(r.scope_centro_id)
      WHEN r.scope_tipo = 'AREA' THEN COALESCE((
        SELECT jsonb_agg(ca.id ORDER BY ca.id)
        FROM public.centri_di_ascolto ca
        WHERE ca.area_operativa_id = r.scope_area_operativa_id
      ), '[]'::jsonb)
      ELSE COALESCE((
        SELECT jsonb_agg(ca.id ORDER BY ca.id)
        FROM public.centri_di_ascolto ca
      ), '[]'::jsonb)
    END,
    scope_fingerprint =
      md5(concat_ws(':', 'legacy-v1', r.scope_tipo, r.scope_centro_id, r.scope_area_operativa_id))
      || md5(concat_ws(':', 'legacy-v2', r.scope_tipo, r.scope_centro_id, r.scope_area_operativa_id))
FROM risolti r
WHERE i.id = r.id AND i.scope_tipo IS NULL;

ALTER TABLE public.importazioni_volontari
  ALTER COLUMN scope_tipo SET NOT NULL,
  ALTER COLUMN scope_centro_ids_snapshot SET DEFAULT '[]'::jsonb,
  ALTER COLUMN scope_centro_ids_snapshot SET NOT NULL,
  ALTER COLUMN scope_fingerprint SET NOT NULL;

DO $import_scope_fingerprint_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.importazioni_volontari'::regclass
      AND conname = 'importazioni_volontari_scope_fingerprint_check'
  ) THEN
    ALTER TABLE public.importazioni_volontari
      ADD CONSTRAINT importazioni_volontari_scope_fingerprint_check
      CHECK (scope_fingerprint ~ '^[0-9a-f]{64}$') NOT VALID;
  END IF;
END
$import_scope_fingerprint_check$;
ALTER TABLE public.importazioni_volontari
  VALIDATE CONSTRAINT importazioni_volontari_scope_fingerprint_check;

DO $import_scope_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.importazioni_volontari'::regclass
      AND conname = 'importazioni_volontari_scope_tipo_check'
  ) THEN
    ALTER TABLE public.importazioni_volontari
      ADD CONSTRAINT importazioni_volontari_scope_tipo_check
      CHECK (
        (scope_tipo = 'CENTRO' AND scope_centro_id IS NOT NULL)
        OR (scope_tipo = 'AREA' AND scope_centro_id IS NULL AND scope_area_operativa_id IS NOT NULL)
        OR (scope_tipo = 'GLOBALE' AND scope_centro_id IS NULL AND scope_area_operativa_id IS NULL)
      ) NOT VALID;
  END IF;
END
$import_scope_check$;
ALTER TABLE public.importazioni_volontari
  VALIDATE CONSTRAINT importazioni_volontari_scope_tipo_check;

CREATE INDEX IF NOT EXISTS importazioni_volontari_scope_owner_idx
  ON public.importazioni_volontari (
    scope_tipo, scope_centro_id, scope_area_operativa_id, id
  );

ALTER TABLE public.importazioni_volontari_righe
  ADD COLUMN IF NOT EXISTS versione_candidato integer,
  ADD COLUMN IF NOT EXISTS fingerprint_candidato varchar(64),
  ADD COLUMN IF NOT EXISTS fingerprint_mapping_preview varchar(64),
  ADD COLUMN IF NOT EXISTS data_analisi timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.emissioni_registro_volontari
  ADD COLUMN IF NOT EXISTS scope_tipo varchar(16),
  ADD COLUMN IF NOT EXISTS scope_centro_id integer
    REFERENCES public.centri_di_ascolto(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS scope_area_operativa_id integer
    REFERENCES public.aree_operative(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS scope_centro_ids_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS scope_fingerprint varchar(64);

WITH risolti AS (
  SELECT
    e.id,
    CASE
      WHEN e.centro_ascolto_id IS NOT NULL THEN 'CENTRO'
      WHEN u.area_operativa_id IS NOT NULL THEN 'AREA'
      ELSE 'GLOBALE'
    END AS scope_tipo,
    e.centro_ascolto_id AS scope_centro_id,
    COALESCE(c.area_operativa_id, u.area_operativa_id) AS scope_area_operativa_id
  FROM public.emissioni_registro_volontari e
  LEFT JOIN public.utenti u ON u.id = e.generato_da
  LEFT JOIN public.centri_di_ascolto c ON c.id = e.centro_ascolto_id
)
UPDATE public.emissioni_registro_volontari e
SET scope_tipo = r.scope_tipo,
    scope_centro_id = r.scope_centro_id,
    scope_area_operativa_id = r.scope_area_operativa_id,
    scope_centro_ids_snapshot = CASE
      WHEN r.scope_tipo = 'CENTRO' THEN jsonb_build_array(r.scope_centro_id)
      WHEN r.scope_tipo = 'AREA' THEN COALESCE((
        SELECT jsonb_agg(ca.id ORDER BY ca.id)
        FROM public.centri_di_ascolto ca
        WHERE ca.area_operativa_id = r.scope_area_operativa_id
      ), '[]'::jsonb)
      ELSE COALESCE((
        SELECT jsonb_agg(ca.id ORDER BY ca.id)
        FROM public.centri_di_ascolto ca
      ), '[]'::jsonb)
    END,
    scope_fingerprint =
      md5(concat_ws(':', 'legacy-v1', r.scope_tipo, r.scope_centro_id, r.scope_area_operativa_id))
      || md5(concat_ws(':', 'legacy-v2', r.scope_tipo, r.scope_centro_id, r.scope_area_operativa_id))
FROM risolti r
WHERE e.id = r.id AND e.scope_tipo IS NULL;

ALTER TABLE public.emissioni_registro_volontari
  ALTER COLUMN scope_tipo SET NOT NULL,
  ALTER COLUMN scope_centro_ids_snapshot SET DEFAULT '[]'::jsonb,
  ALTER COLUMN scope_centro_ids_snapshot SET NOT NULL,
  ALTER COLUMN scope_fingerprint SET NOT NULL;

DO $emissione_scope_fingerprint_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.emissioni_registro_volontari'::regclass
      AND conname = 'emissioni_registro_scope_fingerprint_check'
  ) THEN
    ALTER TABLE public.emissioni_registro_volontari
      ADD CONSTRAINT emissioni_registro_scope_fingerprint_check
      CHECK (scope_fingerprint ~ '^[0-9a-f]{64}$') NOT VALID;
  END IF;
END
$emissione_scope_fingerprint_check$;
ALTER TABLE public.emissioni_registro_volontari
  VALIDATE CONSTRAINT emissioni_registro_scope_fingerprint_check;

DO $emissione_scope_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.emissioni_registro_volontari'::regclass
      AND conname = 'emissioni_registro_scope_tipo_check'
  ) THEN
    ALTER TABLE public.emissioni_registro_volontari
      ADD CONSTRAINT emissioni_registro_scope_tipo_check
      CHECK (
        (scope_tipo = 'CENTRO' AND scope_centro_id IS NOT NULL)
        OR (scope_tipo = 'AREA' AND scope_centro_id IS NULL AND scope_area_operativa_id IS NOT NULL)
        OR (scope_tipo = 'GLOBALE' AND scope_centro_id IS NULL AND scope_area_operativa_id IS NULL)
      ) NOT VALID;
  END IF;
END
$emissione_scope_check$;
ALTER TABLE public.emissioni_registro_volontari
  VALIDATE CONSTRAINT emissioni_registro_scope_tipo_check;

CREATE INDEX IF NOT EXISTS emissioni_registro_scope_owner_idx
  ON public.emissioni_registro_volontari (
    scope_tipo, scope_centro_id, scope_area_operativa_id, generato_at DESC
  );

DO $registro_evento_conversione$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.registro_volontari_eventi'::regclass
      AND conname = 'registro_volontari_evento_check'
  ) THEN
    ALTER TABLE public.registro_volontari_eventi
      DROP CONSTRAINT registro_volontari_evento_check;
  END IF;
  ALTER TABLE public.registro_volontari_eventi
    ADD CONSTRAINT registro_volontari_evento_check
    CHECK (tipo_evento IN (
      'REGISTRAZIONE', 'SOSPENSIONE_CESSAZIONE', 'RIATTIVAZIONE',
      'GIORNATA_TEMPORANEA', 'CONVERSIONE_PERMANENTE',
      'AGGIORNAMENTO_ANAGRAFICA', 'RETTIFICA'
    )) NOT VALID;
END
$registro_evento_conversione$;
ALTER TABLE public.registro_volontari_eventi
  VALIDATE CONSTRAINT registro_volontari_evento_check;
