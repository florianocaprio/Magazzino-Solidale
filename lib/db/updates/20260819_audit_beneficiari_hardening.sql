DO $update$
BEGIN
  IF to_regclass('public.beneficiari') IS NULL THEN
    RAISE EXCEPTION 'Tabella public.beneficiari non trovata: eseguire prima il bootstrap dello schema';
  END IF;
END
$update$;

ALTER TABLE public.beneficiari
  ADD COLUMN IF NOT EXISTS versione integer NOT NULL DEFAULT 1;

DO $update$
DECLARE
  column_data_type text;
  column_is_nullable text;
  stored_default text;
BEGIN
  SELECT columns.data_type, columns.is_nullable, columns.column_default
  INTO column_data_type, column_is_nullable, stored_default
  FROM information_schema.columns AS columns
  WHERE columns.table_schema = 'public'
    AND columns.table_name = 'beneficiari'
    AND columns.column_name = 'versione';

  IF NOT FOUND
    OR column_data_type <> 'integer'
    OR column_is_nullable <> 'NO'
    OR stored_default IS NULL
  THEN
    RAISE EXCEPTION
      'Schema inatteso per public.beneficiari.versione: atteso integer NOT NULL DEFAULT 1';
  END IF;
END
$update$;

-- Diagnostica conservativa: nessun record viene modificato o cancellato.
-- Eseguire prima di valutare una futura FK nucleo_familiare -> beneficiari:
-- SELECT nf.id, nf.beneficiario_id
-- FROM public.nucleo_familiare nf
-- LEFT JOIN public.beneficiari b ON b.id = nf.beneficiario_id
-- WHERE b.id IS NULL;
