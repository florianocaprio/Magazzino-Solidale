-- Appendice 50: solo coordinamento persistente. Nessun accredito, backfill o
-- riscrittura dei movimenti/politiche/quote/crediti storici, anche frazionari.
CREATE TABLE IF NOT EXISTS public.credito_ricariche_mensili (
  periodo varchar(7) PRIMARY KEY,
  avviata_at timestamptz NOT NULL,
  completata_at timestamptz,
  CONSTRAINT credito_ricariche_periodo_check CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE TABLE IF NOT EXISTS public.credito_ricariche_destinatari (
  id serial PRIMARY KEY,
  periodo varchar(7) NOT NULL REFERENCES public.credito_ricariche_mensili(periodo),
  beneficiario_id integer NOT NULL REFERENCES public.beneficiari(id),
  stato varchar(20) NOT NULL DEFAULT 'pendente',
  causa text,
  movimento_id integer REFERENCES public.credito_solidale_movimenti(id),
  aggiornata_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credito_ricariche_stato_check CHECK (stato IN ('pendente','elaborato','gia_elaborato','escluso','errore')),
  CONSTRAINT credito_ricariche_ricevuta_check CHECK (
    (stato IN ('elaborato','gia_elaborato') AND movimento_id IS NOT NULL)
    OR (stato NOT IN ('elaborato','gia_elaborato') AND movimento_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS credito_ricariche_beneficiario_periodo_unique
  ON public.credito_ricariche_destinatari(beneficiario_id, periodo);
