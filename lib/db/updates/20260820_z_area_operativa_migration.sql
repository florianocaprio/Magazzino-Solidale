-- Rename atomico del confine organizzativo "citta" in "area_operativa".
-- Lo script e idempotente: ogni coppia old/new ammette soltanto uno dei due nomi.

DO $$
DECLARE
  old_exists boolean := to_regclass('public.citta') IS NOT NULL;
  new_exists boolean := to_regclass('public.aree_operative') IS NOT NULL;
BEGIN
  IF old_exists AND new_exists THEN
    RAISE EXCEPTION 'Split-brain: esistono entrambe public.citta e public.aree_operative';
  ELSIF NOT old_exists AND NOT new_exists THEN
    RAISE EXCEPTION 'Schema inatteso: non esistono ne public.citta ne public.aree_operative';
  ELSIF old_exists THEN
    ALTER TABLE public.citta RENAME TO aree_operative;
  END IF;
END $$;

DO $$
DECLARE
  target_table text;
  old_exists boolean;
  new_exists boolean;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'utenti',
    'beneficiari',
    'centri_di_ascolto',
    'magazzini',
    'zone_uds',
    'fornitori',
    'mense',
    'mensa_eccezioni',
    'politiche_credito_solidale',
    'credito_solidale_movimenti',
    'sessioni_cassa_emporio',
    'spese_emporio'
  ]
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND information_schema.columns.table_name = target_table
        AND column_name = 'citta_id'
    ) INTO old_exists;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND information_schema.columns.table_name = target_table
        AND column_name = 'area_operativa_id'
    ) INTO new_exists;

    IF old_exists AND new_exists THEN
      RAISE EXCEPTION 'Split-brain: %.citta_id e %.area_operativa_id esistono entrambe', target_table, target_table;
    ELSIF NOT old_exists AND NOT new_exists THEN
      RAISE EXCEPTION 'Schema inatteso: %.citta_id e %.area_operativa_id sono entrambe assenti', target_table, target_table;
    ELSIF old_exists THEN
      EXECUTE format(
        'ALTER TABLE public.%I RENAME COLUMN citta_id TO area_operativa_id',
        target_table
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  old_exists boolean := to_regclass('public.citta_id_seq') IS NOT NULL;
  new_exists boolean := to_regclass('public.aree_operative_id_seq') IS NOT NULL;
BEGIN
  IF old_exists AND new_exists THEN
    RAISE EXCEPTION 'Split-brain: esistono entrambe citta_id_seq e aree_operative_id_seq';
  ELSIF NOT old_exists AND NOT new_exists THEN
    RAISE EXCEPTION 'Schema inatteso: non esistono ne citta_id_seq ne aree_operative_id_seq';
  ELSIF old_exists THEN
    ALTER SEQUENCE public.citta_id_seq RENAME TO aree_operative_id_seq;
  END IF;
END $$;

DO $$
DECLARE
  old_exists boolean;
  new_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.aree_operative'::regclass
      AND c.conname = 'citta_pkey'
  ) INTO old_exists;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.aree_operative'::regclass
      AND c.conname = 'aree_operative_pkey'
  ) INTO new_exists;

  IF old_exists AND new_exists THEN
    RAISE EXCEPTION 'Split-brain: constraint citta_pkey e aree_operative_pkey esistono entrambe su aree_operative';
  ELSIF NOT old_exists AND NOT new_exists THEN
    RAISE EXCEPTION 'Schema inatteso: constraint citta_pkey e aree_operative_pkey sono entrambe assenti su aree_operative';
  ELSIF old_exists THEN
    ALTER TABLE public.aree_operative RENAME CONSTRAINT citta_pkey TO aree_operative_pkey;
  END IF;
END $$;

DO $$
DECLARE
  object_table text;
  canonical_name text;
  semantic_count integer;
  semantic_oid oid;
  semantic_name text;
  canonical_oid oid;
  item text[];
BEGIN
  FOREACH item SLICE 1 IN ARRAY ARRAY[
    ARRAY['utenti', 'utenti_area_operativa_id_fk'],
    ARRAY['beneficiari', 'beneficiari_area_operativa_id_fk'],
    ARRAY['centri_di_ascolto', 'centri_di_ascolto_area_operativa_id_fk'],
    ARRAY['magazzini', 'magazzini_area_operativa_id_fk'],
    ARRAY['zone_uds', 'zone_uds_area_operativa_id_fk'],
    ARRAY['mense', 'mense_area_operativa_id_fkey'],
    ARRAY['mensa_eccezioni', 'mensa_eccezioni_area_operativa_id_fkey'],
    ARRAY['politiche_credito_solidale', 'politiche_credito_solidale_area_operativa_id_fk'],
    ARRAY['credito_solidale_movimenti', 'credito_solidale_movimenti_area_operativa_id_fk'],
    ARRAY['sessioni_cassa_emporio', 'sessioni_cassa_emporio_area_operativa_id_fk'],
    ARRAY['spese_emporio', 'spese_emporio_area_operativa_id_fk']
  ]
  LOOP
    object_table := item[1];
    canonical_name := item[2];

    SELECT
      count(*)::integer,
      (array_agg(c.oid ORDER BY c.oid))[1],
      (array_agg(c.conname ORDER BY c.oid))[1]
    INTO semantic_count, semantic_oid, semantic_name
    FROM pg_constraint c
    JOIN pg_class source_table ON source_table.oid = c.conrelid
    JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
    JOIN pg_attribute source_column
      ON source_column.attrelid = c.conrelid
      AND source_column.attnum = c.conkey[1]
    JOIN pg_attribute referenced_column
      ON referenced_column.attrelid = c.confrelid
      AND referenced_column.attnum = c.confkey[1]
    WHERE c.contype = 'f'
      AND source_namespace.nspname = 'public'
      AND source_table.relname = object_table
      AND source_column.attname = 'area_operativa_id'
      AND c.confrelid = 'public.aree_operative'::regclass
      AND referenced_column.attname = 'id'
      AND cardinality(c.conkey) = 1
      AND cardinality(c.confkey) = 1;

    IF semantic_count = 0 THEN
      RAISE EXCEPTION 'Schema inatteso: nessuna FK semantica %.area_operativa_id -> public.aree_operative.id', object_table;
    ELSIF semantic_count > 1 THEN
      RAISE EXCEPTION 'Split-brain: % FK semantiche %.area_operativa_id -> public.aree_operative.id', semantic_count, object_table;
    END IF;

    canonical_oid := NULL;
    SELECT c.oid
    INTO canonical_oid
    FROM pg_constraint c
    WHERE c.conrelid = format('public.%I', object_table)::regclass
      AND c.conname = canonical_name;

    IF canonical_oid IS NOT NULL AND canonical_oid <> semantic_oid THEN
      RAISE EXCEPTION 'Conflitto: il nome canonico % su % e occupato da un constraint diverso', canonical_name, object_table;
    ELSIF semantic_name <> canonical_name THEN
      EXECUTE format(
        'ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I',
        object_table,
        semantic_name,
        canonical_name
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  old_exists boolean := to_regclass('public.mense_citta_idx') IS NOT NULL;
  new_exists boolean := to_regclass('public.mense_area_operativa_idx') IS NOT NULL;
BEGIN
  IF old_exists AND new_exists THEN
    RAISE EXCEPTION 'Split-brain: esistono entrambi gli indici mense_citta_idx e mense_area_operativa_idx';
  ELSIF NOT old_exists AND NOT new_exists THEN
    RAISE EXCEPTION 'Schema inatteso: non esistono ne mense_citta_idx ne mense_area_operativa_idx';
  ELSIF old_exists THEN
    ALTER INDEX public.mense_citta_idx RENAME TO mense_area_operativa_idx;
  END IF;
END $$;

DO $$
DECLARE
  legacy_objects text;
BEGIN
  SELECT string_agg(format('%s:%s', object_type, object_name), ', ' ORDER BY object_type, object_name)
  INTO legacy_objects
  FROM (
    SELECT 'relation' AS object_type, c.relname AS object_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname ILIKE '%citta%'
    UNION ALL
    SELECT 'constraint', c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND c.conname ILIKE '%citta%'
  ) legacy;

  IF legacy_objects IS NOT NULL THEN
    RAISE EXCEPTION 'Oggetti PostgreSQL legacy residui dopo la migrazione: %', legacy_objects;
  END IF;
END $$;
