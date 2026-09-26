-- M5A: bridge non inventariale Centro -> Magazzino. Nessun backfill o stock.
CREATE SEQUENCE IF NOT EXISTS richieste_magazzino_codice_seq;

CREATE TABLE IF NOT EXISTS richieste_magazzino (
  id serial PRIMARY KEY,
  codice varchar(40) NOT NULL,
  tipo_destinatario varchar(20) NOT NULL,
  beneficiario_id integer REFERENCES beneficiari(id) ON DELETE RESTRICT,
  ente_destinatario_id integer REFERENCES enti_destinatari(id) ON DELETE RESTRICT,
  magazzino_destinatario_id integer REFERENCES magazzini(id) ON DELETE RESTRICT,
  area_operativa_id integer NOT NULL REFERENCES aree_operative(id) ON DELETE RESTRICT,
  centro_ascolto_id integer REFERENCES centri_di_ascolto(id) ON DELETE RESTRICT,
  zona_uds_id_snapshot integer,
  sorgente varchar(30) NOT NULL,
  intervento_id integer REFERENCES interventi(id) ON DELETE RESTRICT,
  destinatario_codice_snapshot varchar(40),
  destinatario_nome_snapshot varchar(200) NOT NULL,
  num_componenti_snapshot integer,
  area_nome_snapshot varchar(120) NOT NULL,
  centro_nome_snapshot varchar(120),
  bisogno varchar(2000) NOT NULL,
  note_operative varchar(2000),
  priorita varchar(10) NOT NULL DEFAULT 'normale',
  data_desiderata date,
  modalita_preferita varchar(20) NOT NULL DEFAULT 'da_definire',
  stato varchar(20) NOT NULL DEFAULT 'inviata',
  versione integer NOT NULL DEFAULT 1,
  inviato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  preso_in_carico_da integer REFERENCES utenti(id) ON DELETE RESTRICT,
  preso_in_carico_codice_snapshot varchar(120),
  preso_in_carico_at timestamptz,
  annullato_da integer REFERENCES utenti(id) ON DELETE RESTRICT,
  annullato_at timestamptz,
  motivo_annullamento varchar(500),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT richieste_magazzino_destinatario_check CHECK (
    (tipo_destinatario = 'beneficiario' AND beneficiario_id IS NOT NULL AND ente_destinatario_id IS NULL AND magazzino_destinatario_id IS NULL AND centro_ascolto_id IS NOT NULL)
    OR (tipo_destinatario = 'ente' AND beneficiario_id IS NULL AND ente_destinatario_id IS NOT NULL AND magazzino_destinatario_id IS NULL)
    OR (tipo_destinatario = 'magazzino' AND beneficiario_id IS NULL AND ente_destinatario_id IS NULL AND magazzino_destinatario_id IS NOT NULL)
  ),
  CONSTRAINT richieste_magazzino_sorgente_check CHECK (
    (sorgente = 'beneficiario' AND tipo_destinatario = 'beneficiario' AND intervento_id IS NULL)
    OR (sorgente = 'intervento_sociale' AND tipo_destinatario = 'beneficiario' AND intervento_id IS NOT NULL)
    OR (sorgente = 'operativa' AND tipo_destinatario IN ('ente', 'magazzino') AND intervento_id IS NULL)
  ),
  CONSTRAINT richieste_magazzino_contenuto_check CHECK (length(btrim(bisogno)) BETWEEN 1 AND 2000 AND (note_operative IS NULL OR length(note_operative) <= 2000)),
  CONSTRAINT richieste_magazzino_priorita_check CHECK (priorita IN ('bassa', 'normale', 'alta', 'urgente')),
  CONSTRAINT richieste_magazzino_modalita_check CHECK (modalita_preferita IN ('da_definire', 'ritiro', 'domicilio')),
  CONSTRAINT richieste_magazzino_stato_check CHECK (stato IN ('inviata', 'presa_in_carico', 'chiusa', 'annullata')),
  CONSTRAINT richieste_magazzino_versione_check CHECK (versione > 0),
  CONSTRAINT richieste_magazzino_presa_check CHECK ((preso_in_carico_da IS NULL) = (preso_in_carico_at IS NULL) AND (preso_in_carico_da IS NULL) = (preso_in_carico_codice_snapshot IS NULL) AND (stato <> 'inviata' OR preso_in_carico_da IS NULL) AND (stato NOT IN ('presa_in_carico', 'chiusa') OR preso_in_carico_da IS NOT NULL)),
  CONSTRAINT richieste_magazzino_annullamento_check CHECK ((stato = 'annullata' AND annullato_da IS NOT NULL AND annullato_at IS NOT NULL AND motivo_annullamento IS NOT NULL AND length(btrim(motivo_annullamento)) BETWEEN 1 AND 500) OR (stato <> 'annullata' AND annullato_da IS NULL AND annullato_at IS NULL AND motivo_annullamento IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS richieste_magazzino_codice_unique ON richieste_magazzino(codice);
CREATE UNIQUE INDEX IF NOT EXISTS richieste_magazzino_intervento_attivo_unique ON richieste_magazzino(intervento_id)
  WHERE intervento_id IS NOT NULL AND stato IN ('inviata', 'presa_in_carico');
CREATE INDEX IF NOT EXISTS richieste_magazzino_coda_idx ON richieste_magazzino(area_operativa_id, centro_ascolto_id, stato, data_creazione, id);
CREATE INDEX IF NOT EXISTS richieste_magazzino_beneficiario_idx ON richieste_magazzino(beneficiario_id);
CREATE INDEX IF NOT EXISTS richieste_magazzino_ente_idx ON richieste_magazzino(ente_destinatario_id);
CREATE INDEX IF NOT EXISTS richieste_magazzino_magazzino_idx ON richieste_magazzino(magazzino_destinatario_id);
CREATE INDEX IF NOT EXISTS richieste_magazzino_intervento_idx ON richieste_magazzino(intervento_id);
