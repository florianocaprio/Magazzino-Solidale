import bcrypt from "bcryptjs";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  bolleTable,
  centriAscoltoTable,
  cittaTable,
  consegneTable,
  creditoSolidaleMovimentiTable,
  db,
  interventiTable,
  magazziniTable,
  nucleoFamiliareTable,
  prodottiTable,
  ruoliTable,
  sessioniCassaEmporioTable,
  speseEmporioTable,
  userSessionsTable,
  utentiTable,
  zoneUdsTable,
} from "@workspace/db";
import {
  DEMO_AREA_NAME,
  DEMO_CENTRO_NAME,
  DEMO_MARKER,
  DEMO_PRODUCT_CODES,
  DEMO_WAREHOUSE_CODES,
  resetDemoWarehouseData,
  seedDemoWarehouseData,
  type EnvironmentDataSummary,
} from "./environmentData";
import { EMPORIO_ROLE_NAME } from "./seedRoles";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const DEMO_ZONE_NAME = "Zona UDS Demo";
export const DEMO_USER_USERNAME = "operatore.demo";
export const DEMO_USER_MATRICOLA = "DEMO-OP-001";
export const DEMO_BENEFICIARY_CODE = "DEMO-BEN-001";
export const DEMO_ACCESS_CODE = "DEMO-EMPORIO-001";

function assertDemoMarker(
  label: string,
  value: string | null | undefined,
): void {
  if (!value?.includes(DEMO_MARKER)) {
    throw new Error(
      `Operazione demo annullata: ${label} esiste senza il marcatore ${DEMO_MARKER}.`,
    );
  }
}

function demoPassword(): string {
  const value = process.env.DEMO_USER_INITIAL_PASSWORD?.trim();
  if (!value || value.length < 12) {
    throw new Error(
      "DEMO_USER_INITIAL_PASSWORD deve contenere almeno 12 caratteri.",
    );
  }
  return value;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function insertAudit(
  tx: Transaction,
  actorUserId: number,
  key: string,
  summary: EnvironmentDataSummary,
  note: string,
): Promise<void> {
  await tx.insert(auditConfigurazioniTable).values({
    area: "dati_ambiente",
    chiave: key,
    azione: key.startsWith("seed") ? "seed_demo" : "reset_demo",
    valoreNuovo: summary,
    utenteId: actorUserId,
    ip: "cli",
    note,
  });
}

/** Adds only synthetic social, UDS and Emporio rows to the warehouse demo set. */
export async function seedDemoEnvironmentData(
  actorUserId: number,
): Promise<EnvironmentDataSummary> {
  const warehouseSummary = await seedDemoWarehouseData(actorUserId);

  const socialSummary = await db.transaction(async (tx) => {
    const [area] = await tx
      .select({ id: cittaTable.id, note: cittaTable.note })
      .from(cittaTable)
      .where(eq(cittaTable.nome, DEMO_AREA_NAME));
    const [centro] = await tx
      .select({ id: centriAscoltoTable.id, note: centriAscoltoTable.note })
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.nome, DEMO_CENTRO_NAME));
    const [emporio] = await tx
      .select({ id: magazziniTable.id, note: magazziniTable.note })
      .from(magazziniTable)
      .where(eq(magazziniTable.codice, DEMO_WAREHOUSE_CODES[1]));
    const [emporioRole] = await tx
      .select({ id: ruoliTable.id })
      .from(ruoliTable)
      .where(eq(ruoliTable.nome, EMPORIO_ROLE_NAME));

    if (!area || !centro || !emporio || !emporioRole) {
      throw new Error("Seed demo incompleto: eseguire prima seed-base.");
    }
    assertDemoMarker("l'area demo", area.note);
    assertDemoMarker("il centro demo", centro.note);
    assertDemoMarker("il magazzino Emporio demo", emporio.note);

    let createdZone = 0;
    let [zone] = await tx
      .select({ id: zoneUdsTable.id, note: zoneUdsTable.note })
      .from(zoneUdsTable)
      .where(
        and(
          eq(zoneUdsTable.nome, DEMO_ZONE_NAME),
          eq(zoneUdsTable.cittaId, area.id),
        ),
      );
    if (zone) assertDemoMarker("la zona UDS demo", zone.note);
    if (!zone) {
      [zone] = await tx
        .insert(zoneUdsTable)
        .values({
          nome: DEMO_ZONE_NAME,
          cittaId: area.id,
          note: `${DEMO_MARKER}: zona UDS sintetica`,
        })
        .returning({ id: zoneUdsTable.id, note: zoneUdsTable.note });
      createdZone = 1;
    }

    let createdUsers = 0;
    let [demoUser] = await tx
      .select({
        id: utentiTable.id,
        matricola: utentiTable.matricola,
        isSuperAdmin: utentiTable.isSuperAdmin,
      })
      .from(utentiTable)
      .where(eq(utentiTable.username, DEMO_USER_USERNAME));
    if (
      demoUser &&
      (demoUser.matricola !== DEMO_USER_MATRICOLA || demoUser.isSuperAdmin)
    ) {
      throw new Error(
        `Seed demo annullato: username ${DEMO_USER_USERNAME} già in uso.`,
      );
    }
    if (!demoUser) {
      [demoUser] = await tx
        .insert(utentiTable)
        .values({
          username: DEMO_USER_USERNAME,
          passwordHash: await bcrypt.hash(demoPassword(), 10),
          nome: "Operatore",
          cognome: "Demo",
          matricola: DEMO_USER_MATRICOLA,
          ruoloId: emporioRole.id,
          centroAscoltoId: centro.id,
          cittaId: area.id,
          zonaUdsId: zone.id,
          attivo: true,
          isSuperAdmin: false,
          mustChangePassword: true,
        })
        .returning({
          id: utentiTable.id,
          matricola: utentiTable.matricola,
          isSuperAdmin: utentiTable.isSuperAdmin,
        });
      createdUsers = 1;
    }

    let createdBeneficiaries = 0;
    let [beneficiary] = await tx
      .select({ id: beneficiariTable.id, note: beneficiariTable.noteInterne })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.codice, DEMO_BENEFICIARY_CODE));
    if (beneficiary) assertDemoMarker("il beneficiario demo", beneficiary.note);
    if (!beneficiary) {
      [beneficiary] = await tx
        .insert(beneficiariTable)
        .values({
          codice: DEMO_BENEFICIARY_CODE,
          cognome: "Demo 001",
          nome: "Beneficiario",
          email: "beneficiario.demo.001@example.org",
          centroAscoltoId: centro.id,
          cittaId: area.id,
          zonaUdsId: zone.id,
          uds: true,
          numComponenti: 1,
          creditoSolidaleAbilitato: true,
          creditoSolidaleStato: "attivo",
          creditoSolidaleDataAbilitazione: new Date(),
          creditoSolidaleMensileAssegnato: "50.00",
          creditoSolidaleSaldo: "50.00",
          magazzinoEmporioPreferitoId: emporio.id,
          noteInterne: `${DEMO_MARKER}: persona interamente sintetica`,
        })
        .returning({
          id: beneficiariTable.id,
          note: beneficiariTable.noteInterne,
        });
      createdBeneficiaries = 1;
    }

    let createdCreditMovements = 0;
    const [creditMovement] = await tx
      .select({ id: creditoSolidaleMovimentiTable.id })
      .from(creditoSolidaleMovimentiTable)
      .where(
        and(
          eq(creditoSolidaleMovimentiTable.beneficiarioId, beneficiary.id),
          eq(creditoSolidaleMovimentiTable.riferimentoTipo, "seed_demo"),
          like(creditoSolidaleMovimentiTable.note, `%${DEMO_MARKER}%`),
        ),
      );
    if (!creditMovement) {
      await tx.insert(creditoSolidaleMovimentiTable).values({
        beneficiarioId: beneficiary.id,
        centroAscoltoId: centro.id,
        cittaId: area.id,
        tipoMovimento: "ricarica_iniziale",
        variazioneCredito: "50.00",
        saldoPrima: "0.00",
        saldoDopo: "50.00",
        periodoRiferimento: isoDate(new Date()).slice(0, 7),
        origine: "seed_demo",
        riferimentoTipo: "seed_demo",
        note: `${DEMO_MARKER}: credito interamente sintetico`,
        operatoreId: actorUserId,
      });
      createdCreditMovements = 1;
    }

    let createdUdsInterventions = 0;
    const [udsIntervention] = await tx
      .select({ id: interventiTable.id })
      .from(interventiTable)
      .where(
        and(
          eq(interventiTable.beneficiarioId, beneficiary.id),
          like(interventiTable.noteUds, `%${DEMO_MARKER}%`),
        ),
      );
    if (!udsIntervention) {
      await tx.insert(interventiTable).values({
        beneficiarioId: beneficiary.id,
        operatoreId: demoUser.id,
        dataIntervento: isoDate(new Date()),
        tipoIntervento: "Contatto UDS Demo",
        descrizione: "Intervento interamente sintetico",
        esito: "Demo completata",
        noteUds: `${DEMO_MARKER}: intervento UDS sintetico`,
      });
      createdUdsInterventions = 1;
    }

    let createdEmporioAccesses = 0;
    const [access] = await tx
      .select({ id: consegneTable.id, note: consegneTable.noteAccessoEmporio })
      .from(consegneTable)
      .where(eq(consegneTable.codice, DEMO_ACCESS_CODE));
    if (access) assertDemoMarker("l'accesso Emporio demo", access.note);
    if (!access) {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await tx.insert(consegneTable).values({
        codice: DEMO_ACCESS_CODE,
        beneficiarioId: beneficiary.id,
        tipoPianificazione: "accesso_emporio",
        tipoConsegna: "accesso_emporio",
        dataPrevista: isoDate(tomorrow),
        magazzinoId: emporio.id,
        magazzinoEmporioId: emporio.id,
        stato: "pianificata",
        statoAccessoEmporio: "pianificato",
        dataOraInizio: tomorrow,
        origineAccesso: "seed_demo",
        noteAccessoEmporio: `${DEMO_MARKER}: accesso Emporio sintetico`,
      });
      createdEmporioAccesses = 1;
    }

    const summary: EnvironmentDataSummary = {
      createdZone,
      createdUsers,
      createdBeneficiaries,
      createdCreditMovements,
      createdUdsInterventions,
      createdEmporioAccesses,
    };
    await insertAudit(
      tx,
      actorUserId,
      "seed_demo_ambiente",
      summary,
      "Seed sintetico ambiente, UDS ed Emporio; nessun dato reale.",
    );
    return summary;
  });

  return { ...warehouseSummary, ...socialSummary };
}

async function demoBeneficiaryIds(tx: Transaction): Promise<number[]> {
  const rows = await tx
    .select({ id: beneficiariTable.id })
    .from(beneficiariTable)
    .where(
      and(
        eq(beneficiariTable.codice, DEMO_BENEFICIARY_CODE),
        like(beneficiariTable.noteInterne, `%${DEMO_MARKER}%`),
      ),
    );
  return rows.map((row) => row.id);
}

async function demoAccessIds(tx: Transaction): Promise<number[]> {
  const rows = await tx
    .select({ id: consegneTable.id })
    .from(consegneTable)
    .where(
      and(
        eq(consegneTable.codice, DEMO_ACCESS_CODE),
        like(consegneTable.noteAccessoEmporio, `%${DEMO_MARKER}%`),
      ),
    );
  return rows.map((row) => row.id);
}

async function deleteDemoEmporio(
  tx: Transaction,
): Promise<EnvironmentDataSummary> {
  const accessIds = await demoAccessIds(tx);
  const beneficiaryIds = await demoBeneficiaryIds(tx);
  const sessions = accessIds.length
    ? await tx
        .select({ id: sessioniCassaEmporioTable.id })
        .from(sessioniCassaEmporioTable)
        .where(inArray(sessioniCassaEmporioTable.accessoEmporioId, accessIds))
    : [];
  const expenses = accessIds.length
    ? await tx
        .select({ id: speseEmporioTable.id })
        .from(speseEmporioTable)
        .where(inArray(speseEmporioTable.accessoEmporioId, accessIds))
    : [];
  if (sessions.length > 0 || expenses.length > 0) {
    throw new Error(
      "Reset demo Emporio annullato: esistono sessioni/spese di cassa. Usare il reset operativo protetto dopo backup.",
    );
  }

  const deletedAccesses = accessIds.length
    ? await tx
        .delete(consegneTable)
        .where(inArray(consegneTable.id, accessIds))
        .returning({ id: consegneTable.id })
    : [];
  const deletedCreditMovements = beneficiaryIds.length
    ? await tx
        .delete(creditoSolidaleMovimentiTable)
        .where(
          and(
            inArray(
              creditoSolidaleMovimentiTable.beneficiarioId,
              beneficiaryIds,
            ),
            like(creditoSolidaleMovimentiTable.note, `%${DEMO_MARKER}%`),
          ),
        )
        .returning({ id: creditoSolidaleMovimentiTable.id })
    : [];
  return {
    deletedEmporioAccesses: deletedAccesses.length,
    deletedCreditMovements: deletedCreditMovements.length,
  };
}

async function deleteDemoUds(tx: Transaction): Promise<EnvironmentDataSummary> {
  const beneficiaryIds = await demoBeneficiaryIds(tx);
  const deletedInterventions = beneficiaryIds.length
    ? await tx
        .delete(interventiTable)
        .where(
          and(
            inArray(interventiTable.beneficiarioId, beneficiaryIds),
            like(interventiTable.noteUds, `%${DEMO_MARKER}%`),
          ),
        )
        .returning({ id: interventiTable.id })
    : [];
  return { deletedUdsInterventions: deletedInterventions.length };
}

async function deleteDemoBeneficiaries(
  tx: Transaction,
): Promise<EnvironmentDataSummary> {
  const beneficiaryIds = await demoBeneficiaryIds(tx);
  if (beneficiaryIds.length === 0) return { deletedBeneficiaries: 0 };

  const references = [
    await tx
      .select({ id: consegneTable.id })
      .from(consegneTable)
      .where(inArray(consegneTable.beneficiarioId, beneficiaryIds))
      .limit(1),
    await tx
      .select({ id: interventiTable.id })
      .from(interventiTable)
      .where(inArray(interventiTable.beneficiarioId, beneficiaryIds))
      .limit(1),
    await tx
      .select({ id: creditoSolidaleMovimentiTable.id })
      .from(creditoSolidaleMovimentiTable)
      .where(
        inArray(creditoSolidaleMovimentiTable.beneficiarioId, beneficiaryIds),
      )
      .limit(1),
    await tx
      .select({ id: bolleTable.id })
      .from(bolleTable)
      .where(inArray(bolleTable.beneficiarioId, beneficiaryIds))
      .limit(1),
    await tx
      .select({ id: sessioniCassaEmporioTable.id })
      .from(sessioniCassaEmporioTable)
      .where(inArray(sessioniCassaEmporioTable.beneficiarioId, beneficiaryIds))
      .limit(1),
    await tx
      .select({ id: speseEmporioTable.id })
      .from(speseEmporioTable)
      .where(inArray(speseEmporioTable.beneficiarioId, beneficiaryIds))
      .limit(1),
  ];
  if (references.some((rows) => rows.length > 0)) {
    throw new Error(
      "Reset beneficiari demo annullato: rimuovere prima i dati demo Emporio e UDS collegati.",
    );
  }

  const deletedHousehold = await tx
    .delete(nucleoFamiliareTable)
    .where(inArray(nucleoFamiliareTable.beneficiarioId, beneficiaryIds))
    .returning({ id: nucleoFamiliareTable.id });
  const deletedBeneficiaries = await tx
    .delete(beneficiariTable)
    .where(inArray(beneficiariTable.id, beneficiaryIds))
    .returning({ id: beneficiariTable.id });
  return {
    deletedHousehold: deletedHousehold.length,
    deletedBeneficiaries: deletedBeneficiaries.length,
  };
}

async function deleteDemoIdentity(
  tx: Transaction,
): Promise<EnvironmentDataSummary> {
  const [user] = await tx
    .select({ id: utentiTable.id, isSuperAdmin: utentiTable.isSuperAdmin })
    .from(utentiTable)
    .where(
      and(
        eq(utentiTable.username, DEMO_USER_USERNAME),
        eq(utentiTable.matricola, DEMO_USER_MATRICOLA),
      ),
    );
  if (user?.isSuperAdmin) {
    throw new Error(
      "Reset demo annullato: l'account demo risulta Super Admin.",
    );
  }

  let deletedUserSessions = 0;
  let deletedUsers = 0;
  if (user) {
    const sessions = await tx
      .delete(userSessionsTable)
      .where(sql`${userSessionsTable.sess} ->> 'userId' = ${String(user.id)}`)
      .returning({ sid: userSessionsTable.sid });
    deletedUserSessions = sessions.length;
    const users = await tx
      .delete(utentiTable)
      .where(eq(utentiTable.id, user.id))
      .returning({ id: utentiTable.id });
    deletedUsers = users.length;
  }

  const [zone] = await tx
    .select({ id: zoneUdsTable.id })
    .from(zoneUdsTable)
    .where(
      and(
        eq(zoneUdsTable.nome, DEMO_ZONE_NAME),
        like(zoneUdsTable.note, `%${DEMO_MARKER}%`),
      ),
    );
  let deletedZones = 0;
  if (zone) {
    const [beneficiaryReference] = await tx
      .select({ id: beneficiariTable.id })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.zonaUdsId, zone.id))
      .limit(1);
    const [userReference] = await tx
      .select({ id: utentiTable.id })
      .from(utentiTable)
      .where(eq(utentiTable.zonaUdsId, zone.id))
      .limit(1);
    if (!beneficiaryReference && !userReference) {
      deletedZones = (
        await tx
          .delete(zoneUdsTable)
          .where(eq(zoneUdsTable.id, zone.id))
          .returning({ id: zoneUdsTable.id })
      ).length;
    }
  }

  return { deletedUserSessions, deletedUsers, deletedZones };
}

export async function previewDemoReset(): Promise<EnvironmentDataSummary> {
  return db.transaction(async (tx) => {
    const beneficiaryIds = await demoBeneficiaryIds(tx);
    const accessIds = await demoAccessIds(tx);
    const areas = await tx
      .select({ id: cittaTable.id })
      .from(cittaTable)
      .where(
        and(
          eq(cittaTable.nome, DEMO_AREA_NAME),
          like(cittaTable.note, `%${DEMO_MARKER}%`),
        ),
      );
    const centres = await tx
      .select({ id: centriAscoltoTable.id })
      .from(centriAscoltoTable)
      .where(
        and(
          eq(centriAscoltoTable.nome, DEMO_CENTRO_NAME),
          like(centriAscoltoTable.note, `%${DEMO_MARKER}%`),
        ),
      );
    const zones = await tx
      .select({ id: zoneUdsTable.id })
      .from(zoneUdsTable)
      .where(
        and(
          eq(zoneUdsTable.nome, DEMO_ZONE_NAME),
          like(zoneUdsTable.note, `%${DEMO_MARKER}%`),
        ),
      );
    const users = await tx
      .select({ id: utentiTable.id })
      .from(utentiTable)
      .where(
        and(
          eq(utentiTable.username, DEMO_USER_USERNAME),
          eq(utentiTable.matricola, DEMO_USER_MATRICOLA),
        ),
      );
    const products = await tx
      .select({ id: prodottiTable.id })
      .from(prodottiTable)
      .where(inArray(prodottiTable.codice, [...DEMO_PRODUCT_CODES]));
    const sessions = accessIds.length
      ? await tx
          .select({ id: sessioniCassaEmporioTable.id })
          .from(sessioniCassaEmporioTable)
          .where(inArray(sessioniCassaEmporioTable.accessoEmporioId, accessIds))
      : [];
    const expenses = accessIds.length
      ? await tx
          .select({ id: speseEmporioTable.id })
          .from(speseEmporioTable)
          .where(inArray(speseEmporioTable.accessoEmporioId, accessIds))
      : [];

    return {
      demoAreas: areas.length,
      demoCentres: centres.length,
      demoZones: zones.length,
      demoUsers: users.length,
      demoBeneficiaries: beneficiaryIds.length,
      demoProducts: products.length,
      demoEmporioAccesses: accessIds.length,
      demoCashSessions: sessions.length,
      demoExpenses: expenses.length,
      resetBlockedByCashOperations: sessions.length > 0 || expenses.length > 0,
    };
  });
}

export async function resetDemoEmporioData(
  actorUserId: number,
): Promise<EnvironmentDataSummary> {
  return db.transaction(async (tx) => {
    const summary = await deleteDemoEmporio(tx);
    await insertAudit(
      tx,
      actorUserId,
      "reset_demo_emporio",
      summary,
      "Reset limitato ad accesso e credito Emporio marcati demo.",
    );
    return summary;
  });
}

export async function resetDemoUdsData(
  actorUserId: number,
): Promise<EnvironmentDataSummary> {
  return db.transaction(async (tx) => {
    const summary = await deleteDemoUds(tx);
    await insertAudit(
      tx,
      actorUserId,
      "reset_demo_uds",
      summary,
      "Reset limitato agli interventi UDS marcati demo.",
    );
    return summary;
  });
}

export async function resetDemoBeneficiaryData(
  actorUserId: number,
): Promise<EnvironmentDataSummary> {
  return db.transaction(async (tx) => {
    const summary = await deleteDemoBeneficiaries(tx);
    await insertAudit(
      tx,
      actorUserId,
      "reset_demo_beneficiari",
      summary,
      "Reset limitato ai beneficiari con codice e marcatore demo.",
    );
    return summary;
  });
}

export async function resetAllDemoData(
  actorUserId: number,
): Promise<EnvironmentDataSummary> {
  const socialSummary = await db.transaction(async (tx) => {
    const emporio = await deleteDemoEmporio(tx);
    const uds = await deleteDemoUds(tx);
    const beneficiaries = await deleteDemoBeneficiaries(tx);
    const identity = await deleteDemoIdentity(tx);
    const summary = { ...emporio, ...uds, ...beneficiaries, ...identity };
    await insertAudit(
      tx,
      actorUserId,
      "reset_demo_ambiente",
      summary,
      "Reset esclusivo dei record sintetici sociali, UDS ed Emporio.",
    );
    return summary;
  });
  const warehouseSummary = await resetDemoWarehouseData(actorUserId);
  return { ...socialSummary, ...warehouseSummary };
}
