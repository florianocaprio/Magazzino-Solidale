import { and, eq, inArray, isNull, like, ne, or } from "drizzle-orm";
import {
  approvvigionamentiTable,
  approvvigionamentoRigheTable,
  auditConfigurazioniTable,
  beneficiariTable,
  bolleTable,
  bollaRigheTable,
  centriAscoltoTable,
  cittaTable,
  consegneTable,
  creditoSolidaleMovimentiTable,
  db,
  fornitoriTable,
  interventiTable,
  lottiTable,
  magazziniTable,
  mezziTable,
  movimentiTable,
  nucleoFamiliareTable,
  politicheCreditoSolidaleTable,
  prenotazioniMagazzinoTable,
  prodottiTable,
  scarichiTable,
  scaricoRigheTable,
  sessioniCassaEmporioRigheTable,
  sessioniCassaEmporioTable,
  speseEmporioRigheTable,
  speseEmporioTable,
  trasferimentiTable,
  trasferimentoRigheTable,
  turniTable,
  turniVolontariTable,
  userSessionsTable,
  utentiTable,
  volontariTable,
  zoneUdsTable,
} from "@workspace/db";
import { DEFAULT_POLICY_NAME } from "./seedPoliticheCreditoSolidale";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const DEMO_MARKER = "BUG-DB-01-DEMO";
export const DEMO_AREA_NAME = "Area Demo";
export const DEMO_CENTRO_NAME = "Centro di Ascolto Demo";
export const DEMO_WAREHOUSE_CODES = ["DEMO-MAG-001", "DEMO-MAG-002"] as const;
export const DEMO_SUPPLIER_NAMES = [
  "Fornitore Demo Alimentare",
  "Fornitore Demo Farmaceutico",
  "Donatore Demo Privato",
] as const;
export const DEMO_PRODUCT_CODES = [
  "DEMO-PASTA-500",
  "DEMO-RISO-1KG",
  "DEMO-LATTE-1L",
  "DEMO-OLIO-1L",
  "DEMO-BISCOTTI",
  "DEMO-OMOGENEIZZATI",
  "DEMO-SAPONE",
  "DEMO-FARMACO-NON-REALE",
] as const;
export const DEMO_LOT_CODES = [
  "LOT-DEMO-001",
  "LOT-DEMO-002",
  "LOT-DEMO-003",
  "LOT-DEMO-004",
  "LOT-DEMO-005",
  "LOT-DEMO-006",
  "LOT-DEMO-007",
  "LOT-DEMO-008",
] as const;

const DEMO_WAREHOUSES = [
  {
    codice: DEMO_WAREHOUSE_CODES[0],
    nome: "Magazzino Demo Principale",
    tipoMagazzino: "logistico",
  },
  {
    codice: DEMO_WAREHOUSE_CODES[1],
    nome: "Magazzino Demo Emporio",
    tipoMagazzino: "emporio",
  },
] as const;

const DEMO_SUPPLIERS = [
  {
    nome: DEMO_SUPPLIER_NAMES[0],
    tipo: "commerciale",
    email: "alimentare.demo@example.org",
  },
  {
    nome: DEMO_SUPPLIER_NAMES[1],
    tipo: "commerciale",
    email: "farmaceutico.demo@example.org",
  },
  {
    nome: DEMO_SUPPLIER_NAMES[2],
    tipo: "donatore_privato",
    email: "donatore.demo@example.org",
  },
] as const;

const DEMO_PRODUCTS = [
  {
    codice: DEMO_PRODUCT_CODES[0],
    nome: "Pasta Demo 500g",
    tipoProdotto: "alimentare",
    unitaMisura: "pz",
    supplierIndex: 0,
    quantita: 24,
  },
  {
    codice: DEMO_PRODUCT_CODES[1],
    nome: "Riso Demo 1kg",
    tipoProdotto: "alimentare",
    unitaMisura: "pz",
    supplierIndex: 0,
    quantita: 18,
  },
  {
    codice: DEMO_PRODUCT_CODES[2],
    nome: "Latte Demo 1L",
    tipoProdotto: "alimentare",
    unitaMisura: "pz",
    supplierIndex: 2,
    quantita: 12,
  },
  {
    codice: DEMO_PRODUCT_CODES[3],
    nome: "Olio Demo 1L",
    tipoProdotto: "alimentare",
    unitaMisura: "pz",
    supplierIndex: 0,
    quantita: 10,
  },
  {
    codice: DEMO_PRODUCT_CODES[4],
    nome: "Biscotti Demo",
    tipoProdotto: "alimentare",
    unitaMisura: "conf",
    supplierIndex: 2,
    quantita: 16,
  },
  {
    codice: DEMO_PRODUCT_CODES[5],
    nome: "Omogeneizzati Demo",
    tipoProdotto: "alimentare",
    unitaMisura: "conf",
    supplierIndex: 0,
    quantita: 8,
  },
  {
    codice: DEMO_PRODUCT_CODES[6],
    nome: "Sapone Demo",
    tipoProdotto: "igiene",
    unitaMisura: "pz",
    supplierIndex: 2,
    quantita: 14,
  },
  {
    codice: DEMO_PRODUCT_CODES[7],
    nome: "Farmaco Demo Non Reale",
    tipoProdotto: "medicinali",
    unitaMisura: "conf",
    supplierIndex: 1,
    quantita: 6,
  },
] as const;

export type EnvironmentDataSummary = Record<string, number | boolean>;

function assertDemoOwned(
  label: string,
  markerValue: string | null | undefined,
): void {
  if (!markerValue?.includes(DEMO_MARKER)) {
    throw new Error(
      `Seed demo annullato: esiste già ${label} senza il marcatore ${DEMO_MARKER}.`,
    );
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function futureDate(monthOffset: number): string {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + monthOffset);
  return isoDate(date);
}

async function insertAudit(
  tx: Transaction,
  actorUserId: number | null,
  action: string,
  key: string,
  summary: EnvironmentDataSummary,
  note: string,
): Promise<void> {
  await tx.insert(auditConfigurazioniTable).values({
    area: "dati_ambiente",
    chiave: key,
    azione: action,
    valoreNuovo: summary,
    utenteId: actorUserId,
    ip: "cli",
    note,
  });
}

/**
 * Creates only conspicuously synthetic warehouse data. Existing matching rows
 * are reused without overwriting local changes, making the operation idempotent.
 */
export async function seedDemoWarehouseData(
  actorUserId: number | null,
): Promise<EnvironmentDataSummary> {
  return db.transaction(async (tx) => {
    let createdAree = 0;
    let createdCentri = 0;
    let createdMagazzini = 0;
    let createdFornitori = 0;
    let createdProdotti = 0;
    let createdLotti = 0;
    let createdMovimenti = 0;

    let [area] = await tx
      .select({ id: cittaTable.id, note: cittaTable.note })
      .from(cittaTable)
      .where(eq(cittaTable.nome, DEMO_AREA_NAME));
    if (area) assertDemoOwned(`l'area "${DEMO_AREA_NAME}"`, area.note);
    if (!area) {
      [area] = await tx
        .insert(cittaTable)
        .values({
          nome: DEMO_AREA_NAME,
          provincia: "DE",
          sigla: "DE",
          note: `${DEMO_MARKER}: dato territoriale sintetico`,
        })
        .returning({ id: cittaTable.id, note: cittaTable.note });
      createdAree += 1;
    }

    let [centro] = await tx
      .select({ id: centriAscoltoTable.id, note: centriAscoltoTable.note })
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.nome, DEMO_CENTRO_NAME));
    if (centro) assertDemoOwned(`il centro "${DEMO_CENTRO_NAME}"`, centro.note);
    if (!centro) {
      [centro] = await tx
        .insert(centriAscoltoTable)
        .values({
          nome: DEMO_CENTRO_NAME,
          cittaId: area.id,
          comune: "Comune Demo",
          email: "centro.demo@example.org",
          note: `${DEMO_MARKER}: nessun dato personale reale`,
        })
        .returning({
          id: centriAscoltoTable.id,
          note: centriAscoltoTable.note,
        });
      createdCentri += 1;
    }

    const warehouseIds: number[] = [];
    for (const warehouse of DEMO_WAREHOUSES) {
      let [row] = await tx
        .select({ id: magazziniTable.id, note: magazziniTable.note })
        .from(magazziniTable)
        .where(eq(magazziniTable.codice, warehouse.codice));
      if (row) assertDemoOwned(`il magazzino "${warehouse.codice}"`, row.note);
      if (!row) {
        [row] = await tx
          .insert(magazziniTable)
          .values({
            ...warehouse,
            cittaId: area.id,
            centroAscoltoId: centro.id,
            comune: "Comune Demo",
            email: `${warehouse.codice.toLowerCase()}@example.org`,
            note: `${DEMO_MARKER}: magazzino sintetico`,
          })
          .returning({ id: magazziniTable.id, note: magazziniTable.note });
        createdMagazzini += 1;
      }
      warehouseIds.push(row.id);
    }

    const supplierIds: number[] = [];
    for (const supplier of DEMO_SUPPLIERS) {
      let [row] = await tx
        .select({ id: fornitoriTable.id, note: fornitoriTable.note })
        .from(fornitoriTable)
        .where(eq(fornitoriTable.nome, supplier.nome));
      if (row) assertDemoOwned(`il fornitore "${supplier.nome}"`, row.note);
      if (!row) {
        [row] = await tx
          .insert(fornitoriTable)
          .values({
            ...supplier,
            cittaId: area.id,
            referente: "Referente Demo",
            note: `${DEMO_MARKER}: fornitore sintetico`,
          })
          .returning({ id: fornitoriTable.id, note: fornitoriTable.note });
        createdFornitori += 1;
      }
      supplierIds.push(row.id);
    }

    const productIds: number[] = [];
    for (const product of DEMO_PRODUCTS) {
      let [row] = await tx
        .select({ id: prodottiTable.id, note: prodottiTable.note })
        .from(prodottiTable)
        .where(eq(prodottiTable.codice, product.codice));
      if (row) assertDemoOwned(`il prodotto "${product.codice}"`, row.note);
      if (!row) {
        [row] = await tx
          .insert(prodottiTable)
          .values({
            codice: product.codice,
            nome: product.nome,
            descrizione: `${DEMO_MARKER}: prodotto non reale`,
            tipoProdotto: product.tipoProdotto,
            unitaMisura: product.unitaMisura,
            gestioneLotto: true,
            gestioneScadenza: true,
            scortaMinima: "2.00",
            scortaConsigliata: "10.00",
            abilitatoEmporio: product.tipoProdotto !== "medicinali",
            creditoSolidaleValore:
              product.tipoProdotto === "medicinali" ? "0.00" : "1.00",
            fornitoreId: supplierIds[product.supplierIndex],
            note: `${DEMO_MARKER}: solo per collaudo`,
          })
          .returning({ id: prodottiTable.id, note: prodottiTable.note });
        createdProdotti += 1;
      }
      productIds.push(row.id);
    }

    const today = isoDate(new Date());
    for (let index = 0; index < DEMO_PRODUCTS.length; index += 1) {
      const product = DEMO_PRODUCTS[index];
      const warehouseId = warehouseIds[index % warehouseIds.length];
      const lotCode = DEMO_LOT_CODES[index];
      let [lot] = await tx
        .select({
          id: lottiTable.id,
          documentoCarico: lottiTable.documentoCarico,
        })
        .from(lottiTable)
        .where(
          and(
            eq(lottiTable.codiceLotto, lotCode),
            eq(lottiTable.prodottoId, productIds[index]),
            eq(lottiTable.magazzinoId, warehouseId),
          ),
        );
      if (lot) assertDemoOwned(`il lotto "${lotCode}"`, lot.documentoCarico);
      if (!lot) {
        [lot] = await tx
          .insert(lottiTable)
          .values({
            prodottoId: productIds[index],
            codiceLotto: lotCode,
            dataScadenza: futureDate(8 + index * 2),
            dataCarico: today,
            quantitaCaricata: product.quantita.toFixed(2),
            quantitaResidua: product.quantita.toFixed(2),
            magazzinoId: warehouseId,
            fornitoreId: supplierIds[product.supplierIndex],
            fsePlus: false,
            documentoCarico: DEMO_MARKER,
            note: `${DEMO_MARKER}: lotto sintetico`,
          })
          .returning({
            id: lottiTable.id,
            documentoCarico: lottiTable.documentoCarico,
          });
        createdLotti += 1;
      }

      const [movement] = await tx
        .select({ id: movimentiTable.id })
        .from(movimentiTable)
        .where(
          and(
            eq(movimentiTable.lottoId, lot.id),
            eq(movimentiTable.documentoRiferimento, DEMO_MARKER),
          ),
        );
      if (!movement) {
        await tx.insert(movimentiTable).values({
          tipoMovimento: "carico",
          tipoDettaglio: "donazione",
          dataMovimento: today,
          magazzinoId: warehouseId,
          prodottoId: productIds[index],
          lottoId: lot.id,
          quantita: product.quantita.toFixed(2),
          unitaMisura: product.unitaMisura,
          fornitoreId: supplierIds[product.supplierIndex],
          documentoRiferimento: DEMO_MARKER,
          note: `${DEMO_MARKER}: carico iniziale sintetico`,
        });
        createdMovimenti += 1;
      }
    }

    const summary: EnvironmentDataSummary = {
      createdAree,
      createdCentri,
      createdMagazzini,
      createdFornitori,
      createdProdotti,
      createdLotti,
      createdMovimenti,
      bolleCreate: 0,
      beneficiariCreati: 0,
    };
    await insertAudit(
      tx,
      actorUserId,
      "seed_demo",
      "magazzino_demo",
      summary,
      "Seed sintetico idempotente; nessuna bolla o persona creata.",
    );
    return summary;
  });
}

async function firstOperationalDemoReference(
  tx: Transaction,
  productIds: number[],
  lotIds: number[],
  warehouseIds: number[],
): Promise<string | null> {
  if (productIds.length > 0 || lotIds.length > 0) {
    const productOrLot = or(
      productIds.length > 0
        ? inArray(bollaRigheTable.prodottoId, productIds)
        : undefined,
      lotIds.length > 0 ? inArray(bollaRigheTable.lottoId, lotIds) : undefined,
    );
    const [bolla] = await tx
      .select({ id: bollaRigheTable.id })
      .from(bollaRigheTable)
      .where(productOrLot)
      .limit(1);
    if (bolla) return "righe bolla";

    const [reservation] = await tx
      .select({ id: prenotazioniMagazzinoTable.id })
      .from(prenotazioniMagazzinoTable)
      .where(
        or(
          productIds.length > 0
            ? inArray(prenotazioniMagazzinoTable.prodottoId, productIds)
            : undefined,
          lotIds.length > 0
            ? inArray(prenotazioniMagazzinoTable.lottoId, lotIds)
            : undefined,
        ),
      )
      .limit(1);
    if (reservation) return "prenotazioni magazzino";

    const [transfer] = await tx
      .select({ id: trasferimentoRigheTable.id })
      .from(trasferimentoRigheTable)
      .where(
        or(
          productIds.length > 0
            ? inArray(trasferimentoRigheTable.prodottoId, productIds)
            : undefined,
          lotIds.length > 0
            ? inArray(trasferimentoRigheTable.lottoId, lotIds)
            : undefined,
        ),
      )
      .limit(1);
    if (transfer) return "trasferimenti";

    const [procurement] = await tx
      .select({ id: approvvigionamentoRigheTable.id })
      .from(approvvigionamentoRigheTable)
      .where(
        productIds.length > 0
          ? inArray(approvvigionamentoRigheTable.prodottoId, productIds)
          : undefined,
      )
      .limit(1);
    if (procurement) return "approvvigionamenti";

    const [unload] = await tx
      .select({ id: scaricoRigheTable.id })
      .from(scaricoRigheTable)
      .where(
        productIds.length > 0
          ? inArray(scaricoRigheTable.prodottoId, productIds)
          : undefined,
      )
      .limit(1);
    if (unload) return "scarichi";

    const [cashRow] = await tx
      .select({ id: sessioniCassaEmporioRigheTable.id })
      .from(sessioniCassaEmporioRigheTable)
      .where(
        or(
          productIds.length > 0
            ? inArray(sessioniCassaEmporioRigheTable.prodottoId, productIds)
            : undefined,
          lotIds.length > 0
            ? inArray(sessioniCassaEmporioRigheTable.lottoId, lotIds)
            : undefined,
        ),
      )
      .limit(1);
    if (cashRow) return "sessioni cassa Emporio";

    const [expenseRow] = await tx
      .select({ id: speseEmporioRigheTable.id })
      .from(speseEmporioRigheTable)
      .where(
        or(
          productIds.length > 0
            ? inArray(speseEmporioRigheTable.prodottoId, productIds)
            : undefined,
          lotIds.length > 0
            ? inArray(speseEmporioRigheTable.lottoId, lotIds)
            : undefined,
        ),
      )
      .limit(1);
    if (expenseRow) return "spese Emporio";

    const [stockMovement] = await tx
      .select({ id: movimentiTable.id })
      .from(movimentiTable)
      .where(
        and(
          or(
            productIds.length > 0
              ? inArray(movimentiTable.prodottoId, productIds)
              : undefined,
            lotIds.length > 0
              ? inArray(movimentiTable.lottoId, lotIds)
              : undefined,
          ),
          or(
            isNull(movimentiTable.documentoRiferimento),
            ne(movimentiTable.documentoRiferimento, DEMO_MARKER),
          ),
        ),
      )
      .limit(1);
    if (stockMovement) return "movimenti non demo";
  }

  if (warehouseIds.length > 0) {
    const [document] = await tx
      .select({ id: bolleTable.id })
      .from(bolleTable)
      .where(inArray(bolleTable.magazzinoId, warehouseIds))
      .limit(1);
    if (document) return "bolle collegate ai magazzini demo";

    const [delivery] = await tx
      .select({ id: consegneTable.id })
      .from(consegneTable)
      .where(
        or(
          inArray(consegneTable.magazzinoId, warehouseIds),
          inArray(consegneTable.magazzinoEmporioId, warehouseIds),
        ),
      )
      .limit(1);
    if (delivery) return "consegne collegate ai magazzini demo";

    const [preferred] = await tx
      .select({ id: beneficiariTable.id })
      .from(beneficiariTable)
      .where(
        inArray(beneficiariTable.magazzinoEmporioPreferitoId, warehouseIds),
      )
      .limit(1);
    if (preferred) return "preferenze Emporio dei beneficiari";

    const [warehouseTransfer] = await tx
      .select({ id: trasferimentiTable.id })
      .from(trasferimentiTable)
      .where(
        or(
          inArray(trasferimentiTable.magazzinoOrigineId, warehouseIds),
          inArray(trasferimentiTable.magazzinoDestinoId, warehouseIds),
        ),
      )
      .limit(1);
    if (warehouseTransfer) return "trasferimenti collegati ai magazzini demo";

    const [warehouseUnload] = await tx
      .select({ id: scarichiTable.id })
      .from(scarichiTable)
      .where(inArray(scarichiTable.magazzinoId, warehouseIds))
      .limit(1);
    if (warehouseUnload) return "scarichi collegati ai magazzini demo";

    const [warehouseProcurement] = await tx
      .select({ id: approvvigionamentiTable.id })
      .from(approvvigionamentiTable)
      .where(inArray(approvvigionamentiTable.magazzinoId, warehouseIds))
      .limit(1);
    if (warehouseProcurement) {
      return "approvvigionamenti collegati ai magazzini demo";
    }
  }

  return null;
}

async function demoCentreHasReferences(
  tx: Transaction,
  centreId: number,
): Promise<boolean> {
  const checks: Array<() => Promise<unknown[]>> = [
    async () =>
      tx
        .select({ id: utentiTable.id })
        .from(utentiTable)
        .where(eq(utentiTable.centroAscoltoId, centreId))
        .limit(1),
    async () =>
      tx
        .select({ id: beneficiariTable.id })
        .from(beneficiariTable)
        .where(eq(beneficiariTable.centroAscoltoId, centreId))
        .limit(1),
    async () =>
      tx
        .select({ id: volontariTable.id })
        .from(volontariTable)
        .where(eq(volontariTable.centroAscoltoId, centreId))
        .limit(1),
    async () =>
      tx
        .select({ id: magazziniTable.id })
        .from(magazziniTable)
        .where(eq(magazziniTable.centroAscoltoId, centreId))
        .limit(1),
    async () =>
      tx
        .select({ id: mezziTable.id })
        .from(mezziTable)
        .where(eq(mezziTable.centroAscoltoId, centreId))
        .limit(1),
    async () =>
      tx
        .select({ id: turniTable.id })
        .from(turniTable)
        .where(eq(turniTable.centroAscoltoId, centreId))
        .limit(1),
    async () =>
      tx
        .select({ id: scarichiTable.id })
        .from(scarichiTable)
        .where(eq(scarichiTable.centroAscoltoId, centreId))
        .limit(1),
    async () =>
      tx
        .select({ id: politicheCreditoSolidaleTable.id })
        .from(politicheCreditoSolidaleTable)
        .where(eq(politicheCreditoSolidaleTable.centroAscoltoId, centreId))
        .limit(1),
    async () =>
      tx
        .select({ id: sessioniCassaEmporioTable.id })
        .from(sessioniCassaEmporioTable)
        .where(eq(sessioniCassaEmporioTable.centroAscoltoId, centreId))
        .limit(1),
    async () =>
      tx
        .select({ id: speseEmporioTable.id })
        .from(speseEmporioTable)
        .where(eq(speseEmporioTable.centroAscoltoId, centreId))
        .limit(1),
    async () =>
      tx
        .select({ id: fornitoriTable.id })
        .from(fornitoriTable)
        .where(eq(fornitoriTable.centroAscoltoId, centreId))
        .limit(1),
    async () =>
      tx
        .select({ id: approvvigionamentiTable.id })
        .from(approvvigionamentiTable)
        .where(eq(approvvigionamentiTable.centroAscoltoId, centreId))
        .limit(1),
  ];
  for (const check of checks) {
    if ((await check()).length > 0) return true;
  }
  return false;
}

async function demoAreaHasReferences(
  tx: Transaction,
  areaId: number,
): Promise<boolean> {
  const checks: Array<() => Promise<unknown[]>> = [
    async () =>
      tx
        .select({ id: utentiTable.id })
        .from(utentiTable)
        .where(eq(utentiTable.cittaId, areaId))
        .limit(1),
    async () =>
      tx
        .select({ id: beneficiariTable.id })
        .from(beneficiariTable)
        .where(eq(beneficiariTable.cittaId, areaId))
        .limit(1),
    async () =>
      tx
        .select({ id: centriAscoltoTable.id })
        .from(centriAscoltoTable)
        .where(eq(centriAscoltoTable.cittaId, areaId))
        .limit(1),
    async () =>
      tx
        .select({ id: magazziniTable.id })
        .from(magazziniTable)
        .where(eq(magazziniTable.cittaId, areaId))
        .limit(1),
    async () =>
      tx
        .select({ id: fornitoriTable.id })
        .from(fornitoriTable)
        .where(eq(fornitoriTable.cittaId, areaId))
        .limit(1),
    async () =>
      tx
        .select({ id: zoneUdsTable.id })
        .from(zoneUdsTable)
        .where(eq(zoneUdsTable.cittaId, areaId))
        .limit(1),
    async () =>
      tx
        .select({ id: politicheCreditoSolidaleTable.id })
        .from(politicheCreditoSolidaleTable)
        .where(eq(politicheCreditoSolidaleTable.cittaId, areaId))
        .limit(1),
    async () =>
      tx
        .select({ id: sessioniCassaEmporioTable.id })
        .from(sessioniCassaEmporioTable)
        .where(eq(sessioniCassaEmporioTable.cittaId, areaId))
        .limit(1),
    async () =>
      tx
        .select({ id: speseEmporioTable.id })
        .from(speseEmporioTable)
        .where(eq(speseEmporioTable.cittaId, areaId))
        .limit(1),
    async () =>
      tx
        .select({ id: creditoSolidaleMovimentiTable.id })
        .from(creditoSolidaleMovimentiTable)
        .where(eq(creditoSolidaleMovimentiTable.cittaId, areaId))
        .limit(1),
  ];
  for (const check of checks) {
    if ((await check()).length > 0) return true;
  }
  return false;
}

/** Deletes only the exact synthetic warehouse dataset and refuses mixed use. */
export async function resetDemoWarehouseData(
  actorUserId: number,
): Promise<EnvironmentDataSummary> {
  return db.transaction(async (tx) => {
    const products = await tx
      .select({ id: prodottiTable.id })
      .from(prodottiTable)
      .where(
        and(
          inArray(prodottiTable.codice, [...DEMO_PRODUCT_CODES]),
          like(prodottiTable.note, `%${DEMO_MARKER}%`),
        ),
      );
    const warehouses = await tx
      .select({ id: magazziniTable.id })
      .from(magazziniTable)
      .where(
        and(
          inArray(magazziniTable.codice, [...DEMO_WAREHOUSE_CODES]),
          like(magazziniTable.note, `%${DEMO_MARKER}%`),
        ),
      );
    const suppliers = await tx
      .select({ id: fornitoriTable.id })
      .from(fornitoriTable)
      .where(
        and(
          inArray(fornitoriTable.nome, [...DEMO_SUPPLIER_NAMES]),
          like(fornitoriTable.note, `%${DEMO_MARKER}%`),
        ),
      );
    const lots = await tx
      .select({ id: lottiTable.id })
      .from(lottiTable)
      .where(
        and(
          inArray(lottiTable.codiceLotto, [...DEMO_LOT_CODES]),
          eq(lottiTable.documentoCarico, DEMO_MARKER),
        ),
      );

    const productIds = products.map((row) => row.id);
    const warehouseIds = warehouses.map((row) => row.id);
    const supplierIds = suppliers.map((row) => row.id);
    const lotIds = lots.map((row) => row.id);
    const reference = await firstOperationalDemoReference(
      tx,
      productIds,
      lotIds,
      warehouseIds,
    );
    if (reference) {
      throw new Error(
        `Reset demo annullato: i dati sintetici sono usati da ${reference}.`,
      );
    }

    const deletedMovimenti =
      productIds.length > 0 || lotIds.length > 0 || warehouseIds.length > 0
        ? await tx
            .delete(movimentiTable)
            .where(
              and(
                eq(movimentiTable.documentoRiferimento, DEMO_MARKER),
                or(
                  productIds.length > 0
                    ? inArray(movimentiTable.prodottoId, productIds)
                    : undefined,
                  lotIds.length > 0
                    ? inArray(movimentiTable.lottoId, lotIds)
                    : undefined,
                  warehouseIds.length > 0
                    ? inArray(movimentiTable.magazzinoId, warehouseIds)
                    : undefined,
                ),
              ),
            )
            .returning({ id: movimentiTable.id })
        : [];
    const deletedLotti = lotIds.length
      ? await tx
          .delete(lottiTable)
          .where(inArray(lottiTable.id, lotIds))
          .returning({ id: lottiTable.id })
      : [];
    const deletedProdotti = productIds.length
      ? await tx
          .delete(prodottiTable)
          .where(inArray(prodottiTable.id, productIds))
          .returning({ id: prodottiTable.id })
      : [];
    const deletedMagazzini = warehouseIds.length
      ? await tx
          .delete(magazziniTable)
          .where(inArray(magazziniTable.id, warehouseIds))
          .returning({ id: magazziniTable.id })
      : [];

    let deletedFornitori = 0;
    for (const supplierId of supplierIds) {
      const [stillUsedByLot] = await tx
        .select({ id: lottiTable.id })
        .from(lottiTable)
        .where(eq(lottiTable.fornitoreId, supplierId))
        .limit(1);
      const [stillUsedByProduct] = await tx
        .select({ id: prodottiTable.id })
        .from(prodottiTable)
        .where(eq(prodottiTable.fornitoreId, supplierId))
        .limit(1);
      if (!stillUsedByLot && !stillUsedByProduct) {
        const rows = await tx
          .delete(fornitoriTable)
          .where(eq(fornitoriTable.id, supplierId))
          .returning({ id: fornitoriTable.id });
        deletedFornitori += rows.length;
      }
    }

    const [demoCentro] = await tx
      .select({ id: centriAscoltoTable.id })
      .from(centriAscoltoTable)
      .where(
        and(
          eq(centriAscoltoTable.nome, DEMO_CENTRO_NAME),
          like(centriAscoltoTable.note, `%${DEMO_MARKER}%`),
        ),
      );
    let deletedCentri = 0;
    if (demoCentro) {
      if (!(await demoCentreHasReferences(tx, demoCentro.id))) {
        const rows = await tx
          .delete(centriAscoltoTable)
          .where(eq(centriAscoltoTable.id, demoCentro.id))
          .returning({ id: centriAscoltoTable.id });
        deletedCentri = rows.length;
      }
    }

    const [demoArea] = await tx
      .select({ id: cittaTable.id })
      .from(cittaTable)
      .where(
        and(
          eq(cittaTable.nome, DEMO_AREA_NAME),
          like(cittaTable.note, `%${DEMO_MARKER}%`),
        ),
      );
    let deletedAree = 0;
    if (demoArea) {
      if (!(await demoAreaHasReferences(tx, demoArea.id))) {
        const rows = await tx
          .delete(cittaTable)
          .where(eq(cittaTable.id, demoArea.id))
          .returning({ id: cittaTable.id });
        deletedAree = rows.length;
      }
    }

    const summary: EnvironmentDataSummary = {
      deletedMovimenti: deletedMovimenti.length,
      deletedLotti: deletedLotti.length,
      deletedProdotti: deletedProdotti.length,
      deletedFornitori,
      deletedMagazzini: deletedMagazzini.length,
      deletedCentri,
      deletedAree,
      territorialDataPreserved: deletedCentri === 0 || deletedAree === 0,
    };
    await insertAudit(
      tx,
      actorUserId,
      "reset_demo",
      "magazzino_demo",
      summary,
      "Reset limitato ai codici demo BUG-DB-01.",
    );
    return summary;
  });
}

async function resetWarehouseOperationalData(
  tx: Transaction,
): Promise<EnvironmentDataSummary> {
  await tx.update(beneficiariTable).set({ magazzinoEmporioPreferitoId: null });
  await tx.update(interventiTable).set({ bollaId: null });

  const deletedSpeseRighe = await tx
    .delete(speseEmporioRigheTable)
    .returning({ id: speseEmporioRigheTable.id });
  const deletedSpese = await tx
    .delete(speseEmporioTable)
    .returning({ id: speseEmporioTable.id });
  const deletedSessioniRighe = await tx
    .delete(sessioniCassaEmporioRigheTable)
    .returning({ id: sessioniCassaEmporioRigheTable.id });
  const deletedSessioni = await tx
    .delete(sessioniCassaEmporioTable)
    .returning({ id: sessioniCassaEmporioTable.id });
  const deletedPrenotazioni = await tx
    .delete(prenotazioniMagazzinoTable)
    .returning({ id: prenotazioniMagazzinoTable.id });
  const deletedBollaRighe = await tx
    .delete(bollaRigheTable)
    .returning({ id: bollaRigheTable.id });
  const deletedBolle = await tx
    .delete(bolleTable)
    .returning({ id: bolleTable.id });
  const deletedMovimenti = await tx
    .delete(movimentiTable)
    .returning({ id: movimentiTable.id });
  const deletedTrasferimentoRighe = await tx
    .delete(trasferimentoRigheTable)
    .returning({ id: trasferimentoRigheTable.id });
  const deletedTrasferimenti = await tx
    .delete(trasferimentiTable)
    .returning({ id: trasferimentiTable.id });
  const deletedScaricoRighe = await tx
    .delete(scaricoRigheTable)
    .returning({ id: scaricoRigheTable.id });
  const deletedScarichi = await tx
    .delete(scarichiTable)
    .returning({ id: scarichiTable.id });
  const deletedApprovvigionamentoRighe = await tx
    .delete(approvvigionamentoRigheTable)
    .returning({ id: approvvigionamentoRigheTable.id });
  const deletedApprovvigionamenti = await tx
    .delete(approvvigionamentiTable)
    .returning({ id: approvvigionamentiTable.id });
  const deletedConsegne = await tx
    .delete(consegneTable)
    .returning({ id: consegneTable.id });
  const deletedLotti = await tx
    .delete(lottiTable)
    .returning({ id: lottiTable.id });
  const deletedProdotti = await tx
    .delete(prodottiTable)
    .returning({ id: prodottiTable.id });
  const deletedFornitori = await tx
    .delete(fornitoriTable)
    .returning({ id: fornitoriTable.id });
  const deletedMagazzini = await tx
    .delete(magazziniTable)
    .returning({ id: magazziniTable.id });

  return {
    deletedSpeseRighe: deletedSpeseRighe.length,
    deletedSpese: deletedSpese.length,
    deletedSessioniRighe: deletedSessioniRighe.length,
    deletedSessioni: deletedSessioni.length,
    deletedPrenotazioni: deletedPrenotazioni.length,
    deletedBollaRighe: deletedBollaRighe.length,
    deletedBolle: deletedBolle.length,
    deletedMovimenti: deletedMovimenti.length,
    deletedTrasferimentoRighe: deletedTrasferimentoRighe.length,
    deletedTrasferimenti: deletedTrasferimenti.length,
    deletedScaricoRighe: deletedScaricoRighe.length,
    deletedScarichi: deletedScarichi.length,
    deletedApprovvigionamentoRighe: deletedApprovvigionamentoRighe.length,
    deletedApprovvigionamenti: deletedApprovvigionamenti.length,
    deletedConsegne: deletedConsegne.length,
    deletedLotti: deletedLotti.length,
    deletedProdotti: deletedProdotti.length,
    deletedFornitori: deletedFornitori.length,
    deletedMagazzini: deletedMagazzini.length,
  };
}

/** Deletes all warehouse operational data but preserves identities/config/audit. */
export async function resetWarehouseData(
  actorUserId: number,
): Promise<EnvironmentDataSummary> {
  return db.transaction(async (tx) => {
    const summary = await resetWarehouseOperationalData(tx);
    await insertAudit(
      tx,
      actorUserId,
      "reset_totale",
      "magazzino",
      summary,
      "Reset totale magazzino eseguito da CLI con conferma forte e backup dichiarato.",
    );
    return summary;
  });
}

/**
 * Resets operational/social data while preserving users, base roles,
 * configuration, functional modules, settings and the existing audit trail.
 */
export async function resetOperationalEnvironment(
  actorUserId: number,
): Promise<EnvironmentDataSummary> {
  return db.transaction(async (tx) => {
    const warehouseSummary = await resetWarehouseOperationalData(tx);
    const deletedCredito = await tx
      .delete(creditoSolidaleMovimentiTable)
      .returning({ id: creditoSolidaleMovimentiTable.id });
    const deletedNucleo = await tx
      .delete(nucleoFamiliareTable)
      .returning({ id: nucleoFamiliareTable.id });
    const deletedInterventi = await tx
      .delete(interventiTable)
      .returning({ id: interventiTable.id });
    const deletedBeneficiari = await tx
      .delete(beneficiariTable)
      .returning({ id: beneficiariTable.id });
    const deletedTurniVolontari = await tx
      .delete(turniVolontariTable)
      .returning({ id: turniVolontariTable.id });
    const deletedTurni = await tx
      .delete(turniTable)
      .returning({ id: turniTable.id });
    const deletedMezzi = await tx
      .delete(mezziTable)
      .returning({ id: mezziTable.id });
    const deletedVolontari = await tx
      .delete(volontariTable)
      .returning({ id: volontariTable.id });

    // Keep the one base policy and reset its scope; discard environment-specific
    // policies because their area/centre references are about to be removed.
    await tx
      .delete(politicheCreditoSolidaleTable)
      .where(ne(politicheCreditoSolidaleTable.nome, DEFAULT_POLICY_NAME));
    await tx
      .update(politicheCreditoSolidaleTable)
      .set({ cittaId: null, centroAscoltoId: null })
      .where(eq(politicheCreditoSolidaleTable.nome, DEFAULT_POLICY_NAME));

    // Preserve every technical/application user and all roles, but remove
    // territorial links that would otherwise prevent the environment reset.
    await tx
      .update(utentiTable)
      .set({ centroAscoltoId: null, cittaId: null, zonaUdsId: null });
    const deletedSessioniUtente = await tx
      .delete(userSessionsTable)
      .returning({ sid: userSessionsTable.sid });
    const deletedZone = await tx
      .delete(zoneUdsTable)
      .returning({ id: zoneUdsTable.id });
    const deletedCentri = await tx
      .delete(centriAscoltoTable)
      .returning({ id: centriAscoltoTable.id });
    const deletedAree = await tx
      .delete(cittaTable)
      .returning({ id: cittaTable.id });

    const summary: EnvironmentDataSummary = {
      ...warehouseSummary,
      deletedCredito: deletedCredito.length,
      deletedNucleo: deletedNucleo.length,
      deletedInterventi: deletedInterventi.length,
      deletedBeneficiari: deletedBeneficiari.length,
      deletedTurniVolontari: deletedTurniVolontari.length,
      deletedTurni: deletedTurni.length,
      deletedMezzi: deletedMezzi.length,
      deletedVolontari: deletedVolontari.length,
      deletedSessioniUtente: deletedSessioniUtente.length,
      deletedZone: deletedZone.length,
      deletedCentri: deletedCentri.length,
      deletedAree: deletedAree.length,
      utentiPreservati: true,
      ruoliPreservati: true,
      configurazionePreservata: true,
      auditPreservato: true,
    };
    await insertAudit(
      tx,
      actorUserId,
      "reset_totale",
      "ambiente_operativo",
      summary,
      "Reset operativo ambiente: identità, ruoli, configurazione, moduli, impostazioni e audit preservati.",
    );
    return summary;
  });
}
