import type { RequestHandler } from "express";
import { isGlobalAdmin } from "../lib/adminScope";

/**
 * Authorize the actor before legacy warehouse predicates interpret NULL as
 * unrestricted. Resource Centro NULL still means shared within the actor's Area.
 * SessionUser is reloaded from persisted user/role/territory on every request.
 * This guard neither grants capabilities nor replaces row/document predicates.
 */
export const requireWarehouseScope: RequestHandler = (req, res, next) => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ error: "Non autenticato" });
    return;
  }
  const global = isGlobalAdmin(actor) && actor?.centroAscoltoId == null;
  const assigned =
    actor?.areaOperativaId != null &&
    actor.areaOperativaAttiva === true &&
    (actor.centroAscoltoId == null ||
      (actor.centroAscoltoAttivo === true &&
        actor.centroAscoltoAreaOperativaId === actor.areaOperativaId));
  if (!global && !assigned) {
    res.status(403).json({
      error:
        "Assegnazione territoriale valida richiesta per consultare il Magazzino",
    });
    return;
  }
  next();
};

export const requireWarehouseReadScope: RequestHandler = (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  return requireWarehouseScope(req, res, next);
};
