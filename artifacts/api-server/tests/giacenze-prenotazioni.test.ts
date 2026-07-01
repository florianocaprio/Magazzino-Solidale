import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import giacenzeRouter from "../src/routes/giacenze";
import {
  makeScopedApp,
  newScope,
  cleanup,
  type SeedScope,
  createBeneficiario,
  createCentro,
  createLotto,
  createMagazzino,
  createProdotto,
  createUtente,
  insertBolla,
  insertBollaRiga,
  insertPrenotazioneMagazzino,
} from "./scope-helpers";

type GiacenzaBody = {
  prodottoId: number;
  magazzinoId: number;
  quantitaTotale: number;
  giacenzaFisica: number;
  impegnato: number;
  disponibileReale: number;
};

let bootScope: SeedScope;
let scope: SeedScope;
let operatoreId: number;
let centroA: number;
let centroB: number;
let magA: number;
let magB: number;
let prod: number;
let beneficiarioA: number;
let beneficiarioB: number;

const appAs = (centro: number | null) =>
  makeScopedApp(giacenzeRouter, { id: operatoreId, centroAscoltoId: centro });

const rowFor = (rows: GiacenzaBody[], magazzinoId: number): GiacenzaBody => {
  const row = rows.find((item) => item.magazzinoId === magazzinoId);
  expect(row).toBeDefined();
  return row as GiacenzaBody;
};

async function prenota(
  opts: {
    beneficiarioId: number;
    magazzinoId: number;
    lottoId: number;
    quantita: number;
    stato?: string;
  },
): Promise<void> {
  const bollaId = await insertBolla(scope, {
    beneficiarioId: opts.beneficiarioId,
    magazzinoId: opts.magazzinoId,
    stato: "bozza",
  });
  const rigaBollaId = await insertBollaRiga(scope, {
    bollaId,
    prodottoId: prod,
    lottoId: opts.lottoId,
    quantita: opts.quantita,
  });
  await insertPrenotazioneMagazzino(scope, {
    bollaId,
    rigaBollaId,
    prodottoId: prod,
    lottoId: opts.lottoId,
    magazzinoId: opts.magazzinoId,
    quantita: opts.quantita,
    stato: opts.stato,
  });
}

beforeAll(async () => {
  bootScope = newScope();
  operatoreId = await createUtente(bootScope, {});
});

beforeEach(async () => {
  scope = newScope();
  centroA = await createCentro(scope);
  centroB = await createCentro(scope);
  magA = await createMagazzino(scope, centroA);
  magB = await createMagazzino(scope, centroB);
  prod = await createProdotto(scope);
  beneficiarioA = await createBeneficiario(scope, centroA);
  beneficiarioB = await createBeneficiario(scope, centroB);
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("GET /giacenze — prenotazioni magazzino", () => {
  it("espone giacenza fisica, impegnato zero e disponibile reale senza prenotazioni", async () => {
    await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 12.5 });

    const res = await request(appAs(centroA)).get("/giacenze");

    expect(res.status).toBe(200);
    expect(rowFor(res.body, magA)).toMatchObject({
      quantitaTotale: 12.5,
      giacenzaFisica: 12.5,
      impegnato: 0,
      disponibileReale: 12.5,
    });
  });

  it("sottrae solo le prenotazioni attive dal disponibile reale", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    await prenota({ beneficiarioId: beneficiarioA, magazzinoId: magA, lottoId, quantita: 4 });

    const res = await request(appAs(centroA)).get("/giacenze");

    expect(res.status).toBe(200);
    expect(rowFor(res.body, magA)).toMatchObject({
      quantitaTotale: 10,
      giacenzaFisica: 10,
      impegnato: 4,
      disponibileReale: 6,
    });
  });

  it("ignora prenotazioni rilasciate o convertite in scarico", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    await prenota({ beneficiarioId: beneficiarioA, magazzinoId: magA, lottoId, quantita: 2 });
    await prenota({ beneficiarioId: beneficiarioA, magazzinoId: magA, lottoId, quantita: 3, stato: "rilasciata" });
    await prenota({ beneficiarioId: beneficiarioA, magazzinoId: magA, lottoId, quantita: 4, stato: "convertita_in_scarico" });

    const res = await request(appAs(centroA)).get("/giacenze");

    expect(res.status).toBe(200);
    expect(rowFor(res.body, magA)).toMatchObject({
      giacenzaFisica: 10,
      impegnato: 2,
      disponibileReale: 8,
    });
  });

  it("mantiene il calcolo entro i magazzini visibili al centro", async () => {
    const lottoA = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const lottoB = await createLotto(scope, { prodottoId: prod, magazzinoId: magB, quantita: 20 });
    await prenota({ beneficiarioId: beneficiarioA, magazzinoId: magA, lottoId: lottoA, quantita: 3 });
    await prenota({ beneficiarioId: beneficiarioB, magazzinoId: magB, lottoId: lottoB, quantita: 9 });

    const res = await request(appAs(centroA)).get("/giacenze");

    expect(res.status).toBe(200);
    const rows = res.body as GiacenzaBody[];
    expect(rowFor(rows, magA)).toMatchObject({ giacenzaFisica: 10, impegnato: 3, disponibileReale: 7 });
    expect(rows.map((row) => row.magazzinoId)).not.toContain(magB);
  });

  it("per un caller globale calcola separatamente le disponibilita di tutti i magazzini", async () => {
    const lottoA = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const lottoB = await createLotto(scope, { prodottoId: prod, magazzinoId: magB, quantita: 20 });
    await prenota({ beneficiarioId: beneficiarioA, magazzinoId: magA, lottoId: lottoA, quantita: 3 });
    await prenota({ beneficiarioId: beneficiarioB, magazzinoId: magB, lottoId: lottoB, quantita: 9 });

    const res = await request(appAs(null)).get("/giacenze");

    expect(res.status).toBe(200);
    const rows = res.body as GiacenzaBody[];
    expect(rowFor(rows, magA)).toMatchObject({ giacenzaFisica: 10, impegnato: 3, disponibileReale: 7 });
    expect(rowFor(rows, magB)).toMatchObject({ giacenzaFisica: 20, impegnato: 9, disponibileReale: 11 });
  });
});
