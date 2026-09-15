-- M1C hardening: un iniziatore ancora referenziato richiede sempre lo snapshot.
-- Sono validi anche gli eventi di puro sistema e gli iniziatori storici rimossi.

ALTER TABLE public.audit_eventi
  DROP CONSTRAINT IF EXISTS audit_eventi_actor_consistency_check;

ALTER TABLE public.audit_eventi
  ADD CONSTRAINT audit_eventi_actor_consistency_check
  CHECK (
    (actor_type = 'user'
      AND initiated_by_user_id IS NULL
      AND initiated_by_code_snapshot IS NULL)
    OR (actor_type = 'system'
      AND actor_user_id IS NULL
      AND (initiated_by_user_id IS NULL
        OR initiated_by_code_snapshot IS NOT NULL))
  ) NOT VALID;

ALTER TABLE public.audit_eventi
  VALIDATE CONSTRAINT audit_eventi_actor_consistency_check;
