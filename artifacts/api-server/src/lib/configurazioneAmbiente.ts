import bcrypt from "bcryptjs";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  ambienteModuliTable,
  auditConfigurazioniTable,
  configurazioneAmbienteTable,
  db,
  moduliFunzionaliTable,
  utentiTable,
} from "@workspace/db";
import { logger } from "./logger";
import { ensureSuperAdminRole } from "./seedRoles";

export const CONFIGURAZIONE_AMBIENTE_ID = 1;
export const DEFAULT_SUPER_ADMIN_USERNAME = "sadmin";
const DEFAULT_SUPER_ADMIN_PASSWORD = "Apollo13!";

type ModuloSeed = {
  codice: string;
  nome: string;
  descrizione: string;
  categoria: string;
  core: boolean;
  ordine: number;
  attivoDefault: boolean;
};

export const CATALOGO_MODULI: ModuloSeed[] = [
  { codice: "DASHBOARD", nome: "Dashboard", descrizione: "KPI, alert e panoramica operativa.", categoria: "generale", core: true, ordine: 10, attivoDefault: true },
  { codice: "AMMINISTRAZIONE", nome: "Amministrazione", descrizione: "Utenti, ruoli e configurazioni amministrative essenziali.", categoria: "amministrazione", core: true, ordine: 20, attivoDefault: true },
  { codice: "MAGAZZINO", nome: "Magazzino", descrizione: "Base logistica di magazzino.", categoria: "magazzino", core: true, ordine: 30, attivoDefault: true },
  { codice: "PRODOTTI", nome: "Prodotti", descrizione: "Catalogo prodotti e anagrafiche merce.", categoria: "magazzino", core: true, ordine: 40, attivoDefault: true },
  { codice: "GIACENZE", nome: "Giacenze", descrizione: "Disponibilità e stock per magazzino.", categoria: "magazzino", core: true, ordine: 50, attivoDefault: true },
  { codice: "LOTTI", nome: "Lotti", descrizione: "Lotti, scadenze e tracciabilità FEFO.", categoria: "magazzino", core: false, ordine: 60, attivoDefault: true },
  { codice: "CARICHI", nome: "Carichi", descrizione: "Carico merce e movimenti in ingresso.", categoria: "magazzino", core: false, ordine: 70, attivoDefault: true },
  { codice: "SCARICHI", nome: "Scarichi", descrizione: "Scarichi e documenti di uscita merce.", categoria: "magazzino", core: false, ordine: 80, attivoDefault: true },
  { codice: "TRASFERIMENTI", nome: "Trasferimenti", descrizione: "Trasferimenti interni tra magazzini.", categoria: "magazzino", core: false, ordine: 90, attivoDefault: true },
  { codice: "FORNITORI", nome: "Fornitori", descrizione: "Fornitori, donatori e tipologie.", categoria: "logistica", core: false, ordine: 100, attivoDefault: true },
  { codice: "APPROVVIGIONAMENTI", nome: "Approvvigionamenti", descrizione: "Ordini e richieste di approvvigionamento.", categoria: "logistica", core: false, ordine: 110, attivoDefault: true },
  { codice: "BENEFICIARI", nome: "Beneficiari", descrizione: "Anagrafica beneficiari e dossier familiare.", categoria: "sociale", core: false, ordine: 120, attivoDefault: true },
  { codice: "INTERVENTI", nome: "Interventi", descrizione: "Interventi sociali e UDS.", categoria: "sociale", core: false, ordine: 130, attivoDefault: true },
  { codice: "BOLLE", nome: "Bolle", descrizione: "Bolle e documenti di consegna.", categoria: "sociale", core: false, ordine: 140, attivoDefault: true },
  { codice: "CONSEGNE", nome: "Consegne", descrizione: "Pianificazione e completamento consegne.", categoria: "sociale", core: false, ordine: 150, attivoDefault: true },
  { codice: "LOGISTICA", nome: "Logistica", descrizione: "Area logistica e coordinamento operativo.", categoria: "logistica", core: false, ordine: 160, attivoDefault: true },
  { codice: "MEZZI", nome: "Mezzi", descrizione: "Parco mezzi e approvazioni.", categoria: "logistica", core: false, ordine: 170, attivoDefault: true },
  { codice: "VOLONTARI", nome: "Volontari", descrizione: "Anagrafica volontari e ruoli.", categoria: "logistica", core: false, ordine: 180, attivoDefault: true },
  { codice: "UDS", nome: "Unità di Strada", descrizione: "Anagrafica, interventi e report Unità di Strada.", categoria: "uds", core: false, ordine: 190, attivoDefault: true },
  { codice: "EMPORIO_SOLIDALE", nome: "Emporio Solidale", descrizione: "Accessi, cassa e operatività Emporio.", categoria: "emporio", core: false, ordine: 200, attivoDefault: true },
  { codice: "CREDITO_SOLIDALE", nome: "Credito Solidale", descrizione: "Credito, saldi, ricariche e movimenti.", categoria: "emporio", core: false, ordine: 210, attivoDefault: true },
  { codice: "REPORT", nome: "Report", descrizione: "Report operativi base.", categoria: "analisi", core: false, ordine: 220, attivoDefault: true },
  { codice: "REPORT_AVANZATI", nome: "Report avanzati", descrizione: "Analisi avanzate e viste specialistiche.", categoria: "analisi", core: false, ordine: 230, attivoDefault: true },
  { codice: "PREDITTIVO", nome: "Predittivo", descrizione: "Funzionalità predittive future.", categoria: "analisi", core: false, ordine: 240, attivoDefault: true },
  { codice: "BARCODE", nome: "Barcode", descrizione: "Scanner, codici a barre e PDF etichette.", categoria: "magazzino", core: false, ordine: 250, attivoDefault: true },
];

export type ConfigurazioneAmbienteDto = {
  id: number;
  codiceAmbiente: string;
  nomeAmbiente: string;
  nomeAssociazione: string;
  descrizione: string | null;
  indirizzo: string | null;
  comune: string | null;
  provincia: string | null;
  codiceFiscale: string | null;
  partitaIva: string | null;
  email: string | null;
  telefono: string | null;
  sitoWeb: string | null;
  logoDocumentiUrl: string | null;
  logoTessereUrl: string | null;
  footerDocumenti: string | null;
  noteLegali: string | null;
  privacyTestoBreve: string | null;
  attivo: boolean;
  dataCreazione: string;
  dataAggiornamento: string;
  aggiornatoDaId: number | null;
};

export type ModuloFunzionaleDto = {
  id: number;
  codice: string;
  nome: string;
  descrizione: string | null;
  categoria: string;
  core: boolean;
  ordine: number;
  attivoDefault: boolean;
  attivo: boolean;
  dataCreazione: string;
  dataAggiornamento: string;
  ambienteModuloId: number | null;
  abilitatoDaId: number | null;
};

export type ConfigurazioneAmbientePubblicaDto = {
  configurazione: ConfigurazioneAmbienteDto;
  moduli: ModuloFunzionaleDto[];
  moduliAttivi: string[];
};

function fmtConfigurazione(row: typeof configurazioneAmbienteTable.$inferSelect): ConfigurazioneAmbienteDto {
  return {
    id: row.id,
    codiceAmbiente: row.codiceAmbiente,
    nomeAmbiente: row.nomeAmbiente,
    nomeAssociazione: row.nomeAssociazione,
    descrizione: row.descrizione ?? null,
    indirizzo: row.indirizzo ?? null,
    comune: row.comune ?? null,
    provincia: row.provincia ?? null,
    codiceFiscale: row.codiceFiscale ?? null,
    partitaIva: row.partitaIva ?? null,
    email: row.email ?? null,
    telefono: row.telefono ?? null,
    sitoWeb: row.sitoWeb ?? null,
    logoDocumentiUrl: row.logoDocumentiUrl ?? null,
    logoTessereUrl: row.logoTessereUrl ?? null,
    footerDocumenti: row.footerDocumenti ?? null,
    noteLegali: row.noteLegali ?? null,
    privacyTestoBreve: row.privacyTestoBreve ?? null,
    attivo: row.attivo,
    dataCreazione: row.dataCreazione.toISOString(),
    dataAggiornamento: row.dataAggiornamento.toISOString(),
    aggiornatoDaId: row.aggiornatoDaId ?? null,
  };
}

function fmtModulo(row: {
  m: typeof moduliFunzionaliTable.$inferSelect;
  am: typeof ambienteModuliTable.$inferSelect | null;
}): ModuloFunzionaleDto {
  return {
    id: row.m.id,
    codice: row.m.codice,
    nome: row.m.nome,
    descrizione: row.m.descrizione ?? null,
    categoria: row.m.categoria,
    core: row.m.core,
    ordine: row.m.ordine,
    attivoDefault: row.m.attivoDefault,
    attivo: row.m.core || (row.am?.attivo ?? row.m.attivoDefault),
    dataCreazione: row.m.dataCreazione.toISOString(),
    dataAggiornamento: row.m.dataAggiornamento.toISOString(),
    ambienteModuloId: row.am?.id ?? null,
    abilitatoDaId: row.am?.abilitatoDaId ?? null,
  };
}

export async function ensureConfigurazioneAmbiente(): Promise<typeof configurazioneAmbienteTable.$inferSelect> {
  await db
    .insert(configurazioneAmbienteTable)
    .values({ id: CONFIGURAZIONE_AMBIENTE_ID })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(configurazioneAmbienteTable)
    .where(eq(configurazioneAmbienteTable.id, CONFIGURAZIONE_AMBIENTE_ID));
  return row;
}

export async function ensureCatalogoModuli(): Promise<void> {
  for (const modulo of CATALOGO_MODULI) {
    await db
      .insert(moduliFunzionaliTable)
      .values(modulo)
      .onConflictDoUpdate({
        target: moduliFunzionaliTable.codice,
        set: {
          nome: modulo.nome,
          descrizione: modulo.descrizione,
          categoria: modulo.categoria,
          core: modulo.core,
          ordine: modulo.ordine,
          attivoDefault: modulo.attivoDefault,
          dataAggiornamento: new Date(),
        },
      });
  }
}

export async function ensureAmbienteModuli(): Promise<void> {
  const configurazione = await ensureConfigurazioneAmbiente();
  await ensureCatalogoModuli();
  const moduli = await db.select().from(moduliFunzionaliTable);
  for (const modulo of moduli) {
    await db
      .insert(ambienteModuliTable)
      .values({
        configurazioneAmbienteId: configurazione.id,
        moduloId: modulo.id,
        attivo: modulo.core || modulo.attivoDefault,
      })
      .onConflictDoNothing();
  }
}

export async function ensureDefaultSuperAdminUser(): Promise<void> {
  const superAdminRoleId = await ensureSuperAdminRole();
  const passwordHash = await bcrypt.hash(DEFAULT_SUPER_ADMIN_PASSWORD, 10);
  const [existing] = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(eq(utentiTable.username, DEFAULT_SUPER_ADMIN_USERNAME));

  if (existing) {
    await db
      .update(utentiTable)
      .set({
        passwordHash,
        ruoloId: superAdminRoleId,
        isSuperAdmin: true,
        attivo: true,
        mustChangePassword: false,
        centroAscoltoId: null,
        cittaId: null,
        zonaUdsId: null,
      })
      .where(eq(utentiTable.id, existing.id));
    return;
  }

  await db.insert(utentiTable).values({
    username: DEFAULT_SUPER_ADMIN_USERNAME,
    passwordHash,
    nome: "Super",
    cognome: "Admin",
    ruoloId: superAdminRoleId,
    centroAscoltoId: null,
    cittaId: null,
    zonaUdsId: null,
    attivo: true,
    isSuperAdmin: true,
    mustChangePassword: false,
  });
  logger.info({ username: DEFAULT_SUPER_ADMIN_USERNAME }, "Seeded default SuperAdmin user");
}

export async function ensureFase5Bootstrap(): Promise<void> {
  await ensureConfigurazioneAmbiente();
  await ensureAmbienteModuli();
  await ensureDefaultSuperAdminUser();
}

export async function getConfigurazioneAmbiente(): Promise<ConfigurazioneAmbienteDto> {
  return fmtConfigurazione(await ensureConfigurazioneAmbiente());
}

export async function listModuliFunzionali(): Promise<ModuloFunzionaleDto[]> {
  const configurazione = await ensureConfigurazioneAmbiente();
  await ensureAmbienteModuli();
  const rows = await db
    .select({ m: moduliFunzionaliTable, am: ambienteModuliTable })
    .from(moduliFunzionaliTable)
    .leftJoin(
      ambienteModuliTable,
      and(
        eq(ambienteModuliTable.moduloId, moduliFunzionaliTable.id),
        eq(ambienteModuliTable.configurazioneAmbienteId, configurazione.id),
      ),
    )
    .orderBy(asc(moduliFunzionaliTable.ordine), asc(moduliFunzionaliTable.codice));
  return rows.map(fmtModulo);
}

export async function getConfigurazioneAmbientePubblica(): Promise<ConfigurazioneAmbientePubblicaDto> {
  const configurazione = await getConfigurazioneAmbiente();
  const moduli = await listModuliFunzionali();
  return {
    configurazione,
    moduli,
    moduliAttivi: moduli.filter((m) => m.attivo).map((m) => m.codice),
  };
}

export async function updateConfigurazioneAmbiente(
  updates: Partial<typeof configurazioneAmbienteTable.$inferInsert>,
): Promise<ConfigurazioneAmbienteDto> {
  await ensureConfigurazioneAmbiente();
  const [row] = await db
    .update(configurazioneAmbienteTable)
    .set({ ...updates, dataAggiornamento: new Date() })
    .where(eq(configurazioneAmbienteTable.id, CONFIGURAZIONE_AMBIENTE_ID))
    .returning();
  return fmtConfigurazione(row);
}

export async function updateModuloAmbiente(
  codice: string,
  attivo: boolean,
  abilitatoDaId: number | null,
): Promise<ModuloFunzionaleDto | { error: string; status: number }> {
  await ensureAmbienteModuli();
  const normalized = codice.trim().toUpperCase();
  const [modulo] = await db
    .select()
    .from(moduliFunzionaliTable)
    .where(eq(moduliFunzionaliTable.codice, normalized));
  if (!modulo) return { error: "Modulo funzionale non trovato", status: 404 };
  if (modulo.core && !attivo) {
    return { error: "I moduli core non possono essere disabilitati", status: 400 };
  }

  const configurazione = await ensureConfigurazioneAmbiente();
  const finalAttivo = modulo.core ? true : attivo;
  await db
    .insert(ambienteModuliTable)
    .values({
      configurazioneAmbienteId: configurazione.id,
      moduloId: modulo.id,
      attivo: finalAttivo,
      abilitatoDaId,
      dataAggiornamento: new Date(),
    })
    .onConflictDoUpdate({
      target: [ambienteModuliTable.configurazioneAmbienteId, ambienteModuliTable.moduloId],
      set: {
        attivo: finalAttivo,
        abilitatoDaId,
        dataAggiornamento: new Date(),
      },
    });

  const [row] = await db
    .select({ m: moduliFunzionaliTable, am: ambienteModuliTable })
    .from(moduliFunzionaliTable)
    .leftJoin(
      ambienteModuliTable,
      and(
        eq(ambienteModuliTable.moduloId, moduliFunzionaliTable.id),
        eq(ambienteModuliTable.configurazioneAmbienteId, configurazione.id),
      ),
    )
    .where(eq(moduliFunzionaliTable.id, modulo.id));
  return fmtModulo(row);
}

export async function listAuditConfigurazioni(limit = 100) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 100;
  const rows = await db
    .select()
    .from(auditConfigurazioniTable)
    .orderBy(desc(auditConfigurazioniTable.dataOra), desc(auditConfigurazioniTable.id))
    .limit(safeLimit);
  return rows.map((r) => ({
    id: r.id,
    area: r.area,
    chiave: r.chiave,
    valorePrecedente: r.valorePrecedente ?? null,
    valoreNuovo: r.valoreNuovo ?? null,
    utenteId: r.utenteId ?? null,
    azione: r.azione,
    dataOra: r.dataOra.toISOString(),
    ip: r.ip ?? null,
    note: r.note ?? null,
  }));
}
