import { beneficiariTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BeneficiaryReportingSnapshot = {
  areaOperativaIdSnapshot: number | null;
  centroAscoltoIdSnapshot: number | null;
  numeroComponentiNucleoSnapshot: number | null;
};

export function isReportingSnapshotConcurrencyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 6; depth += 1) {
    if (typeof current !== "object") return false;
    const code = (current as { code?: unknown }).code;
    if (code === "40P01" || code === "40001") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Acquisisce la proiezione territoriale e del nucleo nel momento in cui un
 * evento diventa effettivo. Il chiamante la salva nella stessa transazione
 * della finalizzazione; i report non devono rileggere l'anagrafica corrente.
 *
 * Ordine di lock Reporting: evento (se esiste), Beneficiario, quindi
 * Magazzino/Lotti. Tutti i workflow di finalizzazione devono rispettarlo.
 */
export async function beneficiaryReportingSnapshotTx(
  tx: Tx,
  beneficiarioId: number,
): Promise<BeneficiaryReportingSnapshot> {
  const [beneficiario] = await tx
    .select({
      areaOperativaId: beneficiariTable.areaOperativaId,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      numComponenti: beneficiariTable.numComponenti,
    })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId))
    .for("update");
  if (!beneficiario)
    throw new Error("Beneficiario non disponibile per lo snapshot Reporting");
  return {
    areaOperativaIdSnapshot: beneficiario.areaOperativaId,
    centroAscoltoIdSnapshot:
      beneficiario.areaOperativaId == null
        ? null
        : beneficiario.centroAscoltoId,
    numeroComponentiNucleoSnapshot:
      Number.isInteger(beneficiario.numComponenti) && beneficiario.numComponenti > 0
        ? beneficiario.numComponenti
        : null,
  };
}
