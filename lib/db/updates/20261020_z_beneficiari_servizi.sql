-- Explicit optional policy selection; NULL retains the territorial default.
ALTER TABLE beneficiari ADD COLUMN IF NOT EXISTS politica_credito_solidale_id integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='beneficiari_politica_credito_fk' AND conrelid='beneficiari'::regclass) THEN
    ALTER TABLE beneficiari ADD CONSTRAINT beneficiari_politica_credito_fk
      FOREIGN KEY (politica_credito_solidale_id) REFERENCES politiche_credito_solidale(id);
  END IF;
END $$;

-- Repair only known, active territorial references and accepted FSE dossiers.
-- No inferred birth dates/sex, invented household members, balances or movements.
WITH eligible AS (
  SELECT b.id, coalesce(b.area_operativa_id, c.area_operativa_id) AS area_id,
    b.area_operativa_id IS NULL AS repair_area,
    b.stato_anagrafica = 'provvisoria' AND NOT b.uds AND
      EXISTS (SELECT 1 FROM fse_fascicoli_sociali f WHERE f.beneficiario_id=b.id
        AND f.origine_fascicolo='import_fse' AND f.codice_fascicolo_normalizzato IS NOT NULL)
      AS accept_fse,
    b.attivo AND NOT b.credito_solidale_abilitato
      AND b.credito_solidale_stato='non_abilitato'
      AND b.credito_solidale_data_abilitazione IS NULL
      AND EXISTS (SELECT 1 FROM emporio_abilitazioni e WHERE e.beneficiario_id=b.id
        AND e.area_operativa_id=coalesce(b.area_operativa_id,c.area_operativa_id)
        AND e.stato='attivo' AND e.data_effetto<=now()) AS enable_credit
  FROM beneficiari b
  JOIN centri_di_ascolto c ON c.id=b.centro_ascolto_id AND c.attivo
  JOIN aree_operative a ON a.id=coalesce(b.area_operativa_id,c.area_operativa_id)
    AND a.attivo AND c.area_operativa_id=a.id
  WHERE b.area_operativa_id IS NOT NULL OR b.zona_uds_id IS NULL
)
UPDATE beneficiari b SET
  area_operativa_id=e.area_id,
  stato_anagrafica=CASE WHEN e.accept_fse THEN 'completa' ELSE b.stato_anagrafica END,
  credito_solidale_abilitato=CASE WHEN e.enable_credit THEN true ELSE b.credito_solidale_abilitato END,
  credito_solidale_stato=CASE WHEN e.enable_credit THEN 'attivo' ELSE b.credito_solidale_stato END,
  credito_solidale_data_abilitazione=CASE WHEN e.enable_credit THEN now() ELSE b.credito_solidale_data_abilitazione END,
  versione=b.versione+1, data_aggiornamento=now()
FROM eligible e WHERE b.id=e.id AND (e.repair_area OR e.accept_fse OR e.enable_credit);
