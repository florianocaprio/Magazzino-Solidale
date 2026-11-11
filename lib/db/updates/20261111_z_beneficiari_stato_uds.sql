ALTER TABLE public.beneficiari
  ADD COLUMN IF NOT EXISTS uds_attivo boolean NOT NULL DEFAULT true;
