import {
  db,
  prodottiTable,
  trasferimentiTable,
  trasferimentoRigheTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { withDocumentCodeRetry } from "./documentCode";
import {
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "./inventoryDecimal";

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
  mensaId?: number | null;
  idempotencyKey?: string | null;
  righe: TransferRequestRow[];
  afterCreate?: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    created: typeof trasferimentiTable.$inferSelect,
  ) => Promise<void>;
}

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
      quantity = positiveInventoryDecimal(row.quantita);
    } catch (error) {
      if (!(error instanceof InventoryDecimalError)) throw error;
      throw new TransferRequestError(400, error.message);
    }
    const product = productById.get(row.prodottoId)!;
    if (!product.attivo) {
      throw new TransferRequestError(400, "Il Prodotto non è attivo");
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
export async function createTransferRequest(input: TransferRequestInput) {
  return withDocumentCodeRetry("TRASM", (codice) =>
    db.transaction(async (tx) => {
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
          operatoreId: input.operatoreId,
          mensaId: input.mensaId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .returning();
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
      return created;
    }),
  );
}
