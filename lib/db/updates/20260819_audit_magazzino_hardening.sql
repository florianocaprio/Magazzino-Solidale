-- Hardening progressivo e non distruttivo del dominio Magazzino.
-- Le FK/CHECK NOT VALID proteggono immediatamente le nuove scritture; i record
-- legacy orfani restano invariati e impediscono soltanto la VALIDATE finale.

ALTER TABLE movimenti
  ADD COLUMN IF NOT EXISTS movimento_origine_id integer,
  ADD COLUMN IF NOT EXISTS operatore_id integer;

ALTER TABLE trasferimenti
  ADD COLUMN IF NOT EXISTS versione integer NOT NULL DEFAULT 1;

ALTER TABLE approvvigionamenti
  ADD COLUMN IF NOT EXISTS versione integer NOT NULL DEFAULT 1;

DO $update$
DECLARE
  relation record;
  has_orphans boolean;
  installed_constraint_name text;
BEGIN
  FOR relation IN
    SELECT * FROM (VALUES
      ('lotti_prodotto_fk', 'lotti', 'prodotto_id', 'prodotti', 'id', 'RESTRICT'),
      ('lotti_magazzino_fk', 'lotti', 'magazzino_id', 'magazzini', 'id', 'RESTRICT'),
      ('lotti_fornitore_fk', 'lotti', 'fornitore_id', 'fornitori', 'id', 'RESTRICT'),
      ('movimenti_magazzino_fk', 'movimenti', 'magazzino_id', 'magazzini', 'id', 'RESTRICT'),
      ('movimenti_prodotto_fk', 'movimenti', 'prodotto_id', 'prodotti', 'id', 'RESTRICT'),
      ('movimenti_lotto_fk', 'movimenti', 'lotto_id', 'lotti', 'id', 'RESTRICT'),
      ('movimenti_fornitore_fk', 'movimenti', 'fornitore_id', 'fornitori', 'id', 'RESTRICT'),
      ('movimenti_beneficiario_fk', 'movimenti', 'beneficiario_id', 'beneficiari', 'id', 'RESTRICT'),
      ('movimenti_bolla_fk', 'movimenti', 'bolla_id', 'bolle', 'id', 'RESTRICT'),
      ('movimenti_bolla_riga_fk', 'movimenti', 'bolla_riga_id', 'bolla_righe', 'id', 'RESTRICT'),
      ('movimenti_trasferimento_fk', 'movimenti', 'trasferimento_id', 'trasferimenti', 'id', 'RESTRICT'),
      ('movimenti_origine_fk', 'movimenti', 'movimento_origine_id', 'movimenti', 'id', 'RESTRICT'),
      ('movimenti_operatore_fk', 'movimenti', 'operatore_id', 'utenti', 'id', 'RESTRICT'),
      ('scarichi_magazzino_fk', 'scarichi', 'magazzino_id', 'magazzini', 'id', 'RESTRICT'),
      ('scarichi_centro_fk', 'scarichi', 'centro_ascolto_id', 'centri_di_ascolto', 'id', 'RESTRICT'),
      ('scarichi_operatore_fk', 'scarichi', 'operatore_id', 'utenti', 'id', 'RESTRICT'),
      ('scarico_righe_scarico_fk', 'scarico_righe', 'scarico_id', 'scarichi', 'id', 'CASCADE'),
      ('scarico_righe_prodotto_fk', 'scarico_righe', 'prodotto_id', 'prodotti', 'id', 'RESTRICT'),
      ('trasferimenti_origine_fk', 'trasferimenti', 'magazzino_origine_id', 'magazzini', 'id', 'RESTRICT'),
      ('trasferimenti_destino_fk', 'trasferimenti', 'magazzino_destino_id', 'magazzini', 'id', 'RESTRICT'),
      ('trasferimenti_operatore_fk', 'trasferimenti', 'operatore_id', 'utenti', 'id', 'RESTRICT'),
      ('trasferimenti_volontario_fk', 'trasferimenti', 'trasportatore_volontario_id', 'volontari', 'id', 'RESTRICT'),
      ('trasferimento_righe_trasferimento_fk', 'trasferimento_righe', 'trasferimento_id', 'trasferimenti', 'id', 'CASCADE'),
      ('trasferimento_righe_prodotto_fk', 'trasferimento_righe', 'prodotto_id', 'prodotti', 'id', 'RESTRICT'),
      ('trasferimento_righe_lotto_fk', 'trasferimento_righe', 'lotto_id', 'lotti', 'id', 'RESTRICT'),
      ('approvvigionamenti_fornitore_fk', 'approvvigionamenti', 'fornitore_id', 'fornitori', 'id', 'RESTRICT'),
      ('approvvigionamenti_magazzino_fk', 'approvvigionamenti', 'magazzino_id', 'magazzini', 'id', 'RESTRICT'),
      ('approvvigionamenti_centro_fk', 'approvvigionamenti', 'centro_ascolto_id', 'centri_di_ascolto', 'id', 'RESTRICT'),
      ('approvvigionamento_righe_testata_fk', 'approvvigionamento_righe', 'approvvigionamento_id', 'approvvigionamenti', 'id', 'CASCADE'),
      ('approvvigionamento_righe_prodotto_fk', 'approvvigionamento_righe', 'prodotto_id', 'prodotti', 'id', 'RESTRICT'),
      ('bolla_righe_bolla_fk', 'bolla_righe', 'bolla_id', 'bolle', 'id', 'CASCADE'),
      ('bolla_righe_prodotto_fk', 'bolla_righe', 'prodotto_id', 'prodotti', 'id', 'RESTRICT'),
      ('bolla_righe_lotto_fk', 'bolla_righe', 'lotto_id', 'lotti', 'id', 'RESTRICT')
    ) AS relations(constraint_name, source_table, source_column, target_table, target_column, delete_action)
  LOOP
    SELECT constraint_row.conname
      INTO installed_constraint_name
    FROM pg_constraint constraint_row
    JOIN pg_attribute source_attribute
      ON source_attribute.attrelid = constraint_row.conrelid
     AND source_attribute.attnum = constraint_row.conkey[1]
    JOIN pg_attribute target_attribute
      ON target_attribute.attrelid = constraint_row.confrelid
     AND target_attribute.attnum = constraint_row.confkey[1]
    WHERE constraint_row.contype = 'f'
      AND constraint_row.conrelid = relation.source_table::regclass
      AND constraint_row.confrelid = relation.target_table::regclass
      AND array_length(constraint_row.conkey, 1) = 1
      AND array_length(constraint_row.confkey, 1) = 1
      AND source_attribute.attname = relation.source_column
      AND target_attribute.attname = relation.target_column
    ORDER BY (constraint_row.conname = relation.constraint_name) DESC
    LIMIT 1;

    IF installed_constraint_name IS NULL THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I) ON DELETE %s NOT VALID',
        relation.source_table, relation.constraint_name, relation.source_column,
        relation.target_table, relation.target_column, relation.delete_action
      );
      installed_constraint_name := relation.constraint_name;
    END IF;

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I s LEFT JOIN %I t ON t.%I = s.%I WHERE s.%I IS NOT NULL AND t.%I IS NULL)',
      relation.source_table, relation.target_table, relation.target_column,
      relation.source_column, relation.source_column, relation.target_column
    ) INTO has_orphans;
    IF has_orphans THEN
      RAISE NOTICE 'FK % non validata: presenti riferimenti legacy orfani', relation.constraint_name;
    ELSIF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = installed_constraint_name
        AND conrelid = relation.source_table::regclass
        AND NOT convalidated
    ) THEN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', relation.source_table, installed_constraint_name);
    END IF;
  END LOOP;
END
$update$;

DO $update$
DECLARE
  check_item record;
  has_invalid boolean;
BEGIN
  FOR check_item IN
    SELECT * FROM (VALUES
      ('lotti_quantita_caricata_positive_ck', 'lotti', 'quantita_caricata > 0', 'quantita_caricata <= 0'),
      ('lotti_quantita_residua_nonnegative_ck', 'lotti', 'quantita_residua >= 0', 'quantita_residua < 0'),
      ('movimenti_quantita_positive_ck', 'movimenti', 'quantita > 0', 'quantita <= 0'),
      ('scarico_righe_quantita_positive_ck', 'scarico_righe', 'quantita > 0', 'quantita <= 0'),
      ('trasferimento_righe_quantita_positive_ck', 'trasferimento_righe', 'quantita > 0', 'quantita <= 0'),
      ('trasferimenti_magazzini_distinti_ck', 'trasferimenti', 'magazzino_origine_id <> magazzino_destino_id', 'magazzino_origine_id = magazzino_destino_id'),
      ('approvv_righe_richiesta_positive_ck', 'approvvigionamento_righe', 'quantita_richiesta > 0', 'quantita_richiesta <= 0'),
      ('approvv_righe_ricevuta_nonnegative_ck', 'approvvigionamento_righe', 'quantita_ricevuta >= 0', 'quantita_ricevuta < 0'),
      ('approvv_righe_ricevuta_coerente_ck', 'approvvigionamento_righe', 'quantita_ricevuta <= quantita_richiesta', 'quantita_ricevuta > quantita_richiesta'),
      ('bolla_righe_quantita_positive_ck', 'bolla_righe', 'quantita > 0', 'quantita <= 0')
    ) AS checks(constraint_name, source_table, expression_sql, invalid_sql)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = check_item.constraint_name
        AND conrelid = check_item.source_table::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
        check_item.source_table, check_item.constraint_name, check_item.expression_sql
      );
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %s)', check_item.source_table, check_item.invalid_sql)
      INTO has_invalid;
    IF has_invalid THEN
      RAISE NOTICE 'CHECK % non validato: presenti valori legacy incompatibili', check_item.constraint_name;
    ELSIF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = check_item.constraint_name
        AND conrelid = check_item.source_table::regclass
        AND NOT convalidated
    ) THEN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', check_item.source_table, check_item.constraint_name);
    END IF;
  END LOOP;
END
$update$;

CREATE UNIQUE INDEX IF NOT EXISTS movimenti_storno_origine_unique
  ON movimenti (movimento_origine_id)
  WHERE movimento_origine_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS movimenti_lotto_idx ON movimenti (lotto_id);
CREATE INDEX IF NOT EXISTS movimenti_documento_idx ON movimenti (documento_riferimento);
