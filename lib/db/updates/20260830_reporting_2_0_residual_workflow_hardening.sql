-- Reporting 2.0 residual workflow hardening.
-- Additiva e idempotente: nessun backfill o aggiornamento di eventi legacy.

CREATE OR REPLACE FUNCTION public.enforce_reporting_snapshot_center_area()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.centro_ascolto_id_snapshot IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.centri_di_ascolto centro
    WHERE centro.id = NEW.centro_ascolto_id_snapshot
      AND centro.area_operativa_id = NEW.area_operativa_id_snapshot
  ) THEN
    RAISE EXCEPTION 'REPORTING_SNAPSHOT_AREA_CENTRO_INCOERENTE: %', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bolle_reporting_snapshot_center_area ON public.bolle;
CREATE TRIGGER bolle_reporting_snapshot_center_area
  BEFORE INSERT OR UPDATE OF area_operativa_id_snapshot, centro_ascolto_id_snapshot
  ON public.bolle FOR EACH ROW
  EXECUTE FUNCTION public.enforce_reporting_snapshot_center_area();

DROP TRIGGER IF EXISTS consegne_reporting_snapshot_center_area ON public.consegne;
CREATE TRIGGER consegne_reporting_snapshot_center_area
  BEFORE INSERT OR UPDATE OF area_operativa_id_snapshot, centro_ascolto_id_snapshot
  ON public.consegne FOR EACH ROW
  EXECUTE FUNCTION public.enforce_reporting_snapshot_center_area();

DROP TRIGGER IF EXISTS interventi_reporting_snapshot_center_area ON public.interventi;
CREATE TRIGGER interventi_reporting_snapshot_center_area
  BEFORE INSERT OR UPDATE OF area_operativa_id_snapshot, centro_ascolto_id_snapshot
  ON public.interventi FOR EACH ROW
  EXECUTE FUNCTION public.enforce_reporting_snapshot_center_area();

DROP TRIGGER IF EXISTS operazioni_distribuzione_reporting_snapshot_center_area
  ON public.operazioni_distribuzione_magazzino;
CREATE TRIGGER operazioni_distribuzione_reporting_snapshot_center_area
  BEFORE INSERT OR UPDATE OF area_operativa_id_snapshot, centro_ascolto_id_snapshot
  ON public.operazioni_distribuzione_magazzino FOR EACH ROW
  EXECUTE FUNCTION public.enforce_reporting_snapshot_center_area();

CREATE OR REPLACE FUNCTION public.reject_distribution_statistics_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.numero_pacchi IS NOT NULL AND NEW.numero_pacchi IS DISTINCT FROM OLD.numero_pacchi)
    OR (OLD.numero_pasti IS NOT NULL AND NEW.numero_pasti IS DISTINCT FROM OLD.numero_pasti)
    OR (OLD.indigenti_saltuari IS NOT NULL AND NEW.indigenti_saltuari IS DISTINCT FROM OLD.indigenti_saltuari)
    OR (OLD.indigenti_continuativi IS NOT NULL AND NEW.indigenti_continuativi IS DISTINCT FROM OLD.indigenti_continuativi) THEN
    RAISE EXCEPTION 'STATISTICA_DISTRIBUZIONE_IMMUTABILE: operazioni_distribuzione_magazzino'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS operazioni_distribuzione_statistics_immutable
  ON public.operazioni_distribuzione_magazzino;
CREATE TRIGGER operazioni_distribuzione_statistics_immutable
  BEFORE UPDATE OF numero_pacchi, numero_pasti,
    indigenti_saltuari, indigenti_continuativi
  ON public.operazioni_distribuzione_magazzino FOR EACH ROW
  EXECUTE FUNCTION public.reject_distribution_statistics_rewrite();
