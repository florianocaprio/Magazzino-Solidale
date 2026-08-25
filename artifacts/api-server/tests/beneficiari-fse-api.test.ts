import { createHash } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  areeOperativeTable,
  auditConfigurazioniTable,
  beneficiariTable,
  centriAscoltoTable,
  db,
  fseFascicoliSocialiTable,
  fseFascicoliSocialiSnapshotTable,
  fseImportBatchesTable,
  nucleoFamiliareTable,
  utentiTable,
  zoneUdsTable,
} from "@workspace/db";
import beneficiariFseRouter from "../src/routes/beneficiari-fse";
import {
  FSE_BENEFICIARI_HEADERS,
  buildFseBeneficiariWorkbook,
  parseFseBeneficiariWorkbook,
} from "../src/lib/fseBeneficiari";
import { makeScopedApp } from "./scope-helpers";

const suffix = Math.random().toString(36).slice(2, 9);
const beneficiaryIds: number[] = [];
const centerIds: number[] = [];
const areaIds: number[] = [];
const zoneIds: number[] = [];
let userId: number;
let areaA: number;
let areaB: number;
let centerA: number;
let centerB: number;
let centerExport: number;
let centerRemote: number;
let zoneA: number;

const permissions = [
  "beneficiari.fse.view",
  "beneficiari.fse.manage",
  "beneficiari.fse.import",
  "beneficiari.fse.export",
];

function app(
  overrides: {
    areaOperativaId?: number | null;
    centroAscoltoId?: number | null;
    zonaUdsId?: number | null;
    permessi?: string[];
  } = {},
) {
  return makeScopedApp(beneficiariFseRouter, {
    id: userId,
    areaOperativaId:
      overrides.areaOperativaId === undefined
        ? areaA
        : overrides.areaOperativaId,
    centroAscoltoId:
      overrides.centroAscoltoId === undefined
        ? null
        : overrides.centroAscoltoId,
    zonaUdsId: overrides.zonaUdsId ?? null,
    aree: ["sociale"],
    permessi: overrides.permessi ?? permissions,
  });
}

function row(code: string, overrides: Record<string, unknown> = {}) {
  return {
    "Nome Referente fascicolo": `Referente-${suffix}-${code}`,
    "Cognome Referente fascicolo": `Fascicolo-${suffix}-${code}`,
    "Codice fascicolo": code,
    "Data di presa in carico": "24/08/2026",
    "Numero componenti fascicolo": 1,
    "Tipologia di Attività": "Pacchi",
    "Stato attuale": "Attivo",
    Donne: 1,
    Uomini: 0,
    "Età<18": 0,
    "Età 18-29": 0,
    "Età 30-64": 1,
    "Età>=65": 0,
    "Origine straniera e minoranze": 0,
    Disabili: 0,
    "Cittadini di Paesi Terzi": 0,
    "Senzatetto o colpiti da esclusione abitativa": 0,
    ...overrides,
  };
}

function workbook(righe: Array<Record<string, unknown>>, sheetName = "Table1") {
  if (sheetName === "Table1") {
    return buildFseBeneficiariWorkbook(
      righe as Array<
        Record<(typeof FSE_BENEFICIARI_HEADERS)[number], string | number | Date>
      >,
    );
  }
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(righe, {
    header: [...FSE_BENEFICIARI_HEADERS],
  });
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function upload(
  targetApp: ReturnType<typeof app>,
  path: "/beneficiari/fse/preview" | "/beneficiari/fse/import",
  centroAscoltoId: number,
  righe: Array<Record<string, unknown>>,
  options: {
    risoluzioni?: unknown[];
    buffer?: Buffer;
    filename?: string;
    dataRiferimento?: string;
  } = {},
) {
  const call = request(targetApp)
    .post(path)
    .field("centroAscoltoId", String(centroAscoltoId))
    .field("dataRiferimento", options.dataRiferimento ?? "2026-08-24")
    .attach("file", options.buffer ?? workbook(righe), {
      filename: options.filename ?? `fixture-${suffix}.xlsx`,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  if (options.risoluzioni)
    call.field("risoluzioni", JSON.stringify(options.risoluzioni));
  return call;
}

async function insertBeneficiary(
  values: Partial<typeof beneficiariTable.$inferInsert>,
) {
  const [created] = await db
    .insert(beneficiariTable)
    .values({
      codice: `BFSE-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
      nome: `Anagrafica-${suffix}`,
      cognome: `Test-${suffix}`,
      statoAnagrafica: "completa",
      dataNascita: "1990-01-01",
      dataPresaInCarico: "2026-08-24",
      sesso: "F",
      numComponenti: 1,
      areaOperativaId: areaA,
      centroAscoltoId: centerA,
      ...values,
    })
    .returning();
  beneficiaryIds.push(created.id);
  return created;
}

beforeAll(async () => {
  const [user] = await db
    .insert(utentiTable)
    .values({
      username: `beneficiari-fse-${suffix}`,
      passwordHash: "test-only",
      nome: "Test FSE",
    })
    .returning({ id: utentiTable.id });
  userId = user.id;
  const [a] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Area FSE A ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  const [b] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Area FSE B ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  areaA = a.id;
  areaB = b.id;
  areaIds.push(areaA, areaB);
  const centers = await db
    .insert(centriAscoltoTable)
    .values([
      { nome: `Centro FSE A ${suffix}`, areaOperativaId: areaA },
      { nome: `Centro FSE B ${suffix}`, areaOperativaId: areaB },
      { nome: `Centro FSE Export ${suffix}`, areaOperativaId: areaA },
      { nome: `Centro FSE Remote ${suffix}`, areaOperativaId: areaA },
    ])
    .returning({ id: centriAscoltoTable.id });
  [centerA, centerB, centerExport, centerRemote] = centers.map(
    (center) => center.id,
  );
  centerIds.push(centerA, centerB, centerExport, centerRemote);
  const [zone] = await db
    .insert(zoneUdsTable)
    .values({ nome: `Zona FSE ${suffix}`, areaOperativaId: areaA })
    .returning({ id: zoneUdsTable.id });
  zoneA = zone.id;
  zoneIds.push(zoneA);
});

afterAll(async () => {
  const createdInCenters = await db
    .select({ id: beneficiariTable.id })
    .from(beneficiariTable)
    .where(inArray(beneficiariTable.centroAscoltoId, centerIds));
  const ids = [
    ...new Set([...beneficiaryIds, ...createdInCenters.map((item) => item.id)]),
  ];
  if (ids.length) {
    await db
      .delete(nucleoFamiliareTable)
      .where(inArray(nucleoFamiliareTable.beneficiarioId, ids));
    await db
      .delete(fseFascicoliSocialiTable)
      .where(inArray(fseFascicoliSocialiTable.beneficiarioId, ids));
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, ids));
  }
  await db
    .delete(fseImportBatchesTable)
    .where(inArray(fseImportBatchesTable.centroAscoltoId, centerIds));
  await db
    .delete(auditConfigurazioniTable)
    .where(eq(auditConfigurazioniTable.utenteId, userId));
  await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zoneIds));
  await db
    .delete(centriAscoltoTable)
    .where(inArray(centriAscoltoTable.id, centerIds));
  await db.delete(utentiTable).where(eq(utentiTable.id, userId));
  await db
    .delete(areeOperativeTable)
    .where(inArray(areeOperativeTable.id, areaIds));
});

describe("Beneficiari 2.0 FSE+: API, scope e persistenza", () => {
  it("protegge le route letterali con permesso, Area, Centro e Zona UDS", async () => {
    expect(
      (
        await upload(
          app({ permessi: [] }),
          "/beneficiari/fse/preview",
          centerA,
          [row("SCOPE-1")],
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await upload(
          app({ areaOperativaId: areaB }),
          "/beneficiari/fse/preview",
          centerA,
          [row("SCOPE-2")],
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await upload(
          app({ centroAscoltoId: centerB, areaOperativaId: areaB }),
          "/beneficiari/fse/preview",
          centerA,
          [row("SCOPE-3")],
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await upload(
          app({ zonaUdsId: zoneA }),
          "/beneficiari/fse/preview",
          centerA,
          [row("SCOPE-4")],
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .post("/beneficiari/fse/preview")
          .send({ centroAscoltoId: centerA, headers: [], righe: [] })
      ).status,
    ).toBe(415);
  });

  it("deriva l'Area dal Centro e classifica senza restituire le righe grezze", async () => {
    const response = await upload(app(), "/beneficiari/fse/preview", centerA, [
      row("PREVIEW-1"),
    ]);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      centroAscoltoId: centerA,
      areaOperativaId: areaA,
      areaOperativaDerivata: true,
      numeroRighe: 1,
    });
    expect(response.body.righe[0].classificazione).toBe("nuovo");
    expect(response.body).not.toHaveProperty("rawRows");
    expect(JSON.stringify(response.body)).not.toContain(`Referente-${suffix}`);
  });

  it("rifiuta lato server un workbook con foglio diverso da Table1", async () => {
    const response = await upload(
      app(),
      "/beneficiari/fse/preview",
      centerA,
      [row("WRONG-SHEET")],
      {
        buffer: workbook([row("WRONG-SHEET")], "FoglioErrato"),
      },
    );
    expect(response.status).toBe(400);
    expect(response.body.errori.join(" ")).toContain("Table1");
  });

  it("tratta la somiglianza fuori Centro come warning e richiede Crea nuovo esplicito", async () => {
    const similarRow = row("REMOTE-FUZZY", {
      "Nome Referente fascicolo": "Quasar",
      "Cognome Referente fascicolo": "Zefiro",
    });
    await insertBeneficiary({
      nome: "Quasar",
      cognome: "Zefiro",
      centroAscoltoId: centerRemote,
      areaOperativaId: areaA,
    });
    const preview = await upload(app(), "/beneficiari/fse/preview", centerA, [
      similarRow,
    ]);
    expect(preview.status).toBe(200);
    expect(preview.body.righe[0]).toMatchObject({
      classificazione: "possibile_duplicato",
      duplicati: [],
    });
    expect(preview.body.righe[0].warning.join(" ")).toContain(
      "non sono esposti",
    );

    const unresolved = await upload(app(), "/beneficiari/fse/import", centerA, [
      similarRow,
    ]);
    expect(unresolved.body.dettagli[0].errori).toContain(
      "DUPLICATO_NON_RISOLTO",
    );
    const created = await upload(
      app(),
      "/beneficiari/fse/import",
      centerA,
      [similarRow],
      {
        risoluzioni: [{ numeroRiga: 2, azione: "crea" }],
      },
    );
    expect(created.body).toMatchObject({ creati: 1, errori: 0 });
    const audit = await db
      .select()
      .from(auditConfigurazioniTable)
      .where(eq(auditConfigurazioniTable.azione, "scelta-crea-nuovo-fse"));
    expect(audit.some((item) => item.utenteId === userId)).toBe(true);
  });

  it("importa, assegna il territorio, non crea persone fittizie ed è idempotente", async () => {
    const importRows = [row("IMPORT-1")];
    const importWorkbook = workbook(importRows);
    const first = await upload(
      app(),
      "/beneficiari/fse/import",
      centerA,
      importRows,
      { buffer: importWorkbook },
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      stato: "confermato",
      creati: 1,
      errori: 0,
      dataRiferimento: "2026-08-24",
    });
    const [profile] = await db
      .select()
      .from(fseFascicoliSocialiTable)
      .where(
        eq(fseFascicoliSocialiTable.codiceFascicoloNormalizzato, "import-1"),
      );
    beneficiaryIds.push(profile.beneficiarioId);
    const [beneficiary] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, profile.beneficiarioId));
    expect(beneficiary).toMatchObject({
      areaOperativaId: areaA,
      centroAscoltoId: centerA,
      sesso: "F",
      fasciaEtaPresunta: "30_64",
    });
    expect(
      await db
        .select()
        .from(nucleoFamiliareTable)
        .where(eq(nucleoFamiliareTable.beneficiarioId, beneficiary.id)),
    ).toHaveLength(0);
    const [batch] = await db
      .select()
      .from(fseImportBatchesTable)
      .where(eq(fseImportBatchesTable.id, first.body.batchId));
    expect(batch.sha256File).toBe(
      createHash("sha256").update(importWorkbook).digest("hex"),
    );
    expect(batch.dataRiferimento).toBe("2026-08-24");
    const snapshotsAfterFirstImport = await db
      .select()
      .from(fseFascicoliSocialiSnapshotTable)
      .where(
        eq(fseFascicoliSocialiSnapshotTable.beneficiarioId, beneficiary.id),
      );
    expect(snapshotsAfterFirstImport).toHaveLength(1);
    expect(snapshotsAfterFirstImport[0]).toMatchObject({
      dataRiferimento: "2026-08-24",
      origineSnapshot: "import_fse",
      versioneProfilo: 1,
    });

    const replay = await upload(
      app(),
      "/beneficiari/fse/import",
      centerA,
      importRows,
      { buffer: importWorkbook },
    );
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ creati: 0, invariati: 1, errori: 0 });
    const snapshotsAfterReplay = await db
      .select()
      .from(fseFascicoliSocialiSnapshotTable)
      .where(
        eq(fseFascicoliSocialiSnapshotTable.beneficiarioId, beneficiary.id),
      );
    expect(snapshotsAfterReplay).toHaveLength(1);

    const nextReferenceDate = await upload(
      app(),
      "/beneficiari/fse/import",
      centerA,
      importRows,
      {
        buffer: importWorkbook,
        dataRiferimento: "2026-08-25",
      },
    );
    expect(nextReferenceDate.status).toBe(200);
    expect(nextReferenceDate.body).toMatchObject({ aggiornati: 1, errori: 0 });
    const snapshotsAfterNextDate = await db
      .select()
      .from(fseFascicoliSocialiSnapshotTable)
      .where(
        eq(fseFascicoliSocialiSnapshotTable.beneficiarioId, beneficiary.id),
      );
    expect(snapshotsAfterNextDate).toHaveLength(2);
    expect(
      snapshotsAfterNextDate.map((item) => item.dataRiferimento).sort(),
    ).toEqual(["2026-08-24", "2026-08-25"]);
  });

  it("serializza prime importazioni e aggiornamenti concorrenti senza duplicare versioni", async () => {
    const firstCode = `CONCURRENT-FIRST-${suffix}`;
    const concurrentRow = (overrides: Record<string, unknown> = {}) =>
      row(firstCode, {
        "Nome Referente fascicolo": `Xylophora-${suffix}`,
        "Cognome Referente fascicolo": `Quasarion-${suffix}`,
        ...overrides,
      });
    const firstRows = [concurrentRow()];
    const firstBuffer = workbook(firstRows);
    const firstResults = await Promise.all([
      upload(app(), "/beneficiari/fse/import", centerA, firstRows, {
        buffer: firstBuffer,
      }),
      upload(app(), "/beneficiari/fse/import", centerA, firstRows, {
        buffer: firstBuffer,
      }),
    ]);
    expect(firstResults.map((result) => result.status)).toEqual([200, 200]);
    expect(
      firstResults.reduce(
        (sum, result) => sum + Number(result.body.creati ?? 0),
        0,
      ),
      JSON.stringify(firstResults.map((result) => result.body)),
    ).toBe(1);
    expect(
      firstResults.reduce(
        (sum, result) => sum + Number(result.body.invariati ?? 0),
        0,
      ),
    ).toBe(1);

    const [createdProfile] = await db
      .select()
      .from(fseFascicoliSocialiTable)
      .where(
        eq(
          fseFascicoliSocialiTable.codiceFascicoloNormalizzato,
          firstCode.toLowerCase(),
        ),
      );
    beneficiaryIds.push(createdProfile.beneficiarioId);
    expect(createdProfile.versione).toBe(1);
    expect(
      await db
        .select()
        .from(fseFascicoliSocialiSnapshotTable)
        .where(
          eq(
            fseFascicoliSocialiSnapshotTable.beneficiarioId,
            createdProfile.beneficiarioId,
          ),
        ),
    ).toHaveLength(1);

    const updates = await Promise.all([
      upload(app(), "/beneficiari/fse/import", centerA, [
        concurrentRow({ Disabili: 1 }),
      ]),
      upload(app(), "/beneficiari/fse/import", centerA, [
        concurrentRow({ "Origine straniera e minoranze": 1 }),
      ]),
    ]);
    expect(updates.map((result) => result.status)).toEqual([200, 200]);
    expect(updates.every((result) => result.body.aggiornati === 1)).toBe(true);

    const [updatedProfile] = await db
      .select()
      .from(fseFascicoliSocialiTable)
      .where(eq(fseFascicoliSocialiTable.id, createdProfile.id));
    expect(updatedProfile.versione).toBe(3);
    const authoritativeSnapshots = await db
      .select()
      .from(fseFascicoliSocialiSnapshotTable)
      .where(
        eq(
          fseFascicoliSocialiSnapshotTable.beneficiarioId,
          createdProfile.beneficiarioId,
        ),
      );
    expect(
      authoritativeSnapshots
        .map((snapshot) => snapshot.versioneProfilo)
        .sort((left, right) => left - right),
    ).toEqual([1, 2, 3]);
    expect(
      new Set(
        authoritativeSnapshots.map((snapshot) => snapshot.versioneProfilo),
      ).size,
    ).toBe(3);

    const replay = await upload(app(), "/beneficiari/fse/import", centerA, [
      concurrentRow({
        "Origine straniera e minoranze":
          updatedProfile.origineStranieraMinoranze ?? 0,
        Disabili: updatedProfile.personeDisabilita ?? 0,
      }),
    ]);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ invariati: 1, aggiornati: 0 });
  });

  it("mantiene il partial success e aggiorna una riga già collegata", async () => {
    const partial = await upload(app(), "/beneficiari/fse/import", centerA, [
      row("PARTIAL-OK", {
        "Nome Referente fascicolo": "Ulisse",
        "Cognome Referente fascicolo": "Nebbia",
      }),
      row("PARTIAL-BAD", {
        "Nome Referente fascicolo": "Carla",
        "Cognome Referente fascicolo": "Muschio",
        "Numero componenti fascicolo": 2,
      }),
    ]);
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({
      stato: "parziale",
      creati: 1,
      errori: 1,
    });
    expect(partial.body.dettagli).toHaveLength(2);

    const update = await upload(app(), "/beneficiari/fse/import", centerA, [
      row("IMPORT-1", { Disabili: 1 }),
    ]);
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ aggiornati: 1, errori: 0 });
  });

  it("collega un nucleo multipersona con merge conservativo e rifiuta target arbitrari", async () => {
    const duplicateRow = row("LINK-1", {
      "Numero componenti fascicolo": 5,
      "Tipologia di Attività": "Domiciliare",
      Donne: 3,
      Uomini: 2,
      "Età<18": 1,
      "Età 18-29": 1,
      "Età 30-64": 2,
      "Età>=65": 1,
      "Origine straniera e minoranze": 2,
      Disabili: 2,
      "Cittadini di Paesi Terzi": 1,
      "Senzatetto o colpiti da esclusione abitativa": 0,
    });
    const target = await insertBeneficiary({
      nome: String(duplicateRow["Nome Referente fascicolo"]),
      cognome: String(duplicateRow["Cognome Referente fascicolo"]),
      centroAscoltoId: centerA,
      numComponenti: 1,
      dataPresaInCarico: null,
      consegnaDomicilio: false,
      motivoConsegnaDomicilio: "Scelta interna autorevole",
    });
    const arbitrary = await insertBeneficiary({
      nome: "Target",
      cognome: "Arbitrario",
      centroAscoltoId: centerA,
    });
    const preview = await upload(app(), "/beneficiari/fse/preview", centerA, [
      duplicateRow,
    ]);
    expect(preview.body.righe[0]).toMatchObject({
      classificazione: "possibile_duplicato",
    });
    expect(
      preview.body.righe[0].duplicati.map((item: { id: number }) => item.id),
    ).toContain(target.id);

    const unresolved = await upload(app(), "/beneficiari/fse/import", centerA, [
      duplicateRow,
    ]);
    expect(unresolved.body).toMatchObject({ stato: "parziale", errori: 1 });
    expect(unresolved.body.dettagli[0].errori).toContain(
      "DUPLICATO_NON_RISOLTO",
    );

    const rejected = await upload(
      app(),
      "/beneficiari/fse/import",
      centerA,
      [duplicateRow],
      {
        risoluzioni: [
          { numeroRiga: 2, azione: "collega", beneficiarioId: arbitrary.id },
        ],
      },
    );
    expect(rejected.body.dettagli[0].errori).toContain("TARGET_NON_CANDIDATO");

    const linked = await upload(
      app(),
      "/beneficiari/fse/import",
      centerA,
      [duplicateRow],
      {
        risoluzioni: [
          { numeroRiga: 2, azione: "collega", beneficiarioId: target.id },
        ],
      },
    );
    expect(linked.body).toMatchObject({
      stato: "confermato",
      collegati: 1,
      errori: 0,
    });
    const [merged] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, target.id));
    expect(merged).toMatchObject({
      numComponenti: 5,
      numMinori: 1,
      numAnziani: 1,
      numDisabili: 2,
      dataPresaInCarico: "2026-08-24",
      consegnaDomicilio: false,
    });
    const [profile] = await db
      .select()
      .from(fseFascicoliSocialiTable)
      .where(eq(fseFascicoliSocialiTable.beneficiarioId, target.id));
    expect(profile).toMatchObject({
      numeroComponentiImportato: 5,
      donneImportate: 3,
      uominiImportati: 2,
    });
  });

  it("non sovrascrive i conteggi di un nucleo interno anagraficamente completo", async () => {
    const completeRow = row("LINK-FULL", {
      "Nome Referente fascicolo": "Nucleo",
      "Cognome Referente fascicolo": "Completo",
      "Numero componenti fascicolo": 5,
      Donne: 3,
      Uomini: 2,
      "Età<18": 1,
      "Età 18-29": 1,
      "Età 30-64": 2,
      "Età>=65": 1,
      Disabili: 2,
    });
    const target = await insertBeneficiary({
      nome: "Nucleo",
      cognome: "Completo",
      centroAscoltoId: centerA,
      numComponenti: 3,
      numMinori: 2,
      numAnziani: 0,
      numDisabili: 0,
    });
    await db.insert(nucleoFamiliareTable).values([
      {
        beneficiarioId: target.id,
        nome: "Minore",
        cognome: "Uno",
        dataNascita: "2015-01-01",
        sesso: "F",
      },
      {
        beneficiarioId: target.id,
        nome: "Minore",
        cognome: "Due",
        dataNascita: "2017-01-01",
        sesso: "M",
      },
    ]);

    const preview = await upload(app(), "/beneficiari/fse/preview", centerA, [
      completeRow,
    ]);
    expect(
      preview.body.righe[0].duplicati.map((item: { id: number }) => item.id),
    ).toContain(target.id);
    const linked = await upload(
      app(),
      "/beneficiari/fse/import",
      centerA,
      [completeRow],
      {
        risoluzioni: [
          { numeroRiga: 2, azione: "collega", beneficiarioId: target.id },
        ],
      },
    );
    expect(linked.body).toMatchObject({ collegati: 1, errori: 0 });
    const [preserved] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, target.id));
    expect(preserved).toMatchObject({
      numComponenti: 3,
      numMinori: 2,
      numAnziani: 0,
      numDisabili: 2,
    });
  });

  it("espone e aggiorna la scheda FSE applicando scope e validazione", async () => {
    const [profile] = await db
      .select()
      .from(fseFascicoliSocialiTable)
      .where(
        eq(fseFascicoliSocialiTable.codiceFascicoloNormalizzato, "import-1"),
      );
    expect(
      (
        await request(app({ permessi: [] })).get(
          `/beneficiari/${profile.beneficiarioId}/fse`,
        )
      ).status,
    ).toBe(403);
    const get = await request(app()).get(
      `/beneficiari/${profile.beneficiarioId}/fse`,
    );
    expect(get.status).toBe(200);
    expect(get.body).toHaveProperty("demografia");
    expect(get.body).toHaveProperty("confronto");
    expect(
      (
        await request(app())
          .patch(`/beneficiari/${profile.beneficiarioId}/fse`)
          .send({ origineStranieraMinoranze: 2 })
      ).status,
    ).toBe(400);
    const patch = await request(app())
      .patch(`/beneficiari/${profile.beneficiarioId}/fse`)
      .send({
        codiceFascicolo: "IMPORT-1-EDIT",
        origineStranieraMinoranze: 1,
        dataRiferimento: "2026-08-26",
        versione: get.body.profilo.versione,
      });
    expect(patch.status).toBe(200);
    expect(patch.body.codiceFascicoloNormalizzato).toBe("import-1-edit");
    const stalePatch = await request(app())
      .patch(`/beneficiari/${profile.beneficiarioId}/fse`)
      .send({
        origineStranieraMinoranze: 0,
        dataRiferimento: "2026-08-26",
        versione: get.body.profilo.versione,
      });
    expect(stalePatch.status).toBe(409);
  });

  it("distingue valori FSE sconosciuti da zero e inizializza il codice al primo export", async () => {
    const exportable = await insertBeneficiary({
      codice: `EXPORT-${suffix}`,
      nome: `Export-${suffix}`,
      cognome: `Valido-${suffix}`,
      centroAscoltoId: centerExport,
      areaOperativaId: areaA,
    });
    const blocked = await request(app())
      .post("/beneficiari/fse/export/preflight")
      .send({
        centroAscoltoId: centerExport,
        areaOperativaId: areaB,
        dataRiferimento: "2026-08-24",
        soloAttivi: true,
      });
    expect(blocked.status).toBe(200);
    expect(blocked.body).toMatchObject({
      candidati: 1,
      esportabili: 0,
      areaOperativaId: areaA,
    });
    expect(blocked.body.bloccati[0].errori).toEqual(
      expect.arrayContaining([
        "ORIGINE_STRANIERA_MINORANZE_NON_VALORIZZATA",
        "CITTADINI_PAESI_TERZI_NON_VALORIZZATO",
        "ESCLUSIONE_ABITATIVA_NON_VALORIZZATA",
      ]),
    );
    expect(
      (
        await request(app()).post("/beneficiari/fse/export").send({
          centroAscoltoId: centerExport,
          dataRiferimento: "2026-08-24",
          soloAttivi: true,
        })
      ).status,
    ).toBe(422);

    const profileWithoutCode = await request(app())
      .patch(`/beneficiari/${exportable.id}/fse`)
      .send({
        origineStranieraMinoranze: 0,
        cittadiniPaesiTerzi: 0,
        senzaTettoEsclusioneAbitativa: 0,
        dataRiferimento: "2026-08-24",
        versione: 0,
      });
    expect(profileWithoutCode.status).toBe(200);
    expect(profileWithoutCode.body).toMatchObject({
      codiceFascicolo: null,
      origineStranieraMinoranze: 0,
      cittadiniPaesiTerzi: 0,
      senzaTettoEsclusioneAbitativa: 0,
    });

    const preflight = await request(app())
      .post("/beneficiari/fse/export/preflight")
      .send({
        centroAscoltoId: centerExport,
        areaOperativaId: areaB,
        dataRiferimento: "2026-08-24",
        soloAttivi: true,
      });
    expect(preflight.status).toBe(200);
    expect(preflight.body).toMatchObject({
      candidati: 1,
      esportabili: 1,
      areaOperativaId: areaA,
      soloAttivi: true,
    });
    expect(
      (
        await request(app())
          .post("/beneficiari/fse/export")
          .send({
            centroAscoltoId: centerExport,
            dataRiferimento: "2026-08-24",
            soloAttivi: false,
          })
      ).status,
    ).toBe(400);

    const exported = await request(app())
      .post("/beneficiari/fse/export")
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .send({
        centroAscoltoId: centerExport,
        dataRiferimento: "2026-08-24",
        soloAttivi: true,
      });
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml.sheet");
    const parsed = parseFseBeneficiariWorkbook(exported.body as Buffer);
    expect(parsed.header.errori).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].errori).toEqual([]);
    expect(parsed.rawRows[0]).toMatchObject({
      "Origine straniera e minoranze": 0,
      "Cittadini di Paesi Terzi": 0,
      "Senzatetto o colpiti da esclusione abitativa": 0,
    });
    const [profile] = await db
      .select()
      .from(fseFascicoliSocialiTable)
      .where(eq(fseFascicoliSocialiTable.beneficiarioId, exportable.id));
    expect(profile.ultimoExportAt).not.toBeNull();
    expect(profile.codiceFascicolo).toBe(exportable.codice);
    const exportSnapshots = await db
      .select()
      .from(fseFascicoliSocialiSnapshotTable)
      .where(
        eq(fseFascicoliSocialiSnapshotTable.beneficiarioId, exportable.id),
      );
    expect(
      exportSnapshots.some((item) => item.origineSnapshot === "export_fse"),
    ).toBe(true);

    const replayedExport = await request(app())
      .post("/beneficiari/fse/export")
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .send({
        centroAscoltoId: centerExport,
        dataRiferimento: "2026-08-24",
        soloAttivi: true,
      });
    expect(replayedExport.status).toBe(200);
    const exportSnapshotsAfterReplay = await db
      .select()
      .from(fseFascicoliSocialiSnapshotTable)
      .where(
        eq(fseFascicoliSocialiSnapshotTable.beneficiarioId, exportable.id),
      );
    expect(exportSnapshotsAfterReplay).toHaveLength(exportSnapshots.length);
  });

  it("registra audit tecnici senza nomi o cognomi", async () => {
    const audits = await db
      .select()
      .from(auditConfigurazioniTable)
      .where(eq(auditConfigurazioniTable.utenteId, userId));
    expect(
      audits.some((audit) => audit.azione === "import-fse-confermato"),
    ).toBe(true);
    expect(audits.some((audit) => audit.azione === "export-fse")).toBe(true);
    const serialized = JSON.stringify(audits.map((audit) => audit.valoreNuovo));
    expect(serialized).not.toContain(`Referente-${suffix}`);
    expect(serialized).not.toContain(`Fascicolo-${suffix}-`);
  });
});
