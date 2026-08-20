-- Fase di audit Mensa: aggiornamento esclusivamente additivo/conservativo.
-- Nessun record storico viene cancellato o reinterpretato.

DO $audit$
DECLARE
  overlap_count bigint;
  invalid_service_count bigint;
  orphan_exception_count bigint;
  inconsistent_warehouse_count bigint;
BEGIN
  IF to_regclass('public.mense') IS NULL
    OR to_regclass('public.mensa_abilitazioni') IS NULL
    OR to_regclass('public.mensa_accessi') IS NULL
    OR to_regclass('public.mensa_eccezioni') IS NULL
    OR to_regclass('public.mensa_pasti') IS NULL
    OR to_regclass('public.scarichi') IS NULL
  THEN
    RAISE EXCEPTION 'Schema Mensa incompleto: applicare prima gli aggiornamenti precedenti';
  END IF;

  SELECT count(*) INTO overlap_count
  FROM public.mensa_abilitazioni a
  JOIN public.mensa_abilitazioni b
    ON a.id < b.id
   AND a.beneficiario_id = b.beneficiario_id
   AND a.mensa_principale = true
   AND b.mensa_principale = true
   AND a.stato = 'attiva'
   AND b.stato = 'attiva'
   AND daterange(a.data_inizio, coalesce(a.data_fine, 'infinity'::date), '[]')
       && daterange(b.data_inizio, coalesce(b.data_fine, 'infinity'::date), '[]');
  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'Preflight Mensa: trovate % coppie di abilitazioni principali sovrapposte. Bonificare esplicitamente prima della migrazione.', overlap_count;
  END IF;

  SELECT count(*) INTO invalid_service_count
  FROM public.mensa_pasti
  WHERE lower(trim(tipo_servizio)) NOT IN ('pranzo', 'cena');
  RAISE NOTICE 'Preflight Mensa: % pasti legacy hanno un tipo servizio non canonico; restano preservati e il vincolo rimarrà NOT VALID.', invalid_service_count;

  SELECT count(*) INTO orphan_exception_count
  FROM public.mensa_accessi a
  LEFT JOIN public.mensa_eccezioni e ON e.id = a.eccezione_id
  WHERE a.eccezione_id IS NOT NULL AND e.id IS NULL;
  RAISE NOTICE 'Preflight Mensa: % accessi hanno eccezione_id orfano; restano preservati e la FK rimarrà NOT VALID.', orphan_exception_count;

  SELECT count(*) INTO inconsistent_warehouse_count
  FROM public.mense m
  LEFT JOIN public.magazzini w ON w.id = m.magazzino_id
  WHERE w.id IS NULL OR w.tipo_magazzino <> 'mensa' OR w.citta_id IS DISTINCT FROM m.citta_id;
  RAISE NOTICE 'Preflight Mensa: % associazioni Mensa/Magazzino legacy sono incoerenti; nessuna viene modificata automaticamente.', inconsistent_warehouse_count;
END
$audit$;

ALTER TABLE public.mensa_pasti
  ADD COLUMN IF NOT EXISTS giornata_servizio_id integer,
  ADD COLUMN IF NOT EXISTS sesso_snapshot varchar(10),
  ADD COLUMN IF NOT EXISTS fascia_eta_snapshot varchar(20),
  ADD COLUMN IF NOT EXISTS fascia_eta_origine_snapshot varchar(20),
  ADD COLUMN IF NOT EXISTS anagrafica_provvisoria_snapshot boolean,
  ADD COLUMN IF NOT EXISTS temporaneo_snapshot boolean;

CREATE TABLE IF NOT EXISTS public.mensa_giornate_servizio (
  id serial PRIMARY KEY,
  mensa_id integer NOT NULL REFERENCES public.mense(id),
  data_servizio date NOT NULL,
  tipo_servizio varchar(40) NOT NULL,
  stato varchar(20) NOT NULL DEFAULT 'aperta',
  aperta_da integer REFERENCES public.utenti(id),
  aperta_at timestamptz NOT NULL DEFAULT now(),
  chiusa_da integer REFERENCES public.utenti(id),
  chiusa_at timestamptz,
  riaperta_da integer REFERENCES public.utenti(id),
  riaperta_at timestamptz,
  motivo_riapertura text,
  note_chiusura text,
  snapshot jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mensa_giornate_servizio_tipo_check CHECK (tipo_servizio IN ('pranzo', 'cena')),
  CONSTRAINT mensa_giornate_servizio_stato_check CHECK (stato IN ('aperta', 'chiusa'))
);
CREATE UNIQUE INDEX IF NOT EXISTS mensa_giornate_servizio_unique
  ON public.mensa_giornate_servizio (mensa_id, data_servizio, tipo_servizio);
CREATE INDEX IF NOT EXISTS mensa_giornate_servizio_mensa_data_idx
  ON public.mensa_giornate_servizio (mensa_id, data_servizio);

CREATE TABLE IF NOT EXISTS public.mensa_consumi (
  id serial PRIMARY KEY,
  giornata_servizio_id integer NOT NULL REFERENCES public.mensa_giornate_servizio(id),
  mensa_id integer NOT NULL REFERENCES public.mense(id),
  scarico_id integer NOT NULL REFERENCES public.scarichi(id),
  data_servizio date NOT NULL,
  tipo_servizio varchar(40) NOT NULL,
  prodotto_id integer NOT NULL REFERENCES public.prodotti(id),
  quantita numeric(10,2) NOT NULL,
  unita_misura varchar(20) NOT NULL,
  causale varchar(20) NOT NULL,
  note text,
  operatore_id integer NOT NULL REFERENCES public.utenti(id),
  idempotency_key varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mensa_consumi_tipo_check CHECK (tipo_servizio IN ('pranzo', 'cena')),
  CONSTRAINT mensa_consumi_causale_check CHECK (causale IN ('consumo', 'scarto')),
  CONSTRAINT mensa_consumi_quantita_check CHECK (quantita > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS mensa_consumi_idempotency_unique
  ON public.mensa_consumi (idempotency_key);
CREATE INDEX IF NOT EXISTS mensa_consumi_giornata_idx
  ON public.mensa_consumi (giornata_servizio_id);
CREATE INDEX IF NOT EXISTS mensa_consumi_mensa_data_idx
  ON public.mensa_consumi (mensa_id, data_servizio);

DO $audit$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.mensa_consumi'::regclass
      AND conname = 'mensa_consumi_causale_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%scarto%'
  ) THEN
    ALTER TABLE public.mensa_consumi
      DROP CONSTRAINT mensa_consumi_causale_check;
    ALTER TABLE public.mensa_consumi
      ADD CONSTRAINT mensa_consumi_causale_check
      CHECK (causale IN ('consumo', 'scarto')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mensa_consumi
    WHERE causale NOT IN ('consumo', 'scarto')
  ) THEN
    ALTER TABLE public.mensa_consumi
      VALIDATE CONSTRAINT mensa_consumi_causale_check;
  END IF;
END
$audit$;

CREATE TABLE IF NOT EXISTS public.mensa_consumi_storni (
  id serial PRIMARY KEY,
  consumo_id integer NOT NULL REFERENCES public.mensa_consumi(id),
  motivo text NOT NULL,
  operatore_id integer NOT NULL REFERENCES public.utenti(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mensa_consumi_storni_consumo_unique
  ON public.mensa_consumi_storni (consumo_id);

DO $audit$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mensa_pasti'::regclass
      AND conname = 'mensa_pasti_giornata_servizio_fk'
  ) THEN
    ALTER TABLE public.mensa_pasti
      ADD CONSTRAINT mensa_pasti_giornata_servizio_fk
      FOREIGN KEY (giornata_servizio_id)
      REFERENCES public.mensa_giornate_servizio(id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.mensa_accessi'::regclass
      AND c.confrelid = 'public.mensa_eccezioni'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.mensa_accessi'::regclass
           AND attname = 'eccezione_id')
      ]::smallint[]
  ) THEN
    ALTER TABLE public.mensa_accessi
      ADD CONSTRAINT mensa_accessi_eccezione_fk_audit
      FOREIGN KEY (eccezione_id)
      REFERENCES public.mensa_eccezioni(id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mensa_pasti'::regclass
      AND conname = 'mensa_pasti_tipo_canonico_check'
  ) THEN
    ALTER TABLE public.mensa_pasti
      ADD CONSTRAINT mensa_pasti_tipo_canonico_check
      CHECK (tipo_servizio IN ('pranzo', 'cena'))
      NOT VALID;
  END IF;
END
$audit$;

-- Alcuni ambienti hanno già il vincolo equivalente introdotto dalla Fase 5-4.
-- Se una precedente esecuzione di questo aggiornamento ha aggiunto anche il
-- vincolo audit, rimuove soltanto il duplicato strutturale (mai righe o dati).
DO $audit$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.mensa_accessi'::regclass
      AND c.conname = 'mensa_accessi_eccezione_fk_audit'
  ) AND EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.mensa_accessi'::regclass
      AND c.confrelid = 'public.mensa_eccezioni'::regclass
      AND c.contype = 'f'
      AND c.conname <> 'mensa_accessi_eccezione_fk_audit'
      AND c.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.mensa_accessi'::regclass
           AND attname = 'eccezione_id')
      ]::smallint[]
  ) THEN
    ALTER TABLE public.mensa_accessi
      DROP CONSTRAINT mensa_accessi_eccezione_fk_audit;
  END IF;
END
$audit$;

DO $audit$
DECLARE
  constraint_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mensa_accessi a
    LEFT JOIN public.mensa_eccezioni e ON e.id = a.eccezione_id
    WHERE a.eccezione_id IS NOT NULL AND e.id IS NULL
  ) THEN
    FOR constraint_name IN
      SELECT c.conname
      FROM pg_constraint c
      WHERE c.conrelid = 'public.mensa_accessi'::regclass
        AND c.confrelid = 'public.mensa_eccezioni'::regclass
        AND c.contype = 'f'
        AND c.conkey = ARRAY[
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'public.mensa_accessi'::regclass
             AND attname = 'eccezione_id')
        ]::smallint[]
    LOOP
      EXECUTE format(
        'ALTER TABLE public.mensa_accessi VALIDATE CONSTRAINT %I',
        constraint_name
      );
    END LOOP;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mensa_pasti
    WHERE tipo_servizio NOT IN ('pranzo', 'cena')
  ) THEN
    ALTER TABLE public.mensa_pasti VALIDATE CONSTRAINT mensa_pasti_tipo_canonico_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mensa_pasti p
    LEFT JOIN public.mensa_giornate_servizio g ON g.id = p.giornata_servizio_id
    WHERE p.giornata_servizio_id IS NOT NULL AND g.id IS NULL
  ) THEN
    ALTER TABLE public.mensa_pasti VALIDATE CONSTRAINT mensa_pasti_giornata_servizio_fk;
  END IF;
END
$audit$;

-- La vecchia unicità impediva anche intervalli futuri disgiunti. La protezione
-- seguente serializza per beneficiario e verifica la reale sovrapposizione.
DROP INDEX IF EXISTS public.mensa_abilitazioni_principale_attiva_unique;

CREATE OR REPLACE FUNCTION public.mensa_check_abilitazione_principale_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.mensa_principale = true AND NEW.stato = 'attiva' THEN
    PERFORM pg_advisory_xact_lock(hashtext('mensa-abilitazione:' || NEW.beneficiario_id::text));
    IF EXISTS (
      SELECT 1
      FROM public.mensa_abilitazioni other
      WHERE other.beneficiario_id = NEW.beneficiario_id
        AND other.mensa_principale = true
        AND other.stato = 'attiva'
        AND other.id IS DISTINCT FROM NEW.id
        AND daterange(other.data_inizio, coalesce(other.data_fine, 'infinity'::date), '[]')
            && daterange(NEW.data_inizio, coalesce(NEW.data_fine, 'infinity'::date), '[]')
    ) THEN
      RAISE EXCEPTION 'ABILITAZIONE_PRINCIPALE_SOVRAPPOSTA'
        USING ERRCODE = '23P01', CONSTRAINT = 'mensa_abilitazioni_principale_periodo_excl';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS mensa_abilitazioni_principale_overlap_trg
  ON public.mensa_abilitazioni;
CREATE TRIGGER mensa_abilitazioni_principale_overlap_trg
BEFORE INSERT OR UPDATE OF beneficiario_id, data_inizio, data_fine, stato, mensa_principale
ON public.mensa_abilitazioni
FOR EACH ROW EXECUTE FUNCTION public.mensa_check_abilitazione_principale_overlap();

DO $audit$
BEGIN
  RAISE NOTICE 'Aggiornamento Mensa completato senza cancellazioni o normalizzazioni dei record legacy.';
END
$audit$;
