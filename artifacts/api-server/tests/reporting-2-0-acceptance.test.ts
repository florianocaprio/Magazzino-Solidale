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
import { buildPacchiReport } from "../src/lib/reporting/pacchi";
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
let centreB: number;
let warehouseA: number;
let warehouseB: number;
let warehouseShared: number;
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
  [centreA, centreB] = centres.map((item) => item.id);
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
      {
        codice: `R20-S-${suffix}`,
        nome: `Reporting Magazzino condiviso ${suffix}`,
        areaOperativaId: null,
        centroAscoltoId: null,
      },
    ])
    .returning({ id: magazziniTable.id });
  [warehouseA, warehouseB, warehouseShared] = warehouses.map((item) => item.id);
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
        dataNascita: "1990-01-01",
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
      {
        prodottoId: productPieces,
        codiceLotto: `R20-SHARED-${suffix}`,
        dataCarico: "2026-01-01",
        quantitaCaricata: "100",
        quantitaResidua: "96",
        magazzinoId: warehouseShared,
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
        areaOperativaIdSnapshot: null,
        centroAscoltoIdSnapshot: null,
        numeroComponentiNucleoSnapshot: 3,
      },
      {
        numeroBolla: `R20-RITIRO-${suffix}`,
        dataBolla: "2026-06-02",
        beneficiarioId: beneficiaryA,
        magazzinoId: warehouseA,
        stato: "consegnato",
        areaOperativaIdSnapshot: null,
        centroAscoltoIdSnapshot: null,
        numeroComponentiNucleoSnapshot: 3,
      },
      {
        numeroBolla: `R20-DOM-${suffix}`,
        dataBolla: "2026-06-03",
        beneficiarioId: beneficiaryA,
        magazzinoId: warehouseA,
        stato: "consegnato",
        areaOperativaIdSnapshot: null,
        centroAscoltoIdSnapshot: null,
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
        areaOperativaIdSnapshot: areaA,
        centroAscoltoIdSnapshot: centreA,
        territorioClassificazione: "attribuito",
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

  const territorialOperations = await db
    .insert(operazioniDistribuzioneMagazzinoTable)
    .values([
      {
        magazzinoId: warehouseShared,
        dataDistribuzione: "2026-07-01",
        canaleOperativo: "PACCHI",
        dominioOrigine: "TEST_REPORTING_SCOPE",
        entitaOrigineTipo: "SCOPE",
        entitaOrigineId: 100,
        areaOperativaIdSnapshot: areaA,
        centroAscoltoIdSnapshot: centreA,
        territorioClassificazione: "attribuito",
        creatoDa: userId,
      },
      {
        magazzinoId: warehouseShared,
        dataDistribuzione: "2026-07-02",
        canaleOperativo: "PACCHI",
        dominioOrigine: "TEST_REPORTING_SCOPE",
        entitaOrigineTipo: "SCOPE",
        entitaOrigineId: 101,
        areaOperativaIdSnapshot: areaB,
        centroAscoltoIdSnapshot: centreB,
        territorioClassificazione: "attribuito",
        creatoDa: userId,
      },
      {
        magazzinoId: warehouseShared,
        dataDistribuzione: "2026-07-03",
        canaleOperativo: "PACCHI",
        dominioOrigine: "TEST_REPORTING_SCOPE",
        entitaOrigineTipo: "SCOPE",
        entitaOrigineId: 102,
        territorioClassificazione: "legacy_sconosciuto",
        creatoDa: userId,
      },
      {
        magazzinoId: warehouseShared,
        dataDistribuzione: "2026-07-04",
        canaleOperativo: "PACCHI",
        dominioOrigine: "TEST_REPORTING_SCOPE",
        entitaOrigineTipo: "SCOPE",
        entitaOrigineId: 103,
        territorioClassificazione: "universale",
        creatoDa: userId,
      },
    ])
    .returning({ id: operazioniDistribuzioneMagazzinoTable.id });
  ids.operations.push(...territorialOperations.map((item) => item.id));
  const territorialMovements = await db
    .insert(movimentiTable)
    .values(
      territorialOperations.map((operation, index) => ({
        tipoMovimento: "scarico",
        tipoDettaglio: "reporting_scope",
        dataMovimento: `2026-07-0${index + 1}`,
        magazzinoId: warehouseShared,
        prodottoId: productPieces,
        lottoId: lots[2].id,
        quantita: "1",
        quantitaPezzi: "1",
        unitaMisura: "pz",
        fondoOrigine: "FSE_PLUS",
        naturaContabile: "DISTRIBUZIONE_FINALE",
        canaleOperativo: "PACCHI",
        operazioneDistribuzioneId: operation.id,
      })),
    )
    .returning({ id: movimentiTable.id });
  ids.movements.push(...territorialMovements.map((item) => item.id));

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
      versioneProfilo: 4,
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
    {
      beneficiarioId: beneficiaryA,
      dataRiferimento: "2026-04-01",
      origineSnapshot: "import_fse",
      utenteId: userId,
      versioneProfilo: 3,
      numeroComponenti: 5,
      donne: 3,
      uomini: 2,
      eta017: 1,
      eta1829: 1,
      eta3064: 3,
      eta65Plus: 0,
      origineStranieraMinoranze: 5,
      personeDisabilita: 5,
      cittadiniPaesiTerzi: 5,
      senzaTettoEsclusioneAbitativa: 5,
      attendibilitaDato: "fonte_fse_dichiarata",
      hashCanonico: hash(4),
    },
    {
      beneficiarioId: beneficiaryA,
      dataRiferimento: "2026-04-01",
      origineSnapshot: "export_fse",
      utenteId: userId,
      versioneProfilo: 99,
      numeroComponenti: 99,
      donne: 50,
      uomini: 49,
      eta017: 1,
      eta1829: 1,
      eta3064: 96,
      eta65Plus: 1,
      origineStranieraMinoranze: 99,
      personeDisabilita: 99,
      cittadiniPaesiTerzi: 99,
      senzaTettoEsclusioneAbitativa: 99,
      attendibilitaDato: "anagrafica_derivata",
      hashCanonico: hash(5),
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

  it("conta le anomalie anagrafiche per nucleo e quelle storiche per Bolla", async () => {
    const report = await buildPacchiReport(filters());
    expect(
      report.quality.find((item) => item.key === "dataNascitaMancante")?.count,
    ).toBe(1);
    expect(
      report.quality.find((item) => item.key === "territorioStoricoDerivato")
        ?.count,
    ).toBe(3);
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

  it("fa prevalere manuale su import ed export della stessa data in report e drill-down", async () => {
    const report = await buildFsePlusReport(filters());
    expect(
      report.kpi.find((item) => item.key === "personeRaggiunte")?.value,
    ).toBe(3);
    const detail = await buildDrilldown({
      section: "fse-plus",
      metric: "nucleiRaggiunti",
      filters: {
        ...filters(),
        callerPermissions: ["magazzino.fse.view", "beneficiari.fse.view"],
      },
      page: 1,
      pageSize: 100,
    });
    expect(detail.rows).toContainEqual(
      expect.objectContaining({
        beneficiarioCodice: `BA-${suffix}`,
        numeroComponenti: 3,
        origineSnapshot: "aggiornamento_manuale",
      }),
    );
  });

  it("espone coperture indipendenti e persone note per snapshot parziali", async () => {
    const [coverageWarehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `R20-COV-${suffix}`,
        nome: `Reporting copertura ${suffix}`,
        areaOperativaId: areaA,
        centroAscoltoId: centreA,
      })
      .returning({ id: magazziniTable.id });
    ids.warehouses.push(coverageWarehouse.id);
    const [coverageProduct] = await db
      .insert(prodottiTable)
      .values({
        codice: `R20-COV-${suffix}`,
        nome: `Prodotto copertura ${suffix}`,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
      })
      .returning({ id: prodottiTable.id });
    ids.products.push(coverageProduct.id);
    const [coverageLot] = await db
      .insert(lottiTable)
      .values({
        prodottoId: coverageProduct.id,
        codiceLotto: `R20-COV-${suffix}`,
        dataCarico: "2026-01-01",
        quantitaCaricata: "10",
        quantitaResidua: "7",
        magazzinoId: coverageWarehouse.id,
        fondoOrigine: "FSE_PLUS",
        fsePlus: true,
      })
      .returning({ id: lottiTable.id });
    ids.lots.push(coverageLot.id);
    const coverageBeneficiaries = await db
      .insert(beneficiariTable)
      .values(
        [1, 2, 3].map((index) => ({
          codice: `R20-COV-${index}-${suffix}`,
          nome: `Coverage ${index}`,
          cognome: `Reporting ${suffix}`,
          areaOperativaId: areaA,
          centroAscoltoId: centreA,
        })),
      )
      .returning({ id: beneficiariTable.id });
    ids.beneficiaries.push(...coverageBeneficiaries.map((item) => item.id));
    const coverageBolle = await db
      .insert(bolleTable)
      .values(
        coverageBeneficiaries.map((beneficiary, index) => ({
          numeroBolla: `R20-COV-${index + 1}-${suffix}`,
          dataBolla: `2026-08-0${index + 1}`,
          beneficiarioId: beneficiary.id,
          magazzinoId: coverageWarehouse.id,
          stato: "consegnato",
          areaOperativaIdSnapshot: areaA,
          centroAscoltoIdSnapshot: centreA,
          numeroComponentiNucleoSnapshot: index + 1,
        })),
      )
      .returning({ id: bolleTable.id });
    ids.bolle.push(...coverageBolle.map((item) => item.id));
    const coverageOperations = await db
      .insert(operazioniDistribuzioneMagazzinoTable)
      .values(
        coverageBeneficiaries.map((_, index) => ({
          magazzinoId: coverageWarehouse.id,
          dataDistribuzione: `2026-08-0${index + 1}`,
          canaleOperativo: "PACCHI",
          dominioOrigine: "TEST_REPORTING_COVERAGE",
          entitaOrigineTipo: "COVERAGE",
          entitaOrigineId: index + 1,
          areaOperativaIdSnapshot: areaA,
          centroAscoltoIdSnapshot: centreA,
          territorioClassificazione: "attribuito",
          creatoDa: userId,
        })),
      )
      .returning({ id: operazioniDistribuzioneMagazzinoTable.id });
    ids.operations.push(...coverageOperations.map((item) => item.id));
    const coverageMovements = await db
      .insert(movimentiTable)
      .values(
        coverageBeneficiaries.map((beneficiary, index) => ({
          tipoMovimento: "scarico",
          tipoDettaglio: "reporting_coverage",
          dataMovimento: `2026-08-0${index + 1}`,
          magazzinoId: coverageWarehouse.id,
          prodottoId: coverageProduct.id,
          lottoId: coverageLot.id,
          quantita: "1",
          quantitaPezzi: "1",
          unitaMisura: "pz",
          beneficiarioId: beneficiary.id,
          bollaId: coverageBolle[index].id,
          fondoOrigine: "FSE_PLUS",
          naturaContabile: "DISTRIBUZIONE_FINALE",
          canaleOperativo: "PACCHI",
          operazioneDistribuzioneId: coverageOperations[index].id,
        })),
      )
      .returning({ id: movimentiTable.id });
    ids.movements.push(...coverageMovements.map((item) => item.id));
    await db.insert(fseFascicoliSocialiSnapshotTable).values([
      {
        beneficiarioId: coverageBeneficiaries[0].id,
        dataRiferimento: "2026-08-01",
        origineSnapshot: "aggiornamento_manuale",
        versioneProfilo: 1,
        numeroComponenti: 2,
        donne: 1,
        uomini: 1,
        eta017: 1,
        eta1829: 0,
        eta3064: 1,
        eta65Plus: 0,
        origineStranieraMinoranze: 1,
        personeDisabilita: 0,
        cittadiniPaesiTerzi: 1,
        senzaTettoEsclusioneAbitativa: 0,
        attendibilitaDato: "operatore_verificato",
        hashCanonico: hash(20),
      },
      {
        beneficiarioId: coverageBeneficiaries[1].id,
        dataRiferimento: "2026-08-01",
        origineSnapshot: "aggiornamento_manuale",
        versioneProfilo: 1,
        numeroComponenti: 3,
        donne: 2,
        uomini: null,
        eta017: 1,
        eta1829: 0,
        eta3064: 2,
        eta65Plus: 0,
        origineStranieraMinoranze: null,
        personeDisabilita: 1,
        cittadiniPaesiTerzi: null,
        senzaTettoEsclusioneAbitativa: 0,
        attendibilitaDato: "operatore_verificato",
        hashCanonico: hash(21),
      },
      {
        beneficiarioId: coverageBeneficiaries[2].id,
        dataRiferimento: "2026-08-01",
        origineSnapshot: "aggiornamento_manuale",
        versioneProfilo: 1,
        numeroComponenti: null,
        donne: 1,
        uomini: 0,
        eta017: 0,
        eta1829: null,
        eta3064: 1,
        eta65Plus: 0,
        origineStranieraMinoranze: 0,
        personeDisabilita: null,
        cittadiniPaesiTerzi: 0,
        senzaTettoEsclusioneAbitativa: null,
        attendibilitaDato: "operatore_verificato",
        hashCanonico: hash(22),
      },
    ]);

    const report = await buildFsePlusReport({
      ...filters(),
      magazzinoId: coverageWarehouse.id,
    });
    expect(
      report.kpi.find((item) => item.key === "nucleiRaggiunti")?.value,
    ).toBe(3);
    expect(
      report.kpi.find((item) => item.key === "personeRaggiunte"),
    ).toMatchObject({
      value: 5,
      availability: "derivable",
    });
    const dimensions =
      report.tables.find((table) => table.key === "dimensioniFseBeneficiari")
        ?.rows ?? [];
    expect(dimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campo: "numeroComponenti",
          valore: 5,
          nucleiCoperti: 2,
          nucleiTotali: 3,
          nucleiSenzaDato: 1,
          disponibilita: "PARZIALE",
        }),
        expect.objectContaining({
          campo: "sesso",
          valore: 3,
          nucleiCoperti: 2,
          nucleiTotali: 3,
          nucleiSenzaDato: 1,
          disponibilita: "PARZIALE",
        }),
        expect.objectContaining({
          campo: "fasceEta",
          valore: 5,
          nucleiCoperti: 2,
          nucleiTotali: 3,
          nucleiSenzaDato: 1,
          disponibilita: "PARZIALE",
        }),
      ]),
    );
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

  it("isola gli eventi di un Magazzino condiviso per snapshot Area", async () => {
    const scoped = (
      areaOperativaId: number,
      centroAscoltoId: number,
    ): ReportFilters => ({
      ...filters(),
      areaOperativaId,
      centroAscoltoId,
      magazzinoId: warehouseShared,
    });
    const globalFilters: ReportFilters = {
      ...filters(),
      areaOperativaId: null,
      centroAscoltoId: null,
      magazzinoId: warehouseShared,
      areaOperativaMode: "all",
      centroMode: "all",
    };
    const [reportA, reportB, globalReport] = await Promise.all([
      buildFsePlusReport(scoped(areaA, centreA)),
      buildFsePlusReport(scoped(areaB, centreB)),
      buildFsePlusReport(globalFilters),
    ]);
    const quantity = (report: Awaited<ReturnType<typeof buildFsePlusReport>>) =>
      report.tables
        .find((table) => table.key === "01_Prodotti_FSE")
        ?.rows.reduce((sum, row) => sum + Number(row.quantitaFse), 0) ?? 0;
    expect(quantity(reportA)).toBe(1);
    expect(quantity(reportB)).toBe(1);
    expect(quantity(globalReport)).toBe(4);
    const qualityCount = (
      report: Awaited<ReturnType<typeof buildFsePlusReport>>,
      key: string,
    ) => report.quality.find((item) => item.key === key)?.count;
    expect(qualityCount(globalReport, "territorioEventoLegacyMancante")).toBe(
      1,
    );
    expect(qualityCount(globalReport, "eventoUniversale")).toBe(1);
    expect(
      qualityCount(globalReport, "eventoEsclusoMancanzaAttribuzione"),
    ).toBe(0);
    expect(qualityCount(reportA, "territorioEventoLegacyMancante")).toBe(0);
    expect(qualityCount(reportA, "eventoUniversale")).toBe(0);
    expect(qualityCount(reportA, "eventoEsclusoMancanzaAttribuzione")).toBe(1);

    const detailA = await buildDrilldown({
      section: "fse-plus",
      metric: "prodottiFse",
      filters: scoped(areaA, centreA),
      page: 1,
      pageSize: 100,
    });
    const detailB = await buildDrilldown({
      section: "fse-plus",
      metric: "prodottiFse",
      filters: scoped(areaB, centreB),
      page: 1,
      pageSize: 100,
    });
    expect(
      detailA.rows.reduce((sum, row) => sum + Number(row.quantita), 0),
    ).toBe(1);
    expect(
      detailB.rows.reduce((sum, row) => sum + Number(row.quantita), 0),
    ).toBe(1);
  });
});
