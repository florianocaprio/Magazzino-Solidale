import { auditConfigurazioniTable, db } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type EmporioAuditInput = {
  entityType: "accesso" | "sessione" | "riga_sessione" | "spesa" | "storno";
  entityId: number;
  action: string;
  operatoreId?: number | null;
  ip?: string | null;
  motivo?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

/** Audit append-only Emporio sul registro generico già adottato dal progetto. */
export async function auditEmporioTx(
  tx: Tx,
  input: EmporioAuditInput,
): Promise<void> {
  await tx.insert(auditConfigurazioniTable).values({
    area: "emporio",
    chiave: `emporio-${input.entityType}:${input.entityId}`,
    azione: input.action,
    valorePrecedente: input.before ?? null,
    valoreNuovo: input.after ?? input.metadata ?? null,
    utenteId: input.operatoreId ?? null,
    ip: input.ip ?? null,
    note: input.motivo ?? null,
  });
}
