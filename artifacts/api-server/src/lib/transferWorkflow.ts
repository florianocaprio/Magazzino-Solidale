import {
  db,
  prodottiTable,
  trasferimentiTable,
  trasferimentoRigheTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { withDocumentCodeRetry } from "./documentCode";
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
import {
  loadDocumentCommand,
  lockDocumentCommand,
  storeDocumentCommand,
  validateDocumentCommand,
} from "./documentCommand";
import { requireOperationalMagazzino } from "./inventoryLedger";

export class TransferRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface TransferRequestRow {
  prodottoId: number;
  lottoId?: number | null;
  quantita: string | number;
  /** Valore legacy opzionale: se presente deve coincidere con il Prodotto. */
  unitaMisura?: string | null;
  note?: string | null;
}

export interface TransferRequestInput {
  magazzinoOrigineId: number;
  magazzinoDestinoId: number;
  dataRichiesta: string;
  trasportatoreVolontarioId?: number | null;
  trasportatoreNome?: string | null;
  note?: string | null;
  operatoreId: number;
  audit?: AuditCommandContext;
  mensaId?: number | null;
  idempotencyKey?: string | null;
  command?: {
    idempotencyKey: string;
    requestHash: string;
    actorUserId: number;
  };
  righe: TransferRequestRow[];
  authorizeCurrent?: (
    tx: TransferTransaction,
    transfer: typeof trasferimentiTable.$inferSelect,
  ) => Promise<void>;
  beforeCreate?: (tx: TransferTransaction) => Promise<void>;
  afterCreate?: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    created: typeof trasferimentiTable.$inferSelect,
  ) => Promise<void>;
}

export type TransferRequestResult = typeof trasferimentiTable.$inferSelect & {
  idempotentReplay: boolean;
};

type TransferTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function normalizeTransferRows(
  tx: TransferTransaction,
  rows: TransferRequestRow[],
) {
  if (
    rows.length === 0 ||
    rows.some(
      (row) =>
        !Number.isSafeInteger(row.prodottoId) ||
        row.prodottoId <= 0 ||
        (row.lottoId != null &&
          (!Number.isSafeInteger(row.lottoId) || row.lottoId <= 0)) ||
        (row.unitaMisura != null && typeof row.unitaMisura !== "string"),
    )
  ) {
    throw new TransferRequestError(
      400,
      "Indicare righe con Prodotto, quantità e unità di misura valide",
    );
  }
  const productIds = [...new Set(rows.map((row) => row.prodottoId))];
  const products = await tx
    .select({
      id: prodottiTable.id,
      unitaMisura: prodottiTable.unitaMisura,
      attivo: prodottiTable.attivo,
      quantitaFrazionabile: prodottiTable.quantitaFrazionabile,
      lottoFisicoObbligatorio: prodottiTable.lottoFisicoObbligatorio,
      nome: prodottiTable.nome,
    })
    .from(prodottiTable)
    .where(inArray(prodottiTable.id, productIds));
  if (products.length !== productIds.length) {
    throw new TransferRequestError(
      400,
      "Una o più righe indicano un Prodotto inesistente",
    );
  }
  const productById = new Map(products.map((product) => [product.id, product]));
  return rows.map((row) => {
    let quantity;
    try {
      const product = productById.get(row.prodottoId)!;
      quantity = validateProductOperationalQuantity({
        quantita: row.quantita,
        quantitaFrazionabile: product.quantitaFrazionabile,
        prodottoLabel: product.nome,
      });
    } catch (error) {
      if (!(error instanceof ProductOperationalQuantityError)) throw error;
      throw new TransferRequestError(400, error.message);
    }
    const product = productById.get(row.prodottoId)!;
    if (!product.attivo) {
      throw new TransferRequestError(400, "Il Prodotto non è attivo");
    }
    if (product.lottoFisicoObbligatorio && row.lottoId == null) {
      throw new TransferRequestError(
        400,
        "Il lotto fisico è obbligatorio per questo Prodotto",
      );
    }
    if (row.unitaMisura != null) {
      if (
        typeof row.unitaMisura !== "string" ||
        row.unitaMisura.trim() !== product.unitaMisura
      ) {
        throw new TransferRequestError(
          400,
          `L'unità di misura del Prodotto ${row.prodottoId} deve essere ${product.unitaMisura}`,
        );
      }
    }
    return {
      ...row,
      quantita: quantity.toDb(),
      unitaMisura: product.unitaMisura,
    };
  });
}

/**
 * Unico punto di persistenza di una richiesta di trasferimento. Le route
 * generiche e Mensa mantengono soltanto RBAC/scope e validazione dell'origine.
 * Spedizione FEFO e ricezione restano nel medesimo workflow /trasferimenti.
 */
export async function createTransferRequest(
  input: TransferRequestInput,
): Promise<TransferRequestResult> {
  return withDocumentCodeRetry("TRASM", (codice) =>
    db.transaction(async (tx) => {
      if (input.command) {
        await lockDocumentCommand(
          tx,
          "trasferimento.create",
          input.command.idempotencyKey,
        );
        const receipt = await loadDocumentCommand(tx, {
          tipoComando: "trasferimento.create",
          idempotencyKey: input.command.idempotencyKey,
        });
        if (receipt) {
          const [existing] = await tx
            .select()
            .from(trasferimentiTable)
            .where(eq(trasferimentiTable.id, receipt.aggregatoId))
            .for("update");
          if (!existing) {
            throw new TransferRequestError(
              409,
              "La ricevuta idempotente non corrisponde più al Trasferimento",
            );
          }
          await input.authorizeCurrent?.(tx, existing);
          validateDocumentCommand(receipt, {
            tipoComando: "trasferimento.create",
            idempotencyKey: input.command.idempotencyKey,
            requestHash: input.command.requestHash,
            actorUserId: input.command.actorUserId,
            aggregatoTipo: "trasferimento",
          });
          return { ...existing, idempotentReplay: true };
        }
        await requireOperationalMagazzino(tx, input.magazzinoOrigineId);
        await requireOperationalMagazzino(tx, input.magazzinoDestinoId);
      }
      await input.beforeCreate?.(tx);
      const normalizedRows = await normalizeTransferRows(tx, input.righe);
      const [created] = await tx
        .insert(trasferimentiTable)
        .values({
          codice,
          magazzinoOrigineId: input.magazzinoOrigineId,
          magazzinoDestinoId: input.magazzinoDestinoId,
          dataRichiesta: input.dataRichiesta,
          trasportatoreVolontarioId: input.trasportatoreVolontarioId ?? null,
          trasportatoreNome: input.trasportatoreNome ?? null,
          note: input.note ?? null,
          operatoreId: input.audit
            ? auditUserId(input.audit)
            : input.operatoreId,
          mensaId: input.mensaId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .returning();
      if (input.audit) {
        await recordAuditEvent(tx, {
          command: input.audit,
          azione: "TRASFERIMENTO_CREATO",
          entitaTipo: "trasferimento",
          entitaId: created.id,
          documentoTipo: "trasferimento",
          documentoId: created.id,
          magazzinoIdSnapshot: created.magazzinoOrigineId,
          dataOperativa: created.dataRichiesta,
          changes: auditFields({ statoNuovo: created.stato }, ["statoNuovo"]),
          metadata: auditFields(
            {
              magazzinoOrigineId: created.magazzinoOrigineId,
              magazzinoDestinoId: created.magazzinoDestinoId,
              numeroRighe: normalizedRows.length,
            },
            ["magazzinoOrigineId", "magazzinoDestinoId", "numeroRighe"],
          ),
        });
      }
      await tx.insert(trasferimentoRigheTable).values(
        normalizedRows.map((row) => ({
          trasferimentoId: created.id,
          prodottoId: row.prodottoId,
          lottoId: row.lottoId ?? null,
          quantita: row.quantita,
          unitaMisura: row.unitaMisura,
          note: row.note ?? null,
        })),
      );
      await input.afterCreate?.(tx, created);
      if (input.command) {
        await storeDocumentCommand(tx, {
          tipoComando: "trasferimento.create",
          idempotencyKey: input.command.idempotencyKey,
          requestHash: input.command.requestHash,
          aggregatoTipo: "trasferimento",
          aggregatoId: created.id,
          versioneRisultante: created.versione,
          resultSnapshot: {
            id: created.id,
            codice: created.codice,
            stato: created.stato,
            versione: created.versione,
          },
          actorUserId: input.command.actorUserId,
        });
      }
      return { ...created, idempotentReplay: false };
    }),
  );
}
