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
  createMagazzino,
  createMagazzinoRec,
  createProdotto,
  createBeneficiario,
  createUtente,
  createCitta,
  createLotto,
  insertConsegna,
  insertBolla,
  insertBollaRiga,
} from "./scope-helpers";

/**
 * Città-level data filtering on the global reports (B5).
 *
 * A global admin (cittaId = null) may narrow any report to a single città via
 * ?cittaId. A scoped caller stays HARD-bound to its own città: the ?cittaId
 * param is ANDed on top of the existing own-città-or-null scope, so passing
 * another città's id can only ever shrink the result to zero — never leak.
 */

let scope: SeedScope;
let bootScope: SeedScope;
let operatoreId: number;
let centro: number;
let cittaA: number;
let cittaB: number;
let magNull: number;
let prod: number;

const appAs = (centro: number | null, citta: number | null) =>
  makeScopedApp(reportRouter, { id: operatoreId, centroAscoltoId: centro, cittaId: citta });

beforeAll(async () => {
  bootScope = newScope();
  operatoreId = await createUtente(bootScope, {});
});

beforeEach(async () => {
  scope = newScope();
  centro = await createCentro(scope);
  cittaA = await createCitta(scope);
  cittaB = await createCitta(scope);
  magNull = await createMagazzino(scope, null);
  prod = await createProdotto(scope);
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("Report — filtro ?cittaId (admin globale)", () => {
  it("giacenze-per-magazzino: ?cittaId restringe ai magazzini della città scelta", async () => {
    const magA = await createMagazzinoRec(scope, null, { cittaId: cittaA });
    const magB = await createMagazzinoRec(scope, null, { cittaId: cittaB });
    await createLotto(scope, { prodottoId: prod, magazzinoId: magA.id, quantita: 10 });
    await createLotto(scope, { prodottoId: prod, magazzinoId: magB.id, quantita: 10 });

    const res = await request(appAs(null, null)).get(`/report/giacenze-per-magazzino?cittaId=${cittaA}`);
    expect(res.status).toBe(200);
    const names = (res.body as Array<{ magazzinoNome: string }>).map((r) => r.magazzinoNome);
    expect(names).toContain(magA.nome);
    expect(names).not.toContain(magB.nome);
  });

  it("consegne-per-centro: ?cittaId conta solo i beneficiari della città scelta", async () => {
    const benA = await createBeneficiario(scope, centro, { cittaId: cittaA });
    const benB = await createBeneficiario(scope, centro, { cittaId: cittaB });
    await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magNull, stato: "effettuata" });
    await insertConsegna(scope, { beneficiarioId: benB, magazzinoId: magNull, stato: "effettuata" });

    const q = "/report/consegne-per-centro?da=2026-01-01&a=2026-12-31";
    const totA = (await request(appAs(null, null)).get(`${q}&cittaId=${cittaA}`)).body as Array<{
      totale: number;
    }>;
    const totAll = (await request(appAs(null, null)).get(q)).body as Array<{ totale: number }>;
    const sum = (rows: Array<{ totale: number }>) => rows.reduce((a, r) => a + r.totale, 0);
    // città A has exactly one delivery; the unfiltered total includes B too.
    expect(sum(totA)).toBeGreaterThanOrEqual(1);
    expect(sum(totAll)).toBeGreaterThanOrEqual(sum(totA) + 1);
  });

  it("consegne-per-mese: ?cittaId isola la consegna della città scelta", async () => {
    const monthTotal = (body: Array<{ mese: string; totConsegne: number }>, mese: string) =>
      body.find((r) => r.mese === mese)?.totConsegne ?? 0;
    const q = "/report/consegne-per-mese?da=2026-01-01&a=2026-12-31";

    const beforeFiltered = monthTotal((await request(appAs(null, null)).get(`${q}&cittaId=${cittaA}`)).body, "2026-06");

    await insertConsegna(scope, {
      beneficiarioId: await createBeneficiario(scope, centro, { cittaId: cittaA }),
      magazzinoId: magNull,
      stato: "effettuata",
    });
    await insertConsegna(scope, {
      beneficiarioId: await createBeneficiario(scope, centro, { cittaId: cittaB }),
      magazzinoId: magNull,
      stato: "effettuata",
    });

    const afterFiltered = monthTotal((await request(appAs(null, null)).get(`${q}&cittaId=${cittaA}`)).body, "2026-06");
    // Only the città-A delivery is counted under ?cittaId=A.
    expect(afterFiltered).toBe(beforeFiltered + 1);
  });

  it("fse-plus: ?cittaId conta solo i beneficiari FSE+ della città scelta", async () => {
    const q = "/report/fse-plus?anno=2026";
    const beforeFiltered = (await request(appAs(null, null)).get(`${q}&cittaId=${cittaA}`)).body
      .beneficiariTotali as number;

    const benA = await createBeneficiario(scope, centro, { cittaId: cittaA });
    const lotA = await createLotto(scope, { prodottoId: prod, magazzinoId: magNull, quantita: 5, fsePlus: true });
    const bolA = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magNull, stato: "confermato" });
    await insertBollaRiga(scope, { bollaId: bolA, prodottoId: prod, lottoId: lotA, quantita: 5 });

    const benB = await createBeneficiario(scope, centro, { cittaId: cittaB });
    const lotB = await createLotto(scope, { prodottoId: prod, magazzinoId: magNull, quantita: 5, fsePlus: true });
    const bolB = await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull, stato: "confermato" });
    await insertBollaRiga(scope, { bollaId: bolB, prodottoId: prod, lottoId: lotB, quantita: 5 });

    const afterFiltered = (await request(appAs(null, null)).get(`${q}&cittaId=${cittaA}`)).body
      .beneficiariTotali as number;
    // Only città-A's FSE+ beneficiary is counted under ?cittaId=A.
    expect(afterFiltered).toBe(beforeFiltered + 1);
  });
});

describe("Report — ?cittaId NON è un leak per chiamanti scoped", () => {
  it("consegne-per-mese: uno scoped su città A che chiede ?cittaId=B non vede nulla di B", async () => {
    const monthTotal = (body: Array<{ mese: string; totConsegne: number }>, mese: string) =>
      body.find((r) => r.mese === mese)?.totConsegne ?? 0;
    const q = "/report/consegne-per-mese?da=2026-01-01&a=2026-12-31";

    // Caller is scoped to città A.
    const beforeReqB = monthTotal((await request(appAs(null, cittaA)).get(`${q}&cittaId=${cittaB}`)).body, "2026-06");

    // Add a delivery in città B.
    await insertConsegna(scope, {
      beneficiarioId: await createBeneficiario(scope, centro, { cittaId: cittaB }),
      magazzinoId: magNull,
      stato: "effettuata",
    });

    // Scoped-A caller asking for città B still sees zero of B (own-città AND B = empty).
    const afterReqB = monthTotal((await request(appAs(null, cittaA)).get(`${q}&cittaId=${cittaB}`)).body, "2026-06");
    expect(afterReqB).toBe(beforeReqB);
  });

  it("giacenze-per-magazzino: uno scoped su città A che chiede ?cittaId=B non vede i magazzini di B", async () => {
    const magB = await createMagazzinoRec(scope, null, { cittaId: cittaB });
    await createLotto(scope, { prodottoId: prod, magazzinoId: magB.id, quantita: 10 });

    const res = await request(appAs(null, cittaA)).get(`/report/giacenze-per-magazzino?cittaId=${cittaB}`);
    expect(res.status).toBe(200);
    const names = (res.body as Array<{ magazzinoNome: string }>).map((r) => r.magazzinoNome);
    expect(names).not.toContain(magB.nome);
  });
});
