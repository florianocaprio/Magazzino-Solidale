import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { db, pool, beneficiariTable, areeOperativeTable, centriAscoltoTable, zoneUdsTable, magazziniTable, creditoSolidaleMovimentiTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import beneficiariRouter from "../src/routes/beneficiari";
import creditoSolidaleRouter from "../src/routes/credito-solidale";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
import { calcolaEta, risolviFasciaEta } from "@workspace/api-zod";

/**
 * UDS unification: an explicit `uds` boolean flag (independent of zonaUdsId)
 * lets one shared person record belong to UDS and/or a Centro. Covers the
 * GET ?uds filter and the area operativa-HARD-boundary guard on UDS creation.
 */

const rnd = () => Math.random().toString(36).slice(2, 8);

function makeApp(user: { id: number; centroAscoltoId: number | null; areaOperativaId: number | null; zonaUdsId?: number | null }): Express {
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    (req as unknown as { user: typeof user & { isAdmin: boolean; permessi: string[]; aree: string[] } }).user = {
      ...user,
      isAdmin: false,
      aree: ["sociale", "uds"],
      permessi: ["beneficiari.view", "beneficiari.manage", "beneficiari.sensitive.view", "beneficiari.deactivate", "credito.view", "credito.quota.manage"],
    };
    if (req.method === "PATCH" && /^\/beneficiari\/\d+$/.test(req.path) && req.body?.versione == null) {
      const id = Number(req.path.split("/").pop());
      const [row] = await db.select({ versione: beneficiariTable.versione }).from(beneficiariTable).where(eq(beneficiariTable.id, id));
      if (row) req.body.versione = row.versione;
    }
    next();
  });
  app.use(beneficiariRouter);
  app.use(creditoSolidaleRouter);
  return app;
}

const beneficiarioIds: number[] = [];
const areaOperativaIds: number[] = [];
const centroIds: number[] = [];
const zonaIds: number[] = [];
const magazzinoIds: number[] = [];

async function createAreaOperativa(nome = `AreaOperativa ${rnd()}`): Promise<number> {
  const [c] = await db.insert(areeOperativeTable).values({ nome }).returning({ id: areeOperativeTable.id });
  areaOperativaIds.push(c.id);
  return c.id;
}

async function createCentro(areaOperativaId: number, nome = `Centro ${rnd()}`): Promise<number> {
  const [c] = await db.insert(centriAscoltoTable).values({ nome, areaOperativaId }).returning({ id: centriAscoltoTable.id });
  centroIds.push(c.id);
  return c.id;
}

async function createZona(areaOperativaId: number, nome = `Zona ${rnd()}`): Promise<number> {
  const [z] = await db.insert(zoneUdsTable).values({ nome, areaOperativaId }).returning({ id: zoneUdsTable.id });
  zonaIds.push(z.id);
  return z.id;
}

async function createMagazzino(tipoMagazzino: "emporio" | "misto" | "logistico", areaOperativaId: number | null, nome = `Magazzino ${rnd()}`): Promise<{ id: number; nome: string }> {
  const [m] = await db
    .insert(magazziniTable)
    .values({ codice: `MAG-${rnd()}`, nome, tipoMagazzino, areaOperativaId })
    .returning({ id: magazziniTable.id, nome: magazziniTable.nome });
  magazzinoIds.push(m.id);
  return m;
}

let areaOperativaA: number;

const appAs = (areaOperativaId: number | null, zonaUdsId: number | null = null) =>
  makeApp({ id: 1, centroAscoltoId: null, areaOperativaId, zonaUdsId });
const appAsCentro = (centroAscoltoId: number, areaOperativaId: number | null, zonaUdsId: number | null = null) =>
  makeApp({ id: 1, centroAscoltoId, areaOperativaId, zonaUdsId });
const idsOf = (body: unknown) => (body as Array<{ id: number }>).map((r) => r.id);
const sessoObbligatorioMsg = "Il campo Sesso è obbligatorio.";
const creditoSolidaleCentroAscoltoRichiestoMsg =
  "ATTENZIONE: il beneficiario non ha un Centro di Ascolto assegnato. Non è possibile assegnare Credito Solidale.";

async function setEmporioEnabled(enabled: boolean): Promise<void> {
  await updateModuloAmbiente("EMPORIO_SOLIDALE", enabled, null);
}

async function setCentroAscoltoEnabled(enabled: boolean): Promise<void> {
  await updateModuloAmbiente("CENTRO_ASCOLTO", enabled, null);
}

beforeAll(async () => {
  areaOperativaA = await createAreaOperativa();
});

beforeEach(async () => {
  await setEmporioEnabled(true);
  await setCentroAscoltoEnabled(true);
  beneficiarioIds.length = 0;
  magazzinoIds.length = 0;
});

afterEach(async () => {
  if (beneficiarioIds.length > 0) {
    await db.delete(creditoSolidaleMovimentiTable).where(inArray(creditoSolidaleMovimentiTable.beneficiarioId, beneficiarioIds));
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, beneficiarioIds));
  }
  if (magazzinoIds.length > 0) {
    await db.delete(magazziniTable).where(inArray(magazziniTable.id, magazzinoIds));
  }
  await setEmporioEnabled(false);
  await setCentroAscoltoEnabled(true);
});

afterAll(async () => {
  if (centroIds.length > 0) {
    await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centroIds));
  }
  if (zonaIds.length > 0) {
    await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zonaIds));
  }
  if (areaOperativaIds.length > 0) {
    await db.delete(areeOperativeTable).where(inArray(areeOperativeTable.id, areaOperativaIds));
  }
  await setEmporioEnabled(true);
  await pool.end();
});

describe("POST /beneficiari (uds)", () => {
  it("crea una persona UDS con la area operativa e ritorna uds=true", async () => {
    const res = await request(appAs(null))
      .post("/beneficiari")
      .send({ nome: "Mario", cognome: "Rossi", sesso: "M", uds: true, areaOperativaId: areaOperativaA });
    expect(res.status).toBe(201);
    expect(res.body.uds).toBe(true);
    expect(res.body.areaOperativaId).toBe(areaOperativaA);
    beneficiarioIds.push(res.body.id);
  });

  it("continua a creare persone UDS quando il servizio Centro di Ascolto è disabilitato", async () => {
    await setCentroAscoltoEnabled(false);
    const res = await request(appAs(null))
      .post("/beneficiari")
      .send({
        nome: "Persona",
        cognome: "Solo UDS",
        sesso: "F",
        uds: true,
        areaOperativaId: areaOperativaA,
      });
    expect(res.status).toBe(201);
    expect(res.body.uds).toBe(true);
    beneficiarioIds.push(res.body.id);
  });

  it("rifiuta la creazione senza sesso", async () => {
    const res = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ nome: "Senza", cognome: "Sesso" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(sessoObbligatorioMsg);
  });

  it.each([
    ["Maschio", "M", "M"],
    ["Femmina", "F", "F"],
    ["Altro", "ALTRO", "ALTRO"],
  ])("crea un beneficiario con sesso valido: %s", async (_label, sesso, expected) => {
    const created = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ nome: "Con", cognome: "Sesso", sesso });
    expect(created.status).toBe(201);
    expect(created.body.sesso).toBe(expected);
    beneficiarioIds.push(created.body.id);
  });

  it("rifiuta la creazione con sesso non valido", async () => {
    const res = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ nome: "Sesso", cognome: "NonValido", sesso: "X" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(sessoObbligatorioMsg);
  });

  it("rifiuta una persona UDS senza area operativa per un caller globale (400)", async () => {
    const res = await request(appAs(null))
      .post("/beneficiari")
      .send({ nome: "Senza", cognome: "AreaOperativa", sesso: "M", uds: true });
    expect(res.status).toBe(400);
    if (res.body?.id) beneficiarioIds.push(res.body.id);
  });

  it('rifiuta uds passato come stringa "true" senza area operativa (no type-confusion bypass)', async () => {
    const res = await request(appAs(null))
      .post("/beneficiari")
      .send({ nome: "Coerce", cognome: "AreaOperativa", sesso: "M", uds: "true" });
    expect(res.status).toBe(400);
    if (res.body?.id) beneficiarioIds.push(res.body.id);
  });

  it("un caller con area operativa pinnata può creare una persona UDS senza inviare areaOperativaId", async () => {
    const res = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ nome: "Auto", cognome: "AreaOperativa", sesso: "M", uds: true });
    expect(res.status).toBe(201);
    expect(res.body.uds).toBe(true);
    expect(res.body.areaOperativaId).toBe(areaOperativaA);
    beneficiarioIds.push(res.body.id);
  });
});

describe("fascia d'età UDS", () => {
  const referenceDate = new Date("2025-06-15T10:00:00.000Z");
  const currentYear = new Date().getFullYear();
  const birthDateAge26 = `${currentYear - 26}-01-01`;
  const birthDateAge16 = `${currentYear - 16}-01-01`;

  it.each([
    ["il giorno prima del diciottesimo compleanno", "2007-06-16", 17, "0_17"],
    ["il giorno del diciottesimo compleanno", "2007-06-15", 18, "18_29"],
    ["il giorno dopo il diciottesimo compleanno", "2007-06-14", 18, "18_29"],
    ["il limite dei 29 anni", "1995-06-16", 29, "18_29"],
    ["il passaggio da 29 a 30 anni", "1995-06-15", 30, "30_64"],
    ["il limite dei 64 anni", "1960-06-16", 64, "30_64"],
    ["il passaggio da 64 a 65 anni", "1960-06-15", 65, "65_plus"],
  ])("calcola %s usando giorno, mese e anno", (_label, birthDate, age, fascia) => {
    expect(calcolaEta(birthDate, referenceDate)).toBe(age);
    expect(risolviFasciaEta(birthDate, "0_17", referenceDate)).toEqual({
      fascia,
      origine: "calcolata",
    });
  });

  it.each(["UTC", "America/New_York", "Asia/Tokyo"])(
    "usa sempre la data civile Europe/Rome anche con TZ del processo %s",
    (processTimeZone) => {
      const originalTimeZone = process.env.TZ;
      process.env.TZ = processTimeZone;
      try {
        const beforeMidnightInRome = new Date("2026-08-13T21:59:59.999Z");
        const midnightInRome = new Date("2026-08-13T22:00:00.000Z");

        expect(calcolaEta("2008-08-14", beforeMidnightInRome)).toBe(17);
        expect(calcolaEta("2008-08-14", midnightInRome)).toBe(18);
      } finally {
        if (originalTimeZone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimeZone;
      }
    },
  );

  it("cambia fascia esattamente al compleanno secondo la mezzanotte italiana", () => {
    expect(risolviFasciaEta("2008-08-14", null, new Date("2026-08-13T21:59:59.999Z"))).toEqual({
      fascia: "0_17",
      origine: "calcolata",
    });
    expect(risolviFasciaEta("2008-08-14", null, new Date("2026-08-13T22:00:00.000Z"))).toEqual({
      fascia: "18_29",
      origine: "calcolata",
    });
  });

  it("usa la fascia presunta solo in assenza della data di nascita", () => {
    expect(risolviFasciaEta(null, "30_64", referenceDate)).toEqual({
      fascia: "30_64",
      origine: "presunta",
    });
  });

  it("restituisce non determinata per un record legacy senza entrambi i valori", () => {
    expect(risolviFasciaEta(null, null, referenceDate)).toEqual({
      fascia: "non_determinata",
      origine: "non_determinata",
    });
  });

  it("persiste la fascia presunta ma restituisce quella calcolata quando è presente la data", async () => {
    const res = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({
        nome: "Fascia",
        cognome: rnd(),
        sesso: "F",
        uds: true,
        dataNascita: birthDateAge26,
        fasciaEtaPresunta: "65_plus",
      });

    expect(res.status).toBe(201);
    expect(res.body.fasciaEtaPresunta).toBe("65_plus");
    expect(res.body.fasciaEtaCorrente).toBe("18_29");
    expect(res.body.fasciaEtaOrigine).toBe("calcolata");
    beneficiarioIds.push(res.body.id);
  });

  it("dopo la rimozione della data torna alla fascia presunta conservata", async () => {
    const created = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({
        nome: "Ritorno",
        cognome: rnd(),
        sesso: "M",
        dataNascita: birthDateAge26,
        fasciaEtaPresunta: "30_64",
      });
    expect(created.status).toBe(201);
    beneficiarioIds.push(created.body.id);

    const patched = await request(appAs(areaOperativaA))
      .patch(`/beneficiari/${created.body.id}`)
      .send({ dataNascita: null });

    expect(patched.status).toBe(200);
    expect(patched.body.dataNascita).toBeNull();
    expect(patched.body.fasciaEtaPresunta).toBe("30_64");
    expect(patched.body.fasciaEtaCorrente).toBe("30_64");
    expect(patched.body.fasciaEtaOrigine).toBe("presunta");
  });

  it("ricalcola immediatamente la fascia quando cambia la data di nascita", async () => {
    const created = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ nome: "Cambio", cognome: rnd(), sesso: "F", dataNascita: birthDateAge16 });
    expect(created.status).toBe(201);
    expect(created.body.fasciaEtaCorrente).toBe("0_17");
    beneficiarioIds.push(created.body.id);

    const patched = await request(appAs(areaOperativaA))
      .patch(`/beneficiari/${created.body.id}`)
      .send({ dataNascita: birthDateAge26 });
    expect(patched.status).toBe(200);
    expect(patched.body.fasciaEtaCorrente).toBe("18_29");
    expect(patched.body.fasciaEtaOrigine).toBe("calcolata");
  });

  it.each([`${currentYear + 1}-01-01`, "2025-02-30", "15/06/2000"])(
    "rifiuta una data futura o non valida: %s",
    async (dataNascita) => {
      const res = await request(appAs(areaOperativaA))
        .post("/beneficiari")
        .send({ nome: "Data", cognome: rnd(), sesso: "M", dataNascita });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/data di nascita/i);
    },
  );

  it("rifiuta una fascia presunta fuori dall'insieme previsto", async () => {
    const res = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ nome: "Fascia", cognome: rnd(), sesso: "M", fasciaEtaPresunta: "18_64" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fascia d'età presunta/i);
  });

  it("espone come non determinato un beneficiario storico con valori null", async () => {
    const [legacy] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "Legacy", cognome: rnd(), sesso: "M", areaOperativaId: areaOperativaA })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(legacy.id);

    const res = await request(appAs(areaOperativaA)).get(`/beneficiari/${legacy.id}`);
    expect(res.status).toBe(200);
    expect(res.body.fasciaEtaPresunta).toBeNull();
    expect(res.body.fasciaEtaCorrente).toBe("non_determinata");
    expect(res.body.fasciaEtaOrigine).toBe("non_determinata");
  });
});

describe("Credito Solidale beneficiari", () => {
  it.each(["emporio", "misto"] as const)("accetta un magazzino %s come emporio preferito e abilita con stato attivo", async (tipoMagazzino) => {
    const centro = await createCentro(areaOperativaA);
    const emporio = await createMagazzino(tipoMagazzino, areaOperativaA, `Emporio ${tipoMagazzino} ${rnd()}`);

    const created = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({
        nome: "Credito",
        cognome: rnd(),
        sesso: "M",
        centroAscoltoId: centro,
        magazzinoEmporioPreferitoId: emporio.id,
      });
    expect(created.status).toBe(201);
    beneficiarioIds.push(created.body.id);
    const configured = await request(appAs(areaOperativaA))
      .patch(`/credito-solidale/beneficiari/${created.body.id}/configurazione`)
      .send({ creditoSolidaleAbilitato: true });
    expect(configured.status).toBe(200);
    expect(configured.body.creditoSolidaleAbilitato).toBe(true);
    expect(configured.body.creditoSolidaleStato).toBe("attivo");
    expect(created.body.magazzinoEmporioPreferitoId).toBe(emporio.id);
    expect(created.body.magazzinoEmporioPreferitoNome).toBe(emporio.nome);
  });

  it("rifiuta l'abilitazione Credito Solidale senza Centro di Ascolto", async () => {
    const created = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({
        nome: "Senza",
        cognome: "CentroCredito",
        sesso: "M",
      });
    expect(created.status).toBe(201);
    beneficiarioIds.push(created.body.id);
    const res = await request(appAs(areaOperativaA))
      .patch(`/credito-solidale/beneficiari/${created.body.id}/configurazione`)
      .send({ creditoSolidaleAbilitato: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Centro di Ascolto/i);
  });

  it("rifiuta un magazzino logistico come emporio preferito", async () => {
    const centro = await createCentro(areaOperativaA);
    const logistico = await createMagazzino("logistico", areaOperativaA);

    const res = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({
        nome: "No",
        cognome: "Logistico",
        sesso: "F",
        centroAscoltoId: centro,
        magazzinoEmporioPreferitoId: logistico.id,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Il magazzino selezionato non è un Emporio Solidale.");
  });

  it("alla prima abilitazione via PATCH valorizza la data e la conserva in disabilitazione", async () => {
    const centro = await createCentro(areaOperativaA);
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "PatchCredito", cognome: rnd(), sesso: "M", areaOperativaId: areaOperativaA, centroAscoltoId: centro })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);

    const enabled = await request(appAs(areaOperativaA))
      .patch(`/credito-solidale/beneficiari/${b.id}/configurazione`)
      .send({ creditoSolidaleAbilitato: true });

    expect(enabled.status).toBe(200);
    expect(enabled.body.creditoSolidaleAbilitato).toBe(true);
    expect(enabled.body.creditoSolidaleStato).toBe("attivo");

    const disabled = await request(appAs(areaOperativaA))
      .patch(`/credito-solidale/beneficiari/${b.id}/configurazione`)
      .send({ creditoSolidaleAbilitato: false });

    expect(disabled.status).toBe(200);
    expect(disabled.body.creditoSolidaleAbilitato).toBe(false);
    expect(disabled.body.creditoSolidaleStato).toBe("non_abilitato");
  });

  it("rifiuta l'abilitazione via PATCH se il beneficiario non ha Centro di Ascolto", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "PatchNoCentro", cognome: rnd(), sesso: "M", areaOperativaId: areaOperativaA })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);

    const res = await request(appAs(areaOperativaA))
      .patch(`/credito-solidale/beneficiari/${b.id}/configurazione`)
      .send({ creditoSolidaleAbilitato: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Centro di Ascolto/i);
  });

  it("abilita via PATCH quando assegna il Centro nello stesso payload senza creare movimenti o cambiare saldo", async () => {
    const centro = await createCentro(areaOperativaA);
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "PatchCentroCredito", cognome: rnd(), sesso: "M", areaOperativaId: areaOperativaA })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);

    const assigned = await request(appAs(areaOperativaA))
      .patch(`/beneficiari/${b.id}`)
      .send({ centroAscoltoId: centro });
    expect(assigned.status).toBe(200);
    const res = await request(appAs(areaOperativaA))
      .patch(`/credito-solidale/beneficiari/${b.id}/configurazione`)
      .send({ creditoSolidaleAbilitato: true });

    expect(res.status).toBe(200);
    expect(res.body.creditoSolidaleAbilitato).toBe(true);
    expect(res.body.creditoSolidaleStato).toBe("attivo");

    const [after] = await db
      .select({ saldo: beneficiariTable.creditoSolidaleSaldo })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, b.id));
    expect(Number(after.saldo)).toBe(0);

    const movimenti = await db
      .select({ id: creditoSolidaleMovimentiTable.id })
      .from(creditoSolidaleMovimentiTable)
      .where(eq(creditoSolidaleMovimentiTable.beneficiarioId, b.id));
    expect(movimenti).toHaveLength(0);
  });

  it("un utente UDS con Centro assegnato abilita Credito Solidale su beneficiario UDS condiviso", async () => {
    const centro = await createCentro(areaOperativaA);
    const zona = await createZona(areaOperativaA);
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "UdsCentroCredito", cognome: rnd(), sesso: "M", areaOperativaId: areaOperativaA, centroAscoltoId: centro, uds: true, zonaUdsId: zona })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);

    const res = await request(appAsCentro(centro, areaOperativaA, zona))
      .patch(`/credito-solidale/beneficiari/${b.id}/configurazione`)
      .send({ creditoSolidaleAbilitato: true });

    expect(res.status).toBe(200);
    expect(res.body.creditoSolidaleAbilitato).toBe(true);
    expect(res.body.creditoSolidaleStato).toBe("attivo");
  });
});

describe("PATCH /beneficiari/:id (uds boundary)", () => {
  it("collega a UDS un beneficiario Sociale della stessa area operativa senza duplicarlo, ignorando centro e zona del caller", async () => {
    const centroOperatore = await createCentro(areaOperativaA);
    const centroPersona = await createCentro(areaOperativaA);
    const zonaOperatore = await createZona(areaOperativaA);
    const codice = `BEN-${rnd()}`;
    const [sociale] = await db
      .insert(beneficiariTable)
      .values({
        codice,
        nome: "Sociale",
        cognome: "DaCollegare",
        sesso: "F",
        areaOperativaId: areaOperativaA,
        centroAscoltoId: centroPersona,
        uds: false,
      })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(sociale.id);

    const res = await request(appAsCentro(centroOperatore, areaOperativaA, zonaOperatore))
      .patch(`/beneficiari/${sociale.id}`)
      .send({ uds: true, zonaUdsId: zonaOperatore, fasciaEtaPresunta: "30_64" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(sociale.id);
    expect(res.body.uds).toBe(true);
    expect(res.body.centroAscoltoId).toBe(centroPersona);
    expect(res.body.zonaUdsId).toBe(zonaOperatore);
    expect(res.body.fasciaEtaCorrente).toBe("30_64");
    expect(res.body.fasciaEtaOrigine).toBe("presunta");

    const rows = await db
      .select({
        id: beneficiariTable.id,
        uds: beneficiariTable.uds,
        fasciaEtaPresunta: beneficiariTable.fasciaEtaPresunta,
      })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.codice, codice));
    expect(rows).toEqual([{ id: sociale.id, uds: true, fasciaEtaPresunta: "30_64" }]);
  });

  it("non trasforma il collegamento UDS in un bypass generico per una persona già UDS di un'altra zona", async () => {
    const zonaOperatore = await createZona(areaOperativaA);
    const altraZona = await createZona(areaOperativaA);
    const [uds] = await db
      .insert(beneficiariTable)
      .values({
        codice: `BEN-${rnd()}`,
        nome: "Gia",
        cognome: "Uds",
        sesso: "M",
        areaOperativaId: areaOperativaA,
        zonaUdsId: altraZona,
        uds: true,
      })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(uds.id);

    const res = await request(appAs(areaOperativaA, zonaOperatore))
      .patch(`/beneficiari/${uds.id}`)
      .send({ uds: true, zonaUdsId: zonaOperatore });

    expect(res.status).toBe(403);
    const [unchanged] = await db
      .select({ zonaUdsId: beneficiariTable.zonaUdsId })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, uds.id));
    expect(unchanged.zonaUdsId).toBe(altraZona);
  });

  it("un caller globale non può attivare uds su una persona senza area operativa (400)", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "NoAreaOperativa", cognome: rnd(), sesso: "M", areaOperativaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: true });
    expect(res.status).toBe(400);
  });

  it("un caller globale può attivare uds se la persona ha una area operativa", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "ConAreaOperativa", cognome: rnd(), sesso: "M", areaOperativaId: areaOperativaA })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: true });
    expect(res.status).toBe(200);
    expect(res.body.uds).toBe(true);
  });

  it('rifiuta uds="true" (stringa) su una persona senza area operativa per un caller globale', async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "CoercePatch", cognome: rnd(), sesso: "M", areaOperativaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: "true" });
    expect(res.status).toBe(400);
  });

  it("un caller con area operativa attiva uds su un record legacy senza area operativa auto-assegnando la propria area operativa", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "Legacy", cognome: rnd(), sesso: "M", areaOperativaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(areaOperativaA)).patch(`/beneficiari/${b.id}`).send({ uds: true });
    expect(res.status).toBe(200);
    expect(res.body.uds).toBe(true);
    expect(res.body.areaOperativaId).toBe(areaOperativaA);
  });

  it("un caller globale può attivare uds assegnando contestualmente la area operativa", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "AssegnaAreaOperativa", cognome: rnd(), sesso: "M", areaOperativaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: true, areaOperativaId: areaOperativaA });
    expect(res.status).toBe(200);
    expect(res.body.uds).toBe(true);
    expect(res.body.areaOperativaId).toBe(areaOperativaA);
  });

  it("permette di modificare e salvare il sesso Altro", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "PatchAltro", cognome: rnd(), sesso: "M", areaOperativaId: areaOperativaA })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(areaOperativaA)).patch(`/beneficiari/${b.id}`).send({ sesso: "ALTRO" });
    expect(res.status).toBe(200);
    expect(res.body.sesso).toBe("ALTRO");
  });

  it("permette una PATCH parziale del flag UDS su un legacy senza sesso", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "LegacySoloUds", cognome: rnd(), areaOperativaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: true, areaOperativaId: areaOperativaA });
    expect(res.status).toBe(200);
    expect(res.body.uds).toBe(true);
    expect(res.body.areaOperativaId).toBe(areaOperativaA);
  });

  it("rifiuta la modifica di un beneficiario legacy senza sesso", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "LegacySesso", cognome: rnd(), areaOperativaId: areaOperativaA })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(areaOperativaA)).patch(`/beneficiari/${b.id}`).send({ nome: "Cambio" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(sessoObbligatorioMsg);
  });
});

describe("GET /beneficiari?uds", () => {
  it("ritorna solo le persone con uds=true", async () => {
    const u = await request(appAs(areaOperativaA)).post("/beneficiari").send({ nome: "UdsOnly", cognome: rnd(), sesso: "M", uds: true });
    const n = await request(appAs(areaOperativaA)).post("/beneficiari").send({ nome: "NoUds", cognome: rnd(), sesso: "F", uds: false });
    beneficiarioIds.push(u.body.id, n.body.id);

    const res = await request(appAs(areaOperativaA)).get("/beneficiari").query({ uds: "true", areaOperativaId: String(areaOperativaA) });
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(u.body.id);
    expect(ids).not.toContain(n.body.id);
  });

  it("filtra per parte del nome rispettando lo scope area operativa", async () => {
    const areaOperativaB = await createAreaOperativa();
    const marioA = await request(appAs(areaOperativaA)).post("/beneficiari").send({ nome: "Mario", cognome: rnd(), sesso: "M", uds: true });
    const luigiA = await request(appAs(areaOperativaA)).post("/beneficiari").send({ nome: "Luigi", cognome: rnd(), sesso: "M", uds: true });
    const mariaB = await request(appAs(null)).post("/beneficiari").send({ nome: "Maria", cognome: rnd(), sesso: "F", uds: true, areaOperativaId: areaOperativaB });
    beneficiarioIds.push(marioA.body.id, luigiA.body.id, mariaB.body.id);

    const res = await request(appAs(areaOperativaA)).get("/beneficiari").query({ uds: "true", search: "mar" });
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(marioA.body.id);
    expect(ids).not.toContain(luigiA.body.id);
    expect(ids).not.toContain(mariaB.body.id);
  });

  it("filtra anche per codice tessera e codice fiscale", async () => {
    const codice = `BEN-${rnd().toUpperCase()}`;
    const cf = `RSSMRA80A01H501${rnd().slice(0, 1).toUpperCase()}`;
    const target = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ codice, codiceFiscale: cf, nome: "Codice", cognome: rnd(), sesso: "M", uds: true });
    const other = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ nome: "Altro", cognome: rnd(), sesso: "F", uds: true });
    beneficiarioIds.push(target.body.id, other.body.id);

    const byCodice = await request(appAs(areaOperativaA)).get("/beneficiari").query({ search: codice.toLowerCase() });
    expect(byCodice.status).toBe(200);
    expect(idsOf(byCodice.body)).toContain(target.body.id);
    expect(idsOf(byCodice.body)).not.toContain(other.body.id);

    const byCf = await request(appAs(areaOperativaA)).get("/beneficiari").query({ search: cf.toLowerCase() });
    expect(byCf.status).toBe(200);
    expect(idsOf(byCf.body)).toContain(target.body.id);
    expect(idsOf(byCf.body)).not.toContain(other.body.id);
  });

  it("un caller con zona vede solo beneficiari della propria zona", async () => {
    const zonaA = await createZona(areaOperativaA);
    const zonaB = await createZona(areaOperativaA);
    const a = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ nome: "ZonaA", cognome: rnd(), sesso: "M", uds: true, areaOperativaId: areaOperativaA, zonaUdsId: zonaA });
    const b = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ nome: "ZonaB", cognome: rnd(), sesso: "F", uds: true, areaOperativaId: areaOperativaA, zonaUdsId: zonaB });
    beneficiarioIds.push(a.body.id, b.body.id);

    const res = await request(appAs(areaOperativaA, zonaA)).get("/beneficiari").query({ uds: "true" });
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(a.body.id);
    expect(ids).not.toContain(b.body.id);
  });

  it("mostra le persone uds+centro ma MAI le persone solo-centro", async () => {
    const centro = await createCentro(areaOperativaA);
    // uds + centro → deve comparire
    const both = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ nome: "UdsCentro", cognome: rnd(), sesso: "M", uds: true, centroAscoltoId: centro });
    // solo centro (uds=false) → non deve MAI comparire nell'anagrafica UDS
    const centroOnly = await request(appAs(areaOperativaA))
      .post("/beneficiari")
      .send({ nome: "SoloCentro", cognome: rnd(), sesso: "F", uds: false, centroAscoltoId: centro });
    beneficiarioIds.push(both.body.id, centroOnly.body.id);
    expect(both.body.uds).toBe(true);
    expect(both.body.centroAscoltoId).toBe(centro);
    expect(centroOnly.body.uds).toBe(false);

    const res = await request(appAs(areaOperativaA)).get("/beneficiari").query({ uds: "true", areaOperativaId: String(areaOperativaA) });
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(both.body.id);
    expect(ids).not.toContain(centroOnly.body.id);
  });
});
