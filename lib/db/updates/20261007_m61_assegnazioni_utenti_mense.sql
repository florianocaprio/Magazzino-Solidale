-- D1 approvata: nessun backfill territoriale, nessuna modifica a ruoli/stock.
CREATE TABLE IF NOT EXISTS public.utenti_mense (
  id serial PRIMARY KEY,
  utente_id integer NOT NULL REFERENCES public.utenti(id) ON DELETE RESTRICT,
  mensa_id integer NOT NULL REFERENCES public.mense(id) ON DELETE RESTRICT,
  attiva boolean NOT NULL DEFAULT true,
  assegnata_da integer NOT NULL REFERENCES public.utenti(id) ON DELETE RESTRICT,
  assegnata_at timestamptz NOT NULL DEFAULT now(),
  revocata_da integer REFERENCES public.utenti(id) ON DELETE RESTRICT,
  revocata_at timestamptz,
  CONSTRAINT utenti_mense_revoca_check CHECK (
    (attiva AND revocata_da IS NULL AND revocata_at IS NULL)
    OR (NOT attiva AND revocata_da IS NOT NULL AND revocata_at IS NOT NULL AND revocata_at >= assegnata_at)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS utenti_mense_coppia_unique ON public.utenti_mense(utente_id, mensa_id);
CREATE INDEX IF NOT EXISTS utenti_mense_mensa_idx ON public.utenti_mense(mensa_id);
