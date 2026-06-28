import { db, consegneTable, bolleTable, volontariTable } from "@workspace/db";
import { and, eq, ne, isNull, type SQL } from "drizzle-orm";

// Il "carico" di un volontario in un turno (= un giorno) è il numero di consegne
// a lui assegnate per quella data PIÙ le bolle a lui assegnate per quella data che
// NON sono già collegate a una consegna (per non contare due volte la stessa uscita).
// Le bolle annullate non contano.
export async function caricoVolontario(
  volontarioId: number,
  data: string,
  opts: { excludeConsegnaId?: number; excludeBollaId?: number } = {},
): Promise<number> {
  const consegneConds: SQL[] = [
    eq(consegneTable.dataPrevista, data),
    eq(consegneTable.volontarioId, volontarioId),
  ];
  if (opts.excludeConsegnaId != null) consegneConds.push(ne(consegneTable.id, opts.excludeConsegnaId));
  const cons = await db.select({ id: consegneTable.id }).from(consegneTable).where(and(...consegneConds));

  const bolleConds: SQL[] = [
    eq(bolleTable.dataBolla, data),
    eq(bolleTable.volontarioConsegnaId, volontarioId),
    isNull(bolleTable.consegnaId),
    ne(bolleTable.stato, "annullato"),
  ];
  if (opts.excludeBollaId != null) bolleConds.push(ne(bolleTable.id, opts.excludeBollaId));
  const bol = await db.select({ id: bolleTable.id }).from(bolleTable).where(and(...bolleConds));

  return cons.length + bol.length;
}

// maxConsegneTurno <= 0 (o assente) = nessun limite.
export async function volontarioOverLimit(
  volontarioId: number,
  data: string,
  opts: { excludeConsegnaId?: number; excludeBollaId?: number } = {},
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
