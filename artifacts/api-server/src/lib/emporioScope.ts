import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import {
  areeOperativeTable,
  beneficiariTable,
  centriAscoltoTable,
  db,
  magazziniTable,
  zoneUdsTable,
} from "@workspace/db";
import { and, eq, isNull, or, type Column, type SQL } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";
import {
  CurrentCommandActorError,
  requireCurrentCommandActor,
} from "./currentCommandActor";
import type { PermissionKey } from "./permissions";
import { requirePermission as preliminaryPermission } from "../middlewares/auth";
export {
  andScoped,
  callerCentroId,
  callerAreaOperativaId,
  callerZonaUdsId,
  magazzinoScopeFilter,
  zonaUdsScopeFilter,
  canAccessZonaUds,
} from "./centroScope";

export class EmporioScopeError extends Error {
  constructor(
    public readonly status: number,
    message = "Operazione Emporio non autorizzata per il tuo profilo.",
  ) {
    super(message);
  }
}
type Actor = Awaited<ReturnType<typeof requireCurrentCommandActor>>;

/** Lock brevi nelle letture; nei comandi la stessa autorità resta protetta fino al commit.
 * Ruolo is_admin è la sola eccezione globale esistente, mai Area/Centro NULL ordinari. */
export async function currentEmporioActor(
  tx: InventoryTransaction,
  userId: number,
  permission: string,
): Promise<Actor> {
  let actor: Actor;
  try {
    actor = await requireCurrentCommandActor(tx, userId, permission);
  } catch (error) {
    if (error instanceof CurrentCommandActorError)
      throw new EmporioScopeError(403);
    throw error;
  }
  if (
    !actor.isAdmin &&
    !actor.aree.some((area) => ["emporio", "sociale", "uds"].includes(area))
  )
    throw new EmporioScopeError(403);
  if (!actor.isAdmin && actor.areaOperativaId == null)
    throw new EmporioScopeError(
      403,
      "Perimetro territoriale Emporio non assegnato.",
    );
  if (actor.areaOperativaId != null) {
    const [area] = await tx
      .select()
      .from(areeOperativeTable)
      .where(eq(areeOperativeTable.id, actor.areaOperativaId))
      .for("share");
    if (!area?.attivo)
      throw new EmporioScopeError(403, "Area Operativa non più disponibile.");
  }
  if (actor.centroAscoltoId != null) {
    const [center] = await tx
      .select()
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, actor.centroAscoltoId))
      .for("share");
    if (
      !center?.attivo ||
      (actor.areaOperativaId != null &&
        center.areaOperativaId !== actor.areaOperativaId)
    )
      throw new EmporioScopeError(
        403,
        "Centro non più disponibile nel perimetro corrente.",
      );
  }
  if (actor.zonaUdsId != null) {
    const [zone] = await tx
      .select()
      .from(zoneUdsTable)
      .where(eq(zoneUdsTable.id, actor.zonaUdsId))
      .for("share");
    if (!zone?.attivo || zone.areaOperativaId !== actor.areaOperativaId)
      throw new EmporioScopeError(
        403,
        "Zona non più disponibile nel perimetro corrente.",
      );
  }
  return actor;
}

/** Mantiene il controllo preliminare canonico e rilegge il DB, senza TX per tutta la risposta. */
export function requirePermission(permission: PermissionKey): RequestHandler {
  const preliminary = preliminaryPermission(permission);
  return (req, res, next) =>
    preliminary(req, res, async (error) => {
      if (error) return next(error);
      try {
        if (!req.user)
          throw new EmporioScopeError(401, "Sessione non disponibile.");
        const actor = await db.transaction((tx) =>
          currentEmporioActor(tx, req.user!.id, permission),
        );
        req.user.isAdmin = actor.isAdmin && req.user.isAdmin;
        req.user.permessi = req.user.permessi.filter((grant) =>
          actor.permessi.includes(grant),
        );
        req.user.aree = actor.aree;
        req.user.areaOperativaId = actor.areaOperativaId;
        req.user.centroAscoltoId = actor.centroAscoltoId;
        req.user.zonaUdsId = actor.zonaUdsId;
        next();
      } catch (failure) {
        if (failure instanceof EmporioScopeError)
          res.status(failure.status).json({ error: failure.message });
        else next(failure);
      }
    });
}

export function canAccessCentro(
  value: number | null | undefined,
  scope: number | null,
) {
  return scope == null || value === scope;
}
export function canAccessAreaOperativa(
  value: number | null | undefined,
  scope: number | null,
) {
  return scope == null || value === scope;
}
export function centroScopeFilter(
  column: Column,
  scope: number | null,
): SQL | undefined {
  return scope == null ? undefined : eq(column, scope);
}
export function areaOperativaScopeFilter(
  column: Column,
  scope: number | null,
): SQL | undefined {
  return scope == null ? undefined : eq(column, scope);
}
export function canReadEmporioBeneficiary(
  resource: {
    areaOperativaId: number | null;
    centroAscoltoId: number | null;
    zonaUdsId: number | null;
  },
  actor: Pick<Actor, "areaOperativaId" | "centroAscoltoId" | "zonaUdsId">,
) {
  return (
    canAccessAreaOperativa(resource.areaOperativaId, actor.areaOperativaId) &&
    canAccessCentro(resource.centroAscoltoId, actor.centroAscoltoId) &&
    (actor.zonaUdsId == null || resource.zonaUdsId === actor.zonaUdsId)
  );
}
function warehouseCondition(centroId: number | null, areaId: number | null) {
  return and(
    areaOperativaScopeFilter(magazziniTable.areaOperativaId, areaId),
    centroId == null
      ? undefined
      : or(
          eq(magazziniTable.centroAscoltoId, centroId),
          isNull(magazziniTable.centroAscoltoId),
        ),
  );
}
export async function visibleMagazzinoIds(
  centroId: number | null,
  areaId: number | null = null,
) {
  if (centroId == null && areaId == null) return null;
  return (
    await db
      .select({ id: magazziniTable.id })
      .from(magazziniTable)
      .where(warehouseCondition(centroId, areaId))
  ).map((row) => row.id);
}
export async function canAccessMagazzino(
  id: number,
  centroId: number | null,
  areaId: number | null = null,
) {
  const [row] = await db
    .select({ id: magazziniTable.id })
    .from(magazziniTable)
    .where(
      and(eq(magazziniTable.id, id), warehouseCondition(centroId, areaId)),
    );
  return !!row;
}
export async function canUseBeneficiario(
  id: number | null | undefined,
  centroId: number | null,
  areaId: number | null = null,
  zonaId: number | null = null,
) {
  if (id == null) return false;
  const [row] = await db
    .select()
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, id));
  return (
    !!row &&
    canReadEmporioBeneficiary(row, {
      areaOperativaId: areaId,
      centroAscoltoId: centroId,
      zonaUdsId: zonaId,
    })
  );
}

/** Dopo il lock dell'aggregato: attore → ruolo → territorio → beneficiario → magazzino.
 * FOR UPDATE sul beneficiario evita upgrade di lock SHARE→UPDATE per credito/checkout.
 * La revoca confermata prima è negata; una revoca successiva attende il commit. */
export async function requireEmporioCommandTx(
  tx: InventoryTransaction,
  userId: number | null,
  permission: string,
  resource: { beneficiarioId: number; magazzinoEmporioId?: number | null },
  operational = true,
) {
  if (userId == null)
    throw new EmporioScopeError(401, "Sessione non disponibile.");
  const actor = await currentEmporioActor(tx, userId, permission);
  const [beneficiary] = await tx
    .select()
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, resource.beneficiarioId))
    .for("update");
  if (!beneficiary || !canReadEmporioBeneficiary(beneficiary, actor))
    throw new EmporioScopeError(
      403,
      "Beneficiario non accessibile per il tuo profilo.",
    );
  if (operational) {
    const [area] =
      beneficiary.areaOperativaId == null
        ? []
        : await tx
            .select()
            .from(areeOperativeTable)
            .where(eq(areeOperativeTable.id, beneficiary.areaOperativaId))
            .for("share");
    const [center] =
      beneficiary.centroAscoltoId == null
        ? []
        : await tx
            .select()
            .from(centriAscoltoTable)
            .where(eq(centriAscoltoTable.id, beneficiary.centroAscoltoId))
            .for("share");
    if (
      !area?.attivo ||
      !beneficiary.attivo ||
      !beneficiary.creditoSolidaleAbilitato ||
      beneficiary.creditoSolidaleStato !== "attivo" ||
      !center?.attivo ||
      center.areaOperativaId !== beneficiary.areaOperativaId
    )
      throw new EmporioScopeError(
        400,
        "Beneficiario o Centro non più disponibile per l'operazione Emporio.",
      );
  }
  if (resource.magazzinoEmporioId != null) {
    const [warehouse] = await tx
      .select()
      .from(magazziniTable)
      .where(eq(magazziniTable.id, resource.magazzinoEmporioId))
      .for("share");
    if (
      !warehouse ||
      !canAccessAreaOperativa(
        warehouse.areaOperativaId,
        actor.areaOperativaId,
      ) ||
      (actor.centroAscoltoId != null &&
        warehouse.centroAscoltoId != null &&
        warehouse.centroAscoltoId !== actor.centroAscoltoId)
    )
      throw new EmporioScopeError(
        403,
        "Magazzino non accessibile per il tuo profilo.",
      );
    if (
      operational &&
      (warehouse.stato !== "attivo" ||
        !["emporio", "misto"].includes(warehouse.tipoMagazzino) ||
        warehouse.areaOperativaId !== beneficiary.areaOperativaId)
    )
      throw new EmporioScopeError(
        400,
        "Emporio non più disponibile o incoerente con il Beneficiario.",
      );
  }
  return { actor, beneficiary };
}

export function syncEmporioScope(req: Request, actor: Actor) {
  if (!req.user) return;
  req.user.areaOperativaId = actor.areaOperativaId;
  req.user.centroAscoltoId = actor.centroAscoltoId;
  req.user.zonaUdsId = actor.zonaUdsId;
}
export const emporioScopeErrorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  if (error instanceof EmporioScopeError)
    res.status(error.status).json({ error: error.message });
  else next(error);
};

export async function requireEmporioAdminTx(
  tx: InventoryTransaction,
  userId: number,
) {
  const actor = await currentEmporioActor(tx, userId, "credito.quota.manage");
  if (!actor.isAdmin) throw new EmporioScopeError(403);
  return actor;
}
export async function lockEmporioPolicyTerritory(
  tx: InventoryTransaction,
  values: { areaOperativaId?: number | null; centroAscoltoId?: number | null },
) {
  if (values.areaOperativaId != null) {
    const [area] = await tx
      .select()
      .from(areeOperativeTable)
      .where(eq(areeOperativeTable.id, values.areaOperativaId))
      .for("share");
    if (!area?.attivo)
      throw new EmporioScopeError(400, "Area Operativa non disponibile.");
  }
  if (values.centroAscoltoId != null) {
    const [center] = await tx
      .select()
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, values.centroAscoltoId))
      .for("share");
    if (!center?.attivo || center.areaOperativaId !== values.areaOperativaId)
      throw new EmporioScopeError(
        400,
        "Centro non disponibile nell'Area indicata.",
      );
  }
}
