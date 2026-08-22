-- Magazzino 2.0A: modello additivo di carico/partita/ledger.
-- La migration non modifica saldi né fonde partite legacy.

DO $migration$
BEGIN
  IF to_regclass('public.lotti') IS NULL
    OR to_regclass('public.movimenti') IS NULL
    OR to_regclass('public.prodotti') IS NULL
    OR to_regclass('public.magazzini') IS NULL
    OR to_regclass('public.utenti') IS NULL
  THEN
    RAISE EXCEPTION 'Schema Magazzino incompleto: applicare prima gli aggiornamenti consolidati';
  END IF;
END
$migration$;

ALTER TABLE public.lotti
  ALTER COLUMN quantita_caricata TYPE numeric(14,6),
  ALTER COLUMN quantita_residua TYPE numeric(14,6),
  ADD COLUMN IF NOT EXISTS fondo_origine varchar(50),
  ADD COLUMN IF NOT EXISTS codice_lotto_normalizzato varchar(80),
  ADD COLUMN IF NOT EXISTS data_ultimo_carico date,
  ADD COLUMN IF NOT EXISTS fattore_kg_lt_pezzo numeric(18,9);

UPDATE public.lotti
SET fondo_origine = CASE WHEN fse_plus THEN 'FSE_PLUS' ELSE 'NESSUN_FONDO' END
WHERE fondo_origine IS NULL;

UPDATE public.lotti
SET data_ultimo_carico = data_carico
WHERE data_ultimo_carico IS NULL;

ALTER TABLE public.lotti
  ALTER COLUMN fondo_origine SET DEFAULT 'NESSUN_FONDO',
  ALTER COLUMN fondo_origine SET NOT NULL;

-- Popola la chiave normalizzata soltanto quando il gruppo legacy è certo.
-- Gruppi duplicati restano esplicitamente NULL e non vengono fusi.
WITH candidati AS (
  SELECT
    id,
    upper(regexp_replace(btrim(codice_lotto), '\s+', ' ', 'g')) AS normalizzato,
    count(*) OVER (
      PARTITION BY magazzino_id, prodotto_id, fondo_origine,
        upper(regexp_replace(btrim(codice_lotto), '\s+', ' ', 'g'))
    ) AS occorrenze
  FROM public.lotti
  WHERE codice_lotto IS NOT NULL AND btrim(codice_lotto) <> ''
)
UPDATE public.lotti l
SET codice_lotto_normalizzato = c.normalizzato
FROM candidati c
WHERE c.id = l.id
  AND c.occorrenze = 1
  AND l.codice_lotto_normalizzato IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lotti_partita_fisica_unique
  ON public.lotti
    (magazzino_id, prodotto_id, fondo_origine, codice_lotto_normalizzato)
  WHERE codice_lotto_normalizzato IS NOT NULL;
CREATE INDEX IF NOT EXISTS lotti_fondo_idx ON public.lotti (fondo_origine);
CREATE INDEX IF NOT EXISTS lotti_mag_prod_scadenza_idx
  ON public.lotti (magazzino_id, prodotto_id, data_scadenza);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lotti'::regclass
      AND conname = 'lotti_fondo_origine_check'
  ) THEN
    ALTER TABLE public.lotti
      ADD CONSTRAINT lotti_fondo_origine_check CHECK (
        fondo_origine IN (
          'FSE_PLUS', 'FONDO_NAZIONALE',
          'FONDO_NAZIONALE_COFINANZIATO', 'NESSUN_FONDO'
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lotti'::regclass
      AND conname = 'lotti_fse_fondo_coerenza_check'
  ) THEN
    ALTER TABLE public.lotti
      ADD CONSTRAINT lotti_fse_fondo_coerenza_check
      CHECK (fse_plus = (fondo_origine = 'FSE_PLUS'));
  END IF;
  -- Una rettifica inventariale positiva può rendere il residuo superiore ai
  -- carichi documentali: il ledger della rettifica è la fonte della differenza.
  ALTER TABLE public.lotti
    DROP CONSTRAINT IF EXISTS lotti_residuo_non_superiore_caricato_2_0a;
END
$migration$;

CREATE TABLE IF NOT EXISTS public.carichi_magazzino (
  id serial PRIMARY KEY,
  magazzino_id integer NOT NULL REFERENCES public.magazzini(id),
  origine_carico varchar(40) NOT NULL,
  numero_documento varchar(100),
  data_documento date,
  data_carico date NOT NULL,
  descrizione text,
  fornitore_id integer REFERENCES public.fornitori(id),
  note text,
  idempotency_key varchar(120),
  stato varchar(20) NOT NULL DEFAULT 'confermato',
  creato_da integer NOT NULL REFERENCES public.utenti(id),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carichi_magazzino_origine_check CHECK (
    origine_carico IN (
      'AGEA_SIFEAD', 'RACCOLTA_ALIMENTARE', 'DONAZIONE', 'ACQUISTO',
      'FORNITORE', 'RETTIFICA_INVENTARIO', 'SALDO_INIZIALE', 'ALTRO', 'LEGACY'
    )
  ),
  CONSTRAINT carichi_magazzino_stato_check CHECK (stato IN ('confermato', 'stornato'))
);
CREATE UNIQUE INDEX IF NOT EXISTS carichi_magazzino_idempotency_unique
  ON public.carichi_magazzino (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS carichi_magazzino_magazzino_data_idx
  ON public.carichi_magazzino (magazzino_id, data_carico);
CREATE INDEX IF NOT EXISTS carichi_magazzino_documento_idx
  ON public.carichi_magazzino (magazzino_id, numero_documento);

CREATE TABLE IF NOT EXISTS public.carichi_magazzino_righe (
  id serial PRIMARY KEY,
  carico_magazzino_id integer NOT NULL REFERENCES public.carichi_magazzino(id),
  numero_riga integer NOT NULL,
  prodotto_id integer NOT NULL REFERENCES public.prodotti(id),
  lotto_id integer NOT NULL REFERENCES public.lotti(id),
  fondo_origine varchar(50) NOT NULL,
  quantita_operativa numeric(14,6) NOT NULL,
  unita_misura_operativa varchar(20) NOT NULL,
  quantita_pezzi numeric(14,6),
  quantita_kg_lt numeric(14,6),
  fattore_kg_lt_pezzo numeric(18,9),
  codice_lotto_originale varchar(80),
  data_scadenza date,
  descrizione_esterna text,
  riferimento_esterno varchar(160),
  note text,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carichi_magazzino_righe_numero_unique
    UNIQUE (carico_magazzino_id, numero_riga),
  CONSTRAINT carichi_magazzino_righe_fondo_check CHECK (
    fondo_origine IN (
      'FSE_PLUS', 'FONDO_NAZIONALE',
      'FONDO_NAZIONALE_COFINANZIATO', 'NESSUN_FONDO'
    )
  ),
  CONSTRAINT carichi_magazzino_righe_quantita_check CHECK (
    quantita_operativa > 0
    AND (quantita_pezzi IS NULL OR quantita_pezzi >= 0)
    AND (quantita_kg_lt IS NULL OR quantita_kg_lt >= 0)
  )
);
CREATE INDEX IF NOT EXISTS carichi_magazzino_righe_lotto_idx
  ON public.carichi_magazzino_righe (lotto_id);
CREATE INDEX IF NOT EXISTS carichi_magazzino_righe_fondo_idx
  ON public.carichi_magazzino_righe (fondo_origine);

CREATE TABLE IF NOT EXISTS public.operazioni_distribuzione_magazzino (
  id serial PRIMARY KEY,
  magazzino_id integer NOT NULL REFERENCES public.magazzini(id),
  data_distribuzione date NOT NULL,
  canale_operativo varchar(40) NOT NULL,
  dominio_origine varchar(40) NOT NULL,
  entita_origine_tipo varchar(80) NOT NULL,
  entita_origine_id integer NOT NULL,
  numero_documento varchar(100),
  numero_pacchi integer,
  numero_pasti integer,
  indigenti_saltuari integer,
  indigenti_continuativi integer,
  stato varchar(20) NOT NULL DEFAULT 'confermata',
  creato_da integer NOT NULL REFERENCES public.utenti(id),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operazioni_distribuzione_canale_check CHECK (
    canale_operativo IN (
      'PACCHI', 'RITIRO_SEDE', 'DOMICILIARE', 'EMPORIO', 'MENSA',
      'UDS_STRADA', 'ALTRO'
    )
  ),
  CONSTRAINT operazioni_distribuzione_stato_check
    CHECK (stato IN ('confermata', 'stornata')),
  CONSTRAINT operazioni_distribuzione_conteggi_check CHECK (
    (numero_pacchi IS NULL OR numero_pacchi >= 0)
    AND (numero_pasti IS NULL OR numero_pasti >= 0)
    AND (indigenti_saltuari IS NULL OR indigenti_saltuari >= 0)
    AND (indigenti_continuativi IS NULL OR indigenti_continuativi >= 0)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS operazioni_distribuzione_sorgente_unique
  ON public.operazioni_distribuzione_magazzino
    (dominio_origine, entita_origine_tipo, entita_origine_id);
CREATE INDEX IF NOT EXISTS operazioni_distribuzione_mag_data_idx
  ON public.operazioni_distribuzione_magazzino (magazzino_id, data_distribuzione);
CREATE INDEX IF NOT EXISTS operazioni_distribuzione_canale_idx
  ON public.operazioni_distribuzione_magazzino (canale_operativo);

ALTER TABLE public.movimenti
  ALTER COLUMN quantita TYPE numeric(14,6),
  ADD COLUMN IF NOT EXISTS quantita_pezzi numeric(14,6),
  ADD COLUMN IF NOT EXISTS quantita_kg_lt numeric(14,6),
  ADD COLUMN IF NOT EXISTS fondo_origine varchar(50),
  ADD COLUMN IF NOT EXISTS natura_contabile varchar(50),
  ADD COLUMN IF NOT EXISTS dominio_origine varchar(40),
  ADD COLUMN IF NOT EXISTS entita_origine_tipo varchar(80),
  ADD COLUMN IF NOT EXISTS entita_origine_id integer,
  ADD COLUMN IF NOT EXISTS riga_origine_id integer,
  ADD COLUMN IF NOT EXISTS carico_magazzino_riga_id integer,
  ADD COLUMN IF NOT EXISTS operazione_distribuzione_id integer,
  ADD COLUMN IF NOT EXISTS canale_operativo varchar(40);

UPDATE public.movimenti m
SET fondo_origine = CASE WHEN l.fse_plus THEN 'FSE_PLUS' ELSE 'NESSUN_FONDO' END
FROM public.lotti l
WHERE m.lotto_id = l.id AND m.fondo_origine IS NULL;
UPDATE public.movimenti SET fondo_origine = 'NESSUN_FONDO' WHERE fondo_origine IS NULL;
UPDATE public.movimenti SET natura_contabile = 'LEGACY' WHERE natura_contabile IS NULL;
ALTER TABLE public.movimenti
  ALTER COLUMN fondo_origine SET DEFAULT 'NESSUN_FONDO',
  ALTER COLUMN fondo_origine SET NOT NULL,
  ALTER COLUMN natura_contabile SET DEFAULT 'LEGACY',
  ALTER COLUMN natura_contabile SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.movimenti'::regclass
      AND conname = 'movimenti_carico_magazzino_riga_fk'
  ) THEN
    ALTER TABLE public.movimenti
      ADD CONSTRAINT movimenti_carico_magazzino_riga_fk
      FOREIGN KEY (carico_magazzino_riga_id)
      REFERENCES public.carichi_magazzino_righe(id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.movimenti'::regclass
      AND conname = 'movimenti_operazione_distribuzione_fk'
  ) THEN
    ALTER TABLE public.movimenti
      ADD CONSTRAINT movimenti_operazione_distribuzione_fk
      FOREIGN KEY (operazione_distribuzione_id)
      REFERENCES public.operazioni_distribuzione_magazzino(id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.movimenti'::regclass
      AND conname = 'movimenti_fondo_origine_check'
  ) THEN
    ALTER TABLE public.movimenti
      ADD CONSTRAINT movimenti_fondo_origine_check CHECK (
        fondo_origine IN (
          'FSE_PLUS', 'FONDO_NAZIONALE',
          'FONDO_NAZIONALE_COFINANZIATO', 'NESSUN_FONDO'
        )
      );
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS movimenti_fondo_idx ON public.movimenti (fondo_origine);
CREATE INDEX IF NOT EXISTS movimenti_natura_idx ON public.movimenti (natura_contabile);
CREATE INDEX IF NOT EXISTS movimenti_sorgente_idx
  ON public.movimenti (dominio_origine, entita_origine_tipo, entita_origine_id);
CREATE INDEX IF NOT EXISTS movimenti_operazione_distribuzione_idx
  ON public.movimenti (operazione_distribuzione_id);
CREATE UNIQUE INDEX IF NOT EXISTS movimenti_carico_riga_unique
  ON public.movimenti (carico_magazzino_riga_id)
  WHERE carico_magazzino_riga_id IS NOT NULL;

-- Widening conservativo dei campi direttamente coinvolti nei flussi stock.
ALTER TABLE public.bolla_righe ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.prenotazioni_magazzino ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.scarico_righe ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.trasferimento_righe ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.interventi_materiali
  ALTER COLUMN quantita_prevista TYPE numeric(14,6),
  ALTER COLUMN quantita_consegnata TYPE numeric(14,6);
ALTER TABLE public.mensa_consumi ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.spese_emporio_righe ALTER COLUMN quantita TYPE numeric(14,6);
