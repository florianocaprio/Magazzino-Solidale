import { randomBytes } from "node:crypto";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  db,
  tessereBeneficiariTable,
} from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";

export class TesseraBeneficiarioError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function formatTesseraBeneficiario(
  row: typeof tessereBeneficiariTable.$inferSelect,
) {
  return {
    id: row.id,
    beneficiarioId: row.beneficiarioId,
    codice: row.codice,
    stato: row.stato,
    dataEmissione: row.dataEmissione.toISOString(),
    dataScadenza: row.dataScadenza ?? null,
    dataRevoca: row.dataRevoca?.toISOString() ?? null,
    motivoRevoca: row.motivoRevoca ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    versione: row.updatedAt.toISOString(),
  };
}

export async function issueTesseraBeneficiario(input: {
  beneficiarioId: number;
  dataScadenza: string | null;
  motivoSostituzione: string | null;
  operatoreId: number;
  ip: string | null;
  areaAudit: "mensa" | "beneficiari";
  recoverExisting?: boolean;
  authorize?: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], beneficiary: typeof beneficiariTable.$inferSelect) => Promise<void>;
}) {
  return db.transaction(async (tx) => {
    // Blocca anche il caso senza tessere: due prime emissioni non possono gareggiare.
    const [beneficiary] = await tx.select().from(beneficiariTable).where(eq(beneficiariTable.id, input.beneficiarioId)).for("update");
    if (!beneficiary) throw new TesseraBeneficiarioError(404, "Beneficiario non trovato");
    if (!beneficiary.attivo) throw new TesseraBeneficiarioError(409, "Il beneficiario non è attivo");
    await input.authorize?.(tx, beneficiary);
    if (input.recoverExisting) {
      const [existing] = await tx.select().from(tessereBeneficiariTable).where(eq(tessereBeneficiariTable.beneficiarioId, input.beneficiarioId))
        .orderBy(sql`case when ${tessereBeneficiariTable.stato} = 'attiva' then 0 else 1 end`, desc(tessereBeneficiariTable.createdAt), desc(tessereBeneficiariTable.id)).limit(1);
      if (existing) return existing;
    }
    const [active] = await tx
      .select()
      .from(tessereBeneficiariTable)
      .where(
        and(
          eq(tessereBeneficiariTable.beneficiarioId, input.beneficiarioId),
          eq(tessereBeneficiariTable.stato, "attiva"),
        ),
      )
      .for("update");
    if (active && !input.motivoSostituzione) {
      throw new TesseraBeneficiarioError(
        409,
        "Esiste già una tessera attiva; indicare il motivo della sostituzione",
      );
    }
    if (active) {
      await tx
        .update(tessereBeneficiariTable)
        .set({
          stato: "revocata",
          dataRevoca: new Date(),
          motivoRevoca: input.motivoSostituzione,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tessereBeneficiariTable.id, active.id),
            eq(tessereBeneficiariTable.stato, "attiva"),
          ),
        );
    }
    const [row] = await tx
      .insert(tessereBeneficiariTable)
      .values({
        beneficiarioId: input.beneficiarioId,
        // Token opaco casuale: nessun dato personale o codice anagrafico.
        codice: `MS-${randomBytes(24).toString("base64url")}`,
        dataScadenza: input.dataScadenza,
        createdBy: input.operatoreId,
      })
      .returning();
    await tx.insert(auditConfigurazioniTable).values({
      area: input.areaAudit,
      chiave: `tessera-beneficiario:${row.id}`,
      azione: active ? "sostituzione" : "emissione",
      valorePrecedente: active ? formatTesseraBeneficiario(active) : null,
      valoreNuovo: formatTesseraBeneficiario(row),
      utenteId: input.operatoreId,
      ip: input.ip,
      note: input.motivoSostituzione,
    });
    return row;
  });
}
