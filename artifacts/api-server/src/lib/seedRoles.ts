import { eq } from "drizzle-orm";
import { db, ruoliTable } from "@workspace/db";
import { ALL_AREA_KEYS } from "./areas";
import { logger } from "./logger";

const ADMIN_ROLE_NAME = "Amministratore";
const UDS_ROLE_NAME = "Operatore UDS";

/**
 * Idempotently ensures the default roles exist so the first-run setup screen has
 * an administrator role to assign. Safe to run on every startup.
 *
 * NOTE: this intentionally does NOT seed any user. The portal ships with no
 * default account; the first administrator is created through the first-run
 * bootstrap setup screen (see `lib/bootstrap.ts`).
 */
export async function seedRoles(): Promise<void> {
  const [adminRole] = await db
    .select({ id: ruoliTable.id })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, ADMIN_ROLE_NAME));

  if (!adminRole) {
    await db.insert(ruoliTable).values({
      nome: ADMIN_ROLE_NAME,
      descrizione: "Accesso completo a tutte le aree e alla gestione utenti",
      aree: ALL_AREA_KEYS,
      isAdmin: true,
    });
    logger.info("Seeded admin role");
  }

  // Provide a ready-to-assign "Operatore UDS" role so a street-unit operator can
  // be created out of the box (admin can still edit/remove it). Idempotent.
  const [udsRole] = await db
    .select({ id: ruoliTable.id })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, UDS_ROLE_NAME));
  if (!udsRole) {
    await db.insert(ruoliTable).values({
      nome: UDS_ROLE_NAME,
      descrizione: "Operatore Unità di Strada: anagrafica e interventi UDS",
      aree: ["uds"],
      isAdmin: false,
    });
    logger.info("Seeded UDS operator role");
  }
}
