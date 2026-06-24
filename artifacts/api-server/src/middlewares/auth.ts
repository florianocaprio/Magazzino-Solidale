import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, utentiTable, ruoliTable } from "@workspace/db";
import { AREA_BY_SEGMENT } from "../lib/areas";

export interface SessionUser {
  id: number;
  username: string;
  nome: string;
  cognome: string | null;
  matricola: string | null;
  ruoloId: number | null;
  ruoloNome: string | null;
  isAdmin: boolean;
  aree: string[];
  mustChangePassword: boolean;
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function loadSessionUser(
  userId: number,
): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: utentiTable.id,
      username: utentiTable.username,
      nome: utentiTable.nome,
      cognome: utentiTable.cognome,
      matricola: utentiTable.matricola,
      attivo: utentiTable.attivo,
      mustChangePassword: utentiTable.mustChangePassword,
      ruoloId: utentiTable.ruoloId,
      ruoloNome: ruoliTable.nome,
      isAdmin: ruoliTable.isAdmin,
      aree: ruoliTable.aree,
    })
    .from(utentiTable)
    .leftJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .where(eq(utentiTable.id, userId));

  if (!row || !row.attivo) return null;

  return {
    id: row.id,
    username: row.username,
    nome: row.nome,
    cognome: row.cognome ?? null,
    matricola: row.matricola ?? null,
    ruoloId: row.ruoloId ?? null,
    ruoloNome: row.ruoloNome ?? null,
    isAdmin: row.isAdmin ?? false,
    aree: row.aree ?? [],
    mustChangePassword: row.mustChangePassword,
  };
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Non autenticato" });
    return;
  }
  const user = await loadSessionUser(userId);
  if (!user) {
    res.status(401).json({ error: "Non autenticato" });
    return;
  }
  req.user = user;
  next();
};

/**
 * When the authenticated user is flagged `mustChangePassword`, blocks every
 * protected route except the auth self-service endpoints needed to actually
 * change the password (`/auth/me`, `/auth/change-password`, `/auth/logout`).
 * Frontend gating is UX only — this is the real enforcement boundary so a user
 * with the known bootstrap credential cannot operate before rotating it.
 */
const PASSWORD_CHANGE_ALLOWLIST = new Set([
  "/auth/me",
  "/auth/change-password",
  "/auth/logout",
]);

export const requirePasswordChange: RequestHandler = (req, res, next) => {
  if (req.user?.mustChangePassword && !PASSWORD_CHANGE_ALLOWLIST.has(req.path)) {
    res.status(403).json({ error: "Cambio password obbligatorio" });
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Accesso riservato agli amministratori" });
    return;
  }
  next();
};

/**
 * Enforces that the authenticated user's role grants access to the area that
 * governs the requested path. Admins bypass all checks. Paths whose first
 * segment is not area-mapped are allowed through (they are gated elsewhere).
 */
export const areaGuard: RequestHandler = (req, res, next) => {
  const segment = req.path.split("/").filter(Boolean)[0];
  const area = segment ? AREA_BY_SEGMENT[segment] : undefined;
  if (!area) {
    next();
    return;
  }
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Non autenticato" });
    return;
  }
  if (user.isAdmin) {
    next();
    return;
  }
  if (area === "amministrazione" || !user.aree.includes(area)) {
    res.status(403).json({ error: "Area non consentita per il ruolo" });
    return;
  }
  next();
};
