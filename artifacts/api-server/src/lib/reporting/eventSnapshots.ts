import { beneficiariTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BeneficiaryReportingSnapshot = {
  areaOperativaIdSnapshot: number | null;
  centroAscoltoIdSnapshot: number | null;
  numeroComponentiNucleoSnapshot: number;
};

/**
 * Acquisisce la proiezione territoriale e del nucleo nel momento in cui un
 * evento diventa effettivo. Il chiamante la salva nella stessa transazione
 * della finalizzazione; i report non devono rileggere l'anagrafica corrente.
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
    .where(eq(beneficiariTable.id, beneficiarioId));
  if (!beneficiario)
    throw new Error("Beneficiario non disponibile per lo snapshot Reporting");
  return {
    areaOperativaIdSnapshot: beneficiario.areaOperativaId,
    centroAscoltoIdSnapshot: beneficiario.centroAscoltoId,
    numeroComponentiNucleoSnapshot: Math.max(1, beneficiario.numComponenti),
  };
}
