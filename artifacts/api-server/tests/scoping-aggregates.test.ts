/* @vitest-environment node */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import dashboardRouter from "../src/routes/dashboard";
import reportRouter from "../src/routes/report";
import {
  makeScopedApp,
  newScope,
  cleanup,
  type SeedScope,
  createCentro,
  createMagazzino,
  createMagazzinoRec,
  createProdotto,
  createBeneficiario,
  createUtente,
  createLotto,
  insertConsegna,
  insertMovimento,
  insertBolla,
  insertBollaRiga,
} from "./scope-helpers";

/**
 * Centro scoping for the aggregate/read-only screens (Dashboard + Report).
 * These endpoints scope in raw SQL via the visible-magazzini set (movimenti,
 * giacenze, alerts) or a beneficiario centro subquery (consegne, fse-plus), so
 * a scoped caller must never see another centro's rows while a global
 * (null-centro) caller sees everything.
 *
 * Count-based endpoints (alerts, consegne-per-mese, fse-plus) run against the
 * shared real DB, so absolute totals are not deterministic. Instead we assert a
 * DELTA: seed a centro-B-only artifact and require the scoped-A total to be
 * UNCHANGED (B invisible) while the global total grows by exactly one.
 */

let scope: SeedScope;
let bootScope: SeedScope;
let operatoreId: number;
let centroA: number;
let centroB: number;
let magA: number;
let magNull: number;
let magB: number;
let prod: number;

const appAs = (router: Parameters<typeof makeScopedApp>[0], centro: number | null) =>
  makeScopedApp(router, { id: operatoreId, centroAscoltoId: centro });

beforeAll(async () => {
  bootScope = newScope();
  operatoreId = await createUtente(bootScope, {});
});

beforeEach(async () => {
  scope = newScope();
  centroA = await createCentro(scope);
  centroB = await createCentro(scope);
  magA = await createMagazzino(scope, centroA);
  magNull = await createMagazzino(scope, null);
  magB = await createMagazzino(scope, centroB);
  prod = await createProdotto(scope);
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("Dashboard — scoping via magazzini visibili", () => {
  it("movimenti-recenti: A vede i movimenti di magA + comune, non quelli di magB", async () => {
    const mA = await insertMovimento(scope, { magazzinoId: magA, prodottoId: prod });
    const mB = await insertMovimento(scope, { magazzinoId: magB, prodottoId: prod });
    const mNull = await insertMovimento(scope, { magazzinoId: magNull, prodottoId: prod });
    const res = await request(appAs(dashboardRouter, centroA)).get("/dashboard/movimenti-recenti");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toContain(mA);
    expect(ids).toContain(mNull);
    expect(ids).not.toContain(mB);
  });

  it("movimenti-recenti: un caller globale vede i movimenti di entrambi i centri", async () => {
    const mA = await insertMovimento(scope, { magazzinoId: magA, prodottoId: prod });
    const mB = await insertMovimento(scope, { magazzinoId: magB, prodottoId: prod });
    const res = await request(appAs(dashboardRouter, null)).get("/dashboard/movimenti-recenti");
    const ids = (res.body as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([mA, mB]));
  });

  it("stats: una consegna del centro B è invisibile ad A ma conta per un globale", async () => {
    // consegneMese counts consegne with dataPrevista >= current month start,
    // scoped via the beneficiario-centro path. Pin the fixture date to the same
    // runtime month so the delta assertion stays valid as calendar time moves.
    const inizioMese = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
    const consMese = (body: { consegneMese: number }) => body.consegneMese;
    const beforeA = consMese((await request(appAs(dashboardRouter, centroA)).get("/dashboard/stats")).body);
    const beforeG = consMese((await request(appAs(dashboardRouter, null)).get("/dashboard/stats")).body);

    await insertConsegna(scope, {
      beneficiarioId: await createBeneficiario(scope, centroB),
      magazzinoId: magNull,
      stato: "effettuata",
      dataPrevista: inizioMese,
    });

    const afterA = consMese((await request(appAs(dashboardRouter, centroA)).get("/dashboard/stats")).body);
    const afterG = consMese((await request(appAs(dashboardRouter, null)).get("/dashboard/stats")).body);

    expect(afterA).toBe(beforeA); // benB belongs to centro B, hidden from A
    expect(afterG).toBe(beforeG + 1); // global counts it
  });

  it("alerts: un lotto in scadenza nel magazzino del centro B è invisibile ad A ma conta per un globale", async () => {
    // Total lots expiring within 30 days, summed across both expiry-alert tiers
    // (lotti_scadenza = <=7gg, lotti_scadenza_30 = the 8..30gg remainder).
    const expiring30 = (body: Array<{ tipo: string; messaggio: string }>) =>
      body.reduce((acc, alert) => {
        if (alert.tipo === "lotti_scadenza" || alert.tipo === "lotti_scadenza_30") {
          const m = alert.messaggio.match(/(\d+)/);
          if (m) acc += parseInt(m[1], 10);
        }
        return acc;
      }, 0);

    const beforeA = expiring30((await request(appAs(dashboardRouter, centroA)).get("/dashboard/alerts")).body);
    const beforeG = expiring30((await request(appAs(dashboardRouter, null)).get("/dashboard/alerts")).body);

    // today is 2026-06-25 (see project context); +3 days keeps it within 7gg.
    await createLotto(scope, { prodottoId: prod, magazzinoId: magB, quantita: 5, dataScadenza: "2026-06-28" });

    const afterA = expiring30((await request(appAs(dashboardRouter, centroA)).get("/dashboard/alerts")).body);
    const afterG = expiring30((await request(appAs(dashboardRouter, null)).get("/dashboard/alerts")).body);

    expect(afterA).toBe(beforeA); // magB not in A's visible set
    expect(afterG).toBe(beforeG + 1); // global sees it
  });
});

describe("Report — scoping via beneficiario", () => {
  it("consegne-per-centro: A vede il proprio centro, non quello B", async () => {
    await insertConsegna(scope, { beneficiarioId: await createBeneficiario(scope, centroA), magazzinoId: magNull, stato: "effettuata" });
    await insertConsegna(scope, { beneficiarioId: await createBeneficiario(scope, centroB), magazzinoId: magNull, stato: "effettuata" });
    const res = await request(appAs(reportRouter, centroA)).get(
      "/report/consegne-per-centro?da=2026-01-01&a=2026-12-31",
    );
    expect(res.status).toBe(200);
    const centroIds = (res.body as Array<{ centroId: number | null }>).map((r) => r.centroId);
    expect(centroIds).toContain(centroA);
    expect(centroIds).not.toContain(centroB);
  });

  it("consegne-per-centro: un caller globale vede entrambi i centri", async () => {
    await insertConsegna(scope, { beneficiarioId: await createBeneficiario(scope, centroA), magazzinoId: magNull, stato: "effettuata" });
    await insertConsegna(scope, { beneficiarioId: await createBeneficiario(scope, centroB), magazzinoId: magNull, stato: "effettuata" });
    const res = await request(appAs(reportRouter, null)).get(
      "/report/consegne-per-centro?da=2026-01-01&a=2026-12-31",
    );
    const centroIds = (res.body as Array<{ centroId: number | null }>).map((r) => r.centroId);
    expect(centroIds).toEqual(expect.arrayContaining([centroA, centroB]));
  });

  it("consegne-per-mese: una consegna del centro B è invisibile ad A ma conta per un globale", async () => {
    const monthTotal = (body: Array<{ mese: string; totConsegne: number }>, mese: string) =>
      body.find((r) => r.mese === mese)?.totConsegne ?? 0;
    const q = "/report/consegne-per-mese?da=2026-01-01&a=2026-12-31";

    const beforeA = monthTotal((await request(appAs(reportRouter, centroA)).get(q)).body, "2026-06");
    const beforeG = monthTotal((await request(appAs(reportRouter, null)).get(q)).body, "2026-06");

    await insertConsegna(scope, {
      beneficiarioId: await createBeneficiario(scope, centroB),
      magazzinoId: magNull,
      stato: "effettuata",
    });

    const afterA = monthTotal((await request(appAs(reportRouter, centroA)).get(q)).body, "2026-06");
    const afterG = monthTotal((await request(appAs(reportRouter, null)).get(q)).body, "2026-06");

    expect(afterA).toBe(beforeA);
    expect(afterG).toBe(beforeG + 1);
  });

  it("giacenze-per-magazzino: A non vede il magazzino del centro B", async () => {
    const magBNamed = await createMagazzinoRec(scope, centroB);
    // Give it stock so it would surface in the report if scoping leaked.
    await createLotto(scope, { prodottoId: prod, magazzinoId: magBNamed.id, quantita: 10 });

    const scopedRes = await request(appAs(reportRouter, centroA)).get("/report/giacenze-per-magazzino");
    const globalRes = await request(appAs(reportRouter, null)).get("/report/giacenze-per-magazzino");
    expect(scopedRes.status).toBe(200);
    expect(globalRes.status).toBe(200);
    const scopedNames = (scopedRes.body as Array<{ magazzinoNome: string }>).map((r) => r.magazzinoNome);
    const globalNames = (globalRes.body as Array<{ magazzinoNome: string }>).map((r) => r.magazzinoNome);

    expect(scopedNames).not.toContain(magBNamed.nome); // B's warehouse hidden from A
    expect(globalNames).toContain(magBNamed.nome); // visible to a global caller
  });

  it("fse-plus: una consegna FSE+ del centro B è invisibile ad A ma conta per un globale", async () => {
    const q = "/report/fse-plus?anno=2026";
    const beforeA = (await request(appAs(reportRouter, centroA)).get(q)).body.beneficiariTotali as number;
    const beforeG = (await request(appAs(reportRouter, null)).get(q)).body.beneficiariTotali as number;

    // One delivered (confermato) FSE+ bolla for a centro-B beneficiary, year 2026.
    const benB = await createBeneficiario(scope, centroB);
    const lotB = await createLotto(scope, { prodottoId: prod, magazzinoId: magNull, quantita: 5, fsePlus: true });
    const bolB = await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull, stato: "confermato" });
    await insertBollaRiga(scope, { bollaId: bolB, prodottoId: prod, lottoId: lotB, quantita: 5 });

    const afterA = (await request(appAs(reportRouter, centroA)).get(q)).body.beneficiariTotali as number;
    const afterG = (await request(appAs(reportRouter, null)).get(q)).body.beneficiariTotali as number;

    expect(afterA).toBe(beforeA); // benB belongs to centro B, hidden from A
    expect(afterG).toBe(beforeG + 1); // global counts it
  });
});
