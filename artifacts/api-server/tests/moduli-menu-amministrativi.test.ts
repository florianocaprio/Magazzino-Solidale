/* @vitest-environment node */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import approvazioniLogisticaRouter from "../src/routes/approvazioni-logistica";
import centriAscoltoRouter from "../src/routes/centri-ascolto";
import impostazioniStampaRouter from "../src/routes/impostazioni-stampa";
import ruoliVolontariRouter from "../src/routes/ruoli-volontari";
import tipologieFornitoreRouter from "../src/routes/tipologie-fornitore";
import {
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import { makeScopedApp } from "./scope-helpers";

const MODULI_TEST = [
  "VOLONTARI",
  "MEZZI",
  "FORNITORI",
  "MAGAZZINO_SOLIDALE",
  "BOLLE",
  "CENTRO_ASCOLTO",
  "EMPORIO_SOLIDALE",
  "MENSA",
  "CREDITO_SOLIDALE",
] as const;

const statiOriginali = new Map<string, boolean>();

async function setModulo(codice: (typeof MODULI_TEST)[number], attivo: boolean) {
  const result = await updateModuloAmbiente(codice, attivo, null);
  if ("error" in result) throw new Error(result.error);
}

async function abilitaModuliTest() {
  await Promise.all(MODULI_TEST.map((codice) => setModulo(codice, true)));
}

function app(router: Parameters<typeof makeScopedApp>[0]) {
  return makeScopedApp(router, {
    id: 0,
    centroAscoltoId: null,
    cittaId: null,
    aree: ["amministrazione", "logistica"],
  });
}

beforeAll(async () => {
  const moduli = await listModuliFunzionali();
  for (const codice of MODULI_TEST) {
    statiOriginali.set(
      codice,
      moduli.find((modulo) => modulo.codice === codice)?.attivo ?? true,
    );
  }
});

beforeEach(abilitaModuliTest);
afterEach(abilitaModuliTest);

afterAll(async () => {
  for (const codice of MODULI_TEST) {
    await setModulo(codice, statiOriginali.get(codice) ?? true);
  }
  await pool.end();
});

describe("moduli delle configurazioni amministrative", () => {
  it("blocca le API Ruoli Volontari quando VOLONTARI è disattivato", async () => {
    const scopedApp = app(ruoliVolontariRouter);
    await setModulo("VOLONTARI", false);
    expect((await request(scopedApp).get("/ruoli-volontari")).status).toBe(403);

    await setModulo("VOLONTARI", true);
    expect((await request(scopedApp).get("/ruoli-volontari")).status).toBe(200);
  });

  it("blocca le API Tipologie Fornitore quando FORNITORI è disattivato", async () => {
    const scopedApp = app(tipologieFornitoreRouter);
    await setModulo("FORNITORI", false);
    expect((await request(scopedApp).get("/tipologie-fornitore")).status).toBe(403);

    await setModulo("FORNITORI", true);
    expect((await request(scopedApp).get("/tipologie-fornitore")).status).toBe(200);
  });

  it("blocca Approvazioni se Volontari e Mezzi sono spenti", async () => {
    const scopedApp = app(approvazioniLogisticaRouter);
    await setModulo("VOLONTARI", false);
    await setModulo("MEZZI", false);

    expect((await request(scopedApp).get("/approvazioni-logistica")).status).toBe(
      403,
    );
  });

  it("con solo VOLONTARI attivo restituisce esclusivamente la relativa sezione", async () => {
    const scopedApp = app(approvazioniLogisticaRouter);
    await setModulo("MEZZI", false);

    const response = await request(scopedApp).get("/approvazioni-logistica");
    expect(response.status).toBe(200);
    expect(response.body.mezzi).toEqual([]);
    expect(Array.isArray(response.body.volontari)).toBe(true);
    expect(
      (
        await request(scopedApp).post(
          "/approvazioni-logistica/mezzi/999999999/approva",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(scopedApp).post(
          "/approvazioni-logistica/volontari/999999999/approva",
        )
      ).status,
    ).toBe(404);
  });

  it("con solo MEZZI attivo restituisce esclusivamente la relativa sezione", async () => {
    const scopedApp = app(approvazioniLogisticaRouter);
    await setModulo("VOLONTARI", false);

    const response = await request(scopedApp).get("/approvazioni-logistica");
    expect(response.status).toBe(200);
    expect(response.body.volontari).toEqual([]);
    expect(Array.isArray(response.body.mezzi)).toBe(true);
    expect(
      (
        await request(scopedApp).post(
          "/approvazioni-logistica/volontari/999999999/approva",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(scopedApp).post(
          "/approvazioni-logistica/mezzi/999999999/approva",
        )
      ).status,
    ).toBe(404);
  });

  it("mantiene Impostazioni Stampa disponibile perché include configurazioni condivise", async () => {
    const scopedApp = app(impostazioniStampaRouter);
    await setModulo("MAGAZZINO_SOLIDALE", false);
    await setModulo("BOLLE", false);

    expect((await request(scopedApp).get("/impostazioni-stampa")).status).toBe(
      200,
    );
  });

  it("mantiene le API Centri strutturali disponibili per i servizi dipendenti", async () => {
    const scopedApp = app(centriAscoltoRouter);
    await setModulo("CENTRO_ASCOLTO", false);
    await setModulo("EMPORIO_SOLIDALE", true);

    expect((await request(scopedApp).get("/centri-ascolto")).status).toBe(200);
  });
});
