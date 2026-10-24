-- Default di confezionamento per nuovi carichi; nessuna conversione dello storico.
ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS fattore_kg_lt_pezzo numeric(18,9);
ALTER TABLE prodotti ADD COLUMN IF NOT EXISTS unita_misura_peso varchar(2);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prodotti_contenuto_pezzo_check') THEN
  ALTER TABLE prodotti ADD CONSTRAINT prodotti_contenuto_pezzo_check CHECK (
   (fattore_kg_lt_pezzo IS NULL AND unita_misura_peso IS NULL) OR
   (fattore_kg_lt_pezzo IS NOT NULL AND fattore_kg_lt_pezzo > 0 AND fattore_kg_lt_pezzo < 1000000000 AND unita_misura_peso IS NOT NULL AND unita_misura_peso IN ('kg','l'))
  );
 END IF;
END $$;
