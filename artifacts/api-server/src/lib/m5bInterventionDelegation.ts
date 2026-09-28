import { and, eq, gt, like, sql } from "drizzle-orm";
import {
  interventiDelegheM4Table,
  interventiMaterialiTable,
  interventiTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  richiesteMagazzinoDocumentiTable,
  richiesteMagazzinoTable,
} from "@workspace/db";
import type { InventoryTransaction } from "./scaricoInventory";

export class M5bDelegationError extends Error {
  readonly status = 409;
}

/** Shared before row locks in both the legacy and M5B material paths. */
export async function lockInterventionMaterialPath(
  tx: InventoryTransaction,
  interventoId: number,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('m5b.intervento.materiali'), ${interventoId})`,
  );
}

export async function interventionIsDelegated(
  tx: InventoryTransaction,
  interventoId: number,
) {
  const [delegation] = await tx
    .select({ interventoId: interventiDelegheM4Table.interventoId })
    .from(interventiDelegheM4Table)
    .where(eq(interventiDelegheM4Table.interventoId, interventoId));
  return delegation != null;
}

export async function rejectLegacyMaterialIncreaseAfterDelegation(
  tx: InventoryTransaction,
  interventoId: number,
  hasCataloguedIncrease: boolean,
) {
  if (
    hasCataloguedIncrease &&
    (await interventionIsDelegated(tx, interventoId))
  )
    throw new M5bDelegationError(
      "I materiali catalogati di questo Intervento sono affidati al documento M4; non registrarli anche nell'Intervento",
    );
}

/** Called with the advisory lock and the Intervention FOR UPDATE held. */
export async function delegateInterventionToM4(
  tx: InventoryTransaction,
  input: {
    interventoId: number;
    beneficiarioId: number;
    richiestaId: number;
    actorId: number;
  },
) {
  const [intervento] = await tx
    .select({
      id: interventiTable.id,
      beneficiarioId: interventiTable.beneficiarioId,
      ambito: interventiTable.ambito,
      bollaId: interventiTable.bollaId,
    })
    .from(interventiTable)
    .where(eq(interventiTable.id, input.interventoId))
    .for("update");
  if (
    !intervento ||
    intervento.ambito !== "sociale" ||
    intervento.beneficiarioId !== input.beneficiarioId
  )
    throw new M5bDelegationError("Intervento origine non più coerente");
  if (intervento.bollaId != null)
    throw new M5bDelegationError(
      "L'Intervento deriva già da una Bolla; non può essere erogato di nuovo",
    );

  const [existing] = await tx
    .select()
    .from(interventiDelegheM4Table)
    .where(eq(interventiDelegheM4Table.interventoId, input.interventoId));
  if (existing) {
    const [otherCurrent] = await tx
      .select({ id: richiesteMagazzinoDocumentiTable.id })
      .from(richiesteMagazzinoDocumentiTable)
      .innerJoin(
        richiesteMagazzinoTable,
        eq(
          richiesteMagazzinoTable.id,
          richiesteMagazzinoDocumentiTable.richiestaId,
        ),
      )
      .where(
        and(
          eq(richiesteMagazzinoTable.interventoId, input.interventoId),
          eq(richiesteMagazzinoDocumentiTable.corrente, true),
        ),
      );
    if (otherCurrent)
      throw new M5bDelegationError(
        "L'Intervento ha già un documento operativo corrente",
      );
    return false;
  }

  const [delivered] = await tx
    .select({ id: interventiMaterialiTable.id })
    .from(interventiMaterialiTable)
    .where(
      and(
        eq(interventiMaterialiTable.interventoId, input.interventoId),
        sql`${interventiMaterialiTable.prodottoId} is not null`,
        gt(interventiMaterialiTable.quantitaConsegnata, "0"),
      ),
    );
  const [operation] = await tx
    .select({ id: operazioniDistribuzioneMagazzinoTable.id })
    .from(operazioniDistribuzioneMagazzinoTable)
    .where(
      and(
        eq(operazioniDistribuzioneMagazzinoTable.dominioOrigine, "SOCIALE"),
        like(
          operazioniDistribuzioneMagazzinoTable.entitaOrigineTipo,
          "intervento_materiali_%",
        ),
        eq(
          operazioniDistribuzioneMagazzinoTable.entitaOrigineId,
          input.interventoId,
        ),
      ),
    );
  const [movement] = await tx
    .select({ id: movimentiTable.id })
    .from(movimentiTable)
    .where(
      and(
        eq(movimentiTable.dominioOrigine, "SOCIALE"),
        like(movimentiTable.entitaOrigineTipo, "intervento_materiali_%"),
        eq(movimentiTable.entitaOrigineId, input.interventoId),
      ),
    );
  if (delivered || operation || movement)
    throw new M5bDelegationError(
      "L'Intervento ha già materiale inventariale erogato: crea un nuovo aiuto esplicito",
    );
  await tx.insert(interventiDelegheM4Table).values({
    interventoId: input.interventoId,
    primaRichiestaId: input.richiestaId,
    delegatoDa: input.actorId,
  });
  return true;
}
