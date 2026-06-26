import { eq } from "drizzle-orm";
import { db, ruoliVolontariTable } from "@workspace/db";
import { logger } from "./logger";

// The historical built-in volunteer roles. Seeded as role NAMES so existing
// `volontari.ruolo` values (which store these same keys) keep matching a
// selectable option; the GUI translates known keys via `volontari.roles.*`.
const DEFAULT_ROLES = [
  "magazziniere",
  "autista",
  "operatore_sportello",
  "coordinatore",
];

/**
 * Idempotently ensures the default volunteer roles exist so the volontari form
 * has options out of the box. Admins can add/remove roles afterwards.
 */
export async function seedRuoliVolontari(): Promise<void> {
  for (const nome of DEFAULT_ROLES) {
    const [existing] = await db
      .select({ id: ruoliVolontariTable.id })
      .from(ruoliVolontariTable)
      .where(eq(ruoliVolontariTable.nome, nome));
    if (!existing) {
      await db.insert(ruoliVolontariTable).values({ nome });
    }
  }
  logger.info("Seeded default volunteer roles");
}
