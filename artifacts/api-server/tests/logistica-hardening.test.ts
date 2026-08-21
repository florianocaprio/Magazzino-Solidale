/* @vitest-environment node */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  auditConfigurazioniTable,
  consegneTable,
  db,
  mezziTable,
  pool,
  turniTable,
  turniVolontariTable,
  volontariTable,
} from "@workspace/db";
import { ALL_PERMISSION_KEYS } from "../src/lib/permissions";
import volontariRouter from "../src/routes/volontari";
import mezziRouter from "../src/routes/mezzi";
import turniRouter from "../src/routes/turni";
import approvazioniRouter from "../src/routes/approvazioni-logistica";
import consegneRouter from "../src/routes/consegne";
import {
  cleanup,
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createMagazzino,
  createMezzo,
  createRuoloVolontario,
  createVolontario,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

let scope: SeedScope;
let ruoloVolontarioId: number;

beforeEach(async () => {
  scope = newScope();
  ruoloVolontarioId = await createRuoloVolontario(scope);
});

afterEach(async () => {
  await db.delete(auditConfigurazioniTable).where(eq(auditConfigurazioniTable.area, "logistica"));
  await cleanup(scope);
});

afterAll(async () => {
  await pool.end();
});

const app = (
  router: Parameters<typeof makeScopedApp>[0],
  user: Parameters<typeof makeScopedApp>[1] = { id: 0, centroAscoltoId: null, areaOperativaId: null },
) => makeScopedApp(router, user);

describe("hardening Logistica", () => {
  it("separa permission view e manage lato server", async () => {
    expect(ALL_PERMISSION_KEYS).toEqual(expect.arrayContaining([
      "logistica.volontari.export",
      "logistica.mezzi.export",
    ]));
    const viewOnly = {
      id: 0,
      centroAscoltoId: null,
      areaOperativaId: null,
      permessi: ["logistica.volontari.view"],
    };
    expect((await request(app(volontariRouter, viewOnly)).get("/volontari")).status).toBe(200);
    const denied = await request(app(volontariRouter, viewOnly)).post("/volontari").send({
      nome: "Ada",
      cognome: "Rossi",
      matricola: `RBAC-${Date.now()}`,
      ruoloVolontarioId,
    });
    expect(denied.status).toBe(403);

    const approvalsViewOnly = { ...viewOnly, permessi: ["logistica.approvazioni.view"] };
    expect((await request(app(approvazioniRouter, approvalsViewOnly)).get("/approvazioni-logistica")).status).toBe(200);
    expect((await request(app(approvazioniRouter, approvalsViewOnly)).post("/approvazioni-logistica/volontari/999999/approva").send({ versione: 1 })).status).toBe(403);
  });

  it("forza pending/inattivo e pending/non disponibile su create normali", async () => {
    const volontario = await request(app(volontariRouter)).post("/volontari").send({
      nome: "Nuovo",
      cognome: "Volontario",
      matricola: `PENDING-${Date.now()}`,
      ruoloVolontarioId,
      attivo: true,
      statoApprovazione: "approvato",
    });
    expect(volontario.status).toBe(201);
    expect(volontario.body).toMatchObject({ attivo: false, statoApprovazione: "in_attesa", versione: 1 });
    scope.volontarioIds.push(volontario.body.id);

    const mezzo = await request(app(mezziRouter)).post("/mezzi").send({
      codice: `PM-${Date.now()}`,
      tipo: "auto",
      proprieta: "associazione",
      stato: "disponibile",
      statoApprovazione: "approvato",
    });
    expect(mezzo.status).toBe(201);
    expect(mezzo.body).toMatchObject({ stato: "non_disponibile", statoApprovazione: "in_attesa", versione: 1 });
    scope.mezzoIds.push(mezzo.body.id);
  });

  it("forza il workflow pending anche su BULK e quick-create", async () => {
    const bulkMatricola = `BLK-${Date.now()}`;
    const bulkVolontario = await request(app(volontariRouter)).post("/volontari/bulk").send({ righe: [{
      nome: "Bulk",
      cognome: "Volontario",
      matricola: bulkMatricola,
      ruoloVolontarioId,
      attivo: true,
      statoApprovazione: "approvato",
    }] });
    expect(bulkVolontario.status).toBe(200);
    const [volontario] = await db.select().from(volontariTable).where(eq(volontariTable.matricola, bulkMatricola));
    expect(volontario).toMatchObject({ attivo: false, statoApprovazione: "in_attesa" });
    scope.volontarioIds.push(volontario.id);

    const bulkCodice = `BM-${Date.now()}`;
    const bulkMezzo = await request(app(mezziRouter)).post("/mezzi/bulk").send({ righe: [{
      codice: bulkCodice,
      tipo: "auto",
      proprieta: "associazione",
      stato: "disponibile",
      statoApprovazione: "approvato",
    }] });
    expect(bulkMezzo.status).toBe(200);
    const [mezzo] = await db.select().from(mezziTable).where(eq(mezziTable.codice, bulkCodice));
    expect(mezzo).toMatchObject({ stato: "non_disponibile", statoApprovazione: "in_attesa" });
    scope.mezzoIds.push(mezzo.id);

    const centro = await createCentroRec(scope);
    const quickVolontario = await request(app(turniRouter)).post("/turni/volontari-pending").send({
      centroAscoltoId: centro.id,
      nome: "Quick",
      cognome: "Volontario",
      matricola: `Q-${Date.now()}`,
      ruoloVolontarioId,
    });
    expect(quickVolontario.status).toBe(201);
    expect(quickVolontario.body).toMatchObject({ attivo: false, statoApprovazione: "in_attesa" });
    scope.volontarioIds.push(quickVolontario.body.id);
    const quickMezzo = await request(app(turniRouter)).post("/turni/mezzi-pending").send({
      centroAscoltoId: centro.id,
      codice: `QM-${Date.now()}`,
      tipo: "auto",
    });
    expect(quickMezzo.status).toBe(201);
    expect(quickMezzo.body).toMatchObject({ stato: "non_disponibile", statoApprovazione: "in_attesa" });
    scope.mezzoIds.push(quickMezzo.body.id);
  });

  it("accetta solo ruoli catalogati attivi e preserva la normalizzazione", async () => {
    const ruoloInattivo = await createRuoloVolontario(scope, { attivo: false });
    const rejected = await request(app(volontariRouter)).post("/volontari").send({
      nome: "Ruolo",
      cognome: "Inattivo",
      matricola: `ROLE-${Date.now()}`,
      ruoloVolontarioId: ruoloInattivo,
      ruolo: "testo arbitrario",
    });
    expect(rejected.status).toBe(400);
    const created = await request(app(volontariRouter)).post("/volontari").send({
      nome: "Ruolo",
      cognome: "Attivo",
      matricola: `  norm-${Date.now()}  `,
      ruoloVolontarioId,
      ruolo: "testo arbitrario",
    });
    expect(created.status).toBe(201);
    expect(created.body.matricola).toMatch(/^norm-/);
    expect(created.body.matricola).not.toMatch(/^\s|\s$/);
    expect(created.body.ruoloVolontarioId).toBe(ruoloVolontarioId);
    expect(created.body.ruolo).not.toBe("testo arbitrario");
    scope.volontarioIds.push(created.body.id);
  });

  it("impedisce a un caller Area-scoped di creare risorse globali NULL", async () => {
    const area = await createAreaOperativa(scope);
    const areaUser = { id: 0, centroAscoltoId: null, areaOperativaId: area };
    const volontario = await request(app(volontariRouter, areaUser)).post("/volontari").send({
      nome: "Area",
      cognome: "Senza centro",
      matricola: `AREA-${Date.now()}`,
      ruoloVolontarioId,
    });
    expect(volontario.status).toBe(400);
    const mezzo = await request(app(mezziRouter, areaUser)).post("/mezzi").send({
      codice: `AREA-M-${Date.now()}`,
      tipo: "auto",
      proprieta: "associazione",
    });
    expect(mezzo.status).toBe(400);
  });

  it("approva solo da in_attesa con versione CAS", async () => {
    const created = await request(app(volontariRouter)).post("/volontari").send({
      nome: "Da",
      cognome: "Approvare",
      matricola: `APP-${Date.now()}`,
      ruoloVolontarioId,
    });
    scope.volontarioIds.push(created.body.id);
    const stale = await request(app(approvazioniRouter))
      .post(`/approvazioni-logistica/volontari/${created.body.id}/approva`)
      .send({ versione: 99 });
    expect(stale.status).toBe(409);
    const approved = await request(app(approvazioniRouter))
      .post(`/approvazioni-logistica/volontari/${created.body.id}/approva`)
      .send({ versione: created.body.versione });
    expect(approved.status).toBe(200);
    const repeated = await request(app(approvazioniRouter))
      .post(`/approvazioni-logistica/volontari/${created.body.id}/approva`)
      .send({ versione: approved.body.versione });
    expect(repeated.status).toBe(409);

    const daRespingere = await request(app(volontariRouter)).post("/volontari").send({
      nome: "Da",
      cognome: "Respingere",
      matricola: `REJ-${Date.now()}`,
      ruoloVolontarioId,
    });
    scope.volontarioIds.push(daRespingere.body.id);
    const respinto = await request(app(approvazioniRouter))
      .post(`/approvazioni-logistica/volontari/${daRespingere.body.id}/respingi`)
      .send({ versione: daRespingere.body.versione });
    expect(respinto.status).toBe(200);
    expect((await request(app(approvazioniRouter))
      .post(`/approvazioni-logistica/volontari/${daRespingere.body.id}/approva`)
      .send({ versione: respinto.body.versione })).status).toBe(409);
  });

  it("blocca pending e doppia assegnazione volontario, ma separa le fasce", async () => {
    const area = await createAreaOperativa(scope);
    const centroA = await createCentroRec(scope, { areaOperativaId: area });
    const centroB = await createCentroRec(scope, { areaOperativaId: area });
    const pending = await request(app(volontariRouter)).post("/volontari").send({
      nome: "Pending",
      cognome: "Turno",
      matricola: `TURN-P-${Date.now()}`,
      ruoloVolontarioId,
      centroAscoltoId: centroA.id,
    });
    scope.volontarioIds.push(pending.body.id);
    const pendingResult = await request(app(turniRouter)).put("/turni").send({
      centroAscoltoId: centroA.id,
      data: "2026-09-01",
      fascia: "09-13",
      volontari: [{ volontarioId: pending.body.id }],
    });
    expect(pendingResult.status).toBe(403);
    expect((await request(app(turniRouter)).put("/turni").send({ centroAscoltoId: centroA.id, data: "2026-09-01", fascia: "Mattina", volontari: [] })).status).toBe(400);

    const volontario = await createVolontario(scope, null);
    const first = await request(app(turniRouter)).put("/turni").send({
      centroAscoltoId: centroA.id,
      data: "2026-09-02",
      fascia: "09-13",
      volontari: [{ volontarioId: volontario }, { volontarioId: volontario }],
    });
    expect(first.status).toBe(200);
    expect(first.body.volontari).toHaveLength(1);
    scope.turnoIds.push(first.body.id);
    const conflict = await request(app(turniRouter)).put("/turni").send({
      centroAscoltoId: centroB.id,
      data: "2026-09-02",
      fascia: "09-13",
      volontari: [{ volontarioId: volontario }],
    });
    expect(conflict.status).toBe(409);
    const otherFascia = await request(app(turniRouter)).put("/turni").send({
      centroAscoltoId: centroB.id,
      data: "2026-09-02",
      fascia: "14-18",
      volontari: [{ volontarioId: volontario }],
    });
    expect(otherFascia.status).toBe(200);
    scope.turnoIds.push(otherFascia.body.id);
  });

  it("serializza due richieste reali sullo stesso volontario e slot", async () => {
    const area = await createAreaOperativa(scope);
    const centroA = await createCentroRec(scope, { areaOperativaId: area });
    const centroB = await createCentroRec(scope, { areaOperativaId: area });
    const volontario = await createVolontario(scope, null);
    const payload = (centroAscoltoId: number) => ({ centroAscoltoId, data: "2026-09-03", fascia: "18-20", volontari: [{ volontarioId: volontario }] });
    const responses = await Promise.all([
      request(app(turniRouter)).put("/turni").send(payload(centroA.id)),
      request(app(turniRouter)).put("/turni").send(payload(centroB.id)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    for (const response of responses) if (response.status === 200) scope.turnoIds.push(response.body.id);
  });

  it("serializza due richieste reali sullo stesso mezzo e slot", async () => {
    const area = await createAreaOperativa(scope);
    const centroA = await createCentroRec(scope, { areaOperativaId: area });
    const centroB = await createCentroRec(scope, { areaOperativaId: area });
    const mezzo = await createMezzo(scope, { centroId: null });
    const volontarioA = await createVolontario(scope, null);
    const volontarioB = await createVolontario(scope, null);
    const responses = await Promise.all([
      request(app(turniRouter)).put("/turni").send({ centroAscoltoId: centroA.id, data: "2026-09-10", fascia: "14-18", mezzoId: mezzo, volontari: [{ volontarioId: volontarioA }] }),
      request(app(turniRouter)).put("/turni").send({ centroAscoltoId: centroB.id, data: "2026-09-10", fascia: "14-18", mezzoId: mezzo, volontari: [{ volontarioId: volontarioB }] }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    for (const response of responses) if (response.status === 200) scope.turnoIds.push(response.body.id);
  });

  it("non perde gli assegnatari esistenti quando un update del turno fallisce", async () => {
    const centro = await createCentroRec(scope);
    const assegnato = await createVolontario(scope, centro.id);
    const nonAttivo = await createVolontario(scope, centro.id);
    await db.update(volontariTable).set({ attivo: false }).where(eq(volontariTable.id, nonAttivo));
    const created = await request(app(turniRouter)).put("/turni").send({
      centroAscoltoId: centro.id,
      data: "2026-09-04",
      fascia: "09-13",
      volontari: [{ volontarioId: assegnato }],
    });
    expect(created.status).toBe(200);
    scope.turnoIds.push(created.body.id);
    const failed = await request(app(turniRouter)).put("/turni").send({
      centroAscoltoId: centro.id,
      data: "2026-09-04",
      fascia: "09-13",
      versione: created.body.versione,
      volontari: [{ volontarioId: assegnato }, { volontarioId: nonAttivo }],
    });
    expect(failed.status).toBe(403);
    const links = await db.select().from(turniVolontariTable).where(eq(turniVolontariTable.turnoId, created.body.id));
    expect(links.map((link) => link.volontarioId)).toEqual([assegnato]);
  });

  it("usa centro effettivo del proprietario e blocca scadenze sulla data operativa", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const centroA = await createCentroRec(scope, { areaOperativaId: areaA });
    const centroB = await createCentroRec(scope, { areaOperativaId: areaB });
    const proprietarioB = await createVolontario(scope, centroB.id);
    const [mezzoPersonale] = await db.insert(mezziTable).values({
      codice: `PV-${Date.now()}`,
      tipo: "auto",
      proprieta: "volontario",
      volontarioId: proprietarioB,
      centroAscoltoId: null,
      stato: "non_disponibile",
      statoApprovazione: "in_attesa",
    }).returning();
    scope.mezzoIds.push(mezzoPersonale.id);
    const denied = await request(app(approvazioniRouter, { id: 0, centroAscoltoId: null, areaOperativaId: areaA }))
      .post(`/approvazioni-logistica/mezzi/${mezzoPersonale.id}/approva`)
      .send({ versione: mezzoPersonale.versione });
    expect(denied.status).toBe(403);
    const approved = await request(app(approvazioniRouter, { id: 0, centroAscoltoId: null, areaOperativaId: areaB }))
      .post(`/approvazioni-logistica/mezzi/${mezzoPersonale.id}/approva`)
      .send({ versione: mezzoPersonale.versione });
    expect(approved.status).toBe(200);

    const volontarioA = await createVolontario(scope, centroA.id);
    const expired = await createMezzo(scope, { centroId: centroA.id });
    await db.update(mezziTable).set({ scadenzaRevisione: "2026-08-31" }).where(eq(mezziTable.id, expired));
    const expiredResult = await request(app(turniRouter)).put("/turni").send({
      centroAscoltoId: centroA.id,
      data: "2026-09-01",
      fascia: "09-13",
      mezzoId: expired,
      volontari: [{ volontarioId: volontarioA }],
    });
    expect(expiredResult.status).toBe(403);
    const valid = await createMezzo(scope, { centroId: centroA.id });
    const validResult = await request(app(turniRouter)).put("/turni").send({
      centroAscoltoId: centroA.id,
      data: "2026-09-01",
      fascia: "09-13",
      mezzoId: valid,
      volontari: [{ volontarioId: volontarioA }],
    });
    expect(validResult.status).toBe(200);
    scope.turnoIds.push(validResult.body.id);

    const crossOwner = await request(app(mezziRouter, { id: 0, centroAscoltoId: null, areaOperativaId: areaA }))
      .patch(`/mezzi/${mezzoPersonale.id}`)
      .send({ versione: approved.body.versione, volontarioId: volontarioA });
    expect(crossOwner.status).toBe(403);
  });

  it("rifiuta risorse respinte, inattive, pending o non disponibili e valida i mezzi", async () => {
    const centro = await createCentroRec(scope);
    const volontario = await createVolontario(scope, centro.id);
    const mezzo = await createMezzo(scope, { centroId: centro.id });
    const tentativo = (data: string, input: { volontarioId?: number; mezzoId?: number }) =>
      request(app(turniRouter)).put("/turni").send({
        centroAscoltoId: centro.id,
        data,
        fascia: "09-13",
        volontari: input.volontarioId ? [{ volontarioId: input.volontarioId }] : [],
        mezzoId: input.mezzoId ?? null,
      });

    await db.update(volontariTable).set({ attivo: false }).where(eq(volontariTable.id, volontario));
    expect((await tentativo("2026-09-11", { volontarioId: volontario })).status).toBe(403);
    await db.update(volontariTable).set({ attivo: true, statoApprovazione: "respinto" }).where(eq(volontariTable.id, volontario));
    expect((await tentativo("2026-09-12", { volontarioId: volontario })).status).toBe(403);
    await db.update(volontariTable).set({ statoApprovazione: "approvato" }).where(eq(volontariTable.id, volontario));

    await db.update(mezziTable).set({ statoApprovazione: "in_attesa" }).where(eq(mezziTable.id, mezzo));
    expect((await tentativo("2026-09-13", { mezzoId: mezzo })).status).toBe(403);
    await db.update(mezziTable).set({ statoApprovazione: "approvato", stato: "manutenzione" }).where(eq(mezziTable.id, mezzo));
    expect((await tentativo("2026-09-14", { mezzoId: mezzo })).status).toBe(403);
    await db.update(mezziTable).set({ stato: "disponibile", scadenzaAssicurazione: "2026-09-14", scadenzaRevisione: null }).where(eq(mezziTable.id, mezzo));
    expect((await tentativo("2026-09-15", { mezzoId: mezzo })).status).toBe(403);
    await db.update(mezziTable).set({ scadenzaAssicurazione: null }).where(eq(mezziTable.id, mezzo));
    const valid = await tentativo("2026-09-16", { mezzoId: mezzo });
    expect(valid.status).toBe(200);
    scope.turnoIds.push(valid.body.id);

    expect((await request(app(mezziRouter)).post("/mezzi").send({ codice: `NEG-${Date.now()}`, tipo: "auto", proprieta: "associazione", capacitaColli: -1 })).status).toBe(400);
    expect((await request(app(mezziRouter)).patch(`/mezzi/${mezzo}`).send({ versione: 1, stato: "arbitrario" })).status).toBe(400);
    const normalized = await request(app(mezziRouter)).patch(`/mezzi/${mezzo}`).send({ versione: 1, targa: "  ab  123 cd  " });
    expect(normalized.status).toBe(200);
    expect(normalized.body.targa).toBe("AB 123 CD");
    const [existingMezzo] = await db.select({ codice: mezziTable.codice }).from(mezziTable).where(eq(mezziTable.id, mezzo));
    expect((await request(app(mezziRouter)).post("/mezzi").send({ codice: existingMezzo.codice, tipo: "auto", proprieta: "associazione" })).status).toBe(409);
  });

  it("protegge la pianificazione Consegne cross-Area e le assegnazioni non operative", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const centroA = await createCentroRec(scope, { areaOperativaId: areaA });
    const centroB = await createCentroRec(scope, { areaOperativaId: areaB });
    const beneficiarioA = await createBeneficiario(scope, centroA.id, { areaOperativaId: areaA });
    const magazzinoA = await createMagazzino(scope, centroA.id, { areaOperativaId: areaA });
    const volontarioB = await createVolontario(scope, centroB.id);
    const mezzoB = await createMezzo(scope, { centroId: centroB.id });
    const payload = { beneficiarioId: beneficiarioA, tipoConsegna: "domicilio", dataPrevista: "2026-09-17", fasciaOraria: "Mattina", magazzinoId: magazzinoA };
    const scopedA = { id: 0, centroAscoltoId: null, areaOperativaId: areaA };
    expect((await request(app(consegneRouter, scopedA)).post("/consegne").send({ ...payload, volontarioId: volontarioB })).status).toBe(403);
    expect((await request(app(consegneRouter, scopedA)).post("/consegne").send({ ...payload, mezzoId: mezzoB })).status).toBe(403);

    const pending = await request(app(volontariRouter)).post("/volontari").send({ nome: "Pending", cognome: "Consegna", matricola: `PC-${Date.now()}`, ruoloVolontarioId, centroAscoltoId: centroA.id });
    scope.volontarioIds.push(pending.body.id);
    expect((await request(app(consegneRouter, scopedA)).post("/consegne").send({ ...payload, volontarioId: pending.body.id })).status).toBe(403);
    const pendingMezzo = await request(app(mezziRouter)).post("/mezzi").send({ codice: `PCM-${Date.now()}`, tipo: "auto", proprieta: "associazione", centroAscoltoId: centroA.id });
    scope.mezzoIds.push(pendingMezzo.body.id);
    expect((await request(app(consegneRouter, scopedA)).post("/consegne").send({ ...payload, mezzoId: pendingMezzo.body.id })).status).toBe(403);
  });

  it("preserva il turno annullato, libera il mezzo e registra audit/versione", async () => {
    const centro = await createCentroRec(scope);
    const volontario = await createVolontario(scope, centro.id);
    const mezzo = await createMezzo(scope, { centroId: centro.id });
    const created = await request(app(turniRouter)).put("/turni").send({
      centroAscoltoId: centro.id,
      data: "2026-09-05",
      fascia: "09-13",
      mezzoId: mezzo,
      volontari: [{ volontarioId: volontario }],
    });
    scope.turnoIds.push(created.body.id);
    const cancelled = await request(app(turniRouter))
      .patch(`/turni/${created.body.id}/stato`)
      .send({ stato: "annullato", versione: created.body.versione, motivoAnnullamento: "Test operativo" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ id: created.body.id, stato: "annullato", mezzoId: null, versione: created.body.versione + 1 });
    const stale = await request(app(turniRouter))
      .patch(`/turni/${created.body.id}/stato`)
      .send({ stato: "confermato", versione: created.body.versione });
    expect(stale.status).toBe(409);
    const audit = await db.select().from(auditConfigurazioniTable).where(eq(auditConfigurazioniTable.chiave, `turno:${created.body.id}`));
    expect(audit.some((entry) => entry.azione === "annullato")).toBe(true);
  });

  it("rende atomico il limite consegne per data+fascia e il sync turno", async () => {
    const centro = await createCentroRec(scope);
    const beneficiario = await createBeneficiario(scope, centro.id);
    const magazzino = await createMagazzino(scope, centro.id);
    const volontario = await createVolontario(scope, centro.id);
    await db.update(volontariTable).set({ maxConsegneTurno: 1 }).where(eq(volontariTable.id, volontario));
    const payload = (fasciaOraria: "Mattina" | "Pomeriggio") => ({
      beneficiarioId: beneficiario,
      tipoConsegna: "domicilio",
      dataPrevista: "2026-09-06",
      fasciaOraria,
      magazzinoId: magazzino,
      volontarioId: volontario,
    });
    const concurrent = await Promise.all([
      request(app(consegneRouter)).post("/consegne").send(payload("Mattina")),
      request(app(consegneRouter)).post("/consegne").send(payload("Mattina")),
    ]);
    const statuses = concurrent.map((response) => response.status).sort();
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]);
    for (const response of concurrent) if (response.status === 201) scope.consegnaIds.push(response.body.id);
    const otherFascia = await request(app(consegneRouter)).post("/consegne").send(payload("Pomeriggio"));
    expect(otherFascia.status).toBe(201);
    scope.consegnaIds.push(otherFascia.body.id);
    const turni = await db.select({ id: turniTable.id }).from(turniTable).where(eq(turniTable.centroAscoltoId, centro.id));
    scope.turnoIds.push(...turni.map((turno) => turno.id));
    const counts = await db.select().from(consegneTable).where(and(eq(consegneTable.volontarioId, volontario), eq(consegneTable.dataPrevista, "2026-09-06")));
    expect(counts).toHaveLength(2);
  });

  it("fa rollback della consegna se il turno collegato è completato", async () => {
    const centro = await createCentroRec(scope);
    const beneficiario = await createBeneficiario(scope, centro.id);
    const magazzino = await createMagazzino(scope, centro.id);
    const volontario = await createVolontario(scope, centro.id);
    const [completed] = await db.insert(turniTable).values({ centroAscoltoId: centro.id, data: "2026-09-07", fascia: "09-13", stato: "completato" }).returning();
    scope.turnoIds.push(completed.id);
    const before = await db.select().from(consegneTable).where(eq(consegneTable.beneficiarioId, beneficiario));
    const response = await request(app(consegneRouter)).post("/consegne").send({
      beneficiarioId: beneficiario,
      tipoConsegna: "domicilio",
      dataPrevista: "2026-09-07",
      fasciaOraria: "Mattina",
      magazzinoId: magazzino,
      volontarioId: volontario,
    });
    expect(response.status).toBe(409);
    const after = await db.select().from(consegneTable).where(eq(consegneTable.beneficiarioId, beneficiario));
    expect(after).toHaveLength(before.length);
    const linked = await db.select().from(turniVolontariTable).where(eq(turniVolontariTable.turnoId, completed.id));
    expect(linked).toHaveLength(0);
  });
});
