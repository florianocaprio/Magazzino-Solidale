/* @vitest-environment node */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { auditConfigurazioniTable, consegneTable, db, mezziTable, pool, turniConsegneTable, turniTable, turniVolontariTable, volontariTable } from "@workspace/db";
import approvazioniRouter from "../src/routes/approvazioni-logistica";
import consegneRouter from "../src/routes/consegne";
import mezziRouter from "../src/routes/mezzi";
import reportRouter from "../src/routes/report";
import turniRouter from "../src/routes/turni";
import volontariRouter from "../src/routes/volontari";
import { cleanup, createAreaOperativa, createBeneficiario, createCentroRec, createMagazzino, createMezzo, createRuoloVolontario, createVolontario, makeScopedApp, newScope, type SeedScope } from "./scope-helpers";

let scope: SeedScope;
beforeEach(async () => { scope = newScope(); await createRuoloVolontario(scope); });
afterEach(async () => { await db.delete(auditConfigurazioniTable).where(eq(auditConfigurazioniTable.area, "logistica")); await cleanup(scope); });
afterAll(async () => { await pool.end(); });
const app = (router: Parameters<typeof makeScopedApp>[0]) => makeScopedApp(router, { id: 0, centroAscoltoId: null, areaOperativaId: null });
const areaApp = (router: Parameters<typeof makeScopedApp>[0], areaOperativaId: number) => makeScopedApp(router, { id: 0, centroAscoltoId: null, areaOperativaId });
const start = <T>(requestPromise: PromiseLike<T>): Promise<T> => Promise.resolve(requestPromise);
const letRequestReachLock = () => new Promise((resolve) => setTimeout(resolve, 50));

async function fixture() {
  const centro = await createCentroRec(scope);
  const beneficiario = await createBeneficiario(scope, centro.id);
  const magazzino = await createMagazzino(scope, centro.id);
  const volontarioA = await createVolontario(scope, centro.id);
  const volontarioB = await createVolontario(scope, centro.id);
  const mezzoA = await createMezzo(scope, { centroId: centro.id });
  const mezzoB = await createMezzo(scope, { centroId: centro.id });
  return { centro, beneficiario, magazzino, volontarioA, volontarioB, mezzoA, mezzoB };
}

describe("riconciliazione residui Logistica", () => {
  it("sposta atomicamente data/fascia/risorse e libera il vecchio turno", async () => {
    const f = await fixture();
    const created = await request(app(consegneRouter)).post("/consegne").send({ beneficiarioId: f.beneficiario, tipoConsegna: "domicilio", dataPrevista: "2026-10-01", fasciaOraria: "Mattina", magazzinoId: f.magazzino, volontarioId: f.volontarioA, mezzoId: f.mezzoA });
    expect(created.status).toBe(201); scope.consegnaIds.push(created.body.id);
    const [oldSource] = await db.select().from(turniConsegneTable).where(eq(turniConsegneTable.consegnaId, created.body.id));
    scope.turnoIds.push(oldSource.turnoId);
    const moved = await request(app(consegneRouter)).patch(`/consegne/${created.body.id}`).send({ dataPrevista: "2026-10-02", fasciaOraria: "Pomeriggio", volontarioId: f.volontarioB, mezzoId: f.mezzoB });
    expect(moved.status).toBe(200);
    const [source] = await db.select().from(turniConsegneTable).where(eq(turniConsegneTable.consegnaId, created.body.id));
    expect(source).toMatchObject({ volontarioId: f.volontarioB, mezzoId: f.mezzoB }); scope.turnoIds.push(source.turnoId);
    expect((await db.select().from(turniTable).where(eq(turniTable.id, oldSource.turnoId)))[0]).toMatchObject({ stato: "annullato", mezzoId: null });
    expect(await db.select().from(turniVolontariTable).where(eq(turniVolontariTable.turnoId, oldSource.turnoId))).toHaveLength(0);
    expect((await request(app(consegneRouter)).patch(`/consegne/${created.body.id}`).send({ volontarioId: null, mezzoId: null })).status).toBe(200);
    expect(await db.select().from(turniConsegneTable).where(eq(turniConsegneTable.consegnaId, created.body.id))).toHaveLength(0);
    expect((await db.select().from(turniTable).where(eq(turniTable.id, source.turnoId)))[0].stato).toBe("annullato");
  });

  it("riconcilia singolarmente volontario, mezzo, fascia e data senza occupazioni fantasma", async () => {
    const f = await fixture();
    const created = await request(app(consegneRouter)).post("/consegne").send({ beneficiarioId: f.beneficiario, tipoConsegna: "domicilio", dataPrevista: "2026-11-01", fasciaOraria: "Mattina", magazzinoId: f.magazzino, volontarioId: f.volontarioA, mezzoId: f.mezzoA });
    expect(created.status).toBe(201); scope.consegnaIds.push(created.body.id);

    expect((await request(app(consegneRouter)).patch(`/consegne/${created.body.id}`).send({ volontarioId: f.volontarioB })).status).toBe(200);
    let [source] = await db.select().from(turniConsegneTable).where(eq(turniConsegneTable.consegnaId, created.body.id));
    scope.turnoIds.push(source.turnoId);
    expect(source.volontarioId).toBe(f.volontarioB);
    expect((await db.select().from(turniVolontariTable).where(eq(turniVolontariTable.turnoId, source.turnoId))).map((row) => row.volontarioId)).toEqual([f.volontarioB]);

    expect((await request(app(consegneRouter)).patch(`/consegne/${created.body.id}`).send({ mezzoId: f.mezzoB })).status).toBe(200);
    [source] = await db.select().from(turniConsegneTable).where(eq(turniConsegneTable.consegnaId, created.body.id));
    expect((await db.select().from(turniTable).where(eq(turniTable.id, source.turnoId)))[0].mezzoId).toBe(f.mezzoB);

    const beforeSlot = source.turnoId;
    expect((await request(app(consegneRouter)).patch(`/consegne/${created.body.id}`).send({ fasciaOraria: "Sera" })).status).toBe(200);
    [source] = await db.select().from(turniConsegneTable).where(eq(turniConsegneTable.consegnaId, created.body.id));
    scope.turnoIds.push(source.turnoId);
    expect((await db.select().from(turniTable).where(eq(turniTable.id, source.turnoId)))[0].fascia).toBe("18-20");
    expect((await db.select().from(turniTable).where(eq(turniTable.id, beforeSlot)))[0]).toMatchObject({ stato: "annullato", mezzoId: null });

    const beforeDate = source.turnoId;
    expect((await request(app(consegneRouter)).patch(`/consegne/${created.body.id}`).send({ dataPrevista: "2026-11-02" })).status).toBe(200);
    [source] = await db.select().from(turniConsegneTable).where(eq(turniConsegneTable.consegnaId, created.body.id));
    scope.turnoIds.push(source.turnoId);
    expect((await db.select().from(turniTable).where(eq(turniTable.id, source.turnoId)))[0]).toMatchObject({ data: "2026-11-02", fascia: "18-20", mezzoId: f.mezzoB });
    expect((await db.select().from(turniTable).where(eq(turniTable.id, beforeDate)))[0].stato).toBe("annullato");

    const report = await request(app(reportRouter)).get("/report/allocazione-mezzi?da=2026-11-01&a=2026-11-02");
    expect(report.status).toBe(200);
    const old = report.body.mezzi.find((row: { mezzoId: number }) => row.mezzoId === f.mezzoA);
    expect(old).toMatchObject({ consegne: 0, turni: 0 });
  });

  it("mantiene fonti condivise e preserva assegnazioni manuali/legacy", async () => {
    const f = await fixture();
    const manual = await request(app(turniRouter)).put("/turni").send({ centroAscoltoId: f.centro.id, data: "2026-10-03", fascia: "09-13", volontari: [{ volontarioId: f.volontarioA }], mezzoId: f.mezzoA });
    expect(manual.status).toBe(200); scope.turnoIds.push(manual.body.id);
    const payload = { beneficiarioId: f.beneficiario, tipoConsegna: "domicilio", dataPrevista: "2026-10-03", fasciaOraria: "Mattina", magazzinoId: f.magazzino, volontarioId: f.volontarioA, mezzoId: f.mezzoA };
    const one = await request(app(consegneRouter)).post("/consegne").send(payload);
    const two = await request(app(consegneRouter)).post("/consegne").send(payload);
    expect([one.status, two.status]).toEqual([201, 201]); scope.consegnaIds.push(one.body.id, two.body.id);
    expect(await db.select().from(turniConsegneTable).where(inArray(turniConsegneTable.consegnaId, [one.body.id, two.body.id]))).toHaveLength(2);
    expect((await request(app(consegneRouter)).delete(`/consegne/${one.body.id}`)).status).toBe(204);
    expect((await request(app(consegneRouter)).delete(`/consegne/${two.body.id}`)).status).toBe(204);
    const [turno] = await db.select().from(turniTable).where(eq(turniTable.id, manual.body.id));
    const [link] = await db.select().from(turniVolontariTable).where(eq(turniVolontariTable.turnoId, manual.body.id));
    expect(turno).toMatchObject({ stato: "pianificato", mezzoId: f.mezzoA, mezzoManuale: true });
    expect(link).toMatchObject({ volontarioId: f.volontarioA, manuale: true });
  });

  it("preserva il legacy senza provenance, registra audit e fa rollback integrale su PATCH non valida", async () => {
    const f = await fixture();
    const [legacy] = await db.insert(turniTable).values({ centroAscoltoId: f.centro.id, data: "2026-11-03", fascia: "09-13", mezzoId: f.mezzoA }).returning();
    scope.turnoIds.push(legacy.id);
    await db.insert(turniVolontariTable).values({ turnoId: legacy.id, volontarioId: f.volontarioA, ruolo: "Legacy" });
    const created = await request(app(consegneRouter)).post("/consegne").send({ beneficiarioId: f.beneficiario, tipoConsegna: "domicilio", dataPrevista: "2026-11-03", fasciaOraria: "Mattina", magazzinoId: f.magazzino, volontarioId: f.volontarioA, mezzoId: f.mezzoA });
    expect(created.status).toBe(201); scope.consegnaIds.push(created.body.id);
    expect((await request(app(consegneRouter)).delete(`/consegne/${created.body.id}`)).status).toBe(204);
    expect((await db.select().from(turniVolontariTable).where(eq(turniVolontariTable.turnoId, legacy.id)))[0]).toMatchObject({ volontarioId: f.volontarioA, manuale: true });
    expect((await db.select().from(turniTable).where(eq(turniTable.id, legacy.id)))[0]).toMatchObject({ stato: "pianificato", mezzoId: f.mezzoA, mezzoManuale: true });

    const rollback = await request(app(consegneRouter)).post("/consegne").send({ beneficiarioId: f.beneficiario, tipoConsegna: "domicilio", dataPrevista: "2026-11-04", fasciaOraria: "Mattina", magazzinoId: f.magazzino, volontarioId: f.volontarioB, mezzoId: f.mezzoB });
    expect(rollback.status).toBe(201); scope.consegnaIds.push(rollback.body.id);
    const [oldSource] = await db.select().from(turniConsegneTable).where(eq(turniConsegneTable.consegnaId, rollback.body.id));
    scope.turnoIds.push(oldSource.turnoId);
    const [completed] = await db.insert(turniTable).values({ centroAscoltoId: f.centro.id, data: "2026-11-05", fascia: "14-18", stato: "completato" }).returning();
    scope.turnoIds.push(completed.id);
    const failed = await request(app(consegneRouter)).patch(`/consegne/${rollback.body.id}`).send({ dataPrevista: "2026-11-05", fasciaOraria: "Pomeriggio" });
    expect(failed.status).toBe(409);
    expect((await db.select().from(consegneTable).where(eq(consegneTable.id, rollback.body.id)))[0]).toMatchObject({ dataPrevista: "2026-11-04", fasciaOraria: "Mattina" });
    expect((await db.select().from(turniConsegneTable).where(eq(turniConsegneTable.consegnaId, rollback.body.id)))[0].turnoId).toBe(oldSource.turnoId);
    const audit = await db.select().from(auditConfigurazioniTable).where(eq(auditConfigurazioniTable.chiave, `turno:${oldSource.turnoId}`));
    expect(audit.some((entry) => entry.azione.includes("consegna"))).toBe(true);
  });

  it("serializza il cambio Area del proprietario contro approvazione e assegnazione", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const centroA = await createCentroRec(scope, { areaOperativaId: areaA });
    const centroB = await createCentroRec(scope, { areaOperativaId: areaB });
    const ownerApproval = await createVolontario(scope, centroA.id);
    const [pendingMezzo] = await db.insert(mezziTable).values({ codice: `R3-APP-${Date.now()}`, tipo: "auto", proprieta: "volontario", volontarioId: ownerApproval, stato: "non_disponibile", statoApprovazione: "in_attesa" }).returning();
    scope.mezzoIds.push(pendingMezzo.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE volontari SET centro_ascolto_id = $1 WHERE id = $2", [centroB.id, ownerApproval]);
      const approval = start(request(areaApp(approvazioniRouter, areaA)).post(`/approvazioni-logistica/mezzi/${pendingMezzo.id}/approva`).send({ versione: pendingMezzo.versione }));
      await letRequestReachLock();
      await client.query("COMMIT");
      expect((await approval).status).toBe(403);
    } finally {
      client.release();
    }

    const ownerAssignment = await createVolontario(scope, centroA.id);
    const mezzo = await createMezzo(scope, { volontarioId: ownerAssignment });
    const clientAssignment = await pool.connect();
    try {
      await clientAssignment.query("BEGIN");
      await clientAssignment.query("UPDATE volontari SET centro_ascolto_id = $1 WHERE id = $2", [centroB.id, ownerAssignment]);
      const assignment = start(request(areaApp(turniRouter, areaA)).put("/turni").send({ centroAscoltoId: centroA.id, data: "2026-11-06", fascia: "09-13", mezzoId: mezzo, volontari: [] }));
      await letRequestReachLock();
      await clientAssignment.query("COMMIT");
      expect((await assignment).status).toBe(403);
    } finally {
      clientAssignment.release();
    }

    const beneficiary = await createBeneficiario(scope, centroA.id, { areaOperativaId: areaA });
    const magazzino = await createMagazzino(scope, centroA.id, { areaOperativaId: areaA });
    const ownerDelivery = await createVolontario(scope, centroA.id);
    const deliveryMezzo = await createMezzo(scope, { volontarioId: ownerDelivery });
    const clientDelivery = await pool.connect();
    try {
      await clientDelivery.query("BEGIN");
      await clientDelivery.query("UPDATE volontari SET centro_ascolto_id = $1 WHERE id = $2", [centroB.id, ownerDelivery]);
      const delivery = start(request(areaApp(consegneRouter, areaA)).post("/consegne").send({ beneficiarioId: beneficiary, tipoConsegna: "domicilio", dataPrevista: "2026-11-06", fasciaOraria: "Pomeriggio", magazzinoId: magazzino, mezzoId: deliveryMezzo }));
      await letRequestReachLock();
      await clientDelivery.query("COMMIT");
      expect((await delivery).status).toBe(403);
    } finally {
      clientDelivery.release();
    }

    const ownerCreation = await createVolontario(scope, centroA.id);
    const clientCreation = await pool.connect();
    try {
      await clientCreation.query("BEGIN");
      await clientCreation.query("UPDATE volontari SET centro_ascolto_id = $1 WHERE id = $2", [centroB.id, ownerCreation]);
      const creation = start(request(areaApp(mezziRouter, areaA)).post("/mezzi").send({ codice: `R3-CREATE-${Date.now()}`, tipo: "auto", proprieta: "volontario", volontarioId: ownerCreation }));
      await letRequestReachLock();
      await clientCreation.query("COMMIT");
      expect((await creation).status).toBe(403);
    } finally {
      clientCreation.release();
    }
  });

  it("disattiva e ritira sempre con lock, CAS, audit e record storico", async () => {
    const f = await fixture();
    expect((await request(app(volontariRouter)).delete(`/volontari/${f.volontarioA}`).send({ versione: 1 })).status).toBe(200);
    expect((await request(app(mezziRouter)).delete(`/mezzi/${f.mezzoA}`).send({ versione: 1 })).status).toBe(200);
    expect((await db.select().from(volontariTable).where(eq(volontariTable.id, f.volontarioA)))[0]).toMatchObject({ attivo: false, versione: 2 });
    expect((await db.select().from(mezziTable).where(eq(mezziTable.id, f.mezzoA)))[0]).toMatchObject({ stato: "ritirato", versione: 2 });
    expect((await request(app(volontariRouter)).delete(`/volontari/${f.volontarioA}`).send({ versione: 1 })).status).toBe(409);
    expect((await request(app(mezziRouter)).delete(`/mezzi/${f.mezzoA}`).send({ versione: 1 })).status).toBe(409);
    expect((await request(app(turniRouter)).put("/turni").send({ centroAscoltoId: f.centro.id, data: "2026-10-04", fascia: "09-13", volontari: [{ volontarioId: f.volontarioA }], mezzoId: f.mezzoA })).status).toBe(403);
    const audits = await db.select().from(auditConfigurazioniTable).where(eq(auditConfigurazioniTable.area, "logistica"));
    expect(audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ chiave: `volontario:${f.volontarioA}`, azione: "disattivazione" }),
      expect.objectContaining({ chiave: `mezzo:${f.mezzoA}`, azione: "ritiro" }),
    ]));
  });

  it("serializza ritiro/disattivazione contro nuove assegnazioni senza perdere riferimenti", async () => {
    const f = await fixture();
    const mezzoClient = await pool.connect();
    try {
      await mezzoClient.query("BEGIN");
      await mezzoClient.query("UPDATE mezzi SET stato = 'ritirato', versione = versione + 1 WHERE id = $1", [f.mezzoA]);
      const assignment = start(request(app(turniRouter)).put("/turni").send({ centroAscoltoId: f.centro.id, data: "2026-11-07", fascia: "09-13", mezzoId: f.mezzoA, volontari: [] }));
      await letRequestReachLock();
      await mezzoClient.query("COMMIT");
      expect((await assignment).status).toBe(403);
    } finally {
      mezzoClient.release();
    }

    const volontarioClient = await pool.connect();
    try {
      await volontarioClient.query("BEGIN");
      await volontarioClient.query("UPDATE volontari SET attivo = false, versione = versione + 1 WHERE id = $1", [f.volontarioA]);
      const assignment = start(request(app(turniRouter)).put("/turni").send({ centroAscoltoId: f.centro.id, data: "2026-11-08", fascia: "14-18", volontari: [{ volontarioId: f.volontarioA }] }));
      await letRequestReachLock();
      await volontarioClient.query("COMMIT");
      expect((await assignment).status).toBe(403);
    } finally {
      volontarioClient.release();
    }
    expect(await db.select().from(turniTable).where(inArray(turniTable.data, ["2026-11-07", "2026-11-08"]))).toHaveLength(0);
  });
});
