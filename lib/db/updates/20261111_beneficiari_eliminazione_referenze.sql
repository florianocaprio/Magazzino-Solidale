-- Preserve legacy data while enforcing the beneficiary link on new writes.
DO $update$
DECLARE
  relation_name text;
  constraint_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['bolle', 'consegne', 'nucleo_familiare'] LOOP
    constraint_name := relation_name || '_beneficiario_fk';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', relation_name)::regclass
        AND conname = constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (beneficiario_id) REFERENCES public.beneficiari(id) ON DELETE RESTRICT NOT VALID',
        relation_name, constraint_name
      );
    END IF;
  END LOOP;
END
$update$;
