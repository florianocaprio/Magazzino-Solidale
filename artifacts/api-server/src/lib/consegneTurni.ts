import { and, eq } from "drizzle-orm";
import { db, consegneTable, turniTable, turniVolontariTable } from "@workspace/db";
import { beneficiarioCentroId } from "./centroScope";

function fasciaTurnoFromConsegna(fascia: string | null | undefined): string | null {
  const normalized = (fascia ?? "").toLowerCase();
  if (normalized.includes("matt")) return "09-13";
  if (normalized.includes("pom")) return "14-18";
  if (normalized.includes("sera") || normalized.includes("18")) return "18-20";
  return null;
}

export async function syncTurnoDaConsegna(consegna: typeof consegneTable.$inferSelect) {
  if (consegna.volontarioId == null && consegna.mezzoId == null) return;
  const centroAscoltoId = await beneficiarioCentroId(consegna.beneficiarioId);
  const fascia = fasciaTurnoFromConsegna(consegna.fasciaOraria);
  if (centroAscoltoId == null || fascia == null) return;

  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(turniTable).where(and(
      eq(turniTable.centroAscoltoId, centroAscoltoId),
      eq(turniTable.data, consegna.dataPrevista),
      eq(turniTable.fascia, fascia),
    ));
    let turnoId: number;
    if (existing) {
      turnoId = existing.id;
      if (consegna.mezzoId != null && existing.mezzoId !== consegna.mezzoId) {
        await tx.update(turniTable).set({ mezzoId: consegna.mezzoId }).where(eq(turniTable.id, turnoId));
      }
    } else {
      const [created] = await tx.insert(turniTable).values({
        centroAscoltoId,
        data: consegna.dataPrevista,
        fascia,
        mezzoId: consegna.mezzoId ?? null,
      }).returning();
      turnoId = created.id;
    }
    if (consegna.volontarioId != null) {
      const [already] = await tx.select({ id: turniVolontariTable.id }).from(turniVolontariTable).where(and(
        eq(turniVolontariTable.turnoId, turnoId),
        eq(turniVolontariTable.volontarioId, consegna.volontarioId),
      ));
      if (!already) {
        await tx.insert(turniVolontariTable).values({ turnoId, volontarioId: consegna.volontarioId, ruolo: "Consegna" });
      }
    }
  });
}
