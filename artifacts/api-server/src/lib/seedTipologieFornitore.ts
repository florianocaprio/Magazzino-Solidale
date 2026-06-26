import { eq } from "drizzle-orm";
import { db, tipologieFornitoreTable } from "@workspace/db";
import { logger } from "./logger";

// The historical built-in supplier types. Seeded as type NAMES so existing
// `fornitori.tipo` values (which store these same keys) keep matching a
// selectable option; the GUI translates known keys via `fornitori.tipi.*`.
const DEFAULT_TIPOLOGIE = [
  "commerciale",
  "donatore_privato",
  "banco_alimentare",
  "ente_pubblico",
  "altro",
];

/**
 * Idempotently ensures the default supplier types exist so the fornitori form
 * has options out of the box. Admins can add/remove types afterwards.
 */
export async function seedTipologieFornitore(): Promise<void> {
  for (const nome of DEFAULT_TIPOLOGIE) {
    const [existing] = await db
      .select({ id: tipologieFornitoreTable.id })
      .from(tipologieFornitoreTable)
      .where(eq(tipologieFornitoreTable.nome, nome));
    if (!existing) {
      await db.insert(tipologieFornitoreTable).values({ nome });
    }
  }
  logger.info("Seeded default supplier types");
}
