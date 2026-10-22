import { eq } from "drizzle-orm";
import { db, ruoliTable } from "@workspace/db";
import { ALL_AREA_KEYS, EMPORIO_AREA_KEY, MENSA_AREA_KEY } from "./areas";
import {
  DEFAULT_ADMIN_PERMISSION_KEYS,
  adminPermissionsWithExplicitOriginal,
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

export const SOCIAL_OPERATOR_PERMISSIONS = [
  "maps.operational",
  "maps.route",
  "beneficiari.view",
  "beneficiari.manage",
  "beneficiari.sensitive.view",
  "beneficiari.deactivate",
  "beneficiari.export",
  "beneficiari.fse.view",
  "beneficiari.fse.manage",
  "beneficiari.fse.import",
  "beneficiari.fse.export",
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
  "richieste_magazzino.view",
  "richieste_magazzino.create",
  "richieste_magazzino.update",
  "richieste_magazzino.cancel",
  "consegne.view",
  "consegne.manage",
  "consegne.complete",
  "consegne.cancel",
  "consegne.export",
  "bolle.view",
  "enti-destinatari.view",
  "enti-destinatari.manage",
  "logistica.turni.view",
  "logistica.turni.manage",
] as const;
const SOCIAL_OPERATOR_DENIED_BOLLA_PERMISSIONS = new Set([
  "bolle.manage",
  "bolle.deliver",
  "bolle.cancel",
]);

export function defaultSocialOperatorPermissions(
  current: string[] | null | undefined,
): string[] {
  return mergePermissions(
    (current ?? []).filter(
      (permission) => !SOCIAL_OPERATOR_DENIED_BOLLA_PERMISSIONS.has(permission),
    ),
    SOCIAL_OPERATOR_PERMISSIONS,
  );
}
export const UDS_OPERATOR_PERMISSIONS = [
  "beneficiari.view",
  "beneficiari.manage",
  "beneficiari.duplicates.search",
  ...UDS_PERMISSIONS.map((permission) => permission.key),
] as const;
export const EMPORIO_OPERATOR_PERMISSIONS = [
  "credito.view",
  "emporio.access.view",
  "emporio.access.manage",
  "emporio.cassa.view",
  "emporio.cassa.operate",
  "emporio.sales.view",
  "emporio.sales.manage",
] as const;
export const LOGISTICA_OPERATOR_PERMISSIONS = [
  "approvvigionamenti.view",
  "approvvigionamenti.manage",
  "approvvigionamenti.receive",
  ...LOGISTICA_PERMISSIONS.map((permission) => permission.key),
  "fornitori.view",
  "fornitori.manage",
] as const;
export const MAGAZZINO_OPERATOR_PERMISSIONS = [
  "magazzino.view",
  "richieste_magazzino.view",
  "richieste_magazzino.take",
  "richieste_magazzino.prepare",
  "richieste_magazzino.cancel",
  "magazzino.fse.view",
  "magazzino.agea.view",
  "magazzino.agea.import",
  "magazzino.agea.mapping.manage",
  "magazzino.agea.bootstrap",
  "magazzino.products.manage",
  "magazzino.stock.receive",
  "magazzino.stock.issue",
  "magazzino.stock.adjust",
  "magazzino.transfers.create",
  "magazzino.transfers.prepare",
  "magazzino.transfers.cancel",
  "magazzino.transfers.dispatch",
  "magazzino.transfers.receive",
  "bolle.view",
  "bolle.manage",
  "bolle.deliver",
  "bolle.cancel",
  "enti-destinatari.view",
] as const;

export function defaultMagazzinoOperatorPermissions(
  current: string[] | null | undefined,
): string[] {
  return mergePermissions(
    (current ?? []).filter(
      (permission) => permission !== "enti-destinatari.manage",
    ),
    MAGAZZINO_OPERATOR_PERMISSIONS,
  );
}

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
  "mensa.transfers.prepare",
  "mensa.transfers.cancel",
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
    .select({ id: ruoliTable.id, permessi: ruoliTable.permessi })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, SUPER_ADMIN_ROLE_NAME));

  if (existing) return existing.id;

  const [created] = await db
    .insert(ruoliTable)
    .values({
      nome: SUPER_ADMIN_ROLE_NAME,
      descrizione:
        "Accesso completo a tutte le aree e alla configurazione ambiente",
      aree: ALL_AREA_KEYS,
      permessi: DEFAULT_ADMIN_PERMISSION_KEYS,
      isAdmin: true,
    })
    .returning({ id: ruoliTable.id });
  logger.info("Seeded SuperAdmin role");
  return created.id;
}

/** Versioned proposals are separate from startup: never overwrite a persisted
 * role by its name, nor restore an administrator's revoked grants on restart. */
export const STANDARD_ROLE_PROFILES = [
  { nome: SUPER_ADMIN_ROLE_NAME, descrizione: "Configurazione ambiente e servizi", aree: ALL_AREA_KEYS, permessi: DEFAULT_ADMIN_PERMISSION_KEYS, isAdmin: true },
  { nome: ADMIN_ROLE_NAME, descrizione: "Amministrazione dei servizi", aree: ALL_AREA_KEYS, permessi: DEFAULT_ADMIN_PERMISSION_KEYS, isAdmin: true },
  { nome: OPERATOR_ROLE_NAME, descrizione: "Operatore Centro di Ascolto", aree: ["generale", "sociale"], permessi: [...SOCIAL_OPERATOR_PERMISSIONS], isAdmin: false },
  { nome: MAGAZZINO_ROLE_NAME, descrizione: "Operatore Magazzino Solidale", aree: ["magazzino"], permessi: [...MAGAZZINO_OPERATOR_PERMISSIONS], isAdmin: false },
  { nome: LOGISTICA_ROLE_NAME, descrizione: "Operatore Logistica e approvvigionamenti", aree: ["logistica"], permessi: [...LOGISTICA_OPERATOR_PERMISSIONS], isAdmin: false },
  { nome: UDS_ROLE_NAME, descrizione: "Operatore Unità di Strada", aree: ["uds"], permessi: [...UDS_OPERATOR_PERMISSIONS], isAdmin: false },
  { nome: EMPORIO_ROLE_NAME, descrizione: "Operatore Emporio Solidale", aree: [EMPORIO_AREA_KEY], permessi: [...EMPORIO_OPERATOR_PERMISSIONS], isAdmin: false },
  { nome: MENSA_ROLE_NAME, descrizione: "Operatore Mensa", aree: [MENSA_AREA_KEY], permessi: defaultMensaRolePermissions([]), isAdmin: false },
  { nome: VOLUNTEER_ROLE_NAME, descrizione: "Consultazione turni, consegne dell’Area e mappa operativa", aree: ["logistica"], permessi: ["logistica.turni.view", "consegne.view", "maps.operational", "maps.route"], isAdmin: false },
];

export const ORDINARY_AREA_PERMISSION_MAP: Record<string, readonly string[]> = {
  generale: [], amministrazione: [], analisi: [],
  sociale: SOCIAL_OPERATOR_PERMISSIONS, magazzino: MAGAZZINO_OPERATOR_PERMISSIONS,
  logistica: LOGISTICA_OPERATOR_PERMISSIONS, uds: UDS_OPERATOR_PERMISSIONS,
  emporio: EMPORIO_OPERATOR_PERMISSIONS, mensa: defaultMensaRolePermissions([]),
};

export async function seedRoles(): Promise<void> {
  for (const profile of STANDARD_ROLE_PROFILES) {
    const [existing] = await db.select({ id: ruoliTable.id }).from(ruoliTable).where(eq(ruoliTable.nome, profile.nome));
    if (existing) continue;
    await db.insert(ruoliTable).values({ ...profile, aree: [...profile.aree], permessi: [...profile.permessi] }).onConflictDoNothing();
    logger.info({ role: profile.nome }, "Created missing standard role; existing roles preserved");
  }
}
