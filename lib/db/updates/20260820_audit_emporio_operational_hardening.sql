-- Hardening operativo Emporio Solidale: aggiornamento additivo e conservativo.
-- Nessun dato business viene cancellato o reinterpretato.

DO $audit$
DECLARE
  duplicate_access_groups bigint;
  duplicate_session_groups bigint;
  duplicate_monthly_groups bigint;
BEGIN
  IF to_regclass('public.sessioni_cassa_emporio') IS NULL
    OR to_regclass('public.sessioni_cassa_emporio_righe') IS NULL
    OR to_regclass('public.spese_emporio') IS NULL
    OR to_regclass('public.spese_emporio_righe') IS NULL
    OR to_regclass('public.credito_solidale_movimenti') IS NULL
  THEN
    RAISE EXCEPTION 'Schema Emporio incompleto: applicare prima gli aggiornamenti precedenti';
  END IF;

  SELECT count(*) INTO duplicate_access_groups
  FROM (
    SELECT beneficiario_id, (data_ora_inizio AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date
    FROM public.consegne
    WHERE tipo_pianificazione = 'accesso_emporio'
      AND stato_accesso_emporio NOT IN ('annullato', 'non_presentato')
    GROUP BY beneficiario_id, (data_ora_inizio AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date
    HAVING count(*) > 1
  ) duplicates;
  RAISE NOTICE 'Preflight Emporio: % gruppi Accesso legacy duplicati; restano preservati.', duplicate_access_groups;

  SELECT count(*) INTO duplicate_session_groups
  FROM (
    SELECT accesso_emporio_id
    FROM public.sessioni_cassa_emporio
    WHERE stato_sessione <> 'annullata'
    GROUP BY accesso_emporio_id
    HAVING count(*) > 1
  ) duplicates;
  RAISE NOTICE 'Preflight Emporio: % gruppi Sessione legacy duplicati; restano preservati.', duplicate_session_groups;

  SELECT count(*) INTO duplicate_monthly_groups
  FROM (
    SELECT beneficiario_id, periodo_riferimento
    FROM public.credito_solidale_movimenti
    WHERE tipo_movimento = 'ricarica_mensile' AND annullato = false
    GROUP BY beneficiario_id, periodo_riferimento
    HAVING count(*) > 1
  ) duplicates;
  RAISE NOTICE 'Preflight Emporio: % gruppi ricarica mensile legacy duplicati; restano preservati.', duplicate_monthly_groups;
END
$audit$;

ALTER TABLE public.sessioni_cassa_emporio
  ADD COLUMN IF NOT EXISTS versione integer NOT NULL DEFAULT 1;

ALTER TABLE public.sessioni_cassa_emporio_righe
  ALTER COLUMN quantita TYPE numeric(10,2) USING quantita::numeric(10,2),
  ALTER COLUMN giacenza_disponibile_al_momento TYPE numeric(10,2)
    USING giacenza_disponibile_al_momento::numeric(10,2),
  ALTER COLUMN limite_per_spesa TYPE numeric(10,2)
    USING limite_per_spesa::numeric(10,2),
  ALTER COLUMN limite_mensile TYPE numeric(10,2)
    USING limite_mensile::numeric(10,2),
  ADD COLUMN IF NOT EXISTS unita_misura varchar(20);

ALTER TABLE public.spese_emporio_righe
  ADD COLUMN IF NOT EXISTS unita_misura varchar(20);

DO $audit$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sessioni_cassa_emporio_righe'::regclass
      AND conname = 'sessioni_cassa_emporio_righe_quantita_positive_check'
  ) THEN
    ALTER TABLE public.sessioni_cassa_emporio_righe
      ADD CONSTRAINT sessioni_cassa_emporio_righe_quantita_positive_check
      CHECK (quantita > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sessioni_cassa_emporio_righe WHERE quantita <= 0
  ) THEN
    ALTER TABLE public.sessioni_cassa_emporio_righe
      VALIDATE CONSTRAINT sessioni_cassa_emporio_righe_quantita_positive_check;
  END IF;
END
$audit$;

CREATE TABLE IF NOT EXISTS public.spese_emporio_storni (
  id serial PRIMARY KEY,
  spesa_emporio_id integer NOT NULL REFERENCES public.spese_emporio(id),
  motivo text NOT NULL,
  operatore_id integer REFERENCES public.utenti(id),
  credito_restituito numeric(10,2) NOT NULL DEFAULT 0,
  movimento_credito_solidale_id integer REFERENCES public.credito_solidale_movimenti(id),
  idempotency_key varchar(100),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT spese_emporio_storni_credito_check CHECK (credito_restituito > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS spese_emporio_storni_idempotency_unique
  ON public.spese_emporio_storni (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS spese_emporio_storni_spesa_idx
  ON public.spese_emporio_storni (spesa_emporio_id, id);

CREATE TABLE IF NOT EXISTS public.spese_emporio_storni_righe (
  id serial PRIMARY KEY,
  storno_id integer NOT NULL REFERENCES public.spese_emporio_storni(id),
  spesa_riga_id integer NOT NULL REFERENCES public.spese_emporio_righe(id),
  quantita numeric(10,2) NOT NULL,
  credito_restituito numeric(10,2) NOT NULL,
  movimento_inventario_id integer REFERENCES public.movimenti(id),
  movimento_inventario_originale_id integer REFERENCES public.movimenti(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT spese_emporio_storni_righe_quantita_check CHECK (quantita > 0),
  CONSTRAINT spese_emporio_storni_righe_credito_check CHECK (credito_restituito > 0)
);
ALTER TABLE public.spese_emporio_storni_righe
  ADD COLUMN IF NOT EXISTS movimento_inventario_originale_id integer
    REFERENCES public.movimenti(id);
CREATE INDEX IF NOT EXISTS spese_emporio_storni_righe_spesa_riga_idx
  ON public.spese_emporio_storni_righe (spesa_riga_id, id);
CREATE INDEX IF NOT EXISTS spese_emporio_storni_righe_movimento_originale_idx
  ON public.spese_emporio_storni_righe (movimento_inventario_originale_id);

CREATE OR REPLACE FUNCTION public.prevent_new_duplicate_accesso_emporio()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  civil_day date;
BEGIN
  IF NEW.tipo_pianificazione IS DISTINCT FROM 'accesso_emporio'
    OR NEW.stato_accesso_emporio IN ('annullato', 'non_presentato')
  THEN
    RETURN NEW;
  END IF;
  civil_day := (NEW.data_ora_inizio AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date;
  PERFORM pg_advisory_xact_lock(
    hashtext('accesso-emporio'),
    hashtext(NEW.beneficiario_id::text || ':' || civil_day::text)
  );
  IF EXISTS (
    SELECT 1 FROM public.consegne c
    WHERE c.id IS DISTINCT FROM NEW.id
      AND c.tipo_pianificazione = 'accesso_emporio'
      AND c.beneficiario_id = NEW.beneficiario_id
      AND (c.data_ora_inizio AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date = civil_day
      AND c.stato_accesso_emporio NOT IN ('annullato', 'non_presentato')
  ) THEN
    RAISE EXCEPTION 'Esiste già un Accesso Emporio operativo per beneficiario e data'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS prevent_new_duplicate_accesso_emporio_trg ON public.consegne;
CREATE TRIGGER prevent_new_duplicate_accesso_emporio_trg
BEFORE INSERT OR UPDATE OF beneficiario_id, data_ora_inizio, stato_accesso_emporio, tipo_pianificazione
ON public.consegne
FOR EACH ROW EXECUTE FUNCTION public.prevent_new_duplicate_accesso_emporio();

CREATE OR REPLACE FUNCTION public.prevent_new_duplicate_sessione_emporio()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.stato_sessione = 'annullata' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtext('sessione-cassa-emporio'),
    NEW.accesso_emporio_id
  );
  IF EXISTS (
    SELECT 1 FROM public.sessioni_cassa_emporio s
    WHERE s.id IS DISTINCT FROM NEW.id
      AND s.accesso_emporio_id = NEW.accesso_emporio_id
      AND s.stato_sessione <> 'annullata'
  ) THEN
    RAISE EXCEPTION 'Esiste già una Sessione Cassa Emporio per questo Accesso'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS prevent_new_duplicate_sessione_emporio_trg
  ON public.sessioni_cassa_emporio;
CREATE TRIGGER prevent_new_duplicate_sessione_emporio_trg
BEFORE INSERT OR UPDATE OF accesso_emporio_id, stato_sessione
ON public.sessioni_cassa_emporio
FOR EACH ROW EXECUTE FUNCTION public.prevent_new_duplicate_sessione_emporio();

CREATE OR REPLACE FUNCTION public.prevent_new_duplicate_ricarica_mensile()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.tipo_movimento <> 'ricarica_mensile' OR NEW.annullato THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtext('credito-ricarica-mensile'),
    NEW.beneficiario_id
  );
  IF EXISTS (
    SELECT 1 FROM public.credito_solidale_movimenti m
    WHERE m.id IS DISTINCT FROM NEW.id
      AND m.beneficiario_id = NEW.beneficiario_id
      AND m.periodo_riferimento IS NOT DISTINCT FROM NEW.periodo_riferimento
      AND m.tipo_movimento = 'ricarica_mensile'
      AND m.annullato = false
  ) THEN
    RAISE EXCEPTION 'Ricarica mensile già presente per beneficiario e periodo'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS prevent_new_duplicate_ricarica_mensile_trg
  ON public.credito_solidale_movimenti;
CREATE TRIGGER prevent_new_duplicate_ricarica_mensile_trg
BEFORE INSERT OR UPDATE OF beneficiario_id, periodo_riferimento, tipo_movimento, annullato
ON public.credito_solidale_movimenti
FOR EACH ROW EXECUTE FUNCTION public.prevent_new_duplicate_ricarica_mensile();
