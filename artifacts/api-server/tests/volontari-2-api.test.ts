/* @vitest-environment node */

import { Router } from "express";
import request from "supertest";
import * as XLSX from "xlsx";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copertureAssicurativeVolontariTable,
  centriAscoltoTable,
  corsiVolontariCatalogoTable,
  db,
  emissioniRegistroVolontariTable,
  giornateServizioVolontariTable,
  importazioniVolontariTable,
  importazioniVolontariRigheTable,
  pool,
  qualificheVolontariCatalogoTable,
  registroVolontariEventiTable,
  ruoliVolontariTable,
  volontariTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import approvazioniLogisticaRouter from "../src/routes/approvazioni-logistica";
import consegneRouter from "../src/routes/consegne";
import volontariExportRouter from "../src/routes/volontari-export";
import volontariFormazioneRouter from "../src/routes/volontari-formazione";
import volontariImportRouter from "../src/routes/volontari-import";
import volontariOperazioniRouter from "../src/routes/volontari-operazioni";
import volontariRouter from "../src/routes/volontari";
import {
  addCalendarDays,
  subtractCalendarMonths,
  todayRome,
} from "../src/lib/volontariDomain";
import {
  appendVolontarioLedgerEvent,
  buildVolunteerEventSnapshot,
  canonicalLedgerEventHash,
} from "../src/lib/volontariLedger";
import {
  cleanup,
  createAreaOperativa,
  createBeneficiario,
  createCentro,
  createCentroRec,
  createMagazzino,
  createRuoloVolontario,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

const allRouters = Router();
allRouters.use(volontariOperazioniRouter);
allRouters.use(volontariFormazioneRouter);
allRouters.use(volontariImportRouter);
allRouters.use(volontariExportRouter);
allRouters.use(volontariRouter);
allRouters.use(approvazioniLogisticaRouter);
allRouters.use(consegneRouter);

type UserOptions = Parameters<typeof makeScopedApp>[1];

const app = (overrides: Partial<UserOptions> = {}) =>
  makeScopedApp(allRouters, {
    id: 0,
    centroAscoltoId: null,
    areaOperativaId: null,
    ...overrides,
  });

let scope: SeedScope;
let ruoloId: number;
let defaultCenterId: number;
let sequence = 0;
const courseCatalogIds: number[] = [];
const qualificationCatalogIds: number[] = [];

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${sequence}`;
}

async function createVolunteer(input: {
  tipo?: "PERMANENTE" | "TEMPORANEO";
  centroAscoltoId?: number | null;
  email?: string;
  telefono?: string;
  codiceFiscale?: string;
  nome?: string;
  cognome?: string;
  luogoNascita?: string;
  dataNascita?: string;
  indirizzoResidenza?: string;
  dataServizio?: string;
}) {
  const centroAscoltoId = input.centroAscoltoId ?? defaultCenterId;
  const [center] = await db
    .select({ areaOperativaId: centriAscoltoTable.areaOperativaId })
    .from(centriAscoltoTable)
    .where(eq(centriAscoltoTable.id, centroAscoltoId));
  if (center && center.areaOperativaId == null) {
    const areaOperativaId = await createAreaOperativa(scope);
    await db
      .update(centriAscoltoTable)
      .set({ areaOperativaId })
      .where(eq(centriAscoltoTable.id, centroAscoltoId));
  }
  const response = await request(app())
    .post("/volontari")
    .send({
      nome: input.nome ?? "Ada",
      cognome: input.cognome ?? "Sintetica",
      tipoVolontario: input.tipo ?? "PERMANENTE",
      ruoloVolontarioId: ruoloId,
      centroAscoltoId,
      email: input.email,
      telefono: input.telefono,
      codiceFiscale: input.codiceFiscale,
      codiceFiscaleNonDisponibile: input.codiceFiscale == null,
      codiceFiscaleNota:
        input.codiceFiscale == null ? "Non disponibile nel test" : undefined,
      luogoNascita: input.luogoNascita ?? "Roma",
      dataNascita: input.dataNascita ?? "1990-01-02",
      indirizzoResidenza: input.indirizzoResidenza ?? "Via Sintetica 1",
      ...(input.tipo === "TEMPORANEO"
        ? { dataServizio: input.dataServizio ?? "2026-01-01" }
        : {}),
    });
  expect(response.status, response.text).toBe(201);
  scope.volontarioIds.push(response.body.id);
  return response.body as {
    id: number;
    versione: number;
    matricola: string;
  };
}

async function approve(volunteer: { id: number; versione: number }) {
  const response = await request(app())
    .post(`/approvazioni-logistica/volontari/${volunteer.id}/approva`)
    .send({ versione: volunteer.versione });
  expect(response.status, response.text).toBe(200);
  return { id: volunteer.id, versione: response.body.versione as number };
}

async function insure(
  volunteer: { id: number; versione: number },
  input: {
    modalita?: "NUOVA_DA_DATA" | "CONTINUA_SCADENZA";
    dataDecorrenza?: string;
    durataMesi?: number;
  },
) {
  const response = await request(app())
    .post(`/volontari/${volunteer.id}/assicurazione`)
    .send({
      versione: volunteer.versione,
      modalita: input.modalita ?? "NUOVA_DA_DATA",
      dataDecorrenza: input.dataDecorrenza,
      durataMesi: input.durataMesi ?? 12,
    });
  expect(response.status, response.text).toBe(201);
  return {
    id: volunteer.id,
    versione: response.body.versione as number,
    dataInizio: response.body.copertura.dataInizio as string,
    dataFine: response.body.copertura.dataFine as string,
  };
}

function workbook(
  rows: Array<Array<string | number>>,
  variant = "base",
): Buffer {
  const headers = [
    "N°",
    "Codice",
    "Cognome e Nome",
    "Città di Nascita",
    "Data N.",
    "Indirizzo di Residenza",
    "Cod. Fiscale",
    "Da Data",
    "A Data",
    "Cellulare",
    "Telefono",
    "Email",
    "Gruppo",
    "Categoria",
    "Tipo volontario",
    "Data servizio",
  ];
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const book = XLSX.utils.book_new();
  book.Props = { Title: `Volontari ${variant}` };
  XLSX.utils.book_append_sheet(book, sheet, "Volontari");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

async function analyze(
  buffer: Buffer,
  centroId: number | null,
  user: Partial<UserOptions> = {},
) {
  const query = centroId == null ? "" : `?centroAscoltoId=${centroId}`;
  return request(app(user))
    .post(`/volontari/import/analizza${query}`)
    .set(
      "content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    .set("x-file-name", "volontari-sintetici.xlsx")
    .send(buffer);
}

beforeEach(async () => {
  scope = newScope();
  const areaOperativaId = await createAreaOperativa(scope);
  defaultCenterId = (
    await createCentroRec(scope, {
      areaOperativaId,
      nome: unique("Centro Volontari 2"),
    })
  ).id;
  ruoloId = await createRuoloVolontario(scope, {
    nome: unique("Ruolo Volontari 2"),
  });
});

afterEach(async () => {
  await cleanup(scope);
  if (courseCatalogIds.length) {
    await db
      .delete(corsiVolontariCatalogoTable)
      .where(
        inArray(corsiVolontariCatalogoTable.id, courseCatalogIds.splice(0)),
      );
  }
  if (qualificationCatalogIds.length) {
    await db
      .delete(qualificheVolontariCatalogoTable)
      .where(
        inArray(
          qualificheVolontariCatalogoTable.id,
          qualificationCatalogIds.splice(0),
        ),
      );
  }
});

afterAll(async () => {
  await pool.end();
});

describe("Volontari 2.0 — dominio operativo e assicurazione", () => {
  it("crea permanenti e temporanei e calcola operatività, giornata e scadenza inclusiva", async () => {
    let permanent = await approve(await createVolunteer({}));
    permanent = await insure(permanent, { dataDecorrenza: "2027-01-01" });

    const inclusive = await request(app()).get(
      `/volontari/${permanent.id}?dataRiferimento=2027-12-31`,
    );
    expect(inclusive.body).toMatchObject({
      operativo: true,
      scadenzaAssicurazione: "2027-12-31",
    });
    const expired = await request(app()).get(
      `/volontari/${permanent.id}?dataRiferimento=2028-01-01`,
    );
    expect(expired.body).toMatchObject({
      operativo: false,
      motivoNonOperativo: "ASSICURAZIONE_SCADUTA",
    });

    let temporary = await approve(
      await createVolunteer({ tipo: "TEMPORANEO" }),
    );
    temporary = await insure(temporary, { dataDecorrenza: "2027-01-01" });
    const day = await request(app())
      .post(`/volontari/${temporary.id}/giornate`)
      .send({ dataServizio: "2027-05-10", stato: "PIANIFICATA" });
    expect(day.status, day.text).toBe(201);

    const onDay = await request(app()).get(
      `/volontari/${temporary.id}?dataRiferimento=2027-05-10`,
    );
    const outsideDay = await request(app()).get(
      `/volontari/${temporary.id}?dataRiferimento=2027-05-11`,
    );
    expect(onDay.body.operativo).toBe(true);
    expect(outsideDay.body).toMatchObject({
      operativo: false,
      motivoNonOperativo: "GIORNATA_TEMPORANEA_MANCANTE",
    });
  });

  it("gestisce nuova copertura, estensione calendar-aware e conflitto optimistic", async () => {
    let volunteer = await approve(await createVolunteer({}));
    volunteer = await insure(volunteer, { dataDecorrenza: "2026-02-01" });
    expect(volunteer).toMatchObject({
      dataInizio: "2026-02-01",
      dataFine: "2027-01-31",
    });
    const staleVersion = volunteer.versione;
    volunteer = await insure(volunteer, { modalita: "CONTINUA_SCADENZA" });
    expect(volunteer).toMatchObject({
      dataInizio: "2027-02-01",
      dataFine: "2028-01-31",
    });

    const conflict = await request(app())
      .post(`/volontari/${volunteer.id}/sospendi`)
      .send({
        versione: staleVersion,
        dataEffettiva: todayRome(),
        motivo: "sospensione_organizzativa",
      });
    expect(conflict.status).toBe(409);
  });

  it("storicizza sospensione e riattivazione senza confonderle con la copertura", async () => {
    let volunteer = await approve(await createVolunteer({}));
    volunteer = await insure(volunteer, { dataDecorrenza: todayRome() });
    const suspended = await request(app())
      .post(`/volontari/${volunteer.id}/sospendi`)
      .send({
        versione: volunteer.versione,
        dataEffettiva: todayRome(),
        motivo: "dimissioni_cessazione",
        note: "Caso sintetico",
      });
    expect(suspended.status, suspended.text).toBe(200);
    expect(suspended.body.stato).toMatchObject({
      operativo: false,
      motivoNonOperativo: "SOSPENSIONE_MANUALE",
    });

    const renewed = await insure(
      { id: volunteer.id, versione: suspended.body.versione },
      { modalita: "CONTINUA_SCADENZA" },
    );
    const stillSuspended = await request(app()).get(
      `/volontari/${volunteer.id}`,
    );
    expect(stillSuspended.body.motivoNonOperativo).toBe("SOSPENSIONE_MANUALE");

    const reactivated = await request(app())
      .post(`/volontari/${volunteer.id}/riattiva`)
      .send({ versione: renewed.versione, dataEffettiva: todayRome() });
    expect(reactivated.status, reactivated.text).toBe(200);
    expect(reactivated.body.stato.operativo).toBe(true);
    const dossier = await request(app()).get(
      `/volontari/${volunteer.id}/dossier`,
    );
    expect(
      dossier.body.stati.map((item: { tipoEvento: string }) => item.tipoEvento),
    ).toEqual(expect.arrayContaining(["SOSPENSIONE", "RIATTIVAZIONE"]));
  });

  it("riattiva amministrativamente ma resta non operativo con assicurazione scaduta", async () => {
    let volunteer = await approve(await createVolunteer({}));
    volunteer = await insure(volunteer, { dataDecorrenza: "2024-01-01" });
    const suspended = await request(app())
      .post(`/volontari/${volunteer.id}/sospendi`)
      .send({
        versione: volunteer.versione,
        dataEffettiva: todayRome(),
        motivo: "indisponibilita_temporanea",
      });
    const reactivated = await request(app())
      .post(`/volontari/${volunteer.id}/riattiva`)
      .send({ versione: suspended.body.versione, dataEffettiva: todayRome() });
    expect(reactivated.body.stato).toMatchObject({
      operativo: false,
      statoAssicurazione: "SCADUTA",
    });
    expect(reactivated.body.azioneSuggerita).toBe(
      "REGISTRA_RINNOVA_ASSICURAZIONE",
    );
  });

  it("rinnova in massa i recenti scaduti senza rimuovere sospensioni", async () => {
    const start = subtractCalendarMonths(todayRome(), 14);
    let first = await approve(await createVolunteer({}));
    let second = await approve(await createVolunteer({}));
    first = await insure(first, { dataDecorrenza: start });
    second = await insure(second, { dataDecorrenza: start });
    const filtered = await request(app()).get(
      "/volontari?statoAssicurazione=SCADUTA&scadutiDaMenoDiMesi=6",
    );
    expect(filtered.body.map((item: { id: number }) => item.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    const suspended = await request(app())
      .post(`/volontari/${second.id}/sospendi`)
      .send({
        versione: second.versione,
        dataEffettiva: todayRome(),
        motivo: "sospensione_organizzativa",
      });
    second.versione = suspended.body.versione;

    const preview = await request(app())
      .post("/volontari/assicurazione/massivo/preview")
      .send({
        volontarioIds: [first.id, second.id],
        modalita: "CONTINUA_SCADENZA",
        durataMesi: 12,
      });
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.items).toHaveLength(2);
    expect(
      preview.body.items.find(
        (item: { volontarioId: number }) => item.volontarioId === second.id,
      ).esitoPrevisto,
    ).toBe("RESTA_NON_OPERATIVO_SOSPESO");

    const confirmed = await request(app())
      .post("/volontari/assicurazione/massivo/conferma")
      .send({
        modalita: "CONTINUA_SCADENZA",
        durataMesi: 12,
        righe: preview.body.items,
      });
    expect(confirmed.status, confirmed.text).toBe(200);
    const firstAfter = await request(app()).get(`/volontari/${first.id}`);
    const secondAfter = await request(app()).get(`/volontari/${second.id}`);
    expect(firstAfter.body.operativo).toBe(true);
    expect(secondAfter.body.motivoNonOperativo).toBe("SOSPENSIONE_MANUALE");
  });
});

describe("Volontari 2.0 — import, registro, privacy e integrazioni", () => {
  it("analizza, crea, aggiorna e ripete lo stesso XLSX senza duplicare", async () => {
    const centroId = await createCentro(scope, unique("Centro Import"));
    const [role] = await db
      .select()
      .from(ruoliVolontariTable)
      .where(eq(ruoliVolontariTable.id, ruoloId));
    const code = unique("IMP");
    const row = [
      1,
      code,
      "Rossi Ada",
      "Roma",
      "1990-01-02",
      "Via Sintetica 1",
      "RSSDAA90A02H501Q",
      "2020-01-01",
      "2028-01-31",
      "0012345678",
      "0000123",
      "ada.import@example.test",
      "Gruppo non riconosciuto",
      `  ${role.nome.toUpperCase()}  `,
    ];
    const file = workbook([row]);
    const preview = await analyze(file, centroId);
    expect(preview.status, preview.text).toBe(201);
    expect(preview.body.righe[0]).toMatchObject({
      stato: "DA_VERIFICARE",
      ruoloPropostoId: ruoloId,
    });
    const commit = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: preview.body.importazioneId,
        righe: [
          {
            numeroRiga: 2,
            ruoloVolontarioId: ruoloId,
            centroAscoltoId: centroId,
          },
        ],
      });
    expect(commit.status, commit.text).toBe(200);
    expect(commit.body).toMatchObject({ creati: 1, errori: 0 });
    const [created] = await db
      .select()
      .from(volontariTable)
      .where(eq(volontariTable.matricola, code));
    scope.volontarioIds.push(created.id);
    expect(created).toMatchObject({
      ruoloVolontarioId: ruoloId,
      categoriaImportataOriginale: role.nome.toUpperCase(),
    });
    const historical = await request(app())
      .get(`/volontari/export/storico.xlsx?search=${code}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    const historicalBook = XLSX.read(historical.body, { type: "buffer" });
    const [historicalRow] = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      historicalBook.Sheets[historicalBook.SheetNames[0]],
      { raw: true },
    );
    expect(historicalRow["Da Data"]).toBe("2020-01-01");
    expect(historicalRow["A Data"]).toBe("2028-01-31");

    const replay = await analyze(file, centroId);
    expect(replay.status).toBe(201);
    expect(replay.body.importazioneId).not.toBe(preview.body.importazioneId);
    const replayConfirmation = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: replay.body.importazioneId,
        righe: [
          {
            numeroRiga: 2,
            ruoloVolontarioId: ruoloId,
            centroAscoltoId: centroId,
          },
        ],
      });
    expect(replayConfirmation.status, replayConfirmation.text).toBe(200);
    expect(replayConfirmation.body.replayIdempotente).toBe(true);
    expect(
      await db
        .select()
        .from(volontariTable)
        .where(eq(volontariTable.matricola, code)),
    ).toHaveLength(1);

    const changedFile = workbook([
      [...row.slice(0, 11), "ada.changed@example.test", ...row.slice(12)],
    ]);
    const updatePreview = await analyze(changedFile, centroId);
    expect(updatePreview.body.righe[0].stato).toBe("AGGIORNAMENTO_CERTO");
    const update = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: updatePreview.body.importazioneId,
        righe: [
          {
            numeroRiga: 2,
            ruoloVolontarioId: ruoloId,
            centroAscoltoId: centroId,
          },
        ],
      });
    expect(update.body.aggiornati).toBe(1);

    const dateOnlyRow = [...row];
    dateOnlyRow[7] = "2021-02-03";
    dateOnlyRow[11] = "ada.changed@example.test";
    const dateOnlyPreview = await analyze(workbook([dateOnlyRow]), centroId);
    expect(dateOnlyPreview.body.righe[0].stato).toBe("AGGIORNAMENTO_CERTO");
    const dateOnlyUpdate = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: dateOnlyPreview.body.importazioneId,
        righe: [
          {
            numeroRiga: 2,
            ruoloVolontarioId: ruoloId,
            centroAscoltoId: centroId,
          },
        ],
      });
    expect(dateOnlyUpdate.body.aggiornati).toBe(1);
  });

  it("tratta come replay due XLSX binariamente diversi ma semanticamente identici e regge conferme concorrenti", async () => {
    const centerName = unique("Centro Semantico");
    const centroId = await createCentro(scope, centerName);
    const [role] = await db
      .select()
      .from(ruoliVolontariTable)
      .where(eq(ruoliVolontariTable.id, ruoloId));
    const code = unique("SEM");
    const row = [
      1,
      code,
      "Živković Łukasz",
      "Forlì",
      "1991-03-04",
      "Via dell'Unità 7",
      "ZVKLSZ91C04D704X",
      "2021-04-01",
      "2028-12-31",
      "0011223344",
      "",
      "lukasz@example.test",
      centerName,
      role.nome,
      "Temporaneo",
      "2027-06-15",
    ];
    const firstFile = workbook([row], "prima-serializzazione");
    const secondFile = workbook([row], "seconda-serializzazione");
    expect(firstFile.equals(secondFile)).toBe(false);

    const preview = await analyze(firstFile, centroId);
    expect(preview.status, preview.text).toBe(201);
    expect(preview.body).toMatchObject({
      sha256File: preview.body.hashFile,
      hashContenutoNormalizzato: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const confirmationPayload = {
      importazioneId: preview.body.importazioneId,
      righe: [
        {
          numeroRiga: 2,
          ruoloVolontarioId: ruoloId,
          centroAscoltoId: centroId,
        },
      ],
    };
    const confirmations = await Promise.all([
      request(app())
        .post("/volontari/import/conferma")
        .send(confirmationPayload),
      request(app())
        .post("/volontari/import/conferma")
        .send(confirmationPayload),
    ]);
    expect(confirmations.map((response) => response.status)).toEqual([
      200, 200,
    ]);
    expect(
      confirmations.some((response) => response.body.replayIdempotente),
    ).toBe(true);
    const divergent = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: preview.body.importazioneId,
        righe: [{ numeroRiga: 2, inclusa: false }],
      });
    expect(divergent.status).toBe(409);
    expect(divergent.body.code).toBe(
      "IMPORT_GIA_CONFERMATO_CON_DECISIONI_DIVERSE",
    );

    const [created] = await db
      .select()
      .from(volontariTable)
      .where(eq(volontariTable.matricola, code));
    scope.volontarioIds.push(created.id);
    const beforeReplay = {
      coverages: await db
        .select()
        .from(copertureAssicurativeVolontariTable)
        .where(
          eq(copertureAssicurativeVolontariTable.volontarioId, created.id),
        ),
      days: await db
        .select()
        .from(giornateServizioVolontariTable)
        .where(eq(giornateServizioVolontariTable.volontarioId, created.id)),
      ledger: await db
        .select()
        .from(registroVolontariEventiTable)
        .where(eq(registroVolontariEventiTable.volontarioId, created.id)),
    };
    expect(beforeReplay.coverages).toHaveLength(1);
    expect(beforeReplay.days).toHaveLength(1);
    expect(beforeReplay.ledger).toHaveLength(1);
    expect(beforeReplay.ledger[0].snapshot).toMatchObject({
      volontarioId: created.id,
      matricola: code,
      nome: "Łukasz",
      cognome: "Živković",
      codiceFiscale: "ZVKLSZ91C04D704X",
      dataNascita: "1991-03-04",
      luogoNascita: "Forlì",
      indirizzoResidenza: "Via dell'Unità 7",
      tipoVolontario: "TEMPORANEO",
      centroAscoltoId: centroId,
      centroAscoltoNome: centerName,
      ruoloVolontarioId: ruoloId,
      ruoloNome: role.nome,
      dataInizio: "2021-04-01",
      dataInizioImportata: "2021-04-01",
      origine: "IMPORT_VOLONTARI_2_0",
      importazioneId: preview.body.importazioneId,
      numeroRiga: 2,
    });

    const replay = await analyze(secondFile, centroId);
    expect(replay.status, replay.text).toBe(201);
    expect(replay.body).toMatchObject({
      hashContenutoNormalizzato: preview.body.hashContenutoNormalizzato,
    });
    expect(replay.body.importazioneId).not.toBe(preview.body.importazioneId);
    expect(replay.body.sha256File).not.toBe(preview.body.sha256File);
    const replayConfirmation = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: replay.body.importazioneId,
        righe: confirmationPayload.righe,
      });
    expect(replayConfirmation.status, replayConfirmation.text).toBe(200);
    expect(replayConfirmation.body.replayIdempotente).toBe(true);
    expect(replayConfirmation.body.importazioneId).toBe(
      preview.body.importazioneId,
    );

    expect(
      await db
        .select()
        .from(copertureAssicurativeVolontariTable)
        .where(
          eq(copertureAssicurativeVolontariTable.volontarioId, created.id),
        ),
    ).toHaveLength(beforeReplay.coverages.length);
    expect(
      await db
        .select()
        .from(giornateServizioVolontariTable)
        .where(eq(giornateServizioVolontariTable.volontarioId, created.id)),
    ).toHaveLength(beforeReplay.days.length);
    expect(
      await db
        .select()
        .from(registroVolontariEventiTable)
        .where(eq(registroVolontariEventiTable.volontarioId, created.id)),
    ).toHaveLength(beforeReplay.ledger.length);
    expect(
      await db
        .select()
        .from(importazioniVolontariTable)
        .where(
          and(
            eq(
              importazioniVolontariTable.hashContenutoNormalizzato,
              preview.body.hashContenutoNormalizzato,
            ),
            eq(importazioniVolontariTable.stato, "CONFERMATO"),
          ),
        ),
    ).toHaveLength(1);
    const official = await request(app())
      .post("/volontari/registro/genera")
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .send({
        tipo: "XLSX",
        filtri: {
          dataRiferimento: "2028-12-31",
          stato: "tutti",
          tipo: "TEMPORANEO",
          search: code,
          centroAscoltoId: centroId,
        },
      });
    expect(official.status, official.text).toBe(200);
    const officialBook = XLSX.read(official.body, { type: "buffer" });
    const [officialRow] = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      officialBook.Sheets[officialBook.SheetNames[0]],
      { raw: true },
    );
    expect(officialRow).toMatchObject({
      Matricola: code,
      Domicilio: "Via dell'Unità 7",
      "Data inizio attività/iscrizione": "2021-04-01",
      "Da Data importata": "2021-04-01",
      "Scadenza assicurazione": "2028-12-31",
      "Date servizio temporaneo": "2027-06-15",
      "Intervallo servizio temporaneo": "2027-06-15 – 2027-06-15",
    });
  });

  it("considera equivalenti file con righe riordinate solo a parità di mapping finale", async () => {
    const centerName = unique("Centro Righe Riordinate");
    const centroId = await createCentro(scope, centerName);
    const [role] = await db
      .select()
      .from(ruoliVolontariTable)
      .where(eq(ruoliVolontariTable.id, ruoloId));
    const codeA = unique("ORDER-A");
    const codeB = unique("ORDER-B");
    const rowA = [
      1,
      codeA,
      "Alfa Ada",
      "Roma",
      "1990-01-02",
      "Via Alfa 1",
      "",
      "2020-01-01",
      "",
      "",
      "",
      "",
      centerName,
      role.nome,
      "Permanente",
      "",
    ];
    const rowB = [
      2,
      codeB,
      "Beta Bea",
      "Milano",
      "1991-02-03",
      "Via Beta 2",
      "",
      "2020-02-01",
      "",
      "",
      "",
      "",
      centerName,
      role.nome,
      "Permanente",
      "",
    ];
    const first = await analyze(workbook([rowA, rowB], "ordine-a-b"), centroId);
    const second = await analyze(
      workbook([rowB, rowA], "ordine-b-a"),
      centroId,
    );
    expect(first.status, first.text).toBe(201);
    expect(second.status, second.text).toBe(201);
    expect(first.body.righe, JSON.stringify(first.body.righe)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stato: "NUOVO", errori: [] }),
        expect.objectContaining({ stato: "NUOVO", errori: [] }),
      ]),
    );
    expect(first.body.hashContenutoNormalizzato).toBe(
      second.body.hashContenutoNormalizzato,
    );
    scope.importazioneVolontariIds.push(
      first.body.importazioneId,
      second.body.importazioneId,
    );
    const decisions = [2, 3].map((numeroRiga) => ({
      numeroRiga,
      ruoloVolontarioId: ruoloId,
      centroAscoltoId: centroId,
    }));
    const confirmed = await request(app())
      .post("/volontari/import/conferma")
      .send({ importazioneId: first.body.importazioneId, righe: decisions });
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(confirmed.body.creati).toBe(2);
    const replay = await request(app())
      .post("/volontari/import/conferma")
      .send({ importazioneId: second.body.importazioneId, righe: decisions });
    expect(replay.status, replay.text).toBe(200);
    expect(replay.body.replayIdempotente).toBe(true);
    const created = await db
      .select({ id: volontariTable.id })
      .from(volontariTable)
      .where(inArray(volontariTable.matricola, [codeA, codeB]));
    scope.volontarioIds.push(...created.map((item) => item.id));
  });

  it("blocca la conferma se il candidato cambia dopo la preview", async () => {
    const centroId = await createCentro(
      scope,
      unique("Centro Concorrenza Import"),
    );
    const existing = await createVolunteer({
      centroAscoltoId: centroId,
      email: "prima@example.test",
    });
    const [role] = await db
      .select()
      .from(ruoliVolontariTable)
      .where(eq(ruoliVolontariTable.id, ruoloId));
    const file = workbook([
      [
        1,
        existing.matricola,
        "Sintetica Ada",
        "Roma",
        "1990-01-02",
        "Via Sintetica 1",
        "",
        todayRome(),
        "",
        "",
        "",
        "prima@example.test",
        "",
        role.nome,
        "Permanente",
        "",
      ],
    ]);
    const preview = await analyze(file, centroId);
    expect(preview.status, preview.text).toBe(201);
    expect(
      preview.body.righe[0],
      JSON.stringify(preview.body.righe[0]),
    ).toMatchObject({
      stato: "AGGIORNAMENTO_CERTO",
      errori: [],
    });
    scope.importazioneVolontariIds.push(preview.body.importazioneId);
    expect(preview.body.righe[0].volontarioCandidatoId).toBe(existing.id);

    const manualUpdate = await request(app())
      .patch(`/volontari/${existing.id}`)
      .send({ versione: existing.versione, email: "modificata@example.test" });
    expect(manualUpdate.status, manualUpdate.text).toBe(200);
    const confirmation = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: preview.body.importazioneId,
        righe: [
          {
            numeroRiga: 2,
            ruoloVolontarioId: ruoloId,
            centroAscoltoId: centroId,
          },
        ],
      });
    expect(confirmation.status, confirmation.text).toBe(200);
    expect(confirmation.body).toMatchObject({ stato: "PARZIALE", errori: 1 });
    const [storedRow] = await db
      .select()
      .from(importazioniVolontariRigheTable)
      .where(
        eq(
          importazioniVolontariRigheTable.importazioneId,
          preview.body.importazioneId,
        ),
      );
    expect(storedRow.esitoCommit).toBe("CONFLITTO_DATI_MODIFICATI");
    const unchanged = await request(app()).get(`/volontari/${existing.id}`);
    expect(unchanged.body.email).toBe("modificata@example.test");
  });

  it("espone conflitti semantici per coperture e giornate manuali preesistenti", async () => {
    const centerName = unique("Centro Conflitti Import");
    const centroId = await createCentro(scope, centerName);
    const existing = await createVolunteer({
      tipo: "TEMPORANEO",
      centroAscoltoId: centroId,
    });
    const [role] = await db
      .select()
      .from(ruoliVolontariTable)
      .where(eq(ruoliVolontariTable.id, ruoloId));
    await db.insert(copertureAssicurativeVolontariTable).values({
      volontarioId: existing.id,
      dataInizio: "2027-01-01",
      dataFine: "2028-01-31",
      tipoOperazione: "NUOVA_COPERTURA",
    });
    await db.insert(giornateServizioVolontariTable).values({
      volontarioId: existing.id,
      dataServizio: "2027-06-15",
      centroAscoltoId: centroId,
      stato: "PRESENTE",
      note: "Giornata inserita manualmente",
    });
    const row = (coverageEnd: string) => [
      1,
      existing.matricola,
      "Sintetica Ada",
      "Roma",
      "1990-01-02",
      "Via Sintetica 1",
      "",
      todayRome(),
      coverageEnd,
      "",
      "",
      "",
      centerName,
      role.nome,
      "Temporaneo",
      "2027-06-15",
    ];
    const coveragePreview = await analyze(
      workbook([row("2028-01-31")], "conflitto-copertura"),
      centroId,
    );
    expect(coveragePreview.status, coveragePreview.text).toBe(201);
    expect(
      coveragePreview.body.righe[0],
      JSON.stringify(coveragePreview.body.righe[0]),
    ).toMatchObject({ stato: "AGGIORNAMENTO_CERTO", errori: [] });
    scope.importazioneVolontariIds.push(coveragePreview.body.importazioneId);
    const coverageResult = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: coveragePreview.body.importazioneId,
        righe: [
          {
            numeroRiga: 2,
            ruoloVolontarioId: ruoloId,
            centroAscoltoId: centroId,
          },
        ],
      });
    expect(coverageResult.body).toMatchObject({ stato: "PARZIALE", errori: 1 });
    const [coverageRow] = await db
      .select()
      .from(importazioniVolontariRigheTable)
      .where(
        eq(
          importazioniVolontariRigheTable.importazioneId,
          coveragePreview.body.importazioneId,
        ),
      );
    expect(coverageRow.esitoCommit).toBe("CONFLITTO_COPERTURA_ESISTENTE");

    const servicePreview = await analyze(
      workbook([row("")], "conflitto-giornata"),
      centroId,
    );
    expect(servicePreview.status, servicePreview.text).toBe(201);
    expect(
      servicePreview.body.righe[0],
      JSON.stringify(servicePreview.body.righe[0]),
    ).toMatchObject({ stato: "AGGIORNAMENTO_CERTO", errori: [] });
    scope.importazioneVolontariIds.push(servicePreview.body.importazioneId);
    const serviceResult = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: servicePreview.body.importazioneId,
        righe: [
          {
            numeroRiga: 2,
            ruoloVolontarioId: ruoloId,
            centroAscoltoId: centroId,
          },
        ],
      });
    expect(serviceResult.body).toMatchObject({ stato: "PARZIALE", errori: 1 });
    const [serviceRow] = await db
      .select()
      .from(importazioniVolontariRigheTable)
      .where(
        eq(
          importazioniVolontariRigheTable.importazioneId,
          servicePreview.body.importazioneId,
        ),
      );
    expect(serviceRow.esitoCommit).toBe("CONFLITTO_GIORNATA_ESISTENTE");
  });

  it("classifica email/telefono come possibile duplicato e non effettua merge automatici", async () => {
    const centroId = await createCentro(scope, unique("Centro Duplicati"));
    const existing = await createVolunteer({
      centroAscoltoId: centroId,
      email: "match@example.test",
    });
    const [role] = await db
      .select()
      .from(ruoliVolontariTable)
      .where(eq(ruoliVolontariTable.id, ruoloId));
    const file = workbook([
      [
        1,
        unique("CAND"),
        "Bianchi Beatrice",
        "Milano",
        "1985-02-03",
        "Via Test 2",
        "",
        "2020-01-01",
        "2028-01-31",
        "",
        "",
        "match@example.test",
        "",
        role.nome,
      ],
    ]);
    const preview = await analyze(file, centroId);
    expect(preview.body.righe[0]).toMatchObject({
      stato: "POSSIBILE_DUPLICATO",
      volontarioCandidatoId: existing.id,
    });
    const commit = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: preview.body.importazioneId,
        righe: [{ numeroRiga: 2, ruoloVolontarioId: ruoloId }],
      });
    expect(commit.body).toMatchObject({ creati: 0, aggiornati: 0, errori: 1 });
    const unchanged = await request(app()).get(`/volontari/${existing.id}`);
    expect(unchanged.body.email).toBe("match@example.test");
  });

  it("rifiuta duplicati fiscali, maschera la lista e mantiene il dettaglio autorizzato", async () => {
    const invalidLength = await request(app())
      .post("/volontari")
      .send({
        nome: "Ada",
        cognome: "TroppoLunga",
        matricola: "X".repeat(41),
        ruoloVolontarioId: ruoloId,
      });
    expect(invalidLength.status).toBe(422);
    expect(invalidLength.body.fieldErrors.matricola).toMatch(
      /generata automaticamente/i,
    );

    const first = await createVolunteer({
      codiceFiscale: "RSS MRA 80A01 H501 U",
      telefono: "0012345",
      email: "privacy@example.test",
      nome: "Èlia",
      cognome: "Dvořák",
      luogoNascita: "Forlì",
      dataNascita: "1980-01-01",
      indirizzoResidenza: "Via dell'Unità 3",
    });
    const duplicate = await request(app()).post("/volontari").send({
      nome: "Altro",
      cognome: "Sintetico",
      ruoloVolontarioId: ruoloId,
      centroAscoltoId: defaultCenterId,
      codiceFiscale: "RSSMRA80A01H501U",
      luogoNascita: "Roma",
      dataNascita: "1982-02-02",
      indirizzoResidenza: "Via Duplicato 2",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.fieldErrors.codiceFiscale).toMatch(/già associato/i);

    const list = await request(app()).get(
      `/volontari?search=${first.matricola}`,
    );
    expect(list.body[0]).toMatchObject({
      codiceFiscale: null,
      telefono: null,
      email: null,
    });
    const detail = await request(app()).get(`/volontari/${first.id}`);
    expect(detail.body).toMatchObject({
      codiceFiscale: "RSSMRA80A01H501U",
      telefono: "0012345",
      email: "privacy@example.test",
    });
    const fullLedger = await request(app()).get("/volontari/registro/eventi");
    const fullRegistration = fullLedger.body.find(
      (event: { volontarioId: number; tipoEvento: string }) =>
        event.volontarioId === first.id && event.tipoEvento === "REGISTRAZIONE",
    );
    expect(fullRegistration.snapshot).toMatchObject({
      volontarioId: first.id,
      matricola: first.matricola,
      nome: "Èlia",
      cognome: "Dvořák",
      codiceFiscale: "RSSMRA80A01H501U",
      dataNascita: "1980-01-01",
      luogoNascita: "Forlì",
      indirizzoResidenza: "Via dell'Unità 3",
      tipoVolontario: "PERMANENTE",
      ruoloVolontarioId: ruoloId,
      ruoloNome: expect.any(String),
      statoApprovazione: "in_attesa",
      origine: "MANUALE",
      importazioneId: null,
      numeroRiga: null,
    });
    const viewOnlyLedger = await request(
      app({
        permessi: ["logistica.volontari.view"],
        isAdmin: false,
        isSuperAdmin: false,
      }),
    ).get("/volontari/registro/eventi");
    const sanitizedRegistration = viewOnlyLedger.body.find(
      (event: { volontarioId: number; tipoEvento: string }) =>
        event.volontarioId === first.id && event.tipoEvento === "REGISTRAZIONE",
    );
    expect(sanitizedRegistration.snapshot).toMatchObject({
      volontarioId: first.id,
      tipoVolontario: "PERMANENTE",
      statoApprovazione: "in_attesa",
      origine: "MANUALE",
    });
    expect(sanitizedRegistration.snapshot).not.toHaveProperty("nome");
    expect(sanitizedRegistration.snapshot).not.toHaveProperty("cognome");
    expect(sanitizedRegistration.snapshot).not.toHaveProperty("codiceFiscale");
    expect(sanitizedRegistration.snapshot).not.toHaveProperty(
      "indirizzoResidenza",
    );
  });

  it("produce XLSX storico string-safe e un registro ufficiale esattamente riproducibile", async () => {
    const centroId = await createCentro(scope, unique("Centro Registro"));
    const createdVolunteer = await createVolunteer({
      centroAscoltoId: centroId,
      telefono: "0012345678",
      nome: "Łukasz",
      cognome: "Živković",
      codiceFiscale: "ZVKLSZ91C04D704X",
      luogoNascita: "Forlì",
      dataNascita: "1991-03-04",
      indirizzoResidenza: "Via dell'Unità 7",
    });
    const volunteer = {
      ...createdVolunteer,
      ...(await insure(await approve(createdVolunteer), {
        dataDecorrenza: todayRome(),
      })),
    };
    const suspension = await request(app())
      .post(`/volontari/${volunteer.id}/sospendi`)
      .send({
        versione: volunteer.versione,
        dataEffettiva: todayRome(),
        motivo: "dimissioni_cessazione",
      });
    expect(suspension.status, suspension.text).toBe(200);
    const historical = await request(app())
      .get(`/volontari/export/storico.xlsx?search=${volunteer.matricola}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(historical.status, historical.text).toBe(200);
    const historicalBook = XLSX.read(historical.body, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      historicalBook.Sheets[historicalBook.SheetNames[0]],
      { raw: true },
    );
    expect(rows[0].Codice).toBe(volunteer.matricola);
    expect(rows[0].Cellulare).toBe("0012345678");
    expect(rows[0]["Da Data"] ?? "").toBe("");
    expect(rows[0]["A Data"]).toBe(volunteer.dataFine);

    const emission = await request(app())
      .post("/volontari/registro/genera")
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .send({
        tipo: "XLSX",
        filtri: {
          dataRiferimento: todayRome(),
          stato: "tutti",
          tipo: "TUTTI",
          search: volunteer.matricola,
          centroAscoltoId: centroId,
        },
      });
    expect(emission.status, emission.text).toBe(200);
    const emissionId = Number(emission.headers["x-registro-emissione-id"]);
    expect(emission.headers["x-registro-sha256"]).toMatch(/^[0-9a-f]{64}$/);
    const officialBook = XLSX.read(emission.body, { type: "buffer" });
    const officialSheet = officialBook.Sheets[officialBook.SheetNames[0]];
    const officialMatrix = XLSX.utils.sheet_to_json<unknown[]>(officialSheet, {
      header: 1,
      raw: true,
    });
    expect(officialMatrix[0]).toEqual(
      expect.arrayContaining([
        "Progressivo",
        "Matricola",
        "Domicilio",
        "Data cessazione",
        "Date servizio temporaneo",
        "Riferimento iscrizione",
      ]),
    );
    const [officialRow] = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      officialSheet,
      { raw: true },
    );
    expect(officialRow).toMatchObject({
      Matricola: volunteer.matricola,
      Cognome: "Živković",
      Nome: "Łukasz",
      "Codice fiscale": "ZVKLSZ91C04D704X",
      "Data di nascita": "1991-03-04",
      "Luogo di nascita": "Forlì",
      Residenza: "Via dell'Unità 7",
      "Data inizio attività/iscrizione": todayRome(),
      "Data cessazione": todayRome(),
      "Stato alla data di riferimento": "CESSATO",
      "Scadenza assicurazione": volunteer.dataFine,
      "Data di riferimento": todayRome(),
    });
    expect(officialRow["Da Data importata"] ?? "").toBe("");
    const [storedEmission] = await db
      .select()
      .from(emissioniRegistroVolontariTable)
      .where(eq(emissioniRegistroVolontariTable.id, emissionId));
    expect(storedEmission).toMatchObject({
      versioneLayout: "VOLONTARI_REGISTRO_UFFICIALE_V2",
      numeroRighe: 1,
    });
    expect(storedEmission.snapshot[0]).toMatchObject(officialRow);
    const reproduced = await request(app())
      .get(`/volontari/registro/emissioni/${emissionId}/file`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(Buffer.compare(emission.body, reproduced.body)).toBe(0);

    const pdfInput = {
      tipo: "PDF",
      filtri: {
        dataRiferimento: todayRome(),
        stato: "tutti",
        tipo: "TUTTI",
        search: volunteer.matricola,
        centroAscoltoId: centroId,
      },
    };
    const pdfResponses = await Promise.all(
      [0, 1].map(() =>
        request(app())
          .post("/volontari/registro/genera")
          .buffer(true)
          .parse((response, callback) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            response.on("end", () => callback(null, Buffer.concat(chunks)));
          })
          .send(pdfInput),
      ),
    );
    expect(pdfResponses.map((response) => response.status)).toEqual([200, 200]);
    expect(pdfResponses[0].body.equals(pdfResponses[1].body)).toBe(true);
    const pdfText = pdfResponses[0].body.toString("latin1");
    expect(pdfText).toContain("/ToUnicode");
    expect(pdfText).toContain("beginbfchar");
    expect(pdfText.slice(pdfText.indexOf("beginbfchar"))).toMatch(
      /<[0-9a-f]{4}><0141>/i,
    );
    expect(pdfText).not.toContain("?ukasz");

    const events = await request(app()).get("/volontari/registro/eventi");
    const original = events.body.find(
      (item: { volontarioId: number }) => item.volontarioId === volunteer.id,
    );
    const arbitraryCorrection = await request(app())
      .post(`/volontari/registro/eventi/${original.id}/rettifica`)
      .send({
        motivo: "Payload arbitrario non ammesso",
        snapshot: { indirizzoResidenza: "Valore non validato" },
      });
    expect(arbitraryCorrection.status).toBe(400);
    const stalePreviousValue = await request(app())
      .post(`/volontari/registro/eventi/${original.id}/rettifica`)
      .send({
        motivo: "Valore precedente errato",
        rettifiche: [
          {
            campo: "indirizzoResidenza",
            valorePrecedente: "Valore diverso",
            nuovoValore: "Via domicilio rettificata 9",
          },
        ],
      });
    expect(stalePreviousValue.status).toBe(409);
    const correction = await request(app())
      .post(`/volontari/registro/eventi/${original.id}/rettifica`)
      .send({
        motivo: "Rettifica sintetica",
        dataEffettiva: todayRome(),
        rettifiche: [
          {
            campo: "indirizzoDomicilio",
            valorePrecedente: null,
            nuovoValore: "Via domicilio rettificata 9",
          },
        ],
      });
    expect(correction.status, correction.text).toBe(201);
    expect(correction.body).toMatchObject({
      tipoEvento: "RETTIFICA",
      eventoRettificatoId: original.id,
    });
    expect(
      (await request(app()).get("/volontari/registro/verifica-integrita"))
        .status,
    ).toBe(403);
    const integrity = await request(app({ isSuperAdmin: true })).get(
      "/volontari/registro/verifica-integrita",
    );
    expect(integrity.status, integrity.text).toBe(200);
    expect(integrity.body.valid).toBe(true);
    const ledger = await db
      .select()
      .from(registroVolontariEventiTable)
      .where(eq(registroVolontariEventiTable.volontarioId, volunteer.id))
      .orderBy(asc(registroVolontariEventiTable.progressivo));
    expect(ledger.length).toBeGreaterThanOrEqual(3);
    for (const event of ledger) {
      expect(event.hashEvento).toBe(
        canonicalLedgerEventHash({
          sezione: event.sezione as "PERMANENTE" | "TEMPORANEO",
          tipoEvento: event.tipoEvento as
            | "REGISTRAZIONE"
            | "SOSPENSIONE_CESSAZIONE"
            | "RIATTIVAZIONE"
            | "GIORNATA_TEMPORANEA"
            | "RETTIFICA",
          volontarioId: event.volontarioId,
          centroAscoltoId: event.centroAscoltoId,
          dataEffettiva: event.dataEffettiva,
          snapshot: event.snapshot,
          utenteId: event.utenteId,
          eventoRettificatoId: event.eventoRettificatoId,
          progressivo: event.progressivo,
          hashPrecedente: event.hashPrecedente,
        }),
      );
    }
    await expect(
      db
        .update(registroVolontariEventiTable)
        .set({ snapshot: { alterato: true } })
        .where(eq(registroVolontariEventiTable.id, original.id)),
    ).rejects.toThrow();
    await expect(
      db
        .delete(registroVolontariEventiTable)
        .where(eq(registroVolontariEventiTable.id, original.id)),
    ).rejects.toThrow();
  });

  it("rispetta scope, permessi e blocca una consegna a un volontario non operativo", async () => {
    const centerA = await createCentro(scope, unique("Centro A"));
    const centerB = await createCentro(scope, unique("Centro B"));
    const volunteer = await createVolunteer({ centroAscoltoId: centerA });
    const forbidden = await request(app({ centroAscoltoId: centerB })).get(
      `/volontari/${volunteer.id}`,
    );
    expect(forbidden.status).toBe(403);
    const denied = await request(
      app({ permessi: [], isAdmin: false, isSuperAdmin: false }),
    ).get("/volontari");
    expect(denied.status).toBe(403);

    const beneficiaryId = await createBeneficiario(scope, centerA);
    const warehouseId = await createMagazzino(scope, centerA);
    const delivery = await request(app({ centroAscoltoId: centerA }))
      .post("/consegne")
      .send({
        beneficiarioId: beneficiaryId,
        tipoConsegna: "domicilio",
        dataPrevista: addCalendarDays(todayRome(), 1),
        fasciaOraria: "Mattina",
        indirizzoConsegna: "Via Sintetica 1",
        magazzinoId: warehouseId,
        volontarioId: volunteer.id,
      });
    expect(delivery.status).toBe(403);
    expect(delivery.body.error).toMatch(/non operativo/i);
  });

  it("isola emissioni, ledger e batch import tra Centro, Area e scope globale", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const centerA = (
      await createCentroRec(scope, {
        areaOperativaId: areaA,
        nome: unique("Centro Scope A"),
      })
    ).id;
    const centerB = (
      await createCentroRec(scope, {
        areaOperativaId: areaB,
        nome: unique("Centro Scope B"),
      })
    ).id;
    const volunteerA = await createVolunteer({ centroAscoltoId: centerA });
    const volunteerB = await createVolunteer({ centroAscoltoId: centerB });

    const areaEmission = await request(app({ areaOperativaId: areaA }))
      .post("/volontari/registro/genera")
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .send({
        tipo: "XLSX",
        filtri: { dataRiferimento: todayRome(), stato: "tutti", tipo: "TUTTI" },
      });
    expect(areaEmission.status, areaEmission.text).toBe(200);
    const areaEmissionId = Number(
      areaEmission.headers["x-registro-emissione-id"],
    );
    scope.emissioneRegistroIds.push(areaEmissionId);

    const areaAList = await request(app({ areaOperativaId: areaA })).get(
      "/volontari/registro/emissioni",
    );
    const areaBList = await request(app({ areaOperativaId: areaB })).get(
      "/volontari/registro/emissioni",
    );
    expect(areaAList.body.map((item: { id: number }) => item.id)).toContain(
      areaEmissionId,
    );
    expect(areaBList.body.map((item: { id: number }) => item.id)).not.toContain(
      areaEmissionId,
    );
    expect(
      (
        await request(
          app({ centroAscoltoId: centerA, areaOperativaId: areaA }),
        ).get(`/volontari/registro/emissioni/${areaEmissionId}/file`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app({ areaOperativaId: areaB })).get(
          `/volontari/registro/emissioni/${areaEmissionId}/file`,
        )
      ).status,
    ).toBe(403);

    const globalEmission = await request(app({ isSuperAdmin: true }))
      .post("/volontari/registro/genera")
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .send({
        tipo: "XLSX",
        filtri: { dataRiferimento: todayRome(), stato: "tutti", tipo: "TUTTI" },
      });
    expect(globalEmission.status, globalEmission.text).toBe(200);
    const globalEmissionId = Number(
      globalEmission.headers["x-registro-emissione-id"],
    );
    scope.emissioneRegistroIds.push(globalEmissionId);
    expect(
      (
        await request(app({ areaOperativaId: areaA })).get(
          `/volontari/registro/emissioni/${globalEmissionId}/file`,
        )
      ).status,
    ).toBe(403);

    const centerAEventsBefore = await request(
      app({ centroAscoltoId: centerA, areaOperativaId: areaA }),
    ).get("/volontari/registro/eventi");
    const registrationA = centerAEventsBefore.body.find(
      (item: { volontarioId: number; tipoEvento: string }) =>
        item.volontarioId === volunteerA.id &&
        item.tipoEvento === "REGISTRAZIONE",
    );
    expect(registrationA).toBeTruthy();
    await db.transaction(async (tx) => {
      for (let index = 0; index < 505; index += 1) {
        await appendVolontarioLedgerEvent(tx, {
          sezione: "PERMANENTE",
          tipoEvento: "AGGIORNAMENTO_ANAGRAFICA",
          volontarioId: volunteerB.id,
          centroAscoltoId: centerB,
          dataEffettiva: todayRome(),
          snapshot: {
            volontarioId: volunteerB.id,
            sequenzaTestScope: index,
          },
          utenteId: null,
        });
      }
    });
    const centerAEventsAfter = await request(
      app({ centroAscoltoId: centerA, areaOperativaId: areaA }),
    ).get("/volontari/registro/eventi");
    expect(centerAEventsAfter.body).toHaveLength(1);
    expect(centerAEventsAfter.body[0].id).toBe(registrationA.id);

    const [role] = await db
      .select()
      .from(ruoliVolontariTable)
      .where(eq(ruoliVolontariTable.id, ruoloId));
    const importFile = workbook([
      [
        1,
        unique("SCOPE-IMP"),
        "Scope Ada",
        "Roma",
        "1990-01-02",
        "Via Scope 1",
        "",
        "2020-01-01",
        "2028-01-31",
        "",
        "",
        "",
        (
          await db
            .select({ nome: centriAscoltoTable.nome })
            .from(centriAscoltoTable)
            .where(eq(centriAscoltoTable.id, centerA))
        )[0].nome,
        role.nome,
        "Permanente",
        "",
      ],
    ]);
    const areaBatchA = await analyze(importFile, null, {
      areaOperativaId: areaA,
    });
    expect(areaBatchA.status, areaBatchA.text).toBe(201);
    expect(areaBatchA.body.scopeTipo).toBe("AREA");
    scope.importazioneVolontariIds.push(areaBatchA.body.importazioneId);
    expect(
      (
        await request(app({ areaOperativaId: areaB }))
          .post("/volontari/import/conferma")
          .send({ importazioneId: areaBatchA.body.importazioneId, righe: [] })
      ).status,
    ).toBe(403);

    const areaBatchB = await analyze(importFile, null, {
      areaOperativaId: areaB,
    });
    expect(areaBatchB.status, areaBatchB.text).toBe(201);
    scope.importazioneVolontariIds.push(areaBatchB.body.importazioneId);
    expect(areaBatchB.body.hashContenutoNormalizzato).toBe(
      areaBatchA.body.hashContenutoNormalizzato,
    );
    expect(areaBatchB.body.scopeFingerprint).not.toBe(
      areaBatchA.body.scopeFingerprint,
    );

    const globalBatch = await analyze(importFile, null, { isSuperAdmin: true });
    expect(globalBatch.status, globalBatch.text).toBe(201);
    expect(globalBatch.body.scopeTipo).toBe("GLOBALE");
    scope.importazioneVolontariIds.push(globalBatch.body.importazioneId);
    expect(
      (
        await request(app({ centroAscoltoId: centerA, areaOperativaId: areaA }))
          .post("/volontari/import/conferma")
          .send({ importazioneId: globalBatch.body.importazioneId, righe: [] })
      ).status,
    ).toBe(403);
  });

  it("ricostruisce anagrafica, rettifiche e intervalli alla data senza rinumerare", async () => {
    const centerId = defaultCenterId;
    const volunteer = await createVolunteer({
      centroAscoltoId: centerId,
      indirizzoResidenza: "Via Storica A 1",
    });
    const [registration] = await db
      .select()
      .from(registroVolontariEventiTable)
      .where(
        and(
          eq(registroVolontariEventiTable.volontarioId, volunteer.id),
          eq(registroVolontariEventiTable.tipoEvento, "REGISTRAZIONE"),
        ),
      );
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(volontariTable)
        .set({
          indirizzoResidenza: "Via Storica B 2",
          versione: 2,
          dataAggiornamento: new Date(),
        })
        .where(eq(volontariTable.id, volunteer.id))
        .returning();
      await appendVolontarioLedgerEvent(tx, {
        sezione: "PERMANENTE",
        tipoEvento: "AGGIORNAMENTO_ANAGRAFICA",
        volontarioId: volunteer.id,
        centroAscoltoId: centerId,
        dataEffettiva: "2027-01-10",
        snapshot: await buildVolunteerEventSnapshot(tx, updated, {
          statoPrecedente: "PERMANENTE",
          nuovoStato: "PERMANENTE",
          motivo: "aggiornamento_anagrafica_test",
          dataEffettiva: "2027-01-10",
          datiEvento: { campiModificati: ["indirizzoResidenza"] },
        }),
      });
      await appendVolontarioLedgerEvent(tx, {
        sezione: "PERMANENTE",
        tipoEvento: "RETTIFICA",
        volontarioId: volunteer.id,
        centroAscoltoId: centerId,
        dataEffettiva: "2027-06-10",
        snapshot: await buildVolunteerEventSnapshot(tx, updated, {
          statoPrecedente: "PERMANENTE",
          nuovoStato: "RETTIFICATO",
          motivo: "rettifica_test",
          dataEffettiva: "2027-06-10",
          riferimentoEventoId: registration.id,
          datiEvento: {
            rettifiche: [
              {
                campo: "indirizzoResidenza",
                valorePrecedente: "Via Storica B 2",
                nuovoValore: "Via Storica C 3",
              },
            ],
          },
        }),
        eventoRettificatoId: registration.id,
      });
      await appendVolontarioLedgerEvent(tx, {
        sezione: "PERMANENTE",
        tipoEvento: "SOSPENSIONE_CESSAZIONE",
        volontarioId: volunteer.id,
        centroAscoltoId: centerId,
        dataEffettiva: "2027-08-01",
        snapshot: await buildVolunteerEventSnapshot(tx, updated, {
          statoPrecedente: "ATTIVO",
          nuovoStato: "CESSATO",
          motivo: "dimissioni_cessazione",
          dataEffettiva: "2027-08-01",
        }),
      });
      await appendVolontarioLedgerEvent(tx, {
        sezione: "PERMANENTE",
        tipoEvento: "RIATTIVAZIONE",
        volontarioId: volunteer.id,
        centroAscoltoId: centerId,
        dataEffettiva: "2027-09-01",
        snapshot: await buildVolunteerEventSnapshot(tx, updated, {
          statoPrecedente: "CESSATO",
          nuovoStato: "ATTIVO",
          motivo: "riattivazione_test",
          dataEffettiva: "2027-09-01",
        }),
      });
    });

    const officialAt = async (reference: string) => {
      const response = await request(app())
        .post("/volontari/registro/genera")
        .buffer(true)
        .parse((raw, callback) => {
          const chunks: Buffer[] = [];
          raw.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          raw.on("end", () => callback(null, Buffer.concat(chunks)));
        })
        .send({
          tipo: "XLSX",
          filtri: {
            dataRiferimento: reference,
            stato: "tutti",
            tipo: "TUTTI",
            search: volunteer.matricola,
            centroAscoltoId: centerId,
          },
        });
      expect(response.status, response.text).toBe(200);
      scope.emissioneRegistroIds.push(
        Number(response.headers["x-registro-emissione-id"]),
      );
      const book = XLSX.read(response.body, { type: "buffer" });
      return XLSX.utils.sheet_to_json<Record<string, unknown>>(
        book.Sheets[book.SheetNames[0]],
        { raw: true },
      )[0];
    };

    const beforeUpdate = await officialAt("2026-12-31");
    const afterUpdate = await officialAt("2027-03-01");
    const afterCorrection = await officialAt("2027-07-01");
    const ceased = await officialAt("2027-08-15");
    const reactivated = await officialAt("2027-10-01");
    expect(beforeUpdate.Residenza).toBe("Via Storica A 1");
    expect(afterUpdate.Residenza).toBe("Via Storica B 2");
    expect(afterCorrection.Residenza).toBe("Via Storica C 3");
    expect(ceased).toMatchObject({
      "Stato alla data di riferimento": "CESSATO",
      "Data cessazione": "2027-08-01",
    });
    expect(reactivated["Stato alla data di riferimento"]).toBe("ATTIVO");
    expect(reactivated["Data cessazione"] ?? "").toBe("");
    expect(beforeUpdate.Progressivo).toBe(afterCorrection.Progressivo);

    const [current] = await db
      .select()
      .from(volontariTable)
      .where(eq(volontariTable.id, volunteer.id));
    const [future] = await db
      .insert(volontariTable)
      .values({
        nome: "Iscrizione",
        cognome: "Futura",
        matricola: unique("FUTURE"),
        tipoVolontario: "PERMANENTE",
        ruoloVolontarioId: ruoloId,
        ruolo: current.ruolo,
        centroAscoltoId: centerId,
        luogoNascita: "Roma",
        dataNascita: "1992-02-02",
        indirizzoResidenza: "Via Futura 1",
        codiceFiscaleNonDisponibile: true,
        codiceFiscaleNota: "Non disponibile nel test",
        dataIscrizione: "2027-12-31",
      })
      .returning();
    scope.volontarioIds.push(future.id);
    const futureResponse = await request(app())
      .post("/volontari/registro/genera")
      .buffer(true)
      .parse((raw, callback) => {
        const chunks: Buffer[] = [];
        raw.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        raw.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .send({
        tipo: "XLSX",
        filtri: {
          dataRiferimento: "2027-01-01",
          stato: "tutti",
          tipo: "TUTTI",
          search: future.matricola,
          centroAscoltoId: centerId,
        },
      });
    expect(futureResponse.status, futureResponse.text).toBe(200);
    scope.emissioneRegistroIds.push(
      Number(futureResponse.headers["x-registro-emissione-id"]),
    );
    const futureBook = XLSX.read(futureResponse.body, { type: "buffer" });
    expect(
      XLSX.utils.sheet_to_json(futureBook.Sheets[futureBook.SheetNames[0]], {
        raw: true,
      }),
    ).toHaveLength(0);

    const pdf = await request(app())
      .post("/volontari/registro/genera")
      .buffer(true)
      .parse((raw, callback) => {
        const chunks: Buffer[] = [];
        raw.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        raw.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .send({
        tipo: "PDF",
        filtri: {
          dataRiferimento: "2027-10-01",
          stato: "tutti",
          tipo: "TUTTI",
          search: volunteer.matricola,
          centroAscoltoId: centerId,
        },
      });
    expect(pdf.status, pdf.text).toBe(200);
    const pdfEmissionId = Number(pdf.headers["x-registro-emissione-id"]);
    scope.emissioneRegistroIds.push(pdfEmissionId);
    const [xlsxEmission, pdfEmission] = await Promise.all([
      db
        .select()
        .from(emissioniRegistroVolontariTable)
        .where(
          eq(
            emissioniRegistroVolontariTable.id,
            scope.emissioneRegistroIds.at(-3)!,
          ),
        ),
      db
        .select()
        .from(emissioniRegistroVolontariTable)
        .where(eq(emissioniRegistroVolontariTable.id, pdfEmissionId)),
    ]);
    expect(pdfEmission[0].snapshot).toEqual(xlsxEmission[0].snapshot);
  });

  it("limita le giornate temporanee per intervallo e Centro", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const centerA = (await createCentroRec(scope, { areaOperativaId: areaA }))
      .id;
    const centerB = (await createCentroRec(scope, { areaOperativaId: areaB }))
      .id;
    const volunteer = await createVolunteer({
      tipo: "TEMPORANEO",
      centroAscoltoId: centerA,
    });
    await db.insert(giornateServizioVolontariTable).values([
      {
        volontarioId: volunteer.id,
        dataServizio: "2027-04-01",
        centroAscoltoId: centerA,
        stato: "PRESENTE",
      },
      {
        volontarioId: volunteer.id,
        dataServizio: "2027-05-01",
        centroAscoltoId: centerA,
        stato: "PRESENTE",
      },
      {
        volontarioId: volunteer.id,
        dataServizio: "2027-04-02",
        centroAscoltoId: centerB,
        stato: "PRESENTE",
      },
    ]);
    const response = await request(
      app({ centroAscoltoId: centerA, areaOperativaId: areaA }),
    )
      .post("/volontari/registro/genera")
      .buffer(true)
      .parse((raw, callback) => {
        const chunks: Buffer[] = [];
        raw.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        raw.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .send({
        tipo: "XLSX",
        filtri: {
          dataRiferimento: "2027-12-31",
          stato: "tutti",
          tipo: "TEMPORANEO",
          search: volunteer.matricola,
          centroAscoltoId: centerA,
          servizioDa: "2027-04-01",
          servizioA: "2027-04-30",
        },
      });
    expect(response.status, response.text).toBe(200);
    scope.emissioneRegistroIds.push(
      Number(response.headers["x-registro-emissione-id"]),
    );
    const book = XLSX.read(response.body, { type: "buffer" });
    const [row] = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      book.Sheets[book.SheetNames[0]],
      { raw: true },
    );
    expect(row["Date servizio temporaneo"]).toBe("2027-04-01");
    expect(row["Intervallo servizio temporaneo"]).toBe(
      "2027-04-01 – 2027-04-01",
    );
  });

  it("gestisce separatamente cataloghi, corsi e qualifiche del volontario", async () => {
    const volunteer = await createVolunteer({});
    const course = await request(app())
      .post("/volontari/formazione/corsi")
      .send({
        codice: unique("CRS"),
        titolo: "Corso sintetico",
        ore: 8,
        validitaMesi: 12,
      });
    expect(course.status, course.text).toBe(201);
    courseCatalogIds.push(course.body.id);
    const qualification = await request(app())
      .post("/volontari/formazione/qualifiche")
      .send({
        codice: unique("QLF"),
        nome: "Qualifica sintetica",
        validitaMesi: 24,
      });
    expect(qualification.status, qualification.text).toBe(201);
    qualificationCatalogIds.push(qualification.body.id);
    const volunteerCourse = await request(app())
      .post(`/volontari/${volunteer.id}/corsi`)
      .send({ corsoId: course.body.id, dataCompletamento: "2026-01-31" });
    expect(volunteerCourse.body.dataScadenza).toBe("2027-01-31");
    const volunteerQualification = await request(app())
      .post(`/volontari/${volunteer.id}/qualifiche`)
      .send({
        qualificaId: qualification.body.id,
        dataOttenimento: "2026-02-28",
        stato: "VALIDA",
      });
    expect(volunteerQualification.body.dataScadenza).toBe("2028-02-28");
    const dossier = await request(app()).get(
      `/volontari/${volunteer.id}/dossier`,
    );
    expect(dossier.body.corsi).toHaveLength(1);
    expect(dossier.body.qualifiche).toHaveLength(1);
  });
});
