import {
  db,
  prodottiTable,
  trasferimentiTable,
  trasferimentoRigheTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { withDocumentCodeRetry } from "./documentCode";

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
  quantita: number;
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

/**
 * Unico punto di persistenza di una richiesta di trasferimento. Le route
 * generiche e Mensa mantengono soltanto RBAC/scope e validazione dell'origine.
 * Spedizione FEFO e ricezione restano nel medesimo workflow /trasferimenti.
 */
export async function createTransferRequest(input: TransferRequestInput) {
  return withDocumentCodeRetry("TRASM", (codice) =>
    db.transaction(async (tx) => {
      const productIds = [...new Set(input.righe.map((row) => row.prodottoId))];
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
      const productById = new Map(
        products.map((product) => [product.id, product]),
      );
      const normalizedRows = input.righe.map((row) => {
        const product = productById.get(row.prodottoId)!;
        if (!product.attivo) {
          throw new TransferRequestError(400, "Il Prodotto non è attivo");
        }
        if (
          row.unitaMisura != null &&
          row.unitaMisura.trim() !== product.unitaMisura
        ) {
          throw new TransferRequestError(
            400,
            `L'unità di misura del Prodotto ${row.prodottoId} deve essere ${product.unitaMisura}`,
          );
        }
        return { ...row, unitaMisura: product.unitaMisura };
      });
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
          quantita: row.quantita.toFixed(2),
          unitaMisura: row.unitaMisura,
          note: row.note ?? null,
        })),
      );
      await input.afterCreate?.(tx, created);
      return created;
    }),
  );
}
