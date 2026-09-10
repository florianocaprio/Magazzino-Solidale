import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";
import {
  db,
  lottiTable,
  magazziniTable,
  pool,
  prodottiTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import giacenzeRouter from "../src/routes/giacenze";
import {
  cleanup,
  createAreaOperativa,
  createBeneficiario,
  createCentro,
  createLotto,
  createMagazzino,
  createProdotto,
  createUtente,
  insertBolla,
  insertBollaRiga,
  insertPrenotazioneMagazzino,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

type GiacenzaM1B = {
  ambito: "area" | "magazzino";
  areaOperativaId: number;
  areaOperativaNome: string;
  magazzinoId: number | null;
  magazzinoNome: string | null;
  giacenzaFisica: number;
  giacenzaFisicaPrecisa: string;
  giacenzaScaduta: number;
  giacenzaScadutaPrecisa: string;
  giacenzaDistribuibile: number;
  giacenzaDistribuibilePrecisa: string;
  impegnato: number;
  impegnatoPreciso: string;
  disponibileReale: number;
  disponibileRealePrecisa: string;
  scortaMinima: number | null;
  sottoscorta: boolean | null;
  lottiAttivi: number;
  prossimaScadenza: string | null;
};

let bootScope: SeedScope;
let scope: SeedScope;
let operatoreId: number;
let areaA: number;
let areaB: number;
let centroA: number;
let centroB: number;
let magA1: number;
let magA2: number;
let magB1: number;
let magLegacy: number;
let prodottoP: number;
let lottoA1: number;
let lottoA2: number;

const appAs = (opts: {
  centroAscoltoId?: number | null;
  areaOperativaId?: number | null;
}) =>
  makeScopedApp(giacenzeRouter, {
    id: operatoreId,
    centroAscoltoId: opts.centroAscoltoId ?? null,
    areaOperativaId: opts.areaOperativaId ?? null,
  });

const rows = (body: unknown) => body as GiacenzaM1B[];

beforeAll(async () => {
  bootScope = newScope();
  operatoreId = await createUtente(bootScope, {});
});

beforeEach(async () => {
  scope = newScope();
  areaA = await createAreaOperativa(scope);
  areaB = await createAreaOperativa(scope);
  centroA = await createCentro(scope);
  centroB = await createCentro(scope);
  magA1 = await createMagazzino(scope, centroA, {
    areaOperativaId: areaA,
  });
  magA2 = await createMagazzino(scope, centroB, {
    areaOperativaId: areaA,
  });
  magB1 = await createMagazzino(scope, null, {
    areaOperativaId: areaB,
  });
  magLegacy = await createMagazzino(scope, null);
  prodottoP = await createProdotto(scope);
  await db
    .update(prodottiTable)
    .set({ unitaMisura: "pz", scortaMinima: "15.000000" })
    .where(eq(prodottiTable.id, prodottoP));
  lottoA1 = await createLotto(scope, {
    prodottoId: prodottoP,
    magazzinoId: magA1,
    quantita: 10,
    dataScadenza: "2099-12-31",
  });
  lottoA2 = await createLotto(scope, {
    prodottoId: prodottoP,
    magazzinoId: magA2,
    quantita: 20,
    dataScadenza: "2099-01-01",
  });
  await createLotto(scope, {
    prodottoId: prodottoP,
    magazzinoId: magB1,
    quantita: 40,
  });
  await createLotto(scope, {
    prodottoId: prodottoP,
    magazzinoId: magLegacy,
    quantita: 90,
  });
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("GET /giacenze — M1B Area Operativa → Magazzino", () => {
  it("rifiuta Area assente/non valida e Magazzino non valido/inesistente", async () => {
    const app = appAs({});
    expect((await request(app).get("/giacenze")).status).toBe(400);
    expect(
      (await request(app).get("/giacenze?areaOperativaId=1x")).status,
    ).toBe(400);
    expect(
      (await request(app).get("/giacenze?areaOperativaId=2147483648")).status,
    ).toBe(400);
    expect(
      (await request(app).get("/giacenze?areaOperativaId=2147483647")).status,
    ).toBe(404);
    expect(
      (
        await request(app).get(
          `/giacenze?areaOperativaId=${areaA}&magazzinoId=non-numerico`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app).get(
          `/giacenze?areaOperativaId=${areaA}&magazzinoId=2147483647`,
        )
      ).status,
    ).toBe(404);
  });

  it("aggrega una sola Area, espone il DTO esplicito ed esclude Area B e legacy null", async () => {
    const app = appAs({});
    const areaAResponse = await request(app).get(
      `/giacenze?areaOperativaId=${areaA}`,
    );
    const areaBResponse = await request(app).get(
      `/giacenze?areaOperativaId=${areaB}`,
    );

    expect(areaAResponse.status).toBe(200);
    expect(rows(areaAResponse.body)).toHaveLength(1);
    expect(rows(areaAResponse.body)[0]).toMatchObject({
      ambito: "area",
      areaOperativaId: areaA,
      areaOperativaNome: expect.any(String),
      magazzinoId: null,
      magazzinoNome: null,
      giacenzaFisica: 30,
      scortaMinima: null,
      sottoscorta: null,
      lottiAttivi: 2,
      prossimaScadenza: "2099-01-01",
    });
    expect(rows(areaBResponse.body)[0]).toMatchObject({
      ambito: "area",
      areaOperativaId: areaB,
      magazzinoId: null,
      giacenzaFisica: 40,
    });
    expect(rows(areaAResponse.body)[0].giacenzaFisica).not.toBe(70);
    expect(rows(areaAResponse.body)[0].giacenzaFisica).not.toBe(160);
    const [legacyAfter] = await db
      .select({ areaOperativaId: magazziniTable.areaOperativaId })
      .from(magazziniTable)
      .where(eq(magazziniTable.id, magLegacy));
    expect(legacyAfter.areaOperativaId).toBeNull();
  });

  it("restituisce un array vuoto per un'Area valida senza Magazzini", async () => {
    const areaVuota = await createAreaOperativa(scope);

    const response = await request(appAs({})).get(
      `/giacenze?areaOperativaId=${areaVuota}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("restituisce il solo Magazzino selezionato dentro l'Area", async () => {
    const app = appAs({});
    const [a1, a2] = await Promise.all([
      request(app).get(
        `/giacenze?areaOperativaId=${areaA}&magazzinoId=${magA1}`,
      ),
      request(app).get(
        `/giacenze?areaOperativaId=${areaA}&magazzinoId=${magA2}`,
      ),
    ]);

    expect(rows(a1.body)[0]).toMatchObject({
      ambito: "magazzino",
      areaOperativaId: areaA,
      areaOperativaNome: expect.any(String),
      magazzinoId: magA1,
      magazzinoNome: expect.any(String),
      giacenzaFisica: 10,
    });
    expect(rows(a2.body)[0]).toMatchObject({
      ambito: "magazzino",
      areaOperativaId: areaA,
      magazzinoId: magA2,
      giacenzaFisica: 20,
    });
  });

  it("rifiuta con 400 un Magazzino appartenente a un'altra Area", async () => {
    const response = await request(appAs({})).get(
      `/giacenze?areaOperativaId=${areaA}&magazzinoId=${magB1}`,
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toContain(
      "non appartiene all'Area Operativa richiesta",
    );
  });

  it("non amplia lo scope Area o Centro del caller", async () => {
    const magazzinoCondiviso = await createMagazzino(scope, null, {
      areaOperativaId: areaA,
    });
    await createLotto(scope, {
      prodottoId: prodottoP,
      magazzinoId: magazzinoCondiviso,
      quantita: 5,
    });
    const areaForbidden = await request(appAs({ areaOperativaId: areaA })).get(
      `/giacenze?areaOperativaId=${areaB}`,
    );
    expect(areaForbidden.status).toBe(403);

    const centroScoped = await request(appAs({ centroAscoltoId: centroA })).get(
      `/giacenze?areaOperativaId=${areaA}`,
    );
    expect(centroScoped.status).toBe(200);
    expect(rows(centroScoped.body)[0]).toMatchObject({
      ambito: "area",
      giacenzaFisica: 15,
    });

    const warehouseForbidden = await request(
      appAs({ centroAscoltoId: centroA }),
    ).get(`/giacenze?areaOperativaId=${areaA}&magazzinoId=${magA2}`);
    expect(warehouseForbidden.status).toBe(403);

    const sharedWarehouse = await request(
      appAs({ centroAscoltoId: centroA }),
    ).get(
      `/giacenze?areaOperativaId=${areaA}&magazzinoId=${magazzinoCondiviso}`,
    );
    expect(rows(sharedWarehouse.body)[0]).toMatchObject({
      ambito: "magazzino",
      magazzinoId: magazzinoCondiviso,
      giacenzaFisica: 5,
    });
  });

  it("consente sottoscorta solo sul singolo Magazzino e conserva la semantica baseline", async () => {
    const app = appAs({});
    const aggregate = await request(app).get(
      `/giacenze?areaOperativaId=${areaA}&sottoscortaOnly=true`,
    );
    const warehouseLow = await request(app).get(
      `/giacenze?areaOperativaId=${areaA}&magazzinoId=${magA1}&sottoscortaOnly=true`,
    );
    const warehouseRegular = await request(app).get(
      `/giacenze?areaOperativaId=${areaA}&magazzinoId=${magA2}&sottoscortaOnly=true`,
    );

    expect(aggregate.status).toBe(400);
    expect(aggregate.body.error).toContain("solo selezionando un magazzino");
    expect(rows(warehouseLow.body)[0]).toMatchObject({
      magazzinoId: magA1,
      scortaMinima: 15,
      sottoscorta: true,
    });
    expect(rows(warehouseRegular.body)).toEqual([]);
  });

  it("somma quantità decimali con InventoryDecimal senza perdita di precisione", async () => {
    const prodottoKg = await createProdotto(scope);
    const lottoKgA1 = await createLotto(scope, {
      prodottoId: prodottoKg,
      magazzinoId: magA1,
      quantita: 0.1,
    });
    const lottoKgA2 = await createLotto(scope, {
      prodottoId: prodottoKg,
      magazzinoId: magA2,
      quantita: 0.2,
    });
    const beneficiarioA = await createBeneficiario(scope, centroA);
    const beneficiarioB = await createBeneficiario(scope, centroB);
    const bollaA = await insertBolla(scope, {
      beneficiarioId: beneficiarioA,
      magazzinoId: magA1,
    });
    const bollaB = await insertBolla(scope, {
      beneficiarioId: beneficiarioB,
      magazzinoId: magA2,
    });
    const rigaA = await insertBollaRiga(scope, {
      bollaId: bollaA,
      prodottoId: prodottoKg,
      lottoId: lottoKgA1,
      quantita: 0.03,
    });
    const rigaB = await insertBollaRiga(scope, {
      bollaId: bollaB,
      prodottoId: prodottoKg,
      lottoId: lottoKgA2,
      quantita: 0.04,
    });
    await insertPrenotazioneMagazzino(scope, {
      bollaId: bollaA,
      rigaBollaId: rigaA,
      prodottoId: prodottoKg,
      lottoId: lottoKgA1,
      magazzinoId: magA1,
      quantita: 0.03,
    });
    await insertPrenotazioneMagazzino(scope, {
      bollaId: bollaB,
      rigaBollaId: rigaB,
      prodottoId: prodottoKg,
      lottoId: lottoKgA2,
      magazzinoId: magA2,
      quantita: 0.04,
    });

    const response = await request(appAs({})).get(
      `/giacenze?areaOperativaId=${areaA}&prodottoId=${prodottoKg}`,
    );

    expect(response.status).toBe(200);
    expect(rows(response.body)[0]).toMatchObject({
      ambito: "area",
      giacenzaFisica: 0.3,
      giacenzaFisicaPrecisa: "0.300000",
      giacenzaScaduta: 0,
      giacenzaScadutaPrecisa: "0.000000",
      giacenzaDistribuibile: 0.3,
      giacenzaDistribuibilePrecisa: "0.300000",
      impegnato: 0.07,
      impegnatoPreciso: "0.070000",
      disponibileReale: 0.23,
      disponibileRealePrecisa: "0.230000",
    });
  });

  it("aggrega impegnato e disponibile dopo il calcolo del singolo Magazzino", async () => {
    const beneficiarioA = await createBeneficiario(scope, centroA);
    const beneficiarioB = await createBeneficiario(scope, centroB);
    const bollaA = await insertBolla(scope, {
      beneficiarioId: beneficiarioA,
      magazzinoId: magA1,
    });
    const bollaB = await insertBolla(scope, {
      beneficiarioId: beneficiarioB,
      magazzinoId: magA2,
    });
    const rigaA = await insertBollaRiga(scope, {
      bollaId: bollaA,
      prodottoId: prodottoP,
      lottoId: lottoA1,
      quantita: 3,
    });
    const rigaB = await insertBollaRiga(scope, {
      bollaId: bollaB,
      prodottoId: prodottoP,
      lottoId: lottoA2,
      quantita: 4,
    });
    await insertPrenotazioneMagazzino(scope, {
      bollaId: bollaA,
      rigaBollaId: rigaA,
      prodottoId: prodottoP,
      lottoId: lottoA1,
      magazzinoId: magA1,
      quantita: 3,
    });
    await insertPrenotazioneMagazzino(scope, {
      bollaId: bollaB,
      rigaBollaId: rigaB,
      prodottoId: prodottoP,
      lottoId: lottoA2,
      magazzinoId: magA2,
      quantita: 4,
    });

    const [response, a1, a2] = await Promise.all([
      request(appAs({})).get(`/giacenze?areaOperativaId=${areaA}`),
      request(appAs({})).get(
        `/giacenze?areaOperativaId=${areaA}&magazzinoId=${magA1}`,
      ),
      request(appAs({})).get(
        `/giacenze?areaOperativaId=${areaA}&magazzinoId=${magA2}`,
      ),
    ]);

    expect(rows(response.body)[0]).toMatchObject({
      giacenzaFisica: 30,
      impegnato: 7,
      impegnatoPreciso: "7.000000",
      disponibileReale: 23,
      disponibileRealePrecisa: "23.000000",
    });
    expect(rows(response.body)[0].impegnato).toBe(
      rows(a1.body)[0].impegnato + rows(a2.body)[0].impegnato,
    );
    expect(rows(response.body)[0].disponibileReale).toBe(
      rows(a1.body)[0].disponibileReale + rows(a2.body)[0].disponibileReale,
    );
  });

  it("ignora le scadenze trascorse per prossima scadenza e conta i lotti attivi senza deduplicarli", async () => {
    await db
      .update(lottiTable)
      .set({ codiceLotto: "LOTTO-FISICO-CONDIVISO" })
      .where(eq(lottiTable.id, lottoA1));
    await db
      .update(lottiTable)
      .set({ codiceLotto: "LOTTO-FISICO-CONDIVISO" })
      .where(eq(lottiTable.id, lottoA2));
    await createLotto(scope, {
      prodottoId: prodottoP,
      magazzinoId: magA1,
      quantita: 5,
      dataScadenza: "2020-01-01",
    });

    const response = await request(appAs({})).get(
      `/giacenze?areaOperativaId=${areaA}`,
    );

    expect(rows(response.body)[0]).toMatchObject({
      giacenzaFisica: 35,
      giacenzaScaduta: 5,
      giacenzaDistribuibile: 30,
      lottiAttivi: 2,
      prossimaScadenza: "2099-01-01",
    });
  });

  it("applica il filtro FSE+ prima dell'aggregazione Area", async () => {
    await createLotto(scope, {
      prodottoId: prodottoP,
      magazzinoId: magA1,
      quantita: 3,
      fsePlus: true,
    });
    await createLotto(scope, {
      prodottoId: prodottoP,
      magazzinoId: magA2,
      quantita: 4,
      fsePlus: true,
    });

    const [response, a1, a2] = await Promise.all([
      request(appAs({})).get(
        `/giacenze?areaOperativaId=${areaA}&fsePlusOnly=true`,
      ),
      request(appAs({})).get(
        `/giacenze?areaOperativaId=${areaA}&magazzinoId=${magA1}&fsePlusOnly=true`,
      ),
      request(appAs({})).get(
        `/giacenze?areaOperativaId=${areaA}&magazzinoId=${magA2}&fsePlusOnly=true`,
      ),
    ]);

    expect(rows(response.body)[0]).toMatchObject({
      ambito: "area",
      giacenzaFisica: 7,
      giacenzaFisicaPrecisa: "7.000000",
    });
    expect(rows(a1.body)[0].giacenzaFisica).toBe(3);
    expect(rows(a2.body)[0].giacenzaFisica).toBe(4);
    expect(rows(response.body)[0].giacenzaFisica).toBe(
      rows(a1.body)[0].giacenzaFisica + rows(a2.body)[0].giacenzaFisica,
    );
  });
});
