-- Hardening conservativo Centro di Ascolto / Interventi Sociali.
-- La preflight interrompe l'aggiornamento senza modificare dati se rileva
-- riferimenti orfani o duplicati incompatibili con i nuovi vincoli.

DO $update$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.interventi i
    LEFT JOIN public.beneficiari b ON b.id = i.beneficiario_id
    WHERE b.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: interventi.beneficiario_id contiene riferimenti orfani';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.interventi i
    LEFT JOIN public.bolle b ON b.id = i.bolla_id
    WHERE i.bolla_id IS NOT NULL AND b.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: interventi.bolla_id contiene riferimenti orfani';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.turni t
    LEFT JOIN public.centri_di_ascolto c ON c.id = t.centro_ascolto_id
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: turni.centro_ascolto_id contiene riferimenti orfani';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.turni t
    LEFT JOIN public.mezzi m ON m.id = t.mezzo_id
    WHERE t.mezzo_id IS NOT NULL AND m.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: turni.mezzo_id contiene riferimenti orfani';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.turni_volontari tv
    LEFT JOIN public.turni t ON t.id = tv.turno_id
    WHERE t.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: turni_volontari.turno_id contiene riferimenti orfani';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.turni_volontari tv
    LEFT JOIN public.volontari v ON v.id = tv.volontario_id
    WHERE v.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: turni_volontari.volontario_id contiene riferimenti orfani';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.turni
    GROUP BY centro_ascolto_id, data, fascia HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: slot turno Centro/Area duplicati';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.turni
    WHERE mezzo_id IS NOT NULL
    GROUP BY mezzo_id, data, fascia HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: mezzo assegnato più volte nello stesso slot';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.turni_volontari
    GROUP BY turno_id, volontario_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: volontario duplicato nello stesso turno';
  END IF;
END
$update$;

DO $update$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interventi_beneficiario_fk') THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_beneficiario_fk
      FOREIGN KEY (beneficiario_id) REFERENCES public.beneficiari(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interventi_bolla_fk') THEN
    ALTER TABLE public.interventi
      ADD CONSTRAINT interventi_bolla_fk
      FOREIGN KEY (bolla_id) REFERENCES public.bolle(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'turni_centro_ascolto_fk') THEN
    ALTER TABLE public.turni
      ADD CONSTRAINT turni_centro_ascolto_fk
      FOREIGN KEY (centro_ascolto_id) REFERENCES public.centri_di_ascolto(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'turni_mezzo_fk') THEN
    ALTER TABLE public.turni
      ADD CONSTRAINT turni_mezzo_fk
      FOREIGN KEY (mezzo_id) REFERENCES public.mezzi(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'turni_volontari_turno_fk') THEN
    ALTER TABLE public.turni_volontari
      ADD CONSTRAINT turni_volontari_turno_fk
      FOREIGN KEY (turno_id) REFERENCES public.turni(id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'turni_volontari_volontario_fk') THEN
    ALTER TABLE public.turni_volontari
      ADD CONSTRAINT turni_volontari_volontario_fk
      FOREIGN KEY (volontario_id) REFERENCES public.volontari(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END
$update$;

ALTER TABLE public.interventi VALIDATE CONSTRAINT interventi_beneficiario_fk;
ALTER TABLE public.interventi VALIDATE CONSTRAINT interventi_bolla_fk;
ALTER TABLE public.turni VALIDATE CONSTRAINT turni_centro_ascolto_fk;
ALTER TABLE public.turni VALIDATE CONSTRAINT turni_mezzo_fk;
ALTER TABLE public.turni_volontari VALIDATE CONSTRAINT turni_volontari_turno_fk;
ALTER TABLE public.turni_volontari VALIDATE CONSTRAINT turni_volontari_volontario_fk;

CREATE UNIQUE INDEX IF NOT EXISTS turni_centro_data_fascia_unique
  ON public.turni (centro_ascolto_id, data, fascia);
CREATE UNIQUE INDEX IF NOT EXISTS turni_mezzo_data_fascia_unique
  ON public.turni (mezzo_id, data, fascia)
  WHERE mezzo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS turni_volontari_turno_volontario_unique
  ON public.turni_volontari (turno_id, volontario_id);
