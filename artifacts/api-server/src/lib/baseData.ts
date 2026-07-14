import { ensureFase5Bootstrap } from "./configurazioneAmbiente";
import { initDbExtensions } from "./dbInit";
import { ensureImpostazioniStampa } from "./impostazioniStampa";
import { logger } from "./logger";
import { seedPoliticheCreditoSolidale } from "./seedPoliticheCreditoSolidale";
import { seedRoles } from "./seedRoles";
import { seedRuoliVolontari } from "./seedRuoliVolontari";
import { seedTipiIntervento } from "./seedTipiIntervento";
import { seedTipologieFornitore } from "./seedTipologieFornitore";

/**
 * Idempotent non-personal base data required by a fresh database.
 *
 * This intentionally excludes demo warehouses, suppliers and products: those
 * are opt-in through the environment-data CLI and never appear automatically
 * in a production database.
 */
export async function initializeBaseData(): Promise<void> {
  try {
    await initDbExtensions();
  } catch (error) {
    logger.warn(
      { err: error },
      "Could not enable optional PostgreSQL extensions; fuzzy search may be unavailable",
    );
  }
  await seedRoles();
  await ensureFase5Bootstrap();
  await ensureImpostazioniStampa();
  await seedRuoliVolontari();
  await seedTipiIntervento();
  await seedTipologieFornitore();
  await seedPoliticheCreditoSolidale();
}
