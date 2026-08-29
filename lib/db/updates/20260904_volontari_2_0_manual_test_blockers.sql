-- Rimuove il vincolo CHECK anonimo creato dalla migration iniziale, rimasto
-- attivo insieme al vincolo esteso e causa dei 500 sugli eventi anagrafici.
ALTER TABLE public.registro_volontari_eventi
  DROP CONSTRAINT IF EXISTS registro_volontari_eventi_tipo_evento_check;

ALTER TABLE public.registro_volontari_eventi
  DROP CONSTRAINT IF EXISTS registro_volontari_evento_check;

ALTER TABLE public.registro_volontari_eventi
  ADD CONSTRAINT registro_volontari_evento_check
  CHECK (tipo_evento IN (
    'REGISTRAZIONE', 'SOSPENSIONE_CESSAZIONE', 'RIATTIVAZIONE',
    'GIORNATA_TEMPORANEA', 'CONVERSIONE_PERMANENTE',
    'AGGIORNAMENTO_ANAGRAFICA', 'RETTIFICA'
  )) NOT VALID;

ALTER TABLE public.registro_volontari_eventi
  VALIDATE CONSTRAINT registro_volontari_evento_check;
