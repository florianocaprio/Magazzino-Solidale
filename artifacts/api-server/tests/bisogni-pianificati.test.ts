import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request, { type Response } from "supertest";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  bisogniPianificatiStoricoTable,
  bisogniPianificatiTable,
  centriAscoltoTable,
  areeOperativeTable,
  db,
  interventiTable,
  pool,
  utentiTable,
  zoneUdsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import interventiRouter from "../src/routes/interventi";
import udsRouter from "../src/routes/uds";

const rnd = () => Math.random().toString(36).slice(2, 8);
const bisognoIds: number[] = [];
const interventoIds: number[] = [];
const beneficiarioIds: number[] = [];
const centroIds: number[] = [];
const zonaIds: number[] = [];
const areaOperativaIds: number[] = [];

let operatorUserId: number;
let areaOperativaRoma: number;
let areaOperativaMilano: number;
let centroRoma: number;
let zonaRoma: number;

function makeApp(
  areaOperativaId: number | null = areaOperativaRoma,
  centroAscoltoId: number | null = centroRoma,
  zonaUdsId: number | null = zonaRoma,
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (
      req as unknown as {
        user: {
          id: number;
          areaOperativaId: number | null;
          centroAscoltoId: number | null;
          zonaUdsId: number | null;
          aree: string[];
          permessi: string[];
        };
      }
    ).user = {
      id: operatorUserId,
      areaOperativaId,
      centroAscoltoId,
      zonaUdsId,
      aree: ["uds"],
      permessi: [
        "uds.interventi.view",
        "uds.interventi.create",
        "uds.bisogni.manage",
      ],
    };
    next();
  });
  app.use(udsRouter);
  app.use(interventiRouter);
  return app;
}

async function createAreaOperativa(nome: string): Promise<number> {
  const [row] = await db
    .insert(areeOperativeTable)
    .values({ nome })
    .returning({ id: areeOperativeTable.id });
  areaOperativaIds.push(row.id);
  return row.id;
}

async function createCentro(areaOperativaId: number): Promise<number> {
  const [row] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `Centro ${rnd()}`, areaOperativaId })
    .returning({ id: centriAscoltoTable.id });
  centroIds.push(row.id);
  return row.id;
}

async function createZona(areaOperativaId: number): Promise<number> {
  const [row] = await db
    .insert(zoneUdsTable)
    .values({ nome: `Zona ${rnd()}`, areaOperativaId })
    .returning({ id: zoneUdsTable.id });
  zonaIds.push(row.id);
  return row.id;
}

async function createBeneficiario(
  areaOperativaId: number | null,
  centroAscoltoId: number | null = null,
  zonaUdsId: number | null = null,
): Promise<number> {
  const [row] = await db
    .insert(beneficiariTable)
    .values({
      codice: `BEN-${rnd()}`,
      nome: "Persona",
      cognome: rnd(),
      sesso: "M",
      uds: true,
      areaOperativaId,
      centroAscoltoId,
      zonaUdsId,
    })
    .returning({ id: beneficiariTable.id });
  beneficiarioIds.push(row.id);
  return row.id;
}

async function createIntervento(beneficiarioId: number): Promise<number> {
  const [beneficiario] = await db
    .select({
      areaOperativaId: beneficiariTable.areaOperativaId,
      zonaUdsId: beneficiariTable.zonaUdsId,
    })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  const [row] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId,
      dataIntervento: "2026-08-14",
      tipoIntervento: "ascolto",
      ambito: beneficiario?.areaOperativaId == null ? null : "uds",
      areaOperativaIdSnapshot: beneficiario?.areaOperativaId ?? null,
      zonaUdsIdSnapshot: beneficiario?.zonaUdsId ?? null,
    })
    .returning({ id: interventiTable.id });
  interventoIds.push(row.id);
  return row.id;
}

async function createNeed(
  interventoId: number,
  overrides: Record<string, unknown> = {},
): Promise<Response> {
  const response = await request(makeApp())
    .post(`/interventi/${interventoId}/bisogni-pianificati`)
    .send({
      tipo: "richiesta",
      descrizione: `Bisogno ${rnd()}`,
      stato: "da_pianificare",
      priorita: "normale",
      ...overrides,
    });
  if (response.body?.id) bisognoIds.push(response.body.id);
  return response;
}

beforeAll(async () => {
  areaOperativaRoma = await createAreaOperativa(`Roma ${rnd()}`);
  areaOperativaMilano = await createAreaOperativa(`Milano ${rnd()}`);
  centroRoma = await createCentro(areaOperativaRoma);
  zonaRoma = await createZona(areaOperativaRoma);
  const [operator] = await db
    .insert(utentiTable)
    .values({
      username: `bisogni_test_${rnd()}`,
      passwordHash: "test-only",
      nome: "Operatore Bisogni",
      attivo: true,
      areaOperativaId: areaOperativaRoma,
      centroAscoltoId: centroRoma,
      zonaUdsId: zonaRoma,
    })
    .returning({ id: utentiTable.id });
  operatorUserId = operator.id;
});

afterAll(async () => {
  if (interventoIds.length > 0) {
    const needs = await db
      .select({ id: bisogniPianificatiTable.id })
      .from(bisogniPianificatiTable)
      .where(inArray(bisogniPianificatiTable.interventoId, interventoIds));
    if (needs.length > 0) {
      await db
        .delete(bisogniPianificatiStoricoTable)
        .where(
          inArray(
            bisogniPianificatiStoricoTable.bisognoId,
            needs.map((need) => need.id),
          ),
        );
    }
    await db
      .delete(bisogniPianificatiTable)
      .where(inArray(bisogniPianificatiTable.interventoId, interventoIds));
  }
  if (interventoIds.length > 0) {
    await db
      .delete(interventiTable)
      .where(inArray(interventiTable.id, interventoIds));
  }
  if (beneficiarioIds.length > 0) {
    await db
      .delete(beneficiariTable)
      .where(inArray(beneficiariTable.id, beneficiarioIds));
  }
  await db
    .delete(auditConfigurazioniTable)
    .where(eq(auditConfigurazioniTable.utenteId, operatorUserId));
  await db.delete(utentiTable).where(eq(utentiTable.id, operatorUserId));
  if (zonaIds.length > 0)
    await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zonaIds));
  if (centroIds.length > 0) {
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, centroIds));
  }
  if (areaOperativaIds.length > 0)
    await db.delete(areeOperativeTable).where(inArray(areeOperativeTable.id, areaOperativaIds));
  await pool.end();
});

describe("Bisogni Pianificati negli Interventi UDS", () => {
  it("crea e consulta un intervento senza Bisogni Pianificati", async () => {
    const beneficiarioId = await createBeneficiario(
      areaOperativaRoma,
      centroRoma,
      zonaRoma,
    );
    const created = await request(makeApp()).post("/uds/interventi").send({
      beneficiarioId,
      tipoIntervento: "ascolto",
      bisogniPianificati: [],
    });
    expect(created.status).toBe(201);
    interventoIds.push(created.body.id);

    const history = await request(makeApp()).get(
      `/interventi/${created.body.id}/bisogni-pianificati`,
    );
    expect(history.status).toBe(200);
    expect(history.body).toEqual([]);
  });

  it("crea contestualmente uno o più bisogni distinguendo richiesta e azione", async () => {
    const beneficiarioId = await createBeneficiario(areaOperativaRoma);
    const created = await request(makeApp())
      .post("/uds/interventi")
      .send({
        beneficiarioId,
        tipoIntervento: "ascolto",
        bisogniPianificati: [
          {
            tipo: "richiesta",
            descrizione: "Richiesta documenti",
            stato: "da_pianificare",
            priorita: "normale",
          },
          {
            tipo: "azione",
            descrizione: "Prenotare visita",
            stato: "pianificato",
            priorita: "alta",
            dataPrevista: "2026-08-20",
          },
        ],
    });
    expect(created.status).toBe(201);
    interventoIds.push(created.body.id);

    const history = await request(makeApp()).get(
      `/interventi/${created.body.id}/bisogni-pianificati`,
    );
    expect(history.status).toBe(200);
    bisognoIds.push(...history.body.map((row: { id: number }) => row.id));
    expect(
      history.body.map((row: { tipo: string }) => row.tipo).sort(),
    ).toEqual(["azione", "richiesta"]);
    expect(history.body).toHaveLength(2);
  });

  it("annulla transazionalmente anche l'intervento se un bisogno contestuale non è valido", async () => {
    const beneficiarioId = await createBeneficiario(areaOperativaRoma);
    const before = await db
      .select({ id: interventiTable.id })
      .from(interventiTable);
    const response = await request(makeApp())
      .post("/uds/interventi")
      .send({
        beneficiarioId,
        tipoIntervento: "ascolto",
        bisogniPianificati: [
          {
            tipo: "richiesta",
            descrizione: "Valido",
            stato: "da_pianificare",
            priorita: "normale",
          },
          {
            tipo: "azione",
            descrizione: "",
            stato: "pianificato",
            priorita: "alta",
          },
        ],
      });
    expect(response.status).toBe(400);
    const after = await db
      .select({ id: interventiTable.id })
      .from(interventiTable);
    expect(after).toHaveLength(before.length);
  });

  it("richiede la data prevista per il passaggio a pianificato", async () => {
    const beneficiarioId = await createBeneficiario(areaOperativaRoma);
    const interventoId = await createIntervento(beneficiarioId);
    const created = await createNeed(interventoId);
    expect(created.status).toBe(201);

    const rejected = await request(makeApp())
      .patch(
        `/interventi/${interventoId}/bisogni-pianificati/${created.body.id}`,
      )
      .send({ versione: created.body.versione, stato: "pianificato" });
    expect(rejected.status).toBe(400);

    const planned = await request(makeApp())
      .patch(
        `/interventi/${interventoId}/bisogni-pianificati/${created.body.id}`,
      )
      .send({
        versione: created.body.versione,
        stato: "pianificato",
        dataPrevista: "2026-08-20",
      });
    expect(planned.status).toBe(200);
    expect(planned.body.stato).toBe("pianificato");
    expect(planned.body.dataPrevista).toBe("2026-08-20");
  });

  it("valorizza la data al completamento e la azzera alla riapertura", async () => {
    const beneficiarioId = await createBeneficiario(areaOperativaRoma);
    const interventoId = await createIntervento(beneficiarioId);
    const created = await createNeed(interventoId, { tipo: "azione" });

    const completed = await request(makeApp())
      .patch(
        `/interventi/${interventoId}/bisogni-pianificati/${created.body.id}`,
      )
      .send({ versione: created.body.versione, stato: "completato" });
    expect(completed.status).toBe(200);
    expect(completed.body.dataCompletamento).toEqual(expect.any(String));

    const reopened = await request(makeApp())
      .patch(
        `/interventi/${interventoId}/bisogni-pianificati/${created.body.id}`,
      )
      .send({ versione: completed.body.versione, stato: "da_pianificare" });
    expect(reopened.status).toBe(200);
    expect(reopened.body.dataCompletamento).toBeNull();
  });

  it("mantiene gli elementi annullati nello storico senza cancellazione", async () => {
    const beneficiarioId = await createBeneficiario(areaOperativaRoma);
    const interventoId = await createIntervento(beneficiarioId);
    const created = await createNeed(interventoId);
    const cancelled = await request(makeApp())
      .patch(
        `/interventi/${interventoId}/bisogni-pianificati/${created.body.id}`,
      )
      .send({ versione: created.body.versione, stato: "annullato" });
    expect(cancelled.status).toBe(200);

    const history = await request(makeApp()).get(
      `/interventi/${interventoId}/bisogni-pianificati`,
    );
    expect(history.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.body.id, stato: "annullato" }),
      ]),
    );
  });

  it("ordina per data prevista e priorità e individua gli elementi scaduti", async () => {
    const beneficiarioId = await createBeneficiario(areaOperativaRoma);
    const interventoId = await createIntervento(beneficiarioId);
    const first = await createNeed(interventoId, {
      descrizione: "Data prima",
      dataPrevista: "2000-01-01",
      priorita: "bassa",
    });
    const urgent = await createNeed(interventoId, {
      descrizione: "Urgente",
      dataPrevista: "2999-01-01",
      priorita: "urgente",
    });
    const normal = await createNeed(interventoId, {
      descrizione: "Normale",
      dataPrevista: "2999-01-01",
      priorita: "normale",
    });
    expect(first.status).toBe(201);
    expect(urgent.status).toBe(201);
    expect(normal.status).toBe(201);

    const history = await request(makeApp()).get(
      `/interventi/${interventoId}/bisogni-pianificati`,
    );
    expect(
      history.body.map((row: { descrizione: string }) => row.descrizione),
    ).toEqual(["Data prima", "Urgente", "Normale"]);

    const filtered = await request(makeApp())
      .get("/interventi")
      .query({ beneficiarioId, bisogni: "scaduti" });
    expect(filtered.status).toBe(200);
    expect(filtered.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: interventoId,
          bisogniPianificatiTotale: 3,
          bisogniPianificatiScaduti: 1,
          bisogniPianificatiProssimaScadenza: "2000-01-01",
        }),
      ]),
    );
  });

  it("filtra lo storico degli interventi senza bisogni e con bisogni aperti", async () => {
    const beneficiarioId = await createBeneficiario(areaOperativaRoma);
    const emptyInterventoId = await createIntervento(beneficiarioId);
    const openInterventoId = await createIntervento(beneficiarioId);
    await createNeed(openInterventoId);

    const empty = await request(makeApp())
      .get("/interventi")
      .query({ beneficiarioId, bisogni: "nessuno" });
    expect(empty.body.map((row: { id: number }) => row.id)).toContain(
      emptyInterventoId,
    );
    expect(empty.body.map((row: { id: number }) => row.id)).not.toContain(
      openInterventoId,
    );

    const open = await request(makeApp())
      .get("/interventi")
      .query({ beneficiarioId, bisogni: "aperti" });
    expect(open.body.map((row: { id: number }) => row.id)).toContain(
      openInterventoId,
    );
    expect(open.body.map((row: { id: number }) => row.id)).not.toContain(
      emptyInterventoId,
    );
  });

  it("consente la gestione nella stessa area operativa anche con centro e zona differenti", async () => {
    const altroCentro = await createCentro(areaOperativaRoma);
    const altraZona = await createZona(areaOperativaRoma);
    const beneficiarioId = await createBeneficiario(
      areaOperativaRoma,
      altroCentro,
      altraZona,
    );
    const interventoId = await createIntervento(beneficiarioId);

    const created = await createNeed(interventoId, {
      descrizione: "Stessa area operativa",
    });
    expect(created.status).toBe(201);
    const history = await request(makeApp()).get(
      `/interventi/${interventoId}/bisogni-pianificati`,
    );
    expect(history.status).toBe(200);
  });

  it.each([
    ["altra area operativa", () => createBeneficiario(areaOperativaMilano)],
    ["area operativa NULL", () => createBeneficiario(null)],
  ])(
    "nega lettura e modifica per un intervento di %s",
    async (_label, makeBeneficiario) => {
      const beneficiarioId = await makeBeneficiario();
      const interventoId = await createIntervento(beneficiarioId);
      const [need] = await db
        .insert(bisogniPianificatiTable)
        .values({ interventoId, tipo: "richiesta", descrizione: "Protetto" })
        .returning({ id: bisogniPianificatiTable.id });
      bisognoIds.push(need.id);

      const history = await request(makeApp()).get(
        `/interventi/${interventoId}/bisogni-pianificati`,
      );
      expect(history.status).toBe(403);
      const created = await request(makeApp())
        .post(`/interventi/${interventoId}/bisogni-pianificati`)
        .send({ tipo: "azione", descrizione: "Non consentito" });
      expect(created.status).toBe(403);
      const updated = await request(makeApp())
        .patch(`/interventi/${interventoId}/bisogni-pianificati/${need.id}`)
        .send({ stato: "annullato" });
      expect(updated.status).toBe(403);
    },
  );

  it("permette a un utente globale di gestire una area operativa valorizzata ma non un legacy NULL", async () => {
    const globalApp = makeApp(null, null, null);
    const beneficiarioMilano = await createBeneficiario(areaOperativaMilano);
    const interventoMilano = await createIntervento(beneficiarioMilano);
    const allowed = await request(globalApp)
      .post(`/interventi/${interventoMilano}/bisogni-pianificati`)
      .send({ tipo: "azione", descrizione: "Globale" });
    expect(allowed.status).toBe(201);
    bisognoIds.push(allowed.body.id);

    const beneficiarioLegacy = await createBeneficiario(null);
    const interventoLegacy = await createIntervento(beneficiarioLegacy);
    const denied = await request(globalApp).get(
      `/interventi/${interventoLegacy}/bisogni-pianificati`,
    );
    expect(denied.status).toBe(403);
  });

  it("non permette di modificare un bisogno appartenente a un altro intervento", async () => {
    const beneficiarioId = await createBeneficiario(areaOperativaRoma);
    const interventoA = await createIntervento(beneficiarioId);
    const interventoB = await createIntervento(beneficiarioId);
    const created = await createNeed(interventoB, {
      descrizione: "Resta su B",
    });

    const response = await request(makeApp())
      .patch(
        `/interventi/${interventoA}/bisogni-pianificati/${created.body.id}`,
      )
      .send({
        versione: created.body.versione,
        descrizione: "Tentativo",
      });
    expect(response.status).toBe(404);

    const [stored] = await db
      .select({ descrizione: bisogniPianificatiTable.descrizione })
      .from(bisogniPianificatiTable)
      .where(
        and(
          eq(bisogniPianificatiTable.id, created.body.id),
          eq(bisogniPianificatiTable.interventoId, interventoB),
        ),
      );
    expect(stored.descrizione).toBe("Resta su B");
  });

  it.each([
    ["tipo", { tipo: "altro", descrizione: "Test" }],
    ["stato", { tipo: "richiesta", descrizione: "Test", stato: "aperto" }],
    [
      "priorità",
      { tipo: "richiesta", descrizione: "Test", priorita: "massima" },
    ],
    ["descrizione vuota", { tipo: "richiesta", descrizione: "" }],
    [
      "descrizione troppo lunga",
      { tipo: "richiesta", descrizione: "x".repeat(501) },
    ],
    [
      "note troppo lunghe",
      { tipo: "richiesta", descrizione: "Test", note: "x".repeat(2001) },
    ],
  ])("valida %s", async (_label, payload) => {
    const beneficiarioId = await createBeneficiario(areaOperativaRoma);
    const interventoId = await createIntervento(beneficiarioId);
    const response = await request(makeApp())
      .post(`/interventi/${interventoId}/bisogni-pianificati`)
      .send(payload);
    expect(response.status).toBe(400);
  });
});
