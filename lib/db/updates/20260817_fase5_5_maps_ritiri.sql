-- Fase 5-5: esito strutturato del ritiro, separato dal lifecycle logistico.
-- Aggiornamento additivo e idempotente: non modifica stato, righe o prenotazioni.
ALTER TABLE bolle
  ADD COLUMN IF NOT EXISTS ritiro_non_effettuato_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ritiro_non_effettuato_operatore_id integer NULL,
  ADD COLUMN IF NOT EXISTS ritiro_non_effettuato_motivo varchar(500) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bolle_ritiro_non_effettuato_operatore_id_utenti_id_fk'
      AND conrelid = 'bolle'::regclass
  ) THEN
    ALTER TABLE bolle
      ADD CONSTRAINT bolle_ritiro_non_effettuato_operatore_id_utenti_id_fk
      FOREIGN KEY (ritiro_non_effettuato_operatore_id)
      REFERENCES utenti(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bolle_ritiro_non_effettuato_at_idx
  ON bolle (ritiro_non_effettuato_at)
  WHERE ritiro_non_effettuato_at IS NOT NULL;
