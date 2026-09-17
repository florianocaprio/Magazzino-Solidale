-- M3A: pratica di carico persistente e contabilizzazioni incrementali.
-- Le tabelle contabili esistenti restano il solo motore inventariale.

CREATE TABLE IF NOT EXISTS carico_pratiche (
  id serial PRIMARY KEY,
  codice varchar(40) NOT NULL,
  versione integer NOT NULL DEFAULT 1,
  stato varchar(20) NOT NULL DEFAULT 'bozza',
  area_operativa_id integer NOT NULL REFERENCES aree_operative(id) ON DELETE RESTRICT,
  magazzino_id integer NOT NULL REFERENCES magazzini(id) ON DELETE RESTRICT,
  lotto_logico_id integer NOT NULL REFERENCES lotti_logici(id) ON DELETE RESTRICT,
  origine_carico varchar(40) NOT NULL,
  data_carico date NOT NULL,
  descrizione text NOT NULL,
  fornitore_id integer REFERENCES fornitori(id) ON DELETE RESTRICT,
  numero_documento varchar(100),
  data_documento date,
  note text,
  creato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  aggiornato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carico_pratiche_stato_check
    CHECK (stato IN ('bozza', 'aperta', 'chiusa', 'annullata')),
  CONSTRAINT carico_pratiche_versione_check CHECK (versione > 0),
  CONSTRAINT carico_pratiche_descrizione_check
    CHECK (length(btrim(descrizione)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS carico_pratiche_codice_unique
  ON carico_pratiche (codice);
CREATE INDEX IF NOT EXISTS carico_pratiche_area_magazzino_idx
  ON carico_pratiche (area_operativa_id, magazzino_id, data_carico);
CREATE INDEX IF NOT EXISTS carico_pratiche_stato_idx
  ON carico_pratiche (stato);

CREATE TABLE IF NOT EXISTS carico_pratica_righe (
  id serial PRIMARY KEY,
  carico_pratica_id integer NOT NULL REFERENCES carico_pratiche(id) ON DELETE CASCADE,
  client_id varchar(100),
  prodotto_id integer NOT NULL REFERENCES prodotti(id) ON DELETE RESTRICT,
  fondo_origine varchar(50) NOT NULL DEFAULT 'NESSUN_FONDO',
  quantita numeric(14,6),
  codice_lotto_produttore varchar(80),
  data_scadenza date,
  fattore_kg_lt_pezzo numeric(18,9),
  note text,
  unita_misura_snapshot varchar(20),
  quantita_frazionabile_snapshot boolean,
  registrata_at timestamptz,
  creato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  aggiornato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carico_pratica_righe_quantita_check
    CHECK (quantita IS NULL OR quantita > 0),
  CONSTRAINT carico_pratica_righe_snapshot_check CHECK (
    (registrata_at IS NULL AND unita_misura_snapshot IS NULL AND quantita_frazionabile_snapshot IS NULL)
    OR
    (registrata_at IS NOT NULL AND quantita IS NOT NULL AND unita_misura_snapshot IS NOT NULL AND quantita_frazionabile_snapshot IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS carico_pratica_righe_client_unique
  ON carico_pratica_righe (carico_pratica_id, client_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS carico_pratica_righe_pratica_idx
  ON carico_pratica_righe (carico_pratica_id);
CREATE INDEX IF NOT EXISTS carico_pratica_righe_prodotto_idx
  ON carico_pratica_righe (prodotto_id);

CREATE TABLE IF NOT EXISTS carico_integrazioni (
  id serial PRIMARY KEY,
  carico_pratica_id integer NOT NULL REFERENCES carico_pratiche(id) ON DELETE RESTRICT,
  carico_magazzino_id integer NOT NULL REFERENCES carichi_magazzino(id) ON DELETE RESTRICT,
  idempotency_key varchar(120) NOT NULL,
  request_hash varchar(64) NOT NULL,
  versione_richiesta integer NOT NULL,
  versione_risultante integer NOT NULL,
  attore_id integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  result_snapshot jsonb NOT NULL,
  data_registrazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carico_integrazioni_request_hash_check
    CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS carico_integrazioni_idempotency_unique
  ON carico_integrazioni (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS carico_integrazioni_carico_unique
  ON carico_integrazioni (carico_magazzino_id);
CREATE INDEX IF NOT EXISTS carico_integrazioni_pratica_idx
  ON carico_integrazioni (carico_pratica_id);

CREATE TABLE IF NOT EXISTS carico_integrazione_righe (
  id serial PRIMARY KEY,
  carico_integrazione_id integer NOT NULL REFERENCES carico_integrazioni(id) ON DELETE RESTRICT,
  carico_pratica_riga_id integer NOT NULL REFERENCES carico_pratica_righe(id) ON DELETE RESTRICT,
  carico_magazzino_riga_id integer NOT NULL REFERENCES carichi_magazzino_righe(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS carico_integrazione_righe_pratica_riga_unique
  ON carico_integrazione_righe (carico_pratica_riga_id);
CREATE UNIQUE INDEX IF NOT EXISTS carico_integrazione_righe_contabile_unique
  ON carico_integrazione_righe (carico_magazzino_riga_id);
CREATE INDEX IF NOT EXISTS carico_integrazione_righe_integrazione_idx
  ON carico_integrazione_righe (carico_integrazione_id);

CREATE TABLE IF NOT EXISTS carico_pratica_rettifiche (
  id serial PRIMARY KEY,
  carico_pratica_riga_id integer NOT NULL REFERENCES carico_pratica_righe(id) ON DELETE RESTRICT,
  carico_integrazione_riga_id integer NOT NULL REFERENCES carico_integrazione_righe(id) ON DELETE RESTRICT,
  lotto_id integer NOT NULL REFERENCES lotti(id) ON DELETE RESTRICT,
  movimento_id integer NOT NULL REFERENCES movimenti(id) ON DELETE RESTRICT,
  audit_evento_id integer NOT NULL REFERENCES audit_eventi(id) ON DELETE RESTRICT,
  idempotency_key varchar(120) NOT NULL,
  request_hash varchar(64) NOT NULL,
  quantita numeric(14,6) NOT NULL,
  motivo text NOT NULL,
  attore_id integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  result_snapshot jsonb NOT NULL,
  data_rettifica timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carico_pratica_rettifiche_quantita_check CHECK (quantita > 0),
  CONSTRAINT carico_pratica_rettifiche_motivo_check CHECK (length(btrim(motivo)) > 0),
  CONSTRAINT carico_pratica_rettifiche_request_hash_check
    CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS carico_pratica_rettifiche_idempotency_unique
  ON carico_pratica_rettifiche (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS carico_pratica_rettifiche_movimento_unique
  ON carico_pratica_rettifiche (movimento_id);
CREATE INDEX IF NOT EXISTS carico_pratica_rettifiche_riga_idx
  ON carico_pratica_rettifiche (carico_pratica_riga_id);

COMMENT ON TABLE carico_pratiche IS
  'Pratica M3A persistente; non produce effetti inventariali finché non viene registrata una integrazione.';
COMMENT ON TABLE carico_integrazioni IS
  'Comando immutabile che collega una selezione di righe alla registrazione contabile carichi_magazzino.';
COMMENT ON TABLE carico_pratica_rettifiche IS
  'Rettifiche negative motivate e idempotenti collegate alla riga M3A e al movimento contabile aggiuntivo.';
