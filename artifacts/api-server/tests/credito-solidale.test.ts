import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
  creditoSolidaleMovimentiTable,
  db,
  impostazioniModuliTable,
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

async function setEmporioEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(impostazioniModuliTable)
    .values({ id: 1, emporioAbilitato: enabled, unitaStradaAbilitata: true })
    .onConflictDoUpdate({
      target: impostazioniModuliTable.id,
      set: { emporioAbilitato: enabled, unitaStradaAbilitata: true },
    });
}

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
  creditoSolidaleAbilitato?: boolean;
  creditoSolidaleStato?: "non_abilitato" | "attivo" | "sospeso" | "revocato";
  creditoSolidaleMensileAssegnato?: number | null;
  creditoSolidaleSaldo?: number;
  attivo?: boolean;
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
      creditoSolidaleAbilitato: opts.creditoSolidaleAbilitato ?? false,
      creditoSolidaleStato: opts.creditoSolidaleStato ?? "non_abilitato",
      creditoSolidaleMensileAssegnato: opts.creditoSolidaleMensileAssegnato == null ? null : opts.creditoSolidaleMensileAssegnato.toFixed(2),
      ...(opts.creditoSolidaleSaldo == null ? {} : { creditoSolidaleSaldo: opts.creditoSolidaleSaldo.toFixed(2) }),
      attivo: opts.attivo ?? true,
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

beforeEach(async () => {
  await setEmporioEnabled(true);
});

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
    await db.delete(creditoSolidaleMovimentiTable).where(inArray(creditoSolidaleMovimentiTable.beneficiarioId, beneficiarioIds));
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, beneficiarioIds.splice(0)));
  }
  if (centroIds.length > 0) {
    await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centroIds.splice(0)));
  }
  if (cittaIds.length > 0) {
    await db.delete(cittaTable).where(inArray(cittaTable.id, cittaIds.splice(0)));
  }
  await setEmporioEnabled(false);
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

describe("Movimenti Credito Solidale", () => {
  it("crea una ricarica manuale e aggiorna il saldo solo tramite movimento", async () => {
    const beneficiarioId = await createBeneficiario({
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
    });

    const res = await request(makeApp({ centroAscoltoId: null, cittaId: null }))
      .post(`/credito-solidale/beneficiari/${beneficiarioId}/ricarica-manuale`)
      .send({ variazioneCredito: 25, motivo: "Avvio saldo" });

    expect(res.status).toBe(201);
    expect(res.body.tipoMovimento).toBe("ricarica_manuale");
    expect(res.body.saldoPrima).toBe(0);
    expect(res.body.variazioneCredito).toBe(25);
    expect(res.body.saldoDopo).toBe(25);

    const saldo = await request(makeApp({ centroAscoltoId: null, cittaId: null }))
      .get(`/credito-solidale/beneficiari/${beneficiarioId}/saldo`);
    expect(saldo.status).toBe(200);
    expect(saldo.body.saldoAttuale).toBe(25);
  });

  it("blocca una rettifica negativa che renderebbe il saldo sotto zero", async () => {
    const beneficiarioId = await createBeneficiario({
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
    });
    await request(makeApp({ centroAscoltoId: null, cittaId: null }))
      .post(`/credito-solidale/beneficiari/${beneficiarioId}/ricarica-manuale`)
      .send({ variazioneCredito: 10 });

    const res = await request(makeApp({ centroAscoltoId: null, cittaId: null }))
      .post(`/credito-solidale/beneficiari/${beneficiarioId}/rettifica`)
      .send({ variazioneCredito: -15, motivo: "Controllo saldo" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Il saldo Credito Solidale non può diventare negativo.");
    const saldo = await request(makeApp({ centroAscoltoId: null, cittaId: null }))
      .get(`/credito-solidale/beneficiari/${beneficiarioId}/saldo`);
    expect(saldo.body.saldoAttuale).toBe(10);
  });

  it("usa la quota mensile assegnata per la ricarica mensile ed evita duplicazioni per periodo", async () => {
    const cittaId = await createCitta();
    const centroId = await createCentro(cittaId);
    const ricaricabileId = await createBeneficiario({
      cittaId,
      centroAscoltoId: centroId,
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
      creditoSolidaleMensileAssegnato: 15,
    });
    await createBeneficiario({
      cittaId,
      centroAscoltoId: centroId,
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
      creditoSolidaleMensileAssegnato: null,
    });
    const app = makeApp({ centroAscoltoId: null, cittaId: null });

    const preview = await request(app)
      .post("/credito-solidale/ricariche-mensili/preview")
      .send({ periodoRiferimento: "2026-07", centroAscoltoId: centroId });

    expect(preview.status).toBe(200);
    expect(preview.body.totaleRicaricabili).toBe(1);
    expect(preview.body.totaleCreditoDaRicaricare).toBe(15);
    expect(preview.body.righe.find((r: { beneficiarioId: number }) => r.beneficiarioId === ricaricabileId).saldoPrevistoDopoRicarica).toBe(15);

    const first = await request(app)
      .post("/credito-solidale/ricariche-mensili/esegui")
      .send({ periodoRiferimento: "2026-07", centroAscoltoId: centroId });
    expect(first.status).toBe(200);
    expect(first.body.creati).toBe(1);
    expect(first.body.totaleCreditoRicaricato).toBe(15);

    const second = await request(app)
      .post("/credito-solidale/ricariche-mensili/esegui")
      .send({ periodoRiferimento: "2026-07", centroAscoltoId: centroId });
    expect(second.status).toBe(200);
    expect(second.body.creati).toBe(0);
    expect(second.body.saltatiGiaRicaricati).toBe(1);

    const saldo = await request(app).get(`/credito-solidale/beneficiari/${ricaricabileId}/saldo`);
    expect(saldo.body.saldoAttuale).toBe(15);
  });

  it("con modulo Emporio disabilitato consente lettura e blocca nuovi movimenti", async () => {
    const beneficiarioId = await createBeneficiario({
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
    });
    await setEmporioEnabled(false);

    const saldo = await request(makeApp({ centroAscoltoId: null, cittaId: null }))
      .get(`/credito-solidale/beneficiari/${beneficiarioId}/saldo`);
    expect(saldo.status).toBe(200);

    const write = await request(makeApp({ centroAscoltoId: null, cittaId: null }))
      .post(`/credito-solidale/beneficiari/${beneficiarioId}/ricarica-manuale`)
      .send({ variazioneCredito: 5 });
    expect(write.status).toBe(403);
    expect(write.body.error).toBe("Il modulo Emporio Solidale è disabilitato. Abilitalo da Impostazioni Moduli per utilizzare questa funzione.");
  });

  it("storna un movimento creando il movimento contrario e impedisce il doppio storno", async () => {
    const beneficiarioId = await createBeneficiario({
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
    });
    const app = makeApp({ centroAscoltoId: null, cittaId: null });
    const movimento = await request(app)
      .post(`/credito-solidale/beneficiari/${beneficiarioId}/ricarica-manuale`)
      .send({ variazioneCredito: 20 });

    const storno = await request(app)
      .post(`/credito-solidale/movimenti/${movimento.body.id}/storno`)
      .send({ motivo: "Errore operativo" });

    expect(storno.status).toBe(201);
    expect(storno.body.tipoMovimento).toBe("storno");
    expect(storno.body.variazioneCredito).toBe(-20);
    expect(storno.body.saldoDopo).toBe(0);

    const lista = await request(app).get(`/credito-solidale/beneficiari/${beneficiarioId}/movimenti`);
    const originale = lista.body.find((m: { id: number }) => m.id === movimento.body.id);
    expect(originale.annullato).toBe(true);
    expect(originale.annullatoDaMovimentoId).toBe(storno.body.id);

    const second = await request(app)
      .post(`/credito-solidale/movimenti/${movimento.body.id}/storno`)
      .send({ motivo: "Secondo tentativo" });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("Il movimento è già stato stornato.");
  });

  it("rispetta lo scoping centro nella lista movimenti", async () => {
    const cittaId = await createCitta();
    const centroA = await createCentro(cittaId);
    const centroB = await createCentro(cittaId);
    const beneficiarioA = await createBeneficiario({
      cittaId,
      centroAscoltoId: centroA,
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
    });
    const beneficiarioB = await createBeneficiario({
      cittaId,
      centroAscoltoId: centroB,
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
    });
    const forbidden = await request(makeApp({ centroAscoltoId: centroA, cittaId: null }))
      .post(`/credito-solidale/beneficiari/${beneficiarioB}/ricarica-manuale`)
      .send({ variazioneCredito: 9 });
    expect(forbidden.status).toBe(403);
    const globalApp = makeApp({ centroAscoltoId: null, cittaId: null });
    await request(globalApp).post(`/credito-solidale/beneficiari/${beneficiarioA}/ricarica-manuale`).send({ variazioneCredito: 7 });
    await request(globalApp).post(`/credito-solidale/beneficiari/${beneficiarioB}/ricarica-manuale`).send({ variazioneCredito: 9 });

    const scoped = await request(makeApp({ centroAscoltoId: centroA, cittaId: null }))
      .get("/credito-solidale/movimenti");

    expect(scoped.status).toBe(200);
    expect(scoped.body.map((m: { beneficiarioId: number }) => m.beneficiarioId)).toEqual([beneficiarioA]);
  });
});
