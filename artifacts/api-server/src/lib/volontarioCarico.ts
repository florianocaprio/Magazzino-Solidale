import { db, consegneTable, volontariTable } from "@workspace/db";
import { and, eq, ne, type SQL } from "drizzle-orm";
import { fasciaTurnoConsegnaSql, fasciaTurnoFromConsegna } from "./consegneTurni";

// Il carico è il numero di consegne operative nello stesso slot data+fascia.
// Le bolle non costituiscono una seconda unità di carico.
export async function caricoVolontario(
  volontarioId: number,
  data: string,
  fasciaOraria: string,
  opts: { excludeConsegnaId?: number } = {},
): Promise<number> {
  const consegneConds: SQL[] = [
    eq(consegneTable.dataPrevista, data),
    eq(consegneTable.volontarioId, volontarioId),
    ne(consegneTable.stato, "annullata"),
    eq(fasciaTurnoConsegnaSql(), fasciaTurnoFromConsegna(fasciaOraria)),
  ];
  if (opts.excludeConsegnaId != null) consegneConds.push(ne(consegneTable.id, opts.excludeConsegnaId));
  const cons = await db.select({ id: consegneTable.id }).from(consegneTable).where(and(...consegneConds));

  return cons.length;
}

// maxConsegneTurno <= 0 (o assente) = nessun limite.
export async function volontarioOverLimit(
  volontarioId: number,
  data: string,
  fasciaOraria: string,
  opts: { excludeConsegnaId?: number } = {},
): Promise<boolean> {
  const [vol] = await db
    .select({ max: volontariTable.maxConsegneTurno })
    .from(volontariTable)
    .where(eq(volontariTable.id, volontarioId));
  if (!vol) return false;
  const max = vol.max ?? 0;
  if (max <= 0) return false;
  if (fasciaTurnoFromConsegna(fasciaOraria) == null) return false;
  const count = await caricoVolontario(volontarioId, data, fasciaOraria, opts);
  return count >= max;
}
