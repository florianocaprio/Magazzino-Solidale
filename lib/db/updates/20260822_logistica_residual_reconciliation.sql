-- Residui Review 2.0 Logistica: provenienza Consegna/Turno e integrità storica.
-- Aggiornamento additivo, idempotente e senza backfill interpretativo.

DO $logistica_residui$
BEGIN
  IF to_regclass('public.turni') IS NULL
    OR to_regclass('public.turni_volontari') IS NULL
    OR to_regclass('public.consegne') IS NULL
    OR to_regclass('public.volontari') IS NULL
    OR to_regclass('public.mezzi') IS NULL
  THEN
    RAISE EXCEPTION 'Schema Logistica incompleto: applicare prima gli aggiornamenti precedenti';
  END IF;
END
$logistica_residui$;

-- I valori true sono intenzionali: tutto il pregresso resta manuale/legacy e
-- non può essere rimosso da una riconciliazione Consegna.
ALTER TABLE public.turni
  ADD COLUMN IF NOT EXISTS mezzo_manuale boolean NOT NULL DEFAULT true;

ALTER TABLE public.turni_volontari
  ADD COLUMN IF NOT EXISTS manuale boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.turni_consegne (
  id serial PRIMARY KEY,
  turno_id integer NOT NULL,
  consegna_id integer NOT NULL,
  volontario_id integer,
  mezzo_id integer,
  data_creazione timestamp NOT NULL DEFAULT now(),
  data_aggiornamento timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS turni_consegne_consegna_unique
  ON public.turni_consegne (consegna_id);

DO $logistica_residui$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.turni_consegne'::regclass
      AND conname = 'turni_consegne_turno_fk'
  ) THEN
    ALTER TABLE public.turni_consegne
      ADD CONSTRAINT turni_consegne_turno_fk FOREIGN KEY (turno_id)
      REFERENCES public.turni(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.turni_consegne'::regclass
      AND conname = 'turni_consegne_consegna_fk'
  ) THEN
    ALTER TABLE public.turni_consegne
      ADD CONSTRAINT turni_consegne_consegna_fk FOREIGN KEY (consegna_id)
      REFERENCES public.consegne(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.turni_consegne'::regclass
      AND conname = 'turni_consegne_volontario_fk'
  ) THEN
    ALTER TABLE public.turni_consegne
      ADD CONSTRAINT turni_consegne_volontario_fk FOREIGN KEY (volontario_id)
      REFERENCES public.volontari(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.turni_consegne'::regclass
      AND conname = 'turni_consegne_mezzo_fk'
  ) THEN
    ALTER TABLE public.turni_consegne
      ADD CONSTRAINT turni_consegne_mezzo_fk FOREIGN KEY (mezzo_id)
      REFERENCES public.mezzi(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END
$logistica_residui$;

-- Cambia esclusivamente la FK turno_id da CASCADE a RESTRICT, qualunque sia
-- il nome assegnato storicamente al vincolo.
DO $logistica_residui$
DECLARE
  fk_name text;
  fk_action "char";
BEGIN
  SELECT c.conname, c.confdeltype INTO fk_name, fk_action
  FROM pg_constraint c
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'public.turni_volontari'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'public.turni'::regclass
    AND a.attname = 'turno_id'
  LIMIT 1;

  IF fk_name IS NOT NULL AND fk_action <> 'r' THEN
    EXECUTE format('ALTER TABLE public.turni_volontari DROP CONSTRAINT %I', fk_name);
    fk_name := NULL;
  END IF;
  IF fk_name IS NULL THEN
    ALTER TABLE public.turni_volontari
      ADD CONSTRAINT turni_volontari_turno_restrict_fk
      FOREIGN KEY (turno_id) REFERENCES public.turni(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END
$logistica_residui$;

-- Diagnostica soltanto: nessuna provenienza viene inferita dal pregresso.
DO $logistica_residui$
DECLARE
  legacy_turni bigint;
  legacy_volontari bigint;
BEGIN
  SELECT count(*) INTO legacy_turni
  FROM public.turni t
  WHERE (t.mezzo_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.turni_volontari tv WHERE tv.turno_id = t.id
  )) AND NOT EXISTS (
    SELECT 1 FROM public.turni_consegne tc WHERE tc.turno_id = t.id
  );
  SELECT count(*) INTO legacy_volontari
  FROM public.turni_volontari WHERE manuale = true;
  RAISE NOTICE 'Logistica legacy protetta: % turni senza provenienza Consegna, % assegnazioni volontario manuali/legacy',
    legacy_turni, legacy_volontari;
END
$logistica_residui$;
