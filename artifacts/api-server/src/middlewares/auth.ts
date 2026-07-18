import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, utentiTable, ruoliTable, centriAscoltoTable, cittaTable, zoneUdsTable } from "@workspace/db";
import { AREA_BY_SEGMENT, ALL_AREA_KEYS } from "../lib/areas";
import { isBootstrapMode } from "../lib/bootstrap";
import { SUPER_ADMIN_ROLE_NAME } from "../lib/seedRoles";

export interface SessionUser {
  id: number;
  username: string;
  email: string | null;
  emailDaAggiornare: boolean;
  nome: string;
  cognome: string | null;
  matricola: string | null;
  ruoloId: number | null;
  ruoloNome: string | null;
  centroAscoltoId: number | null;
  centroAscoltoNome: string | null;
  cittaId: number | null;
  cittaNome: string | null;
  zonaUdsId: number | null;
  zonaUdsNome: string | null;
  isSuperAdmin: boolean;
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

export async function loadSessionUser(userId: number): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: utentiTable.id,
      username: utentiTable.username,
      email: utentiTable.email,
      emailDaAggiornare: utentiTable.emailDaAggiornare,
      nome: utentiTable.nome,
      cognome: utentiTable.cognome,
      matricola: utentiTable.matricola,
      attivo: utentiTable.attivo,
      mustChangePassword: utentiTable.mustChangePassword,
      ruoloId: utentiTable.ruoloId,
      ruoloNome: ruoliTable.nome,
      centroAscoltoId: utentiTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      cittaId: utentiTable.cittaId,
      cittaNome: cittaTable.nome,
      zonaUdsId: utentiTable.zonaUdsId,
      zonaUdsNome: zoneUdsTable.nome,
      isSuperAdmin: utentiTable.isSuperAdmin,
      isAdmin: ruoliTable.isAdmin,
      aree: ruoliTable.aree,
    })
    .from(utentiTable)
    .leftJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .leftJoin(centriAscoltoTable, eq(utentiTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(cittaTable, eq(utentiTable.cittaId, cittaTable.id))
    .leftJoin(zoneUdsTable, eq(utentiTable.zonaUdsId, zoneUdsTable.id))
    .where(eq(utentiTable.id, userId));

  if (!row || !row.attivo) return null;

  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    emailDaAggiornare: row.emailDaAggiornare,
    nome: row.nome,
    cognome: row.cognome ?? null,
    matricola: row.matricola ?? null,
    ruoloId: row.ruoloId ?? null,
    ruoloNome: row.ruoloNome ?? null,
    centroAscoltoId: row.centroAscoltoId ?? null,
    centroAscoltoNome: row.centroAscoltoNome ?? null,
    cittaId: row.cittaId ?? null,
    cittaNome: row.cittaNome ?? null,
    zonaUdsId: row.zonaUdsId ?? null,
    zonaUdsNome: row.zonaUdsNome ?? null,
    isSuperAdmin: (row.isSuperAdmin ?? false) || row.ruoloNome === SUPER_ADMIN_ROLE_NAME,
    isAdmin: row.isAdmin ?? false,
    aree: row.aree ?? [],
    mustChangePassword: row.mustChangePassword,
  };
}

/**
 * First-run bootstrap synthetic admin.
 *
 * While the system is in bootstrap mode (no admin user exists yet) and the
 * request is unauthenticated, this synthetic admin is injected so the setup
 * screen can create the initial users. It is NOT persisted and never has a real
 * session — it only exists for the duration of a single whitelisted request.
 */
const BOOTSTRAP_ADMIN: SessionUser = {
  id: 0,
  username: "__bootstrap__",
  email: null,
  emailDaAggiornare: true,
  nome: "Configurazione iniziale",
  cognome: null,
  matricola: null,
  ruoloId: null,
  ruoloNome: null,
  centroAscoltoId: null,
  centroAscoltoNome: null,
  cittaId: null,
  cittaNome: null,
  zonaUdsId: null,
  zonaUdsNome: null,
  isSuperAdmin: false,
  isAdmin: true,
  aree: ALL_AREA_KEYS,
  mustChangePassword: false,
};

/**
 * Minimal set of requests reachable during first-run bootstrap WITHOUT
 * authentication. Deliberately NOT a whole-segment whitelist: bootstrap visitors
 * may ONLY do what the setup screen needs — read the available roles, read the
 * users already created, and create a new user. Everything else (PATCH/DELETE
 * users, any role mutation, etc.) stays behind authentication even on a fresh
 * install, so the open setup surface cannot be abused for full admin CRUD.
 */
export function isBootstrapAllowedRequest(method: string, path: string): boolean {
  // Normalize a trailing slash so "/utenti/" matches "/utenti".
  const normalized = path.replace(/\/+$/, "") || "/";
  if (method === "GET" && (normalized === "/ruoli" || normalized === "/utenti")) {
    return true; // read the roles list + the users already created
  }
  if (method === "POST" && normalized === "/utenti") {
    return true; // create a system user
  }
  return false;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  // requireAuth is applied both globally (routes/index.ts) and again inside the
  // admin routers (utenti/ruoli). When it runs again the user is already
  // resolved; short-circuit so the inner pass is idempotent. This also matters
  // for bootstrap: the inner `router.use("/utenti", requireAuth)` strips the
  // mount prefix (req.path becomes "/"), so only the GLOBAL pass — which sees
  // the full path — can correctly authorize the bootstrap request.
  if (req.user) {
    next();
    return;
  }

  const userId = req.session?.userId;
  if (userId) {
    const user = await loadSessionUser(userId);
    if (user) {
      req.user = user;
      next();
      return;
    }
  }

  // No valid session. On a fresh install (no admin user yet) allow a synthetic
  // bootstrap admin, but ONLY for the minimal setup requests (read roles, read
  // users, create a user) — never the full user/role CRUD surface.
  if (isBootstrapAllowedRequest(req.method, req.path) && (await isBootstrapMode())) {
    req.user = BOOTSTRAP_ADMIN;
    next();
    return;
  }

  res.status(401).json({ error: "Non autenticato" });
};

/**
 * When the authenticated user is flagged `mustChangePassword`, blocks every
 * protected route except the auth self-service endpoints needed to actually
 * change the password (`/auth/me`, `/auth/change-password`, `/auth/logout`).
 * Frontend gating is UX only — this is the real enforcement boundary for users
 * whose password was explicitly marked as temporary.
 */
const PASSWORD_CHANGE_ALLOWLIST = new Set(["/auth/me", "/auth/change-password", "/auth/logout"]);

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

export const requireSuperAdmin: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: "Non autenticato" });
    return;
  }
  if (!req.user.isSuperAdmin) {
    res.status(403).json({ error: "Accesso riservato ai Super Admin" });
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
  const mapped = segment ? AREA_BY_SEGMENT[segment] : undefined;
  if (!mapped) {
    next();
    return;
  }
  const areas = Array.isArray(mapped) ? mapped : [mapped];
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Non autenticato" });
    return;
  }
  if (user.isAdmin) {
    next();
    return;
  }
  // "amministrazione" is reserved to admins; access is granted if the role has
  // ANY of the areas governing this segment.
  if (areas.includes("amministrazione") || !areas.some((a) => user.aree.includes(a))) {
    res.status(403).json({ error: "Area non consentita per il ruolo" });
    return;
  }
  next();
};
