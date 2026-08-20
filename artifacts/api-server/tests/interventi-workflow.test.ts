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
  utentiTable,
  zoneUdsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import interventiRouter from "../src/routes/interventi";
import {
  dataCivileEuropeRome,
  parseIsoTimestamp,
} from "../src/lib/interventiWorkflow";

const rnd = () => Math.random().toString(36).slice(2, 10);
const interventoIds: number[] = [];
const beneficiarioIds: number[] = [];
const centroIds: number[] = [];
const zonaIds: number[] = [];
const cittaIds: number[] = [];

let operatoreId: number;
let cittaRoma: number;
let cittaMilano: number;
let centroRoma: number;
let altroCentroRoma: number;
let centroMilano: number;
let zonaRoma: number;
let altraZonaRoma: number;
let zonaMilano: number;
let socialeRoma: number;
let socialeAltroCentroRoma: number;
let socialeMilano: number;
let udsRomaAltraZona: number;
let udsMilano: number;
let udsCittaNull: number;

function makeApp(
  cittaId: number | null = cittaRoma,
  centroAscoltoId: number | null = centroRoma,
  zonaUdsId: number | null = zonaRoma,
  aree: string[] = ["sociale", "uds"],
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
          zonaUdsId: number | null;
          aree: string[];
          permessi: string[];
        };
      }
    ).user = {
      id: operatoreId,
      cittaId,
      centroAscoltoId,
      zonaUdsId,
      aree,
      permessi: [
        "sociale.interventi.view",
        "sociale.interventi.create",
        "sociale.interventi.update",
        "sociale.interventi.complete",
        "sociale.interventi.cancel",
      ],
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
  cittaIds.push(row.id);
  return row.id;
}

async function createCentro(cittaId: number): Promise<number> {
  const [row] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `Centro ${rnd()}`, cittaId })
    .returning({ id: centriAscoltoTable.id });
  centroIds.push(row.id);
  return row.id;
}

async function createZona(cittaId: number): Promise<number> {
  const [row] = await db
    .insert(zoneUdsTable)
    .values({ nome: `Zona ${rnd()}`, cittaId })
    .returning({ id: zoneUdsTable.id });
  zonaIds.push(row.id);
  return row.id;
}

async function createBeneficiario(input: {
  cittaId: number | null;
  centroAscoltoId?: number | null;
  zonaUdsId?: number | null;
  uds?: boolean;
}): Promise<number> {
  const [row] = await db
    .insert(beneficiariTable)
    .values({
      codice: `WF-${rnd()}`,
      nome: "Persona",
      cognome: rnd(),
      sesso: "F",
      uds: input.uds ?? false,
      cittaId: input.cittaId,
      centroAscoltoId: input.centroAscoltoId ?? null,
      zonaUdsId: input.zonaUdsId ?? null,
    })
    .returning({ id: beneficiariTable.id });
  beneficiarioIds.push(row.id);
  return row.id;
}

async function createWorkflow(
  overrides: Record<string, unknown> = {},
  app = makeApp(),
) {
  const response = await request(app)
    .post("/interventi")
    .send({
      beneficiarioId: socialeRoma,
      tipoIntervento: `workflow-${rnd()}`,
      ambito: "sociale",
      stato: "da_pianificare",
      ...overrides,
    });
  if (response.body?.id) interventoIds.push(response.body.id);
  return response;
}

async function versioneIntervento(id: number): Promise<string> {
  const [row] = await db
    .select({ versione: interventiTable.dataAggiornamento })
    .from(interventiTable)
    .where(eq(interventiTable.id, id));
  if (!row?.versione) throw new Error("Versione intervento non disponibile");
  return row.versione.toISOString();
}

beforeAll(async () => {
  cittaRoma = await createCitta(`Roma Workflow ${rnd()}`);
  cittaMilano = await createCitta(`Milano Workflow ${rnd()}`);
  centroRoma = await createCentro(cittaRoma);
  altroCentroRoma = await createCentro(cittaRoma);
  centroMilano = await createCentro(cittaMilano);
  zonaRoma = await createZona(cittaRoma);
  altraZonaRoma = await createZona(cittaRoma);
  zonaMilano = await createZona(cittaMilano);

  const [operatore] = await db
    .insert(utentiTable)
    .values({
      username: `workflow_test_${rnd()}`,
      passwordHash: "test-only",
      nome: "Operatore Workflow",
      attivo: true,
      cittaId: cittaRoma,
      centroAscoltoId: centroRoma,
      zonaUdsId: zonaRoma,
    })
    .returning({ id: utentiTable.id });
  operatoreId = operatore.id;

  socialeRoma = await createBeneficiario({
    cittaId: cittaRoma,
    centroAscoltoId: centroRoma,
    zonaUdsId: zonaRoma,
  });
  socialeAltroCentroRoma = await createBeneficiario({
    cittaId: cittaRoma,
    centroAscoltoId: altroCentroRoma,
    zonaUdsId: zonaRoma,
  });
  socialeMilano = await createBeneficiario({
    cittaId: cittaMilano,
    centroAscoltoId: centroMilano,
    zonaUdsId: zonaMilano,
  });
  udsRomaAltraZona = await createBeneficiario({
    cittaId: cittaRoma,
    centroAscoltoId: altroCentroRoma,
    zonaUdsId: altraZonaRoma,
    uds: true,
  });
  udsMilano = await createBeneficiario({
    cittaId: cittaMilano,
    centroAscoltoId: centroMilano,
    zonaUdsId: zonaMilano,
    uds: true,
  });
  udsCittaNull = await createBeneficiario({ cittaId: null, uds: true });
});

afterAll(async () => {
  if (interventoIds.length > 0) {
    await db
      .delete(bisogniPianificatiTable)
      .where(inArray(bisogniPianificatiTable.interventoId, interventoIds));
    await db
      .delete(interventiTable)
      .where(inArray(interventiTable.id, interventoIds));
  }
  if (beneficiarioIds.length > 0) {
    await db
      .delete(beneficiariTable)
      .where(inArray(beneficiariTable.id, beneficiarioIds));
  }
  await db.delete(utentiTable).where(eq(utentiTable.id, operatoreId));
  if (zonaIds.length > 0) {
    await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zonaIds));
  }
  if (centroIds.length > 0) {
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, centroIds));
  }
  if (cittaIds.length > 0) {
    await db.delete(cittaTable).where(inArray(cittaTable.id, cittaIds));
  }
  await pool.end();
});

describe("workflow degli interventi", () => {
  it("crea un intervento da pianificare senza data e lo storico iniziale in modo atomico", async () => {
    const response = await createWorkflow({
      priorita: "urgente",
      sede: "Sede A",
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      stato: "da_pianificare",
      ambito: "sociale",
      priorita: "urgente",
      dataIntervento: null,
      dataOraPianificata: null,
      operatoreId,
    });

    const history = await request(makeApp()).get(
      `/interventi/${response.body.id}/storico-stati`,
    );
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      statoPrecedente: null,
      statoNuovo: "da_pianificare",
      operatoreId,
    });
  });

  it("rifiuta un pianificato senza timestamp e non lascia righe parziali", async () => {
    const marker = `rollback-${rnd()}`;
    const response = await createWorkflow({
      stato: "pianificato",
      tipoIntervento: marker,
    });
    expect(response.status).toBe(400);
    const rows = await db
      .select({ id: interventiTable.id })
      .from(interventiTable)
      .where(eq(interventiTable.tipoIntervento, marker));
    expect(rows).toEqual([]);
  });

  it("crea un pianificato valido, lo avvia e lo conclude con timestamp coerenti", async () => {
    const created = await createWorkflow({
      stato: "pianificato",
      dataOraPianificata: "2026-08-20T10:00:00+02:00",
    });
    expect(created.status).toBe(201);
    expect(created.body.dataOraPianificata).toBe("2026-08-20T08:00:00.000Z");

    const started = await request(makeApp())
      .post(`/interventi/${created.body.id}/avvia`)
      .send({
        versione: await versioneIntervento(created.body.id),
        dataOraAvvio: "2026-08-20T10:05:00+02:00",
        operatoreId: -1,
      });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({
      stato: "in_corso",
      dataIntervento: "2026-08-20",
      dataOraAvvio: "2026-08-20T08:05:00.000Z",
    });

    const incoherent = await request(makeApp())
      .post(`/interventi/${created.body.id}/concludi`)
      .send({
        versione: await versioneIntervento(created.body.id),
        conferma: true,
        risultato: "Attività completata",
        dataOraConclusione: "2026-08-20T10:04:00+02:00",
      });
    expect(incoherent.status).toBe(400);

    const concluded = await request(makeApp())
      .post(`/interventi/${created.body.id}/concludi`)
      .send({
        versione: await versioneIntervento(created.body.id),
        conferma: true,
        risultato: "Attività completata",
        dataOraConclusione: "2026-08-20T10:30:00+02:00",
      });
    expect(concluded.status).toBe(200);
    expect(concluded.body.intervento).toMatchObject({
      stato: "concluso",
      dataOraConclusione: "2026-08-20T08:30:00.000Z",
    });

    const history = await request(makeApp()).get(
      `/interventi/${created.body.id}/storico-stati`,
    );
    expect(
      history.body.map((row: { statoNuovo: string }) => row.statoNuovo),
    ).toEqual(["pianificato", "in_corso", "concluso"]);
    expect(
      history.body.every(
        (row: { operatoreId: number }) => row.operatoreId === operatoreId,
      ),
    ).toBe(true);
  });

  it("avvia senza pianificazione e usa la data civile Europe/Rome", async () => {
    const created = await createWorkflow();
    const started = await request(makeApp())
      .post(`/interventi/${created.body.id}/avvia`)
      .send({
        versione: await versioneIntervento(created.body.id),
        dataOraAvvio: "2026-08-14T22:30:00Z",
      });
    expect(started.status).toBe(200);
    expect(started.body.dataIntervento).toBe("2026-08-15");
    expect(started.body.dataOraPianificata).toBeNull();
  });

  it("annulla soltanto con motivo e traccia autore e timestamp", async () => {
    const created = await createWorkflow();
    const missingReason = await request(makeApp())
      .post(`/interventi/${created.body.id}/annulla`)
      .send({
        versione: await versioneIntervento(created.body.id),
      });
    expect(missingReason.status).toBe(400);

    const cancelled = await request(makeApp())
      .post(`/interventi/${created.body.id}/annulla`)
      .send({
        versione: await versioneIntervento(created.body.id),
        motivo: "Richiesta del beneficiario",
        dataOraAnnullamento: "2026-08-21T09:00:00+02:00",
      });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      stato: "annullato",
      motivoAnnullamento: "Richiesta del beneficiario",
    });
    const history = await request(makeApp()).get(
      `/interventi/${created.body.id}/storico-stati`,
    );
    expect(history.body.at(-1)).toMatchObject({
      operatoreId,
      motivo: "Richiesta del beneficiario",
      dataTransizione: "2026-08-21T07:00:00.000Z",
    });
  });

  it("registra la mancata presentazione solo da un appuntamento pianificato e senza falso avvio", async () => {
    const planned = await createWorkflow({
      stato: "pianificato",
      dataOraPianificata: "2026-08-22T10:00:00+02:00",
    });
    const noShow = await request(makeApp())
      .post(`/interventi/${planned.body.id}/mancata-presentazione`)
      .send({
        versione: await versioneIntervento(planned.body.id),
        nota: "Non si è presentato",
      });
    expect(noShow.status).toBe(200);
    expect(noShow.body).toMatchObject({
      stato: "mancata_presentazione",
      dataOraAvvio: null,
      dataOraConclusione: null,
    });

    const unplanned = await createWorkflow();
    const rejected = await request(makeApp())
      .post(`/interventi/${unplanned.body.id}/mancata-presentazione`)
      .send({
        versione: await versioneIntervento(unplanned.body.id),
      });
    expect(rejected.status).toBe(409);
  });

  it("riserva i comandi di dominio Sociali agli endpoint specialistici e preserva UDS", async () => {
    const socialPlanned = await createWorkflow({
      stato: "pianificato",
      dataOraPianificata: "2026-08-23T10:00:00+02:00",
    });
    const bypassStart = await request(makeApp())
      .post(`/interventi/${socialPlanned.body.id}/transizioni`)
      .send({
        versione: await versioneIntervento(socialPlanned.body.id),
        stato: "in_corso",
      });
    expect(bypassStart.status).toBe(409);

    const socialRunning = await createWorkflow({ stato: "da_pianificare" });
    const started = await request(makeApp())
      .post(`/interventi/${socialRunning.body.id}/avvia`)
      .send({ versione: await versioneIntervento(socialRunning.body.id) });
    expect(started.status).toBe(200);
    const bypassConclusion = await request(makeApp())
      .post(`/interventi/${socialRunning.body.id}/transizioni`)
      .send({
        versione: await versioneIntervento(socialRunning.body.id),
        stato: "concluso",
      });
    expect(bypassConclusion.status).toBe(409);
    const properConclusion = await request(makeApp())
      .post(`/interventi/${socialRunning.body.id}/concludi`)
      .send({
        versione: await versioneIntervento(socialRunning.body.id),
        conferma: true,
        risultato: "Conclusione verificata",
      });
    expect(properConclusion.status).toBe(200);

    const socialCancellable = await createWorkflow();
    expect(
      (
        await request(makeApp())
          .post(`/interventi/${socialCancellable.body.id}/transizioni`)
          .send({
            versione: await versioneIntervento(socialCancellable.body.id),
            stato: "annullato",
            motivo: "Tentativo generico",
          })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(makeApp())
          .post(`/interventi/${socialCancellable.body.id}/annulla`)
          .send({
            versione: await versioneIntervento(socialCancellable.body.id),
            motivo: "Comando dedicato",
          })
      ).status,
    ).toBe(200);

    const socialNoShow = await createWorkflow({
      stato: "pianificato",
      dataOraPianificata: "2026-08-24T10:00:00+02:00",
    });
    expect(
      (
        await request(makeApp())
          .post(`/interventi/${socialNoShow.body.id}/transizioni`)
          .send({
            versione: await versioneIntervento(socialNoShow.body.id),
            stato: "mancata_presentazione",
          })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(makeApp())
          .post(`/interventi/${socialNoShow.body.id}/mancata-presentazione`)
          .send({
            versione: await versioneIntervento(socialNoShow.body.id),
            nota: "Comando dedicato",
          })
      ).status,
    ).toBe(200);

    const uds = await createWorkflow({
      beneficiarioId: udsRomaAltraZona,
      ambito: "uds",
      stato: "pianificato",
      dataOraPianificata: "2026-08-25T10:00:00+02:00",
    });
    const udsStarted = await request(makeApp())
      .post(`/interventi/${uds.body.id}/transizioni`)
      .send({
        versione: await versioneIntervento(uds.body.id),
        stato: "in_corso",
      });
    expect(udsStarted.status).toBe(200);
    const udsConcluded = await request(makeApp())
      .post(`/interventi/${uds.body.id}/transizioni`)
      .send({
        versione: await versioneIntervento(uds.body.id),
        stato: "concluso",
      });
    expect(udsConcluded.status).toBe(200);
  });

  it("blocca transizioni terminali e modifiche dirette dello stato", async () => {
    const created = await createWorkflow();
    await request(makeApp())
      .post(`/interventi/${created.body.id}/annulla`)
      .send({
        versione: await versioneIntervento(created.body.id),
        motivo: "Test",
      });

    const reopen = await request(makeApp())
      .post(`/interventi/${created.body.id}/transizioni`)
      .send({
        versione: await versioneIntervento(created.body.id),
        stato: "da_pianificare",
      });
    expect(reopen.status).toBe(409);

    const patched = await request(makeApp())
      .patch(`/interventi/${created.body.id}`)
      .send({ stato: "in_corso" });
    expect(patched.status).toBe(400);
  });

  it("mantiene l'ordine causale senza alterare i timestamp operativi", async () => {
    const created = await createWorkflow({
      stato: "pianificato",
      dataOraPianificata: "2026-09-01T10:00:00+02:00",
    });
    const initialHistory = await request(makeApp()).get(
      `/interventi/${created.body.id}/storico-stati`,
    );
    expect(initialHistory.status).toBe(200);
    expect(initialHistory.body).toHaveLength(1);
    const technicalCreationTimestamp = initialHistory.body[0].dataTransizione;
    const retroactiveTransitionTimestamp = new Date(
      Date.parse(technicalCreationTimestamp) - 60_000,
    ).toISOString();

    const started = await request(makeApp())
      .post(`/interventi/${created.body.id}/avvia`)
      .send({
        versione: await versioneIntervento(created.body.id),
        dataOraAvvio: retroactiveTransitionTimestamp,
      });
    expect(started.status).toBe(200);

    const concluded = await request(makeApp())
      .post(`/interventi/${created.body.id}/concludi`)
      .send({
        versione: await versioneIntervento(created.body.id),
        conferma: true,
        risultato: "Attività completata",
        dataOraConclusione: retroactiveTransitionTimestamp,
      });
    expect(concluded.status).toBe(200);

    const history = await request(makeApp()).get(
      `/interventi/${created.body.id}/storico-stati`,
    );
    expect(history.status).toBe(200);
    expect(
      history.body.map((row: { statoNuovo: string }) => row.statoNuovo),
    ).toEqual(["pianificato", "in_corso", "concluso"]);
    expect(
      history.body.map(
        (row: { dataTransizione: string }) => row.dataTransizione,
      ),
    ).toEqual([
      technicalCreationTimestamp,
      retroactiveTransitionTimestamp,
      retroactiveTransitionTimestamp,
    ]);
    expect(Date.parse(technicalCreationTimestamp)).toBeGreaterThan(
      Date.parse(retroactiveTransitionTimestamp),
    );
  });

  it("crea un successivo senza modificare il precedente e impedisce duplicati", async () => {
    const parent = await createWorkflow({ descrizione: "Immutabile" });
    const before = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, parent.body.id));

    const child = await request(makeApp())
      .post(`/interventi/${parent.body.id}/successivi`)
      .send({
        tipoIntervento: "follow-up",
        ambito: "sociale",
        stato: "pianificato",
        dataOraPianificata: "2026-09-10T11:00:00+02:00",
        beneficiarioId: socialeMilano,
      });
    expect(child.status).toBe(201);
    interventoIds.push(child.body.id);
    expect(child.body).toMatchObject({
      beneficiarioId: socialeRoma,
      interventoPrecedenteId: parent.body.id,
      stato: "pianificato",
    });

    const duplicate = await request(makeApp())
      .post(`/interventi/${parent.body.id}/successivi`)
      .send({
        tipoIntervento: "follow-up",
        ambito: "sociale",
        stato: "pianificato",
        dataOraPianificata: "2026-09-10T11:00:00+02:00",
      });
    expect(duplicate.status).toBe(409);

    const after = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, parent.body.id));
    expect(after).toEqual(before);

    const parentResponse = await request(makeApp()).get(
      `/interventi/${parent.body.id}`,
    );
    expect(parentResponse.body.successoriIds).toContain(child.body.id);
    expect(parentResponse.body.numeroSuccessori).toBe(1);
  });

  it("rifiuta collegamenti tra beneficiari diversi, auto-collegamenti e cicli", async () => {
    const first = await createWorkflow();
    const crossBeneficiary = await createWorkflow(
      {
        beneficiarioId: socialeAltroCentroRoma,
        interventoPrecedenteId: first.body.id,
      },
      makeApp(null, null, null),
    );
    expect(crossBeneficiary.status).toBe(400);

    const self = await request(makeApp())
      .patch(`/interventi/${first.body.id}`)
      .send({ interventoPrecedenteId: first.body.id });
    expect(self.status).toBe(400);

    const second = await createWorkflow({
      interventoPrecedenteId: first.body.id,
    });
    const cycle = await request(makeApp())
      .patch(`/interventi/${first.body.id}`)
      .send({ interventoPrecedenteId: second.body.id });
    expect(cycle.status).toBe(400);
  });

  it("applica i filtri di stato, ambito, priorità, operatore, pianificazione e precedente", async () => {
    const parent = await createWorkflow({
      beneficiarioId: udsRomaAltraZona,
      ambito: "uds",
      priorita: "bassa",
    });
    const target = await createWorkflow({
      beneficiarioId: udsRomaAltraZona,
      ambito: "uds",
      stato: "pianificato",
      priorita: "alta",
      dataOraPianificata: "2026-10-10T10:00:00+02:00",
      interventoPrecedenteId: parent.body.id,
    });
    expect(target.status).toBe(201);

    const response = await request(makeApp()).get("/interventi").query({
      stato: "pianificato",
      ambito: "uds",
      priorita: "alta",
      operatoreId,
      pianificataDa: "2026-10-10T09:00:00+02:00",
      pianificataA: "2026-10-10T11:00:00+02:00",
      interventoPrecedenteId: parent.body.id,
    });
    expect(response.status).toBe(200);
    expect(response.body.map((row: { id: number }) => row.id)).toEqual([
      target.body.id,
    ]);
  });

  it("mantiene il payload legacy concluso, la data storica e nessun orario artificiale", async () => {
    const response = await request(makeApp()).post("/interventi").send({
      beneficiarioId: socialeRoma,
      tipoIntervento: "legacy",
      dataIntervento: "2025-01-15",
      ambito: "sociale",
    });
    expect(response.status).toBe(201);
    interventoIds.push(response.body.id);
    expect(response.body).toMatchObject({
      stato: "concluso",
      ambito: "sociale",
      dataIntervento: "2025-01-15",
      dataOraPianificata: null,
      dataOraAvvio: null,
      dataOraConclusione: null,
    });
  });

  it("include i record storici non classificati solo quando richiesto esplicitamente", async () => {
    const legacy = await request(makeApp())
      .post("/interventi")
      .send({
        beneficiarioId: udsRomaAltraZona,
        tipoIntervento: `legacy-uds-${rnd()}`,
        dataIntervento: "2025-01-16",
      });
    expect(legacy.status).toBe(201);
    interventoIds.push(legacy.body.id);
    expect(legacy.body.ambito).toBeNull();

    const exact = await request(makeApp()).get("/interventi").query({
      beneficiarioId: udsRomaAltraZona,
      ambito: "uds",
    });
    expect(exact.status).toBe(200);
    expect(exact.body.map((row: { id: number }) => row.id)).not.toContain(
      legacy.body.id,
    );

    const withHistory = await request(makeApp()).get("/interventi").query({
      beneficiarioId: udsRomaAltraZona,
      ambito: "uds",
      includiStorici: true,
    });
    expect(withHistory.status).toBe(200);
    expect(withHistory.body.map((row: { id: number }) => row.id)).toContain(
      legacy.body.id,
    );

    const malformed = await request(makeApp())
      .get("/interventi")
      .query({ ambito: "uds", includiStorici: "yes" });
    expect(malformed.status).toBe(400);

    const withoutScope = await request(makeApp())
      .get("/interventi")
      .query({ includiStorici: true });
    expect(withoutScope.status).toBe(400);
  });

  it("preserva i Bisogni Pianificati UDS e li vieta nell'ambito Sociale", async () => {
    const uds = await createWorkflow({
      beneficiarioId: udsRomaAltraZona,
      ambito: "uds",
      bisogniPianificati: [
        {
          tipo: "richiesta",
          descrizione: "Documenti",
          stato: "da_pianificare",
          priorita: "normale",
        },
      ],
    });
    expect(uds.status).toBe(201);
    expect(uds.body.bisogniPianificatiTotale).toBe(1);
    const needs = await request(makeApp()).get(
      `/interventi/${uds.body.id}/bisogni-pianificati`,
    );
    expect(needs.status).toBe(200);
    expect(needs.body).toHaveLength(1);

    const social = await createWorkflow({
      bisogniPianificati: [
        {
          tipo: "richiesta",
          descrizione: "Non ammesso",
          stato: "da_pianificare",
          priorita: "normale",
        },
      ],
    });
    expect(social.status).toBe(403);
  });
});

describe("visibilità territoriale del workflow", () => {
  it("separa le autorizzazioni degli ambiti Sociale e UDS", async () => {
    const socialOnly = makeApp(cittaRoma, centroRoma, zonaRoma, ["sociale"]);
    const udsOnly = makeApp(cittaRoma, centroRoma, zonaRoma, ["uds"]);

    expect((await createWorkflow({}, socialOnly)).status).toBe(201);
    expect(
      (
        await createWorkflow(
          { beneficiarioId: udsRomaAltraZona, ambito: "uds" },
          socialOnly,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await createWorkflow(
          { beneficiarioId: socialeRoma, ambito: "sociale" },
          udsOnly,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await createWorkflow(
          { beneficiarioId: udsRomaAltraZona, ambito: "uds" },
          udsOnly,
        )
      ).status,
    ).toBe(201);

    const legacy = await request(makeApp())
      .post("/interventi")
      .send({
        beneficiarioId: udsRomaAltraZona,
        tipoIntervento: `legacy-area-${rnd()}`,
        dataIntervento: "2025-01-17",
      });
    expect(legacy.status).toBe(201);
    interventoIds.push(legacy.body.id);
    expect(
      (await request(socialOnly).get(`/interventi/${legacy.body.id}`)).status,
    ).toBe(403);
    expect(
      (await request(udsOnly).get(`/interventi/${legacy.body.id}`)).status,
    ).toBe(200);
  });

  it("consente UDS in tutta la città, ma esclude altra città e città NULL", async () => {
    const sameCity = await createWorkflow({
      beneficiarioId: udsRomaAltraZona,
      ambito: "uds",
    });
    expect(sameCity.status).toBe(201);

    const otherCity = await createWorkflow(
      { beneficiarioId: udsMilano, ambito: "uds" },
      makeApp(),
    );
    expect(otherCity.status).toBe(403);

    const nullCity = await createWorkflow(
      { beneficiarioId: udsCittaNull, ambito: "uds" },
      makeApp(),
    );
    expect(nullCity.status).toBe(403);
  });

  it("preserva l'isolamento Sociale per centro e città", async () => {
    const otherCentre = await createWorkflow({
      beneficiarioId: socialeAltroCentroRoma,
      ambito: "sociale",
    });
    expect(otherCentre.status).toBe(403);

    const otherCity = await createWorkflow({
      beneficiarioId: socialeMilano,
      ambito: "sociale",
    });
    expect(otherCity.status).toBe(403);

    const global = await createWorkflow(
      { beneficiarioId: socialeMilano, ambito: "sociale" },
      makeApp(null, null, null),
    );
    expect(global.status).toBe(201);
  });

  it("obbliga il globale a scegliere la città negli elenchi UDS", async () => {
    const missingCity = await request(makeApp(null, null, null))
      .get("/interventi")
      .query({ ambito: "uds" });
    expect(missingCity.status).toBe(400);

    const scoped = await request(makeApp(null, null, null))
      .get("/interventi")
      .query({ ambito: "uds", cittaId: cittaRoma });
    expect(scoped.status).toBe(200);
    expect(
      scoped.body.every(
        (row: { beneficiarioId: number }) => row.beneficiarioId !== udsMilano,
      ),
    ).toBe(true);
  });

  it("protegge dettaglio, storico e transizioni da un'altra città", async () => {
    const milano = await createWorkflow(
      { beneficiarioId: udsMilano, ambito: "uds" },
      makeApp(null, null, null),
    );
    expect(milano.status).toBe(201);

    expect(
      (await request(makeApp()).get(`/interventi/${milano.body.id}`)).status,
    ).toBe(403);
    expect(
      (
        await request(makeApp()).get(
          `/interventi/${milano.body.id}/storico-stati`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(makeApp())
          .post(`/interventi/${milano.body.id}/transizioni`)
          .send({ stato: "in_corso" })
      ).status,
    ).toBe(403);
  });

  it("impedisce di cambiare beneficiario o autore della transizione", async () => {
    const created = await createWorkflow();
    const move = await request(makeApp())
      .patch(`/interventi/${created.body.id}`)
      .send({ beneficiarioId: socialeMilano });
    expect(move.status).toBe(403);

    const operator = await request(makeApp())
      .patch(`/interventi/${created.body.id}`)
      .send({ operatoreId: -1 });
    expect(operator.status).toBe(400);
  });
});

describe("data civile italiana", () => {
  it("usa Europe/Rome ai confini di mezzanotte in inverno e in estate", () => {
    expect(dataCivileEuropeRome(new Date("2026-01-14T22:59:59Z"))).toBe(
      "2026-01-14",
    );
    expect(dataCivileEuropeRome(new Date("2026-01-14T23:00:00Z"))).toBe(
      "2026-01-15",
    );
    expect(dataCivileEuropeRome(new Date("2026-08-14T21:59:59Z"))).toBe(
      "2026-08-14",
    );
    expect(dataCivileEuropeRome(new Date("2026-08-14T22:00:00Z"))).toBe(
      "2026-08-15",
    );
  });

  it("richiede sempre un fuso esplicito nei timestamp API", () => {
    expect(() => parseIsoTimestamp("2026-08-14T10:00:00", "data")).toThrow(
      "fuso orario",
    );
    expect(
      parseIsoTimestamp("2026-08-14T10:00:00+02:00", "data")?.toISOString(),
    ).toBe("2026-08-14T08:00:00.000Z");
  });
});
