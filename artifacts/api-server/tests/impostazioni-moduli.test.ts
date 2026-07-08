import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
  db,
  impostazioniModuliTable,
  magazziniTable,
  politicheCreditoSolidaleTable,
  pool,
  prodottiTable,
  zoneUdsTable,
} from "@workspace/db";
import beneficiariRouter from "../src/routes/beneficiari";
import impostazioniModuliRouter from "../src/routes/impostazioni-moduli";
import magazziniRouter from "../src/routes/magazzini";
import politicheCreditoSolidaleRouter from "../src/routes/politiche-credito-solidale";
import prodottiRouter from "../src/routes/prodotti";
import zoneUdsRouter from "../src/routes/zone-uds";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";

const EMPORIO_DISABLED_MSG = "Il modulo Emporio Solidale è disabilitato. Abilitalo da Impostazioni Moduli per utilizzare questa funzione.";
const UDS_DISABLED_MSG = "La gestione Unità di Strada è disabilitata.";

const rnd = () => Math.random().toString(36).slice(2, 8);

const beneficiarioIds: number[] = [];
const centroIds: number[] = [];
const cittaIds: number[] = [];
const magazzinoIds: number[] = [];
const politicaIds: number[] = [];
const prodottoIds: number[] = [];
const zonaIds: number[] = [];

function makeApp(isSuperAdmin = false): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      username: "admin",
      nome: "Admin",
      cognome: null,
      matricola: null,
      ruoloId: null,
      ruoloNome: null,
      centroAscoltoId: null,
      centroAscoltoNome: null,
      cittaId: null,
      cittaNome: null,
      zonaUdsId: null,
      zonaUdsNome: null,
      isSuperAdmin,
      isAdmin: true,
      aree: [],
      mustChangePassword: false,
    };
    next();
  });
  app.use(impostazioniModuliRouter);
  app.use(magazziniRouter);
  app.use(prodottiRouter);
  app.use(beneficiariRouter);
  app.use(zoneUdsRouter);
  app.use(politicheCreditoSolidaleRouter);
  return app;
}

async function setModuli(emporioAbilitato: boolean, unitaStradaAbilitata: boolean): Promise<void> {
  await updateModuloAmbiente("EMPORIO_SOLIDALE", emporioAbilitato, null);
  await updateModuloAmbiente("UDS", unitaStradaAbilitata, null);
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

beforeEach(async () => {
  await setModuli(false, true);
});

afterEach(async () => {
  if (zonaIds.length > 0) await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zonaIds.splice(0)));
  if (beneficiarioIds.length > 0) await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, beneficiarioIds.splice(0)));
  if (politicaIds.length > 0) await db.delete(politicheCreditoSolidaleTable).where(inArray(politicheCreditoSolidaleTable.id, politicaIds.splice(0)));
  if (prodottoIds.length > 0) await db.delete(prodottiTable).where(inArray(prodottiTable.id, prodottoIds.splice(0)));
  if (magazzinoIds.length > 0) await db.delete(magazziniTable).where(inArray(magazziniTable.id, magazzinoIds.splice(0)));
  if (centroIds.length > 0) await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centroIds.splice(0)));
  if (cittaIds.length > 0) await db.delete(cittaTable).where(inArray(cittaTable.id, cittaIds.splice(0)));
  await db.delete(impostazioniModuliTable).where(eq(impostazioniModuliTable.id, 1));
  await setModuli(false, true);
});

afterAll(async () => {
  await setModuli(true, true);
  await pool.end();
});

describe("Impostazioni moduli", () => {
  it("ignora la vecchia riga singleton e legge i flag da ambiente_moduli", async () => {
    await db
      .insert(impostazioniModuliTable)
      .values({ id: 1, emporioAbilitato: true, unitaStradaAbilitata: false })
      .onConflictDoUpdate({
        target: impostazioniModuliTable.id,
        set: { emporioAbilitato: true, unitaStradaAbilitata: false },
      });

    const res = await request(makeApp()).get("/impostazioni-moduli");

    expect(res.status).toBe(200);
    expect(res.body.emporioAbilitato).toBe(false);
    expect(res.body.unitaStradaAbilitata).toBe(true);
  });

  it("nega il PATCH legacy a un admin non Super Admin", async () => {
    const res = await request(makeApp())
      .patch("/impostazioni-moduli")
      .send({ emporioAbilitato: true, unitaStradaAbilitata: false });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Accesso riservato ai Super Admin");
  });

  it("blocca nuove configurazioni Emporio quando il modulo è disabilitato", async () => {
    const app = makeApp();
    const cittaId = await createCitta();
    const centroId = await createCentro(cittaId);

    const magazzino = await request(app)
      .post("/magazzini")
      .send({ nome: `Emporio ${rnd()}`, tipoMagazzino: "emporio" });
    expect(magazzino.status).toBe(403);
    expect(magazzino.body.error).toBe(EMPORIO_DISABLED_MSG);

    const prodotto = await request(app)
      .post("/prodotti")
      .send({ nome: `Prodotto ${rnd()}`, tipoProdotto: "alimentare", unitaMisura: "pz", abilitatoEmporio: true });
    expect(prodotto.status).toBe(403);
    expect(prodotto.body.error).toBe(EMPORIO_DISABLED_MSG);

    const beneficiarioCredito = await request(app)
      .post("/beneficiari")
      .send({ nome: "Credito", cognome: rnd(), sesso: "M", centroAscoltoId: centroId, creditoSolidaleAbilitato: true });
    expect(beneficiarioCredito.status).toBe(403);
    expect(beneficiarioCredito.body.error).toBe(EMPORIO_DISABLED_MSG);

    const beneficiarioQuota = await request(app)
      .post("/beneficiari")
      .send({ nome: "Quota", cognome: rnd(), sesso: "F", creditoSolidaleMensileAssegnato: 40 });
    expect(beneficiarioQuota.status).toBe(403);
    expect(beneficiarioQuota.body.error).toBe(EMPORIO_DISABLED_MSG);

    const politica = await request(app)
      .post("/politiche-credito-solidale")
      .send({ nome: `Politica ${rnd()}` });
    expect(politica.status).toBe(403);
    expect(politica.body.error).toBe(EMPORIO_DISABLED_MSG);
  });

  it("salva la quota mensile assegnata e marca la modifica manuale quando Emporio è abilitato", async () => {
    await setModuli(true, true);
    const cittaId = await createCitta();
    const centroId = await createCentro(cittaId);

    const res = await request(makeApp())
      .post("/beneficiari")
      .send({
        nome: "Quota",
        cognome: rnd(),
        sesso: "M",
        centroAscoltoId: centroId,
        creditoSolidaleAbilitato: true,
        creditoSolidaleMensileAssegnato: 70,
        creditoSolidaleMensileSuggerito: 60,
        creditoSolidaleMotivoModifica: "Esigenza temporanea",
      });

    expect(res.status).toBe(201);
    beneficiarioIds.push(res.body.id);
    expect(res.body.creditoSolidaleMensileAssegnato).toBe(70);
    expect(res.body.creditoSolidaleMensileManuale).toBe(true);
    expect(res.body.creditoSolidaleMotivoModifica).toBe("Esigenza temporanea");
    expect(typeof res.body.creditoSolidaleDataUltimaModificaQuota).toBe("string");
  });

  it("blocca nuove operazioni UDS quando Unità di Strada è disabilitata", async () => {
    await setModuli(false, false);
    const cittaId = await createCitta();
    const app = makeApp();

    const zona = await request(app)
      .post("/zone-uds")
      .send({ nome: `Zona ${rnd()}`, cittaId });
    expect(zona.status).toBe(403);
    expect(zona.body.error).toBe("Modulo UDS non abilitato per questo ambiente");

    const createUds = await request(app)
      .post("/beneficiari")
      .send({ nome: "Uds", cognome: rnd(), sesso: "M", uds: true, cittaId });
    expect(createUds.status).toBe(403);
    expect(createUds.body.error).toBe(UDS_DISABLED_MSG);

    const [beneficiario] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "Patch", cognome: rnd(), sesso: "F", cittaId })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(beneficiario.id);

    const patchUds = await request(app)
      .patch(`/beneficiari/${beneficiario.id}`)
      .send({ uds: true, cittaId });
    expect(patchUds.status).toBe(403);
    expect(patchUds.body.error).toBe(UDS_DISABLED_MSG);
  });
});
