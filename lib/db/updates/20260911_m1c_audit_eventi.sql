-- M1C: audit applicativo comune, append-only per contratto applicativo.
-- Nessun dato legacy viene ricostruito o aggiornato retroattivamente.

CREATE TABLE IF NOT EXISTS public.audit_eventi (
  id serial PRIMARY KEY,
  correlation_id uuid NOT NULL,
  azione varchar(100) NOT NULL,
  entita_tipo varchar(80) NOT NULL,
  entita_id integer NOT NULL,
  actor_type varchar(20) NOT NULL,
  actor_user_id integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  actor_code_snapshot varchar(160) NOT NULL,
  initiated_by_user_id integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  initiated_by_code_snapshot varchar(160),
  documento_tipo varchar(80),
  documento_id integer,
  area_operativa_id_snapshot integer,
  centro_ascolto_id_snapshot integer,
  magazzino_id_snapshot integer,
  data_operativa date,
  registrato_at timestamptz NOT NULL DEFAULT now(),
  motivo text,
  changes jsonb,
  metadata jsonb,
  operation_key varchar(200),
  previous_event_id integer REFERENCES public.audit_eventi(id) ON DELETE RESTRICT,
  CONSTRAINT audit_eventi_actor_type_check
    CHECK (actor_type IN ('user', 'system')),
  CONSTRAINT audit_eventi_actor_consistency_check
    CHECK (
      (actor_type = 'user'
        AND initiated_by_user_id IS NULL
        AND initiated_by_code_snapshot IS NULL)
      OR (actor_type = 'system' AND actor_user_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS audit_eventi_correlation_idx
  ON public.audit_eventi(correlation_id);
CREATE INDEX IF NOT EXISTS audit_eventi_action_idx
  ON public.audit_eventi(azione);
CREATE INDEX IF NOT EXISTS audit_eventi_entity_idx
  ON public.audit_eventi(entita_tipo, entita_id);
CREATE INDEX IF NOT EXISTS audit_eventi_actor_idx
  ON public.audit_eventi(actor_user_id);
CREATE INDEX IF NOT EXISTS audit_eventi_document_idx
  ON public.audit_eventi(documento_tipo, documento_id);
CREATE INDEX IF NOT EXISTS audit_eventi_registered_idx
  ON public.audit_eventi(registrato_at);
CREATE INDEX IF NOT EXISTS audit_eventi_area_idx
  ON public.audit_eventi(area_operativa_id_snapshot);
CREATE INDEX IF NOT EXISTS audit_eventi_warehouse_idx
  ON public.audit_eventi(magazzino_id_snapshot);
CREATE UNIQUE INDEX IF NOT EXISTS audit_eventi_operation_key_unique
  ON public.audit_eventi(azione, operation_key)
  WHERE operation_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.audit_eventi_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected public.audit_eventi%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_eventi is append-only';
  END IF;

  expected := OLD;
  -- Le sole mutazioni ammesse sono i SET NULL eseguiti dalle FK quando un
  -- account viene eliminato. Gli snapshot dell'attore restano immutati.
  IF OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL THEN
    expected.actor_user_id := NULL;
  END IF;
  IF OLD.initiated_by_user_id IS NOT NULL AND NEW.initiated_by_user_id IS NULL THEN
    expected.initiated_by_user_id := NULL;
  END IF;
  IF NEW IS NOT DISTINCT FROM expected THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_eventi is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_eventi_append_only_trg ON public.audit_eventi;
CREATE TRIGGER audit_eventi_append_only_trg
  BEFORE UPDATE OR DELETE ON public.audit_eventi
  FOR EACH ROW EXECUTE FUNCTION public.audit_eventi_append_only_guard();

ALTER TABLE public.movimenti
  ADD COLUMN IF NOT EXISTS audit_evento_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'movimenti_audit_evento_id_audit_eventi_id_fk'
      AND conrelid = 'public.movimenti'::regclass
  ) THEN
    ALTER TABLE public.movimenti
      ADD CONSTRAINT movimenti_audit_evento_id_audit_eventi_id_fk
      FOREIGN KEY (audit_evento_id)
      REFERENCES public.audit_eventi(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.movimenti
  VALIDATE CONSTRAINT movimenti_audit_evento_id_audit_eventi_id_fk;

CREATE INDEX IF NOT EXISTS movimenti_audit_evento_idx
  ON public.movimenti(audit_evento_id)
  WHERE audit_evento_id IS NOT NULL;
