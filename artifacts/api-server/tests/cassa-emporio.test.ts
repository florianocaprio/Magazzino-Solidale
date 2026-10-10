import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import {
  beneficiariTable,
  auditConfigurazioniTable,
  auditEventiTable,
  bolleTable,
  bollaRigheTable,
  centriAscoltoTable,
  areeOperativeTable,
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
  speseEmporioStorniRigheTable,
  speseEmporioStorniTable,
  speseEmporioTable,
  utentiTable,
  operazioniDistribuzioneMagazzinoTable,
  prenotazioniMagazzinoTable,
  trasferimentiTable,
  trasferimentoRigheTable,
  menseTable,
  mensaConsumiTable,
  mensaGiornateServizioTable,
  ruoliTable,
  emporioAbilitazioniTable,
} from "@workspace/db";
import cassaEmporioRouter from "../src/routes/cassa-emporio";
import bolleRouter from "../src/routes/bolle";
import trasferimentiRouter from "../src/routes/trasferimenti";
import scarichiRouter from "../src/routes/scarichi";
import mensaRouter from "../src/routes/mensa";
import {
  creaScaricoInventariale,
  InventoryError,
} from "../src/lib/scaricoInventory";
import speseEmporioRouter from "../src/routes/spese-emporio";
import creditoSolidaleRouter from "../src/routes/credito-solidale";
import prodottiRouter from "../src/routes/prodotti";
import politicheCreditoSolidaleRouter from "../src/routes/politiche-credito-solidale";
import { httpListeners } from "./helpers/http-listeners";
import {
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import { dataCivileEuropeRome } from "../src/lib/interventiWorkflow";
import { quantitaNettaMensileProdotto } from "../src/lib/speseEmporio";
import {
  emporioActorFixture,
  cleanupEmporioActorFixtures,
  grantEmporioEligibilityFixture,
} from "./helpers/emporio-actor";

const rnd = () => Math.random().toString(36).slice(2, 8);

const areaOperativaIds: number[] = [];
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
const transferIds: number[] = [];
const mensaIds: number[] = [];
let operatorUserId: number;
const cListeners = httpListeners({ diagnostics: "m62c" });

function makeApp(
  options: {
    isAdmin?: boolean;
    permessi?: string[];
    aree?: string[];
    centroAscoltoId?: number | null;
    areaOperativaId?: number | null;
  } = {},
): Express {
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    (
      req as unknown as {
        user: {
          id: number;
          centroAscoltoId: number | null;
          areaOperativaId: number | null;
          isAdmin: boolean;
          permessi: string[];
          aree: string[];
        };
      }
    ).user = {
      id: operatorUserId,
      centroAscoltoId: options.centroAscoltoId ?? null,
      areaOperativaId: options.areaOperativaId ?? null,
      isAdmin: options.isAdmin ?? true,
      permessi: options.permessi ?? [],
      aree: options.aree ?? ["emporio"],
    };
    req.user = await emporioActorFixture(req.user!);
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

async function createAreaOperativa(): Promise<number> {
  const [areaOperativa] = await db
    .insert(areeOperativeTable)
    .values({ nome: `AreaOperativa ${rnd()}` })
    .returning({ id: areeOperativeTable.id });
  areaOperativaIds.push(areaOperativa.id);
  return areaOperativa.id;
}

async function createCentro(
  areaOperativaId: number,
  email?: string | null,
): Promise<number> {
  const [centro] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `Centro ${rnd()}`, areaOperativaId, email })
    .returning({ id: centriAscoltoTable.id });
  centroIds.push(centro.id);
  return centro.id;
}

async function createMagazzino(
  tipoMagazzino: "emporio" | "misto" | "logistico",
  areaOperativaId: number,
  centroAscoltoId: number,
): Promise<number> {
  const [magazzino] = await db
    .insert(magazziniTable)
    .values({
      codice: `MAG-${rnd()}`,
      nome: `Mag ${rnd()}`,
      tipoMagazzino,
      areaOperativaId,
      centroAscoltoId,
    })
    .returning({ id: magazziniTable.id });
  magazzinoIds.push(magazzino.id);
  return magazzino.id;
}

async function createBeneficiario(opts: {
  areaOperativaId: number;
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
      areaOperativaId: opts.areaOperativaId,
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
  await grantEmporioEligibilityFixture(beneficiario.id, opts.areaOperativaId);
  return beneficiario.id;
}

async function createAccesso(opts: {
  beneficiarioId: number;
  magazzinoId: number;
  stato?:
    | "pianificato"
    | "confermato"
    | "effettuato"
    | "annullato"
    | "non_presentato";
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
      stato:
        stato === "annullato"
          ? "annullata"
          : stato === "non_presentato"
            ? "mancata"
            : "pianificata",
      statoAccessoEmporio: stato,
    })
    .returning({ id: consegneTable.id });
  consegnaIds.push(accesso.id);
  return accesso.id;
}

function todayInput(): string {
  return dataCivileEuropeRome();
}

async function createFixture(
  opts: {
    tipoMagazzino?: "emporio" | "misto" | "logistico";
    creditoSolidaleAbilitato?: boolean;
    creditoSolidaleStato?: "non_abilitato" | "attivo" | "sospeso" | "revocato";
    saldo?: string;
    codiceBeneficiario?: string;
    centroEmail?: string | null;
    beneficiarioEmail?: string | null;
  } = {},
) {
  const areaOperativaId = await createAreaOperativa();
  const centroId = await createCentro(areaOperativaId, opts.centroEmail);
  const magazzinoId = await createMagazzino(
    opts.tipoMagazzino ?? "emporio",
    areaOperativaId,
    centroId,
  );
  const beneficiarioId = await createBeneficiario({
    areaOperativaId,
    centroAscoltoId: centroId,
    creditoSolidaleAbilitato: opts.creditoSolidaleAbilitato,
    creditoSolidaleStato: opts.creditoSolidaleStato,
    saldo: opts.saldo,
    codice: opts.codiceBeneficiario,
    email: opts.beneficiarioEmail,
    magazzinoEmporioPreferitoId: magazzinoId,
  });
  const accessoId = await createAccesso({ beneficiarioId, magazzinoId });
  return { areaOperativaId, centroId, magazzinoId, beneficiarioId, accessoId };
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
  unitaMisura?: string;
  quantitaFrazionabile?: boolean;
  dataScadenza?: string | null;
  fsePlus?: boolean;
}): Promise<number> {
  const [prodotto] = await db
    .insert(prodottiTable)
    .values({
      codice: opts.codice ?? `PRO-${rnd()}`,
      nome: `Prodotto ${rnd()}`,
      descrizione: "Prodotto Emporio",
      tipoProdotto: "alimenti",
      unitaMisura: opts.unitaMisura ?? "pz",
      quantitaFrazionabile:
        opts.quantitaFrazionabile ??
        ["kg", "l", "lt"].includes(
          (opts.unitaMisura ?? "pz").trim().toLowerCase(),
        ),
      codiceBarre:
        opts.codiceBarre ??
        `200${Math.floor(Math.random() * 1_000_000_000)
          .toString()
          .padStart(9, "0")}0`,
      abilitatoEmporio: opts.abilitatoEmporio ?? true,
      creditoSolidaleValore: opts.creditoSolidaleValore ?? "2",
      quantitaMassimaPerSpesa: opts.quantitaMassimaPerSpesa ?? null,
      quantitaMassimaMensile: opts.quantitaMassimaMensile ?? null,
      attivo: true,
    })
    .returning({ id: prodottiTable.id });
  prodottoIds.push(prodotto.id);
  if (Number(opts.quantitaResidua ?? "10") > 0) {
    const [lotto] = await db
      .insert(lottiTable)
      .values({
        prodottoId: prodotto.id,
        codiceLotto: `L-${rnd()}`,
        dataScadenza: opts.dataScadenza,
        dataCarico: "2026-07-01",
        quantitaCaricata: opts.quantitaResidua ?? "10",
        quantitaResidua: opts.quantitaResidua ?? "10",
        magazzinoId: opts.magazzinoId,
        fsePlus: opts.fsePlus ?? false,
        fondoOrigine: opts.fsePlus ? "FSE_PLUS" : "NESSUN_FONDO",
      })
      .returning({ id: lottiTable.id });
    lottoIds.push(lotto.id);
  }
  return prodotto.id;
}

async function openSession(accessoId: number) {
  const res = await request(makeApp())
    .post(`/cassa-emporio/accessi/${accessoId}/apri-sessione`)
    .send({});
  if (res.body?.id) sessioneIds.push(res.body.id);
  return res;
}

async function addProduct(
  sessioneId: number,
  prodottoId: number,
  quantita = 1,
) {
  const versione = await getSessionVersion(sessioneId);
  const res = await request(makeApp())
    .post(`/cassa-emporio/sessioni/${sessioneId}/righe`)
    .send({ prodottoId, quantita, versione });
  if (res.body?.id) rigaIds.push(res.body.id);
  return res;
}

async function getSessionVersion(sessioneId: number): Promise<number> {
  const detail = await request(makeApp()).get(
    `/cassa-emporio/sessioni/${sessioneId}`,
  );
  return detail.body.versione;
}

async function postSessionAction(
  sessioneId: number,
  action: string,
  payload: Record<string, unknown> = {},
) {
  const versione = await getSessionVersion(sessioneId);
  return request(makeApp())
    .post(`/cassa-emporio/sessioni/${sessioneId}/${action}`)
    .send({ ...payload, versione });
}

async function trackSpesa(spesaId: number): Promise<void> {
  spesaIds.push(spesaId);
  const [spesa] = await db
    .select()
    .from(speseEmporioTable)
    .where(eq(speseEmporioTable.id, spesaId));
  if (spesa?.bollaId != null) bollaIds.push(spesa.bollaId);
  if (spesa?.scaricoId != null) scaricoIds.push(spesa.scaricoId);
}

beforeAll(async () => {
  const [operator] = await db
    .insert(utentiTable)
    .values({
      username: `cassa_test_${rnd()}`,
      passwordHash: "test-only",
      nome: "Operatore Cassa Test",
      attivo: true,
    })
    .returning({ id: utentiTable.id });
  operatorUserId = operator.id;
});

beforeEach(async () => {
  await setEmporioEnabled(true);
});

afterEach(async () => {
  await cListeners.close();
  // Track committed facts even when the response/assertion failed after commit.
  if (sessioneIds.length) {
    const committed = await db
      .select({ id: speseEmporioTable.id })
      .from(speseEmporioTable)
      .where(inArray(speseEmporioTable.sessioneCassaId, sessioneIds));
    for (const row of committed)
      if (!spesaIds.includes(row.id)) await trackSpesa(row.id);
  }
  await cleanupEmporioActorFixtures();
  if (magazzinoIds.length) {
    const owned = await db
      .select({ id: scarichiTable.id })
      .from(scarichiTable)
      .where(inArray(scarichiTable.magazzinoId, magazzinoIds));
    for (const row of owned)
      if (!scaricoIds.includes(row.id)) scaricoIds.push(row.id);
  }
  if (transferIds.length) {
    await db
      .delete(prenotazioniMagazzinoTable)
      .where(inArray(prenotazioniMagazzinoTable.trasferimentoId, transferIds));
    await db
      .delete(movimentiTable)
      .where(inArray(movimentiTable.trasferimentoId, transferIds));
    await db
      .delete(trasferimentoRigheTable)
      .where(inArray(trasferimentoRigheTable.trasferimentoId, transferIds));
    await db
      .delete(trasferimentiTable)
      .where(inArray(trasferimentiTable.id, transferIds.splice(0)));
  }
  if (mensaIds.length) {
    await db
      .delete(mensaConsumiTable)
      .where(inArray(mensaConsumiTable.mensaId, mensaIds));
    await db
      .delete(mensaGiornateServizioTable)
      .where(inArray(mensaGiornateServizioTable.mensaId, mensaIds));
    await db
      .delete(menseTable)
      .where(inArray(menseTable.id, mensaIds.splice(0)));
  }
  const currentSpesaIds = spesaIds.splice(0);
  const currentBollaIds = bollaIds.splice(0);
  const currentScaricoIds = scaricoIds.splice(0);
  const currentRigaIds = rigaIds.splice(0);
  const currentSessioneIds = sessioneIds.splice(0);
  const currentConsegnaIds = consegnaIds.splice(0);
  const currentBeneficiarioIds = beneficiarioIds.splice(0);
  const currentMagazzinoIds = magazzinoIds.splice(0);

  if (currentBollaIds.length)
    await db
      .delete(prenotazioniMagazzinoTable)
      .where(inArray(prenotazioniMagazzinoTable.bollaId, currentBollaIds));

  await db
    .delete(auditConfigurazioniTable)
    .where(eq(auditConfigurazioniTable.utenteId, operatorUserId));

  if (currentSpesaIds.length > 0) {
    const storni = await db
      .select({ id: speseEmporioStorniTable.id })
      .from(speseEmporioStorniTable)
      .where(inArray(speseEmporioStorniTable.spesaEmporioId, currentSpesaIds));
    const stornoIds = storni.map((row) => row.id);
    if (stornoIds.length > 0)
      await db
        .delete(speseEmporioStorniRigheTable)
        .where(inArray(speseEmporioStorniRigheTable.stornoId, stornoIds));
    if (stornoIds.length > 0)
      await db
        .delete(speseEmporioStorniTable)
        .where(inArray(speseEmporioStorniTable.id, stornoIds));
  }

  if (currentSpesaIds.length > 0)
    await db
      .delete(speseEmporioRigheTable)
      .where(inArray(speseEmporioRigheTable.spesaEmporioId, currentSpesaIds));
  if (currentSpesaIds.length > 0)
    await db
      .delete(speseEmporioTable)
      .where(inArray(speseEmporioTable.id, currentSpesaIds));
  if (currentRigaIds.length > 0)
    await db
      .delete(sessioniCassaEmporioRigheTable)
      .where(inArray(sessioniCassaEmporioRigheTable.id, currentRigaIds));
  if (currentSessioneIds.length > 0)
    await db
      .delete(sessioniCassaEmporioTable)
      .where(inArray(sessioniCassaEmporioTable.id, currentSessioneIds));
  if (prodottoIds.length)
    await db
      .delete(movimentiTable)
      .where(inArray(movimentiTable.prodottoId, prodottoIds));
  if (currentBollaIds.length > 0)
    await db
      .delete(movimentiTable)
      .where(inArray(movimentiTable.bollaId, currentBollaIds));
  if (currentBollaIds.length > 0)
    await db
      .delete(bollaRigheTable)
      .where(inArray(bollaRigheTable.bollaId, currentBollaIds));
  if (currentScaricoIds.length > 0)
    await db
      .delete(scaricoRigheTable)
      .where(inArray(scaricoRigheTable.scaricoId, currentScaricoIds));
  if (currentBollaIds.length > 0)
    await db.delete(bolleTable).where(inArray(bolleTable.id, currentBollaIds));
  if (currentScaricoIds.length > 0)
    await db
      .delete(scarichiTable)
      .where(inArray(scarichiTable.id, currentScaricoIds));
  if (currentBeneficiarioIds.length > 0)
    await db
      .delete(creditoSolidaleMovimentiTable)
      .where(
        inArray(
          creditoSolidaleMovimentiTable.beneficiarioId,
          currentBeneficiarioIds,
        ),
      );
  if (currentConsegnaIds.length > 0)
    await db
      .delete(consegneTable)
      .where(inArray(consegneTable.id, currentConsegnaIds));
  if (currentMagazzinoIds.length > 0)
    await db
      .delete(operazioniDistribuzioneMagazzinoTable)
      .where(
        inArray(
          operazioniDistribuzioneMagazzinoTable.magazzinoId,
          currentMagazzinoIds,
        ),
      );
  if (lottoIds.length > 0)
    await db
      .delete(lottiTable)
      .where(inArray(lottiTable.id, lottoIds.splice(0)));
  if (prodottoIds.length > 0)
    await db
      .delete(prodottiTable)
      .where(inArray(prodottiTable.id, prodottoIds.splice(0)));
  if (currentBeneficiarioIds.length > 0)
    await db
      .delete(beneficiariTable)
      .where(inArray(beneficiariTable.id, currentBeneficiarioIds));
  if (currentMagazzinoIds.length > 0)
    await db
      .delete(magazziniTable)
      .where(inArray(magazziniTable.id, currentMagazzinoIds));
  if (centroIds.length > 0)
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, centroIds.splice(0)));
  if (areaOperativaIds.length > 0)
    await db
      .delete(areeOperativeTable)
      .where(inArray(areeOperativeTable.id, areaOperativaIds.splice(0)));
  await setEmporioEnabled(false);
});

afterAll(async () => {
  await setEmporioEnabled(true);
  await db
    .delete(auditConfigurazioniTable)
    .where(eq(auditConfigurazioniTable.utenteId, operatorUserId));
  await db.delete(utentiTable).where(eq(utentiTable.id, operatorUserId));
  await pool.end();
});

describe("Cassa Emporio", () => {
  async function cExpense(
    price = "3",
    quantity = 2,
    uom = "pz",
    multi = false,
  ) {
    const fixture = await createFixture();
    const product = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: price,
      unitaMisura: uom,
      quantitaResidua: "10",
    });
    if (multi) {
      const [original] = await db
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.prodottoId, product));
      await db
        .update(lottiTable)
        .set({ quantitaCaricata: "0.5", quantitaResidua: "0.5" })
        .where(eq(lottiTable.id, original.id));
      const [second] = await db
        .insert(lottiTable)
        .values({
          ...original,
          id: undefined,
          codiceLotto: `C-MULTI-${rnd()}`,
          quantitaCaricata: "0.5",
          quantitaResidua: "0.5",
        })
        .returning();
      lottoIds.push(second.id);
    }
    const session = await readyCart(fixture, product, quantity);
    const close = await postSessionAction(session.id, "chiudi");
    expect(close.status, close.text).toBe(200);
    await trackSpesa(close.body.spesa.id);
    const app = await stableApp(fixture.areaOperativaId);
    app.use(creditoSolidaleRouter);
    app.use(prodottiRouter);
    app.use(politicheCreditoSolidaleRouter);
    const server = await cListeners.open(app, () => app);
    return { fixture, product, session, spesa: close.body.spesa, server };
  }
  function cPost(
    c: Awaited<ReturnType<typeof cExpense>>,
    body: Record<string, unknown>,
  ) {
    return request(c.server)
      .post(`/spese-emporio/${c.spesa.id}/storna`)
      .send({
        motivo: "Rettifica sintetica M6.2-C",
        idempotencyKey: `c-${rnd()}`,
        ...body,
      });
  }

  it("C04/C05 credito intero con quantità frazionaria, rifiuto senza effetti", async () => {
    const f = await createFixture();
    const product = await createProdotto({
      magazzinoId: f.magazzinoId,
      creditoSolidaleValore: "3",
      unitaMisura: "kg",
    });
    const s = await openSession(f.accessoId);
    const denied = await addProduct(s.body.id, product, 0.5);
    expect(denied.status).toBe(400);
    expect(denied.body.error).toContain("frazione di credito");
    expect(
      await db
        .select()
        .from(sessioniCassaEmporioRigheTable)
        .where(eq(sessioniCassaEmporioRigheTable.sessioneCassaId, s.body.id)),
    ).toHaveLength(0);
    await db
      .update(prodottiTable)
      .set({ creditoSolidaleValore: "4" })
      .where(eq(prodottiTable.id, product));
    expect((await addProduct(s.body.id, product, 0.5)).status).toBe(201);
    await postSessionAction(s.body.id, "pronta-per-chiusura");
    const closed = await postSessionAction(s.body.id, "chiudi");
    expect(closed.status, closed.text).toBe(200);
    await trackSpesa(closed.body.spesa.id);
    expect(closed.body.spesa.totaleCreditoConsumati).toBe(2);
    expect(closed.body.spesa.righe[0].quantita).toBe(0.5);
  });

  it("C07/C08/C12/C13/C14/C16/C18 credito-only poi totale, replay e recupero GET", async () => {
    const c = await cExpense();
    await db
      .update(prodottiTable)
      .set({ creditoSolidaleValore: "9" })
      .where(eq(prodottiTable.id, c.product));
    const credit = await cPost(c, {
      tipoRettifica: "solo_credito",
      creditoRestituito: 2,
    });
    expect(credit.status, credit.text).toBe(201);
    expect(credit.body.spesa.righe[0].quantitaStornata).toBe(0);
    expect(credit.body.spesa.statoSpesa).toBe(c.spesa.statoSpesa);
    const key = `total-${rnd()}`;
    const total = await cPost(c, { idempotencyKey: key });
    expect(total.status, total.text).toBe(201);
    expect(total.body.creditoRestituito).toBe(4);
    const replay = await cPost(c, { idempotencyKey: key });
    expect(replay.status, replay.text).toBe(201);
    expect(replay.body.stornoId).toBe(total.body.stornoId);
    expect(
      (await cPost(c, { idempotencyKey: key, motivo: "Altro comando" })).status,
    ).toBe(409);
    const recovered = await request(c.server).get(
      `/spese-emporio/${c.spesa.id}/rettifiche/esito/${key}`,
    );
    expect(recovered.status, recovered.text).toBe(200);
    expect(recovered.body.stornoId).toBe(total.body.stornoId);
    expect(recovered.body.spesa.creditoGiaRestituito).toBe(6);
    expect(recovered.body.spesa.creditoRimborsabile).toBe(0);
    expect(
      (await cPost(c, { tipoRettifica: "solo_credito", creditoRestituito: 1 }))
        .status,
    ).toBe(409);
    const [lot] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.prodottoId, c.product));
    expect(Number(lot.quantitaResidua)).toBe(10);
    const [person] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, c.fixture.beneficiarioId));
    expect(Number(person.creditoSolidaleSaldo)).toBe(20);
  });

  it("C08 errore amministrativo 12−4=8: nessun rientro inventato, audit e ledger riconciliati", async () => {
    const c = await cExpense("3", 4);
    const first = await cPost(c, {
      tipoRettifica: "errore_amministrativo",
      creditoRestituito: 4,
    });
    expect(first.status, first.text).toBe(201);
    expect(first.body.spesa.righe[0].quantitaStornata).toBe(0);
    const full = await cPost(c, {});
    expect(full.status, full.text).toBe(201);
    expect(full.body.creditoRestituito).toBe(8);
    const moves = await db
      .select()
      .from(creditoSolidaleMovimentiTable)
      .where(
        eq(
          creditoSolidaleMovimentiTable.beneficiarioId,
          c.fixture.beneficiarioId,
        ),
      );
    expect(
      moves.map((r) => Number(r.variazioneCredito)).sort((a, b) => a - b),
    ).toEqual([-12, 4, 8]);
    expect(
      moves.every(
        (r) =>
          Number(r.saldoPrima) + Number(r.variazioneCredito) ===
          Number(r.saldoDopo),
      ),
    ).toBe(true);
    const audits = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.entitaId, first.body.stornoId));
    const audit = audits.find((r) => r.entitaTipo === "storno_spesa_emporio");
    expect(audit?.actorUserId).toBe(operatorUserId);
    expect(audit?.correlationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(audit?.motivo).toBe("Rettifica sintetica M6.2-C");
    const [lot] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.prodottoId, c.product));
    expect(Number(lot.quantitaResidua)).toBe(10);
  });

  it("C12 stessa chiave in parallelo: una ricevuta e un solo rimborso", async () => {
    const c = await cExpense(),
      blocker = await pool.connect(),
      key = `same-${rnd()}`;
    let pending: Array<Promise<request.Response>> = [];
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
        .pid;
      await blocker.query(
        "SELECT id FROM spese_emporio WHERE id=$1 FOR UPDATE",
        [c.spesa.id],
      );
      pending = [1, 2].map(() =>
        cPost(c, {
          idempotencyKey: key,
          tipoRettifica: "solo_credito",
          creditoRestituito: 2,
        }).then((r) => r),
      );
      await observedWait(pid, 2);
      await blocker.query("COMMIT");
      const [a, b] = await Promise.all(pending);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.stornoId).toBe(b.body.stornoId);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM comandi_operativi WHERE aggregato_tipo='spesa_emporio' AND aggregato_id=$1",
            [c.spesa.id],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        await db
          .select()
          .from(speseEmporioStorniTable)
          .where(eq(speseEmporioStorniTable.spesaEmporioId, c.spesa.id)),
      ).toHaveLength(1);
      const [person] = await db
        .select()
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, c.fixture.beneficiarioId));
      expect(Number(person.creditoSolidaleSaldo)).toBe(16);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled(pending);
    }
  });

  it.each(["2026-12-31T23:30:00Z", "2026-12-31T22:30:00Z"])(
    "C23 confine anno Europe/Rome %s: il reso resta nel mese originale",
    async (instant) => {
      const c = await cExpense();
      await db
        .update(speseEmporioTable)
        .set({ dataChiusura: new Date(instant) })
        .where(eq(speseEmporioTable.id, c.spesa.id));
      const net = (date: string) =>
        quantitaNettaMensileProdotto(
          db,
          c.fixture.beneficiarioId,
          c.product,
          new Date(date),
        );
      const january = instant.includes("23:30");
      expect(
        await net(january ? "2027-01-15T12:00Z" : "2026-12-15T12:00Z"),
      ).toBe(2);
      const result = await cPost(c, {
        righe: [{ spesaRigaId: c.spesa.righe[0].id, quantita: "1" }],
      });
      expect(result.status, result.text).toBe(201);
      expect(
        await net(january ? "2027-01-15T12:00Z" : "2026-12-15T12:00Z"),
      ).toBe(1);
      expect(
        await net(january ? "2026-12-15T12:00Z" : "2027-01-15T12:00Z"),
      ).toBe(0);
    },
  );

  it("C15 GET di esito assente non dichiara successo e non crea fatti", async () => {
    const c = await cExpense();
    expect(
      (
        await request(c.server).get(
          `/spese-emporio/${c.spesa.id}/rettifiche/esito/mai-eseguito`,
        )
      ).status,
    ).toBe(404);
    expect(
      await db
        .select()
        .from(speseEmporioStorniTable)
        .where(eq(speseEmporioStorniTable.spesaEmporioId, c.spesa.id)),
    ).toHaveLength(0);
  });

  it("C12/C27 chiave legacy senza hash: diniego conservativo e storico leggibile", async () => {
    const c = await cExpense(),
      key = `legacy-${rnd()}`;
    await db.insert(speseEmporioStorniTable).values({
      spesaEmporioId: c.spesa.id,
      motivo: "Rettifica storica sintetica",
      tipoRettifica: "legacy_storno",
      creditoRestituito: "1",
      operatoreId: operatorUserId,
      idempotencyKey: key,
    });
    const denied = await cPost(c, { idempotencyKey: key });
    expect(denied.status, denied.text).toBe(409);
    expect(denied.body.error).toContain("Chiave legacy");
    const history = await request(c.server).get(`/spese-emporio/${c.spesa.id}`);
    expect(history.status, history.text).toBe(200);
    expect(history.body.rettifiche).toHaveLength(1);
    expect(
      (
        await request(c.server).get(
          `/spese-emporio/${c.spesa.id}/rettifiche/esito/${key}`,
        )
      ).status,
    ).toBe(404);
  });

  it.each(["saldi", "rimborsi"] as const)(
    "C27 storico frazionario %s leggibile ma non rettificabile, anche se la somma è intera",
    async (legacy) => {
      expect(process.env.M62C_DISPOSABLE_DB).toBe("verified");
      const target = new URL(process.env.DATABASE_URL!);
      expect(target.hostname).toBe("127.0.0.1");
      expect(target.port).toBe("58621");
      expect(target.pathname).toBe("/m62a");
      const c = await cExpense();
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        // Simulate pre-49 facts only on this verified disposable connection.
        // SET LOCAL is undone by COMMIT/ROLLBACK; production guards stay intact.
        await connection.query("SET LOCAL session_replication_role = replica");
        if (legacy === "saldi") {
          await connection.query(
            "UPDATE spese_emporio SET saldo_prima = 20.25, saldo_dopo = 14.25 WHERE id = $1",
            [c.spesa.id],
          );
        } else {
          await connection.query(
            `INSERT INTO spese_emporio_storni
              (spesa_emporio_id, motivo, tipo_rettifica, credito_restituito, operatore_id)
             VALUES ($1, 'Legacy sintetico A', 'legacy_storno', 0.5, $2),
                    ($1, 'Legacy sintetico B', 'legacy_storno', 0.5, $2)`,
            [c.spesa.id, operatorUserId],
          );
        }
        await connection.query("COMMIT");
      } finally {
        await connection.query("ROLLBACK");
        connection.release();
      }
      const history = await request(c.server).get(
        `/spese-emporio/${c.spesa.id}`,
      );
      expect(history.status, history.text).toBe(200);
      expect(history.body.creditoConforme).toBe(false);
      const denied = await cPost(c, {
        tipoRettifica: "solo_credito",
        creditoRestituito: 1,
      });
      expect(denied.status, denied.text).toBe(400);
      expect(denied.body.error).toContain("inter");
      expect(
        await db
          .select()
          .from(speseEmporioStorniTable)
          .where(eq(speseEmporioStorniTable.spesaEmporioId, c.spesa.id)),
      ).toHaveLength(legacy === "saldi" ? 0 : 2);
      const [lot] = await db
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.prodottoId, c.product));
      const [person] = await db
        .select()
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, c.fixture.beneficiarioId));
      expect(Number(lot.quantitaResidua)).toBe(8);
      expect(Number(person.creditoSolidaleSaldo)).toBe(14);
    },
  );

  it("C06/C10 FEFO multi-lotto non definisce il rimborso; nessun resto redistribuito", async () => {
    const c = await cExpense("3", 1, "kg", true);
    expect(c.spesa.righe).toHaveLength(2);
    expect(
      c.spesa.righe
        .map((row: { creditoTotale: number }) => row.creditoTotale)
        .sort(),
    ).toEqual([1, 2]);
    expect(c.spesa.totaleCreditoConsumati).toBe(3);
    for (const row of c.spesa.righe) {
      const denied = await cPost(c, {
        righe: [{ spesaRigaId: row.id, quantita: "0.5" }],
      });
      expect(denied.status, denied.text).toBe(409);
      expect(denied.body.error).toContain("frazione di credito");
    }
    expect(
      await db
        .select()
        .from(speseEmporioStorniTable)
        .where(eq(speseEmporioStorniTable.spesaEmporioId, c.spesa.id)),
    ).toHaveLength(0);
    const full = await cPost(c, {});
    expect(full.status, full.text).toBe(201);
    expect(full.body.creditoRestituito).toBe(3);
  });

  it("C09/C23 solo reso quantitativo riduce il mese della Spesa originaria", async () => {
    const c = await cExpense();
    await db
      .update(speseEmporioTable)
      .set({ dataChiusura: new Date("2026-09-20T10:00:00Z") })
      .where(eq(speseEmporioTable.id, c.spesa.id));
    const net = (date: string) =>
      quantitaNettaMensileProdotto(
        db,
        c.fixture.beneficiarioId,
        c.product,
        new Date(date + "T12:00:00Z"),
      );
    expect(await net("2026-09-20")).toBe(2);
    const credit = await cPost(c, {
      tipoRettifica: "solo_credito",
      creditoRestituito: 1,
    });
    expect(credit.status).toBe(201);
    expect(await net("2026-09-20")).toBe(2);
    const partial = await cPost(c, {
      righe: [{ spesaRigaId: c.spesa.righe[0].id, quantita: "1" }],
    });
    expect(partial.status, partial.text).toBe(201);
    expect(partial.body.creditoRestituito).toBe(3);
    expect(await net("2026-09-20")).toBe(1);
    expect(await net("2026-10-10")).toBe(0);
  });

  it("C24 sei decimali preservati UI-contract → API → DB → risposta", async () => {
    const c = await cExpense("1000000", 0.000001, "kg");
    const response = await cPost(c, {
      righe: [{ spesaRigaId: c.spesa.righe[0].id, quantita: "0.000001" }],
    });
    expect(response.status, response.text).toBe(201);
    expect(response.body.creditoRestituito).toBe(1);
    expect(response.body.spesa.righe[0].quantitaStornata).toBe(0.000001);
    const [physical] = await db
      .select()
      .from(speseEmporioStorniRigheTable)
      .where(eq(speseEmporioStorniRigheTable.stornoId, response.body.stornoId));
    expect(Number(physical.quantita)).toBe(0.000001);
  });

  it.each([
    ["lotti", "UPDATE"],
    ["credito_solidale_movimenti", "INSERT"],
    ["comandi_operativi", "INSERT"],
    ["audit_eventi", "INSERT"],
  ])(
    "C28 fault %s: stock, credito, ricevuta e audit annullati insieme",
    async (table, operation) => {
      expect(process.env.M62C_DISPOSABLE_DB).toBe("verified");
      const c = await cExpense();
      const admin = await pool.connect(),
        name = `m62c_fault_${rnd()}`;
      const condition =
        table === "lotti"
          ? `NEW.prodotto_id=${c.product}`
          : table === "credito_solidale_movimenti"
            ? `NEW.beneficiario_id=${c.fixture.beneficiarioId}`
            : table === "comandi_operativi"
              ? `NEW.aggregato_tipo='spesa_emporio' AND NEW.aggregato_id=${c.spesa.id}`
              : `NEW.entita_tipo='storno_spesa_emporio' AND NEW.magazzino_id_snapshot=${c.fixture.magazzinoId}`;
      try {
        await admin.query(
          `CREATE FUNCTION pg_temp.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'M62C fault injection'; END $$`,
        );
        await admin.query(
          `CREATE TRIGGER ${name} BEFORE ${operation} ON ${table} FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION pg_temp.${name}()`,
        );
        expect((await cPost(c, {})).status).toBe(500);
        const [lot] = await db
          .select()
          .from(lottiTable)
          .where(eq(lottiTable.prodottoId, c.product));
        const [person] = await db
          .select()
          .from(beneficiariTable)
          .where(eq(beneficiariTable.id, c.fixture.beneficiarioId));
        expect(Number(lot.quantitaResidua)).toBe(8);
        expect(Number(person.creditoSolidaleSaldo)).toBe(14);
        expect(
          (
            await pool.query(
              "SELECT count(*)::int n FROM comandi_operativi WHERE aggregato_tipo='spesa_emporio' AND aggregato_id=$1",
              [c.spesa.id],
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (
            await pool.query(
              "SELECT count(*)::int n FROM audit_eventi WHERE entita_tipo='storno_spesa_emporio' AND magazzino_id_snapshot=$1",
              [c.fixture.magazzinoId],
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          await db
            .select()
            .from(speseEmporioStorniTable)
            .where(eq(speseEmporioStorniTable.spesaEmporioId, c.spesa.id)),
        ).toHaveLength(0);
      } finally {
        await admin.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
        await admin.query(`DROP FUNCTION pg_temp.${name}()`);
        admin.release();
      }
    },
  );

  it("C02 input frazionario diretto non crea rettifiche", async () => {
    const c = await cExpense();
    for (const amount of ["0.5", "1,5", "2.25", "3.0000000000000001"]) {
      expect(
        (
          await cPost(c, {
            tipoRettifica: "solo_credito",
            creditoRestituito: amount,
          })
        ).status,
      ).toBe(400);
      const topup = await request(c.server)
        .post(
          `/credito-solidale/beneficiari/${c.fixture.beneficiarioId}/ricarica-manuale`,
        )
        .send({ variazioneCredito: amount, motivo: "Vietato frazionario" });
      expect(topup.status, topup.text).toBe(400);
      const product = await request(c.server)
        .patch(`/prodotti/${c.product}`)
        .send({ creditoSolidaleValore: amount });
      expect(product.status, product.text).toBe(400);
      const policy = await request(c.server)
        .post("/politiche-credito-solidale")
        .send({ nome: `C invalid ${rnd()}`, creditoBaseNucleo: amount });
      expect(policy.status, policy.text).toBe(400);
      const config = await request(c.server)
        .patch(
          `/credito-solidale/beneficiari/${c.fixture.beneficiarioId}/configurazione`,
        )
        .send({ creditoSolidaleMensileAssegnato: amount });
      expect(config.status, config.text).toBe(400);
    }
    expect(
      await db
        .select()
        .from(speseEmporioStorniTable)
        .where(eq(speseEmporioStorniTable.spesaEmporioId, c.spesa.id)),
    ).toHaveLength(0);
  });

  it("C17 reso non distribuibile: scarto M4, saldo corretto, lotto sano invariato", async () => {
    const c = await cExpense();
    const result = await cPost(c, {
      tipoRettifica: "reso_non_distribuibile",
      righe: [{ spesaRigaId: c.spesa.righe[0].id, quantita: "1" }],
    });
    expect(result.status, result.text).toBe(201);
    expect(result.body.creditoRestituito).toBe(3);
    const [lot] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.prodottoId, c.product));
    expect(Number(lot.quantitaResidua)).toBe(8);
    const events = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.prodottoId, c.product));
    expect(
      events.filter((row) => row.naturaContabile === "SCARTO"),
    ).toHaveLength(1);
    expect(
      events.filter((row) => row.tipoDettaglio === "storno_spesa_emporio"),
    ).toHaveLength(1);
    expect(events.every((row) => row.auditEventoId != null)).toBe(true);
  });

  it("C19/C20 storni esterni credito e Bolla Emporio rifiutati prima degli effetti", async () => {
    const c = await cExpense();
    const credit = await request(c.server)
      .post(
        `/credito-solidale/movimenti/${c.spesa.movimentoCreditoSolidaleId}/storno`,
      )
      .send({ motivo: "Vietato" });
    expect(credit.status, credit.text).toBe(409);
    expect(credit.body.error).toContain("Rettifica spesa");
    const [currentBill] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, c.spesa.bollaId));
    const bill = await request(c.server)
      .post(`/bolle/${c.spesa.bollaId}/storno-amministrativo`)
      .send({
        motivo: "Vietato",
        rigaIds: [c.spesa.righe[0].bollaRigaId],
        versione: currentBill.versione,
        idempotencyKey: `outside-${rnd()}`,
      });
    expect(bill.status, bill.text).toBe(409);
    expect(bill.body.error).toContain("Rettifica spesa");
    const [lot] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.prodottoId, c.product));
    expect(Number(lot.quantitaResidua)).toBe(8);
  });

  it("C11 due rimborsi concorrenti, barriera PostgreSQL osservata sulla Spesa", async () => {
    const c = await cExpense();
    const blocker = await pool.connect();
    let pending: Array<Promise<request.Response>> = [];
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
        .pid;
      await blocker.query(
        "SELECT id FROM spese_emporio WHERE id=$1 FOR UPDATE",
        [c.spesa.id],
      );
      pending = [1, 2].map(() =>
        cPost(c, { tipoRettifica: "solo_credito", creditoRestituito: 4 }).then(
          (r) => r,
        ),
      );
      await observedWait(pid, 2);
      await blocker.query("COMMIT");
      const results = await Promise.all(pending);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        (
          await db
            .select()
            .from(speseEmporioStorniTable)
            .where(eq(speseEmporioStorniTable.spesaEmporioId, c.spesa.id))
        ).reduce((sum, row) => sum + Number(row.creditoRestituito), 0),
      ).toBe(4);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled(pending);
    }
  });

  it("C22 replay e recupero rivalidano la revoca corrente senza alterare sessione", async () => {
    const c = await cExpense();
    const key = `revoca-${rnd()}`;
    const first = await cPost(c, { idempotencyKey: key });
    expect(first.status, first.text).toBe(201);
    const [actor] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, operatorUserId));
    await db
      .update(ruoliTable)
      .set({ isAdmin: false, permessi: ["emporio.cassa.operate"] })
      .where(eq(ruoliTable.id, actor.ruoloId!));
    expect((await cPost(c, { idempotencyKey: key })).status).toBe(403);
    expect(
      (
        await request(c.server).get(
          `/spese-emporio/${c.spesa.id}/rettifiche/esito/${key}`,
        )
      ).status,
    ).toBe(403);
  });

  it("C11 parziale contro totale: quantità e rimborso cumulativi sotto lock", async () => {
    const c = await cExpense(),
      blocker = await pool.connect();
    let pending: Array<Promise<request.Response>> = [];
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
        .pid;
      await blocker.query(
        "SELECT id FROM spese_emporio WHERE id=$1 FOR UPDATE",
        [c.spesa.id],
      );
      pending = [
        cPost(c, {
          righe: [{ spesaRigaId: c.spesa.righe[0].id, quantita: "1" }],
        }).then((r) => r),
        cPost(c, {}).then((r) => r),
      ];
      await observedWait(pid, 2);
      await blocker.query("COMMIT");
      const results = await Promise.all(pending);
      expect(results.every((r) => [201, 409].includes(r.status))).toBe(true);
      expect(results.filter((r) => r.status === 201).length).toBeGreaterThan(0);
      expect(
        (
          await db
            .select()
            .from(speseEmporioStorniTable)
            .where(eq(speseEmporioStorniTable.spesaEmporioId, c.spesa.id))
        ).reduce((s, r) => s + Number(r.creditoRestituito), 0),
      ).toBe(6);
      const [lot] = await db
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.prodottoId, c.product));
      expect(Number(lot.quantitaResidua)).toBe(10);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled(pending);
    }
  });

  it.each(["credito", "bolla"])(
    "C19/C20 rettifica in corso contro compensazione esterna %s",
    async (kind) => {
      const c = await cExpense(),
        blocker = await pool.connect();
      let pending: Promise<request.Response> | undefined;
      try {
        await blocker.query("BEGIN");
        const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid;
        await blocker.query(
          "SELECT id FROM spese_emporio WHERE id=$1 FOR UPDATE",
          [c.spesa.id],
        );
        pending = cPost(c, {}).then((r) => r);
        await observedWait(pid);
        const [bill] = await db
          .select()
          .from(bolleTable)
          .where(eq(bolleTable.id, c.spesa.bollaId));
        const denied =
          kind === "credito"
            ? await request(c.server)
                .post(
                  `/credito-solidale/movimenti/${c.spesa.movimentoCreditoSolidaleId}/storno`,
                )
                .send({ motivo: "Conflitto sintetico" })
            : await request(c.server)
                .post(`/bolle/${c.spesa.bollaId}/storno-amministrativo`)
                .send({
                  motivo: "Conflitto sintetico",
                  versione: bill.versione,
                  rigaIds: [c.spesa.righe[0].bollaRigaId],
                  idempotencyKey: `external-${rnd()}`,
                });
        expect(denied.status, denied.text).toBe(409);
        expect(denied.body.error).toContain("Rettifica spesa");
        await blocker.query("COMMIT");
        expect((await pending).status).toBe(201);
        expect(
          await db
            .select()
            .from(speseEmporioStorniTable)
            .where(eq(speseEmporioStorniTable.spesaEmporioId, c.spesa.id)),
        ).toHaveLength(1);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        if (pending) await Promise.allSettled([pending]);
      }
    },
  );

  it("C22 revoca concorrente dopo il preliminare: rivalidazione transazionale", async () => {
    const c = await cExpense(),
      blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
        .pid;
      await blocker.query(
        "SELECT id FROM spese_emporio WHERE id=$1 FOR UPDATE",
        [c.spesa.id],
      );
      pending = cPost(c, {}).then((r) => r);
      await observedWait(pid);
      const [actor] = await db
        .select()
        .from(utentiTable)
        .where(eq(utentiTable.id, operatorUserId));
      await db
        .update(ruoliTable)
        .set({ isAdmin: false, permessi: ["emporio.cassa.operate"] })
        .where(eq(ruoliTable.id, actor.ruoloId!));
      await blocker.query("COMMIT");
      expect((await pending).status).toBe(403);
      expect(
        await db
          .select()
          .from(speseEmporioStorniTable)
          .where(eq(speseEmporioStorniTable.spesaEmporioId, c.spesa.id)),
      ).toHaveLength(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await Promise.allSettled([pending]);
    }
  });

  it("C11 rientro contro writer indipendente dello stesso lotto: nessun lost update", async () => {
    const c = await cExpense(),
      blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
        .pid;
      // Simulate an independent inventory writer owning the canonical lot lock.
      await blocker.query(
        "UPDATE lotti SET quantita_residua=quantita_residua-1 WHERE prodotto_id=$1",
        [c.product],
      );
      pending = cPost(c, {
        righe: [{ spesaRigaId: c.spesa.righe[0].id, quantita: "1" }],
      }).then((r) => r);
      await observedWait(pid);
      await blocker.query("COMMIT");
      expect((await pending).status).toBe(201);
      const [lot] = await db
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.prodottoId, c.product));
      expect(Number(lot.quantitaResidua)).toBe(8);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await Promise.allSettled([pending]);
    }
  });

  it("C17 lotto divenuto scaduto: no reso idoneo, scarto atomico consentito", async () => {
    const c = await cExpense();
    await db
      .update(lottiTable)
      .set({ dataScadenza: "2020-01-01" })
      .where(eq(lottiTable.prodottoId, c.product));
    expect((await cPost(c, {})).status).toBe(409);
    expect(
      (await cPost(c, { tipoRettifica: "reso_non_distribuibile" })).status,
    ).toBe(201);
    const [lot] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.prodottoId, c.product));
    expect(Number(lot.quantitaResidua)).toBe(8);
    expect(lot.dataScadenza).toBe("2020-01-01");
  });

  async function observedWait(blockerPid: number, expected = 1) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const { rows } = await pool.query<{ pid: number }>(
        `WITH RECURSIVE waiters AS (
          SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
          UNION SELECT a.pid FROM pg_stat_activity a JOIN waiters w ON w.pid=ANY(pg_blocking_pids(a.pid))
        ) SELECT pid FROM waiters`,
        [blockerPid],
      );
      if (rows.length >= expected) return rows[0].pid;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error(
      `Timeout barriera PostgreSQL: attesi ${expected} backend dietro ${blockerPid}`,
    );
  }

  async function checkoutFacts(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    product: number,
    session: number,
  ) {
    const {
      rows: [facts],
    } = await pool.query(
      `SELECT
      (SELECT quantita_residua::float8 FROM lotti WHERE prodotto_id=$1) stock,
      (SELECT credito_solidale_saldo::float8 FROM beneficiari WHERE id=$2) credit,
      (SELECT count(*)::int FROM spese_emporio WHERE sessione_cassa_id=$3) expenses,
      (SELECT count(*)::int FROM bolle WHERE magazzino_id=$4) bills,
      (SELECT count(*)::int FROM scarichi WHERE magazzino_id=$4) issues,
      (SELECT count(*)::int FROM credito_solidale_movimenti WHERE beneficiario_id=$2) credit_entries,
      (SELECT count(*)::int FROM audit_eventi WHERE azione='EMPORIO_CHECKOUT' AND metadata->>'cassaId'=$3::text) audits,
      (SELECT coalesce(sum(quantita),0)::float8 FROM movimenti WHERE prodotto_id=$1) issued,
      (SELECT count(*)::int FROM operazioni_distribuzione_magazzino WHERE magazzino_id=$4) operations`,
      [product, fixture.beneficiarioId, session, fixture.magazzinoId],
    );
    return facts;
  }

  it.each(["revoca-prima", "checkout-prima"] as const)(
    "B25 R2 concorrenza PostgreSQL %s: contabilità atomica",
    async (order) => {
      const fixture = await createFixture({ saldo: "20.00" });
      const product = await createProdotto({
        magazzinoId: fixture.magazzinoId,
        creditoSolidaleValore: "2.00",
        quantitaResidua: "5",
      });
      const session = await readyCart(fixture, product);
      const app = await stableApp(fixture.areaOperativaId, false);
      const before = await checkoutFacts(fixture, product, session.id);
      const blocker = await pool.connect(),
        revoker = await pool.connect();
      let pending: Promise<request.Response> | undefined,
        revoke: Promise<unknown> | undefined;
      try {
        await blocker.query("BEGIN");
        const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid;
        if (order === "revoca-prima")
          await blocker.query(
            "SELECT id FROM sessioni_cassa_emporio WHERE id=$1 FOR UPDATE",
            [session.id],
          );
        else
          await blocker.query(
            "SELECT id FROM beneficiari WHERE id=$1 FOR UPDATE",
            [fixture.beneficiarioId],
          );
        pending = request(app)
          .post(`/cassa-emporio/sessioni/${session.id}/chiudi`)
          .send({ versione: session.versione })
          .then((r) => r);
        const commandPid = await observedWait(pid);
        revoke = revoker.query(
          "UPDATE utenti SET area_operativa_id=null,centro_ascolto_id=null WHERE id=$1",
          [operatorUserId],
        );
        if (order === "revoca-prima") await revoke;
        else await observedWait(commandPid);
        await blocker.query("COMMIT");
        const result = await pending;
        if (result.status === 200) await trackSpesa(result.body.spesa.id);
        await revoke;
        expect(result.status, result.text).toBe(
          order === "revoca-prima" ? 403 : 200,
        );
        const after = await checkoutFacts(fixture, product, session.id);
        if (order === "revoca-prima") expect(after).toEqual(before);
        else
          expect(after).toEqual({
            stock: 4,
            credit: 18,
            expenses: 1,
            bills: 1,
            issues: 1,
            credit_entries: 1,
            audits: 1,
            issued: 1,
            operations: 1,
          });
        expect(
          (await request(app).get(`/cassa-emporio/sessioni/${session.id}`))
            .status,
        ).toBe(403);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        if (pending) await pending;
        if (revoke) await revoke;
        revoker.release();
      }
    },
  );

  it.each([
    [{ attivo: false }, 400, /Prodotto/i],
    [{ abilitatoEmporio: false }, 400, /abilitato/i],
    [{ unitaMisura: "l" }, 409, /unità di misura/i],
    [{ quantitaFrazionabile: false }, 409, /inter/i],
    [{ quantitaMassimaPerSpesa: "0.25" }, 400, /limite/i],
  ] as const)(
    "B18/B19 Catalogo cambiato dopo preparazione: %j",
    async (change, status, message) => {
      const fixture = await createFixture();
      const product = await createProdotto({
        magazzinoId: fixture.magazzinoId,
        unitaMisura: "kg",
        quantitaFrazionabile: true,
      });
      const session = await readyCart(fixture, product, 0.5);
      await db
        .update(prodottiTable)
        .set(change)
        .where(eq(prodottiTable.id, product));
      const close = await postSessionAction(session.id, "chiudi");
      expect(close.status, close.text).toBe(status);
      expect(close.body.error).toMatch(message);
      expect(
        await db
          .select()
          .from(speseEmporioTable)
          .where(eq(speseEmporioTable.sessioneCassaId, session.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(bolleTable)
          .where(eq(bolleTable.magazzinoId, fixture.magazzinoId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(scarichiTable)
          .where(eq(scarichiTable.magazzinoId, fixture.magazzinoId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(movimentiTable)
          .where(eq(movimentiTable.prodottoId, product)),
      ).toHaveLength(0);
      const [lot] = await db
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.prodottoId, product));
      const [beneficiary] = await db
        .select()
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, fixture.beneficiarioId));
      expect(Number(lot.quantitaResidua)).toBe(10);
      expect(Number(beneficiary.creditoSolidaleSaldo)).toBe(20);
    },
  );

  it("B34 una Spesa con UOM pz/kg conserva dimensioni e un unico fatto distributivo", async () => {
    const fixture = await createFixture();
    const pieces = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      unitaMisura: "pz",
    });
    const kg = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      unitaMisura: "kg",
      creditoSolidaleValore: "8",
    });
    const session = await openSession(fixture.accessoId);
    expect((await addProduct(session.body.id, pieces, 1)).status).toBe(201);
    expect((await addProduct(session.body.id, kg, 0.125)).status).toBe(201);
    expect(
      (await postSessionAction(session.body.id, "pronta-per-chiusura")).status,
    ).toBe(200);
    const close = await postSessionAction(session.body.id, "chiudi");
    expect(close.status, close.text).toBe(200);
    await trackSpesa(close.body.spesa.id);
    const moves = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, close.body.spesa.bollaId));
    expect(moves).toHaveLength(2);
    expect(moves.find((m) => m.prodottoId === pieces)).toMatchObject({
      unitaMisura: "pz",
      quantitaPezzi: "1.00",
    });
    expect(moves.find((m) => m.prodottoId === kg)).toMatchObject({
      unitaMisura: "kg",
      quantitaKgLt: "0.125",
    });
    expect(new Set(moves.map((m) => m.operazioneDistribuzioneId)).size).toBe(1);
    expect(
      moves.every(
        (m) =>
          m.auditEventoId != null && m.lottoId != null && m.bollaRigaId != null,
      ),
    ).toBe(true);
    // M6.2-C: 1 pz × 2 + 0.125 kg × 8 = 3 crediti, senza arrotondamenti.
    expect(close.body.spesa.totaleCreditoConsumati).toBe(3);
  });

  it.each(["saldo", "limite mensile"])(
    "B15 stesso Beneficiario: serializza %s con due checkout da 8",
    async (policy) => {
      const fixture = await createFixture({
        saldo: policy === "saldo" ? "10" : "100",
      });
      const product = await createProdotto({
        magazzinoId: fixture.magazzinoId,
        quantitaResidua: "20",
        creditoSolidaleValore: "1",
        quantitaMassimaMensile: policy === "limite mensile" ? "10" : null,
      });
      const a = await readyCart(fixture, product, 8);
      const secondAccess = await createAccesso({
        beneficiarioId: fixture.beneficiarioId,
        magazzinoId: fixture.magazzinoId,
        dataOraInizio: "2026-07-16T09:00:00",
      });
      const b = await readyCart(
        { ...fixture, accessoId: secondAccess },
        product,
        8,
      );
      expect(b.id).not.toBe(a.id);
      const app = await stableApp(fixture.areaOperativaId);
      const results = await raceAtLot(
        product,
        [a, b].map(
          (session) => () =>
            request(app)
              .post(`/cassa-emporio/sessioni/${session.id}/chiudi`)
              .send({ versione: session.versione })
              .then((r) => r),
        ),
      );
      expect(results.filter((result) => result.status === 200)).toHaveLength(1);
      const denied = results.find((result) => result.status !== 200)!;
      expect(denied.status).toBe(400);
      expect(denied.body.error).toMatch(
        policy === "saldo" ? /saldo|credito/i : /mensile/i,
      );
      const [beneficiary] = await db
        .select()
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, fixture.beneficiarioId));
      expect(Number(beneficiary.creditoSolidaleSaldo)).toBe(
        policy === "saldo" ? 2 : 92,
      );
      const [lot] = await db
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.prodottoId, product));
      expect(Number(lot.quantitaResidua)).toBe(12);
    },
  );

  it.each(["grant", "area", "emporio", "abilitazione"])(
    "B25/B26 revoca %s sulla stessa sessione reale: zero effetti",
    async (kind) => {
      const fixture = await createFixture();
      const product = await createProdotto({
        magazzinoId: fixture.magazzinoId,
      });
      const session = await readyCart(fixture, product);
      const app = await stableApp(fixture.areaOperativaId, false);
      if (kind === "grant") {
        const [actor] = await db
          .select()
          .from(utentiTable)
          .where(eq(utentiTable.id, operatorUserId));
        await db
          .update(ruoliTable)
          .set({ permessi: [] })
          .where(eq(ruoliTable.id, actor.ruoloId!));
      }
      if (kind === "area")
        await db
          .update(utentiTable)
          .set({ areaOperativaId: null })
          .where(eq(utentiTable.id, operatorUserId));
      if (kind === "emporio")
        await db
          .update(magazziniTable)
          .set({ stato: "inattivo" })
          .where(eq(magazziniTable.id, fixture.magazzinoId));
      if (kind === "abilitazione")
        await db
          .update(emporioAbilitazioniTable)
          .set({ stato: "revocato" })
          .where(
            eq(emporioAbilitazioniTable.beneficiarioId, fixture.beneficiarioId),
          );
      const denied = await request(app)
        .post(`/cassa-emporio/sessioni/${session.id}/chiudi`)
        .send({ versione: session.versione });
      expect(denied.status).toBe(["grant", "area"].includes(kind) ? 403 : 400);
      expect(
        await db
          .select()
          .from(speseEmporioTable)
          .where(eq(speseEmporioTable.sessioneCassaId, session.id)),
      ).toHaveLength(0);
      const [lot] = await db
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.prodottoId, product));
      expect(Number(lot.quantitaResidua)).toBe(10);
      expect(
        (await request(app).get(`/spese-emporio/sessione/${session.id}`))
          .status,
      ).toBe(["grant", "area"].includes(kind) ? 403 : 400);
    },
  );

  it.each([
    ["B27", "spese_emporio", "INSERT"],
    ["B28", "lotti", "UPDATE"],
    ["B29-credito", "credito_solidale_movimenti", "INSERT"],
    ["B29-audit/B31", "audit_eventi", "INSERT"],
  ])(
    "%s fault injection PostgreSQL: rollback totale",
    async (_code, table, operation) => {
      expect(
        process.env.M62B_DISPOSABLE_DB,
        "fault injection solo su DB effimero esplicito",
      ).toBe("verified");
      const fixture = await createFixture();
      const product = await createProdotto({
        magazzinoId: fixture.magazzinoId,
      });
      const session = await readyCart(fixture, product);
      const app = await stableApp(fixture.areaOperativaId);
      const connection = await pool.connect();
      const trigger = `m62b_fault_${rnd()}`;
      const condition =
        table === "lotti"
          ? `NEW.prodotto_id = ${product}`
          : table === "audit_eventi"
            ? `NEW.azione = 'EMPORIO_CHECKOUT' AND NEW.metadata->>'cassaId' = '${session.id}'`
            : `NEW.beneficiario_id = ${fixture.beneficiarioId}`;
      try {
        await connection.query(
          `CREATE FUNCTION pg_temp.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'M62B injected fault'; END $$`,
        );
        await connection.query(
          `CREATE TRIGGER ${trigger} BEFORE ${operation} ON ${table} FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION pg_temp.${trigger}()`,
        );
        const close = await request(app)
          .post(`/cassa-emporio/sessioni/${session.id}/chiudi`)
          .send({ versione: session.versione });
        expect(close.status).toBe(500);
        const [lot] = await db
          .select()
          .from(lottiTable)
          .where(eq(lottiTable.prodottoId, product));
        const [beneficiary] = await db
          .select()
          .from(beneficiariTable)
          .where(eq(beneficiariTable.id, fixture.beneficiarioId));
        const [current] = await db
          .select()
          .from(sessioniCassaEmporioTable)
          .where(eq(sessioniCassaEmporioTable.id, session.id));
        expect(Number(lot.quantitaResidua)).toBe(10);
        expect(Number(beneficiary.creditoSolidaleSaldo)).toBe(20);
        expect(current.statoSessione).toBe("pronta_per_chiusura");
        expect(current.spesaEmporioId).toBeNull();
        expect(
          await db
            .select()
            .from(speseEmporioTable)
            .where(eq(speseEmporioTable.sessioneCassaId, session.id)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(bolleTable)
            .where(eq(bolleTable.magazzinoId, fixture.magazzinoId)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(scarichiTable)
            .where(eq(scarichiTable.magazzinoId, fixture.magazzinoId)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(movimentiTable)
            .where(eq(movimentiTable.prodottoId, product)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(creditoSolidaleMovimentiTable)
            .where(
              eq(
                creditoSolidaleMovimentiTable.beneficiarioId,
                fixture.beneficiarioId,
              ),
            ),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(operazioniDistribuzioneMagazzinoTable)
            .where(
              eq(
                operazioniDistribuzioneMagazzinoTable.magazzinoId,
                fixture.magazzinoId,
              ),
            ),
        ).toHaveLength(0);
        const events = await db
          .select()
          .from(auditEventiTable)
          .where(eq(auditEventiTable.magazzinoIdSnapshot, fixture.magazzinoId));
        expect(
          events.filter((event) => event.azione === "EMPORIO_CHECKOUT"),
        ).toHaveLength(0);
        expect(
          (await request(app).get(`/spese-emporio/sessione/${session.id}`))
            .status,
        ).toBe(404);
      } finally {
        await connection.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
        await connection.query(`DROP FUNCTION IF EXISTS pg_temp.${trigger}()`);
        connection.release();
      }
    },
  );

  it("B12/B34 FEFO 3+5, fondi e fattori fisici diversi conservati nei movimenti", async () => {
    const fixture = await createFixture({ saldo: "100" });
    const product = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      quantitaResidua: "3",
      creditoSolidaleValore: "1",
      dataScadenza: "2030-01-01",
    });
    const firstLot = lottoIds.at(-1)!;
    await db
      .update(lottiTable)
      .set({ fattoreKgLtPezzo: "0.5" })
      .where(eq(lottiTable.id, firstLot));
    const [second] = await db
      .insert(lottiTable)
      .values({
        prodottoId: product,
        magazzinoId: fixture.magazzinoId,
        codiceLotto: `B34-${rnd()}`,
        dataCarico: todayInput(),
        dataScadenza: "2030-02-01",
        quantitaCaricata: "5",
        quantitaResidua: "5",
        fsePlus: true,
        fondoOrigine: "FSE_PLUS",
        fattoreKgLtPezzo: "0.75",
      })
      .returning();
    lottoIds.push(second.id);
    const session = await readyCart(fixture, product, 8);
    const close = await postSessionAction(session.id, "chiudi");
    expect(close.status, close.text).toBe(200);
    await trackSpesa(close.body.spesa.id);
    const moves = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, close.body.spesa.bollaId));
    expect(moves).toHaveLength(2);
    expect(
      moves.map((m) => [
        m.lottoId,
        Number(m.quantita),
        m.fondoOrigine,
        Number(m.fattoreKgLtPezzo),
      ]),
    ).toEqual([
      [firstLot, 3, "NESSUN_FONDO", 0.5],
      [second.id, 5, "FSE_PLUS", 0.75],
    ]);
    expect(
      moves.every(
        (m) =>
          m.bollaRigaId &&
          m.operazioneDistribuzioneId &&
          m.auditEventoId &&
          m.unitaMisura === "pz",
      ),
    ).toBe(true);
  });

  it("B13 stock 10 prenotato 7: 4 negato, 3 consentito, prenotazione intatta", async () => {
    const fixture = await createFixture({ saldo: "100" });
    const product = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "1",
    });
    const session = await readyCart(fixture, product, 4);
    const [bolla] = await db
      .insert(bolleTable)
      .values({
        numeroBolla: `B13-${rnd()}`,
        dataBolla: todayInput(),
        beneficiarioId: fixture.beneficiarioId,
        magazzinoId: fixture.magazzinoId,
        stato: "confermato",
      })
      .returning();
    bollaIds.push(bolla.id);
    const [row] = await db
      .insert(bollaRigheTable)
      .values({
        bollaId: bolla.id,
        prodottoId: product,
        quantita: "7",
        unitaMisura: "pz",
        descrizione: "B13",
      })
      .returning();
    const [reservation] = await db
      .insert(prenotazioniMagazzinoTable)
      .values({
        bollaId: bolla.id,
        rigaBollaId: row.id,
        prodottoId: product,
        magazzinoId: fixture.magazzinoId,
        lottoId: lottoIds.at(-1)!,
        quantita: "7",
      })
      .returning();
    const denied = await postSessionAction(session.id, "chiudi");
    expect(denied.status).toBe(409);
    expect(denied.body.error).toMatch(/giacenza|disponibil/i);
    const [cartRow] = await db
      .select()
      .from(sessioniCassaEmporioRigheTable)
      .where(eq(sessioniCassaEmporioRigheTable.sessioneCassaId, session.id));
    expect(
      (
        await request(makeApp())
          .patch(`/cassa-emporio/sessioni/${session.id}/righe/${cartRow.id}`)
          .send({
            versione: await getSessionVersion(session.id),
            quantita: "3",
          })
      ).status,
    ).toBe(200);
    await postSessionAction(session.id, "pronta-per-chiusura");
    const close = await postSessionAction(session.id, "chiudi");
    expect(close.status).toBe(200);
    await trackSpesa(close.body.spesa.id);
    const [lot] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.prodottoId, product));
    expect(Number(lot.quantitaResidua)).toBe(7);
    const [unchanged] = await db
      .select()
      .from(prenotazioniMagazzinoTable)
      .where(eq(prenotazioniMagazzinoTable.id, reservation.id));
    expect(unchanged.stato).toBe("attiva");
    expect(Number(unchanged.quantita)).toBe(7);
  });

  async function stableApp(areaOperativaId: number, admin = true) {
    const actor = await emporioActorFixture({
      id: operatorUserId,
      isAdmin: admin,
      permessi: ["emporio.cassa.view", "emporio.cassa.operate"],
      aree: ["emporio", "magazzino"],
      areaOperativaId,
      centroAscoltoId: null,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = actor;
      next();
    });
    app.use(
      cassaEmporioRouter,
      speseEmporioRouter,
      bolleRouter,
      trasferimentiRouter,
      scarichiRouter,
      mensaRouter,
    );
    return app;
  }

  async function readyCart(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    product: number,
    quantity = 1,
  ) {
    const opened = await openSession(fixture.accessoId);
    expect(opened.status).toBe(201);
    expect((await addProduct(opened.body.id, product, quantity)).status).toBe(
      201,
    );
    const ready = await postSessionAction(
      opened.body.id,
      "pronta-per-chiusura",
    );
    expect(ready.status).toBe(200);
    return ready.body as { id: number; versione: number };
  }

  async function raceAtLot(
    product: number,
    contenders: Array<() => Promise<request.Response>>,
  ) {
    const blocker = await pool.connect();
    let pending: Array<Promise<request.Response>> = [];
    try {
      await blocker.query("BEGIN");
      const {
        rows: [{ pid }],
      } = await blocker.query("SELECT pg_backend_pid() pid");
      await blocker.query(
        "SELECT id FROM lotti WHERE prodotto_id=$1 ORDER BY id FOR UPDATE",
        [product],
      );
      pending = contenders.map((start) => start());
      let blocked = 0;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        await blocker.query("SELECT pg_stat_clear_snapshot()");
        const result = await blocker.query(
          `WITH RECURSIVE waiters AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiters w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*)::int n FROM waiters`,
          [pid],
        );
        blocked = result.rows[0].n;
        if (blocked >= contenders.length) break;
      }
      expect(
        blocked,
        "tutti i contender devono attendere lock PostgreSQL reali",
      ).toBeGreaterThanOrEqual(contenders.length);
      await blocker.query("COMMIT");
      return await Promise.all(pending);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      const results = await Promise.all(pending);
      for (const result of results)
        if (
          result.status === 200 &&
          result.body.spesa &&
          !spesaIds.includes(result.body.spesa.id)
        )
          await trackSpesa(result.body.spesa.id);
      for (const result of results)
        if (
          result.status < 300 &&
          result.body.scaricoId &&
          !scaricoIds.includes(result.body.scaricoId)
        )
          scaricoIds.push(result.body.scaricoId);
      for (const result of results)
        if (
          result.status === 201 &&
          result.body.codice?.startsWith("SC-") &&
          !scaricoIds.includes(result.body.id)
        )
          scaricoIds.push(result.body.id);
    }
  }

  it.each(["Bolla", "Trasferimento", "Scarico", "Mensa"] as const)(
    "B07…B10 Cassa contro %s: stock e prenotazioni entro disponibilità",
    async (kind) => {
      const fixture = await createFixture({ tipoMagazzino: "misto" });
      const product = await createProdotto({
        magazzinoId: fixture.magazzinoId,
        quantitaResidua: "1",
        creditoSolidaleValore: "1",
      });
      const session = await readyCart(fixture, product);
      const app = await stableApp(fixture.areaOperativaId);
      const cash = () =>
        request(app)
          .post(`/cassa-emporio/sessioni/${session.id}/chiudi`)
          .send({ versione: session.versione })
          .then((r) => r);
      let other: () => Promise<request.Response>;
      let competingBolla: number | undefined,
        competingTransfer: number | undefined;
      if (kind === "Bolla") {
        const [bolla] = await db
          .insert(bolleTable)
          .values({
            numeroBolla: `M62B-${rnd()}`,
            dataBolla: todayInput(),
            beneficiarioId: fixture.beneficiarioId,
            magazzinoId: fixture.magazzinoId,
            operatoreId: operatorUserId,
            stato: "bozza",
          })
          .returning();
        bollaIds.push(bolla.id);
        competingBolla = bolla.id;
        await db.insert(bollaRigheTable).values({
          bollaId: bolla.id,
          prodottoId: product,
          quantita: "1",
          unitaMisura: "pz",
          descrizione: "M62B",
        });
        other = () =>
          request(app)
            .post(`/bolle/${bolla.id}/conferma`)
            .send({ versione: bolla.versione, idempotencyKey: `b-${rnd()}` })
            .then((r) => r);
      } else if (kind === "Trasferimento") {
        const destination = await createMagazzino(
          "logistico",
          fixture.areaOperativaId,
          fixture.centroId,
        );
        const [transfer] = await db
          .insert(trasferimentiTable)
          .values({
            codice: `M62B-${rnd()}`,
            magazzinoOrigineId: fixture.magazzinoId,
            magazzinoDestinoId: destination,
            dataRichiesta: todayInput(),
            operatoreId: operatorUserId,
            trasportatoreNome: "Fixture M62B",
          })
          .returning();
        transferIds.push(transfer.id);
        competingTransfer = transfer.id;
        await db.insert(trasferimentoRigheTable).values({
          trasferimentoId: transfer.id,
          prodottoId: product,
          quantita: "1",
          unitaMisura: "pz",
        });
        other = () =>
          request(app)
            .post(`/trasferimenti/${transfer.id}/prepara`)
            .send({ versione: transfer.versione, idempotencyKey: `t-${rnd()}` })
            .then((r) => r);
      } else if (kind === "Scarico") {
        await updateModuloAmbiente("SCARICHI", true);
        other = () =>
          request(app)
            .post("/scarichi")
            .send({
              magazzinoId: fixture.magazzinoId,
              dataScarico: todayInput(),
              causale: "deteriorata",
              righe: [
                { prodottoId: product, quantita: "1", unitaMisura: "pz" },
              ],
            })
            .then((r) => r);
      } else {
        await updateModuloAmbiente("MENSA", true);
        const [mensa] = await db
          .insert(menseTable)
          .values({
            codice: `M62B-${rnd()}`,
            nome: "M62B Mensa sintetica",
            areaOperativaId: fixture.areaOperativaId,
            magazzinoId: fixture.magazzinoId,
          })
          .returning();
        mensaIds.push(mensa.id);
        const denied = await request(app)
          .post("/mensa/consumi")
          .send({
            mensaId: mensa.id,
            prodottoId: product,
            quantita: "1",
            dataServizio: todayInput(),
            tipoServizio: "pranzo",
            causale: "consumo",
            idempotencyKey: `m-${rnd()}`,
          });
        expect(denied.status).toBe(409);
        expect(denied.body.error).toContain("Mensa o il magazzino");
        // I gateway non autorizzano contemporaneamente Cassa e Mensa sulla stessa sede.
        // La contesa fisica viene quindi provata al confine del motore realmente usato da Mensa.
        other = async () => {
          try {
            const id = await db.transaction((tx) =>
              creaScaricoInventariale(tx, {
                codice: `MB-${rnd()}`,
                magazzinoId: fixture.magazzinoId,
                centroAscoltoId: fixture.centroId,
                dataScarico: todayInput(),
                causale: "altro",
                causaleAltro: "Consumo Mensa",
                operatoreId: operatorUserId,
                source: {
                  dominioOrigine: "MENSA",
                  entitaOrigineTipo: "mensa_giornata_servizio",
                  entitaOrigineId: mensa.id,
                  naturaContabile: "DISTRIBUZIONE_FINALE",
                  canaleOperativo: "MENSA",
                },
                operazioneDistribuzione: {
                  canaleOperativo: "MENSA",
                  dominioOrigine: "MENSA",
                  entitaOrigineTipo: "mensa_giornata_servizio",
                  entitaOrigineId: mensa.id,
                  areaOperativaIdSnapshot: fixture.areaOperativaId,
                  centroAscoltoIdSnapshot: fixture.centroId,
                  territorioClassificazione: "attribuito",
                },
                righe: [
                  { prodottoId: product, quantita: "1", unitaMisura: "pz" },
                ],
              }),
            );
            scaricoIds.push(id);
            return {
              status: 201,
              body: { scaricoId: id },
              text: "Mensa inventory primitive",
            } as request.Response;
          } catch (error) {
            if (!(error instanceof InventoryError)) throw error;
            return {
              status: error.status,
              body: { error: error.message },
              text: error.message,
            } as request.Response;
          }
        };
      }
      const results = await raceAtLot(product, [cash, other]);
      expect(
        results.filter((r) => r.status < 300),
        results.map((r) => r.text).join("\n"),
      ).toHaveLength(1);
      const denied = results.find((r) => r.status >= 400)!;
      expect([400, 409]).toContain(denied.status);
      expect(denied.body.error).toMatch(/giacenza|disponibil|insufficiente/i);
      const [lot] = await db
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.prodottoId, product));
      const moves = await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.prodottoId, product));
      const reservations = await db
        .select()
        .from(prenotazioniMagazzinoTable)
        .where(eq(prenotazioniMagazzinoTable.prodottoId, product));
      expect(Number(lot.quantitaResidua)).toBeGreaterThanOrEqual(0);
      expect(
        moves.reduce((n, m) => n + Number(m.quantita), 0) +
          reservations
            .filter((r) => r.stato === "attiva")
            .reduce((n, r) => n + Number(r.quantita), 0),
      ).toBe(1);
      const cashWon = results[0].status === 200;
      const facts = await checkoutFacts(fixture, product, session.id);
      expect(facts.expenses).toBe(cashWon ? 1 : 0);
      expect(facts.credit).toBe(cashWon ? 19 : 20);
      expect(facts.credit_entries).toBe(cashWon ? 1 : 0);
      expect(facts.audits).toBe(cashWon ? 1 : 0);
      const reserved =
        !cashWon && (kind === "Bolla" || kind === "Trasferimento");
      expect(facts.stock).toBe(reserved ? 1 : 0);
      expect(facts.issued).toBe(reserved ? 0 : 1);
      expect(facts.issues).toBe(reserved ? 0 : 1);
      // Deteriorata is an adjustment, not a final distribution operation.
      expect(facts.operations).toBe(
        reserved || (!cashWon && kind === "Scarico") ? 0 : 1,
      );
      expect(facts.bills).toBe((competingBolla ? 1 : 0) + (cashWon ? 1 : 0));
      const active = reservations.filter((r) => r.stato === "attiva");
      expect(active).toHaveLength(reserved ? 1 : 0);
      if (reserved)
        expect(active[0]).toMatchObject({
          bollaId: competingBolla ?? null,
          trasferimentoId: competingTransfer ?? null,
        });
      if (competingBolla)
        expect(
          (
            await db
              .select()
              .from(bolleTable)
              .where(eq(bolleTable.id, competingBolla))
          )[0].stato,
        ).toBe(cashWon ? "bozza" : "confermato");
      if (competingTransfer)
        expect(
          (
            await db
              .select()
              .from(trasferimentiTable)
              .where(eq(trasferimentiTable.id, competingTransfer))
          )[0].stato,
        ).toBe(cashWon ? "bozza" : "preparato");
      if (cashWon) {
        const expense = results[0].body.spesa;
        expect(moves).toHaveLength(1);
        expect(moves[0]).toMatchObject({
          bollaId: expense.bollaId,
          entitaOrigineId: expense.id,
          entitaOrigineTipo: "spesa_emporio",
        });
        const [issueLine] = await db
          .select()
          .from(scaricoRigheTable)
          .where(eq(scaricoRigheTable.scaricoId, expense.scaricoId));
        expect(Number(issueLine.quantita)).toBe(1);
        expect(
          await db
            .select()
            .from(scaricoRigheTable)
            .where(eq(scaricoRigheTable.scaricoId, expense.scaricoId)),
        ).toEqual([
          expect.objectContaining({
            prodottoId: product,
            quantita: expect.any(String),
          }),
        ]);
        expect(
          await db
            .select()
            .from(speseEmporioRigheTable)
            .where(eq(speseEmporioRigheTable.spesaEmporioId, expense.id)),
        ).toEqual([
          expect.objectContaining({
            prodottoId: product,
            lottoId: lot.id,
            scaricoId: expense.scaricoId,
            bollaRigaId: moves[0].bollaRigaId,
          }),
        ]);
        expect(moves[0].auditEventoId).not.toBeNull();
        const [credit] = await db
          .select()
          .from(creditoSolidaleMovimentiTable)
          .where(
            eq(
              creditoSolidaleMovimentiTable.beneficiarioId,
              fixture.beneficiarioId,
            ),
          );
        expect(Number(credit.variazioneCredito)).toBe(-1);
        expect(Number(credit.saldoPrima)).toBe(20);
        expect(Number(credit.saldoDopo)).toBe(19);
      } else if (!reserved) {
        expect(moves).toHaveLength(1);
        expect(moves[0].bollaId).toBeNull();
        const [issueLine] = await db
          .select()
          .from(scaricoRigheTable)
          .where(eq(scaricoRigheTable.prodottoId, product));
        expect(Number(issueLine.quantita)).toBe(1);
        expect(
          await db
            .select()
            .from(scaricoRigheTable)
            .where(eq(scaricoRigheTable.prodottoId, product)),
        ).toEqual([
          expect.objectContaining({
            prodottoId: product,
            quantita: expect.any(String),
          }),
        ]);
      }
    },
  );

  it("B22/B24 recupero GET della propria sessione senza sales.view; niente directory o stampa", async () => {
    const fixture = await createFixture();
    const product = await createProdotto({ magazzinoId: fixture.magazzinoId });
    const session = await readyCart(fixture, product);
    const app = await stableApp(fixture.areaOperativaId, false);
    const close = await request(app)
      .post(`/cassa-emporio/sessioni/${session.id}/chiudi`)
      .send({ versione: session.versione });
    expect(close.status, close.text).toBe(200);
    await trackSpesa(close.body.spesa.id);
    const recovered = await request(app).get(
      `/spese-emporio/sessione/${session.id}`,
    );
    expect(recovered.status).toBe(200);
    expect(recovered.body.id).toBe(close.body.spesa.id);
    expect((await request(app).get("/spese-emporio")).status).toBe(403);
    expect(
      (
        await request(app).get(
          `/spese-emporio/${close.body.spesa.id}/bolla-stampa`,
        )
      ).status,
    ).toBe(403);
    await db
      .update(sessioniCassaEmporioTable)
      .set({ operatoreChiusuraId: null, operatoreAperturaId: null })
      .where(eq(sessioniCassaEmporioTable.id, session.id));
    expect(
      (await request(app).get(`/spese-emporio/sessione/${session.id}`)).status,
    ).toBe(404);
  });

  it("B18 PATCH non riscrive la UOM salvata dopo modifica Catalogo", async () => {
    const fixture = await createFixture();
    const product = await createProdotto({ magazzinoId: fixture.magazzinoId });
    const session = await openSession(fixture.accessoId);
    const row = await addProduct(session.body.id, product);
    await db
      .update(prodottiTable)
      .set({ unitaMisura: "kg" })
      .where(eq(prodottiTable.id, product));
    const changed = await request(makeApp())
      .patch(`/cassa-emporio/sessioni/${session.body.id}/righe/${row.body.id}`)
      .send({
        quantita: 2,
        versione: await getSessionVersion(session.body.id),
      });
    expect(changed.status).toBe(409);
    expect(changed.body.error).toContain("unità di misura");
    const [saved] = await db
      .select()
      .from(sessioniCassaEmporioRigheTable)
      .where(eq(sessioniCassaEmporioRigheTable.id, row.body.id));
    expect(saved.unitaMisura).toBe("pz");
    expect(Number(saved.quantita)).toBe(1);
  });

  it("B06 due Casse ultimo pezzo: lock PostgreSQL osservabile, una sola uscita", async () => {
    const first = await createFixture();
    const product = await createProdotto({
      magazzinoId: first.magazzinoId,
      quantitaResidua: "1",
      creditoSolidaleValore: "1",
    });
    const secondBeneficiary = await createBeneficiario({
      areaOperativaId: first.areaOperativaId,
      centroAscoltoId: first.centroId,
      saldo: "20",
      magazzinoEmporioPreferitoId: first.magazzinoId,
    });
    const accessoId = await createAccesso({
      beneficiarioId: secondBeneficiary,
      magazzinoId: first.magazzinoId,
    });
    const a = await readyCart(first, product);
    const b = await readyCart(
      { ...first, beneficiarioId: secondBeneficiary, accessoId },
      product,
    );
    const app = await stableApp(first.areaOperativaId);
    const blocker = await pool.connect();
    let pending: Array<Promise<request.Response>> = [];
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
        .pid;
      await blocker.query(
        "SELECT id FROM lotti WHERE prodotto_id=$1 FOR UPDATE",
        [product],
      );
      pending = [a, b].map((session) =>
        request(app)
          .post(`/cassa-emporio/sessioni/${session.id}/chiudi`)
          .send({ versione: session.versione })
          .then((result) => result),
      );
      const deadline = Date.now() + 10000;
      let blocked = 0;
      while (Date.now() < deadline) {
        await blocker.query("SELECT pg_stat_clear_snapshot()");
        const result = await blocker.query(
          `WITH RECURSIVE waiters AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiters w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*)::int n FROM waiters`,
          [pid],
        );
        blocked = result.rows[0].n;
        if (blocked >= 2) break;
      }
      expect(
        blocked,
        "due connessioni devono essere realmente in attesa del lock",
      ).toBeGreaterThanOrEqual(2);
      await blocker.query("COMMIT");
      const results = await Promise.all(pending);
      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      for (const result of results)
        if (result.status === 200) await trackSpesa(result.body.spesa.id);
      const [lot] = await db
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.prodottoId, product));
      expect(Number(lot.quantitaResidua)).toBe(0);
      const movements = await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.prodottoId, product));
      expect(
        movements.reduce(
          (total, movement) => total + Number(movement.quantita),
          0,
        ),
      ).toBe(1);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      const results = await Promise.all(pending);
      for (const result of results)
        if (result.status === 200 && !spesaIds.includes(result.body.spesa.id))
          await trackSpesa(result.body.spesa.id);
    }
  });

  it("B16/B17 congela il prezzo all'aggiunta anche dopo PATCH quantità", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
    });
    const sessione = await openSession(fixture.accessoId);
    const added = await addProduct(sessione.body.id, prodottoId);
    expect(added.status).toBe(201);
    await db
      .update(prodottiTable)
      .set({ creditoSolidaleValore: "3.00" })
      .where(eq(prodottiTable.id, prodottoId));
    const changed = await request(makeApp())
      .patch(
        `/cassa-emporio/sessioni/${sessione.body.id}/righe/${added.body.id}`,
      )
      .send({
        quantita: "2",
        versione: await getSessionVersion(sessione.body.id),
      });
    expect(changed.status).toBe(200);
    expect(changed.body.creditoUnitario).toBe(2);
    expect(changed.body.creditoTotale).toBe(4);
    const newer = await addProduct(sessione.body.id, prodottoId);
    expect(newer.body.creditoUnitario).toBe(3);
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    const close = await postSessionAction(sessione.body.id, "chiudi");
    expect(close.status).toBe(200);
    await trackSpesa(close.body.spesa.id);
    expect(close.body.spesa.totaleCreditoConsumati).toBe(7);
  });

  it("B30 collega checkout e movimenti a un unico audit comune con attore e correlation", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
    });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId);
    const ready = await postSessionAction(
      sessione.body.id,
      "pronta-per-chiusura",
    );
    const close = await request(makeApp())
      .post(`/cassa-emporio/sessioni/${sessione.body.id}/chiudi`)
      .send({ versione: ready.body.versione });
    expect(close.status).toBe(200);
    await trackSpesa(close.body.spesa.id);
    const events = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.entitaId, close.body.spesa.id));
    const checkoutEvents = events.filter(
      (event) => event.azione === "EMPORIO_CHECKOUT",
    );
    expect(checkoutEvents).toHaveLength(1);
    expect(checkoutEvents[0].actorUserId).toBe(operatorUserId);
    expect(checkoutEvents[0].actorCodeSnapshot).toBeTruthy();
    expect(checkoutEvents[0].correlationId).toBeTruthy();
    expect(checkoutEvents[0].metadata).toMatchObject({
      cassaId: sessione.body.id,
      bollaId: close.body.spesa.bollaId,
      scaricoId: close.body.spesa.scaricoId,
    });
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, close.body.spesa.bollaId));
    expect(movements.length).toBeGreaterThan(0);
    expect(
      movements.every((m) => m.auditEventoId === checkoutEvents[0].id),
    ).toBe(true);
  });

  it("applica RBAC dedicato a Cassa, force e Spese anche per utenti non-admin", async () => {
    for (const area of ["sociale", "uds"]) {
      const denied = makeApp({ isAdmin: false, aree: [area], permessi: [] });
      expect(
        (await request(denied).get("/cassa-emporio/sessioni")).status,
      ).toBe(403);
      expect((await request(denied).get("/spese-emporio")).status).toBe(403);
    }

    const territory = await createFixture();
    const viewOnly = makeApp({
      isAdmin: false,
      permessi: ["emporio.cassa.view", "emporio.sales.view"],
      areaOperativaId: territory.areaOperativaId,
    });
    expect(
      (await request(viewOnly).get("/cassa-emporio/sessioni")).status,
    ).toBe(200);
    expect((await request(viewOnly).get("/spese-emporio")).status).toBe(200);
    expect(
      (
        await request(viewOnly)
          .post("/cassa-emporio/accessi/1/apri-sessione")
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(viewOnly)
          .post("/spese-emporio/1/registra-invio-manuale-bolla")
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(viewOnly)
          .post("/spese-emporio/1/storna")
          .send({ motivo: "No" })
      ).status,
    ).toBe(403);

    const operate = makeApp({
      isAdmin: false,
      permessi: ["emporio.cassa.view", "emporio.cassa.operate"],
    });
    expect(
      (await request(operate).post("/cassa-emporio/accessi/forza").send({}))
        .status,
    ).toBe(403);
  });

  it("apre una sessione da Accesso Emporio valido e marca l'accesso effettuato", async () => {
    const fixture = await createFixture();
    const res = await openSession(fixture.accessoId);
    expect(res.status).toBe(201);
    expect(res.body.accessoEmporioId).toBe(fixture.accessoId);
    expect(res.body.statoSessione).toBe("aperta");
    expect(res.body.saldoCreditoIniziale).toBe(20);
    expect(res.body.creditoResiduoPrevisto).toBe(20);

    const [accesso] = await db
      .select()
      .from(consegneTable)
      .where(eq(consegneTable.id, fixture.accessoId));
    expect(accesso.statoAccessoEmporio).toBe("effettuato");
  });

  it("impedisce due Sessioni concorrenti sullo stesso Accesso", async () => {
    const fixture = await createFixture();
    const [first, second] = await Promise.all([
      request(makeApp())
        .post(`/cassa-emporio/accessi/${fixture.accessoId}/apri-sessione`)
        .send({}),
      request(makeApp())
        .post(`/cassa-emporio/accessi/${fixture.accessoId}/apri-sessione`)
        .send({}),
    ]);
    const created = [first, second].find((result) => result.status === 201);
    expect(created).toBeDefined();
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    sessioneIds.push(created!.body.id);
    const rows = await db
      .select()
      .from(sessioniCassaEmporioTable)
      .where(eq(sessioniCassaEmporioTable.accessoEmporioId, fixture.accessoId));
    expect(rows).toHaveLength(1);
  });

  it("rifiuta una seconda mutazione con versione stale", async () => {
    const fixture = await createFixture();
    const firstProduct = await createProdotto({
      magazzinoId: fixture.magazzinoId,
    });
    const secondProduct = await createProdotto({
      magazzinoId: fixture.magazzinoId,
    });
    const sessione = await openSession(fixture.accessoId);
    const versione = sessione.body.versione;
    const [first, second] = await Promise.all([
      request(makeApp())
        .post(`/cassa-emporio/sessioni/${sessione.body.id}/righe`)
        .send({ prodottoId: firstProduct, quantita: 1, versione }),
      request(makeApp())
        .post(`/cassa-emporio/sessioni/${sessione.body.id}/righe`)
        .send({ prodottoId: secondProduct, quantita: 1, versione }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const created = [first, second].find((result) => result.status === 201);
    if (created?.body.id) rigaIds.push(created.body.id);
    const rows = await db
      .select()
      .from(sessioniCassaEmporioRigheTable)
      .where(
        eq(sessioniCassaEmporioRigheTable.sessioneCassaId, sessione.body.id),
      );
    expect(rows).toHaveLength(1);
  });

  it("recupera oltre 100 Sessioni e oltre 200 Spese senza cap silenziosi", async () => {
    const codiceBeneficiario = `PAGE-${rnd()}`;
    const fixture = await createFixture({ codiceBeneficiario });
    const extraAccessi = Array.from({ length: 200 }, (_, index) => {
      const date = new Date(Date.UTC(2027, 0, index + 1, 9));
      return {
        codice: `EMP-PAGE-${rnd()}-${index}`,
        beneficiarioId: fixture.beneficiarioId,
        tipoPianificazione: "accesso_emporio" as const,
        tipoConsegna: "accesso_emporio",
        dataPrevista: date.toISOString().slice(0, 10),
        magazzinoId: fixture.magazzinoId,
        magazzinoEmporioId: fixture.magazzinoId,
        dataOraInizio: date,
        stato: "effettuata",
        statoAccessoEmporio: "effettuato" as const,
      };
    });
    const accessi = await db
      .insert(consegneTable)
      .values(extraAccessi)
      .returning({ id: consegneTable.id });
    consegnaIds.push(...accessi.map((row) => row.id));
    const allAccessoIds = [fixture.accessoId, ...accessi.map((row) => row.id)];
    const sessions = await db
      .insert(sessioniCassaEmporioTable)
      .values(
        allAccessoIds.map((accessoEmporioId) => ({
          accessoEmporioId,
          beneficiarioId: fixture.beneficiarioId,
          magazzinoEmporioId: fixture.magazzinoId,
          centroAscoltoId: fixture.centroId,
          areaOperativaId: fixture.areaOperativaId,
          statoSessione: "chiusa",
          saldoCreditoIniziale: "20.00",
          creditoResiduoPrevisto: "20.00",
        })),
      )
      .returning({
        id: sessioniCassaEmporioTable.id,
        accessoEmporioId: sessioniCassaEmporioTable.accessoEmporioId,
      });
    sessioneIds.push(...sessions.map((row) => row.id));
    const expenses = await db
      .insert(speseEmporioTable)
      .values(
        sessions.map((sessione, index) => ({
          sessioneCassaId: sessione.id,
          accessoEmporioId: sessione.accessoEmporioId,
          beneficiarioId: fixture.beneficiarioId,
          centroAscoltoId: fixture.centroId,
          areaOperativaId: fixture.areaOperativaId,
          magazzinoEmporioId: fixture.magazzinoId,
          numeroSpesa: `EMP-PAGE-${Date.now()}-${index}`,
          totaleCreditoConsumati: "0.00",
          saldoPrima: "20.00",
          saldoDopo: "20.00",
          operatoreChiusuraId: operatorUserId,
        })),
      )
      .returning({ id: speseEmporioTable.id });
    spesaIds.push(...expenses.map((row) => row.id));

    const sessionPage = await request(makeApp())
      .get("/cassa-emporio/sessioni")
      .query({ beneficiarioSearch: codiceBeneficiario, page: 3, limit: 100 });
    const expensePage = await request(makeApp())
      .get("/spese-emporio")
      .query({ beneficiarioSearch: codiceBeneficiario, page: 3, limit: 100 });
    expect(sessionPage.status).toBe(200);
    expect(sessionPage.headers["x-total-count"]).toBe("201");
    expect(sessionPage.body).toHaveLength(1);
    expect(expensePage.status).toBe(200);
    expect(expensePage.headers["x-total-count"]).toBe("201");
    expect(expensePage.body).toHaveLength(1);
  });

  it("blocca apertura se Emporio è disabilitato", async () => {
    const fixture = await createFixture();
    await setEmporioEnabled(false);
    const res = await openSession(fixture.accessoId);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(
      "Il modulo Emporio Solidale è disabilitato. Abilitalo da Impostazioni Moduli per utilizzare questa funzione.",
    );
  });

  it("blocca apertura e Accesso forzato su Emporio inattivo", async () => {
    const fixture = await createFixture();
    await db
      .update(magazziniTable)
      .set({ stato: "inattivo" })
      .where(eq(magazziniTable.id, fixture.magazzinoId));
    const opening = await openSession(fixture.accessoId);
    expect(opening.status).toBe(400);
    const forced = await request(makeApp())
      .post("/cassa-emporio/accessi/forza")
      .send({
        beneficiarioId: fixture.beneficiarioId,
        magazzinoEmporioId: fixture.magazzinoId,
        motivoAccessoForzato: "Test inattivo",
      });
    expect(forced.status).toBe(400);
  });

  it.each(["annullato", "non_presentato"] as const)(
    "blocca apertura da accesso %s",
    async (stato) => {
      const fixture = await createFixture();
      const accessoId = await createAccesso({
        beneficiarioId: fixture.beneficiarioId,
        magazzinoId: fixture.magazzinoId,
        stato,
      });
      const res = await openSession(accessoId);
      expect(res.status).toBe(400);
    },
  );

  it("blocca apertura se beneficiario non è abilitato al Credito Solidale", async () => {
    const fixture = await createFixture({ creditoSolidaleAbilitato: false });
    const res = await openSession(fixture.accessoId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Il beneficiario non è abilitato al Credito Solidale.",
    );
  });

  it("blocca apertura se Credito Solidale non è attivo", async () => {
    const fixture = await createFixture({ creditoSolidaleStato: "sospeso" });
    const res = await openSession(fixture.accessoId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Il Credito Solidale del beneficiario non è attivo.",
    );
  });

  it("blocca apertura su magazzino logistico", async () => {
    const fixture = await createFixture({ tipoMagazzino: "logistico" });
    const res = await openSession(fixture.accessoId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "La Cassa Emporio può essere aperta solo su un magazzino di tipo Emporio o Misto.",
    );
  });

  it("non crea due sessioni attive per lo stesso accesso e restituisce quella esistente", async () => {
    const fixture = await createFixture();
    const first = await openSession(fixture.accessoId);
    const second = await openSession(fixture.accessoId);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    const rows = await db
      .select()
      .from(sessioniCassaEmporioTable)
      .where(eq(sessioniCassaEmporioTable.accessoEmporioId, fixture.accessoId));
    expect(rows).toHaveLength(1);
  });

  it("forza un Accesso Emporio dalla Cassa e apre una sessione tracciata", async () => {
    const areaOperativaId = await createAreaOperativa();
    const centroId = await createCentro(areaOperativaId);
    const magazzinoId = await createMagazzino(
      "emporio",
      areaOperativaId,
      centroId,
    );
    const beneficiarioId = await createBeneficiario({
      areaOperativaId,
      centroAscoltoId: centroId,
      saldo: "15.00",
    });

    const res = await request(makeApp())
      .post("/cassa-emporio/accessi/forza")
      .send({
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

    const [accesso] = await db
      .select()
      .from(consegneTable)
      .where(eq(consegneTable.id, res.body.accessoEmporioId));
    expect(accesso.accessoForzato).toBe(true);
    expect(accesso.origineAccesso).toBe("forzato_da_cassa");
    expect(accesso.motivoAccessoForzato).toBe(
      "Beneficiario presente senza pianificazione",
    );
    expect(accesso.statoAccessoEmporio).toBe("effettuato");

    const duplicate = await request(makeApp())
      .post("/cassa-emporio/accessi/forza")
      .send({
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
    const res = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({
        search: codice,
        areaOperativaId: fixture.areaOperativaId,
        magazzinoEmporioId: fixture.magazzinoId,
      });
    expect(res.status).toBe(200);
    expect(res.body[0].beneficiarioId).toBe(fixture.beneficiarioId);
    expect(res.body[0].accessi.map((a: { id: number }) => a.id)).toContain(
      fixture.accessoId,
    );

    const scanned = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({
        search: codice,
        areaOperativaId: fixture.areaOperativaId,
        magazzinoEmporioId: fixture.magazzinoId,
      });
    expect(scanned.status).toBe(200);
    expect(
      scanned.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).toContain(fixture.beneficiarioId);
  });

  it("mostra beneficiari accreditati anche senza Accesso Emporio pianificato", async () => {
    const areaOperativaId = await createAreaOperativa();
    const centroId = await createCentro(areaOperativaId);
    const magazzinoEmporioId = await createMagazzino(
      "emporio",
      areaOperativaId,
      centroId,
    );
    const suffix = rnd();
    const popescuCognome = `Popescu${suffix}`;
    const popescuId = await createBeneficiario({
      areaOperativaId,
      centroAscoltoId: centroId,
      cognome: popescuCognome,
      nome: "Pavel",
      saldo: "80.00",
    });
    const galliId = await createBeneficiario({
      areaOperativaId,
      centroAscoltoId: centroId,
      cognome: `Galli${suffix}`,
      nome: "Lucia",
      saldo: "0.00",
    });

    const byArea = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({ areaOperativaId, magazzinoEmporioId });
    expect(byArea.status).toBe(200);
    expect(
      byArea.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).toEqual(expect.arrayContaining([popescuId, galliId]));

    const byName = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({ search: `${popescuCognome} Pavel`, magazzinoEmporioId });
    expect(byName.status).toBe(200);
    expect(
      byName.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).toContain(popescuId);
    const popescuRow = byName.body.find(
      (b: { beneficiarioId: number }) => b.beneficiarioId === popescuId,
    );
    expect(popescuRow.accessi).toEqual([]);
  });

  it("non cerca in Cassa beneficiari di altra Area anche con Emporio preferito locale", async () => {
    const romaId = await createAreaOperativa();
    const centroRomaId = await createCentro(romaId);
    const emporioRomaId = await createMagazzino(
      "emporio",
      romaId,
      centroRomaId,
    );
    const bolognaId = await createAreaOperativa();
    const centroBolognaId = await createCentro(bolognaId);
    const galliId = await createBeneficiario({
      areaOperativaId: bolognaId,
      centroAscoltoId: centroBolognaId,
      cognome: "Galli",
      nome: "Lucia",
      saldo: "100.00",
      codice: `BEN-GALLI-${rnd()}`,
      magazzinoEmporioPreferitoId: emporioRomaId,
    });

    const res = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({
        search: "Galli Lucia",
        areaOperativaId: romaId,
        magazzinoEmporioId: emporioRomaId,
      });

    expect(res.status).toBe(200);
    expect(
      res.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).not.toContain(galliId);
  });

  it("non mostra beneficiari Cassa senza Area o Emporio e scarta beneficiari non eleggibili", async () => {
    const fixture = await createFixture();
    const nonAbilitatoId = await createBeneficiario({
      areaOperativaId: fixture.areaOperativaId,
      centroAscoltoId: fixture.centroId,
      creditoSolidaleAbilitato: false,
      creditoSolidaleStato: "non_abilitato",
    });
    await createAccesso({
      beneficiarioId: nonAbilitatoId,
      magazzinoId: fixture.magazzinoId,
    });

    const noArea = await request(makeApp()).get(
      "/cassa-emporio/beneficiari/ricerca",
    );
    expect(noArea.status).toBe(400);

    const searchWithoutArea = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({ search: "Cassa" });
    expect(searchWithoutArea.status).toBe(400);

    const byArea = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({
        data: "2026-07-15",
        areaOperativaId: fixture.areaOperativaId,
        magazzinoEmporioId: fixture.magazzinoId,
      });
    expect(byArea.status).toBe(200);
    const ids = byArea.body.map(
      (b: { beneficiarioId: number }) => b.beneficiarioId,
    );
    expect(ids).toContain(fixture.beneficiarioId);
    expect(ids).not.toContain(nonAbilitatoId);
  });

  it("mostra beneficiari accreditati e filtra gli accessi validi per data, area ed Emporio", async () => {
    const fixture = await createFixture();
    const app = makeApp();
    const server = await cListeners.open(app, () => app);
    const otherAreaOperativaId = await createAreaOperativa();
    const otherCentroId = await createCentro(otherAreaOperativaId);
    const otherMagazzinoId = await createMagazzino(
      "emporio",
      otherAreaOperativaId,
      otherCentroId,
    );

    const list = await request(server)
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({
        data: "2026-07-15",
        areaOperativaId: fixture.areaOperativaId,
        magazzinoEmporioId: fixture.magazzinoId,
      });
    expect(list.status).toBe(200);
    expect(
      list.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).toContain(fixture.beneficiarioId);
    expect(list.body[0].accessi.map((a: { id: number }) => a.id)).toContain(
      fixture.accessoId,
    );

    const wrongDate = await request(server)
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({
        data: "2026-07-16",
        areaOperativaId: fixture.areaOperativaId,
        magazzinoEmporioId: fixture.magazzinoId,
      });
    const wrongDateRow = wrongDate.body.find(
      (b: { beneficiarioId: number }) =>
        b.beneficiarioId === fixture.beneficiarioId,
    );
    expect(wrongDateRow?.accessi).toEqual([]);

    const wrongEmporio = await request(server)
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({
        data: "2026-07-15",
        areaOperativaId: fixture.areaOperativaId,
        magazzinoEmporioId: otherMagazzinoId,
      });
    expect(wrongEmporio.status, wrongEmporio.text).toBe(200);
    expect(
      wrongEmporio.body.map(
        (b: { beneficiarioId: number }) => b.beneficiarioId,
      ),
    ).not.toContain(fixture.beneficiarioId);
  });

  it("filtra le sessioni per data, area ed Emporio", async () => {
    const fixture = await createFixture();
    const sessione = await openSession(fixture.accessoId);
    const today = todayInput();

    const list = await request(makeApp()).get("/cassa-emporio/sessioni").query({
      data: today,
      areaOperativaId: fixture.areaOperativaId,
      magazzinoEmporioId: fixture.magazzinoId,
    });
    expect(list.status).toBe(200);
    expect(list.body.map((s: { id: number }) => s.id)).toContain(
      sessione.body.id,
    );

    const otherAreaOperativaId = await createAreaOperativa();
    const wrongArea = await request(makeApp())
      .get("/cassa-emporio/sessioni")
      .query({
        data: today,
        areaOperativaId: otherAreaOperativaId,
        magazzinoEmporioId: fixture.magazzinoId,
      });
    expect(wrongArea.body.map((s: { id: number }) => s.id)).not.toContain(
      sessione.body.id,
    );
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
    const senzaCredito = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "0",
    });

    const byCode = await request(makeApp())
      .get("/cassa-emporio/prodotti/ricerca")
      .query({ search: "EMP-P-", magazzinoEmporioId: fixture.magazzinoId });
    const byBarcode = await request(makeApp())
      .get("/cassa-emporio/prodotti/ricerca")
      .query({ search: "BAR-P-", magazzinoEmporioId: fixture.magazzinoId });
    const byName = await request(makeApp())
      .get("/cassa-emporio/prodotti/ricerca")
      .query({ search: "Prodotto", magazzinoEmporioId: fixture.magazzinoId });
    const emptyCombo = await request(makeApp())
      .get("/cassa-emporio/prodotti/ricerca")
      .query({ magazzinoEmporioId: fixture.magazzinoId });
    expect(byCode.status).toBe(200);
    expect(byBarcode.status).toBe(200);
    expect(byName.status).toBe(200);
    expect(emptyCombo.status).toBe(200);
    expect(
      byCode.body.map((p: { prodottoId: number }) => p.prodottoId),
    ).toContain(prodottoId);
    expect(
      byBarcode.body.map((p: { prodottoId: number }) => p.prodottoId),
    ).toContain(prodottoId);
    expect(
      byName.body.map((p: { prodottoId: number }) => p.prodottoId),
    ).toContain(prodottoId);
    expect(
      emptyCombo.body.map((p: { prodottoId: number }) => p.prodottoId),
    ).toContain(prodottoId);
    expect(
      emptyCombo.body.map((p: { prodottoId: number }) => p.prodottoId),
    ).not.toContain(nonAbilitato);
    expect(
      emptyCombo.body.map((p: { prodottoId: number }) => p.prodottoId),
    ).not.toContain(senzaCredito);
  });

  it("ricerca prodotto mostra solo prodotti disponibili nell'Emporio e l'aggiunta blocca la giacenza assente", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      codice: `GIAC-${rnd()}`,
      quantitaResidua: "0",
    });
    const sessione = await openSession(fixture.accessoId);
    const list = await request(makeApp())
      .get("/cassa-emporio/prodotti/ricerca")
      .query({ search: "GIAC-", magazzinoEmporioId: fixture.magazzinoId });
    expect(list.status).toBe(200);
    expect(
      list.body.map((p: { prodottoId: number }) => p.prodottoId),
    ).not.toContain(prodottoId);
    const add = await addProduct(sessione.body.id, prodottoId, 1);
    expect(add.status).toBe(400);
    expect(add.body.error).toBe(
      "La quantità richiesta supera la giacenza disponibile nel magazzino Emporio selezionato.",
    );
  });

  it("blocca prodotto non abilitato Emporio e prodotto senza Valore Credito Solidale", async () => {
    const fixture = await createFixture();
    const sessione = await openSession(fixture.accessoId);
    const nonAbilitato = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      abilitatoEmporio: false,
    });
    const senzaCredito = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "0",
    });

    const blocked = await addProduct(sessione.body.id, nonAbilitato);
    const noCredit = await addProduct(sessione.body.id, senzaCredito);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe(
      "Il prodotto non è abilitato per Emporio. Abilitalo nella scheda prodotto prima di aggiungerlo al carrello.",
    );
    expect(noCredit.status).toBe(400);
    expect(noCredit.body.error).toBe(
      "Il prodotto non ha un Valore Credito Solidale configurato. Imposta il valore nella scheda prodotto.",
    );
  });

  it("aggiunta, modifica quantità e rimozione aggiornano il totale Credito previsto", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "3",
    });
    const sessione = await openSession(fixture.accessoId);

    const add = await addProduct(sessione.body.id, prodottoId, 2);
    expect(add.status).toBe(201);
    let detail = await request(makeApp()).get(
      `/cassa-emporio/sessioni/${sessione.body.id}`,
    );
    expect(detail.body.totaleCreditoPrevisto).toBe(6);

    const patch = await request(makeApp())
      .patch(`/cassa-emporio/sessioni/${sessione.body.id}/righe/${add.body.id}`)
      .send({
        quantita: 3,
        versione: await getSessionVersion(sessione.body.id),
      });
    expect(patch.status).toBe(200);
    detail = await request(makeApp()).get(
      `/cassa-emporio/sessioni/${sessione.body.id}`,
    );
    expect(detail.body.totaleCreditoPrevisto).toBe(9);

    const ready = await postSessionAction(
      sessione.body.id,
      "pronta-per-chiusura",
    );
    expect(ready.status).toBe(200);
    expect(ready.body.statoSessione).toBe("pronta_per_chiusura");

    const del = await request(makeApp())
      .delete(
        `/cassa-emporio/sessioni/${sessione.body.id}/righe/${add.body.id}`,
      )
      .send({ versione: await getSessionVersion(sessione.body.id) });
    expect(del.status).toBe(200);
    expect(del.body.statoSessione).toBe("aperta");
    expect(del.body.totaleCreditoPrevisto).toBe(0);
    expect(del.body.righe).toHaveLength(0);
    rigaIds.splice(rigaIds.indexOf(add.body.id), 1);
  });

  it("blocca quantità zero o negativa", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
    });
    const sessione = await openSession(fixture.accessoId);
    expect((await addProduct(sessione.body.id, prodottoId, 0)).status).toBe(
      400,
    );
    expect((await addProduct(sessione.body.id, prodottoId, -1)).status).toBe(
      400,
    );
  });

  it("blocca limite per singola spesa e limite mensile netto del Beneficiario", async () => {
    const fixture = await createFixture();
    const perSpesa = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      quantitaMassimaPerSpesa: "1",
    });
    const mensile = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      quantitaMassimaMensile: "1",
    });
    const sessione = await openSession(fixture.accessoId);
    expect((await addProduct(sessione.body.id, perSpesa, 2)).status).toBe(400);
    expect((await addProduct(sessione.body.id, mensile, 1)).status).toBe(201);
    expect((await addProduct(sessione.body.id, mensile, 1)).status).toBe(400);
  });

  it("applica il limite mensile netto tra Sessioni ed Empori e libera quantità dopo storno", async () => {
    const fixture = await createFixture({ saldo: "50.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "1.00",
      quantitaMassimaMensile: "4.00",
      quantitaResidua: "10",
    });
    const firstSession = await openSession(fixture.accessoId);
    await addProduct(firstSession.body.id, prodottoId, 3);
    await postSessionAction(firstSession.body.id, "pronta-per-chiusura");
    const firstClose = await postSessionAction(firstSession.body.id, "chiudi");
    expect(firstClose.status).toBe(200);
    await trackSpesa(firstClose.body.spesa.id);
    const nextMonthReference = new Date();
    nextMonthReference.setUTCMonth(nextMonthReference.getUTCMonth() + 1, 15);
    expect(
      await quantitaNettaMensileProdotto(
        db,
        fixture.beneficiarioId,
        prodottoId,
        nextMonthReference,
      ),
    ).toBe(0);

    const secondMagazzinoId = await createMagazzino(
      "emporio",
      fixture.areaOperativaId,
      fixture.centroId,
    );
    const [secondLotto] = await db
      .insert(lottiTable)
      .values({
        prodottoId,
        codiceLotto: `SECOND-${rnd()}`,
        dataCarico: "2026-07-01",
        quantitaCaricata: "10.00",
        quantitaResidua: "10.00",
        magazzinoId: secondMagazzinoId,
      })
      .returning({ id: lottiTable.id });
    lottoIds.push(secondLotto.id);
    const secondAccessoId = await createAccesso({
      beneficiarioId: fixture.beneficiarioId,
      magazzinoId: secondMagazzinoId,
      dataOraInizio: "2026-07-16T09:00:00",
    });
    const secondSession = await openSession(secondAccessoId);
    expect(
      (await addProduct(secondSession.body.id, prodottoId, 2)).status,
    ).toBe(400);

    const reverse = await request(makeApp())
      .post(`/spese-emporio/${firstClose.body.spesa.id}/storna`)
      .send({
        motivo: "Correzione limite mensile",
        righe: [
          { spesaRigaId: firstClose.body.spesa.righe[0].id, quantita: 2 },
        ],
        idempotencyKey: `monthly-${rnd()}`,
      });
    expect(reverse.status).toBe(201);
    expect(
      (await addProduct(secondSession.body.id, prodottoId, 3)).status,
    ).toBe(201);
  });

  it("blocca giacenza insufficiente senza scaricare il lotto", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      quantitaResidua: "1",
    });
    const sessione = await openSession(fixture.accessoId);
    const res = await addProduct(sessione.body.id, prodottoId, 2);
    expect(res.status).toBe(400);

    const [lotto] = await db
      .select()
      .from(lottiTable)
      .where(inArray(lottiTable.id, lottoIds));
    expect(lotto.quantitaResidua).toBe("1.00");
  });

  it("saldo insufficiente e carrello vuoto impediscono pronta_per_chiusura", async () => {
    const fixture = await createFixture({ saldo: "1.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
    });
    const sessione = await openSession(fixture.accessoId);
    const empty = await postSessionAction(
      sessione.body.id,
      "pronta-per-chiusura",
    );
    expect(empty.status).toBe(400);

    await addProduct(sessione.body.id, prodottoId, 1);
    const ready = await postSessionAction(
      sessione.body.id,
      "pronta-per-chiusura",
    );
    expect(ready.status).toBe(400);
    expect(ready.body.error).toBe(
      "Saldo Credito Solidale insufficiente. Riduci il carrello o effettua una ricarica prima della chiusura.",
    );
  });

  it("ricalcola il credito residuo usando il saldo corrente del beneficiario", async () => {
    const fixture = await createFixture({ saldo: "0.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
    });
    const sessione = await openSession(fixture.accessoId);
    expect(sessione.body.saldoCreditoIniziale).toBe(0);

    await db
      .update(beneficiariTable)
      .set({ creditoSolidaleSaldo: "70.00" })
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));

    const add = await addProduct(sessione.body.id, prodottoId, 1);
    expect(add.status).toBe(201);
    const detail = await request(makeApp()).get(
      `/cassa-emporio/sessioni/${sessione.body.id}`,
    );
    expect(detail.body.saldoCreditoIniziale).toBe(70);
    expect(detail.body.totaleCreditoPrevisto).toBe(2);
    expect(detail.body.creditoResiduoPrevisto).toBe(68);
    const ready = await postSessionAction(
      sessione.body.id,
      "pronta-per-chiusura",
    );
    expect(ready.status).toBe(200);
  });

  it("aggiorna il Credito Solidale da Cassa usando la quota mensile senza duplicare il periodo", async () => {
    const fixture = await createFixture({ saldo: "0.00" });
    const sessione = await openSession(fixture.accessoId);
    expect(sessione.body.saldoCreditoIniziale).toBe(0);

    const first = await request(makeApp())
      .post(
        `/credito-solidale/beneficiari/${fixture.beneficiarioId}/refresh-credito`,
      )
      .send({ periodoRiferimento: "2026-07" });
    expect(first.status).toBe(201);
    expect(first.body.ricaricaEseguita).toBe(true);
    expect(first.body.movimento.tipoMovimento).toBe("ricarica_mensile");
    expect(first.body.movimento.variazioneCredito).toBe(25);
    expect(first.body.saldo.saldoAttuale).toBe(25);

    const refreshedSessione = await request(makeApp()).get(
      `/cassa-emporio/sessioni/${sessione.body.id}`,
    );
    expect(refreshedSessione.status).toBe(200);
    expect(refreshedSessione.body.saldoCreditoIniziale).toBe(25);
    expect(refreshedSessione.body.creditoResiduoPrevisto).toBe(25);

    const second = await request(makeApp())
      .post(
        `/credito-solidale/beneficiari/${fixture.beneficiarioId}/refresh-credito`,
      )
      .send({ periodoRiferimento: "2026-07" });
    expect(second.status).toBe(200);
    expect(second.body.ricaricaEseguita).toBe(false);
    expect(second.body.movimento).toBeNull();
    expect(second.body.saldo.saldoAttuale).toBe(25);
  });

  it("pronta_per_chiusura non crea movimenti, non scala saldo, non scarica giacenza, non crea bolle o scarichi", async () => {
    // Keep diagnostics limited to operation/error fields: no beneficiary DTO/PII.
    const diagnostic = (step: string, response: request.Response) =>
      JSON.stringify({
        step,
        status: response.status,
        error: response.body?.error,
        message: response.body?.message,
        statoSessione: response.body?.statoSessione,
        versione: response.body?.versione,
      });
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "5",
    });
    const sessione = await openSession(fixture.accessoId);
    expect(sessione.status, diagnostic("apri-sessione", sessione)).toBe(201);
    expect(sessione.body).toMatchObject({
      statoSessione: "aperta",
      saldoCreditoIniziale: 20,
      totaleCreditoPrevisto: 0,
      righe: [],
    });
    expect(Number.isInteger(sessione.body.versione)).toBe(true);
    const aggiunta = await addProduct(sessione.body.id, prodottoId, 2);
    expect(aggiunta.status, diagnostic("aggiunta-prodotto", aggiunta)).toBe(
      201,
    );
    expect(aggiunta.body).toMatchObject({
      sessioneCassaId: sessione.body.id,
      prodottoId,
      quantita: 2,
      creditoUnitario: 2,
      creditoTotale: 4,
      giacenzaDisponibileAlMomento: 5,
      superaGiacenza: false,
      superaLimitePerSpesa: false,
      superaLimiteMensile: false,
    });
    const righeSalvate = await db
      .select()
      .from(sessioniCassaEmporioRigheTable)
      .where(
        eq(sessioniCassaEmporioRigheTable.sessioneCassaId, sessione.body.id),
      );
    expect(righeSalvate).toHaveLength(1);
    expect(righeSalvate[0].id).toBe(aggiunta.body.id);
    expect(Number(righeSalvate[0].quantita)).toBe(2);
    expect(Number(righeSalvate[0].creditoTotale)).toBe(4);

    // Validate the exact GET/version used by the command, not an unchecked
    // second GET hidden inside postSessionAction().
    const corrente = await request(makeApp()).get(
      `/cassa-emporio/sessioni/${sessione.body.id}`,
    );
    expect(corrente.status, diagnostic("lettura-versione", corrente)).toBe(200);
    expect(corrente.body).toMatchObject({
      statoSessione: "aperta",
      saldoCreditoIniziale: 20,
      totaleCreditoPrevisto: 4,
      creditoResiduoPrevisto: 16,
    });
    expect(corrente.body.righe).toHaveLength(1);
    expect(corrente.body.versione).toBe(sessione.body.versione + 1);
    const [persistita] = await db
      .select()
      .from(sessioniCassaEmporioTable)
      .where(eq(sessioniCassaEmporioTable.id, sessione.body.id));
    expect(persistita.versione).toBe(corrente.body.versione);
    expect(persistita.statoSessione).toBe("aperta");
    const moduli = await listModuliFunzionali();
    expect(
      moduli.find((modulo) => modulo.codice === "EMPORIO_SOLIDALE")?.attivo,
    ).toBe(true);
    const abilitazioni = await db
      .select()
      .from(emporioAbilitazioniTable)
      .where(
        eq(emporioAbilitazioniTable.beneficiarioId, fixture.beneficiarioId),
      );
    expect(abilitazioni).toHaveLength(1);
    expect(abilitazioni[0]).toMatchObject({
      areaOperativaId: fixture.areaOperativaId,
      stato: "attivo",
    });

    const [beneficiarioPrima] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));
    const [lottoPrima] = await db
      .select()
      .from(lottiTable)
      .where(inArray(lottiTable.id, lottoIds));
    expect(beneficiarioPrima.creditoSolidaleAbilitato).toBe(true);
    expect(beneficiarioPrima.creditoSolidaleStato).toBe("attivo");
    expect(Number(beneficiarioPrima.creditoSolidaleSaldo)).toBe(20);
    expect(lottoPrima.prodottoId).toBe(prodottoId);
    expect(lottoPrima.magazzinoId).toBe(fixture.magazzinoId);
    expect(Number(lottoPrima.quantitaResidua)).toBe(5);
    const movimentiPrima = await db
      .select({ id: creditoSolidaleMovimentiTable.id })
      .from(creditoSolidaleMovimentiTable)
      .where(
        eq(
          creditoSolidaleMovimentiTable.beneficiarioId,
          fixture.beneficiarioId,
        ),
      );
    const bollePrima = await db
      .select({ id: bolleTable.id })
      .from(bolleTable)
      .where(eq(bolleTable.beneficiarioId, fixture.beneficiarioId));
    const scarichiPrima = await db
      .select({ id: scarichiTable.id })
      .from(scarichiTable)
      .where(eq(scarichiTable.magazzinoId, fixture.magazzinoId));

    expect(movimentiPrima).toHaveLength(0);
    expect(bollePrima).toHaveLength(0);
    expect(scarichiPrima).toHaveLength(0);
    const movimentiInventariali = () =>
      db
        .select({ id: movimentiTable.id })
        .from(movimentiTable)
        .where(eq(movimentiTable.lottoId, lottoPrima.id));
    expect(await movimentiInventariali()).toHaveLength(0);

    const ready = await request(makeApp())
      .post(`/cassa-emporio/sessioni/${sessione.body.id}/pronta-per-chiusura`)
      .send({ versione: corrente.body.versione });
    expect(ready.status, diagnostic("pronta-per-chiusura", ready)).toBe(200);
    expect(ready.body.statoSessione).toBe("pronta_per_chiusura");

    const [beneficiarioDopo] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));
    const [lottoDopo] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoPrima.id));
    const movimentiDopo = await db
      .select({ id: creditoSolidaleMovimentiTable.id })
      .from(creditoSolidaleMovimentiTable)
      .where(
        eq(
          creditoSolidaleMovimentiTable.beneficiarioId,
          fixture.beneficiarioId,
        ),
      );
    const bolleDopo = await db
      .select({ id: bolleTable.id })
      .from(bolleTable)
      .where(eq(bolleTable.beneficiarioId, fixture.beneficiarioId));
    const scarichiDopo = await db
      .select({ id: scarichiTable.id })
      .from(scarichiTable)
      .where(eq(scarichiTable.magazzinoId, fixture.magazzinoId));

    expect(beneficiarioDopo.creditoSolidaleSaldo).toBe(
      beneficiarioPrima.creditoSolidaleSaldo,
    );
    expect(lottoDopo.quantitaResidua).toBe(lottoPrima.quantitaResidua);
    expect(movimentiDopo.length).toBe(movimentiPrima.length);
    expect(bolleDopo.length).toBe(bollePrima.length);
    expect(scarichiDopo.length).toBe(scarichiPrima.length);
    expect(await movimentiInventariali()).toHaveLength(0);
    const spese = await db
      .select({ id: speseEmporioTable.id })
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.sessioneCassaId, sessione.body.id));
    expect(spese).toHaveLength(0);
    const [sessioneDopo] = await db
      .select()
      .from(sessioniCassaEmporioTable)
      .where(eq(sessioniCassaEmporioTable.id, sessione.body.id));
    expect(sessioneDopo.statoSessione).toBe("pronta_per_chiusura");
  });

  it("supporta quantità decimali e mantiene la UOM kg su Sessione, Spesa, Bolla e Movimento", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "0.75",
      unitaMisura: "kg",
    });
    const lottoId = lottoIds.at(-1)!;
    const sessione = await openSession(fixture.accessoId);
    const add = await addProduct(sessione.body.id, prodottoId, 0.5);
    expect(add.status).toBe(201);
    expect(add.body.quantita).toBe(0.5);
    expect(add.body.unitaMisura).toBe("kg");
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    const close = await postSessionAction(sessione.body.id, "chiudi");
    expect(close.status).toBe(200);
    await trackSpesa(close.body.spesa.id);

    const [lotto] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    const [rigaSpesa] = await db
      .select()
      .from(speseEmporioRigheTable)
      .where(eq(speseEmporioRigheTable.spesaEmporioId, close.body.spesa.id));
    const [rigaBolla] = await db
      .select()
      .from(bollaRigheTable)
      .where(eq(bollaRigheTable.bollaId, close.body.spesa.bollaId));
    const [movimento] = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaRigaId, rigaSpesa.bollaRigaId!));
    expect(lotto.quantitaResidua).toBe("0.25");
    expect(rigaSpesa.quantita).toBe("0.50");
    expect(rigaSpesa.unitaMisura).toBe("kg");
    expect(rigaBolla.unitaMisura).toBe("kg");
    expect(movimento.quantita).toBe("0.50");
    expect(movimento.unitaMisura).toBe("kg");
  });

  it("non scarica un Lotto diventato scaduto dopo la preparazione e rollbacka ogni effetto", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      quantitaResidua: "0.75",
      unitaMisura: "kg",
      dataScadenza: "2099-01-01",
    });
    const lottoId = lottoIds.at(-1)!;
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 0.5);
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    await db
      .update(lottiTable)
      .set({ dataScadenza: "2020-01-01" })
      .where(eq(lottiTable.id, lottoId));

    const close = await postSessionAction(sessione.body.id, "chiudi");
    expect(close.status).toBe(409);
    const [lotto] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    const spese = await db
      .select()
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.sessioneCassaId, sessione.body.id));
    const movimenti = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.beneficiarioId, fixture.beneficiarioId));
    const crediti = await db
      .select()
      .from(creditoSolidaleMovimentiTable)
      .where(
        eq(
          creditoSolidaleMovimentiTable.beneficiarioId,
          fixture.beneficiarioId,
        ),
      );
    expect(lotto.quantitaResidua).toBe("0.75");
    expect(spese).toHaveLength(0);
    expect(movimenti).toHaveLength(0);
    expect(crediti).toHaveLength(0);
  });

  it("applica FEFO soltanto ai Lotti distribuibili lasciando invariato quello scaduto", async () => {
    const fixture = await createFixture({ saldo: "30.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      quantitaResidua: "5",
      dataScadenza: "2020-01-01",
    });
    const expiredLottoId = lottoIds.at(-1)!;
    const [validLotto] = await db
      .insert(lottiTable)
      .values({
        prodottoId,
        codiceLotto: `VALID-${rnd()}`,
        dataScadenza: "2099-01-01",
        dataCarico: "2026-07-02",
        quantitaCaricata: "10.00",
        quantitaResidua: "10.00",
        magazzinoId: fixture.magazzinoId,
      })
      .returning({ id: lottiTable.id });
    lottoIds.push(validLotto.id);
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 3);
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    const close = await postSessionAction(sessione.body.id, "chiudi");
    expect(close.status).toBe(200);
    await trackSpesa(close.body.spesa.id);
    const [expired] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, expiredLottoId));
    const [valid] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, validLotto.id));
    expect(expired.quantitaResidua).toBe("5.00");
    expect(valid.quantitaResidua).toBe("7.00");
  });

  it("chiude una sessione pronta creando Spesa Emporio, bolla, scarico, movimento credito e aggiornando saldo e giacenza", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "5",
    });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 2);
    const ready = await postSessionAction(
      sessione.body.id,
      "pronta-per-chiusura",
    );
    expect(ready.status).toBe(200);

    const close = await postSessionAction(sessione.body.id, "chiudi");
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

    const [beneficiario] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));
    const [lotto] = await db
      .select()
      .from(lottiTable)
      .where(inArray(lottiTable.id, lottoIds));
    const [sessioneChiusa] = await db
      .select()
      .from(sessioniCassaEmporioTable)
      .where(eq(sessioniCassaEmporioTable.id, sessione.body.id));
    const [spesa] = await db
      .select()
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.id, close.body.spesa.id));
    const righeSpesa = await db
      .select()
      .from(speseEmporioRigheTable)
      .where(eq(speseEmporioRigheTable.spesaEmporioId, spesa.id));
    const [movimentoCredito] = await db
      .select()
      .from(creditoSolidaleMovimentiTable)
      .where(
        eq(creditoSolidaleMovimentiTable.id, spesa.movimentoCreditoSolidaleId!),
      );
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, spesa.bollaId!));
    const righeBolla = await db
      .select()
      .from(bollaRigheTable)
      .where(eq(bollaRigheTable.bollaId, spesa.bollaId!));
    const [scarico] = await db
      .select()
      .from(scarichiTable)
      .where(eq(scarichiTable.id, spesa.scaricoId!));
    const righeScarico = await db
      .select()
      .from(scaricoRigheTable)
      .where(eq(scaricoRigheTable.scaricoId, spesa.scaricoId!));
    const [accesso] = await db
      .select()
      .from(consegneTable)
      .where(eq(consegneTable.id, fixture.accessoId));

    expect(beneficiario.creditoSolidaleSaldo).toBe("16.00");
    expect(lotto.quantitaResidua).toBe("3.00");
    expect(sessioneChiusa.spesaEmporioId).toBe(spesa.id);
    expect(righeSpesa).toHaveLength(1);
    expect(righeSpesa[0].creditoTotale).toBe("4.00");
    expect(movimentoCredito.tipoMovimento).toBe("consumo_spesa");
    expect(movimentoCredito.variazioneCredito).toBe("-4.00");
    expect(bolla.stato).toBe("consegnato");
    expect(righeBolla).toHaveLength(1);
    const dettaglioBolla = await request(makeApp()).get(
      `/bolle/${spesa.bollaId}`,
    );
    expect(dettaglioBolla.status).toBe(200);
    expect(dettaglioBolla.body.righe).toHaveLength(1);
    expect(dettaglioBolla.body.righe[0].prodottoId).toBe(prodottoId);
    expect(dettaglioBolla.body.righe[0].quantita).toBe(2);
    await db
      .update(speseEmporioRigheTable)
      .set({ bollaRigaId: null })
      .where(eq(speseEmporioRigheTable.spesaEmporioId, spesa.id));
    await expect(
      db
        .delete(bollaRigheTable)
        .where(eq(bollaRigheTable.bollaId, spesa.bollaId!)),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    const dettaglioBollaPreservato = await request(makeApp()).get(
      `/bolle/${spesa.bollaId}`,
    );
    expect(dettaglioBollaPreservato.status).toBe(200);
    expect(dettaglioBollaPreservato.body.righe).toHaveLength(1);
    expect(dettaglioBollaPreservato.body.righe[0].prodottoId).toBe(prodottoId);
    expect(dettaglioBollaPreservato.body.righe[0].quantita).toBe(2);
    expect(scarico.causaleAltro).toBe("Spesa Emporio");
    expect(righeScarico).toHaveLength(1);
    expect(accesso).toMatchObject({
      statoAccessoEmporio: "effettuato",
      areaOperativaIdSnapshot: fixture.areaOperativaId,
      centroAscoltoIdSnapshot: fixture.centroId,
    });
    expect(bolla).toMatchObject({
      areaOperativaIdSnapshot: fixture.areaOperativaId,
      centroAscoltoIdSnapshot: fixture.centroId,
    });
  });

  it("genera numeri Spesa e Bolla distinti per due checkout concorrenti", async () => {
    const firstFixture = await createFixture({ saldo: "20.00" });
    const secondFixture = await createFixture({ saldo: "20.00" });
    const firstProduct = await createProdotto({
      magazzinoId: firstFixture.magazzinoId,
      creditoSolidaleValore: "1.00",
      quantitaResidua: "2",
    });
    const secondProduct = await createProdotto({
      magazzinoId: secondFixture.magazzinoId,
      creditoSolidaleValore: "1.00",
      quantitaResidua: "2",
    });
    const firstSession = await openSession(firstFixture.accessoId);
    const secondSession = await openSession(secondFixture.accessoId);
    await addProduct(firstSession.body.id, firstProduct, 1);
    await addProduct(secondSession.body.id, secondProduct, 1);
    await postSessionAction(firstSession.body.id, "pronta-per-chiusura");
    await postSessionAction(secondSession.body.id, "pronta-per-chiusura");

    const [firstClose, secondClose] = await Promise.all([
      postSessionAction(firstSession.body.id, "chiudi"),
      postSessionAction(secondSession.body.id, "chiudi"),
    ]);
    expect(firstClose.status).toBe(200);
    expect(secondClose.status).toBe(200);
    await trackSpesa(firstClose.body.spesa.id);
    await trackSpesa(secondClose.body.spesa.id);
    expect(firstClose.body.spesa.numeroSpesa).not.toBe(
      secondClose.body.spesa.numeroSpesa,
    );
    expect(firstClose.body.spesa.bollaNumero).not.toBe(
      secondClose.body.spesa.bollaNumero,
    );
  });

  it("prepara la Bolla via mailto manuale e registra il click senza invio SMTP", async () => {
    const centroEmail = `centro-${rnd()}@example.org`;
    const fixture = await createFixture({
      saldo: "20.00",
      centroEmail,
      beneficiarioEmail: `benef-${rnd()}@example.org`,
    });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "5",
    });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 1);
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    const close = await postSessionAction(sessione.body.id, "chiudi");
    await trackSpesa(close.body.spesa.id);

    const linkBolla = `/api/spese-emporio/${close.body.spesa.id}/bolla-stampa`;
    const res = await request(makeApp())
      .post(
        `/spese-emporio/${close.body.spesa.id}/registra-invio-manuale-bolla`,
      )
      .send({ linkBolla: "https://evil.example/phishing" });

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("invio_manuale_avviato");
    expect(res.body.destinatari[0]).toBe(centroEmail);
    expect(res.body.oggetto).toBe(
      `Bolla Emporio Solidale ${close.body.spesa.bollaNumero} - ${close.body.spesa.beneficiarioNome}`,
    );
    expect(res.body.corpo).toContain(linkBolla);
    expect(res.body.corpo).not.toContain("evil.example");
    expect(res.body.corpo).toContain(close.body.spesa.numeroSpesa);
    expect(res.body.corpo).not.toMatch(/euro|prezz|gift card|wallet|importo/i);
    expect(res.body.mailtoHref).toContain(
      `mailto:${encodeURIComponent(centroEmail)}`,
    );
    expect(res.body.mailtoHref).toContain("subject=Bolla%20Emporio%20Solidale");
    expect(res.body.mailtoHref).not.toMatch(/attach/i);

    const [spesa] = await db
      .select()
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.id, close.body.spesa.id));
    expect(spesa.emailBollaStato).toBe("invio_manuale_avviato");
    expect(spesa.emailBollaDestinatari).toContain(centroEmail);
    expect(spesa.emailBollaDataUltimoClick).toBeTruthy();
    expect(spesa.emailBollaOperatoreId).toBe(operatorUserId);
    expect(spesa.emailBollaOggetto).toBe(res.body.oggetto);
  });

  it("prepara link e testo Bolla anche quando non esiste un destinatario email", async () => {
    const fixture = await createFixture({
      saldo: "20.00",
      centroEmail: null,
      beneficiarioEmail: null,
    });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "5",
    });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 1);
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    const close = await postSessionAction(sessione.body.id, "chiudi");
    await trackSpesa(close.body.spesa.id);

    const linkBolla = `/api/spese-emporio/${close.body.spesa.id}/bolla-stampa`;
    const res = await request(makeApp())
      .post(
        `/spese-emporio/${close.body.spesa.id}/registra-invio-manuale-bolla`,
      )
      .send({ linkBolla: "https://evil.example/phishing" });

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("nessun_destinatario");
    expect(res.body.destinatari).toEqual([]);
    expect(res.body.mailtoHref).toBeNull();
    expect(res.body.linkBolla).toBe(linkBolla);
    expect(res.body.corpo).toContain(linkBolla);
    expect(res.body.messaggio).toBe(
      "Nessun destinatario email disponibile. Copia manualmente il link alla Bolla e invialo dal tuo client di posta.",
    );

    const [spesa] = await db
      .select()
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.id, close.body.spesa.id));
    expect(spesa.emailBollaStato).toBe("nessun_destinatario");
    expect(spesa.emailBollaDestinatari).toBeNull();
    expect(spesa.emailBollaErrore).toBe(
      "Nessun destinatario email disponibile. Copia manualmente il link alla Bolla e invialo dal tuo client di posta.",
    );
  });

  it("non chiude una sessione non pronta", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const sessione = await openSession(fixture.accessoId);
    const close = await postSessionAction(sessione.body.id, "chiudi");
    expect(close.status).toBe(400);
    expect(close.body.error).toBe(
      "La sessione Cassa Emporio non è pronta per la chiusura.",
    );
  });

  it("non chiude due volte la stessa sessione", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "5",
    });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 1);
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");

    const first = await postSessionAction(sessione.body.id, "chiudi");
    expect(first.status).toBe(200);
    await trackSpesa(first.body.spesa.id);

    const second = await postSessionAction(sessione.body.id, "chiudi");
    expect(second.status).toBe(400);
    expect(second.body.error).toBe(
      "La sessione Cassa Emporio risulta già chiusa. Non è possibile chiudere due volte la stessa spesa.",
    );
  });

  it("mantiene chiusa una Sessione terminale e non altera stock o Credito su annullamento successivo", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "5",
    });
    const lottoId = lottoIds.at(-1)!;
    const sessione = await openSession(fixture.accessoId);
    expect(sessione.status, sessione.text).toBe(201);
    const add = await addProduct(sessione.body.id, prodottoId, 1);
    expect(add.status, add.text).toBe(201);
    const ready = await postSessionAction(
      sessione.body.id,
      "pronta-per-chiusura",
    );
    expect(ready.status, ready.text).toBe(200);
    const close = await postSessionAction(sessione.body.id, "chiudi");
    expect(close.status, close.text).toBe(200);
    await trackSpesa(close.body.spesa.id);
    const [lottoPrima] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    const [beneficiarioPrima] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));

    const cancel = await postSessionAction(sessione.body.id, "annulla", {
      motivoAnnullamento: "Tentativo non valido",
    });
    expect(cancel.status).toBe(409);
    const [sessioneDopo] = await db
      .select()
      .from(sessioniCassaEmporioTable)
      .where(eq(sessioniCassaEmporioTable.id, sessione.body.id));
    const [lottoDopo] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    const [beneficiarioDopo] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));
    expect(sessioneDopo.statoSessione).toBe("chiusa");
    expect(lottoDopo.quantitaResidua).toBe(lottoPrima.quantitaResidua);
    expect(beneficiarioDopo.creditoSolidaleSaldo).toBe(
      beneficiarioPrima.creditoSolidaleSaldo,
    );
  });

  it("serializza modifica carrello e checkout evitando una Spesa su carrello mezzo vecchio", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "5",
    });
    const sessione = await openSession(fixture.accessoId);
    const add = await addProduct(sessione.body.id, prodottoId, 1);
    const ready = await postSessionAction(
      sessione.body.id,
      "pronta-per-chiusura",
    );
    const versione = ready.body.versione;
    const app = await stableApp(fixture.areaOperativaId);
    const blocker = await pool.connect();
    let pending: Array<Promise<request.Response>> = [];
    let results: request.Response[];
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
        .pid;
      await blocker.query(
        "SELECT id FROM sessioni_cassa_emporio WHERE id=$1 FOR UPDATE",
        [sessione.body.id],
      );
      // Both commands are observed waiting on the SAME persisted session version.
      pending = [
        request(app)
          .patch(
            `/cassa-emporio/sessioni/${sessione.body.id}/righe/${add.body.id}`,
          )
          .send({ quantita: 2, versione })
          .then((r) => r),
        request(app)
          .post(`/cassa-emporio/sessioni/${sessione.body.id}/chiudi`)
          .send({ versione })
          .then((r) => r),
      ];
      await observedWait(pid, 2);
      await blocker.query("COMMIT");
      results = await Promise.all(pending);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled(pending);
    }
    const [update, close] = results;
    expect([update.status, close.status].sort()).toEqual([200, 409]);
    if (close.status === 200) await trackSpesa(close.body.spesa.id);
    const [finale] = await db
      .select()
      .from(sessioniCassaEmporioTable)
      .where(eq(sessioniCassaEmporioTable.id, sessione.body.id));
    const spese = await db
      .select()
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.sessioneCassaId, sessione.body.id));
    if (finale.statoSessione === "chiusa") {
      expect(spese).toHaveLength(1);
      expect(
        await checkoutFacts(fixture, prodottoId, sessione.body.id),
      ).toEqual({
        stock: 4,
        credit: 18,
        expenses: 1,
        bills: 1,
        issues: 1,
        credit_entries: 1,
        audits: 1,
        issued: 1,
        operations: 1,
      });
    } else {
      expect(finale.statoSessione).toBe("aperta");
      expect(spese).toHaveLength(0);
      expect(
        await checkoutFacts(fixture, prodottoId, sessione.body.id),
      ).toEqual({
        stock: 5,
        credit: 20,
        expenses: 0,
        bills: 0,
        issues: 0,
        credit_entries: 0,
        audits: 0,
        issued: 0,
        operations: 0,
      });
      expect(
        Number(
          (
            await db
              .select()
              .from(sessioniCassaEmporioRigheTable)
              .where(eq(sessioniCassaEmporioRigheTable.id, add.body.id))
          )[0].quantita,
        ),
      ).toBe(2);
    }
  });

  it("storna parzialmente e poi serializza due storni concorrenti senza over-storno", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "5",
      unitaMisura: "kg",
    });
    const lottoId = lottoIds.at(-1)!;
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 2);
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    const close = await postSessionAction(sessione.body.id, "chiudi");
    expect(close.status).toBe(200);
    await trackSpesa(close.body.spesa.id);
    const spesaRigaId = close.body.spesa.righe[0].id;

    const invalidPrecision = await request(makeApp())
      .post(`/spese-emporio/${close.body.spesa.id}/storna`)
      .send({
        motivo: "Precisione non valida",
        righe: [{ spesaRigaId, quantita: "0.0000001" }],
      });
    expect(invalidPrecision.status).toBe(400);

    const partial = await request(makeApp())
      .post(`/spese-emporio/${close.body.spesa.id}/storna`)
      .send({
        motivo: "Restituzione parziale",
        righe: [{ spesaRigaId, quantita: 0.5 }],
        idempotencyKey: `partial-${rnd()}`,
      });
    expect(partial.status).toBe(201);
    expect(partial.body.creditoRestituito).toBe(1);
    expect(partial.body.spesa.statoSpesa).toBe("stornata_parzialmente");

    const [first, second] = await Promise.all([
      request(makeApp())
        .post(`/spese-emporio/${close.body.spesa.id}/storna`)
        .send({
          motivo: "Residuo A",
          righe: [{ spesaRigaId, quantita: 1.5 }],
          idempotencyKey: `a-${rnd()}`,
        }),
      request(makeApp())
        .post(`/spese-emporio/${close.body.spesa.id}/storna`)
        .send({
          motivo: "Residuo B",
          righe: [{ spesaRigaId, quantita: 1.5 }],
          idempotencyKey: `b-${rnd()}`,
        }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const [lotto] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    const [beneficiario] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));
    const [spesa] = await db
      .select()
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.id, close.body.spesa.id));
    const originalMovements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.tipoDettaglio, "spesa_emporio"));
    const compensations = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.tipoDettaglio, "storno_spesa_emporio"));
    const audit = await db
      .select()
      .from(auditConfigurazioniTable)
      .where(eq(auditConfigurazioniTable.utenteId, operatorUserId));
    expect(lotto.quantitaResidua).toBe("5.00");
    expect(beneficiario.creditoSolidaleSaldo).toBe("20.00");
    expect(spesa.statoSpesa).toBe("stornata");
    expect(
      originalMovements.some(
        (movement) =>
          movement.lottoId === lottoId && movement.quantita === "2.00",
      ),
    ).toBe(true);
    expect(
      originalMovements
        .filter((movement) => movement.lottoId === lottoId)
        .every(
          (movement) =>
            movement.operatoreId === operatorUserId &&
            movement.auditEventoId != null,
        ),
    ).toBe(true);
    expect(
      compensations
        .filter((movement) => movement.lottoId === lottoId)
        .reduce((sum, movement) => sum + Number(movement.quantita), 0),
    ).toBe(2);
    expect(
      compensations
        .filter((movement) => movement.lottoId === lottoId)
        .every(
          (movement) =>
            movement.operatoreId === operatorUserId &&
            movement.auditEventoId != null,
        ),
    ).toBe(true);
    expect(
      audit.some(
        (event) =>
          event.area === "emporio" && event.azione.startsWith("storno-"),
      ),
    ).toBe(true);
  });

  it("rollbacka integralmente uno storno quando manca il legame inventariale storico", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "2",
    });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 1);
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    const close = await postSessionAction(sessione.body.id, "chiudi");
    expect(close.status).toBe(200);
    await trackSpesa(close.body.spesa.id);
    const riga = close.body.spesa.righe[0];
    await db
      .update(speseEmporioRigheTable)
      .set({ bollaRigaId: null })
      .where(eq(speseEmporioRigheTable.id, riga.id));
    const [lottoBefore] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, riga.lottoId));
    const [beneficiarioBefore] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));

    const response = await request(makeApp())
      .post(`/spese-emporio/${close.body.spesa.id}/storna`)
      .send({
        motivo: "Riferimento legacy incompleto",
        idempotencyKey: `legacy-${rnd()}`,
      });
    expect(response.status).toBe(409);

    expect(
      await db
        .select()
        .from(speseEmporioStorniTable)
        .where(eq(speseEmporioStorniTable.spesaEmporioId, close.body.spesa.id)),
    ).toHaveLength(0);
    const [lottoAfter] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, riga.lottoId));
    const [beneficiarioAfter] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.lottoId, riga.lottoId));
    expect(lottoAfter.quantitaResidua).toBe(lottoBefore.quantitaResidua);
    expect(beneficiarioAfter.creditoSolidaleSaldo).toBe(
      beneficiarioBefore.creditoSolidaleSaldo,
    );
    expect(
      movements.filter(
        (movement) => movement.tipoDettaglio === "storno_spesa_emporio",
      ),
    ).toHaveLength(0);
  });

  it("annulla atomicamente la chiusura se la giacenza diventa insufficiente", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "1",
    });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 1);
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    await db
      .update(lottiTable)
      .set({ quantitaResidua: "0.00" })
      .where(eq(lottiTable.id, lottoIds[lottoIds.length - 1]));

    const close = await postSessionAction(sessione.body.id, "chiudi");
    expect(close.status).toBe(409);
    expect(close.body.error).toBe(
      "Giacenza insufficiente per chiudere la spesa Emporio. Verifica le disponibilità di magazzino prima di riprovare.",
    );

    const [beneficiario] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));
    const [sessioneDopo] = await db
      .select()
      .from(sessioniCassaEmporioTable)
      .where(eq(sessioniCassaEmporioTable.id, sessione.body.id));
    const spese = await db
      .select()
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.sessioneCassaId, sessione.body.id));
    const movimentiCredito = await db
      .select()
      .from(creditoSolidaleMovimentiTable)
      .where(
        eq(
          creditoSolidaleMovimentiTable.beneficiarioId,
          fixture.beneficiarioId,
        ),
      );

    expect(beneficiario.creditoSolidaleSaldo).toBe("20.00");
    expect(sessioneDopo.statoSessione).toBe("pronta_per_chiusura");
    expect(spese).toHaveLength(0);
    expect(movimentiCredito).toHaveLength(0);
  });

  it("rifiuta atomicamente un'incoerenza legacy tra Accesso e Sessione", async () => {
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "2",
    });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 1);
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    const altroBeneficiarioId = await createBeneficiario({
      areaOperativaId: fixture.areaOperativaId,
      centroAscoltoId: fixture.centroId,
      saldo: "20.00",
    });
    await db
      .update(consegneTable)
      .set({ beneficiarioId: altroBeneficiarioId })
      .where(eq(consegneTable.id, fixture.accessoId));

    const close = await postSessionAction(sessione.body.id, "chiudi");
    expect(close.status).toBe(409);
    const spese = await db
      .select()
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.sessioneCassaId, sessione.body.id));
    const crediti = await db
      .select()
      .from(creditoSolidaleMovimentiTable)
      .where(
        eq(
          creditoSolidaleMovimentiTable.beneficiarioId,
          fixture.beneficiarioId,
        ),
      );
    expect(spese).toHaveLength(0);
    expect(crediti).toHaveLength(0);
  });

  it("applica scope Area a Sessioni, Spese, Bolla, email e storno", async () => {
    const areaOperativaId = await createAreaOperativa();
    const centroAId = await createCentro(areaOperativaId);
    const altraAreaId = await createAreaOperativa();
    const centroBId = await createCentro(altraAreaId);
    const magazzinoAId = await createMagazzino(
      "emporio",
      areaOperativaId,
      centroAId,
    );
    const magazzinoBId = await createMagazzino(
      "emporio",
      altraAreaId,
      centroBId,
    );
    const beneficiarioId = await createBeneficiario({
      areaOperativaId,
      centroAscoltoId: centroAId,
      saldo: "50.00",
    });
    const accessoAId = await createAccesso({
      beneficiarioId,
      magazzinoId: magazzinoAId,
      dataOraInizio: "2026-07-15T09:00:00",
    });
    const altroBeneficiarioId = await createBeneficiario({
      areaOperativaId: altraAreaId,
      centroAscoltoId: centroBId,
      saldo: "50.00",
    });
    const accessoBId = await createAccesso({
      beneficiarioId: altroBeneficiarioId,
      magazzinoId: magazzinoBId,
      dataOraInizio: "2026-07-16T09:00:00",
    });
    const prodottoAId = await createProdotto({ magazzinoId: magazzinoAId });
    const prodottoBId = await createProdotto({ magazzinoId: magazzinoBId });
    const lottoBId = lottoIds[lottoIds.length - 1];

    const sessioneA = await openSession(accessoAId);
    await addProduct(sessioneA.body.id, prodottoAId, 1);
    await postSessionAction(sessioneA.body.id, "pronta-per-chiusura");
    const chiusuraA = await postSessionAction(sessioneA.body.id, "chiudi");
    expect(chiusuraA.status).toBe(200);
    await trackSpesa(chiusuraA.body.spesa.id);

    const sessioneB = await openSession(accessoBId);
    await addProduct(sessioneB.body.id, prodottoBId, 1);
    await postSessionAction(sessioneB.body.id, "pronta-per-chiusura");
    const chiusuraB = await postSessionAction(sessioneB.body.id, "chiudi");
    expect(chiusuraB.status).toBe(200);
    await trackSpesa(chiusuraB.body.spesa.id);

    const scopedCentroA = makeApp({
      isAdmin: false,
      centroAscoltoId: centroAId,
      areaOperativaId,
      permessi: [
        "emporio.cassa.view",
        "emporio.sales.view",
        "emporio.sales.manage",
        "emporio.sales.reverse",
      ],
    });

    const sessioni = await request(scopedCentroA).get(
      "/cassa-emporio/sessioni",
    );
    expect(sessioni.status).toBe(200);
    expect(sessioni.headers["x-total-count"]).toBe("1");
    expect(sessioni.body.map((row: { id: number }) => row.id)).toEqual([
      sessioneA.body.id,
    ]);
    expect(
      (
        await request(scopedCentroA).get(
          `/cassa-emporio/sessioni/${sessioneB.body.id}`,
        )
      ).status,
    ).toBe(403);

    const spese = await request(scopedCentroA).get("/spese-emporio");
    expect(spese.status).toBe(200);
    expect(spese.headers["x-total-count"]).toBe("1");
    expect(spese.body.map((row: { id: number }) => row.id)).toEqual([
      chiusuraA.body.spesa.id,
    ]);
    expect(
      (
        await request(scopedCentroA).get(
          `/spese-emporio/${chiusuraB.body.spesa.id}`,
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await request(scopedCentroA).get(
          `/spese-emporio/${chiusuraA.body.spesa.id}/bolla-stampa`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(scopedCentroA).get(
          `/bolle/${chiusuraA.body.spesa.bollaId}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(scopedCentroA).get(
          `/spese-emporio/${chiusuraB.body.spesa.id}/bolla-stampa`,
        )
      ).status,
    ).toBe(403);

    const [lottoPrima] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoBId));
    const [beneficiarioPrima] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, beneficiarioId));
    const movimentiPrima = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.lottoId, lottoBId));
    const auditPrima = await db
      .select()
      .from(auditConfigurazioniTable)
      .where(eq(auditConfigurazioniTable.utenteId, operatorUserId));

    expect(
      (
        await request(scopedCentroA)
          .post(
            `/spese-emporio/${chiusuraB.body.spesa.id}/registra-invio-manuale-bolla`,
          )
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(scopedCentroA)
          .post(`/spese-emporio/${chiusuraB.body.spesa.id}/storna`)
          .send({ motivo: "Tentativo fuori scope" })
      ).status,
    ).toBe(403);

    const [lottoDopo] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoBId));
    const [beneficiarioDopo] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, beneficiarioId));
    const movimentiDopo = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.lottoId, lottoBId));
    const auditDopo = await db
      .select()
      .from(auditConfigurazioniTable)
      .where(eq(auditConfigurazioniTable.utenteId, operatorUserId));
    const spesaBDopo = await request(makeApp()).get(
      `/spese-emporio/${chiusuraB.body.spesa.id}`,
    );

    expect(lottoDopo.quantitaResidua).toBe(lottoPrima.quantitaResidua);
    expect(beneficiarioDopo.creditoSolidaleSaldo).toBe(
      beneficiarioPrima.creditoSolidaleSaldo,
    );
    expect(movimentiDopo).toHaveLength(movimentiPrima.length);
    expect(auditDopo).toHaveLength(auditPrima.length);
    expect(spesaBDopo.body.emailBollaStato).toBe("non_preparata");
    expect(spesaBDopo.body.statoSpesa).toBe("chiusa");
  });

  it("preserva la UOM deterministica nel fallback Bolla legacy senza inventare pz", async () => {
    const fixture = await createFixture();
    const sessione = await openSession(fixture.accessoId);
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      unitaMisura: "kg",
    });
    const [bolla] = await db
      .insert(bolleTable)
      .values({
        numeroBolla: `LEG-${rnd()}`,
        dataBolla: "2026-07-15",
        beneficiarioId: fixture.beneficiarioId,
        magazzinoId: fixture.magazzinoId,
      })
      .returning();
    bollaIds.push(bolla.id);
    const [spesa] = await db
      .insert(speseEmporioTable)
      .values({
        sessioneCassaId: sessione.body.id,
        accessoEmporioId: fixture.accessoId,
        beneficiarioId: fixture.beneficiarioId,
        centroAscoltoId: fixture.centroId,
        areaOperativaId: fixture.areaOperativaId,
        magazzinoEmporioId: fixture.magazzinoId,
        bollaId: bolla.id,
        numeroSpesa: `SP-LEG-${rnd()}`,
        totaleCreditoConsumati: "1.00",
        saldoPrima: "20.00",
        saldoDopo: "19.00",
      })
      .returning();
    spesaIds.push(spesa.id);
    const [rigaSpesa] = await db
      .insert(speseEmporioRigheTable)
      .values({
        spesaEmporioId: spesa.id,
        prodottoId,
        descrizioneProdotto: "Farina legacy",
        quantita: "0.50",
        unitaMisura: "kg",
        creditoUnitario: "2.00",
        creditoTotale: "1.00",
      })
      .returning();

    const fallbackKg = await request(makeApp()).get(`/bolle/${bolla.id}`);
    expect(fallbackKg.status).toBe(200);
    expect(fallbackKg.body.righe[0].unitaMisura).toBe("kg");

    await db
      .update(speseEmporioRigheTable)
      .set({ unitaMisura: null })
      .where(eq(speseEmporioRigheTable.id, rigaSpesa.id));
    const fallbackSenzaUom = await request(makeApp()).get(`/bolle/${bolla.id}`);
    expect(fallbackSenzaUom.status).toBe(200);
    expect(fallbackSenzaUom.body.righe[0].unitaMisura).toBeNull();

    await db.insert(bollaRigheTable).values({
      bollaId: bolla.id,
      prodottoId,
      quantita: "0.50",
      unitaMisura: "l",
    });
    const bollaNormale = await request(makeApp()).get(`/bolle/${bolla.id}`);
    expect(bollaNormale.status).toBe(200);
    expect(bollaNormale.body.righe[0].unitaMisura).toBe("l");
  });

  it("espone data documento Europe/Rome e provenienza FSE+ reale nella Bolla Emporio", async () => {
    const fixture = await createFixture();
    const prodottoFseId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      fsePlus: true,
    });
    const prodottoNonFseId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      fsePlus: false,
    });
    const sessione = await openSession(fixture.accessoId);
    expect((await addProduct(sessione.body.id, prodottoFseId)).status).toBe(
      201,
    );
    expect((await addProduct(sessione.body.id, prodottoNonFseId)).status).toBe(
      201,
    );
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    const chiusura = await postSessionAction(sessione.body.id, "chiudi");
    expect(chiusura.status).toBe(200);
    await trackSpesa(chiusura.body.spesa.id);

    const dataChiusura = new Date("2026-08-20T22:30:00.000Z");
    await db
      .update(speseEmporioTable)
      .set({ dataChiusura })
      .where(eq(speseEmporioTable.id, chiusura.body.spesa.id));
    await db
      .update(bolleTable)
      .set({ dataBolla: "2026-08-21" })
      .where(eq(bolleTable.id, chiusura.body.spesa.bollaId));

    const stampa = await request(makeApp()).get(
      `/spese-emporio/${chiusura.body.spesa.id}/bolla-stampa`,
    );
    expect(stampa.status).toBe(200);
    expect(stampa.body.dataChiusura).toBe("2026-08-20T22:30:00.000Z");
    expect(stampa.body.dataBolla).toBe("2026-08-21");
    expect(
      Object.fromEntries(
        stampa.body.righe.map(
          (riga: { prodottoId: number; fsePlus: boolean }) => [
            riga.prodottoId,
            riga.fsePlus,
          ],
        ),
      ),
    ).toEqual({
      [prodottoFseId]: true,
      [prodottoNonFseId]: false,
    });
  });

  it("impone quantità intere per pz e conserva i decimali per kg e l", async () => {
    const fixture = await createFixture();
    const sessione = await openSession(fixture.accessoId);
    const prodottoPzId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      unitaMisura: "pz",
    });
    const prodottoPzFrazionarioId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      unitaMisura: "pz",
    });
    const prodottoKgId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      unitaMisura: "kg",
    });
    const prodottoGrammiId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      unitaMisura: "g",
      quantitaFrazionabile: true,
    });
    const prodottoLitriId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      unitaMisura: "l",
      creditoSolidaleValore: "4",
    });
    const prodottoMillilitriId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      unitaMisura: "ml",
      quantitaFrazionabile: true,
    });

    const pz = await addProduct(sessione.body.id, prodottoPzId, 1);
    expect(pz.status).toBe(201);
    const pzFrazionario = await addProduct(
      sessione.body.id,
      prodottoPzFrazionarioId,
      0.5,
    );
    expect(pzFrazionario.status).toBe(400);
    expect(pzFrazionario.body.error).toContain("numero intero");
    let versione = await getSessionVersion(sessione.body.id);
    const duePezzi = await request(makeApp())
      .patch(`/cassa-emporio/sessioni/${sessione.body.id}/righe/${pz.body.id}`)
      .send({ quantita: 2, versione });
    expect(duePezzi.status).toBe(200);

    versione = await getSessionVersion(sessione.body.id);
    for (const quantita of [0.5, 1.25]) {
      const frazionaria = await request(makeApp())
        .patch(
          `/cassa-emporio/sessioni/${sessione.body.id}/righe/${pz.body.id}`,
        )
        .send({ quantita, versione });
      expect(frazionaria.status).toBe(400);
      expect(frazionaria.body.error).toContain("numero intero");
    }

    expect((await addProduct(sessione.body.id, prodottoKgId, 0.5)).status).toBe(
      201,
    );
    expect(
      (await addProduct(sessione.body.id, prodottoGrammiId, 0.5)).status,
    ).toBe(201);
    expect(
      (await addProduct(sessione.body.id, prodottoLitriId, 0.75)).status,
    ).toBe(201);
    expect(
      (await addProduct(sessione.body.id, prodottoMillilitriId, 0.5)).status,
    ).toBe(201);

    await db
      .update(sessioniCassaEmporioRigheTable)
      .set({ quantita: "0.50", creditoTotale: "1" })
      .where(eq(sessioniCassaEmporioRigheTable.id, pz.body.id));
    expect(
      (await postSessionAction(sessione.body.id, "pronta-per-chiusura")).status,
    ).toBe(200);
    const chiusuraLegacy = await postSessionAction(sessione.body.id, "chiudi");
    expect(chiusuraLegacy.status).toBe(409);
    expect(chiusuraLegacy.body.error).toContain("numero intero");
    expect(
      await db
        .select()
        .from(speseEmporioTable)
        .where(eq(speseEmporioTable.sessioneCassaId, sessione.body.id)),
    ).toHaveLength(0);
  });

  it("sospende, riprende e annulla con motivo; sessione annullata non è modificabile", async () => {
    const fixture = await createFixture();
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
    });
    const sessione = await openSession(fixture.accessoId);

    const sospesa = await postSessionAction(sessione.body.id, "sospendi");
    expect(sospesa.status).toBe(200);
    expect(sospesa.body.statoSessione).toBe("sospesa");

    const ripresa = await postSessionAction(sessione.body.id, "riprendi");
    expect(ripresa.status).toBe(200);
    expect(ripresa.body.statoSessione).toBe("aperta");

    const annullata = await postSessionAction(sessione.body.id, "annulla", {
      motivoAnnullamento: "Errore operatore",
    });
    expect(annullata.status).toBe(200);
    expect(annullata.body.statoSessione).toBe("annullata");

    const add = await addProduct(sessione.body.id, prodottoId, 1);
    expect(add.status).toBe(409);
  });
});
