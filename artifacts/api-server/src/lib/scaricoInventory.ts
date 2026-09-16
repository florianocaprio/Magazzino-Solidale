import {
  db,
  type CanaleOperativo,
  lottiTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  prodottiTable,
  scarichiTable,
  scaricoRigheTable,
} from "@workspace/db";
import { and, asc, eq, gt, inArray, sum, type SQL } from "drizzle-orm";
import { PRENOTAZIONE_MAGAZZINO_ATTIVA } from "./disponibilitaMagazzino";
import {
  isLottoDistribuibile,
  lottoSelectionCondition,
  type LottoSelectionPolicy,
} from "./lottoPolicy";
import {
  InventoryDecimal,
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "./inventoryDecimal";
import {
  ensureDistributionOperation,
  markDistributionOperationReversed,
  reconcileDistributionOperationState,
  type DistributionOperationInput,
} from "./distributionLedger";
import { resolveInventoryQuantityDimensions } from "./inventoryQuantityDimensions";
import {
  auditFields,
  auditUserId,
  recordAuditEvent,
  type AuditCommandContext,
} from "./auditEvent";
import {
  ProductOperationalQuantityError,
  validateProductOperationalQuantity,
} from "./productQuantity";

export type InventoryTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export class InventoryError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export interface ScaricoInventarialeRiga {
  prodottoId: number;
  quantita: string | number;
  unitaMisura: string;
  lottoId?: number | null;
  rigaOrigineId?: number | null;
  note?: string | null;
}

export interface InventorySourceContext {
  naturaContabile:
    | "DISTRIBUZIONE_FINALE"
    | "SCARTO"
    | "RESO"
    | "RETTIFICA_NEGATIVA"
    | "ALTRO";
  dominioOrigine: string;
  entitaOrigineTipo: string;
  entitaOrigineId: number;
  canaleOperativo?: CanaleOperativo | null;
  operazioneDistribuzioneId?: number | null;
}

export interface ScaricoInventarialeInput {
  codice: string;
  magazzinoId: number;
  centroAscoltoId: number | null;
  dataScarico: string;
  causale: string;
  causaleAltro?: string | null;
  note?: string | null;
  operatoreId: number;
  audit?: AuditCommandContext;
  beneficiarioId?: number | null;
  documentoRiferimento?: string | null;
  lottoPolicy?: LottoSelectionPolicy;
  allowedFondiOrigine?: string[];
  source?: InventorySourceContext;
  operazioneDistribuzione?: Omit<
    DistributionOperationInput,
    "magazzinoId" | "dataDistribuzione" | "creatoDa"
  >;
  righe: ScaricoInventarialeRiga[];
}

interface StornoScaricoInventarialeInput {
  documentoRiferimento: string;
  dataMovimento: string;
  operatoreId: number;
  tipoDettaglio: string;
  note: string;
  rejectAlreadyReversed?: boolean;
  audit?: AuditCommandContext;
}

async function impegnatoAttivoLotto(
  tx: InventoryTransaction,
  lottoId: number,
): Promise<InventoryDecimal> {
  const [result] = await tx
    .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
    .from(prenotazioniMagazzinoTable)
    .where(
      and(
        eq(prenotazioniMagazzinoTable.lottoId, lottoId),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_MAGAZZINO_ATTIVA),
      ),
    );
  return InventoryDecimal.parse(result?.totale ?? "0");
}

async function scaricaRigaFefo(
  tx: InventoryTransaction,
  input: ScaricoInventarialeInput,
  riga: ScaricoInventarialeRiga,
  operationId: number | null,
  auditEventoId: number | null,
): Promise<void> {
  let rimanente: InventoryDecimal;
  try {
    rimanente = positiveInventoryDecimal(riga.quantita);
  } catch (error) {
    if (error instanceof InventoryDecimalError)
      throw new InventoryError(error.message);
    throw error;
  }
  const policyCondition = lottoSelectionCondition(
    input.lottoPolicy ?? "distribuibile",
    input.dataScarico,
  );
  const conditions: SQL[] = [
    eq(lottiTable.prodottoId, riga.prodottoId),
    eq(lottiTable.magazzinoId, input.magazzinoId),
    gt(lottiTable.quantitaResidua, "0"),
  ];
  if (policyCondition) conditions.push(policyCondition);
  if (input.allowedFondiOrigine?.length) {
    conditions.push(
      inArray(lottiTable.fondoOrigine, input.allowedFondiOrigine),
    );
  }
  const lotti = await tx
    .select()
    .from(lottiTable)
    .where(and(...conditions))
    .orderBy(asc(lottiTable.dataScadenza), asc(lottiTable.dataCarico))
    .for("update");

  for (const lotto of lotti) {
    if (!rimanente.isPositive()) break;
    const residua = InventoryDecimal.parse(lotto.quantitaResidua);
    // Una prenotazione resta un impegno operativo soltanto finché il lotto è
    // distribuibile. Se nel frattempo è scaduto, non deve impedire la rettifica
    // fisica amministrativa (`scaduta`, `deteriorata`, `rubata`, `altro`).
    const impegnato = isLottoDistribuibile(
      lotto.dataScadenza,
      input.dataScarico,
    )
      ? await impegnatoAttivoLotto(tx, lotto.id)
      : InventoryDecimal.zero();
    const netto = residua.subtract(impegnato);
    const disponibile = netto.isNegative() ? InventoryDecimal.zero() : netto;
    const prelievo = disponibile.min(rimanente);
    if (!prelievo.isPositive()) continue;

    await tx
      .update(lottiTable)
      .set({ quantitaResidua: residua.subtract(prelievo).toDb() })
      .where(eq(lottiTable.id, lotto.id));
    const dimensions = resolveInventoryQuantityDimensions({
      quantitaOperativa: prelievo.toDb(),
      unitaMisura: riga.unitaMisura,
      fattorePartita: lotto.fattoreKgLtPezzo,
    });
    await tx.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: input.causale,
      dataMovimento: input.dataScarico,
      magazzinoId: input.magazzinoId,
      prodottoId: riga.prodottoId,
      lottoId: lotto.id,
      quantita: prelievo.toDb(),
      quantitaPezzi: dimensions.quantitaPezzi,
      quantitaKgLt: dimensions.quantitaKgLt,
      fattoreKgLtPezzo: dimensions.fattoreKgLtPezzo,
      unitaMisura: riga.unitaMisura,
      beneficiarioId: input.beneficiarioId ?? null,
      operatoreId: input.operatoreId,
      auditEventoId,
      fondoOrigine: lotto.fondoOrigine,
      naturaContabile: input.source?.naturaContabile ?? "ALTRO",
      dominioOrigine: input.source?.dominioOrigine ?? "MAGAZZINO",
      entitaOrigineTipo: input.source?.entitaOrigineTipo ?? "scarico",
      entitaOrigineId: input.source?.entitaOrigineId ?? null,
      rigaOrigineId: riga.rigaOrigineId ?? null,
      operazioneDistribuzioneId: operationId,
      canaleOperativo: input.source?.canaleOperativo ?? null,
      documentoRiferimento: input.documentoRiferimento ?? null,
      note: `Scarico ${input.codice}${riga.note ? ` — ${riga.note}` : ""}`,
    });
    rimanente = rimanente.subtract(prelievo);
  }

  if (rimanente.isPositive()) {
    throw new InventoryError(
      `Disponibilità insufficiente per il prodotto #${riga.prodottoId}: mancano ${rimanente.toCanonical()}`,
    );
  }
}

async function scaricaRigaLottoEsatto(
  tx: InventoryTransaction,
  input: ScaricoInventarialeInput,
  riga: ScaricoInventarialeRiga,
  operationId: number | null,
  auditEventoId: number | null,
): Promise<void> {
  const quantity = positiveInventoryDecimal(riga.quantita);
  const [lotto] = await tx
    .select()
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.id, riga.lottoId!),
        eq(lottiTable.prodottoId, riga.prodottoId),
        eq(lottiTable.magazzinoId, input.magazzinoId),
      ),
    )
    .for("update");
  if (!lotto)
    throw new InventoryError("Lotto non compatibile con prodotto e Magazzino");
  if (
    input.allowedFondiOrigine?.length &&
    !input.allowedFondiOrigine.includes(lotto.fondoOrigine)
  ) {
    throw new InventoryError("Lotto non compatibile con i Fondi ammessi");
  }

  const residua = InventoryDecimal.parse(lotto.quantitaResidua);
  const impegnato = isLottoDistribuibile(lotto.dataScadenza, input.dataScarico)
    ? await impegnatoAttivoLotto(tx, lotto.id)
    : InventoryDecimal.zero();
  const disponibile = residua.subtract(impegnato);
  if (disponibile.isNegative() || quantity.compare(disponibile) > 0) {
    throw new InventoryError(
      `Disponibilita insufficiente sul Lotto #${lotto.id}`,
    );
  }

  await tx
    .update(lottiTable)
    .set({ quantitaResidua: residua.subtract(quantity).toDb() })
    .where(eq(lottiTable.id, lotto.id));
  const dimensions = resolveInventoryQuantityDimensions({
    quantitaOperativa: quantity.toDb(),
    unitaMisura: riga.unitaMisura,
    fattorePartita: lotto.fattoreKgLtPezzo,
  });
  await tx.insert(movimentiTable).values({
    tipoMovimento: "scarico",
    tipoDettaglio: input.causale,
    dataMovimento: input.dataScarico,
    magazzinoId: input.magazzinoId,
    prodottoId: riga.prodottoId,
    lottoId: lotto.id,
    quantita: quantity.toDb(),
    quantitaPezzi: dimensions.quantitaPezzi,
    quantitaKgLt: dimensions.quantitaKgLt,
    fattoreKgLtPezzo: dimensions.fattoreKgLtPezzo,
    unitaMisura: riga.unitaMisura,
    beneficiarioId: input.beneficiarioId ?? null,
    operatoreId: input.operatoreId,
    auditEventoId,
    fondoOrigine: lotto.fondoOrigine,
    naturaContabile: input.source?.naturaContabile ?? "ALTRO",
    dominioOrigine: input.source?.dominioOrigine ?? "MAGAZZINO",
    entitaOrigineTipo: input.source?.entitaOrigineTipo ?? "scarico",
    entitaOrigineId: input.source?.entitaOrigineId ?? null,
    rigaOrigineId: riga.rigaOrigineId ?? null,
    operazioneDistribuzioneId: operationId,
    canaleOperativo: input.source?.canaleOperativo ?? null,
    documentoRiferimento: input.documentoRiferimento ?? null,
    note: `Scarico ${input.codice}${riga.note ? ` — ${riga.note}` : ""}`,
  });
}

/**
 * Registra uno scarico e i relativi movimenti FEFO nello stesso contesto
 * transazionale del chiamante. Nessuna giacenza viene modificata se una delle
 * righe fallisce.
 */
export async function creaScaricoInventariale(
  tx: InventoryTransaction,
  input: ScaricoInventarialeInput,
): Promise<number> {
  if (input.righe.length === 0) {
    throw new InventoryError("Lo scarico richiede almeno una riga");
  }
  const [scarico] = await tx
    .insert(scarichiTable)
    .values({
      codice: input.codice,
      magazzinoId: input.magazzinoId,
      centroAscoltoId: input.centroAscoltoId,
      dataScarico: input.dataScarico,
      causale: input.causale,
      causaleAltro: input.causaleAltro ?? null,
      note: input.note ?? null,
      operatoreId: input.operatoreId,
    })
    .returning({ id: scarichiTable.id });

  const source =
    input.source?.entitaOrigineId === 0
      ? { ...input.source, entitaOrigineId: scarico.id }
      : input.source;
  let operationId = source?.operazioneDistribuzioneId ?? null;
  if (input.operazioneDistribuzione) {
    const operation = await ensureDistributionOperation(tx, {
      ...input.operazioneDistribuzione,
      entitaOrigineId:
        input.operazioneDistribuzione.entitaOrigineId === 0
          ? scarico.id
          : input.operazioneDistribuzione.entitaOrigineId,
      magazzinoId: input.magazzinoId,
      dataDistribuzione: input.dataScarico,
      creatoDa: input.operatoreId,
    });
    operationId = operation.id;
  }
  if (
    source?.naturaContabile === "DISTRIBUZIONE_FINALE" &&
    operationId == null
  ) {
    throw new InventoryError(
      "Una distribuzione finale richiede una operazione di distribuzione strutturata",
    );
  }

  const movementInput: ScaricoInventarialeInput = source
    ? { ...input, source }
    : {
        ...input,
        source: {
          naturaContabile: ["deteriorata", "scaduta", "rubata"].includes(
            input.causale,
          )
            ? "SCARTO"
            : "ALTRO",
          dominioOrigine: "MAGAZZINO",
          entitaOrigineTipo: "scarico",
          entitaOrigineId: scarico.id,
        },
      };

  const auditEventoId = input.audit
    ? await recordAuditEvent(tx, {
        command: input.audit,
        azione: "SCARICO_MAGAZZINO_CREATO",
        entitaTipo: "scarico",
        entitaId: scarico.id,
        documentoTipo: "scarico",
        documentoId: scarico.id,
        centroAscoltoIdSnapshot: input.centroAscoltoId,
        magazzinoIdSnapshot: input.magazzinoId,
        dataOperativa: input.dataScarico,
        motivo: input.causaleAltro ?? null,
        metadata: auditFields(
          {
            causale: input.causale,
            numeroRighe: input.righe.length,
            documentoRiferimento: input.documentoRiferimento,
          },
          ["causale", "numeroRighe", "documentoRiferimento"],
        ),
      })
    : null;
  if (input.audit) {
    movementInput.operatoreId = auditUserId(input.audit);
  }

  const productIds = [...new Set(input.righe.map((riga) => riga.prodottoId))];
  const products = await tx
    .select({
      id: prodottiTable.id,
      nome: prodottiTable.nome,
      quantitaFrazionabile: prodottiTable.quantitaFrazionabile,
    })
    .from(prodottiTable)
    .where(inArray(prodottiTable.id, productIds));
  if (products.length !== productIds.length) {
    throw new InventoryError("Uno o più Prodotti non esistono");
  }
  const productById = new Map(products.map((product) => [product.id, product]));
  const normalizedQuantities = new Map<number, string>();
  input.righe.forEach((riga, index) => {
    const product = productById.get(riga.prodottoId)!;
    try {
      normalizedQuantities.set(
        index,
        validateProductOperationalQuantity({
          quantita: riga.quantita,
          quantitaFrazionabile: product.quantitaFrazionabile,
          prodottoLabel: product.nome,
        }).toDb(),
      );
    } catch (error) {
      if (error instanceof ProductOperationalQuantityError) {
        throw new InventoryError(error.message, 400);
      }
      throw error;
    }
  });

  await tx.insert(scaricoRigheTable).values(
    input.righe.map((riga, index) => ({
      scaricoId: scarico.id,
      prodottoId: riga.prodottoId,
      quantita: normalizedQuantities.get(index)!,
      unitaMisura: riga.unitaMisura,
      note: riga.note ?? null,
    })),
  );
  for (const riga of input.righe) {
    if (riga.lottoId != null) {
      await scaricaRigaLottoEsatto(
        tx,
        movementInput,
        riga,
        operationId,
        auditEventoId,
      );
    } else {
      await scaricaRigaFefo(
        tx,
        movementInput,
        riga,
        operationId,
        auditEventoId,
      );
    }
  }
  if (movementInput.source?.naturaContabile === "DISTRIBUZIONE_FINALE") {
    await reconcileDistributionOperationState(tx, operationId);
  }
  return scarico.id;
}

/**
 * Compensa, senza cancellarli, tutti i movimenti di uno scarico identificato
 * dal documento di riferimento. Il ripristino dei Lotti e le rettifiche
 * append-only restano atomici nel ledger condiviso.
 */
export async function stornaScaricoInventariale(
  tx: InventoryTransaction,
  input: StornoScaricoInventarialeInput,
): Promise<number> {
  const movements = await tx
    .select()
    .from(movimentiTable)
    .where(
      and(
        eq(movimentiTable.documentoRiferimento, input.documentoRiferimento),
        eq(movimentiTable.tipoMovimento, "scarico"),
      ),
    )
    .for("update");
  if (!movements.length) {
    throw new InventoryError(
      "Movimenti inventariali dello scarico non trovati",
    );
  }
  const auditEventoId = input.audit
    ? await recordAuditEvent(tx, {
        command: input.audit,
        azione: "SCARICO_MAGAZZINO_STORNATO",
        entitaTipo: "movimento",
        entitaId: movements[0].id,
        documentoTipo: "scarico",
        magazzinoIdSnapshot: movements[0].magazzinoId,
        dataOperativa: input.dataMovimento,
        motivo: input.note,
        metadata: auditFields(
          { documentoRiferimento: input.documentoRiferimento },
          ["documentoRiferimento"],
        ),
      })
    : null;
  const operatoreId = input.audit
    ? auditUserId(input.audit)
    : input.operatoreId;
  for (const movement of movements) {
    if (movement.lottoId == null) {
      throw new InventoryError("Movimento senza Lotto non stornabile");
    }
    const [lotto] = await tx
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, movement.lottoId))
      .for("update");
    if (!lotto) throw new InventoryError("Lotto storico non disponibile");
    const [alreadyReversed] = await tx
      .select({ id: movimentiTable.id })
      .from(movimentiTable)
      .where(eq(movimentiTable.movimentoOrigineId, movement.id));
    if (alreadyReversed) {
      if (input.rejectAlreadyReversed) {
        throw new InventoryError("Lo scarico e gia stato stornato");
      }
      continue;
    }
    const quantity = InventoryDecimal.parse(movement.quantita);
    await tx
      .update(lottiTable)
      .set({
        quantitaResidua: InventoryDecimal.parse(lotto.quantitaResidua)
          .add(quantity)
          .toDb(),
      })
      .where(eq(lottiTable.id, lotto.id));
    await tx.insert(movimentiTable).values({
      tipoMovimento: "rettifica_positiva",
      tipoDettaglio: input.tipoDettaglio,
      dataMovimento: input.dataMovimento,
      magazzinoId: movement.magazzinoId,
      prodottoId: movement.prodottoId,
      lottoId: movement.lottoId,
      quantita: quantity.toDb(),
      quantitaPezzi: movement.quantitaPezzi,
      quantitaKgLt: movement.quantitaKgLt,
      fattoreKgLtPezzo: movement.fattoreKgLtPezzo,
      unitaMisura: movement.unitaMisura,
      movimentoOrigineId: movement.id,
      fondoOrigine: movement.fondoOrigine,
      naturaContabile: "STORNO",
      dominioOrigine: movement.dominioOrigine,
      entitaOrigineTipo: movement.entitaOrigineTipo,
      entitaOrigineId: movement.entitaOrigineId,
      rigaOrigineId: movement.rigaOrigineId,
      operazioneDistribuzioneId: movement.operazioneDistribuzioneId,
      canaleOperativo: movement.canaleOperativo,
      operatoreId,
      auditEventoId,
      documentoRiferimento: input.documentoRiferimento,
      note: input.note,
    });
    await markDistributionOperationReversed(
      tx,
      movement.operazioneDistribuzioneId,
    );
  }
  return movements.length;
}
