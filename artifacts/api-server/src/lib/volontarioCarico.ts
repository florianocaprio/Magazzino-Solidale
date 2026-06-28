import { db, consegneTable, volontariTable } from "@workspace/db";
import { and, eq, ne, type SQL } from "drizzle-orm";

// Il "carico" di un volontario in un turno (= un giorno) è il numero di consegne
// a lui assegnate per quella data. Il conteggio vive solo sulla pianificazione
// consegne: le bolle non sono più documenti a sé per il calcolo del carico.
export async function caricoVolontario(
  volontarioId: number,
  data: string,
  opts: { excludeConsegnaId?: number } = {},
): Promise<number> {
  const consegneConds: SQL[] = [
    eq(consegneTable.dataPrevista, data),
    eq(consegneTable.volontarioId, volontarioId),
  ];
  if (opts.excludeConsegnaId != null) consegneConds.push(ne(consegneTable.id, opts.excludeConsegnaId));
  const cons = await db.select({ id: consegneTable.id }).from(consegneTable).where(and(...consegneConds));

  return cons.length;
}

// maxConsegneTurno <= 0 (o assente) = nessun limite.
export async function volontarioOverLimit(
  volontarioId: number,
  data: string,
  opts: { excludeConsegnaId?: number } = {},
): Promise<boolean> {
  const [vol] = await db
    .select({ max: volontariTable.maxConsegneTurno })
    .from(volontariTable)
    .where(eq(volontariTable.id, volontarioId));
  if (!vol) return false;
  const max = vol.max ?? 0;
  if (max <= 0) return false;
  const count = await caricoVolontario(volontarioId, data, opts);
  return count >= max;
}
