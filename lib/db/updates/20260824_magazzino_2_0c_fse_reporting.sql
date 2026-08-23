-- Magazzino 2.0C: snapshot amministrativi FSE+, monitoraggio e riconciliazione.
-- Migration append-only, additiva e senza backfill interpretativo.

CREATE TABLE IF NOT EXISTS rilevazioni_monitoraggio_fse (
  id serial PRIMARY KEY,
  magazzino_id integer NOT NULL REFERENCES magazzini(id) ON DELETE RESTRICT,
  anno_mese varchar(7) NOT NULL,
  canale_ufficiale varchar(20) NOT NULL,
  operazione_distribuzione_id integer REFERENCES operazioni_distribuzione_magazzino(id) ON DELETE RESTRICT,
  data_riferimento date NOT NULL,
  minori_18 integer,
  giovani_18_29 integer,
  donne integer,
  over_65 integer,
  persone_disabilita integer,
  cittadini_paesi_terzi integer,
  origine_straniera_minoranze integer,
  senzatetto_esclusione_abitativa integer,
  totale_saltuari integer,
  fonte varchar(40) NOT NULL,
  completezza varchar(30) NOT NULL,
  versione integer NOT NULL DEFAULT 1,
  creato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  aggiornato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  note_audit text,
  CONSTRAINT rilevazioni_monitoraggio_fse_month_check CHECK (anno_mese ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT rilevazioni_monitoraggio_fse_channel_check CHECK (canale_ufficiale IN ('PACCHI', 'MENSA', 'STRADA')),
  CONSTRAINT rilevazioni_monitoraggio_fse_counts_check CHECK (
    (minori_18 IS NULL OR minori_18 >= 0) AND
    (giovani_18_29 IS NULL OR giovani_18_29 >= 0) AND
    (donne IS NULL OR donne >= 0) AND
    (over_65 IS NULL OR over_65 >= 0) AND
    (persone_disabilita IS NULL OR persone_disabilita >= 0) AND
    (cittadini_paesi_terzi IS NULL OR cittadini_paesi_terzi >= 0) AND
    (origine_straniera_minoranze IS NULL OR origine_straniera_minoranze >= 0) AND
    (senzatetto_esclusione_abitativa IS NULL OR senzatetto_esclusione_abitativa >= 0) AND
    (totale_saltuari IS NULL OR totale_saltuari >= 0)
  ),
  CONSTRAINT rilevazioni_monitoraggio_fse_version_check CHECK (versione >= 1),
  CONSTRAINT rilevazioni_monitoraggio_fse_month_unique UNIQUE (magazzino_id, anno_mese, canale_ufficiale)
);

CREATE TABLE IF NOT EXISTS esportazioni_fse (
  id serial PRIMARY KEY,
  magazzino_id integer NOT NULL REFERENCES magazzini(id) ON DELETE RESTRICT,
  data_da date NOT NULL,
  data_a date NOT NULL,
  data_as_of date NOT NULL,
  timezone varchar(40) NOT NULL DEFAULT 'Europe/Rome',
  format_code varchar(60) NOT NULL,
  model_version varchar(40) NOT NULL,
  stato varchar(40) NOT NULL,
  max_movimento_id integer NOT NULL,
  max_operazione_distribuzione_id integer NOT NULL,
  canonical_hash varchar(64) NOT NULL,
  idempotency_key varchar(64) NOT NULL,
  eventi_totali integer NOT NULL,
  righe_totali integer NOT NULL,
  righe_bloccanti integer NOT NULL,
  righe_warning integer NOT NULL,
  creato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  annullato_da integer REFERENCES utenti(id) ON DELETE RESTRICT,
  data_annullamento timestamptz,
  motivazione_annullamento text,
  marcato_inserito_da integer REFERENCES utenti(id) ON DELETE RESTRICT,
  data_inserimento_esterno timestamptz,
  riferimento_esterno text,
  versione integer NOT NULL DEFAULT 1,
  CONSTRAINT esportazioni_fse_format_check CHECK (format_code IN ('FSE_CANONICAL_AUDIT_XLSX_V1', 'SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1')),
  CONSTRAINT esportazioni_fse_state_check CHECK (stato IN ('GENERATA', 'PRONTA_PER_INSERIMENTO_MANUALE', 'INSERITA_MANUALMENTE', 'ANNULLATA')),
  CONSTRAINT esportazioni_fse_period_check CHECK (data_da <= data_a AND data_as_of >= data_a),
  CONSTRAINT esportazioni_fse_hash_check CHECK (canonical_hash ~ '^[0-9a-f]{64}$' AND idempotency_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT esportazioni_fse_version_check CHECK (versione >= 1),
  CONSTRAINT esportazioni_fse_counts_check CHECK (eventi_totali >= 0 AND righe_totali >= 0 AND righe_bloccanti >= 0 AND righe_warning >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS esportazioni_fse_idempotency_unique ON esportazioni_fse(idempotency_key);
CREATE INDEX IF NOT EXISTS esportazioni_fse_mag_period_state_idx ON esportazioni_fse(magazzino_id, data_da, data_a, stato);

CREATE TABLE IF NOT EXISTS esportazioni_fse_eventi (
  id serial PRIMARY KEY,
  esportazione_id integer NOT NULL REFERENCES esportazioni_fse(id) ON DELETE RESTRICT,
  event_key varchar(160) NOT NULL,
  content_hash varchar(64) NOT NULL,
  source_type varchar(80) NOT NULL,
  source_id integer NOT NULL,
  event_date date NOT NULL,
  official_activity varchar(30),
  internal_channel varchar(40),
  document_number varchar(100),
  packs integer,
  meals integer,
  occasional_people integer,
  continuous_people integer,
  status varchar(40) NOT NULL,
  quality_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_coverage boolean NOT NULL DEFAULT true,
  CONSTRAINT esportazioni_fse_eventi_key_unique UNIQUE (esportazione_id, event_key),
  CONSTRAINT esportazioni_fse_eventi_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT esportazioni_fse_eventi_counts_check CHECK (
    (packs IS NULL OR packs >= 0) AND (meals IS NULL OR meals >= 0) AND
    (occasional_people IS NULL OR occasional_people >= 0) AND
    (continuous_people IS NULL OR continuous_people >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS esportazioni_fse_eventi_active_coverage_unique
  ON esportazioni_fse_eventi(event_key) WHERE active_coverage = true;

CREATE TABLE IF NOT EXISTS esportazioni_fse_righe (
  id serial PRIMARY KEY,
  esportazione_evento_id integer NOT NULL REFERENCES esportazioni_fse_eventi(id) ON DELETE RESTRICT,
  line_key varchar(180) NOT NULL,
  content_hash varchar(64) NOT NULL,
  movimento_id integer NOT NULL REFERENCES movimenti(id) ON DELETE RESTRICT,
  movimento_origine_id integer REFERENCES movimenti(id) ON DELETE RESTRICT,
  accounting_nature varchar(50) NOT NULL,
  fund varchar(50) NOT NULL,
  product_id integer NOT NULL REFERENCES prodotti(id) ON DELETE RESTRICT,
  product_code_snapshot varchar(30) NOT NULL,
  product_name_snapshot varchar(150) NOT NULL,
  lot_id integer REFERENCES lotti(id) ON DELETE RESTRICT,
  lot_code_snapshot varchar(80),
  expiry_snapshot date,
  quantity_pieces_signed numeric(18,6),
  quantity_kg_lt_signed numeric(18,6),
  factor_kg_lt_piece numeric(18,9),
  unit_snapshot varchar(20) NOT NULL,
  source_lineage_json jsonb NOT NULL,
  reporting_disposition varchar(60) NOT NULL,
  quality_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_coverage boolean NOT NULL DEFAULT true,
  CONSTRAINT esportazioni_fse_righe_key_unique UNIQUE (esportazione_evento_id, line_key),
  CONSTRAINT esportazioni_fse_righe_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS esportazioni_fse_righe_active_coverage_unique
  ON esportazioni_fse_righe(line_key) WHERE active_coverage = true;

CREATE TABLE IF NOT EXISTS riconciliazioni_fse (
  id serial PRIMARY KEY,
  magazzino_id integer NOT NULL REFERENCES magazzini(id) ON DELETE RESTRICT,
  importazione_agea_id integer NOT NULL REFERENCES importazioni_agea(id) ON DELETE RESTRICT,
  importazione_agea_precedente_id integer REFERENCES importazioni_agea(id) ON DELETE RESTRICT,
  data_riferimento date NOT NULL,
  max_movimento_id integer NOT NULL,
  max_operazione_distribuzione_id integer NOT NULL,
  model_version varchar(40) NOT NULL,
  canonical_hash varchar(64) NOT NULL,
  stato varchar(40) NOT NULL,
  versione integer NOT NULL DEFAULT 1,
  totale_righe integer NOT NULL DEFAULT 0,
  riconciliate integer NOT NULL DEFAULT 0,
  solo_locali integer NOT NULL DEFAULT 0,
  solo_agea integer NOT NULL DEFAULT 0,
  scostamenti integer NOT NULL DEFAULT 0,
  ambigue integer NOT NULL DEFAULT 0,
  bloccanti integer NOT NULL DEFAULT 0,
  creato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  ricalcolato_da integer REFERENCES utenti(id) ON DELETE RESTRICT,
  data_ricalcolo timestamptz,
  chiuso_da integer REFERENCES utenti(id) ON DELETE RESTRICT,
  data_chiusura timestamptz,
  annullato_da integer REFERENCES utenti(id) ON DELETE RESTRICT,
  data_annullamento timestamptz,
  motivazione_chiusura text,
  CONSTRAINT riconciliazioni_fse_state_check CHECK (stato IN ('CALCOLATA', 'DA_RIVEDERE', 'RICONCILIATA', 'CHIUSA_CON_SCOSTAMENTI', 'ANNULLATA')),
  CONSTRAINT riconciliazioni_fse_hash_check CHECK (canonical_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT riconciliazioni_fse_version_check CHECK (versione >= 1),
  CONSTRAINT riconciliazioni_fse_counts_check CHECK (
    totale_righe >= 0 AND riconciliate >= 0 AND solo_locali >= 0 AND solo_agea >= 0 AND
    scostamenti >= 0 AND ambigue >= 0 AND bloccanti >= 0
  )
);

CREATE INDEX IF NOT EXISTS riconciliazioni_fse_import_state_idx ON riconciliazioni_fse(importazione_agea_id, stato);

CREATE TABLE IF NOT EXISTS riconciliazioni_fse_righe (
  id serial PRIMARY KEY,
  riconciliazione_id integer NOT NULL REFERENCES riconciliazioni_fse(id) ON DELETE RESTRICT,
  tipo_riga varchar(40) NOT NULL,
  business_key varchar(255) NOT NULL,
  match_method varchar(40) NOT NULL,
  local_event_key varchar(160),
  local_line_key varchar(180),
  movimento_id integer REFERENCES movimenti(id) ON DELETE RESTRICT,
  operazione_distribuzione_id integer REFERENCES operazioni_distribuzione_magazzino(id) ON DELETE RESTRICT,
  external_movement_id integer,
  importazione_agea_riga_id integer REFERENCES importazioni_agea_righe(id) ON DELETE RESTRICT,
  fund_local varchar(50),
  fund_external varchar(50),
  product_id_local integer REFERENCES prodotti(id) ON DELETE RESTRICT,
  product_id_external integer REFERENCES prodotti(id) ON DELETE RESTRICT,
  lot_local varchar(80),
  lot_external varchar(80),
  date_local date,
  date_external date,
  pieces_local numeric(18,6),
  pieces_external numeric(18,6),
  kg_lt_local numeric(18,6),
  kg_lt_external numeric(18,6),
  difference_pieces numeric(18,6),
  difference_kg_lt numeric(18,6),
  channel_local varchar(40),
  channel_external varchar(40),
  status varchar(60) NOT NULL,
  blocking boolean NOT NULL,
  quality_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash varchar(64) NOT NULL,
  CONSTRAINT riconciliazioni_fse_righe_key_unique UNIQUE (riconciliazione_id, business_key),
  CONSTRAINT riconciliazioni_fse_righe_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS riconciliazioni_fse_righe_state_block_idx ON riconciliazioni_fse_righe(status, blocking);

CREATE TABLE IF NOT EXISTS riconciliazioni_fse_risoluzioni (
  id serial PRIMARY KEY,
  riconciliazione_riga_id integer NOT NULL REFERENCES riconciliazioni_fse_righe(id) ON DELETE RESTRICT,
  azione varchar(40) NOT NULL,
  motivazione text NOT NULL,
  old_state_json jsonb NOT NULL,
  new_state_json jsonb NOT NULL,
  creato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT riconciliazioni_fse_risoluzioni_action_check CHECK (azione IN ('ABBINA', 'DISABBINA', 'ACCETTA_SCOSTAMENTO', 'SEGNALA_DA_CORREGGERE', 'RIAPRI'))
);

CREATE INDEX IF NOT EXISTS riconciliazioni_fse_risoluzioni_row_idx ON riconciliazioni_fse_risoluzioni(riconciliazione_riga_id);

CREATE INDEX IF NOT EXISTS movimenti_mag_fondo_data_id_idx ON movimenti(magazzino_id, fondo_origine, data_movimento, id);
CREATE INDEX IF NOT EXISTS movimenti_operazione_distribuzione_idx ON movimenti(operazione_distribuzione_id);
