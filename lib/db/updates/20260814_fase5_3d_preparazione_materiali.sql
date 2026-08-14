CREATE INDEX IF NOT EXISTS interventi_materiali_preparazione_idx
  ON public.interventi_materiali (
    stato_preparazione,
    prodotto_id,
    magazzino_id,
    intervento_id
  );

CREATE INDEX IF NOT EXISTS interventi_ambito_stato_pianificata_idx
  ON public.interventi (ambito, stato, data_ora_pianificata);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'interventi_materiali'
      AND indexname = 'interventi_materiali_preparazione_idx'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'interventi'
      AND indexname = 'interventi_ambito_stato_pianificata_idx'
  ) THEN
    RAISE EXCEPTION 'Indici di preparazione materiali non disponibili';
  END IF;
END $$;
