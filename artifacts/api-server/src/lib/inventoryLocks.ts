import { db, lottiTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";

type InventoryLockTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/** Acquisisce i lock delle partite in ordine globale prodotto/lotto logico/id. */
export async function lockInventoryLotsInGlobalOrder(
  tx: InventoryLockTransaction,
  input:
    | {
        kind: "warehouse-products";
        magazzinoId: number;
        prodottoIds: number[];
      }
    | { kind: "lot-ids"; lottoIds: number[] },
): Promise<void> {
  const ids = [
    ...new Set(
      input.kind === "warehouse-products" ? input.prodottoIds : input.lottoIds,
    ),
  ]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .sort((a, b) => a - b);
  if (ids.length === 0) return;

  const condition =
    input.kind === "warehouse-products"
      ? and(
          eq(lottiTable.magazzinoId, input.magazzinoId),
          inArray(lottiTable.prodottoId, ids),
        )
      : inArray(lottiTable.id, ids);

  await tx
    .select({ id: lottiTable.id })
    .from(lottiTable)
    .where(condition)
    .orderBy(
      asc(lottiTable.prodottoId),
      asc(lottiTable.lottoLogicoId),
      asc(lottiTable.id),
    )
    .for("update");
}
