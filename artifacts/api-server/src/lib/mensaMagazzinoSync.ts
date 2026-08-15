import { db, magazziniTable, menseTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Magazzino = typeof magazziniTable.$inferSelect;

function internalMensaCode(magazzinoId: number): string {
  return `MEN-MAG-${magazzinoId}`;
}

/** Mantiene il record operativo Mensa come dettaglio tecnico 1:1 del magazzino. */
export async function syncMensaFromMagazzino(
  tx: Tx,
  magazzino: Magazzino,
  userId: number | null,
): Promise<typeof menseTable.$inferSelect> {
  if (magazzino.tipoMagazzino !== "mensa" || magazzino.cittaId == null) {
    throw new Error("Un magazzino Mensa deve avere un'Area");
  }
  const [existing] = await tx
    .select()
    .from(menseTable)
    .where(eq(menseTable.magazzinoId, magazzino.id));
  if (existing) {
    const [updated] = await tx
      .update(menseTable)
      .set({
        nome: magazzino.nome,
        cittaId: magazzino.cittaId,
        indirizzo: magazzino.indirizzo,
        attiva: magazzino.stato === "attivo",
        note: magazzino.note,
        updatedAt: new Date(),
      })
      .where(eq(menseTable.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await tx
    .insert(menseTable)
    .values({
      codice: internalMensaCode(magazzino.id),
      nome: magazzino.nome,
      cittaId: magazzino.cittaId,
      magazzinoId: magazzino.id,
      indirizzo: magazzino.indirizzo,
      attiva: magazzino.stato === "attivo",
      note: magazzino.note,
      createdBy: userId,
    })
    .returning();
  return created;
}
