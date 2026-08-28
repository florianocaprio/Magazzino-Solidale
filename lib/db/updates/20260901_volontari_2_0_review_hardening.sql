-- Hardening additivo Volontari 2.0 dopo revisione ##test.
-- Le chiavi sono valorizzate solo dalle nuove scritture: nessun dato storico
-- viene reinterpretato o modificato dalla migration.

ALTER TABLE public.importazioni_volontari
  ADD COLUMN IF NOT EXISTS chiave_idempotenza varchar(64);

ALTER TABLE public.coperture_assicurative_volontari
  ADD COLUMN IF NOT EXISTS chiave_idempotenza varchar(64);

ALTER TABLE public.giornate_servizio_volontari
  ADD COLUMN IF NOT EXISTS chiave_idempotenza varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS importazioni_volontari_confermate_idempotenza_unique
  ON public.importazioni_volontari (chiave_idempotenza)
  WHERE chiave_idempotenza IS NOT NULL AND stato = 'CONFERMATO';

CREATE UNIQUE INDEX IF NOT EXISTS coperture_import_idempotenza_unique
  ON public.coperture_assicurative_volontari (chiave_idempotenza)
  WHERE chiave_idempotenza IS NOT NULL
    AND tipo_operazione = 'IMPORTAZIONE'
    AND annullata = false;

CREATE UNIQUE INDEX IF NOT EXISTS giornate_servizio_import_idempotenza_unique
  ON public.giornate_servizio_volontari (chiave_idempotenza)
  WHERE chiave_idempotenza IS NOT NULL;
