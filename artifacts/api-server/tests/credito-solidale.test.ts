import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
  db,
  politicheCreditoSolidaleTable,
  pool,
} from "@workspace/db";
import creditoSolidaleRouter from "../src/routes/credito-solidale";
import politicheCreditoSolidaleRouter from "../src/routes/politiche-credito-solidale";

const rnd = () => Math.random().toString(36).slice(2, 8);

const politicaIds: number[] = [];
const beneficiarioIds: number[] = [];
const centroIds: number[] = [];
const cittaIds: number[] = [];
const policyIdsToReactivate: number[] = [];

function makeApp(user: { centroAscoltoId: number | null; cittaId: number | null; isAdmin?: boolean }): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: typeof user & { id: number } }).user = {
      id: 1,
      ...user,
      isAdmin: user.isAdmin ?? true,
    };
    next();
  });
  app.use(politicheCreditoSolidaleRouter);
  app.use(creditoSolidaleRouter);
  return app;
}

async function createCitta(): Promise<number> {
  const [citta] = await db.insert(cittaTable).values({ nome: `Citta ${rnd()}` }).returning({ id: cittaTable.id });
  cittaIds.push(citta.id);
  return citta.id;
}

async function createCentro(cittaId: number): Promise<number> {
  const [centro] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `Centro ${rnd()}`, cittaId })
    .returning({ id: centriAscoltoTable.id });
  centroIds.push(centro.id);
  return centro.id;
}

async function createBeneficiario(opts: {
  cittaId?: number | null;
  centroAscoltoId?: number | null;
  numComponenti?: number;
  numMinori?: number;
  numAnziani?: number;
  numDisabili?: number;
} = {}): Promise<number> {
  const [beneficiario] = await db
    .insert(beneficiariTable)
    .values({
      codice: `BEN-${rnd()}`,
      cognome: `Calcolo ${rnd()}`,
      nome: "Credito",
      sesso: "M",
      cittaId: opts.cittaId ?? null,
      centroAscoltoId: opts.centroAscoltoId ?? null,
      numComponenti: opts.numComponenti ?? 1,
      numMinori: opts.numMinori ?? 0,
      numAnziani: opts.numAnziani ?? 0,
      numDisabili: opts.numDisabili ?? 0,
    })
    .returning({ id: beneficiariTable.id });
  beneficiarioIds.push(beneficiario.id);
  return beneficiario.id;
}

async function createPolicy(data: Record<string, unknown>): Promise<number> {
  const res = await request(makeApp({ centroAscoltoId: null, cittaId: null }))
    .post("/politiche-credito-solidale")
    .send({
      nome: `Politica ${rnd()}`,
      creditoPerComponente: 0,
      bonusMinore: 0,
      bonusAnziano: 0,
      bonusDisabile: 0,
      creditoMinimoMensile: 0,
      ...data,
    });
  expect(res.status).toBe(201);
  politicaIds.push(res.body.id);
  return res.body.id;
}

async function deactivateActivePoliciesForDefaultCase(): Promise<void> {
  const rows = await db
    .select({ id: politicheCreditoSolidaleTable.id })
    .from(politicheCreditoSolidaleTable)
    .where(eq(politicheCreditoSolidaleTable.attiva, true));
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  policyIdsToReactivate.push(...ids);
  await db
    .update(politicheCreditoSolidaleTable)
    .set({ attiva: false })
    .where(inArray(politicheCreditoSolidaleTable.id, ids));
}

afterEach(async () => {
  if (policyIdsToReactivate.length > 0) {
    await db
      .update(politicheCreditoSolidaleTable)
      .set({ attiva: true })
      .where(inArray(politicheCreditoSolidaleTable.id, policyIdsToReactivate.splice(0)));
  }
  if (politicaIds.length > 0) {
    await db.delete(politicheCreditoSolidaleTable).where(inArray(politicheCreditoSolidaleTable.id, politicaIds.splice(0)));
  }
  if (beneficiarioIds.length > 0) {
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, beneficiarioIds.splice(0)));
  }
  if (centroIds.length > 0) {
    await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centroIds.splice(0)));
  }
  if (cittaIds.length > 0) {
    await db.delete(cittaTable).where(inArray(cittaTable.id, cittaIds.splice(0)));
  }
});

afterAll(async () => {
  await pool.end();
});

describe("Politiche Credito Solidale", () => {
  it("valida il giorno di ricarica mensile", async () => {
    const res = await request(makeApp({ centroAscoltoId: null, cittaId: null }))
      .post("/politiche-credito-solidale")
      .send({ nome: "Giorno non valido", giornoRicaricaMensile: 29 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Il giorno di ricarica mensile deve essere compreso tra 1 e 28.");
  });

  it("valida il rapporto tra massimo e minimo mensile", async () => {
    const res = await request(makeApp({ centroAscoltoId: null, cittaId: null }))
      .post("/politiche-credito-solidale")
      .send({ nome: "Massimo non valido", creditoMinimoMensile: 30, creditoMassimoMensile: 20 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Il credito massimo mensile deve essere maggiore o uguale al minimo.");
  });

  it("calcola la quota mensile suggerita con limiti e arrotondamento", async () => {
    await createPolicy({
      creditoBaseNucleo: 20,
      creditoPerComponente: 3,
      bonusMinore: 2,
      bonusAnziano: 4,
      bonusDisabile: 5,
      creditoMassimoMensile: 40,
      arrotondamento: "intero_superiore",
    });
    const beneficiarioId = await createBeneficiario({
      numComponenti: 3,
      numMinori: 2,
      numAnziani: 1,
      numDisabili: 1,
    });

    const res = await request(makeApp({ centroAscoltoId: null, cittaId: null }))
      .get(`/credito-solidale/calcola-beneficiario/${beneficiarioId}`);

    expect(res.status).toBe(200);
    expect(res.body.politicaOrigine).toBe("globale");
    expect(res.body.dettaglio.totalePrimaDeiLimiti).toBe(42);
    expect(res.body.dettaglio.creditoMassimoApplicato).toBe(40);
    expect(res.body.dettaglio.arrotondamentoApplicato).toBe("intero_superiore");
    expect(res.body.totaleSuggerito).toBe(40);
  });

  it("sceglie la politica più specifica tra centro, area e globale", async () => {
    const cittaId = await createCitta();
    const centroId = await createCentro(cittaId);
    await createPolicy({ nome: "Globale", creditoBaseNucleo: 10 });
    await createPolicy({ nome: "Area", cittaId, creditoBaseNucleo: 20 });
    await createPolicy({ nome: "Centro", cittaId, centroAscoltoId: centroId, creditoBaseNucleo: 30 });
    const beneficiarioCentro = await createBeneficiario({ cittaId, centroAscoltoId: centroId });
    const beneficiarioCitta = await createBeneficiario({ cittaId });
    const beneficiarioGlobale = await createBeneficiario();

    const app = makeApp({ centroAscoltoId: null, cittaId: null });
    const centro = await request(app).get(`/credito-solidale/calcola-beneficiario/${beneficiarioCentro}`);
    const citta = await request(app).get(`/credito-solidale/calcola-beneficiario/${beneficiarioCitta}`);
    const globale = await request(app).get(`/credito-solidale/calcola-beneficiario/${beneficiarioGlobale}`);

    expect(centro.body.politicaOrigine).toBe("centro");
    expect(centro.body.totaleSuggerito).toBe(30);
    expect(citta.body.politicaOrigine).toBe("citta");
    expect(citta.body.totaleSuggerito).toBe(20);
    expect(globale.body.politicaOrigine).toBe("globale");
    expect(globale.body.totaleSuggerito).toBe(10);
  });

  it("usa la politica predefinita in memoria quando non esistono politiche attive", async () => {
    await deactivateActivePoliciesForDefaultCase();
    await createPolicy({ nome: "Inattiva", attiva: false, creditoBaseNucleo: 999 });
    const beneficiarioId = await createBeneficiario({ numComponenti: 1 });

    const res = await request(makeApp({ centroAscoltoId: null, cittaId: null }))
      .get(`/credito-solidale/calcola-beneficiario/${beneficiarioId}`);

    expect(res.status).toBe(200);
    expect(res.body.politicaId).toBeNull();
    expect(res.body.politicaOrigine).toBe("default");
    expect(res.body.totaleSuggerito).toBe(60);
  });
});
