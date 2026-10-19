import type { Request, RequestHandler } from "express";
import {
  db,
  utentiTable,
  ruoliTable,
  menseTable,
  areeOperativeTable,
  centriAscoltoTable,
} from "@workspace/db";
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";

export class MensaScopeError extends Error {
  readonly status = 403;
}
const scopes = new WeakMap<Request, number[] | null>();

/** Il ruolo abilita Mensa; l'Area corrente delimita tutte le strutture utilizzabili. */
export async function currentMensaIds(
  tx: InventoryTransaction,
  userId: number,
) {
  const [user] = await tx
    .select()
    .from(utentiTable)
    .where(eq(utentiTable.id, userId))
    .for("share");
  const [role] =
    user?.ruoloId == null
      ? []
      : await tx
          .select()
          .from(ruoliTable)
          .where(eq(ruoliTable.id, user.ruoloId))
          .for("share");
  if (!user?.attivo || !role)
    throw new MensaScopeError("Operatore non più autorizzato");
  if (role.isAdmin) return { ids: null, user, role };
  if (!role.aree.includes("mensa") || user.areaOperativaId == null)
    throw new MensaScopeError("Scope Mensa non assegnato");
  const [area] = await tx
    .select()
    .from(areeOperativeTable)
    .where(eq(areeOperativeTable.id, user.areaOperativaId))
    .for("share");
  const [center] =
    user.centroAscoltoId == null
      ? []
      : await tx
          .select()
          .from(centriAscoltoTable)
          .where(eq(centriAscoltoTable.id, user.centroAscoltoId))
          .for("share");
  if (
    !area?.attivo ||
    (user.centroAscoltoId != null &&
      (!center?.attivo || center.areaOperativaId !== area.id))
  )
    throw new MensaScopeError("Scope territoriale Mensa non valido");
  const candidates = await tx
    .select({ id: menseTable.id })
    .from(menseTable)
    .where(eq(menseTable.areaOperativaId, area.id))
    .orderBy(menseTable.id);
  return {
    ids: candidates.map((item) => item.id),
    user,
    role,
  };
}

/** Mantiene i lock di autorizzazione fino al completamento HTTP: una revoca
 * concorrente serializza con il comando, anche quando usa un servizio M4. */
export const currentMensaScope: RequestHandler = async (req, res, next) => {
  // Il client può chiudere durante una query/attesa di lock, prima di next().
  // Registrare gli eventi prima dell'I/O evita di perdere quel close.
  let completeResponse!: () => void;
  const responseCompleted = new Promise<void>((resolve) => {
    completeResponse = resolve;
  });
  res.once("finish", completeResponse);
  res.once("close", completeResponse);
  try {
    await db.transaction(async (tx) => {
      const current = await currentMensaIds(tx, req.user!.id);
      if (res.destroyed || res.writableEnded) return;
      scopes.set(req, current.ids);
      Object.assign(req.user!, { mensaIds: current.ids });
      // Intersezione preserva controlli preliminari più restrittivi; mai elevazione.
      if (!current.role.isAdmin)
        req.user!.permessi = req.user!.permessi.filter((grant) =>
          current.role.permessi.includes(grant),
        );
      req.user!.isAdmin = current.role.isAdmin;
      req.user!.areaOperativaId = current.user.areaOperativaId;
      req.user!.centroAscoltoId = current.user.centroAscoltoId;
      if (
        current.ids?.length === 0 &&
        req.baseUrl.endsWith("/mensa") &&
        !(req.method === "GET" && req.path === "/mense")
      )
        throw new MensaScopeError("Nessuna Mensa disponibile nell'Area");
      next();
      await responseCompleted;
    });
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    if (error instanceof MensaScopeError && !res.headersSent)
      res.status(403).json({ error: error.message });
    else if (!res.headersSent) next(error);
  } finally {
    res.off("finish", completeResponse);
    res.off("close", completeResponse);
  }
};

export function mensaScopeCondition(
  req: Request,
  column: Parameters<typeof inArray>[0] | SQL,
): SQL {
  const ids = scopes.get(req);
  if (ids === null) return sql`true`;
  return ids?.length ? inArray(column, ids) : sql`false`;
}

export function assertAssignedMensa(req: Request, mensaId: number) {
  const ids = scopes.get(req);
  if (ids !== null && !ids?.includes(mensaId))
    throw new MensaScopeError("Mensa fuori dall'Area autorizzata");
}

export async function assertCurrentMensaAssignment(
  tx: InventoryTransaction,
  req: Request,
  mensaId: number,
) {
  const current = await currentMensaIds(tx, req.user!.id);
  if (current.ids !== null && !current.ids.includes(mensaId))
    throw new MensaScopeError("Mensa fuori dall'Area autorizzata");
}
