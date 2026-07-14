import { eq } from "drizzle-orm";
import { db, politicheCreditoSolidaleTable } from "@workspace/db";
import { logger } from "./logger";

export const DEFAULT_POLICY_NAME = "Politica globale Credito Solidale";

export async function seedPoliticheCreditoSolidale(): Promise<void> {
  const [existing] = await db
    .select({ id: politicheCreditoSolidaleTable.id })
    .from(politicheCreditoSolidaleTable)
    .where(eq(politicheCreditoSolidaleTable.nome, DEFAULT_POLICY_NAME));

  if (!existing) {
    await db.insert(politicheCreditoSolidaleTable).values({
      nome: DEFAULT_POLICY_NAME,
      descrizione: "Politica demo globale per il calcolo della quota mensile suggerita.",
      centroAscoltoId: null,
      cittaId: null,
      attiva: true,
      creditoBaseNucleo: "50.00",
      creditoPerComponente: "10.00",
      bonusMinore: "5.00",
      bonusAnziano: "5.00",
      bonusDisabile: "10.00",
      creditoMinimoMensile: "0.00",
      creditoMassimoMensile: null,
      giornoRicaricaMensile: 1,
      ricaricaAutomaticaAbilitata: false,
      arrotondamento: "nessuno",
      note: null,
    });
  }

  logger.info("Seeded default Credito Solidale policy");
}
