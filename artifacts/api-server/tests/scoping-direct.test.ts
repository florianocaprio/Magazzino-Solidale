import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import request from "supertest";
import { Router } from "express";
import { requireAuth } from "../src/middlewares/auth";
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
  createCentroRec,
  createMagazzino,
  createProdotto,
  createBeneficiario,
  createAreaOperativa,
  createFornitore,
  createVolontario,
  createMezzo,
  createRuolo,
  createRuoloVolontario,
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
let areaOperativaA: number;
let areaOperativaB: number;
let ruoloVolontarioId: number;

const idsOf = (body: unknown) =>
  (body as Array<{ id: number }>).map((r) => r.id);

beforeAll(async () => {
  bootScope = newScope();
  operatoreId = await createUtente(bootScope, {});
});

beforeEach(async () => {
  scope = newScope();
  areaOperativaA = await createAreaOperativa(scope);
  areaOperativaB = await createAreaOperativa(scope);
  centroA = (await createCentroRec(scope, { areaOperativaId: areaOperativaA }))
    .id;
  centroB = (await createCentroRec(scope, { areaOperativaId: areaOperativaB }))
    .id;
  ruoloVolontarioId = await createRuoloVolontario(scope);
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("Fornitori — scoping per area operativa", () => {
  it("lista: il caller della area operativa A vede A + comuni (NULL), non B", async () => {
    const fA = await createFornitore(scope, areaOperativaA);
    const fB = await createFornitore(scope, areaOperativaB);
    const fNull = await createFornitore(scope, null);
    const res = await request(
      makeScopedApp(fornitoriRouter, {
        id: operatoreId,
        areaOperativaId: areaOperativaA,
      }),
    ).get("/fornitori");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(fA);
    expect(ids).toContain(fNull);
    expect(ids).not.toContain(fB);
  });

  it("lista: il caller globale vede tutti", async () => {
    const fA = await createFornitore(scope, areaOperativaA);
    const fB = await createFornitore(scope, areaOperativaB);
    const res = await request(
      makeScopedApp(fornitoriRouter, {
        id: operatoreId,
        areaOperativaId: null,
      }),
    ).get("/fornitori");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([fA, fB]));
  });

  it("BUG17: Solo globali esclude i locali, anche con filtro Area", async () => {
    const local = await createFornitore(scope, areaOperativaA);
    const foreign = await createFornitore(scope, areaOperativaB);
    const global = await createFornitore(scope, null);
    for (const callerArea of [null, areaOperativaA]) {
      const app = makeScopedApp(fornitoriRouter, { id: operatoreId, areaOperativaId: callerArea });
      const res = await request(app).get(`/fornitori?ambito=globali&areaOperativaId=${areaOperativaB}`);
      expect(res.status).toBe(200);
      expect(idsOf(res.body)).toContain(global);
      expect(idsOf(res.body)).not.toContain(local);
      expect(idsOf(res.body)).not.toContain(foreign);
      expect(res.body.every((f: { areaOperativaId: number | null }) => f.areaOperativaId === null)).toBe(true);
    }
  });

  it("BUG17: il filtro Area include locali e globali senza altre Aree", async () => {
    const local = await createFornitore(scope, areaOperativaA);
    const foreign = await createFornitore(scope, areaOperativaB);
    const global = await createFornitore(scope, null);
    const app = makeScopedApp(fornitoriRouter, { id: operatoreId, areaOperativaId: null });
    const res = await request(app).get(`/fornitori?areaOperativaId=${areaOperativaA}`);
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([local, global]));
    expect(idsOf(res.body)).not.toContain(foreign);
    const scoped = makeScopedApp(fornitoriRouter, { id: operatoreId, areaOperativaId: areaOperativaA });
    const attempted = await request(scoped).get(`/fornitori?areaOperativaId=${areaOperativaB}`);
    expect(attempted.status).toBe(200);
    expect(idsOf(attempted.body)).toEqual(expect.arrayContaining([local, global]));
    expect(idsOf(attempted.body)).not.toContain(foreign);
  });

  it.each(["ambito=altro", "ambito=globali&ambito=tutti", "areaOperativaId=0", "areaOperativaId=1x", "areaOperativaId=NaN"])("BUG17: rifiuta il filtro malformato %s", async (query) => {
    const app = makeScopedApp(fornitoriRouter, { id: operatoreId, areaOperativaId: null });
    expect((await request(app).get(`/fornitori?${query}`)).status).toBe(400);
  });

  it("BUG17: crea e modifica un globale; il territoriale può leggerlo ma non gestirlo", async () => {
    const admin = makeScopedApp(fornitoriRouter, { id: operatoreId, areaOperativaId: null });
    const created = await request(admin).post("/fornitori").send({ nome: "Globale BUG17", tipo: "commerciale", areaOperativaId: null });
    expect(created.status).toBe(201);
    scope.fornitoreIds.push(created.body.id);
    expect(created.body.areaOperativaId).toBeNull();
    const edited = await request(admin).patch(`/fornitori/${created.body.id}`).send({ nome: "Globale BUG17 aggiornato", areaOperativaId: null });
    expect(edited.status).toBe(200);
    expect(edited.body.areaOperativaId).toBeNull();
    const scoped = makeScopedApp(fornitoriRouter, { id: operatoreId, areaOperativaId: areaOperativaA });
    expect((await request(scoped).get(`/fornitori/${created.body.id}`)).status).toBe(200);
    expect((await request(scoped).patch(`/fornitori/${created.body.id}`).send({ nome: "Non consentito" })).status).toBe(403);
    expect((await request(scoped).delete(`/fornitori/${created.body.id}`)).status).toBe(403);
    const attempted = await request(scoped).post("/fornitori").send({ nome: "Tentativo globale", tipo: "commerciale", areaOperativaId: null });
    expect(attempted.status).toBe(201);
    scope.fornitoreIds.push(attempted.body.id);
    expect(attempted.body.areaOperativaId).toBe(areaOperativaA);
  });

  it("GET /:id fuori area operativa → 403", async () => {
    const fB = await createFornitore(scope, areaOperativaB);
    const res = await request(
      makeScopedApp(fornitoriRouter, {
        id: operatoreId,
        areaOperativaId: areaOperativaA,
      }),
    ).get(`/fornitori/${fB}`);
    expect(res.status).toBe(403);
  });

  it("POST auto-assegna e blocca la area operativa del caller", async () => {
    const res = await request(
      makeScopedApp(fornitoriRouter, {
        id: operatoreId,
        areaOperativaId: areaOperativaA,
      }),
    )
      .post("/fornitori")
      .send({
        nome: "Fornitore X",
        tipo: "azienda",
        areaOperativaId: areaOperativaB,
      });
    expect(res.status).toBe(201);
    scope.fornitoreIds.push(res.body.id);
    expect(res.body.areaOperativaId).toBe(areaOperativaA);
  });

  it("PATCH /:id fuori area operativa → 403", async () => {
    const fB = await createFornitore(scope, areaOperativaB);
    const res = await request(
      makeScopedApp(fornitoriRouter, {
        id: operatoreId,
        areaOperativaId: areaOperativaA,
      }),
    )
      .patch(`/fornitori/${fB}`)
      .send({ nome: "Hack" });
    expect(res.status).toBe(403);
  });

  it("DELETE /:id fuori area operativa → 403", async () => {
    const fB = await createFornitore(scope, areaOperativaB);
    const res = await request(
      makeScopedApp(fornitoriRouter, {
        id: operatoreId,
        areaOperativaId: areaOperativaA,
      }),
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
      makeScopedApp(volontariRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
      }),
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
      makeScopedApp(volontariRouter, {
        id: operatoreId,
        centroAscoltoId: null,
      }),
    ).get("/volontari");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([vA, vB]));
  });

  it("lista filtrata per centro: restituisce il centro richiesto + comuni, non altri centri", async () => {
    const vA = await createVolontario(scope, centroA);
    const vB = await createVolontario(scope, centroB);
    const vNull = await createVolontario(scope, null);
    const res = await request(
      makeScopedApp(volontariRouter, {
        id: operatoreId,
        centroAscoltoId: null,
      }),
    ).get(`/volontari?centroAscoltoId=${centroA}`);
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(vA);
    expect(ids).toContain(vNull);
    expect(ids).not.toContain(vB);
  });

  it("lista filtrata per centro fuori perimetro → 403", async () => {
    const res = await request(
      makeScopedApp(volontariRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
      }),
    ).get(`/volontari?centroAscoltoId=${centroB}`);
    expect(res.status).toBe(403);
  });

  it("GET /:id fuori centro → 403", async () => {
    const vB = await createVolontario(scope, centroB);
    const res = await request(
      makeScopedApp(volontariRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
      }),
    ).get(`/volontari/${vB}`);
    expect(res.status).toBe(403);
  });

  it("POST rifiuta l'assegnazione esplicita a un Centro di un’altra Area", async () => {
    const res = await request(
      makeScopedApp(volontariRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
      }),
    )
      .post("/volontari")
      .send({
        nome: "Mario",
        cognome: "Rossi",
        ruoloVolontarioId,
        centroAscoltoId: centroB,
        luogoNascita: "Roma",
        dataNascita: "1990-01-02",
        indirizzoResidenza: "Via Scoping 1",
        codiceFiscaleNonDisponibile: true,
        codiceFiscaleNota: "Non disponibile nel test automatico",
      });
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.centroAscoltoId).toBeDefined();
  });

  it("PATCH /:id fuori centro → 403", async () => {
    const vB = await createVolontario(scope, centroB);
    const res = await request(
      makeScopedApp(volontariRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
      }),
    )
      .patch(`/volontari/${vB}`)
      .send({ nome: "Hack" });
    expect(res.status).toBe(403);
  });

  it("DELETE /:id fuori centro → 403", async () => {
    const vB = await createVolontario(scope, centroB);
    const res = await request(
      makeScopedApp(volontariRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
      }),
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
    const mVolB = await createMezzo(scope, {
      centroId: null,
      volontarioId: volB,
    });
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
      .send({
        codice: `MZ${Date.now()}`,
        tipo: "furgone",
        proprieta: "centro",
        centroAscoltoId: centroB,
      });
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
      .send({ volontarioId: volB, versione: 1 });
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

describe("Utenti — scoping per Area (niente globali/NULL)", () => {
  // The utenti router bakes in requireAuth+requireAdmin, so the caller must be a
  // real admin utente loaded via the session; its centro drives the scoping.
  let adminA: number;
  let adminNull: number;

  beforeEach(async () => {
    const adminRuolo = await createRuolo(scope, { isAdmin: true });
    adminA = await createUtente(scope, {
      centroId: centroA,
      ruoloId: adminRuolo,
    });
    adminNull = await createUtente(scope, {
      centroId: null,
      ruoloId: adminRuolo,
    });
  });

  it("lista: A vede SOLO gli utenti della propria Area (non B, non globali/NULL)", async () => {
    const uA = await createUtente(scope, { centroId: centroA });
    const uB = await createUtente(scope, { centroId: centroB });
    const uNull = await createUtente(scope, { centroId: null });
    const res = await request(makeSessionApp(utentiRouter, adminA)).get(
      "/utenti",
    );
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
    const res = await request(makeSessionApp(utentiRouter, adminNull)).get(
      "/utenti",
    );
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([uA, uB, uNull]));
  });

  it("GET /:id → 403 sia per un utente di B sia per un utente globale/NULL", async () => {
    const uB = await createUtente(scope, { centroId: centroB });
    const uNull = await createUtente(scope, { centroId: null });
    const appA = makeSessionApp(utentiRouter, adminA);
    expect((await request(appA).get(`/utenti/${uB}`)).status).toBe(403);
    expect((await request(appA).get(`/utenti/${uNull}`)).status).toBe(403);
  });

  it("POST ignora il Centro legacy e assegna l’Area del caller", async () => {
    const ruoloId = await createRuolo(scope, {});
    const res = await request(makeSessionApp(utentiRouter, adminA))
      .post("/utenti")
      .send({
        username: `u_${Date.now()}`,
        email: `u_${Date.now()}@example.org`,
        password: "password123",
        nome: "Mario",
        cognome: "Rossi",
        ruoloId,
        centroAscoltoId: centroB,
      });
    expect(res.status).toBe(201);
    scope.utenteIds.push(res.body.id);
    expect(res.body).toMatchObject({ areaOperativaId: areaOperativaA, centroAscoltoId: null });
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
    const res = await request(makeSessionApp(utentiRouter, adminA)).delete(
      `/utenti/${uB}`,
    );
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
      makeScopedApp(beneficiariRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
        areaOperativaId: areaOperativaA,
      }),
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
    const unscoped = await request(
      makeScopedApp(beneficiariRouter, {
        id: operatoreId,
        centroAscoltoId: null,
      }),
    ).get("/beneficiari");
    expect(unscoped.status).toBe(403);
    expect(unscoped.body.error).toBe(
      "Assegnazione territoriale UDS non disponibile",
    );
    const res = await request(
      makeScopedApp(beneficiariRouter, {
        id: operatoreId,
        centroAscoltoId: null,
        isAdmin: true,
      }),
    ).get("/beneficiari");
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([bA, bB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const bB = await createBeneficiario(scope, centroB);
    const res = await request(
      makeScopedApp(beneficiariRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
        areaOperativaId: areaOperativaA,
      }),
    ).get(`/beneficiari/${bB}`);
    expect(res.status).toBe(403);
  });

  it("POST rifiuta un Centro di un’altra Area senza assegnazioni implicite", async () => {
    const res = await request(
      makeScopedApp(beneficiariRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
        areaOperativaId: areaOperativaA,
      }),
    )
      .post("/beneficiari")
      .send({
        nome: "Mario",
        cognome: "Rossi",
        sesso: "M",
        centroAscoltoId: centroB,
      });
    expect(res.status).toBe(400);
  });

  it("profilo sociale: crea, legge e modifica in un altro Centro della stessa Area", async () => {
    const other = await createCentroRec(scope, { areaOperativaId: areaOperativaA });
    const app = makeScopedApp(beneficiariRouter, {
      id: operatoreId, centroAscoltoId: centroA, areaOperativaId: areaOperativaA,
      aree: ["sociale"],
    });
    const created = await request(app).post("/beneficiari").send({
      nome: "Area", cognome: "Condivisa", sesso: "M", centroAscoltoId: other.id,
    });
    expect(created.status, created.text).toBe(201);
    scope.beneficiarioIds.push(created.body.id);
    expect(created.body.centroAscoltoId).toBe(other.id);
    const path = `/beneficiari/${created.body.id}`;
    expect((await request(app).get(path)).status).toBe(200);
    const updated = await request(app).patch(path).send({ nome: "Aggiornato", versione: created.body.versione });
    expect(updated.status, updated.text).toBe(200);
    const foreign = await request(app).patch(path).send({
      centroAscoltoId: centroB, versione: updated.body.versione,
    });
    expect(foreign.status, foreign.text).toBe(403);
    expect((await request(app).get(path)).body.centroAscoltoId).toBe(other.id);
    expect((await request(app).delete(path)).status).toBe(204);
  });

  it("PATCH /:id fuori centro → 403", async () => {
    const bB = await createBeneficiario(scope, centroB);
    const res = await request(
      makeScopedApp(beneficiariRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
        areaOperativaId: areaOperativaA,
      }),
    )
      .patch(`/beneficiari/${bB}`)
      .send({ nome: "Hack", versione: 1 });
    expect(res.status).toBe(403);
  });

  it("DELETE /:id fuori centro → 403", async () => {
    const bB = await createBeneficiario(scope, centroB);
    const res = await request(
      makeScopedApp(beneficiariRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
        areaOperativaId: areaOperativaA,
      }),
    ).delete(`/beneficiari/${bB}`);
    expect(res.status).toBe(403);
  });

  it("nucleo (GET/POST/DELETE) fuori centro → 403", async () => {
    const bB = await createBeneficiario(scope, centroB);
    const appA = makeScopedApp(beneficiariRouter, {
      id: operatoreId,
      centroAscoltoId: centroA,
      areaOperativaId: areaOperativaA,
    });
    expect((await request(appA).get(`/beneficiari/${bB}/nucleo`)).status).toBe(
      403,
    );
    expect(
      (await request(appA).post(`/beneficiari/${bB}/nucleo`).send({})).status,
    ).toBe(403);
    expect(
      (await request(appA).delete(`/beneficiari/${bB}/nucleo/1`)).status,
    ).toBe(403);
  });
});

describe("Scarichi — scoping per centro", () => {
  it("lista: A vede A + comuni, non B", async () => {
    const mag = await createMagazzino(scope, null);
    const sA = await insertScarico(scope, {
      magazzinoId: mag,
      centroId: centroA,
    });
    const sB = await insertScarico(scope, {
      magazzinoId: mag,
      centroId: centroB,
    });
    const sNull = await insertScarico(scope, {
      magazzinoId: mag,
      centroId: null,
    });
    const res = await request(
      makeScopedApp(scarichiRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
      }),
    ).get("/scarichi");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(sA);
    expect(ids).toContain(sNull);
    expect(ids).not.toContain(sB);
  });

  it("lista: il caller globale vede tutti", async () => {
    const mag = await createMagazzino(scope, null);
    const sA = await insertScarico(scope, {
      magazzinoId: mag,
      centroId: centroA,
    });
    const sB = await insertScarico(scope, {
      magazzinoId: mag,
      centroId: centroB,
    });
    const res = await request(
      makeScopedApp(scarichiRouter, { id: operatoreId, centroAscoltoId: null }),
    ).get("/scarichi");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([sA, sB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const mag = await createMagazzino(scope, null);
    const sB = await insertScarico(scope, {
      magazzinoId: mag,
      centroId: centroB,
    });
    const res = await request(
      makeScopedApp(scarichiRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
      }),
    ).get(`/scarichi/${sB}`);
    expect(res.status).toBe(403);
  });

  it("POST auto-assegna il centro del caller", async () => {
    const mag = await createMagazzino(scope, null);
    const prod = await createProdotto(scope);
    await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: mag,
      quantita: 10,
    });
    const res = await request(
      makeScopedApp(scarichiRouter, {
        id: operatoreId,
        centroAscoltoId: centroA,
      }),
    )
      .post("/scarichi")
      .send({
        magazzinoId: mag,
        dataScarico: "2026-06-24",
        causale: "deteriorata",
        righe: [{ prodottoId: prod, quantita: 2, unitaMisura: "kg" }],
      });
    expect(res.status).toBe(201);
    scope.scaricoIds.push(res.body.id);
    expect(res.body.centroAscoltoId).toBe(centroA);
  });
});

describe("Approvvigionamenti — scoping per centro", () => {
  async function supplyApp(centre: number | null) {
    const role = await createRuolo(scope, { isAdmin: centre == null });
    await pool.query("update ruoli set aree=$1, permessi=$2 where id=$3", [
      JSON.stringify(["logistica"]),
      JSON.stringify([
        "approvvigionamenti.view",
        "approvvigionamenti.manage",
        "approvvigionamenti.receive",
      ]),
      role,
    ]);
    const id = await createUtente(scope, { centroId: centre, ruoloId: role });
    await pool.query("update utenti set area_operativa_id=$1 where id=$2", [
      centre == null ? null : areaOperativaA,
      id,
    ]);
    const router = Router();
    router.use(requireAuth, approvvigionamentiRouter);
    return makeSessionApp(router, id);
  }
  it("lista: A vede A + comuni, non B", async () => {
    const mag = await createMagazzino(scope, null, {
      areaOperativaId: areaOperativaA,
    });
    const aA = await insertApprovvigionamento(scope, {
      magazzinoId: mag,
      centroId: centroA,
    });
    const aB = await insertApprovvigionamento(scope, {
      magazzinoId: mag,
      centroId: centroB,
    });
    const aNull = await insertApprovvigionamento(scope, {
      magazzinoId: mag,
      centroId: null,
    });
    const res = await request(await supplyApp(centroA)).get(
      "/approvvigionamenti",
    );
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(aA);
    expect(ids).toContain(aNull);
    expect(ids).toContain(aB);
  });

  it("lista: il caller globale vede tutti", async () => {
    const mag = await createMagazzino(scope, null, {
      areaOperativaId: areaOperativaA,
    });
    const aA = await insertApprovvigionamento(scope, {
      magazzinoId: mag,
      centroId: centroA,
    });
    const aB = await insertApprovvigionamento(scope, {
      magazzinoId: mag,
      centroId: centroB,
    });
    const res = await request(await supplyApp(null)).get("/approvvigionamenti");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([aA, aB]));
  });

  it("GET /:id dello stesso magazzino resta leggibile fra Centri", async () => {
    const mag = await createMagazzino(scope, null, {
      areaOperativaId: areaOperativaA,
    });
    const aB = await insertApprovvigionamento(scope, {
      magazzinoId: mag,
      centroId: centroB,
    });
    const res = await request(await supplyApp(centroA)).get(
      `/approvvigionamenti/${aB}`,
    );
    expect(res.status).toBe(200);
  });

  it("POST non assegna il Centro storico dell’utente", async () => {
    const mag = await createMagazzino(scope, null, {
      areaOperativaId: areaOperativaA,
    });
    const prod = await createProdotto(scope);
    const fornitore = await createFornitore(scope, areaOperativaA);
    const res = await request(await supplyApp(centroA))
      .post("/approvvigionamenti")
      .send({
        dataRichiesta: "2026-06-24",
        areaOperativaId: areaOperativaA,
        fornitoreId: fornitore,
        magazzinoId: mag,
        righe: [{ prodottoId: prod, quantitaRichiesta: 10, unitaMisura: "kg" }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    scope.approvvigionamentoIds.push(res.body.id);
    expect(res.body.centroAscoltoId).toBeNull();
  });

  it("PATCH IDOR: spostare l'ordine su un magazzino di un altro centro → 403", async () => {
    const magNull = await createMagazzino(scope, null, {
      areaOperativaId: areaOperativaA,
    });
    const magB = await createMagazzino(scope, centroB);
    const ordA = await insertApprovvigionamento(scope, {
      magazzinoId: magNull,
      centroId: centroA,
    });
    const res = await request(await supplyApp(centroA))
      .patch(`/approvvigionamenti/${ordA}`)
      .send({ versione: 1, magazzinoId: magB });
    expect(res.status).toBe(403);
  });

  it("POST /:id/sottometti fuori centro → 403", async () => {
    const mag = await createMagazzino(scope, null, {
      areaOperativaId: areaOperativaA,
    });
    const aB = await insertApprovvigionamento(scope, {
      magazzinoId: mag,
      centroId: centroB,
    });
    const res = await request(await supplyApp(centroA))
      .post(`/approvvigionamenti/${aB}/sottometti`)
      .send({ versione: 1 });
    expect(res.status).toBe(403);
  });
});
