import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, ruoliTable, utentiTable } from "@workspace/db";
import { ALL_AREA_KEYS } from "./areas";
import { logger } from "./logger";

const ADMIN_ROLE_NAME = "Amministratore";
const ADMIN_USERNAME = "admin";
const ADMIN_INITIAL_PASSWORD = "flocap!";

/**
 * Idempotently ensures an admin role and an admin user exist so the portal is
 * never locked out. Safe to run on every startup.
 */
export async function seedAdmin(): Promise<void> {
  let [adminRole] = await db
    .select()
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, ADMIN_ROLE_NAME));

  if (!adminRole) {
    [adminRole] = await db
      .insert(ruoliTable)
      .values({
        nome: ADMIN_ROLE_NAME,
        descrizione: "Accesso completo a tutte le aree e alla gestione utenti",
        aree: ALL_AREA_KEYS,
        isAdmin: true,
      })
      .returning();
    logger.info("Seeded admin role");
  }

  const [existingUser] = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(eq(utentiTable.username, ADMIN_USERNAME));

  if (!existingUser) {
    const passwordHash = await bcrypt.hash(ADMIN_INITIAL_PASSWORD, 10);
    await db.insert(utentiTable).values({
      username: ADMIN_USERNAME,
      passwordHash,
      nome: "Amministratore",
      ruoloId: adminRole.id,
      attivo: true,
      mustChangePassword: true,
    });
    logger.info("Seeded admin user");
  }

  // Provide a ready-to-assign "Operatore UDS" role so a street-unit operator can
  // be created out of the box (admin can still edit/remove it). Idempotent.
  const UDS_ROLE_NAME = "Operatore UDS";
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
