-- Rollback manuale e simmetrico della migrazione Area Operativa.
-- NON viene eseguito da apply-updates.mjs perché vive fuori da updates/.

DO $$
DECLARE
  object_table text;
  new_name text;
  old_name text;
  new_exists boolean;
  old_exists boolean;
  item text[];
BEGIN
  FOREACH item SLICE 1 IN ARRAY ARRAY[
    ARRAY['aree_operative', 'aree_operative_pkey', 'citta_pkey'],
    ARRAY['utenti', 'utenti_area_operativa_id_fk', 'utenti_citta_id_citta_id_fk'],
    ARRAY['beneficiari', 'beneficiari_area_operativa_id_fk', 'beneficiari_citta_id_citta_id_fk'],
    ARRAY['centri_di_ascolto', 'centri_di_ascolto_area_operativa_id_fk', 'centri_di_ascolto_citta_id_citta_id_fk'],
    ARRAY['magazzini', 'magazzini_area_operativa_id_fk', 'magazzini_citta_id_citta_id_fk'],
    ARRAY['zone_uds', 'zone_uds_area_operativa_id_fk', 'zone_uds_citta_id_citta_id_fk'],
    ARRAY['mense', 'mense_area_operativa_id_fkey', 'mense_citta_id_fkey'],
    ARRAY['mensa_eccezioni', 'mensa_eccezioni_area_operativa_id_fkey', 'mensa_eccezioni_citta_id_fkey'],
    ARRAY['politiche_credito_solidale', 'politiche_credito_solidale_area_operativa_id_fk', 'politiche_credito_solidale_citta_id_citta_id_fk'],
    ARRAY['credito_solidale_movimenti', 'credito_solidale_movimenti_area_operativa_id_fk', 'credito_solidale_movimenti_citta_id_citta_id_fk'],
    ARRAY['sessioni_cassa_emporio', 'sessioni_cassa_emporio_area_operativa_id_fk', 'sessioni_cassa_emporio_citta_id_citta_id_fk'],
    ARRAY['spese_emporio', 'spese_emporio_area_operativa_id_fk', 'spese_emporio_citta_id_citta_id_fk']
  ]
  LOOP
    object_table := item[1];
    new_name := item[2];
    old_name := item[3];
    IF object_table = 'aree_operative'
      AND to_regclass('public.aree_operative') IS NULL
      AND to_regclass('public.citta') IS NOT NULL
    THEN
      object_table := 'citta';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = object_table AND c.conname = new_name
    ) INTO new_exists;
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = object_table AND c.conname = old_name
    ) INTO old_exists;
    IF new_exists AND old_exists THEN
      RAISE EXCEPTION 'Split-brain rollback: constraint % e % esistono entrambe su %', new_name, old_name, object_table;
    ELSIF NOT new_exists AND NOT old_exists THEN
      RAISE EXCEPTION 'Schema inatteso rollback: constraint % e % assenti su %', new_name, old_name, object_table;
    ELSIF new_exists THEN
      EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', object_table, new_name, old_name);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  new_exists boolean := to_regclass('public.mense_area_operativa_idx') IS NOT NULL;
  old_exists boolean := to_regclass('public.mense_citta_idx') IS NOT NULL;
BEGIN
  IF new_exists AND old_exists THEN
    RAISE EXCEPTION 'Split-brain rollback: entrambi gli indici Mensa esistono';
  ELSIF NOT new_exists AND NOT old_exists THEN
    RAISE EXCEPTION 'Schema inatteso rollback: entrambi gli indici Mensa sono assenti';
  ELSIF new_exists THEN
    ALTER INDEX public.mense_area_operativa_idx RENAME TO mense_citta_idx;
  END IF;
END $$;

DO $$
DECLARE
  new_exists boolean := to_regclass('public.aree_operative_id_seq') IS NOT NULL;
  old_exists boolean := to_regclass('public.citta_id_seq') IS NOT NULL;
BEGIN
  IF new_exists AND old_exists THEN
    RAISE EXCEPTION 'Split-brain rollback: entrambe le sequence esistono';
  ELSIF NOT new_exists AND NOT old_exists THEN
    RAISE EXCEPTION 'Schema inatteso rollback: entrambe le sequence sono assenti';
  ELSIF new_exists THEN
    ALTER SEQUENCE public.aree_operative_id_seq RENAME TO citta_id_seq;
  END IF;
END $$;

DO $$
DECLARE
  target_table text;
  new_exists boolean;
  old_exists boolean;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'utenti', 'beneficiari', 'centri_di_ascolto', 'magazzini', 'zone_uds',
    'fornitori', 'mense', 'mensa_eccezioni', 'politiche_credito_solidale',
    'credito_solidale_movimenti', 'sessioni_cassa_emporio', 'spese_emporio'
  ]
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target_table
        AND column_name = 'area_operativa_id'
    ) INTO new_exists;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target_table
        AND column_name = 'citta_id'
    ) INTO old_exists;
    IF new_exists AND old_exists THEN
      RAISE EXCEPTION 'Split-brain rollback: %.area_operativa_id e %.citta_id esistono entrambe', target_table, target_table;
    ELSIF NOT new_exists AND NOT old_exists THEN
      RAISE EXCEPTION 'Schema inatteso rollback: colonne Area Operativa assenti su %', target_table;
    ELSIF new_exists THEN
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN area_operativa_id TO citta_id', target_table);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  new_exists boolean := to_regclass('public.aree_operative') IS NOT NULL;
  old_exists boolean := to_regclass('public.citta') IS NOT NULL;
BEGIN
  IF new_exists AND old_exists THEN
    RAISE EXCEPTION 'Split-brain rollback: entrambe le tabelle esistono';
  ELSIF NOT new_exists AND NOT old_exists THEN
    RAISE EXCEPTION 'Schema inatteso rollback: entrambe le tabelle sono assenti';
  ELSIF new_exists THEN
    ALTER TABLE public.aree_operative RENAME TO citta;
  END IF;
END $$;
