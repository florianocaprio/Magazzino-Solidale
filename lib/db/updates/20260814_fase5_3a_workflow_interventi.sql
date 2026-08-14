DO $update$
BEGIN
  IF to_regclass('public.interventi') IS NULL THEN
    RAISE EXCEPTION 'Tabella public.interventi non trovata: eseguire prima il bootstrap dello schema';
  END IF;
END
$update$;

ALTER TABLE public.interventi
  ADD COLUMN IF NOT EXISTS stato varchar(30),
  ADD COLUMN IF NOT EXISTS ambito varchar(20),
  ADD COLUMN IF NOT EXISTS priorita varchar(20),
  ADD COLUMN IF NOT EXISTS data_ora_pianificata timestamp with time zone,
  ADD COLUMN IF NOT EXISTS data_ora_avvio timestamp with time zone,
  ADD COLUMN IF NOT EXISTS data_ora_conclusione timestamp with time zone,
  ADD COLUMN IF NOT EXISTS intervento_precedente_id integer,
  ADD COLUMN IF NOT EXISTS sede varchar(255),
  ADD COLUMN IF NOT EXISTS motivo_annullamento text,
  ADD COLUMN IF NOT EXISTS data_aggiornamento timestamp with time zone;

-- Le schede storiche descrivono attività già registrate. Non viene invece
-- inventato alcun ambito o orario effettivo: quei campi restano NULL.
UPDATE public.interventi
SET stato = 'concluso'
WHERE stato IS NULL;

UPDATE public.interventi
SET priorita = 'normale'
WHERE priorita IS NULL;

ALTER TABLE public.interventi
  ALTER COLUMN data_intervento DROP NOT NULL,
  ALTER COLUMN stato SET DEFAULT 'concluso',
  ALTER COLUMN stato SET NOT NULL,
  ALTER COLUMN priorita SET DEFAULT 'normale',
  ALTER COLUMN priorita SET NOT NULL,
  ALTER COLUMN data_aggiornamento SET DEFAULT now();

DO $update$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.interventi'::regclass
      AND conname = 'interventi_stato_check'
  ) THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_stato_check
      CHECK (stato IN (
        'da_pianificare', 'pianificato', 'in_corso', 'concluso',
        'annullato', 'mancata_presentazione'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.interventi'::regclass
      AND conname = 'interventi_ambito_check'
  ) THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_ambito_check
      CHECK (ambito IS NULL OR ambito IN ('sociale', 'uds'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.interventi'::regclass
      AND conname = 'interventi_priorita_check'
  ) THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_priorita_check
      CHECK (priorita IN ('bassa', 'normale', 'alta', 'urgente'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.interventi'::regclass
      AND conname = 'interventi_pianificato_data_check'
  ) THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_pianificato_data_check
      CHECK (stato <> 'pianificato' OR data_ora_pianificata IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.interventi'::regclass
      AND conname = 'interventi_timestamp_ordine_check'
  ) THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_timestamp_ordine_check
      CHECK (
        data_ora_avvio IS NULL OR data_ora_conclusione IS NULL
        OR data_ora_conclusione >= data_ora_avvio
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.interventi'::regclass
      AND conname = 'interventi_precedente_diverso_check'
  ) THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_precedente_diverso_check
      CHECK (
        intervento_precedente_id IS NULL OR intervento_precedente_id <> id
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.interventi'::regclass
      AND confrelid = 'public.interventi'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.interventi'::regclass
           AND attname = 'intervento_precedente_id')
      ]::smallint[]
  ) THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_precedente_id_interventi_id_fk
      FOREIGN KEY (intervento_precedente_id) REFERENCES public.interventi(id);
  END IF;
END
$update$;

CREATE INDEX IF NOT EXISTS interventi_beneficiario_idx
  ON public.interventi (beneficiario_id);
CREATE INDEX IF NOT EXISTS interventi_operatore_idx
  ON public.interventi (operatore_id);
CREATE INDEX IF NOT EXISTS interventi_stato_idx
  ON public.interventi (stato);
CREATE INDEX IF NOT EXISTS interventi_ambito_idx
  ON public.interventi (ambito);
CREATE INDEX IF NOT EXISTS interventi_priorita_idx
  ON public.interventi (priorita);
CREATE INDEX IF NOT EXISTS interventi_data_ora_pianificata_idx
  ON public.interventi (data_ora_pianificata);
CREATE INDEX IF NOT EXISTS interventi_precedente_idx
  ON public.interventi (intervento_precedente_id);

CREATE TABLE IF NOT EXISTS public.interventi_storico_stati (
  id serial PRIMARY KEY,
  intervento_id integer NOT NULL,
  stato_precedente varchar(30),
  stato_nuovo varchar(30) NOT NULL,
  operatore_id integer,
  data_transizione timestamp with time zone NOT NULL DEFAULT now(),
  motivo text,
  CONSTRAINT interventi_storico_intervento_id_interventi_id_fk
    FOREIGN KEY (intervento_id) REFERENCES public.interventi(id) ON DELETE CASCADE,
  CONSTRAINT interventi_storico_operatore_id_utenti_id_fk
    FOREIGN KEY (operatore_id) REFERENCES public.utenti(id),
  CONSTRAINT interventi_storico_stato_precedente_check
    CHECK (
      stato_precedente IS NULL OR stato_precedente IN (
        'da_pianificare', 'pianificato', 'in_corso', 'concluso',
        'annullato', 'mancata_presentazione'
      )
    ),
  CONSTRAINT interventi_storico_stato_nuovo_check
    CHECK (stato_nuovo IN (
      'da_pianificare', 'pianificato', 'in_corso', 'concluso',
      'annullato', 'mancata_presentazione'
    ))
);

-- La cancellazione diretta di un intervento non è esposta dall'applicazione. La
-- cascata mantiene però lo schema coerente nelle pulizie controllate dei test e
-- in eventuali procedure amministrative che rimuovano l'entità padre.
DO $update$
DECLARE
  history_fk_delete_action "char";
BEGIN
  SELECT confdeltype INTO history_fk_delete_action
  FROM pg_constraint
  WHERE conrelid = 'public.interventi_storico_stati'::regclass
    AND conname = 'interventi_storico_intervento_id_interventi_id_fk';

  IF history_fk_delete_action IS DISTINCT FROM 'c' THEN
    ALTER TABLE public.interventi_storico_stati
      DROP CONSTRAINT IF EXISTS interventi_storico_intervento_id_interventi_id_fk;
    ALTER TABLE public.interventi_storico_stati
      ADD CONSTRAINT interventi_storico_intervento_id_interventi_id_fk
      FOREIGN KEY (intervento_id) REFERENCES public.interventi(id)
      ON DELETE CASCADE;
  END IF;
END
$update$;

CREATE INDEX IF NOT EXISTS interventi_storico_intervento_data_idx
  ON public.interventi_storico_stati (intervento_id, data_transizione, id);

DO $update$
DECLARE
  workflow_columns integer;
BEGIN
  SELECT count(*) INTO workflow_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'interventi'
    AND column_name IN (
      'stato', 'ambito', 'priorita', 'data_ora_pianificata',
      'data_ora_avvio', 'data_ora_conclusione', 'intervento_precedente_id',
      'sede', 'motivo_annullamento', 'data_aggiornamento'
    );

  IF workflow_columns <> 10 THEN
    RAISE EXCEPTION 'Schema workflow inatteso per public.interventi';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.interventi
    WHERE stato IS NULL OR priorita IS NULL
  ) THEN
    RAISE EXCEPTION 'Migrazione workflow incompleta: stato o priorita NULL';
  END IF;
END
$update$;
