-- Every warehouse belongs to an Area. A nullable Centre still means shared
-- within that Area; a nullable Area must never imply global visibility.
-- No inferred assignment, deletion or stock change is permitted here.
-- The canonical runner executes this migration and its ledger entry atomically.
LOCK TABLE magazzini IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE invalid_count bigint;
BEGIN
  SELECT count(*) INTO invalid_count FROM magazzini WHERE area_operativa_id IS NULL;
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'MAGAZZINI_AREA_REQUIRED: % magazzini senza Area Operativa', invalid_count
      USING ERRCODE = '23502',
        HINT = 'Riconciliare esplicitamente le Aree dei magazzini prima di ripetere la migration. Nessun backfill automatico.';
  END IF;
END $$;
ALTER TABLE magazzini ALTER COLUMN area_operativa_id SET NOT NULL;
