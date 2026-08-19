import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  bolleTable,
  bollaRigheTable,
  lottiTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  consegneTable,
  interventiTable,
  interventiStoricoStatiTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import bolleRouter from "../src/routes/bolle";
import consegneRouter from "../src/routes/consegne";
import preparazioneConsegneRouter from "../src/routes/preparazione-consegne";
import reportRouter from "../src/routes/report";
import { annullaInterventoDaBollaTx, stornoRigaTx } from "../src/lib/bollaDelivery";
import { dataOperativaEuropeRome } from "../src/lib/lottoPolicy";
import {
  makeScopedApp,
  newScope,
  cleanup,
  type SeedScope,
  createBeneficiario,
  createCentro,
  createLotto,
  createMagazzino,
  createProdotto,
  createUtente,
  insertConsegna,
  insertBolla,
  insertBollaRiga,
  insertPrenotazioneMagazzino,
} from "./scope-helpers";

let bootScope: SeedScope;
let scope: SeedScope;
let operatoreId: number;
let centroA: number;
let centroB: number;
let benA: number;
let benB: number;
let magA: number;
let magB: number;
let prod: number;

const appAs = (centro: number | null) =>
  makeScopedApp(bolleRouter, { id: operatoreId, centroAscoltoId: centro });
const consegneAppAs = (centro: number | null) =>
  makeScopedApp(consegneRouter, { id: operatoreId, centroAscoltoId: centro });
const preparazioneAppAs = (centro: number | null) =>
  makeScopedApp(preparazioneConsegneRouter, { id: operatoreId, centroAscoltoId: centro });
const reportAppAs = (centro: number | null) =>
  makeScopedApp(reportRouter, { id: operatoreId, centroAscoltoId: centro });

async function prenotazioniBolla(bollaId: number) {
  return db
    .select()
    .from(prenotazioniMagazzinoTable)
    .where(eq(prenotazioniMagazzinoTable.bollaId, bollaId))
    .orderBy(asc(prenotazioniMagazzinoTable.id));
}

async function movimentiBolla(bollaId: number) {
  return db
    .select()
    .from(movimentiTable)
    .where(eq(movimentiTable.bollaId, bollaId))
    .orderBy(asc(movimentiTable.id));
}

async function lottoResidua(lottoId: number): Promise<number> {
  const [lotto] = await db.select().from(lottiTable).where(eq(lottiTable.id, lottoId));
  return Number(lotto.quantitaResidua);
}

async function bollaStato(bollaId: number): Promise<string> {
  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  return bolla.stato;
}

beforeAll(async () => {
  bootScope = newScope();
  operatoreId = await createUtente(bootScope, {});
});

beforeEach(async () => {
  scope = newScope();
  centroA = await createCentro(scope);
  centroB = await createCentro(scope);
  benA = await createBeneficiario(scope, centroA);
  benB = await createBeneficiario(scope, centroB);
  magA = await createMagazzino(scope, centroA);
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

describe("Bolle — prenotazione merce su conferma", () => {
  it("crea sempre in bozza, rifiuta campi server-managed e rende immutabile una Bolla consegnata", async () => {
    const rejected = await request(appAs(centroA)).post("/bolle").send({
      beneficiarioId: benA,
      magazzinoId: magA,
      stato: "consegnato",
    });
    expect(rejected.status).toBe(400);

    const created = await request(appAs(centroA)).post("/bolle").send({ beneficiarioId: benA, magazzinoId: magA });
    expect(created.status).toBe(201);
    expect(created.body.stato).toBe("bozza");
    scope.bollaIds.push(created.body.id);

    const altroBeneficiario = await createBeneficiario(scope, centroA);
    const delivered = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA, stato: "consegnato" });
    const patch = await request(appAs(centroA))
      .patch(`/bolle/${delivered}`)
      .send({ beneficiarioId: altroBeneficiario });
    expect([400, 409]).toContain(patch.status);
    const [unchanged] = await db.select().from(bolleTable).where(eq(bolleTable.id, delivered));
    expect(unchanged.beneficiarioId).toBe(benA);
    expect(await movimentiBolla(delivered)).toHaveLength(0);
  });

  it("conferma una bolla con disponibilita reale sufficiente creando prenotazioni senza scalare lotti o creare movimenti", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA });
    await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 4 });

    const res = await request(appAs(centroA)).post(`/bolle/${bollaId}/conferma`).send({});

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("confermato");
    expect(await lottoResidua(lottoId)).toBe(10);
    expect(await movimentiBolla(bollaId)).toHaveLength(0);
    const prenotazioni = await prenotazioniBolla(bollaId);
    expect(prenotazioni).toHaveLength(1);
    expect(prenotazioni[0]).toMatchObject({
      lottoId,
      stato: "attiva",
      quantita: "4.00",
    });
  });

  it("fallisce se la disponibilita reale e insufficiente e lascia bolla, lotti e prenotazioni invariati", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const bollaPrenotata = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA, stato: "confermato" });
    const rigaPrenotata = await insertBollaRiga(scope, { bollaId: bollaPrenotata, prodottoId: prod, lottoId, quantita: 8 });
    await insertPrenotazioneMagazzino(scope, {
      bollaId: bollaPrenotata,
      rigaBollaId: rigaPrenotata,
      prodottoId: prod,
      lottoId,
      magazzinoId: magA,
      quantita: 8,
    });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA });
    await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 3 });

    const res = await request(appAs(centroA)).post(`/bolle/${bollaId}/conferma`).send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Disponibilità reale insufficiente");
    expect(await bollaStato(bollaId)).toBe("bozza");
    expect(await lottoResidua(lottoId)).toBe(10);
    expect(await prenotazioniBolla(bollaId)).toHaveLength(0);
  });

  it("usa le prenotazioni della prima bolla per bloccare una seconda bolla oltre il disponibile reale", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const primaBolla = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA });
    await insertBollaRiga(scope, { bollaId: primaBolla, prodottoId: prod, lottoId, quantita: 8 });
    const secondaBolla = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA });
    await insertBollaRiga(scope, { bollaId: secondaBolla, prodottoId: prod, lottoId, quantita: 3 });

    expect((await request(appAs(centroA)).post(`/bolle/${primaBolla}/conferma`).send({})).status).toBe(200);
    const res = await request(appAs(centroA)).post(`/bolle/${secondaBolla}/conferma`).send({});

    expect(res.status).toBe(409);
    expect(await bollaStato(secondaBolla)).toBe("bozza");
    expect(await prenotazioniBolla(secondaBolla)).toHaveLength(0);
  });

  it("prenota FEFO splittando una riga su piu lotti senza scalare la giacenza fisica", async () => {
    const lottoA = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 40,
      dataScadenza: "2098-02-01",
    });
    const lottoB = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 60,
      dataScadenza: "2098-06-01",
    });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA });
    const rigaId = await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId: null, quantita: 70 });

    const res = await request(appAs(centroA)).post(`/bolle/${bollaId}/conferma`).send({});

    expect(res.status).toBe(200);
    const prenotazioni = await prenotazioniBolla(bollaId);
    expect(prenotazioni.map((p) => ({ lottoId: p.lottoId, quantita: p.quantita, stato: p.stato }))).toEqual([
      { lottoId: lottoA, quantita: "40.00", stato: "attiva" },
      { lottoId: lottoB, quantita: "30.00", stato: "attiva" },
    ]);
    expect(await lottoResidua(lottoA)).toBe(40);
    expect(await lottoResidua(lottoB)).toBe(60);
    const [riga] = await db.select().from(bollaRigheTable).where(eq(bollaRigheTable.id, rigaId));
    expect(riga.lottoId).toBe(lottoA);
  });

  it("blocca aggiunta e cancellazione righe su bolla confermata", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA, stato: "confermato" });
    const rigaId = await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 2 });

    const add = await request(appAs(centroA)).post(`/bolle/${bollaId}/righe`).send({ prodottoId: prod, lottoId, quantita: 1 });
    const del = await request(appAs(centroA)).delete(`/bolle/${bollaId}/righe/${rigaId}`).send({});

    expect(add.status).toBe(400);
    expect(del.status).toBe(400);
    expect(add.body.error).toContain("solo in stato bozza");
    expect(del.body.error).toContain("solo in stato bozza");
  });
});

describe("Bolle — consegna e annullo prenotazioni", () => {
  it("esclude i lotti scaduti dalla selezione FEFO automatica e accetta quelli che scadono oggi", async () => {
    const scaduto = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 8,
      dataScadenza: "2000-01-01",
    });
    const valido = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 4,
      dataScadenza: dataOperativaEuropeRome(),
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId: null,
      quantita: 4,
    });

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/conferma`)
      .send({});

    expect(res.status).toBe(200);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.lottoId)).toEqual([
      valido,
    ]);
    expect(await lottoResidua(scaduto)).toBe(8);
  });


  it("rifiuta conferma con lotto esplicito scaduto e quando esiste solo stock scaduto", async () => {
    const scaduto = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
      dataScadenza: "2000-01-01",
    });
    const esplicita = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId: esplicita,
      prodottoId: prod,
      lottoId: scaduto,
      quantita: 1,
    });
    const automatica = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId: automatica,
      prodottoId: prod,
      lottoId: null,
      quantita: 1,
    });

    const explicitResult = await request(appAs(centroA))
      .post(`/bolle/${esplicita}/conferma`)
      .send({});
    const automaticResult = await request(appAs(centroA))
      .post(`/bolle/${automatica}/conferma`)
      .send({});

    expect(explicitResult.status).toBe(409);
    expect(explicitResult.body.error).toMatch(/scaduto/i);
    expect(automaticResult.status).toBe(409);
    expect(await prenotazioniBolla(esplicita)).toHaveLength(0);
    expect(await prenotazioniBolla(automatica)).toHaveLength(0);
  });
});

describe("Bolle — inserimento righe con scope operativo", () => {

  it("valida Bolla e magazzino prima di leggere il lotto e non espone dati fuori scope", async () => {
    const lottoB = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magB,
      quantita: 5,
      dataScadenza: "2099-12-31",
    });
    const [lotto] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoB));
    const bollaFuoriScope = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magB,
    });

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaFuoriScope}/righe`)
      .send({
        prodottoId: prod,
        lottoId: lottoB,
        quantita: 1,
      });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(
      lotto.codiceLotto ?? "codice-impossibile",
    );
  });


  it("rifiuta lotto inesistente, scaduto o non coerente con prodotto/magazzino e accetta un lotto valido", async () => {
    const altroProdotto = await createProdotto(scope);
    const valido = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 5,
      dataScadenza: "2099-12-31",
    });
    const scaduto = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 5,
      dataScadenza: "2000-01-01",
    });
    const altroMagazzino = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magB,
      quantita: 5,
      dataScadenza: "2099-12-31",
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const path = `/bolle/${bollaId}/righe`;

    expect(
      (
        await request(appAs(centroA))
          .post(path)
          .send({ prodottoId: prod, lottoId: 2_000_000_000, quantita: 1 })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(appAs(centroA))
          .post(path)
          .send({ prodottoId: prod, lottoId: scaduto, quantita: 1 })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(appAs(centroA))
          .post(path)
          .send({ prodottoId: altroProdotto, lottoId: valido, quantita: 1 })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(appAs(centroA))
          .post(path)
          .send({ prodottoId: prod, lottoId: altroMagazzino, quantita: 1 })
      ).status,
    ).toBe(404);
    const accepted = await request(appAs(centroA))
      .post(path)
      .send({ prodottoId: prod, lottoId: valido, quantita: 1 });
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({
      prodottoId: prod,
      lottoId: valido,
      quantita: 1,
    });
  });


  it("consente a un operatore Sociale con bolle.manage la propria Bolla senza permettere probe su altri magazzini", async () => {
    const socialApp = makeScopedApp(bolleRouter, {
      id: operatoreId,
      centroAscoltoId: centroA,
      aree: ["sociale"],
      permessi: ["bolle.manage"],
    });
    const lottoA = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 5,
      dataScadenza: "2099-12-31",
    });
    const lottoB = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magB,
      quantita: 5,
      dataScadenza: "2099-12-31",
    });
    const propria = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const altrui = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magB,
    });

    expect(
      (
        await request(socialApp)
          .post(`/bolle/${propria}/righe`)
          .send({ prodottoId: prod, lottoId: lottoA, quantita: 1 })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(socialApp)
          .post(`/bolle/${altrui}/righe`)
          .send({ prodottoId: prod, lottoId: lottoB, quantita: 1 })
      ).status,
    ).toBe(403);
  });
});

describe("Bolle — consegna e annullo prenotazioni", () => {

  it("consegna una bolla confermata convertendo prenotazioni in scarico fisico", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA });
    await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 4 });
    expect((await request(appAs(centroA)).post(`/bolle/${bollaId}/conferma`).send({})).status).toBe(200);

    const res = await request(appAs(centroA)).post(`/bolle/${bollaId}/consegna`).send({ confermaRicezione: true });

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("consegnato");
    expect(await lottoResidua(lottoId)).toBe(6);
    const prenotazioni = await prenotazioniBolla(bollaId);
    expect(prenotazioni.map((p) => p.stato)).toEqual(["convertita_in_scarico"]);
    const movimenti = await movimentiBolla(bollaId);
    expect(movimenti).toHaveLength(1);
    expect(movimenti[0]).toMatchObject({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      lottoId,
      prodottoId: prod,
      bollaId,
      bollaRigaId: prenotazioni[0].rigaBollaId,
      quantita: "4.00",
    });
  });

  it("blocca la consegna se il lotto prenotato non ha piu residuo sufficiente", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA });
    await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 4 });
    expect((await request(appAs(centroA)).post(`/bolle/${bollaId}/conferma`).send({})).status).toBe(200);
    await db.update(lottiTable).set({ quantitaResidua: "2.00" }).where(eq(lottiTable.id, lottoId));

    const res = await request(appAs(centroA)).post(`/bolle/${bollaId}/consegna`).send({ confermaRicezione: true });

    expect(res.status).toBe(409);
    expect(await bollaStato(bollaId)).toBe("confermato");
    expect(await lottoResidua(lottoId)).toBe(2);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.stato)).toEqual(["attiva"]);
    expect(await movimentiBolla(bollaId)).toHaveLength(0);
  });

  it("blocca la consegna se il lotto è scaduto dopo la conferma", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
      dataScadenza: "2099-12-31",
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/conferma`)
          .send({})
      ).status,
    ).toBe(200);
    await db
      .update(lottiTable)
      .set({ dataScadenza: "2000-01-01" })
      .where(eq(lottiTable.id, lottoId));

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/consegna`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/scaduto/i);
    expect(await bollaStato(bollaId)).toBe("confermato");
    expect(await lottoResidua(lottoId)).toBe(10);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.stato)).toEqual([
      "attiva",
    ]);
    expect(await movimentiBolla(bollaId)).toHaveLength(0);
  });


  it("annulla una bolla confermata nuova rilasciando prenotazioni senza scalare lotti o creare movimenti", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA });
    await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 4 });
    expect((await request(appAs(centroA)).post(`/bolle/${bollaId}/conferma`).send({})).status).toBe(200);

    const res = await request(appAs(centroA)).post(`/bolle/${bollaId}/annulla`).send({});

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("annullato");
    expect(await lottoResidua(lottoId)).toBe(10);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.stato)).toEqual(["rilasciata"]);
    expect(await movimentiBolla(bollaId)).toHaveLength(0);
  });

  it("storna una Bolla consegnata in modo append-only e impedisce il doppio ripristino", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/conferma`)
          .send({})
      ).status,
    ).toBe(200);
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/consegna`)
          .send({ confermaRicezione: true })
      ).status,
    ).toBe(200);
    expect(await lottoResidua(lottoId)).toBe(6);
    const [interventoConsegnato] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.bollaId, bollaId));
    expect(interventoConsegnato).toMatchObject({
      bollaId,
      beneficiarioId: benA,
      stato: "concluso",
    });

    const cancelled = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/annulla`)
      .send({ motivo: "Consegna annullata dal test" });
    expect(cancelled.status).toBe(200);
    expect(await lottoResidua(lottoId)).toBe(10);
    const movements = await movimentiBolla(bollaId);
    expect(movements).toHaveLength(2);
    expect(movements[0].tipoMovimento).toBe("scarico");
    expect(movements[1]).toMatchObject({
      tipoMovimento: "storno",
      movimentoOrigineId: movements[0].id,
      operatoreId,
    });
    const [interventoAnnullato] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.bollaId, bollaId));
    expect(interventoAnnullato).toMatchObject({
      id: interventoConsegnato.id,
      bollaId,
      beneficiarioId: benA,
      stato: "annullato",
      operatoreId,
    });
    expect(interventoAnnullato.motivoAnnullamento).toContain(
      "Consegna annullata dal test",
    );
    const storico = await db
      .select()
      .from(interventiStoricoStatiTable)
      .where(
        eq(interventiStoricoStatiTable.interventoId, interventoConsegnato.id),
      );
    expect(storico).toHaveLength(1);
    expect(storico[0]).toMatchObject({
      statoPrecedente: "concluso",
      statoNuovo: "annullato",
      operatoreId,
    });

    const duplicate = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/annulla`)
      .send({});
    expect(duplicate.status).toBe(400);
    expect(await lottoResidua(lottoId)).toBe(10);
    expect(await movimentiBolla(bollaId)).toHaveLength(2);
    expect(
      await db
        .select()
        .from(interventiStoricoStatiTable)
        .where(
          eq(interventiStoricoStatiTable.interventoId, interventoConsegnato.id),
        ),
    ).toHaveLength(1);
  });

  it("rollbacka storno e stato Intervento se l'audit dell'annullamento fallisce", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const rigaId = await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/conferma`)
          .send({})
      ).status,
    ).toBe(200);
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/consegna`)
          .send({})
      ).status,
    ).toBe(200);
    const [interventoPrima] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.bollaId, bollaId));

    await expect(
      db.transaction(async (tx) => {
        await stornoRigaTx(tx, { id: rigaId }, bollaId, operatoreId);
        await annullaInterventoDaBollaTx(
          tx,
          bollaId,
          2_000_000_000,
          "Errore simulato",
        );
      }),
    ).rejects.toBeDefined();

    expect(await lottoResidua(lottoId)).toBe(6);
    expect(await movimentiBolla(bollaId)).toHaveLength(1);
    const [interventoDopo] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.bollaId, bollaId));
    expect(interventoDopo).toMatchObject({
      id: interventoPrima.id,
      stato: "concluso",
    });
    expect(
      await db
        .select()
        .from(interventiStoricoStatiTable)
        .where(
          eq(interventiStoricoStatiTable.interventoId, interventoPrima.id),
        ),
    ).toHaveLength(0);
  });


  it("tratta una bolla legacy confermata con movimenti scarico come gia scaricata e non scala di nuovo alla consegna", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA, stato: "confermato" });
    const rigaId = await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 4 });
    await db.update(lottiTable).set({ quantitaResidua: "6.00" }).where(eq(lottiTable.id, lottoId));
    await db.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      dataMovimento: "2026-06-01",
      magazzinoId: magA,
      prodottoId: prod,
      lottoId,
      quantita: "4.00",
      unitaMisura: "kg",
      beneficiarioId: benA,
      bollaId,
      bollaRigaId: rigaId,
      documentoRiferimento: "legacy",
    });

    const res = await request(appAs(centroA)).post(`/bolle/${bollaId}/consegna`).send({ confermaRicezione: true });

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("consegnato");
    expect(await lottoResidua(lottoId)).toBe(6);
    expect(await movimentiBolla(bollaId)).toHaveLength(1);
    expect(await prenotazioniBolla(bollaId)).toHaveLength(0);
  });
});

describe("Consegne — completa converte le prenotazioni bolla", () => {
  it("completa una consegna collegata a bolla confermata convertendo prenotazioni in scarico fisico", async () => {
    const consegnaId = await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magA });
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA, consegnaId });
    await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 4 });
    expect((await request(appAs(centroA)).post(`/bolle/${bollaId}/conferma`).send({})).status).toBe(200);

    const res = await request(consegneAppAs(centroA)).post(`/consegne/${consegnaId}/completa`).send({});

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("effettuata");
    expect(await bollaStato(bollaId)).toBe("consegnato");
    expect(await lottoResidua(lottoId)).toBe(6);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.stato)).toEqual(["convertita_in_scarico"]);
    expect(await movimentiBolla(bollaId)).toHaveLength(1);

    const [consegna] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
    expect(consegna.stato).toBe("effettuata");
    expect(consegna.dataEffettuata).not.toBeNull();
  });

  it("completa una consegna legacy senza scalare lotti o duplicare movimenti", async () => {
    const consegnaId = await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magA });
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA, consegnaId, stato: "confermato" });
    const rigaId = await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 4 });
    await db.update(lottiTable).set({ quantitaResidua: "6.00" }).where(eq(lottiTable.id, lottoId));
    await db.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      dataMovimento: "2026-06-01",
      magazzinoId: magA,
      prodottoId: prod,
      lottoId,
      quantita: "4.00",
      unitaMisura: "kg",
      beneficiarioId: benA,
      bollaId,
      bollaRigaId: rigaId,
      documentoRiferimento: "legacy",
    });

    const res = await request(consegneAppAs(centroA)).post(`/consegne/${consegnaId}/completa`).send({});

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("effettuata");
    expect(await bollaStato(bollaId)).toBe("consegnato");
    expect(await lottoResidua(lottoId)).toBe(6);
    expect(await movimentiBolla(bollaId)).toHaveLength(1);
    expect(await prenotazioniBolla(bollaId)).toHaveLength(0);
  });

  it("non scarica due volte su doppia chiamata completa/consegna", async () => {
    const consegnaId = await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magA });
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA, consegnaId });
    await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 4 });
    expect((await request(appAs(centroA)).post(`/bolle/${bollaId}/conferma`).send({})).status).toBe(200);
    expect((await request(consegneAppAs(centroA)).post(`/consegne/${consegnaId}/completa`).send({})).status).toBe(200);

    const completaBis = await request(consegneAppAs(centroA)).post(`/consegne/${consegnaId}/completa`).send({});
    const consegnaBis = await request(appAs(centroA)).post(`/bolle/${bollaId}/consegna`).send({});

    expect(completaBis.status).toBe(400);
    expect(completaBis.body.error).toContain("già consegnata");
    expect(consegnaBis.status).toBe(400);
    expect(consegnaBis.body.error).toContain("già consegnata");
    expect(await lottoResidua(lottoId)).toBe(6);
    expect(await movimentiBolla(bollaId)).toHaveLength(1);
  });
});

describe("Report e preparazione — semantica merce impegnata/consegnata", () => {
  it("il report FSE+ conta solo bolle fisicamente consegnate", async () => {
    const before = (await request(reportAppAs(null)).get("/report/fse-plus?anno=2026")).body.beneficiariTotali as number;
    const benConfermato = await createBeneficiario(scope, centroA);
    const benConsegnato = await createBeneficiario(scope, centroA);
    const lottoConfermato = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 5, fsePlus: true });
    const lottoConsegnato = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 5, fsePlus: true });
    const bollaConfermata = await insertBolla(scope, { beneficiarioId: benConfermato, magazzinoId: magA, stato: "confermato" });
    const bollaConsegnata = await insertBolla(scope, { beneficiarioId: benConsegnato, magazzinoId: magA, stato: "consegnato" });
    await insertBollaRiga(scope, { bollaId: bollaConfermata, prodottoId: prod, lottoId: lottoConfermato, quantita: 5 });
    await insertBollaRiga(scope, { bollaId: bollaConsegnata, prodottoId: prod, lottoId: lottoConsegnato, quantita: 5 });

    const after = (await request(reportAppAs(null)).get("/report/fse-plus?anno=2026")).body.beneficiariTotali as number;

    expect(after).toBe(before + 1);
  });

  it("preparazione consegne usa il disponibile reale e non propone merce già impegnata", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const bollaPrenotata = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA, stato: "confermato" });
    const rigaPrenotata = await insertBollaRiga(scope, { bollaId: bollaPrenotata, prodottoId: prod, lottoId, quantita: 8 });
    await insertPrenotazioneMagazzino(scope, {
      bollaId: bollaPrenotata,
      rigaBollaId: rigaPrenotata,
      prodottoId: prod,
      lottoId,
      magazzinoId: magA,
      quantita: 8,
    });
    const consegnaId = await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magA });
    const bollaDaPreparare = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magA, consegnaId });
    await insertBollaRiga(scope, { bollaId: bollaDaPreparare, prodottoId: prod, lottoId, quantita: 3 });

    const res = await request(preparazioneAppAs(centroA)).get(`/preparazione-consegne?magazzinoId=${magA}`);

    expect(res.status).toBe(200);
    expect(res.body.righe).toEqual([
      expect.objectContaining({
        prodottoId: prod,
        quantitaRichiesta: 3,
        quantitaDisponibile: 2,
        sufficiente: false,
      }),
    ]);
  });
});

describe("Bolle — scoping prenotazioni", () => {
  it("impedisce a un utente del centro A di confermare merce del magazzino del centro B", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magB, quantita: 10 });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magB });
    await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 4 });

    const res = await request(appAs(centroA)).post(`/bolle/${bollaId}/conferma`).send({});

    expect(res.status).toBe(403);
    expect(await prenotazioniBolla(bollaId)).toHaveLength(0);
    expect(await bollaStato(bollaId)).toBe("bozza");
  });

  it("anche un utente globale rispetta la disponibilita reale", async () => {
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magB, quantita: 10 });
    const bollaPrenotata = await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magB, stato: "confermato" });
    const rigaPrenotata = await insertBollaRiga(scope, { bollaId: bollaPrenotata, prodottoId: prod, lottoId, quantita: 9 });
    await insertPrenotazioneMagazzino(scope, {
      bollaId: bollaPrenotata,
      rigaBollaId: rigaPrenotata,
      prodottoId: prod,
      lottoId,
      magazzinoId: magB,
      quantita: 9,
    });
    const bollaId = await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magB });
    await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 2 });

    const res = await request(appAs(null)).post(`/bolle/${bollaId}/conferma`).send({});

    expect(res.status).toBe(409);
    expect(await prenotazioniBolla(bollaId)).toHaveLength(0);
  });

  it("completa consegna rispetta anche lo scope del magazzino della bolla", async () => {
    const consegnaId = await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magB });
    const lottoId = await createLotto(scope, { prodottoId: prod, magazzinoId: magB, quantita: 10 });
    const bollaId = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magB, consegnaId, stato: "confermato" });
    const rigaId = await insertBollaRiga(scope, { bollaId, prodottoId: prod, lottoId, quantita: 4 });
    await insertPrenotazioneMagazzino(scope, {
      bollaId,
      rigaBollaId: rigaId,
      prodottoId: prod,
      lottoId,
      magazzinoId: magB,
      quantita: 4,
    });

    const res = await request(consegneAppAs(centroA)).post(`/consegne/${consegnaId}/completa`).send({});

    expect(res.status).toBe(403);
    expect(await lottoResidua(lottoId)).toBe(10);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.stato)).toEqual(["attiva"]);
    expect(await bollaStato(bollaId)).toBe("confermato");
  });
});
