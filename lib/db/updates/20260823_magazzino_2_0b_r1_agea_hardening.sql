-- Magazzino 2.0B-R1: hardening additivo dello staging AGEA/SIFEAD.

ALTER TABLE importazioni_agea_righe
  ADD COLUMN IF NOT EXISTS lotto_effettivo_raw text,
  ADD COLUMN IF NOT EXISTS lotto_effettivo_normalizzato text,
  ADD COLUMN IF NOT EXISTS data_carico_effettiva date,
  ADD COLUMN IF NOT EXISTS mapping_versione_snapshot integer,
  ADD COLUMN IF NOT EXISTS correzione_motivazione text,
  ADD COLUMN IF NOT EXISTS corretto_da integer REFERENCES utenti(id),
  ADD COLUMN IF NOT EXISTS data_correzione timestamptz;

UPDATE importazioni_agea_righe
SET lotto_effettivo_raw = lotto_raw
WHERE lotto_effettivo_raw IS NULL AND lotto_raw IS NOT NULL;

UPDATE importazioni_agea_righe
SET lotto_effettivo_normalizzato = lotto_normalizzato
WHERE lotto_effettivo_normalizzato IS NULL AND lotto_normalizzato IS NOT NULL;

UPDATE importazioni_agea_righe
SET data_carico_effettiva = data_carico_risolta
WHERE data_carico_effettiva IS NULL AND data_carico_risolta IS NOT NULL;

ALTER TABLE importazioni_agea_partite
  ADD COLUMN IF NOT EXISTS descrizioni_esterne_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS correzione_motivazione text,
  ADD COLUMN IF NOT EXISTS corretto_da integer REFERENCES utenti(id),
  ADD COLUMN IF NOT EXISTS data_correzione timestamptz;

CREATE INDEX IF NOT EXISTS importazioni_agea_righe_identity_base_idx
  ON importazioni_agea_righe (identity_base_hash, content_hash);
CREATE INDEX IF NOT EXISTS importazioni_agea_righe_mapping_idx
  ON importazioni_agea_righe (importazione_id, mapping_prodotto_id);
CREATE INDEX IF NOT EXISTS importazioni_agea_partite_identity_idx
  ON importazioni_agea_partite (importazione_id, prodotto_id, fondo_origine, lotto_normalizzato);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'importazioni_agea_righe_mapping_versione_check'
  ) THEN
    ALTER TABLE importazioni_agea_righe
      ADD CONSTRAINT importazioni_agea_righe_mapping_versione_check
      CHECK (mapping_versione_snapshot IS NULL OR mapping_versione_snapshot > 0);
  END IF;
END $$;
