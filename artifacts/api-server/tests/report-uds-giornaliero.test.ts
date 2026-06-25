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
  createCitta,
  createZona,
  createBeneficiario,
  createUtente,
  insertIntervento,
} from "./scope-helpers";

/**
 * Daily UDS report (/report/uds/interventi-giornalieri). numeroIntervento is the
 * per-person chronological rank over ALL their interventions, then filtered to the
 * requested day — so numero=1 (primoIntervento=true) means it's their first-ever.
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

describe("Report UDS — interventi-giornalieri", () => {
  it("richiede il parametro data (400 se assente o invalido)", async () => {
    expect((await request(appGlobal()).get("/report/uds/interventi-giornalieri")).status).toBe(400);
    expect(
      (await request(appGlobal()).get("/report/uds/interventi-giornalieri?data=non-valida")).status,
    ).toBe(400);
  });

  it("numera gli interventi per persona e segna il primo come primoIntervento", async () => {
    const citta = await createCitta(scope);
    const ben = await createBeneficiario(scope, null, { uds: true, cittaId: citta });
    await insertIntervento(scope, { beneficiarioId: ben, dataIntervento: "2026-06-01" });
    await insertIntervento(scope, { beneficiarioId: ben, dataIntervento: "2026-06-02" });

    const day1 = await request(appGlobal()).get("/report/uds/interventi-giornalieri?data=2026-06-01");
    expect(day1.status).toBe(200);
    const r1 = (day1.body as Array<{ beneficiarioId: number; numeroIntervento: number; primoIntervento: boolean }>)
      .find((r) => r.beneficiarioId === ben);
    expect(r1).toBeDefined();
    expect(r1!.numeroIntervento).toBe(1);
    expect(r1!.primoIntervento).toBe(true);

    const day2 = await request(appGlobal()).get("/report/uds/interventi-giornalieri?data=2026-06-02");
    expect(day2.status).toBe(200);
    const r2 = (day2.body as Array<{ beneficiarioId: number; numeroIntervento: number; primoIntervento: boolean }>)
      .find((r) => r.beneficiarioId === ben);
    expect(r2).toBeDefined();
    expect(r2!.numeroIntervento).toBe(2);
    expect(r2!.primoIntervento).toBe(false);
  });

  it("conta solo le persone UDS", async () => {
    const citta = await createCitta(scope);
    const plain = await createBeneficiario(scope, null, { uds: false, cittaId: citta });
    await insertIntervento(scope, { beneficiarioId: plain, dataIntervento: "2026-06-03" });

    const res = await request(appGlobal()).get("/report/uds/interventi-giornalieri?data=2026-06-03");
    expect(res.status).toBe(200);
    expect((res.body as Array<{ beneficiarioId: number }>).find((r) => r.beneficiarioId === plain)).toBeUndefined();
  });

  it("filtra per zonaUdsId", async () => {
    const citta = await createCitta(scope);
    const zonaA = await createZona(scope, citta);
    const zonaB = await createZona(scope, citta);
    const benA = await createBeneficiario(scope, null, { uds: true, cittaId: citta, zonaUdsId: zonaA.id });
    const benB = await createBeneficiario(scope, null, { uds: true, cittaId: citta, zonaUdsId: zonaB.id });
    await insertIntervento(scope, { beneficiarioId: benA, dataIntervento: "2026-06-04" });
    await insertIntervento(scope, { beneficiarioId: benB, dataIntervento: "2026-06-04" });

    const res = await request(appGlobal()).get(
      `/report/uds/interventi-giornalieri?data=2026-06-04&zonaUdsId=${zonaA.id}`,
    );
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ beneficiarioId: number }>).map((r) => r.beneficiarioId);
    expect(ids).toContain(benA);
    expect(ids).not.toContain(benB);
  });

  it("applica lo scope HARD per città", async () => {
    const cittaA = await createCitta(scope);
    const cittaB = await createCitta(scope);
    const benB = await createBeneficiario(scope, null, { uds: true, cittaId: cittaB });
    await insertIntervento(scope, { beneficiarioId: benB, dataIntervento: "2026-06-05" });

    const fromA = await request(appCitta(cittaA)).get("/report/uds/interventi-giornalieri?data=2026-06-05");
    expect(fromA.status).toBe(200);
    expect((fromA.body as Array<{ beneficiarioId: number }>).find((r) => r.beneficiarioId === benB)).toBeUndefined();

    const fromG = await request(appGlobal()).get("/report/uds/interventi-giornalieri?data=2026-06-05");
    expect((fromG.body as Array<{ beneficiarioId: number }>).find((r) => r.beneficiarioId === benB)).toBeDefined();
  });
});
