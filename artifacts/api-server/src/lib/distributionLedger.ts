import {
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  type CanaleOperativo,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";
import { InventoryDecimal } from "./inventoryDecimal";

export interface DistributionOperationInput {
  magazzinoId: number;
  dataDistribuzione: string;
  canaleOperativo: CanaleOperativo;
  dominioOrigine: string;
  entitaOrigineTipo: string;
  entitaOrigineId: number;
  areaOperativaIdSnapshot?: number | null;
  centroAscoltoIdSnapshot?: number | null;
  territorioClassificazione?: "attribuito" | "universale" | "legacy_sconosciuto";
  numeroDocumento?: string | null;
  numeroPacchi?: number | null;
  numeroPasti?: number | null;
  indigentiSaltuari?: number | null;
  indigentiContinuativi?: number | null;
  creatoDa: number;
}

export class DistributionLedgerError extends Error {
  readonly status = 409;
}

export async function ensureDistributionOperation(
  tx: InventoryTransaction,
  input: DistributionOperationInput,
) {
  const sourceKey = `${input.dominioOrigine}:${input.entitaOrigineTipo}:${input.entitaOrigineId}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`distribution:${sourceKey}`}, 0))`,
  );
  const [existing] = await tx
    .select()
    .from(operazioniDistribuzioneMagazzinoTable)
    .where(
      and(
        eq(
          operazioniDistribuzioneMagazzinoTable.dominioOrigine,
          input.dominioOrigine,
        ),
        eq(
          operazioniDistribuzioneMagazzinoTable.entitaOrigineTipo,
          input.entitaOrigineTipo,
        ),
        eq(
          operazioniDistribuzioneMagazzinoTable.entitaOrigineId,
          input.entitaOrigineId,
        ),
      ),
    )
    .for("update");
  if (existing) {
    if (
      existing.magazzinoId !== input.magazzinoId ||
      existing.dataDistribuzione !== input.dataDistribuzione ||
      existing.canaleOperativo !== input.canaleOperativo ||
      (input.areaOperativaIdSnapshot !== undefined &&
        existing.areaOperativaIdSnapshot !== input.areaOperativaIdSnapshot) ||
      (input.centroAscoltoIdSnapshot !== undefined &&
        existing.centroAscoltoIdSnapshot !== input.centroAscoltoIdSnapshot) ||
      (input.territorioClassificazione !== undefined &&
        existing.territorioClassificazione !== input.territorioClassificazione)
    ) {
      throw new DistributionLedgerError(
        "La sorgente è già collegata a una diversa operazione di distribuzione",
      );
    }
    const requested = {
      numeroDocumento:
        input.numeroDocumento !== undefined
          ? input.numeroDocumento
          : existing.numeroDocumento,
      numeroPacchi:
        input.numeroPacchi !== undefined
          ? input.numeroPacchi
          : existing.numeroPacchi,
      numeroPasti:
        input.numeroPasti !== undefined
          ? input.numeroPasti
          : existing.numeroPasti,
      indigentiSaltuari:
        input.indigentiSaltuari !== undefined
          ? input.indigentiSaltuari
          : existing.indigentiSaltuari,
      indigentiContinuativi:
        input.indigentiContinuativi !== undefined
          ? input.indigentiContinuativi
          : existing.indigentiContinuativi,
    };
    const changed = Object.entries(requested).some(
      ([key, value]) => value !== existing[key as keyof typeof requested],
    );
    if (!changed) return existing;
    const [linkedMovement] = await tx
      .select({ id: movimentiTable.id })
      .from(movimentiTable)
      .where(eq(movimentiTable.operazioneDistribuzioneId, existing.id))
      .limit(1);
    if (linkedMovement) {
      throw new DistributionLedgerError(
        "OPERAZIONE_DISTRIBUZIONE_IMMUTABILE: esistono Movimenti collegati",
      );
    }
    const [updated] = await tx
      .update(operazioniDistribuzioneMagazzinoTable)
      .set(requested)
      .where(eq(operazioniDistribuzioneMagazzinoTable.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await tx
    .insert(operazioniDistribuzioneMagazzinoTable)
    .values({
      magazzinoId: input.magazzinoId,
      dataDistribuzione: input.dataDistribuzione,
      canaleOperativo: input.canaleOperativo,
      dominioOrigine: input.dominioOrigine,
      entitaOrigineTipo: input.entitaOrigineTipo,
      entitaOrigineId: input.entitaOrigineId,
      areaOperativaIdSnapshot: input.areaOperativaIdSnapshot ?? null,
      centroAscoltoIdSnapshot: input.centroAscoltoIdSnapshot ?? null,
      territorioClassificazione:
        input.territorioClassificazione ?? "legacy_sconosciuto",
      numeroDocumento: input.numeroDocumento ?? null,
      numeroPacchi: input.numeroPacchi ?? null,
      numeroPasti: input.numeroPasti ?? null,
      indigentiSaltuari: input.indigentiSaltuari ?? null,
      indigentiContinuativi: input.indigentiContinuativi ?? null,
      creatoDa: input.creatoDa,
    })
    .returning();
  return created;
}

export async function reconcileDistributionOperationState(
  tx: InventoryTransaction,
  operationId: number | null,
): Promise<void> {
  if (operationId == null) return;
  const [operation] = await tx
    .select()
    .from(operazioniDistribuzioneMagazzinoTable)
    .where(eq(operazioniDistribuzioneMagazzinoTable.id, operationId))
    .for("update");
  if (!operation) {
    throw new DistributionLedgerError(
      "Operazione di distribuzione non trovata",
    );
  }
  const originals = await tx
    .select({ id: movimentiTable.id, quantita: movimentiTable.quantita })
    .from(movimentiTable)
    .where(
      and(
        eq(movimentiTable.operazioneDistribuzioneId, operationId),
        eq(movimentiTable.naturaContabile, "DISTRIBUZIONE_FINALE"),
      ),
    )
    .for("update");
  if (originals.length === 0) {
    await tx
      .update(operazioniDistribuzioneMagazzinoTable)
      .set({ stato: "confermata" })
      .where(eq(operazioniDistribuzioneMagazzinoTable.id, operationId));
    return;
  }
  const reversals = await tx
    .select({
      movimentoOrigineId: movimentiTable.movimentoOrigineId,
      quantita: movimentiTable.quantita,
    })
    .from(movimentiTable)
    .where(
      and(
        eq(movimentiTable.naturaContabile, "STORNO"),
        inArray(
          movimentiTable.movimentoOrigineId,
          originals.map((movement) => movement.id),
        ),
      ),
    );
  const reversedByOriginal = new Map<number, InventoryDecimal>();
  for (const reversal of reversals) {
    if (reversal.movimentoOrigineId == null) continue;
    reversedByOriginal.set(
      reversal.movimentoOrigineId,
      (
        reversedByOriginal.get(reversal.movimentoOrigineId) ??
        InventoryDecimal.zero()
      ).add(InventoryDecimal.parse(reversal.quantita)),
    );
  }
  let anyReversed = false;
  let allReversed = true;
  for (const original of originals) {
    const originalQuantity = InventoryDecimal.parse(original.quantita);
    const reversed =
      reversedByOriginal.get(original.id) ?? InventoryDecimal.zero();
    if (reversed.compare(originalQuantity) > 0) {
      throw new DistributionLedgerError(
        `Over-storno rilevato sul movimento #${original.id}`,
      );
    }
    if (reversed.isPositive()) anyReversed = true;
    if (reversed.compare(originalQuantity) !== 0) allReversed = false;
  }
  const stato = allReversed
    ? "stornata"
    : anyReversed
      ? "parzialmente_stornata"
      : "confermata";
  await tx
    .update(operazioniDistribuzioneMagazzinoTable)
    .set({ stato })
    .where(eq(operazioniDistribuzioneMagazzinoTable.id, operationId));
}

/** Alias di compatibilità: ora riconcilia lo stato invece di marcarlo alla cieca. */
export const markDistributionOperationReversed =
  reconcileDistributionOperationState;
