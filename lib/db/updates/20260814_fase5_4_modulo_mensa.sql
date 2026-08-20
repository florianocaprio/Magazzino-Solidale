DO $update$
BEGIN
  IF to_regclass('public.beneficiari') IS NULL
    OR to_regclass('public.magazzini') IS NULL
    OR to_regclass('public.trasferimenti') IS NULL
    OR to_regclass('public.ruoli') IS NULL
  THEN
    RAISE EXCEPTION 'Schema base incompleto: applicare prima gli aggiornamenti precedenti';
  END IF;
END
$update$;

ALTER TABLE public.ruoli
  ADD COLUMN IF NOT EXISTS permessi jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.beneficiari
  ADD COLUMN IF NOT EXISTS stato_anagrafica varchar(20) NOT NULL DEFAULT 'completa';

DO $update$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.beneficiari'::regclass
      AND conname = 'beneficiari_stato_anagrafica_check'
  ) THEN
    ALTER TABLE public.beneficiari
      ADD CONSTRAINT beneficiari_stato_anagrafica_check
      CHECK (stato_anagrafica IN ('provvisoria', 'completa'));
  END IF;
END
$update$;

CREATE TABLE IF NOT EXISTS public.mense (
  id serial PRIMARY KEY,
  codice varchar(30) NOT NULL,
  nome varchar(160) NOT NULL,
  citta_id integer NOT NULL REFERENCES public.citta(id),
  magazzino_id integer NOT NULL REFERENCES public.magazzini(id),
  indirizzo varchar(255),
  attiva boolean NOT NULL DEFAULT true,
  note text,
  created_by integer REFERENCES public.utenti(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mense_codice_unique
  ON public.mense (codice);
CREATE UNIQUE INDEX IF NOT EXISTS mense_magazzino_unique
  ON public.mense (magazzino_id);
DO $update$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mense'
      AND column_name = 'area_operativa_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS mense_area_operativa_idx
      ON public.mense (area_operativa_id);
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mense'
      AND column_name = 'citta_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS mense_citta_idx
      ON public.mense (citta_id);
  ELSE
    RAISE EXCEPTION 'Schema Mensa inatteso: colonna di Area Operativa assente';
  END IF;
END
$update$;
CREATE INDEX IF NOT EXISTS mense_attiva_idx ON public.mense (attiva);

CREATE TABLE IF NOT EXISTS public.mensa_abilitazioni (
  id serial PRIMARY KEY,
  beneficiario_id integer NOT NULL REFERENCES public.beneficiari(id),
  mensa_id integer NOT NULL REFERENCES public.mense(id),
  data_inizio date NOT NULL,
  data_fine date,
  stato varchar(20) NOT NULL DEFAULT 'attiva',
  mensa_principale boolean NOT NULL DEFAULT true,
  motivo text,
  created_by integer REFERENCES public.utenti(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mensa_abilitazioni_stato_check
    CHECK (stato IN ('attiva', 'sospesa', 'revocata', 'scaduta')),
  CONSTRAINT mensa_abilitazioni_date_check
    CHECK (data_fine IS NULL OR data_fine >= data_inizio)
);

CREATE INDEX IF NOT EXISTS mensa_abilitazioni_beneficiario_idx
  ON public.mensa_abilitazioni (beneficiario_id);
CREATE INDEX IF NOT EXISTS mensa_abilitazioni_mensa_idx
  ON public.mensa_abilitazioni (mensa_id);
CREATE INDEX IF NOT EXISTS mensa_abilitazioni_stato_idx
  ON public.mensa_abilitazioni (stato);
CREATE UNIQUE INDEX IF NOT EXISTS mensa_abilitazioni_principale_attiva_unique
  ON public.mensa_abilitazioni (beneficiario_id)
  WHERE stato = 'attiva' AND mensa_principale = true;

CREATE TABLE IF NOT EXISTS public.tessere_beneficiari (
  id serial PRIMARY KEY,
  beneficiario_id integer NOT NULL REFERENCES public.beneficiari(id),
  codice varchar(64) NOT NULL,
  stato varchar(20) NOT NULL DEFAULT 'attiva',
  data_emissione timestamptz NOT NULL DEFAULT now(),
  data_scadenza date,
  data_revoca timestamptz,
  motivo_revoca text,
  created_by integer REFERENCES public.utenti(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tessere_beneficiari_stato_check
    CHECK (stato IN ('attiva', 'sospesa', 'revocata', 'scaduta'))
);

CREATE UNIQUE INDEX IF NOT EXISTS tessere_beneficiari_codice_unique
  ON public.tessere_beneficiari (codice);
CREATE UNIQUE INDEX IF NOT EXISTS tessere_beneficiari_attiva_unique
  ON public.tessere_beneficiari (beneficiario_id)
  WHERE stato = 'attiva';
CREATE INDEX IF NOT EXISTS tessere_beneficiari_beneficiario_idx
  ON public.tessere_beneficiari (beneficiario_id);
CREATE INDEX IF NOT EXISTS tessere_beneficiari_stato_idx
  ON public.tessere_beneficiari (stato);

-- Compatibilità legacy: il codice beneficiario già stampato sulle tessere
-- storiche viene accettato una sola volta come primo token trasversale. Questo
-- backfill non definisce il formato delle nuove emissioni: l'API genera sempre
-- token casuali opachi con prefisso MS- e non inserisce dati personali nel
-- QR/barcode.
INSERT INTO public.tessere_beneficiari (
  beneficiario_id,
  codice,
  stato,
  data_emissione,
  created_at,
  updated_at
)
SELECT
  b.id,
  b.codice,
  'attiva',
  b.data_creazione,
  b.data_creazione,
  now()
FROM public.beneficiari b
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tessere_beneficiari t
  WHERE t.beneficiario_id = b.id
     OR t.codice = b.codice
)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mensa_autorizzazioni_temporanee (
  id serial PRIMARY KEY,
  beneficiario_id integer NOT NULL REFERENCES public.beneficiari(id),
  mensa_id integer NOT NULL REFERENCES public.mense(id),
  data_servizio date NOT NULL,
  motivo text NOT NULL,
  operatore_id integer NOT NULL REFERENCES public.utenti(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mensa_autorizzazioni_temporanee_giorno_unique
  ON public.mensa_autorizzazioni_temporanee
    (beneficiario_id, mensa_id, data_servizio);
CREATE INDEX IF NOT EXISTS mensa_autorizzazioni_temporanee_mensa_data_idx
  ON public.mensa_autorizzazioni_temporanee (mensa_id, data_servizio);

CREATE TABLE IF NOT EXISTS public.mensa_accessi (
  id serial PRIMARY KEY,
  mensa_id integer NOT NULL REFERENCES public.mense(id),
  beneficiario_id integer REFERENCES public.beneficiari(id),
  tessera_id integer REFERENCES public.tessere_beneficiari(id),
  autorizzazione_temporanea_id integer,
  data_ora timestamptz NOT NULL DEFAULT now(),
  esito varchar(30) NOT NULL,
  motivo_esito varchar(50) NOT NULL,
  operatore_id integer NOT NULL REFERENCES public.utenti(id),
  eccezione_id integer,
  modalita_accesso varchar(20) NOT NULL,
  idempotency_key varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mensa_accessi_esito_check
    CHECK (esito IN ('consentito', 'negato', 'consentito_eccezione')),
  CONSTRAINT mensa_accessi_modalita_check
    CHECK (modalita_accesso IN ('tessera', 'manuale', 'temporaneo'))
);

ALTER TABLE public.mensa_accessi
  ADD COLUMN IF NOT EXISTS autorizzazione_temporanea_id integer;

DO $update$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'public.mensa_accessi'::regclass
      AND c.confrelid = 'public.mensa_autorizzazioni_temporanee'::regclass
      AND c.contype = 'f'
      AND a.attname = 'autorizzazione_temporanea_id'
  ) THEN
    ALTER TABLE public.mensa_accessi
      ADD CONSTRAINT mensa_accessi_temp_auth_fk
      FOREIGN KEY (autorizzazione_temporanea_id)
      REFERENCES public.mensa_autorizzazioni_temporanee(id);
  END IF;

  ALTER TABLE public.mensa_accessi
    DROP CONSTRAINT IF EXISTS mensa_accessi_modalita_check;
  ALTER TABLE public.mensa_accessi
    ADD CONSTRAINT mensa_accessi_modalita_check
    CHECK (modalita_accesso IN ('tessera', 'manuale', 'temporaneo'));
END
$update$;

CREATE UNIQUE INDEX IF NOT EXISTS mensa_accessi_idempotency_unique
  ON public.mensa_accessi (idempotency_key);
CREATE INDEX IF NOT EXISTS mensa_accessi_mensa_data_idx
  ON public.mensa_accessi (mensa_id, data_ora);
CREATE INDEX IF NOT EXISTS mensa_accessi_beneficiario_data_idx
  ON public.mensa_accessi (beneficiario_id, data_ora);

CREATE TABLE IF NOT EXISTS public.mensa_eccezioni (
  id serial PRIMARY KEY,
  beneficiario_id integer NOT NULL REFERENCES public.beneficiari(id),
  mensa_principale_id integer NOT NULL REFERENCES public.mense(id),
  mensa_destinazione_id integer NOT NULL REFERENCES public.mense(id),
  citta_id integer NOT NULL REFERENCES public.citta(id),
  motivo text NOT NULL,
  operatore_id integer NOT NULL REFERENCES public.utenti(id),
  data_ora timestamptz NOT NULL DEFAULT now(),
  accesso_mensa_id integer NOT NULL REFERENCES public.mensa_accessi(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mensa_eccezioni_accesso_unique
  ON public.mensa_eccezioni (accesso_mensa_id);
CREATE INDEX IF NOT EXISTS mensa_eccezioni_beneficiario_idx
  ON public.mensa_eccezioni (beneficiario_id);
CREATE INDEX IF NOT EXISTS mensa_eccezioni_mensa_data_idx
  ON public.mensa_eccezioni (mensa_destinazione_id, data_ora);

DO $update$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mensa_accessi'::regclass
      AND conname = 'mensa_accessi_eccezione_id_mensa_eccezioni_id_fk'
  ) THEN
    ALTER TABLE public.mensa_accessi
      ADD CONSTRAINT mensa_accessi_eccezione_id_mensa_eccezioni_id_fk
      FOREIGN KEY (eccezione_id) REFERENCES public.mensa_eccezioni(id);
  END IF;
END
$update$;

CREATE TABLE IF NOT EXISTS public.mensa_pasti (
  id serial PRIMARY KEY,
  mensa_id integer NOT NULL REFERENCES public.mense(id),
  beneficiario_id integer NOT NULL REFERENCES public.beneficiari(id),
  accesso_mensa_id integer NOT NULL REFERENCES public.mensa_accessi(id),
  data_ora timestamptz NOT NULL DEFAULT now(),
  data_servizio date NOT NULL,
  tipo_servizio varchar(40) NOT NULL,
  operatore_id integer NOT NULL REFERENCES public.utenti(id),
  eccezione_id integer REFERENCES public.mensa_eccezioni(id),
  note text,
  override boolean NOT NULL DEFAULT false,
  motivo_override text,
  idempotency_key varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mensa_pasti_tipo_check
    CHECK (length(trim(tipo_servizio)) > 0),
  CONSTRAINT mensa_pasti_override_motivo_check
    CHECK (override = false OR length(trim(coalesce(motivo_override, ''))) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS mensa_pasti_accesso_unique
  ON public.mensa_pasti (accesso_mensa_id);
CREATE UNIQUE INDEX IF NOT EXISTS mensa_pasti_idempotency_unique
  ON public.mensa_pasti (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS mensa_pasti_servizio_giorno_unique
  ON public.mensa_pasti (beneficiario_id, data_servizio, tipo_servizio)
  WHERE override = false;
CREATE INDEX IF NOT EXISTS mensa_pasti_mensa_servizio_idx
  ON public.mensa_pasti (mensa_id, data_servizio);
CREATE INDEX IF NOT EXISTS mensa_pasti_beneficiario_servizio_idx
  ON public.mensa_pasti (beneficiario_id, data_servizio);

ALTER TABLE public.trasferimenti
  ADD COLUMN IF NOT EXISTS mensa_id integer,
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(80);

DO $update$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.trasferimenti'::regclass
      AND conname = 'trasferimenti_mensa_id_mense_id_fk'
  ) THEN
    ALTER TABLE public.trasferimenti
      ADD CONSTRAINT trasferimenti_mensa_id_mense_id_fk
      FOREIGN KEY (mensa_id) REFERENCES public.mense(id);
  END IF;
END
$update$;

CREATE UNIQUE INDEX IF NOT EXISTS trasferimenti_idempotency_unique
  ON public.trasferimenti (idempotency_key);
CREATE INDEX IF NOT EXISTS trasferimenti_mensa_idx
  ON public.trasferimenti (mensa_id);

DO $update$
DECLARE
  required_tables integer;
BEGIN
  SELECT count(*) INTO required_tables
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'mense',
      'mensa_abilitazioni',
      'tessere_beneficiari',
      'mensa_autorizzazioni_temporanee',
      'mensa_accessi',
      'mensa_eccezioni',
      'mensa_pasti'
    );

  IF required_tables <> 7 THEN
    RAISE EXCEPTION 'Aggiornamento Mensa incompleto: tabelle attese non disponibili';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ruoli'
      AND column_name = 'permessi' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Aggiornamento Mensa incompleto: ruoli.permessi non disponibile';
  END IF;
END
$update$;
