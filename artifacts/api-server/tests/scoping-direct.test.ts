import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import fornitoriRouter from "../src/routes/fornitori";
import volontariRouter from "../src/routes/volontari";
import mezziRouter from "../src/routes/mezzi";
import utentiRouter from "../src/routes/utenti";
import scarichiRouter from "../src/routes/scarichi";
import approvvigionamentiRouter from "../src/routes/approvvigionamenti";
import beneficiariRouter from "../src/routes/beneficiari";
import {
  makeScopedApp,
  makeSessionApp,
  newScope,
  cleanup,
  type SeedScope,
  createCentro,
  createMagazzino,
  createProdotto,
  createBeneficiario,
  createFornitore,
  createVolontario,
  createMezzo,
  createRuolo,
  createUtente,
  createLotto,
  insertScarico,
  insertApprovvigionamento,
} from "./scope-helpers";

/**
 * Centro scoping for direct-column entities: each row carries its own
 * `centroAscoltoId`. A scoped caller sees own-centro + shared (NULL) rows,
 * except `utenti` which is intentionally STRICT (own centro only, no NULL).
 */

let scope: SeedScope;
let bootScope: SeedScope;
let operatoreId: number;
let centroA: number;
let centroB: number;

const idsOf = (body: unknown) => (body as Array<{ id: number }>).map((r) => r.id);

beforeAll(async () => {
  bootScope = newScope();
  operatoreId = await createUtente(bootScope, {});
});

beforeEach(async () => {
  scope = newScope();
  centroA = await createCentro(scope);
  centroB = await createCentro(scope);
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("Fornitori — scoping per centro", () => {
  it("lista: il caller del centro A vede A + comuni (NULL), non B", async () => {
    const fA = await createFornitore(scope, centroA);
    const fB = await createFornitore(scope, centroB);
    const fNull = await createFornitore(scope, null);
    const res = await request(
      makeScopedApp(fornitoriRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get("/fornitori");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(fA);
    expect(ids).toContain(fNull);
    expect(ids).not.toContain(fB);
  });

  it("lista: il caller globale vede tutti", async () => {
    const fA = await createFornitore(scope, centroA);
    const fB = await createFornitore(scope, centroB);
    const res = await request(
      makeScopedApp(fornitoriRouter, { id: operatoreId, centroAscoltoId: null }),
    ).get("/fornitori");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([fA, fB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const fB = await createFornitore(scope, centroB);
    const res = await request(
      makeScopedApp(fornitoriRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get(`/fornitori/${fB}`);
    expect(res.status).toBe(403);
  });

  it("POST auto-assegna e blocca il centro del caller", async () => {
    const res = await request(
      makeScopedApp(fornitoriRouter, { id: operatoreId, centroAscoltoId: centroA }),
    )
      .post("/fornitori")
      .send({ nome: "Fornitore X", tipo: "azienda", centroAscoltoId: centroB });
    expect(res.status).toBe(201);
    scope.fornitoreIds.push(res.body.id);
    expect(res.body.centroAscoltoId).toBe(centroA);
  });

  it("PATCH /:id fuori centro → 403", async () => {
    const fB = await createFornitore(scope, centroB);
    const res = await request(
      makeScopedApp(fornitoriRouter, { id: operatoreId, centroAscoltoId: centroA }),
    )
      .patch(`/fornitori/${fB}`)
      .send({ nome: "Hack" });
    expect(res.status).toBe(403);
  });

  it("DELETE /:id fuori centro → 403", async () => {
    const fB = await createFornitore(scope, centroB);
    const res = await request(
      makeScopedApp(fornitoriRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).delete(`/fornitori/${fB}`);
    expect(res.status).toBe(403);
  });
});

describe("Volontari — scoping per centro", () => {
  it("lista: A vede A + comuni (NULL), non B", async () => {
    const vA = await createVolontario(scope, centroA);
    const vB = await createVolontario(scope, centroB);
    const vNull = await createVolontario(scope, null);
    const res = await request(
      makeScopedApp(volontariRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get("/volontari");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(vA);
    expect(ids).toContain(vNull);
    expect(ids).not.toContain(vB);
  });

  it("lista: il caller globale vede tutti", async () => {
    const vA = await createVolontario(scope, centroA);
    const vB = await createVolontario(scope, centroB);
    const res = await request(
      makeScopedApp(volontariRouter, { id: operatoreId, centroAscoltoId: null }),
    ).get("/volontari");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([vA, vB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const vB = await createVolontario(scope, centroB);
    const res = await request(
      makeScopedApp(volontariRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get(`/volontari/${vB}`);
    expect(res.status).toBe(403);
  });

  it("POST auto-assegna e blocca il centro del caller", async () => {
    const res = await request(
      makeScopedApp(volontariRouter, { id: operatoreId, centroAscoltoId: centroA }),
    )
      .post("/volontari")
      .send({ nome: "Mario", cognome: "Rossi", ruolo: "autista", centroAscoltoId: centroB });
    expect(res.status).toBe(201);
    scope.volontarioIds.push(res.body.id);
    expect(res.body.centroAscoltoId).toBe(centroA);
  });

  it("PATCH /:id fuori centro → 403", async () => {
    const vB = await createVolontario(scope, centroB);
    const res = await request(
      makeScopedApp(volontariRouter, { id: operatoreId, centroAscoltoId: centroA }),
    )
      .patch(`/volontari/${vB}`)
      .send({ nome: "Hack" });
    expect(res.status).toBe(403);
  });

  it("DELETE /:id fuori centro → 403", async () => {
    const vB = await createVolontario(scope, centroB);
    const res = await request(
      makeScopedApp(volontariRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).delete(`/volontari/${vB}`);
    expect(res.status).toBe(403);
  });
});

describe("Mezzi — scoping per centro", () => {
  it("lista: A vede A + comuni, non B (centro diretto e via volontario)", async () => {
    const mA = await createMezzo(scope, { centroId: centroA });
    const mB = await createMezzo(scope, { centroId: centroB });
    const mNull = await createMezzo(scope, { centroId: null });
    const volB = await createVolontario(scope, centroB);
    // centro NULL ma volontario del centro B → centro effettivo = B → invisibile ad A.
    const mVolB = await createMezzo(scope, { centroId: null, volontarioId: volB });
    const res = await request(
      makeScopedApp(mezziRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get("/mezzi");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(mA);
    expect(ids).toContain(mNull);
    expect(ids).not.toContain(mB);
    expect(ids).not.toContain(mVolB);
  });

  it("lista: il caller globale vede tutti", async () => {
    const mA = await createMezzo(scope, { centroId: centroA });
    const mB = await createMezzo(scope, { centroId: centroB });
    const res = await request(
      makeScopedApp(mezziRouter, { id: operatoreId, centroAscoltoId: null }),
    ).get("/mezzi");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([mA, mB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const mB = await createMezzo(scope, { centroId: centroB });
    const res = await request(
      makeScopedApp(mezziRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get(`/mezzi/${mB}`);
    expect(res.status).toBe(403);
  });

  it("POST auto-assegna il centro del caller", async () => {
    const res = await request(
      makeScopedApp(mezziRouter, { id: operatoreId, centroAscoltoId: centroA }),
    )
      .post("/mezzi")
      .send({ codice: `MZ${Date.now()}`, tipo: "furgone", proprieta: "centro", centroAscoltoId: centroB });
    expect(res.status).toBe(201);
    scope.mezzoIds.push(res.body.id);
    expect(res.body.centroAscoltoId).toBe(centroA);
  });

  it("PATCH IDOR: assegnare un volontario di un altro centro → 403", async () => {
    const mA = await createMezzo(scope, { centroId: centroA });
    const volB = await createVolontario(scope, centroB);
    const res = await request(
      makeScopedApp(mezziRouter, { id: operatoreId, centroAscoltoId: centroA }),
    )
      .patch(`/mezzi/${mA}`)
      .send({ volontarioId: volB });
    expect(res.status).toBe(403);
  });

  it("DELETE /:id fuori centro → 403", async () => {
    const mB = await createMezzo(scope, { centroId: centroB });
    const res = await request(
      makeScopedApp(mezziRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).delete(`/mezzi/${mB}`);
    expect(res.status).toBe(403);
  });
});

describe("Utenti — scoping STRETTO per centro (niente comuni/NULL)", () => {
  // The utenti router bakes in requireAuth+requireAdmin, so the caller must be a
  // real admin utente loaded via the session; its centro drives the scoping.
  let adminA: number;
  let adminNull: number;

  beforeEach(async () => {
    const adminRuolo = await createRuolo(scope, { isAdmin: true });
    adminA = await createUtente(scope, { centroId: centroA, ruoloId: adminRuolo });
    adminNull = await createUtente(scope, { centroId: null, ruoloId: adminRuolo });
  });

  it("lista: A vede SOLO gli utenti del proprio centro (non B, non globali/NULL)", async () => {
    const uA = await createUtente(scope, { centroId: centroA });
    const uB = await createUtente(scope, { centroId: centroB });
    const uNull = await createUtente(scope, { centroId: null });
    const res = await request(makeSessionApp(utentiRouter, adminA)).get("/utenti");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(uA);
    expect(ids).not.toContain(uB);
    expect(ids).not.toContain(uNull);
  });

  it("lista: il caller globale vede tutti", async () => {
    const uA = await createUtente(scope, { centroId: centroA });
    const uB = await createUtente(scope, { centroId: centroB });
    const uNull = await createUtente(scope, { centroId: null });
    const res = await request(makeSessionApp(utentiRouter, adminNull)).get("/utenti");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([uA, uB, uNull]));
  });

  it("GET /:id → 403 sia per un utente di B sia per un utente globale/NULL", async () => {
    const uB = await createUtente(scope, { centroId: centroB });
    const uNull = await createUtente(scope, { centroId: null });
    const appA = makeSessionApp(utentiRouter, adminA);
    expect((await request(appA).get(`/utenti/${uB}`)).status).toBe(403);
    expect((await request(appA).get(`/utenti/${uNull}`)).status).toBe(403);
  });

  it("POST auto-assegna e blocca il centro del caller", async () => {
    const ruoloId = await createRuolo(scope, {});
    const res = await request(makeSessionApp(utentiRouter, adminA))
      .post("/utenti")
      .send({
        username: `u_${Date.now()}`,
        password: "password123",
        nome: "Mario",
        cognome: "Rossi",
        ruoloId,
        centroAscoltoId: centroB,
      });
    expect(res.status).toBe(201);
    scope.utenteIds.push(res.body.id);
    expect(res.body.centroAscoltoId).toBe(centroA);
  });

  it("PATCH /:id fuori centro → 403", async () => {
    const uB = await createUtente(scope, { centroId: centroB });
    const res = await request(makeSessionApp(utentiRouter, adminA))
      .patch(`/utenti/${uB}`)
      .send({ nome: "Hack" });
    expect(res.status).toBe(403);
  });

  it("DELETE /:id fuori centro → 403", async () => {
    const uB = await createUtente(scope, { centroId: centroB });
    const res = await request(makeSessionApp(utentiRouter, adminA)).delete(`/utenti/${uB}`);
    expect(res.status).toBe(403);
  });

  it("POST /:id/reset-password fuori centro → 403", async () => {
    const uB = await createUtente(scope, { centroId: centroB });
    const res = await request(makeSessionApp(utentiRouter, adminA))
      .post(`/utenti/${uB}/reset-password`)
      .send({ newPassword: "password123" });
    expect(res.status).toBe(403);
  });
});

describe("Beneficiari — scoping per centro", () => {
  it("lista: A vede A + comuni, non B", async () => {
    const bA = await createBeneficiario(scope, centroA);
    const bB = await createBeneficiario(scope, centroB);
    const bNull = await createBeneficiario(scope, null);
    const res = await request(
      makeScopedApp(beneficiariRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get("/beneficiari");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(bA);
    expect(ids).toContain(bNull);
    expect(ids).not.toContain(bB);
  });

  it("lista: il caller globale vede tutti", async () => {
    const bA = await createBeneficiario(scope, centroA);
    const bB = await createBeneficiario(scope, centroB);
    const res = await request(
      makeScopedApp(beneficiariRouter, { id: operatoreId, centroAscoltoId: null }),
    ).get("/beneficiari");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([bA, bB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const bB = await createBeneficiario(scope, centroB);
    const res = await request(
      makeScopedApp(beneficiariRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get(`/beneficiari/${bB}`);
    expect(res.status).toBe(403);
  });

  it("POST auto-assegna e blocca il centro del caller", async () => {
    const res = await request(
      makeScopedApp(beneficiariRouter, { id: operatoreId, centroAscoltoId: centroA }),
    )
      .post("/beneficiari")
      .send({ nome: "Mario", cognome: "Rossi", centroAscoltoId: centroB });
    expect(res.status).toBe(201);
    scope.beneficiarioIds.push(res.body.id);
    expect(res.body.centroAscoltoId).toBe(centroA);
  });

  it("PATCH /:id fuori centro → 403", async () => {
    const bB = await createBeneficiario(scope, centroB);
    const res = await request(
      makeScopedApp(beneficiariRouter, { id: operatoreId, centroAscoltoId: centroA }),
    )
      .patch(`/beneficiari/${bB}`)
      .send({ nome: "Hack" });
    expect(res.status).toBe(403);
  });

  it("DELETE /:id fuori centro → 403", async () => {
    const bB = await createBeneficiario(scope, centroB);
    const res = await request(
      makeScopedApp(beneficiariRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).delete(`/beneficiari/${bB}`);
    expect(res.status).toBe(403);
  });

  it("nucleo (GET/POST/DELETE) fuori centro → 403", async () => {
    const bB = await createBeneficiario(scope, centroB);
    const appA = makeScopedApp(beneficiariRouter, { id: operatoreId, centroAscoltoId: centroA });
    expect((await request(appA).get(`/beneficiari/${bB}/nucleo`)).status).toBe(403);
    expect((await request(appA).post(`/beneficiari/${bB}/nucleo`).send({})).status).toBe(403);
    expect((await request(appA).delete(`/beneficiari/${bB}/nucleo/1`)).status).toBe(403);
  });
});

describe("Scarichi — scoping per centro", () => {
  it("lista: A vede A + comuni, non B", async () => {
    const mag = await createMagazzino(scope, null);
    const sA = await insertScarico(scope, { magazzinoId: mag, centroId: centroA });
    const sB = await insertScarico(scope, { magazzinoId: mag, centroId: centroB });
    const sNull = await insertScarico(scope, { magazzinoId: mag, centroId: null });
    const res = await request(
      makeScopedApp(scarichiRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get("/scarichi");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(sA);
    expect(ids).toContain(sNull);
    expect(ids).not.toContain(sB);
  });

  it("lista: il caller globale vede tutti", async () => {
    const mag = await createMagazzino(scope, null);
    const sA = await insertScarico(scope, { magazzinoId: mag, centroId: centroA });
    const sB = await insertScarico(scope, { magazzinoId: mag, centroId: centroB });
    const res = await request(
      makeScopedApp(scarichiRouter, { id: operatoreId, centroAscoltoId: null }),
    ).get("/scarichi");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([sA, sB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const mag = await createMagazzino(scope, null);
    const sB = await insertScarico(scope, { magazzinoId: mag, centroId: centroB });
    const res = await request(
      makeScopedApp(scarichiRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get(`/scarichi/${sB}`);
    expect(res.status).toBe(403);
  });

  it("POST auto-assegna il centro del caller", async () => {
    const mag = await createMagazzino(scope, null);
    const prod = await createProdotto(scope);
    await createLotto(scope, { prodottoId: prod, magazzinoId: mag, quantita: 10 });
    const res = await request(
      makeScopedApp(scarichiRouter, { id: operatoreId, centroAscoltoId: centroA }),
    )
      .post("/scarichi")
      .send({
        magazzinoId: mag,
        dataScarico: "2026-06-24",
        causale: "scaduta",
        righe: [{ prodottoId: prod, quantita: 2, unitaMisura: "kg" }],
      });
    expect(res.status).toBe(201);
    scope.scaricoIds.push(res.body.id);
    expect(res.body.centroAscoltoId).toBe(centroA);
  });
});

describe("Approvvigionamenti — scoping per centro", () => {
  it("lista: A vede A + comuni, non B", async () => {
    const mag = await createMagazzino(scope, null);
    const aA = await insertApprovvigionamento(scope, { magazzinoId: mag, centroId: centroA });
    const aB = await insertApprovvigionamento(scope, { magazzinoId: mag, centroId: centroB });
    const aNull = await insertApprovvigionamento(scope, { magazzinoId: mag, centroId: null });
    const res = await request(
      makeScopedApp(approvvigionamentiRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get("/approvvigionamenti");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(aA);
    expect(ids).toContain(aNull);
    expect(ids).not.toContain(aB);
  });

  it("lista: il caller globale vede tutti", async () => {
    const mag = await createMagazzino(scope, null);
    const aA = await insertApprovvigionamento(scope, { magazzinoId: mag, centroId: centroA });
    const aB = await insertApprovvigionamento(scope, { magazzinoId: mag, centroId: centroB });
    const res = await request(
      makeScopedApp(approvvigionamentiRouter, { id: operatoreId, centroAscoltoId: null }),
    ).get("/approvvigionamenti");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([aA, aB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const mag = await createMagazzino(scope, null);
    const aB = await insertApprovvigionamento(scope, { magazzinoId: mag, centroId: centroB });
    const res = await request(
      makeScopedApp(approvvigionamentiRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).get(`/approvvigionamenti/${aB}`);
    expect(res.status).toBe(403);
  });

  it("POST auto-assegna il centro del caller", async () => {
    const mag = await createMagazzino(scope, null);
    const prod = await createProdotto(scope);
    const res = await request(
      makeScopedApp(approvvigionamentiRouter, { id: operatoreId, centroAscoltoId: centroA }),
    )
      .post("/approvvigionamenti")
      .send({
        dataRichiesta: "2026-06-24",
        magazzinoId: mag,
        righe: [{ prodottoId: prod, quantitaRichiesta: 10, unitaMisura: "kg" }],
      });
    expect(res.status).toBe(201);
    scope.approvvigionamentoIds.push(res.body.id);
    expect(res.body.centroAscoltoId).toBe(centroA);
  });

  it("PATCH IDOR: spostare l'ordine su un magazzino di un altro centro → 403", async () => {
    const magNull = await createMagazzino(scope, null);
    const magB = await createMagazzino(scope, centroB);
    const ordA = await insertApprovvigionamento(scope, { magazzinoId: magNull, centroId: centroA });
    const res = await request(
      makeScopedApp(approvvigionamentiRouter, { id: operatoreId, centroAscoltoId: centroA }),
    )
      .patch(`/approvvigionamenti/${ordA}`)
      .send({ magazzinoId: magB });
    expect(res.status).toBe(403);
  });

  it("POST /:id/sottometti fuori centro → 403", async () => {
    const mag = await createMagazzino(scope, null);
    const aB = await insertApprovvigionamento(scope, { magazzinoId: mag, centroId: centroB });
    const res = await request(
      makeScopedApp(approvvigionamentiRouter, { id: operatoreId, centroAscoltoId: centroA }),
    ).post(`/approvvigionamenti/${aB}/sottometti`);
    expect(res.status).toBe(403);
  });
});
