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
  createCitta,
  createZona,
  createBeneficiario,
  createUtente,
  insertIntervento,
} from "./scope-helpers";

/**
 * UDS (Unità di Strada) reports. All four endpoints restrict to UDS persons
 * (beneficiari.uds = true) and aggregate via raw SQL. The shared real DB makes
 * absolute totals non-deterministic, so we assert DELTAS from a baseline taken
 * before seeding, against a global (null-città) caller that sees every città.
 */

let scope: SeedScope;
let bootScope: SeedScope;
let operatoreId: number;

const appGlobal = () => makeScopedApp(reportRouter, { id: operatoreId, centroAscoltoId: null });
const appCitta = (cittaId: number) =>
  makeScopedApp(reportRouter, { id: operatoreId, centroAscoltoId: null, cittaId });

beforeAll(async () => {
  bootScope = newScope();
  operatoreId = await createUtente(bootScope, {});
});

beforeEach(() => {
  scope = newScope();
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

const RANGE = "da=2026-01-01&a=2026-12-31";

describe("Report UDS — interventi-per-mese", () => {
  it("conta solo gli interventi di persone UDS, raggruppati per mese", async () => {
    const monthTotal = (body: Array<{ mese: string; totInterventi: number }>, mese: string) =>
      body.find((r) => r.mese === mese)?.totInterventi ?? 0;
    const q = `/report/uds/interventi-per-mese?${RANGE}`;

    const before = monthTotal((await request(appGlobal()).get(q)).body, "2026-06");

    const citta = await createCitta(scope);
    const udsBen = await createBeneficiario(scope, null, { uds: true, cittaId: citta });
    await insertIntervento(scope, { beneficiarioId: udsBen }); // data 2026-06-01
    // A non-UDS beneficiary intervention must NOT be counted.
    const plainBen = await createBeneficiario(scope, null, { uds: false, cittaId: citta });
    await insertIntervento(scope, { beneficiarioId: plainBen });

    const res = await request(appGlobal()).get(q);
    expect(res.status).toBe(200);
    expect(monthTotal(res.body, "2026-06")).toBe(before + 1);
  });
});

describe("Report UDS — città HARD scope", () => {
  it("un caller di città A non vede gli interventi UDS di città B", async () => {
    const monthTotal = (body: Array<{ mese: string; totInterventi: number }>, mese: string) =>
      body.find((r) => r.mese === mese)?.totInterventi ?? 0;
    const q = `/report/uds/interventi-per-mese?${RANGE}`;

    const cittaA = await createCitta(scope);
    const cittaB = await createCitta(scope);

    const beforeA = monthTotal((await request(appCitta(cittaA)).get(q)).body, "2026-06");
    const beforeG = monthTotal((await request(appGlobal()).get(q)).body, "2026-06");

    // A UDS intervention belonging to città B.
    const benB = await createBeneficiario(scope, null, { uds: true, cittaId: cittaB });
    await insertIntervento(scope, { beneficiarioId: benB });

    const afterA = monthTotal((await request(appCitta(cittaA)).get(q)).body, "2026-06");
    const afterG = monthTotal((await request(appGlobal()).get(q)).body, "2026-06");

    expect(afterA).toBe(beforeA); // città B is invisible to a città-A caller
    expect(afterG).toBe(beforeG + 1); // a global caller counts it
  });
});

describe("Report UDS — interventi-per-tipo", () => {
  it("raggruppa per tipo gli interventi delle persone UDS", async () => {
    const q = `/report/uds/interventi-per-tipo?${RANGE}`;
    const tipoTotal = (body: Array<{ tipo: string; totInterventi: number }>, tipo: string) =>
      body.find((r) => r.tipo === tipo)?.totInterventi ?? 0;

    // insertIntervento uses tipoIntervento "pacco_alimentare"
    const before = tipoTotal((await request(appGlobal()).get(q)).body, "pacco_alimentare");

    const citta = await createCitta(scope);
    const udsBen = await createBeneficiario(scope, null, { uds: true, cittaId: citta });
    await insertIntervento(scope, { beneficiarioId: udsBen });

    const res = await request(appGlobal()).get(q);
    expect(res.status).toBe(200);
    expect(tipoTotal(res.body, "pacco_alimentare")).toBe(before + 1);
  });
});

describe("Report UDS — interventi-per-zona", () => {
  it("raggruppa per zona e rispetta il filtro ?zonaUdsId", async () => {
    const q = `/report/uds/interventi-per-zona?${RANGE}`;
    const zonaTotal = (body: Array<{ zonaId: number | null; totInterventi: number }>, id: number) =>
      body.find((r) => r.zonaId === id)?.totInterventi ?? 0;

    const citta = await createCitta(scope);
    const zona = await createZona(scope, citta);
    const udsBen = await createBeneficiario(scope, null, {
      uds: true,
      cittaId: citta,
      zonaUdsId: zona.id,
    });
    await insertIntervento(scope, { beneficiarioId: udsBen });

    const res = await request(appGlobal()).get(q);
    expect(res.status).toBe(200);
    expect(zonaTotal(res.body, zona.id)).toBe(1);

    // Narrowing by a different zona must exclude it.
    const otherZona = await createZona(scope, citta);
    const filtered = await request(appGlobal()).get(`${q}&zonaUdsId=${otherZona.id}`);
    expect(zonaTotal(filtered.body, zona.id)).toBe(0);
  });
});

describe("Report UDS — persone-per-zona", () => {
  it("conta le persone UDS per zona e separa solo-UDS da UDS+centro", async () => {
    const q = "/report/uds/persone-per-zona";
    const row = (body: Array<{ zonaId: number | null }>, id: number) =>
      body.find((r) => r.zonaId === id);

    const citta = await createCitta(scope);
    const centro = await createCentro(scope);
    const zona = await createZona(scope, citta);
    // one solo-UDS (no centro) + one UDS-with-centro, same zona
    await createBeneficiario(scope, null, { uds: true, cittaId: citta, zonaUdsId: zona.id });
    await createBeneficiario(scope, centro, { uds: true, cittaId: citta, zonaUdsId: zona.id });

    const res = await request(appGlobal()).get(q);
    expect(res.status).toBe(200);
    const r = row(res.body, zona.id) as
      | { totale: number; soloUds: number; udsConCentro: number }
      | undefined;
    expect(r).toBeDefined();
    expect(r!.totale).toBe(2);
    expect(r!.soloUds).toBe(1);
    expect(r!.udsConCentro).toBe(1);
  });
});
