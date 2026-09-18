/* @vitest-environment node */

import { readFileSync } from "node:fs";
import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  areeOperativeTable,
  auditEventiTable,
  caricoPraticaRigheTable,
  caricoPraticheTable,
  db,
  fseImportAttachCommandsTable,
  fseImportRowsTable,
  fseImportSessionsTable,
  fseInitialBalanceCoverageTable,
  fseMovementClaimsTable,
  fseSourceRegistriesTable,
  importazioniAgeaRigheTable,
  importazioniAgeaTable,
  lottiLogiciTable,
  lottiTable,
  magazziniTable,
  mappatureProdottiEsterniTable,
  movimentiEsterniAgeaTable,
  movimentiTable,
  pool,
  prodottiTable,
  utentiTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  ensureAmbienteModuli,
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import caricoPraticheRouter from "../src/routes/carico-pratiche";
import ageaRouter from "../src/routes/agea";
import fseImportazioniRouter from "../src/routes/fse-importazioni";
import { AGEA_XLSX_MIME } from "../src/lib/ageaSifeadParser";

const suffix = `${process.pid}${Date.now().toString(36)}`;
let actorId: number;
let areaId: number;
let logicalLotId: number;
let ordinaryWarehouseId: number;
let initialWarehouseId: number;
let incompleteBalanceWarehouseId: number;
let productId: number;
let ordinarySourceId: number;
let initialSourceId: number;
let incompleteBalanceSourceId: number;
let originalLottiEnabled = true;
const originalRegistryPath = process.env.FSE_REGISTRY_ORIGINAL_PATH;
const originalStockPath = process.env.FSE_STOCK_ORIGINAL_PATH;
const originalsAvailable = Boolean(originalRegistryPath && originalStockPath);

const registryHeaders = [
  "Fondo",
  "Prodotto",
  "Giacenza al 17/09/2026 Pezzi",
  "Giacenza al 17/09/2026 KgLt",
  "Numero documento",
  "Data documento",
  "Data carico magazzino",
  "Lotto",
  "Mittente / destinatario",
  "Carico / scarico",
  "Carico / scarico pezzi",
  "Giacenza pezzi alla movimentazione",
  "Giacenza alla movimentazione",
  "Note",
  "Attività",
  "Pacchi",
  "Pasti",
  "Indigenti saltuari",
  "Indigenti continuativi",
];

const stockHeaders = [
  "Denominazione OpN",
  "Denominazione OpC",
  "Denominazione OpT",
  "CodiceAccesso",
  "Fondo",
  "Prodotto",
  "Lotto",
  "PesoUnita",
  "UnitaMisuraPeso",
  "GiacenzaPesoVolume",
  "GiacenzaPezzi",
  "PezziPerCollo",
  "GiacenzaColli",
  "CheckModificaGiacenza",
  "Scadenza",
];

function workbook(headers: string[], rows: unknown[][]): Buffer {
  const value = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    value,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    "Dati sintetici",
  );
  return Buffer.from(XLSX.write(value, { type: "buffer", bookType: "xlsx" }));
}

function registryRow(
  document: string,
  quantity: number,
  finalBalance: number,
  lot = "006544",
) {
  return [
    "Fondo Nazionale",
    "Prodotto sintetico M3B",
    finalBalance,
    null,
    document,
    "17/09/2026",
    null,
    lot,
    "Ente sintetico",
    null,
    quantity,
    finalBalance,
    null,
    "fixture sintetica",
    null,
    null,
    null,
    null,
    null,
  ];
}

function stockRow(quantity: number, lot = "006544") {
  return [
    "OpN sintetico",
    "OpC sintetico",
    "OpT sintetico",
    "valore-riservato-sintetico",
    "Fondo Nazionale",
    "Prodotto sintetico M3B",
    lot,
    null,
    null,
    null,
    quantity,
    null,
    0,
    false,
    null,
  ];
}

function legacyRegistryRow(
  document: string,
  quantity = 10,
  finalBalance = quantity,
) {
  const row = registryRow(document, quantity, finalBalance);
  row[6] = "17/09/2026";
  return row;
}

function appFor(
  options: {
    isAdmin?: boolean;
    isSuperAdmin?: boolean;
    areaOperativaId?: number | null;
    permissions?: string[];
  } = {},
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: actorId,
      username: `m3b_${suffix}`,
      matricola: `M3B-${suffix}`,
      isAdmin: options.isAdmin ?? false,
      isSuperAdmin: options.isSuperAdmin ?? false,
      aree: ["magazzino"],
      permessi: options.permissions ?? [
        "magazzino.view",
        "magazzino.stock.receive",
        "magazzino.stock.adjust",
        "magazzino.agea.view",
        "magazzino.agea.import",
        "magazzino.agea.mapping.manage",
        "magazzino.agea.bootstrap",
        "magazzino.products.manage",
      ],
      centroAscoltoId: null,
      areaOperativaId:
        options.areaOperativaId === undefined
          ? areaId
          : options.areaOperativaId,
      zonaUdsId: null,
    };
    next();
  });
  app.use(ageaRouter);
  app.use(fseImportazioniRouter);
  app.use(caricoPraticheRouter);
  return app;
}

async function createEmptyPractice(
  app: Express,
  warehouseId: number,
  context: { areaId?: number; logicalLotId?: number } = {},
) {
  return request(app)
    .post("/carico-pratiche")
    .send({
      areaOperativaId: context.areaId ?? areaId,
      magazzinoId: warehouseId,
      lottoLogicoId: context.logicalLotId ?? logicalLotId,
      origineCarico: "DONAZIONE",
      dataCarico: "2026-09-17",
      descrizione: "Contesto import FSE+ sintetico",
      righe: [],
    });
}

async function upload(
  app: Express,
  input: {
    bytes: Buffer;
    sourceId: number;
    warehouseId: number;
    practiceId: number;
    mode: "NUOVI_CARICHI" | "SALDO_INIZIALE";
    profile: "REGISTRO" | "GIACENZE";
    sessionId?: number;
    fileName?: string;
    areaId?: number;
    logicalLotId?: number;
    referenceDate?: string;
  },
) {
  const query = new URLSearchParams({
    sourceRegistryId: String(input.sourceId),
    areaOperativaId: String(input.areaId ?? areaId),
    magazzinoId: String(input.warehouseId),
    lottoLogicoId: String(input.logicalLotId ?? logicalLotId),
    caricoPraticaId: String(input.practiceId),
    modalita: input.mode,
    profilo: input.profile,
    nomeFile: input.fileName ?? `${input.profile.toLowerCase()}-sintetico.xlsx`,
    ...(input.profile === "GIACENZE"
      ? { dataRiferimento: input.referenceDate ?? "2026-09-17" }
      : {}),
    ...(input.sessionId == null ? {} : { sessionId: String(input.sessionId) }),
  });
  return request(app)
    .post(`/fse-importazioni/analizza?${query.toString()}`)
    .set("Content-Type", "application/octet-stream")
    .send(input.bytes);
}

async function mapProduct(app: Express, sessionId: number, version: number) {
  return request(app)
    .post(`/fse-importazioni/sessioni/${sessionId}/associa-prodotto`)
    .send({
      versione: version,
      descrizioneEsterna: "Prodotto sintetico M3B",
      prodottoId: productId,
      motivo: "Associazione fixture sintetica M3B",
      accettaFallbackData: true,
    });
}

async function analyzeLegacy(
  app: Express,
  warehouseId: number,
  bytes: Buffer,
  fileName: string,
) {
  return request(app)
    .post("/agea/importazioni/analizza")
    .query({
      magazzinoId: warehouseId,
      modalita: "PRIMA_ACQUISIZIONE",
      nomeFile: fileName,
    })
    .set("Content-Type", AGEA_XLSX_MIME)
    .send(bytes);
}

async function waitForPendingMovementShareLock() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const pending = await pool.query<{ waiting: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND relation = 'movimenti'::regclass
          AND mode = 'ShareLock'
          AND NOT granted
      ) AS waiting
    `);
    if (pending.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Il lock ShareLock M3B non è entrato in attesa");
}

async function prepareOrdinaryImport(
  app: Express,
  input: {
    warehouseId: number;
    sourceId: number;
    document: string;
    quantity?: number;
    finalBalance?: number;
    fileName?: string;
  },
) {
  const practice = await createEmptyPractice(app, input.warehouseId);
  expect(practice.status).toBe(201);
  const acquired = await upload(app, {
    bytes: workbook(registryHeaders, [
      registryRow(
        input.document,
        input.quantity ?? 10,
        input.finalBalance ?? input.quantity ?? 10,
      ),
    ]),
    sourceId: input.sourceId,
    warehouseId: input.warehouseId,
    practiceId: practice.body.id,
    mode: "NUOVI_CARICHI",
    profile: "REGISTRO",
    fileName: input.fileName,
  });
  expect(acquired.status).toBe(201);
  const mapped = await mapProduct(
    app,
    acquired.body.sessionId,
    acquired.body.versione,
  );
  expect(mapped.status).toBe(200);
  const detail = await request(app).get(
    `/fse-importazioni/sessioni/${acquired.body.sessionId}`,
  );
  expect(detail.status).toBe(200);
  expect(detail.body.summary.ready).toBe(1);
  return { practice, acquired, detail };
}

beforeAll(async () => {
  const required = await pool.query(`
    SELECT count(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'fse_import_sessions',
        'fse_import_attach_commands',
        'fse_movement_claims',
        'fse_initial_balance_coverage'
      )
  `);
  if (required.rows[0].count !== 4)
    throw new Error("Applicare la migrazione M3B al database disposable");

  await ensureAmbienteModuli();
  originalLottiEnabled =
    (await listModuliFunzionali()).find((item) => item.codice === "LOTTI")
      ?.attivo ?? true;
  await updateModuloAmbiente("LOTTI", true, null);

  [{ id: actorId }] = await db
    .insert(utentiTable)
    .values({
      username: `m3b_${suffix}`,
      passwordHash: "fixture-only",
      nome: "Operatore",
      cognome: "M3B",
    })
    .returning({ id: utentiTable.id });
  [{ id: areaId }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `M3B Area ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  [{ id: logicalLotId }] = await db
    .insert(lottiLogiciTable)
    .values({
      areaOperativaId: areaId,
      codice: "GENERALE",
      descrizione: "Generale",
      isGenerale: true,
    })
    .returning({ id: lottiLogiciTable.id });
  [{ id: ordinaryWarehouseId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `M3BO-${suffix}`.slice(0, 20),
      nome: "M3B ordinario",
      areaOperativaId: areaId,
    })
    .returning({ id: magazziniTable.id });
  [{ id: initialWarehouseId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `M3BI-${suffix}`.slice(0, 20),
      nome: "M3B saldo iniziale",
      areaOperativaId: areaId,
    })
    .returning({ id: magazziniTable.id });
  [{ id: incompleteBalanceWarehouseId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `M3BX-${suffix}`.slice(0, 20),
      nome: "M3B saldo incompleto",
      areaOperativaId: areaId,
    })
    .returning({ id: magazziniTable.id });
  [{ id: productId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `M3BP-${suffix}`.slice(0, 30),
      nome: "Prodotto sintetico M3B",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
      quantitaFrazionabile: false,
      lottoFisicoObbligatorio: false,
      gestioneScadenza: false,
    })
    .returning({ id: prodottiTable.id });
  [{ id: ordinarySourceId }] = await db
    .insert(fseSourceRegistriesTable)
    .values({
      codice: `M3B-ORD-${suffix}`,
      descrizione: "Sorgente ordinaria sintetica",
      areaOperativaId: areaId,
      creatoDa: actorId,
    })
    .returning({ id: fseSourceRegistriesTable.id });
  [{ id: initialSourceId }] = await db
    .insert(fseSourceRegistriesTable)
    .values({
      codice: `M3B-SALDO-${suffix}`,
      descrizione: "Sorgente saldo sintetica",
      areaOperativaId: areaId,
      creatoDa: actorId,
    })
    .returning({ id: fseSourceRegistriesTable.id });
  [{ id: incompleteBalanceSourceId }] = await db
    .insert(fseSourceRegistriesTable)
    .values({
      codice: `M3B-INCOMPLETO-${suffix}`,
      descrizione: "Sorgente saldo incompleto sintetica",
      areaOperativaId: areaId,
      creatoDa: actorId,
    })
    .returning({ id: fseSourceRegistriesTable.id });
  await db
    .insert(mappatureProdottiEsterniTable)
    .values({
      fonte: "AGEA_SIFEAD",
      sourceRegistryId: null,
      descrizioneEsterna: "Prodotto sintetico M3B",
      chiaveDescrizioneNormalizzata: "PRODOTTO SINTETICO M3B",
      prodottoId: productId,
      creatoDa: actorId,
      aggiornatoDa: actorId,
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await updateModuloAmbiente("LOTTI", originalLottiEnabled, null);
  await pool.end();
});

describe("M3B — import FSE+ nella pratica Carico Merce", () => {
  it("riserva la configurazione sorgente agli amministratori e serializza i codici duplicati", async () => {
    const code = `M3B-ADMIN-${suffix}`;
    const payload = {
      codice: code,
      descrizione: "Sorgente configurata da amministratore",
      areaOperativaId: areaId,
    };
    const denied = await request(appFor())
      .post("/fse-importazioni/sorgenti")
      .send(payload);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("CONFIGURAZIONE_SORGENTE_RISERVATA");

    const admin = appFor({ isAdmin: true });
    const attempts = await Promise.all([
      request(admin).post("/fse-importazioni/sorgenti").send(payload),
      request(admin).post("/fse-importazioni/sorgenti").send(payload),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
  });

  it("riprende un import parziale, rende idempotente il comando e non muove stock prima di Registra", async () => {
    const app = appFor();
    const created = await createEmptyPractice(app, ordinaryWarehouseId);
    expect(created.status).toBe(201);

    const bytes = workbook(registryHeaders, [
      registryRow("DOC-80", 80, 100),
      registryRow("DOC-20", 20, 100),
    ]);
    const acquired = await upload(app, {
      bytes,
      sourceId: ordinarySourceId,
      warehouseId: ordinaryWarehouseId,
      practiceId: created.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
    });
    expect(acquired.status).toBe(201);

    const replayUpload = await upload(app, {
      bytes,
      sourceId: ordinarySourceId,
      warehouseId: ordinaryWarehouseId,
      practiceId: created.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
    });
    expect(replayUpload.status).toBe(200);
    expect(replayUpload.body).toMatchObject({
      sessionId: acquired.body.sessionId,
      replay: true,
    });

    const mapped = await mapProduct(
      app,
      acquired.body.sessionId,
      acquired.body.versione,
    );
    expect(mapped.status).toBe(200);
    const detail = await request(app).get(
      `/fse-importazioni/sessioni/${acquired.body.sessionId}`,
    );
    expect(detail.body.summary.ready).toBe(2);

    const firstCommand = {
      versione: detail.body.versione,
      versionePratica: created.body.versione,
      rigaIds: [detail.body.rows[0].id],
      idempotencyKey: `m3b-attach-80-${suffix}`,
    };
    const firstAttach = await request(app)
      .post(
        `/fse-importazioni/sessioni/${acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send(firstCommand);
    expect(firstAttach.status).toBe(201);
    expect(firstAttach.body).toMatchObject({ addedRows: 1, replay: false });

    const incompatibleRetry = await request(app)
      .post(
        `/fse-importazioni/sessioni/${acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        ...firstCommand,
        rigaIds: [detail.body.rows[1].id],
      });
    expect(incompatibleRetry.status).toBe(409);
    expect(incompatibleRetry.body.code).toBe("IDEMPOTENCY_KEY_RIUSATA");

    const retry = await request(app)
      .post(
        `/fse-importazioni/sessioni/${acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send(firstCommand);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ addedRows: 1, replay: true });

    const resumed = await request(app).get(
      `/fse-importazioni/sessioni/${acquired.body.sessionId}`,
    );
    const secondAttach = await request(app)
      .post(
        `/fse-importazioni/sessioni/${acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: resumed.body.versione,
        versionePratica: firstAttach.body.practiceVersion,
        rigaIds: [
          resumed.body.rows.find(
            (row: { stato: string }) => row.stato === "PRONTO",
          ).id,
        ],
        idempotencyKey: `m3b-attach-20-${suffix}`,
      });
    expect(secondAttach.status).toBe(201);

    const practice = await request(app).get(
      `/carico-pratiche/${created.body.id}`,
    );
    expect(practice.body).toMatchObject({
      origineCarico: "AGEA_SIFEAD",
      tipoPratica: "ORDINARIA",
    });
    expect(
      practice.body.righe.map(
        (row: { numeroDocumentoEsterno: string }) => row.numeroDocumentoEsterno,
      ),
    ).toEqual(["DOC-80", "DOC-20"]);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, ordinaryWarehouseId)),
    ).toHaveLength(0);

    const forbiddenManualEdit = await request(app)
      .patch(
        `/carico-pratiche/${created.body.id}/righe/${practice.body.righe[0].id}`,
      )
      .send({ versione: practice.body.versione, quantita: "81" });
    expect(forbiddenManualEdit.status).toBe(409);

    const registered = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send({
        versione: practice.body.versione,
        rigaIds: practice.body.righe.map((row: { id: number }) => row.id),
        idempotencyKey: `m3b-register-ordinary-${suffix}`,
      });
    expect(registered.status).toBe(201);

    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, ordinaryWarehouseId));
    expect(
      movements.map((movement) => Number(movement.quantita)).sort(),
    ).toEqual([20, 80]);
    const claims = await db
      .select()
      .from(fseMovementClaimsTable)
      .where(eq(fseMovementClaimsTable.sourceRegistryId, ordinarySourceId));
    expect(claims.map((claim) => claim.stato)).toEqual([
      "REGISTRATA",
      "REGISTRATA",
    ]);
  });

  it("non rimappa righe già riservate durante la ripresa parziale", async () => {
    const app = appFor();
    const created = await createEmptyPractice(app, ordinaryWarehouseId);
    const acquired = await upload(app, {
      bytes: workbook(registryHeaders, [
        registryRow(`DOC-MAP-A-${suffix}`, 4, 9),
        registryRow(`DOC-MAP-B-${suffix}`, 5, 9),
      ]),
      sourceId: ordinarySourceId,
      warehouseId: ordinaryWarehouseId,
      practiceId: created.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
    });
    const firstMapping = await mapProduct(
      app,
      acquired.body.sessionId,
      acquired.body.versione,
    );
    expect(firstMapping.status).toBe(200);
    const detail = await request(app).get(
      `/fse-importazioni/sessioni/${acquired.body.sessionId}`,
    );
    const attached = await request(app)
      .post(
        `/fse-importazioni/sessioni/${acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: detail.body.versione,
        versionePratica: created.body.versione,
        rigaIds: [detail.body.rows[0].id],
        idempotencyKey: `m3b-map-one-${suffix}`,
      });
    expect(attached.status).toBe(201);

    const [{ id: replacementProductId }] = await db
      .insert(prodottiTable)
      .values({
        codice: `M3BMAP-${suffix}`.slice(0, 30),
        nome: "Prodotto mapping sostitutivo",
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
        quantitaFrazionabile: false,
      })
      .returning({ id: prodottiTable.id });
    const resumed = await request(app).get(
      `/fse-importazioni/sessioni/${acquired.body.sessionId}`,
    );
    const remapped = await request(app)
      .post(
        `/fse-importazioni/sessioni/${acquired.body.sessionId}/associa-prodotto`,
      )
      .send({
        versione: resumed.body.versione,
        descrizioneEsterna: "Prodotto sintetico M3B",
        prodottoId: replacementProductId,
        motivo: "Cambio mapping durante ripresa parziale",
        accettaFallbackData: true,
      });
    expect(remapped.status).toBe(200);
    const persisted = await db
      .select({
        id: fseImportRowsTable.id,
        productId: fseImportRowsTable.prodottoId,
        state: fseImportRowsTable.stato,
      })
      .from(fseImportRowsTable)
      .where(eq(fseImportRowsTable.sessioneId, acquired.body.sessionId));
    expect(
      persisted.find((row) => row.id === detail.body.rows[0].id),
    ).toMatchObject({ productId, state: "GIA_NELLA_PRATICA" });
    expect(
      persisted.find((row) => row.id === detail.body.rows[1].id),
    ).toMatchObject({ productId: replacementProductId, state: "PRONTO" });
  });

  it("impedisce due claim concorrenti della stessa sorgente anche su magazzini diversi", async () => {
    const app = appFor();
    const [{ id: secondWarehouseId }] = await db
      .insert(magazziniTable)
      .values({
        codice: `M3BC-${suffix}`.slice(0, 20),
        nome: "M3B concorrenza altro deposito",
        areaOperativaId: areaId,
      })
      .returning({ id: magazziniTable.id });
    const document = `DOC-CONCURRENT-${suffix}`;
    const first = await prepareOrdinaryImport(app, {
      warehouseId: ordinaryWarehouseId,
      sourceId: ordinarySourceId,
      document,
      quantity: 10,
      finalBalance: 10,
      fileName: "concorrenza-a.xlsx",
    });
    const second = await prepareOrdinaryImport(app, {
      warehouseId: secondWarehouseId,
      sourceId: ordinarySourceId,
      document,
      quantity: 10,
      finalBalance: 999,
      fileName: "concorrenza-b.xlsx",
    });
    const responses = await Promise.all([
      request(app)
        .post(
          `/fse-importazioni/sessioni/${first.acquired.body.sessionId}/aggiungi-pratica`,
        )
        .send({
          versione: first.detail.body.versione,
          versionePratica: first.practice.body.versione,
          rigaIds: [first.detail.body.rows[0].id],
          idempotencyKey: `m3b-concurrent-a-${suffix}`,
        }),
      request(app)
        .post(
          `/fse-importazioni/sessioni/${second.acquired.body.sessionId}/aggiungi-pratica`,
        )
        .send({
          versione: second.detail.body.versione,
          versionePratica: second.practice.body.versione,
          rigaIds: [second.detail.body.rows[0].id],
          idempotencyKey: `m3b-concurrent-b-${suffix}`,
        }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const identity = first.detail.body.rows[0].id;
    const [sourceRow] = await db
      .select({ identity: fseImportRowsTable.semanticIdentityHash })
      .from(fseImportRowsTable)
      .where(eq(fseImportRowsTable.id, identity));
    expect(
      await db
        .select()
        .from(fseMovementClaimsTable)
        .where(
          and(
            eq(fseMovementClaimsTable.sourceRegistryId, ordinarySourceId),
            eq(fseMovementClaimsTable.semanticIdentityHash, sourceRow.identity),
          ),
        ),
    ).toHaveLength(1);
  });

  it("riconosce come da verificare un evento legacy applicato in un altro magazzino della stessa Area", async () => {
    const [{ id: legacyAreaId }] = await db
      .insert(areeOperativeTable)
      .values({ nome: `M3B legacy prima ${suffix}` })
      .returning({ id: areeOperativeTable.id });
    const [{ id: legacyLotId }] = await db
      .insert(lottiLogiciTable)
      .values({
        areaOperativaId: legacyAreaId,
        codice: "GENERALE",
        descrizione: "Generale",
        isGenerale: true,
      })
      .returning({ id: lottiLogiciTable.id });
    const [warehouseA, warehouseB] = await db
      .insert(magazziniTable)
      .values([
        {
          codice: `M3BLA-${suffix}`.slice(0, 20),
          nome: "M3B nuovo dopo legacy",
          areaOperativaId: legacyAreaId,
        },
        {
          codice: `M3BLB-${suffix}`.slice(0, 20),
          nome: "M3B legacy origine",
          areaOperativaId: legacyAreaId,
        },
      ])
      .returning({ id: magazziniTable.id });
    const scopedApp = appFor({ areaOperativaId: legacyAreaId });
    const bytes = workbook(registryHeaders, [
      legacyRegistryRow(`DOC-LEGACY-FIRST-${suffix}`),
    ]);
    const analyzed = await analyzeLegacy(
      scopedApp,
      warehouseB.id,
      bytes,
      "legacy-prima.xlsx",
    );
    expect(analyzed.status).toBe(201);
    const confirmed = await request(scopedApp)
      .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
      .send({ versione: analyzed.body.versione });
    expect(confirmed.status).toBe(200);

    const sourceCreated = await request(
      appFor({ isAdmin: true, areaOperativaId: legacyAreaId }),
    )
      .post("/fse-importazioni/sorgenti")
      .send({
        codice: `M3B-LEGACY-FIRST-${suffix}`,
        descrizione: "Sorgente registrata dopo il writer legacy",
        areaOperativaId: legacyAreaId,
      });
    expect(sourceCreated.status).toBe(201);
    const practice = await createEmptyPractice(scopedApp, warehouseA.id, {
      areaId: legacyAreaId,
      logicalLotId: legacyLotId,
    });
    const acquired = await upload(scopedApp, {
      bytes,
      sourceId: sourceCreated.body.id,
      warehouseId: warehouseA.id,
      practiceId: practice.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
      areaId: legacyAreaId,
      logicalLotId: legacyLotId,
    });
    expect(acquired.status).toBe(201);
    let detail = await request(scopedApp).get(
      `/fse-importazioni/sessioni/${acquired.body.sessionId}`,
    );
    expect(detail.body.rows[0]).toMatchObject({ stato: "DA_VERIFICARE" });
    expect(detail.body.rows[0].warningCodes).toContain(
      "LEGACY_MATCH_ALTRO_MAGAZZINO_DA_VERIFICARE",
    );
    const mapped = await mapProduct(
      scopedApp,
      acquired.body.sessionId,
      detail.body.versione,
    );
    expect(mapped.status).toBe(200);
    detail = await request(scopedApp).get(
      `/fse-importazioni/sessioni/${acquired.body.sessionId}`,
    );
    expect(detail.body.rows[0]).toMatchObject({ stato: "DA_VERIFICARE" });
    expect(detail.body.rows[0].warningCodes).toContain(
      "LEGACY_MATCH_ALTRO_MAGAZZINO_DA_VERIFICARE",
    );
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, warehouseA.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, warehouseB.id)),
    ).toHaveLength(1);
  });

  it("blocca il writer legacy in un altro magazzino dopo l'attivazione della sorgente M3B", async () => {
    const app = appFor();
    const [warehouseA, warehouseB] = await db
      .insert(magazziniTable)
      .values([
        {
          codice: `M3BNA-${suffix}`.slice(0, 20),
          nome: "M3B writer nuovo",
          areaOperativaId: areaId,
        },
        {
          codice: `M3BNB-${suffix}`.slice(0, 20),
          nome: "M3B writer legacy bloccato",
          areaOperativaId: areaId,
        },
      ])
      .returning({ id: magazziniTable.id });
    const document = `DOC-M3B-FIRST-${suffix}`;
    const prepared = await prepareOrdinaryImport(app, {
      warehouseId: warehouseA.id,
      sourceId: ordinarySourceId,
      document,
    });
    const attached = await request(app)
      .post(
        `/fse-importazioni/sessioni/${prepared.acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: prepared.detail.body.versione,
        versionePratica: prepared.practice.body.versione,
        rigaIds: [prepared.detail.body.rows[0].id],
        idempotencyKey: `m3b-before-legacy-${suffix}`,
      });
    expect(attached.status).toBe(201);
    const practice = await request(app).get(
      `/carico-pratiche/${prepared.practice.body.id}`,
    );
    const registered = await request(app)
      .post(`/carico-pratiche/${prepared.practice.body.id}/registra`)
      .send({
        versione: practice.body.versione,
        rigaIds: practice.body.righe.map((row: { id: number }) => row.id),
        idempotencyKey: `m3b-before-legacy-register-${suffix}`,
      });
    expect(registered.status).toBe(201);

    const legacy = await analyzeLegacy(
      app,
      warehouseB.id,
      workbook(registryHeaders, [legacyRegistryRow(document)]),
      "legacy-dopo-m3b.xlsx",
    );
    expect(legacy.status).toBe(201);
    const rejected = await request(app)
      .post(`/agea/importazioni/${legacy.body.id}/conferma`)
      .send({ versione: legacy.body.versione });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe("SORGENTE_GESTITA_DA_M3B");
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, warehouseB.id)),
    ).toHaveLength(0);
  });

  it("classifica come dato modificato la stessa identità senza applicare delta o nuovo carico", async () => {
    const app = appFor();
    const [{ id: warehouseId }] = await db
      .insert(magazziniTable)
      .values({
        codice: `M3BDM-${suffix}`.slice(0, 20),
        nome: "M3B dato modificato",
        areaOperativaId: areaId,
      })
      .returning({ id: magazziniTable.id });
    const document = `DOC-MODIFIED-${suffix}`;
    const first = await prepareOrdinaryImport(app, {
      warehouseId,
      sourceId: ordinarySourceId,
      document,
      quantity: 10,
      finalBalance: 10,
    });
    const attached = await request(app)
      .post(
        `/fse-importazioni/sessioni/${first.acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: first.detail.body.versione,
        versionePratica: first.practice.body.versione,
        rigaIds: [first.detail.body.rows[0].id],
        idempotencyKey: `m3b-modified-first-${suffix}`,
      });
    expect(attached.status).toBe(201);
    const firstPractice = await request(app).get(
      `/carico-pratiche/${first.practice.body.id}`,
    );
    const registered = await request(app)
      .post(`/carico-pratiche/${first.practice.body.id}/registra`)
      .send({
        versione: firstPractice.body.versione,
        rigaIds: firstPractice.body.righe.map((row: { id: number }) => row.id),
        idempotencyKey: `m3b-modified-register-${suffix}`,
      });
    expect(registered.status).toBe(201);

    const secondPractice = await createEmptyPractice(app, warehouseId);
    const changed = await upload(app, {
      bytes: workbook(registryHeaders, [registryRow(document, 12, 12)]),
      sourceId: ordinarySourceId,
      warehouseId,
      practiceId: secondPractice.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
      fileName: "stessa-identita-contenuto-modificato.xlsx",
    });
    expect(changed.status).toBe(201);
    const detail = await request(app).get(
      `/fse-importazioni/sessioni/${changed.body.sessionId}`,
    );
    expect(detail.body.rows[0]).toMatchObject({ stato: "DATO_MODIFICATO" });
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, warehouseId));
    expect(movements).toHaveLength(1);
    expect(Number(movements[0].quantita)).toBe(10);
  });

  it("nega dettaglio e replay dopo la revoca dello scope senza esporre dati della sessione", async () => {
    const app = appFor();
    const prepared = await prepareOrdinaryImport(app, {
      warehouseId: ordinaryWarehouseId,
      sourceId: ordinarySourceId,
      document: `DOC-SCOPE-${suffix}`,
    });
    const [{ id: foreignAreaId }] = await db
      .insert(areeOperativeTable)
      .values({ nome: `M3B scope revocato ${suffix}` })
      .returning({ id: areeOperativeTable.id });
    const revoked = appFor({ areaOperativaId: foreignAreaId });
    const detail = await request(revoked).get(
      `/fse-importazioni/sessioni/${prepared.acquired.body.sessionId}`,
    );
    expect(detail.status).toBe(403);
    expect(JSON.stringify(detail.body)).not.toContain(`DOC-SCOPE-${suffix}`);
    const attach = await request(revoked)
      .post(
        `/fse-importazioni/sessioni/${prepared.acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: prepared.detail.body.versione,
        versionePratica: prepared.practice.body.versione,
        rigaIds: [prepared.detail.body.rows[0].id],
        idempotencyKey: `m3b-scope-denied-${suffix}`,
      });
    expect(attach.status).toBe(403);
    expect(JSON.stringify(attach.body)).not.toContain(`DOC-SCOPE-${suffix}`);
  });

  it("rilascia e traccia una claim annullata prima della contabilizzazione", async () => {
    const app = appFor();
    const [{ id: warehouseId }] = await db
      .insert(magazziniTable)
      .values({
        codice: `M3BRL-${suffix}`.slice(0, 20),
        nome: "M3B rilascio claim",
        areaOperativaId: areaId,
      })
      .returning({ id: magazziniTable.id });
    const prepared = await prepareOrdinaryImport(app, {
      warehouseId,
      sourceId: ordinarySourceId,
      document: `DOC-RELEASE-${suffix}`,
    });
    const attached = await request(app)
      .post(
        `/fse-importazioni/sessioni/${prepared.acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: prepared.detail.body.versione,
        versionePratica: prepared.practice.body.versione,
        rigaIds: [prepared.detail.body.rows[0].id],
        idempotencyKey: `m3b-release-${suffix}`,
      });
    expect(attached.status).toBe(201);
    const cancelled = await request(app)
      .post(`/carico-pratiche/${prepared.practice.body.id}/annulla`)
      .send({
        versione: attached.body.practiceVersion,
        motivo: "Bozza FSE annullata per test claim",
      });
    expect(cancelled.status).toBe(200);
    const [claim] = await db
      .select()
      .from(fseMovementClaimsTable)
      .where(eq(fseMovementClaimsTable.sourceRegistryId, ordinarySourceId))
      .orderBy(fseMovementClaimsTable.id);
    const released = (
      await db
        .select()
        .from(fseMovementClaimsTable)
        .where(
          eq(
            fseMovementClaimsTable.semanticIdentityHash,
            (
              await db
                .select({ value: fseImportRowsTable.semanticIdentityHash })
                .from(fseImportRowsTable)
                .where(
                  eq(fseImportRowsTable.id, prepared.detail.body.rows[0].id),
                )
            )[0].value,
          ),
        )
    )[0];
    expect(claim).toBeTruthy();
    expect(released).toMatchObject({
      stato: "RILASCIATA",
      caricoPraticaRigaId: null,
    });
    expect(
      await db
        .select()
        .from(auditEventiTable)
        .where(eq(auditEventiTable.azione, "FSE_IMPORT_CLAIM_RILASCIATA")),
    ).not.toHaveLength(0);
    const [session] = await db
      .select()
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.id, prepared.acquired.body.sessionId));
    expect(session.stato).toBe("ANNULLATA");
  });

  it("fa rollback di pratica, claim e stock quando l'audit fallisce", async () => {
    const app = appFor();
    const [{ id: warehouseId }] = await db
      .insert(magazziniTable)
      .values({
        codice: `M3BAR-${suffix}`.slice(0, 20),
        nome: "M3B rollback audit",
        areaOperativaId: areaId,
      })
      .returning({ id: magazziniTable.id });
    const prepared = await prepareOrdinaryImport(app, {
      warehouseId,
      sourceId: ordinarySourceId,
      document: `DOC-AUDIT-${suffix}`,
    });
    const attachKey = `m3b-audit-attach-${suffix}`;
    await pool.query(`CREATE OR REPLACE FUNCTION test_m3b_audit_failure()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.operation_key IN ('m3b:${attachKey}', 'm3a:m3b-audit-register-${suffix}') THEN
          RAISE EXCEPTION 'synthetic M3B audit failure';
        END IF;
        RETURN NEW;
      END $$`);
    await pool.query(
      "DROP TRIGGER IF EXISTS test_m3b_audit_failure_trigger ON audit_eventi",
    );
    await pool.query(`CREATE TRIGGER test_m3b_audit_failure_trigger
      BEFORE INSERT ON audit_eventi
      FOR EACH ROW EXECUTE FUNCTION test_m3b_audit_failure()`);
    try {
      const failedAttach = await request(app)
        .post(
          `/fse-importazioni/sessioni/${prepared.acquired.body.sessionId}/aggiungi-pratica`,
        )
        .send({
          versione: prepared.detail.body.versione,
          versionePratica: prepared.practice.body.versione,
          rigaIds: [prepared.detail.body.rows[0].id],
          idempotencyKey: attachKey,
        });
      expect(failedAttach.status).toBe(500);
      expect(
        await db
          .select()
          .from(fseImportAttachCommandsTable)
          .where(eq(fseImportAttachCommandsTable.idempotencyKey, attachKey)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(caricoPraticaRigheTable)
          .where(
            eq(
              caricoPraticaRigheTable.caricoPraticaId,
              prepared.practice.body.id,
            ),
          ),
      ).toHaveLength(0);
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS test_m3b_audit_failure_trigger ON audit_eventi",
      );
    }

    const refreshed = await request(app).get(
      `/fse-importazioni/sessioni/${prepared.acquired.body.sessionId}`,
    );
    const attached = await request(app)
      .post(
        `/fse-importazioni/sessioni/${prepared.acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: refreshed.body.versione,
        versionePratica: prepared.practice.body.versione,
        rigaIds: [refreshed.body.rows[0].id],
        idempotencyKey: `m3b-audit-attach-ok-${suffix}`,
      });
    expect(attached.status).toBe(201);
    await pool.query(`CREATE TRIGGER test_m3b_audit_failure_trigger
      BEFORE INSERT ON audit_eventi
      FOR EACH ROW EXECUTE FUNCTION test_m3b_audit_failure()`);
    try {
      const practice = await request(app).get(
        `/carico-pratiche/${prepared.practice.body.id}`,
      );
      const failedRegistration = await request(app)
        .post(`/carico-pratiche/${prepared.practice.body.id}/registra`)
        .send({
          versione: practice.body.versione,
          rigaIds: practice.body.righe.map((row: { id: number }) => row.id),
          idempotencyKey: `m3b-audit-register-${suffix}`,
        });
      expect(failedRegistration.status).toBe(500);
      expect(
        await db
          .select()
          .from(movimentiTable)
          .where(eq(movimentiTable.magazzinoId, warehouseId)),
      ).toHaveLength(0);
      const [claim] = await db
        .select()
        .from(fseMovementClaimsTable)
        .where(
          eq(
            fseMovementClaimsTable.caricoPraticaRigaId,
            practice.body.righe[0].id,
          ),
        );
      expect(claim.stato).toBe("RISERVATA");
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS test_m3b_audit_failure_trigger ON audit_eventi",
      );
      await pool.query("DROP FUNCTION IF EXISTS test_m3b_audit_failure()");
    }
  });

  it("blocca un saldo iniziale se il Registro ha un saldo positivo assente dalle Giacenze", async () => {
    const app = appFor();
    const created = await createEmptyPractice(
      app,
      incompleteBalanceWarehouseId,
    );
    const registry = await upload(app, {
      bytes: workbook(registryHeaders, [
        registryRow("DOC-PRESENTE", 10, 10, "006544"),
        registryRow("DOC-MANCANTE", 5, 5, "006545"),
      ]),
      sourceId: incompleteBalanceSourceId,
      warehouseId: incompleteBalanceWarehouseId,
      practiceId: created.body.id,
      mode: "SALDO_INIZIALE",
      profile: "REGISTRO",
    });
    const stock = await upload(app, {
      bytes: workbook(stockHeaders, [stockRow(10, "006544")]),
      sourceId: incompleteBalanceSourceId,
      warehouseId: incompleteBalanceWarehouseId,
      practiceId: created.body.id,
      mode: "SALDO_INIZIALE",
      profile: "GIACENZE",
      sessionId: registry.body.sessionId,
    });
    const mapped = await mapProduct(
      app,
      registry.body.sessionId,
      stock.body.versione,
    );
    expect(mapped.status).toBe(200);
    const detail = await request(app).get(
      `/fse-importazioni/sessioni/${registry.body.sessionId}`,
    );
    const attach = await request(app)
      .post(
        `/fse-importazioni/sessioni/${registry.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: detail.body.versione,
        versionePratica: created.body.versione,
        confermaCoperturaStorica: true,
        idempotencyKey: `m3b-attach-incomplete-${suffix}`,
      });
    expect(attach.status).toBe(409);
    expect(attach.body.code).toBe("SALDO_POSITIVO_SENZA_GIACENZA");
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, incompleteBalanceWarehouseId)),
    ).toHaveLength(0);
  });

  it.each([
    ["quantita-diversa", "SALDO_NON_RICONCILIATO"],
    ["solo-giacenze", "SALDO_SENZA_REGISTRO"],
    ["data-diversa", "DATE_RIFERIMENTO_INCOERENTI"],
  ] as const)(
    "blocca il saldo iniziale non riconciliato: %s",
    async (caseId, expectedCode) => {
      const app = appFor();
      const [{ id: warehouseId }] = await db
        .insert(magazziniTable)
        .values({
          codice: `M3BN${caseId[0]}-${suffix}`.slice(0, 20),
          nome: `M3B saldo negativo ${caseId}`,
          areaOperativaId: areaId,
        })
        .returning({ id: magazziniTable.id });
      const [{ id: sourceId }] = await db
        .insert(fseSourceRegistriesTable)
        .values({
          codice: `M3B-NEG-${caseId}-${suffix}`,
          descrizione: `Sorgente negativa ${caseId}`,
          areaOperativaId: areaId,
          creatoDa: actorId,
        })
        .returning({ id: fseSourceRegistriesTable.id });
      const practice = await createEmptyPractice(app, warehouseId);
      const registry = await upload(app, {
        bytes: workbook(registryHeaders, [
          registryRow(`DOC-NEG-${caseId}-${suffix}`, 10, 10, "006544"),
        ]),
        sourceId,
        warehouseId,
        practiceId: practice.body.id,
        mode: "SALDO_INIZIALE",
        profile: "REGISTRO",
      });
      const stockRows =
        caseId === "solo-giacenze"
          ? [stockRow(10, "006544"), stockRow(1, "LOT-SOLO-STOCK")]
          : [stockRow(caseId === "quantita-diversa" ? 9 : 10, "006544")];
      const stock = await upload(app, {
        bytes: workbook(stockHeaders, stockRows),
        sourceId,
        warehouseId,
        practiceId: practice.body.id,
        mode: "SALDO_INIZIALE",
        profile: "GIACENZE",
        sessionId: registry.body.sessionId,
        referenceDate: caseId === "data-diversa" ? "2026-09-18" : "2026-09-17",
      });
      const mapped = await mapProduct(
        app,
        registry.body.sessionId,
        stock.body.versione,
      );
      expect(mapped.status).toBe(200);
      const detail = await request(app).get(
        `/fse-importazioni/sessioni/${registry.body.sessionId}`,
      );
      const rejected = await request(app)
        .post(
          `/fse-importazioni/sessioni/${registry.body.sessionId}/aggiungi-pratica`,
        )
        .send({
          versione: detail.body.versione,
          versionePratica: practice.body.versione,
          confermaCoperturaStorica: true,
          idempotencyKey: `m3b-negative-${caseId}-${suffix}`,
        });
      expect(rejected.status).toBe(409);
      expect(rejected.body.code).toBe(expectedCode);
      expect(
        await db
          .select()
          .from(movimentiTable)
          .where(eq(movimentiTable.magazzinoId, warehouseId)),
      ).toHaveLength(0);
    },
  );

  it("serializza il saldo con un writer inventariale già in volo e lascia la proposta assente", async () => {
    const app = appFor();
    const [{ id: warehouseId }] = await db
      .insert(magazziniTable)
      .values({
        codice: `M3BRACE-${suffix}`.slice(0, 20),
        nome: "M3B saldo contro writer in volo",
        areaOperativaId: areaId,
      })
      .returning({ id: magazziniTable.id });
    const [{ id: sourceId }] = await db
      .insert(fseSourceRegistriesTable)
      .values({
        codice: `M3B-RACE-${suffix}`,
        descrizione: "Sorgente saldo concorrente",
        areaOperativaId: areaId,
        creatoDa: actorId,
      })
      .returning({ id: fseSourceRegistriesTable.id });
    const practice = await createEmptyPractice(app, warehouseId);
    const registry = await upload(app, {
      bytes: workbook(registryHeaders, [
        registryRow(`DOC-RACE-${suffix}`, 10, 10),
      ]),
      sourceId,
      warehouseId,
      practiceId: practice.body.id,
      mode: "SALDO_INIZIALE",
      profile: "REGISTRO",
    });
    const stock = await upload(app, {
      bytes: workbook(stockHeaders, [stockRow(10)]),
      sourceId,
      warehouseId,
      practiceId: practice.body.id,
      mode: "SALDO_INIZIALE",
      profile: "GIACENZE",
      sessionId: registry.body.sessionId,
    });
    expect(
      await mapProduct(app, registry.body.sessionId, stock.body.versione),
    ).toMatchObject({ status: 200 });
    const detail = await request(app).get(
      `/fse-importazioni/sessioni/${registry.body.sessionId}`,
    );

    const writer = await pool.connect();
    let writerOpen = false;
    try {
      await writer.query("BEGIN");
      writerOpen = true;
      await writer.query(
        `INSERT INTO movimenti (
          tipo_movimento, tipo_dettaglio, data_movimento, magazzino_id,
          prodotto_id, quantita, unita_misura, fondo_origine, natura_contabile
        ) VALUES ('carico', 'carico', '2026-09-17', $1, $2, 1, 'pz', 'NESSUN_FONDO', 'CARICO')`,
        [warehouseId, productId],
      );
      const attachPromise = request(app)
        .post(
          `/fse-importazioni/sessioni/${registry.body.sessionId}/aggiungi-pratica`,
        )
        .send({
          versione: detail.body.versione,
          versionePratica: practice.body.versione,
          confermaCoperturaStorica: true,
          idempotencyKey: `m3b-race-balance-${suffix}`,
        })
        .then((response) => response);
      await waitForPendingMovementShareLock();
      await writer.query("COMMIT");
      writerOpen = false;
      const rejected = await attachPromise;
      expect(rejected.status).toBe(409);
      expect(rejected.body.code).toBe("MAGAZZINO_CON_STORIA");
    } finally {
      if (writerOpen) await writer.query("ROLLBACK");
      writer.release();
    }
    expect(
      await db
        .select()
        .from(fseInitialBalanceCoverageTable)
        .where(eq(fseInitialBalanceCoverageTable.sourceRegistryId, sourceId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(caricoPraticaRigheTable)
        .where(eq(caricoPraticaRigheTable.caricoPraticaId, practice.body.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, warehouseId)),
    ).toHaveLength(1);
  });

  it("prepara e registra il saldo iniziale in modo atomico", async () => {
    const app = appFor();
    const created = await createEmptyPractice(app, initialWarehouseId);
    expect(created.status).toBe(201);

    const registry = await upload(app, {
      bytes: workbook(registryHeaders, [registryRow("DOC-SALDO", 10, 10)]),
      sourceId: initialSourceId,
      warehouseId: initialWarehouseId,
      practiceId: created.body.id,
      mode: "SALDO_INIZIALE",
      profile: "REGISTRO",
    });
    expect(registry.status).toBe(201);
    const stock = await upload(app, {
      bytes: workbook(stockHeaders, [stockRow(10)]),
      sourceId: initialSourceId,
      warehouseId: initialWarehouseId,
      practiceId: created.body.id,
      mode: "SALDO_INIZIALE",
      profile: "GIACENZE",
      sessionId: registry.body.sessionId,
    });
    expect(stock.status).toBe(201);

    const mapped = await mapProduct(
      app,
      registry.body.sessionId,
      stock.body.versione,
    );
    expect(mapped.status).toBe(200);
    const detail = await request(app).get(
      `/fse-importazioni/sessioni/${registry.body.sessionId}`,
    );
    expect(detail.body.summary).toMatchObject({
      stockRows: 1,
      stockPieces: "10.000000",
    });

    const attached = await request(app)
      .post(
        `/fse-importazioni/sessioni/${registry.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: detail.body.versione,
        versionePratica: created.body.versione,
        confermaCoperturaStorica: true,
        idempotencyKey: `m3b-attach-balance-${suffix}`,
      });
    expect(attached.status).toBe(201);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, initialWarehouseId)),
    ).toHaveLength(0);

    await expect(
      db.insert(movimentiTable).values({
        tipoMovimento: "carico",
        tipoDettaglio: "carico",
        dataMovimento: "2026-09-17",
        magazzinoId: initialWarehouseId,
        prodottoId: productId,
        quantita: "1",
        unitaMisura: "pz",
        fondoOrigine: "NESSUN_FONDO",
        naturaContabile: "CARICO",
      }),
    ).rejects.toMatchObject({
      cause: {
        code: "23514",
        constraint: "movimenti_fse_initial_balance_proposal_guard",
      },
    });

    const [{ id: competingSourceId }] = await db
      .insert(fseSourceRegistriesTable)
      .values({
        codice: `M3B-SALDO-COMP-${suffix}`,
        descrizione: "Sorgente concorrente sullo stesso deposito",
        areaOperativaId: areaId,
        creatoDa: actorId,
      })
      .returning({ id: fseSourceRegistriesTable.id });
    const competingPractice = await createEmptyPractice(
      app,
      initialWarehouseId,
    );
    const competingRegistry = await upload(app, {
      bytes: workbook(registryHeaders, [
        registryRow(`DOC-SALDO-COMP-${suffix}`, 10, 10),
      ]),
      sourceId: competingSourceId,
      warehouseId: initialWarehouseId,
      practiceId: competingPractice.body.id,
      mode: "SALDO_INIZIALE",
      profile: "REGISTRO",
    });
    const competingStock = await upload(app, {
      bytes: workbook(stockHeaders, [stockRow(10)]),
      sourceId: competingSourceId,
      warehouseId: initialWarehouseId,
      practiceId: competingPractice.body.id,
      mode: "SALDO_INIZIALE",
      profile: "GIACENZE",
      sessionId: competingRegistry.body.sessionId,
    });
    const competingMapped = await mapProduct(
      app,
      competingRegistry.body.sessionId,
      competingStock.body.versione,
    );
    expect(competingMapped.status).toBe(200);
    const competingDetail = await request(app).get(
      `/fse-importazioni/sessioni/${competingRegistry.body.sessionId}`,
    );
    const competingAttach = await request(app)
      .post(
        `/fse-importazioni/sessioni/${competingRegistry.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: competingDetail.body.versione,
        versionePratica: competingPractice.body.versione,
        confermaCoperturaStorica: true,
        idempotencyKey: `m3b-competing-balance-${suffix}`,
      });
    expect(competingAttach.status).toBe(409);
    expect(competingAttach.body.code).toBe("SALDO_GIA_PRESENTE");

    const practice = await request(app).get(
      `/carico-pratiche/${created.body.id}`,
    );
    expect(practice.body).toMatchObject({
      origineCarico: "SALDO_INIZIALE",
      tipoPratica: "SALDO_INIZIALE",
    });
    const partial = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send({
        versione: practice.body.versione,
        rigaIds: [],
        idempotencyKey: `m3b-register-balance-partial-${suffix}`,
      });
    expect(partial.status).toBe(400);

    const registered = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send({
        versione: practice.body.versione,
        rigaIds: practice.body.righe.map((row: { id: number }) => row.id),
        idempotencyKey: `m3b-register-balance-${suffix}`,
      });
    expect(registered.status).toBe(201);

    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, initialWarehouseId));
    expect(movements).toHaveLength(1);
    expect(Number(movements[0].quantita)).toBe(10);
    expect(movements[0].naturaContabile).toBe("SALDO_INIZIALE");
    const [coverage] = await db
      .select()
      .from(fseInitialBalanceCoverageTable)
      .where(
        and(
          eq(fseInitialBalanceCoverageTable.sourceRegistryId, initialSourceId),
          inArray(fseInitialBalanceCoverageTable.stato, ["PROPOSTA", "ATTIVA"]),
        ),
      );
    expect(coverage.stato).toBe("ATTIVA");
    const [persistedPractice] = await db
      .select()
      .from(caricoPraticheTable)
      .where(eq(caricoPraticheTable.id, created.body.id));
    expect(persistedPractice.stato).toBe("aperta");
  });

  it.runIf(originalsAvailable)(
    "T25 registra i sette saldi originali per 1177 pezzi e copre gli 80 carichi storici senza duplicarli",
    async () => {
      const app = appFor();
      const [{ id: warehouseId }] = await db
        .insert(magazziniTable)
        .values({
          codice: `M3BR-${suffix}`.slice(0, 20),
          nome: "M3B saldo originali",
          areaOperativaId: areaId,
        })
        .returning({ id: magazziniTable.id });
      const [{ id: sourceId }] = await db
        .insert(fseSourceRegistriesTable)
        .values({
          codice: `M3B-REAL-${suffix}`,
          descrizione: "Sorgente originali M3B",
          areaOperativaId: areaId,
          creatoDa: actorId,
        })
        .returning({ id: fseSourceRegistriesTable.id });
      const practiceCreated = await createEmptyPractice(app, warehouseId);
      expect(practiceCreated.status).toBe(201);

      const registry = await upload(app, {
        bytes: readFileSync(originalRegistryPath!),
        sourceId,
        warehouseId,
        practiceId: practiceCreated.body.id,
        mode: "SALDO_INIZIALE",
        profile: "REGISTRO",
        fileName:
          "Registro Feliciangeli_in_Moto_ODV_Dal_01-09-2024_Al_17-09-2026.xlsx",
      });
      expect(registry.status).toBe(201);
      const stock = await upload(app, {
        bytes: readFileSync(originalStockPath!),
        sourceId,
        warehouseId,
        practiceId: practiceCreated.body.id,
        mode: "SALDO_INIZIALE",
        profile: "GIACENZE",
        sessionId: registry.body.sessionId,
        fileName:
          "Giacenza Feliciangeli in Moto ODV al giorno 17_09_2026_escluse_DdCBozza_escluse_GiacenzaZero.xlsx",
      });
      expect(stock.status).toBe(201);

      let detail = await request(app).get(
        `/fse-importazioni/sessioni/${registry.body.sessionId}`,
      );
      expect(detail.body.stockRows).toHaveLength(7);
      const externalProducts = [
        ...new Set(
          detail.body.stockRows.map(
            (row: { prodottoEsterno: string }) => row.prodottoEsterno,
          ),
        ),
      ] as string[];
      expect(externalProducts).toHaveLength(7);
      for (const [index, externalDescription] of externalProducts.entries()) {
        const [{ id: mappedProductId }] = await db
          .insert(prodottiTable)
          .values({
            codice: `M3BRP-${index}-${suffix}`.slice(0, 30),
            nome: `Saldo reale ${index + 1} ${suffix}`,
            tipoProdotto: "alimentare",
            unitaMisura: "pz",
            quantitaFrazionabile: false,
            lottoFisicoObbligatorio: true,
            gestioneScadenza: true,
          })
          .returning({ id: prodottiTable.id });
        const mapped = await request(app)
          .post(
            `/fse-importazioni/sessioni/${registry.body.sessionId}/associa-prodotto`,
          )
          .send({
            versione: detail.body.versione,
            descrizioneEsterna: externalDescription,
            prodottoId: mappedProductId,
            motivo: "Mapping T25 sui campioni originali",
            accettaFallbackData: true,
          });
        expect(mapped.status).toBe(200);
        detail = await request(app).get(
          `/fse-importazioni/sessioni/${registry.body.sessionId}`,
        );
      }
      expect(detail.body).toMatchObject({
        stato: "PRONTA",
        summary: { stockRows: 7, stockPieces: "1177.000000" },
      });
      expect(
        await db
          .select()
          .from(movimentiTable)
          .where(eq(movimentiTable.magazzinoId, warehouseId)),
      ).toHaveLength(0);

      const missingConfirmation = await request(app)
        .post(
          `/fse-importazioni/sessioni/${registry.body.sessionId}/aggiungi-pratica`,
        )
        .send({
          versione: detail.body.versione,
          versionePratica: practiceCreated.body.versione,
          confermaCoperturaStorica: false,
          idempotencyKey: `m3b-real-no-coverage-${suffix}`,
        });
      expect(missingConfirmation.status).toBe(409);
      expect(missingConfirmation.body.code).toBe(
        "COPERTURA_STORICA_NON_CONFERMATA",
      );

      const attached = await request(app)
        .post(
          `/fse-importazioni/sessioni/${registry.body.sessionId}/aggiungi-pratica`,
        )
        .send({
          versione: detail.body.versione,
          versionePratica: practiceCreated.body.versione,
          confermaCoperturaStorica: true,
          idempotencyKey: `m3b-real-attach-${suffix}`,
        });
      expect(attached.status).toBe(201);
      const practice = await request(app).get(
        `/carico-pratiche/${practiceCreated.body.id}`,
      );
      expect(practice.body.righe).toHaveLength(7);
      expect(
        await db
          .select()
          .from(movimentiTable)
          .where(eq(movimentiTable.magazzinoId, warehouseId)),
      ).toHaveLength(0);

      const registered = await request(app)
        .post(`/carico-pratiche/${practiceCreated.body.id}/registra`)
        .send({
          versione: practice.body.versione,
          rigaIds: practice.body.righe.map((row: { id: number }) => row.id),
          idempotencyKey: `m3b-real-register-${suffix}`,
        });
      expect(registered.status).toBe(201);
      const movements = await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, warehouseId));
      expect(movements).toHaveLength(7);
      expect(
        movements.reduce(
          (total, movement) => total + Number(movement.quantita),
          0,
        ),
      ).toBe(1_177);
      expect(
        movements.every(
          (movement) => movement.naturaContabile === "SALDO_INIZIALE",
        ),
      ).toBe(true);
      const physicalBalances = await db
        .select({
          lot: lottiTable.codiceLotto,
          pieces: movimentiTable.quantitaPezzi,
          weight: movimentiTable.quantitaKgLt,
          factor: movimentiTable.fattoreKgLtPezzo,
          expiry: lottiTable.dataScadenza,
          fund: movimentiTable.fondoOrigine,
        })
        .from(movimentiTable)
        .innerJoin(lottiTable, eq(movimentiTable.lottoId, lottiTable.id))
        .where(eq(movimentiTable.magazzinoId, warehouseId));
      expect(
        physicalBalances.map((row) => ({
          ...row,
          pieces: Number(row.pieces),
          weight: Number(row.weight),
          factor: Number(row.factor),
        })),
      ).toEqual(
        expect.arrayContaining([
          {
            lot: "25332L3P02",
            pieces: 384,
            weight: 30.72,
            factor: 0.08,
            expiry: "2027-12-31",
            fund: "FSE_PLUS",
          },
          {
            lot: "LB111456",
            pieces: 274,
            weight: 137,
            factor: 0.5,
            expiry: "2028-05-25",
            fund: "FSE_PLUS",
          },
          {
            lot: "LA081316",
            pieces: 200,
            weight: 100,
            factor: 0.5,
            expiry: "2028-05-11",
            fund: "FSE_PLUS",
          },
          {
            lot: "LB111426",
            pieces: 26,
            weight: 13,
            factor: 0.5,
            expiry: "2028-05-22",
            fund: "FSE_PLUS",
          },
          {
            lot: "L154642",
            pieces: 160,
            weight: 160,
            factor: 1,
            expiry: "2026-12-30",
            fund: "FSE_PLUS",
          },
          {
            lot: "7829294",
            pieces: 80,
            weight: 80,
            factor: 1,
            expiry: "2028-05-21",
            fund: "FONDO_NAZIONALE",
          },
          {
            lot: "006544",
            pieces: 53,
            weight: 17.04586,
            factor: 0.32162,
            expiry: "2026-11-08",
            fund: "FONDO_NAZIONALE",
          },
        ]),
      );
      const coveredClaims = await db
        .select()
        .from(fseMovementClaimsTable)
        .where(eq(fseMovementClaimsTable.sourceRegistryId, sourceId));
      expect(coveredClaims).toHaveLength(80);
      expect(
        coveredClaims.every((claim) => claim.stato === "COPERTA_SALDO"),
      ).toBe(true);

      const registryReplay = await upload(app, {
        bytes: readFileSync(originalRegistryPath!),
        sourceId,
        warehouseId,
        practiceId: practiceCreated.body.id,
        mode: "SALDO_INIZIALE",
        profile: "REGISTRO",
        fileName: "Registro-originale-rinominato.xlsx",
      });
      expect(registryReplay.status).toBe(200);
      expect(registryReplay.body.replay).toBe(true);
      expect(
        await db
          .select()
          .from(movimentiTable)
          .where(eq(movimentiTable.magazzinoId, warehouseId)),
      ).toHaveLength(7);
    },
  );
});
