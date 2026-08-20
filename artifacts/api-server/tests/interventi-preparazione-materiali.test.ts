import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  beneficiariTable,
  centriAscoltoTable,
  areeOperativeTable,
  db,
  interventiMaterialiTable,
  interventiTable,
  magazziniTable,
  movimentiTable,
  pool,
  prodottiTable,
  utentiTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import interventiRouter from "../src/routes/interventi";
import {
  avvisoInterventoEuropeRome,
  dataCivileEuropeRome,
} from "../src/lib/interventiWorkflow";
import { dateTimeEuropeRomeToUtc } from "../src/lib/interventiViste";

const rnd = () => Math.random().toString(36).slice(2, 10);
const ids = {
  areaOperativa: [] as number[],
  centri: [] as number[],
  beneficiari: [] as number[],
  utenti: [] as number[],
  interventi: [] as number[],
  magazzini: [] as number[],
  prodotti: [] as number[],
};

let roma: number;
let milano: number;
let centroRoma: number;
let centroMilano: number;
let operatoreRoma: number;
let operatoreMilano: number;
let beneficiarioRoma: number;
let beneficiarioMilano: number;
let prodottoId: number;
let magazzinoRoma: number;
let altroMagazzinoRoma: number;
let today: string;
let tomorrow: string;
let dayAfter: string;
let primaryInterventoId: number;
let secondaryInterventoId: number;

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function atRome(value: string, time = "09:00"): Date {
  const [hour, minute] = time.split(":").map(Number);
  return dateTimeEuropeRomeToUtc(value, hour, minute);
}

function makeApp(
  options: {
    userId?: number;
    areaOperativaId?: number;
    centroId?: number;
  } = {},
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (
      req as unknown as {
        user: {
          id: number;
          areaOperativaId: number;
          centroAscoltoId: number;
          zonaUdsId: null;
          aree: string[];
          permessi: string[];
          isAdmin: boolean;
          isSuperAdmin: boolean;
        };
      }
    ).user = {
      id: options.userId ?? operatoreRoma,
      areaOperativaId: options.areaOperativaId ?? roma,
      centroAscoltoId: options.centroId ?? centroRoma,
      zonaUdsId: null,
      aree: ["sociale"],
      permessi: ["sociale.interventi.view", "sociale.interventi.update"],
      isAdmin: false,
      isSuperAdmin: false,
    };
    next();
  });
  app.use(interventiRouter);
  return app;
}

async function createIntervento(input: {
  stato?: string;
  ambito?: string;
  beneficiarioId?: number;
  operatoreId?: number;
  planned: Date;
  priorita?: string;
  materiale: {
    prodottoId?: number | null;
    descrizione: string;
    unita: string;
    prevista: number;
    consegnata?: number;
    stato?: string;
    magazzinoId?: number | null;
  };
}): Promise<{ interventoId: number; materialeId: number }> {
  const [intervento] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId: input.beneficiarioId ?? beneficiarioRoma,
      operatoreId: input.operatoreId ?? operatoreRoma,
      tipoIntervento: `Preparazione ${rnd()}`,
      stato: input.stato ?? "pianificato",
      ambito: input.ambito ?? "sociale",
      priorita: input.priorita ?? "normale",
      dataOraPianificata: input.planned,
      dataOraAvvio:
        input.stato === "in_corso"
          ? new Date(input.planned.getTime() - 60_000)
          : null,
      dataAggiornamento: new Date(),
    } as never)
    .returning({ id: interventiTable.id });
  ids.interventi.push(intervento.id);
  const [materiale] = await db
    .insert(interventiMaterialiTable)
    .values({
      interventoId: intervento.id,
      prodottoId: input.materiale.prodottoId ?? null,
      descrizioneSnapshot: input.materiale.descrizione,
      unitaMisuraSnapshot: input.materiale.unita,
      quantitaPrevista: input.materiale.prevista.toFixed(3),
      quantitaConsegnata: (input.materiale.consegnata ?? 0).toFixed(3),
      statoPreparazione: input.materiale.stato ?? "da_preparare",
      magazzinoId: input.materiale.magazzinoId ?? null,
      dataAggiornamento: new Date(),
    } as never)
    .returning({ id: interventiMaterialiTable.id });
  return { interventoId: intervento.id, materialeId: materiale.id };
}

beforeAll(async () => {
  today = dataCivileEuropeRome();
  tomorrow = addDays(today, 1);
  dayAfter = addDays(today, 2);
  const areeOperative = await db
    .insert(areeOperativeTable)
    .values([{ nome: `Roma Prep ${rnd()}` }, { nome: `Milano Prep ${rnd()}` }])
    .returning({ id: areeOperativeTable.id });
  [roma, milano] = areeOperative.map((row) => row.id);
  ids.areaOperativa.push(roma, milano);
  const centers = await db
    .insert(centriAscoltoTable)
    .values([
      { nome: `Centro Roma Prep ${rnd()}`, areaOperativaId: roma },
      { nome: `Centro Milano Prep ${rnd()}`, areaOperativaId: milano },
    ])
    .returning({ id: centriAscoltoTable.id });
  [centroRoma, centroMilano] = centers.map((row) => row.id);
  ids.centri.push(centroRoma, centroMilano);
  const users = await db
    .insert(utentiTable)
    .values([
      {
        username: `prep_roma_${rnd()}`,
        passwordHash: "test",
        nome: "Prep Roma",
        areaOperativaId: roma,
        centroAscoltoId: centroRoma,
      },
      {
        username: `prep_milano_${rnd()}`,
        passwordHash: "test",
        nome: "Prep Milano",
        areaOperativaId: milano,
        centroAscoltoId: centroMilano,
      },
    ])
    .returning({ id: utentiTable.id });
  [operatoreRoma, operatoreMilano] = users.map((row) => row.id);
  ids.utenti.push(operatoreRoma, operatoreMilano);
  const beneficiaries = await db
    .insert(beneficiariTable)
    .values([
      {
        codice: `PREP-RM-${rnd()}`,
        nome: "Persona",
        cognome: "Roma",
        sesso: "F",
        areaOperativaId: roma,
        centroAscoltoId: centroRoma,
      },
      {
        codice: `PREP-MI-${rnd()}`,
        nome: "Persona",
        cognome: "Milano",
        sesso: "M",
        areaOperativaId: milano,
        centroAscoltoId: centroMilano,
      },
    ])
    .returning({ id: beneficiariTable.id });
  [beneficiarioRoma, beneficiarioMilano] = beneficiaries.map((row) => row.id);
  ids.beneficiari.push(beneficiarioRoma, beneficiarioMilano);
  const [product] = await db
    .insert(prodottiTable)
    .values({
      codice: `PREP-P-${rnd()}`,
      nome: "Pacco alimentare",
      tipoProdotto: "alimentare",
      unitaMisura: "pacco",
    })
    .returning({ id: prodottiTable.id });
  prodottoId = product.id;
  ids.prodotti.push(product.id);
  const warehouses = await db
    .insert(magazziniTable)
    .values([
      { codice: `PREP-M1-${rnd()}`, nome: "Magazzino Uno", areaOperativaId: roma },
      { codice: `PREP-M2-${rnd()}`, nome: "Magazzino Due", areaOperativaId: roma },
    ])
    .returning({ id: magazziniTable.id });
  [magazzinoRoma, altroMagazzinoRoma] = warehouses.map((row) => row.id);
  ids.magazzini.push(magazzinoRoma, altroMagazzinoRoma);

  const primary = await createIntervento({
    planned: atRome(tomorrow),
    priorita: "normale",
    materiale: {
      prodottoId,
      descrizione: "Pacco alimentare",
      unita: "pacco",
      prevista: 5,
      consegnata: 1,
      magazzinoId: magazzinoRoma,
    },
  });
  primaryInterventoId = primary.interventoId;
  const secondary = await createIntervento({
    planned: atRome(dayAfter),
    priorita: "urgente",
    materiale: {
      prodottoId,
      descrizione: "Snapshot precedente",
      unita: "pacco",
      prevista: 3,
      consegnata: 1,
      stato: "pronto",
      magazzinoId: magazzinoRoma,
    },
  });
  secondaryInterventoId = secondary.interventoId;
  await createIntervento({
    planned: atRome(dayAfter, "10:00"),
    materiale: {
      descrizione: "Coperta",
      unita: "pz",
      prevista: 2,
    },
  });
  await createIntervento({
    planned: atRome(dayAfter, "11:00"),
    materiale: {
      descrizione: " coperta ",
      unita: "PZ",
      prevista: 1,
    },
  });
  await createIntervento({
    planned: atRome(dayAfter, "12:00"),
    materiale: {
      descrizione: "Coperta",
      unita: "kg",
      prevista: 1,
    },
  });
  await createIntervento({
    planned: atRome(dayAfter, "13:00"),
    materiale: {
      prodottoId,
      descrizione: "Pacco alimentare",
      unita: "pacco",
      prevista: 1,
      magazzinoId: altroMagazzinoRoma,
    },
  });
  await createIntervento({
    planned: atRome(today, "20:00"),
    stato: "in_corso",
    materiale: { descrizione: "Kit oggi", unita: "kit", prevista: 1 },
  });
  for (const excluded of [
    { stato: "annullato" },
    { stato: "concluso" },
    { stato: "mancata_presentazione" },
  ]) {
    await createIntervento({
      planned: atRome(tomorrow),
      stato: excluded.stato,
      materiale: {
        descrizione: `Escluso ${excluded.stato}`,
        unita: "pz",
        prevista: 1,
      },
    });
  }
  await createIntervento({
    planned: atRome(tomorrow),
    materiale: {
      descrizione: "Materiale annullato",
      unita: "pz",
      prevista: 1,
      stato: "annullato",
    },
  });
  await createIntervento({
    planned: atRome(tomorrow),
    materiale: {
      descrizione: "Già consegnato",
      unita: "pz",
      prevista: 2,
      consegnata: 2,
      stato: "consegnato",
    },
  });
  await createIntervento({
    planned: atRome(tomorrow),
    ambito: "uds",
    materiale: { descrizione: "UDS escluso", unita: "pz", prevista: 1 },
  });
  await createIntervento({
    planned: atRome(tomorrow),
    beneficiarioId: beneficiarioMilano,
    operatoreId: operatoreMilano,
    materiale: { descrizione: "Milano escluso", unita: "pz", prevista: 1 },
  });
});

afterAll(async () => {
  await db
    .delete(interventiTable)
    .where(inArray(interventiTable.id, ids.interventi));
  await db.delete(prodottiTable).where(inArray(prodottiTable.id, ids.prodotti));
  await db
    .delete(magazziniTable)
    .where(inArray(magazziniTable.id, ids.magazzini));
  await db
    .delete(beneficiariTable)
    .where(inArray(beneficiariTable.id, ids.beneficiari));
  await db.delete(utentiTable).where(inArray(utentiTable.id, ids.utenti));
  await db
    .delete(centriAscoltoTable)
    .where(inArray(centriAscoltoTable.id, ids.centri));
  await db.delete(areeOperativeTable).where(inArray(areeOperativeTable.id, ids.areaOperativa));
  await pool.end();
});

describe("materiale da preparare per gli interventi Sociali", () => {
  it("aggrega residui, pronto, priorità e scadenze senza unire unità o magazzini diversi", async () => {
    const response = await request(makeApp()).get(
      "/interventi/materiale-da-preparare?periodo=7",
    );
    expect(response.status).toBe(200);
    const productGroups = response.body.gruppi.filter(
      (group: { prodottoId: number | null }) => group.prodottoId === prodottoId,
    );
    expect(productGroups).toHaveLength(2);
    const main = productGroups.find(
      (group: { magazzinoId: number | null }) =>
        group.magazzinoId === magazzinoRoma,
    );
    expect(main).toMatchObject({
      quantitaTotale: 6,
      quantitaPronta: 2,
      quantitaDaPreparare: 4,
      numeroInterventi: 2,
      prioritaPiuAlta: "urgente",
      primaScadenza: atRome(tomorrow).toISOString(),
    });
    expect(main.interventi).toHaveLength(2);
    const blankets = response.body.gruppi.filter(
      (group: { descrizione: string }) =>
        group.descrizione.trim().toLowerCase().includes("coperta"),
    );
    expect(blankets).toHaveLength(2);
    expect(
      response.body.gruppi.some(
        (group: { descrizione: string }) => group.descrizione === "UDS escluso",
      ),
    ).toBe(false);
    expect(
      response.body.gruppi.some(
        (group: { descrizione: string }) =>
          group.descrizione === "Milano escluso",
      ),
    ).toBe(false);
  });

  it("supporta intervallo personalizzato e ne limita l'ampiezza", async () => {
    const response = await request(makeApp()).get(
      `/interventi/materiale-da-preparare?periodo=personalizzato&da=${tomorrow}&a=${tomorrow}`,
    );
    expect(response.status).toBe(200);
    expect(
      response.body.gruppi.flatMap(
        (group: { interventi: unknown[] }) => group.interventi,
      ),
    ).toHaveLength(1);
    const tooLong = await request(makeApp()).get(
      `/interventi/materiale-da-preparare?periodo=personalizzato&da=${today}&a=${addDays(today, 31)}`,
    );
    expect(tooLong.status).toBe(400);
  });

  it("aggiorna pronto con versione, ricalcola l'aggregazione e non crea movimenti", async () => {
    const before = await request(makeApp()).get(
      "/interventi/materiale-da-preparare?periodo=7",
    );
    const group = before.body.gruppi.find(
      (candidate: { prodottoId: number; magazzinoId: number }) =>
        candidate.prodottoId === prodottoId &&
        candidate.magazzinoId === magazzinoRoma,
    );
    const detail = group.interventi.find(
      (candidate: { interventoId: number }) =>
        candidate.interventoId === primaryInterventoId,
    );
    const [movementCountBefore] = await db
      .select({ count: sql<number>`count(*)` })
      .from(movimentiTable);
    const changed = await request(makeApp())
      .patch(
        `/interventi/${primaryInterventoId}/materiali/${detail.materialeId}`,
      )
      .send({ statoPreparazione: "pronto", versione: detail.versione });
    expect(changed.status).toBe(200);
    expect(changed.body.statoPreparazione).toBe("pronto");
    const concurrent = await request(makeApp())
      .patch(
        `/interventi/${primaryInterventoId}/materiali/${detail.materialeId}`,
      )
      .send({ statoPreparazione: "da_preparare", versione: detail.versione });
    expect(concurrent.status).toBe(409);
    const after = await request(makeApp()).get(
      "/interventi/materiale-da-preparare?periodo=7",
    );
    const updatedGroup = after.body.gruppi.find(
      (candidate: { prodottoId: number; magazzinoId: number }) =>
        candidate.prodottoId === prodottoId &&
        candidate.magazzinoId === magazzinoRoma,
    );
    expect(updatedGroup).toMatchObject({
      quantitaPronta: 6,
      quantitaDaPreparare: 0,
    });
    const [movementCountAfter] = await db
      .select({ count: sql<number>`count(*)` })
      .from(movimentiTable);
    expect(Number(movementCountAfter.count)).toBe(
      Number(movementCountBefore.count),
    );
  });

  it("protegge territorio, ambito UDS e appartenenza del materiale", async () => {
    const romaResponse = await request(makeApp()).get(
      "/interventi/materiale-da-preparare?periodo=7",
    );
    const detail = romaResponse.body.gruppi[0].interventi[0];
    const milanoApp = makeApp({
      userId: operatoreMilano,
      areaOperativaId: milano,
      centroId: centroMilano,
    });
    expect(
      (
        await request(milanoApp)
          .patch(
            `/interventi/${detail.interventoId}/materiali/${detail.materialeId}`,
          )
          .send({ statoPreparazione: "pronto", versione: detail.versione })
      ).status,
    ).toBe(403);
    const wrongInterventoId =
      detail.interventoId === primaryInterventoId
        ? secondaryInterventoId
        : primaryInterventoId;
    expect(
      (
        await request(makeApp())
          .patch(
            `/interventi/${wrongInterventoId}/materiali/${detail.materialeId}`,
          )
          .send({ statoPreparazione: "pronto", versione: detail.versione })
      ).status,
    ).toBe(404);
  });
});

describe("avvisi Europe/Rome", () => {
  it("classifica scaduto, oggi, entro 48 ore e entro 7 giorni", () => {
    const reference = new Date("2026-08-14T20:30:00Z");
    expect(
      avvisoInterventoEuropeRome(
        new Date("2026-08-14T20:00:00Z"),
        "pianificato",
        reference,
      ),
    ).toBe("scaduto");
    expect(
      avvisoInterventoEuropeRome(
        new Date("2026-08-14T21:00:00Z"),
        "pianificato",
        reference,
      ),
    ).toBe("oggi");
    expect(
      avvisoInterventoEuropeRome(
        new Date("2026-08-16T20:00:00Z"),
        "pianificato",
        reference,
      ),
    ).toBe("imminente");
    expect(
      avvisoInterventoEuropeRome(
        new Date("2026-08-20T08:00:00Z"),
        "pianificato",
        reference,
      ),
    ).toBe("prossimo");
  });

  it("resta coerente al cambio giorno e ai passaggi di ora legale/solare", () => {
    expect(
      avvisoInterventoEuropeRome(
        new Date("2026-03-30T20:30:00Z"),
        "pianificato",
        new Date("2026-03-28T21:45:00Z"),
      ),
    ).toBe("imminente");
    expect(
      avvisoInterventoEuropeRome(
        new Date("2026-10-26T09:00:00Z"),
        "pianificato",
        new Date("2026-10-24T22:30:00Z"),
      ),
    ).toBe("imminente");
    expect(
      avvisoInterventoEuropeRome(
        new Date("2026-08-15T00:15:00+02:00"),
        "pianificato",
        new Date("2026-08-14T23:55:00+02:00"),
      ),
    ).toBe("imminente");
  });
});
