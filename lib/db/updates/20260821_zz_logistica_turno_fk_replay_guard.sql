-- Guard forward-only per il replay completo delle migration Logistica.
-- 20260819 può ricreare la FK CASCADE con il nome legacy; prima che la
-- riconciliazione 20260822 venga eseguita, questo aggiornamento converge tutte
-- le FK semanticamente equivalenti verso un solo vincolo RESTRICT canonico.

DO $logistica_turno_fk_replay_guard$
DECLARE
  semantic_count integer;
  restrict_count integer;
  canonical_count integer;
  semantic_fk record;
BEGIN
  IF to_regclass('public.turni') IS NULL
    OR to_regclass('public.turni_volontari') IS NULL
  THEN
    RAISE EXCEPTION 'Schema Logistica incompleto: turni e turni_volontari sono obbligatori';
  END IF;

  -- Il nome canonico può essere riutilizzato soltanto dal vincolo atteso.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.turni_volontari'::regclass
      AND c.conname = 'turni_volontari_turno_restrict_fk'
      AND NOT (
        c.contype = 'f'
        AND c.confrelid = 'public.turni'::regclass
        AND cardinality(c.conkey) = 1
        AND cardinality(c.confkey) = 1
        AND c.conkey[1] = (
          SELECT a.attnum
          FROM pg_attribute a
          WHERE a.attrelid = 'public.turni_volontari'::regclass
            AND a.attname = 'turno_id'
            AND NOT a.attisdropped
        )
        AND c.confkey[1] = (
          SELECT a.attnum
          FROM pg_attribute a
          WHERE a.attrelid = 'public.turni'::regclass
            AND a.attname = 'id'
            AND NOT a.attisdropped
        )
      )
  ) THEN
    RAISE EXCEPTION 'Il nome canonico turni_volontari_turno_restrict_fk è occupato da un constraint semanticamente diverso';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE c.confdeltype = 'r')::integer,
    count(*) FILTER (
      WHERE c.conname = 'turni_volontari_turno_restrict_fk'
    )::integer
  INTO semantic_count, restrict_count, canonical_count
  FROM pg_constraint c
  WHERE c.conrelid = 'public.turni_volontari'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'public.turni'::regclass
    AND cardinality(c.conkey) = 1
    AND cardinality(c.confkey) = 1
    AND c.conkey[1] = (
      SELECT a.attnum
      FROM pg_attribute a
      WHERE a.attrelid = 'public.turni_volontari'::regclass
        AND a.attname = 'turno_id'
        AND NOT a.attisdropped
    )
    AND c.confkey[1] = (
      SELECT a.attnum
      FROM pg_attribute a
      WHERE a.attrelid = 'public.turni'::regclass
        AND a.attname = 'id'
        AND NOT a.attisdropped
    );

  IF semantic_count <> 1 OR restrict_count <> 1 OR canonical_count <> 1 THEN
    FOR semantic_fk IN
      SELECT c.conname
      FROM pg_constraint c
      WHERE c.conrelid = 'public.turni_volontari'::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'public.turni'::regclass
        AND cardinality(c.conkey) = 1
        AND cardinality(c.confkey) = 1
        AND c.conkey[1] = (
          SELECT a.attnum
          FROM pg_attribute a
          WHERE a.attrelid = 'public.turni_volontari'::regclass
            AND a.attname = 'turno_id'
            AND NOT a.attisdropped
        )
        AND c.confkey[1] = (
          SELECT a.attnum
          FROM pg_attribute a
          WHERE a.attrelid = 'public.turni'::regclass
            AND a.attname = 'id'
            AND NOT a.attisdropped
        )
      ORDER BY c.conname
    LOOP
      EXECUTE format(
        'ALTER TABLE public.turni_volontari DROP CONSTRAINT %I',
        semantic_fk.conname
      );
    END LOOP;

    ALTER TABLE public.turni_volontari
      ADD CONSTRAINT turni_volontari_turno_restrict_fk
      FOREIGN KEY (turno_id) REFERENCES public.turni(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE c.confdeltype = 'r')::integer,
    count(*) FILTER (
      WHERE c.conname = 'turni_volontari_turno_restrict_fk'
    )::integer
  INTO semantic_count, restrict_count, canonical_count
  FROM pg_constraint c
  WHERE c.conrelid = 'public.turni_volontari'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'public.turni'::regclass
    AND cardinality(c.conkey) = 1
    AND cardinality(c.confkey) = 1
    AND c.conkey[1] = (
      SELECT a.attnum
      FROM pg_attribute a
      WHERE a.attrelid = 'public.turni_volontari'::regclass
        AND a.attname = 'turno_id'
        AND NOT a.attisdropped
    )
    AND c.confkey[1] = (
      SELECT a.attnum
      FROM pg_attribute a
      WHERE a.attrelid = 'public.turni'::regclass
        AND a.attname = 'id'
        AND NOT a.attisdropped
    );

  IF semantic_count <> 1 OR restrict_count <> 1 OR canonical_count <> 1 THEN
    RAISE EXCEPTION 'Normalizzazione FK turni_volontari.turno_id non riuscita';
  END IF;
END
$logistica_turno_fk_replay_guard$;
