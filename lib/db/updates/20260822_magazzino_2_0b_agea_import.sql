-- Magazzino 2.0B: staging auditabile e ledger esterno per registri AGEA/SIFEAD.
-- Migration additiva e idempotente; non contabilizza alcuna quantità.

CREATE TABLE IF NOT EXISTS importazioni_agea (
  id serial PRIMARY KEY,
  magazzino_id integer NOT NULL REFERENCES magazzini(id),
  nome_file varchar(255) NOT NULL,
  mime_type varchar(150) NOT NULL,
  dimensione_bytes integer NOT NULL CHECK (dimensione_bytes > 0 AND dimensione_bytes <= 10485760),
  sha256_file varchar(64) NOT NULL CHECK (sha256_file ~ '^[0-9a-f]{64}$'),
  tracciato_codice varchar(80) NOT NULL,
  parser_version varchar(30) NOT NULL,
  sheet_name varchar(100) NOT NULL,
  data_riferimento date NOT NULL,
  modalita varchar(30) NOT NULL CHECK (modalita IN ('PRIMA_ACQUISIZIONE', 'AGGIORNAMENTO', 'SOLO_ANALISI')),
  stato varchar(30) NOT NULL CHECK (stato IN ('ANALIZZATA', 'DA_MAPPARE', 'BLOCCATA', 'PRONTA', 'CONFERMATA', 'ANNULLATA', 'ERRORE')),
  versione integer NOT NULL DEFAULT 1 CHECK (versione > 0),
  righe_totali integer NOT NULL DEFAULT 0,
  righe_carico integer NOT NULL DEFAULT 0,
  righe_distribuzione integer NOT NULL DEFAULT 0,
  righe_reso integer NOT NULL DEFAULT 0,
  righe_non_classificate integer NOT NULL DEFAULT 0,
  righe_nuove integer NOT NULL DEFAULT 0,
  righe_duplicate integer NOT NULL DEFAULT 0,
  righe_modificate integer NOT NULL DEFAULT 0,
  righe_ambigue integer NOT NULL DEFAULT 0,
  righe_bloccanti integer NOT NULL DEFAULT 0,
  partite_totali integer NOT NULL DEFAULT 0,
  partite_saldo_positivo integer NOT NULL DEFAULT 0,
  bootstrap_carico_id integer REFERENCES carichi_magazzino(id),
  creato_da integer NOT NULL REFERENCES utenti(id),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  confermato_da integer REFERENCES utenti(id),
  data_conferma timestamptz,
  annullato_da integer REFERENCES utenti(id),
  data_annullamento timestamptz,
  note_audit jsonb
);

CREATE INDEX IF NOT EXISTS importazioni_agea_magazzino_data_idx ON importazioni_agea(magazzino_id, data_creazione);
CREATE INDEX IF NOT EXISTS importazioni_agea_sha_idx ON importazioni_agea(sha256_file);
CREATE UNIQUE INDEX IF NOT EXISTS importazioni_agea_bootstrap_unique
  ON importazioni_agea(magazzino_id)
  WHERE modalita = 'PRIMA_ACQUISIZIONE' AND stato = 'CONFERMATA';

CREATE TABLE IF NOT EXISTS mappature_prodotti_esterni (
  id serial PRIMARY KEY,
  fonte varchar(40) NOT NULL CHECK (fonte = 'AGEA_SIFEAD'),
  codice_esterno varchar(100),
  descrizione_esterna text NOT NULL,
  chiave_descrizione_normalizzata text NOT NULL,
  prodotto_id integer NOT NULL REFERENCES prodotti(id),
  attiva boolean NOT NULL DEFAULT true,
  versione integer NOT NULL DEFAULT 1 CHECK (versione > 0),
  creato_da integer NOT NULL REFERENCES utenti(id),
  data_prima_associazione timestamptz NOT NULL DEFAULT now(),
  aggiornato_da integer NOT NULL REFERENCES utenti(id),
  data_ultimo_aggiornamento timestamptz NOT NULL DEFAULT now(),
  data_ultimo_riscontro timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mappature_prodotti_esterni_fonte_descrizione_unique UNIQUE (fonte, chiave_descrizione_normalizzata)
);
CREATE INDEX IF NOT EXISTS mappature_prodotti_esterni_prodotto_idx ON mappature_prodotti_esterni(prodotto_id);

CREATE TABLE IF NOT EXISTS importazioni_agea_righe (
  id serial PRIMARY KEY,
  importazione_id integer NOT NULL REFERENCES importazioni_agea(id) ON DELETE CASCADE,
  numero_riga integer NOT NULL CHECK (numero_riga >= 2),
  raw_json jsonb NOT NULL,
  fondo_raw text,
  fondo_normalizzato varchar(50),
  prodotto_raw text NOT NULL,
  prodotto_normalizzato text NOT NULL,
  lotto_raw text,
  lotto_normalizzato text,
  numero_documento_raw text,
  numero_documento_normalizzato text,
  data_documento_raw text,
  data_documento date,
  data_carico_magazzino_raw text,
  data_carico_risolta date,
  data_carico_fonte varchar(40),
  mittente_destinatario_raw text,
  movimento_kg_lt_raw text,
  movimento_kg_lt numeric(18,6),
  movimento_pezzi_raw text,
  movimento_pezzi numeric(18,6),
  saldo_movimento_kg_lt_raw text,
  saldo_movimento_kg_lt numeric(18,6),
  saldo_movimento_pezzi_raw text,
  saldo_movimento_pezzi numeric(18,6),
  saldo_finale_kg_lt_raw text,
  saldo_finale_kg_lt numeric(18,6),
  saldo_finale_pezzi_raw text,
  saldo_finale_pezzi numeric(18,6),
  note_raw text,
  attivita_raw text,
  attivita_normalizzata varchar(30),
  pacchi_raw text,
  pasti_raw text,
  saltuari_raw text,
  continuativi_raw text,
  tipo_movimento_esterno varchar(60) NOT NULL,
  identity_base_hash varchar(64) NOT NULL CHECK (identity_base_hash ~ '^[0-9a-f]{64}$'),
  identity_occurrence integer NOT NULL CHECK (identity_occurrence > 0),
  identity_key varchar(140) NOT NULL,
  content_hash varchar(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  movimento_esterno_id integer,
  mapping_prodotto_id integer REFERENCES mappature_prodotti_esterni(id),
  prodotto_id_snapshot integer REFERENCES prodotti(id),
  descrizione_prodotto_snapshot text,
  unita_misura_snapshot varchar(20),
  carico_magazzino_riga_id integer REFERENCES carichi_magazzino_righe(id),
  stato_riga varchar(60) NOT NULL,
  blocking boolean NOT NULL DEFAULT false,
  error_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  warning_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT importazioni_agea_righe_numero_unique UNIQUE (importazione_id, numero_riga)
);
CREATE INDEX IF NOT EXISTS importazioni_agea_righe_identity_idx ON importazioni_agea_righe(identity_key);
CREATE INDEX IF NOT EXISTS importazioni_agea_righe_preview_idx ON importazioni_agea_righe(importazione_id, stato_riga);

CREATE TABLE IF NOT EXISTS importazioni_agea_partite (
  id serial PRIMARY KEY,
  importazione_id integer NOT NULL REFERENCES importazioni_agea(id) ON DELETE CASCADE,
  party_key varchar(255) NOT NULL,
  fondo_origine varchar(50) NOT NULL,
  prodotto_id integer REFERENCES prodotti(id),
  prodotto_normalizzato text NOT NULL,
  lotto_raw text,
  lotto_normalizzato text,
  existing_lotto_id integer REFERENCES lotti(id),
  saldo_finale_pezzi numeric(18,6),
  saldo_finale_kg_lt numeric(18,6),
  quantita_operativa numeric(18,6),
  unita_misura_operativa varchar(20),
  fattore_kg_lt_pezzo numeric(18,9),
  data_scadenza_risolta date,
  data_scadenza_fonte varchar(40),
  stato varchar(60) NOT NULL,
  blocking boolean NOT NULL DEFAULT false,
  error_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  warning_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT importazioni_agea_partite_key_unique UNIQUE (importazione_id, party_key)
);
CREATE INDEX IF NOT EXISTS importazioni_agea_partite_preview_idx ON importazioni_agea_partite(importazione_id, stato);

CREATE TABLE IF NOT EXISTS movimenti_esterni_agea (
  id serial PRIMARY KEY,
  magazzino_id integer NOT NULL REFERENCES magazzini(id),
  identity_key varchar(140) NOT NULL,
  identity_base_hash varchar(64) NOT NULL CHECK (identity_base_hash ~ '^[0-9a-f]{64}$'),
  identity_occurrence integer NOT NULL CHECK (identity_occurrence > 0),
  accepted_content_hash varchar(64) NOT NULL CHECK (accepted_content_hash ~ '^[0-9a-f]{64}$'),
  accepted_import_row_id integer NOT NULL REFERENCES importazioni_agea_righe(id),
  tipo_movimento_esterno varchar(60) NOT NULL,
  prodotto_id_snapshot integer REFERENCES prodotti(id),
  first_seen_import_id integer NOT NULL REFERENCES importazioni_agea(id),
  last_seen_import_id integer NOT NULL REFERENCES importazioni_agea(id),
  stato_applicazione varchar(60) NOT NULL CHECK (stato_applicazione IN ('NON_APPLICABILE_RIFERIMENTO', 'DA_APPLICARE', 'APPLICATO_INCREMENTALE', 'ASSORBITO_SALDO_INIZIALE', 'CONFLITTO_CONTENUTO')),
  carico_magazzino_riga_id integer REFERENCES carichi_magazzino_righe(id),
  assorbito_da_bootstrap_riga_id integer REFERENCES carichi_magazzino_righe(id),
  data_prima_acquisizione timestamptz NOT NULL DEFAULT now(),
  data_ultimo_riscontro timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movimenti_esterni_agea_magazzino_identity_unique UNIQUE (magazzino_id, identity_key)
);
CREATE INDEX IF NOT EXISTS movimenti_esterni_agea_import_idx ON movimenti_esterni_agea(last_seen_import_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'importazioni_agea_righe_movimento_esterno_fk'
  ) THEN
    ALTER TABLE importazioni_agea_righe
      ADD CONSTRAINT importazioni_agea_righe_movimento_esterno_fk
      FOREIGN KEY (movimento_esterno_id) REFERENCES movimenti_esterni_agea(id);
  END IF;
END $$;
