DO $volontari_2_preflight$
BEGIN
  IF to_regclass('public.volontari') IS NULL
     OR to_regclass('public.ruoli_volontari') IS NULL
     OR to_regclass('public.utenti') IS NULL
     OR to_regclass('public.centri_di_ascolto') IS NULL THEN
    RAISE EXCEPTION 'Schema base Volontari 2.0 non disponibile';
  END IF;
END
$volontari_2_preflight$;

ALTER TABLE public.volontari
  ADD COLUMN IF NOT EXISTS tipo_volontario varchar(20) NOT NULL DEFAULT 'PERMANENTE',
  ADD COLUMN IF NOT EXISTS telefono_secondario varchar(20),
  ADD COLUMN IF NOT EXISTS luogo_nascita varchar(120),
  ADD COLUMN IF NOT EXISTS data_nascita date,
  ADD COLUMN IF NOT EXISTS indirizzo_residenza varchar(240),
  ADD COLUMN IF NOT EXISTS codice_fiscale varchar(32),
  ADD COLUMN IF NOT EXISTS codice_fiscale_normalizzato varchar(32),
  ADD COLUMN IF NOT EXISTS data_inizio_importata date,
  ADD COLUMN IF NOT EXISTS categoria_importata_originale varchar(160),
  ADD COLUMN IF NOT EXISTS gruppo_importato_originale varchar(160);

CREATE INDEX IF NOT EXISTS volontari_codice_fiscale_norm_idx
  ON public.volontari (codice_fiscale_normalizzato);
CREATE INDEX IF NOT EXISTS volontari_tipo_idx
  ON public.volontari (tipo_volontario);

DO $volontari_2_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.volontari'::regclass
      AND conname = 'volontari_tipo_check'
  ) THEN
    ALTER TABLE public.volontari
      ADD CONSTRAINT volontari_tipo_check
      CHECK (tipo_volontario IN ('PERMANENTE','TEMPORANEO')) NOT VALID;
  END IF;
END
$volontari_2_constraints$;
ALTER TABLE public.volontari VALIDATE CONSTRAINT volontari_tipo_check;

ALTER TABLE public.ruoli_volontari
  ADD COLUMN IF NOT EXISTS nome_normalizzato varchar(80),
  ADD COLUMN IF NOT EXISTS descrizione text,
  ADD COLUMN IF NOT EXISTS data_aggiornamento timestamp NOT NULL DEFAULT now();

UPDATE public.ruoli_volontari
SET nome_normalizzato = lower(regexp_replace(trim(translate(
  nome,
  'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç',
  'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'
)), '[^[:alnum:]]+', ' ', 'g'))
WHERE nome_normalizzato IS NULL;

WITH ranked AS (
  SELECT id, nome_normalizzato,
         first_value(id) OVER (PARTITION BY nome_normalizzato ORDER BY id) AS canonical_id,
         row_number() OVER (PARTITION BY nome_normalizzato ORDER BY id) AS rn
  FROM public.ruoli_volontari
  WHERE nome_normalizzato IS NOT NULL
), remap AS (
  UPDATE public.volontari v
  SET ruolo_volontario_id = ranked.canonical_id
  FROM ranked
  WHERE ranked.rn > 1 AND v.ruolo_volontario_id = ranked.id
  RETURNING v.id
)
UPDATE public.ruoli_volontari r
SET attivo = false,
    nome_normalizzato = ranked.nome_normalizzato || '#legacy-' || r.id,
    data_aggiornamento = now()
FROM ranked
WHERE ranked.rn > 1 AND r.id = ranked.id;

CREATE UNIQUE INDEX IF NOT EXISTS ruoli_volontari_nome_normalizzato_unique
  ON public.ruoli_volontari (nome_normalizzato);

CREATE TABLE IF NOT EXISTS public.stati_volontari (
  id serial PRIMARY KEY,
  volontario_id integer NOT NULL REFERENCES public.volontari(id) ON DELETE RESTRICT,
  tipo_evento varchar(24) NOT NULL CHECK (tipo_evento IN ('SOSPENSIONE','RIATTIVAZIONE')),
  data_effettiva date NOT NULL,
  motivo varchar(80),
  note text,
  creato_da integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  data_creazione timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stati_volontari_volontario_data_idx
  ON public.stati_volontari (volontario_id, data_effettiva, id);

CREATE TABLE IF NOT EXISTS public.coperture_assicurative_volontari (
  id serial PRIMARY KEY,
  volontario_id integer NOT NULL REFERENCES public.volontari(id) ON DELETE RESTRICT,
  data_inizio date,
  data_fine date NOT NULL,
  durata_mesi integer CHECK (durata_mesi IS NULL OR durata_mesi > 0),
  tipo_operazione varchar(24) NOT NULL CHECK (
    tipo_operazione IN ('IMPORTAZIONE','NUOVA_COPERTURA','RINNOVO','RETTIFICA')
  ),
  riferimento_polizza varchar(120),
  note text,
  gruppo_operazione_id varchar(64),
  rettifica_di_id integer,
  annullata boolean NOT NULL DEFAULT false,
  annullata_da integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  data_annullamento timestamptz,
  creato_da integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coperture_date_check CHECK (data_inizio IS NULL OR data_fine >= data_inizio)
);
CREATE INDEX IF NOT EXISTS coperture_volontario_date_idx
  ON public.coperture_assicurative_volontari (volontario_id, data_fine, data_inizio);
CREATE INDEX IF NOT EXISTS coperture_gruppo_operazione_idx
  ON public.coperture_assicurative_volontari (gruppo_operazione_id);

DO $coperture_self_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coperture_assicurative_volontari'::regclass
      AND conname = 'coperture_assicurative_rettifica_fk'
  ) THEN
    ALTER TABLE public.coperture_assicurative_volontari
      ADD CONSTRAINT coperture_assicurative_rettifica_fk
      FOREIGN KEY (rettifica_di_id)
      REFERENCES public.coperture_assicurative_volontari(id)
      ON DELETE RESTRICT;
  END IF;
END
$coperture_self_fk$;

CREATE TABLE IF NOT EXISTS public.giornate_servizio_volontari (
  id serial PRIMARY KEY,
  volontario_id integer NOT NULL REFERENCES public.volontari(id) ON DELETE RESTRICT,
  data_servizio date NOT NULL,
  centro_ascolto_id integer REFERENCES public.centri_di_ascolto(id) ON DELETE RESTRICT,
  attivita varchar(200),
  stato varchar(20) NOT NULL DEFAULT 'PIANIFICATA'
    CHECK (stato IN ('PIANIFICATA','PRESENTE','ASSENTE','ANNULLATA')),
  copertura_verificata boolean NOT NULL DEFAULT false,
  note text,
  versione integer NOT NULL DEFAULT 1 CHECK (versione > 0),
  creato_da integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS giornate_servizio_volontario_data_centro_unique
  ON public.giornate_servizio_volontari (volontario_id, data_servizio, centro_ascolto_id);
CREATE INDEX IF NOT EXISTS giornate_servizio_data_idx
  ON public.giornate_servizio_volontari (data_servizio, stato);

CREATE TABLE IF NOT EXISTS public.corsi_volontari_catalogo (
  id serial PRIMARY KEY,
  codice varchar(40) NOT NULL UNIQUE,
  titolo varchar(160) NOT NULL,
  descrizione text,
  ore integer NOT NULL DEFAULT 0 CHECK (ore >= 0),
  ente_docente varchar(160),
  validita_mesi integer CHECK (validita_mesi IS NULL OR validita_mesi > 0),
  attivo boolean NOT NULL DEFAULT true,
  versione integer NOT NULL DEFAULT 1 CHECK (versione > 0),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.corsi_volontari_ruoli (
  id serial PRIMARY KEY,
  corso_id integer NOT NULL REFERENCES public.corsi_volontari_catalogo(id) ON DELETE CASCADE,
  ruolo_volontario_id integer NOT NULL REFERENCES public.ruoli_volontari(id) ON DELETE RESTRICT,
  livello varchar(20) NOT NULL DEFAULT 'CONSIGLIATO'
    CHECK (livello IN ('OBBLIGATORIO','CONSIGLIATO')),
  CONSTRAINT corsi_volontari_ruoli_unique UNIQUE (corso_id, ruolo_volontario_id)
);

CREATE TABLE IF NOT EXISTS public.corsi_dei_volontari (
  id serial PRIMARY KEY,
  volontario_id integer NOT NULL REFERENCES public.volontari(id) ON DELETE RESTRICT,
  corso_id integer NOT NULL REFERENCES public.corsi_volontari_catalogo(id) ON DELETE RESTRICT,
  data_completamento date NOT NULL,
  esito varchar(30) NOT NULL,
  ore integer NOT NULL DEFAULT 0 CHECK (ore >= 0),
  data_scadenza date,
  numero_attestato varchar(100),
  riferimento_documento varchar(255),
  note text,
  verificato_da integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  versione integer NOT NULL DEFAULT 1 CHECK (versione > 0),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corsi_dei_volontari_volontario_idx
  ON public.corsi_dei_volontari (volontario_id);

CREATE TABLE IF NOT EXISTS public.qualifiche_volontari_catalogo (
  id serial PRIMARY KEY,
  codice varchar(40) NOT NULL UNIQUE,
  nome varchar(160) NOT NULL,
  descrizione text,
  validita_mesi integer CHECK (validita_mesi IS NULL OR validita_mesi > 0),
  attivo boolean NOT NULL DEFAULT true,
  versione integer NOT NULL DEFAULT 1 CHECK (versione > 0),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.qualifiche_volontari_ruoli (
  id serial PRIMARY KEY,
  qualifica_id integer NOT NULL REFERENCES public.qualifiche_volontari_catalogo(id) ON DELETE CASCADE,
  ruolo_volontario_id integer NOT NULL REFERENCES public.ruoli_volontari(id) ON DELETE RESTRICT,
  livello varchar(20) NOT NULL DEFAULT 'CONSIGLIATO'
    CHECK (livello IN ('OBBLIGATORIO','CONSIGLIATO')),
  CONSTRAINT qualifiche_volontari_ruoli_unique UNIQUE (qualifica_id, ruolo_volontario_id)
);

CREATE TABLE IF NOT EXISTS public.qualifiche_dei_volontari (
  id serial PRIMARY KEY,
  volontario_id integer NOT NULL REFERENCES public.volontari(id) ON DELETE RESTRICT,
  qualifica_id integer NOT NULL REFERENCES public.qualifiche_volontari_catalogo(id) ON DELETE RESTRICT,
  data_ottenimento date NOT NULL,
  data_scadenza date,
  stato varchar(20) NOT NULL DEFAULT 'VALIDA'
    CHECK (stato IN ('VALIDA','SCADUTA','SOSPESA','REVOCATA')),
  riferimento_documento varchar(255),
  corso_origine_id integer REFERENCES public.corsi_dei_volontari(id) ON DELETE SET NULL,
  note text,
  versione integer NOT NULL DEFAULT 1 CHECK (versione > 0),
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_aggiornamento timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qualifiche_dei_volontari_volontario_idx
  ON public.qualifiche_dei_volontari (volontario_id);

CREATE TABLE IF NOT EXISTS public.importazioni_volontari (
  id serial PRIMARY KEY,
  nome_file varchar(255) NOT NULL,
  mime_type varchar(150) NOT NULL,
  dimensione_bytes integer NOT NULL CHECK (dimensione_bytes > 0),
  sha256_file varchar(64) NOT NULL CHECK (sha256_file ~ '^[0-9a-f]{64}$'),
  hash_contenuto_normalizzato varchar(64) NOT NULL
    CHECK (hash_contenuto_normalizzato ~ '^[0-9a-f]{64}$'),
  centro_ascolto_id integer REFERENCES public.centri_di_ascolto(id) ON DELETE RESTRICT,
  stato varchar(20) NOT NULL DEFAULT 'ANALIZZATO'
    CHECK (stato IN ('ANALIZZATO','CONFERMATO','PARZIALE','FALLITO')),
  numero_righe integer NOT NULL DEFAULT 0,
  creati integer NOT NULL DEFAULT 0,
  aggiornati integer NOT NULL DEFAULT 0,
  invariati integer NOT NULL DEFAULT 0,
  esclusi integer NOT NULL DEFAULT 0,
  errori integer NOT NULL DEFAULT 0,
  creato_da integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  confermato_da integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  data_creazione timestamptz NOT NULL DEFAULT now(),
  data_conferma timestamptz,
  CONSTRAINT importazioni_volontari_counts_check CHECK (
    numero_righe >= 0 AND creati >= 0 AND aggiornati >= 0
    AND invariati >= 0 AND esclusi >= 0 AND errori >= 0
  )
);
CREATE INDEX IF NOT EXISTS importazioni_volontari_hash_idx
  ON public.importazioni_volontari (sha256_file);
CREATE INDEX IF NOT EXISTS importazioni_volontari_scope_idx
  ON public.importazioni_volontari (centro_ascolto_id);

CREATE TABLE IF NOT EXISTS public.importazioni_volontari_righe (
  id serial PRIMARY KEY,
  importazione_id integer NOT NULL REFERENCES public.importazioni_volontari(id) ON DELETE CASCADE,
  numero_riga integer NOT NULL,
  stato_riga varchar(30) NOT NULL CHECK (
    stato_riga IN ('NUOVO','AGGIORNAMENTO_CERTO','INVARIATO','POSSIBILE_DUPLICATO','ERRORE','DA_VERIFICARE')
  ),
  hash_riga varchar(64) NOT NULL CHECK (hash_riga ~ '^[0-9a-f]{64}$'),
  dati_originali jsonb NOT NULL,
  dati_normalizzati jsonb NOT NULL,
  volontario_candidato_id integer REFERENCES public.volontari(id) ON DELETE SET NULL,
  ruolo_proposto_id integer REFERENCES public.ruoli_volontari(id) ON DELETE SET NULL,
  centro_proposto_id integer REFERENCES public.centri_di_ascolto(id) ON DELETE SET NULL,
  errori jsonb NOT NULL DEFAULT '[]'::jsonb,
  avvisi jsonb NOT NULL DEFAULT '[]'::jsonb,
  esclusa boolean NOT NULL DEFAULT false,
  esito_commit varchar(30),
  volontario_risultato_id integer REFERENCES public.volontari(id) ON DELETE SET NULL,
  CONSTRAINT importazioni_volontari_righe_unique UNIQUE (importazione_id, numero_riga)
);
CREATE INDEX IF NOT EXISTS importazioni_volontari_righe_preview_idx
  ON public.importazioni_volontari_righe (importazione_id, stato_riga);

CREATE TABLE IF NOT EXISTS public.registro_volontari_eventi (
  id serial PRIMARY KEY,
  progressivo integer NOT NULL UNIQUE,
  sezione varchar(24) NOT NULL CHECK (sezione IN ('PERMANENTE','TEMPORANEO')),
  tipo_evento varchar(40) NOT NULL CHECK (
    tipo_evento IN ('REGISTRAZIONE','SOSPENSIONE_CESSAZIONE','RIATTIVAZIONE','GIORNATA_TEMPORANEA','RETTIFICA')
  ),
  volontario_id integer NOT NULL REFERENCES public.volontari(id) ON DELETE RESTRICT,
  centro_ascolto_id integer REFERENCES public.centri_di_ascolto(id) ON DELETE RESTRICT,
  data_effettiva date NOT NULL,
  timestamp_inserimento timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  utente_id integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  evento_rettificato_id integer,
  hash_precedente varchar(64),
  hash_evento varchar(64) NOT NULL UNIQUE CHECK (hash_evento ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS registro_volontari_volontario_idx
  ON public.registro_volontari_eventi (volontario_id, data_effettiva);

DO $registro_self_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.registro_volontari_eventi'::regclass
      AND conname = 'registro_volontari_rettifica_fk'
  ) THEN
    ALTER TABLE public.registro_volontari_eventi
      ADD CONSTRAINT registro_volontari_rettifica_fk
      FOREIGN KEY (evento_rettificato_id)
      REFERENCES public.registro_volontari_eventi(id)
      ON DELETE RESTRICT;
  END IF;
END
$registro_self_fk$;

CREATE TABLE IF NOT EXISTS public.emissioni_registro_volontari (
  id serial PRIMARY KEY,
  tipo varchar(20) NOT NULL CHECK (tipo IN ('PDF','XLSX')),
  sezione varchar(24),
  centro_ascolto_id integer REFERENCES public.centri_di_ascolto(id) ON DELETE RESTRICT,
  filtri jsonb NOT NULL,
  data_riferimento date NOT NULL,
  generato_da integer REFERENCES public.utenti(id) ON DELETE SET NULL,
  generato_at timestamptz NOT NULL DEFAULT now(),
  numero_righe integer NOT NULL CHECK (numero_righe >= 0),
  hash_file varchar(64) NOT NULL CHECK (hash_file ~ '^[0-9a-f]{64}$'),
  hash_snapshot varchar(64) NOT NULL CHECK (hash_snapshot ~ '^[0-9a-f]{64}$'),
  versione_layout varchar(40) NOT NULL,
  snapshot jsonb NOT NULL,
  contenuto_base64 text NOT NULL
);
CREATE INDEX IF NOT EXISTS emissioni_registro_data_idx
  ON public.emissioni_registro_volontari (data_riferimento, generato_at);
CREATE INDEX IF NOT EXISTS emissioni_registro_scope_idx
  ON public.emissioni_registro_volontari (centro_ascolto_id);

CREATE OR REPLACE FUNCTION public.volontari_registro_append_only()
RETURNS trigger LANGUAGE plpgsql AS $append_only$
BEGIN
  RAISE EXCEPTION 'Il registro volontari è append-only: usare un evento di rettifica';
END
$append_only$;

DROP TRIGGER IF EXISTS registro_volontari_append_only_trg
  ON public.registro_volontari_eventi;
CREATE TRIGGER registro_volontari_append_only_trg
BEFORE UPDATE OR DELETE ON public.registro_volontari_eventi
FOR EACH ROW EXECUTE FUNCTION public.volontari_registro_append_only();
