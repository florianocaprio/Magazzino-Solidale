import { db, trasferimentiTable, trasferimentoRigheTable } from "@workspace/db";
import { withDocumentCodeRetry } from "./documentCode";

export interface TransferRequestRow {
  prodottoId: number;
  lottoId?: number | null;
  quantita: number;
  unitaMisura: string;
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
        input.righe.map((row) => ({
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
