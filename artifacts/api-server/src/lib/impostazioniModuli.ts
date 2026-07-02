import { db, impostazioniModuliTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const EMPORIO_DISABLED_MSG = "Il modulo Emporio Solidale è disabilitato.";
export const UNITA_STRADA_DISABLED_MSG = "La gestione Unità di Strada è disabilitata.";

const SINGLETON_ID = 1;

export type ImpostazioniModuliDto = {
  emporioAbilitato: boolean;
  unitaStradaAbilitata: boolean;
  dataAggiornamento: string | null;
};

function fmt(row: typeof impostazioniModuliTable.$inferSelect): ImpostazioniModuliDto {
  return {
    emporioAbilitato: row.emporioAbilitato,
    unitaStradaAbilitata: row.unitaStradaAbilitata,
    dataAggiornamento: row.dataAggiornamento?.toISOString() ?? null,
  };
}

export async function ensureImpostazioniModuliRow(): Promise<typeof impostazioniModuliTable.$inferSelect> {
  await db
    .insert(impostazioniModuliTable)
    .values({ id: SINGLETON_ID })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(impostazioniModuliTable)
    .where(eq(impostazioniModuliTable.id, SINGLETON_ID));
  return row;
}

export async function getImpostazioniModuli(): Promise<ImpostazioniModuliDto> {
  return fmt(await ensureImpostazioniModuliRow());
}

export async function updateImpostazioniModuli(
  values: Partial<Pick<typeof impostazioniModuliTable.$inferInsert, "emporioAbilitato" | "unitaStradaAbilitata">>,
): Promise<ImpostazioniModuliDto> {
  await ensureImpostazioniModuliRow();
  const [row] = await db
    .update(impostazioniModuliTable)
    .set({ ...values, dataAggiornamento: new Date() })
    .where(eq(impostazioniModuliTable.id, SINGLETON_ID))
    .returning();
  return fmt(row);
}

export async function isEmporioEnabled(): Promise<boolean> {
  return (await getImpostazioniModuli()).emporioAbilitato;
}

export async function isUnitaStradaEnabled(): Promise<boolean> {
  return (await getImpostazioniModuli()).unitaStradaAbilitata;
}
