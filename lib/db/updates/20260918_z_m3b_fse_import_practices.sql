-- M3B: acquisizione FSE+/AGEA persistente collegata alle pratiche M3A.
-- Nessun dato campione e nessuna contabilizzazione vengono creati dalla migrazione.

CREATE TABLE IF NOT EXISTS fse_source_registries (
  id serial PRIMARY KEY,
  codice varchar(80) NOT NULL,
  descrizione text NOT NULL,
  area_operativa_id integer NOT NULL REFERENCES aree_operative(id) ON DELETE RESTRICT,
  attiva integer NOT NULL DEFAULT 1,
  creato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_source_registries_attiva_check CHECK (attiva IN (0, 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_source_registries_codice_unique
  ON fse_source_registries (codice);
CREATE INDEX IF NOT EXISTS fse_source_registries_area_idx
  ON fse_source_registries (area_operativa_id);

ALTER TABLE mappature_prodotti_esterni
  ADD COLUMN IF NOT EXISTS source_registry_id integer;
ALTER TABLE mappature_prodotti_esterni
  DROP CONSTRAINT IF EXISTS mappature_prodotti_esterni_fonte_descrizione_unique;
DROP INDEX IF EXISTS mappature_prodotti_esterni_fonte_descrizione_unique;
ALTER TABLE mappature_prodotti_esterni
  DROP CONSTRAINT IF EXISTS mappature_prodotti_esterni_source_registry_id_fkey;
ALTER TABLE mappature_prodotti_esterni
  ADD CONSTRAINT mappature_prodotti_esterni_source_registry_id_fkey
  FOREIGN KEY (source_registry_id) REFERENCES fse_source_registries(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS mappature_prodotti_esterni_legacy_descrizione_unique
  ON mappature_prodotti_esterni (fonte, chiave_descrizione_normalizzata)
  WHERE source_registry_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mappature_prodotti_esterni_sorgente_descrizione_unique
  ON mappature_prodotti_esterni (source_registry_id, chiave_descrizione_normalizzata)
  WHERE source_registry_id IS NOT NULL;

ALTER TABLE carico_pratiche
  ADD COLUMN IF NOT EXISTS tipo_pratica varchar(30) NOT NULL DEFAULT 'ORDINARIA';
ALTER TABLE carico_pratiche
  DROP CONSTRAINT IF EXISTS carico_pratiche_tipo_check;
ALTER TABLE carico_pratiche
  ADD CONSTRAINT carico_pratiche_tipo_check
  CHECK (tipo_pratica IN ('ORDINARIA', 'SALDO_INIZIALE'));

ALTER TABLE carico_pratica_righe
  ADD COLUMN IF NOT EXISTS numero_documento_esterno varchar(100),
  ADD COLUMN IF NOT EXISTS data_documento_esterna date,
  ADD COLUMN IF NOT EXISTS data_operativa_fonte varchar(40);

CREATE TABLE IF NOT EXISTS fse_import_sessions (
  id serial PRIMARY KEY,
  source_registry_id integer NOT NULL REFERENCES fse_source_registries(id) ON DELETE RESTRICT,
  area_operativa_id integer NOT NULL REFERENCES aree_operative(id) ON DELETE RESTRICT,
  magazzino_id integer NOT NULL REFERENCES magazzini(id) ON DELETE RESTRICT,
  lotto_logico_id integer NOT NULL REFERENCES lotti_logici(id) ON DELETE RESTRICT,
  carico_pratica_id integer REFERENCES carico_pratiche(id) ON DELETE RESTRICT,
  modalita varchar(30) NOT NULL,
  stato varchar(30) NOT NULL DEFAULT 'IN_ANALISI',
  versione integer NOT NULL DEFAULT 1,
  data_riferimento_saldo date,
  copertura_confermata integer NOT NULL DEFAULT 0,
  creato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  aggiornato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_import_sessions_modalita_check
    CHECK (modalita IN ('NUOVI_CARICHI', 'SALDO_INIZIALE')),
  CONSTRAINT fse_import_sessions_stato_check
    CHECK (stato IN ('IN_ANALISI', 'DA_COMPLETARE', 'PRONTA', 'IN_PRATICA', 'REGISTRATA', 'ANNULLATA')),
  CONSTRAINT fse_import_sessions_versione_check CHECK (versione > 0),
  CONSTRAINT fse_import_sessions_copertura_check CHECK (copertura_confermata IN (0, 1))
);
CREATE INDEX IF NOT EXISTS fse_import_sessions_scope_idx
  ON fse_import_sessions (source_registry_id, magazzino_id, data_creazione);

CREATE TABLE IF NOT EXISTS fse_import_attach_commands (
  id serial PRIMARY KEY,
  sessione_id integer NOT NULL REFERENCES fse_import_sessions(id) ON DELETE RESTRICT,
  idempotency_key varchar(100) NOT NULL,
  request_hash varchar(64) NOT NULL,
  result_json jsonb NOT NULL,
  creato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_import_attach_commands_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_import_attach_commands_key_unique
  ON fse_import_attach_commands (idempotency_key);
CREATE INDEX IF NOT EXISTS fse_import_attach_commands_session_idx
  ON fse_import_attach_commands (sessione_id);

CREATE TABLE IF NOT EXISTS fse_import_files (
  id serial PRIMARY KEY,
  sessione_id integer NOT NULL REFERENCES fse_import_sessions(id) ON DELETE CASCADE,
  profilo varchar(20) NOT NULL,
  nome_file varchar(255) NOT NULL,
  formato varchar(10) NOT NULL,
  mime_type_dichiarato varchar(150),
  dimensione_bytes integer NOT NULL,
  sha256_file varchar(64) NOT NULL,
  tracciato_codice varchar(80) NOT NULL,
  parser_version varchar(40) NOT NULL,
  sheet_name varchar(100) NOT NULL,
  data_riferimento date,
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  acquisito_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_acquisizione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_import_files_sha_check CHECK (sha256_file ~ '^[0-9a-f]{64}$'),
  CONSTRAINT fse_import_files_profilo_check CHECK (profilo IN ('REGISTRO', 'GIACENZE')),
  CONSTRAINT fse_import_files_formato_check CHECK (formato IN ('XLSX', 'XLS', 'CSV'))
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_import_files_session_profile_sha_unique
  ON fse_import_files (sessione_id, profilo, sha256_file);
CREATE INDEX IF NOT EXISTS fse_import_files_sha_idx ON fse_import_files (sha256_file);

CREATE TABLE IF NOT EXISTS fse_import_rows (
  id serial PRIMARY KEY,
  sessione_id integer NOT NULL REFERENCES fse_import_sessions(id) ON DELETE CASCADE,
  file_id integer NOT NULL REFERENCES fse_import_files(id) ON DELETE CASCADE,
  numero_riga integer NOT NULL,
  raw_json jsonb NOT NULL,
  semantic_identity_hash varchar(64) NOT NULL,
  disambiguatore varchar(80) NOT NULL DEFAULT '',
  movement_content_hash varchar(64) NOT NULL,
  summary_hash varchar(64) NOT NULL,
  tipo_movimento varchar(60) NOT NULL,
  fondo_origine varchar(50),
  prodotto_esterno text NOT NULL,
  prodotto_normalizzato text NOT NULL,
  lotto_fisico varchar(80),
  numero_documento varchar(100),
  data_documento date,
  data_operativa_proposta date,
  data_operativa_fonte varchar(40),
  quantita_pezzi numeric(18,6),
  quantita_kg_lt numeric(18,6),
  saldo_finale_pezzi numeric(18,6),
  saldo_finale_kg_lt numeric(18,6),
  prodotto_id integer REFERENCES prodotti(id) ON DELETE RESTRICT,
  quantita_operativa numeric(18,6),
  data_scadenza date,
  fattore_kg_lt_pezzo numeric(18,9),
  stato varchar(40) NOT NULL,
  error_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  warning_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  aggiornato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_import_rows_hashes_check CHECK (
    semantic_identity_hash ~ '^[0-9a-f]{64}$'
    AND movement_content_hash ~ '^[0-9a-f]{64}$'
    AND summary_hash ~ '^[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_import_rows_file_row_unique
  ON fse_import_rows (file_id, numero_riga);
CREATE INDEX IF NOT EXISTS fse_import_rows_identity_idx
  ON fse_import_rows (semantic_identity_hash);
CREATE INDEX IF NOT EXISTS fse_import_rows_session_state_idx
  ON fse_import_rows (sessione_id, stato);

CREATE TABLE IF NOT EXISTS fse_import_stock_rows (
  id serial PRIMARY KEY,
  sessione_id integer NOT NULL REFERENCES fse_import_sessions(id) ON DELETE CASCADE,
  file_id integer NOT NULL REFERENCES fse_import_files(id) ON DELETE CASCADE,
  numero_riga integer NOT NULL,
  raw_json jsonb NOT NULL,
  balance_key varchar(64) NOT NULL,
  fondo_origine varchar(50),
  prodotto_esterno text NOT NULL,
  prodotto_normalizzato text NOT NULL,
  lotto_fisico varchar(80),
  peso_unita numeric(18,9),
  unita_misura_peso varchar(10),
  giacenza_peso_volume numeric(18,6),
  giacenza_pezzi numeric(18,6),
  pezzi_per_collo numeric(18,6),
  giacenza_colli numeric(18,6),
  data_scadenza date,
  prodotto_id integer REFERENCES prodotti(id) ON DELETE RESTRICT,
  quantita_operativa numeric(18,6),
  stato varchar(40) NOT NULL DEFAULT 'DA_ASSOCIARE',
  error_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  warning_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_import_stock_rows_file_row_unique
  ON fse_import_stock_rows (file_id, numero_riga);
CREATE INDEX IF NOT EXISTS fse_import_stock_rows_balance_idx
  ON fse_import_stock_rows (balance_key);
CREATE INDEX IF NOT EXISTS fse_import_stock_rows_session_state_idx
  ON fse_import_stock_rows (sessione_id, stato);

CREATE TABLE IF NOT EXISTS fse_import_row_revisions (
  id serial PRIMARY KEY,
  riga_id integer NOT NULL REFERENCES fse_import_rows(id) ON DELETE RESTRICT,
  versione integer NOT NULL,
  accepted_values_json jsonb NOT NULL,
  revision_hash varchar(64) NOT NULL,
  motivo text NOT NULL,
  creato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_import_row_revisions_hash_check CHECK (revision_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_import_row_revisions_version_unique
  ON fse_import_row_revisions (riga_id, versione);

CREATE TABLE IF NOT EXISTS fse_movement_claims (
  id serial PRIMARY KEY,
  source_registry_id integer NOT NULL REFERENCES fse_source_registries(id) ON DELETE RESTRICT,
  semantic_identity_hash varchar(64) NOT NULL,
  disambiguatore varchar(80) NOT NULL DEFAULT '',
  accepted_content_hash varchar(64) NOT NULL,
  accepted_revision_id integer NOT NULL REFERENCES fse_import_row_revisions(id) ON DELETE RESTRICT,
  carico_pratica_riga_id integer REFERENCES carico_pratica_righe(id) ON DELETE RESTRICT,
  carico_magazzino_riga_id integer REFERENCES carichi_magazzino_righe(id) ON DELETE RESTRICT,
  magazzino_id_snapshot integer NOT NULL REFERENCES magazzini(id) ON DELETE RESTRICT,
  stato varchar(30) NOT NULL,
  data_presa_in_carico timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_movement_claims_stato_check
    CHECK (stato IN ('RISERVATA', 'REGISTRATA', 'COPERTA_SALDO', 'RILASCIATA', 'CONFLITTO'))
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_movement_claims_identity_active_unique
  ON fse_movement_claims (source_registry_id, semantic_identity_hash, disambiguatore)
  WHERE stato <> 'RILASCIATA';
CREATE UNIQUE INDEX IF NOT EXISTS fse_movement_claims_practice_row_unique
  ON fse_movement_claims (carico_pratica_riga_id)
  WHERE carico_pratica_riga_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fse_initial_balance_coverage (
  id serial PRIMARY KEY,
  source_registry_id integer NOT NULL REFERENCES fse_source_registries(id) ON DELETE RESTRICT,
  sessione_id integer NOT NULL REFERENCES fse_import_sessions(id) ON DELETE RESTRICT,
  carico_pratica_id integer NOT NULL REFERENCES carico_pratiche(id) ON DELETE RESTRICT,
  magazzino_id integer NOT NULL REFERENCES magazzini(id) ON DELETE RESTRICT,
  data_taglio date NOT NULL,
  stato varchar(20) NOT NULL DEFAULT 'PROPOSTA',
  attivata_da integer REFERENCES utenti(id) ON DELETE RESTRICT,
  data_attivazione timestamptz,
  CONSTRAINT fse_initial_balance_coverage_stato_check
    CHECK (stato IN ('PROPOSTA', 'ATTIVA', 'ANNULLATA'))
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_initial_balance_coverage_source_active_unique
  ON fse_initial_balance_coverage (source_registry_id)
  WHERE stato IN ('PROPOSTA', 'ATTIVA');
CREATE UNIQUE INDEX IF NOT EXISTS fse_initial_balance_coverage_warehouse_active_unique
  ON fse_initial_balance_coverage (magazzino_id)
  WHERE stato IN ('PROPOSTA', 'ATTIVA');
CREATE UNIQUE INDEX IF NOT EXISTS fse_initial_balance_coverage_practice_unique
  ON fse_initial_balance_coverage (carico_pratica_id);

CREATE OR REPLACE FUNCTION guard_fse_initial_balance_movement()
RETURNS trigger AS $$
BEGIN
  IF NEW.natura_contabile IS DISTINCT FROM 'SALDO_INIZIALE'
     AND EXISTS (
       SELECT 1
       FROM fse_initial_balance_coverage coverage
       WHERE coverage.magazzino_id = NEW.magazzino_id
         AND coverage.stato = 'PROPOSTA'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'movimenti_fse_initial_balance_proposal_guard',
      MESSAGE = 'Il Magazzino ha una proposta di saldo iniziale in corso';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS movimenti_fse_initial_balance_proposal_guard ON movimenti;
CREATE TRIGGER movimenti_fse_initial_balance_proposal_guard
BEFORE INSERT ON movimenti
FOR EACH ROW EXECUTE FUNCTION guard_fse_initial_balance_movement();

COMMENT ON TABLE fse_movement_claims IS
  'Presa in carico univoca di un evento esterno, indipendente dal magazzino scelto.';
COMMENT ON TABLE fse_initial_balance_coverage IS
  'Copertura storica attivata atomicamente con la registrazione SALDO_INIZIALE.';
