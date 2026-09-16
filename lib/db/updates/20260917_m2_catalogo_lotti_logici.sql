-- M2: catalogo globale, quantità frazionabili e lotti logici operativi.
-- I dati inventariali legacy restano invariati e senza lotto logico.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prodotti'
      AND column_name = 'gestione_lotto'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prodotti'
      AND column_name = 'lotto_fisico_obbligatorio'
  ) THEN
    ALTER TABLE prodotti
      RENAME COLUMN gestione_lotto TO lotto_fisico_obbligatorio;
  END IF;
END $$;

ALTER TABLE prodotti
  ADD COLUMN IF NOT EXISTS lotto_fisico_obbligatorio boolean;

UPDATE prodotti
SET lotto_fisico_obbligatorio = false
WHERE lotto_fisico_obbligatorio IS NULL;

ALTER TABLE prodotti
  ALTER COLUMN lotto_fisico_obbligatorio SET DEFAULT false,
  ALTER COLUMN lotto_fisico_obbligatorio SET NOT NULL;

ALTER TABLE prodotti
  ADD COLUMN IF NOT EXISTS quantita_frazionabile boolean;

UPDATE prodotti
SET quantita_frazionabile = CASE
  WHEN lower(btrim(unita_misura)) IN ('kg', 'l', 'lt') THEN true
  ELSE false
END
WHERE quantita_frazionabile IS NULL;

ALTER TABLE prodotti
  ALTER COLUMN quantita_frazionabile SET DEFAULT false,
  ALTER COLUMN quantita_frazionabile SET NOT NULL;

CREATE TABLE IF NOT EXISTS lotti_logici (
  id serial PRIMARY KEY,
  area_operativa_id integer NOT NULL REFERENCES aree_operative(id) ON DELETE RESTRICT,
  codice varchar(80) NOT NULL,
  descrizione varchar(200) NOT NULL,
  data_inizio date,
  data_fine date,
  note text,
  stato varchar(20) NOT NULL DEFAULT 'aperto',
  is_generale boolean NOT NULL DEFAULT false,
  creato_da integer REFERENCES utenti(id) ON DELETE SET NULL,
  aggiornato_da integer REFERENCES utenti(id) ON DELETE SET NULL,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lotti_logici_stato_check
    CHECK (stato IN ('aperto', 'chiuso', 'archiviato')),
  CONSTRAINT lotti_logici_generale_aperto_check
    CHECK (NOT is_generale OR stato = 'aperto')
);

CREATE UNIQUE INDEX IF NOT EXISTS lotti_logici_area_codice_unique
  ON lotti_logici (area_operativa_id, codice);
CREATE UNIQUE INDEX IF NOT EXISTS lotti_logici_area_generale_unique
  ON lotti_logici (area_operativa_id)
  WHERE is_generale = true;
CREATE INDEX IF NOT EXISTS lotti_logici_area_stato_idx
  ON lotti_logici (area_operativa_id, stato);

INSERT INTO lotti_logici (
  area_operativa_id,
  codice,
  descrizione,
  stato,
  is_generale,
  creato_da,
  aggiornato_da
)
SELECT id, 'GENERALE', 'Generale', 'aperto', true, NULL, NULL
FROM aree_operative
ON CONFLICT DO NOTHING;

ALTER TABLE lotti
  ADD COLUMN IF NOT EXISTS lotto_logico_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lotti_lotto_logico_id_lotti_logici_id_fk'
  ) THEN
    ALTER TABLE lotti
      ADD CONSTRAINT lotti_lotto_logico_id_lotti_logici_id_fk
      FOREIGN KEY (lotto_logico_id)
      REFERENCES lotti_logici(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS lotti_lotto_logico_idx
  ON lotti (lotto_logico_id);

-- La vecchia chiave non comprendeva il lotto logico e non deve unire due
-- partite appartenenti a lotti operativi differenti.
DROP INDEX IF EXISTS lotti_partita_fisica_unique;
CREATE UNIQUE INDEX IF NOT EXISTS lotti_partita_fisica_unique
  ON lotti (
    magazzino_id,
    prodotto_id,
    lotto_logico_id,
    fondo_origine,
    coalesce(fornitore_id, 0),
    codice_lotto_normalizzato,
    coalesce(data_scadenza, DATE '0001-01-01'),
    coalesce(fattore_kg_lt_pezzo, 0)
  )
  WHERE lotto_logico_id IS NOT NULL
    AND codice_lotto_normalizzato IS NOT NULL;

-- Vista diagnostica: classifica senza correggere o arrotondare le quantità
-- frazionarie legacy legate a prodotti ora dichiarati non frazionabili.
CREATE OR REPLACE VIEW m2_anomalie_quantita_legacy AS
SELECT 'anomalia_quantita_legacy'::text AS classificazione,
       fonte,
       record_id,
       prodotto_id,
       quantita
FROM (
  SELECT 'lotti.quantita_caricata'::text AS fonte, l.id AS record_id,
         l.prodotto_id, l.quantita_caricata AS quantita
  FROM lotti l
  UNION ALL
  SELECT 'lotti.quantita_residua', l.id, l.prodotto_id, l.quantita_residua
  FROM lotti l
  UNION ALL
  SELECT 'movimenti.quantita', m.id, m.prodotto_id, m.quantita
  FROM movimenti m
  UNION ALL
  SELECT 'prenotazioni_magazzino.quantita', p.id, p.prodotto_id, p.quantita
  FROM prenotazioni_magazzino p
  UNION ALL
  SELECT 'bolla_righe.quantita', b.id, b.prodotto_id, b.quantita
  FROM bolla_righe b
  UNION ALL
  SELECT 'trasferimento_righe.quantita', t.id, t.prodotto_id, t.quantita
  FROM trasferimento_righe t
  UNION ALL
  SELECT 'scarico_righe.quantita', s.id, s.prodotto_id, s.quantita
  FROM scarico_righe s
  UNION ALL
  SELECT 'carichi_magazzino_righe.quantita_operativa', c.id,
         c.prodotto_id, c.quantita_operativa
  FROM carichi_magazzino_righe c
) q
JOIN prodotti p ON p.id = q.prodotto_id
WHERE p.quantita_frazionabile = false
  AND q.quantita <> trunc(q.quantita);
