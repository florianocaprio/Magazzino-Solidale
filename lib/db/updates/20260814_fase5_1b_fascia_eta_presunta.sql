DO $update$
BEGIN
  IF to_regclass('public.beneficiari') IS NULL THEN
    RAISE EXCEPTION 'Tabella public.beneficiari non trovata: eseguire prima il bootstrap dello schema';
  END IF;
END
$update$;

ALTER TABLE public.beneficiari
  ADD COLUMN IF NOT EXISTS fascia_eta_presunta varchar(20) NULL;

DO $update$
DECLARE
  column_data_type text;
  column_maximum_length integer;
  column_is_nullable text;
BEGIN
  SELECT data_type, character_maximum_length, is_nullable
  INTO column_data_type, column_maximum_length, column_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'beneficiari'
    AND column_name = 'fascia_eta_presunta';

  IF NOT FOUND
    OR column_data_type <> 'character varying'
    OR column_maximum_length <> 20
    OR column_is_nullable <> 'YES'
  THEN
    RAISE EXCEPTION
      'Schema inatteso per public.beneficiari.fascia_eta_presunta: atteso varchar(20) NULL';
  END IF;
END
$update$;
