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
  importazioniAgeaTable,
  lottiTable,
  mappatureProdottiEsterniTable,
  magazziniTable,
  movimentiEsterniAgeaTable,
  movimentiTable,
  pool,
  prodottiTable,
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
let acceptanceProductIds: number[] = [];
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
  mode: "PRIMA_ACQUISIZIONE" | "AGGIORNAMENTO",
  buffer: Buffer,
) {
  return request(app)
    .post("/agea/importazioni/analizza")
    .query({
      magazzinoId: warehouseId,
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
  if (acceptanceWarehouseId != null) {
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
    const replay = await request(app)
      .post(`/agea/importazioni/${analyzed.body.id}/conferma`)
      .send({ versione: analyzed.body.versione });
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
