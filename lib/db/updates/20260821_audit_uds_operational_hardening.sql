-- Hardening operativo Unita di Strada: aggiornamento additivo e conservativo.
-- I record legacy restano preservati e non ricevono classificazioni territoriali interpretative.

DO $uds$
BEGIN
  IF to_regclass('public.aree_operative') IS NULL
    OR to_regclass('public.zone_uds') IS NULL
    OR to_regclass('public.beneficiari') IS NULL
    OR to_regclass('public.utenti') IS NULL
    OR to_regclass('public.interventi') IS NULL
    OR to_regclass('public.bisogni_pianificati') IS NULL
    OR to_regclass('public.ruoli') IS NULL
  THEN
    RAISE EXCEPTION 'Schema UDS incompleto: applicare prima gli aggiornamenti fino alla migrazione Area Operativa';
  END IF;
END
$uds$;

ALTER TABLE public.zone_uds
  ADD COLUMN IF NOT EXISTS versione integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS data_aggiornamento timestamp NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS zone_uds_id_area_unique
  ON public.zone_uds (id, area_operativa_id);

DO $uds$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.zone_uds
    WHERE attivo = true
    GROUP BY area_operativa_id, lower(btrim(nome))
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS zone_uds_area_nome_attiva_unique
      ON public.zone_uds (area_operativa_id, lower(btrim(nome)))
      WHERE attivo = true;
  ELSE
    RAISE NOTICE 'Zone UDS attive duplicate per Area/nome: indice univoco rinviato, trigger di enforcement nuovi dati attivo.';
  END IF;
END
$uds$;

CREATE OR REPLACE FUNCTION public.enforce_zone_uds_active_name_unique()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.area_operativa_id IS NOT DISTINCT FROM OLD.area_operativa_id
    AND lower(btrim(NEW.nome)) IS NOT DISTINCT FROM lower(btrim(OLD.nome))
    AND NEW.attivo IS NOT DISTINCT FROM OLD.attivo
  THEN
    RETURN NEW;
  END IF;
  IF NEW.attivo = false THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtext('zona-uds-attiva'),
    hashtext(NEW.area_operativa_id::text || ':' || lower(btrim(NEW.nome)))
  );
  IF EXISTS (
    SELECT 1
    FROM public.zone_uds z
    WHERE z.id IS DISTINCT FROM NEW.id
      AND z.area_operativa_id = NEW.area_operativa_id
      AND lower(btrim(z.nome)) = lower(btrim(NEW.nome))
      AND z.attivo = true
  ) THEN
    RAISE EXCEPTION 'Esiste gia una Zona UDS attiva con questo nome nell Area'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS enforce_zone_uds_active_name_unique_trg ON public.zone_uds;
CREATE TRIGGER enforce_zone_uds_active_name_unique_trg
BEFORE INSERT OR UPDATE OF area_operativa_id, nome, attivo
ON public.zone_uds
FOR EACH ROW EXECUTE FUNCTION public.enforce_zone_uds_active_name_unique();

CREATE OR REPLACE FUNCTION public.prevent_zone_uds_area_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.area_operativa_id IS DISTINCT FROM OLD.area_operativa_id THEN
    RAISE EXCEPTION 'L Area Operativa della Zona UDS e immutabile'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS prevent_zone_uds_area_change_trg ON public.zone_uds;
CREATE TRIGGER prevent_zone_uds_area_change_trg
BEFORE UPDATE OF area_operativa_id
ON public.zone_uds
FOR EACH ROW EXECUTE FUNCTION public.prevent_zone_uds_area_change();

ALTER TABLE public.interventi
  ADD COLUMN IF NOT EXISTS area_operativa_id_snapshot integer,
  ADD COLUMN IF NOT EXISTS zona_uds_id_snapshot integer;

CREATE INDEX IF NOT EXISTS interventi_uds_territorio_data_idx
  ON public.interventi (
    ambito,
    area_operativa_id_snapshot,
    zona_uds_id_snapshot,
    data_intervento
  );

DO $uds$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.interventi'::regclass
      AND conname = 'interventi_area_operativa_id_snapshot_aree_operative_id_fk'
  ) THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_area_operativa_id_snapshot_aree_operative_id_fk
      FOREIGN KEY (area_operativa_id_snapshot)
      REFERENCES public.aree_operative(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.interventi'::regclass
      AND conname = 'interventi_zona_uds_id_snapshot_zone_uds_id_fk'
  ) THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_zona_uds_id_snapshot_zone_uds_id_fk
      FOREIGN KEY (zona_uds_id_snapshot)
      REFERENCES public.zone_uds(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.interventi'::regclass
      AND conname = 'interventi_uds_zona_area_snapshot_fk'
  ) THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_uds_zona_area_snapshot_fk
      FOREIGN KEY (zona_uds_id_snapshot, area_operativa_id_snapshot)
      REFERENCES public.zone_uds(id, area_operativa_id)
      NOT VALID;
  END IF;
END
$uds$;

-- Un CHECK NOT VALID viene comunque applicato agli UPDATE e renderebbe
-- immodificabili i record UDS legacy privi di snapshot. L'enforcement mirato
-- seguente protegge solo INSERT e nuove transizioni verso UDS.
ALTER TABLE public.interventi
  DROP CONSTRAINT IF EXISTS interventi_uds_area_snapshot_check;

CREATE OR REPLACE FUNCTION public.enforce_new_uds_area_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.ambito = 'uds'
    AND NEW.area_operativa_id_snapshot IS NULL
    AND (TG_OP = 'INSERT' OR OLD.ambito IS DISTINCT FROM 'uds')
  THEN
    RAISE EXCEPTION 'Un nuovo Intervento UDS richiede lo snapshot Area Operativa'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS enforce_new_uds_area_snapshot_trg ON public.interventi;
CREATE TRIGGER enforce_new_uds_area_snapshot_trg
BEFORE INSERT OR UPDATE OF ambito, area_operativa_id_snapshot
ON public.interventi
FOR EACH ROW EXECUTE FUNCTION public.enforce_new_uds_area_snapshot();

CREATE OR REPLACE FUNCTION public.prevent_uds_snapshot_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.ambito = 'uds'
    AND (
      NEW.ambito IS DISTINCT FROM OLD.ambito
      OR NEW.area_operativa_id_snapshot IS DISTINCT FROM OLD.area_operativa_id_snapshot
      OR NEW.zona_uds_id_snapshot IS DISTINCT FROM OLD.zona_uds_id_snapshot
    )
  THEN
    RAISE EXCEPTION 'La classificazione territoriale storica UDS e immutabile'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS prevent_uds_snapshot_rewrite_trg ON public.interventi;
CREATE TRIGGER prevent_uds_snapshot_rewrite_trg
BEFORE UPDATE OF ambito, area_operativa_id_snapshot, zona_uds_id_snapshot
ON public.interventi
FOR EACH ROW EXECUTE FUNCTION public.prevent_uds_snapshot_rewrite();

DO $uds$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.beneficiari'::regclass
      AND conname = 'beneficiari_zona_richiede_area_check'
  ) THEN
    ALTER TABLE public.beneficiari
      ADD CONSTRAINT beneficiari_zona_richiede_area_check
      CHECK (zona_uds_id IS NULL OR area_operativa_id IS NOT NULL)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.beneficiari'::regclass
      AND conname = 'beneficiari_zona_richiede_uds_check'
  ) THEN
    ALTER TABLE public.beneficiari
      ADD CONSTRAINT beneficiari_zona_richiede_uds_check
      CHECK (zona_uds_id IS NULL OR uds = true)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.beneficiari'::regclass
      AND conname = 'beneficiari_zona_area_fk'
  ) THEN
    ALTER TABLE public.beneficiari
      ADD CONSTRAINT beneficiari_zona_area_fk
      FOREIGN KEY (zona_uds_id, area_operativa_id)
      REFERENCES public.zone_uds(id, area_operativa_id)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.utenti'::regclass
      AND conname = 'utenti_zona_richiede_area_check'
  ) THEN
    ALTER TABLE public.utenti
      ADD CONSTRAINT utenti_zona_richiede_area_check
      CHECK (zona_uds_id IS NULL OR area_operativa_id IS NOT NULL)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.utenti'::regclass
      AND conname = 'utenti_zona_area_fk'
  ) THEN
    ALTER TABLE public.utenti
      ADD CONSTRAINT utenti_zona_area_fk
      FOREIGN KEY (zona_uds_id, area_operativa_id)
      REFERENCES public.zone_uds(id, area_operativa_id)
      NOT VALID;
  END IF;
END
$uds$;

ALTER TABLE public.bisogni_pianificati
  ADD COLUMN IF NOT EXISTS versione integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.bisogni_pianificati_storico (
  id serial PRIMARY KEY,
  bisogno_id integer NOT NULL,
  stato_precedente varchar(30),
  stato_nuovo varchar(30) NOT NULL,
  operatore_id integer REFERENCES public.utenti(id),
  data_transizione timestamptz NOT NULL DEFAULT now(),
  motivo text,
  valore_precedente jsonb,
  valore_nuovo jsonb
);

DO $uds$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bisogni_pianificati_storico'::regclass
      AND conname = 'bisogni_pianificati_storico_bisogno_id_fkey'
      AND confdeltype <> 'r'
  ) THEN
    ALTER TABLE public.bisogni_pianificati_storico
      DROP CONSTRAINT bisogni_pianificati_storico_bisogno_id_fkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bisogni_pianificati_storico'::regclass
      AND conname = 'bisogni_pianificati_storico_bisogno_id_fkey'
  ) THEN
    ALTER TABLE public.bisogni_pianificati_storico
      ADD CONSTRAINT bisogni_pianificati_storico_bisogno_id_fkey
      FOREIGN KEY (bisogno_id)
      REFERENCES public.bisogni_pianificati(id)
      ON DELETE RESTRICT;
  END IF;
END
$uds$;

CREATE INDEX IF NOT EXISTS bisogni_pianificati_storico_bisogno_idx
  ON public.bisogni_pianificati_storico (bisogno_id, id);

-- Preserva in modo conservativo le capacita dei ruoli che avevano gia Area UDS.
UPDATE public.ruoli r
SET permessi = (
  SELECT jsonb_agg(permission ORDER BY permission)
  FROM (
    SELECT DISTINCT jsonb_array_elements_text(coalesce(r.permessi, '[]'::jsonb)) AS permission
    UNION
    SELECT unnest(ARRAY[
      'uds.directory.view',
      'uds.interventi.view',
      'uds.interventi.create',
      'uds.interventi.update',
      'uds.interventi.note',
      'uds.bisogni.manage',
      'uds.reports.view'
    ])
  ) permissions
)
WHERE r.aree @> '["uds"]'::jsonb
  AND NOT r.permessi @> '[
    "uds.directory.view",
    "uds.interventi.view",
    "uds.interventi.create",
    "uds.interventi.update",
    "uds.interventi.note",
    "uds.bisogni.manage",
    "uds.reports.view"
  ]'::jsonb;
