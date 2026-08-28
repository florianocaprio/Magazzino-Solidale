import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";
import { areeOperativeTable } from "./areeOperative";
import { centriAscoltoTable } from "./centri";
import { ruoliVolontariTable } from "./ruoliVolontari";
import { volontariTable } from "./volontari";

const auditTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const statiVolontariTable = pgTable(
  "stati_volontari",
  {
    id: serial("id").primaryKey(),
    volontarioId: integer("volontario_id")
      .notNull()
      .references(() => volontariTable.id, { onDelete: "restrict" }),
    tipoEvento: varchar("tipo_evento", { length: 24 }).notNull(),
    dataEffettiva: date("data_effettiva").notNull(),
    motivo: varchar("motivo", { length: 80 }),
    note: text("note"),
    creatoDa: integer("creato_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    dataCreazione: auditTimestamp("data_creazione"),
  },
  (table) => [
    index("stati_volontari_volontario_data_idx").on(
      table.volontarioId,
      table.dataEffettiva,
      table.id,
    ),
    check(
      "stati_volontari_tipo_check",
      sql`${table.tipoEvento} in ('SOSPENSIONE','RIATTIVAZIONE')`,
    ),
  ],
);

export const copertureAssicurativeVolontariTable = pgTable(
  "coperture_assicurative_volontari",
  {
    id: serial("id").primaryKey(),
    volontarioId: integer("volontario_id")
      .notNull()
      .references(() => volontariTable.id, { onDelete: "restrict" }),
    dataInizio: date("data_inizio"),
    dataFine: date("data_fine").notNull(),
    durataMesi: integer("durata_mesi"),
    tipoOperazione: varchar("tipo_operazione", { length: 24 }).notNull(),
    riferimentoPolizza: varchar("riferimento_polizza", { length: 120 }),
    note: text("note"),
    gruppoOperazioneId: varchar("gruppo_operazione_id", { length: 64 }),
    chiaveIdempotenza: varchar("chiave_idempotenza", { length: 64 }),
    rettificaDiId: integer("rettifica_di_id"),
    annullata: boolean("annullata").notNull().default(false),
    annullataDa: integer("annullata_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    dataAnnullamento: timestamp("data_annullamento", { withTimezone: true }),
    creatoDa: integer("creato_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    dataCreazione: auditTimestamp("data_creazione"),
  },
  (table) => [
    index("coperture_volontario_date_idx").on(
      table.volontarioId,
      table.dataFine,
      table.dataInizio,
    ),
    index("coperture_gruppo_operazione_idx").on(table.gruppoOperazioneId),
    uniqueIndex("coperture_import_idempotenza_unique")
      .on(table.chiaveIdempotenza)
      .where(
        sql`${table.chiaveIdempotenza} is not null and ${table.tipoOperazione} = 'IMPORTAZIONE' and ${table.annullata} = false`,
      ),
    check(
      "coperture_tipo_operazione_check",
      sql`${table.tipoOperazione} in ('IMPORTAZIONE','NUOVA_COPERTURA','RINNOVO','RETTIFICA')`,
    ),
    check(
      "coperture_date_check",
      sql`${table.dataInizio} is null or ${table.dataFine} >= ${table.dataInizio}`,
    ),
    check(
      "coperture_durata_check",
      sql`${table.durataMesi} is null or ${table.durataMesi} > 0`,
    ),
  ],
);

export const giornateServizioVolontariTable = pgTable(
  "giornate_servizio_volontari",
  {
    id: serial("id").primaryKey(),
    volontarioId: integer("volontario_id")
      .notNull()
      .references(() => volontariTable.id, { onDelete: "restrict" }),
    dataServizio: date("data_servizio").notNull(),
    centroAscoltoId: integer("centro_ascolto_id").references(
      () => centriAscoltoTable.id,
      { onDelete: "restrict" },
    ),
    attivita: varchar("attivita", { length: 200 }),
    stato: varchar("stato", { length: 20 }).notNull().default("PIANIFICATA"),
    coperturaVerificata: boolean("copertura_verificata").notNull().default(false),
    note: text("note"),
    chiaveIdempotenza: varchar("chiave_idempotenza", { length: 64 }),
    versione: integer("versione").notNull().default(1),
    creatoDa: integer("creato_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    dataCreazione: auditTimestamp("data_creazione"),
    dataAggiornamento: auditTimestamp("data_aggiornamento"),
  },
  (table) => [
    uniqueIndex("giornate_servizio_volontario_data_centro_unique").on(
      table.volontarioId,
      table.dataServizio,
      table.centroAscoltoId,
    ),
    uniqueIndex("giornate_servizio_import_idempotenza_unique")
      .on(table.chiaveIdempotenza)
      .where(sql`${table.chiaveIdempotenza} is not null`),
    index("giornate_servizio_data_idx").on(table.dataServizio, table.stato),
    check(
      "giornate_servizio_stato_check",
      sql`${table.stato} in ('PIANIFICATA','PRESENTE','ASSENTE','ANNULLATA')`,
    ),
    check("giornate_servizio_versione_check", sql`${table.versione} > 0`),
  ],
);

export const corsiVolontariCatalogoTable = pgTable(
  "corsi_volontari_catalogo",
  {
    id: serial("id").primaryKey(),
    codice: varchar("codice", { length: 40 }).notNull(),
    titolo: varchar("titolo", { length: 160 }).notNull(),
    descrizione: text("descrizione"),
    ore: integer("ore").notNull().default(0),
    enteDocente: varchar("ente_docente", { length: 160 }),
    validitaMesi: integer("validita_mesi"),
    attivo: boolean("attivo").notNull().default(true),
    versione: integer("versione").notNull().default(1),
    dataCreazione: auditTimestamp("data_creazione"),
    dataAggiornamento: auditTimestamp("data_aggiornamento"),
  },
  (table) => [
    uniqueIndex("corsi_volontari_codice_unique").on(table.codice),
    check("corsi_volontari_ore_check", sql`${table.ore} >= 0`),
    check(
      "corsi_volontari_validita_check",
      sql`${table.validitaMesi} is null or ${table.validitaMesi} > 0`,
    ),
  ],
);

export const corsiVolontariRuoliTable = pgTable(
  "corsi_volontari_ruoli",
  {
    id: serial("id").primaryKey(),
    corsoId: integer("corso_id")
      .notNull()
      .references(() => corsiVolontariCatalogoTable.id, { onDelete: "cascade" }),
    ruoloVolontarioId: integer("ruolo_volontario_id")
      .notNull()
      .references(() => ruoliVolontariTable.id, { onDelete: "restrict" }),
    livello: varchar("livello", { length: 20 }).notNull().default("CONSIGLIATO"),
  },
  (table) => [
    uniqueIndex("corsi_volontari_ruoli_unique").on(
      table.corsoId,
      table.ruoloVolontarioId,
    ),
    check(
      "corsi_volontari_ruoli_livello_check",
      sql`${table.livello} in ('OBBLIGATORIO','CONSIGLIATO')`,
    ),
  ],
);

export const corsiDeiVolontariTable = pgTable(
  "corsi_dei_volontari",
  {
    id: serial("id").primaryKey(),
    volontarioId: integer("volontario_id")
      .notNull()
      .references(() => volontariTable.id, { onDelete: "restrict" }),
    corsoId: integer("corso_id")
      .notNull()
      .references(() => corsiVolontariCatalogoTable.id, { onDelete: "restrict" }),
    dataCompletamento: date("data_completamento").notNull(),
    esito: varchar("esito", { length: 30 }).notNull(),
    ore: integer("ore").notNull().default(0),
    dataScadenza: date("data_scadenza"),
    numeroAttestato: varchar("numero_attestato", { length: 100 }),
    riferimentoDocumento: varchar("riferimento_documento", { length: 255 }),
    note: text("note"),
    verificatoDa: integer("verificato_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    versione: integer("versione").notNull().default(1),
    dataCreazione: auditTimestamp("data_creazione"),
    dataAggiornamento: auditTimestamp("data_aggiornamento"),
  },
  (table) => [
    index("corsi_dei_volontari_volontario_idx").on(table.volontarioId),
    check("corsi_dei_volontari_ore_check", sql`${table.ore} >= 0`),
  ],
);

export const qualificheVolontariCatalogoTable = pgTable(
  "qualifiche_volontari_catalogo",
  {
    id: serial("id").primaryKey(),
    codice: varchar("codice", { length: 40 }).notNull(),
    nome: varchar("nome", { length: 160 }).notNull(),
    descrizione: text("descrizione"),
    validitaMesi: integer("validita_mesi"),
    attivo: boolean("attivo").notNull().default(true),
    versione: integer("versione").notNull().default(1),
    dataCreazione: auditTimestamp("data_creazione"),
    dataAggiornamento: auditTimestamp("data_aggiornamento"),
  },
  (table) => [
    uniqueIndex("qualifiche_volontari_codice_unique").on(table.codice),
    check(
      "qualifiche_volontari_validita_check",
      sql`${table.validitaMesi} is null or ${table.validitaMesi} > 0`,
    ),
  ],
);

export const qualificheVolontariRuoliTable = pgTable(
  "qualifiche_volontari_ruoli",
  {
    id: serial("id").primaryKey(),
    qualificaId: integer("qualifica_id")
      .notNull()
      .references(() => qualificheVolontariCatalogoTable.id, { onDelete: "cascade" }),
    ruoloVolontarioId: integer("ruolo_volontario_id")
      .notNull()
      .references(() => ruoliVolontariTable.id, { onDelete: "restrict" }),
    livello: varchar("livello", { length: 20 }).notNull().default("CONSIGLIATO"),
  },
  (table) => [
    uniqueIndex("qualifiche_volontari_ruoli_unique").on(
      table.qualificaId,
      table.ruoloVolontarioId,
    ),
    check(
      "qualifiche_volontari_ruoli_livello_check",
      sql`${table.livello} in ('OBBLIGATORIO','CONSIGLIATO')`,
    ),
  ],
);

export const qualificheDeiVolontariTable = pgTable(
  "qualifiche_dei_volontari",
  {
    id: serial("id").primaryKey(),
    volontarioId: integer("volontario_id")
      .notNull()
      .references(() => volontariTable.id, { onDelete: "restrict" }),
    qualificaId: integer("qualifica_id")
      .notNull()
      .references(() => qualificheVolontariCatalogoTable.id, {
        onDelete: "restrict",
      }),
    dataOttenimento: date("data_ottenimento").notNull(),
    dataScadenza: date("data_scadenza"),
    stato: varchar("stato", { length: 20 }).notNull().default("VALIDA"),
    riferimentoDocumento: varchar("riferimento_documento", { length: 255 }),
    corsoOrigineId: integer("corso_origine_id").references(
      () => corsiDeiVolontariTable.id,
      { onDelete: "set null" },
    ),
    note: text("note"),
    versione: integer("versione").notNull().default(1),
    dataCreazione: auditTimestamp("data_creazione"),
    dataAggiornamento: auditTimestamp("data_aggiornamento"),
  },
  (table) => [
    index("qualifiche_dei_volontari_volontario_idx").on(table.volontarioId),
    check(
      "qualifiche_dei_volontari_stato_check",
      sql`${table.stato} in ('VALIDA','SCADUTA','SOSPESA','REVOCATA')`,
    ),
  ],
);

export const configurazioniMatricoleVolontariTable = pgTable(
  "configurazioni_matricole_volontari",
  {
    id: serial("id").primaryKey(),
    scopeTipo: varchar("scope_tipo", { length: 16 }).notNull().default("GLOBALE"),
    versione: integer("versione").notNull(),
    prefissoAssociazione: varchar("prefisso_associazione", { length: 12 }),
    includiCodiceArea: boolean("includi_codice_area").notNull().default(true),
    segmentoFisso: varchar("segmento_fisso", { length: 8 }),
    separatore: varchar("separatore", { length: 1 }).notNull().default("-"),
    cifreProgressivo: integer("cifre_progressivo").notNull().default(3),
    numeroIniziale: integer("numero_iniziale").notNull().default(1),
    ambitoProgressivo: varchar("ambito_progressivo", { length: 16 })
      .notNull()
      .default("PER_AREA"),
    attiva: boolean("attiva").notNull().default(true),
    aggiornataDa: integer("aggiornata_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    dataCreazione: auditTimestamp("data_creazione"),
    dataAggiornamento: auditTimestamp("data_aggiornamento"),
  },
  (table) => [
    uniqueIndex("config_matricole_versione_unique").on(table.versione),
    uniqueIndex("config_matricole_attiva_scope_unique")
      .on(table.scopeTipo)
      .where(sql`${table.attiva} = true`),
    check("config_matricole_scope_check", sql`${table.scopeTipo} = 'GLOBALE'`),
    check(
      "config_matricole_separatore_check",
      sql`${table.separatore} in ('','-','/')`,
    ),
    check(
      "config_matricole_cifre_check",
      sql`${table.cifreProgressivo} between 2 and 8`,
    ),
    check(
      "config_matricole_iniziale_check",
      sql`${table.numeroIniziale} > 0`,
    ),
    check(
      "config_matricole_ambito_check",
      sql`${table.ambitoProgressivo} in ('GLOBALE','PER_AREA')`,
    ),
  ],
);

export const progressiviMatricoleVolontariTable = pgTable(
  "progressivi_matricole_volontari",
  {
    id: serial("id").primaryKey(),
    configurazioneId: integer("configurazione_id")
      .notNull()
      .references(() => configurazioniMatricoleVolontariTable.id, {
        onDelete: "restrict",
      }),
    scopeTipo: varchar("scope_tipo", { length: 16 }).notNull(),
    scopeKey: varchar("scope_key", { length: 80 }).notNull(),
    areaOperativaId: integer("area_operativa_id").references(
      () => areeOperativeTable.id,
      { onDelete: "restrict" },
    ),
    ultimoNumero: integer("ultimo_numero").notNull(),
    versione: integer("versione").notNull().default(1),
    dataAggiornamento: auditTimestamp("data_aggiornamento"),
  },
  (table) => [
    uniqueIndex("progressivi_matricole_config_scope_unique").on(
      table.configurazioneId,
      table.scopeKey,
    ),
    check(
      "progressivi_matricole_scope_check",
      sql`${table.scopeTipo} in ('GLOBALE','AREA')`,
    ),
    check("progressivi_matricole_numero_check", sql`${table.ultimoNumero} > 0`),
  ],
);

export const matricoleVolontariTable = pgTable(
  "matricole_volontari",
  {
    id: serial("id").primaryKey(),
    volontarioId: integer("volontario_id")
      .notNull()
      .references(() => volontariTable.id, { onDelete: "restrict" }),
    matricola: varchar("matricola", { length: 40 }).notNull(),
    matricolaNormalizzata: varchar("matricola_normalizzata", { length: 40 })
      .notNull(),
    tipoIdentificativo: varchar("tipo_identificativo", { length: 16 }).notNull(),
    stato: varchar("stato", { length: 16 }).notNull(),
    origine: varchar("origine", { length: 16 }).notNull(),
    dataInizioValidita: date("data_inizio_validita").notNull(),
    dataFineValidita: date("data_fine_validita"),
    assegnataDa: integer("assegnata_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    configurazioneId: integer("configurazione_id").references(
      () => configurazioniMatricoleVolontariTable.id,
      { onDelete: "restrict" },
    ),
    configurazioneVersione: integer("configurazione_versione"),
    snapshotRegola: jsonb("snapshot_regola")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    noteTecniche: varchar("note_tecniche", { length: 240 }),
    dataAssegnazione: auditTimestamp("data_assegnazione"),
  },
  (table) => [
    uniqueIndex("matricole_volontari_normalizzata_unique").on(
      table.matricolaNormalizzata,
    ),
    uniqueIndex("matricole_volontari_attiva_unique")
      .on(table.volontarioId)
      .where(sql`${table.stato} = 'ATTIVA'`),
    index("matricole_volontari_volontario_idx").on(
      table.volontarioId,
      table.dataInizioValidita,
    ),
    check(
      "matricole_volontari_tipo_check",
      sql`${table.tipoIdentificativo} in ('TEMPORANEA','PERMANENTE','LEGACY')`,
    ),
    check(
      "matricole_volontari_stato_check",
      sql`${table.stato} in ('ATTIVA','STORICA')`,
    ),
    check(
      "matricole_volontari_origine_check",
      sql`${table.origine} in ('GENERATA','IMPORTATA','CONVERSIONE','BACKFILL')`,
    ),
    check(
      "matricole_volontari_validita_check",
      sql`${table.dataFineValidita} is null or ${table.dataFineValidita} >= ${table.dataInizioValidita}`,
    ),
  ],
);

export const importazioniVolontariTable = pgTable(
  "importazioni_volontari",
  {
    id: serial("id").primaryKey(),
    nomeFile: varchar("nome_file", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 150 }).notNull(),
    dimensioneBytes: integer("dimensione_bytes").notNull(),
    sha256File: varchar("sha256_file", { length: 64 }).notNull(),
    hashContenutoNormalizzato: varchar("hash_contenuto_normalizzato", {
      length: 64,
    }).notNull(),
    chiaveIdempotenza: varchar("chiave_idempotenza", { length: 64 }),
    hashDecisioniFinali: varchar("hash_decisioni_finali", { length: 64 }),
    centroAscoltoId: integer("centro_ascolto_id").references(
      () => centriAscoltoTable.id,
      { onDelete: "restrict" },
    ),
    scopeTipo: varchar("scope_tipo", { length: 16 }).notNull(),
    scopeCentroId: integer("scope_centro_id").references(
      () => centriAscoltoTable.id,
      { onDelete: "restrict" },
    ),
    scopeAreaOperativaId: integer("scope_area_operativa_id").references(
      () => areeOperativeTable.id,
      { onDelete: "restrict" },
    ),
    scopeCentroIdsSnapshot: jsonb("scope_centro_ids_snapshot")
      .$type<number[]>()
      .notNull()
      .default([]),
    scopeFingerprint: varchar("scope_fingerprint", { length: 64 }).notNull(),
    stato: varchar("stato", { length: 20 }).notNull().default("ANALIZZATO"),
    numeroRighe: integer("numero_righe").notNull().default(0),
    creati: integer("creati").notNull().default(0),
    aggiornati: integer("aggiornati").notNull().default(0),
    invariati: integer("invariati").notNull().default(0),
    esclusi: integer("esclusi").notNull().default(0),
    errori: integer("errori").notNull().default(0),
    creatoDa: integer("creato_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    confermatoDa: integer("confermato_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    dataCreazione: auditTimestamp("data_creazione"),
    dataConferma: timestamp("data_conferma", { withTimezone: true }),
  },
  (table) => [
    index("importazioni_volontari_hash_idx").on(table.sha256File),
    index("importazioni_volontari_scope_idx").on(table.centroAscoltoId),
    index("importazioni_volontari_scope_owner_idx").on(
      table.scopeTipo,
      table.scopeCentroId,
      table.scopeAreaOperativaId,
      table.id,
    ),
    uniqueIndex("importazioni_volontari_confermate_idempotenza_unique")
      .on(table.chiaveIdempotenza)
      .where(
        sql`${table.chiaveIdempotenza} is not null and ${table.stato} = 'CONFERMATO'`,
      ),
    check(
      "importazioni_volontari_stato_check",
      sql`${table.stato} in ('ANALIZZATO','CONFERMATO','PARZIALE','FALLITO')`,
    ),
    check(
      "importazioni_volontari_sha_check",
      sql`${table.sha256File} ~ '^[0-9a-f]{64}$' and ${table.hashContenutoNormalizzato} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "importazioni_volontari_scope_tipo_check",
      sql`(
        (${table.scopeTipo} = 'CENTRO' and ${table.scopeCentroId} is not null)
        or (${table.scopeTipo} = 'AREA' and ${table.scopeCentroId} is null and ${table.scopeAreaOperativaId} is not null)
        or (${table.scopeTipo} = 'GLOBALE' and ${table.scopeCentroId} is null and ${table.scopeAreaOperativaId} is null)
      )`,
    ),
    check(
      "importazioni_volontari_scope_fingerprint_check",
      sql`${table.scopeFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const importazioniVolontariRigheTable = pgTable(
  "importazioni_volontari_righe",
  {
    id: serial("id").primaryKey(),
    importazioneId: integer("importazione_id")
      .notNull()
      .references(() => importazioniVolontariTable.id, { onDelete: "cascade" }),
    numeroRiga: integer("numero_riga").notNull(),
    statoRiga: varchar("stato_riga", { length: 30 }).notNull(),
    hashRiga: varchar("hash_riga", { length: 64 }).notNull(),
    datiOriginali: jsonb("dati_originali").$type<Record<string, unknown>>().notNull(),
    datiNormalizzati: jsonb("dati_normalizzati").$type<Record<string, unknown>>().notNull(),
    volontarioCandidatoId: integer("volontario_candidato_id").references(
      () => volontariTable.id,
      { onDelete: "set null" },
    ),
    versioneCandidato: integer("versione_candidato"),
    fingerprintCandidato: varchar("fingerprint_candidato", { length: 64 }),
    fingerprintMappingPreview: varchar("fingerprint_mapping_preview", {
      length: 64,
    }),
    dataAnalisi: auditTimestamp("data_analisi"),
    ruoloPropostoId: integer("ruolo_proposto_id").references(
      () => ruoliVolontariTable.id,
      { onDelete: "set null" },
    ),
    centroPropostoId: integer("centro_proposto_id").references(
      () => centriAscoltoTable.id,
      { onDelete: "set null" },
    ),
    errori: jsonb("errori").$type<string[]>().notNull().default([]),
    avvisi: jsonb("avvisi").$type<string[]>().notNull().default([]),
    esclusa: boolean("esclusa").notNull().default(false),
    esitoCommit: varchar("esito_commit", { length: 30 }),
    volontarioRisultatoId: integer("volontario_risultato_id").references(
      () => volontariTable.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    uniqueIndex("importazioni_volontari_righe_unique").on(
      table.importazioneId,
      table.numeroRiga,
    ),
    index("importazioni_volontari_righe_preview_idx").on(
      table.importazioneId,
      table.statoRiga,
    ),
  ],
);

export const registroVolontariEventiTable = pgTable(
  "registro_volontari_eventi",
  {
    id: serial("id").primaryKey(),
    progressivo: integer("progressivo").notNull(),
    sezione: varchar("sezione", { length: 24 }).notNull(),
    tipoEvento: varchar("tipo_evento", { length: 40 }).notNull(),
    volontarioId: integer("volontario_id")
      .notNull()
      .references(() => volontariTable.id, { onDelete: "restrict" }),
    centroAscoltoId: integer("centro_ascolto_id").references(
      () => centriAscoltoTable.id,
      { onDelete: "restrict" },
    ),
    dataEffettiva: date("data_effettiva").notNull(),
    timestampInserimento: auditTimestamp("timestamp_inserimento"),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    utenteId: integer("utente_id").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    eventoRettificatoId: integer("evento_rettificato_id"),
    hashPrecedente: varchar("hash_precedente", { length: 64 }),
    hashEvento: varchar("hash_evento", { length: 64 }).notNull(),
  },
  (table) => [
    uniqueIndex("registro_volontari_progressivo_unique").on(table.progressivo),
    uniqueIndex("registro_volontari_hash_unique").on(table.hashEvento),
    index("registro_volontari_volontario_idx").on(
      table.volontarioId,
      table.dataEffettiva,
    ),
    check(
      "registro_volontari_sezione_check",
      sql`${table.sezione} in ('PERMANENTE','TEMPORANEO')`,
    ),
    check(
      "registro_volontari_evento_check",
      sql`${table.tipoEvento} in ('REGISTRAZIONE','SOSPENSIONE_CESSAZIONE','RIATTIVAZIONE','GIORNATA_TEMPORANEA','CONVERSIONE_PERMANENTE','AGGIORNAMENTO_ANAGRAFICA','RETTIFICA')`,
    ),
  ],
);

export const emissioniRegistroVolontariTable = pgTable(
  "emissioni_registro_volontari",
  {
    id: serial("id").primaryKey(),
    tipo: varchar("tipo", { length: 20 }).notNull(),
    sezione: varchar("sezione", { length: 24 }),
    centroAscoltoId: integer("centro_ascolto_id").references(
      () => centriAscoltoTable.id,
      { onDelete: "restrict" },
    ),
    scopeTipo: varchar("scope_tipo", { length: 16 }).notNull(),
    scopeCentroId: integer("scope_centro_id").references(
      () => centriAscoltoTable.id,
      { onDelete: "restrict" },
    ),
    scopeAreaOperativaId: integer("scope_area_operativa_id").references(
      () => areeOperativeTable.id,
      { onDelete: "restrict" },
    ),
    scopeCentroIdsSnapshot: jsonb("scope_centro_ids_snapshot")
      .$type<number[]>()
      .notNull()
      .default([]),
    scopeFingerprint: varchar("scope_fingerprint", { length: 64 }).notNull(),
    filtri: jsonb("filtri").$type<Record<string, unknown>>().notNull(),
    dataRiferimento: date("data_riferimento").notNull(),
    generatoDa: integer("generato_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    generatoAt: auditTimestamp("generato_at"),
    numeroRighe: integer("numero_righe").notNull(),
    hashFile: varchar("hash_file", { length: 64 }).notNull(),
    hashSnapshot: varchar("hash_snapshot", { length: 64 }).notNull(),
    versioneLayout: varchar("versione_layout", { length: 40 }).notNull(),
    snapshot: jsonb("snapshot").$type<Array<Record<string, unknown>>>().notNull(),
    contenutoBase64: text("contenuto_base64").notNull(),
  },
  (table) => [
    index("emissioni_registro_data_idx").on(table.dataRiferimento, table.generatoAt),
    index("emissioni_registro_scope_idx").on(table.centroAscoltoId),
    index("emissioni_registro_scope_owner_idx").on(
      table.scopeTipo,
      table.scopeCentroId,
      table.scopeAreaOperativaId,
      table.generatoAt,
    ),
    check(
      "emissioni_registro_tipo_check",
      sql`${table.tipo} in ('PDF','XLSX')`,
    ),
    check(
      "emissioni_registro_hash_check",
      sql`${table.hashFile} ~ '^[0-9a-f]{64}$' and ${table.hashSnapshot} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "emissioni_registro_scope_tipo_check",
      sql`(
        (${table.scopeTipo} = 'CENTRO' and ${table.scopeCentroId} is not null)
        or (${table.scopeTipo} = 'AREA' and ${table.scopeCentroId} is null and ${table.scopeAreaOperativaId} is not null)
        or (${table.scopeTipo} = 'GLOBALE' and ${table.scopeCentroId} is null and ${table.scopeAreaOperativaId} is null)
      )`,
    ),
    check(
      "emissioni_registro_scope_fingerprint_check",
      sql`${table.scopeFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type StatoVolontario = typeof statiVolontariTable.$inferSelect;
export type CoperturaAssicurativaVolontario =
  typeof copertureAssicurativeVolontariTable.$inferSelect;
export type GiornataServizioVolontario =
  typeof giornateServizioVolontariTable.$inferSelect;
