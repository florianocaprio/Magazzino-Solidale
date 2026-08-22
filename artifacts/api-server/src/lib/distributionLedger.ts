import {
  operazioniDistribuzioneMagazzinoTable,
  type CanaleOperativo,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";

export interface DistributionOperationInput {
  magazzinoId: number;
  dataDistribuzione: string;
  canaleOperativo: CanaleOperativo;
  dominioOrigine: string;
  entitaOrigineTipo: string;
  entitaOrigineId: number;
  numeroDocumento?: string | null;
  numeroPacchi?: number | null;
  numeroPasti?: number | null;
  indigentiSaltuari?: number | null;
  indigentiContinuativi?: number | null;
  creatoDa: number;
}

export class DistributionLedgerError extends Error {}

export async function ensureDistributionOperation(
  tx: InventoryTransaction,
  input: DistributionOperationInput,
) {
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
      existing.canaleOperativo !== input.canaleOperativo
    ) {
      throw new DistributionLedgerError(
        "La sorgente è già collegata a una diversa operazione di distribuzione",
      );
    }
    return existing;
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

export async function markDistributionOperationReversed(
  tx: InventoryTransaction,
  operationId: number | null,
): Promise<void> {
  if (operationId == null) return;
  await tx
    .update(operazioniDistribuzioneMagazzinoTable)
    .set({ stato: "stornata" })
    .where(eq(operazioniDistribuzioneMagazzinoTable.id, operationId));
}
