-- Configurazione versionata e contatori indipendenti dalle matricole volontari.
-- Nessuna rinumerazione di beneficiari o tessere esistenti.
CREATE TABLE IF NOT EXISTS configurazioni_codici_beneficiari (
 id serial PRIMARY KEY, scope_tipo varchar(16) NOT NULL DEFAULT 'GLOBALE' CHECK (scope_tipo = 'GLOBALE'),
 versione integer NOT NULL UNIQUE, prefisso_associazione varchar(12), includi_codice_area boolean NOT NULL DEFAULT false,
 segmento_fisso varchar(8), separatore varchar(1) NOT NULL DEFAULT '-' CHECK (separatore IN ('','-','/')),
 cifre_progressivo integer NOT NULL DEFAULT 6 CHECK (cifre_progressivo BETWEEN 2 AND 8),
 numero_iniziale integer NOT NULL DEFAULT 1 CHECK (numero_iniziale > 0),
 ambito_progressivo varchar(16) NOT NULL DEFAULT 'GLOBALE' CHECK (ambito_progressivo IN ('GLOBALE','PER_AREA')),
 attiva boolean NOT NULL DEFAULT true, aggiornata_da integer REFERENCES utenti(id) ON DELETE SET NULL,
 data_creazione timestamp NOT NULL DEFAULT now(), data_aggiornamento timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS config_codici_benef_attiva_scope_unique ON configurazioni_codici_beneficiari(scope_tipo) WHERE attiva = true;
CREATE TABLE IF NOT EXISTS progressivi_codici_beneficiari (
 id serial PRIMARY KEY, configurazione_id integer NOT NULL REFERENCES configurazioni_codici_beneficiari(id) ON DELETE RESTRICT,
 scope_tipo varchar(16) NOT NULL CHECK (scope_tipo IN ('GLOBALE','AREA')), scope_key varchar(80) NOT NULL,
 area_operativa_id integer REFERENCES aree_operative(id) ON DELETE RESTRICT,
 ultimo_numero integer NOT NULL CHECK (ultimo_numero > 0), versione integer NOT NULL DEFAULT 1,
 data_aggiornamento timestamp NOT NULL DEFAULT now(),
 CONSTRAINT progressivi_codici_benef_config_scope_unique UNIQUE(configurazione_id,scope_key)
);
INSERT INTO configurazioni_codici_beneficiari(versione,prefisso_associazione) VALUES (1,'BEN') ON CONFLICT DO NOTHING;
