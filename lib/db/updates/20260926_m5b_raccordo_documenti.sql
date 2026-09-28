-- M5B: solo relazioni e delega; nessun backfill, documento o movimento.
CREATE TABLE IF NOT EXISTS richieste_magazzino_documenti (
  id serial PRIMARY KEY,
  richiesta_id integer NOT NULL REFERENCES richieste_magazzino(id) ON DELETE RESTRICT,
  tipo_documento varchar(20) NOT NULL,
  bolla_id integer REFERENCES bolle(id) ON DELETE RESTRICT,
  trasferimento_id integer REFERENCES trasferimenti(id) ON DELETE RESTRICT,
  corrente boolean NOT NULL DEFAULT true,
  creato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  creato_at timestamptz NOT NULL DEFAULT now(),
  cessato_da integer REFERENCES utenti(id) ON DELETE RESTRICT,
  cessato_at timestamptz,
  evento_cessazione varchar(40),
  motivo_cessazione varchar(500),
  CONSTRAINT richieste_magazzino_documenti_tipo_check CHECK (
    (tipo_documento = 'bolla' AND bolla_id IS NOT NULL AND trasferimento_id IS NULL)
    OR (tipo_documento = 'trasferimento' AND bolla_id IS NULL AND trasferimento_id IS NOT NULL)
  ),
  CONSTRAINT richieste_magazzino_documenti_corrente_check CHECK (
    (corrente = true AND cessato_da IS NULL AND cessato_at IS NULL AND evento_cessazione IS NULL AND motivo_cessazione IS NULL)
    OR (corrente = false AND cessato_da IS NOT NULL AND cessato_at IS NOT NULL AND evento_cessazione = 'annullamento_m4' AND motivo_cessazione IS NOT NULL AND length(btrim(motivo_cessazione)) BETWEEN 1 AND 500)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS richieste_magazzino_documenti_corrente_unique
  ON richieste_magazzino_documenti(richiesta_id) WHERE corrente = true;
CREATE UNIQUE INDEX IF NOT EXISTS richieste_magazzino_documenti_bolla_unique
  ON richieste_magazzino_documenti(bolla_id) WHERE bolla_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS richieste_magazzino_documenti_trasferimento_unique
  ON richieste_magazzino_documenti(trasferimento_id) WHERE trasferimento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS richieste_magazzino_documenti_storico_idx
  ON richieste_magazzino_documenti(richiesta_id, creato_at, id);

CREATE TABLE IF NOT EXISTS interventi_deleghe_m4 (
  intervento_id integer PRIMARY KEY REFERENCES interventi(id) ON DELETE RESTRICT,
  prima_richiesta_id integer NOT NULL REFERENCES richieste_magazzino(id) ON DELETE RESTRICT,
  delegato_da integer NOT NULL REFERENCES utenti(id) ON DELETE RESTRICT,
  delegato_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interventi_deleghe_m4_richiesta_idx
  ON interventi_deleghe_m4(prima_richiesta_id);

-- Il fresh esegue prima Drizzle push; IF NOT EXISTS da solo non prova equivalenza.
-- La guardia confronta la semantica degli oggetti M5B prima di registrare la 44.
DO $m5b_structure$
DECLARE
  mismatch boolean;
BEGIN
  IF (SELECT count(*) FROM pg_class WHERE oid IN (
      'public.richieste_magazzino_documenti'::regclass,
      'public.interventi_deleghe_m4'::regclass
    ) AND relkind = 'r') <> 2 THEN
    RAISE EXCEPTION 'M5B: relazione omonima non compatibile';
  END IF;

  WITH expected(tabella, colonna, tipo, obbligatoria, default_sql) AS (
    VALUES
      ('richieste_magazzino_documenti', 'id', 'integer', true, 'nextval(''richieste_magazzino_documenti_id_seq''::regclass)'),
      ('richieste_magazzino_documenti', 'richiesta_id', 'integer', true, NULL),
      ('richieste_magazzino_documenti', 'tipo_documento', 'character varying(20)', true, NULL),
      ('richieste_magazzino_documenti', 'bolla_id', 'integer', false, NULL),
      ('richieste_magazzino_documenti', 'trasferimento_id', 'integer', false, NULL),
      ('richieste_magazzino_documenti', 'corrente', 'boolean', true, 'true'),
      ('richieste_magazzino_documenti', 'creato_da', 'integer', true, NULL),
      ('richieste_magazzino_documenti', 'creato_at', 'timestamp with time zone', true, 'now()'),
      ('richieste_magazzino_documenti', 'cessato_da', 'integer', false, NULL),
      ('richieste_magazzino_documenti', 'cessato_at', 'timestamp with time zone', false, NULL),
      ('richieste_magazzino_documenti', 'evento_cessazione', 'character varying(40)', false, NULL),
      ('richieste_magazzino_documenti', 'motivo_cessazione', 'character varying(500)', false, NULL),
      ('interventi_deleghe_m4', 'intervento_id', 'integer', true, NULL),
      ('interventi_deleghe_m4', 'prima_richiesta_id', 'integer', true, NULL),
      ('interventi_deleghe_m4', 'delegato_da', 'integer', true, NULL),
      ('interventi_deleghe_m4', 'delegato_at', 'timestamp with time zone', true, 'now()')
  ), actual AS (
    SELECT c.relname::text, a.attname::text,
      format_type(a.atttypid, a.atttypmod), a.attnotnull,
      pg_get_expr(d.adbin, d.adrelid)
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE c.oid IN ('public.richieste_magazzino_documenti'::regclass,
                    'public.interventi_deleghe_m4'::regclass)
      AND a.attidentity = '' AND a.attgenerated = ''
  )
  SELECT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      OR EXISTS (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    INTO mismatch;
  IF mismatch OR pg_get_serial_sequence('public.richieste_magazzino_documenti', 'id')
      IS DISTINCT FROM 'public.richieste_magazzino_documenti_id_seq' THEN
    RAISE EXCEPTION 'M5B: colonne, default o sequenza non compatibili';
  END IF;

  WITH expected(tabella, colonna, riferimento, colonna_riferimento) AS (
    VALUES
      ('richieste_magazzino_documenti', 'richiesta_id', 'richieste_magazzino', 'id'),
      ('richieste_magazzino_documenti', 'bolla_id', 'bolle', 'id'),
      ('richieste_magazzino_documenti', 'trasferimento_id', 'trasferimenti', 'id'),
      ('richieste_magazzino_documenti', 'creato_da', 'utenti', 'id'),
      ('richieste_magazzino_documenti', 'cessato_da', 'utenti', 'id'),
      ('interventi_deleghe_m4', 'intervento_id', 'interventi', 'id'),
      ('interventi_deleghe_m4', 'prima_richiesta_id', 'richieste_magazzino', 'id'),
      ('interventi_deleghe_m4', 'delegato_da', 'utenti', 'id')
  ), actual AS (
    SELECT source.relname::text, source_col.attname::text,
      target.relname::text, target_col.attname::text
    FROM pg_constraint con
    JOIN pg_class source ON source.oid = con.conrelid
    JOIN pg_class target ON target.oid = con.confrelid
    JOIN pg_attribute source_col ON source_col.attrelid = source.oid AND source_col.attnum = con.conkey[1]
    JOIN pg_attribute target_col ON target_col.attrelid = target.oid AND target_col.attnum = con.confkey[1]
    WHERE con.conrelid IN ('public.richieste_magazzino_documenti'::regclass,
                           'public.interventi_deleghe_m4'::regclass)
      AND con.contype = 'f' AND cardinality(con.conkey) = 1
      AND cardinality(con.confkey) = 1 AND con.confdeltype = 'r'
      AND con.confupdtype = 'a' AND NOT con.condeferrable AND con.convalidated
  )
  SELECT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      OR EXISTS (SELECT * FROM actual EXCEPT SELECT * FROM expected)
      OR (SELECT count(*) FROM pg_constraint
          WHERE conrelid IN ('public.richieste_magazzino_documenti'::regclass,
                             'public.interventi_deleghe_m4'::regclass)
            AND contype = 'f') <> 8
    INTO mismatch;
  IF mismatch THEN
    RAISE EXCEPTION 'M5B: foreign key non compatibili';
  END IF;

  WITH expected(tabella, definizione) AS (
    VALUES ('richieste_magazzino_documenti', 'PRIMARY KEY (id)'),
           ('interventi_deleghe_m4', 'PRIMARY KEY (intervento_id)')
  ), actual AS (
    SELECT c.relname::text, pg_get_constraintdef(con.oid)
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    WHERE con.conrelid IN ('public.richieste_magazzino_documenti'::regclass,
                           'public.interventi_deleghe_m4'::regclass)
      AND con.contype = 'p' AND con.convalidated
  )
  SELECT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      OR EXISTS (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    INTO mismatch;
  IF mismatch THEN RAISE EXCEPTION 'M5B: primary key non compatibili'; END IF;

  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid IN ('public.richieste_magazzino_documenti'::regclass,
                         'public.interventi_deleghe_m4'::regclass)
        AND contype = 'c' AND convalidated) <> 2
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE
      conrelid = 'public.richieste_magazzino_documenti'::regclass
      AND conname = 'richieste_magazzino_documenti_tipo_check' AND convalidated
      AND pg_get_constraintdef(oid) =
        'CHECK (((((tipo_documento)::text = ''bolla''::text) AND (bolla_id IS NOT NULL) AND (trasferimento_id IS NULL)) OR (((tipo_documento)::text = ''trasferimento''::text) AND (bolla_id IS NULL) AND (trasferimento_id IS NOT NULL))))')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE
      conrelid = 'public.richieste_magazzino_documenti'::regclass
      AND conname = 'richieste_magazzino_documenti_corrente_check' AND convalidated
      AND pg_get_constraintdef(oid) =
        'CHECK ((((corrente = true) AND (cessato_da IS NULL) AND (cessato_at IS NULL) AND (evento_cessazione IS NULL) AND (motivo_cessazione IS NULL)) OR ((corrente = false) AND (cessato_da IS NOT NULL) AND (cessato_at IS NOT NULL) AND ((evento_cessazione)::text = ''annullamento_m4''::text) AND (motivo_cessazione IS NOT NULL) AND ((length(btrim((motivo_cessazione)::text)) >= 1) AND (length(btrim((motivo_cessazione)::text)) <= 500)))))') THEN
    RAISE EXCEPTION 'M5B: CHECK non compatibili';
  END IF;

  WITH expected(nome, definizione) AS (
    VALUES
      ('richieste_magazzino_documenti_pkey', 'CREATE UNIQUE INDEX richieste_magazzino_documenti_pkey ON public.richieste_magazzino_documenti USING btree (id)'),
      ('richieste_magazzino_documenti_corrente_unique', 'CREATE UNIQUE INDEX richieste_magazzino_documenti_corrente_unique ON public.richieste_magazzino_documenti USING btree (richiesta_id) WHERE (corrente = true)'),
      ('richieste_magazzino_documenti_bolla_unique', 'CREATE UNIQUE INDEX richieste_magazzino_documenti_bolla_unique ON public.richieste_magazzino_documenti USING btree (bolla_id) WHERE (bolla_id IS NOT NULL)'),
      ('richieste_magazzino_documenti_trasferimento_unique', 'CREATE UNIQUE INDEX richieste_magazzino_documenti_trasferimento_unique ON public.richieste_magazzino_documenti USING btree (trasferimento_id) WHERE (trasferimento_id IS NOT NULL)'),
      ('richieste_magazzino_documenti_storico_idx', 'CREATE INDEX richieste_magazzino_documenti_storico_idx ON public.richieste_magazzino_documenti USING btree (richiesta_id, creato_at, id)'),
      ('interventi_deleghe_m4_pkey', 'CREATE UNIQUE INDEX interventi_deleghe_m4_pkey ON public.interventi_deleghe_m4 USING btree (intervento_id)'),
      ('interventi_deleghe_m4_richiesta_idx', 'CREATE INDEX interventi_deleghe_m4_richiesta_idx ON public.interventi_deleghe_m4 USING btree (prima_richiesta_id)')
  ), actual AS (
    SELECT indexname::text, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN
      ('richieste_magazzino_documenti', 'interventi_deleghe_m4')
  )
  SELECT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      OR EXISTS (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    INTO mismatch;
  IF mismatch THEN RAISE EXCEPTION 'M5B: indici non compatibili'; END IF;
END
$m5b_structure$;
