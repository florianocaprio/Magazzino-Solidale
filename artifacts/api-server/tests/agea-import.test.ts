/* @vitest-environment node */

import { existsSync, readFileSync } from "node:fs";
import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  areeOperativeTable,
  carichiMagazzinoRigheTable,
  carichiMagazzinoTable,
  db,
  importazioniAgeaRigheTable,
  importazioniAgeaPartiteTable,
  importazioniAgeaTable,
  lottiTable,
  mappatureProdottiEsterniTable,
  magazziniTable,
  movimentiEsterniAgeaTable,
  movimentiTable,
  pool,
  prodottiTable,
  riconciliazioniFseRigheTable,
  riconciliazioniFseTable,
  systemLogsTable,
  utentiTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import ageaRouter from "../src/routes/agea";
import {
  ensureAmbienteModuli,
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import { AGEA_XLSX_MIME, parseAgeaWorkbook } from "../src/lib/ageaSifeadParser";
import { InventoryDecimal } from "../src/lib/inventoryDecimal";
import { createWarehouseLoad } from "../src/lib/inventoryLedger";
import { calculateFseReconciliation } from "../src/lib/fseReconciliation";

const suffix = `${process.pid}${Date.now().toString(36)}`;
let app: Express;
let deniedApp: Express;
let scopedApp: Express;
let userId: number;
let warehouseId: number;
let foreignWarehouseId: number;
let scopeAreaId: number;
let foreignAreaId: number;
let productId: number;
let originalLotti = true;
let acceptanceWarehouseId: number | null = null;
let acceptanceReconciliationId: number | null = null;
let manyToOneWarehouseId: number | null = null;
const concurrencyWarehouseIds: number[] = [];
let acceptanceProductIds: number[] = [];
let extraProductIds: number[] = [];
const acceptancePath = process.env.AGEA_ACCEPTANCE_XLSX;

const headers = [
  "Fondo",
  "Prodotto",
  "Giacenza al 20/08/2026 Pezzi",
  "Giacenza al 20/08/2026 KgLt",
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

function registry(
  includeIncrement = false,
  modifiedBase = false,
  sameBaseIncrement = false,
) {
  const finalPieces = includeIncrement ? 10 : 8;
  const finalKg = includeIncrement ? 5.5 : 4.4;
  const rows: Array<Array<string | number>> = [
    [
      "FSE+",
      "Pasta test AGEA",
      finalPieces,
      finalKg,
      "DOC-BASE",
      "01/08/2026",
      23,
      "LOT-AGEA",
      "AGEA",
      modifiedBase ? 5.6 : 5.5,
      10,
      10,
      5.5,
      23,
      23,
      23,
      23,
      23,
      23,
    ],
    [
      "FSE+",
      "Pasta test AGEA",
      finalPieces,
      finalKg,
      "SC-BASE",
      "10/08/2026",
      23,
      "LOT-AGEA",
      "Distribuzione indigenti",
      -1.1,
      -2,
      8,
      4.4,
      23,
      "Pacchi",
      1,
      0,
      2,
      0,
    ],
  ];
  if (includeIncrement)
    rows.push([
      "FSE+",
      "Pasta test AGEA",
      finalPieces,
      finalKg,
      sameBaseIncrement ? "DOC-BASE" : "DOC-NEW",
      sameBaseIncrement ? "01/08/2026" : "20/08/2026",
      23,
      "LOT-AGEA",
      "AGEA",
      1.1,
      2,
      10,
      5.5,
      23,
      23,
      23,
      23,
      23,
      23,
    ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    "Table1",
  );
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  );
}

function ageaRow(overrides: Record<number, string | number> = {}) {
  const values: Array<string | number> = [
    "FSE+",
    "Pasta test AGEA",
    8,
    4.4,
    "DOC-R1",
    "20/08/2026",
    "20/08/2026",
    "LOT-R1",
    "AGEA",
    4.4,
    8,
    8,
    4.4,
    "",
    "Pacchi",
    0,
    0,
    0,
    0,
  ];
  Object.entries(overrides).forEach(([index, value]) => {
    values[Number(index)] = value;
  });
  return values;
}

function workbookFromRows(rows: Array<Array<string | number>>) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    "Table1",
  );
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  );
}

function makeApp(
  permissions: string[],
  areaOperativaId: number | null = null,
): Express {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => {
    req.user = {
      id: userId,
      username: "agea-test",
      email: null,
      emailDaAggiornare: false,
      nome: "Agea",
      cognome: "Test",
      matricola: null,
      ruoloId: null,
      ruoloNome: null,
      centroAscoltoId: null,
      centroAscoltoNome: null,
      areaOperativaId,
      areaOperativaNome: null,
      zonaUdsId: null,
      zonaUdsNome: null,
      isAdmin: false,
      isSuperAdmin: false,
      aree: ["magazzino"],
      permessi: permissions,
      mustChangePassword: false,
    };
    next();
  });
  instance.use(ageaRouter);
  return instance;
}

async function analyze(
  mode: "PRIMA_ACQUISIZIONE" | "AGGIORNAMENTO" | "SOLO_ANALISI",
  buffer: Buffer,
) {
  return analyzeForWarehouse(mode, buffer, warehouseId);
}

async function analyzeForWarehouse(
  mode: "PRIMA_ACQUISIZIONE" | "AGGIORNAMENTO" | "SOLO_ANALISI",
  buffer: Buffer,
  targetWarehouseId: number,
) {
  return request(app)
    .post("/agea/importazioni/analizza")
    .query({
      magazzinoId: targetWarehouseId,
      modalita: mode,
      nomeFile: "registro.xlsx",
    })
    .set("Content-Type", AGEA_XLSX_MIME)
    .send(buffer);
}

beforeAll(async () => {
  const required = await pool.query(`
    SELECT count(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('importazioni_agea', 'importazioni_agea_righe', 'importazioni_agea_partite', 'movimenti_esterni_agea', 'mappature_prodotti_esterni')
  `);
  if (required.rows[0].count !== 5)
    throw new Error(
      "Applicare lib/db/updates/20260822_magazzino_2_0b_agea_import.sql al database di test",
    );
  await ensureAmbienteModuli();
  originalLotti =
    (await listModuliFunzionali()).find((item) => item.codice === "LOTTI")
      ?.attivo ?? true;
  await updateModuloAmbiente("LOTTI", true, null);
  [{ id: userId }] = await db
    .insert(utentiTable)
    .values({
      username: `agea_${suffix}`,
      passwordHash: "x",
      nome: "Agea Test",
    })
    .returning({ id: utentiTable.id });
  [{ id: scopeAreaId }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Area scope AGEA ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  [{ id: foreignAreaId }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Area esterna AGEA ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  [{ id: warehouseId }] = await db
    .insert(magazziniTable)
    .values({ codice: `AGEA-${suffix}`.slice(0, 20), nome: `AGEA ${suffix}` })
    .returning({ id: magazziniTable.id });
  [{ id: foreignWarehouseId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `AGEAX-${suffix}`.slice(0, 20),
      nome: `AGEA esterno ${suffix}`,
      areaOperativaId: foreignAreaId,
    })
    .returning({ id: magazziniTable.id });
  [{ id: productId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `AGEA-${suffix}`.slice(0, 30),
      nome: "Pasta AGEA interna",
      tipoProdotto: "alimentare",
      unitaMisura: "kg",
      gestioneLotto: true,
      gestioneScadenza: false,
    })
    .returning({ id: prodottiTable.id });
  await db.insert(mappatureProdottiEsterniTable).values({
    fonte: "AGEA_SIFEAD",
    descrizioneEsterna: "Pasta test AGEA",
    chiaveDescrizioneNormalizzata: "PASTA TEST AGEA",
    prodottoId: productId,
    creatoDa: userId,
    aggiornatoDa: userId,
  });
  const permissions = [
    "magazzino.agea.view",
    "magazzino.agea.import",
    "magazzino.agea.mapping.manage",
    "magazzino.agea.bootstrap",
  ];
  app = makeApp(permissions);
  deniedApp = makeApp(["magazzino.agea.view"]);
  scopedApp = makeApp(permissions, scopeAreaId);
});

afterAll(async () => {
  for (const concurrencyWarehouseId of concurrencyWarehouseIds) {
    const imports = await db
      .select({ id: importazioniAgeaTable.id })
      .from(importazioniAgeaTable)
      .where(eq(importazioniAgeaTable.magazzinoId, concurrencyWarehouseId));
    const importIds = imports.map((item) => item.id);
    if (importIds.length)
      await db
        .update(importazioniAgeaRigheTable)
        .set({ movimentoEsternoId: null })
        .where(inArray(importazioniAgeaRigheTable.importazioneId, importIds));
    await db
      .delete(movimentiEsterniAgeaTable)
      .where(eq(movimentiEsterniAgeaTable.magazzinoId, concurrencyWarehouseId));
    await db
      .update(importazioniAgeaTable)
      .set({ bootstrapCaricoId: null })
      .where(eq(importazioniAgeaTable.magazzinoId, concurrencyWarehouseId));
    await db
      .delete(importazioniAgeaTable)
      .where(eq(importazioniAgeaTable.magazzinoId, concurrencyWarehouseId));
    await db
      .delete(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, concurrencyWarehouseId));
    const loads = await db
      .select({ id: carichiMagazzinoTable.id })
      .from(carichiMagazzinoTable)
      .where(eq(carichiMagazzinoTable.magazzinoId, concurrencyWarehouseId));
    if (loads.length)
      await db.delete(carichiMagazzinoRigheTable).where(
        inArray(
          carichiMagazzinoRigheTable.caricoMagazzinoId,
          loads.map((load) => load.id),
        ),
      );
    await db
      .delete(carichiMagazzinoTable)
      .where(eq(carichiMagazzinoTable.magazzinoId, concurrencyWarehouseId));
    await db
      .delete(lottiTable)
      .where(eq(lottiTable.magazzinoId, concurrencyWarehouseId));
    await db
      .delete(magazziniTable)
      .where(eq(magazziniTable.id, concurrencyWarehouseId));
  }
  if (manyToOneWarehouseId != null) {
    const imports = await db
      .select({ id: importazioniAgeaTable.id })
      .from(importazioniAgeaTable)
      .where(eq(importazioniAgeaTable.magazzinoId, manyToOneWarehouseId));
    const importIds = imports.map((item) => item.id);
    if (importIds.length)
      await db
        .update(importazioniAgeaRigheTable)
        .set({ movimentoEsternoId: null })
        .where(inArray(importazioniAgeaRigheTable.importazioneId, importIds));
    await db
      .delete(movimentiEsterniAgeaTable)
      .where(eq(movimentiEsterniAgeaTable.magazzinoId, manyToOneWarehouseId));
    await db
      .update(importazioniAgeaTable)
      .set({ bootstrapCaricoId: null })
      .where(eq(importazioniAgeaTable.magazzinoId, manyToOneWarehouseId));
    await db
      .delete(importazioniAgeaTable)
      .where(eq(importazioniAgeaTable.magazzinoId, manyToOneWarehouseId));
    await db
      .delete(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, manyToOneWarehouseId));
    const loads = await db
      .select({ id: carichiMagazzinoTable.id })
      .from(carichiMagazzinoTable)
      .where(eq(carichiMagazzinoTable.magazzinoId, manyToOneWarehouseId));
    if (loads.length)
      await db.delete(carichiMagazzinoRigheTable).where(
        inArray(
          carichiMagazzinoRigheTable.caricoMagazzinoId,
          loads.map((load) => load.id),
        ),
      );
    await db
      .delete(carichiMagazzinoTable)
      .where(eq(carichiMagazzinoTable.magazzinoId, manyToOneWarehouseId));
    await db
      .delete(lottiTable)
      .where(eq(lottiTable.magazzinoId, manyToOneWarehouseId));
    await db
      .delete(magazziniTable)
      .where(eq(magazziniTable.id, manyToOneWarehouseId));
  }
  if (acceptanceWarehouseId != null) {
    if (acceptanceReconciliationId != null) {
      await db
        .delete(riconciliazioniFseRigheTable)
        .where(
          eq(
            riconciliazioniFseRigheTable.riconciliazioneId,
            acceptanceReconciliationId,
          ),
        );
      await db
        .delete(riconciliazioniFseTable)
        .where(eq(riconciliazioniFseTable.id, acceptanceReconciliationId));
    }
    const acceptanceImports = await db
      .select({ id: importazioniAgeaTable.id })
      .from(importazioniAgeaTable)
      .where(eq(importazioniAgeaTable.magazzinoId, acceptanceWarehouseId));
    const acceptanceImportIds = acceptanceImports.map((item) => item.id);
    if (acceptanceImportIds.length)
      await db
        .update(importazioniAgeaRigheTable)
        .set({ movimentoEsternoId: null })
        .where(
          inArray(
            importazioniAgeaRigheTable.importazioneId,
            acceptanceImportIds,
          ),
        );
    await db
      .delete(movimentiEsterniAgeaTable)
      .where(eq(movimentiEsterniAgeaTable.magazzinoId, acceptanceWarehouseId));
    await db
      .update(importazioniAgeaTable)
      .set({ bootstrapCaricoId: null })
      .where(eq(importazioniAgeaTable.magazzinoId, acceptanceWarehouseId));
    await db
      .delete(importazioniAgeaTable)
      .where(eq(importazioniAgeaTable.magazzinoId, acceptanceWarehouseId));
    await db
      .delete(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, acceptanceWarehouseId));
    if (acceptanceProductIds.length)
      await db
        .delete(carichiMagazzinoRigheTable)
        .where(
          inArray(carichiMagazzinoRigheTable.prodottoId, acceptanceProductIds),
        );
    await db
      .delete(carichiMagazzinoTable)
      .where(eq(carichiMagazzinoTable.magazzinoId, acceptanceWarehouseId));
    await db
      .delete(lottiTable)
      .where(eq(lottiTable.magazzinoId, acceptanceWarehouseId));
    if (acceptanceProductIds.length) {
      await db
        .delete(mappatureProdottiEsterniTable)
        .where(
          inArray(
            mappatureProdottiEsterniTable.prodottoId,
            acceptanceProductIds,
          ),
        );
      await db
        .delete(prodottiTable)
        .where(inArray(prodottiTable.id, acceptanceProductIds));
    }
    await db
      .delete(magazziniTable)
      .where(eq(magazziniTable.id, acceptanceWarehouseId));
  }
  await db
    .update(importazioniAgeaRigheTable)
    .set({ movimentoEsternoId: null })
    .where(eq(importazioniAgeaRigheTable.prodottoIdSnapshot, productId));
  await db
    .delete(movimentiEsterniAgeaTable)
    .where(eq(movimentiEsterniAgeaTable.magazzinoId, warehouseId));
  await db
    .delete(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.magazzinoId, warehouseId));
  await db
    .delete(movimentiTable)
    .where(eq(movimentiTable.magazzinoId, warehouseId));
  await db
    .delete(carichiMagazzinoRigheTable)
    .where(eq(carichiMagazzinoRigheTable.prodottoId, productId));
  await db
    .delete(carichiMagazzinoTable)
    .where(eq(carichiMagazzinoTable.magazzinoId, warehouseId));
  await db.delete(lottiTable).where(eq(lottiTable.magazzinoId, warehouseId));
  await db
    .delete(mappatureProdottiEsterniTable)
    .where(eq(mappatureProdottiEsterniTable.prodottoId, productId));
  if (extraProductIds.length) {
    await db
      .delete(mappatureProdottiEsterniTable)
      .where(
        inArray(mappatureProdottiEsterniTable.prodottoId, extraProductIds),
      );
    await db
      .delete(prodottiTable)
      .where(inArray(prodottiTable.id, extraProductIds));
  }
  await db.delete(prodottiTable).where(eq(prodottiTable.id, productId));
  await db.delete(magazziniTable).where(eq(magazziniTable.id, warehouseId));
  await db
    .delete(magazziniTable)
    .where(eq(magazziniTable.id, foreignWarehouseId));
  await db
    .delete(systemLogsTable)
    .where(eq(systemLogsTable.actorUserId, userId));
  await db.delete(utentiTable).where(eq(utentiTable.id, userId));
  await db
    .delete(areeOperativeTable)
    .where(eq(areeOperativeTable.id, scopeAreaId));
  await db
    .delete(areeOperativeTable)
    .where(eq(areeOperativeTable.id, foreignAreaId));
  await updateModuloAmbiente("LOTTI", originalLotti, null);
  await pool.end();
});

describe("Import AGEA/SIFEAD 2.0B", () => {
  it("applica il bootstrap come singolo SALDO_INIZIALE e non genera scarichi dalle righe negative", async () => {
    const analyzed = await analyze("PRIMA_ACQUISIZIONE", registry());
    expect(analyzed.status).toBe(201);
    expect(analyzed.body).toMatchObject({
      stato: "PRONTA",
      righeTotali: 2,
      righeCarico: 1,
      righeDistribuzione: 1,
      partiteSaldoPositivo: 1,
    });
    const confirmed = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
      .send({ versione: analyzed.body.versione });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ replay: false });
    expect(confirmed.body.carichi).toHaveLength(1);
    const [load] = await db
      .select()
      .from(carichiMagazzinoTable)
      .where(eq(carichiMagazzinoTable.id, confirmed.body.carichi[0]));
    expect(load).toMatchObject({
      origineCarico: "SALDO_INIZIALE",
      numeroDocumento: "AGEA-SALDO-2026-08-20",
    });
    const stockMovements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, warehouseId));
    expect(stockMovements).toHaveLength(1);
    expect(stockMovements[0].tipoMovimento).toBe("carico");
    expect(InventoryDecimal.parse(stockMovements[0].quantita).toDb()).toBe(
      "4.400000",
    );
    const staleReplay = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
      .send({ versione: analyzed.body.versione });
    expect(staleReplay.status).toBe(409);
    expect(staleReplay.body.code).toBe("VERSIONE_NON_CORRENTE");
    const replay = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
      .send({ versione: confirmed.body.importazione.versione });
    expect(replay.body.replay).toBe(true);
    expect(
      await db
        .select()
        .from(carichiMagazzinoTable)
        .where(eq(carichiMagazzinoTable.magazzinoId, warehouseId)),
    ).toHaveLength(1);
  });

  it("riconosce lo storico e applica soltanto il nuovo carico positivo nell'aggiornamento", async () => {
    const analyzed = await analyze("AGGIORNAMENTO", registry(true));
    expect(analyzed.status).toBe(201);
    expect(analyzed.body).toMatchObject({
      stato: "PRONTA",
      righeTotali: 3,
      righeDuplicate: 2,
      righeNuove: 1,
    });
    const confirmed = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
      .send({ versione: analyzed.body.versione });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.carichi).toHaveLength(1);
    const [lot] = await db
      .select()
      .from(lottiTable)
      .where(
        and(
          eq(lottiTable.magazzinoId, warehouseId),
          eq(lottiTable.prodottoId, productId),
        ),
      );
    expect(InventoryDecimal.parse(lot.quantitaCaricata).toDb()).toBe(
      "5.500000",
    );
    expect(InventoryDecimal.parse(lot.quantitaResidua).toDb()).toBe("5.500000");
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, warehouseId)),
    ).toHaveLength(2);
  });

  it("non duplica un registro ripetuto e blocca una identity nota con contenuto modificato", async () => {
    const repeated = await analyze("AGGIORNAMENTO", registry(true));
    expect(repeated.body).toMatchObject({
      stato: "PRONTA",
      righeDuplicate: 3,
      righeNuove: 0,
    });
    const confirmed = await request(app)
      .post(`/agea/importazioni/${repeated.body.id}/conferma`)
      .send({ versione: repeated.body.versione });
    expect(confirmed.body.carichi).toHaveLength(0);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, warehouseId)),
    ).toHaveLength(2);

    const modified = await analyze("AGGIORNAMENTO", registry(true, true));
    expect(modified.body).toMatchObject({
      stato: "BLOCCATA",
      righeModificate: 1,
    });
  });

  it("abbina prima il content hash noto e non rinumera lo storico quando arriva una nuova occorrenza della stessa identity base", async () => {
    const analyzed = await analyze(
      "AGGIORNAMENTO",
      registry(true, false, true),
    );
    expect(analyzed.status).toBe(201);
    expect(analyzed.body).toMatchObject({
      stato: "PRONTA",
      righeDuplicate: 2,
      righeNuove: 1,
      righeModificate: 0,
    });
  });

  it("conta separatamente una riga nuova, duplicata, modificata e ambigua", async () => {
    const [{ id: countWarehouseId }] = await db
      .insert(magazziniTable)
      .values({
        codice: `AGEACT-${suffix}`.slice(0, 20),
        nome: `AGEA conteggi ${suffix}`,
      })
      .returning({ id: magazziniTable.id });
    concurrencyWarehouseIds.push(countWarehouseId);
    const buffer = workbookFromRows([
      ageaRow({ 4: "COUNT-NEW", 9: 1, 10: 2 }),
      ageaRow({ 4: "COUNT-DUPLICATE", 9: 2, 10: 4 }),
      ageaRow({ 4: "COUNT-MODIFIED", 9: 3, 10: 6 }),
      ageaRow({ 4: "COUNT-AMBIGUOUS", 9: 4, 10: 8 }),
    ]);
    const parsed = parseAgeaWorkbook(buffer);
    const seed = await analyzeForWarehouse(
      "SOLO_ANALISI",
      buffer,
      countWarehouseId,
    );
    const seedRows = await db
      .select()
      .from(importazioniAgeaRigheTable)
      .where(eq(importazioniAgeaRigheTable.importazioneId, seed.body.id));
    const seedByNumber = new Map(seedRows.map((row) => [row.numeroRiga, row]));
    const byDocument = new Map(
      parsed.rows.map((row) => [
        row.numeroDocumentoNormalizzato,
        { parsed: row, stored: seedByNumber.get(row.numeroRiga)! },
      ]),
    );
    const duplicate = byDocument.get("COUNT-DUPLICATE")!;
    const modified = byDocument.get("COUNT-MODIFIED")!;
    const ambiguous = byDocument.get("COUNT-AMBIGUOUS")!;
    await db.insert(movimentiEsterniAgeaTable).values([
      {
        magazzinoId: countWarehouseId,
        identityKey: `${duplicate.parsed.identityBaseHash}:1`,
        identityBaseHash: duplicate.parsed.identityBaseHash,
        identityOccurrence: 1,
        acceptedContentHash: duplicate.parsed.contentHash,
        acceptedImportRowId: duplicate.stored.id,
        tipoMovimentoEsterno: "CARICO",
        prodottoIdSnapshot: productId,
        firstSeenImportId: seed.body.id,
        lastSeenImportId: seed.body.id,
        statoApplicazione: "NON_APPLICABILE_RIFERIMENTO",
      },
      {
        magazzinoId: countWarehouseId,
        identityKey: `${modified.parsed.identityBaseHash}:1`,
        identityBaseHash: modified.parsed.identityBaseHash,
        identityOccurrence: 1,
        acceptedContentHash: "f".repeat(64),
        acceptedImportRowId: modified.stored.id,
        tipoMovimentoEsterno: "CARICO",
        prodottoIdSnapshot: productId,
        firstSeenImportId: seed.body.id,
        lastSeenImportId: seed.body.id,
        statoApplicazione: "NON_APPLICABILE_RIFERIMENTO",
      },
      ...[1, 2].map((occurrence) => ({
        magazzinoId: countWarehouseId,
        identityKey: `${ambiguous.parsed.identityBaseHash}:${occurrence}`,
        identityBaseHash: ambiguous.parsed.identityBaseHash,
        identityOccurrence: occurrence,
        acceptedContentHash: (occurrence === 1 ? "e" : "d").repeat(64),
        acceptedImportRowId: ambiguous.stored.id,
        tipoMovimentoEsterno: "CARICO",
        prodottoIdSnapshot: productId,
        firstSeenImportId: seed.body.id,
        lastSeenImportId: seed.body.id,
        statoApplicazione: "NON_APPLICABILE_RIFERIMENTO",
      })),
    ]);

    const analyzed = await analyzeForWarehouse(
      "SOLO_ANALISI",
      buffer,
      countWarehouseId,
    );
    expect(analyzed.body).toMatchObject({
      stato: "BLOCCATA",
      righeNuove: 1,
      righeDuplicate: 1,
      righeModificate: 1,
      righeAmbigue: 1,
    });
    const classified = await request(app).get(
      `/agea/importazioni/${analyzed.body.id}/righe`,
    );
    expect(
      classified.body.items.map((row: { statoRiga: string }) => row.statoRiga),
    ).toEqual([
      "DA_APPLICARE",
      "DUPLICATA",
      "MODIFICATO_NEL_REGISTRO",
      "IDENTITA_AMBIGUA",
    ]);
    expect(
      classified.body.items.flatMap(
        (row: { errorCodesJson: string[] }) => row.errorCodesJson,
      ),
    ).toEqual(
      expect.arrayContaining(["MODIFICATO_NEL_REGISTRO", "IDENTITA_AMBIGUA"]),
    );
  });

  it("non collide su documenti lunghi e mantiene l'idempotenza invertendo l'ordine", async () => {
    const prefix = "DOC-" + "X".repeat(130);
    const firstBuffer = workbookFromRows([
      ageaRow({ 4: `${prefix}-A`, 9: 1.1, 10: 2 }),
      ageaRow({ 4: `${prefix}-B`, 9: 2.2, 10: 4 }),
    ]);
    const analyzed = await analyze("AGGIORNAMENTO", firstBuffer);
    expect(analyzed.body).toMatchObject({ stato: "PRONTA", righeNuove: 2 });
    const confirmed = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
      .send({ versione: analyzed.body.versione });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.carichi).toHaveLength(2);

    const reversed = await analyze(
      "AGGIORNAMENTO",
      workbookFromRows([
        ageaRow({ 4: `${prefix}-B`, 9: 2.2, 10: 4 }),
        ageaRow({ 4: `${prefix}-A`, 9: 1.1, 10: 2 }),
      ]),
    );
    expect(reversed.body).toMatchObject({
      stato: "PRONTA",
      righeDuplicate: 2,
      righeNuove: 0,
    });
    const replayed = await request(app)
      .post(`/agea/importazioni/${reversed.body.id}/conferma`)
      .send({ versione: reversed.body.versione });
    expect(replayed.status).toBe(200);
    expect(replayed.body.carichi).toHaveLength(0);
  });

  it("ricostruisce tutti gli snapshot dopo mapping A→B, disable/enable e blocca la conferma su drift", async () => {
    const [mappingA] = await db
      .select()
      .from(mappatureProdottiEsterniTable)
      .where(
        eq(
          mappatureProdottiEsterniTable.chiaveDescrizioneNormalizzata,
          "PASTA TEST AGEA",
        ),
      );
    const [{ id: productB }] = await db
      .insert(prodottiTable)
      .values({
        codice: `AGEAB-${suffix}`.slice(0, 30),
        nome: "Pasta AGEA interna B",
        tipoProdotto: "alimentare",
        unitaMisura: "kg",
        gestioneLotto: true,
        gestioneScadenza: false,
      })
      .returning({ id: prodottiTable.id });
    extraProductIds.push(productB);
    const analyzed = await analyze(
      "SOLO_ANALISI",
      workbookFromRows([ageaRow()]),
    );
    expect(analyzed.body.stato).toBe("PRONTA");

    const unsafeUpsert = await request(app)
      .post("/agea/mappature-prodotti")
      .send({ descrizioneEsterna: "Pasta test AGEA", prodottoId: productB });
    expect(unsafeUpsert.status).toBe(409);
    expect(unsafeUpsert.body.code).toBe("MAPPATURA_GIA_ESISTENTE");

    const changed = await request(app)
      .patch(`/agea/mappature-prodotti/${mappingA.id}`)
      .send({
        prodottoId: productB,
        versione: mappingA.versione,
        attiva: true,
      });
    expect(changed.status).toBe(200);
    const drift = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
      .send({ versione: analyzed.body.versione });
    expect(drift.status).toBe(409);
    expect(drift.body.code).toBe("MAPPING_MODIFICATO");

    const recalculatedB = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/ricalcola`)
      .send({ versione: analyzed.body.versione });
    expect(recalculatedB.status).toBe(200);
    expect(recalculatedB.body.versione).toBe(analyzed.body.versione + 1);
    const [rowB] = await db
      .select()
      .from(importazioniAgeaRigheTable)
      .where(eq(importazioniAgeaRigheTable.importazioneId, analyzed.body.id));
    expect(rowB).toMatchObject({
      prodottoIdSnapshot: productB,
      mappingVersioneSnapshot: changed.body.versione,
    });

    const disabled = await request(app)
      .patch(`/agea/mappature-prodotti/${mappingA.id}`)
      .send({
        prodottoId: productB,
        versione: changed.body.versione,
        attiva: false,
      });
    const recalculatedDisabled = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/ricalcola`)
      .send({ versione: recalculatedB.body.versione });
    expect(recalculatedDisabled.body.stato).toBe("DA_MAPPARE");
    const [unmapped] = await db
      .select()
      .from(importazioniAgeaRigheTable)
      .where(eq(importazioniAgeaRigheTable.importazioneId, analyzed.body.id));
    expect(unmapped.prodottoIdSnapshot).toBeNull();

    const enabled = await request(app)
      .patch(`/agea/mappature-prodotti/${mappingA.id}`)
      .send({
        prodottoId: productB,
        versione: disabled.body.versione,
        attiva: true,
      });
    const recalculatedEnabled = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/ricalcola`)
      .send({ versione: recalculatedDisabled.body.versione });
    expect(recalculatedEnabled.body.stato).toBe("PRONTA");

    const restored = await request(app)
      .patch(`/agea/mappature-prodotti/${mappingA.id}`)
      .send({
        prodottoId: productId,
        versione: enabled.body.versione,
        attiva: true,
      });
    expect(restored.status).toBe(200);
    const confirmedRows = await db
      .select()
      .from(importazioniAgeaRigheTable)
      .innerJoin(
        importazioniAgeaTable,
        eq(importazioniAgeaTable.id, importazioniAgeaRigheTable.importazioneId),
      )
      .where(eq(importazioniAgeaTable.stato, "CONFERMATA"));
    expect(
      confirmedRows.every(
        ({ importazioni_agea_righe: row }) =>
          row.prodottoIdSnapshot === productId,
      ),
    ).toBe(true);
  });

  it("aggrega in una sola partita due descrizioni mappate allo stesso prodotto/fondo/lotto", async () => {
    await db.insert(mappatureProdottiEsterniTable).values({
      fonte: "AGEA_SIFEAD",
      descrizioneEsterna: "Alias pasta AGEA",
      chiaveDescrizioneNormalizzata: "ALIAS PASTA AGEA",
      prodottoId: productId,
      creatoDa: userId,
      aggiornatoDa: userId,
    });
    [{ id: manyToOneWarehouseId }] = await db
      .insert(magazziniTable)
      .values({
        codice: `AGEAM-${suffix}`.slice(0, 20),
        nome: `AGEA many-to-one ${suffix}`,
      })
      .returning({ id: magazziniTable.id });
    const analyzed = await request(app)
      .post("/agea/importazioni/analizza")
      .query({
        magazzinoId: manyToOneWarehouseId,
        modalita: "PRIMA_ACQUISIZIONE",
        nomeFile: "many-to-one.xlsx",
      })
      .set("Content-Type", AGEA_XLSX_MIME)
      .send(
        workbookFromRows([
          ageaRow(),
          ageaRow({
            1: "Alias pasta AGEA",
            4: "SC-R1",
            8: "Distribuzione indigenti",
            9: -1.1,
            10: -2,
          }),
        ]),
      );
    expect(analyzed.body).toMatchObject({
      stato: "PRONTA",
      partiteTotali: 1,
      partiteSaldoPositivo: 1,
    });
    const parties = await request(app).get(
      `/agea/importazioni/${analyzed.body.id}/partite`,
    );
    expect(parties.body).toHaveLength(1);
    expect(parties.body[0].descrizioniEsterneJson).toEqual([
      "ALIAS PASTA AGEA",
      "PASTA TEST AGEA",
    ]);
    expect(
      InventoryDecimal.parse(parties.body[0].quantitaOperativa).toDb(),
    ).toBe("4.400000");
    const confirmed = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
      .send({ versione: analyzed.body.versione });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.carichi).toHaveLength(1);
    const loadLines = await db
      .select()
      .from(carichiMagazzinoRigheTable)
      .where(
        eq(
          carichiMagazzinoRigheTable.caricoMagazzinoId,
          confirmed.body.carichi[0],
        ),
      );
    expect(loadLines).toHaveLength(1);
    expect(InventoryDecimal.parse(loadLines[0].quantitaOperativa).toDb()).toBe(
      "4.400000",
    );
  });

  it("blocca il merge molti-a-uno quando le scadenze manuali precedenti sono discordanti", async () => {
    const [{ id: conflictWarehouseId }] = await db
      .insert(magazziniTable)
      .values({
        codice: `AGEACM-${suffix}`.slice(0, 20),
        nome: `AGEA merge conflict ${suffix}`,
      })
      .returning({ id: magazziniTable.id });
    concurrencyWarehouseIds.push(conflictWarehouseId);
    const [{ id: conflictProductId }] = await db
      .insert(prodottiTable)
      .values({
        codice: `AGEACF-${suffix}`.slice(0, 30),
        nome: "Pasta AGEA conflitto",
        tipoProdotto: "alimentare",
        unitaMisura: "kg",
        gestioneLotto: true,
        gestioneScadenza: true,
      })
      .returning({ id: prodottiTable.id });
    extraProductIds.push(conflictProductId);
    await db
      .update(prodottiTable)
      .set({ gestioneScadenza: true })
      .where(eq(prodottiTable.id, productId));
    const [conflictMapping] = await db
      .insert(mappatureProdottiEsterniTable)
      .values({
        fonte: "AGEA_SIFEAD",
        descrizioneEsterna: "Alias conflitto AGEA",
        chiaveDescrizioneNormalizzata: "ALIAS CONFLITTO AGEA",
        prodottoId: conflictProductId,
        creatoDa: userId,
        aggiornatoDa: userId,
      })
      .returning();
    const analyzed = await analyzeForWarehouse(
      "SOLO_ANALISI",
      workbookFromRows([
        ageaRow({ 4: "MERGE-CONFLICT-A" }),
        ageaRow({ 1: "Alias conflitto AGEA", 4: "MERGE-CONFLICT-B" }),
      ]),
      conflictWarehouseId,
    );
    const initialParties = await request(app).get(
      `/agea/importazioni/${analyzed.body.id}/partite`,
    );
    expect(initialParties.body).toHaveLength(2);
    const firstCorrection = await request(app)
      .patch(
        `/agea/importazioni/${analyzed.body.id}/partite/${initialParties.body.find((party: { prodottoId: number }) => party.prodottoId === productId).id}`,
      )
      .send({
        dataScadenza: "2028-01-31",
        motivazione: "Scadenza prodotto A",
        versione: analyzed.body.versione,
      });
    expect(firstCorrection.status, JSON.stringify(firstCorrection.body)).toBe(
      200,
    );
    const refreshedParties = await request(app).get(
      `/agea/importazioni/${analyzed.body.id}/partite`,
    );
    const secondCorrection = await request(app)
      .patch(
        `/agea/importazioni/${analyzed.body.id}/partite/${refreshedParties.body.find((party: { prodottoId: number }) => party.prodottoId === conflictProductId).id}`,
      )
      .send({
        dataScadenza: "2029-01-31",
        motivazione: "Scadenza prodotto B",
        versione: firstCorrection.body.versione,
      });
    expect(secondCorrection.status, JSON.stringify(secondCorrection.body)).toBe(
      200,
    );
    expect(secondCorrection.body.stato).toBe("PRONTA");
    const mergedMapping = await request(app)
      .patch(`/agea/mappature-prodotti/${conflictMapping.id}`)
      .send({
        prodottoId: productId,
        versione: conflictMapping.versione,
        attiva: true,
      });
    expect(mergedMapping.status).toBe(200);
    const recalculated = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/ricalcola`)
      .send({ versione: secondCorrection.body.versione });
    expect(recalculated.body).toMatchObject({
      stato: "BLOCCATA",
      partiteTotali: 1,
    });
    const mergedParties = await request(app).get(
      `/agea/importazioni/${analyzed.body.id}/partite`,
    );
    expect(mergedParties.body).toHaveLength(1);
    expect(mergedParties.body[0].errorCodesJson).toContain(
      "CORREZIONI_PARTITA_CONFLITTO",
    );
    await db
      .update(prodottiTable)
      .set({ gestioneScadenza: false })
      .where(eq(prodottiTable.id, productId));
  });

  it("blocca saldi finali negativi o a segno misto senza applicare valori assoluti", async () => {
    const negative = await analyze(
      "SOLO_ANALISI",
      workbookFromRows([
        ageaRow({
          2: -8,
          3: -4.4,
          8: "Distribuzione indigenti",
          9: -1,
          10: -2,
        }),
      ]),
    );
    expect(negative.body.stato).toBe("BLOCCATA");
    const negativeParties = await request(app).get(
      `/agea/importazioni/${negative.body.id}/partite`,
    );
    expect(negativeParties.body[0].errorCodesJson).toContain(
      "SALDO_FINALE_NEGATIVO",
    );
    expect(
      InventoryDecimal.parse(negativeParties.body[0].quantitaOperativa, {
        allowNegative: true,
      }).toDb(),
    ).toBe("-4.400000");

    const mixed = await analyze(
      "SOLO_ANALISI",
      workbookFromRows([ageaRow({ 2: 8, 3: -4.4 })]),
    );
    const mixedParties = await request(app).get(
      `/agea/importazioni/${mixed.body.id}/partite`,
    );
    expect(mixedParties.body[0].errorCodesJson).toEqual(
      expect.arrayContaining([
        "SALDO_FINALE_NEGATIVO",
        "SALDO_FINALE_SEGNO_INCOERENTE",
      ]),
    );

    const zero = await analyze(
      "SOLO_ANALISI",
      workbookFromRows([ageaRow({ 2: 0, 3: 0, 9: 0, 10: 0 })]),
    );
    const zeroParties = await request(app).get(
      `/agea/importazioni/${zero.body.id}/partite`,
    );
    expect(zero.body).toMatchObject({
      stato: "PRONTA",
      partiteSaldoPositivo: 0,
    });
    expect(zeroParties.body[0].stato).toBe("SALDO_ZERO");
    expect(
      InventoryDecimal.parse(zeroParties.body[0].quantitaOperativa).toDb(),
    ).toBe("0.000000");
  });

  it("applica correzioni effective versionate lasciando immutati i raw e gestisce la concorrenza", async () => {
    const analyzed = await analyze(
      "SOLO_ANALISI",
      workbookFromRows([ageaRow({ 5: 23, 6: 23, 7: "" })]),
    );
    const rows = await request(app).get(
      `/agea/importazioni/${analyzed.body.id}/righe`,
    );
    const rowId = rows.body.items[0].id;
    for (const body of [
      {},
      { versione: null },
      { versione: "1" },
      { versione: 1.5 },
      { versione: 0 },
    ]) {
      const invalidVersion = await request(app)
        .post(`/agea/importazioni/${analyzed.body.id}/ricalcola`)
        .send(body);
      expect(invalidVersion.status).toBe(400);
      expect(invalidVersion.body.code).toBe("VERSIONE_RICHIESTA");
    }
    const invalid = await request(app)
      .patch(
        `/agea/importazioni/${analyzed.body.id}/righe/${rowId}/data-carico`,
      )
      .send({
        valore: "2026-02-30",
        motivazione: "Correzione test",
        versione: analyzed.body.versione,
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("DATA_CIVILE_NON_VALIDA");
    const invalidLot = await request(app)
      .patch(`/agea/importazioni/${analyzed.body.id}/righe/${rowId}/lotto`)
      .send({
        valore: "X".repeat(81),
        motivazione: "Lotto oltre il limite ledger",
        versione: analyzed.body.versione,
      });
    expect(invalidLot.status).toBe(400);
    expect(invalidLot.body.code).toBe("LOTTO_NON_VALIDO");
    const correctedDate = await request(app)
      .patch(
        `/agea/importazioni/${analyzed.body.id}/righe/${rowId}/data-carico`,
      )
      .send({
        valore: "2026-08-20",
        motivazione: "Correzione test",
        versione: analyzed.body.versione,
      });
    expect(correctedDate.status).toBe(200);
    expect(correctedDate.body.versione).toBe(analyzed.body.versione + 1);
    const correctedLot = await request(app)
      .patch(`/agea/importazioni/${analyzed.body.id}/righe/${rowId}/lotto`)
      .send({
        valore: "  Lotto N\u0303  ",
        motivazione: "Correzione lotto test",
        versione: correctedDate.body.versione,
      });
    expect(correctedLot.status).toBe(200);
    expect(correctedLot.body.stato).toBe("PRONTA");
    const [stored] = await db
      .select()
      .from(importazioniAgeaRigheTable)
      .where(eq(importazioniAgeaRigheTable.id, rowId));
    expect(stored).toMatchObject({
      dataCaricoMagazzinoRaw: "23",
      dataCaricoEffettiva: "2026-08-20",
      lottoRaw: null,
      lottoEffettivoRaw: "  Lotto Ñ  ",
      lottoEffettivoNormalizzato: "LOTTO Ñ",
    });

    const removedLot = await request(app)
      .patch(`/agea/importazioni/${analyzed.body.id}/righe/${rowId}/lotto`)
      .send({
        valore: null,
        motivazione: "Rimozione correzione lotto test",
        versione: correctedLot.body.versione,
      });
    expect(removedLot.status).toBe(200);
    expect(removedLot.body.stato).toBe("BLOCCATA");
    const [withoutLotCorrection] = await db
      .select()
      .from(importazioniAgeaRigheTable)
      .where(eq(importazioniAgeaRigheTable.id, rowId));
    expect(withoutLotCorrection.lottoRaw).toBeNull();
    expect(withoutLotCorrection.lottoEffettivoRaw).toBeNull();
    expect(withoutLotCorrection.errorCodesJson).toContain(
      "LOTTO_DA_COMPLETARE",
    );

    const missingVersion = await request(app).post(
      `/agea/importazioni/${analyzed.body.id}/ricalcola`,
    );
    expect(missingVersion.status).toBe(400);
    expect(missingVersion.body.code).toBe("VERSIONE_RICHIESTA");
    const concurrent = await Promise.all([
      request(app)
        .post(`/agea/importazioni/${analyzed.body.id}/ricalcola`)
        .send({ versione: removedLot.body.versione }),
      request(app)
        .post(`/agea/importazioni/${analyzed.body.id}/ricalcola`)
        .send({ versione: removedLot.body.versione }),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      concurrent.find((response) => response.status === 409)?.body.code,
    ).toBe("VERSIONE_NON_CORRENTE");
    const conflicts = await db
      .select()
      .from(systemLogsTable)
      .where(eq(systemLogsTable.evento, "MAGAZZINO_AGEA_CONFLITTO"));
    expect(
      conflicts.some(
        (entry) =>
          (entry.details as { importazioneId?: number }).importazioneId ===
            analyzed.body.id &&
          (entry.details as { codiceErrore?: string }).codiceErrore ===
            "VERSIONE_NON_CORRENTE",
      ),
    ).toBe(true);
  });

  it("mantiene il lotto raw di 81 caratteri bloccante e consente una correzione effective a 80", async () => {
    const rawLot = "R".repeat(81);
    const effectiveLot = "E".repeat(80);
    const analyzed = await analyze(
      "SOLO_ANALISI",
      workbookFromRows([ageaRow({ 4: "LOT-LIMIT-R2", 7: rawLot })]),
    );
    expect(analyzed.body.stato).toBe("BLOCCATA");
    const rows = await request(app).get(
      `/agea/importazioni/${analyzed.body.id}/righe`,
    );
    expect(rows.body.items[0]).toMatchObject({
      lottoRaw: rawLot,
      blocking: true,
      errorCodesJson: expect.arrayContaining(["LOTTO_NON_VALIDO"]),
    });
    const corrected = await request(app)
      .patch(
        `/agea/importazioni/${analyzed.body.id}/righe/${rows.body.items[0].id}/lotto`,
      )
      .send({
        valore: effectiveLot,
        motivazione: "Allineamento al limite del ledger",
        versione: analyzed.body.versione,
      });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(corrected.body.stato).toBe("PRONTA");
    const [stored] = await db
      .select()
      .from(importazioniAgeaRigheTable)
      .where(eq(importazioniAgeaRigheTable.id, rows.body.items[0].id));
    expect(stored).toMatchObject({
      lottoRaw: rawLot,
      lottoEffettivoRaw: effectiveLot,
      lottoEffettivoNormalizzato: effectiveLot,
      blocking: false,
    });
  });

  it("rivalida sotto gli stessi party lock una Partita locale creata dopo la preview bootstrap", async () => {
    const [{ id: raceWarehouseId }] = await db
      .insert(magazziniTable)
      .values({
        codice: `AGEAPR-${suffix}`.slice(0, 20),
        nome: `AGEA party race ${suffix}`,
      })
      .returning({ id: magazziniTable.id });
    concurrencyWarehouseIds.push(raceWarehouseId);
    const analyzed = await analyzeForWarehouse(
      "PRIMA_ACQUISIZIONE",
      workbookFromRows([ageaRow({ 4: "PARTY-RACE-R2" })]),
      raceWarehouseId,
    );
    expect(analyzed.body.stato).toBe("PRONTA");

    await db.transaction((tx) =>
      createWarehouseLoad(tx, {
        magazzinoId: raceWarehouseId,
        origineCarico: "DONAZIONE",
        numeroDocumento: "MANUAL-RACE-R2",
        dataDocumento: "2026-08-20",
        dataCarico: "2026-08-20",
        creatoDa: userId,
        righe: [
          {
            prodottoId: productId,
            fondoOrigine: "FSE_PLUS",
            quantitaOperativa: "1.100000",
            unitaMisuraOperativa: "kg",
            quantitaPezzi: "2.000000",
            quantitaKgLt: "1.100000",
            fattoreKgLtPezzo: "0.550000000",
            codiceLotto: "LOT-R1",
          },
        ],
      }),
    );
    const [before] = await db
      .select()
      .from(lottiTable)
      .where(
        and(
          eq(lottiTable.magazzinoId, raceWarehouseId),
          eq(lottiTable.codiceLottoNormalizzato, "LOT-R1"),
        ),
      );
    const confirmed = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
      .send({ versione: analyzed.body.versione });
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.code).toBe("PREVIEW_DA_RICALCOLARE");
    const saldoLoads = await db
      .select()
      .from(carichiMagazzinoTable)
      .where(
        and(
          eq(carichiMagazzinoTable.magazzinoId, raceWarehouseId),
          eq(carichiMagazzinoTable.origineCarico, "SALDO_INIZIALE"),
        ),
      );
    expect(saldoLoads).toHaveLength(0);
    const [after] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, before.id));
    expect(after.quantitaResidua).toBe(before.quantitaResidua);
    const canonicalRows = await db
      .select()
      .from(movimentiEsterniAgeaTable)
      .where(eq(movimentiEsterniAgeaTable.firstSeenImportId, analyzed.body.id));
    expect(canonicalRows).toHaveLength(0);
  });

  it("serializza correzioni, annullamento, conferme e due bootstrap concorrenti", async () => {
    const expectOneWinner = (
      responses: Array<{ status: number; body: { code?: string } }>,
    ) => {
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      expect(
        responses.find((response) => response.status === 409)?.body.code,
      ).toMatch(
        /VERSIONE_NON_CORRENTE|IMPORTAZIONE_IMMUTABILE|BOOTSTRAP_GIA_CONFERMATO|CARICO_AGEA_ESISTENTE/,
      );
    };

    const recalculateImport = await analyze(
      "SOLO_ANALISI",
      workbookFromRows([ageaRow({ 4: "RACE-RECALCULATE" })]),
    );
    expectOneWinner(
      await Promise.all([
        request(app)
          .post(`/agea/importazioni/${recalculateImport.body.id}/ricalcola`)
          .send({ versione: recalculateImport.body.versione }),
        request(app)
          .post(`/agea/importazioni/${recalculateImport.body.id}/conferma`)
          .send({ versione: recalculateImport.body.versione }),
      ]),
    );

    const expiryImport = await analyze(
      "SOLO_ANALISI",
      workbookFromRows([ageaRow({ 4: "RACE-EXPIRY", 7: "RACE-EXPIRY-LOT" })]),
    );
    const expiryParties = await request(app).get(
      `/agea/importazioni/${expiryImport.body.id}/partite`,
    );
    expectOneWinner(
      await Promise.all([
        request(app)
          .patch(
            `/agea/importazioni/${expiryImport.body.id}/partite/${expiryParties.body[0].id}`,
          )
          .send({
            dataScadenza: "2028-01-31",
            motivazione: "Race scadenza",
            versione: expiryImport.body.versione,
          }),
        request(app)
          .post(`/agea/importazioni/${expiryImport.body.id}/conferma`)
          .send({ versione: expiryImport.body.versione }),
      ]),
    );

    const lotImport = await analyze(
      "SOLO_ANALISI",
      workbookFromRows([ageaRow({ 4: "RACE-LOT" })]),
    );
    const lotRows = await request(app).get(
      `/agea/importazioni/${lotImport.body.id}/righe`,
    );
    expectOneWinner(
      await Promise.all([
        request(app)
          .patch(
            `/agea/importazioni/${lotImport.body.id}/righe/${lotRows.body.items[0].id}/lotto`,
          )
          .send({
            valore: "LOT-RACE",
            motivazione: "Race lotto",
            versione: lotImport.body.versione,
          }),
        request(app)
          .post(`/agea/importazioni/${lotImport.body.id}/conferma`)
          .send({ versione: lotImport.body.versione }),
      ]),
    );

    const cancelledImport = await analyze(
      "SOLO_ANALISI",
      workbookFromRows([ageaRow({ 4: "RACE-CANCEL" })]),
    );
    expectOneWinner(
      await Promise.all([
        request(app)
          .post(`/agea/importazioni/${cancelledImport.body.id}/annulla`)
          .send({ versione: cancelledImport.body.versione }),
        request(app)
          .post(`/agea/importazioni/${cancelledImport.body.id}/conferma`)
          .send({ versione: cancelledImport.body.versione }),
      ]),
    );

    const doubleConfirmImport = await analyze(
      "SOLO_ANALISI",
      workbookFromRows([ageaRow({ 4: "RACE-CONFIRM" })]),
    );
    expectOneWinner(
      await Promise.all([
        request(app)
          .post(`/agea/importazioni/${doubleConfirmImport.body.id}/conferma`)
          .send({ versione: doubleConfirmImport.body.versione }),
        request(app)
          .post(`/agea/importazioni/${doubleConfirmImport.body.id}/conferma`)
          .send({ versione: doubleConfirmImport.body.versione }),
      ]),
    );

    const [{ id: bootstrapWarehouseId }] = await db
      .insert(magazziniTable)
      .values({
        codice: `AGEAC-${suffix}`.slice(0, 20),
        nome: `AGEA concurrency ${suffix}`,
      })
      .returning({ id: magazziniTable.id });
    concurrencyWarehouseIds.push(bootstrapWarehouseId);
    const [bootstrapA, bootstrapB] = await Promise.all([
      analyzeForWarehouse(
        "PRIMA_ACQUISIZIONE",
        workbookFromRows([ageaRow({ 4: "BOOT-A" })]),
        bootstrapWarehouseId,
      ),
      analyzeForWarehouse(
        "PRIMA_ACQUISIZIONE",
        workbookFromRows([ageaRow({ 4: "BOOT-B" })]),
        bootstrapWarehouseId,
      ),
    ]);
    const bootstrapResponses = await Promise.all([
      request(app)
        .post(`/agea/importazioni/${bootstrapA.body.id}/conferma`)
        .send({ versione: bootstrapA.body.versione }),
      request(app)
        .post(`/agea/importazioni/${bootstrapB.body.id}/conferma`)
        .send({ versione: bootstrapB.body.versione }),
    ]);
    expectOneWinner(bootstrapResponses);
    const bootstrapLoads = await db
      .select({ id: carichiMagazzinoTable.id })
      .from(carichiMagazzinoTable)
      .where(eq(carichiMagazzinoTable.magazzinoId, bootstrapWarehouseId));
    expect(bootstrapLoads).toHaveLength(1);
  });

  it("crea un solo Carico multi-riga per documento e blocca date effettive divergenti", async () => {
    const [{ id: groupWarehouseId }] = await db
      .insert(magazziniTable)
      .values({
        codice: `AGEAGD-${suffix}`.slice(0, 20),
        nome: `AGEA date gruppo ${suffix}`,
      })
      .returning({ id: magazziniTable.id });
    concurrencyWarehouseIds.push(groupWarehouseId);
    const bootstrap = await analyzeForWarehouse(
      "PRIMA_ACQUISIZIONE",
      workbookFromRows([ageaRow({ 4: "GROUP-BOOTSTRAP" })]),
      groupWarehouseId,
    );
    const bootstrapped = await request(app)
      .post(`/agea/importazioni/${bootstrap.body.id}/conferma`)
      .send({ versione: bootstrap.body.versione });
    expect(bootstrapped.status, JSON.stringify(bootstrapped.body)).toBe(200);

    const sameDate = await analyzeForWarehouse(
      "AGGIORNAMENTO",
      workbookFromRows([
        ageaRow({ 4: "GROUP-SAME-DATE", 9: 1.1, 10: 2 }),
        ageaRow({ 4: "GROUP-SAME-DATE", 9: 2.2, 10: 4 }),
      ]),
      groupWarehouseId,
    );
    expect(sameDate.body.stato).toBe("PRONTA");
    const sameDateConfirmed = await request(app)
      .post(`/agea/importazioni/${sameDate.body.id}/conferma`)
      .send({ versione: sameDate.body.versione });
    expect(
      sameDateConfirmed.status,
      JSON.stringify(sameDateConfirmed.body),
    ).toBe(200);
    expect(sameDateConfirmed.body.carichi).toHaveLength(1);
    const sameDateLoadRows = await db
      .select()
      .from(carichiMagazzinoRigheTable)
      .where(
        eq(
          carichiMagazzinoRigheTable.caricoMagazzinoId,
          sameDateConfirmed.body.carichi[0],
        ),
      );
    expect(sameDateLoadRows).toHaveLength(2);

    const divergent = await analyzeForWarehouse(
      "AGGIORNAMENTO",
      workbookFromRows([
        ageaRow({ 4: "GROUP-DIVERGENT", 9: 3.3, 10: 6 }),
        ageaRow({ 4: "GROUP-DIVERGENT", 9: 4.4, 10: 8 }),
      ]),
      groupWarehouseId,
    );
    expect(divergent.body.stato).toBe("PRONTA");
    const divergentRows = await request(app).get(
      `/agea/importazioni/${divergent.body.id}/righe`,
    );
    const corrected = await request(app)
      .patch(
        `/agea/importazioni/${divergent.body.id}/righe/${divergentRows.body.items[0].id}/data-carico`,
      )
      .send({
        valore: "2026-08-21",
        motivazione: "Data verificata su documento",
        versione: divergent.body.versione,
      });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(corrected.body.stato).toBe("BLOCCATA");
    const blockedRows = await request(app).get(
      `/agea/importazioni/${divergent.body.id}/righe`,
    );
    expect(
      blockedRows.body.items.every(
        (row: { errorCodesJson: string[]; blocking: boolean }) =>
          row.blocking &&
          row.errorCodesJson.includes("DATA_CARICO_GRUPPO_INCOERENTE"),
      ),
    ).toBe(true);
    const loadsBeforeRejectedConfirm = await db
      .select()
      .from(carichiMagazzinoTable)
      .where(eq(carichiMagazzinoTable.magazzinoId, groupWarehouseId));
    const rejected = await request(app)
      .post(`/agea/importazioni/${divergent.body.id}/conferma`)
      .send({ versione: corrected.body.versione });
    expect(rejected.status).toBe(409);
    const loadsAfterRejectedConfirm = await db
      .select()
      .from(carichiMagazzinoTable)
      .where(eq(carichiMagazzinoTable.magazzinoId, groupWarehouseId));
    expect(loadsAfterRejectedConfirm).toHaveLength(
      loadsBeforeRejectedConfirm.length,
    );
  });

  it("propaga scadenza, lotto e fattore dalla partita preview a un carico incrementale", async () => {
    await db
      .update(prodottiTable)
      .set({ gestioneScadenza: true })
      .where(eq(prodottiTable.id, productId));
    const analyzed = await analyze(
      "AGGIORNAMENTO",
      workbookFromRows([
        ageaRow({
          4: "DOC-EXP-R1",
          7: "LOT-EXP-R1",
          9: 1.1,
          10: 2,
        }),
      ]),
    );
    expect(analyzed.body.stato).toBe("BLOCCATA");
    const parties = await request(app).get(
      `/agea/importazioni/${analyzed.body.id}/partite`,
    );
    expect(parties.body[0].errorCodesJson).toContain("SCADENZA_DA_COMPLETARE");
    const expiry = await request(app)
      .patch(
        `/agea/importazioni/${analyzed.body.id}/partite/${parties.body[0].id}`,
      )
      .send({
        dataScadenza: "2027-12-31",
        motivazione: "Scadenza da documento AGEA",
        versione: analyzed.body.versione,
      });
    expect(expiry.status).toBe(200);
    expect(expiry.body.stato).toBe("PRONTA");
    const confirmed = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
      .send({ versione: expiry.body.versione });
    expect(confirmed.status).toBe(200);
    const [lot] = await db
      .select()
      .from(lottiTable)
      .where(
        and(
          eq(lottiTable.magazzinoId, warehouseId),
          eq(lottiTable.prodottoId, productId),
          eq(lottiTable.codiceLottoNormalizzato, "LOT-EXP-R1"),
        ),
      );
    await db
      .update(prodottiTable)
      .set({ gestioneScadenza: false })
      .where(eq(prodottiTable.id, productId));
    expect(lot.dataScadenza).toBe("2027-12-31");
    expect(Number(lot.fattoreKgLtPezzo)).toBe(0.55);
  });

  it("registra in chunk un dataset PostgreSQL ampio senza superare i parametri di insert", async () => {
    const rows = Array.from({ length: 2_200 }, (_, index) =>
      ageaRow({ 4: `DOC-LARGE-${String(index).padStart(5, "0")}` }),
    );
    const analyzed = await analyze("SOLO_ANALISI", workbookFromRows(rows));
    expect(analyzed.status).toBe(201);
    expect(analyzed.body).toMatchObject({
      stato: "PRONTA",
      righeTotali: 2_200,
      partiteTotali: 1,
    });
    const page = await request(app)
      .get(`/agea/importazioni/${analyzed.body.id}/righe`)
      .query({ page: 11, pageSize: 200 });
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({
      page: 11,
      pageSize: 200,
      total: 2_200,
    });
    expect(page.body.items).toHaveLength(200);
  }, 20_000);

  it.runIf(Boolean(acceptancePath && existsSync(acceptancePath)))(
    "esegue il bootstrap del registro reale come un Carico con sette righe e nessun movimento negativo",
    async () => {
      const buffer = readFileSync(acceptancePath!);
      const parsed = parseAgeaWorkbook(buffer);
      [{ id: acceptanceWarehouseId }] = await db
        .insert(magazziniTable)
        .values({
          codice: `AGEAR-${suffix}`.slice(0, 20),
          nome: `AGEA reale ${suffix}`,
        })
        .returning({ id: magazziniTable.id });
      const descriptions = [
        ...new Map(
          parsed.rows.map((row) => [row.prodottoNormalizzato, row.prodottoRaw]),
        ).entries(),
      ];
      const productsToCreate = descriptions.map(([key], index) => {
        const positiveRows = parsed.rows.filter(
          (row) =>
            row.prodottoNormalizzato === key &&
            [row.saldoFinalePezzi, row.saldoFinaleKgLt].some(
              (value) =>
                value != null &&
                InventoryDecimal.parse(value, {
                  allowNegative: true,
                }).isPositive(),
            ),
        );
        const useKg = positiveRows.every(
          (row) =>
            row.saldoFinaleKgLt != null &&
            InventoryDecimal.parse(row.saldoFinaleKgLt, {
              allowNegative: true,
            }).isPositive(),
        );
        return {
          codice: `AGEAR-${String(index + 1).padStart(2, "0")}-${suffix.slice(-8)}`,
          nome: `Prodotto acceptance AGEA ${index + 1}`,
          tipoProdotto: "alimentare",
          unitaMisura: useKg ? "kg" : "pz",
          gestioneLotto: true,
          gestioneScadenza: false,
        };
      });
      const createdProducts = await db
        .insert(prodottiTable)
        .values(productsToCreate)
        .returning({ id: prodottiTable.id, codice: prodottiTable.codice });
      acceptanceProductIds = createdProducts.map((product) => product.id);
      const productByCode = new Map(
        createdProducts.map((product) => [product.codice, product.id]),
      );
      await db.insert(mappatureProdottiEsterniTable).values(
        descriptions.map(([key, raw], index) => ({
          fonte: "AGEA_SIFEAD" as const,
          descrizioneEsterna: raw,
          chiaveDescrizioneNormalizzata: key,
          prodottoId: productByCode.get(productsToCreate[index].codice)!,
          creatoDa: userId,
          aggiornatoDa: userId,
        })),
      );

      const analyzed = await request(app)
        .post("/agea/importazioni/analizza")
        .query({
          magazzinoId: acceptanceWarehouseId,
          modalita: "PRIMA_ACQUISIZIONE",
          nomeFile: "registro-reale.xlsx",
        })
        .set("Content-Type", AGEA_XLSX_MIME)
        .send(buffer);
      expect(analyzed.status).toBe(201);
      expect(analyzed.body).toMatchObject({
        stato: "PRONTA",
        righeTotali: 239,
        righeCarico: 80,
        righeDistribuzione: 158,
        righeReso: 1,
        partiteTotali: 79,
        partiteSaldoPositivo: 7,
      });
      const confirmed = await request(app)
        .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
        .send({ versione: analyzed.body.versione });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.carichi).toHaveLength(1);
      const loadLines = await db
        .select()
        .from(carichiMagazzinoRigheTable)
        .where(
          eq(
            carichiMagazzinoRigheTable.caricoMagazzinoId,
            confirmed.body.carichi[0],
          ),
        );
      expect(loadLines).toHaveLength(7);
      const stockMovements = await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, acceptanceWarehouseId));
      expect(stockMovements).toHaveLength(7);
      expect(
        stockMovements.every((movement) => movement.tipoMovimento === "carico"),
      ).toBe(true);

      const repeated = await request(app)
        .post("/agea/importazioni/analizza")
        .query({
          magazzinoId: acceptanceWarehouseId,
          modalita: "AGGIORNAMENTO",
          nomeFile: "registro-reale-ripetuto.xlsx",
        })
        .set("Content-Type", AGEA_XLSX_MIME)
        .send(buffer);
      expect(repeated.status).toBe(201);
      expect(repeated.body).toMatchObject({
        stato: "PRONTA",
        righeTotali: 239,
        righeDuplicate: 239,
        righeNuove: 0,
      });
      const repeatedConfirmation = await request(app)
        .post(`/agea/importazioni/${repeated.body.id}/conferma`)
        .send({ versione: repeated.body.versione });
      expect(repeatedConfirmation.status).toBe(200);
      expect(repeatedConfirmation.body.carichi).toHaveLength(0);
      expect(
        await db
          .select()
          .from(movimentiTable)
          .where(eq(movimentiTable.magazzinoId, acceptanceWarehouseId)),
      ).toHaveLength(7);

      const reconciliation = await calculateFseReconciliation({
        magazzinoId: acceptanceWarehouseId,
        importazioneAgeaId: analyzed.body.id,
        dataRiferimento: parsed.dataRiferimento,
        creatoDa: userId,
      });
      acceptanceReconciliationId = reconciliation.reconciliation.id;
      expect(
        reconciliation.rows.filter(
          (row) => row.status === "BASELINE_ASSORBITA",
        ),
      ).toHaveLength(80);
      expect(
        reconciliation.rows.filter(
          (row) => row.tipoRiga === "SALDO_PARTITA",
        ),
      ).toHaveLength(7);
      expect(
        reconciliation.rows.filter(
          (row) => row.status === "SOLO_AGEA" && row.tipoRiga === "CARICO",
        ),
      ).toHaveLength(0);
    },
  );

  it("nega l'analisi senza magazzino.agea.import", async () => {
    const response = await request(deniedApp)
      .post("/agea/importazioni/analizza")
      .query({
        magazzinoId: warehouseId,
        modalita: "SOLO_ANALISI",
        nomeFile: "registro.xlsx",
      })
      .set("Content-Type", AGEA_XLSX_MIME)
      .send(registry());
    expect(response.status).toBe(403);
  });

  it("nega un Magazzino fuori dallo scope Area Operativa", async () => {
    const response = await request(scopedApp)
      .post("/agea/importazioni/analizza")
      .query({
        magazzinoId: foreignWarehouseId,
        modalita: "SOLO_ANALISI",
        nomeFile: "registro.xlsx",
      })
      .set("Content-Type", AGEA_XLSX_MIME)
      .send(registry());
    expect(response.status).toBe(403);
  });
});
