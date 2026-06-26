import { eq } from "drizzle-orm";
import { db, tipiInterventoTable } from "@workspace/db";
import { logger } from "./logger";

// The historical built-in intervention types. Seeded as type NAMES so existing
// `interventi.tipoIntervento` values (which store these same keys) keep matching
// a selectable option; the GUI translates known keys via `tipiIntervento.opt.*`.
const DEFAULT_TIPI = [
  "ascolto",
  "colloquio",
  "distribuzione",
  "pacco_alimentare",
  "vestiario",
  "orientamento",
  "salute",
  "altro",
];

/**
 * Idempotently ensures the default intervention types exist so the interventi
 * forms have options out of the box. Admins can add/remove types afterwards.
 */
export async function seedTipiIntervento(): Promise<void> {
  for (const nome of DEFAULT_TIPI) {
    const [existing] = await db
      .select({ id: tipiInterventoTable.id })
      .from(tipiInterventoTable)
      .where(eq(tipiInterventoTable.nome, nome));
    if (!existing) {
      await db.insert(tipiInterventoTable).values({ nome });
    }
  }
  logger.info("Seeded default intervention types");
}
