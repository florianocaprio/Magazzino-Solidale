-- Magazzino 2.0C-R2: chiusura replay, coverage e lifecycle riconciliazione.
-- Migration forward-only, additiva, idempotente e senza backfill interpretativo.

ALTER TABLE esportazioni_fse
  ADD COLUMN IF NOT EXISTS scope_request_hash varchar(64);

ALTER TABLE esportazioni_fse DROP CONSTRAINT IF EXISTS esportazioni_fse_scope_request_hash_check;
ALTER TABLE esportazioni_fse ADD CONSTRAINT esportazioni_fse_scope_request_hash_check CHECK (
  scope_request_hash IS NULL OR scope_request_hash ~ '^[0-9a-f]{64}$'
);

CREATE UNIQUE INDEX IF NOT EXISTS esportazioni_fse_active_scope_unique
  ON esportazioni_fse(scope_request_hash)
  WHERE scope_request_hash IS NOT NULL AND stato <> 'ANNULLATA';

ALTER TABLE esportazioni_fse_righe
  ADD COLUMN IF NOT EXISTS opening_balance_pieces numeric(30,6),
  ADD COLUMN IF NOT EXISTS opening_balance_kg_lt numeric(30,6),
  ADD COLUMN IF NOT EXISTS balance_after_pieces numeric(30,6),
  ADD COLUMN IF NOT EXISTS balance_after_kg_lt numeric(30,6);

DROP INDEX IF EXISTS esportazioni_fse_eventi_active_coverage_unique;
CREATE UNIQUE INDEX IF NOT EXISTS esportazioni_fse_eventi_active_content_unique
  ON esportazioni_fse_eventi(event_key, content_hash)
  WHERE active_coverage = true;

DROP INDEX IF EXISTS esportazioni_fse_righe_active_coverage_unique;
CREATE UNIQUE INDEX IF NOT EXISTS esportazioni_fse_righe_active_content_unique
  ON esportazioni_fse_righe(line_key, content_hash)
  WHERE active_coverage = true;

ALTER TABLE riconciliazioni_fse_righe
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS superseded_by_row_id integer,
  ADD COLUMN IF NOT EXISTS resolution_group_id varchar(64),
  ADD COLUMN IF NOT EXISTS companion_row_id integer;

CREATE UNIQUE INDEX IF NOT EXISTS riconciliazioni_fse_righe_active_movement_unique
  ON riconciliazioni_fse_righe(riconciliazione_id, movimento_id)
  WHERE active = true AND movimento_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS riconciliazioni_fse_righe_active_agea_unique
  ON riconciliazioni_fse_righe(riconciliazione_id, importazione_agea_riga_id)
  WHERE active = true AND importazione_agea_riga_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS riconciliazioni_fse_righe_resolution_group_idx
  ON riconciliazioni_fse_righe(riconciliazione_id, resolution_group_id, active);
