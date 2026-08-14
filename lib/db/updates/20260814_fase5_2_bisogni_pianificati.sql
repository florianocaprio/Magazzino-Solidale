DO $update$
BEGIN
  IF to_regclass('public.interventi') IS NULL THEN
    RAISE EXCEPTION 'Tabella public.interventi non trovata: eseguire prima il bootstrap dello schema';
  END IF;
END
$update$;

CREATE TABLE IF NOT EXISTS public.bisogni_pianificati (
  id serial PRIMARY KEY,
  intervento_id integer NOT NULL,
  tipo varchar(20) NOT NULL,
  descrizione varchar(500) NOT NULL,
  stato varchar(30) NOT NULL DEFAULT 'da_pianificare',
  data_prevista date NULL,
  priorita varchar(20) NOT NULL DEFAULT 'normale',
  note varchar(2000) NULL,
  data_completamento timestamp without time zone NULL,
  data_creazione timestamp without time zone NOT NULL DEFAULT now(),
  data_aggiornamento timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT bisogni_pianificati_intervento_id_interventi_id_fk
    FOREIGN KEY (intervento_id) REFERENCES public.interventi(id),
  CONSTRAINT bisogni_pianificati_tipo_check
    CHECK (tipo IN ('richiesta', 'azione')),
  CONSTRAINT bisogni_pianificati_stato_check
    CHECK (stato IN ('da_pianificare', 'pianificato', 'completato', 'annullato')),
  CONSTRAINT bisogni_pianificati_priorita_check
    CHECK (priorita IN ('bassa', 'normale', 'alta', 'urgente')),
  CONSTRAINT bisogni_pianificati_pianificato_data_check
    CHECK (stato <> 'pianificato' OR data_prevista IS NOT NULL)
);

DO $update$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.bisogni_pianificati'::regclass
      AND confrelid = 'public.interventi'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.bisogni_pianificati'::regclass
           AND attname = 'intervento_id')
      ]::smallint[]
  ) THEN
    ALTER TABLE public.bisogni_pianificati
      ADD CONSTRAINT bisogni_pianificati_intervento_id_interventi_id_fk
      FOREIGN KEY (intervento_id) REFERENCES public.interventi(id);
  END IF;
END
$update$;

DO $update$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bisogni_pianificati'::regclass
      AND conname = 'bisogni_pianificati_tipo_check'
  ) THEN
    ALTER TABLE public.bisogni_pianificati
      ADD CONSTRAINT bisogni_pianificati_tipo_check
      CHECK (tipo IN ('richiesta', 'azione'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bisogni_pianificati'::regclass
      AND conname = 'bisogni_pianificati_stato_check'
  ) THEN
    ALTER TABLE public.bisogni_pianificati
      ADD CONSTRAINT bisogni_pianificati_stato_check
      CHECK (stato IN ('da_pianificare', 'pianificato', 'completato', 'annullato'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bisogni_pianificati'::regclass
      AND conname = 'bisogni_pianificati_priorita_check'
  ) THEN
    ALTER TABLE public.bisogni_pianificati
      ADD CONSTRAINT bisogni_pianificati_priorita_check
      CHECK (priorita IN ('bassa', 'normale', 'alta', 'urgente'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bisogni_pianificati'::regclass
      AND conname = 'bisogni_pianificati_pianificato_data_check'
  ) THEN
    ALTER TABLE public.bisogni_pianificati
      ADD CONSTRAINT bisogni_pianificati_pianificato_data_check
      CHECK (stato <> 'pianificato' OR data_prevista IS NOT NULL);
  END IF;
END
$update$;

CREATE INDEX IF NOT EXISTS bisogni_pianificati_intervento_idx
  ON public.bisogni_pianificati (intervento_id);
CREATE INDEX IF NOT EXISTS bisogni_pianificati_stato_idx
  ON public.bisogni_pianificati (stato);
CREATE INDEX IF NOT EXISTS bisogni_pianificati_data_prevista_idx
  ON public.bisogni_pianificati (data_prevista);

DO $update$
DECLARE
  expected_columns integer;
BEGIN
  SELECT count(*)
  INTO expected_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'bisogni_pianificati'
    AND (
      (column_name = 'id' AND data_type = 'integer' AND is_nullable = 'NO')
      OR (column_name = 'intervento_id' AND data_type = 'integer' AND is_nullable = 'NO')
      OR (column_name = 'tipo' AND data_type = 'character varying' AND character_maximum_length = 20 AND is_nullable = 'NO')
      OR (column_name = 'descrizione' AND data_type = 'character varying' AND character_maximum_length = 500 AND is_nullable = 'NO')
      OR (column_name = 'stato' AND data_type = 'character varying' AND character_maximum_length = 30 AND is_nullable = 'NO')
      OR (column_name = 'data_prevista' AND data_type = 'date' AND is_nullable = 'YES')
      OR (column_name = 'priorita' AND data_type = 'character varying' AND character_maximum_length = 20 AND is_nullable = 'NO')
      OR (column_name = 'note' AND data_type = 'character varying' AND character_maximum_length = 2000 AND is_nullable = 'YES')
      OR (column_name = 'data_completamento' AND data_type = 'timestamp without time zone' AND is_nullable = 'YES')
      OR (column_name = 'data_creazione' AND data_type = 'timestamp without time zone' AND is_nullable = 'NO')
      OR (column_name = 'data_aggiornamento' AND data_type = 'timestamp without time zone' AND is_nullable = 'NO')
    );

  IF expected_columns <> 11 THEN
    RAISE EXCEPTION 'Schema inatteso per public.bisogni_pianificati';
  END IF;
END
$update$;
