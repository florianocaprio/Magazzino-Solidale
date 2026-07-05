import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  beneficiariTable,
  bolleTable,
  centriAscoltoTable,
  cittaTable,
  consegneTable,
  creditoSolidaleMovimentiTable,
  db,
  impostazioniModuliTable,
  lottiTable,
  magazziniTable,
  pool,
  prodottiTable,
  scarichiTable,
  sessioniCassaEmporioRigheTable,
  sessioniCassaEmporioTable,
} from "@workspace/db";
import cassaEmporioRouter from "../src/routes/cassa-emporio";

const rnd = () => Math.random().toString(36).slice(2, 8);

const cittaIds: number[] = [];
const centroIds: number[] = [];
const magazzinoIds: number[] = [];
const beneficiarioIds: number[] = [];
const consegnaIds: number[] = [];
const prodottoIds: number[] = [];
const lottoIds: number[] = [];
const sessioneIds: number[] = [];
const rigaIds: number[] = [];

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: number; centroAscoltoId: number | null; cittaId: number | null; isAdmin: boolean } }).user = {
      id: 1,
      centroAscoltoId: null,
      cittaId: null,
      isAdmin: true,
    };
    next();
  });
  app.use(cassaEmporioRouter);
  return app;
}

async function setEmporioEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(impostazioniModuliTable)
    .values({ id: 1, emporioAbilitato: enabled, unitaStradaAbilitata: true })
    .onConflictDoUpdate({
      target: impostazioniModuliTable.id,
      set: { emporioAbilitato: enabled, unitaStradaAbilitata: true },
    });
}

async function createCitta(): Promise<number> {
  const [citta] = await db.insert(cittaTable).values({ nome: `Citta ${rnd()}` }).returning({ id: cittaTable.id });
  cittaIds.push(citta.id);
  return citta.id;
}

async function createCentro(cittaId: number): Promise<number> {
  const [centro] = await db.insert(centriAscoltoTable).values({ nome: `Centro ${rnd()}`, cittaId }).returning({ id: centriAscoltoTable.id });
  centroIds.push(centro.id);
  return centro.id;
}

async function createMagazzino(tipoMagazzino: "emporio" | "misto" | "logistico", cittaId: number, centroAscoltoId: number): Promise<number> {
  const [magazzino] = await db
    .insert(magazziniTable)
    .values({ codice: `MAG-${rnd()}`, nome: `Mag ${rnd()}`, tipoMagazzino, cittaId, centroAscoltoId })
    .returning({ id: magazziniTable.id });
  magazzinoIds.push(magazzino.id);
  return magazzino.id;
}

async function createBeneficiario(opts: {
  cittaId: number;
  centroAscoltoId: number | null;
  creditoSolidaleAbilitato?: boolean;
  creditoSolidaleStato?: "non_abilitato" | "attivo" | "sospeso" | "revocato";
  attivo?: boolean;
  saldo?: string;
  codice?: string;
}): Promise<number> {
  const [beneficiario] = await db
    .insert(beneficiariTable)
    .values({
      codice: opts.codice ?? `BEN-${rnd()}`,
      cognome: `Cassa ${rnd()}`,
      nome: "Emporio",
      sesso: "M",
      cittaId: opts.cittaId,
      centroAscoltoId: opts.centroAscoltoId,
      creditoSolidaleAbilitato: opts.creditoSolidaleAbilitato ?? true,
      creditoSolidaleStato: opts.creditoSolidaleStato ?? "attivo",
      creditoSolidaleSaldo: opts.saldo ?? "20.00",
      creditoSolidaleMensileAssegnato: "25.00",
      attivo: opts.attivo ?? true,
    })
    .returning({ id: beneficiariTable.id });
  beneficiarioIds.push(beneficiario.id);
  return beneficiario.id;
}

async function createAccesso(opts: {
  beneficiarioId: number;
  magazzinoId: number;
  stato?: "pianificato" | "confermato" | "effettuato" | "annullato" | "non_presentato";
  dataOraInizio?: string;
}): Promise<number> {
  const stato = opts.stato ?? "confermato";
  const dataOraInizio = opts.dataOraInizio ?? "2026-07-15T09:00:00";
  const [accesso] = await db
    .insert(consegneTable)
    .values({
      codice: `EMP-${rnd()}`,
      beneficiarioId: opts.beneficiarioId,
      tipoPianificazione: "accesso_emporio",
      tipoConsegna: "accesso_emporio",
      dataPrevista: dataOraInizio.slice(0, 10),
      magazzinoId: opts.magazzinoId,
      magazzinoEmporioId: opts.magazzinoId,
      dataOraInizio: new Date(dataOraInizio),
      dataOraFine: new Date(`${dataOraInizio.slice(0, 10)}T10:00:00`),
      stato: stato === "annullato" ? "annullata" : stato === "non_presentato" ? "mancata" : "pianificata",
      statoAccessoEmporio: stato,
    })
    .returning({ id: consegneTable.id });
  consegnaIds.push(accesso.id);
  return accesso.id;
}

function todayInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function createFixture(opts: {
  tipoMagazzino?: "emporio" | "misto" | "logistico";
  creditoSolidaleAbilitato?: boolean;
  creditoSolidaleStato?: "non_abilitato" | "attivo" | "sospeso" | "revocato";
  saldo?: string;
  codiceBeneficiario?: string;
} = {}) {
  const cittaId = await createCitta();
  const centroId = await createCentro(cittaId);
  const magazzinoId = await createMagazzino(opts.tipoMagazzino ?? "emporio", cittaId, centroId);
  const beneficiarioId = await createBeneficiario({
    cittaId,
    centroAscoltoId: centroId,
    creditoSolidaleAbilitato: opts.creditoSolidaleAbilitato,
    creditoSolidaleStato: opts.creditoSolidaleStato,
    saldo: opts.saldo,
    codice: opts.codiceBeneficiario,
  });
  const accessoId = await createAccesso({ beneficiarioId, magazzinoId });
  return { cittaId, centroId, magazzinoId, beneficiarioId, accessoId };
}

async function createProdotto(opts: {
  magazzinoId: number;
  abilitatoEmporio?: boolean;
  creditoSolidaleValore?: string;
  quantitaMassimaPerSpesa?: string | null;
  quantitaMassimaMensile?: string | null;
  quantitaResidua?: string;
  codice?: string;
  codiceBarre?: string;
}): Promise<number> {
  const [prodotto] = await db
    .insert(prodottiTable)
    .values({
      codice: opts.codice ?? `PRO-${rnd()}`,
      nome: `Prodotto ${rnd()}`,
      descrizione: "Prodotto Emporio",
      tipoProdotto: "alimenti",
      unitaMisura: "pz",
      codiceBarre: opts.codiceBarre ?? `200${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0")}0`,
      abilitatoEmporio: opts.abilitatoEmporio ?? true,
      creditoSolidaleValore: opts.creditoSolidaleValore ?? "2.50",
      quantitaMassimaPerSpesa: opts.quantitaMassimaPerSpesa ?? null,
      quantitaMassimaMensile: opts.quantitaMassimaMensile ?? null,
      attivo: true,
    })
    .returning({ id: prodottiTable.id });
  prodottoIds.push(prodotto.id);
  const [lotto] = await db
    .insert(lottiTable)
    .values({
      prodottoId: prodotto.id,
      codiceLotto: `L-${rnd()}`,
      dataCarico: "2026-07-01",
      quantitaCaricata: opts.quantitaResidua ?? "10",
      quantitaResidua: opts.quantitaResidua ?? "10",
      magazzinoId: opts.magazzinoId,
    })
    .returning({ id: lottiTable.id });
  lottoIds.push(lotto.id);
  return prodotto.id;
}

async function openSession(accessoId: number) {
  const res = await request(makeApp()).post(`/cassa-emporio/accessi/${accessoId}/apri-sessione`).send({});
  if (res.body?.id) sessioneIds.push(res.body.id);
  return res;
}

async function addProduct(sessioneId: number, prodottoId: number, quantita = 1) {
  const res = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessioneId}/righe`).send({ prodottoId, quantita });
  if (res.body?.id) rigaIds.push(res.body.id);
  return res;
}

beforeEach(async () => {
  await setEmporioEnabled(true);
});

afterEach(async () => {
  if (rigaIds.length > 0) await db.delete(sessioniCassaEmporioRigheTable).where(inArray(sessioniCassaEmporioRigheTable.id, rigaIds.splice(0)));
  if (sessioneIds.length > 0) await db.delete(sessioniCassaEmporioTable).where(inArray(sessioniCassaEmporioTable.id, sessioneIds.splice(0)));
  if (consegnaIds.length > 0) await db.delete(consegneTable).where(inArray(consegneTable.id, consegnaIds.splice(0)));
  if (lottoIds.length > 0) await db.delete(lottiTable).where(inArray(lottiTable.id, lottoIds.splice(0)));
  if (prodottoIds.length > 0) await db.delete(prodottiTable).where(inArray(prodottiTable.id, prodottoIds.splice(0)));
  if (beneficiarioIds.length > 0) await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, beneficiarioIds.splice(0)));
  if (magazzinoIds.length > 0) await db.delete(magazziniTable).where(inArray(magazziniTable.id, magazzinoIds.splice(0)));
  if (centroIds.length > 0) await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centroIds.splice(0)));
  if (cittaIds.length > 0) await db.delete(cittaTable).where(inArray(cittaTable.id, cittaIds.splice(0)));
  await setEmporioEnabled(false);
});

afterAll(async () => {
  await pool.end();
});

describe("Cassa Emporio", () => {
  it("apre una sessione da Accesso Emporio valido e marca l'accesso effettuato", async () => {
    const fixture = await createFixture();
    const res = await openSession(fixture.accessoId);
    expect(res.status).toBe(201);
    expect(res.body.accessoEmporioId).toBe(fixture.accessoId);
    expect(res.body.statoSessione).toBe("aperta");
    expect(res.body.saldoCreditoIniziale).toBe(20);
    expect(res.body.creditoResiduoPrevisto).toBe(20);

    const [accesso] = await db.select().from(consegneTable).where(eq(consegneTable.id, fixture.accessoId));
    expect(accesso.statoAccessoEmporio).toBe("effettuato");
  });

  it("blocca apertura se Emporio è disabilitato", async () => {
    const fixture = await createFixture();
    await setEmporioEnabled(false);
    const res = await openSession(fixture.accessoId);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Il modulo Emporio Solidale è disabilitato.");
  });

  it.each(["annullato", "non_presentato"] as const)("blocca apertura da accesso %s", async (stato) => {
    const fixture = await createFixture();
    const accessoId = await createAccesso({ beneficiarioId: fixture.beneficiarioId, magazzinoId: fixture.magazzinoId, stato });
    const res = await openSession(accessoId);
    expect(res.status).toBe(400);
  });

  it("blocca apertura se beneficiario non è abilitato al Credito Solidale", async () => {
    const fixture = await createFixture({ creditoSolidaleAbilitato: false });
    const res = await openSession(fixture.accessoId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Il beneficiario non è abilitato al Credito Solidale.");
  });

  it("blocca apertura se Credito Solidale non è attivo", async () => {
    const fixture = await createFixture({ creditoSolidaleStato: "sospeso" });
    const res = await openSession(fixture.accessoId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Il Credito Solidale del beneficiario non è attivo.");
  });

  it("blocca apertura su magazzino logistico", async () => {
    const fixture = await createFixture({ tipoMagazzino: "logistico" });
    const res = await openSession(fixture.accessoId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("La Cassa Emporio può essere aperta solo su un magazzino di tipo Emporio o Misto.");
  });

  it("non crea due sessioni attive per lo stesso accesso e restituisce quella esistente", async () => {
    const fixture = await createFixture();
    const first = await openSession(fixture.accessoId);
    const second = await openSession(fixture.accessoId);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    const rows = await db.select().from(sessioniCassaEmporioTable).where(eq(sessioniCassaEmporioTable.accessoEmporioId, fixture.accessoId));
    expect(rows).toHaveLength(1);
  });

  it("ricerca beneficiario per codice tessera/codice a barre e include accessi validi", async () => {
    const codice = `BAR-${rnd()}`;
    const fixture = await createFixture({ codiceBeneficiario: codice });
    const res = await request(makeApp()).get("/cassa-emporio/beneficiari/ricerca").query({ search: codice });
    expect(res.status).toBe(200);
    expect(res.body[0].beneficiarioId).toBe(fixture.beneficiarioId);
    expect(res.body[0].accessi.map((a: { id: number }) => a.id)).toContain(fixture.accessoId);
  });

  it("mostra accessi validi filtrando per data, area ed Emporio anche senza testo di ricerca", async () => {
    const fixture = await createFixture();
    const otherCittaId = await createCitta();
    const otherCentroId = await createCentro(otherCittaId);
    const otherMagazzinoId = await createMagazzino("emporio", otherCittaId, otherCentroId);

    const list = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({ data: "2026-07-15", cittaId: fixture.cittaId, magazzinoEmporioId: fixture.magazzinoId });
    expect(list.status).toBe(200);
    expect(list.body.map((b: { beneficiarioId: number }) => b.beneficiarioId)).toContain(fixture.beneficiarioId);
    expect(list.body[0].accessi.map((a: { id: number }) => a.id)).toContain(fixture.accessoId);

    const wrongDate = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({ data: "2026-07-16", cittaId: fixture.cittaId, magazzinoEmporioId: fixture.magazzinoId });
    expect(wrongDate.body.map((b: { beneficiarioId: number }) => b.beneficiarioId)).not.toContain(fixture.beneficiarioId);

    const wrongEmporio = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({ data: "2026-07-15", cittaId: fixture.cittaId, magazzinoEmporioId: otherMagazzinoId });
    expect(wrongEmporio.body.map((b: { beneficiarioId: number }) => b.beneficiarioId)).not.toContain(fixture.beneficiarioId);
  });

  it("filtra le sessioni per data, area ed Emporio", async () => {
    const fixture = await createFixture();
    const sessione = await openSession(fixture.accessoId);
    const today = todayInput();

    const list = await request(makeApp())
      .get("/cassa-emporio/sessioni")
      .query({ data: today, cittaId: fixture.cittaId, magazzinoEmporioId: fixture.magazzinoId });
    expect(list.status).toBe(200);
    expect(list.body.map((s: { id: number }) => s.id)).toContain(sessione.body.id);

    const otherCittaId = await createCitta();
    const wrongArea = await request(makeApp())
      .get("/cassa-emporio/sessioni")
      .query({ data: today, cittaId: otherCittaId, magazzinoEmporioId: fixture.magazzinoId });
    expect(wrongArea.body.map((s: { id: number }) => s.id)).not.toContain(sessione.body.id);
  });

  it("ricerca prodotto per codice e codice a barre solo se abilitato Emporio", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, codice: `EMP-P-${rnd()}`, codiceBarre: `BAR-P-${rnd()}` });
    await createProdotto({ magazzinoId: fixture.magazzinoId, abilitatoEmporio: false, codice: `NOEMP-${rnd()}` });

    const byCode = await request(makeApp()).get("/cassa-emporio/prodotti/ricerca").query({ search: "EMP-P-", magazzinoEmporioId: fixture.magazzinoId });
    const byBarcode = await request(makeApp()).get("/cassa-emporio/prodotti/ricerca").query({ search: "BAR-P-", magazzinoEmporioId: fixture.magazzinoId });
    expect(byCode.status).toBe(200);
    expect(byBarcode.status).toBe(200);
    expect(byCode.body.map((p: { prodottoId: number }) => p.prodottoId)).toContain(prodottoId);
    expect(byBarcode.body.map((p: { prodottoId: number }) => p.prodottoId)).toContain(prodottoId);
  });

  it("ricerca prodotto mostra prodotto abilitato anche se la giacenza poi blocca l'aggiunta", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, codice: `GIAC-${rnd()}`, quantitaResidua: "0" });
    const sessione = await openSession(fixture.accessoId);
    const list = await request(makeApp()).get("/cassa-emporio/prodotti/ricerca").query({ search: "GIAC-", magazzinoEmporioId: fixture.magazzinoId });
    expect(list.status).toBe(200);
    expect(list.body.map((p: { prodottoId: number }) => p.prodottoId)).toContain(prodottoId);
    expect((await addProduct(sessione.body.id, prodottoId, 1)).status).toBe(400);
  });

  it("blocca prodotto non abilitato Emporio e prodotto senza Valore Credito Solidale", async () => {
    const fixture = await createFixture();
    const sessione = await openSession(fixture.accessoId);
    const nonAbilitato = await createProdotto({ magazzinoId: fixture.magazzinoId, abilitatoEmporio: false });
    const senzaCredito = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "0" });

    expect((await addProduct(sessione.body.id, nonAbilitato)).status).toBe(400);
    expect((await addProduct(sessione.body.id, senzaCredito)).status).toBe(400);
  });

  it("aggiunta, modifica quantità e rimozione aggiornano il totale Credito previsto", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "2.50" });
    const sessione = await openSession(fixture.accessoId);

    const add = await addProduct(sessione.body.id, prodottoId, 2);
    expect(add.status).toBe(201);
    let detail = await request(makeApp()).get(`/cassa-emporio/sessioni/${sessione.body.id}`);
    expect(detail.body.totaleCreditoPrevisto).toBe(5);

    const patch = await request(makeApp()).patch(`/cassa-emporio/sessioni/${sessione.body.id}/righe/${add.body.id}`).send({ quantita: 3 });
    expect(patch.status).toBe(200);
    detail = await request(makeApp()).get(`/cassa-emporio/sessioni/${sessione.body.id}`);
    expect(detail.body.totaleCreditoPrevisto).toBe(7.5);

    const del = await request(makeApp()).delete(`/cassa-emporio/sessioni/${sessione.body.id}/righe/${add.body.id}`);
    expect(del.status).toBe(200);
    expect(del.body.totaleCreditoPrevisto).toBe(0);
    rigaIds.splice(rigaIds.indexOf(add.body.id), 1);
  });

  it("blocca quantità zero o negativa", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId });
    const sessione = await openSession(fixture.accessoId);
    expect((await addProduct(sessione.body.id, prodottoId, 0)).status).toBe(400);
    expect((await addProduct(sessione.body.id, prodottoId, -1)).status).toBe(400);
  });

  it("blocca limite per singola spesa e limite mensile sulla sessione corrente", async () => {
    const fixture = await createFixture();
    const perSpesa = await createProdotto({ magazzinoId: fixture.magazzinoId, quantitaMassimaPerSpesa: "1" });
    const mensile = await createProdotto({ magazzinoId: fixture.magazzinoId, quantitaMassimaMensile: "1" });
    const sessione = await openSession(fixture.accessoId);
    expect((await addProduct(sessione.body.id, perSpesa, 2)).status).toBe(400);
    expect((await addProduct(sessione.body.id, mensile, 1)).status).toBe(201);
    expect((await addProduct(sessione.body.id, mensile, 1)).status).toBe(400);
  });

  it("blocca giacenza insufficiente senza scaricare il lotto", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, quantitaResidua: "1" });
    const sessione = await openSession(fixture.accessoId);
    const res = await addProduct(sessione.body.id, prodottoId, 2);
    expect(res.status).toBe(400);

    const [lotto] = await db.select().from(lottiTable).where(inArray(lottiTable.id, lottoIds));
    expect(lotto.quantitaResidua).toBe("1.00");
  });

  it("saldo insufficiente e carrello vuoto impediscono pronta_per_chiusura", async () => {
    const fixture = await createFixture({ saldo: "1.00" });
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "2.00" });
    const sessione = await openSession(fixture.accessoId);
    const empty = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/pronta-per-chiusura`).send({});
    expect(empty.status).toBe(400);

    await addProduct(sessione.body.id, prodottoId, 1);
    const ready = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/pronta-per-chiusura`).send({});
    expect(ready.status).toBe(400);
    expect(ready.body.error).toBe("Il totale Credito previsto supera il Saldo Credito Solidale disponibile.");
  });

  it("pronta_per_chiusura non crea movimenti, non scala saldo, non scarica giacenza, non crea bolle o scarichi", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "2.00", quantitaResidua: "5" });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 2);

    const [beneficiarioPrima] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, fixture.beneficiarioId));
    const [lottoPrima] = await db.select().from(lottiTable).where(inArray(lottiTable.id, lottoIds));
    const movimentiPrima = await db.select({ id: creditoSolidaleMovimentiTable.id }).from(creditoSolidaleMovimentiTable).where(eq(creditoSolidaleMovimentiTable.beneficiarioId, fixture.beneficiarioId));
    const bollePrima = await db.select({ id: bolleTable.id }).from(bolleTable).where(eq(bolleTable.beneficiarioId, fixture.beneficiarioId));
    const scarichiPrima = await db.select({ id: scarichiTable.id }).from(scarichiTable).where(eq(scarichiTable.magazzinoId, fixture.magazzinoId));

    const ready = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/pronta-per-chiusura`).send({});
    expect(ready.status).toBe(200);
    expect(ready.body.statoSessione).toBe("pronta_per_chiusura");

    const [beneficiarioDopo] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, fixture.beneficiarioId));
    const [lottoDopo] = await db.select().from(lottiTable).where(eq(lottiTable.id, lottoPrima.id));
    const movimentiDopo = await db.select({ id: creditoSolidaleMovimentiTable.id }).from(creditoSolidaleMovimentiTable).where(eq(creditoSolidaleMovimentiTable.beneficiarioId, fixture.beneficiarioId));
    const bolleDopo = await db.select({ id: bolleTable.id }).from(bolleTable).where(eq(bolleTable.beneficiarioId, fixture.beneficiarioId));
    const scarichiDopo = await db.select({ id: scarichiTable.id }).from(scarichiTable).where(eq(scarichiTable.magazzinoId, fixture.magazzinoId));

    expect(beneficiarioDopo.creditoSolidaleSaldo).toBe(beneficiarioPrima.creditoSolidaleSaldo);
    expect(lottoDopo.quantitaResidua).toBe(lottoPrima.quantitaResidua);
    expect(movimentiDopo.length).toBe(movimentiPrima.length);
    expect(bolleDopo.length).toBe(bollePrima.length);
    expect(scarichiDopo.length).toBe(scarichiPrima.length);
  });

  it("sospende, riprende e annulla con motivo; sessione annullata non è modificabile", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId });
    const sessione = await openSession(fixture.accessoId);

    const sospesa = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/sospendi`).send({});
    expect(sospesa.status).toBe(200);
    expect(sospesa.body.statoSessione).toBe("sospesa");

    const ripresa = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/riprendi`).send({});
    expect(ripresa.status).toBe(200);
    expect(ripresa.body.statoSessione).toBe("aperta");

    const annullata = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/annulla`).send({ motivoAnnullamento: "Errore operatore" });
    expect(annullata.status).toBe(200);
    expect(annullata.body.statoSessione).toBe("annullata");

    const add = await addProduct(sessione.body.id, prodottoId, 1);
    expect(add.status).toBe(400);
  });
});
