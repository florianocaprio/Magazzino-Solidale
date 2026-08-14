import { db, magazziniTable } from "@workspace/db";

type SelectDatabase = Pick<typeof db, "select">;

/** Calcola il prossimo codice MAG-NNN usato dalla creazione dei magazzini. */
export async function nextMagazzinoCodice(
  database: SelectDatabase = db,
): Promise<string> {
  const rows = await database
    .select({ codice: magazziniTable.codice })
    .from(magazziniTable);
  let max = 0;
  for (const row of rows) {
    const match = /^MAG-(\d+)$/.exec(row.codice);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `MAG-${String(max + 1).padStart(3, "0")}`;
}
