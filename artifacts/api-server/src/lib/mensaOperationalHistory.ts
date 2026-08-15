import {
  db,
  mensaAbilitazioniTable,
  mensaAccessiTable,
  mensaAutorizzazioniTemporaneeTable,
  mensaEccezioniTable,
  mensaPastiTable,
  trasferimentiTable,
} from "@workspace/db";
import { eq, or } from "drizzle-orm";

export async function mensaHasOperationalHistory(
  mensaId: number,
): Promise<boolean> {
  const checks = await Promise.all([
    db
      .select({ id: mensaAbilitazioniTable.id })
      .from(mensaAbilitazioniTable)
      .where(eq(mensaAbilitazioniTable.mensaId, mensaId))
      .limit(1),
    db
      .select({ id: mensaAccessiTable.id })
      .from(mensaAccessiTable)
      .where(eq(mensaAccessiTable.mensaId, mensaId))
      .limit(1),
    db
      .select({ id: mensaAutorizzazioniTemporaneeTable.id })
      .from(mensaAutorizzazioniTemporaneeTable)
      .where(eq(mensaAutorizzazioniTemporaneeTable.mensaId, mensaId))
      .limit(1),
    db
      .select({ id: mensaPastiTable.id })
      .from(mensaPastiTable)
      .where(eq(mensaPastiTable.mensaId, mensaId))
      .limit(1),
    db
      .select({ id: mensaEccezioniTable.id })
      .from(mensaEccezioniTable)
      .where(
        or(
          eq(mensaEccezioniTable.mensaPrincipaleId, mensaId),
          eq(mensaEccezioniTable.mensaDestinazioneId, mensaId),
        ),
      )
      .limit(1),
    db
      .select({ id: trasferimentiTable.id })
      .from(trasferimentiTable)
      .where(eq(trasferimentiTable.mensaId, mensaId))
      .limit(1),
  ]);
  return checks.some((rows) => rows.length > 0);
}
