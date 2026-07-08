import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
  consegneTable,
  db,
  magazziniTable,
  pool,
} from "@workspace/db";
import accessiEmporioRouter from "../src/routes/accessi-emporio";
import consegneRouter from "../src/routes/consegne";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";

const rnd = () => Math.random().toString(36).slice(2, 8);
const centroRichiestoMsg = "Per pianificare un Accesso Emporio è necessario associare il beneficiario a un Centro di Ascolto.";
const creditoRichiestoMsg = "Il beneficiario non è abilitato al Credito Solidale.";
const creditoNonAttivoMsg = "Il Credito Solidale del beneficiario non è attivo.";
const magazzinoEmporioMsg = "Selezionare un magazzino di tipo Emporio o Misto.";
const duplicatoMsg = "Esiste già un Accesso Emporio pianificato per questo beneficiario nella data selezionata.";
const accessoNonTrovatoMsg = "Accesso Emporio non trovato. Verifica l'accesso selezionato e riprova.";

const cittaIds: number[] = [];
const centroIds: number[] = [];
const magazzinoIds: number[] = [];
const beneficiarioIds: number[] = [];
const consegnaIds: number[] = [];

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
  app.use(accessiEmporioRouter);
  app.use(consegneRouter);
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
  codice?: string;
}): Promise<number> {
  const [beneficiario] = await db
    .insert(beneficiariTable)
    .values({
      codice: opts.codice ?? `BEN-${rnd()}`,
      cognome: `Accesso ${rnd()}`,
      nome: "Emporio",
      sesso: "M",
      cittaId: opts.cittaId,
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

async function createEligibleFixture(opts: { tipoMagazzino?: "emporio" | "misto" | "logistico"; codice?: string } = {}) {
  const cittaId = await createCitta();
  const centroId = await createCentro(cittaId);
  const magazzinoId = await createMagazzino(opts.tipoMagazzino ?? "emporio", cittaId, centroId);
  const beneficiarioId = await createBeneficiario({ cittaId, centroAscoltoId: centroId, codice: opts.codice });
  return { cittaId, centroId, magazzinoId, beneficiarioId };
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

beforeEach(async () => {
  await setEmporioEnabled(true);
});

afterEach(async () => {
  if (consegnaIds.length > 0) await db.delete(consegneTable).where(inArray(consegneTable.id, consegnaIds.splice(0)));
  if (beneficiarioIds.length > 0) await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, beneficiarioIds.splice(0)));
  if (magazzinoIds.length > 0) await db.delete(magazziniTable).where(inArray(magazziniTable.id, magazzinoIds.splice(0)));
  if (centroIds.length > 0) await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centroIds.splice(0)));
  if (cittaIds.length > 0) await db.delete(cittaTable).where(inArray(cittaTable.id, cittaIds.splice(0)));
  await setEmporioEnabled(false);
});

afterAll(async () => {
  await setEmporioEnabled(true);
  await pool.end();
});

describe("Accessi Emporio", () => {
  it("crea un Accesso Emporio con beneficiario eleggibile", async () => {
    const { res } = await createAccesso();
    expect(res.status).toBe(201);
    expect(res.body.tipoPianificazione).toBe("accesso_emporio");
    expect(res.body.statoAccessoEmporio).toBe("pianificato");
    expect(res.body.saldoCreditoSolidale).toBe(0);
  });

  it("blocca la creazione se Emporio è disabilitato", async () => {
    await setEmporioEnabled(false);
    const fixture = await createEligibleFixture();
    const res = await request(makeApp())
      .post("/accessi-emporio")
      .send({ beneficiarioId: fixture.beneficiarioId, magazzinoEmporioId: fixture.magazzinoId, dataOraInizio: "2026-07-10T09:00:00" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Il modulo Emporio Solidale è disabilitato. Abilitalo da Impostazioni Moduli per utilizzare questa funzione.");
  });

  it("blocca beneficiario senza Centro di Ascolto", async () => {
    const cittaId = await createCitta();
    const centroId = await createCentro(cittaId);
    const magazzinoId = await createMagazzino("emporio", cittaId, centroId);
    const beneficiarioId = await createBeneficiario({ cittaId, centroAscoltoId: null });
    const res = await request(makeApp())
      .post("/accessi-emporio")
      .send({ beneficiarioId, magazzinoEmporioId: magazzinoId, dataOraInizio: "2026-07-10T09:00:00" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(centroRichiestoMsg);
  });

  it("blocca beneficiario non abilitato al Credito Solidale", async () => {
    const cittaId = await createCitta();
    const centroId = await createCentro(cittaId);
    const magazzinoId = await createMagazzino("emporio", cittaId, centroId);
    const beneficiarioId = await createBeneficiario({ cittaId, centroAscoltoId: centroId, creditoSolidaleAbilitato: false });
    const res = await request(makeApp())
      .post("/accessi-emporio")
      .send({ beneficiarioId, magazzinoEmporioId: magazzinoId, dataOraInizio: "2026-07-10T09:00:00" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(creditoRichiestoMsg);
  });

  it("blocca beneficiario con Credito Solidale non attivo", async () => {
    const cittaId = await createCitta();
    const centroId = await createCentro(cittaId);
    const magazzinoId = await createMagazzino("emporio", cittaId, centroId);
    const beneficiarioId = await createBeneficiario({ cittaId, centroAscoltoId: centroId, creditoSolidaleStato: "sospeso" });
    const res = await request(makeApp())
      .post("/accessi-emporio")
      .send({ beneficiarioId, magazzinoEmporioId: magazzinoId, dataOraInizio: "2026-07-10T09:00:00" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(creditoNonAttivoMsg);
  });

  it("blocca magazzino logistico", async () => {
    const fixture = await createEligibleFixture({ tipoMagazzino: "logistico" });
    const res = await request(makeApp())
      .post("/accessi-emporio")
      .send({ beneficiarioId: fixture.beneficiarioId, magazzinoEmporioId: fixture.magazzinoId, dataOraInizio: "2026-07-10T09:00:00" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(magazzinoEmporioMsg);
  });

  it("consente magazzino Misto", async () => {
    const fixture = await createEligibleFixture({ tipoMagazzino: "misto" });
    const res = await request(makeApp())
      .post("/accessi-emporio")
      .send({ beneficiarioId: fixture.beneficiarioId, magazzinoEmporioId: fixture.magazzinoId, dataOraInizio: "2026-07-10T09:00:00" });
    if (res.body?.id) consegnaIds.push(res.body.id);
    expect(res.status).toBe(201);
    expect(res.body.magazzinoEmporioId).toBe(fixture.magazzinoId);
  });

  it("previene duplicato stesso beneficiario nella stessa data", async () => {
    const { fixture } = await createAccesso();
    const duplicate = await request(makeApp())
      .post("/accessi-emporio")
      .send({ beneficiarioId: fixture.beneficiarioId, magazzinoEmporioId: fixture.magazzinoId, dataOraInizio: "2026-07-10T11:00:00" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe(duplicatoMsg);
  });

  it.each(["confermato", "effettuato", "non_presentato"] as const)("cambia stato accesso: %s", async (statoAccessoEmporio) => {
    const { res } = await createAccesso();
    const changed = await request(makeApp())
      .patch(`/accessi-emporio/${res.body.id}/stato`)
      .send({ statoAccessoEmporio });
    expect(changed.status).toBe(200);
    expect(changed.body.statoAccessoEmporio).toBe(statoAccessoEmporio);
  });

  it("annulla accesso con motivo", async () => {
    const { res } = await createAccesso();
    const changed = await request(makeApp())
      .patch(`/accessi-emporio/${res.body.id}/stato`)
      .send({ statoAccessoEmporio: "annullato", motivoAnnullamento: "Telefonata beneficiario" });
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
      statoAccessoEmporio: "confermato",
    });
    const fuori = await createAccesso({ dataOraInizio: "2026-07-12T09:00:00", dataOraFine: "2026-07-12T10:00:00" });
    expect(res.status).toBe(201);
    expect(fuori.res.status).toBe(201);

    const byPeriod = await request(makeApp()).get("/accessi-emporio").query({ dataDa: "2026-07-11", dataA: "2026-07-11" });
    expect(byPeriod.status).toBe(200);
    expect(byPeriod.body.map((r: { id: number }) => r.id)).toContain(res.body.id);
    expect(byPeriod.body.map((r: { id: number }) => r.id)).not.toContain(fuori.res.body.id);

    const byState = await request(makeApp()).get("/accessi-emporio").query({ statoAccessoEmporio: "confermato" });
    expect(byState.status).toBe(200);
    expect(byState.body.map((r: { id: number }) => r.id)).toContain(res.body.id);
  });

  it("ricerca beneficiario per codice tessera/codice a barre", async () => {
    const fixture = await createEligibleFixture({ codice: `BAR-${rnd()}` });
    const res = await request(makeApp())
      .post("/accessi-emporio")
      .send({ beneficiarioId: fixture.beneficiarioId, magazzinoEmporioId: fixture.magazzinoId, dataOraInizio: "2026-07-10T09:00:00" });
    consegnaIds.push(res.body.id);

    const list = await request(makeApp()).get("/accessi-emporio").query({ beneficiarioSearch: "BAR-" });
    expect(list.status).toBe(200);
    expect(list.body.map((r: { id: number }) => r.id)).toContain(res.body.id);
  });

  it("ricerca beneficiari eleggibili per la combo Accessi Emporio", async () => {
    const codice = `SRC-${rnd()}`;
    const fixture = await createEligibleFixture({ codice });
    const bySearch = await request(makeApp()).get("/accessi-emporio/beneficiari/ricerca").query({ search: codice });
    expect(bySearch.status).toBe(200);
    expect(bySearch.body.map((b: { beneficiarioId: number }) => b.beneficiarioId)).toContain(fixture.beneficiarioId);
    expect(bySearch.body[0].creditoSolidaleAbilitato).toBe(true);
    expect(bySearch.body[0].creditoSolidaleStato).toBe("attivo");

    const byId = await request(makeApp()).get("/accessi-emporio/beneficiari/ricerca").query({ beneficiarioId: fixture.beneficiarioId });
    expect(byId.status).toBe(200);
    expect(byId.body[0].beneficiarioId).toBe(fixture.beneficiarioId);
  });

  it("le consegne pacco continuano a funzionare e la lista storica non include accessi Emporio", async () => {
    const fixture = await createEligibleFixture();
    const accesso = await request(makeApp())
      .post("/accessi-emporio")
      .send({ beneficiarioId: fixture.beneficiarioId, magazzinoEmporioId: fixture.magazzinoId, dataOraInizio: "2026-07-10T09:00:00" });
    consegnaIds.push(accesso.body.id);

    const consegna = await request(makeApp())
      .post("/consegne")
      .send({ beneficiarioId: fixture.beneficiarioId, tipoConsegna: "in_sede", dataPrevista: "2026-07-10", magazzinoId: fixture.magazzinoId });
    consegnaIds.push(consegna.body.id);
    expect(consegna.status).toBe(201);
    expect(consegna.body.tipoPianificazione).toBe("consegna_pacco");

    const list = await request(makeApp()).get("/consegne");
    expect(list.status).toBe(200);
    expect(list.body.map((r: { id: number }) => r.id)).toContain(consegna.body.id);
    expect(list.body.map((r: { id: number }) => r.id)).not.toContain(accesso.body.id);
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
      .returning({ id: consegneTable.id, tipoPianificazione: consegneTable.tipoPianificazione });
    consegnaIds.push(row.id);

    expect(row.tipoPianificazione).toBe("consegna_pacco");
    const list = await request(makeApp()).get("/consegne");
    expect(list.body.map((r: { id: number }) => r.id)).toContain(row.id);
  });

  it("modifica un Accesso Emporio pianificato", async () => {
    const { res } = await createAccesso();
    const changed = await request(makeApp())
      .patch(`/accessi-emporio/${res.body.id}`)
      .send({ dataOraInizio: "2026-07-13T15:00:00", dataOraFine: "2026-07-13T16:00:00", noteAccessoEmporio: "Nuovo orario" });
    expect(changed.status).toBe(200);
    expect(changed.body.noteAccessoEmporio).toBe("Nuovo orario");
    expect(changed.body.dataOraInizio).toContain("2026-07-13");
  });
});
