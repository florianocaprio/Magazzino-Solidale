ALTER TABLE public.interventi
  ADD COLUMN IF NOT EXISTS risultato text;

CREATE TABLE IF NOT EXISTS public.interventi_attivita (
  id serial PRIMARY KEY,
  intervento_id integer NOT NULL REFERENCES public.interventi(id) ON DELETE CASCADE,
  tipologia_id integer REFERENCES public.tipi_intervento(id) ON DELETE SET NULL,
  tipologia_snapshot varchar(120) NOT NULL,
  descrizione text NOT NULL,
  risultato text,
  operatore_id integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interventi_attivita_snapshot_check CHECK (length(trim(tipologia_snapshot)) > 0),
  CONSTRAINT interventi_attivita_descrizione_check CHECK (length(trim(descrizione)) > 0)
);

CREATE TABLE IF NOT EXISTS public.interventi_materiali (
  id serial PRIMARY KEY,
  intervento_id integer NOT NULL REFERENCES public.interventi(id) ON DELETE CASCADE,
  prodotto_id integer REFERENCES public.prodotti(id) ON DELETE SET NULL,
  descrizione_snapshot varchar(255) NOT NULL,
  unita_misura_snapshot varchar(40) NOT NULL,
  quantita_prevista numeric(12,3) NOT NULL DEFAULT 0,
  quantita_consegnata numeric(12,3) NOT NULL DEFAULT 0,
  stato_preparazione varchar(30) NOT NULL DEFAULT 'da_preparare',
  magazzino_id integer REFERENCES public.magazzini(id) ON DELETE SET NULL,
  note text,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interventi_materiali_quantita_check CHECK (quantita_prevista >= 0 AND quantita_consegnata >= 0),
  CONSTRAINT interventi_materiali_stato_check CHECK (stato_preparazione IN ('da_preparare', 'pronto', 'consegnato', 'annullato')),
  CONSTRAINT interventi_materiali_descrizione_check CHECK (length(trim(descrizione_snapshot)) > 0 AND length(trim(unita_misura_snapshot)) > 0)
);

CREATE TABLE IF NOT EXISTS public.interventi_documenti (
  id serial PRIMARY KEY,
  intervento_id integer NOT NULL REFERENCES public.interventi(id) ON DELETE CASCADE,
  tipo_descrizione varchar(200) NOT NULL,
  stato varchar(30) NOT NULL,
  data_scadenza date,
  note text,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interventi_documenti_stato_check CHECK (stato IN ('da_acquisire', 'da_verificare', 'acquisito', 'verificato', 'non_disponibile', 'annullato')),
  CONSTRAINT interventi_documenti_descrizione_check CHECK (length(trim(tipo_descrizione)) > 0)
);

CREATE INDEX IF NOT EXISTS interventi_attivita_intervento_idx
  ON public.interventi_attivita (intervento_id);
CREATE INDEX IF NOT EXISTS interventi_attivita_tipologia_idx
  ON public.interventi_attivita (tipologia_id);
CREATE INDEX IF NOT EXISTS interventi_materiali_intervento_idx
  ON public.interventi_materiali (intervento_id);
CREATE INDEX IF NOT EXISTS interventi_materiali_prodotto_idx
  ON public.interventi_materiali (prodotto_id);
CREATE INDEX IF NOT EXISTS interventi_materiali_magazzino_idx
  ON public.interventi_materiali (magazzino_id);
CREATE INDEX IF NOT EXISTS interventi_materiali_stato_idx
  ON public.interventi_materiali (stato_preparazione);
CREATE INDEX IF NOT EXISTS interventi_documenti_intervento_idx
  ON public.interventi_documenti (intervento_id);
CREATE INDEX IF NOT EXISTS interventi_documenti_stato_idx
  ON public.interventi_documenti (stato);
CREATE INDEX IF NOT EXISTS interventi_documenti_scadenza_idx
  ON public.interventi_documenti (data_scadenza);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'interventi'
      AND column_name = 'risultato' AND data_type = 'text'
  ) THEN
    RAISE EXCEPTION 'Schema inatteso per public.interventi.risultato';
  END IF;
END $$;
