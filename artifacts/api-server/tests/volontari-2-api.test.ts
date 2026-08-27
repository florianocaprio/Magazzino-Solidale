/* @vitest-environment node */

import { Router } from "express";
import request from "supertest";
import * as XLSX from "xlsx";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  corsiVolontariCatalogoTable,
  db,
  pool,
  qualificheVolontariCatalogoTable,
  registroVolontariEventiTable,
  ruoliVolontariTable,
  volontariTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
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
  cleanup,
  createBeneficiario,
  createCentro,
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
  matricola?: string;
  email?: string;
  telefono?: string;
  codiceFiscale?: string;
}) {
  const response = await request(app())
    .post("/volontari")
    .send({
      nome: "Ada",
      cognome: "Sintetica",
      matricola: input.matricola ?? unique("VOL2"),
      tipoVolontario: input.tipo ?? "PERMANENTE",
      ruoloVolontarioId: ruoloId,
      centroAscoltoId: input.centroAscoltoId ?? null,
      email: input.email,
      telefono: input.telefono,
      codiceFiscale: input.codiceFiscale,
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

function workbook(rows: Array<Array<string | number>>): Buffer {
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
  ];
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Volontari");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

async function analyze(buffer: Buffer, centroId: number) {
  return request(app())
    .post(`/volontari/import/analizza?centroAscoltoId=${centroId}`)
    .set(
      "content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    .set("x-file-name", "volontari-sintetici.xlsx")
    .send(buffer);
}

beforeEach(async () => {
  scope = newScope();
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

    const replay = await analyze(file, centroId);
    expect(replay.status).toBe(200);
    expect(replay.body.replayIdempotente).toBe(true);
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
    const first = await createVolunteer({
      codiceFiscale: "RSS MRA 80A01 H501 U",
      telefono: "0012345",
      email: "privacy@example.test",
    });
    const duplicate = await request(app())
      .post("/volontari")
      .send({
        nome: "Altro",
        cognome: "Sintetico",
        matricola: unique("CF"),
        ruoloVolontarioId: ruoloId,
        codiceFiscale: "RSSMRA80A01H501U",
      });
    expect(duplicate.status).toBe(409);

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
  });

  it("produce XLSX storico string-safe e un registro ufficiale esattamente riproducibile", async () => {
    const volunteer = await createVolunteer({ telefono: "0012345678" });
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
        filtri: { dataRiferimento: todayRome(), stato: "tutti", tipo: "TUTTI" },
      });
    expect(emission.status, emission.text).toBe(200);
    const emissionId = Number(emission.headers["x-registro-emissione-id"]);
    expect(emission.headers["x-registro-sha256"]).toMatch(/^[0-9a-f]{64}$/);
    const reproduced = await request(app())
      .get(`/volontari/registro/emissioni/${emissionId}/file`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(Buffer.compare(emission.body, reproduced.body)).toBe(0);

    const events = await request(app()).get("/volontari/registro/eventi");
    const original = events.body.find(
      (item: { volontarioId: number }) => item.volontarioId === volunteer.id,
    );
    const correction = await request(app())
      .post(`/volontari/registro/eventi/${original.id}/rettifica`)
      .send({
        motivo: "Rettifica sintetica",
        snapshot: { campo: "valore corretto" },
      });
    expect(correction.status, correction.text).toBe(201);
    expect(correction.body).toMatchObject({
      tipoEvento: "RETTIFICA",
      eventoRettificatoId: original.id,
    });
    await expect(
      db
        .update(registroVolontariEventiTable)
        .set({ snapshot: { alterato: true } })
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
