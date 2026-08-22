-- Magazzino 2.0A-R1: idempotenza contenuto/scope, dimensioni e storni parziali.
-- Migration progressiva, additiva e rieseguibile dopo 20260822_magazzino_2_0a.sql.

DO $$
BEGIN
  IF to_regclass('public.carichi_magazzino') IS NULL
     OR to_regclass('public.movimenti') IS NULL
     OR to_regclass('public.operazioni_distribuzione_magazzino') IS NULL THEN
    RAISE EXCEPTION 'Applicare prima 20260822_magazzino_2_0a.sql';
  END IF;
END $$;

ALTER TABLE public.carichi_magazzino
  ADD COLUMN IF NOT EXISTS request_hash varchar(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.carichi_magazzino'::regclass
      AND conname = 'carichi_magazzino_request_hash_check'
  ) THEN
    ALTER TABLE public.carichi_magazzino
      ADD CONSTRAINT carichi_magazzino_request_hash_check
      CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$') NOT VALID;
  END IF;
END $$;

ALTER TABLE public.movimenti
  ADD COLUMN IF NOT EXISTS fattore_kg_lt_pezzo numeric(18,9);

-- Tutte le quantità che partecipano a decisioni inventariali condividono la
-- scala contabile 6. Le conversioni sono esatte per i valori legacy scala 2.
ALTER TABLE public.prodotti
  ALTER COLUMN scorta_minima TYPE numeric(14,6),
  ALTER COLUMN scorta_consigliata TYPE numeric(14,6),
  ALTER COLUMN quantita_massima_per_spesa TYPE numeric(14,6),
  ALTER COLUMN quantita_massima_mensile TYPE numeric(14,6);
ALTER TABLE public.bolla_righe ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.prenotazioni_magazzino ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.scarico_righe ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.trasferimento_righe ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.mensa_consumi ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.sessioni_cassa_emporio_righe
  ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.spese_emporio_righe ALTER COLUMN quantita TYPE numeric(14,6);
ALTER TABLE public.spese_emporio_storni_righe
  ALTER COLUMN quantita TYPE numeric(14,6);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.movimenti'::regclass
      AND conname = 'movimenti_fattore_kg_lt_pezzo_check'
  ) THEN
    ALTER TABLE public.movimenti
      ADD CONSTRAINT movimenti_fattore_kg_lt_pezzo_check
      CHECK (fattore_kg_lt_pezzo IS NULL OR fattore_kg_lt_pezzo > 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.operazioni_distribuzione_magazzino
  ALTER COLUMN stato TYPE varchar(30);

ALTER TABLE public.operazioni_distribuzione_magazzino
  DROP CONSTRAINT IF EXISTS operazioni_distribuzione_stato_check;

ALTER TABLE public.operazioni_distribuzione_magazzino
  ADD CONSTRAINT operazioni_distribuzione_stato_check
  CHECK (stato IN ('confermata', 'parzialmente_stornata', 'stornata'));

CREATE INDEX IF NOT EXISTS movimenti_operazione_natura_origine_idx
  ON public.movimenti (operazione_distribuzione_id, natura_contabile, movimento_origine_id);

-- Gli storni parziali producono più compensazioni append-only della stessa
-- origine; l'unicità legacy uno-a-uno impedirebbe il ciclo di vita R1.
DROP INDEX IF EXISTS public.movimenti_storno_origine_unique;
CREATE INDEX IF NOT EXISTS movimenti_storno_origine_idx
  ON public.movimenti (movimento_origine_id)
  WHERE movimento_origine_id IS NOT NULL;

COMMENT ON COLUMN public.carichi_magazzino.request_hash IS
  'SHA-256 della richiesta normalizzata; NULL sui carichi precedenti alla R1, mai esposto dalle API.';
COMMENT ON COLUMN public.movimenti.fattore_kg_lt_pezzo IS
  'Snapshot contabile del fattore Kg/Lt per pezzo usato dal movimento.';
