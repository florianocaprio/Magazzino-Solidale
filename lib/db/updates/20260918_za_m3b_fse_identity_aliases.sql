-- M3B hardening: preserve immutable external identities and map verified
-- corrections to one canonical movement claim. Existing rows are left intact;
-- aliases for claims created by migration 38 are hydrated transactionally by
-- the application when their source is next processed.

CREATE TABLE IF NOT EXISTS fse_movement_identity_aliases (
  id serial PRIMARY KEY,
  source_registry_id integer NOT NULL REFERENCES fse_source_registries(id) ON DELETE RESTRICT,
  semantic_identity_hash varchar(64) NOT NULL,
  disambiguatore varchar(80) NOT NULL DEFAULT '',
  canonical_identity_hash varchar(64) NOT NULL,
  created_from_revision_id integer NOT NULL REFERENCES fse_import_row_revisions(id) ON DELETE RESTRICT,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fse_movement_identity_aliases_hashes_check CHECK (
    semantic_identity_hash ~ '^[0-9a-f]{64}$'
    AND canonical_identity_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS fse_movement_identity_aliases_source_identity_unique
  ON fse_movement_identity_aliases (
    source_registry_id,
    semantic_identity_hash,
    disambiguatore
  );

CREATE INDEX IF NOT EXISTS fse_movement_identity_aliases_canonical_idx
  ON fse_movement_identity_aliases (
    source_registry_id,
    canonical_identity_hash,
    disambiguatore
  );

COMMENT ON TABLE fse_movement_identity_aliases IS
  'Alias verificati e immutabili delle identità esterne, ricondotti alla claim canonica indipendentemente da correzioni di documento, data o lotto.';
