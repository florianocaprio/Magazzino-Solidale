-- Hardening operativo Logistica: aggiornamento additivo, idempotente e conservativo.
-- I valori legacy non canonici vengono diagnosticati ma non riscritti.

DO $logistica$
BEGIN
  IF to_regclass('public.volontari') IS NULL
    OR to_regclass('public.mezzi') IS NULL
    OR to_regclass('public.turni') IS NULL
    OR to_regclass('public.turni_volontari') IS NULL
    OR to_regclass('public.consegne') IS NULL
    OR to_regclass('public.ruoli_volontari') IS NULL
  THEN
    RAISE EXCEPTION 'Schema Logistica incompleto: applicare prima gli aggiornamenti precedenti';
  END IF;
END
$logistica$;

ALTER TABLE public.volontari
  ADD COLUMN IF NOT EXISTS ruolo_volontario_id integer,
  ADD COLUMN IF NOT EXISTS versione integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS data_aggiornamento timestamp NOT NULL DEFAULT now();

ALTER TABLE public.mezzi
  ADD COLUMN IF NOT EXISTS versione integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS data_aggiornamento timestamp NOT NULL DEFAULT now();

ALTER TABLE public.turni
  ADD COLUMN IF NOT EXISTS stato varchar(20) NOT NULL DEFAULT 'pianificato',
  ADD COLUMN IF NOT EXISTS motivo_annullamento text,
  ADD COLUMN IF NOT EXISTS versione integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS data_aggiornamento timestamp NOT NULL DEFAULT now();

ALTER TABLE public.volontari ALTER COLUMN attivo SET DEFAULT false;
ALTER TABLE public.volontari ALTER COLUMN stato_approvazione SET DEFAULT 'in_attesa';
ALTER TABLE public.mezzi ALTER COLUMN stato SET DEFAULT 'non_disponibile';
ALTER TABLE public.mezzi ALTER COLUMN stato_approvazione SET DEFAULT 'in_attesa';

DO $logistica$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.volontari'::regclass
      AND conname = 'volontari_ruolo_volontario_id_fkey'
  ) THEN
    ALTER TABLE public.volontari
      ADD CONSTRAINT volontari_ruolo_volontario_id_fkey
      FOREIGN KEY (ruolo_volontario_id)
      REFERENCES public.ruoli_volontari(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.consegne'::regclass
      AND conname = 'consegne_volontario_id_fkey'
  ) THEN
    ALTER TABLE public.consegne
      ADD CONSTRAINT consegne_volontario_id_fkey
      FOREIGN KEY (volontario_id)
      REFERENCES public.volontari(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.consegne'::regclass
      AND conname = 'consegne_mezzo_id_fkey'
  ) THEN
    ALTER TABLE public.consegne
      ADD CONSTRAINT consegne_mezzo_id_fkey
      FOREIGN KEY (mezzo_id)
      REFERENCES public.mezzi(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END
$logistica$;

DO $logistica$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.volontari'::regclass AND conname = 'volontari_stato_approvazione_check') THEN
    ALTER TABLE public.volontari ADD CONSTRAINT volontari_stato_approvazione_check
      CHECK (stato_approvazione IN ('in_attesa', 'approvato', 'respinto')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.volontari'::regclass AND conname = 'volontari_max_consegne_turno_check') THEN
    ALTER TABLE public.volontari ADD CONSTRAINT volontari_max_consegne_turno_check
      CHECK (max_consegne_turno >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mezzi'::regclass AND conname = 'mezzi_stato_approvazione_check') THEN
    ALTER TABLE public.mezzi ADD CONSTRAINT mezzi_stato_approvazione_check
      CHECK (stato_approvazione IN ('in_attesa', 'approvato', 'respinto')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mezzi'::regclass AND conname = 'mezzi_stato_check') THEN
    ALTER TABLE public.mezzi ADD CONSTRAINT mezzi_stato_check
      CHECK (stato IN ('disponibile', 'non_disponibile', 'manutenzione', 'respinto', 'ritirato')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mezzi'::regclass AND conname = 'mezzi_capacita_colli_check') THEN
    ALTER TABLE public.mezzi ADD CONSTRAINT mezzi_capacita_colli_check
      CHECK (capacita_colli IS NULL OR capacita_colli >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mezzi'::regclass AND conname = 'mezzi_capacita_kg_check') THEN
    ALTER TABLE public.mezzi ADD CONSTRAINT mezzi_capacita_kg_check
      CHECK (capacita_kg IS NULL OR capacita_kg >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.turni'::regclass AND conname = 'turni_fascia_check') THEN
    ALTER TABLE public.turni ADD CONSTRAINT turni_fascia_check
      CHECK (fascia IN ('09-13', '14-18', '18-20')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.turni'::regclass AND conname = 'turni_stato_check') THEN
    ALTER TABLE public.turni ADD CONSTRAINT turni_stato_check
      CHECK (stato IN ('pianificato', 'confermato', 'completato', 'annullato')) NOT VALID;
  END IF;
END
$logistica$;

-- Diagnostica soltanto: nessun dato legacy viene corretto o cancellato.
DO $logistica$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.volontari WHERE stato_approvazione NOT IN ('in_attesa', 'approvato', 'respinto');
  IF n > 0 THEN RAISE NOTICE 'Logistica legacy: % volontari con stato approvazione non canonico', n; END IF;
  SELECT count(*) INTO n FROM public.mezzi WHERE stato_approvazione NOT IN ('in_attesa', 'approvato', 'respinto');
  IF n > 0 THEN RAISE NOTICE 'Logistica legacy: % mezzi con stato approvazione non canonico', n; END IF;
  SELECT count(*) INTO n FROM public.mezzi WHERE stato NOT IN ('disponibile', 'non_disponibile', 'manutenzione', 'respinto', 'ritirato');
  IF n > 0 THEN RAISE NOTICE 'Logistica legacy: % mezzi con stato non canonico', n; END IF;
  SELECT count(*) INTO n FROM public.turni WHERE fascia NOT IN ('09-13', '14-18', '18-20');
  IF n > 0 THEN RAISE NOTICE 'Logistica legacy: % turni con fascia non canonica', n; END IF;
  SELECT count(*) INTO n FROM public.volontari WHERE max_consegne_turno < 0;
  IF n > 0 THEN RAISE NOTICE 'Logistica legacy: % volontari con max consegne negativo', n; END IF;
  SELECT count(*) INTO n FROM public.mezzi WHERE capacita_colli < 0 OR capacita_kg < 0;
  IF n > 0 THEN RAISE NOTICE 'Logistica legacy: % mezzi con capacita negativa', n; END IF;
  SELECT count(*) INTO n FROM public.consegne c LEFT JOIN public.volontari v ON v.id = c.volontario_id WHERE c.volontario_id IS NOT NULL AND v.id IS NULL;
  IF n > 0 THEN RAISE NOTICE 'Logistica legacy: % consegne con volontario orfano', n; END IF;
  SELECT count(*) INTO n FROM public.consegne c LEFT JOIN public.mezzi m ON m.id = c.mezzo_id WHERE c.mezzo_id IS NOT NULL AND m.id IS NULL;
  IF n > 0 THEN RAISE NOTICE 'Logistica legacy: % consegne con mezzo orfano', n; END IF;
  SELECT count(*) INTO n FROM public.volontari v WHERE v.ruolo_volontario_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.ruoli_volontari r WHERE lower(btrim(r.nome)) = lower(btrim(v.ruolo)));
  IF n > 0 THEN RAISE NOTICE 'Logistica legacy: % volontari con ruolo testuale non riconosciuto', n; END IF;
  SELECT count(*) INTO n FROM (
    SELECT tv.volontario_id, t.data, t.fascia
    FROM public.turni_volontari tv JOIN public.turni t ON t.id = tv.turno_id
    WHERE t.stato <> 'annullato'
    GROUP BY tv.volontario_id, t.data, t.fascia HAVING count(DISTINCT t.id) > 1
  ) d;
  IF n > 0 THEN RAISE NOTICE 'Logistica legacy: % collisioni volontario/data/fascia', n; END IF;
  SELECT count(*) INTO n FROM (
    SELECT mezzo_id, data, fascia FROM public.turni
    WHERE mezzo_id IS NOT NULL AND stato <> 'annullato'
    GROUP BY mezzo_id, data, fascia HAVING count(*) > 1
  ) d;
  IF n > 0 THEN RAISE NOTICE 'Logistica legacy: % collisioni mezzo/data/fascia', n; END IF;
END
$logistica$;

CREATE OR REPLACE FUNCTION public.enforce_turno_volontario_slot()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  slot_data date;
  slot_fascia varchar(20);
  slot_stato varchar(20);
  vol_attivo boolean;
  vol_approvazione varchar(20);
BEGIN
  SELECT data, fascia, stato INTO slot_data, slot_fascia, slot_stato
  FROM public.turni WHERE id = NEW.turno_id;
  IF slot_data IS NULL OR slot_stato = 'annullato' THEN RETURN NEW; END IF;

  SELECT attivo, stato_approvazione INTO vol_attivo, vol_approvazione
  FROM public.volontari WHERE id = NEW.volontario_id;
  -- Lascia alla FK il caso orfano, così conserva SQLSTATE 23503 e il
  -- comportamento referenziale già atteso dai consumer del database.
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF vol_attivo IS DISTINCT FROM true OR vol_approvazione IS DISTINCT FROM 'approvato' THEN
    RAISE EXCEPTION 'Volontario non attivo o non approvato' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('turno-volontario-slot'),
    hashtext(NEW.volontario_id::text || ':' || slot_data::text || ':' || slot_fascia)
  );
  IF EXISTS (
    SELECT 1 FROM public.turni_volontari tv
    JOIN public.turni t ON t.id = tv.turno_id
    WHERE tv.volontario_id = NEW.volontario_id
      AND tv.turno_id <> NEW.turno_id
      AND t.data = slot_data
      AND t.fascia = slot_fascia
      AND t.stato <> 'annullato'
  ) THEN
    RAISE EXCEPTION 'Volontario gia assegnato nello stesso slot' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS enforce_turno_volontario_slot_trg ON public.turni_volontari;
CREATE TRIGGER enforce_turno_volontario_slot_trg
BEFORE INSERT OR UPDATE OF turno_id, volontario_id
ON public.turni_volontari
FOR EACH ROW EXECUTE FUNCTION public.enforce_turno_volontario_slot();

CREATE OR REPLACE FUNCTION public.enforce_turno_slot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  volunteer_id integer;
BEGIN
  IF NEW.stato = 'annullato' THEN RETURN NEW; END IF;
  FOR volunteer_id IN
    SELECT volontario_id FROM public.turni_volontari
    WHERE turno_id = NEW.id ORDER BY volontario_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtext('turno-volontario-slot'),
      hashtext(volunteer_id::text || ':' || NEW.data::text || ':' || NEW.fascia)
    );
    IF EXISTS (
      SELECT 1 FROM public.turni_volontari tv
      JOIN public.turni t ON t.id = tv.turno_id
      WHERE tv.volontario_id = volunteer_id
        AND tv.turno_id <> NEW.id
        AND t.data = NEW.data
        AND t.fascia = NEW.fascia
        AND t.stato <> 'annullato'
    ) THEN
      RAISE EXCEPTION 'Volontario gia assegnato nello stesso slot' USING ERRCODE = '23505';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS enforce_turno_slot_update_trg ON public.turni;
CREATE TRIGGER enforce_turno_slot_update_trg
BEFORE UPDATE OF data, fascia, stato
ON public.turni
FOR EACH ROW EXECUTE FUNCTION public.enforce_turno_slot_update();
