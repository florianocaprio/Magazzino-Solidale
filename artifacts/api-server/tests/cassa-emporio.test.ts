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
import { eq, inArray } from "drizzle-orm";
import {
  beneficiariTable,
  auditConfigurazioniTable,
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
} from "@workspace/db";
import cassaEmporioRouter from "../src/routes/cassa-emporio";
import bolleRouter from "../src/routes/bolle";
import speseEmporioRouter from "../src/routes/spese-emporio";
import creditoSolidaleRouter from "../src/routes/credito-solidale";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
import { dataCivileEuropeRome } from "../src/lib/interventiWorkflow";
import { quantitaNettaMensileProdotto } from "../src/lib/speseEmporio";

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
let operatorUserId: number;

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
  app.use((req, _res, next) => {
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
      codiceBarre:
        opts.codiceBarre ??
        `200${Math.floor(Math.random() * 1_000_000_000)
          .toString()
          .padStart(9, "0")}0`,
      abilitatoEmporio: opts.abilitatoEmporio ?? true,
      creditoSolidaleValore: opts.creditoSolidaleValore ?? "2.50",
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
  const currentSpesaIds = spesaIds.splice(0);
  const currentBollaIds = bollaIds.splice(0);
  const currentScaricoIds = scaricoIds.splice(0);
  const currentRigaIds = rigaIds.splice(0);
  const currentSessioneIds = sessioneIds.splice(0);
  const currentConsegnaIds = consegnaIds.splice(0);
  const currentBeneficiarioIds = beneficiarioIds.splice(0);
  const currentMagazzinoIds = magazzinoIds.splice(0);

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
  it("applica RBAC dedicato a Cassa, force e Spese anche per utenti non-admin", async () => {
    for (const area of ["sociale", "uds"]) {
      const denied = makeApp({ isAdmin: false, aree: [area], permessi: [] });
      expect(
        (await request(denied).get("/cassa-emporio/sessioni")).status,
      ).toBe(403);
      expect((await request(denied).get("/spese-emporio")).status).toBe(403);
    }

    const viewOnly = makeApp({
      isAdmin: false,
      permessi: ["emporio.cassa.view", "emporio.sales.view"],
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
      .query({ search: codice, areaOperativaId: fixture.areaOperativaId });
    expect(res.status).toBe(200);
    expect(res.body[0].beneficiarioId).toBe(fixture.beneficiarioId);
    expect(res.body[0].accessi.map((a: { id: number }) => a.id)).toContain(
      fixture.accessoId,
    );

    const scanned = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({
        search: codice.replace(/[^a-zA-Z0-9]/g, ""),
        areaOperativaId: fixture.areaOperativaId,
      });
    expect(scanned.status).toBe(200);
    expect(
      scanned.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).toContain(fixture.beneficiarioId);
  });

  it("mostra beneficiari accreditati anche senza Accesso Emporio pianificato", async () => {
    const areaOperativaId = await createAreaOperativa();
    const centroId = await createCentro(areaOperativaId);
    await createMagazzino("emporio", areaOperativaId, centroId);
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
      .query({ areaOperativaId });
    expect(byArea.status).toBe(200);
    expect(
      byArea.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).toEqual(expect.arrayContaining([popescuId, galliId]));

    const byName = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({ search: `${popescuCognome} Pavel` });
    expect(byName.status).toBe(200);
    expect(
      byName.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).toContain(popescuId);
    const popescuRow = byName.body.find(
      (b: { beneficiarioId: number }) => b.beneficiarioId === popescuId,
    );
    expect(popescuRow.accessi).toEqual([]);
  });

  it("ricerca in Cassa i beneficiari accreditati sull'Emporio selezionato anche se l'anagrafica è di un'altra Area", async () => {
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
        search: "Galli Luciana",
        areaOperativaId: romaId,
        magazzinoEmporioId: emporioRomaId,
      });

    expect(res.status).toBe(200);
    expect(
      res.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).toContain(galliId);
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
    expect(noArea.status).toBe(200);
    expect(noArea.body).toHaveLength(0);

    const searchWithoutArea = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({ search: "Cassa" });
    expect(searchWithoutArea.status).toBe(200);
    expect(
      searchWithoutArea.body.map(
        (b: { beneficiarioId: number }) => b.beneficiarioId,
      ),
    ).toContain(fixture.beneficiarioId);

    const byArea = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({ data: "2026-07-15", areaOperativaId: fixture.areaOperativaId });
    expect(byArea.status).toBe(200);
    const ids = byArea.body.map(
      (b: { beneficiarioId: number }) => b.beneficiarioId,
    );
    expect(ids).toContain(fixture.beneficiarioId);
    expect(ids).not.toContain(nonAbilitatoId);
  });

  it("mostra beneficiari accreditati e filtra gli accessi validi per data, area ed Emporio", async () => {
    const fixture = await createFixture();
    const otherAreaOperativaId = await createAreaOperativa();
    const otherCentroId = await createCentro(otherAreaOperativaId);
    const otherMagazzinoId = await createMagazzino(
      "emporio",
      otherAreaOperativaId,
      otherCentroId,
    );

    const list = await request(makeApp())
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

    const wrongDate = await request(makeApp())
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

    const wrongEmporio = await request(makeApp())
      .get("/cassa-emporio/beneficiari/ricerca")
      .query({
        data: "2026-07-15",
        areaOperativaId: fixture.areaOperativaId,
        magazzinoEmporioId: otherMagazzinoId,
      });
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
      creditoSolidaleValore: "2.50",
    });
    const sessione = await openSession(fixture.accessoId);

    const add = await addProduct(sessione.body.id, prodottoId, 2);
    expect(add.status).toBe(201);
    let detail = await request(makeApp()).get(
      `/cassa-emporio/sessioni/${sessione.body.id}`,
    );
    expect(detail.body.totaleCreditoPrevisto).toBe(5);

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
    expect(detail.body.totaleCreditoPrevisto).toBe(7.5);

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
    const fixture = await createFixture({ saldo: "20.00" });
    const prodottoId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      creditoSolidaleValore: "2.00",
      quantitaResidua: "5",
    });
    const sessione = await openSession(fixture.accessoId);
    await addProduct(sessione.body.id, prodottoId, 2);

    const [beneficiarioPrima] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, fixture.beneficiarioId));
    const [lottoPrima] = await db
      .select()
      .from(lottiTable)
      .where(inArray(lottiTable.id, lottoIds));
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

    const ready = await postSessionAction(
      sessione.body.id,
      "pronta-per-chiusura",
    );
    expect(ready.status).toBe(200);
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
    await addProduct(sessione.body.id, prodottoId, 1);
    await postSessionAction(sessione.body.id, "pronta-per-chiusura");
    const close = await postSessionAction(sessione.body.id, "chiudi");
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
    const [update, close] = await Promise.all([
      request(makeApp())
        .patch(
          `/cassa-emporio/sessioni/${sessione.body.id}/righe/${add.body.id}`,
        )
        .send({ quantita: 2, versione }),
      request(makeApp())
        .post(`/cassa-emporio/sessioni/${sessione.body.id}/chiudi`)
        .send({ versione }),
    ]);
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
    } else {
      expect(finale.statoSessione).toBe("aperta");
      expect(spese).toHaveLength(0);
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
      compensations
        .filter((movement) => movement.lottoId === lottoId)
        .reduce((sum, movement) => sum + Number(movement.quantita), 0),
    ).toBe(2);
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
      .send({ motivo: "Riferimento legacy incompleto" });
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

  it("applica insieme scope Beneficiario e Magazzino a Sessioni, Spese, Bolla, email e storno", async () => {
    const areaOperativaId = await createAreaOperativa();
    const centroAId = await createCentro(areaOperativaId);
    const centroBId = await createCentro(areaOperativaId);
    const magazzinoAId = await createMagazzino(
      "emporio",
      areaOperativaId,
      centroAId,
    );
    const magazzinoBId = await createMagazzino(
      "emporio",
      areaOperativaId,
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
    const accessoBId = await createAccesso({
      beneficiarioId,
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
    });
    const prodottoLitriId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      unitaMisura: "l",
    });
    const prodottoMillilitriId = await createProdotto({
      magazzinoId: fixture.magazzinoId,
      unitaMisura: "ml",
    });

    const pz = await addProduct(sessione.body.id, prodottoPzId, 1);
    expect(pz.status).toBe(201);
    const pzFrazionario = await addProduct(
      sessione.body.id,
      prodottoPzFrazionarioId,
      0.5,
    );
    expect(pzFrazionario.status).toBe(400);
    expect(pzFrazionario.body.error).toContain('unità di misura "pz"');
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
      expect(frazionaria.body.error).toContain('unità di misura "pz"');
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
      .set({ quantita: "0.50", creditoTotale: "0.50" })
      .where(eq(sessioniCassaEmporioRigheTable.id, pz.body.id));
    expect(
      (await postSessionAction(sessione.body.id, "pronta-per-chiusura")).status,
    ).toBe(200);
    const chiusuraLegacy = await postSessionAction(sessione.body.id, "chiudi");
    expect(chiusuraLegacy.status).toBe(409);
    expect(chiusuraLegacy.body.error).toContain("verifica manuale");
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
