-- M6.4 review: one proven claim per administrative version; monotonic cutoff.
-- Never repair/delete historical evidence. Existing duplicate attribution aborts
-- the migration transaction, requiring an explicit administrative decision.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM fse_administrative_lineage l
    JOIN fse_administrative_observations o ON o.id=l.observation_id
    GROUP BY o.version_id,l.claim_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'M64_DUPLICATE_HISTORICAL_LINEAGE' USING ERRCODE='23514';
  END IF;
END $$;

ALTER TABLE fse_administrative_lineage ADD COLUMN IF NOT EXISTS version_id integer;
-- Enrich only the relational ownership key, never snapshot values or hashes.
-- The runner wraps this migration in a transaction; the table lock prevents
-- other writers while this single append-only guard is temporarily disabled.
ALTER TABLE fse_administrative_lineage DISABLE TRIGGER m64_immutable_snapshot;
UPDATE fse_administrative_lineage l SET version_id=o.version_id
FROM fse_administrative_observations o WHERE o.id=l.observation_id AND l.version_id IS NULL;
ALTER TABLE fse_administrative_lineage ENABLE TRIGGER m64_immutable_snapshot;
ALTER TABLE fse_administrative_lineage ALTER COLUMN version_id SET NOT NULL;
ALTER TABLE fse_administrative_lineage DROP CONSTRAINT IF EXISTS fse_administrative_lineage_version_id_fse_administrative_versions_id_fk;
ALTER TABLE fse_administrative_lineage ADD CONSTRAINT fse_administrative_lineage_version_id_fse_administrative_versions_id_fk
  FOREIGN KEY(version_id) REFERENCES fse_administrative_versions(id);
CREATE UNIQUE INDEX IF NOT EXISTS fse_administrative_lineage_version_claim_unique
  ON fse_administrative_lineage(version_id,claim_id);

CREATE OR REPLACE FUNCTION m64_validate_lineage_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_version integer;
BEGIN
  SELECT version_id INTO STRICT actual_version FROM fse_administrative_observations WHERE id=NEW.observation_id;
  IF NEW.version_id IS NOT NULL AND NEW.version_id<>actual_version THEN
    RAISE EXCEPTION 'M64_LINEAGE_VERSION' USING ERRCODE='23514';
  END IF;
  NEW.version_id:=actual_version;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS m64_lineage_version ON fse_administrative_lineage;
CREATE TRIGGER m64_lineage_version BEFORE INSERT ON fse_administrative_lineage
  FOR EACH ROW EXECUTE FUNCTION m64_validate_lineage_version();

CREATE OR REPLACE FUNCTION m64_validate_cutoff_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE baseline fse_reconciliation_runs;
BEGIN
  IF NEW.source_type='FSE_M3B' AND NEW.baseline_run_id IS NOT NULL THEN
    SELECT * INTO STRICT baseline FROM fse_reconciliation_runs WHERE id=NEW.baseline_run_id;
    IF NEW.max_movimento_id<baseline.max_movement_id OR NEW.max_operazione_distribuzione_id<baseline.max_operation_id THEN
      RAISE EXCEPTION 'M64_REGRESSIVE_CUTOFF' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS m64_cutoff_order ON riconciliazioni_fse;
CREATE TRIGGER m64_cutoff_order BEFORE INSERT OR UPDATE ON riconciliazioni_fse
  FOR EACH ROW EXECUTE FUNCTION m64_validate_cutoff_order();
