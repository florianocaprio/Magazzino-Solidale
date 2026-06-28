/* @vitest-environment node */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import turniRouter from "../src/routes/turni";
import {
  makeScopedApp,
  newScope,
  cleanup,
  type SeedScope,
  createCentroRec,
  createCitta,
  createMezzo,
  createVolontario,
} from "./scope-helpers";

/**
 * Anti-doppia-prenotazione del mezzo in PUT /turni: lo stesso mezzo non può
 * essere assegnato a due turni nella stessa data + fascia, anche se di centri
 * diversi. Aggiornare lo stesso slot (stesso centro+data+fascia) con il proprio
 * mezzo NON è un conflitto.
 */

let scope: SeedScope;

const appGlobal = () => makeScopedApp(turniRouter, { id: 0, centroAscoltoId: null, cittaId: null });

const DATA = "2026-07-15";
const FASCIA = "09-13";

beforeEach(() => {
  scope = newScope();
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await pool.end();
});

describe("PUT /turni — anti-doppia-prenotazione mezzo", () => {
  it("rifiuta lo stesso mezzo in due centri nello stesso giorno+fascia (409)", async () => {
    const citta = await createCitta(scope);
    const centroA = await createCentroRec(scope, { cittaId: citta });
    const centroB = await createCentroRec(scope, { cittaId: citta });
    const mezzo = await createMezzo(scope, { centroId: null }); // universale
    const volA = await createVolontario(scope, null);
    const volB = await createVolontario(scope, null);

    const ok = await request(appGlobal())
      .put("/turni")
      .send({
        centroAscoltoId: centroA.id,
        data: DATA,
        fascia: FASCIA,
        mezzoId: mezzo,
        volontari: [{ volontarioId: volA }],
      });
    expect(ok.status).toBe(200);
    if (ok.body?.id) scope.turnoIds.push(ok.body.id);

    const conflict = await request(appGlobal())
      .put("/turni")
      .send({
        centroAscoltoId: centroB.id,
        data: DATA,
        fascia: FASCIA,
        mezzoId: mezzo,
        volontari: [{ volontarioId: volB }],
      });
    expect(conflict.status).toBe(409);
  });

  it("consente di ri-aggiornare lo stesso slot con lo stesso mezzo", async () => {
    const citta = await createCitta(scope);
    const centro = await createCentroRec(scope, { cittaId: citta });
    const mezzo = await createMezzo(scope, { centroId: null });
    const vol1 = await createVolontario(scope, null);
    const vol2 = await createVolontario(scope, null);

    const first = await request(appGlobal())
      .put("/turni")
      .send({
        centroAscoltoId: centro.id,
        data: DATA,
        fascia: FASCIA,
        mezzoId: mezzo,
        volontari: [{ volontarioId: vol1 }],
      });
    expect(first.status).toBe(200);
    if (first.body?.id) scope.turnoIds.push(first.body.id);

    const second = await request(appGlobal())
      .put("/turni")
      .send({
        centroAscoltoId: centro.id,
        data: DATA,
        fascia: FASCIA,
        mezzoId: mezzo,
        volontari: [{ volontarioId: vol1 }, { volontarioId: vol2 }],
      });
    expect(second.status).toBe(200);
    if (second.body?.id) scope.turnoIds.push(second.body.id);
    expect(second.body.volontari).toHaveLength(2);
  });
});
