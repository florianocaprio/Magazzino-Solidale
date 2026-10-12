-- M6.4 D64-01: frozen administrative sources and run history. No stock writes.
CREATE TABLE IF NOT EXISTS fse_administrative_versions (
  id serial PRIMARY KEY,
  source_registry_id integer NOT NULL REFERENCES fse_source_registries(id),
  session_id integer NOT NULL REFERENCES fse_import_sessions(id),
  magazzino_id integer NOT NULL REFERENCES magazzini(id),
  session_version integer NOT NULL,
  reference_date date NOT NULL,
  mode varchar(30) NOT NULL,
  manifest_hash varchar(64) NOT NULL,
  manifest_json jsonb NOT NULL,
  creato_da integer NOT NULL REFERENCES utenti(id),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_administrative_versions_hash_check CHECK(manifest_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT fse_administrative_versions_mode_check CHECK(mode IN ('NUOVI_CARICHI','SALDO_INIZIALE') AND session_version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_administrative_versions_manifest_unique ON fse_administrative_versions(session_id,manifest_hash);
CREATE TABLE IF NOT EXISTS fse_administrative_files (
  id serial PRIMARY KEY,
  version_id integer NOT NULL REFERENCES fse_administrative_versions(id),
  file_id integer NOT NULL REFERENCES fse_import_files(id),
  role varchar(20) NOT NULL,
  file_hash varchar(64) NOT NULL,
  CONSTRAINT fse_administrative_files_check CHECK(role IN ('REGISTRO','GIACENZE') AND file_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_administrative_files_version_file_unique ON fse_administrative_files(version_id,file_id);
CREATE TABLE IF NOT EXISTS fse_administrative_observations (
  id serial PRIMARY KEY,
  version_id integer NOT NULL REFERENCES fse_administrative_versions(id),
  source_file_id integer NOT NULL REFERENCES fse_administrative_files(id),
  row_id integer REFERENCES fse_import_rows(id),
  stock_row_id integer REFERENCES fse_import_stock_rows(id),
  revision_id integer REFERENCES fse_import_row_revisions(id),
  raw_hash varchar(64) NOT NULL,
  identity_hash varchar(64) NOT NULL,
  occurrence integer NOT NULL,
  content_hash varchar(64) NOT NULL,
  original_json jsonb NOT NULL,
  interpreted_json jsonb NOT NULL,
  quality_json jsonb NOT NULL,
  CONSTRAINT fse_administrative_observations_reference_check CHECK(num_nonnulls(row_id,stock_row_id) = 1 AND (revision_id IS NULL OR row_id IS NOT NULL) AND occurrence > 0),
  CONSTRAINT fse_administrative_observations_hash_check CHECK(raw_hash ~ '^[0-9a-f]{64}$' AND identity_hash ~ '^[0-9a-f]{64}$' AND content_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_administrative_observations_row_unique ON fse_administrative_observations(version_id,row_id);
CREATE UNIQUE INDEX IF NOT EXISTS fse_administrative_observations_stock_unique ON fse_administrative_observations(version_id,stock_row_id);
CREATE TABLE IF NOT EXISTS fse_administrative_lineage (
  id serial PRIMARY KEY,
  observation_id integer NOT NULL REFERENCES fse_administrative_observations(id),
  claim_id integer NOT NULL REFERENCES fse_movement_claims(id),
  load_row_id integer REFERENCES carichi_magazzino_righe(id),
  claim_state varchar(30) NOT NULL,
  pieces numeric(18,6),
  kg_lt numeric(18,6)
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_administrative_lineage_unique ON fse_administrative_lineage(observation_id,claim_id);

ALTER TABLE riconciliazioni_fse
  ALTER COLUMN importazione_agea_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source_type varchar(20) NOT NULL DEFAULT 'AGEA_LEGACY',
  ADD COLUMN IF NOT EXISTS administrative_version_id integer REFERENCES fse_administrative_versions(id),
  ADD COLUMN IF NOT EXISTS baseline_run_id integer,
  ADD COLUMN IF NOT EXISTS command_key varchar(100),
  ADD COLUMN IF NOT EXISTS command_hash varchar(64);
ALTER TABLE riconciliazioni_fse DROP CONSTRAINT IF EXISTS riconciliazioni_fse_source_check;
ALTER TABLE riconciliazioni_fse ADD CONSTRAINT riconciliazioni_fse_source_check CHECK (
  (source_type='AGEA_LEGACY' AND importazione_agea_id IS NOT NULL AND administrative_version_id IS NULL)
  OR (source_type='FSE_M3B' AND importazione_agea_id IS NULL AND importazione_agea_precedente_id IS NULL AND administrative_version_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS riconciliazioni_fse_command_unique ON riconciliazioni_fse(command_key);
CREATE TABLE IF NOT EXISTS fse_reconciliation_runs (
  id serial PRIMARY KEY,
  reconciliation_id integer NOT NULL REFERENCES riconciliazioni_fse(id),
  header_version integer NOT NULL,
  administrative_version_id integer REFERENCES fse_administrative_versions(id),
  legacy_import_id integer REFERENCES importazioni_agea(id),
  baseline_run_id integer REFERENCES fse_reconciliation_runs(id),
  max_movement_id integer NOT NULL,
  max_operation_id integer NOT NULL,
  reference_date date NOT NULL,
  canonical_hash varchar(64) NOT NULL,
  snapshot_json jsonb NOT NULL,
  creato_da integer NOT NULL REFERENCES utenti(id),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_reconciliation_runs_source_check CHECK(num_nonnulls(administrative_version_id,legacy_import_id)=1),
  CONSTRAINT fse_reconciliation_runs_hash_check CHECK(canonical_hash ~ '^[0-9a-f]{64}$' AND header_version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS fse_reconciliation_runs_version_unique ON fse_reconciliation_runs(reconciliation_id,header_version);
ALTER TABLE riconciliazioni_fse DROP CONSTRAINT IF EXISTS riconciliazioni_fse_baseline_run_id_fse_reconciliation_runs_id_fk;
ALTER TABLE riconciliazioni_fse ADD CONSTRAINT riconciliazioni_fse_baseline_run_id_fse_reconciliation_runs_id_fk FOREIGN KEY(baseline_run_id) REFERENCES fse_reconciliation_runs(id);
ALTER TABLE riconciliazioni_fse_righe
  ADD COLUMN IF NOT EXISTS observation_id integer REFERENCES fse_administrative_observations(id),
  ADD COLUMN IF NOT EXISTS aggregate_version_id integer REFERENCES fse_administrative_versions(id);
CREATE UNIQUE INDEX IF NOT EXISTS riconciliazioni_fse_righe_active_observation_unique ON riconciliazioni_fse_righe(riconciliazione_id,observation_id) WHERE active=true AND observation_id IS NOT NULL;
ALTER TABLE riconciliazioni_fse_righe DROP CONSTRAINT IF EXISTS riconciliazioni_fse_righe_external_exclusivity;
ALTER TABLE riconciliazioni_fse_righe ADD CONSTRAINT riconciliazioni_fse_righe_external_exclusivity CHECK (
  num_nonnulls(importazione_agea_riga_id,observation_id)<=1 AND (tipo_riga <> 'SALDO_PARTITA' OR num_nonnulls(importazione_agea_riga_id,observation_id)=0)
);
ALTER TABLE riconciliazioni_fse_risoluzioni ADD COLUMN IF NOT EXISTS target_observation_id integer REFERENCES fse_administrative_observations(id);

CREATE OR REPLACE FUNCTION m64_validate_source_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v fse_administrative_versions; f fse_administrative_files; o fse_administrative_observations; c fse_movement_claims;
BEGIN
  IF TG_TABLE_NAME='fse_administrative_versions' THEN
    IF NOT EXISTS(SELECT 1 FROM fse_import_sessions s JOIN fse_source_registries sr ON sr.id=s.source_registry_id JOIN magazzini m ON m.id=s.magazzino_id
      WHERE s.id=NEW.session_id AND s.source_registry_id=NEW.source_registry_id AND s.magazzino_id=NEW.magazzino_id AND s.area_operativa_id=sr.area_operativa_id AND m.area_operativa_id=s.area_operativa_id AND s.versione=NEW.session_version AND s.modalita=NEW.mode) THEN
      RAISE EXCEPTION 'M64_SOURCE_OWNERSHIP' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='fse_administrative_files' THEN
    SELECT * INTO STRICT v FROM fse_administrative_versions WHERE id=NEW.version_id;
    IF NOT EXISTS(SELECT 1 FROM fse_import_files WHERE id=NEW.file_id AND sessione_id=v.session_id AND sha256_file=NEW.file_hash AND profilo=NEW.role) THEN
      RAISE EXCEPTION 'M64_FILE_OWNERSHIP' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='fse_administrative_observations' THEN
    SELECT * INTO STRICT f FROM fse_administrative_files WHERE id=NEW.source_file_id;
    SELECT * INTO STRICT v FROM fse_administrative_versions WHERE id=NEW.version_id;
    IF f.version_id<>NEW.version_id OR
      (NEW.row_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fse_import_rows WHERE id=NEW.row_id AND file_id=f.file_id AND sessione_id=v.session_id)) OR
      (NEW.stock_row_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fse_import_stock_rows WHERE id=NEW.stock_row_id AND file_id=f.file_id AND sessione_id=v.session_id)) OR
      (NEW.revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fse_import_row_revisions WHERE id=NEW.revision_id AND riga_id=NEW.row_id)) THEN
      RAISE EXCEPTION 'M64_OBSERVATION_OWNERSHIP' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='fse_administrative_lineage' THEN
    SELECT * INTO STRICT o FROM fse_administrative_observations WHERE id=NEW.observation_id;
    SELECT * INTO STRICT v FROM fse_administrative_versions WHERE id=o.version_id;
    SELECT * INTO STRICT c FROM fse_movement_claims WHERE id=NEW.claim_id;
    IF c.source_registry_id<>v.source_registry_id OR c.magazzino_id_snapshot<>v.magazzino_id OR
      c.semantic_identity_hash<>o.identity_hash OR c.disambiguatore IS DISTINCT FROM o.interpreted_json->>'disambiguator' OR NEW.load_row_id IS DISTINCT FROM c.carico_magazzino_riga_id OR NEW.claim_state<>c.stato OR
      (NEW.load_row_id IS NULL AND (NEW.pieces IS NOT NULL OR NEW.kg_lt IS NOT NULL)) OR
      (NEW.load_row_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM carichi_magazzino_righe cr WHERE cr.id=NEW.load_row_id AND cr.quantita_pezzi IS NOT DISTINCT FROM NEW.pieces AND cr.quantita_kg_lt IS NOT DISTINCT FROM NEW.kg_lt)) THEN
      RAISE EXCEPTION 'M64_LINEAGE_OWNERSHIP' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fse_administrative_versions','fse_administrative_files','fse_administrative_observations','fse_administrative_lineage','fse_reconciliation_runs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS m64_immutable_snapshot ON %I',t);
    EXECUTE format('CREATE TRIGGER m64_immutable_snapshot BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION m64_reject_snapshot_mutation()',t);
    IF t<>'fse_reconciliation_runs' THEN
      EXECUTE format('DROP TRIGGER IF EXISTS m64_source_ownership ON %I',t);
      EXECUTE format('CREATE TRIGGER m64_source_ownership BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION m64_validate_source_ownership()',t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION m64_validate_reconciliation_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h riconciliazioni_fse; v fse_administrative_versions; b fse_reconciliation_runs; baseline_version integer;
BEGIN
  IF TG_TABLE_NAME='riconciliazioni_fse' THEN
    h:=NEW;
    IF h.source_type='FSE_M3B' THEN
      SELECT * INTO STRICT v FROM fse_administrative_versions WHERE id=h.administrative_version_id;
      IF v.magazzino_id<>h.magazzino_id OR v.reference_date<>h.data_riferimento THEN RAISE EXCEPTION 'M64_RECONCILIATION_SOURCE' USING ERRCODE='23514'; END IF;
      IF h.baseline_run_id IS NOT NULL THEN
        SELECT * INTO STRICT b FROM fse_reconciliation_runs WHERE id=h.baseline_run_id;
        IF NOT EXISTS(SELECT 1 FROM fse_administrative_versions bv WHERE bv.id=b.administrative_version_id AND bv.source_registry_id=v.source_registry_id AND bv.magazzino_id=v.magazzino_id AND bv.mode=v.mode AND bv.reference_date<v.reference_date) THEN
          RAISE EXCEPTION 'M64_BASELINE_INCOMPATIBLE' USING ERRCODE='23514'; END IF;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='fse_reconciliation_runs' THEN
    SELECT * INTO STRICT h FROM riconciliazioni_fse WHERE id=NEW.reconciliation_id;
    IF NEW.header_version<>h.versione OR NEW.administrative_version_id IS DISTINCT FROM h.administrative_version_id OR NEW.legacy_import_id IS DISTINCT FROM h.importazione_agea_id OR NEW.baseline_run_id IS DISTINCT FROM h.baseline_run_id OR NEW.reference_date<>h.data_riferimento OR NEW.max_movement_id<>h.max_movimento_id OR NEW.max_operation_id<>h.max_operazione_distribuzione_id OR NEW.canonical_hash<>h.canonical_hash THEN
      RAISE EXCEPTION 'M64_RUN_OWNERSHIP' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO STRICT h FROM riconciliazioni_fse WHERE id=NEW.riconciliazione_id;
    IF h.baseline_run_id IS NOT NULL THEN SELECT administrative_version_id INTO baseline_version FROM fse_reconciliation_runs WHERE id=h.baseline_run_id; END IF;
    IF h.source_type='FSE_M3B' THEN
      IF NEW.importazione_agea_riga_id IS NOT NULL OR
        (NEW.tipo_riga='SALDO_PARTITA' AND NEW.aggregate_version_id IS DISTINCT FROM h.administrative_version_id) OR
        (NEW.tipo_riga<>'SALDO_PARTITA' AND NEW.aggregate_version_id IS NOT NULL) OR
        (NEW.tipo_riga<>'SALDO_PARTITA' AND NEW.observation_id IS NULL AND (NEW.movimento_id IS NULL OR NEW.fund_external IS NOT NULL OR NEW.pieces_external IS NOT NULL OR NEW.kg_lt_external IS NOT NULL)) OR
        (NEW.observation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fse_administrative_observations o WHERE o.id=NEW.observation_id AND (o.version_id=h.administrative_version_id OR o.version_id=baseline_version))) THEN
        RAISE EXCEPTION 'M64_RECONCILIATION_ROW_OWNERSHIP' USING ERRCODE='23514'; END IF;
    ELSIF NEW.observation_id IS NOT NULL OR NEW.aggregate_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'M64_LEGACY_REFERENCE_REQUIRED' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS m64_reconciliation_ownership ON riconciliazioni_fse;
CREATE TRIGGER m64_reconciliation_ownership BEFORE INSERT OR UPDATE ON riconciliazioni_fse FOR EACH ROW EXECUTE FUNCTION m64_validate_reconciliation_ownership();
DROP TRIGGER IF EXISTS m64_reconciliation_row_ownership ON riconciliazioni_fse_righe;
CREATE TRIGGER m64_reconciliation_row_ownership BEFORE INSERT OR UPDATE ON riconciliazioni_fse_righe FOR EACH ROW EXECUTE FUNCTION m64_validate_reconciliation_ownership();
DROP TRIGGER IF EXISTS m64_run_ownership ON fse_reconciliation_runs;
CREATE TRIGGER m64_run_ownership BEFORE INSERT ON fse_reconciliation_runs FOR EACH ROW EXECUTE FUNCTION m64_validate_reconciliation_ownership();
