import {
  lottiLogiciTable,
  magazziniTable,
  type LottoLogico,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";

export class LogicalLotError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function ensureGeneralLogicalLot(
  tx: InventoryTransaction,
  input: { areaOperativaId: number; creatoDa?: number | null },
): Promise<LottoLogico> {
  await tx
    .insert(lottiLogiciTable)
    .values({
      areaOperativaId: input.areaOperativaId,
      codice: "GENERALE",
      descrizione: "Generale",
      stato: "aperto",
      isGenerale: true,
      creatoDa: input.creatoDa ?? null,
      aggiornatoDa: input.creatoDa ?? null,
    })
    .onConflictDoNothing();
  const [logicalLot] = await tx
    .select()
    .from(lottiLogiciTable)
    .where(
      and(
        eq(lottiLogiciTable.areaOperativaId, input.areaOperativaId),
        eq(lottiLogiciTable.isGenerale, true),
      ),
    )
    .for("update");
  if (!logicalLot) {
    throw new LogicalLotError(
      500,
      "Lotto logico Generale non disponibile per l'Area",
    );
  }
  return logicalLot;
}

export async function resolveOpenLogicalLotForWarehouse(
  tx: InventoryTransaction,
  input: { magazzinoId: number; lottoLogicoId?: number | null },
): Promise<{
  magazzino: typeof magazziniTable.$inferSelect;
  lotto: LottoLogico;
}> {
  const [magazzino] = await tx
    .select()
    .from(magazziniTable)
    .where(eq(magazziniTable.id, input.magazzinoId));
  if (!magazzino) throw new LogicalLotError(404, "Magazzino non trovato");
  if (magazzino.areaOperativaId == null) {
    throw new LogicalLotError(
      409,
      "Il Magazzino deve appartenere a un'Area Operativa per usare i lotti logici",
    );
  }

  const [logicalLot] = await tx
    .select()
    .from(lottiLogiciTable)
    .where(
      input.lottoLogicoId == null
        ? and(
            eq(lottiLogiciTable.areaOperativaId, magazzino.areaOperativaId),
            eq(lottiLogiciTable.isGenerale, true),
          )
        : eq(lottiLogiciTable.id, input.lottoLogicoId),
    );
  if (!logicalLot) throw new LogicalLotError(404, "Lotto logico non trovato");
  if (logicalLot.areaOperativaId !== magazzino.areaOperativaId) {
    throw new LogicalLotError(
      403,
      "Il Lotto logico non appartiene all'Area del Magazzino",
    );
  }
  if (logicalLot.stato !== "aperto") {
    throw new LogicalLotError(
      409,
      "Il Lotto logico non è aperto a nuove operazioni",
    );
  }
  return { magazzino, lotto: logicalLot };
}
