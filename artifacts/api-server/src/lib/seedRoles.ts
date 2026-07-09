import { eq } from "drizzle-orm";
import { db, ruoliTable } from "@workspace/db";
import { ALL_AREA_KEYS } from "./areas";
import { logger } from "./logger";

export const SUPER_ADMIN_ROLE_NAME = "SuperAdmin";
export const ADMIN_ROLE_NAME = "Amministratore";
const UDS_ROLE_NAME = "Operatore UDS";

export async function ensureSuperAdminRole(): Promise<number> {
  const [existing] = await db
    .select({ id: ruoliTable.id })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, SUPER_ADMIN_ROLE_NAME));

  if (existing) {
    await db
      .update(ruoliTable)
      .set({
        descrizione: "Accesso completo a tutte le aree e alla configurazione ambiente",
        aree: ALL_AREA_KEYS,
        isAdmin: true,
      })
      .where(eq(ruoliTable.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(ruoliTable)
    .values({
      nome: SUPER_ADMIN_ROLE_NAME,
      descrizione: "Accesso completo a tutte le aree e alla configurazione ambiente",
      aree: ALL_AREA_KEYS,
      isAdmin: true,
    })
    .returning({ id: ruoliTable.id });
  logger.info("Seeded SuperAdmin role");
  return created.id;
}

/**
 * Idempotently ensures the default roles exist so first-run setup and
 * environment bootstrap always have stable roles to assign.
 */
export async function seedRoles(): Promise<void> {
  await ensureSuperAdminRole();

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
