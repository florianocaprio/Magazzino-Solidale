-- M6.4: additive administrative representations; no inventory/history rewrite.
CREATE TABLE IF NOT EXISTS esportazioni_fse_rappresentazioni (
  id serial PRIMARY KEY,
  esportazione_id integer NOT NULL REFERENCES esportazioni_fse(id),
  original_snapshot_hash varchar(64) NOT NULL,
  format_code varchar(60) NOT NULL,
  transformation_version varchar(40) NOT NULL,
  semantic_hash varchar(64) NOT NULL,
  artifact_hash varchar(64) NOT NULL,
  artifact_base64 text NOT NULL,
  creato_da integer NOT NULL REFERENCES utenti(id),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esportazioni_fse_rappresentazioni_hash_check CHECK (
    original_snapshot_hash ~ '^[0-9a-f]{64}$' AND semantic_hash ~ '^[0-9a-f]{64}$' AND artifact_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT esportazioni_fse_rappresentazioni_format_check CHECK (
    format_code IN ('FSE_CANONICAL_AUDIT_XLSX_V1','SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS esportazioni_fse_rappresentazioni_identity_unique
  ON esportazioni_fse_rappresentazioni(esportazione_id, format_code, transformation_version);

CREATE OR REPLACE FUNCTION m64_reject_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'M64_ADMINISTRATIVE_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS m64_immutable_representation ON esportazioni_fse_rappresentazioni;
CREATE TRIGGER m64_immutable_representation BEFORE UPDATE OR DELETE ON esportazioni_fse_rappresentazioni
  FOR EACH ROW EXECUTE FUNCTION m64_reject_snapshot_mutation();
