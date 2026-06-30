/* @vitest-environment node */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import { db, pool, volontariTable } from "@workspace/db";
import volontariRouter from "../src/routes/volontari";
import turniRouter from "../src/routes/turni";
import approvazioniLogisticaRouter from "../src/routes/approvazioni-logistica";
import {
  makeScopedApp,
  newScope,
  cleanup,
  type SeedScope,
  createCentro,
} from "./scope-helpers";
import { pianificaNormalizzazioneMatricoleVolontari } from "../../../scripts/src/normalizzaMatricoleVolontari";

const DUPLICATE_MSG = "La matricola indicata è già associata a un altro volontario.";

let scope: SeedScope;

const appVolontari = () => makeScopedApp(volontariRouter, { id: 0, centroAscoltoId: null, cittaId: null });
const appTurni = () => makeScopedApp(turniRouter, { id: 0, centroAscoltoId: null, cittaId: null });
const appApprovazioni = () => makeScopedApp(approvazioniLogisticaRouter, { id: 0, centroAscoltoId: null, cittaId: null });

beforeEach(() => {
  scope = newScope();
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await pool.end();
});

describe("Volontari — matricola unica", () => {
  it("rifiuta la creazione con matricola già esistente", async () => {
    const first = await request(appVolontari())
      .post("/volontari")
      .send({ nome: "Mario", cognome: "Rossi", matricola: "VOL-DUP-001", ruolo: "autista" });
    expect(first.status).toBe(201);
    scope.volontarioIds.push(first.body.id);

    const duplicate = await request(appVolontari())
      .post("/volontari")
      .send({ nome: "Luigi", cognome: "Bianchi", matricola: "VOL-DUP-001", ruolo: "autista" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toContain(DUPLICATE_MSG);
    expect(duplicate.body.matricolaSuggerita).toBe("VOL-DUP-001-01");
  });

  it("rifiuta la modifica con matricola già esistente su un altro volontario", async () => {
    const first = await request(appVolontari())
      .post("/volontari")
      .send({ nome: "Anna", cognome: "Verdi", matricola: "VOL-DUP-002", ruolo: "volontario" });
    const second = await request(appVolontari())
      .post("/volontari")
      .send({ nome: "Sara", cognome: "Neri", matricola: "VOL-DUP-003", ruolo: "volontario" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    scope.volontarioIds.push(first.body.id, second.body.id);

    const duplicate = await request(appVolontari())
      .patch(`/volontari/${second.body.id}`)
      .send({ matricola: "VOL-DUP-002" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toContain(DUPLICATE_MSG);
    expect(duplicate.body.matricolaSuggerita).toBe("VOL-DUP-002-01");
  });

  it("rifiuta l'approvazione di un pending con matricola normalizzata già esistente", async () => {
    const centro = await createCentro(scope);
    const existing = await request(appVolontari())
      .post("/volontari")
      .send({ nome: "Paolo", cognome: "Gialli", matricola: "VOL-DUP-004", ruolo: "autista", centroAscoltoId: centro });
    expect(existing.status).toBe(201);
    scope.volontarioIds.push(existing.body.id);

    const [pending] = await db
      .insert(volontariTable)
      .values({
        nome: "Pending",
        cognome: "Duplicato",
        matricola: "VOL-DUP-004 ",
        ruolo: "volontario",
        centroAscoltoId: centro,
        attivo: false,
        statoApprovazione: "in_attesa",
      })
      .returning({ id: volontariTable.id });
    scope.volontarioIds.push(pending.id);

    const duplicate = await request(appApprovazioni())
      .post(`/approvazioni-logistica/volontari/${pending.id}/approva`)
      .send();
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toContain(DUPLICATE_MSG);
    expect(duplicate.body.matricolaSuggerita).toBe("VOL-DUP-004-01");
  });

  it("rifiuta un volontario pending da pianificazione turni con matricola già esistente", async () => {
    const centro = await createCentro(scope);
    const existing = await request(appVolontari())
      .post("/volontari")
      .send({ nome: "Luca", cognome: "Blu", matricola: "VOL-DUP-005", ruolo: "autista", centroAscoltoId: centro });
    expect(existing.status).toBe(201);
    scope.volontarioIds.push(existing.body.id);

    const duplicate = await request(appTurni())
      .post("/turni/volontari-pending")
      .send({ centroAscoltoId: centro, nome: "Nuovo", cognome: "Pending", matricola: "VOL-DUP-005" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toContain(DUPLICATE_MSG);
    expect(duplicate.body.matricolaSuggerita).toBe("VOL-DUP-005-01");
  });
});

describe("Normalizzazione matricole volontari storiche", () => {
  it("mantiene la prima matricola e suffissa i duplicati con il primo progressivo libero", () => {
    const updates = pianificaNormalizzazioneMatricoleVolontari([
      { id: 1, matricola: "V001" },
      { id: 2, matricola: "V001-01" },
      { id: 3, matricola: "V001" },
      { id: 4, matricola: null },
      { id: 5, matricola: "" },
      { id: 6, matricola: "V001" },
    ]);

    expect(updates).toEqual([
      { id: 3, matricola: "V001-02" },
      { id: 6, matricola: "V001-03" },
    ]);
  });
});
