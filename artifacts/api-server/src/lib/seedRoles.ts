import { eq } from "drizzle-orm";
import { db, ruoliTable } from "@workspace/db";
import { ALL_AREA_KEYS, EMPORIO_AREA_KEY, MENSA_AREA_KEY } from "./areas";
import {
  ALL_PERMISSION_KEYS,
  LOGISTICA_PERMISSIONS,
  MENSA_PERMISSIONS,
  UDS_PERMISSIONS,
} from "./permissions";
import { logger } from "./logger";

export const SUPER_ADMIN_ROLE_NAME = "SuperAdmin";
export const ADMIN_ROLE_NAME = "Amministratore";
export const EMPORIO_ROLE_NAME = "Emporio";
export const MENSA_ROLE_NAME = "Operatore Mensa";
export const MAGAZZINO_ROLE_NAME = "Operatore Magazzino";
export const LOGISTICA_ROLE_NAME = "Operatore Logistica";
export const OPERATOR_ROLE_NAME = "Operatore";
export const VOLUNTEER_ROLE_NAME = "Volontario";
const UDS_ROLE_NAME = "Operatore UDS";

const SOCIAL_OPERATOR_PERMISSIONS = [
  "beneficiari.view",
  "beneficiari.manage",
  "beneficiari.sensitive.view",
  "beneficiari.deactivate",
  "beneficiari.export",
  "beneficiari.duplicates.search",
  "credito.view",
  "credito.quota.manage",
  "emporio.access.view",
  "emporio.access.manage",
  "sociale.interventi.view",
  "sociale.interventi.create",
  "sociale.interventi.update",
  "sociale.interventi.complete",
  "sociale.interventi.cancel",
  "bolle.view",
  "bolle.manage",
  "bolle.deliver",
  "bolle.cancel",
  "logistica.turni.view",
  "logistica.turni.manage",
] as const;
const UDS_OPERATOR_PERMISSIONS = [
  "beneficiari.view",
  "beneficiari.manage",
  "beneficiari.duplicates.search",
  ...UDS_PERMISSIONS.map((permission) => permission.key),
] as const;
const EMPORIO_OPERATOR_PERMISSIONS = [
  "credito.view",
  "emporio.access.view",
  "emporio.access.manage",
  "emporio.cassa.view",
  "emporio.cassa.operate",
  "emporio.sales.view",
  "emporio.sales.manage",
] as const;
const LOGISTICA_OPERATOR_PERMISSIONS = [
  "approvvigionamenti.view",
  "approvvigionamenti.manage",
  "approvvigionamenti.receive",
  ...LOGISTICA_PERMISSIONS.map((permission) => permission.key),
] as const;
const MAGAZZINO_OPERATOR_PERMISSIONS = [
  "magazzino.view",
  "magazzino.agea.view",
  "magazzino.agea.import",
  "magazzino.agea.mapping.manage",
  "magazzino.agea.bootstrap",
  "magazzino.products.manage",
  "magazzino.stock.receive",
  "magazzino.stock.issue",
  "magazzino.stock.adjust",
  "magazzino.transfers.create",
  "magazzino.transfers.dispatch",
  "magazzino.transfers.receive",
  "bolle.view",
  "bolle.manage",
  "bolle.deliver",
  "bolle.cancel",
] as const;

function mergePermissions(
  current: string[] | null | undefined,
  required: readonly string[],
): string[] {
  return [...new Set([...(current ?? []), ...required])];
}

export function defaultEmporioPermissions(
  current: string[] | null | undefined,
): string[] {
  return mergePermissions(
    (current ?? []).filter((permission) => permission !== "beneficiari.view"),
    EMPORIO_OPERATOR_PERMISSIONS,
  );
}

export function roleAreasAfterEmporioSeed(
  roleName: string,
  current: string[] | null | undefined,
): string[] {
  if (roleName !== EMPORIO_ROLE_NAME) return [...(current ?? [])];
  return [
    ...new Set([
      ...(current ?? []).filter((area) => area !== "sociale"),
      EMPORIO_AREA_KEY,
    ]),
  ];
}

const MENSA_STANDARD_DENIED_PERMISSIONS = new Set([
  "mensa.meals.override",
  "mensa.service.reopen",
  "mensa.transfers.manage",
  "magazzino.transfers.dispatch",
  "magazzino.stock.issue",
  "magazzino.stock.adjust",
]);

export function defaultMensaRolePermissions(
  current: string[] | null | undefined,
): string[] {
  const required = MENSA_PERMISSIONS.map((item) => item.key).filter(
    (key) => !MENSA_STANDARD_DENIED_PERMISSIONS.has(key),
  );
  return mergePermissions(
    (current ?? []).filter(
      (permission) => !MENSA_STANDARD_DENIED_PERMISSIONS.has(permission),
    ),
    required,
  );
}

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
        permessi: ALL_PERMISSION_KEYS,
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
      permessi: ALL_PERMISSION_KEYS,
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
      permessi: ALL_PERMISSION_KEYS,
      isAdmin: true,
    });
    logger.info("Seeded admin role");
  }

  const [operatorRole] = await db
    .select({
      id: ruoliTable.id,
      aree: ruoliTable.aree,
      permessi: ruoliTable.permessi,
    })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, OPERATOR_ROLE_NAME));
  if (!operatorRole) {
    await db.insert(ruoliTable).values({
      nome: OPERATOR_ROLE_NAME,
      descrizione: "Operatore delle attività generali e sociali",
      aree: ["generale", "sociale"],
      permessi: [...SOCIAL_OPERATOR_PERMISSIONS],
      isAdmin: false,
    });
    logger.info("Seeded operator role");
  } else {
    await db
      .update(ruoliTable)
      .set({
        aree: mergePermissions(operatorRole.aree, ["generale", "sociale"]),
        permessi: mergePermissions(
          operatorRole.permessi,
          SOCIAL_OPERATOR_PERMISSIONS,
        ),
      })
      .where(eq(ruoliTable.id, operatorRole.id));
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

  const [logisticaRole] = await db
    .select({
      id: ruoliTable.id,
      aree: ruoliTable.aree,
      permessi: ruoliTable.permessi,
    })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, LOGISTICA_ROLE_NAME));
  if (!logisticaRole) {
    await db.insert(ruoliTable).values({
      nome: LOGISTICA_ROLE_NAME,
      descrizione: "Operatore degli Approvvigionamenti",
      aree: ["logistica"],
      permessi: [...LOGISTICA_OPERATOR_PERMISSIONS],
      isAdmin: false,
    });
    logger.info("Seeded Logistics operator role");
  } else {
    await db
      .update(ruoliTable)
      .set({
        aree: logisticaRole.aree.includes("logistica")
          ? logisticaRole.aree
          : [...logisticaRole.aree, "logistica"],
        permessi: mergePermissions(
          logisticaRole.permessi,
          LOGISTICA_OPERATOR_PERMISSIONS,
        ),
      })
      .where(eq(ruoliTable.id, logisticaRole.id));
  }

  const [magazzinoRole] = await db
    .select({
      id: ruoliTable.id,
      aree: ruoliTable.aree,
      permessi: ruoliTable.permessi,
    })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, MAGAZZINO_ROLE_NAME));
  if (!magazzinoRole) {
    await db.insert(ruoliTable).values({
      nome: MAGAZZINO_ROLE_NAME,
      descrizione: "Operatore del Magazzino Solidale",
      aree: ["magazzino"],
      permessi: [...MAGAZZINO_OPERATOR_PERMISSIONS],
      isAdmin: false,
    });
    logger.info("Seeded Magazzino operator role");
  } else {
    await db
      .update(ruoliTable)
      .set({
        aree: magazzinoRole.aree.includes("magazzino")
          ? magazzinoRole.aree
          : [...magazzinoRole.aree, "magazzino"],
        permessi: mergePermissions(
          magazzinoRole.permessi,
          MAGAZZINO_OPERATOR_PERMISSIONS,
        ),
      })
      .where(eq(ruoliTable.id, magazzinoRole.id));
  }

  // Provide a ready-to-assign "Operatore UDS" role so a street-unit operator can
  // be created out of the box (admin can still edit/remove it). Idempotent.
  const [udsRole] = await db
    .select({ id: ruoliTable.id, permessi: ruoliTable.permessi })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, UDS_ROLE_NAME));
  if (!udsRole) {
    await db.insert(ruoliTable).values({
      nome: UDS_ROLE_NAME,
      descrizione: "Operatore Unità di Strada: anagrafica e interventi UDS",
      aree: ["uds"],
      permessi: [...UDS_OPERATOR_PERMISSIONS],
      isAdmin: false,
    });
    logger.info("Seeded UDS operator role");
  } else {
    await db
      .update(ruoliTable)
      .set({
        permessi: mergePermissions(udsRole.permessi, UDS_OPERATOR_PERMISSIONS),
      })
      .where(eq(ruoliTable.id, udsRole.id));
  }

  // Operational Emporio role. Keep it non-admin and grant only the areas used
  // by the current Emporio UI/API flows. The generic Sociale area is removed
  // only from this standard role; differently named custom roles are untouched.
  const [emporioRole] = await db
    .select({
      id: ruoliTable.id,
      aree: ruoliTable.aree,
      permessi: ruoliTable.permessi,
    })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, EMPORIO_ROLE_NAME));
  if (!emporioRole) {
    await db.insert(ruoliTable).values({
      nome: EMPORIO_ROLE_NAME,
      descrizione: "Operatore Emporio Solidale",
      aree: ["generale", "magazzino", EMPORIO_AREA_KEY],
      permessi: [...EMPORIO_OPERATOR_PERMISSIONS],
      isAdmin: false,
    });
    logger.info("Seeded Emporio role");
  } else {
    await db
      .update(ruoliTable)
      .set({
        aree: roleAreasAfterEmporioSeed(EMPORIO_ROLE_NAME, emporioRole.aree),
        // Il ruolo standard usa le API Emporio minimizzate. I ruoli custom non
        // vengono toccati e possono ricevere beneficiari.view esplicitamente.
        permessi: defaultEmporioPermissions(emporioRole.permessi),
      })
      .where(eq(ruoliTable.id, emporioRole.id));
  }

  const defaultMensaPermissions = defaultMensaRolePermissions([]);
  const [mensaRole] = await db
    .select({
      id: ruoliTable.id,
      aree: ruoliTable.aree,
      permessi: ruoliTable.permessi,
    })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, MENSA_ROLE_NAME));
  if (!mensaRole) {
    await db.insert(ruoliTable).values({
      nome: MENSA_ROLE_NAME,
      descrizione: "Operatore del servizio Mensa",
      aree: [MENSA_AREA_KEY],
      permessi: defaultMensaPermissions,
      isAdmin: false,
    });
    logger.info("Seeded Mensa operator role");
  } else {
    await db
      .update(ruoliTable)
      .set({
        aree: mensaRole.aree.includes(MENSA_AREA_KEY)
          ? mensaRole.aree
          : [...mensaRole.aree, MENSA_AREA_KEY],
        // Soltanto il ruolo standard viene riallineato: i ruoli custom restano
        // invariati e possono ricevere esplicitamente override/reopen/dispatch.
        permessi: defaultMensaRolePermissions(mensaRole.permessi),
      })
      .where(eq(ruoliTable.id, mensaRole.id));
  }
}
