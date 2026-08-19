import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  beneficiariTable,
  bisogniPianificatiTable,
  centriAscoltoTable,
  cittaTable,
  db,
  interventiStoricoStatiTable,
  interventiTable,
  pool,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import interventiRouter from "../src/routes/interventi";
import { dataCivileEuropeRome } from "../src/lib/interventiWorkflow";
import {
  dateTimeEuropeRomeToUtc,
  intervalloGiornoEuropeRome,
} from "../src/lib/interventiViste";

const rnd = () => Math.random().toString(36).slice(2, 10);
const ids = {
  citta: [] as number[],
  centri: [] as number[],
  beneficiari: [] as number[],
  utenti: [] as number[],
  ruoli: [] as number[],
  interventi: [] as number[],
};

let roma: number;
let milano: number;
let centroRoma: number;
let altroCentroRoma: number;
let centroMilano: number;
let operatoreRoma: number;
let assegnabileRoma: number;
let operatoreMilano: number;
let beneficiarioRoma: number;
let beneficiarioAltroCentro: number;
let beneficiarioMilano: number;
let beneficiarioUds: number;
let codiceRoma: string;
let today: string;
let tomorrow: string;
let yesterday: string;

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function makeApp(
  options: {
    userId?: number;
    cittaId?: number | null;
    centroId?: number | null;
    aree?: string[];
  } = {},
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (
      req as unknown as {
        user: {
          id: number;
          cittaId: number | null;
          centroAscoltoId: number | null;
          zonaUdsId: null;
          aree: string[];
          permessi: string[];
          isAdmin: boolean;
          isSuperAdmin: boolean;
        };
      }
    ).user = {
      id: options.userId ?? operatoreRoma,
      cittaId: options.cittaId === undefined ? roma : options.cittaId,
      centroAscoltoId:
        options.centroId === undefined ? centroRoma : options.centroId,
      zonaUdsId: null,
      aree: options.aree ?? ["sociale"],
      permessi: [
        "sociale.interventi.view",
        "sociale.interventi.create",
        "sociale.interventi.update",
        "sociale.interventi.complete",
        "sociale.interventi.cancel",
      ],
      isAdmin: false,
      isSuperAdmin: false,
    };
    next();
  });
  app.use(interventiRouter);
  return app;
}

async function createCitta(nome: string): Promise<number> {
  const [row] = await db
    .insert(cittaTable)
    .values({ nome })
    .returning({ id: cittaTable.id });
  ids.citta.push(row.id);
  return row.id;
}

async function createCentro(cittaId: number): Promise<number> {
  const [row] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `Centro ${rnd()}`, cittaId })
    .returning({ id: centriAscoltoTable.id });
  ids.centri.push(row.id);
  return row.id;
}

async function createBeneficiario(input: {
  cittaId: number;
  centroId: number;
  uds?: boolean;
  nome?: string;
  cognome?: string;
}): Promise<number> {
  const codice = `53B-${rnd()}`;
  const [row] = await db
    .insert(beneficiariTable)
    .values({
      codice,
      nome: input.nome ?? "Mario",
      cognome: input.cognome ?? "Rossi",
      sesso: "M",
      cittaId: input.cittaId,
      centroAscoltoId: input.centroId,
      uds: input.uds ?? false,
      numComponenti: 4,
      numMinori: 2,
    })
    .returning({ id: beneficiariTable.id });
  ids.beneficiari.push(row.id);
  if (input.cittaId === roma && input.centroId === centroRoma && !input.uds) {
    codiceRoma = codice;
  }
  return row.id;
}

async function createIntervento(input: {
  beneficiarioId?: number;
  operatoreId?: number;
  stato: string;
  ambito?: string | null;
  priorita?: string;
  pianificata?: Date | null;
  avvio?: Date | null;
  conclusione?: Date | null;
  dataIntervento?: string | null;
  tipo?: string;
  updated?: Date;
}): Promise<number> {
  const [row] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId: input.beneficiarioId ?? beneficiarioRoma,
      operatoreId: input.operatoreId ?? operatoreRoma,
      tipoIntervento: input.tipo ?? `tipo-${rnd()}`,
      stato: input.stato,
      ambito: input.ambito === undefined ? "sociale" : input.ambito,
      priorita: input.priorita ?? "normale",
      dataOraPianificata: input.pianificata ?? null,
      dataOraAvvio: input.avvio ?? null,
      dataOraConclusione: input.conclusione ?? null,
      dataIntervento: input.dataIntervento ?? null,
      dataAggiornamento: input.updated ?? new Date(),
      descrizione: `Descrizione ${rnd()}`,
      sede: "Sede test",
    } as never)
    .returning({ id: interventiTable.id });
  ids.interventi.push(row.id);
  return row.id;
}

beforeAll(async () => {
  today = dataCivileEuropeRome();
  tomorrow = addDays(today, 1);
  yesterday = addDays(today, -1);
  roma = await createCitta(`Roma 53B ${rnd()}`);
  milano = await createCitta(`Milano 53B ${rnd()}`);
  centroRoma = await createCentro(roma);
  altroCentroRoma = await createCentro(roma);
  centroMilano = await createCentro(milano);

  const [role] = await db
    .insert(ruoliTable)
    .values({ nome: `Sociale 53B ${rnd()}`, aree: ["sociale"] })
    .returning({ id: ruoliTable.id });
  ids.ruoli.push(role.id);

  const users = await db
    .insert(utentiTable)
    .values([
      {
        username: `op_roma_${rnd()}`,
        passwordHash: "test",
        nome: "Operatore Roma",
        ruoloId: role.id,
        cittaId: roma,
        centroAscoltoId: centroRoma,
      },
      {
        username: `assign_roma_${rnd()}`,
        passwordHash: "test",
        nome: "Assegnabile Roma",
        ruoloId: role.id,
        cittaId: roma,
        centroAscoltoId: centroRoma,
      },
      {
        username: `op_milano_${rnd()}`,
        passwordHash: "test",
        nome: "Operatore Milano",
        ruoloId: role.id,
        cittaId: milano,
        centroAscoltoId: centroMilano,
      },
    ])
    .returning({ id: utentiTable.id });
  [operatoreRoma, assegnabileRoma, operatoreMilano] = users.map(
    (user) => user.id,
  );
  ids.utenti.push(...users.map((user) => user.id));

  beneficiarioRoma = await createBeneficiario({
    cittaId: roma,
    centroId: centroRoma,
    nome: "Mario",
    cognome: "Rossi",
  });
  beneficiarioAltroCentro = await createBeneficiario({
    cittaId: roma,
    centroId: altroCentroRoma,
    nome: "Altra",
    cognome: "Persona",
  });
  beneficiarioMilano = await createBeneficiario({
    cittaId: milano,
    centroId: centroMilano,
    nome: "Milano",
    cognome: "Persona",
  });
  beneficiarioUds = await createBeneficiario({
    cittaId: roma,
    centroId: centroRoma,
    uds: true,
    nome: "Uds",
    cognome: "Persona",
  });

  await createIntervento({
    stato: "da_pianificare",
    priorita: "bassa",
    tipo: "pacco_alimentare",
  });
  await createIntervento({
    stato: "da_pianificare",
    priorita: "urgente",
    tipo: "colloquio",
  });
  await createIntervento({
    stato: "pianificato",
    pianificata: dateTimeEuropeRomeToUtc(today, 10),
    tipo: "colloquio",
  });
  await createIntervento({
    stato: "pianificato",
    pianificata: dateTimeEuropeRomeToUtc(tomorrow, 9),
    tipo: "orientamento",
  });
  await createIntervento({
    stato: "in_corso",
    avvio: dateTimeEuropeRomeToUtc(today, 8),
    tipo: "colloquio",
  });
  await createIntervento({
    stato: "concluso",
    avvio: dateTimeEuropeRomeToUtc(yesterday, 9),
    conclusione: dateTimeEuropeRomeToUtc(yesterday, 10),
    dataIntervento: yesterday,
  });
  await createIntervento({
    stato: "concluso",
    ambito: null,
    dataIntervento: yesterday,
    tipo: "legacy",
  });
  await createIntervento({
    stato: "annullato",
    updated: dateTimeEuropeRomeToUtc(today, 7),
  });
  await createIntervento({
    stato: "mancata_presentazione",
    pianificata: dateTimeEuropeRomeToUtc(today, 11),
    updated: dateTimeEuropeRomeToUtc(today, 12),
  });
  await createIntervento({
    beneficiarioId: beneficiarioUds,
    stato: "pianificato",
    ambito: "uds",
    pianificata: dateTimeEuropeRomeToUtc(today, 13),
  });
  await createIntervento({
    beneficiarioId: beneficiarioAltroCentro,
    stato: "pianificato",
    pianificata: dateTimeEuropeRomeToUtc(today, 14),
  });
  await createIntervento({
    beneficiarioId: beneficiarioMilano,
    operatoreId: operatoreMilano,
    stato: "pianificato",
    pianificata: dateTimeEuropeRomeToUtc(today, 15),
  });
});

afterAll(async () => {
  if (ids.interventi.length) {
    await db
      .delete(bisogniPianificatiTable)
      .where(inArray(bisogniPianificatiTable.interventoId, ids.interventi));
    await db
      .delete(interventiStoricoStatiTable)
      .where(inArray(interventiStoricoStatiTable.interventoId, ids.interventi));
    await db
      .delete(interventiTable)
      .where(inArray(interventiTable.id, ids.interventi));
  }
  if (ids.beneficiari.length)
    await db
      .delete(beneficiariTable)
      .where(inArray(beneficiariTable.id, ids.beneficiari));
  if (ids.utenti.length)
    await db.delete(utentiTable).where(inArray(utentiTable.id, ids.utenti));
  if (ids.ruoli.length)
    await db.delete(ruoliTable).where(inArray(ruoliTable.id, ids.ruoli));
  if (ids.centri.length)
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, ids.centri));
  if (ids.citta.length)
    await db.delete(cittaTable).where(inArray(cittaTable.id, ids.citta));
  await pool.end();
});

describe("viste operative degli interventi Sociali", () => {
  it("nega l'ambito Sociale a un operatore con sola area Emporio", async () => {
    const response = await request(makeApp({ aree: ["emporio"] }))
      .get("/interventi")
      .query({ ambito: "sociale" });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Ambito sociale non consentito");
  });

  it.each([
    ["da_pianificare", 2, ["da_pianificare"]],
    ["pianificati", 1, ["pianificato"]],
    ["oggi", 2, ["pianificato", "in_corso"]],
    ["in_corso", 1, ["in_corso"]],
    ["conclusi", 2, ["concluso"]],
    ["annullati", 2, ["annullato", "mancata_presentazione"]],
  ])("restituisce la vista %s", async (vista, expected, states) => {
    const response = await request(makeApp()).get("/interventi").query({
      ambito: "sociale",
      includiStorici: true,
      vista,
    });
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(expected);
    expect(
      response.body.every((row: { stato: string }) =>
        states.includes(row.stato),
      ),
    ).toBe(true);
  });

  it("esclude gli appuntamenti di oggi dai pianificati futuri e li include in Oggi", async () => {
    const future = await request(makeApp())
      .get("/interventi")
      .query({ ambito: "sociale", includiStorici: true, vista: "pianificati" });
    expect(future.body[0].dataOraPianificata).toBe(
      dateTimeEuropeRomeToUtc(tomorrow, 9).toISOString(),
    );
    const todayRows = await request(makeApp())
      .get("/interventi")
      .query({ ambito: "sociale", includiStorici: true, vista: "oggi" });
    expect(
      todayRows.body.some(
        (row: { dataOraPianificata: string | null }) =>
          row.dataOraPianificata ===
          dateTimeEuropeRomeToUtc(today, 10).toISOString(),
      ),
    ).toBe(true);
  });

  it("ordina da pianificare per priorità semantica e poi anzianità", async () => {
    const response = await request(makeApp()).get("/interventi").query({
      ambito: "sociale",
      includiStorici: true,
      vista: "da_pianificare",
    });
    expect(
      response.body.map((row: { priorita: string }) => row.priorita),
    ).toEqual(["urgente", "bassa"]);
  });

  it("ordina cronologicamente i pianificati", async () => {
    const extra = await createIntervento({
      stato: "pianificato",
      pianificata: dateTimeEuropeRomeToUtc(addDays(tomorrow, 1), 8),
    });
    const response = await request(makeApp())
      .get("/interventi")
      .query({ ambito: "sociale", includiStorici: true, vista: "pianificati" });
    expect(
      response.body.map((row: { id: number }) => row.id).indexOf(extra),
    ).toBeGreaterThan(0);
  });

  it("applica l'intervallo calendario come date civili Europe/Rome", async () => {
    const response = await request(makeApp()).get("/interventi").query({
      ambito: "sociale",
      includiStorici: true,
      vista: "oggi",
      da: today,
      a: today,
    });
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    const tooWide = await request(makeApp()).get("/interventi").query({
      ambito: "sociale",
      includiStorici: true,
      vista: "oggi",
      da: "2025-01-01",
      a: "2026-12-31",
    });
    expect(tooWide.status).toBe(400);
  });

  it("calcola correttamente mezzanotte, ora legale e ora solare", () => {
    expect(
      intervalloGiornoEuropeRome("2026-03-29").end.getTime() -
        intervalloGiornoEuropeRome("2026-03-29").start.getTime(),
    ).toBe(23 * 60 * 60 * 1000);
    expect(
      intervalloGiornoEuropeRome("2026-10-25").end.getTime() -
        intervalloGiornoEuropeRome("2026-10-25").start.getTime(),
    ).toBe(25 * 60 * 60 * 1000);
    expect(dateTimeEuropeRomeToUtc("2026-08-15").toISOString()).toBe(
      "2026-08-14T22:00:00.000Z",
    );
  });

  it("restituisce contatori aggregati coerenti e filtrabili", async () => {
    const response = await request(makeApp()).get(
      "/interventi/riepilogo-viste",
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      daPianificare: 2,
      pianificati: 2,
      oggi: 2,
      inCorso: 1,
      conclusi: 2,
      annullati: 2,
      fusoOrario: "Europe/Rome",
    });
    const filtered = await request(makeApp())
      .get("/interventi/riepilogo-viste")
      .query({ priorita: "urgente" });
    expect(filtered.body).toMatchObject({
      daPianificare: 1,
      pianificati: 0,
      oggi: 0,
    });
  });

  it("combina ricerca beneficiario, tipo, operatore, centro, priorità e legacy", async () => {
    const search = await request(makeApp()).get("/interventi").query({
      ambito: "sociale",
      includiStorici: true,
      vista: "conclusi",
      ricerca: `Rossi Mario`,
    });
    expect(search.status).toBe(200);
    expect(
      search.body.every(
        (row: { beneficiarioCodice: string }) =>
          row.beneficiarioCodice === codiceRoma,
      ),
    ).toBe(true);
    const byCode = await request(makeApp()).get("/interventi").query({
      ambito: "sociale",
      includiStorici: true,
      vista: "conclusi",
      ricerca: codiceRoma,
    });
    expect(byCode.body).toHaveLength(2);
    const byTypeAndState = await request(makeApp()).get("/interventi").query({
      ambito: "sociale",
      includiStorici: true,
      vista: "annullati",
      tipo: "tipo-che-non-esiste",
      stato: "annullato",
    });
    expect(byTypeAndState.body).toEqual([]);
    const legacy = await request(makeApp()).get("/interventi").query({
      ambito: "sociale",
      includiStorici: true,
      vista: "conclusi",
      ambitoLegacy: "legacy",
    });
    expect(legacy.body).toHaveLength(1);
    expect(legacy.body[0]).toMatchObject({ ambito: null, ambitoLegacy: true });
    const classified = await request(makeApp()).get("/interventi").query({
      ambito: "sociale",
      includiStorici: true,
      vista: "conclusi",
      ambitoLegacy: "classificati",
      operatoreId: operatoreRoma,
      centroAscoltoId: altroCentroRoma,
      priorita: "normale",
    });
    expect(classified.body).toHaveLength(1); // il centro inviato viene ignorato per l'operatore territorialmente bloccato
  });

  it("un globale filtra per città senza vedere Milano o UDS", async () => {
    const response = await request(makeApp({ cittaId: null, centroId: null }))
      .get("/interventi")
      .query({
        ambito: "sociale",
        includiStorici: true,
        vista: "oggi",
        cittaId: roma,
      });
    expect(response.status).toBe(200);
    expect(
      response.body.every(
        (row: { cittaId: number; ambito: string | null }) =>
          row.cittaId === roma && row.ambito !== "uds",
      ),
    ).toBe(true);
  });

  it("rispetta lo scope del Centro e nega il dettaglio diretto", async () => {
    const other = await request(makeApp({ centroId: altroCentroRoma }))
      .get("/interventi")
      .query({ ambito: "sociale", includiStorici: true, vista: "oggi" });
    expect(other.body).toHaveLength(1);
    const forbiddenId = other.body[0].id;
    const detail = await request(makeApp()).get(`/interventi/${forbiddenId}`);
    expect(detail.status).toBe(403);
  });

  it("arricchisce la lista in modo costante senza richieste per singola riga", async () => {
    const response = await request(makeApp())
      .get("/interventi")
      .query({ ambito: "sociale", includiStorici: true, vista: "conclusi" });
    expect(response.body).toHaveLength(2);
    expect(
      response.body.every(
        (row: { centroAscoltoNome: string; nucleoFamiliareSintesi: string }) =>
          row.centroAscoltoNome &&
          row.nucleoFamiliareSintesi.includes("4 componenti"),
      ),
    ).toBe(true);
  });
});

describe("creazione dal menu unico", () => {
  it("elenca soltanto gli operatori Sociali assegnabili nel territorio", async () => {
    const response = await request(makeApp()).get("/interventi/operatori");
    expect(response.status).toBe(200);
    expect(response.body.map((row: { id: number }) => row.id)).toEqual(
      expect.arrayContaining([operatoreRoma, assegnabileRoma]),
    );
    expect(response.body.map((row: { id: number }) => row.id)).not.toContain(
      operatoreMilano,
    );
    const globalMissingCity = await request(
      makeApp({ cittaId: null, centroId: null }),
    ).get("/interventi/operatori");
    expect(globalMissingCity.status).toBe(400);
  });

  it("crea da pianificare e pianificato con ambito Sociale e storico iniziale", async () => {
    const draft = await request(makeApp()).post("/interventi").send({
      beneficiarioId: beneficiarioRoma,
      tipoIntervento: "test-draft",
      stato: "da_pianificare",
      ambito: "sociale",
      priorita: "alta",
      operatoreId: assegnabileRoma,
    });
    expect(draft.status).toBe(201);
    ids.interventi.push(draft.body.id);
    expect(draft.body).toMatchObject({
      stato: "da_pianificare",
      ambito: "sociale",
      operatoreId: assegnabileRoma,
    });

    const planned = await request(makeApp())
      .post("/interventi")
      .send({
        beneficiarioId: beneficiarioRoma,
        tipoIntervento: "test-planned",
        stato: "pianificato",
        ambito: "sociale",
        dataOraPianificata: dateTimeEuropeRomeToUtc(tomorrow, 16).toISOString(),
      });
    expect(planned.status).toBe(201);
    ids.interventi.push(planned.body.id);
    const history = await request(makeApp()).get(
      `/interventi/${planned.body.id}/storico-stati`,
    );
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      statoNuovo: "pianificato",
      operatoreId: operatoreRoma,
    });
  });

  it("rifiuta pianificato senza data e operatore di un altro territorio", async () => {
    const missing = await request(makeApp()).post("/interventi").send({
      beneficiarioId: beneficiarioRoma,
      tipoIntervento: "missing-date",
      stato: "pianificato",
      ambito: "sociale",
    });
    expect(missing.status).toBe(400);
    const wrongOperator = await request(makeApp()).post("/interventi").send({
      beneficiarioId: beneficiarioRoma,
      tipoIntervento: "wrong-op",
      stato: "da_pianificare",
      ambito: "sociale",
      operatoreId: operatoreMilano,
    });
    expect(wrongOperator.status).toBe(403);
  });

  it("registra un intervento già effettuato senza inventare orari", async () => {
    const response = await request(makeApp()).post("/interventi").send({
      beneficiarioId: beneficiarioRoma,
      tipoIntervento: "pregresso",
      stato: "concluso",
      ambito: "sociale",
      dataIntervento: yesterday,
      registrazionePregressa: true,
    });
    expect(response.status).toBe(201);
    ids.interventi.push(response.body.id);
    expect(response.body).toMatchObject({
      stato: "concluso",
      ambito: "sociale",
      dataIntervento: yesterday,
      dataOraAvvio: null,
      dataOraConclusione: null,
    });
  });

  it("mantiene compatibili elenco UDS e Bisogni Pianificati", async () => {
    const uds = await request(makeApp({ aree: ["uds"] }))
      .get("/interventi")
      .query({ ambito: "uds", cittaId: roma });
    expect(uds.status).toBe(200);
    expect(
      uds.body.every((row: { ambito: string }) => row.ambito === "uds"),
    ).toBe(true);
    const socialId = ids.interventi.find(Boolean)!;
    const needs = await request(makeApp()).get(
      `/interventi/${socialId}/bisogni-pianificati`,
    );
    expect(needs.status).toBe(200);
    expect(needs.body).toEqual([]);

    const udsOnlyDenied = await request(makeApp({ aree: ["uds"] })).get(
      `/interventi/${socialId}/bisogni-pianificati`,
    );
    expect(udsOnlyDenied.status).toBe(403);
  });
});
