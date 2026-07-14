import { eq } from "drizzle-orm";
import { db, impostazioniStampaTable } from "@workspace/db";

export const IMPOSTAZIONI_STAMPA_ID = 1;
export const VALID_BOLLA_TEMPLATES = [
  "standard",
  "moderno",
  "minimal",
] as const;
export type BollaTemplate = (typeof VALID_BOLLA_TEMPLATES)[number];

export function formatImpostazioniStampa(
  row: typeof impostazioniStampaTable.$inferSelect,
) {
  return {
    templateBolla: row.templateBolla,
    footerBolla: row.footerBolla ?? null,
    dataAggiornamento: row.dataAggiornamento.toISOString(),
  };
}

/** Ensures the persisted default exists before the API starts accepting work. */
export async function ensureImpostazioniStampa(): Promise<
  typeof impostazioniStampaTable.$inferSelect
> {
  await db
    .insert(impostazioniStampaTable)
    .values({ id: IMPOSTAZIONI_STAMPA_ID })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(impostazioniStampaTable)
    .where(eq(impostazioniStampaTable.id, IMPOSTAZIONI_STAMPA_ID));
  return row;
}

export async function updateImpostazioniStampa(values: {
  templateBolla?: BollaTemplate;
  footerBolla?: string | null;
}): Promise<typeof impostazioniStampaTable.$inferSelect> {
  await ensureImpostazioniStampa();
  const [row] = await db
    .update(impostazioniStampaTable)
    .set({ ...values, dataAggiornamento: new Date() })
    .where(eq(impostazioniStampaTable.id, IMPOSTAZIONI_STAMPA_ID))
    .returning();
  return row;
}
