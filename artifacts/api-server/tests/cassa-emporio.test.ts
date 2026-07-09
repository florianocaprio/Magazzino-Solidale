import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  beneficiariTable,
  bolleTable,
  bollaRigheTable,
  centriAscoltoTable,
  cittaTable,
  consegneTable,
  creditoSolidaleMovimentiTable,
  db,
  lottiTable,
  magazziniTable,
  movimentiTable,
  pool,
  prodottiTable,
  scaricoRigheTable,
  scarichiTable,
  sessioniCassaEmporioRigheTable,
  sessioniCassaEmporioTable,
  speseEmporioRigheTable,
  speseEmporioTable,
} from "@workspace/db";
import cassaEmporioRouter from "../src/routes/cassa-emporio";
import bolleRouter from "../src/routes/bolle";
import speseEmporioRouter from "../src/routes/spese-emporio";
import creditoSolidaleRouter from "../src/routes/credito-solidale";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";

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
const spesaIds: number[] = [];
const bollaIds: number[] = [];
const scaricoIds: number[] = [];

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
  app.use(bolleRouter);
  app.use(speseEmporioRouter);
  app.use(creditoSolidaleRouter);
  return app;
}

async function setEmporioEnabled(enabled: boolean): Promise<void> {
  await updateModuloAmbiente("EMPORIO_SOLIDALE", enabled, null);
}

async function createCitta(): Promise<number> {
  const [citta] = await db.insert(cittaTable).values({ nome: `Citta ${rnd()}` }).returning({ id: cittaTable.id });
  cittaIds.push(citta.id);
  return citta.id;
}

async function createCentro(cittaId: number, email?: string | null): Promise<number> {
  const [centro] = await db.insert(centriAscoltoTable).values({ nome: `Centro ${rnd()}`, cittaId, email }).returning({ id: centriAscoltoTable.id });
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
  cognome?: string;
  nome?: string;
  email?: string | null;
  magazzinoEmporioPreferitoId?: number | null;
}): Promise<number> {
  const [beneficiario] = await db
    .insert(beneficiariTable)
    .values({
      codice: opts.codice ?? `BEN-${rnd()}`,
      cognome: opts.cognome ?? `Cassa ${rnd()}`,
      nome: opts.nome ?? "Emporio",
      email: opts.email,
      sesso: "M",
      cittaId: opts.cittaId,
      centroAscoltoId: opts.centroAscoltoId,
      creditoSolidaleAbilitato: opts.creditoSolidaleAbilitato ?? true,
      creditoSolidaleStato: opts.creditoSolidaleStato ?? "attivo",
      creditoSolidaleSaldo: opts.saldo ?? "20.00",
      creditoSolidaleMensileAssegnato: "25.00",
      magazzinoEmporioPreferitoId: opts.magazzinoEmporioPreferitoId,
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
  centroEmail?: string | null;
  beneficiarioEmail?: string | null;
} = {}) {
  const cittaId = await createCitta();
  const centroId = await createCentro(cittaId, opts.centroEmail);
  const magazzinoId = await createMagazzino(opts.tipoMagazzino ?? "emporio", cittaId, centroId);
  const beneficiarioId = await createBeneficiario({
    cittaId,
    centroAscoltoId: centroId,
    creditoSolidaleAbilitato: opts.creditoSolidaleAbilitato,
    creditoSolidaleStato: opts.creditoSolidaleStato,
    saldo: opts.saldo,
    codice: opts.codiceBeneficiario,
    email: opts.beneficiarioEmail,
    magazzinoEmporioPreferitoId: magazzinoId,
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

async function trackSpesa(spesaId: number): Promise<void> {
  spesaIds.push(spesaId);
  const [spesa] = await db.select().from(speseEmporioTable).where(eq(speseEmporioTable.id, spesaId));
  if (spesa?.bollaId != null) bollaIds.push(spesa.bollaId);
  if (spesa?.scaricoId != null) scaricoIds.push(spesa.scaricoId);
}

beforeEach(async () => {
  await setEmporioEnabled(true);
});

afterEach(async () => {
  const currentSpesaIds = spesaIds.splice(0);
  const currentBollaIds = bollaIds.splice(0);
  const currentScaricoIds = scaricoIds.splice(0);
  const currentRigaIds = rigaIds.splice(0);
  const currentSessioneIds = sessioneIds.splice(0);
  const currentConsegnaIds = consegnaIds.splice(0);
  const currentBeneficiarioIds = beneficiarioIds.splice(0);
  const currentMagazzinoIds = magazzinoIds.splice(0);

  if (currentSpesaIds.length > 0) await db.delete(speseEmporioRigheTable).where(inArray(speseEmporioRigheTable.spesaEmporioId, currentSpesaIds));
  if (currentSpesaIds.length > 0) await db.delete(speseEmporioTable).where(inArray(speseEmporioTable.id, currentSpesaIds));
  if (currentRigaIds.length > 0) await db.delete(sessioniCassaEmporioRigheTable).where(inArray(sessioniCassaEmporioRigheTable.id, currentRigaIds));
  if (currentSessioneIds.length > 0) await db.delete(sessioniCassaEmporioTable).where(inArray(sessioniCassaEmporioTable.id, currentSessioneIds));
  if (currentBollaIds.length > 0) await db.delete(movimentiTable).where(inArray(movimentiTable.bollaId, currentBollaIds));
  if (currentBollaIds.length > 0) await db.delete(bollaRigheTable).where(inArray(bollaRigheTable.bollaId, currentBollaIds));
  if (currentScaricoIds.length > 0) await db.delete(scaricoRigheTable).where(inArray(scaricoRigheTable.scaricoId, currentScaricoIds));
  if (currentBollaIds.length > 0) await db.delete(bolleTable).where(inArray(bolleTable.id, currentBollaIds));
  if (currentScaricoIds.length > 0) await db.delete(scarichiTable).where(inArray(scarichiTable.id, currentScaricoIds));
  if (currentBeneficiarioIds.length > 0) await db.delete(creditoSolidaleMovimentiTable).where(inArray(creditoSolidaleMovimentiTable.beneficiarioId, currentBeneficiarioIds));
  if (currentConsegnaIds.length > 0) await db.delete(consegneTable).where(inArray(consegneTable.id, currentConsegnaIds));
  if (lottoIds.length > 0) await db.delete(lottiTable).where(inArray(lottiTable.id, lottoIds.splice(0)));
  if (prodottoIds.length > 0) await db.delete(prodottiTable).where(inArray(prodottiTable.id, prodottoIds.splice(0)));
  if (currentBeneficiarioIds.length > 0) await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, currentBeneficiarioIds));
  if (currentMagazzinoIds.length > 0) await db.delete(magazziniTable).where(inArray(magazziniTable.id, currentMagazzinoIds));
  if (centroIds.length > 0) await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centroIds.splice(0)));
  if (cittaIds.length > 0) await db.delete(cittaTable).where(inArray(cittaTable.id, cittaIds.splice(0)));
  await setEmporioEnabled(false);
});

afterAll(async () => {
  await setEmporioEnabled(true);
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
    expect(res.body.error).toBe("Il modulo Emporio Solidale è disabilitato. Abilitalo da Impostazioni Moduli per utilizzare questa funzione.");
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

  it("forza un Accesso Emporio dalla Cassa e apre una sessione tracciata", async () => {
    const cittaId = await createCitta();
    const centroId = await createCentro(cittaId);
    const magazzinoId = await createMagazzino("emporio", cittaId, centroId);
    const beneficiarioId = await createBeneficiario({ cittaId, centroAscoltoId: centroId, saldo: "15.00" });

    const res = await request(makeApp()).post("/cassa-emporio/accessi/forza").send({
      beneficiarioId,
      magazzinoEmporioId: magazzinoId,
      motivoAccessoForzato: "Beneficiario presente senza pianificazione",
    });
    expect(res.status).toBe(201);
    consegnaIds.push(res.body.accessoEmporioId);
    sessioneIds.push(res.body.sessione.id);
    expect(res.body.origineAccesso).toBe("forzato_da_cassa");
    expect(res.body.sessione.statoSessione).toBe("aperta");
    expect(res.body.sessione.saldoCreditoIniziale).toBe(15);

    const [accesso] = await db.select().from(consegneTable).where(eq(consegneTable.id, res.body.accessoEmporioId));
    expect(accesso.accessoForzato).toBe(true);
    expect(accesso.origineAccesso).toBe("forzato_da_cassa");
    expect(accesso.motivoAccessoForzato).toBe("Beneficiario presente senza pianificazione");
    expect(accesso.statoAccessoEmporio).toBe("effettuato");

    const duplicate = await request(makeApp()).post("/cassa-emporio/accessi/forza").send({
      beneficiarioId,
      magazzinoEmporioId: magazzinoId,
      motivoAccessoForzato: "Secondo tentativo",
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.sessione.id).toBe(res.body.sessione.id);
  });

  it("ricerca beneficiario per codice tessera/codice a barre e include accessi validi", async () => {
    const codice = `BAR-${rnd()}`;
    const fixture = await createFixture({ codiceBeneficiario: codice });
    const res = await request(makeApp()).get("/cassa-emporio/beneficiari/ricerca").query({ search: codice, cittaId: fixture.cittaId });
    expect(res.status).toBe(200);
    expect(res.body[0].beneficiarioId).toBe(fixture.beneficiarioId);
    expect(res.body[0].accessi.map((a: { id: number }) => a.id)).toContain(fixture.accessoId);

    const scanned = await request(makeApp()).get("/cassa-emporio/beneficiari/ricerca").query({ search: codice.replace(/[^a-zA-Z0-9]/g, ""), cittaId: fixture.cittaId });
    expect(scanned.status).toBe(200);
    expect(scanned.body.map((b: { beneficiarioId: number }) => b.beneficiarioId)).toContain(fixture.beneficiarioId);
  });

  it("mostra beneficiari accreditati anche senza Accesso Emporio pianificato", async () => {
    const cittaId = await createCitta();
    const centroId = await createCentro(cittaId);
    await createMagazzino("emporio", cittaId, centroId);
    const suffix = rnd();
    const popescuCognome = `Popescu${suffix}`;
    const popescuId = await createBeneficiario({ cittaId, centroAscoltoId: centroId, cognome: popescuCognome, nome: "Pavel", saldo: "80.00" });
    const galliId = await createBeneficiario({ cittaId, centroAscoltoId: centroId, cognome: `Galli${suffix}`, nome: "Lucia", saldo: "0.00" });

    const byArea = await request(makeApp()).get("/cassa-emporio/beneficiari/ricerca").query({ cittaId });
    expect(byArea.status).toBe(200);
    expect(byArea.body.map((b: { beneficiarioId: number }) => b.beneficiarioId)).toEqual(expect.arrayContaining([popescuId, galliId]));

    const byName = await request(makeApp()).get("/cassa-emporio/beneficiari/ricerca").query({ search: `${popescuCognome} Pavel` });
    expect(byName.status).toBe(200);
    expect(byName.body.map((b: { beneficiarioId: number }) => b.beneficiarioId)).toContain(popescuId);
    const popescuRow = byName.body.find((b: { beneficiarioId: number }) => b.beneficiarioId === popescuId);
    expect(popescuRow.accessi).toEqual([]);
  });

  it("ricerca in Cassa i beneficiari accreditati sull'Emporio selezionato anche se l'anagrafica è di un'altra Area", async () => {
    const romaId = await createCitta();
    const centroRomaId = await createCentro(romaId);
    const emporioRomaId = await createMagazzino("emporio", romaId, centroRomaId);
    const bolognaId = await createCitta();
    const centroBolognaId = await createCentro(bolognaId);
    const galliId = await createBeneficiario({
      cittaId: bolognaId,
      centroAscoltoId: centroBolognaId,
      cognome: "Galli",
      nome: "Lucia",
      saldo: "100.00",
      codice: `BEN-GALLI-${rnd()}`,
      magazzinoEmporioPreferitoId: emporioRomaId,
    });

    const res = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({ search: "Galli Luciana", cittaId: romaId, magazzinoEmporioId: emporioRomaId });

    expect(res.status).toBe(200);
    expect(res.body.map((b: { beneficiarioId: number }) => b.beneficiarioId)).toContain(galliId);
  });

  it("non mostra beneficiari Cassa senza Area o Emporio e scarta beneficiari non eleggibili", async () => {
    const fixture = await createFixture();
    const nonAbilitatoId = await createBeneficiario({
      cittaId: fixture.cittaId,
      centroAscoltoId: fixture.centroId,
      creditoSolidaleAbilitato: false,
      creditoSolidaleStato: "non_abilitato",
    });
    await createAccesso({ beneficiarioId: nonAbilitatoId, magazzinoId: fixture.magazzinoId });

    const noArea = await request(makeApp()).get("/cassa-emporio/beneficiari/ricerca");
    expect(noArea.status).toBe(200);
    expect(noArea.body).toHaveLength(0);

    const searchWithoutArea = await request(makeApp()).get("/cassa-emporio/beneficiari/ricerca").query({ search: "Cassa" });
    expect(searchWithoutArea.status).toBe(200);
    expect(searchWithoutArea.body.map((b: { beneficiarioId: number }) => b.beneficiarioId)).toContain(fixture.beneficiarioId);

    const byArea = await request(makeApp()).get("/cassa-emporio/beneficiari/ricerca").query({ data: "2026-07-15", cittaId: fixture.cittaId });
    expect(byArea.status).toBe(200);
    const ids = byArea.body.map((b: { beneficiarioId: number }) => b.beneficiarioId);
    expect(ids).toContain(fixture.beneficiarioId);
    expect(ids).not.toContain(nonAbilitatoId);
  });

  it("mostra beneficiari accreditati e filtra gli accessi validi per data, area ed Emporio", async () => {
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
    const wrongDateRow = wrongDate.body.find((b: { beneficiarioId: number }) => b.beneficiarioId === fixture.beneficiarioId);
    expect(wrongDateRow?.accessi).toEqual([]);

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

  it("ricerca prodotto per nome, codice e codice a barre solo se abilitato Emporio", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      codice: `EMP-P-${rnd()}`,
      codiceBarre: `BAR-P-${rnd()}`,
    });
    const nonAbilitato = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      codice: `NOEMP-${rnd()}`,
      abilitatoEmporio: false,
    });
    const senzaCredito = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "0" });

    const byCode = await request(makeApp()).get("/cassa-emporio/prodotti/ricerca").query({ search: "EMP-P-", magazzinoEmporioId: fixture.magazzinoId });
    const byBarcode = await request(makeApp()).get("/cassa-emporio/prodotti/ricerca").query({ search: "BAR-P-", magazzinoEmporioId: fixture.magazzinoId });
    const byName = await request(makeApp()).get("/cassa-emporio/prodotti/ricerca").query({ search: "Prodotto", magazzinoEmporioId: fixture.magazzinoId });
    const emptyCombo = await request(makeApp()).get("/cassa-emporio/prodotti/ricerca").query({ magazzinoEmporioId: fixture.magazzinoId });
    expect(byCode.status).toBe(200);
    expect(byBarcode.status).toBe(200);
    expect(byName.status).toBe(200);
    expect(emptyCombo.status).toBe(200);
    expect(byCode.body.map((p: { prodottoId: number }) => p.prodottoId)).toContain(prodottoId);
    expect(byBarcode.body.map((p: { prodottoId: number }) => p.prodottoId)).toContain(prodottoId);
    expect(byName.body.map((p: { prodottoId: number }) => p.prodottoId)).toContain(prodottoId);
    expect(emptyCombo.body.map((p: { prodottoId: number }) => p.prodottoId)).toContain(prodottoId);
    expect(emptyCombo.body.map((p: { prodottoId: number }) => p.prodottoId)).not.toContain(nonAbilitato);
    expect(emptyCombo.body.map((p: { prodottoId: number }) => p.prodottoId)).not.toContain(senzaCredito);
  });

  it("ricerca prodotto mostra solo prodotti disponibili nell'Emporio e l'aggiunta blocca la giacenza assente", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, codice: `GIAC-${rnd()}`, quantitaResidua: "0" });
    const sessione = await openSession(fixture.accessoId);
    const list = await request(makeApp()).get("/cassa-emporio/prodotti/ricerca").query({ search: "GIAC-", magazzinoEmporioId: fixture.magazzinoId });
    expect(list.status).toBe(200);
    expect(list.body.map((p: { prodottoId: number }) => p.prodottoId)).not.toContain(prodottoId);
    const add = await addProduct(sessione.body.id, prodottoId, 1);
    expect(add.status).toBe(400);
    expect(add.body.error).toBe("La quantità richiesta supera la giacenza disponibile nel magazzino Emporio selezionato.");
  });

  it("blocca prodotto non abilitato Emporio e prodotto senza Valore Credito Solidale", async () => {
    const fixture = await createFixture();
    const sessione = await openSession(fixture.accessoId);
    const nonAbilitato = await createProdotto({ magazzinoId: fixture.magazzinoId, abilitatoEmporio: false });
    const senzaCredito = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "0" });

    const blocked = await addProduct(sessione.body.id, nonAbilitato);
    const noCredit = await addProduct(sessione.body.id, senzaCredito);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe("Il prodotto non è abilitato per Emporio. Abilitalo nella scheda prodotto prima di aggiungerlo al carrello.");
    expect(noCredit.status).toBe(400);
    expect(noCredit.body.error).toBe("Il prodotto non ha un Valore Credito Solidale configurato. Imposta il valore nella scheda prodotto.");
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

    const ready = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/pronta-per-chiusura`).send({});
    expect(ready.status).toBe(200);
    expect(ready.body.statoSessione).toBe("pronta_per_chiusura");

    const del = await request(makeApp()).delete(`/cassa-emporio/sessioni/${sessione.body.id}/righe/${add.body.id}`);
    expect(del.status).toBe(200);
    expect(del.body.statoSessione).toBe("aperta");
    expect(del.body.totaleCreditoPrevisto).toBe(0);
    expect(del.body.righe).toHaveLength(0);
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
    expect(ready.body.error).toBe("Saldo Credito Solidale insufficiente. Riduci il carrello o effettua una ricarica prima della chiusura.");
  });

  it("ricalcola il credito residuo usando il saldo corrente del beneficiario", async () => {
    const fixture = await createFixture({ saldo: "0.00" });
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "2.00" });
    const sessione = await openSession(fixture.accessoId);
    expect(sessione.body.saldoCreditoIniziale).toBe(0);

    await db
      .update(beneficiariTable)
      .set({ creditoSolidaleSaldo: "70.00" })
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));

    const add = await addProduct(sessione.body.id, prodottoId, 1);
    expect(add.status).toBe(201);
    const detail = await request(makeApp()).get(`/cassa-emporio/sessioni/${sessione.body.id}`);
    expect(detail.body.saldoCreditoIniziale).toBe(70);
    expect(detail.body.totaleCreditoPrevisto).toBe(2);
    expect(detail.body.creditoResiduoPrevisto).toBe(68);
    const ready = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/pronta-per-chiusura`).send({});
    expect(ready.status).toBe(200);
  });

  it("aggiorna il Credito Solidale da Cassa usando la quota mensile senza duplicare il periodo", async () => {
    const fixture = await createFixture({ saldo: "0.00" });
    const sessione = await openSession(fixture.accessoId);
    expect(sessione.body.saldoCreditoIniziale).toBe(0);

    const first = await request(makeApp())
      .post(`/credito-solidale/beneficiari/${fixture.beneficiarioId}/refresh-credito`)
      .send({ periodoRiferimento: "2026-07" });
    expect(first.status).toBe(201);
    expect(first.body.ricaricaEseguita).toBe(true);
    expect(first.body.movimento.tipoMovimento).toBe("ricarica_mensile");
    expect(first.body.movimento.variazioneCredito).toBe(25);
    expect(first.body.saldo.saldoAttuale).toBe(25);

    const refreshedSessione = await request(makeApp()).get(`/cassa-emporio/sessioni/${sessione.body.id}`);
    expect(refreshedSessione.status).toBe(200);
    expect(refreshedSessione.body.saldoCreditoIniziale).toBe(25);
    expect(refreshedSessione.body.creditoResiduoPrevisto).toBe(25);

    const second = await request(makeApp())
      .post(`/credito-solidale/beneficiari/${fixture.beneficiarioId}/refresh-credito`)
      .send({ periodoRiferimento: "2026-07" });
    expect(second.status).toBe(200);
    expect(second.body.ricaricaEseguita).toBe(false);
    expect(second.body.movimento).toBeNull();
    expect(second.body.saldo.saldoAttuale).toBe(25);
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

  it("chiude una sessione pronta creando Spesa Emporio, bolla, scarico, movimento credito e aggiornando saldo e giacenza", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "2.00", quantitaResidua: "5" });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 2);
    const ready = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/pronta-per-chiusura`).send({});
    expect(ready.status).toBe(200);

    const close = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/chiudi`).send({});
    expect(close.status).toBe(200);
    await trackSpesa(close.body.spesa.id);
    expect(close.body.sessione.statoSessione).toBe("chiusa");
    expect(close.body.spesa.numeroSpesa).toMatch(/^EMP-\d{4}-\d{5}$/);
    expect(close.body.spesa.totaleCreditoConsumati).toBe(4);
    expect(close.body.spesa.saldoPrima).toBe(20);
    expect(close.body.spesa.saldoDopo).toBe(16);
    expect(close.body.emailBolla.stato).toBe("non_preparata");
    expect(close.body.emailBolla.destinatari).toEqual([]);
    expect(close.body.messaggio).toBe("Spesa Emporio chiusa correttamente.");

    const [beneficiario] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, fixture.beneficiarioId));
    const [lotto] = await db.select().from(lottiTable).where(inArray(lottiTable.id, lottoIds));
    const [sessioneChiusa] = await db.select().from(sessioniCassaEmporioTable).where(eq(sessioniCassaEmporioTable.id, sessione.body.id));
    const [spesa] = await db.select().from(speseEmporioTable).where(eq(speseEmporioTable.id, close.body.spesa.id));
    const righeSpesa = await db.select().from(speseEmporioRigheTable).where(eq(speseEmporioRigheTable.spesaEmporioId, spesa.id));
    const [movimentoCredito] = await db
      .select()
      .from(creditoSolidaleMovimentiTable)
      .where(eq(creditoSolidaleMovimentiTable.id, spesa.movimentoCreditoSolidaleId!));
    const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, spesa.bollaId!));
    const righeBolla = await db.select().from(bollaRigheTable).where(eq(bollaRigheTable.bollaId, spesa.bollaId!));
    const [scarico] = await db.select().from(scarichiTable).where(eq(scarichiTable.id, spesa.scaricoId!));
    const righeScarico = await db.select().from(scaricoRigheTable).where(eq(scaricoRigheTable.scaricoId, spesa.scaricoId!));
    const [accesso] = await db.select().from(consegneTable).where(eq(consegneTable.id, fixture.accessoId));

    expect(beneficiario.creditoSolidaleSaldo).toBe("16.00");
    expect(lotto.quantitaResidua).toBe("3.00");
    expect(sessioneChiusa.spesaEmporioId).toBe(spesa.id);
    expect(righeSpesa).toHaveLength(1);
    expect(righeSpesa[0].creditoTotale).toBe("4.00");
    expect(movimentoCredito.tipoMovimento).toBe("consumo_spesa");
    expect(movimentoCredito.variazioneCredito).toBe("-4.00");
    expect(bolla.stato).toBe("consegnato");
    expect(righeBolla).toHaveLength(1);
    const dettaglioBolla = await request(makeApp()).get(`/bolle/${spesa.bollaId}`);
    expect(dettaglioBolla.status).toBe(200);
    expect(dettaglioBolla.body.righe).toHaveLength(1);
    expect(dettaglioBolla.body.righe[0].prodottoId).toBe(prodottoId);
    expect(dettaglioBolla.body.righe[0].quantita).toBe(2);
    await db
      .update(speseEmporioRigheTable)
      .set({ bollaRigaId: null })
      .where(eq(speseEmporioRigheTable.spesaEmporioId, spesa.id));
    await db.delete(bollaRigheTable).where(eq(bollaRigheTable.bollaId, spesa.bollaId!));
    const dettaglioBollaFallback = await request(makeApp()).get(`/bolle/${spesa.bollaId}`);
    expect(dettaglioBollaFallback.status).toBe(200);
    expect(dettaglioBollaFallback.body.righe).toHaveLength(1);
    expect(dettaglioBollaFallback.body.righe[0].prodottoId).toBe(prodottoId);
    expect(dettaglioBollaFallback.body.righe[0].quantita).toBe(2);
    expect(scarico.causaleAltro).toBe("Spesa Emporio");
    expect(righeScarico).toHaveLength(1);
    expect(accesso.statoAccessoEmporio).toBe("effettuato");
  });

  it("prepara la Bolla via mailto manuale e registra il click senza invio SMTP", async () => {
    const centroEmail = `centro-${rnd()}@example.org`;
    const fixture = await createFixture({ saldo: "20.00", centroEmail, beneficiarioEmail: `benef-${rnd()}@example.org` });
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "2.00", quantitaResidua: "5" });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 1);
    await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/pronta-per-chiusura`).send({});
    const close = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/chiudi`).send({});
    await trackSpesa(close.body.spesa.id);

    const linkBolla = `https://magazzino.test/spese-emporio/${close.body.spesa.id}/bolla-stampa`;
    const res = await request(makeApp())
      .post(`/spese-emporio/${close.body.spesa.id}/registra-invio-manuale-bolla`)
      .send({ linkBolla });

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("invio_manuale_avviato");
    expect(res.body.destinatari[0]).toBe(centroEmail);
    expect(res.body.oggetto).toBe(`Bolla Emporio Solidale ${close.body.spesa.bollaNumero} - ${close.body.spesa.beneficiarioNome}`);
    expect(res.body.corpo).toContain(linkBolla);
    expect(res.body.corpo).toContain(close.body.spesa.numeroSpesa);
    expect(res.body.corpo).not.toMatch(/euro|prezz|gift card|wallet|importo/i);
    expect(res.body.mailtoHref).toContain(`mailto:${encodeURIComponent(centroEmail)}`);
    expect(res.body.mailtoHref).toContain("subject=Bolla%20Emporio%20Solidale");
    expect(res.body.mailtoHref).not.toMatch(/attach/i);

    const [spesa] = await db.select().from(speseEmporioTable).where(eq(speseEmporioTable.id, close.body.spesa.id));
    expect(spesa.emailBollaStato).toBe("invio_manuale_avviato");
    expect(spesa.emailBollaDestinatari).toContain(centroEmail);
    expect(spesa.emailBollaDataUltimoClick).toBeTruthy();
    expect(spesa.emailBollaOperatoreId).toBe(1);
    expect(spesa.emailBollaOggetto).toBe(res.body.oggetto);
  });

  it("prepara link e testo Bolla anche quando non esiste un destinatario email", async () => {
    const fixture = await createFixture({ saldo: "20.00", centroEmail: null, beneficiarioEmail: null });
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "2.00", quantitaResidua: "5" });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 1);
    await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/pronta-per-chiusura`).send({});
    const close = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/chiudi`).send({});
    await trackSpesa(close.body.spesa.id);

    const linkBolla = `https://magazzino.test/spese-emporio/${close.body.spesa.id}/bolla-stampa`;
    const res = await request(makeApp())
      .post(`/spese-emporio/${close.body.spesa.id}/registra-invio-manuale-bolla`)
      .send({ linkBolla });

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("nessun_destinatario");
    expect(res.body.destinatari).toEqual([]);
    expect(res.body.mailtoHref).toBeNull();
    expect(res.body.linkBolla).toBe(linkBolla);
    expect(res.body.corpo).toContain(linkBolla);
    expect(res.body.messaggio).toBe("Nessun destinatario email disponibile. Copia manualmente il link alla Bolla e invialo dal tuo client di posta.");

    const [spesa] = await db.select().from(speseEmporioTable).where(eq(speseEmporioTable.id, close.body.spesa.id));
    expect(spesa.emailBollaStato).toBe("nessun_destinatario");
    expect(spesa.emailBollaDestinatari).toBeNull();
    expect(spesa.emailBollaErrore).toBe("Nessun destinatario email disponibile. Copia manualmente il link alla Bolla e invialo dal tuo client di posta.");
  });

  it("non chiude una sessione non pronta", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const sessione = await openSession(fixture.accessoId);
    const close = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/chiudi`).send({});
    expect(close.status).toBe(400);
    expect(close.body.error).toBe("La sessione Cassa Emporio non è pronta per la chiusura.");
  });

  it("non chiude due volte la stessa sessione", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "2.00", quantitaResidua: "5" });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 1);
    await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/pronta-per-chiusura`).send({});

    const first = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/chiudi`).send({});
    expect(first.status).toBe(200);
    await trackSpesa(first.body.spesa.id);

    const second = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/chiudi`).send({});
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("La sessione Cassa Emporio risulta già chiusa. Non è possibile chiudere due volte la stessa spesa.");
  });

  it("annulla atomicamente la chiusura se la giacenza diventa insufficiente", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({ magazzinoId: fixture.magazzinoId, creditoSolidaleValore: "2.00", quantitaResidua: "1" });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 1);
    await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/pronta-per-chiusura`).send({});
    await db.update(lottiTable).set({ quantitaResidua: "0.00" }).where(eq(lottiTable.id, lottoIds[lottoIds.length - 1]));

    const close = await request(makeApp()).post(`/cassa-emporio/sessioni/${sessione.body.id}/chiudi`).send({});
    expect(close.status).toBe(409);
    expect(close.body.error).toBe("Giacenza insufficiente per chiudere la spesa Emporio. Verifica le disponibilità di magazzino prima di riprovare.");

    const [beneficiario] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, fixture.beneficiarioId));
    const [sessioneDopo] = await db.select().from(sessioniCassaEmporioTable).where(eq(sessioniCassaEmporioTable.id, sessione.body.id));
    const spese = await db.select().from(speseEmporioTable).where(eq(speseEmporioTable.sessioneCassaId, sessione.body.id));
    const movimentiCredito = await db.select().from(creditoSolidaleMovimentiTable).where(eq(creditoSolidaleMovimentiTable.beneficiarioId, fixture.beneficiarioId));

    expect(beneficiario.creditoSolidaleSaldo).toBe("20.00");
    expect(sessioneDopo.statoSessione).toBe("pronta_per_chiusura");
    expect(spese).toHaveLength(0);
    expect(movimentiCredito).toHaveLength(0);
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
