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
  fseImportFilesTable,
  fseImportRowRevisionsTable,
  fseImportRowsTable,
  fseImportSessionsTable,
  fseInitialBalanceCoverageTable,
  fseMovementIdentityAliasesTable,
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
import { and, eq, inArray, sql } from "drizzle-orm";
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
let isolatedContextSequence = 0;
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

async function waitForBlockedBy(blockingPid: number, expected = 1) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const pending = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM pg_stat_activity
       WHERE $1 = ANY(pg_blocking_pids(pid))`,
      [blockingPid],
    );
    if ((pending.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Attese ${expected} connessioni bloccate dal backend ${blockingPid}`,
  );
}

async function waitForLockWaiters(expected: number) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const pending = await pool.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND query LIKE '%carico_pratiche%'
    `);
    if ((pending.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Attese ${expected} connessioni in coda sul lock pratica`);
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

async function createIsolatedContext(label: string) {
  isolatedContextSequence += 1;
  const [{ id: warehouseId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `M3B-${suffix.slice(-8)}-${isolatedContextSequence}`.slice(0, 20),
      nome: `M3B ${label}`,
      areaOperativaId: areaId,
    })
    .returning({ id: magazziniTable.id });
  const [{ id: sourceId }] = await db
    .insert(fseSourceRegistriesTable)
    .values({
      codice: `M3B-${label}-${suffix}`,
      descrizione: `Sorgente M3B ${label}`,
      areaOperativaId: areaId,
      creatoDa: actorId,
    })
    .returning({ id: fseSourceRegistriesTable.id });
  return { warehouseId, sourceId };
}

async function prepareInitialBalance(
  app: Express,
  input: {
    warehouseId: number;
    sourceId: number;
    document: string;
    quantity?: number;
  },
) {
  const quantity = input.quantity ?? 10;
  const practice = await createEmptyPractice(app, input.warehouseId);
  expect(practice.status).toBe(201);
  const registry = await upload(app, {
    bytes: workbook(registryHeaders, [
      registryRow(input.document, quantity, quantity),
    ]),
    sourceId: input.sourceId,
    warehouseId: input.warehouseId,
    practiceId: practice.body.id,
    mode: "SALDO_INIZIALE",
    profile: "REGISTRO",
    fileName: `${input.document}-registro.xlsx`,
  });
  expect(registry.status).toBe(201);
  const stock = await upload(app, {
    bytes: workbook(stockHeaders, [stockRow(quantity)]),
    sourceId: input.sourceId,
    warehouseId: input.warehouseId,
    practiceId: practice.body.id,
    mode: "SALDO_INIZIALE",
    profile: "GIACENZE",
    sessionId: registry.body.sessionId,
    fileName: `${input.document}-giacenze.xlsx`,
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
  expect(detail.status).toBe(200);
  expect(detail.body.stato).toBe("PRONTA");
  return { practice, registry, detail };
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
        'fse_initial_balance_coverage',
        'fse_movement_identity_aliases'
      )
  `);
  if (required.rows[0].count !== 5)
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
    const retryClaims = await db
      .select({ id: fseMovementClaimsTable.id })
      .from(fseMovementClaimsTable)
      .innerJoin(
        fseImportRowRevisionsTable,
        eq(
          fseMovementClaimsTable.acceptedRevisionId,
          fseImportRowRevisionsTable.id,
        ),
      )
      .innerJoin(
        fseImportRowsTable,
        eq(fseImportRowRevisionsTable.rigaId, fseImportRowsTable.id),
      )
      .where(eq(fseImportRowsTable.sessioneId, acquired.body.sessionId));
    expect(retryClaims).toHaveLength(1);
    expect(
      await db
        .select({ id: auditEventiTable.id })
        .from(auditEventiTable)
        .where(
          and(
            eq(auditEventiTable.azione, "FSE_IMPORT_AGGIUNTO_PRATICA"),
            eq(auditEventiTable.entitaId, acquired.body.sessionId),
          ),
        ),
    ).toHaveLength(1);

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

  it("conserva l'identità esterna originale e riconcilia gli alias verificati di lotto, documento e data", async () => {
    const app = appFor();
    const context = await createIsolatedContext("identity");
    const originalDocument = `DOC-H1-A-${suffix}`;
    const first = await prepareOrdinaryImport(app, {
      ...context,
      document: originalDocument,
      quantity: 10,
      finalBalance: 10,
      fileName: "h1-originale-a.xlsx",
    });
    const rowId = first.detail.body.rows[0].id;
    const [immutableBefore] = await db
      .select({
        identity: fseImportRowsTable.semanticIdentityHash,
        content: fseImportRowsTable.movementContentHash,
      })
      .from(fseImportRowsTable)
      .where(eq(fseImportRowsTable.id, rowId));

    const revised = await request(app)
      .patch(
        `/fse-importazioni/sessioni/${first.acquired.body.sessionId}/righe/${rowId}`,
      )
      .send({
        versione: first.detail.body.versione,
        lottoFisico: "LOT-B",
        motivo: "Correzione verificata lotto H1",
        accettaFallbackData: true,
      });
    expect(revised.status).toBe(200);
    const [immutableAfter] = await db
      .select({
        identity: fseImportRowsTable.semanticIdentityHash,
        content: fseImportRowsTable.movementContentHash,
        lot: fseImportRowsTable.lottoFisico,
      })
      .from(fseImportRowsTable)
      .where(eq(fseImportRowsTable.id, rowId));
    expect(immutableAfter).toMatchObject({
      identity: immutableBefore.identity,
      content: immutableBefore.content,
      lot: "LOT-B",
    });
    const revisions = await db
      .select()
      .from(fseImportRowRevisionsTable)
      .where(eq(fseImportRowRevisionsTable.rigaId, rowId));
    expect(revisions.length).toBeGreaterThanOrEqual(2);
    const correctionRevision = revisions.find(
      (revision) => revision.motivo === "Correzione verificata lotto H1",
    );
    expect(correctionRevision?.acceptedValuesJson).toMatchObject({
      lottoFisico: "LOT-B",
    });
    expect(
      correctionRevision?.acceptedValuesJson.semanticIdentityHash,
    ).not.toBe(immutableBefore.identity);

    const revisedDetail = await request(app).get(
      `/fse-importazioni/sessioni/${first.acquired.body.sessionId}`,
    );
    const attached = await request(app)
      .post(
        `/fse-importazioni/sessioni/${first.acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: revisedDetail.body.versione,
        versionePratica: first.practice.body.versione,
        rigaIds: [rowId],
        idempotencyKey: `h1-lot-attach-${suffix}`,
      });
    expect(attached.status).toBe(201);

    const classify = async (row: unknown[], name: string) => {
      const practice = await createEmptyPractice(app, context.warehouseId);
      const imported = await upload(app, {
        bytes: workbook(registryHeaders, [row]),
        sourceId: context.sourceId,
        warehouseId: context.warehouseId,
        practiceId: practice.body.id,
        mode: "NUOVI_CARICHI",
        profile: "REGISTRO",
        fileName: name,
      });
      expect(imported.status).toBe(201);
      const detail = await request(app).get(
        `/fse-importazioni/sessioni/${imported.body.sessionId}`,
      );
      return detail.body.rows[0];
    };
    expect(
      await classify(
        registryRow(originalDocument, 10, 999, "006544"),
        "h1-export-originale-diverso.xlsx",
      ),
    ).toMatchObject({ stato: "GIA_NELLA_PRATICA" });
    expect(
      await classify(
        registryRow(originalDocument, 10, 998, "LOT-B"),
        "h1-export-corretto-diverso.xlsx",
      ),
    ).toMatchObject({ stato: "GIA_NELLA_PRATICA" });
    const firstPractice = await request(app).get(
      `/carico-pratiche/${first.practice.body.id}`,
    );
    const registered = await request(app)
      .post(`/carico-pratiche/${first.practice.body.id}/registra`)
      .send({
        versione: firstPractice.body.versione,
        rigaIds: firstPractice.body.righe.map((row: { id: number }) => row.id),
        idempotencyKey: `h1-lot-register-${suffix}`,
      });
    expect(registered.status).toBe(201);
    expect(
      await classify(
        registryRow(originalDocument, 10, 997, "006544"),
        "h1-export-originale-post-registra.xlsx",
      ),
    ).toMatchObject({ stato: "GIA_REGISTRATO" });
    expect(
      await classify(
        (() => {
          const distinct = registryRow(
            `DOC-H1-DISTINTO-${suffix}`,
            3,
            3,
            "LOT-B",
          );
          distinct[6] = "17/09/2026";
          return distinct;
        })(),
        "h1-evento-distinto.xlsx",
      ),
    ).toMatchObject({ stato: "PRONTO" });

    const secondDocument = `DOC-H1-C-${suffix}`;
    const second = await prepareOrdinaryImport(app, {
      ...context,
      document: secondDocument,
      quantity: 4,
      finalBalance: 4,
      fileName: "h1-originale-documento.xlsx",
    });
    const secondRowId = second.detail.body.rows[0].id;
    const revisedDocument = `${secondDocument}-CORRETTO`;
    const revisedDate = "2026-09-18";
    const documentRevision = await request(app)
      .patch(
        `/fse-importazioni/sessioni/${second.acquired.body.sessionId}/righe/${secondRowId}`,
      )
      .send({
        versione: second.detail.body.versione,
        numeroDocumento: revisedDocument,
        dataDocumento: revisedDate,
        motivo: "Correzione verificata documento e data H1",
        accettaFallbackData: true,
      });
    expect(documentRevision.status).toBe(200);
    const secondDetail = await request(app).get(
      `/fse-importazioni/sessioni/${second.acquired.body.sessionId}`,
    );
    expect(
      await request(app)
        .post(
          `/fse-importazioni/sessioni/${second.acquired.body.sessionId}/aggiungi-pratica`,
        )
        .send({
          versione: secondDetail.body.versione,
          versionePratica: second.practice.body.versione,
          rigaIds: [secondRowId],
          idempotencyKey: `h1-document-attach-${suffix}`,
        }),
    ).toMatchObject({ status: 201 });
    const correctedDocumentRow = registryRow(revisedDocument, 4, 5);
    correctedDocumentRow[5] = revisedDate;
    correctedDocumentRow[6] = "17/09/2026";
    expect(
      await classify(
        registryRow(secondDocument, 4, 6),
        "h1-documento-originale-export.xlsx",
      ),
    ).toMatchObject({ stato: "GIA_NELLA_PRATICA" });
    expect(
      await classify(correctedDocumentRow, "h1-documento-corretto-export.xlsx"),
    ).toMatchObject({ stato: "GIA_NELLA_PRATICA" });

    const aliases = await db
      .select()
      .from(fseMovementIdentityAliasesTable)
      .where(
        eq(fseMovementIdentityAliasesTable.sourceRegistryId, context.sourceId),
      );
    expect(
      new Set(aliases.map((alias) => alias.canonicalIdentityHash)).size,
    ).toBe(2);
    expect(aliases.length).toBeGreaterThanOrEqual(4);
    expect(
      await db
        .select()
        .from(fseMovementClaimsTable)
        .where(eq(fseMovementClaimsTable.sourceRegistryId, context.sourceId)),
    ).toHaveLength(2);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, context.warehouseId)),
    ).toHaveLength(1);
  });

  it("serializza forma originale e corretta concorrenti sulla stessa claim canonica", async () => {
    const app = appFor();
    const context = await createIsolatedContext("identity-race");
    const document = `DOC-H1-RACE-${suffix}`;
    const original = await prepareOrdinaryImport(app, {
      ...context,
      document,
      quantity: 6,
      finalBalance: 6,
      fileName: "h1-race-originale.xlsx",
    });
    const originalRowId = original.detail.body.rows[0].id;
    const revised = await request(app)
      .patch(
        `/fse-importazioni/sessioni/${original.acquired.body.sessionId}/righe/${originalRowId}`,
      )
      .send({
        versione: original.detail.body.versione,
        lottoFisico: "LOT-RACE-CORRETTO",
        motivo: "Alias concorrente H1",
        accettaFallbackData: true,
      });
    expect(revised.status).toBe(200);
    const originalReady = await request(app).get(
      `/fse-importazioni/sessioni/${original.acquired.body.sessionId}`,
    );

    const correctedPractice = await createEmptyPractice(
      app,
      context.warehouseId,
    );
    const correctedExport = registryRow(document, 6, 7, "LOT-RACE-CORRETTO");
    correctedExport[6] = "17/09/2026";
    const correctedUpload = await upload(app, {
      bytes: workbook(registryHeaders, [correctedExport]),
      sourceId: context.sourceId,
      warehouseId: context.warehouseId,
      practiceId: correctedPractice.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
      fileName: "h1-race-corretto.xlsx",
    });
    expect(correctedUpload.status).toBe(201);
    const correctedReady = await request(app).get(
      `/fse-importazioni/sessioni/${correctedUpload.body.sessionId}`,
    );
    expect(correctedReady.body.rows[0].stato).toBe("PRONTO");

    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      const pid = (
        await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0].pid;
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`fse-source:${context.sourceId}`],
      );
      const attempts = [
        request(app)
          .post(
            `/fse-importazioni/sessioni/${original.acquired.body.sessionId}/aggiungi-pratica`,
          )
          .send({
            versione: originalReady.body.versione,
            versionePratica: original.practice.body.versione,
            rigaIds: [originalRowId],
            idempotencyKey: `h1-race-original-${suffix}`,
          })
          .then((response) => response),
        request(app)
          .post(
            `/fse-importazioni/sessioni/${correctedUpload.body.sessionId}/aggiungi-pratica`,
          )
          .send({
            versione: correctedReady.body.versione,
            versionePratica: correctedPractice.body.versione,
            rigaIds: [correctedReady.body.rows[0].id],
            idempotencyKey: `h1-race-corrected-${suffix}`,
          })
          .then((response) => response),
      ];
      await waitForBlockedBy(pid, 2);
      await blocker.query("COMMIT");
      const responses = await Promise.all(attempts);
      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    expect(
      await db
        .select()
        .from(fseMovementClaimsTable)
        .where(eq(fseMovementClaimsTable.sourceRegistryId, context.sourceId)),
    ).toHaveLength(1);
  });

  it("rilegge la pratica dopo il lock e rifiuta versione o stato divenuti obsoleti", async () => {
    const app = appFor();
    const versionContext = await createIsolatedContext("practice-version");
    const versionCase = await prepareOrdinaryImport(app, {
      ...versionContext,
      document: `DOC-H2-VERSION-${suffix}`,
    });
    const versionBlocker = await pool.connect();
    try {
      await versionBlocker.query("BEGIN");
      await versionBlocker.query(
        "SELECT id FROM carico_pratiche WHERE id = $1 FOR UPDATE",
        [versionCase.practice.body.id],
      );
      const pid = (
        await versionBlocker.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        )
      ).rows[0].pid;
      const pending = request(app)
        .post(
          `/fse-importazioni/sessioni/${versionCase.acquired.body.sessionId}/aggiungi-pratica`,
        )
        .send({
          versione: versionCase.detail.body.versione,
          versionePratica: versionCase.practice.body.versione,
          rigaIds: [versionCase.detail.body.rows[0].id],
          idempotencyKey: `h2-stale-version-${suffix}`,
        })
        .then((response) => response);
      await waitForBlockedBy(pid);
      await versionBlocker.query(
        "UPDATE carico_pratiche SET versione = versione + 1 WHERE id = $1",
        [versionCase.practice.body.id],
      );
      await versionBlocker.query("COMMIT");
      const rejected = await pending;
      expect(rejected.status).toBe(409);
      expect(rejected.body.code).toBe("VERSIONE_PRATICA");
    } finally {
      await versionBlocker.query("ROLLBACK").catch(() => undefined);
      versionBlocker.release();
    }
    expect(
      await db
        .select()
        .from(caricoPraticaRigheTable)
        .where(
          eq(
            caricoPraticaRigheTable.caricoPraticaId,
            versionCase.practice.body.id,
          ),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(fseMovementClaimsTable)
        .where(
          eq(fseMovementClaimsTable.sourceRegistryId, versionContext.sourceId),
        ),
    ).toHaveLength(0);

    const stateContext = await createIsolatedContext("practice-state");
    const stateCase = await prepareOrdinaryImport(app, {
      ...stateContext,
      document: `DOC-H2-STATE-${suffix}`,
    });
    const stateBlocker = await pool.connect();
    try {
      await stateBlocker.query("BEGIN");
      await stateBlocker.query(
        "SELECT id FROM carico_pratiche WHERE id = $1 FOR UPDATE",
        [stateCase.practice.body.id],
      );
      const pid = (
        await stateBlocker.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        )
      ).rows[0].pid;
      const pending = request(app)
        .post(
          `/fse-importazioni/sessioni/${stateCase.acquired.body.sessionId}/aggiungi-pratica`,
        )
        .send({
          versione: stateCase.detail.body.versione,
          versionePratica: stateCase.practice.body.versione + 1,
          rigaIds: [stateCase.detail.body.rows[0].id],
          idempotencyKey: `h2-stale-state-${suffix}`,
        })
        .then((response) => response);
      await waitForBlockedBy(pid);
      await stateBlocker.query(
        "UPDATE carico_pratiche SET stato = 'chiusa', versione = versione + 1 WHERE id = $1",
        [stateCase.practice.body.id],
      );
      await stateBlocker.query("COMMIT");
      const rejected = await pending;
      expect(rejected.status).toBe(409);
      expect(rejected.body.code).toBe("PRATICA_NON_MODIFICABILE");
    } finally {
      await stateBlocker.query("ROLLBACK").catch(() => undefined);
      stateBlocker.release();
    }
    expect(
      await db
        .select()
        .from(caricoPraticaRigheTable)
        .where(
          eq(
            caricoPraticaRigheTable.caricoPraticaId,
            stateCase.practice.body.id,
          ),
        ),
    ).toHaveLength(0);
  });

  it("serializza due attach sulla stessa pratica e consente il retry con versione aggiornata", async () => {
    const app = appFor();
    const firstContext = await createIsolatedContext("practice-race-a");
    const [{ id: secondSourceId }] = await db
      .insert(fseSourceRegistriesTable)
      .values({
        codice: `M3B-practice-race-b-${suffix}`,
        descrizione: "Sorgente H2 concorrente B",
        areaOperativaId: areaId,
        creatoDa: actorId,
      })
      .returning({ id: fseSourceRegistriesTable.id });
    const practice = await createEmptyPractice(app, firstContext.warehouseId);
    const prepareForPractice = async (sourceId: number, document: string) => {
      const acquired = await upload(app, {
        bytes: workbook(registryHeaders, [registryRow(document, 5, 5)]),
        sourceId,
        warehouseId: firstContext.warehouseId,
        practiceId: practice.body.id,
        mode: "NUOVI_CARICHI",
        profile: "REGISTRO",
        fileName: `${document}.xlsx`,
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
      return { acquired, detail };
    };
    const first = await prepareForPractice(
      firstContext.sourceId,
      `DOC-H2-RACE-A-${suffix}`,
    );
    const second = await prepareForPractice(
      secondSourceId,
      `DOC-H2-RACE-B-${suffix}`,
    );
    const attempts = [first, second].map((prepared, index) => ({
      prepared,
      key: `h2-practice-race-${index}-${suffix}`,
    }));

    const blocker = await pool.connect();
    let responses: Array<Awaited<ReturnType<typeof request>>> = [];
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM carico_pratiche WHERE id = $1 FOR UPDATE",
        [practice.body.id],
      );
      const pid = (
        await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0].pid;
      const pending = attempts.map(({ prepared, key }) =>
        request(app)
          .post(
            `/fse-importazioni/sessioni/${prepared.acquired.body.sessionId}/aggiungi-pratica`,
          )
          .send({
            versione: prepared.detail.body.versione,
            versionePratica: practice.body.versione,
            rigaIds: [prepared.detail.body.rows[0].id],
            idempotencyKey: key,
          })
          .then((response) => response),
      );
      await waitForLockWaiters(2);
      await blocker.query("COMMIT");
      responses = await Promise.all(pending);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const failedIndex = responses.findIndex(
      (response) => response.status === 409,
    );
    expect(responses[failedIndex].body.code).toBe("VERSIONE_PRATICA");
    const failed = attempts[failedIndex].prepared;
    const currentSession = await request(app).get(
      `/fse-importazioni/sessioni/${failed.acquired.body.sessionId}`,
    );
    const currentPractice = await request(app).get(
      `/carico-pratiche/${practice.body.id}`,
    );
    expect(currentPractice.body.versione).toBe(practice.body.versione + 1);
    const retry = await request(app)
      .post(
        `/fse-importazioni/sessioni/${failed.acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: currentSession.body.versione,
        versionePratica: currentPractice.body.versione,
        rigaIds: [
          currentSession.body.rows.find(
            (row: { stato: string }) => row.stato === "PRONTO",
          ).id,
        ],
        idempotencyKey: `h2-practice-retry-${suffix}`,
      });
    expect(retry.status).toBe(201);
    const completed = await request(app).get(
      `/carico-pratiche/${practice.body.id}`,
    );
    expect(completed.body.versione).toBe(practice.body.versione + 2);
    expect(completed.body.righe).toHaveLength(2);
  });

  it("aggiunge solo il sottoinsieme ordinario valido e mantiene atomico il saldo iniziale", async () => {
    const app = appFor();
    const context = await createIsolatedContext("partial-subset");
    const practice = await createEmptyPractice(app, context.warehouseId);
    const ready = registryRow(`DOC-H3-A-${suffix}`, 10, 10);
    const unmapped = registryRow(`DOC-H3-B-${suffix}`, 5, 15);
    unmapped[1] = "Prodotto da associare H3";
    const invalid = registryRow(`DOC-H3-C-${suffix}`, 1.5, 16.5);
    const acquired = await upload(app, {
      bytes: workbook(registryHeaders, [ready, unmapped, invalid]),
      sourceId: context.sourceId,
      warehouseId: context.warehouseId,
      practiceId: practice.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
      fileName: "h3-sottoinsieme.xlsx",
    });
    expect(acquired.status).toBe(201);
    const mapped = await mapProduct(
      app,
      acquired.body.sessionId,
      acquired.body.versione,
    );
    expect(mapped.status).toBe(200);
    let detail = await request(app).get(
      `/fse-importazioni/sessioni/${acquired.body.sessionId}`,
    );
    expect(detail.body.stato).toBe("DA_COMPLETARE");
    const rowsByDocument = new Map(
      detail.body.rows.map((row: { numeroDocumento: string }) => [
        row.numeroDocumento,
        row,
      ]),
    );
    expect(rowsByDocument.get(`DOC-H3-A-${suffix}`)).toMatchObject({
      stato: "PRONTO",
    });
    expect(rowsByDocument.get(`DOC-H3-B-${suffix}`)).toMatchObject({
      stato: "DA_ASSOCIARE",
    });
    expect(rowsByDocument.get(`DOC-H3-C-${suffix}`)).toMatchObject({
      stato: "ERRORE",
    });

    const firstAttach = await request(app)
      .post(
        `/fse-importazioni/sessioni/${acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: detail.body.versione,
        versionePratica: practice.body.versione,
        rigaIds: [
          (rowsByDocument.get(`DOC-H3-A-${suffix}`) as { id: number }).id,
        ],
        idempotencyKey: `h3-ready-a-${suffix}`,
      });
    expect(firstAttach.status).toBe(201);
    expect(firstAttach.body.addedRows).toBe(1);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, context.warehouseId)),
    ).toHaveLength(0);

    const resumedApp = appFor();
    detail = await request(resumedApp).get(
      `/fse-importazioni/sessioni/${acquired.body.sessionId}`,
    );
    expect(detail.body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          numeroDocumento: `DOC-H3-A-${suffix}`,
          stato: "GIA_NELLA_PRATICA",
        }),
        expect.objectContaining({
          numeroDocumento: `DOC-H3-B-${suffix}`,
          stato: "DA_ASSOCIARE",
        }),
        expect.objectContaining({
          numeroDocumento: `DOC-H3-C-${suffix}`,
          stato: "ERRORE",
        }),
      ]),
    );
    const mappedB = await request(resumedApp)
      .post(
        `/fse-importazioni/sessioni/${acquired.body.sessionId}/associa-prodotto`,
      )
      .send({
        versione: detail.body.versione,
        descrizioneEsterna: "Prodotto da associare H3",
        prodottoId: productId,
        motivo: "Associazione differita H3",
        accettaFallbackData: true,
      });
    expect(mappedB.status).toBe(200);
    detail = await request(resumedApp).get(
      `/fse-importazioni/sessioni/${acquired.body.sessionId}`,
    );
    const readyB = detail.body.rows.find(
      (row: { numeroDocumento: string }) =>
        row.numeroDocumento === `DOC-H3-B-${suffix}`,
    );
    const invalidC = detail.body.rows.find(
      (row: { numeroDocumento: string }) =>
        row.numeroDocumento === `DOC-H3-C-${suffix}`,
    );
    expect(readyB.stato).toBe("PRONTO");
    expect(invalidC.stato).toBe("ERRORE");

    const invalidAttach = await request(resumedApp)
      .post(
        `/fse-importazioni/sessioni/${acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: detail.body.versione,
        versionePratica: firstAttach.body.practiceVersion,
        rigaIds: [readyB.id, invalidC.id],
        idempotencyKey: `h3-invalid-subset-${suffix}`,
      });
    expect(invalidAttach.status).toBe(409);
    expect(invalidAttach.body.code).toBe("RIGHE_NON_PRONTE");
    expect(
      await db
        .select()
        .from(caricoPraticaRigheTable)
        .where(eq(caricoPraticaRigheTable.caricoPraticaId, practice.body.id)),
    ).toHaveLength(1);

    const secondAttach = await request(resumedApp)
      .post(
        `/fse-importazioni/sessioni/${acquired.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: detail.body.versione,
        versionePratica: firstAttach.body.practiceVersion,
        rigaIds: [readyB.id],
        idempotencyKey: `h3-ready-b-${suffix}`,
      });
    expect(secondAttach.status).toBe(201);
    const completedPractice = await request(resumedApp).get(
      `/carico-pratiche/${practice.body.id}`,
    );
    expect(completedPractice.body.righe).toHaveLength(2);
    const registered = await request(resumedApp)
      .post(`/carico-pratiche/${practice.body.id}/registra`)
      .send({
        versione: completedPractice.body.versione,
        rigaIds: completedPractice.body.righe.map(
          (row: { id: number }) => row.id,
        ),
        idempotencyKey: `h3-register-valid-${suffix}`,
      });
    expect(registered.status).toBe(201);
    expect(
      (
        await db
          .select()
          .from(movimentiTable)
          .where(eq(movimentiTable.magazzinoId, context.warehouseId))
      ).reduce((total, movement) => total + Number(movement.quantita), 0),
    ).toBe(15);

    const balanceContext = await createIsolatedContext("partial-balance");
    const balancePractice = await createEmptyPractice(
      app,
      balanceContext.warehouseId,
    );
    const balanceRegistry = await upload(app, {
      bytes: workbook(registryHeaders, [
        registryRow(`DOC-H3-SALDO-${suffix}`, 10, 10),
      ]),
      sourceId: balanceContext.sourceId,
      warehouseId: balanceContext.warehouseId,
      practiceId: balancePractice.body.id,
      mode: "SALDO_INIZIALE",
      profile: "REGISTRO",
    });
    const balanceStock = await upload(app, {
      bytes: workbook(stockHeaders, [stockRow(1.5)]),
      sourceId: balanceContext.sourceId,
      warehouseId: balanceContext.warehouseId,
      practiceId: balancePractice.body.id,
      mode: "SALDO_INIZIALE",
      profile: "GIACENZE",
      sessionId: balanceRegistry.body.sessionId,
    });
    const balanceMapped = await mapProduct(
      app,
      balanceRegistry.body.sessionId,
      balanceStock.body.versione,
    );
    expect(balanceMapped.status).toBe(200);
    const balanceDetail = await request(app).get(
      `/fse-importazioni/sessioni/${balanceRegistry.body.sessionId}`,
    );
    expect(balanceDetail.body.stato).toBe("DA_COMPLETARE");
    const balanceAttach = await request(app)
      .post(
        `/fse-importazioni/sessioni/${balanceRegistry.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: balanceDetail.body.versione,
        versionePratica: balancePractice.body.versione,
        confermaCoperturaStorica: true,
        idempotencyKey: `h3-balance-invalid-${suffix}`,
      });
    expect(balanceAttach.status).toBe(409);
    expect(balanceAttach.body.code).toBe("SESSIONE_NON_PRONTA");
    expect(
      await db
        .select()
        .from(caricoPraticaRigheTable)
        .where(
          eq(caricoPraticaRigheTable.caricoPraticaId, balancePractice.body.id),
        ),
    ).toHaveLength(0);
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

  it("rifiuta senza residui un upload ordinario mentre il saldo è PROPOSTA", async () => {
    const app = appFor();
    const context = await createIsolatedContext("PROPOSTA");
    const balance = await prepareInitialBalance(app, {
      ...context,
      document: `DOC-BAL-PROPOSTA-${suffix}`,
    });
    const attached = await request(app)
      .post(
        `/fse-importazioni/sessioni/${balance.registry.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: balance.detail.body.versione,
        versionePratica: balance.practice.body.versione,
        confermaCoperturaStorica: true,
        idempotencyKey: `m3b-proposta-attach-${suffix}`,
      });
    expect(attached.status).toBe(201);

    const sessionsBefore = await db
      .select({ id: fseImportSessionsTable.id })
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.sourceRegistryId, context.sourceId));
    const sessionIdsBefore = sessionsBefore.map((row) => row.id);
    const filesBefore = await db
      .select({ id: fseImportFilesTable.id })
      .from(fseImportFilesTable)
      .where(inArray(fseImportFilesTable.sessioneId, sessionIdsBefore));
    const rowsBefore = await db
      .select({ id: fseImportRowsTable.id })
      .from(fseImportRowsTable)
      .where(inArray(fseImportRowsTable.sessioneId, sessionIdsBefore));
    const auditsBefore = await db
      .select({ id: auditEventiTable.id })
      .from(auditEventiTable)
      .where(eq(auditEventiTable.azione, "FSE_IMPORT_FILE_ACQUISITO"));
    const [coverageBefore] = await db
      .select()
      .from(fseInitialBalanceCoverageTable)
      .where(
        eq(fseInitialBalanceCoverageTable.sourceRegistryId, context.sourceId),
      );
    expect(coverageBefore.stato).toBe("PROPOSTA");

    const ordinaryPractice = await createEmptyPractice(
      app,
      context.warehouseId,
    );
    const rejected = await upload(app, {
      bytes: workbook(registryHeaders, [
        registryRow(`DOC-DURANTE-PROPOSTA-${suffix}`, 100, 100),
      ]),
      sourceId: context.sourceId,
      warehouseId: context.warehouseId,
      practiceId: ordinaryPractice.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
      fileName: "nuovi-carichi-durante-proposta.xlsx",
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toEqual({
      code: "SALDO_INIZIALE_IN_CORSO",
      error:
        "È in corso la preparazione della giacenza iniziale. Completa o annulla il saldo prima di importare nuovi carichi.",
    });

    const sessionsAfter = await db
      .select({ id: fseImportSessionsTable.id })
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.sourceRegistryId, context.sourceId));
    const filesAfter = await db
      .select({ id: fseImportFilesTable.id })
      .from(fseImportFilesTable)
      .where(inArray(fseImportFilesTable.sessioneId, sessionIdsBefore));
    const rowsAfter = await db
      .select({ id: fseImportRowsTable.id })
      .from(fseImportRowsTable)
      .where(inArray(fseImportRowsTable.sessioneId, sessionIdsBefore));
    const auditsAfter = await db
      .select({ id: auditEventiTable.id })
      .from(auditEventiTable)
      .where(eq(auditEventiTable.azione, "FSE_IMPORT_FILE_ACQUISITO"));
    const [coverageAfter] = await db
      .select()
      .from(fseInitialBalanceCoverageTable)
      .where(
        eq(fseInitialBalanceCoverageTable.sourceRegistryId, context.sourceId),
      );
    expect(sessionsAfter).toEqual(sessionsBefore);
    expect(filesAfter).toEqual(filesBefore);
    expect(rowsAfter).toEqual(rowsBefore);
    expect(auditsAfter).toEqual(auditsBefore);
    expect(coverageAfter).toEqual(coverageBefore);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, context.warehouseId)),
    ).toHaveLength(0);

    const cancelledBalance = await request(app)
      .post(`/carico-pratiche/${balance.practice.body.id}/annulla`)
      .send({
        versione: attached.body.practiceVersion,
        motivo: "Annullamento proposta saldo per riaprire gli import ordinari",
      });
    expect(cancelledBalance.status).toBe(200);
    const retried = await upload(app, {
      bytes: workbook(registryHeaders, [
        registryRow(`DOC-DURANTE-PROPOSTA-${suffix}`, 100, 100),
      ]),
      sourceId: context.sourceId,
      warehouseId: context.warehouseId,
      practiceId: ordinaryPractice.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
      fileName: "nuovi-carichi-dopo-annullamento-proposta.xlsx",
    });
    expect(retried.status).toBe(201);
  });

  it("isola le righe coperte e conserva i nuovi eventi post-taglio e retrodatati", async () => {
    const app = appFor();
    const context = await createIsolatedContext("ISOLAMENTO");
    const ordinary = await prepareOrdinaryImport(app, {
      ...context,
      document: `DOC-ORD-APERTA-${suffix}`,
      fileName: "ordinaria-aperta-prima-del-saldo.xlsx",
    });
    expect(ordinary.detail.body.stato).toBe("PRONTA");
    const externalRowId = ordinary.detail.body.rows[0].id as number;

    const balance = await prepareInitialBalance(app, {
      ...context,
      document: `DOC-BAL-ISOLATO-${suffix}`,
    });
    const blocked = await request(app)
      .post(
        `/fse-importazioni/sessioni/${balance.registry.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: balance.detail.body.versione,
        versionePratica: balance.practice.body.versione,
        confermaCoperturaStorica: true,
        idempotencyKey: `m3b-isolamento-attach-${suffix}`,
      });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({
      code: "IMPORT_ORDINARIO_IN_CORSO",
      error:
        "Esiste un'importazione ordinaria FSE+ ancora aperta per questa sorgente. Completala o annullala prima di impostare la giacenza iniziale.",
    });
    expect(
      await db
        .select()
        .from(fseInitialBalanceCoverageTable)
        .where(
          eq(fseInitialBalanceCoverageTable.sourceRegistryId, context.sourceId),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(fseMovementClaimsTable)
        .where(eq(fseMovementClaimsTable.sourceRegistryId, context.sourceId)),
    ).toHaveLength(0);
    const [openSession] = await db
      .select()
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.id, ordinary.acquired.body.sessionId));
    expect(openSession.stato).toBe("PRONTA");

    const cancelledOrdinary = await request(app)
      .post(`/carico-pratiche/${ordinary.practice.body.id}/annulla`)
      .send({
        versione: ordinary.practice.body.versione,
        motivo: "Annullamento sessione ordinaria prima del saldo",
      });
    expect(cancelledOrdinary.status).toBe(200);
    const [cancelledSession] = await db
      .select()
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.id, openSession.id));
    expect(cancelledSession.stato).toBe("ANNULLATA");
    const attached = await request(app)
      .post(
        `/fse-importazioni/sessioni/${balance.registry.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: balance.detail.body.versione,
        versionePratica: balance.practice.body.versione,
        confermaCoperturaStorica: true,
        idempotencyKey: `m3b-isolamento-attach-${suffix}`,
      });
    expect(attached.status).toBe(201);
    const balancePractice = await request(app).get(
      `/carico-pratiche/${balance.practice.body.id}`,
    );
    const registeredBalance = await request(app)
      .post(`/carico-pratiche/${balance.practice.body.id}/registra`)
      .send({
        versione: balancePractice.body.versione,
        rigaIds: balancePractice.body.righe.map(
          (row: { id: number }) => row.id,
        ),
        idempotencyKey: `m3b-isolamento-register-${suffix}`,
      });
    expect(registeredBalance.status).toBe(201);

    const importRows = await db
      .select({
        id: fseImportRowsTable.id,
        sessionId: fseImportRowsTable.sessioneId,
        state: fseImportRowsTable.stato,
      })
      .from(fseImportRowsTable)
      .where(
        inArray(fseImportRowsTable.sessioneId, [
          openSession.id,
          balance.registry.body.sessionId,
        ]),
      );
    expect(importRows.find((row) => row.id === externalRowId)?.state).toBe(
      "PRONTO",
    );
    expect(
      importRows.find(
        (row) => row.sessionId === balance.registry.body.sessionId,
      )?.state,
    ).toBe("COPERTO_SALDO");
    const balanceClaims = await db
      .select()
      .from(fseMovementClaimsTable)
      .where(eq(fseMovementClaimsTable.sourceRegistryId, context.sourceId));
    expect(balanceClaims).toHaveLength(1);
    expect(balanceClaims[0].stato).toBe("COPERTA_SALDO");

    const postCutoffRow = registryRow(`DOC-POST-${suffix}`, 4, 4);
    postCutoffRow[5] = "18/09/2026";
    const postPractice = await createEmptyPractice(app, context.warehouseId);
    const postBytes = workbook(registryHeaders, [postCutoffRow]);
    const postUpload = await upload(app, {
      bytes: postBytes,
      sourceId: context.sourceId,
      warehouseId: context.warehouseId,
      practiceId: postPractice.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
      fileName: "evento-post-taglio.xlsx",
    });
    expect(postUpload.status).toBe(201);
    const postMapped = await mapProduct(
      app,
      postUpload.body.sessionId,
      postUpload.body.versione,
    );
    expect(postMapped.status).toBe(200);
    const postDetail = await request(app).get(
      `/fse-importazioni/sessioni/${postUpload.body.sessionId}`,
    );
    expect(postDetail.body.rows[0].stato).toBe("PRONTO");
    const postAttached = await request(app)
      .post(
        `/fse-importazioni/sessioni/${postUpload.body.sessionId}/aggiungi-pratica`,
      )
      .send({
        versione: postDetail.body.versione,
        versionePratica: postPractice.body.versione,
        rigaIds: [postDetail.body.rows[0].id],
        idempotencyKey: `m3b-post-attach-${suffix}`,
      });
    expect(postAttached.status).toBe(201);
    const postPracticeDetail = await request(app).get(
      `/carico-pratiche/${postPractice.body.id}`,
    );
    const postRegistered = await request(app)
      .post(`/carico-pratiche/${postPractice.body.id}/registra`)
      .send({
        versione: postPracticeDetail.body.versione,
        rigaIds: postPracticeDetail.body.righe.map(
          (row: { id: number }) => row.id,
        ),
        idempotencyKey: `m3b-post-register-${suffix}`,
      });
    expect(postRegistered.status).toBe(201);
    const movementsAfterPost = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, context.warehouseId));
    expect(movementsAfterPost).toHaveLength(2);
    expect(
      movementsAfterPost.filter(
        (movement) => movement.naturaContabile !== "SALDO_INIZIALE",
      ),
    ).toHaveLength(1);

    const replayPractice = await createEmptyPractice(app, context.warehouseId);
    const postReplay = await upload(app, {
      bytes: postBytes,
      sourceId: context.sourceId,
      warehouseId: context.warehouseId,
      practiceId: replayPractice.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
      fileName: "evento-post-taglio-rinominato.xlsx",
    });
    expect(postReplay.status).toBe(200);
    expect(postReplay.body.replay).toBe(true);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, context.warehouseId)),
    ).toHaveLength(2);

    const pastRow = registryRow(`DOC-RETRO-${suffix}`, 3, 3);
    pastRow[5] = "16/09/2026";
    const retroPractice = await createEmptyPractice(app, context.warehouseId);
    const retroUpload = await upload(app, {
      bytes: workbook(registryHeaders, [pastRow]),
      sourceId: context.sourceId,
      warehouseId: context.warehouseId,
      practiceId: retroPractice.body.id,
      mode: "NUOVI_CARICHI",
      profile: "REGISTRO",
      fileName: "evento-retrodatato.xlsx",
    });
    expect(retroUpload.status).toBe(201);
    const retroMapped = await mapProduct(
      app,
      retroUpload.body.sessionId,
      retroUpload.body.versione,
    );
    expect(retroMapped.status).toBe(200);
    const retroDetail = await request(app).get(
      `/fse-importazioni/sessioni/${retroUpload.body.sessionId}`,
    );
    expect(retroDetail.body.rows[0].stato).toBe("DA_VERIFICARE");
    expect(retroDetail.body.rows[0].warningCodes).toContain(
      "EVENTO_RETRODATATO_DOPO_SALDO",
    );
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, context.warehouseId)),
    ).toHaveLength(2);
  });

  it("serializza davvero proposta saldo e acquisizione ordinaria sulla stessa sorgente", async () => {
    const app = appFor();
    const context = await createIsolatedContext("RACE-SOURCE");
    const balance = await prepareInitialBalance(app, {
      ...context,
      document: `DOC-BAL-RACE-SOURCE-${suffix}`,
    });
    const ordinaryPractice = await createEmptyPractice(
      app,
      context.warehouseId,
    );
    const [proposal, ordinaryUpload] = await Promise.all([
      request(app)
        .post(
          `/fse-importazioni/sessioni/${balance.registry.body.sessionId}/aggiungi-pratica`,
        )
        .send({
          versione: balance.detail.body.versione,
          versionePratica: balance.practice.body.versione,
          confermaCoperturaStorica: true,
          idempotencyKey: `m3b-race-source-attach-${suffix}`,
        }),
      upload(app, {
        bytes: workbook(registryHeaders, [
          registryRow(`DOC-NEW-RACE-${suffix}`, 5, 5),
        ]),
        sourceId: context.sourceId,
        warehouseId: context.warehouseId,
        practiceId: ordinaryPractice.body.id,
        mode: "NUOVI_CARICHI",
        profile: "REGISTRO",
        fileName: "nuovo-carico-concorrente.xlsx",
      }),
    ]);
    expect([proposal.status, ordinaryUpload.status].sort()).toEqual([201, 409]);
    const rejected = proposal.status === 409 ? proposal : ordinaryUpload;
    expect(["IMPORT_ORDINARIO_IN_CORSO", "SALDO_INIZIALE_IN_CORSO"]).toContain(
      rejected.body.code,
    );

    const [coverage] = await db
      .select()
      .from(fseInitialBalanceCoverageTable)
      .where(
        eq(fseInitialBalanceCoverageTable.sourceRegistryId, context.sourceId),
      );
    const ordinarySessions = await db
      .select({ id: fseImportSessionsTable.id })
      .from(fseImportSessionsTable)
      .where(
        and(
          eq(fseImportSessionsTable.sourceRegistryId, context.sourceId),
          eq(fseImportSessionsTable.modalita, "NUOVI_CARICHI"),
        ),
      );
    if (proposal.status === 201) {
      expect(coverage?.stato).toBe("PROPOSTA");
      expect(ordinarySessions).toHaveLength(0);
    } else {
      expect(coverage).toBeUndefined();
      expect(ordinarySessions).toHaveLength(1);
      const [ordinaryRow] = await db
        .select({ state: fseImportRowsTable.stato })
        .from(fseImportRowsTable)
        .where(eq(fseImportRowsTable.sessioneId, ordinarySessions[0].id));
      expect(ordinaryRow.state).not.toBe("COPERTO_SALDO");
    }
  }, 15_000);

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
