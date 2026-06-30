import { pathToFileURL } from "node:url";
import { db, pool, volontariTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type MatricolaVolontarioRow = {
  id: number;
  matricola: string | null;
};

export type MatricolaVolontarioUpdate = {
  id: number;
  matricola: string;
};

function keyOf(matricola: string | null): string {
  return matricola?.trim() ?? "";
}

export function nextMatricolaLibera(base: string, occupied: Set<string>): string {
  for (let i = 1; i < 100; i++) {
    const candidate = `${base}-${String(i).padStart(2, "0")}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error(`Troppi duplicati per la matricola ${base}`);
}

export function pianificaNormalizzazioneMatricoleVolontari(rows: MatricolaVolontarioRow[]): MatricolaVolontarioUpdate[] {
  const occupied = new Set(rows.map((r) => keyOf(r.matricola)).filter(Boolean));
  const seen = new Set<string>();
  const updates: MatricolaVolontarioUpdate[] = [];

  for (const row of rows) {
    const base = keyOf(row.matricola);
    if (!base) continue;
    if (!seen.has(base)) {
      seen.add(base);
      continue;
    }
    const matricola = nextMatricolaLibera(base, occupied);
    occupied.add(matricola);
    updates.push({ id: row.id, matricola });
  }

  return updates;
}

async function main() {
  const rows = await db
    .select({ id: volontariTable.id, matricola: volontariTable.matricola })
    .from(volontariTable)
    .orderBy(volontariTable.id);
  const updates = pianificaNormalizzazioneMatricoleVolontari(rows);

  for (const update of updates) {
    await db
      .update(volontariTable)
      .set({ matricola: update.matricola })
      .where(eq(volontariTable.id, update.id));
    console.log(`#${update.id} -> ${update.matricola}`);
  }

  console.log(`Normalizzazione completata: ${updates.length} matricole volontari aggiornate.`);
  await pool.end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
}
