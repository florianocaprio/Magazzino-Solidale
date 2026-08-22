/* @vitest-environment node */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  turniConsegneTable,
  turniTable,
  turniVolontariTable,
} from "@workspace/db";
import consegneRouter from "../src/routes/consegne";
import turniRouter from "../src/routes/turni";
import { isPlanningConcurrencyError } from "../src/lib/logisticaPolicy";
import {
  cleanup,
  createBeneficiario,
  createCentroRec,
  createMagazzino,
  createMezzo,
  createVolontario,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

let scope: SeedScope;

beforeEach(() => {
  scope = newScope();
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await pool.end();
});

const app = (router: Parameters<typeof makeScopedApp>[0]) =>
  makeScopedApp(router, {
    id: 0,
    centroAscoltoId: null,
    areaOperativaId: null,
  });

async function fixture() {
  const centro = await createCentroRec(scope);
  const beneficiario = await createBeneficiario(scope, centro.id);
  const magazzino = await createMagazzino(scope, centro.id);
  const volontario = await createVolontario(scope, centro.id);
  const mezzo = await createMezzo(scope, { centroId: centro.id });
  return { centro, beneficiario, magazzino, volontario, mezzo };
}

async function concurrent<T>(operations: Array<PromiseLike<T>>): Promise<T[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all(operations.map((operation) => Promise.resolve(operation))),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Le operazioni concorrenti non si sono concluse")),
          5_000,
        );
      }),
    ]);
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }
}

async function trackTurni(centroAscoltoId: number) {
  const turni = await db.select({ id: turniTable.id }).from(turniTable)
    .where(eq(turniTable.centroAscoltoId, centroAscoltoId));
  for (const row of turni) {
    if (!scope.turnoIds.includes(row.id)) scope.turnoIds.push(row.id);
  }
}

describe("ordine globale lock pianificazione Logistica", () => {
  it("serializza PUT Turno e POST Consegna sullo stesso slot e Mezzo", async () => {
    const f = await fixture();
    const data = "2026-12-01";
    const [turno, consegna] = await concurrent([
      request(app(turniRouter)).put("/turni").send({
        centroAscoltoId: f.centro.id,
        data,
        fascia: "09-13",
        versione: 1,
        mezzoId: f.mezzo,
        volontari: [],
      }),
      request(app(consegneRouter)).post("/consegne").send({
        beneficiarioId: f.beneficiario,
        tipoConsegna: "domicilio",
        dataPrevista: data,
        fasciaOraria: "Mattina",
        magazzinoId: f.magazzino,
        mezzoId: f.mezzo,
      }),
    ]);
    expect([turno.status, consegna.status]).toEqual([200, 201]);
    scope.consegnaIds.push(consegna.body.id);
    await trackTurni(f.centro.id);
    const slots = await db.select().from(turniTable)
      .where(eq(turniTable.centroAscoltoId, f.centro.id));
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ data, fascia: "09-13", mezzoId: f.mezzo });
    expect(await db.select().from(turniConsegneTable)).toHaveLength(1);
  });

  it("serializza PUT Turno e POST Consegna sullo stesso slot e Volontario", async () => {
    const f = await fixture();
    const data = "2026-12-02";
    const [turno, consegna] = await concurrent([
      request(app(turniRouter)).put("/turni").send({
        centroAscoltoId: f.centro.id,
        data,
        fascia: "14-18",
        versione: 1,
        volontari: [{ volontarioId: f.volontario }],
      }),
      request(app(consegneRouter)).post("/consegne").send({
        beneficiarioId: f.beneficiario,
        tipoConsegna: "domicilio",
        dataPrevista: data,
        fasciaOraria: "Pomeriggio",
        magazzinoId: f.magazzino,
        volontarioId: f.volontario,
      }),
    ]);
    expect([turno.status, consegna.status]).toEqual([200, 201]);
    scope.consegnaIds.push(consegna.body.id);
    await trackTurni(f.centro.id);
    const [slot] = await db.select().from(turniTable)
      .where(eq(turniTable.centroAscoltoId, f.centro.id));
    expect(slot).toMatchObject({ data, fascia: "14-18" });
    expect(await db.select().from(turniVolontariTable)
      .where(eq(turniVolontariTable.turnoId, slot.id))).toHaveLength(1);
    expect(await db.select().from(turniConsegneTable)).toHaveLength(1);
  });

  it("serializza PUT Turno contro PATCH Consegna sul nuovo slot", async () => {
    const f = await fixture();
    const created = await request(app(consegneRouter)).post("/consegne").send({
      beneficiarioId: f.beneficiario,
      tipoConsegna: "domicilio",
      dataPrevista: "2026-12-03",
      fasciaOraria: "Mattina",
      magazzinoId: f.magazzino,
      volontarioId: f.volontario,
      mezzoId: f.mezzo,
    });
    expect(created.status).toBe(201);
    scope.consegnaIds.push(created.body.id);
    const target = await request(app(turniRouter)).put("/turni").send({
      centroAscoltoId: f.centro.id,
      data: "2026-12-04",
      fascia: "18-20",
      mezzoId: f.mezzo,
      volontari: [{ volontarioId: f.volontario }],
    });
    expect(target.status).toBe(200);
    scope.turnoIds.push(target.body.id);

    const [turno, moved] = await concurrent([
      request(app(turniRouter)).put("/turni").send({
        centroAscoltoId: f.centro.id,
        data: "2026-12-04",
        fascia: "18-20",
        versione: target.body.versione,
        mezzoId: f.mezzo,
        volontari: [{ volontarioId: f.volontario }],
      }),
      request(app(consegneRouter)).patch(`/consegne/${created.body.id}`).send({
        dataPrevista: "2026-12-04",
        fasciaOraria: "Sera",
      }),
    ]);
    expect(turno.status).toBe(200);
    expect(moved.status).toBe(200);
    await trackTurni(f.centro.id);
    const [source] = await db.select().from(turniConsegneTable)
      .where(eq(turniConsegneTable.consegnaId, created.body.id));
    expect(source.turnoId).toBe(target.body.id);
    const old = await db.select().from(turniTable)
      .where(eq(turniTable.data, "2026-12-03"));
    expect(old[0]).toMatchObject({ stato: "annullato", mezzoId: null });
    expect(await db.select().from(turniVolontariTable)
      .where(eq(turniVolontariTable.turnoId, old[0].id))).toHaveLength(0);
  });

  it("ordina deterministicamente due PATCH Consegna A→B e B→A", async () => {
    const f = await fixture();
    const payload = (dataPrevista: string) => ({
      beneficiarioId: f.beneficiario,
      tipoConsegna: "domicilio",
      dataPrevista,
      fasciaOraria: "Mattina",
      magazzinoId: f.magazzino,
      volontarioId: f.volontario,
      mezzoId: f.mezzo,
    });
    const first = await request(app(consegneRouter)).post("/consegne")
      .send(payload("2026-12-05"));
    const second = await request(app(consegneRouter)).post("/consegne")
      .send(payload("2026-12-06"));
    expect([first.status, second.status]).toEqual([201, 201]);
    scope.consegnaIds.push(first.body.id, second.body.id);

    const [aToB, bToA] = await concurrent([
      request(app(consegneRouter)).patch(`/consegne/${first.body.id}`)
        .send({ dataPrevista: "2026-12-06" }),
      request(app(consegneRouter)).patch(`/consegne/${second.body.id}`)
        .send({ dataPrevista: "2026-12-05" }),
    ]);
    expect([aToB.status, bToA.status]).toEqual([200, 200]);
    await trackTurni(f.centro.id);
    const sources = await db.select({
      consegnaId: turniConsegneTable.consegnaId,
      data: turniTable.data,
    }).from(turniConsegneTable)
      .innerJoin(turniTable, eq(turniConsegneTable.turnoId, turniTable.id));
    expect(sources).toEqual(expect.arrayContaining([
      { consegnaId: first.body.id, data: "2026-12-06" },
      { consegnaId: second.body.id, data: "2026-12-05" },
    ]));
    expect(sources).toHaveLength(2);
    const turni = await db.select().from(turniTable)
      .where(eq(turniTable.centroAscoltoId, f.centro.id));
    expect(turni).toHaveLength(2);
    for (const turno of turni) {
      expect(await db.select().from(turniVolontariTable)
        .where(eq(turniVolontariTable.turnoId, turno.id))).toHaveLength(1);
    }
  });

  it("riconosce gli errori DB concorrenti senza esporre dettagli tecnici", () => {
    expect(isPlanningConcurrencyError({ code: "40P01" })).toBe(true);
    expect(isPlanningConcurrencyError({ cause: { code: "40001" } })).toBe(true);
    expect(isPlanningConcurrencyError({ code: "23505" })).toBe(false);
  });
});
