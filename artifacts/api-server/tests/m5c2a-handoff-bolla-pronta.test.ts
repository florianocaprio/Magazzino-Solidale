/* @vitest-environment node */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import {
  bolleTable,
  bollaRigheTable,
  consegneTable,
  db,
  interventiTable,
  lottiTable,
  movimentiTable,
  pool,
  prenotazioniMagazzinoTable,
  prodottiTable,
  richiesteMagazzinoDocumentiTable,
  richiesteMagazzinoTable,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import bolleRouter from "../src/routes/bolle";
import consegneRouter from "../src/routes/consegne";
import documentiOperativiRouter from "../src/routes/documenti-operativi";
import interventiRouter from "../src/routes/interventi";
import {
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createLotto,
  createMagazzino,
  createProdotto,
  createUtente,
  insertBolla,
  insertBollaRiga,
  makeScopedApp,
  newScope,
} from "./scope-helpers";

const scope = newScope();
const grants = [
  "richieste_magazzino.view",
  "richieste_magazzino.prepare",
  "consegne.view",
  "consegne.manage",
  "consegne.complete",
  "consegne.cancel",
  "bolle.view",
  "bolle.manage",
  "bolle.deliver",
  "sociale.interventi.view",
  "magazzino.view",
];
let areaId: number;
let centroId: number;
let beneficiarioId: number;
let magazzinoId: number;
let prodottoId: number;
let lottoId: number;
let actorId: number;
let app: ReturnType<typeof makeScopedApp>;

async function linkedBolla(stato: "bozza" | "confermato" = "bozza") {
  const [intervento] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId,
      tipoIntervento: "Pacco alimentare M5C2A",
      ambito: "sociale",
      stato: "da_pianificare",
      operatoreId: actorId,
      areaOperativaIdSnapshot: areaId,
      centroAscoltoIdSnapshot: centroId,
    })
    .returning();
  const [richiesta] = await db
    .insert(richiesteMagazzinoTable)
    .values({
      codice: `RM-C2-${randomUUID().slice(0, 8)}`,
      tipoDestinatario: "beneficiario",
      beneficiarioId,
      areaOperativaId: areaId,
      centroAscoltoId: centroId,
      sorgente: "intervento_sociale",
      interventoId: intervento.id,
      destinatarioNomeSnapshot: "Beneficiario M5C2A",
      areaNomeSnapshot: "Area M5C2A",
      centroNomeSnapshot: "Centro M5C2A",
      bisogno: "Pacco alimentare",
      stato: "presa_in_carico",
      inviatoDa: actorId,
      presoInCaricoDa: actorId,
      presoInCaricoCodiceSnapshot: "M5C2A",
      presoInCaricoAt: new Date(),
    })
    .returning();
  const bollaId = await insertBolla(scope, {
    beneficiarioId,
    magazzinoId,
  });
  await db.insert(richiesteMagazzinoDocumentiTable).values({
    richiestaId: richiesta.id,
    tipoDocumento: "bolla",
    bollaId,
    creatoDa: actorId,
  });
  await insertBollaRiga(scope, {
    bollaId,
    prodottoId,
    lottoId,
    quantita: 3,
    unitaMisura: "pz",
  });
  if (stato === "confermato") {
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    const confirmed = await request(app)
      .post(`/bolle/${bollaId}/conferma`)
      .send({
        versione: bolla.versione,
        idempotencyKey: randomUUID(),
      });
    expect(confirmed.status, confirmed.text).toBe(200);
  }
  const [bolla] = await db
    .select()
    .from(bolleTable)
    .where(eq(bolleTable.id, bollaId));
  return {
    interventoId: intervento.id,
    richiestaId: richiesta.id,
    bollaId,
    versione: bolla.versione,
  };
}

beforeAll(async () => {
  if (process.env.M5C2A_TEST_DISPOSABLE_DB !== "verified")
    throw new Error("M5C2A requires verified disposable PostgreSQL");
  areaId = await createAreaOperativa(scope);
  centroId = (await createCentroRec(scope, { areaOperativaId: areaId })).id;
  beneficiarioId = await createBeneficiario(scope, centroId, {
    areaOperativaId: areaId,
  });
  magazzinoId = await createMagazzino(scope, centroId, {
    areaOperativaId: areaId,
  });
  prodottoId = await createProdotto(scope, {
    unitaMisura: "pz",
    quantitaFrazionabile: false,
  });
  lottoId = await createLotto(scope, {
    prodottoId,
    magazzinoId,
    quantita: 30,
    dataScadenza: "2098-01-01",
  });
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `M5C2A-${randomUUID().slice(0, 8)}`,
      aree: ["sociale", "magazzino"],
      permessi: grants,
    })
    .returning({ id: ruoliTable.id });
  actorId = await createUtente(scope, { centroId, ruoloId: role.id });
  await db
    .update(utentiTable)
    .set({ areaOperativaId: areaId })
    .where(eq(utentiTable.id, actorId));
  const router = express.Router();
  router.use(
    bolleRouter,
    consegneRouter,
    documentiOperativiRouter,
    interventiRouter,
  );
  app = makeScopedApp(router, {
    id: actorId,
    centroAscoltoId: centroId,
    areaOperativaId: areaId,
    aree: ["sociale", "magazzino"],
    permessi: grants,
  });
});

afterAll(async () => {
  await pool.end();
});

describe("M5C2-A — handoff Bolla pronta", () => {
  it("Latte usa l'unità l e il lotto Automatico FEFO; il lotto obbligatorio resta vincolante", async () => {
    const latteId = await createProdotto(scope, { unitaMisura: "l" });
    await db
      .update(prodottiTable)
      .set({ nome: "Latte UHT" })
      .where(eq(prodottiTable.id, latteId));
    const latteLotId = await createLotto(scope, {
      prodottoId: latteId,
      magazzinoId,
      quantita: 44,
    });
    const bollaId = await insertBolla(scope, { beneficiarioId, magazzinoId });
    const [initial] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    const wrongUnit = await request(app).post(`/bolle/${bollaId}/righe`).send({
      prodottoId: latteId,
      quantita: "3",
      unitaMisura: "lt",
      versione: initial.versione,
      idempotencyKey: randomUUID(),
    });
    expect(wrongUnit.status).toBe(400);
    expect(wrongUnit.body.error).toContain("Catalogo");
    const added = await request(app).post(`/bolle/${bollaId}/righe`).send({
      prodottoId: latteId,
      quantita: "3",
      unitaMisura: "l",
      versione: initial.versione,
      idempotencyKey: randomUUID(),
    });
    expect(added.status, added.text).toBe(201);
    expect(added.body).toMatchObject({
      quantita: 3,
      unitaMisura: "l",
      lottoId: null,
    });
    const [savedRow] = await db
      .select()
      .from(bollaRigheTable)
      .where(eq(bollaRigheTable.id, added.body.id));
    expect(savedRow.unitaMisura).toBe("l");
    expect(Number(savedRow.quantita)).toBe(3);
    const confirmed = await request(app)
      .post(`/bolle/${bollaId}/conferma`)
      .send({
        versione: added.body.versioneBolla,
        idempotencyKey: randomUUID(),
      });
    expect(confirmed.status, confirmed.text).toBe(200);
    const reservations = await db
      .select()
      .from(prenotazioniMagazzinoTable)
      .where(eq(prenotazioniMagazzinoTable.bollaId, bollaId));
    expect(reservations).toHaveLength(1);
    expect(reservations[0].lottoId).toBe(latteLotId);

    const requiredId = await createProdotto(scope, {
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    await db
      .update(prodottiTable)
      .set({ lottoFisicoObbligatorio: true })
      .where(eq(prodottiTable.id, requiredId));
    const requiredLotId = await createLotto(scope, {
      prodottoId: requiredId,
      magazzinoId,
      quantita: 10,
    });
    const requiredBollaId = await insertBolla(scope, {
      beneficiarioId,
      magazzinoId,
    });
    const [requiredBolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, requiredBollaId));
    const missingLot = await request(app)
      .post(`/bolle/${requiredBollaId}/righe`)
      .send({
        prodottoId: requiredId,
        quantita: "2",
        unitaMisura: "pz",
        versione: requiredBolla.versione,
        idempotencyKey: randomUUID(),
      });
    expect(missingLot.status).toBe(400);
    const withLot = await request(app)
      .post(`/bolle/${requiredBollaId}/righe`)
      .send({
        prodottoId: requiredId,
        lottoId: requiredLotId,
        quantita: "2",
        unitaMisura: "pz",
        versione: requiredBolla.versione,
        idempotencyKey: randomUUID(),
      });
    expect(withLot.status, withLot.text).toBe(201);
  });

  it("mostra solo la Bolla confermata e non associata; la lista Interventi espone lo stesso raccordo", async () => {
    const bozza = await linkedBolla();
    const pronta = await linkedBolla("confermato");
    const direttaId = await insertBolla(scope, { beneficiarioId, magazzinoId });
    const queue = await request(app).get("/consegne/da-pianificare");
    expect(queue.status, queue.text).toBe(200);
    expect(
      queue.body.some(
        (row: { bollaId: number }) => row.bollaId === bozza.bollaId,
      ),
    ).toBe(false);
    expect(
      queue.body.some(
        (row: { bollaId: number }) => row.bollaId === pronta.bollaId,
      ),
    ).toBe(true);
    const interventi = await request(app).get("/interventi?ambito=sociale");
    expect(interventi.status, interventi.text).toBe(200);
    expect(
      interventi.body.find(
        (row: { id: number }) => row.id === pronta.interventoId,
      )?.raccordoMagazzino?.bollaId,
    ).toBe(pronta.bollaId);
    const documenti = await request(app).get(
      "/documenti-operativi?tipoAggregato=bolla",
    );
    expect(documenti.status, documenti.text).toBe(200);
    expect(
      documenti.body.items.find(
        (row: { id: number }) => row.id === pronta.bollaId,
      )?.centroHandoff,
    ).toBe(true);
    expect(
      documenti.body.items.find((row: { id: number }) => row.id === direttaId)
        ?.centroHandoff,
    ).toBe(false);
  });

  it("la conversione logistica diretta M4 non bypassa l'handoff del Centro", async () => {
    const ready = await linkedBolla("confermato");
    await db
      .update(bolleTable)
      .set({ ritiroNonEffettuatoAt: new Date() })
      .where(eq(bolleTable.id, ready.bollaId));
    const denied = await request(app)
      .post(`/bolle/${ready.bollaId}/converti-consegna`)
      .send({
        indirizzoConsegna: "Via Test 2",
        dataPrevista: "2026-10-18",
        fasciaOraria: "Mattina",
      });
    expect(denied.status).toBe(409);
    expect(denied.body.error).toContain("Centro");
  });

  it("pianifica atomicamente una volta, serializza due operatori e il replay; completa stock/Richiesta senza Intervento duplicato", async () => {
    const ready = await linkedBolla("confermato");
    const payload = {
      versione: ready.versione,
      idempotencyKey: randomUUID(),
      tipoConsegna: "domicilio",
      dataPrevista: "2026-10-15",
      fasciaOraria: "Mattina",
      indirizzoConsegna: "Via Test 1",
    };
    const direct = await request(app)
      .post(`/bolle/${ready.bollaId}/consegna`)
      .send({
        versione: ready.versione,
        idempotencyKey: randomUUID(),
      });
    expect(direct.status).toBe(409);
    const competitorKey = randomUUID();
    const [first, competing] = await Promise.all([
      request(app).post(`/consegne/da-bolla/${ready.bollaId}`).send(payload),
      request(app)
        .post(`/consegne/da-bolla/${ready.bollaId}`)
        .send({
          ...payload,
          idempotencyKey: competitorKey,
        }),
    ]);
    expect([first.status, competing.status].sort()).toEqual([201, 409]);
    const created = first.status === 201 ? first : competing;
    expect(created.body.bollaId).toBe(ready.bollaId);
    const replay = await request(app)
      .post(`/consegne/da-bolla/${ready.bollaId}`)
      .send({
        ...payload,
        idempotencyKey:
          created === first ? payload.idempotencyKey : competitorKey,
      });
    expect(replay.status, replay.text).toBe(200);
    expect(replay.body.id).toBe(created.body.id);
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, ready.bollaId));
    const queue = await request(app).get("/consegne/da-pianificare");
    expect(
      queue.body.some(
        (row: { bollaId: number }) => row.bollaId === ready.bollaId,
      ),
    ).toBe(false);
    const [before] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    const completeBody = {
      versione: bolla.versione,
      idempotencyKey: randomUUID(),
    };
    const completed = await request(app)
      .post(`/consegne/${created.body.id}/completa`)
      .send(completeBody);
    expect(completed.status, completed.text).toBe(200);
    expect(completed.body.stato).toBe("effettuata");
    const completedReplay = await request(app)
      .post(`/consegne/${created.body.id}/completa`)
      .send(completeBody);
    expect(completedReplay.status, completedReplay.text).toBe(200);
    const [after] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    expect(Number(before.quantitaResidua) - Number(after.quantitaResidua)).toBe(
      3,
    );
    const [closed] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
    expect(closed.stato).toBe("chiusa");
    const [deliveredBolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, ready.bollaId));
    expect(deliveredBolla.stato).toBe("consegnato");
    const [original] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, ready.interventoId));
    expect(original.stato).toBe("da_pianificare");
    expect(
      (
        await db
          .select()
          .from(interventiTable)
          .where(eq(interventiTable.bollaId, ready.bollaId))
      ).length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(movimentiTable)
          .where(
            and(
              eq(movimentiTable.bollaId, ready.bollaId),
              eq(movimentiTable.tipoMovimento, "scarico"),
              eq(movimentiTable.tipoDettaglio, "consegna_beneficiario"),
            ),
          )
      ).length,
    ).toBe(1);
    expect(
      (
        await db
          .select()
          .from(prenotazioniMagazzinoTable)
          .where(eq(prenotazioniMagazzinoTable.bollaId, ready.bollaId))
      ).every((row) => row.stato !== "attiva"),
    ).toBe(true);
    expect(
      (
        await db
          .select()
          .from(consegneTable)
          .where(eq(consegneTable.id, created.body.id))
      )[0].stato,
    ).toBe("effettuata");
  }, 60_000);

  it("annullando la Consegna, la Bolla ritorna pianificabile ma il vecchio replay non restituisce una Consegna eliminata", async () => {
    const ready = await linkedBolla("confermato");
    const payload = {
      versione: ready.versione,
      idempotencyKey: randomUUID(),
      tipoConsegna: "in_sede",
      dataPrevista: "2026-10-16",
      fasciaOraria: "Pomeriggio",
    };
    const planned = await request(app)
      .post(`/consegne/da-bolla/${ready.bollaId}`)
      .send(payload);
    expect(planned.status, planned.text).toBe(201);
    const visibleFromBolla = await request(app).get(`/bolle/${ready.bollaId}`);
    expect(visibleFromBolla.status, visibleFromBolla.text).toBe(200);
    expect(visibleFromBolla.body).toMatchObject({
      consegnaDataPrevista: "2026-10-16",
      consegnaFasciaOraria: "Pomeriggio",
    });
    const cancelled = await request(app).delete(`/consegne/${planned.body.id}`);
    expect(cancelled.status, cancelled.text).toBe(204);
    const queue = await request(app).get("/consegne/da-pianificare");
    expect(
      queue.body.some(
        (row: { bollaId: number }) => row.bollaId === ready.bollaId,
      ),
    ).toBe(true);
    const oldReplay = await request(app)
      .post(`/consegne/da-bolla/${ready.bollaId}`)
      .send(payload);
    expect(oldReplay.status).toBe(409);
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, ready.bollaId));
    const replanned = await request(app)
      .post(`/consegne/da-bolla/${ready.bollaId}`)
      .send({
        ...payload,
        versione: bolla.versione,
        idempotencyKey: randomUUID(),
      });
    expect(replanned.status, replanned.text).toBe(201);
    expect(replanned.body.id).not.toBe(planned.body.id);
  });

  it("revoca Centro/Area: la coda e la pianificazione non ampliano il perimetro della sessione esistente", async () => {
    const ready = await linkedBolla("confermato");
    const payload = {
      versione: ready.versione,
      idempotencyKey: randomUUID(),
      tipoConsegna: "in_sede",
      dataPrevista: "2026-10-17",
      fasciaOraria: "Mattina",
    };
    await db
      .update(utentiTable)
      .set({ centroAscoltoId: null, areaOperativaId: null })
      .where(eq(utentiTable.id, actorId));
    try {
      const queue = await request(app).get("/consegne/da-pianificare");
      expect(queue.status, queue.text).toBe(200);
      expect(
        queue.body.some(
          (row: { bollaId: number }) => row.bollaId === ready.bollaId,
        ),
      ).toBe(false);
      const denied = await request(app)
        .post(`/consegne/da-bolla/${ready.bollaId}`)
        .send(payload);
      expect(denied.status).toBe(404);
    } finally {
      await db
        .update(utentiTable)
        .set({ centroAscoltoId: centroId, areaOperativaId: areaId })
        .where(eq(utentiTable.id, actorId));
    }
  });
});
