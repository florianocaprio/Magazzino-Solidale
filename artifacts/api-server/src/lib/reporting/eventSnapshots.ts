import { beneficiariTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  canAccessBeneficiarioScope,
  type BeneficiarioAccessScope,
} from "../beneficiarioPolicy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BeneficiaryReportingSnapshot = {
  areaOperativaIdSnapshot: number | null;
  centroAscoltoIdSnapshot: number | null;
  numeroComponentiNucleoSnapshot: number | null;
};

export type LockedBeneficiaryReportingContext = {
  id: number;
  attivo: boolean;
  uds: boolean;
  areaOperativaId: number | null;
  centroAscoltoId: number | null;
  zonaUdsId: number | null;
  numComponenti: number;
  snapshot: BeneficiaryReportingSnapshot;
};

export class BeneficiaryReportingScopeError extends Error {
  readonly status = 403;

  constructor() {
    super("Risorsa non accessibile per il tuo profilo");
  }
}

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
export async function lockBeneficiaryReportingContextTx(
  tx: Tx,
  beneficiarioId: number,
): Promise<LockedBeneficiaryReportingContext> {
  const [beneficiario] = await tx
    .select({
      id: beneficiariTable.id,
      attivo: beneficiariTable.attivo,
      uds: beneficiariTable.uds,
      areaOperativaId: beneficiariTable.areaOperativaId,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      zonaUdsId: beneficiariTable.zonaUdsId,
      numComponenti: beneficiariTable.numComponenti,
    })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId))
    .for("update");
  if (!beneficiario)
    throw new Error("Beneficiario non disponibile per lo snapshot Reporting");
  return {
    ...beneficiario,
    snapshot: {
      areaOperativaIdSnapshot: beneficiario.areaOperativaId,
      centroAscoltoIdSnapshot:
        beneficiario.areaOperativaId == null
          ? null
          : beneficiario.centroAscoltoId,
      numeroComponentiNucleoSnapshot:
        Number.isInteger(beneficiario.numComponenti) && beneficiario.numComponenti > 0
          ? beneficiario.numComponenti
          : null,
    },
  };
}

export async function lockAndAuthorizeBeneficiaryReportingContextTx(
  tx: Tx,
  beneficiarioId: number,
  scope: BeneficiarioAccessScope,
): Promise<LockedBeneficiaryReportingContext> {
  const context = await lockBeneficiaryReportingContextTx(tx, beneficiarioId);
  if (!context.attivo || !canAccessBeneficiarioScope(context, scope)) {
    throw new BeneficiaryReportingScopeError();
  }
  return context;
}

export async function beneficiaryReportingSnapshotTx(
  tx: Tx,
  beneficiarioId: number,
): Promise<BeneficiaryReportingSnapshot> {
  return (await lockBeneficiaryReportingContextTx(tx, beneficiarioId)).snapshot;
}
