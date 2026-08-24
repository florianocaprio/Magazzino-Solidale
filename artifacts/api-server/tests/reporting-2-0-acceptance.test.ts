/* @vitest-environment node */

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  areeOperativeTable,
  beneficiariTable,
  bolleTable,
  centriAscoltoTable,
  db,
  fseFascicoliSocialiSnapshotTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  prodottiTable,
  utentiTable,
} from "@workspace/db";
import { buildDrilldown } from "../src/lib/reporting/drilldown";
import { buildFsePlusReport } from "../src/lib/reporting/fsePlus";
import type { ReportFilters } from "../src/lib/reporting/types";
import reportIntegratoRouter from "../src/routes/report-integrato";
import { makeScopedApp } from "./scope-helpers";

const suffix = Math.random().toString(36).slice(2, 9);
const ids = {
  areas: [] as number[],
  centres: [] as number[],
  warehouses: [] as number[],
  beneficiaries: [] as number[],
  products: [] as number[],
  lots: [] as number[],
  bolle: [] as number[],
  operations: [] as number[],
  movements: [] as number[],
  users: [] as number[],
};

let areaA: number;
let areaB: number;
let centreA: number;
let warehouseA: number;
let warehouseB: number;
let beneficiaryA: number;
let beneficiaryWithoutSnapshot: number;
let productKg: number;
let productPieces: number;
let userId: number;

function hash(index: number) {
  return index.toString(16).padStart(64, "0");
}

function filters(): ReportFilters {
  return {
    da: "2026-01-01",
    a: "2026-12-31",
    anno: 2026,
    areaOperativaId: areaA,
    centroAscoltoId: centreA,
    magazzinoId: warehouseA,
    mensaId: null,
    zonaUdsId: null,
    operatoreId: null,
    tipoIntervento: null,
    tipoServizio: null,
    areaOperativaMode: "query",
    centroMode: "query",
    zonaMode: "all",
    callerAreas: ["magazzino"],
    callerPermissions: ["magazzino.fse.view"],
    callerIsAdmin: false,
  };
}

beforeAll(async () => {
  const [user] = await db
    .insert(utentiTable)
    .values({
      username: `reporting-2-0-${suffix}`,
      passwordHash: "test-only",
      nome: "Reporting",
    })
    .returning({ id: utentiTable.id });
  userId = user.id;
  ids.users.push(userId);

  const areas = await db
    .insert(areeOperativeTable)
    .values([
      { nome: `Reporting 2.0 A ${suffix}` },
      { nome: `Reporting 2.0 B ${suffix}` },
    ])
    .returning({ id: areeOperativeTable.id });
  [areaA, areaB] = areas.map((item) => item.id);
  ids.areas.push(areaA, areaB);

  const centres = await db
    .insert(centriAscoltoTable)
    .values([
      { nome: `Reporting Centro A ${suffix}`, areaOperativaId: areaA },
      { nome: `Reporting Centro B ${suffix}`, areaOperativaId: areaB },
    ])
    .returning({ id: centriAscoltoTable.id });
  centreA = centres[0].id;
  ids.centres.push(...centres.map((item) => item.id));

  const warehouses = await db
    .insert(magazziniTable)
    .values([
      {
        codice: `R20-A-${suffix}`,
        nome: `Reporting Magazzino A ${suffix}`,
        areaOperativaId: areaA,
        centroAscoltoId: centres[0].id,
      },
      {
        codice: `R20-B-${suffix}`,
        nome: `Reporting Magazzino B ${suffix}`,
        areaOperativaId: areaB,
        centroAscoltoId: centres[1].id,
      },
    ])
    .returning({ id: magazziniTable.id });
  [warehouseA, warehouseB] = warehouses.map((item) => item.id);
  ids.warehouses.push(warehouseA, warehouseB);

  const beneficiaries = await db
    .insert(beneficiariTable)
    .values([
      {
        codice: `BA-${suffix}`,
        nome: `Nome-PII-${suffix}`,
        cognome: `Cognome-PII-${suffix}`,
        areaOperativaId: areaA,
        centroAscoltoId: centreA,
      },
      {
        codice: `BM-${suffix}`,
        nome: `Missing-PII-${suffix}`,
        cognome: `Snapshot-PII-${suffix}`,
        areaOperativaId: areaA,
        centroAscoltoId: centreA,
      },
    ])
    .returning({ id: beneficiariTable.id });
  [beneficiaryA, beneficiaryWithoutSnapshot] = beneficiaries.map(
    (item) => item.id,
  );
  ids.beneficiaries.push(beneficiaryA, beneficiaryWithoutSnapshot);

  const products = await db
    .insert(prodottiTable)
    .values([
      {
        codice: `R20-KG-${suffix}`,
        nome: `Prodotto kg ${suffix}`,
        tipoProdotto: "alimentare",
        unitaMisura: "kg",
      },
      {
        codice: `R20-PZ-${suffix}`,
        nome: `Prodotto pz ${suffix}`,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
      },
    ])
    .returning({ id: prodottiTable.id, unita: prodottiTable.unitaMisura });
  productKg = products.find((item) => item.unita === "kg")!.id;
  productPieces = products.find((item) => item.unita === "pz")!.id;
  ids.products.push(productKg, productPieces);

  const lots = await db
    .insert(lottiTable)
    .values([
      {
        prodottoId: productKg,
        codiceLotto: `R20-KG-${suffix}`,
        dataCarico: "2026-01-01",
        quantitaCaricata: "100",
        quantitaResidua: "89",
        magazzinoId: warehouseA,
        fondoOrigine: "FSE_PLUS",
        fsePlus: true,
      },
      {
        prodottoId: productPieces,
        codiceLotto: `R20-PZ-${suffix}`,
        dataCarico: "2026-01-01",
        quantitaCaricata: "100",
        quantitaResidua: "80",
        magazzinoId: warehouseA,
        fondoOrigine: "FSE_PLUS",
        fsePlus: true,
      },
    ])
    .returning({ id: lottiTable.id });
  ids.lots.push(...lots.map((item) => item.id));

  const bolle = await db
    .insert(bolleTable)
    .values([
      {
        numeroBolla: `R20-PACCHI-${suffix}`,
        dataBolla: "2026-06-01",
        beneficiarioId: beneficiaryA,
        magazzinoId: warehouseA,
        stato: "consegnato",
        areaOperativaIdSnapshot: areaA,
        centroAscoltoIdSnapshot: centreA,
        numeroComponentiNucleoSnapshot: 3,
      },
      {
        numeroBolla: `R20-RITIRO-${suffix}`,
        dataBolla: "2026-06-02",
        beneficiarioId: beneficiaryA,
        magazzinoId: warehouseA,
        stato: "consegnato",
        areaOperativaIdSnapshot: areaA,
        centroAscoltoIdSnapshot: centreA,
        numeroComponentiNucleoSnapshot: 3,
      },
      {
        numeroBolla: `R20-DOM-${suffix}`,
        dataBolla: "2026-06-03",
        beneficiarioId: beneficiaryA,
        magazzinoId: warehouseA,
        stato: "consegnato",
        areaOperativaIdSnapshot: areaA,
        centroAscoltoIdSnapshot: centreA,
        numeroComponentiNucleoSnapshot: 3,
      },
      {
        numeroBolla: `R20-MISSING-${suffix}`,
        dataBolla: "2026-06-04",
        beneficiarioId: beneficiaryWithoutSnapshot,
        magazzinoId: warehouseA,
        stato: "consegnato",
        areaOperativaIdSnapshot: areaA,
        centroAscoltoIdSnapshot: centreA,
        numeroComponentiNucleoSnapshot: 1,
      },
    ])
    .returning({ id: bolleTable.id });
  ids.bolle.push(...bolle.map((item) => item.id));

  const operationInput = [
    ["PACCHI", 1, null],
    ["RITIRO_SEDE", 1, null],
    ["DOMICILIARE", 1, null],
    ["EMPORIO", null, null],
    ["MENSA", null, 6],
    ["UDS_STRADA", null, null],
    ["PACCHI", 1, null],
  ] as const;
  const operations = await db
    .insert(operazioniDistribuzioneMagazzinoTable)
    .values(
      operationInput.map(([channel, parcels, meals], index) => ({
        magazzinoId: warehouseA,
        dataDistribuzione: `2026-06-${String(index + 1).padStart(2, "0")}`,
        canaleOperativo: channel,
        dominioOrigine: "TEST_REPORTING_2_0",
        entitaOrigineTipo: channel,
        entitaOrigineId: index + 1,
        numeroDocumento: `R20-${channel}-${suffix}`,
        numeroPacchi: parcels,
        numeroPasti: meals,
        creatoDa: userId,
      })),
    )
    .returning({ id: operazioniDistribuzioneMagazzinoTable.id });
  ids.operations.push(...operations.map((item) => item.id));

  const distributionInput = [
    {
      channel: "PACCHI",
      quantity: "4",
      productId: productKg,
      lotId: lots[0].id,
      kg: "4",
      pieces: null,
      bollaId: bolle[0].id,
    },
    {
      channel: "RITIRO_SEDE",
      quantity: "10",
      productId: productPieces,
      lotId: lots[1].id,
      kg: null,
      pieces: "10",
      bollaId: bolle[1].id,
    },
    {
      channel: "DOMICILIARE",
      quantity: "3",
      productId: productKg,
      lotId: lots[0].id,
      kg: "3",
      pieces: null,
      bollaId: bolle[2].id,
    },
    {
      channel: "EMPORIO",
      quantity: "5",
      productId: productPieces,
      lotId: lots[1].id,
      kg: null,
      pieces: "5",
      bollaId: null,
    },
    {
      channel: "MENSA",
      quantity: "6",
      productId: productKg,
      lotId: lots[0].id,
      kg: "6",
      pieces: null,
      bollaId: null,
    },
    {
      channel: "UDS_STRADA",
      quantity: "7",
      productId: productPieces,
      lotId: lots[1].id,
      kg: null,
      pieces: "7",
      bollaId: null,
    },
    {
      channel: "PACCHI",
      quantity: "1",
      productId: productKg,
      lotId: lots[0].id,
      kg: "1",
      pieces: null,
      bollaId: bolle[3].id,
    },
  ] as const;
  const movements = await db
    .insert(movimentiTable)
    .values(
      distributionInput.map((item, index) => ({
        tipoMovimento: "scarico",
        tipoDettaglio: "reporting_2_0",
        dataMovimento: `2026-06-${String(index + 1).padStart(2, "0")}`,
        magazzinoId: warehouseA,
        prodottoId: item.productId,
        lottoId: item.lotId,
        quantita: item.quantity,
        quantitaKgLt: item.kg,
        quantitaPezzi: item.pieces,
        unitaMisura: item.productId === productKg ? "kg" : "pz",
        beneficiarioId: item.bollaId
          ? index === 6
            ? beneficiaryWithoutSnapshot
            : beneficiaryA
          : null,
        bollaId: item.bollaId,
        fondoOrigine: "FSE_PLUS",
        naturaContabile: "DISTRIBUZIONE_FINALE",
        canaleOperativo: item.channel,
        operazioneDistribuzioneId: operations[index].id,
        documentoRiferimento: `R20-${item.channel}-${suffix}`,
      })),
    )
    .returning({ id: movimentiTable.id });
  ids.movements.push(...movements.map((item) => item.id));

  const corrections = await db
    .insert(movimentiTable)
    .values([
      {
        tipoMovimento: "carico",
        tipoDettaglio: "storno_reporting_2_0",
        dataMovimento: "2026-06-08",
        magazzinoId: warehouseA,
        prodottoId: productPieces,
        lottoId: lots[1].id,
        quantita: "2",
        quantitaPezzi: "2",
        unitaMisura: "pz",
        fondoOrigine: "FSE_PLUS",
        naturaContabile: "STORNO",
        canaleOperativo: "RITIRO_SEDE",
        operazioneDistribuzioneId: operations[1].id,
        movimentoOrigineId: movements[1].id,
      },
      {
        tipoMovimento: "carico",
        tipoDettaglio: "storno_reporting_2_0",
        dataMovimento: "2026-06-08",
        magazzinoId: warehouseA,
        prodottoId: productKg,
        lottoId: lots[0].id,
        quantita: "3",
        quantitaKgLt: "3",
        unitaMisura: "kg",
        fondoOrigine: "FSE_PLUS",
        naturaContabile: "STORNO",
        canaleOperativo: "DOMICILIARE",
        operazioneDistribuzioneId: operations[2].id,
        movimentoOrigineId: movements[2].id,
      },
      {
        tipoMovimento: "scarico",
        tipoDettaglio: "non_fse_reporting_2_0",
        dataMovimento: "2026-06-01",
        magazzinoId: warehouseA,
        prodottoId: productKg,
        lottoId: lots[0].id,
        quantita: "2",
        quantitaKgLt: "2",
        unitaMisura: "kg",
        fondoOrigine: "NESSUN_FONDO",
        naturaContabile: "DISTRIBUZIONE_FINALE",
        canaleOperativo: "PACCHI",
        operazioneDistribuzioneId: operations[0].id,
      },
    ])
    .returning({ id: movimentiTable.id });
  ids.movements.push(...corrections.map((item) => item.id));

  await db.insert(fseFascicoliSocialiSnapshotTable).values([
    {
      beneficiarioId: beneficiaryA,
      dataRiferimento: "2026-04-01",
      origineSnapshot: "aggiornamento_manuale",
      utenteId: userId,
      versioneProfilo: 1,
      numeroComponenti: 2,
      donne: 1,
      uomini: 1,
      eta017: 0,
      eta1829: 0,
      eta3064: 2,
      eta65Plus: 0,
      origineStranieraMinoranze: 1,
      personeDisabilita: 0,
      cittadiniPaesiTerzi: 1,
      senzaTettoEsclusioneAbitativa: 0,
      attendibilitaDato: "operatore_verificato",
      hashCanonico: hash(1),
    },
    {
      beneficiarioId: beneficiaryA,
      dataRiferimento: "2026-04-01",
      origineSnapshot: "aggiornamento_manuale",
      utenteId: userId,
      versioneProfilo: 2,
      numeroComponenti: 3,
      donne: 2,
      uomini: 1,
      eta017: 1,
      eta1829: 0,
      eta3064: 2,
      eta65Plus: 0,
      origineStranieraMinoranze: 2,
      personeDisabilita: 1,
      cittadiniPaesiTerzi: 1,
      senzaTettoEsclusioneAbitativa: 0,
      attendibilitaDato: "operatore_verificato",
      hashCanonico: hash(2),
    },
    {
      beneficiarioId: beneficiaryA,
      dataRiferimento: "2027-01-01",
      origineSnapshot: "aggiornamento_manuale",
      utenteId: userId,
      versioneProfilo: 3,
      numeroComponenti: 9,
      donne: 5,
      uomini: 4,
      eta017: 1,
      eta1829: 1,
      eta3064: 6,
      eta65Plus: 1,
      origineStranieraMinoranze: 9,
      personeDisabilita: 9,
      cittadiniPaesiTerzi: 9,
      senzaTettoEsclusioneAbitativa: 9,
      attendibilitaDato: "operatore_verificato",
      hashCanonico: hash(3),
    },
  ]);
});

afterAll(async () => {
  if (ids.movements.length)
    await db
      .delete(movimentiTable)
      .where(inArray(movimentiTable.id, ids.movements));
  if (ids.operations.length)
    await db
      .delete(operazioniDistribuzioneMagazzinoTable)
      .where(inArray(operazioniDistribuzioneMagazzinoTable.id, ids.operations));
  if (ids.bolle.length)
    await db.delete(bolleTable).where(inArray(bolleTable.id, ids.bolle));
  if (ids.lots.length)
    await db.delete(lottiTable).where(inArray(lottiTable.id, ids.lots));
  if (ids.products.length)
    await db
      .delete(prodottiTable)
      .where(inArray(prodottiTable.id, ids.products));
  if (ids.beneficiaries.length)
    await db
      .delete(beneficiariTable)
      .where(inArray(beneficiariTable.id, ids.beneficiaries));
  if (ids.warehouses.length)
    await db
      .delete(magazziniTable)
      .where(inArray(magazziniTable.id, ids.warehouses));
  if (ids.centres.length)
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, ids.centres));
  if (ids.users.length)
    await db.delete(utentiTable).where(inArray(utentiTable.id, ids.users));
  if (ids.areas.length)
    await db
      .delete(areeOperativeTable)
      .where(inArray(areeOperativeTable.id, ids.areas));
  await pool.end();
});

describe("Reporting 2.0: accettazione FSE canonica", () => {
  it("include tutti i canali canonici, Mensa/UDS senza Bolla e applica il netto degli storni", async () => {
    const report = await buildFsePlusReport(filters());
    const channelRows =
      report.tables.find((table) => table.key === "quantitaPerCanaleUnita")
        ?.rows ?? [];
    expect(channelRows.map((row) => row.canale)).toEqual(
      expect.arrayContaining([
        "PACCHI",
        "DOMICILIARE",
        "EMPORIO",
        "MENSA",
        "UDS_STRADA",
      ]),
    );
    expect(channelRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canale: "RITIRO_SEDE", quantita: 8 }),
        expect.objectContaining({ canale: "DOMICILIARE", quantita: 0 }),
        expect.objectContaining({ canale: "MENSA", quantita: 6 }),
        expect.objectContaining({ canale: "UDS_STRADA", quantita: 7 }),
      ]),
    );
    expect(
      report.kpi.find((item) => item.key === "prodottiFseDistinti")?.value,
    ).toBe(2);
    expect(
      report.kpi.find((item) => item.key === "pacchiDistribuiti")?.value,
    ).toBe(3);
    expect(
      report.kpi.find((item) => item.key === "pastiDistribuiti")?.value,
    ).toBe(6);
    expect(
      report.kpi.find((item) => item.key === "eventiDistribuzione")?.value,
    ).toBe(6);
    expect(
      report.quality.find(
        (item) => item.key === "statisticheEventoStornoParziale",
      )?.count,
    ).toBe(1);
  });

  it("mantiene parità tra tabella prodotti, drill-down e fonte Movimento", async () => {
    const report = await buildFsePlusReport(filters());
    const productRows =
      report.tables.find((table) => table.key === "01_Prodotti_FSE")?.rows ??
      [];
    expect(productRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prodottoId: productKg,
          quantitaFse: 11,
          quantitaTotale: 13,
        }),
        expect.objectContaining({
          prodottoId: productPieces,
          quantitaFse: 20,
          quantitaTotale: 20,
        }),
      ]),
    );
    const detail = await buildDrilldown({
      section: "fse-plus",
      metric: "prodottiFse",
      filters: filters(),
      page: 1,
      pageSize: 100,
    });
    const totals = detail.rows.reduce<Record<string, number>>((result, row) => {
      const product = String(row.prodotto);
      result[product] = (result[product] ?? 0) + Number(row.quantita);
      return result;
    }, {});
    for (const product of productRows) {
      expect(totals[String(product.prodottoNome)]).toBe(product.quantitaFse);
    }
    expect(JSON.stringify(detail)).not.toContain(`BA-${suffix}`);
    expect(detail.columns).not.toContain("beneficiarioCodice");
  });

  it("seleziona lo snapshot as-of più recente, esclude il futuro e conserva NULL/copertura", async () => {
    const report = await buildFsePlusReport(filters());
    expect(
      report.kpi.find((item) => item.key === "nucleiRaggiunti")?.value,
    ).toBe(2);
    expect(
      report.kpi.find((item) => item.key === "personeRaggiunte"),
    ).toMatchObject({
      value: 3,
      exactValue: "3",
      availability: "derivable",
    });
    const dimensions =
      report.tables.find((table) => table.key === "dimensioniFseBeneficiari")
        ?.rows ?? [];
    expect(dimensions).toContainEqual(
      expect.objectContaining({
        campo: "origineStranieraMinoranze",
        valore: 2,
        nucleiCoperti: 1,
        nucleiTotali: 2,
        nucleiSenzaDato: 1,
      }),
    );
    expect(
      report.quality.find((item) => item.key === "snapshotFseMancante")?.count,
    ).toBe(1);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(`Nome-PII-${suffix}`);
    expect(serialized).not.toContain(`Cognome-PII-${suffix}`);
  });

  it("separa aggregati e dettaglio individuale e blocca ID fuori scope", async () => {
    const aggregateApp = makeScopedApp(reportIntegratoRouter, {
      id: userId,
      areaOperativaId: areaA,
      centroAscoltoId: centreA,
      aree: ["analisi", "magazzino"],
      permessi: ["magazzino.fse.view"],
    });
    const query = `da=2026-01-01&a=2026-12-31&areaOperativaId=${areaA}&centroAscoltoId=${centreA}&magazzinoId=${warehouseA}`;
    expect(
      (await request(aggregateApp).get(`/report/fse-plus/integrato?${query}`))
        .status,
    ).toBe(200);
    const aggregateDrilldown = await request(aggregateApp).get(
      `/report/drilldown?section=fse-plus&metric=prodottiFse&pageSize=100&${query}`,
    );
    expect(aggregateDrilldown.status).toBe(200);
    expect(JSON.stringify(aggregateDrilldown.body)).not.toContain(
      `BA-${suffix}`,
    );
    expect(
      (
        await request(aggregateApp).get(
          `/report/drilldown?section=fse-plus&metric=nucleiRaggiunti&${query}`,
        )
      ).status,
    ).toBe(403);

    const individualApp = makeScopedApp(reportIntegratoRouter, {
      id: userId,
      areaOperativaId: areaA,
      centroAscoltoId: centreA,
      aree: ["analisi", "magazzino"],
      permessi: ["magazzino.fse.view", "beneficiari.fse.view"],
    });
    const individual = await request(individualApp).get(
      `/report/drilldown?section=fse-plus&metric=nucleiRaggiunti&${query}`,
    );
    expect(individual.status).toBe(200);
    expect(individual.body.rows[0]).toHaveProperty("beneficiarioCodice");
    expect(JSON.stringify(individual.body)).not.toContain(`Nome-PII-${suffix}`);

    const outside = await request(aggregateApp).get(
      `/report/fse-plus/integrato?da=2026-01-01&a=2026-12-31&magazzinoId=${warehouseB}`,
    );
    expect(outside.status).toBe(403);
    expect(JSON.stringify(outside.body)).not.toContain(
      `Reporting Magazzino B ${suffix}`,
    );

    const anonymous = express();
    anonymous.use(reportIntegratoRouter);
    expect(
      (
        await request(anonymous).get(
          "/report/fse-plus/integrato?da=2026-01-01&a=2026-12-31",
        )
      ).status,
    ).toBe(401);
  });
});
