import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  areeOperativeTable,
  auditConfigurazioniTable,
  beneficiariTable,
  centriAscoltoTable,
  db,
  fseFascicoliSocialiTable,
  fseImportBatchesTable,
  nucleoFamiliareTable,
  utentiTable,
  zoneUdsTable,
} from "@workspace/db";
import beneficiariFseRouter from "../src/routes/beneficiari-fse";
import {
  FSE_BENEFICIARI_HEADERS,
  parseFseBeneficiariWorkbook,
} from "../src/lib/fseBeneficiari";
import { makeScopedApp } from "./scope-helpers";

const suffix = Math.random().toString(36).slice(2, 9);
const sha = (character: string) => character.repeat(64);
const beneficiaryIds: number[] = [];
const centerIds: number[] = [];
const areaIds: number[] = [];
const zoneIds: number[] = [];
let userId: number;
let areaA: number;
let areaB: number;
let centerA: number;
let centerB: number;
let centerExport: number;
let zoneA: number;

const permissions = [
  "beneficiari.fse.view",
  "beneficiari.fse.manage",
  "beneficiari.fse.import",
  "beneficiari.fse.export",
];

function app(overrides: {
  areaOperativaId?: number | null;
  centroAscoltoId?: number | null;
  zonaUdsId?: number | null;
  permessi?: string[];
} = {}) {
  return makeScopedApp(beneficiariFseRouter, {
    id: userId,
    areaOperativaId: overrides.areaOperativaId === undefined ? areaA : overrides.areaOperativaId,
    centroAscoltoId: overrides.centroAscoltoId === undefined ? null : overrides.centroAscoltoId,
    zonaUdsId: overrides.zonaUdsId ?? null,
    aree: ["sociale"],
    permessi: overrides.permessi ?? permissions,
  });
}

function row(code: string, overrides: Record<string, unknown> = {}) {
  return {
    "Nome Referente fascicolo": `Referente-${suffix}-${code}`,
    "Cognome Referente fascicolo": `Fascicolo-${suffix}-${code}`,
    "Codice fascicolo": code,
    "Data di presa in carico": "24/08/2026",
    "Numero componenti fascicolo": 1,
    "Tipologia di Attività": "Pacchi",
    "Stato attuale": "Attivo",
    Donne: 1,
    Uomini: 0,
    "Età<18": 0,
    "Età 18-29": 0,
    "Età 30-64": 1,
    "Età>=65": 0,
    "Origine straniera e minoranze": 0,
    Disabili: 0,
    "Cittadini di Paesi Terzi": 0,
    "Senzatetto o colpiti da esclusione abitativa": 0,
    ...overrides,
  };
}

function payload(centroAscoltoId: number, righe: Array<Record<string, unknown>>, hash = sha("a")) {
  return {
    centroAscoltoId,
    areaOperativaId: areaB,
    nomeFile: `fixture-${suffix}.xlsx`,
    sha256File: hash,
    headers: [...FSE_BENEFICIARI_HEADERS],
    righe,
  };
}

async function insertBeneficiary(values: Partial<typeof beneficiariTable.$inferInsert>) {
  const [created] = await db.insert(beneficiariTable).values({
    codice: `BFSE-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
    nome: `Anagrafica-${suffix}`,
    cognome: `Test-${suffix}`,
    statoAnagrafica: "completa",
    dataNascita: "1990-01-01",
    dataPresaInCarico: "2026-08-24",
    sesso: "F",
    numComponenti: 1,
    areaOperativaId: areaA,
    centroAscoltoId: centerA,
    ...values,
  }).returning();
  beneficiaryIds.push(created.id);
  return created;
}

beforeAll(async () => {
  const [user] = await db.insert(utentiTable).values({
    username: `beneficiari-fse-${suffix}`,
    passwordHash: "test-only",
    nome: "Test FSE",
  }).returning({ id: utentiTable.id });
  userId = user.id;
  const [a] = await db.insert(areeOperativeTable).values({ nome: `Area FSE A ${suffix}` }).returning({ id: areeOperativeTable.id });
  const [b] = await db.insert(areeOperativeTable).values({ nome: `Area FSE B ${suffix}` }).returning({ id: areeOperativeTable.id });
  areaA = a.id;
  areaB = b.id;
  areaIds.push(areaA, areaB);
  const centers = await db.insert(centriAscoltoTable).values([
    { nome: `Centro FSE A ${suffix}`, areaOperativaId: areaA },
    { nome: `Centro FSE B ${suffix}`, areaOperativaId: areaB },
    { nome: `Centro FSE Export ${suffix}`, areaOperativaId: areaA },
  ]).returning({ id: centriAscoltoTable.id });
  [centerA, centerB, centerExport] = centers.map((center) => center.id);
  centerIds.push(centerA, centerB, centerExport);
  const [zone] = await db.insert(zoneUdsTable).values({ nome: `Zona FSE ${suffix}`, areaOperativaId: areaA }).returning({ id: zoneUdsTable.id });
  zoneA = zone.id;
  zoneIds.push(zoneA);
});

afterAll(async () => {
  const createdInCenters = await db.select({ id: beneficiariTable.id }).from(beneficiariTable)
    .where(inArray(beneficiariTable.centroAscoltoId, centerIds));
  const ids = [...new Set([...beneficiaryIds, ...createdInCenters.map((item) => item.id)])];
  if (ids.length) {
    await db.delete(nucleoFamiliareTable).where(inArray(nucleoFamiliareTable.beneficiarioId, ids));
    await db.delete(fseFascicoliSocialiTable).where(inArray(fseFascicoliSocialiTable.beneficiarioId, ids));
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, ids));
  }
  await db.delete(fseImportBatchesTable).where(inArray(fseImportBatchesTable.centroAscoltoId, centerIds));
  await db.delete(auditConfigurazioniTable).where(eq(auditConfigurazioniTable.utenteId, userId));
  await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zoneIds));
  await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centerIds));
  await db.delete(utentiTable).where(eq(utentiTable.id, userId));
  await db.delete(areeOperativeTable).where(inArray(areeOperativeTable.id, areaIds));
});

describe("Beneficiari 2.0 FSE+: API, scope e persistenza", () => {
  it("protegge le route letterali con permesso, Area, Centro e Zona UDS", async () => {
    expect((await request(app({ permessi: [] })).post("/beneficiari/fse/preview").send(payload(centerA, [row("SCOPE-1")]))).status).toBe(403);
    expect((await request(app({ areaOperativaId: areaB })).post("/beneficiari/fse/preview").send(payload(centerA, [row("SCOPE-2")]))).status).toBe(403);
    expect((await request(app({ centroAscoltoId: centerB, areaOperativaId: areaB })).post("/beneficiari/fse/preview").send(payload(centerA, [row("SCOPE-3")]))).status).toBe(403);
    expect((await request(app({ zonaUdsId: zoneA })).post("/beneficiari/fse/preview").send(payload(centerA, [row("SCOPE-4")]))).status).toBe(403);
    expect((await request(app()).post("/beneficiari/fse/preview").send({ centroAscoltoId: centerA, headers: [], righe: [] })).status).toBe(400);
  });

  it("deriva l'Area dal Centro e classifica senza restituire le righe grezze", async () => {
    const response = await request(app()).post("/beneficiari/fse/preview")
      .send(payload(centerA, [row("PREVIEW-1")], sha("b")));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      centroAscoltoId: centerA,
      areaOperativaId: areaA,
      areaOperativaDerivata: true,
      numeroRighe: 1,
    });
    expect(response.body.righe[0].classificazione).toBe("nuovo");
    expect(response.body).not.toHaveProperty("rawRows");
    expect(JSON.stringify(response.body)).not.toContain(`Referente-${suffix}`);
  });

  it("importa, assegna il territorio, non crea persone fittizie ed è idempotente", async () => {
    const importPayload = payload(centerA, [row("IMPORT-1")], sha("c"));
    const first = await request(app()).post("/beneficiari/fse/import").send(importPayload);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ stato: "confermato", creati: 1, errori: 0 });
    const [profile] = await db.select().from(fseFascicoliSocialiTable)
      .where(eq(fseFascicoliSocialiTable.codiceFascicoloNormalizzato, "import-1"));
    beneficiaryIds.push(profile.beneficiarioId);
    const [beneficiary] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, profile.beneficiarioId));
    expect(beneficiary).toMatchObject({ areaOperativaId: areaA, centroAscoltoId: centerA, sesso: "F", fasciaEtaPresunta: "30_64" });
    expect(await db.select().from(nucleoFamiliareTable).where(eq(nucleoFamiliareTable.beneficiarioId, beneficiary.id))).toHaveLength(0);

    const replay = await request(app()).post("/beneficiari/fse/import").send({ ...importPayload, sha256File: sha("d") });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ creati: 0, invariati: 1, errori: 0 });
  });

  it("mantiene il partial success e aggiorna una riga già collegata", async () => {
    const partial = await request(app()).post("/beneficiari/fse/import").send(payload(centerA, [
      row("PARTIAL-OK", {
        "Nome Referente fascicolo": "Ulisse",
        "Cognome Referente fascicolo": "Nebbia",
      }),
      row("PARTIAL-BAD", {
        "Nome Referente fascicolo": "Carla",
        "Cognome Referente fascicolo": "Muschio",
        "Numero componenti fascicolo": 2,
      }),
    ], sha("e")));
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({ stato: "parziale", creati: 1, errori: 1 });
    expect(partial.body.dettagli).toHaveLength(2);

    const update = await request(app()).post("/beneficiari/fse/import").send(payload(centerA, [
      row("IMPORT-1", { Disabili: 1 }),
    ], sha("f")));
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ aggiornati: 1, errori: 0 });
  });

  it("richiede una risoluzione esplicita per i possibili duplicati", async () => {
    const duplicateRow = row("LINK-1");
    const target = await insertBeneficiary({
      nome: String(duplicateRow["Nome Referente fascicolo"]),
      cognome: String(duplicateRow["Cognome Referente fascicolo"]),
      centroAscoltoId: centerA,
    });
    const preview = await request(app()).post("/beneficiari/fse/preview")
      .send(payload(centerA, [duplicateRow], sha("1")));
    expect(preview.body.righe[0]).toMatchObject({ classificazione: "possibile_duplicato" });
    expect(preview.body.righe[0].duplicati.map((item: { id: number }) => item.id)).toContain(target.id);

    const unresolved = await request(app()).post("/beneficiari/fse/import")
      .send(payload(centerA, [duplicateRow], sha("2")));
    expect(unresolved.body).toMatchObject({ stato: "parziale", errori: 1 });
    expect(unresolved.body.dettagli[0].errori).toContain("DUPLICATO_NON_RISOLTO");

    const linked = await request(app()).post("/beneficiari/fse/import").send({
      ...payload(centerA, [duplicateRow], sha("3")),
      risoluzioni: [{ numeroRiga: 2, azione: "collega", beneficiarioId: target.id }],
    });
    expect(linked.body).toMatchObject({ stato: "confermato", collegati: 1, errori: 0 });
  });

  it("espone e aggiorna la scheda FSE applicando scope e validazione", async () => {
    const [profile] = await db.select().from(fseFascicoliSocialiTable)
      .where(eq(fseFascicoliSocialiTable.codiceFascicoloNormalizzato, "import-1"));
    expect((await request(app({ permessi: [] })).get(`/beneficiari/${profile.beneficiarioId}/fse`)).status).toBe(403);
    const get = await request(app()).get(`/beneficiari/${profile.beneficiarioId}/fse`);
    expect(get.status).toBe(200);
    expect(get.body).toHaveProperty("demografia");
    expect(get.body).toHaveProperty("confronto");
    expect((await request(app()).patch(`/beneficiari/${profile.beneficiarioId}/fse`).send({ origineStranieraMinoranze: 2 })).status).toBe(400);
    const patch = await request(app()).patch(`/beneficiari/${profile.beneficiarioId}/fse`).send({
      codiceFascicolo: "IMPORT-1-EDIT",
      origineStranieraMinoranze: 1,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.codiceFascicoloNormalizzato).toBe("import-1-edit");
  });

  it("esegue preflight ed export XLSX canonico solo per beneficiari attivi", async () => {
    const exportable = await insertBeneficiary({
      codice: `EXPORT-${suffix}`,
      nome: `Export-${suffix}`,
      cognome: `Valido-${suffix}`,
      centroAscoltoId: centerExport,
      areaOperativaId: areaA,
    });
    const preflight = await request(app()).post("/beneficiari/fse/export/preflight").send({
      centroAscoltoId: centerExport,
      areaOperativaId: areaB,
      dataRiferimento: "2026-08-24",
      soloAttivi: true,
    });
    expect(preflight.status).toBe(200);
    expect(preflight.body).toMatchObject({ candidati: 1, esportabili: 1, areaOperativaId: areaA, soloAttivi: true });
    expect((await request(app()).post("/beneficiari/fse/export").send({ centroAscoltoId: centerExport, dataRiferimento: "2026-08-24", soloAttivi: false })).status).toBe(400);

    const exported = await request(app()).post("/beneficiari/fse/export").buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    }).send({ centroAscoltoId: centerExport, dataRiferimento: "2026-08-24", soloAttivi: true });
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml.sheet");
    const parsed = parseFseBeneficiariWorkbook(exported.body as Buffer);
    expect(parsed.header.errori).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].errori).toEqual([]);
    const [profile] = await db.select().from(fseFascicoliSocialiTable)
      .where(eq(fseFascicoliSocialiTable.beneficiarioId, exportable.id));
    expect(profile.ultimoExportAt).not.toBeNull();
  });

  it("registra audit tecnici senza nomi o cognomi", async () => {
    const audits = await db.select().from(auditConfigurazioniTable)
      .where(eq(auditConfigurazioniTable.utenteId, userId));
    expect(audits.some((audit) => audit.azione === "import-fse-confermato")).toBe(true);
    expect(audits.some((audit) => audit.azione === "export-fse")).toBe(true);
    const serialized = JSON.stringify(audits.map((audit) => audit.valoreNuovo));
    expect(serialized).not.toContain(`Referente-${suffix}`);
    expect(serialized).not.toContain(`Fascicolo-${suffix}-`);
  });
});
