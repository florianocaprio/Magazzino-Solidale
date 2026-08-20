-- Hardening conservativo Centro di Ascolto / Interventi Sociali.
-- Le FK NOT VALID proteggono immediatamente nuove INSERT/UPDATE senza
-- cancellare i riferimenti orfani legacy. Ogni FK viene validata appena i dati
-- storici della relativa relazione risultano coerenti.

-- Gli indici univoci non possono convivere con duplicati preesistenti: questo
-- preflight resta bloccante e precede qualsiasi modifica allo schema.
DO $update$
BEGIN
  IF EXISTS (
    SELECT 1 FROM turni
    GROUP BY centro_ascolto_id, data, fascia HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: slot turno Centro/Area duplicati';
  END IF;

  IF EXISTS (
    SELECT 1 FROM turni
    WHERE mezzo_id IS NOT NULL
    GROUP BY mezzo_id, data, fascia HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: mezzo assegnato più volte nello stesso slot';
  END IF;

  IF EXISTS (
    SELECT 1 FROM turni_volontari
    GROUP BY turno_id, volontario_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight fallita: volontario duplicato nello stesso turno';
  END IF;
END
$update$;

DO $update$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interventi_beneficiario_fk'
      AND conrelid = 'interventi'::regclass
  ) THEN
    ALTER TABLE interventi
      ADD CONSTRAINT interventi_beneficiario_fk
      FOREIGN KEY (beneficiario_id) REFERENCES beneficiari(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interventi_bolla_fk'
      AND conrelid = 'interventi'::regclass
  ) THEN
    ALTER TABLE interventi
      ADD CONSTRAINT interventi_bolla_fk
      FOREIGN KEY (bolla_id) REFERENCES bolle(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turni_centro_ascolto_fk'
      AND conrelid = 'turni'::regclass
  ) THEN
    ALTER TABLE turni
      ADD CONSTRAINT turni_centro_ascolto_fk
      FOREIGN KEY (centro_ascolto_id) REFERENCES centri_di_ascolto(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turni_mezzo_fk'
      AND conrelid = 'turni'::regclass
  ) THEN
    ALTER TABLE turni
      ADD CONSTRAINT turni_mezzo_fk
      FOREIGN KEY (mezzo_id) REFERENCES mezzi(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turni_volontari_turno_fk'
      AND conrelid = 'turni_volontari'::regclass
  ) THEN
    ALTER TABLE turni_volontari
      ADD CONSTRAINT turni_volontari_turno_fk
      FOREIGN KEY (turno_id) REFERENCES turni(id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turni_volontari_volontario_fk'
      AND conrelid = 'turni_volontari'::regclass
  ) THEN
    ALTER TABLE turni_volontari
      ADD CONSTRAINT turni_volontari_volontario_fk
      FOREIGN KEY (volontario_id) REFERENCES volontari(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END
$update$;

DO $update$
BEGIN
  IF EXISTS (
    SELECT 1 FROM interventi i
    LEFT JOIN beneficiari b ON b.id = i.beneficiario_id
    WHERE b.id IS NULL
  ) THEN
    RAISE NOTICE 'FK interventi_beneficiario_fk non validata: presenti riferimenti legacy orfani';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interventi_beneficiario_fk'
      AND conrelid = 'interventi'::regclass AND NOT convalidated
  ) THEN
    ALTER TABLE interventi VALIDATE CONSTRAINT interventi_beneficiario_fk;
  END IF;

  IF EXISTS (
    SELECT 1 FROM interventi i
    LEFT JOIN bolle b ON b.id = i.bolla_id
    WHERE i.bolla_id IS NOT NULL AND b.id IS NULL
  ) THEN
    RAISE NOTICE 'FK interventi_bolla_fk non validata: presenti riferimenti legacy orfani';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interventi_bolla_fk'
      AND conrelid = 'interventi'::regclass AND NOT convalidated
  ) THEN
    ALTER TABLE interventi VALIDATE CONSTRAINT interventi_bolla_fk;
  END IF;

  IF EXISTS (
    SELECT 1 FROM turni t
    LEFT JOIN centri_di_ascolto c ON c.id = t.centro_ascolto_id
    WHERE c.id IS NULL
  ) THEN
    RAISE NOTICE 'FK turni_centro_ascolto_fk non validata: presenti riferimenti legacy orfani';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turni_centro_ascolto_fk'
      AND conrelid = 'turni'::regclass AND NOT convalidated
  ) THEN
    ALTER TABLE turni VALIDATE CONSTRAINT turni_centro_ascolto_fk;
  END IF;

  IF EXISTS (
    SELECT 1 FROM turni t
    LEFT JOIN mezzi m ON m.id = t.mezzo_id
    WHERE t.mezzo_id IS NOT NULL AND m.id IS NULL
  ) THEN
    RAISE NOTICE 'FK turni_mezzo_fk non validata: presenti riferimenti legacy orfani';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turni_mezzo_fk'
      AND conrelid = 'turni'::regclass AND NOT convalidated
  ) THEN
    ALTER TABLE turni VALIDATE CONSTRAINT turni_mezzo_fk;
  END IF;

  IF EXISTS (
    SELECT 1 FROM turni_volontari tv
    LEFT JOIN turni t ON t.id = tv.turno_id
    WHERE t.id IS NULL
  ) THEN
    RAISE NOTICE 'FK turni_volontari_turno_fk non validata: presenti riferimenti legacy orfani';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turni_volontari_turno_fk'
      AND conrelid = 'turni_volontari'::regclass AND NOT convalidated
  ) THEN
    ALTER TABLE turni_volontari VALIDATE CONSTRAINT turni_volontari_turno_fk;
  END IF;

  IF EXISTS (
    SELECT 1 FROM turni_volontari tv
    LEFT JOIN volontari v ON v.id = tv.volontario_id
    WHERE v.id IS NULL
  ) THEN
    RAISE NOTICE 'FK turni_volontari_volontario_fk non validata: presenti riferimenti legacy orfani';
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turni_volontari_volontario_fk'
      AND conrelid = 'turni_volontari'::regclass AND NOT convalidated
  ) THEN
    ALTER TABLE turni_volontari VALIDATE CONSTRAINT turni_volontari_volontario_fk;
  END IF;
END
$update$;

CREATE UNIQUE INDEX IF NOT EXISTS turni_centro_data_fascia_unique
  ON turni (centro_ascolto_id, data, fascia);
CREATE UNIQUE INDEX IF NOT EXISTS turni_mezzo_data_fascia_unique
  ON turni (mezzo_id, data, fascia)
  WHERE mezzo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS turni_volontari_turno_volontario_unique
  ON turni_volontari (turno_id, volontario_id);
