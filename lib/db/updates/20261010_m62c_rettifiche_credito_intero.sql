-- M6.2-C: no conversion, rounding, backfill or rewriting of economic history.
ALTER TABLE public.spese_emporio_storni ADD COLUMN IF NOT EXISTS tipo_rettifica varchar(40) NOT NULL DEFAULT 'legacy_storno';
ALTER TABLE public.spese_emporio_storni DROP CONSTRAINT IF EXISTS spese_emporio_storni_credito_check;
ALTER TABLE public.spese_emporio_storni ADD CONSTRAINT spese_emporio_storni_credito_check CHECK (credito_restituito >= 0);
ALTER TABLE public.spese_emporio_storni_righe DROP CONSTRAINT IF EXISTS spese_emporio_storni_righe_credito_check;
ALTER TABLE public.spese_emporio_storni_righe ADD CONSTRAINT spese_emporio_storni_righe_credito_check CHECK (credito_restituito >= 0);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.spese_emporio_storni'::regclass AND conname='spese_emporio_storni_tipo_check') THEN
    ALTER TABLE public.spese_emporio_storni ADD CONSTRAINT spese_emporio_storni_tipo_check CHECK (tipo_rettifica IN ('legacy_storno','reso_idoneo','reso_non_distribuibile','errore_amministrativo','solo_credito'));
  END IF;
END $$;

-- Guard only NEW/CHANGED credit fields: legacy fractions remain readable and
-- unrelated registry updates remain possible. The API validates BEFORE numeric
-- storage conversion; this trigger validates the value PostgreSQL actually stores.
CREATE OR REPLACE FUNCTION public.m62c_credito_intero_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field text; value numeric; before jsonb;
BEGIN
  IF TG_OP='UPDATE' THEN before=to_jsonb(OLD); END IF;
  FOREACH field IN ARRAY TG_ARGV LOOP
    IF TG_OP='UPDATE' AND to_jsonb(NEW)->field IS NOT DISTINCT FROM before->field THEN CONTINUE; END IF;
    value=(to_jsonb(NEW)->>field)::numeric;
    IF value IS NOT NULL AND (value <> trunc(value) OR abs(value)>99999999 OR value::text IN ('NaN','Infinity','-Infinity')) THEN
      RAISE EXCEPTION 'Credito Solidale intero richiesto: %.%', TG_TABLE_NAME, field USING ERRCODE='23514';
    END IF;
    IF value IS NOT NULL AND field NOT IN ('variazione_credito','credito_residuo_previsto') AND value<0 THEN
      RAISE EXCEPTION 'Credito negativo non ammesso: %.%', TG_TABLE_NAME, field USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='credito_solidale_movimenti' AND field='variazione_credito' AND value=0 THEN
      RAISE EXCEPTION 'Movimento credito nullo non ammesso' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
DO $$ DECLARE spec record; args text; BEGIN
  FOR spec IN SELECT * FROM jsonb_each('{
    "beneficiari":["credito_solidale_saldo","credito_solidale_mensile_assegnato"],
    "prodotti":["credito_solidale_valore"],
    "credito_solidale_movimenti":["variazione_credito","saldo_prima","saldo_dopo","quota_mensile_assegnata"],
    "sessioni_cassa_emporio":["saldo_credito_iniziale","totale_credito_previsto","credito_residuo_previsto"],
    "sessioni_cassa_emporio_righe":["credito_unitario","credito_totale"],
    "spese_emporio":["totale_credito_consumati","saldo_prima","saldo_dopo"],
    "spese_emporio_righe":["credito_unitario","credito_totale"],
    "spese_emporio_storni":["credito_restituito"],
    "spese_emporio_storni_righe":["credito_restituito"],
    "politiche_credito_solidale":["credito_base_nucleo","credito_per_componente","bonus_minore","bonus_anziano","bonus_disabile","credito_minimo_mensile","credito_massimo_mensile"]
  }'::jsonb) LOOP
    SELECT string_agg(quote_literal(value),',') INTO args FROM jsonb_array_elements_text(spec.value);
    EXECUTE format('DROP TRIGGER IF EXISTS m62c_credito_intero ON public.%I',spec.key);
    EXECUTE format('CREATE TRIGGER m62c_credito_intero BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.m62c_credito_intero_guard(%s)',spec.key,args);
  END LOOP;
END $$;
