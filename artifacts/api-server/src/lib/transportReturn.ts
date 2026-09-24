import {
  lottiTable,
  movimentiTable,
  prodottiTable,
  rientriTrasportoTable,
  rientroTrasportoRigheTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";
import { creaScaricoInventariale } from "./scaricoInventory";
import { InventoryDecimal, InventoryDecimalError } from "./inventoryDecimal";
import {
  ProductOperationalQuantityError,
  validateProductOperationalQuantity,
} from "./productQuantity";
import { lockInventoryLotsInGlobalOrder } from "./inventoryLocks";
import { resolveInventoryQuantityDimensions } from "./inventoryQuantityDimensions";
import {
  auditFields,
  auditUserId,
  recordAuditEvent,
  type AuditCommandContext,
} from "./auditEvent";

export type ReturnOwner = {
  tipo: "bolla" | "trasferimento";
  id: number;
  magazzinoOrigineId: number;
  numeroDocumento: string;
  areaOperativaIdSnapshot?: number | null;
  centroAscoltoIdSnapshot?: number | null;
};

export const RETURN_OUTCOMES = [
  "idonea",
  "deteriorata",
  "scaduta",
  "mancante",
  "rubata",
] as const;
export type ReturnOutcome = (typeof RETURN_OUTCOMES)[number];
export type ReturnLineInput = {
  movimentoUscitaId: number;
  idonea?: string | number;
  deteriorata?: string | number;
  scaduta?: string | number;
  mancante?: string | number;
  rubata?: string | number;
  nota?: string | null;
};

export class TransportReturnError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** The frozen outbound ledger, not document rows or a new FEFO selection. */
export async function loadTransportOutbound(
  tx: InventoryTransaction,
  owner: ReturnOwner,
) {
  const condition =
    owner.tipo === "bolla"
      ? and(
          eq(movimentiTable.bollaId, owner.id),
          eq(movimentiTable.tipoMovimento, "scarico"),
          eq(movimentiTable.tipoDettaglio, "affidamento_trasporto"),
        )
      : and(
          eq(movimentiTable.trasferimentoId, owner.id),
          eq(movimentiTable.tipoMovimento, "trasferimento"),
          eq(movimentiTable.tipoDettaglio, "uscita"),
        );
  return tx
    .select({
      movement: movimentiTable,
      lot: lottiTable,
      product: prodottiTable,
    })
    .from(movimentiTable)
    .innerJoin(lottiTable, eq(movimentiTable.lottoId, lottiTable.id))
    .innerJoin(prodottiTable, eq(movimentiTable.prodottoId, prodottiTable.id))
    .where(condition)
    .orderBy(asc(movimentiTable.id));
}

/** Read-only document projection; anomaly lines are the automatic zero-effect documents. */
export async function loadTransportReturnDetail(
  tx: InventoryTransaction,
  owner: ReturnOwner,
  stato: string,
) {
  const [outbound, [returnDocument]] = await Promise.all([
    loadTransportOutbound(tx, owner),
    tx
      .select()
      .from(rientriTrasportoTable)
      .where(
        owner.tipo === "bolla"
          ? eq(rientriTrasportoTable.bollaId, owner.id)
          : eq(rientriTrasportoTable.trasferimentoId, owner.id),
      ),
  ]);
  const returnLines = returnDocument
    ? await tx
        .select()
        .from(rientroTrasportoRigheTable)
        .where(eq(rientroTrasportoRigheTable.rientroId, returnDocument.id))
        .orderBy(asc(rientroTrasportoRigheTable.id))
    : [];
  return {
    id: owner.id,
    stato,
    magazzinoOrigineId: owner.magazzinoOrigineId,
    rientroId: returnDocument?.id ?? null,
    dataRientro: returnDocument?.dataRientro ?? null,
    partite: outbound.map(({ movement, lot, product }) => ({
      movimentoUscitaId: movement.id,
      prodottoId: product.id,
      prodottoNome: product.nome,
      lottoId: lot.id,
      codiceLotto: lot.codiceLotto,
      quantitaUscita: movement.quantita,
      unitaMisura: movement.unitaMisura,
      quantitaFrazionabile: product.quantitaFrazionabile,
    })),
    documenti: returnLines.map((line) => ({
      tipo: line.tipoEsito,
      movimentoUscitaId: line.movimentoUscitaId,
      prodottoId: line.prodottoId,
      lottoId: line.lottoId,
      quantita: line.quantita,
      scaricoId: line.scaricoId,
      nota: line.nota,
    })),
  };
}

function normalizedLines(
  input: ReturnLineInput[],
  outbound: Awaited<ReturnType<typeof loadTransportOutbound>>,
) {
  const byMovement = new Map(outbound.map((item) => [item.movement.id, item]));
  if (byMovement.size === 0 || input.length !== byMovement.size) {
    throw new TransportReturnError(
      409,
      "La riconciliazione deve comprendere tutte le partite realmente uscite",
    );
  }
  const seen = new Set<number>();
  const result: Array<{
    source: (typeof outbound)[number];
    outcomes: Array<{ tipoEsito: ReturnOutcome; quantita: InventoryDecimal }>;
    nota: string | null;
  }> = [];
  for (const line of input) {
    if (
      line == null ||
      typeof line !== "object" ||
      !Number.isSafeInteger(line.movimentoUscitaId)
    ) {
      throw new TransportReturnError(400, "Riga di rientro non valida");
    }
    if (
      Object.keys(line).some(
        (key) =>
          !["movimentoUscitaId", ...RETURN_OUTCOMES, "nota"].includes(key),
      )
    ) {
      throw new TransportReturnError(
        400,
        "Classificazione del rientro non ammessa",
      );
    }
    const source = byMovement.get(line.movimentoUscitaId);
    if (!source || seen.has(line.movimentoUscitaId)) {
      throw new TransportReturnError(
        409,
        "Movimento di uscita estraneo o duplicato",
      );
    }
    seen.add(line.movimentoUscitaId);
    let total = InventoryDecimal.zero();
    const outcomes: Array<{
      tipoEsito: ReturnOutcome;
      quantita: InventoryDecimal;
    }> = [];
    for (const tipoEsito of RETURN_OUTCOMES) {
      const raw = line[tipoEsito] ?? "0";
      let quantity: InventoryDecimal;
      try {
        quantity = InventoryDecimal.parse(raw);
        if (!quantity.isZero()) {
          quantity = validateProductOperationalQuantity({
            quantita: quantity.toDb(),
            quantitaFrazionabile: source.product.quantitaFrazionabile,
            prodottoLabel: source.product.nome,
          });
        }
      } catch (error) {
        if (
          error instanceof InventoryDecimalError ||
          error instanceof ProductOperationalQuantityError
        ) {
          throw new TransportReturnError(400, error.message);
        }
        throw error;
      }
      total = total.add(quantity);
      if (quantity.isPositive())
        outcomes.push({ tipoEsito, quantita: quantity });
    }
    if (total.compare(InventoryDecimal.parse(source.movement.quantita)) !== 0) {
      throw new TransportReturnError(
        409,
        `La partita #${source.movement.id} non è riconciliata integralmente`,
      );
    }
    if (line.nota != null && typeof line.nota !== "string") {
      throw new TransportReturnError(400, "La nota deve essere testuale");
    }
    result.push({
      source,
      outcomes,
      nota: line.nota?.trim().slice(0, 500) ?? null,
    });
  }
  return result.sort((a, b) => a.source.movement.id - b.source.movement.id);
}

/** Called inside the document/receipt transaction after locked scope validation. */
export async function reconcileTransportReturnTx(
  tx: InventoryTransaction,
  input: {
    owner: ReturnOwner;
    dataRientro: string;
    note?: string | null;
    lines: ReturnLineInput[];
    audit: AuditCommandContext;
  },
) {
  if (
    input.note != null &&
    (typeof input.note !== "string" || input.note.length > 1000)
  ) {
    throw new TransportReturnError(400, "La nota del rientro non è valida");
  }
  const outbound = await loadTransportOutbound(tx, input.owner);
  if (
    outbound.some(
      (item) => item.movement.magazzinoId !== input.owner.magazzinoOrigineId,
    )
  ) {
    throw new TransportReturnError(
      409,
      "Le partite uscite non appartengono al Magazzino origine",
    );
  }
  const lines = normalizedLines(input.lines, outbound);
  await lockInventoryLotsInGlobalOrder(tx, {
    kind: "lot-ids",
    lottoIds: outbound.map((item) => item.lot.id),
  });
  const actorId = auditUserId(input.audit);
  const auditEventoId = await recordAuditEvent(tx, {
    command: input.audit,
    azione: "RIENTRO_TRASPORTO_REGISTRATO",
    entitaTipo: input.owner.tipo,
    entitaId: input.owner.id,
    documentoTipo: input.owner.tipo,
    documentoId: input.owner.id,
    areaOperativaIdSnapshot: input.owner.areaOperativaIdSnapshot ?? null,
    centroAscoltoIdSnapshot: input.owner.centroAscoltoIdSnapshot ?? null,
    magazzinoIdSnapshot: input.owner.magazzinoOrigineId,
    dataOperativa: input.dataRientro,
    metadata: auditFields({ numeroPartite: lines.length }, ["numeroPartite"]),
  });
  const [returnDocument] = await tx
    .insert(rientriTrasportoTable)
    .values({
      bollaId: input.owner.tipo === "bolla" ? input.owner.id : null,
      trasferimentoId:
        input.owner.tipo === "trasferimento" ? input.owner.id : null,
      magazzinoOrigineId: input.owner.magazzinoOrigineId,
      dataRientro: input.dataRientro,
      note: input.note?.trim().slice(0, 1000) ?? null,
      createdBy: actorId,
    })
    .returning();

  for (const line of lines) {
    const { movement, lot } = line.source;
    for (const outcome of line.outcomes) {
      const physical =
        outcome.tipoEsito === "idonea" ||
        outcome.tipoEsito === "deteriorata" ||
        outcome.tipoEsito === "scaduta";
      const [returnLine] = await tx
        .insert(rientroTrasportoRigheTable)
        .values({
          rientroId: returnDocument.id,
          bollaId: input.owner.tipo === "bolla" ? input.owner.id : null,
          trasferimentoId:
            input.owner.tipo === "trasferimento" ? input.owner.id : null,
          movimentoUscitaId: movement.id,
          prodottoId: movement.prodottoId,
          lottoId: lot.id,
          tipoEsito: outcome.tipoEsito,
          quantita: outcome.quantita.toDb(),
          nota: line.nota,
        })
        .returning();
      const dimensions = resolveInventoryQuantityDimensions({
        quantitaOperativa: outcome.quantita.toDb(),
        unitaMisura: movement.unitaMisura,
        fattorePartita: movement.fattoreKgLtPezzo ?? lot.fattoreKgLtPezzo,
      });
      if (physical) {
        const [currentLot] = await tx
          .select()
          .from(lottiTable)
          .where(eq(lottiTable.id, lot.id))
          .for("update");
        if (
          !currentLot ||
          currentLot.magazzinoId !== input.owner.magazzinoOrigineId
        ) {
          throw new TransportReturnError(
            409,
            "Lotto fisico originario non disponibile",
          );
        }
        await tx
          .update(lottiTable)
          .set({
            quantitaResidua: InventoryDecimal.parse(currentLot.quantitaResidua)
              .add(outcome.quantita)
              .toDb(),
          })
          .where(eq(lottiTable.id, lot.id));
        const [returnMovement] = await tx
          .insert(movimentiTable)
          .values({
            tipoMovimento: "rientro",
            tipoDettaglio: "rientro_trasporto",
            dataMovimento: input.dataRientro,
            magazzinoId: input.owner.magazzinoOrigineId,
            prodottoId: movement.prodottoId,
            lottoId: lot.id,
            quantita: outcome.quantita.toDb(),
            quantitaPezzi: dimensions.quantitaPezzi,
            quantitaKgLt: dimensions.quantitaKgLt,
            fattoreKgLtPezzo: dimensions.fattoreKgLtPezzo,
            unitaMisura: movement.unitaMisura,
            fornitoreId: movement.fornitoreId,
            beneficiarioId: movement.beneficiarioId,
            bollaId: movement.bollaId,
            bollaRigaId: movement.bollaRigaId,
            trasferimentoId: movement.trasferimentoId,
            movimentoOrigineId: movement.id,
            fondoOrigine: movement.fondoOrigine,
            naturaContabile: "RIENTRO_TRASPORTO",
            dominioOrigine: "RIENTRO_TRASPORTO",
            entitaOrigineTipo: "rientro_trasporto",
            entitaOrigineId: returnDocument.id,
            rigaOrigineId: returnLine.id,
            operatoreId: actorId,
            auditEventoId,
            documentoRiferimento: input.owner.numeroDocumento,
          })
          .returning({ id: movimentiTable.id });
        let scaricoId: number | null = null;
        if (
          outcome.tipoEsito === "deteriorata" ||
          outcome.tipoEsito === "scaduta"
        ) {
          scaricoId = await creaScaricoInventariale(tx, {
            codice: `RT-${returnDocument.id}-${returnLine.id}`,
            magazzinoId: input.owner.magazzinoOrigineId,
            centroAscoltoId: input.owner.centroAscoltoIdSnapshot ?? null,
            dataScarico: input.dataRientro,
            causale: outcome.tipoEsito,
            note: `Documento automatico — merce ${outcome.tipoEsito} da rientro #${returnDocument.id}`,
            operatoreId: actorId,
            audit: {
              ...input.audit,
              operationKey: `${input.audit.operationKey ?? input.audit.correlationId}:scarico:${returnLine.id}`,
            },
            documentoRiferimento: input.owner.numeroDocumento,
            source: {
              naturaContabile: "SCARTO",
              dominioOrigine: "RIENTRO_TRASPORTO",
              entitaOrigineTipo: "rientro_trasporto",
              entitaOrigineId: returnDocument.id,
              movimentoOrigineId: returnMovement.id,
            },
            righe: [
              {
                prodottoId: movement.prodottoId,
                lottoId: lot.id,
                quantita: outcome.quantita.toDb(),
                unitaMisura: movement.unitaMisura,
                rigaOrigineId: returnLine.id,
              },
            ],
          });
        }
        await tx
          .update(rientroTrasportoRigheTable)
          .set({
            movimentoRientroId: returnMovement.id,
            scaricoId,
          })
          .where(eq(rientroTrasportoRigheTable.id, returnLine.id));
      } else {
        const [event] = await tx
          .insert(movimentiTable)
          .values({
            tipoMovimento: "esito",
            tipoDettaglio:
              outcome.tipoEsito === "mancante"
                ? "merce_mancante"
                : "merce_rubata",
            dataMovimento: input.dataRientro,
            magazzinoId: input.owner.magazzinoOrigineId,
            prodottoId: movement.prodottoId,
            lottoId: lot.id,
            quantita: outcome.quantita.toDb(),
            quantitaPezzi: dimensions.quantitaPezzi,
            quantitaKgLt: dimensions.quantitaKgLt,
            fattoreKgLtPezzo: dimensions.fattoreKgLtPezzo,
            unitaMisura: movement.unitaMisura,
            fornitoreId: movement.fornitoreId,
            beneficiarioId: movement.beneficiarioId,
            bollaId: movement.bollaId,
            bollaRigaId: movement.bollaRigaId,
            trasferimentoId: movement.trasferimentoId,
            movimentoOrigineId: movement.id,
            fondoOrigine: movement.fondoOrigine,
            naturaContabile:
              outcome.tipoEsito === "mancante"
                ? "SMARRIMENTO_TRASPORTO"
                : "FURTO_TRASPORTO",
            dominioOrigine: "RIENTRO_TRASPORTO",
            entitaOrigineTipo: "rientro_trasporto",
            entitaOrigineId: returnDocument.id,
            rigaOrigineId: returnLine.id,
            operatoreId: actorId,
            auditEventoId,
            documentoRiferimento: input.owner.numeroDocumento,
            note: line.nota,
          })
          .returning({ id: movimentiTable.id });
        await tx
          .update(rientroTrasportoRigheTable)
          .set({ movimentoEsitoId: event.id })
          .where(eq(rientroTrasportoRigheTable.id, returnLine.id));
      }
    }
  }
  return returnDocument;
}
