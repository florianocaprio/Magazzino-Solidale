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
  createCitta,
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
 * used on belong to specific centri/città — those counts must NOT leak across
 * the HARD città boundary.
 */

let scope: SeedScope;
let bootScope: SeedScope;
let operatoreId: number;
let magNull: number;

const appAs = (centro: number | null, citta: number | null) =>
  makeScopedApp(reportRouter, { id: operatoreId, centroAscoltoId: centro, cittaId: citta });

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
    const citta = await createCitta(scope);
    const centro = await createCentroRec(scope, { cittaId: citta });
    const mezzo = await createMezzo(scope, { centroId: centro.id });
    const ben = await createBeneficiario(scope, centro.id, { cittaId: citta });

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

  it("un mezzo UNIVERSALE non fa trapelare conteggi cross-città", async () => {
    const cittaA = await createCitta(scope);
    const cittaB = await createCitta(scope);
    const centroA = await createCentroRec(scope, { cittaId: cittaA });
    const centroB = await createCentroRec(scope, { cittaId: cittaB });
    const mezzo = await createMezzo(scope, { centroId: null }); // universale
    const benA = await createBeneficiario(scope, centroA.id, { cittaId: cittaA });
    const benB = await createBeneficiario(scope, centroB.id, { cittaId: cittaB });

    // Stesso mezzo universale usato in entrambe le città.
    await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magNull, mezzoId: mezzo });
    await insertConsegna(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoId: mezzo });
    await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoId: mezzo });
    await insertTurno(scope, { centroAscoltoId: centroB.id, mezzoId: mezzo });

    // Chiamante scoped su città A: il mezzo è visibile (universale) ma conta SOLO A.
    const body = (await request(appAs(null, cittaA)).get(Q)).body as Report;
    const riga = body.mezzi.find((m) => m.mezzoId === mezzo);
    expect(riga).toBeDefined();
    expect(riga!.consegne).toBe(1); // solo la consegna di città A
    expect(riga!.bolle).toBe(0); // la bolla è di città B → non visibile
    expect(riga!.turni).toBe(0); // il turno è del centro di città B → non visibile
    expect(riga!.totale).toBe(1);
  });

  it('il riepilogo "altro" (trasporto esterno) è scoped via beneficiario', async () => {
    const cittaA = await createCitta(scope);
    const cittaB = await createCitta(scope);
    const centroA = await createCentro(scope);
    const benA = await createBeneficiario(scope, centroA, { cittaId: cittaA });
    const benB = await createBeneficiario(scope, centroA, { cittaId: cittaB });

    await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magNull, mezzoAltro: true });
    await insertConsegna(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoAltro: true });
    await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoAltro: true });

    const body = (await request(appAs(null, cittaA)).get(Q)).body as Report;
    // Solo la consegna "altro" di città A è conteggiata; B (consegna + bolla) escluse.
    expect(body.altro.consegne).toBe(1);
    expect(body.altro.bolle).toBe(0);
  });

  it("un mezzo UNIVERSALE non fa trapelare conteggi cross-centro (stessa città)", async () => {
    const citta = await createCitta(scope);
    const centroA = await createCentroRec(scope, { cittaId: citta });
    const centroB = await createCentroRec(scope, { cittaId: citta });
    const mezzo = await createMezzo(scope, { centroId: null }); // universale
    const benA = await createBeneficiario(scope, centroA.id, { cittaId: citta });
    const benB = await createBeneficiario(scope, centroB.id, { cittaId: citta });

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

  it("admin globale: ?cittaId restringe i conteggi per mezzo alla città scelta", async () => {
    const cittaA = await createCitta(scope);
    const cittaB = await createCitta(scope);
    const centroA = await createCentroRec(scope, { cittaId: cittaA });
    const centroB = await createCentroRec(scope, { cittaId: cittaB });
    // Mezzo del centro A → la sua riga resta visibile sotto ?cittaId=A; usato in A e B.
    const mezzo = await createMezzo(scope, { centroId: centroA.id });
    const benA = await createBeneficiario(scope, centroA.id, { cittaId: cittaA });
    const benB = await createBeneficiario(scope, centroB.id, { cittaId: cittaB });

    await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magNull, mezzoId: mezzo });
    await insertConsegna(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoId: mezzo });
    await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull, mezzoId: mezzo });
    await insertTurno(scope, { centroAscoltoId: centroB.id, mezzoId: mezzo });

    // Admin globale che restringe a città A: conta solo i record di A.
    const body = (await request(appAs(null, null)).get(`${Q}&cittaId=${cittaA}`)).body as Report;
    const riga = body.mezzi.find((m) => m.mezzoId === mezzo);
    expect(riga).toBeDefined();
    expect(riga!.consegne).toBe(1); // solo la consegna di città A
    expect(riga!.bolle).toBe(0); // bolla di città B → esclusa
    expect(riga!.turni).toBe(0); // turno del centro di città B → escluso
    expect(riga!.totale).toBe(1);
  });
});
