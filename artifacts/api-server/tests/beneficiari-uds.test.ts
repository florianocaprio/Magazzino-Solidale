import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { db, pool, beneficiariTable, cittaTable, centriAscoltoTable, zoneUdsTable, magazziniTable, impostazioniModuliTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import beneficiariRouter from "../src/routes/beneficiari";

/**
 * UDS unification: an explicit `uds` boolean flag (independent of zonaUdsId)
 * lets one shared person record belong to UDS and/or a Centro. Covers the
 * GET ?uds filter and the città-HARD-boundary guard on UDS creation.
 */

const rnd = () => Math.random().toString(36).slice(2, 8);

function makeApp(user: { id: number; centroAscoltoId: number | null; cittaId: number | null; zonaUdsId?: number | null }): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: typeof user }).user = user;
    next();
  });
  app.use(beneficiariRouter);
  return app;
}

const beneficiarioIds: number[] = [];
const cittaIds: number[] = [];
const centroIds: number[] = [];
const zonaIds: number[] = [];
const magazzinoIds: number[] = [];

async function createCitta(nome = `Citta ${rnd()}`): Promise<number> {
  const [c] = await db.insert(cittaTable).values({ nome }).returning({ id: cittaTable.id });
  cittaIds.push(c.id);
  return c.id;
}

async function createCentro(cittaId: number, nome = `Centro ${rnd()}`): Promise<number> {
  const [c] = await db.insert(centriAscoltoTable).values({ nome, cittaId }).returning({ id: centriAscoltoTable.id });
  centroIds.push(c.id);
  return c.id;
}

async function createZona(cittaId: number, nome = `Zona ${rnd()}`): Promise<number> {
  const [z] = await db.insert(zoneUdsTable).values({ nome, cittaId }).returning({ id: zoneUdsTable.id });
  zonaIds.push(z.id);
  return z.id;
}

async function createMagazzino(tipoMagazzino: "emporio" | "misto" | "logistico", cittaId: number | null, nome = `Magazzino ${rnd()}`): Promise<{ id: number; nome: string }> {
  const [m] = await db
    .insert(magazziniTable)
    .values({ codice: `MAG-${rnd()}`, nome, tipoMagazzino, cittaId })
    .returning({ id: magazziniTable.id, nome: magazziniTable.nome });
  magazzinoIds.push(m.id);
  return m;
}

let cittaA: number;

const appAs = (cittaId: number | null, zonaUdsId: number | null = null) =>
  makeApp({ id: 1, centroAscoltoId: null, cittaId, zonaUdsId });
const idsOf = (body: unknown) => (body as Array<{ id: number }>).map((r) => r.id);
const sessoObbligatorioMsg = "Il campo Sesso è obbligatorio.";

async function setEmporioEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(impostazioniModuliTable)
    .values({ id: 1, emporioAbilitato: enabled, unitaStradaAbilitata: true })
    .onConflictDoUpdate({
      target: impostazioniModuliTable.id,
      set: { emporioAbilitato: enabled, unitaStradaAbilitata: true },
    });
}

beforeAll(async () => {
  cittaA = await createCitta();
});

beforeEach(async () => {
  await setEmporioEnabled(true);
  beneficiarioIds.length = 0;
  magazzinoIds.length = 0;
});

afterEach(async () => {
  if (beneficiarioIds.length > 0) {
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, beneficiarioIds));
  }
  if (magazzinoIds.length > 0) {
    await db.delete(magazziniTable).where(inArray(magazziniTable.id, magazzinoIds));
  }
  await setEmporioEnabled(false);
});

afterAll(async () => {
  if (centroIds.length > 0) {
    await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centroIds));
  }
  if (zonaIds.length > 0) {
    await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zonaIds));
  }
  if (cittaIds.length > 0) {
    await db.delete(cittaTable).where(inArray(cittaTable.id, cittaIds));
  }
  await pool.end();
});

describe("POST /beneficiari (uds)", () => {
  it("crea una persona UDS con la città e ritorna uds=true", async () => {
    const res = await request(appAs(null))
      .post("/beneficiari")
      .send({ nome: "Mario", cognome: "Rossi", sesso: "M", uds: true, cittaId: cittaA });
    expect(res.status).toBe(201);
    expect(res.body.uds).toBe(true);
    expect(res.body.cittaId).toBe(cittaA);
    beneficiarioIds.push(res.body.id);
  });

  it("rifiuta la creazione senza sesso", async () => {
    const res = await request(appAs(cittaA))
      .post("/beneficiari")
      .send({ nome: "Senza", cognome: "Sesso" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(sessoObbligatorioMsg);
  });

  it.each([
    ["Maschio", "M", "M"],
    ["Femmina", "F", "F"],
    ["Altro", "Altro", "ALTRO"],
  ])("crea un beneficiario con sesso valido: %s", async (_label, sesso, expected) => {
    const res = await request(appAs(cittaA))
      .post("/beneficiari")
      .send({ nome: "Con", cognome: "Sesso", sesso });
    expect(res.status).toBe(201);
    expect(res.body.sesso).toBe(expected);
    beneficiarioIds.push(res.body.id);
  });

  it("rifiuta la creazione con sesso non valido", async () => {
    const res = await request(appAs(cittaA))
      .post("/beneficiari")
      .send({ nome: "Sesso", cognome: "NonValido", sesso: "X" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(sessoObbligatorioMsg);
  });

  it("rifiuta una persona UDS senza città per un caller globale (400)", async () => {
    const res = await request(appAs(null))
      .post("/beneficiari")
      .send({ nome: "Senza", cognome: "Citta", sesso: "M", uds: true });
    expect(res.status).toBe(400);
    if (res.body?.id) beneficiarioIds.push(res.body.id);
  });

  it('rifiuta uds passato come stringa "true" senza città (no type-confusion bypass)', async () => {
    const res = await request(appAs(null))
      .post("/beneficiari")
      .send({ nome: "Coerce", cognome: "Citta", sesso: "M", uds: "true" });
    expect(res.status).toBe(400);
    if (res.body?.id) beneficiarioIds.push(res.body.id);
  });

  it("un caller con città pinnata può creare una persona UDS senza inviare cittaId", async () => {
    const res = await request(appAs(cittaA))
      .post("/beneficiari")
      .send({ nome: "Auto", cognome: "Citta", sesso: "M", uds: true });
    expect(res.status).toBe(201);
    expect(res.body.uds).toBe(true);
    expect(res.body.cittaId).toBe(cittaA);
    beneficiarioIds.push(res.body.id);
  });
});

describe("Credito Solidale beneficiari", () => {
  it.each(["emporio", "misto"] as const)("accetta un magazzino %s come emporio preferito e abilita con stato attivo", async (tipoMagazzino) => {
    const emporio = await createMagazzino(tipoMagazzino, cittaA, `Emporio ${tipoMagazzino} ${rnd()}`);

    const res = await request(appAs(cittaA))
      .post("/beneficiari")
      .send({
        nome: "Credito",
        cognome: rnd(),
        sesso: "M",
        creditoSolidaleAbilitato: true,
        magazzinoEmporioPreferitoId: emporio.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.creditoSolidaleAbilitato).toBe(true);
    expect(res.body.creditoSolidaleStato).toBe("attivo");
    expect(typeof res.body.creditoSolidaleDataAbilitazione).toBe("string");
    expect(Date.parse(res.body.creditoSolidaleDataAbilitazione)).not.toBeNaN();
    expect(res.body.magazzinoEmporioPreferitoId).toBe(emporio.id);
    expect(res.body.magazzinoEmporioPreferitoNome).toBe(emporio.nome);
    beneficiarioIds.push(res.body.id);
  });

  it("rifiuta un magazzino logistico come emporio preferito", async () => {
    const logistico = await createMagazzino("logistico", cittaA);

    const res = await request(appAs(cittaA))
      .post("/beneficiari")
      .send({
        nome: "No",
        cognome: "Logistico",
        sesso: "F",
        creditoSolidaleAbilitato: true,
        magazzinoEmporioPreferitoId: logistico.id,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Il magazzino selezionato non è un Emporio Solidale.");
  });

  it("alla prima abilitazione via PATCH valorizza la data e la conserva in disabilitazione", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "PatchCredito", cognome: rnd(), sesso: "M", cittaId: cittaA })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);

    const enabled = await request(appAs(cittaA))
      .patch(`/beneficiari/${b.id}`)
      .send({ creditoSolidaleAbilitato: true });

    expect(enabled.status).toBe(200);
    expect(enabled.body.creditoSolidaleAbilitato).toBe(true);
    expect(enabled.body.creditoSolidaleStato).toBe("attivo");
    expect(typeof enabled.body.creditoSolidaleDataAbilitazione).toBe("string");
    expect(Date.parse(enabled.body.creditoSolidaleDataAbilitazione)).not.toBeNaN();

    const disabled = await request(appAs(cittaA))
      .patch(`/beneficiari/${b.id}`)
      .send({ creditoSolidaleAbilitato: false, creditoSolidaleDataAbilitazione: null });

    expect(disabled.status).toBe(200);
    expect(disabled.body.creditoSolidaleAbilitato).toBe(false);
    expect(disabled.body.creditoSolidaleStato).toBe("non_abilitato");
    expect(disabled.body.creditoSolidaleDataAbilitazione).toBe(enabled.body.creditoSolidaleDataAbilitazione);
  });
});

describe("PATCH /beneficiari/:id (uds boundary)", () => {
  it("un caller globale non può attivare uds su una persona senza città (400)", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "NoCitta", cognome: rnd(), sesso: "M", cittaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: true });
    expect(res.status).toBe(400);
  });

  it("un caller globale può attivare uds se la persona ha una città", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "ConCitta", cognome: rnd(), sesso: "M", cittaId: cittaA })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: true });
    expect(res.status).toBe(200);
    expect(res.body.uds).toBe(true);
  });

  it('rifiuta uds="true" (stringa) su una persona senza città per un caller globale', async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "CoercePatch", cognome: rnd(), sesso: "M", cittaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: "true" });
    expect(res.status).toBe(400);
  });

  it("un caller con città attiva uds su un record legacy senza città auto-assegnando la propria città", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "Legacy", cognome: rnd(), sesso: "M", cittaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(cittaA)).patch(`/beneficiari/${b.id}`).send({ uds: true });
    expect(res.status).toBe(200);
    expect(res.body.uds).toBe(true);
    expect(res.body.cittaId).toBe(cittaA);
  });

  it("un caller globale può attivare uds assegnando contestualmente la città", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "AssegnaCitta", cognome: rnd(), sesso: "M", cittaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: true, cittaId: cittaA });
    expect(res.status).toBe(200);
    expect(res.body.uds).toBe(true);
    expect(res.body.cittaId).toBe(cittaA);
  });

  it("permette di modificare e salvare il sesso Altro", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "PatchAltro", cognome: rnd(), sesso: "M", cittaId: cittaA })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(cittaA)).patch(`/beneficiari/${b.id}`).send({ sesso: "Altro" });
    expect(res.status).toBe(200);
    expect(res.body.sesso).toBe("ALTRO");
  });

  it("permette una PATCH parziale del flag UDS su un legacy senza sesso", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "LegacySoloUds", cognome: rnd(), cittaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: true, cittaId: cittaA });
    expect(res.status).toBe(200);
    expect(res.body.uds).toBe(true);
    expect(res.body.cittaId).toBe(cittaA);
  });

  it("rifiuta la modifica di un beneficiario legacy senza sesso", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "LegacySesso", cognome: rnd(), cittaId: cittaA })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(cittaA)).patch(`/beneficiari/${b.id}`).send({ nome: "Cambio" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(sessoObbligatorioMsg);
  });
});

describe("GET /beneficiari?uds", () => {
  it("ritorna solo le persone con uds=true", async () => {
    const u = await request(appAs(cittaA)).post("/beneficiari").send({ nome: "UdsOnly", cognome: rnd(), sesso: "M", uds: true });
    const n = await request(appAs(cittaA)).post("/beneficiari").send({ nome: "NoUds", cognome: rnd(), sesso: "F", uds: false });
    beneficiarioIds.push(u.body.id, n.body.id);

    const res = await request(appAs(cittaA)).get("/beneficiari").query({ uds: "true", cittaId: String(cittaA) });
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(u.body.id);
    expect(ids).not.toContain(n.body.id);
  });

  it("filtra per parte del nome rispettando lo scope città", async () => {
    const cittaB = await createCitta();
    const marioA = await request(appAs(cittaA)).post("/beneficiari").send({ nome: "Mario", cognome: rnd(), sesso: "M", uds: true });
    const luigiA = await request(appAs(cittaA)).post("/beneficiari").send({ nome: "Luigi", cognome: rnd(), sesso: "M", uds: true });
    const mariaB = await request(appAs(null)).post("/beneficiari").send({ nome: "Maria", cognome: rnd(), sesso: "F", uds: true, cittaId: cittaB });
    beneficiarioIds.push(marioA.body.id, luigiA.body.id, mariaB.body.id);

    const res = await request(appAs(cittaA)).get("/beneficiari").query({ uds: "true", search: "mar" });
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(marioA.body.id);
    expect(ids).not.toContain(luigiA.body.id);
    expect(ids).not.toContain(mariaB.body.id);
  });

  it("un caller con zona vede solo beneficiari della propria zona", async () => {
    const zonaA = await createZona(cittaA);
    const zonaB = await createZona(cittaA);
    const a = await request(appAs(cittaA))
      .post("/beneficiari")
      .send({ nome: "ZonaA", cognome: rnd(), sesso: "M", uds: true, cittaId: cittaA, zonaUdsId: zonaA });
    const b = await request(appAs(cittaA))
      .post("/beneficiari")
      .send({ nome: "ZonaB", cognome: rnd(), sesso: "F", uds: true, cittaId: cittaA, zonaUdsId: zonaB });
    beneficiarioIds.push(a.body.id, b.body.id);

    const res = await request(appAs(cittaA, zonaA)).get("/beneficiari").query({ uds: "true" });
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(a.body.id);
    expect(ids).not.toContain(b.body.id);
  });

  it("mostra le persone uds+centro ma MAI le persone solo-centro", async () => {
    const centro = await createCentro(cittaA);
    // uds + centro → deve comparire
    const both = await request(appAs(cittaA))
      .post("/beneficiari")
      .send({ nome: "UdsCentro", cognome: rnd(), sesso: "M", uds: true, centroAscoltoId: centro });
    // solo centro (uds=false) → non deve MAI comparire nell'anagrafica UDS
    const centroOnly = await request(appAs(cittaA))
      .post("/beneficiari")
      .send({ nome: "SoloCentro", cognome: rnd(), sesso: "F", uds: false, centroAscoltoId: centro });
    beneficiarioIds.push(both.body.id, centroOnly.body.id);
    expect(both.body.uds).toBe(true);
    expect(both.body.centroAscoltoId).toBe(centro);
    expect(centroOnly.body.uds).toBe(false);

    const res = await request(appAs(cittaA)).get("/beneficiari").query({ uds: "true", cittaId: String(cittaA) });
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(both.body.id);
    expect(ids).not.toContain(centroOnly.body.id);
  });
});
