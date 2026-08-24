-- Reporting 2.0 hardening: concorrenza, snapshot immutabili e territorio evento.
-- Additiva e idempotente. Nessun dato territoriale/FSE legacy viene ricostruito.

ALTER TABLE public.operazioni_distribuzione_magazzino
  ADD COLUMN IF NOT EXISTS area_operativa_id_snapshot integer,
  ADD COLUMN IF NOT EXISTS centro_ascolto_id_snapshot integer,
  ADD COLUMN IF NOT EXISTS territorio_classificazione varchar(30)
    NOT NULL DEFAULT 'legacy_sconosciuto';

CREATE INDEX IF NOT EXISTS operazioni_distribuzione_territorio_idx
  ON public.operazioni_distribuzione_magazzino
    (territorio_classificazione, area_operativa_id_snapshot,
     centro_ascolto_id_snapshot, data_distribuzione);

CREATE UNIQUE INDEX IF NOT EXISTS fse_fascicoli_snapshot_authoritative_version_uidx
  ON public.fse_fascicoli_sociali_snapshot (beneficiario_id, versione_profilo)
  WHERE origine_snapshot <> 'export_fse';

ALTER TABLE public.fse_fascicoli_sociali_snapshot
  DROP CONSTRAINT IF EXISTS fse_fascicoli_snapshot_demography_check;
ALTER TABLE public.fse_fascicoli_sociali_snapshot
  ADD CONSTRAINT fse_fascicoli_snapshot_demography_check CHECK (
    (numero_componenti IS NULL OR numero_componenti > 0)
    AND (donne IS NULL OR donne >= 0)
    AND (uomini IS NULL OR uomini >= 0)
    AND (eta_0_17 IS NULL OR eta_0_17 >= 0)
    AND (eta_18_29 IS NULL OR eta_18_29 >= 0)
    AND (eta_30_64 IS NULL OR eta_30_64 >= 0)
    AND (eta_65_plus IS NULL OR eta_65_plus >= 0)
    AND (numero_componenti IS NULL OR donne IS NULL OR uomini IS NULL
      OR donne + uomini = numero_componenti)
    AND (numero_componenti IS NULL OR eta_0_17 IS NULL OR eta_18_29 IS NULL
      OR eta_30_64 IS NULL OR eta_65_plus IS NULL
      OR eta_0_17 + eta_18_29 + eta_30_64 + eta_65_plus = numero_componenti)
  );

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bolle_numero_componenti_nucleo_snapshot_check') THEN
    ALTER TABLE public.bolle ADD CONSTRAINT bolle_numero_componenti_nucleo_snapshot_check
      CHECK (numero_componenti_nucleo_snapshot IS NULL OR numero_componenti_nucleo_snapshot > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'operazioni_distribuzione_territorio_check') THEN
    ALTER TABLE public.operazioni_distribuzione_magazzino
      ADD CONSTRAINT operazioni_distribuzione_territorio_check CHECK (
        (territorio_classificazione = 'attribuito' AND area_operativa_id_snapshot IS NOT NULL)
        OR (territorio_classificazione IN ('universale', 'legacy_sconosciuto')
          AND area_operativa_id_snapshot IS NULL AND centro_ascolto_id_snapshot IS NULL)
      );
  END IF;
END $$;

ALTER TABLE public.bolle DROP CONSTRAINT IF EXISTS bolle_area_snapshot_fk;
ALTER TABLE public.bolle ADD CONSTRAINT bolle_area_snapshot_fk FOREIGN KEY (area_operativa_id_snapshot) REFERENCES public.aree_operative(id) ON DELETE RESTRICT;
ALTER TABLE public.bolle DROP CONSTRAINT IF EXISTS bolle_centro_snapshot_fk;
ALTER TABLE public.bolle ADD CONSTRAINT bolle_centro_snapshot_fk FOREIGN KEY (centro_ascolto_id_snapshot) REFERENCES public.centri_di_ascolto(id) ON DELETE RESTRICT;
ALTER TABLE public.consegne DROP CONSTRAINT IF EXISTS consegne_area_snapshot_fk;
ALTER TABLE public.consegne ADD CONSTRAINT consegne_area_snapshot_fk FOREIGN KEY (area_operativa_id_snapshot) REFERENCES public.aree_operative(id) ON DELETE RESTRICT;
ALTER TABLE public.consegne DROP CONSTRAINT IF EXISTS consegne_centro_snapshot_fk;
ALTER TABLE public.consegne ADD CONSTRAINT consegne_centro_snapshot_fk FOREIGN KEY (centro_ascolto_id_snapshot) REFERENCES public.centri_di_ascolto(id) ON DELETE RESTRICT;
ALTER TABLE public.interventi DROP CONSTRAINT IF EXISTS interventi_area_snapshot_fk;
ALTER TABLE public.interventi ADD CONSTRAINT interventi_area_snapshot_fk FOREIGN KEY (area_operativa_id_snapshot) REFERENCES public.aree_operative(id) ON DELETE RESTRICT;
ALTER TABLE public.interventi DROP CONSTRAINT IF EXISTS interventi_centro_snapshot_fk;
ALTER TABLE public.interventi ADD CONSTRAINT interventi_centro_snapshot_fk FOREIGN KEY (centro_ascolto_id_snapshot) REFERENCES public.centri_di_ascolto(id) ON DELETE RESTRICT;
ALTER TABLE public.operazioni_distribuzione_magazzino DROP CONSTRAINT IF EXISTS operazioni_distribuzione_area_snapshot_fk;
ALTER TABLE public.operazioni_distribuzione_magazzino ADD CONSTRAINT operazioni_distribuzione_area_snapshot_fk FOREIGN KEY (area_operativa_id_snapshot) REFERENCES public.aree_operative(id) ON DELETE RESTRICT;
ALTER TABLE public.operazioni_distribuzione_magazzino DROP CONSTRAINT IF EXISTS operazioni_distribuzione_centro_snapshot_fk;
ALTER TABLE public.operazioni_distribuzione_magazzino ADD CONSTRAINT operazioni_distribuzione_centro_snapshot_fk FOREIGN KEY (centro_ascolto_id_snapshot) REFERENCES public.centri_di_ascolto(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.reject_reporting_snapshot_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'bolle' THEN
    IF (OLD.area_operativa_id_snapshot IS NOT NULL AND NEW.area_operativa_id_snapshot IS DISTINCT FROM OLD.area_operativa_id_snapshot)
      OR (OLD.centro_ascolto_id_snapshot IS NOT NULL AND NEW.centro_ascolto_id_snapshot IS DISTINCT FROM OLD.centro_ascolto_id_snapshot)
      OR (OLD.numero_componenti_nucleo_snapshot IS NOT NULL AND NEW.numero_componenti_nucleo_snapshot IS DISTINCT FROM OLD.numero_componenti_nucleo_snapshot) THEN
      RAISE EXCEPTION 'REPORTING_SNAPSHOT_IMMUTABILE: bolle' USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'consegne' OR TG_TABLE_NAME = 'interventi' THEN
    IF (OLD.area_operativa_id_snapshot IS NOT NULL AND NEW.area_operativa_id_snapshot IS DISTINCT FROM OLD.area_operativa_id_snapshot)
      OR (OLD.centro_ascolto_id_snapshot IS NOT NULL AND NEW.centro_ascolto_id_snapshot IS DISTINCT FROM OLD.centro_ascolto_id_snapshot) THEN
      RAISE EXCEPTION 'REPORTING_SNAPSHOT_IMMUTABILE: %', TG_TABLE_NAME USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'operazioni_distribuzione_magazzino' THEN
    IF (OLD.area_operativa_id_snapshot IS NOT NULL AND NEW.area_operativa_id_snapshot IS DISTINCT FROM OLD.area_operativa_id_snapshot)
      OR (OLD.centro_ascolto_id_snapshot IS NOT NULL AND NEW.centro_ascolto_id_snapshot IS DISTINCT FROM OLD.centro_ascolto_id_snapshot)
      OR (
        NEW.territorio_classificazione IS DISTINCT FROM OLD.territorio_classificazione
        AND NOT (
          OLD.territorio_classificazione = 'legacy_sconosciuto'
          AND OLD.area_operativa_id_snapshot IS NULL
          AND OLD.centro_ascolto_id_snapshot IS NULL
          AND NEW.territorio_classificazione = 'attribuito'
          AND NEW.area_operativa_id_snapshot IS NOT NULL
        )
      ) THEN
      RAISE EXCEPTION 'REPORTING_SNAPSHOT_IMMUTABILE: operazioni_distribuzione_magazzino' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bolle_reporting_snapshot_immutable ON public.bolle;
CREATE TRIGGER bolle_reporting_snapshot_immutable BEFORE UPDATE ON public.bolle FOR EACH ROW EXECUTE FUNCTION public.reject_reporting_snapshot_rewrite();
DROP TRIGGER IF EXISTS consegne_reporting_snapshot_immutable ON public.consegne;
CREATE TRIGGER consegne_reporting_snapshot_immutable BEFORE UPDATE ON public.consegne FOR EACH ROW EXECUTE FUNCTION public.reject_reporting_snapshot_rewrite();
DROP TRIGGER IF EXISTS interventi_reporting_snapshot_immutable ON public.interventi;
CREATE TRIGGER interventi_reporting_snapshot_immutable BEFORE UPDATE ON public.interventi FOR EACH ROW EXECUTE FUNCTION public.reject_reporting_snapshot_rewrite();
DROP TRIGGER IF EXISTS operazioni_distribuzione_reporting_snapshot_immutable ON public.operazioni_distribuzione_magazzino;
CREATE TRIGGER operazioni_distribuzione_reporting_snapshot_immutable BEFORE UPDATE ON public.operazioni_distribuzione_magazzino FOR EACH ROW EXECUTE FUNCTION public.reject_reporting_snapshot_rewrite();
