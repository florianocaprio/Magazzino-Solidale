import { eq } from "drizzle-orm";
import { db, ruoliTable } from "@workspace/db";
import { ALL_AREA_KEYS, EMPORIO_AREA_KEY } from "./areas";
import { logger } from "./logger";

export const SUPER_ADMIN_ROLE_NAME = "SuperAdmin";
export const ADMIN_ROLE_NAME = "Amministratore";
export const EMPORIO_ROLE_NAME = "Emporio";
const OPERATOR_ROLE_NAME = "Operatore";
const VOLUNTEER_ROLE_NAME = "Volontario";
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
        descrizione:
          "Accesso completo a tutte le aree e alla configurazione ambiente",
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
      descrizione:
        "Accesso completo a tutte le aree e alla configurazione ambiente",
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

  const [operatorRole] = await db
    .select({ id: ruoliTable.id })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, OPERATOR_ROLE_NAME));
  if (!operatorRole) {
    await db.insert(ruoliTable).values({
      nome: OPERATOR_ROLE_NAME,
      descrizione: "Operatore delle attività generali e sociali",
      aree: ["generale", "sociale"],
      isAdmin: false,
    });
    logger.info("Seeded operator role");
  }

  const [volunteerRole] = await db
    .select({ id: ruoliTable.id })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, VOLUNTEER_ROLE_NAME));
  if (!volunteerRole) {
    await db.insert(ruoliTable).values({
      nome: VOLUNTEER_ROLE_NAME,
      descrizione: "Volontario per attività generali e logistiche",
      aree: ["generale", "logistica"],
      isAdmin: false,
    });
    logger.info("Seeded volunteer role");
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

  // Operational Emporio role. Keep it non-admin and grant only the areas used
  // by the current Emporio UI/API flows. Existing customizations are preserved;
  // only the newly required Emporio area is appended when missing.
  const [emporioRole] = await db
    .select({ id: ruoliTable.id, aree: ruoliTable.aree })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, EMPORIO_ROLE_NAME));
  if (!emporioRole) {
    await db.insert(ruoliTable).values({
      nome: EMPORIO_ROLE_NAME,
      descrizione: "Operatore Emporio Solidale",
      aree: ["generale", "magazzino", "sociale", EMPORIO_AREA_KEY],
      isAdmin: false,
    });
    logger.info("Seeded Emporio role");
  } else if (!emporioRole.aree.includes(EMPORIO_AREA_KEY)) {
    await db
      .update(ruoliTable)
      .set({ aree: [...emporioRole.aree, EMPORIO_AREA_KEY] })
      .where(eq(ruoliTable.id, emporioRole.id));
    logger.info("Added Emporio access area to existing Emporio role");
  }
}
