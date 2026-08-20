/* @vitest-environment node */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import reportRouter from "../src/routes/report";
import {
  makeScopedApp,
  newScope,
  cleanup,
  type SeedScope,
  createCentro,
  createCentroRec,
  createMagazzino,
  createBeneficiario,
  createUtente,
  createAreaOperativa,
  createMezzo,
  insertConsegna,
  insertBolla,
  insertTurno,
} from "./scope-helpers";

/**
 * Scoping of GET /report/allocazione-mezzi (B8).
 *
 * The per-mezzo counts (consegne/bolle/turni) and the "altro" summary must each
 * respect the caller's perimeter. The dangerous case is a UNIVERSAL mezzo
 * (centro_ascolto_id NULL): it is visible to everyone, but the records it was
 * used on belong to specific centri/area operativa — those counts must NOT leak across
 * the HARD area operativa boundary.
 */

let scope: SeedScope;
let bootScope: SeedScope;
let operatoreId: number;
let magNull: number;

const appAs = (centro: number | null, areaOperativa: number | null) =>
  makeScopedApp(reportRouter, { id: operatoreId, centroAscoltoId: centro, areaOperativaId: areaOperativa });

type Riga = {
  mezzoId: number;
  consegne: number;
  bolle: number;
  turni: number;
  totale: number;
};
type Report = { mezzi: Riga[]; altro: { consegne: number; bolle: number } };

const Q = "/report/allocazione-mezzi?da=2026-01-01&a=2026-12-31";

beforeAll(async () => {
  bootScope = newScope();
  operatoreId = await createUtente(bootScope, {});
});

beforeEach(async () => {
  scope = newScope();
  magNull = await createMagazzino(scope, null);
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("Report allocazione mezzi — conteggi per mezzo", () => {
  it("un chiamante globale vede i conteggi consegne/bolle/turni di un mezzo", async () => {
    const areaOperativa = await createAreaOperativa(scope);
    const centro = await createCentroRec(scope, { areaOperativaId: areaOperativa });
    const mezzo = await createMezzo(scope, { centroId: centro.id });
    const ben = await createBeneficiario(scope, centro.id, { areaOperativaId: areaOperativa });

    await insertConsegna(scope, { beneficiarioId: ben, magazzinoId: magNull, mezzoId: mezzo });
    await insertConsegna(scope, { beneficiarioId: ben, magazzinoId: magNull, mezzoId: mezzo });
    await insertBolla(scope, { beneficiarioId: ben, magazzinoId: magNull, mezzoId: mezzo });
    await insertTurno(scope, { centroAscoltoId: centro.id, mezzoId: mezzo });

    const body = (await request(appAs(null, null)).get(Q)).body as Report;
    const riga = body.mezzi.find((m) => m.mezzoId === mezzo);
    expect(riga).toBeDefined();
    expect(riga!.consegne).toBe(2);
    expect(riga!.bolle).toBe(1);
    expect(riga!.turni).toBe(1);
    expect(riga!.totale).toBe(4);
  });

  it("un mezzo UNIVERSALE non fa trapelare conteggi cross-area operativa", async () => {
    const areaOperativaA = await createAreaOperativa(scope);
    const areaOperativaB = await createAreaOperativa(scope);
    const centroA = await createCentroRec(scope, { areaOperativaId: areaOperativaA });
    const centroB = await createCentroRec(scope, { areaOperativaId: areaOperativaB });
    const mezzo = await createMezzo(scope, { centroId: null }); // universale
    const benA = await createBeneficiario(scope, centroA.id, { areaOperativaId: areaOperativaA });
    const benB = await createBeneficiario(scope, centroB.id, { areaOperativaId: areaOperativaB });

    // Stesso mezzo universale usato in entrambe le area operativa.
    await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magNull, mezzoId: mezzo });
    await insertConsegna(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoId: mezzo });
    await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoId: mezzo });
    await insertTurno(scope, { centroAscoltoId: centroB.id, mezzoId: mezzo });

    // Chiamante scoped su area operativa A: il mezzo è visibile (universale) ma conta SOLO A.
    const body = (await request(appAs(null, areaOperativaA)).get(Q)).body as Report;
    const riga = body.mezzi.find((m) => m.mezzoId === mezzo);
    expect(riga).toBeDefined();
    expect(riga!.consegne).toBe(1); // solo la consegna di area operativa A
    expect(riga!.bolle).toBe(0); // la bolla è di area operativa B → non visibile
    expect(riga!.turni).toBe(0); // il turno è del centro di area operativa B → non visibile
    expect(riga!.totale).toBe(1);
  });

  it('il riepilogo "altro" (trasporto esterno) è scoped via beneficiario', async () => {
    const areaOperativaA = await createAreaOperativa(scope);
    const areaOperativaB = await createAreaOperativa(scope);
    const centroA = await createCentro(scope);
    const benA = await createBeneficiario(scope, centroA, { areaOperativaId: areaOperativaA });
    const benB = await createBeneficiario(scope, centroA, { areaOperativaId: areaOperativaB });

    await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magNull, mezzoAltro: true });
    await insertConsegna(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoAltro: true });
    await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoAltro: true });

    const body = (await request(appAs(null, areaOperativaA)).get(Q)).body as Report;
    // Solo la consegna "altro" di area operativa A è conteggiata; B (consegna + bolla) escluse.
    expect(body.altro.consegne).toBe(1);
    expect(body.altro.bolle).toBe(0);
  });

  it("un mezzo UNIVERSALE non fa trapelare conteggi cross-centro (stessa area operativa)", async () => {
    const areaOperativa = await createAreaOperativa(scope);
    const centroA = await createCentroRec(scope, { areaOperativaId: areaOperativa });
    const centroB = await createCentroRec(scope, { areaOperativaId: areaOperativa });
    const mezzo = await createMezzo(scope, { centroId: null }); // universale
    const benA = await createBeneficiario(scope, centroA.id, { areaOperativaId: areaOperativa });
    const benB = await createBeneficiario(scope, centroB.id, { areaOperativaId: areaOperativa });

    await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magNull, mezzoId: mezzo });
    await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoId: mezzo });
    await insertTurno(scope, { centroAscoltoId: centroB.id, mezzoId: mezzo });

    // Chiamante scoped sul centro A: vede solo i record del proprio centro.
    const body = (await request(appAs(centroA.id, null)).get(Q)).body as Report;
    const riga = body.mezzi.find((m) => m.mezzoId === mezzo);
    expect(riga).toBeDefined();
    expect(riga!.consegne).toBe(1); // consegna del centro A
    expect(riga!.bolle).toBe(0); // bolla del centro B → non visibile
    expect(riga!.turni).toBe(0); // turno del centro B → non visibile
    expect(riga!.totale).toBe(1);
  });

  it("admin globale: ?areaOperativaId restringe i conteggi per mezzo alla area operativa scelta", async () => {
    const areaOperativaA = await createAreaOperativa(scope);
    const areaOperativaB = await createAreaOperativa(scope);
    const centroA = await createCentroRec(scope, { areaOperativaId: areaOperativaA });
    const centroB = await createCentroRec(scope, { areaOperativaId: areaOperativaB });
    // Mezzo del centro A → la sua riga resta visibile sotto ?areaOperativaId=A; usato in A e B.
    const mezzo = await createMezzo(scope, { centroId: centroA.id });
    const benA = await createBeneficiario(scope, centroA.id, { areaOperativaId: areaOperativaA });
    const benB = await createBeneficiario(scope, centroB.id, { areaOperativaId: areaOperativaB });

    await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magNull, mezzoId: mezzo });
    await insertConsegna(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoId: mezzo });
    await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoId: mezzo });
    await insertTurno(scope, { centroAscoltoId: centroB.id, mezzoId: mezzo });

    // Admin globale che restringe a area operativa A: conta solo i record di A.
    const body = (await request(appAs(null, null)).get(`${Q}&areaOperativaId=${areaOperativaA}`)).body as Report;
    const riga = body.mezzi.find((m) => m.mezzoId === mezzo);
    expect(riga).toBeDefined();
    expect(riga!.consegne).toBe(1); // solo la consegna di area operativa A
    expect(riga!.bolle).toBe(0); // bolla di area operativa B → esclusa
    expect(riga!.turni).toBe(0); // turno del centro di area operativa B → escluso
    expect(riga!.totale).toBe(1);
  });
});
