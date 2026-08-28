/* @vitest-environment node */

import { Router } from "express";
import request from "supertest";
import * as XLSX from "xlsx";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  centriAscoltoTable,
  db,
  giornateServizioVolontariTable,
  importazioniVolontariRigheTable,
  importazioniVolontariTable,
  matricoleVolontariTable,
  pool,
  registroVolontariEventiTable,
  ruoliVolontariTable,
  volontariTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import volontariImportRouter from "../src/routes/volontari-import";
import volontariRouter from "../src/routes/volontari";
import { todayRome } from "../src/lib/volontariDomain";
import { previewPermanentVolunteerIdentifier } from "../src/lib/volontariMatricola";
import {
  cleanup,
  createAreaOperativa,
  createCentroRec,
  createRuoloVolontario,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

const routers = Router();
routers.use(volontariImportRouter);
routers.use(volontariRouter);
const app = () =>
  makeScopedApp(routers, {
    id: 0,
    centroAscoltoId: null,
    areaOperativaId: null,
  });

let scope: SeedScope;
let centroId: number;
let ruoloId: number;
let sequence = 0;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${sequence}`;
}

function workbook(rows: Array<Array<string | number>>): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    [
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
    ],
    ...rows,
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Volontari");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

async function analyze(buffer: Buffer) {
  return request(app())
    .post(`/volontari/import/analizza?centroAscoltoId=${centroId}`)
    .set(
      "content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    .set("x-file-name", `${unique("volontari")}.xlsx`)
    .send(buffer);
}

async function centerAndRole() {
  const [[center], [role]] = await Promise.all([
    db
      .select()
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, centroId)),
    db
      .select()
      .from(ruoliVolontariTable)
      .where(eq(ruoliVolontariTable.id, ruoloId)),
  ]);
  return { center, role };
}

function importRow(
  name: string,
  centerName: string,
  roleName: string,
  options: {
    code?: string;
    start?: string;
    end?: string;
    type?: "Permanente" | "Temporaneo";
    service?: string;
  } = {},
) {
  return [
    1,
    options.code ?? "",
    `${name} Nome`,
    "Roma",
    "1988-04-05",
    `Via ${name} 1`,
    "",
    options.start ?? "2021-03-04",
    options.end ?? "",
    "",
    "",
    "",
    centerName,
    roleName,
    options.type ?? "Permanente",
    options.service ?? "",
  ];
}

beforeEach(async () => {
  scope = newScope();
  const areaOperativaId = await createAreaOperativa(scope);
  centroId = (
    await createCentroRec(scope, {
      areaOperativaId,
      nome: unique("Centro Pre Test Volontari"),
    })
  ).id;
  ruoloId = await createRuoloVolontario(scope, {
    nome: unique("Ruolo Pre Test"),
  });
});

afterEach(async () => cleanup(scope));
afterAll(async () => pool.end());

describe("Volontari 2.0 — quarto addendum pre-test finale", () => {
  it("crea temporaneo e prima giornata atomicamente e applica le regole CF/domicilio", async () => {
    const base = {
      nome: "Tina",
      cognome: unique("Temporanea"),
      tipoVolontario: "TEMPORANEO",
      ruoloVolontarioId: ruoloId,
      centroAscoltoId: centroId,
      codiceFiscaleNonDisponibile: true,
      luogoNascita: "Roma",
      dataNascita: "1992-04-05",
      indirizzoResidenza: "Via Atomica 1",
      indirizzoDomicilio: null,
    };
    const missingDay = await request(app()).post("/volontari").send(base);
    expect(missingDay.status).toBe(400);
    expect(missingDay.body.error).toMatch(/dataServizio/i);

    const created = await request(app())
      .post("/volontari")
      .send({
        ...base,
        dataServizio: "2027-05-10",
      });
    expect(created.status, created.text).toBe(201);
    scope.volontarioIds.push(created.body.id);
    expect(created.body).toMatchObject({
      indirizzoDomicilio: null,
      codiceFiscaleNonDisponibile: true,
      codiceFiscaleNota: null,
    });
    expect(created.body.matricola).toMatch(
      /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/,
    );
    const [days, identifiers, ledger] = await Promise.all([
      db
        .select()
        .from(giornateServizioVolontariTable)
        .where(
          eq(giornateServizioVolontariTable.volontarioId, created.body.id),
        ),
      db
        .select()
        .from(matricoleVolontariTable)
        .where(eq(matricoleVolontariTable.volontarioId, created.body.id)),
      db
        .select()
        .from(registroVolontariEventiTable)
        .where(eq(registroVolontariEventiTable.volontarioId, created.body.id))
        .orderBy(asc(registroVolontariEventiTable.progressivo)),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      dataServizio: "2027-05-10",
      stato: "PIANIFICATA",
    });
    expect(identifiers).toHaveLength(1);
    expect(ledger.map((event) => event.tipoEvento)).toEqual([
      "REGISTRAZIONE",
      "GIORNATA_TEMPORANEA",
    ]);

    const missingCf = await request(app())
      .post("/volontari")
      .send({
        ...base,
        nome: "Carla",
        cognome: unique("SenzaCf"),
        tipoVolontario: "PERMANENTE",
        codiceFiscaleNonDisponibile: false,
      });
    expect(missingCf.status).toBe(400);
    const inconsistentCf = await request(app())
      .post("/volontari")
      .send({
        ...base,
        nome: "Carla",
        cognome: unique("CfIncoerente"),
        tipoVolontario: "PERMANENTE",
        codiceFiscale: "RSSMRA80A01H501U",
        codiceFiscaleNonDisponibile: true,
      });
    expect(inconsistentCf.status).toBe(400);
    const permanent = await request(app())
      .post("/volontari")
      .send({
        ...base,
        nome: "Paola",
        cognome: unique("Permanente"),
        tipoVolontario: "PERMANENTE",
      });
    expect(permanent.status, permanent.text).toBe(201);
    scope.volontarioIds.push(permanent.body.id);
  });

  it("esegue rollback completo quando l'inserimento della giornata fallisce", async () => {
    const email = `${unique("rollback")}@example.test`;
    await pool.query(`CREATE OR REPLACE FUNCTION test_volontari_initial_day_failure()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.data_servizio = DATE '2099-12-30' THEN
          RAISE EXCEPTION 'synthetic initial service day failure';
        END IF;
        RETURN NEW;
      END; $$`);
    await pool.query(
      `DROP TRIGGER IF EXISTS test_volontari_initial_day_failure_trigger ON giornate_servizio_volontari`,
    );
    await pool.query(`CREATE TRIGGER test_volontari_initial_day_failure_trigger
      BEFORE INSERT ON giornate_servizio_volontari
      FOR EACH ROW EXECUTE FUNCTION test_volontari_initial_day_failure()`);
    try {
      const response = await request(app())
        .post("/volontari")
        .send({
          nome: "Rita",
          cognome: unique("Rollback"),
          tipoVolontario: "TEMPORANEO",
          ruoloVolontarioId: ruoloId,
          centroAscoltoId: centroId,
          email,
          codiceFiscaleNonDisponibile: true,
          luogoNascita: "Roma",
          dataNascita: "1994-03-02",
          indirizzoResidenza: "Via Rollback 1",
          dataServizio: "2099-12-30",
        });
      expect(response.status).toBe(500);
    } finally {
      await pool.query(
        `DROP TRIGGER IF EXISTS test_volontari_initial_day_failure_trigger ON giornate_servizio_volontari`,
      );
      await pool.query(
        "DROP FUNCTION IF EXISTS test_volontari_initial_day_failure()",
      );
    }
    expect(
      await db
        .select()
        .from(volontariTable)
        .where(eq(volontariTable.email, email)),
    ).toHaveLength(0);
    const identifiers = await pool.query<{
      orfani: string;
    }>(`SELECT count(*)::text AS orfani
      FROM matricole_volontari m LEFT JOIN volontari v ON v.id = m.volontario_id WHERE v.id IS NULL`);
    const ledger = await pool.query<{
      orfani: string;
    }>(`SELECT count(*)::text AS orfani
      FROM registro_volontari_eventi e LEFT JOIN volontari v ON v.id = e.volontario_id WHERE v.id IS NULL`);
    expect(identifiers.rows[0].orfani).toBe("0");
    expect(ledger.rows[0].orfani).toBe("0");
  });

  it("blocca Da Data mancante fino alla correzione senza usare oggi o A Data", async () => {
    const { center, role } = await centerAndRole();
    const preview = await analyze(
      workbook([
        importRow("Storica", center.nome, role.nome, {
          start: "",
          end: "2030-12-31",
        }),
      ]),
    );
    expect(preview.status, preview.text).toBe(201);
    scope.importazioneVolontariIds.push(preview.body.importazioneId);
    expect(preview.body.righe[0]).toMatchObject({
      stato: "DA_VERIFICARE",
      datiNormalizzati: { dataInizioImportata: null, matricola: null },
      matricolaProposta: {
        modalita: "AUTOMATICA_AL_COMMIT",
        tipoIdentificativo: "PERMANENTE",
        consumaProgressivo: false,
      },
    });
    expect(preview.body.righe[0].avvisi).toContain(
      "Data di iscrizione/inizio attività mancante",
    );
    const decision = {
      numeroRiga: 2,
      ruoloVolontarioId: ruoloId,
      centroAscoltoId: centroId,
    };
    const blocked = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: preview.body.importazioneId,
        righe: [decision],
      });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe("DATA_INIZIO_IMPORTATA_OBBLIGATORIA");
    const [batch] = await db
      .select()
      .from(importazioniVolontariTable)
      .where(eq(importazioniVolontariTable.id, preview.body.importazioneId));
    expect(batch.stato).toBe("ANALIZZATO");

    const correctedDate = "2019-06-15";
    const confirmed = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: preview.body.importazioneId,
        righe: [
          { ...decision, correzioni: { dataInizioImportata: correctedDate } },
        ],
      });
    expect(confirmed.status, confirmed.text).toBe(200);
    const [stored] = await db
      .select()
      .from(importazioniVolontariRigheTable)
      .where(
        eq(
          importazioniVolontariRigheTable.importazioneId,
          preview.body.importazioneId,
        ),
      );
    scope.volontarioIds.push(stored.volontarioRisultatoId!);
    const [[volunteer], [identifier], [registration]] = await Promise.all([
      db
        .select()
        .from(volontariTable)
        .where(eq(volontariTable.id, stored.volontarioRisultatoId!)),
      db
        .select()
        .from(matricoleVolontariTable)
        .where(
          eq(
            matricoleVolontariTable.volontarioId,
            stored.volontarioRisultatoId!,
          ),
        ),
      db
        .select()
        .from(registroVolontariEventiTable)
        .where(
          and(
            eq(
              registroVolontariEventiTable.volontarioId,
              stored.volontarioRisultatoId!,
            ),
            eq(registroVolontariEventiTable.tipoEvento, "REGISTRAZIONE"),
          ),
        ),
    ]);
    expect(volunteer.dataIscrizione).toBe(correctedDate);
    expect(volunteer.dataInizioImportata).toBe(correctedDate);
    expect(identifier.dataInizioValidita).toBe(correctedDate);
    expect(registration.dataEffettiva).toBe(correctedDate);
    expect(registration.snapshot).toMatchObject({ dataInizio: correctedDate });
    expect(volunteer.dataIscrizione).not.toBe("2030-12-31");
    expect(volunteer.dataIscrizione).not.toBe(todayRome());
  });

  it("genera matricole al commit, non consuma preview e serializza la concorrenza", async () => {
    const { center, role } = await centerAndRole();
    const permanentBefore = await previewPermanentVolunteerIdentifier(centroId);
    const mixedPreview = await analyze(
      workbook([
        importRow("Automatica", center.nome, role.nome),
        importRow("Temporanea", center.nome, role.nome, {
          type: "Temporaneo",
          service: "2027-07-08",
        }),
      ]),
    );
    scope.importazioneVolontariIds.push(mixedPreview.body.importazioneId);
    expect(
      mixedPreview.body.righe.map(
        (item: { matricolaProposta: unknown }) => item.matricolaProposta,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tipoIdentificativo: "PERMANENTE",
          consumaProgressivo: false,
        }),
        expect.objectContaining({
          tipoIdentificativo: "TEMPORANEA",
          formato: "XXX-XXX",
        }),
      ]),
    );
    expect(await previewPermanentVolunteerIdentifier(centroId)).toEqual(
      permanentBefore,
    );
    const mixed = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: mixedPreview.body.importazioneId,
        righe: [2, 3].map((numeroRiga) => ({
          numeroRiga,
          ruoloVolontarioId: ruoloId,
          centroAscoltoId: centroId,
        })),
      });
    expect(mixed.status, mixed.text).toBe(200);
    const mixedRows = await db
      .select()
      .from(importazioniVolontariRigheTable)
      .where(
        eq(
          importazioniVolontariRigheTable.importazioneId,
          mixedPreview.body.importazioneId,
        ),
      );
    scope.volontarioIds.push(
      ...mixedRows.map((row) => row.volontarioRisultatoId!),
    );
    const mixedVolunteers = await db
      .select()
      .from(volontariTable)
      .where(
        inArray(
          volontariTable.id,
          mixedRows.map((row) => row.volontarioRisultatoId!),
        ),
      );
    expect(
      mixedVolunteers.find((item) => item.tipoVolontario === "PERMANENTE")!
        .matricola,
    ).toBe(permanentBefore.matricola);
    expect(
      mixedVolunteers.find((item) => item.tipoVolontario === "TEMPORANEO")!
        .matricola,
    ).toMatch(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);

    const [firstPreview, secondPreview] = await Promise.all([
      analyze(workbook([importRow(unique("ConcA"), center.nome, role.nome)])),
      analyze(workbook([importRow(unique("ConcB"), center.nome, role.nome)])),
    ]);
    scope.importazioneVolontariIds.push(
      firstPreview.body.importazioneId,
      secondPreview.body.importazioneId,
    );
    const confirm = (importazioneId: number) =>
      request(app())
        .post("/volontari/import/conferma")
        .send({
          importazioneId,
          righe: [
            {
              numeroRiga: 2,
              ruoloVolontarioId: ruoloId,
              centroAscoltoId: centroId,
            },
          ],
        });
    const concurrent = await Promise.all([
      confirm(firstPreview.body.importazioneId),
      confirm(secondPreview.body.importazioneId),
    ]);
    expect(concurrent.map((response) => response.status)).toEqual([200, 200]);
    const rows = await db
      .select()
      .from(importazioniVolontariRigheTable)
      .where(
        inArray(importazioniVolontariRigheTable.importazioneId, [
          firstPreview.body.importazioneId,
          secondPreview.body.importazioneId,
        ]),
      );
    scope.volontarioIds.push(
      ...rows.map((item) => item.volontarioRisultatoId!),
    );
    const volunteers = await db
      .select({ matricola: volontariTable.matricola })
      .from(volontariTable)
      .where(
        inArray(
          volontariTable.id,
          rows.map((item) => item.volontarioRisultatoId!),
        ),
      );
    expect(new Set(volunteers.map((item) => item.matricola)).size).toBe(2);
  });

  it("preserva la matricola importata e segnala una collisione esplicita", async () => {
    const { center, role } = await centerAndRole();
    const code = unique("COLLISIONE");
    const preview = await analyze(
      workbook([
        importRow(unique("CollisioneA"), center.nome, role.nome, { code }),
        importRow(unique("CollisioneB"), center.nome, role.nome, { code }),
      ]),
    );
    scope.importazioneVolontariIds.push(preview.body.importazioneId);
    const result = await request(app())
      .post("/volontari/import/conferma")
      .send({
        importazioneId: preview.body.importazioneId,
        righe: [2, 3].map((numeroRiga) => ({
          numeroRiga,
          ruoloVolontarioId: ruoloId,
          centroAscoltoId: centroId,
        })),
      });
    expect(result.status, result.text).toBe(200);
    expect(result.body).toMatchObject({ creati: 1, errori: 1 });
    const rows = await db
      .select()
      .from(importazioniVolontariRigheTable)
      .where(
        eq(
          importazioniVolontariRigheTable.importazioneId,
          preview.body.importazioneId,
        ),
      );
    expect(rows.map((row) => row.esitoCommit).sort()).toEqual([
      "CREATO",
      "ERRORE_DUPLICATO",
    ]);
    const created = rows.find((row) => row.volontarioRisultatoId != null)!;
    scope.volontarioIds.push(created.volontarioRisultatoId!);
    const [volunteer] = await db
      .select()
      .from(volontariTable)
      .where(eq(volontariTable.id, created.volontarioRisultatoId!));
    expect(volunteer.matricola).toBe(code);
  });
});
