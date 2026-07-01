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
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import bolleRouter from "../src/routes/bolle";
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
      dataScadenza: "2026-02-01",
    });
    const lottoB = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 60,
      dataScadenza: "2026-06-01",
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
});
