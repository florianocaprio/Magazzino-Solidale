-- Magazzino 2.0C-R1: hardening contabile e amministrativo FSE+.
-- Migration forward-only, additiva e idempotente; nessun backfill interpretativo.

ALTER TABLE esportazioni_fse
  ADD COLUMN IF NOT EXISTS coverage_purpose varchar(30) NOT NULL DEFAULT 'ADMINISTRATIVE',
  ADD COLUMN IF NOT EXISTS request_hash varchar(64),
  ADD COLUMN IF NOT EXISTS snapshot_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS legacy_review_required boolean NOT NULL DEFAULT false;

ALTER TABLE esportazioni_fse_eventi
  ADD COLUMN IF NOT EXISTS administrative_status varchar(50) NOT NULL DEFAULT 'DA_RENDICONTARE',
  ADD COLUMN IF NOT EXISTS arretrato boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocking boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS correction_of_event_key varchar(160),
  ADD COLUMN IF NOT EXISTS covered_at timestamptz,
  ADD COLUMN IF NOT EXISTS gross_statistics_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS net_statistics_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE esportazioni_fse DROP CONSTRAINT IF EXISTS esportazioni_fse_state_check;

-- Gli snapshot creati dalla 2.0C precedente non contengono saldi, indicatori e
-- metadata completi: vengono conservati ma non interpretati come pronti/inseriti.
UPDATE esportazioni_fse
SET stato = 'LEGACY_2_0C_REVIEW_REQUIRED',
    coverage_purpose = 'AUDIT_ONLY',
    legacy_review_required = true
WHERE request_hash IS NULL;

UPDATE esportazioni_fse_eventi e
SET active_coverage = false,
    administrative_status = 'BLOCCATO',
    blocking = true
FROM esportazioni_fse x
WHERE x.id = e.esportazione_id
  AND x.legacy_review_required = true;

UPDATE esportazioni_fse_righe r
SET active_coverage = false
FROM esportazioni_fse_eventi e, esportazioni_fse x
WHERE r.esportazione_evento_id = e.id
  AND x.id = e.esportazione_id
  AND x.legacy_review_required = true;

ALTER TABLE esportazioni_fse ADD CONSTRAINT esportazioni_fse_state_check CHECK (
  stato IN (
    'GENERATA_CON_BLOCCHI',
    'PRONTA_PER_INSERIMENTO_MANUALE',
    'INSERITA_MANUALMENTE',
    'ANNULLATA',
    'LEGACY_2_0C_REVIEW_REQUIRED'
  )
);

ALTER TABLE esportazioni_fse DROP CONSTRAINT IF EXISTS esportazioni_fse_coverage_purpose_check;
ALTER TABLE esportazioni_fse ADD CONSTRAINT esportazioni_fse_coverage_purpose_check CHECK (
  coverage_purpose IN ('ADMINISTRATIVE', 'AUDIT_ONLY')
);

ALTER TABLE esportazioni_fse DROP CONSTRAINT IF EXISTS esportazioni_fse_request_hash_check;
ALTER TABLE esportazioni_fse ADD CONSTRAINT esportazioni_fse_request_hash_check CHECK (
  request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'
);

ALTER TABLE esportazioni_fse_eventi DROP CONSTRAINT IF EXISTS esportazioni_fse_eventi_admin_state_check;
ALTER TABLE esportazioni_fse_eventi ADD CONSTRAINT esportazioni_fse_eventi_admin_state_check CHECK (
  administrative_status IN (
    'DA_RENDICONTARE',
    'ARRETRATO_NON_RENDICONTATO',
    'IN_ESPORTAZIONE',
    'INSERITO_MANUALMENTE',
    'BLOCCATO',
    'ANNULLATO',
    'CORREZIONE_DA_GESTIRE_MANUALMENTE'
  )
);

CREATE TABLE IF NOT EXISTS esportazioni_fse_indicatori (
  id bigserial PRIMARY KEY,
  esportazione_id integer NOT NULL REFERENCES esportazioni_fse(id) ON DELETE RESTRICT,
  rilevazione_id integer REFERENCES rilevazioni_monitoraggio_fse(id) ON DELETE RESTRICT,
  anno_mese varchar(7) NOT NULL,
  canale_ufficiale varchar(20) NOT NULL,
  data_riferimento date NOT NULL,
  values_json jsonb NOT NULL,
  content_hash varchar(64) NOT NULL,
  CONSTRAINT esportazioni_fse_indicatori_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT esportazioni_fse_indicatori_unique UNIQUE (esportazione_id, anno_mese, canale_ufficiale)
);

CREATE TABLE IF NOT EXISTS esportazioni_fse_saldi (
  id bigserial PRIMARY KEY,
  esportazione_id integer NOT NULL REFERENCES esportazioni_fse(id) ON DELETE RESTRICT,
  magazzino_id integer NOT NULL REFERENCES magazzini(id) ON DELETE RESTRICT,
  fondo varchar(50) NOT NULL,
  prodotto_id integer NOT NULL REFERENCES prodotti(id) ON DELETE RESTRICT,
  prodotto_codice_snapshot varchar(30) NOT NULL,
  prodotto_nome_snapshot varchar(150) NOT NULL,
  lotto_id integer REFERENCES lotti(id) ON DELETE RESTRICT,
  lotto_codice_snapshot varchar(80),
  saldo_pezzi numeric(18,6),
  saldo_kg_lt numeric(18,6),
  content_hash varchar(64) NOT NULL,
  CONSTRAINT esportazioni_fse_saldi_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS esportazioni_fse_saldi_key_unique
  ON esportazioni_fse_saldi(esportazione_id, magazzino_id, fondo, prodotto_id, COALESCE(lotto_id, 0));

CREATE INDEX IF NOT EXISTS esportazioni_fse_eventi_admin_queue_idx
  ON esportazioni_fse_eventi(administrative_status, event_date, active_coverage);

ALTER TABLE rilevazioni_monitoraggio_fse DROP CONSTRAINT IF EXISTS rilevazioni_monitoraggio_fse_source_check;
ALTER TABLE rilevazioni_monitoraggio_fse ADD CONSTRAINT rilevazioni_monitoraggio_fse_source_check CHECK (
  fonte IN ('RILEVAZIONE_MANUALE_VERIFICATA', 'DERIVAZIONE_STRUTTURATA')
);

ALTER TABLE rilevazioni_monitoraggio_fse DROP CONSTRAINT IF EXISTS rilevazioni_monitoraggio_fse_completeness_check;
ALTER TABLE rilevazioni_monitoraggio_fse ADD CONSTRAINT rilevazioni_monitoraggio_fse_completeness_check CHECK (
  completezza IN ('PARZIALE', 'COMPLETA')
);

ALTER TABLE scarichi
  ADD COLUMN IF NOT EXISTS fse_idempotency_key varchar(100),
  ADD COLUMN IF NOT EXISTS fse_request_hash varchar(64);

ALTER TABLE scarichi DROP CONSTRAINT IF EXISTS scarichi_fse_request_hash_check;
ALTER TABLE scarichi ADD CONSTRAINT scarichi_fse_request_hash_check CHECK (
  fse_request_hash IS NULL OR fse_request_hash ~ '^[0-9a-f]{64}$'
);

CREATE UNIQUE INDEX IF NOT EXISTS scarichi_fse_idempotency_unique
  ON scarichi(fse_idempotency_key)
  WHERE causale = 'reso_opc' AND fse_idempotency_key IS NOT NULL;

ALTER TABLE riconciliazioni_fse
  ADD COLUMN IF NOT EXISTS request_hash varchar(64),
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(64),
  ADD COLUMN IF NOT EXISTS scostamenti_accettati integer NOT NULL DEFAULT 0;

ALTER TABLE riconciliazioni_fse DROP CONSTRAINT IF EXISTS riconciliazioni_fse_request_hash_check;
ALTER TABLE riconciliazioni_fse ADD CONSTRAINT riconciliazioni_fse_request_hash_check CHECK (
  (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$') AND
  (idempotency_key IS NULL OR idempotency_key ~ '^[0-9a-f]{64}$') AND
  scostamenti_accettati >= 0
);

CREATE UNIQUE INDEX IF NOT EXISTS riconciliazioni_fse_idempotency_unique
  ON riconciliazioni_fse(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE riconciliazioni_fse_righe
  ADD COLUMN IF NOT EXISTS exact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calculated_state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS workflow_status varchar(40) NOT NULL DEFAULT 'CALCOLATO';

ALTER TABLE riconciliazioni_fse_righe DROP CONSTRAINT IF EXISTS riconciliazioni_fse_righe_workflow_check;
ALTER TABLE riconciliazioni_fse_righe ADD CONSTRAINT riconciliazioni_fse_righe_workflow_check CHECK (
  workflow_status IN (
    'CALCOLATO',
    'ABBINATO_MANUALMENTE',
    'DISABBINATO',
    'ACCETTATO_MANUALMENTE',
    'DA_CORREGGERE'
  )
);

ALTER TABLE riconciliazioni_fse_risoluzioni
  ADD COLUMN IF NOT EXISTS riconciliazione_id integer REFERENCES riconciliazioni_fse(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS target_movimento_id integer REFERENCES movimenti(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS target_importazione_riga_id integer REFERENCES importazioni_agea_righe(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS header_version_before integer,
  ADD COLUMN IF NOT EXISTS header_version_after integer;

CREATE INDEX IF NOT EXISTS riconciliazioni_fse_risoluzioni_header_idx
  ON riconciliazioni_fse_risoluzioni(riconciliazione_id, data_creazione);
