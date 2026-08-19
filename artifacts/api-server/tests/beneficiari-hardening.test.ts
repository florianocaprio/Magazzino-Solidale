import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
  db,
  interventiTable,
  magazziniTable,
  nucleoFamiliareTable,
  utentiTable,
  zoneUdsTable,
} from "@workspace/db";
import beneficiariRouter from "../src/routes/beneficiari";

const suffix = Math.random().toString(36).slice(2, 9);
const beneficiaryIds: number[] = [];
const interventionIds: number[] = [];
const warehouseIds: number[] = [];
const centerIds: number[] = [];
const zoneIds: number[] = [];
const areaIds: number[] = [];
let auditUserId: number;
let areaA: number;
let areaB: number;
let inactiveArea: number;
let centerA: number;
let centerB: number;
let inactiveCenter: number;
let zoneA: number;
let zoneB: number;
let emporioA: number;
let emporioB: number;

type TestUser = {
  cittaId: number | null;
  centroAscoltoId: number | null;
  zonaUdsId: number | null;
  aree: string[];
  permessi: string[];
  isAdmin?: boolean;
};

const SOCIAL_PERMISSIONS = [
  "beneficiari.view",
  "beneficiari.manage",
  "beneficiari.sensitive.view",
  "beneficiari.deactivate",
  "beneficiari.export",
  "beneficiari.duplicates.search",
  "credito.view",
];

function makeApp(user: TestUser): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: auditUserId,
      username: `audit-${suffix}`,
      email: null,
      emailDaAggiornare: false,
      nome: "Audit",
      cognome: null,
      matricola: null,
      ruoloId: null,
      ruoloNome: null,
      centroAscoltoNome: null,
      cittaNome: null,
      zonaUdsNome: null,
      isSuperAdmin: false,
      mustChangePassword: false,
      isAdmin: user.isAdmin ?? false,
      ...user,
    };
    next();
  });
  app.use(beneficiariRouter);
  return app;
}

const socialAreaA = () => makeApp({
  cittaId: areaA,
  centroAscoltoId: null,
  zonaUdsId: null,
  aree: ["sociale"],
  permessi: SOCIAL_PERMISSIONS,
});

async function createArea(nome: string, attivo = true): Promise<number> {
  const [row] = await db.insert(cittaTable).values({ nome: `${nome}-${suffix}`, attivo }).returning({ id: cittaTable.id });
  areaIds.push(row.id);
  return row.id;
}

async function createCenter(cittaId: number, nome: string, attivo = true): Promise<number> {
  const [row] = await db.insert(centriAscoltoTable).values({ nome: `${nome}-${suffix}`, cittaId, attivo }).returning({ id: centriAscoltoTable.id });
  centerIds.push(row.id);
  return row.id;
}

async function createZone(cittaId: number, nome: string): Promise<number> {
  const [row] = await db.insert(zoneUdsTable).values({ nome: `${nome}-${suffix}`, cittaId }).returning({ id: zoneUdsTable.id });
  zoneIds.push(row.id);
  return row.id;
}

async function createWarehouse(cittaId: number, nome: string): Promise<number> {
  const [row] = await db.insert(magazziniTable).values({
    codice: `E-${suffix}-${nome.slice(-1)}`,
    nome: `${nome}-${suffix}`,
    tipoMagazzino: "emporio",
    cittaId,
  }).returning({ id: magazziniTable.id });
  warehouseIds.push(row.id);
  return row.id;
}

async function insertBeneficiary(values: Partial<typeof beneficiariTable.$inferInsert> = {}) {
  const [row] = await db.insert(beneficiariTable).values({
    codice: `BEN-${Math.random().toString(36).slice(2, 10)}`,
    nome: "Persona",
    cognome: `Audit-${suffix}`,
    sesso: "M",
    cittaId: areaA,
    ...values,
  }).returning();
  beneficiaryIds.push(row.id);
  return row;
}

beforeAll(async () => {
  const [user] = await db.insert(utentiTable).values({
    username: `beneficiari-audit-${suffix}`,
    passwordHash: "test-only",
    nome: "Audit Beneficiari",
  }).returning({ id: utentiTable.id });
  auditUserId = user.id;
  areaA = await createArea("Area-A");
  areaB = await createArea("Area-B");
  inactiveArea = await createArea("Area-inattiva", false);
  centerA = await createCenter(areaA, "Centro-A");
  centerB = await createCenter(areaB, "Centro-B");
  inactiveCenter = await createCenter(areaA, "Centro-inattivo", false);
  zoneA = await createZone(areaA, "Zona-A");
  zoneB = await createZone(areaB, "Zona-B");
  emporioA = await createWarehouse(areaA, "Emporio-A");
  emporioB = await createWarehouse(areaB, "Emporio-B");
});

afterAll(async () => {
  if (interventionIds.length) await db.delete(interventiTable).where(inArray(interventiTable.id, interventionIds));
  if (beneficiaryIds.length) {
    await db.delete(nucleoFamiliareTable).where(inArray(nucleoFamiliareTable.beneficiarioId, beneficiaryIds));
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, beneficiaryIds));
  }
  await db.delete(auditConfigurazioniTable).where(eq(auditConfigurazioniTable.utenteId, auditUserId));
  if (warehouseIds.length) await db.delete(magazziniTable).where(inArray(magazziniTable.id, warehouseIds));
  if (zoneIds.length) await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zoneIds));
  if (centerIds.length) await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centerIds));
  await db.delete(utentiTable).where(eq(utentiTable.id, auditUserId));
  if (areaIds.length) await db.delete(cittaTable).where(inArray(cittaTable.id, areaIds));
});

describe("hardening Beneficiari: RBAC, DTO e scope", () => {
  it("nega lettura e mutazione senza permessi granulari", async () => {
    const app = makeApp({ cittaId: areaA, centroAscoltoId: null, zonaUdsId: null, aree: ["sociale"], permessi: [] });
    expect((await request(app).get("/beneficiari")).status).toBe(403);
    expect((await request(app).post("/beneficiari").send({ nome: "No", cognome: "Permesso", sesso: "M", cittaId: areaA })).status).toBe(403);
  });

  it("nega il dossier generico all'Emporio standard ma rispetta un grant esplicito", async () => {
    const person = await insertBeneficiary({ centroAscoltoId: centerA });
    const emporioStandard = makeApp({
      cittaId: areaA,
      centroAscoltoId: centerA,
      zonaUdsId: null,
      aree: ["sociale", "emporio"],
      permessi: ["credito.view", "emporio.access.view", "emporio.access.manage"],
    });
    expect((await request(emporioStandard).get(`/beneficiari/${person.id}`)).status).toBe(403);

    const customRole = makeApp({
      cittaId: areaA,
      centroAscoltoId: centerA,
      zonaUdsId: null,
      aree: ["sociale", "emporio"],
      permessi: ["beneficiari.view"],
    });
    expect((await request(customRole).get(`/beneficiari/${person.id}`)).status).toBe(200);
  });

  it("rifiuta mass assignment tecnico/economico in create e patch", async () => {
    const create = await request(socialAreaA()).post("/beneficiari").send({
      nome: "Mass", cognome: "Assignment", sesso: "M", cittaId: areaA, creditoSolidaleSaldo: 999,
    });
    expect(create.status).toBe(400);
    const row = await insertBeneficiary();
    const patch = await request(socialAreaA()).patch(`/beneficiari/${row.id}`).send({ versione: row.versione, creditoSolidaleSaldo: 999 });
    expect(patch.status).toBe(400);
    const [unchanged] = await db.select({ saldo: beneficiariTable.creditoSolidaleSaldo }).from(beneficiariTable).where(eq(beneficiariTable.id, row.id));
    expect(Number(unchanged.saldo)).toBe(0);
  });

  it("richiede Area e rifiuta relazioni territoriali incoerenti o inattive", async () => {
    const base = { nome: "Scope", cognome: "Test", sesso: "F" };
    expect((await request(makeApp({ cittaId: null, centroAscoltoId: null, zonaUdsId: null, aree: ["sociale"], permessi: SOCIAL_PERMISSIONS })).post("/beneficiari").send(base)).status).toBe(400);
    expect((await request(socialAreaA()).post("/beneficiari").send({ ...base, centroAscoltoId: centerB })).status).toBe(400);
    expect((await request(socialAreaA()).post("/beneficiari").send({ ...base, zonaUdsId: zoneB })).status).toBe(400);
    expect((await request(socialAreaA()).post("/beneficiari").send({ ...base, magazzinoEmporioPreferitoId: emporioB })).status).toBe(400);
    expect((await request(socialAreaA()).post("/beneficiari").send({ ...base, centroAscoltoId: inactiveCenter })).status).toBe(400);
    expect((await request(makeApp({ cittaId: null, centroAscoltoId: null, zonaUdsId: null, aree: ["sociale"], permessi: SOCIAL_PERMISSIONS })).post("/beneficiari").send({ ...base, cittaId: inactiveArea })).status).toBe(400);
  });

  it("consente all'Admin globale di creare un Beneficiario Sociale nell'Area scelta", async () => {
    const globalAdmin = makeApp({
      cittaId: null,
      centroAscoltoId: null,
      zonaUdsId: null,
      aree: ["sociale"],
      permessi: SOCIAL_PERMISSIONS,
      isAdmin: true,
    });
    const created = await request(globalAdmin).post("/beneficiari").send({
      nome: "Sociale",
      cognome: "Globale",
      sesso: "F",
      cittaId: areaA,
      centroAscoltoId: centerA,
      uds: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.cittaId).toBe(areaA);
    expect(created.body.centroAscoltoId).toBe(centerA);
    beneficiaryIds.push(created.body.id);

    const wrongCenter = await request(globalAdmin).post("/beneficiari").send({
      nome: "Sociale",
      cognome: "Incoerente",
      sesso: "F",
      cittaId: areaA,
      centroAscoltoId: centerB,
    });
    expect(wrongCenter.status).toBe(400);
  });

  it("accetta Area/Centro/Zona/Emporio coerenti e normalizza il codice fiscale", async () => {
    const response = await request(socialAreaA()).post("/beneficiari").send({
      nome: "Coerente", cognome: "Area", sesso: "ALTRO", centroAscoltoId: centerA,
      zonaUdsId: zoneA, magazzinoEmporioPreferitoId: emporioA, codiceFiscale: "  abc123  ", priorita: "urgente",
    });
    expect(response.status).toBe(201);
    expect(response.body.codiceFiscale).toBe("ABC123");
    beneficiaryIds.push(response.body.id);
  });

  it("valida stato completo, data, enum e conteggi", async () => {
    const cases = [
      { statoAnagrafica: "completa", centroAscoltoId: centerA },
      { dataNascita: "2999-01-01" },
      { sesso: "X" },
      { priorita: "estrema" },
      { numComponenti: 0 },
      { numMinori: -1 },
    ];
    for (const invalid of cases) {
      const response = await request(socialAreaA()).post("/beneficiari").send({ nome: "Invalid", cognome: "Case", sesso: "M", ...invalid });
      expect(response.status).toBe(400);
    }
  });

  it("offre directory paginata minimale e non supera l'Area", async () => {
    const a = await insertBeneficiary({ codiceFiscale: "SECRET", noteInterne: "sociale", creditoSolidaleSaldo: "50" });
    await insertBeneficiary({ cittaId: areaB });
    const response = await request(socialAreaA()).get("/beneficiari").query({ search: a.codice, page: 1, limit: 50 });
    expect(response.status).toBe(200);
    expect(response.headers["x-total-count"]).toBe("1");
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).not.toHaveProperty("codiceFiscale");
    expect(response.body[0]).not.toHaveProperty("noteInterne");
    expect(response.body[0]).not.toHaveProperty("creditoSolidaleSaldo");
    expect((await request(socialAreaA()).get("/beneficiari").query({ limit: 101 })).status).toBe(400);
    expect((await request(socialAreaA()).get("/beneficiari").query({ cittaId: "abc" })).status).toBe(400);
  });
});

describe("hardening Beneficiari: privacy, locking e storico", () => {
  it("separa dossier Sociale/UDS e mantiene la directory UDS Area-wide", async () => {
    const person = await insertBeneficiary({
      centroAscoltoId: centerA,
      zonaUdsId: zoneA,
      uds: true,
      codiceFiscale: "PRIVATE",
      noteInterne: "nota sociale",
      restrizioniAlimentari: "sensibile",
      creditoSolidaleSaldo: "77",
    });
    const [social] = await db.insert(interventiTable).values({ beneficiarioId: person.id, tipoIntervento: "Sociale", ambito: "sociale", note: "nota social" }).returning({ id: interventiTable.id });
    const [uds] = await db.insert(interventiTable).values({ beneficiarioId: person.id, tipoIntervento: "UDS", ambito: "uds", noteUds: "nota uds" }).returning({ id: interventiTable.id });
    interventionIds.push(social.id, uds.id);

    const udsApp = makeApp({ cittaId: areaA, centroAscoltoId: centerB, zonaUdsId: null, aree: ["uds"], permessi: ["beneficiari.view", "beneficiari.manage"] });
    const udsDetail = await request(udsApp).get(`/beneficiari/${person.id}`);
    expect(udsDetail.status).toBe(200);
    expect(udsDetail.body).not.toHaveProperty("codiceFiscale");
    expect(udsDetail.body).not.toHaveProperty("noteInterne");
    expect(udsDetail.body).not.toHaveProperty("creditoSolidaleSaldo");
    expect(udsDetail.body.nucleo).toEqual([]);
    expect(udsDetail.body.interventi.map((row: { ambito: string }) => row.ambito)).toEqual(["uds"]);

    const socialDetail = await request(socialAreaA()).get(`/beneficiari/${person.id}`);
    expect(socialDetail.status).toBe(200);
    expect(socialDetail.body.noteInterne).toBe("nota sociale");
    expect(socialDetail.body.interventi.map((row: { ambito: string }) => row.ambito)).toEqual(["sociale"]);
  });

  it("impedisce a UDS di scrivere campi sociali sensibili", async () => {
    const app = makeApp({ cittaId: areaA, centroAscoltoId: null, zonaUdsId: zoneA, aree: ["uds"], permessi: ["beneficiari.view", "beneficiari.manage"] });
    const response = await request(app).post("/beneficiari").send({ nome: "UDS", cognome: "Sensitive", sesso: "M", noteInterne: "no" });
    expect(response.status).toBe(403);
  });

  it("applica optimistic locking atomico e richiede versione", async () => {
    const row = await insertBeneficiary();
    expect((await request(socialAreaA()).patch(`/beneficiari/${row.id}`).send({ nome: "Senza versione" })).status).toBe(400);
    expect((await request(socialAreaA()).patch(`/beneficiari/${row.id}`).send({ nome: "Versione errata", versione: "abc" })).status).toBe(400);
    const first = await request(socialAreaA()).patch(`/beneficiari/${row.id}`).send({ nome: "Primo", versione: row.versione });
    expect(first.status).toBe(200);
    expect(first.body.versione).toBe(row.versione + 1);
    expect((await request(socialAreaA()).patch(`/beneficiari/${row.id}`).send({ nome: "Stale", versione: row.versione })).status).toBe(409);
    const concurrent = await Promise.all([
      request(socialAreaA()).patch(`/beneficiari/${row.id}`).send({ nome: "Concorrente A", versione: first.body.versione }),
      request(socialAreaA()).patch(`/beneficiari/${row.id}`).send({ nome: "Concorrente B", versione: first.body.versione }),
    ]);
    expect(concurrent.map((item) => item.status).sort()).toEqual([200, 409]);
  });

  it("disattiva senza cancellare e conserva la lettura storica", async () => {
    const row = await insertBeneficiary();
    const response = await request(socialAreaA()).patch(`/beneficiari/${row.id}/stato`).send({ attivo: false, versione: row.versione });
    expect(response.status).toBe(200);
    expect(response.body.attivo).toBe(false);
    const [stored] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, row.id));
    expect(stored).toBeDefined();
    expect(stored.attivo).toBe(false);
    expect((await request(socialAreaA()).get(`/beneficiari/${row.id}`)).status).toBe(200);
  });

  it("autorizza e audita export senza copiare dati sensibili", async () => {
    const denied = makeApp({ cittaId: areaA, centroAscoltoId: null, zonaUdsId: null, aree: ["sociale"], permessi: ["beneficiari.view"] });
    expect((await request(denied).post("/beneficiari/export/authorize").send({ tipo: "lista", numeroRecord: 1 })).status).toBe(403);
    const allowed = await request(socialAreaA()).post("/beneficiari/export/authorize").send({ tipo: "lista", numeroRecord: 2 });
    expect(allowed.status).toBe(200);
    const [audit] = await db.select().from(auditConfigurazioniTable).where(and(eq(auditConfigurazioniTable.id, allowed.body.auditId), eq(auditConfigurazioniTable.utenteId, auditUserId)));
    expect(audit.azione).toBe("export-autorizzato");
    expect(JSON.stringify(audit.valoreNuovo)).not.toMatch(/codiceFiscale|noteInterne/);
  });
});

describe("hardening Beneficiari: nucleo e bulk", () => {
  it("non crea membri orfani e distingue 404 da 403", async () => {
    expect((await request(socialAreaA()).post("/beneficiari/2147483647/nucleo").send({ relazione: "figlio" })).status).toBe(404);
    const foreign = await insertBeneficiary({ cittaId: areaB });
    expect((await request(socialAreaA()).post(`/beneficiari/${foreign.id}/nucleo`).send({ relazione: "figlio" })).status).toBe(403);
    const local = await insertBeneficiary();
    expect((await request(socialAreaA()).post(`/beneficiari/${local.id}/nucleo`).send({})).status).toBe(400);
    const created = await request(socialAreaA()).post(`/beneficiari/${local.id}/nucleo`).send({ nome: "Membro" });
    expect(created.status).toBe(201);
    const orphanRows = await db.select().from(nucleoFamiliareTable).where(eq(nucleoFamiliareTable.beneficiarioId, 2147483647));
    expect(orphanRows).toHaveLength(0);
  });

  it("impone limite e preserva partial success con la validazione del create", async () => {
    expect((await request(socialAreaA()).post("/beneficiari/bulk").send({ righe: Array.from({ length: 501 }, () => ({})) })).status).toBe(400);
    const codice = `BULK-${suffix}`;
    const response = await request(socialAreaA()).post("/beneficiari/bulk").send({ righe: [
      { codice, nome: "Bulk", cognome: "Valido", sesso: "M" },
      { nome: "Bulk", cognome: "Non valido", sesso: "X" },
    ] });
    expect(response.status).toBe(200);
    expect(response.body.creati).toBe(1);
    expect(response.body.errori).toHaveLength(1);
    expect(response.body.errori[0].riga).toBe(2);
    const [created] = await db.select({ id: beneficiariTable.id }).from(beneficiariTable).where(eq(beneficiariTable.codice, codice));
    beneficiaryIds.push(created.id);
  });
});
