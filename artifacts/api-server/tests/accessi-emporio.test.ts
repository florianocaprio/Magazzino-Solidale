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
  centriAscoltoTable,
  areeOperativeTable,
  consegneTable,
  db,
  magazziniTable,
  pool,
  sessioniCassaEmporioTable,
  utentiTable,
} from "@workspace/db";
import accessiEmporioRouter from "../src/routes/accessi-emporio";
import consegneRouter from "../src/routes/consegne";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";

const rnd = () => Math.random().toString(36).slice(2, 8);
const centroRichiestoMsg =
  "Per pianificare un Accesso Emporio è necessario associare il beneficiario a un Centro di Ascolto.";
const creditoRichiestoMsg =
  "Il beneficiario non è abilitato al Credito Solidale.";
const creditoNonAttivoMsg =
  "Il Credito Solidale del beneficiario non è attivo.";
const magazzinoEmporioMsg = "Selezionare un magazzino di tipo Emporio o Misto.";
const duplicatoMsg =
  "Esiste già un Accesso Emporio pianificato per questo beneficiario nella data selezionata.";
const accessoNonTrovatoMsg =
  "Accesso Emporio non trovato. Verifica l'accesso selezionato e riprova.";

const areaOperativaIds: number[] = [];
const centroIds: number[] = [];
const magazzinoIds: number[] = [];
const beneficiarioIds: number[] = [];
const consegnaIds: number[] = [];
const sessioneIds: number[] = [];
let operatorUserId: number;

function makeApp(
  options: {
    isAdmin?: boolean;
    permessi?: string[];
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
      aree: ["emporio"],
    };
    next();
  });
  app.use(accessiEmporioRouter);
  app.use(consegneRouter);
  return app;
}

async function setEmporioEnabled(enabled: boolean): Promise<void> {
  await updateModuloAmbiente("EMPORIO_SOLIDALE", enabled, null);
}

async function setCentroAscoltoEnabled(enabled: boolean): Promise<void> {
  await updateModuloAmbiente("CENTRO_ASCOLTO", enabled, null);
}

async function setMagazzinoSolidaleEnabled(enabled: boolean): Promise<void> {
  await updateModuloAmbiente("MAGAZZINO_SOLIDALE", enabled, null);
}

async function createAreaOperativa(): Promise<number> {
  const [areaOperativa] = await db
    .insert(areeOperativeTable)
    .values({ nome: `AreaOperativa ${rnd()}` })
    .returning({ id: areeOperativeTable.id });
  areaOperativaIds.push(areaOperativa.id);
  return areaOperativa.id;
}

async function createCentro(areaOperativaId: number): Promise<number> {
  const [centro] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `Centro ${rnd()}`, areaOperativaId })
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
  codice?: string;
}): Promise<number> {
  const [beneficiario] = await db
    .insert(beneficiariTable)
    .values({
      codice: opts.codice ?? `BEN-${rnd()}`,
      cognome: `Accesso ${rnd()}`,
      nome: "Emporio",
      sesso: "M",
      areaOperativaId: opts.areaOperativaId,
      centroAscoltoId: opts.centroAscoltoId,
      creditoSolidaleAbilitato: opts.creditoSolidaleAbilitato ?? true,
      creditoSolidaleStato: opts.creditoSolidaleStato ?? "attivo",
      creditoSolidaleSaldo: "0.00",
      creditoSolidaleMensileAssegnato: "25.00",
      attivo: opts.attivo ?? true,
    })
    .returning({ id: beneficiariTable.id });
  beneficiarioIds.push(beneficiario.id);
  return beneficiario.id;
}

async function createEligibleFixture(
  opts: {
    tipoMagazzino?: "emporio" | "misto" | "logistico";
    codice?: string;
  } = {},
) {
  const areaOperativaId = await createAreaOperativa();
  const centroId = await createCentro(areaOperativaId);
  const magazzinoId = await createMagazzino(
    opts.tipoMagazzino ?? "emporio",
    areaOperativaId,
    centroId,
  );
  const beneficiarioId = await createBeneficiario({
    areaOperativaId,
    centroAscoltoId: centroId,
    codice: opts.codice,
  });
  return { areaOperativaId, centroId, magazzinoId, beneficiarioId };
}

async function createAccesso(payload: Record<string, unknown> = {}) {
  const fixture = await createEligibleFixture();
  const res = await request(makeApp())
    .post("/accessi-emporio")
    .send({
      beneficiarioId: fixture.beneficiarioId,
      magazzinoEmporioId: fixture.magazzinoId,
      dataOraInizio: "2026-07-10T09:00:00",
      dataOraFine: "2026-07-10T10:00:00",
      ...payload,
    });
  if (res.body?.id) consegnaIds.push(res.body.id);
  return { res, fixture };
}

beforeAll(async () => {
  const [operator] = await db
    .insert(utentiTable)
    .values({
      username: `accessi_test_${rnd()}`,
      passwordHash: "test-only",
      nome: "Operatore Accessi Test",
      attivo: true,
    })
    .returning({ id: utentiTable.id });
  operatorUserId = operator.id;
});

beforeEach(async () => {
  await setEmporioEnabled(true);
  await setCentroAscoltoEnabled(true);
  await setMagazzinoSolidaleEnabled(true);
});

afterEach(async () => {
  await db
    .delete(auditConfigurazioniTable)
    .where(eq(auditConfigurazioniTable.utenteId, operatorUserId));
  if (sessioneIds.length > 0)
    await db
      .delete(sessioniCassaEmporioTable)
      .where(inArray(sessioniCassaEmporioTable.id, sessioneIds.splice(0)));
  if (consegnaIds.length > 0)
    await db
      .delete(consegneTable)
      .where(inArray(consegneTable.id, consegnaIds.splice(0)));
  if (beneficiarioIds.length > 0)
    await db
      .delete(beneficiariTable)
      .where(inArray(beneficiariTable.id, beneficiarioIds.splice(0)));
  if (magazzinoIds.length > 0)
    await db
      .delete(magazziniTable)
      .where(inArray(magazziniTable.id, magazzinoIds.splice(0)));
  if (centroIds.length > 0)
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, centroIds.splice(0)));
  if (areaOperativaIds.length > 0)
    await db
      .delete(areeOperativeTable)
      .where(inArray(areeOperativeTable.id, areaOperativaIds.splice(0)));
  await setEmporioEnabled(false);
  await setCentroAscoltoEnabled(true);
  await setMagazzinoSolidaleEnabled(true);
});

afterAll(async () => {
  await setEmporioEnabled(true);
  await db
    .delete(auditConfigurazioniTable)
    .where(eq(auditConfigurazioniTable.utenteId, operatorUserId));
  await db.delete(utentiTable).where(eq(utentiTable.id, operatorUserId));
  await pool.end();
});

describe("Accessi Emporio", () => {
  it("separa i permessi di lettura e gestione degli accessi", async () => {
    const none = makeApp({ isAdmin: false, permessi: [] });
    expect((await request(none).get("/accessi-emporio")).status).toBe(403);
    expect((await request(none).post("/accessi-emporio").send({})).status).toBe(
      403,
    );

    const viewOnly = makeApp({
      isAdmin: false,
      permessi: ["emporio.access.view"],
    });
    expect((await request(viewOnly).get("/accessi-emporio")).status).toBe(200);
    expect(
      (await request(viewOnly).post("/accessi-emporio").send({})).status,
    ).toBe(403);
  });

  it("crea un Accesso Emporio con beneficiario eleggibile", async () => {
    const { res } = await createAccesso();
    expect(res.status).toBe(201);
    expect(res.body.tipoPianificazione).toBe("accesso_emporio");
    expect(res.body.statoAccessoEmporio).toBe("pianificato");
    expect(res.body.saldoCreditoSolidale).toBe(0);
  });

  it("continua a creare accessi quando il servizio Centro di Ascolto è disabilitato", async () => {
    await setCentroAscoltoEnabled(false);
    const { res } = await createAccesso();
    expect(res.status).toBe(201);
    expect(res.body.tipoPianificazione).toBe("accesso_emporio");
  });

  it("continua a creare accessi quando il servizio Magazzino Solidale è disabilitato", async () => {
    await setMagazzinoSolidaleEnabled(false);
    const { res } = await createAccesso();
    expect(res.status).toBe(201);
    expect(res.body.tipoPianificazione).toBe("accesso_emporio");
  });

  it("blocca la creazione se Emporio è disabilitato", async () => {
    await setEmporioEnabled(false);
    const fixture = await createEligibleFixture();
    const res = await request(makeApp()).post("/accessi-emporio").send({
      beneficiarioId: fixture.beneficiarioId,
      magazzinoEmporioId: fixture.magazzinoId,
      dataOraInizio: "2026-07-10T09:00:00",
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(
      "Il modulo Emporio Solidale è disabilitato. Abilitalo da Impostazioni Moduli per utilizzare questa funzione.",
    );
  });

  it("blocca beneficiario senza Centro di Ascolto", async () => {
    const areaOperativaId = await createAreaOperativa();
    const centroId = await createCentro(areaOperativaId);
    const magazzinoId = await createMagazzino("emporio", areaOperativaId, centroId);
    const beneficiarioId = await createBeneficiario({
      areaOperativaId,
      centroAscoltoId: null,
    });
    const res = await request(makeApp()).post("/accessi-emporio").send({
      beneficiarioId,
      magazzinoEmporioId: magazzinoId,
      dataOraInizio: "2026-07-10T09:00:00",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(centroRichiestoMsg);
  });

  it("blocca beneficiario non abilitato al Credito Solidale", async () => {
    const areaOperativaId = await createAreaOperativa();
    const centroId = await createCentro(areaOperativaId);
    const magazzinoId = await createMagazzino("emporio", areaOperativaId, centroId);
    const beneficiarioId = await createBeneficiario({
      areaOperativaId,
      centroAscoltoId: centroId,
      creditoSolidaleAbilitato: false,
    });
    const res = await request(makeApp()).post("/accessi-emporio").send({
      beneficiarioId,
      magazzinoEmporioId: magazzinoId,
      dataOraInizio: "2026-07-10T09:00:00",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(creditoRichiestoMsg);
  });

  it("blocca un nuovo accesso per un beneficiario inattivo", async () => {
    const areaOperativaId = await createAreaOperativa();
    const centroId = await createCentro(areaOperativaId);
    const magazzinoId = await createMagazzino("emporio", areaOperativaId, centroId);
    const beneficiarioId = await createBeneficiario({
      areaOperativaId,
      centroAscoltoId: centroId,
      attivo: false,
    });
    const res = await request(makeApp()).post("/accessi-emporio").send({
      beneficiarioId,
      magazzinoEmporioId: magazzinoId,
      dataOraInizio: "2026-07-10T09:00:00",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non è attivo/i);
  });

  it("blocca beneficiario con Credito Solidale non attivo", async () => {
    const areaOperativaId = await createAreaOperativa();
    const centroId = await createCentro(areaOperativaId);
    const magazzinoId = await createMagazzino("emporio", areaOperativaId, centroId);
    const beneficiarioId = await createBeneficiario({
      areaOperativaId,
      centroAscoltoId: centroId,
      creditoSolidaleStato: "sospeso",
    });
    const res = await request(makeApp()).post("/accessi-emporio").send({
      beneficiarioId,
      magazzinoEmporioId: magazzinoId,
      dataOraInizio: "2026-07-10T09:00:00",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(creditoNonAttivoMsg);
  });

  it("blocca magazzino logistico", async () => {
    const fixture = await createEligibleFixture({ tipoMagazzino: "logistico" });
    const res = await request(makeApp()).post("/accessi-emporio").send({
      beneficiarioId: fixture.beneficiarioId,
      magazzinoEmporioId: fixture.magazzinoId,
      dataOraInizio: "2026-07-10T09:00:00",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(magazzinoEmporioMsg);
  });

  it("consente magazzino Misto", async () => {
    const fixture = await createEligibleFixture({ tipoMagazzino: "misto" });
    const res = await request(makeApp()).post("/accessi-emporio").send({
      beneficiarioId: fixture.beneficiarioId,
      magazzinoEmporioId: fixture.magazzinoId,
      dataOraInizio: "2026-07-10T09:00:00",
    });
    if (res.body?.id) consegnaIds.push(res.body.id);
    expect(res.status).toBe(201);
    expect(res.body.magazzinoEmporioId).toBe(fixture.magazzinoId);
  });

  it("previene duplicato stesso beneficiario nella stessa data", async () => {
    const { fixture } = await createAccesso();
    const duplicate = await request(makeApp()).post("/accessi-emporio").send({
      beneficiarioId: fixture.beneficiarioId,
      magazzinoEmporioId: fixture.magazzinoId,
      dataOraInizio: "2026-07-10T11:00:00",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe(duplicatoMsg);
  });

  it("serializza due creazioni concorrenti dello stesso Accesso operativo", async () => {
    const fixture = await createEligibleFixture();
    const payload = {
      beneficiarioId: fixture.beneficiarioId,
      magazzinoEmporioId: fixture.magazzinoId,
      dataOraInizio: "2026-07-14T09:00:00",
    };
    const [first, second] = await Promise.all([
      request(makeApp()).post("/accessi-emporio").send(payload),
      request(makeApp()).post("/accessi-emporio").send(payload),
    ]);
    const created = [first, second].find((result) => result.status === 201);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(created).toBeDefined();
    consegnaIds.push(created!.body.id);
    const rows = await db
      .select()
      .from(consegneTable)
      .where(eq(consegneTable.beneficiarioId, fixture.beneficiarioId));
    expect(
      rows.filter((row) => row.tipoPianificazione === "accesso_emporio"),
    ).toHaveLength(1);
  });

  it("tratta gli stati terminali come irreversibili", async () => {
    const { res } = await createAccesso();
    const cancelled = await request(makeApp())
      .patch(`/accessi-emporio/${res.body.id}/stato`)
      .send({ statoAccessoEmporio: "annullato", motivoAnnullamento: "Test" });
    expect(cancelled.status).toBe(200);
    const regression = await request(makeApp())
      .patch(`/accessi-emporio/${res.body.id}/stato`)
      .send({ statoAccessoEmporio: "confermato" });
    expect(regression.status).toBe(409);
  });

  it("rende immutabili Beneficiario ed Emporio dopo l'apertura della Sessione", async () => {
    const { res, fixture } = await createAccesso();
    const [sessione] = await db
      .insert(sessioniCassaEmporioTable)
      .values({
        accessoEmporioId: res.body.id,
        beneficiarioId: fixture.beneficiarioId,
        magazzinoEmporioId: fixture.magazzinoId,
        centroAscoltoId: fixture.centroId,
        areaOperativaId: fixture.areaOperativaId,
      })
      .returning({ id: sessioniCassaEmporioTable.id });
    sessioneIds.push(sessione.id);
    const other = await createEligibleFixture();
    const changed = await request(makeApp())
      .patch(`/accessi-emporio/${res.body.id}`)
      .send({
        beneficiarioId: other.beneficiarioId,
        magazzinoEmporioId: other.magazzinoId,
      });
    expect(changed.status).toBe(409);
  });

  it("blocca nuovi Accessi su Emporio inattivo mantenendo consultabile lo storico", async () => {
    const fixture = await createEligibleFixture();
    await db
      .update(magazziniTable)
      .set({ stato: "inattivo" })
      .where(eq(magazziniTable.id, fixture.magazzinoId));
    const denied = await request(makeApp()).post("/accessi-emporio").send({
      beneficiarioId: fixture.beneficiarioId,
      magazzinoEmporioId: fixture.magazzinoId,
      dataOraInizio: "2026-07-18T09:00:00",
    });
    expect(denied.status).toBe(400);
    expect(denied.body.error).toMatch(/non è attivo/i);
    const history = await request(makeApp()).get("/accessi-emporio");
    expect(history.status).toBe(200);
  });

  it("applica insieme scope Beneficiario e Magazzino a lista, dettaglio e modifiche", async () => {
    const areaOperativaId = await createAreaOperativa();
    const centroAId = await createCentro(areaOperativaId);
    const centroBId = await createCentro(areaOperativaId);
    const magazzinoAId = await createMagazzino("emporio", areaOperativaId, centroAId);
    const magazzinoBId = await createMagazzino("emporio", areaOperativaId, centroBId);
    const beneficiarioId = await createBeneficiario({
      areaOperativaId,
      centroAscoltoId: centroAId,
    });
    const globalApp = makeApp();
    const accessoA = await request(globalApp).post("/accessi-emporio").send({
      beneficiarioId,
      magazzinoEmporioId: magazzinoAId,
      dataOraInizio: "2026-07-20T09:00:00",
    });
    const accessoB = await request(globalApp).post("/accessi-emporio").send({
      beneficiarioId,
      magazzinoEmporioId: magazzinoBId,
      dataOraInizio: "2026-07-21T09:00:00",
    });
    expect(accessoA.status).toBe(201);
    expect(accessoB.status).toBe(201);
    consegnaIds.push(accessoA.body.id, accessoB.body.id);

    const scopedCentroA = makeApp({
      isAdmin: false,
      permessi: ["emporio.access.view", "emporio.access.manage"],
      centroAscoltoId: centroAId,
      areaOperativaId,
    });
    const list = await request(scopedCentroA).get("/accessi-emporio");
    expect(list.status).toBe(200);
    expect(list.headers["x-total-count"]).toBe("1");
    expect(list.body.map((row: { id: number }) => row.id)).toEqual([
      accessoA.body.id,
    ]);
    expect(
      (await request(scopedCentroA).get(`/accessi-emporio/${accessoA.body.id}`))
        .status,
    ).toBe(200);
    expect(
      (await request(scopedCentroA).get(`/accessi-emporio/${accessoB.body.id}`))
        .status,
    ).toBe(403);

    const [before] = await db
      .select()
      .from(consegneTable)
      .where(eq(consegneTable.id, accessoB.body.id));
    const update = await request(scopedCentroA)
      .patch(`/accessi-emporio/${accessoB.body.id}`)
      .send({ noteAccessoEmporio: "Tentativo fuori scope" });
    const updateStato = await request(scopedCentroA)
      .patch(`/accessi-emporio/${accessoB.body.id}/stato`)
      .send({ statoAccessoEmporio: "confermato" });
    expect(update.status).toBe(403);
    expect(updateStato.status).toBe(403);
    expect(update.body.error).toBe(
      "Risorsa non accessibile per il tuo profilo",
    );
    expect(updateStato.body.error).toBe(
      "Risorsa non accessibile per il tuo profilo",
    );
    const [after] = await db
      .select()
      .from(consegneTable)
      .where(eq(consegneTable.id, accessoB.body.id));
    expect(after).toEqual(before);
  });

  it("recupera oltre 250 Accessi tramite paginazione stabile", async () => {
    const fixture = await createEligibleFixture();
    const values = Array.from({ length: 251 }, (_, index) => {
      const date = new Date(Date.UTC(2027, 0, index + 1, 9));
      const civil = date.toISOString().slice(0, 10);
      return {
        codice: `PAGE-${rnd()}-${index}`,
        beneficiarioId: fixture.beneficiarioId,
        tipoPianificazione: "accesso_emporio" as const,
        tipoConsegna: "accesso_emporio",
        dataPrevista: civil,
        magazzinoId: fixture.magazzinoId,
        magazzinoEmporioId: fixture.magazzinoId,
        dataOraInizio: date,
        stato: "pianificata",
        statoAccessoEmporio: "pianificato" as const,
      };
    });
    const created = await db
      .insert(consegneTable)
      .values(values)
      .returning({ id: consegneTable.id });
    consegnaIds.push(...created.map((row) => row.id));

    const first = await request(makeApp())
      .get("/accessi-emporio")
      .query({ beneficiarioId: fixture.beneficiarioId, page: 1, limit: 100 });
    const third = await request(makeApp())
      .get("/accessi-emporio")
      .query({ beneficiarioId: fixture.beneficiarioId, page: 3, limit: 100 });
    expect(first.status).toBe(200);
    expect(first.body).toHaveLength(100);
    expect(first.headers["x-total-count"]).toBe("251");
    expect(third.body).toHaveLength(51);
    expect(
      new Set(
        [...first.body, ...third.body].map((row: { id: number }) => row.id),
      ).size,
    ).toBe(151);
  });

  it.each(["confermato", "non_presentato"] as const)(
    "cambia stato accesso: %s",
    async (statoAccessoEmporio) => {
      const { res } = await createAccesso();
      const changed = await request(makeApp())
        .patch(`/accessi-emporio/${res.body.id}/stato`)
        .send({ statoAccessoEmporio });
      expect(changed.status).toBe(200);
      expect(changed.body.statoAccessoEmporio).toBe(statoAccessoEmporio);
    },
  );

  it("riserva lo stato effettuato all'entrata operativa in Cassa", async () => {
    const { res } = await createAccesso();
    const changed = await request(makeApp())
      .patch(`/accessi-emporio/${res.body.id}/stato`)
      .send({ statoAccessoEmporio: "effettuato" });
    expect(changed.status).toBe(409);
  });

  it("annulla accesso con motivo", async () => {
    const { res } = await createAccesso();
    const changed = await request(makeApp())
      .patch(`/accessi-emporio/${res.body.id}/stato`)
      .send({
        statoAccessoEmporio: "annullato",
        motivoAnnullamento: "Telefonata beneficiario",
      });
    expect(changed.status).toBe(200);
    expect(changed.body.statoAccessoEmporio).toBe("annullato");
    expect(changed.body.motivoAnnullamento).toBe("Telefonata beneficiario");
  });

  it("restituisce messaggi chiari se l'Accesso Emporio non esiste", async () => {
    const detail = await request(makeApp()).get("/accessi-emporio/999999999");
    expect(detail.status).toBe(404);
    expect(detail.body.error).toBe(accessoNonTrovatoMsg);

    const update = await request(makeApp())
      .patch("/accessi-emporio/999999999")
      .send({ dataOraInizio: "2026-07-10T09:00:00" });
    expect(update.status).toBe(404);
    expect(update.body.error).toBe(accessoNonTrovatoMsg);

    const stato = await request(makeApp())
      .patch("/accessi-emporio/999999999/stato")
      .send({ statoAccessoEmporio: "confermato" });
    expect(stato.status).toBe(404);
    expect(stato.body.error).toBe(accessoNonTrovatoMsg);
  });

  it("lista Accessi Emporio filtrando per periodo e stato", async () => {
    const { res } = await createAccesso({
      dataOraInizio: "2026-07-11T09:00:00",
      dataOraFine: "2026-07-11T10:00:00",
    });
    const fuori = await createAccesso({
      dataOraInizio: "2026-07-12T09:00:00",
      dataOraFine: "2026-07-12T10:00:00",
    });
    expect(res.status).toBe(201);
    expect(fuori.res.status).toBe(201);
    const confirmed = await request(makeApp())
      .patch(`/accessi-emporio/${res.body.id}/stato`)
      .send({ statoAccessoEmporio: "confermato" });
    expect(confirmed.status).toBe(200);

    const byPeriod = await request(makeApp())
      .get("/accessi-emporio")
      .query({ dataDa: "2026-07-11", dataA: "2026-07-11" });
    expect(byPeriod.status).toBe(200);
    expect(byPeriod.body.map((r: { id: number }) => r.id)).toContain(
      res.body.id,
    );
    expect(byPeriod.body.map((r: { id: number }) => r.id)).not.toContain(
      fuori.res.body.id,
    );

    const byState = await request(makeApp())
      .get("/accessi-emporio")
      .query({ statoAccessoEmporio: "confermato" });
    expect(byState.status).toBe(200);
    expect(byState.body.map((r: { id: number }) => r.id)).toContain(
      res.body.id,
    );
  });

  it("ricerca beneficiario per codice tessera/codice a barre", async () => {
    const fixture = await createEligibleFixture({ codice: `BAR-${rnd()}` });
    const res = await request(makeApp()).post("/accessi-emporio").send({
      beneficiarioId: fixture.beneficiarioId,
      magazzinoEmporioId: fixture.magazzinoId,
      dataOraInizio: "2026-07-10T09:00:00",
    });
    consegnaIds.push(res.body.id);

    const list = await request(makeApp())
      .get("/accessi-emporio")
      .query({ beneficiarioSearch: "BAR-" });
    expect(list.status).toBe(200);
    expect(list.body.map((r: { id: number }) => r.id)).toContain(res.body.id);
  });

  it("ricerca beneficiari eleggibili per la combo Accessi Emporio", async () => {
    const codice = `SRC-${rnd()}`;
    const fixture = await createEligibleFixture({ codice });
    const bySearch = await request(makeApp())
      .get("/accessi-emporio/beneficiari/ricerca")
      .query({ search: codice });
    expect(bySearch.status).toBe(200);
    expect(
      bySearch.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).toContain(fixture.beneficiarioId);
    expect(bySearch.body[0].creditoSolidaleAbilitato).toBe(true);
    expect(bySearch.body[0].creditoSolidaleStato).toBe("attivo");

    const byId = await request(makeApp())
      .get("/accessi-emporio/beneficiari/ricerca")
      .query({ beneficiarioId: fixture.beneficiarioId });
    expect(byId.status).toBe(200);
    expect(byId.body[0].beneficiarioId).toBe(fixture.beneficiarioId);
  });

  it("le consegne pacco continuano a funzionare e la lista storica non include accessi Emporio", async () => {
    const fixture = await createEligibleFixture();
    const accesso = await request(makeApp()).post("/accessi-emporio").send({
      beneficiarioId: fixture.beneficiarioId,
      magazzinoEmporioId: fixture.magazzinoId,
      dataOraInizio: "2026-07-10T09:00:00",
    });
    consegnaIds.push(accesso.body.id);

    const consegna = await request(makeApp()).post("/consegne").send({
      beneficiarioId: fixture.beneficiarioId,
      tipoConsegna: "in_sede",
      dataPrevista: "2026-07-10",
      magazzinoId: fixture.magazzinoId,
    });
    consegnaIds.push(consegna.body.id);
    expect(consegna.status).toBe(201);
    expect(consegna.body.tipoPianificazione).toBe("consegna_pacco");

    const list = await request(makeApp()).get("/consegne");
    expect(list.status).toBe(200);
    expect(list.body.map((r: { id: number }) => r.id)).toContain(
      consegna.body.id,
    );
    expect(list.body.map((r: { id: number }) => r.id)).not.toContain(
      accesso.body.id,
    );
  });

  it("record consegna inseriti senza tipo esplicito sono trattati come consegna pacco", async () => {
    const fixture = await createEligibleFixture();
    const [row] = await db
      .insert(consegneTable)
      .values({
        codice: `CON-${rnd()}`,
        beneficiarioId: fixture.beneficiarioId,
        tipoConsegna: "in_sede",
        dataPrevista: "2026-07-10",
        magazzinoId: fixture.magazzinoId,
      })
      .returning({
        id: consegneTable.id,
        tipoPianificazione: consegneTable.tipoPianificazione,
      });
    consegnaIds.push(row.id);

    expect(row.tipoPianificazione).toBe("consegna_pacco");
    const list = await request(makeApp()).get("/consegne");
    expect(list.body.map((r: { id: number }) => r.id)).toContain(row.id);
  });

  it("modifica un Accesso Emporio pianificato", async () => {
    const { res } = await createAccesso();
    const changed = await request(makeApp())
      .patch(`/accessi-emporio/${res.body.id}`)
      .send({
        dataOraInizio: "2026-07-13T15:00:00",
        dataOraFine: "2026-07-13T16:00:00",
        noteAccessoEmporio: "Nuovo orario",
      });
    expect(changed.status).toBe(200);
    expect(changed.body.noteAccessoEmporio).toBe("Nuovo orario");
    expect(changed.body.dataOraInizio).toContain("2026-07-13");
  });
});
