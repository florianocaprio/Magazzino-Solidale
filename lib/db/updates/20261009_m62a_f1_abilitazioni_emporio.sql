-- Nuovo diritto esplicito per Area. Nessun backfill da Credito/Mensa/tessera.
CREATE TABLE IF NOT EXISTS public.emporio_abilitazioni (
  id serial PRIMARY KEY,
  beneficiario_id integer NOT NULL REFERENCES public.beneficiari(id),
  area_operativa_id integer NOT NULL REFERENCES public.aree_operative(id),
  stato varchar(20) NOT NULL,
  data_effetto timestamptz NOT NULL DEFAULT now(),
  operatore_id integer NOT NULL REFERENCES public.utenti(id),
  motivo text NOT NULL,
  CONSTRAINT emporio_abilitazioni_stato_check CHECK (stato IN ('attivo','sospeso','revocato')),
  CONSTRAINT emporio_abilitazioni_motivo_check CHECK (length(trim(motivo)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS emporio_abilitazioni_beneficiario_area_unique
  ON public.emporio_abilitazioni(beneficiario_id, area_operativa_id);
