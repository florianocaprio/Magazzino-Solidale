/* @vitest-environment node */
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import {
  db,
  pool,
  bolleTable,
  lottiTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  richiesteMagazzinoTable,
  richiesteMagazzinoDocumentiTable,
  ruoliTable,
  utentiTable,
  auditEventiTable,
  interventiTable,
} from "@workspace/db";
import requests from "../src/routes/richieste-magazzino";
import transfers from "../src/routes/trasferimenti";
import { trasferimentiTable, trasferimentoRigheTable } from "@workspace/db";
import { insertTrasferimento } from "./scope-helpers";
import bolle from "../src/routes/bolle";
import {
  createAreaOperativa,
  createCentroRec,
  createBeneficiario,
  createMagazzino,
  createProdotto,
  createLotto,
  createUtente,
  insertBolla,
  insertBollaRiga,
  makeScopedApp,
  newScope,
} from "./scope-helpers";

const scope = newScope();
let area: number,
  centro: number,
  beneficiary: number,
  warehouse: number,
  actor: number;
let app: ReturnType<typeof makeScopedApp>;
const grants = [
  "richieste_magazzino.view",
  "richieste_magazzino.cancel",
  "richieste_magazzino.create",
  "richieste_magazzino.prepare",
  "bolle.manage",
  "bolle.view",
  "bolle.deliver",
  "magazzino.view",
  "beneficiari.view",
  "sociale.interventi.view",
  "magazzino.transfers.prepare",
  "magazzino.transfers.dispatch",
];

beforeAll(async () => {
  if (process.env.M5C2A_TEST_DISPOSABLE_DB !== "verified")
    throw Error("Requires disposable PostgreSQL");
  area = await createAreaOperativa(scope);
  centro = (await createCentroRec(scope, { areaOperativaId: area })).id;
  beneficiary = await createBeneficiario(scope, centro, {
    areaOperativaId: area,
  });
  warehouse = await createMagazzino(scope, centro, { areaOperativaId: area });
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `C2R1-${randomUUID()}`,
      aree: ["sociale", "magazzino"],
      permessi: grants,
    })
    .returning();
  actor = await createUtente(scope, { centroId: centro, ruoloId: role.id });
  await db
    .update(utentiTable)
    .set({ areaOperativaId: area })
    .where(eq(utentiTable.id, actor));
  const router = express.Router();
  router.use(requests, bolle, transfers);
  app = makeScopedApp(router, {
    id: actor,
    areaOperativaId: area,
    centroAscoltoId: centro,
    aree: ["sociale", "magazzino"],
    permessi: grants,
  });
});
afterAll(async () => {
  await pool.end();
});

async function fixture(document: "none" | "bozza" | "confermato" = "none") {
  const [intervento] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId: beneficiary,
      tipoIntervento: "C2R1",
      ambito: "sociale",
      stato: "da_pianificare",
      operatoreId: actor,
      areaOperativaIdSnapshot: area,
      centroAscoltoIdSnapshot: centro,
    })
    .returning();
  const [rm] = await db
    .insert(richiesteMagazzinoTable)
    .values({
      codice: `RM-R1-${randomUUID().slice(0, 8)}`,
      tipoDestinatario: "beneficiario",
      beneficiarioId: beneficiary,
      areaOperativaId: area,
      centroAscoltoId: centro,
      sorgente: "intervento_sociale",
      interventoId: intervento.id,
      destinatarioNomeSnapshot: "R1",
      areaNomeSnapshot: "Area R1",
      centroNomeSnapshot: "Centro R1",
      bisogno: "Bisogno R1",
      noteOperative: "Non sovrascrivere",
      stato: document === "none" ? "inviata" : "presa_in_carico",
      inviatoDa: actor,
      ...(document === "none"
        ? {}
        : {
            presoInCaricoDa: actor,
            presoInCaricoCodiceSnapshot: "R1",
            presoInCaricoAt: new Date(),
          }),
    })
    .returning();
  if (document === "none")
    return { rm, intervento, bollaId: null, lotId: null };
  const product = await createProdotto(scope, {
    unitaMisura: "pz",
    quantitaFrazionabile: false,
  });
  const lotId = await createLotto(scope, {
    prodottoId: product,
    magazzinoId: warehouse,
    quantita: 10,
    dataScadenza: "2098-01-01",
  });
  const bollaId = await insertBolla(scope, {
    beneficiarioId: beneficiary,
    magazzinoId: warehouse,
  });
  await insertBollaRiga(scope, {
    bollaId,
    prodottoId: product,
    lottoId: lotId,
    quantita: 3,
    unitaMisura: "pz",
  });
  await db.insert(richiesteMagazzinoDocumentiTable).values({
    richiestaId: rm.id,
    tipoDocumento: "bolla",
    bollaId,
    creatoDa: actor,
  });
  if (document === "confermato") {
    const confirmed = await request(app)
      .post(`/bolle/${bollaId}/conferma`)
      .send({ versione: 1, idempotencyKey: randomUUID() });
    expect(confirmed.status, confirmed.text).toBe(200);
  }
  return { rm, intervento, bollaId, lotId };
}
const command = () => ({
  versione: 1,
  idempotencyKey: randomUUID(),
  motivo: "Bisogno cessato",
  nota: "Nota annullamento",
});

async function cancellationActor(aree: string[], centroId = centro) {
  const permissions = [
    "richieste_magazzino.view",
    "richieste_magazzino.cancel",
  ];
  const [role] = await db
    .insert(ruoliTable)
    .values({ nome: `Cancel-${randomUUID()}`, aree, permessi: permissions })
    .returning();
  const id = await createUtente(scope, { centroId, ruoloId: role.id });
  await db
    .update(utentiTable)
    .set({ areaOperativaId: area })
    .where(eq(utentiTable.id, id));
  return {
    id,
    roleId: role.id,
    app: makeScopedApp(requests, {
      id,
      areaOperativaId: area,
      centroAscoltoId: centroId,
      aree,
      permessi: permissions,
    }),
  };
}

async function transferFixture() {
  const destination = await createMagazzino(scope, centro, {
    areaOperativaId: area,
  });
  const product = await createProdotto(scope, {
    unitaMisura: "pz",
    quantitaFrazionabile: false,
  });
  const lotId = await createLotto(scope, {
    prodottoId: product,
    magazzinoId: warehouse,
    quantita: 10,
    dataScadenza: "2098-01-01",
  });
  const [rm] = await db
    .insert(richiesteMagazzinoTable)
    .values({
      codice: `RM-TR-${randomUUID().slice(0, 8)}`,
      tipoDestinatario: "magazzino",
      magazzinoDestinatarioId: destination,
      areaOperativaId: area,
      sorgente: "operativa",
      destinatarioNomeSnapshot: "Destinazione",
      areaNomeSnapshot: "Area",
      bisogno: "R1 trasferimento",
      stato: "presa_in_carico",
      inviatoDa: actor,
      presoInCaricoDa: actor,
      presoInCaricoCodiceSnapshot: "R1",
      presoInCaricoAt: new Date(),
    })
    .returning();
  const id = await insertTrasferimento(scope, {
    origineId: warehouse,
    destinoId: destination,
  });
  await db.insert(trasferimentoRigheTable).values({
    trasferimentoId: id,
    prodottoId: product,
    lottoId: lotId,
    quantita: "3",
    unitaMisura: "pz",
  });
  await db.insert(richiesteMagazzinoDocumentiTable).values({
    richiestaId: rm.id,
    tipoDocumento: "trasferimento",
    trasferimentoId: id,
    creatoDa: actor,
  });
  const prepared = await request(app)
    .post(`/trasferimenti/${id}/prepara`)
    .send({ versione: 1, idempotencyKey: randomUUID() });
  expect(prepared.status, prepared.text).toBe(200);
  return { rm, id, lotId, versione: prepared.body.versione };
}

describe("M5C2-A-R1 annullamento orchestrato", () => {
  it.each(["sociale", "magazzino"])(
    "attore solo %s annulla Bolla pronta senza grant M4 cancel",
    async (areaRole) => {
      const f = await fixture("confermato");
      const caller = await cancellationActor([areaRole]);
      const body = command();
      const cancelled = await request(caller.app)
        .post(`/richieste-magazzino/${f.rm.id}/annulla`)
        .send(body);
      expect(cancelled.status, cancelled.text).toBe(200);
      await db
        .update(utentiTable)
        .set({ areaOperativaId: null, centroAscoltoId: null })
        .where(eq(utentiTable.id, caller.id));
      const replay = await request(caller.app)
        .post(`/richieste-magazzino/${f.rm.id}/annulla`)
        .send(body);
      expect(replay.status, replay.text).toBe(404);
    },
  );
  it("nega altro Centro e revoca corrente del grant con sessione precedente", async () => {
    const f = await fixture("bozza");
    const otherCentre = (
      await createCentroRec(scope, { areaOperativaId: area })
    ).id;
    const other = await cancellationActor(["sociale"], otherCentre);
    expect(
      (
        await request(other.app)
          .post(`/richieste-magazzino/${f.rm.id}/annulla`)
          .send(command())
      ).status,
    ).toBe(404);
    const revoked = await cancellationActor(["sociale"]);
    await db
      .update(ruoliTable)
      .set({ permessi: ["richieste_magazzino.view"] })
      .where(eq(ruoliTable.id, revoked.roleId));
    expect(
      (
        await request(revoked.app)
          .post(`/richieste-magazzino/${f.rm.id}/annulla`)
          .send(command())
      ).status,
    ).toBe(403);
    const [rm] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, f.rm.id));
    expect(rm.stato).toBe("presa_in_carico");
  });
  it("annulla Trasferimento pronto e ripristina disponibilità senza movimento fisico", async () => {
    const f = await transferFixture();
    const cancelled = await request(app)
      .post(`/richieste-magazzino/${f.rm.id}/annulla`)
      .send(command());
    expect(cancelled.status, cancelled.text).toBe(200);
    const [doc] = await db
      .select()
      .from(trasferimentiTable)
      .where(eq(trasferimentiTable.id, f.id));
    expect(doc.stato).toBe("annullato");
    const reservations = await db
      .select()
      .from(prenotazioniMagazzinoTable)
      .where(eq(prenotazioniMagazzinoTable.trasferimentoId, f.id));
    expect(reservations.length).toBeGreaterThan(0);
    expect(reservations.every((r) => r.stato === "rilasciata")).toBe(true);
    const [lot] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, f.lotId));
    expect(Number(lot.quantitaResidua)).toBe(10);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.trasferimentoId, f.id)),
    ).toHaveLength(0);
  });
  it("serializza annullamento e partenza del Trasferimento, senza stock incoerente", async () => {
    const f = await transferFixture();
    const [cancelled, dispatched] = await Promise.all([
      request(app)
        .post(`/richieste-magazzino/${f.rm.id}/annulla`)
        .send(command()),
      request(app)
        .post(`/trasferimenti/${f.id}/avvia`)
        .send({ versione: f.versione, idempotencyKey: randomUUID() }),
    ]);
    expect([cancelled.status, dispatched.status].sort()).toEqual([200, 409]);
    const [doc] = await db
      .select()
      .from(trasferimentiTable)
      .where(eq(trasferimentiTable.id, f.id));
    const [rm] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, f.rm.id));
    const [lot] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, f.lotId));
    expect([doc.stato, rm.stato, Number(lot.quantitaResidua)]).toEqual(
      cancelled.status === 200
        ? ["annullato", "annullata", 10]
        : ["in_transito", "presa_in_carico", 7],
    );
  });
  it("serializza annullamento e conferma Bolla, rilasciando qualsiasi prenotazione", async () => {
    const f = await fixture("bozza");
    const [cancelled, confirmed] = await Promise.all([
      request(app)
        .post(`/richieste-magazzino/${f.rm.id}/annulla`)
        .send(command()),
      request(app)
        .post(`/bolle/${f.bollaId}/conferma`)
        .send({ versione: 1, idempotencyKey: randomUUID() }),
    ]);
    expect(cancelled.status, cancelled.text).toBe(200);
    expect([200, 409]).toContain(confirmed.status);
    const [doc] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, f.bollaId!));
    expect(doc.stato).toBe("annullato");
    expect(
      await db
        .select()
        .from(prenotazioniMagazzinoTable)
        .where(
          and(
            eq(prenotazioniMagazzinoTable.bollaId, f.bollaId!),
            eq(prenotazioniMagazzinoTable.stato, "attiva"),
          ),
        ),
    ).toHaveLength(0);
  });
  it.each(["none", "bozza", "confermato"] as const)(
    "annulla %s, conserva note/Intervento, audit e replay unici",
    async (state) => {
      const f = await fixture(state);
      const body = command();
      const responses = await Promise.all(
        [1, 2].map(() =>
          request(app)
            .post(`/richieste-magazzino/${f.rm.id}/annulla`)
            .send(body),
        ),
      );
      for (const response of responses)
        expect(response.status, response.text).toBe(200);
      const [rm] = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, f.rm.id));
      expect(rm).toMatchObject({
        stato: "annullata",
        versione: 2,
        noteOperative: "Non sovrascrivere",
      });
      const [intervento] = await db
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, f.intervento.id));
      expect(intervento.stato).toBe("da_pianificare");
      const events = await db
        .select()
        .from(auditEventiTable)
        .where(
          and(
            eq(auditEventiTable.entitaTipo, "richiesta_magazzino"),
            eq(auditEventiTable.entitaId, rm.id),
            eq(auditEventiTable.azione, "richiesta_magazzino.cancel"),
          ),
        );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        motivo: body.motivo,
        changes: { nota: body.nota },
      });
      const history = await request(app).get(
        `/richieste-magazzino/${rm.id}/storico`,
      );
      expect(history.status).toBe(200);
      expect(history.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            motivo: body.motivo,
            changes: expect.objectContaining({ nota: body.nota }),
          }),
        ]),
      );
      if (f.bollaId != null) {
        const [doc] = await db
          .select()
          .from(bolleTable)
          .where(eq(bolleTable.id, f.bollaId));
        expect(doc.stato).toBe("annullato");
        const [link] = await db
          .select()
          .from(richiesteMagazzinoDocumentiTable)
          .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, rm.id));
        expect(link).toMatchObject({
          corrente: false,
          eventoCessazione: "annullamento_m4",
        });
        const reservations = await db
          .select()
          .from(prenotazioniMagazzinoTable)
          .where(eq(prenotazioniMagazzinoTable.bollaId, f.bollaId));
        if (state === "confermato")
          expect(reservations.length).toBeGreaterThan(0);
        expect(reservations.every((r) => r.stato === "rilasciata")).toBe(true);
        const [lot] = await db
          .select()
          .from(lottiTable)
          .where(eq(lottiTable.id, f.lotId!));
        expect(Number(lot.quantitaResidua)).toBe(10);
        expect(
          await db
            .select()
            .from(movimentiTable)
            .where(eq(movimentiTable.bollaId, f.bollaId)),
        ).toHaveLength(0);
      }
      const next = await request(app).post("/richieste-magazzino").send({
        idempotencyKey: randomUUID(),
        tipoDestinatario: "beneficiario",
        beneficiarioId: beneficiary,
        sorgente: "intervento_sociale",
        interventoId: f.intervento.id,
        bisogno: "Nuovo bisogno",
      });
      expect(next.status, next.text).toBe(201);
    },
  );
  it("valida motivo e limite nota senza mutazioni", async () => {
    const f = await fixture();
    for (const body of [
      { ...command(), motivo: " " },
      { ...command(), nota: "x".repeat(2001) },
    ]) {
      const response = await request(app)
        .post(`/richieste-magazzino/${f.rm.id}/annulla`)
        .send(body);
      expect(response.status).toBe(400);
    }
    const [rm] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, f.rm.id));
    expect(rm.stato).toBe("inviata");
  });
  it.each(["in_trasporto", "consegnato", "rientro_atteso"])(
    "nega %s senza mutazioni",
    async (stato) => {
      const f = await fixture("confermato");
      await db
        .update(bolleTable)
        .set({ stato })
        .where(eq(bolleTable.id, f.bollaId!));
      const response = await request(app)
        .post(`/richieste-magazzino/${f.rm.id}/annulla`)
        .send(command());
      expect(response.status, response.text).toBe(409);
      const [rm] = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, f.rm.id));
      expect(rm).toMatchObject({ stato: "presa_in_carico", versione: 1 });
      const [link] = await db
        .select()
        .from(richiesteMagazzinoDocumentiTable)
        .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, rm.id));
      expect(link.corrente).toBe(true);
    },
  );
});
