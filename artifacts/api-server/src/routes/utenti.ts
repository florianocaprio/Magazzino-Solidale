import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, ne, desc, ilike, or, type SQL } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, utentiTable, ruoliTable, centriAscoltoTable, cittaTable, zoneUdsTable } from "@workspace/db";
import { CreateUtenteBody, UpdateUtenteBody, ResetUtentePasswordBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { callerCentroId, callerCittaId, callerZonaUdsId, andScoped } from "../lib/centroScope";
import { isBootstrapMode } from "../lib/bootstrap";
import { ensureSuperAdminRole, SUPER_ADMIN_ROLE_NAME } from "../lib/seedRoles";
import { logSystemEvent, systemLogMetaFromRequest } from "../lib/systemLog";
import { isValidUserEmail, normalizeEmail } from "../lib/userEmail";

const router: IRouter = Router();

router.use("/utenti", requireAuth, requireAdmin);

type UtenteRow = {
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
  attivo: boolean;
  mustChangePassword: boolean;
  emailVerifiedAt: Date | null;
  lastPasswordChangeAt: Date | null;
  ultimoAccesso: Date | null;
  dataCreazione: Date;
};

const fmt = (r: UtenteRow) => ({
  id: r.id,
  username: r.username,
  email: r.email ?? null,
  emailDaAggiornare: r.emailDaAggiornare,
  nome: r.nome,
  cognome: r.cognome ?? null,
  matricola: r.matricola ?? null,
  ruoloId: r.ruoloId ?? null,
  ruoloNome: r.ruoloNome ?? null,
  centroAscoltoId: r.centroAscoltoId ?? null,
  centroAscoltoNome: r.centroAscoltoNome ?? null,
  cittaId: r.cittaId ?? null,
  cittaNome: r.cittaNome ?? null,
  zonaUdsId: r.zonaUdsId ?? null,
  zonaUdsNome: r.zonaUdsNome ?? null,
  isSuperAdmin: r.isSuperAdmin || r.ruoloNome === SUPER_ADMIN_ROLE_NAME,
  attivo: r.attivo,
  mustChangePassword: r.mustChangePassword,
  emailVerifiedAt: r.emailVerifiedAt ? r.emailVerifiedAt.toISOString() : null,
  lastPasswordChangeAt: r.lastPasswordChangeAt ? r.lastPasswordChangeAt.toISOString() : null,
  ultimoAccesso: r.ultimoAccesso ? r.ultimoAccesso.toISOString() : null,
  dataCreazione: r.dataCreazione.toISOString(),
});

const selectUtente = () =>
  db
    .select({
      id: utentiTable.id,
      username: utentiTable.username,
      email: utentiTable.email,
      emailDaAggiornare: utentiTable.emailDaAggiornare,
      nome: utentiTable.nome,
      cognome: utentiTable.cognome,
      matricola: utentiTable.matricola,
      ruoloId: utentiTable.ruoloId,
      ruoloNome: ruoliTable.nome,
      centroAscoltoId: utentiTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      cittaId: utentiTable.cittaId,
      cittaNome: cittaTable.nome,
      zonaUdsId: utentiTable.zonaUdsId,
      zonaUdsNome: zoneUdsTable.nome,
      isSuperAdmin: utentiTable.isSuperAdmin,
      attivo: utentiTable.attivo,
      mustChangePassword: utentiTable.mustChangePassword,
      emailVerifiedAt: utentiTable.emailVerifiedAt,
      lastPasswordChangeAt: utentiTable.lastPasswordChangeAt,
      ultimoAccesso: utentiTable.ultimoAccesso,
      dataCreazione: utentiTable.dataCreazione,
    })
    .from(utentiTable)
    .leftJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .leftJoin(centriAscoltoTable, eq(utentiTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(cittaTable, eq(utentiTable.cittaId, cittaTable.id))
    .leftJoin(zoneUdsTable, eq(utentiTable.zonaUdsId, zoneUdsTable.id));

async function otherActiveAdminExists(excludeId: number): Promise<boolean> {
  const rows = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .innerJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .where(and(eq(utentiTable.attivo, true), eq(ruoliTable.isAdmin, true), ne(utentiTable.id, excludeId)));
  return rows.length > 0;
}

async function otherActiveSuperAdminExists(excludeId: number): Promise<boolean> {
  const rows = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(and(eq(utentiTable.attivo, true), eq(utentiTable.isSuperAdmin, true), ne(utentiTable.id, excludeId)));
  return rows.length > 0;
}

/**
 * Operator matricola format: <InitialNome><InitialCognome><yy>-<SIGLA>-<NNNNNN>
 * e.g. Mario Rossi inserted in 2026, città Milano (sigla MI) → "MR26-MI-482910".
 * The città sigla is the città's `sigla` (or first 2 letters of its name as a
 * fallback); "OO" for global users (no città). The 6-digit number is random; on
 * a full-matricola collision the first digit becomes a letter (A, B, C, ...).
 */
function cittaSigla(sigla: string | null, nome: string | null): string {
  const s = (sigla ?? "").trim().toUpperCase();
  if (s.length >= 2) return s.slice(0, 2);
  const fromName = (nome ?? "").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (fromName.slice(0, 2) || "XX").padEnd(2, "X");
}

function normalizeMatricola(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

function buildMatricola(nome: string, cognome: string, yy: string, sigla: string, tail: string): string {
  const initials = `${nome.trim().charAt(0)}${cognome.trim().charAt(0)}`.toUpperCase();
  return `${initials}${yy}-${sigla}-${tail}`;
}

async function matricolaExists(m: string, excludeId?: number): Promise<boolean> {
  const conditions: SQL[] = [eq(utentiTable.matricola, m)];
  if (excludeId != null) conditions.push(ne(utentiTable.id, excludeId));
  const [hit] = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(and(...conditions));
  return !!hit;
}

async function emailExists(email: string, excludeId?: number): Promise<boolean> {
  const conditions: SQL[] = [eq(utentiTable.email, email)];
  if (excludeId != null) conditions.push(ne(utentiTable.id, excludeId));
  const [hit] = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(and(...conditions));
  return !!hit;
}

async function generateMatricola(nome: string, cognome: string, cittaId: number | null, year?: number): Promise<string> {
  const yy = String(year ?? new Date().getFullYear()).slice(-2);
  let sigla = "OO";
  if (cittaId != null) {
    const [c] = await db.select({ sigla: cittaTable.sigla, nome: cittaTable.nome }).from(cittaTable).where(eq(cittaTable.id, cittaId));
    sigla = cittaSigla(c?.sigla ?? null, c?.nome ?? null);
  }
  for (let i = 0; i < 50; i++) {
    const num = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    let candidate = buildMatricola(nome, cognome, yy, sigla, num);
    if (!(await matricolaExists(candidate))) return candidate;
    // Collision: the first digit of the number becomes a letter (A, B, C, ...).
    for (let a = 0; a < 26; a++) {
      candidate = buildMatricola(nome, cognome, yy, sigla, String.fromCharCode(65 + a) + num.slice(1));
      if (!(await matricolaExists(candidate))) return candidate;
    }
  }
  // Extremely unlikely fallback.
  return buildMatricola(nome, cognome, yy, sigla, String(Date.now()).slice(-6));
}

async function roleIsAdmin(ruoloId: number | null): Promise<boolean> {
  if (ruoloId == null) return false;
  const [r] = await db.select({ isAdmin: ruoliTable.isAdmin }).from(ruoliTable).where(eq(ruoliTable.id, ruoloId));
  return r?.isAdmin ?? false;
}

async function roleIsSuperAdmin(ruoloId: number | null): Promise<boolean> {
  if (ruoloId == null) return false;
  const [r] = await db.select({ nome: ruoliTable.nome }).from(ruoliTable).where(eq(ruoliTable.id, ruoloId));
  return r?.nome === SUPER_ADMIN_ROLE_NAME;
}

async function roleScope(ruoloId: number | null): Promise<{ exists: boolean; isAdmin: boolean; aree: string[] }> {
  if (ruoloId == null) return { exists: true, isAdmin: false, aree: [] };
  const [r] = await db.select({ isAdmin: ruoliTable.isAdmin, aree: ruoliTable.aree }).from(ruoliTable).where(eq(ruoliTable.id, ruoloId));
  return r ? { exists: true, isAdmin: r.isAdmin, aree: r.aree ?? [] } : { exists: false, isAdmin: false, aree: [] };
}

async function validateAssignableRole(req: Request, ruoloId: number | null): Promise<string | null> {
  const role = await roleScope(ruoloId);
  if (!role.exists) return "Il ruolo selezionato non esiste";
  if (req.user?.isSuperAdmin) return null;
  const callerAree = new Set(req.user?.aree ?? []);
  if (role.aree.some((area) => !callerAree.has(area))) {
    return "Non puoi assegnare un ruolo con permessi più ampi dei tuoi";
  }
  return null;
}

async function cittaExists(cittaId: number | null): Promise<boolean> {
  if (cittaId == null) return true;
  const [row] = await db.select({ id: cittaTable.id }).from(cittaTable).where(eq(cittaTable.id, cittaId));
  return Boolean(row);
}

function requireCallerSuperAdmin(req: Request, res: Response): boolean {
  if (req.user?.isSuperAdmin) return true;
  res.status(403).json({ error: "Operazione riservata ai Super Admin" });
  return false;
}

router.get("/utenti", async (req, res): Promise<void> => {
  const caller = callerCentroId(req);
  // STRICT città boundary on utenti: a città-bound admin sees ONLY users of
  // their own città (no NULL/global users), mirroring the strict centro rule.
  const cittaCaller = callerCittaId(req);
  const zonaCaller = callerZonaUdsId(req);
  const cittaId = req.query.cittaId != null ? Number(req.query.cittaId) : null;
  const matricola = typeof req.query.matricola === "string" ? req.query.matricola.trim() : "";
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  const filters: SQL[] = [];
  if (cittaId != null) {
    if (!Number.isInteger(cittaId) || cittaId <= 0) {
      res.status(400).json({ error: "Area geografica non valida" });
      return;
    }
    if (cittaCaller != null && cittaId !== cittaCaller) {
      res.status(403).json({
        error: "Area geografica non accessibile per il tuo perimetro",
      });
      return;
    }
    filters.push(eq(utentiTable.cittaId, cittaId));
  }
  if (matricola) filters.push(ilike(utentiTable.matricola, `%${matricola}%`));
  if (query) {
    const pattern = `%${query}%`;
    filters.push(or(ilike(utentiTable.nome, pattern), ilike(utentiTable.cognome, pattern), ilike(utentiTable.username, pattern), ilike(utentiTable.email, pattern))!);
  }
  const rows = await selectUtente()
    .where(andScoped(caller != null ? eq(utentiTable.centroAscoltoId, caller) : undefined, cittaCaller != null ? eq(utentiTable.cittaId, cittaCaller) : undefined, zonaCaller != null ? eq(utentiTable.zonaUdsId, zonaCaller) : undefined, ...filters))
    .orderBy(desc(utentiTable.id));
  res.json(rows.map(fmt));
});

router.post("/utenti", async (req, res): Promise<void> => {
  const parsed = CreateUtenteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, email, password, nome, cognome, matricola, ruoloId, attivo, centroAscoltoId, cittaId, zonaUdsId } = parsed.data;
  const normalizedEmail = normalizeEmail(email);
  if (!isValidUserEmail(normalizedEmail)) {
    res.status(400).json({ error: "Email non valida" });
    return;
  }
  const bootstrap = await isBootstrapMode();
  const finalRuoloId = bootstrap ? await ensureSuperAdminRole() : (ruoloId ?? null);
  const finalIsSuperAdmin = await roleIsSuperAdmin(finalRuoloId);

  if (finalIsSuperAdmin && !bootstrap && !req.user?.isSuperAdmin) {
    res.status(403).json({ error: "Solo un Super Admin può creare un altro Super Admin" });
    return;
  }
  if (!bootstrap) {
    const roleError = await validateAssignableRole(req, finalRuoloId);
    if (roleError) {
      res.status(403).json({ error: roleError });
      return;
    }
  }

  // A centro-bound admin can only create users inside their own centro; the
  // caller's centro is auto-assigned and locked (any body value is ignored).
  const caller = callerCentroId(req);
  const finalCentroId = bootstrap || finalIsSuperAdmin ? null : caller != null ? caller : (centroAscoltoId ?? null);
  // Likewise a città-bound admin can only create users inside their own città;
  // the caller's città is auto-assigned and locked (any body value is ignored).
  const cittaCaller = callerCittaId(req);
  const finalCittaId = bootstrap || finalIsSuperAdmin ? null : cittaCaller != null ? cittaCaller : (cittaId ?? null);
  const zonaCaller = callerZonaUdsId(req);
  const finalZonaUdsId = bootstrap || finalIsSuperAdmin ? null : zonaCaller != null ? zonaCaller : finalCittaId == null ? null : (zonaUdsId ?? null);
  if (!(await cittaExists(finalCittaId))) {
    res.status(400).json({ error: "L'area geografica selezionata non esiste" });
    return;
  }

  const [existing] = await db.select({ id: utentiTable.id }).from(utentiTable).where(eq(utentiTable.username, username));
  if (existing) {
    res.status(409).json({ error: "Username già esistente" });
    return;
  }
  if (await emailExists(normalizedEmail)) {
    res.status(409).json({ error: "Email già assegnata a un altro utente" });
    return;
  }

  const nomeTrim = nome.trim();
  const cognomeTrim = cognome.trim();
  const finalMatricola = normalizeMatricola(matricola) || (await generateMatricola(nomeTrim, cognomeTrim, finalCittaId));
  if (await matricolaExists(finalMatricola)) {
    res.status(409).json({ error: "Matricola già assegnata a un altro utente" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [created] = await db
    .insert(utentiTable)
    .values({
      username,
      email: normalizedEmail,
      emailDaAggiornare: false,
      passwordHash,
      nome: nomeTrim,
      cognome: cognomeTrim,
      matricola: finalMatricola,
      ruoloId: finalRuoloId,
      centroAscoltoId: finalCentroId,
      cittaId: finalCittaId,
      zonaUdsId: finalZonaUdsId,
      attivo: attivo ?? true,
      isSuperAdmin: finalIsSuperAdmin,
      mustChangePassword: false,
      lastPasswordChangeAt: new Date(),
    })
    .returning({ id: utentiTable.id });

  const [row] = await selectUtente().where(eq(utentiTable.id, created.id));
  await logSystemEvent({
    evento: "USER_CREATED",
    esito: "SUCCESS",
    targetUserId: created.id,
    userEmail: normalizedEmail,
    username,
    ...systemLogMetaFromRequest(req),
    details: { bootstrap, isSuperAdmin: finalIsSuperAdmin },
  });
  res.status(201).json(fmt(row));
});

router.get("/utenti/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [row] = await selectUtente().where(eq(utentiTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Utente non trovato" });
    return;
  }
  const caller = callerCentroId(req);
  if (caller != null && row.centroAscoltoId !== caller) {
    res.status(403).json({ error: "Utente non accessibile per il tuo centro" });
    return;
  }
  const cittaCaller = callerCittaId(req);
  if (cittaCaller != null && row.cittaId !== cittaCaller) {
    res.status(403).json({ error: "Utente non accessibile per la tua città" });
    return;
  }
  const zonaCaller = callerZonaUdsId(req);
  if (zonaCaller != null && row.zonaUdsId !== zonaCaller) {
    res.status(403).json({ error: "Utente non accessibile per la tua zona" });
    return;
  }
  res.json(fmt(row));
});

router.patch("/utenti/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const parsed = UpdateUtenteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  if (body.cittaId !== undefined && !(await cittaExists(body.cittaId))) {
    res.status(400).json({ error: "L'area geografica selezionata non esiste" });
    return;
  }

  const [target] = await db.select().from(utentiTable).where(eq(utentiTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Utente non trovato" });
    return;
  }
  if (target.isSuperAdmin && !req.user?.isSuperAdmin) {
    res.status(403).json({ error: "Operazione riservata ai Super Admin" });
    return;
  }

  const caller = callerCentroId(req);
  if (caller != null && target.centroAscoltoId !== caller) {
    res.status(403).json({ error: "Utente non accessibile per il tuo centro" });
    return;
  }
  const cittaCaller = callerCittaId(req);
  if (cittaCaller != null && target.cittaId !== cittaCaller) {
    res.status(403).json({ error: "Utente non accessibile per la tua città" });
    return;
  }
  if (cittaCaller != null && body.cittaId !== undefined && body.cittaId !== target.cittaId) {
    res.status(403).json({
      error: "Non sei autorizzato a modificare le aree assegnate al tuo profilo.",
    });
    return;
  }
  const zonaCaller = callerZonaUdsId(req);
  if (zonaCaller != null && target.zonaUdsId !== zonaCaller) {
    res.status(403).json({ error: "Utente non accessibile per la tua zona" });
    return;
  }
  if (zonaCaller != null && body.zonaUdsId !== undefined && body.zonaUdsId !== target.zonaUdsId) {
    res.status(403).json({
      error: "Non sei autorizzato a modificare la zona assegnata al tuo profilo.",
    });
    return;
  }
  if (caller != null && body.centroAscoltoId !== undefined && body.centroAscoltoId !== target.centroAscoltoId) {
    res.status(403).json({
      error: "Non sei autorizzato a modificare il centro assegnato al tuo profilo.",
    });
    return;
  }

  const wasActiveAdmin = target.attivo && (await roleIsAdmin(target.ruoloId));
  if (wasActiveAdmin) {
    const willBeActive = body.attivo ?? target.attivo;
    const newRoleId = body.ruoloId !== undefined ? body.ruoloId : target.ruoloId;
    const willBeAdmin = willBeActive && (await roleIsAdmin(newRoleId));
    if (!willBeAdmin && !(await otherActiveAdminExists(id))) {
      res.status(409).json({
        error: "Deve restare almeno un amministratore attivo",
      });
      return;
    }
  }

  const updates: Partial<typeof utentiTable.$inferInsert> = {};
  if (body.ruoloId !== undefined) {
    if (id === req.user!.id && body.ruoloId !== target.ruoloId && !req.user?.isSuperAdmin) {
      res.status(403).json({
        error: "Non sei autorizzato a modificare il ruolo assegnato al tuo profilo.",
      });
      return;
    }
    const roleError = await validateAssignableRole(req, body.ruoloId);
    if (roleError) {
      res.status(403).json({ error: roleError });
      return;
    }
    const nextIsSuperAdmin = await roleIsSuperAdmin(body.ruoloId);
    if ((nextIsSuperAdmin || target.isSuperAdmin) && !requireCallerSuperAdmin(req, res)) {
      return;
    }
    updates.isSuperAdmin = nextIsSuperAdmin;
    if (nextIsSuperAdmin) {
      updates.centroAscoltoId = null;
      updates.cittaId = null;
      updates.zonaUdsId = null;
    }
  }
  if (body.nome !== undefined) updates.nome = body.nome;
  if (body.cognome !== undefined) updates.cognome = body.cognome;
  if (body.email !== undefined) {
    const normalizedEmail = normalizeEmail(body.email);
    if (!isValidUserEmail(normalizedEmail)) {
      res.status(400).json({ error: "Email non valida" });
      return;
    }
    if (await emailExists(normalizedEmail, id)) {
      res.status(409).json({ error: "Email già assegnata a un altro utente" });
      return;
    }
    if (normalizedEmail !== target.email) {
      updates.email = normalizedEmail;
      updates.emailDaAggiornare = false;
      updates.emailVerifiedAt = null;
    }
  }
  if (body.matricola !== undefined) updates.matricola = normalizeMatricola(body.matricola);
  if (body.ruoloId !== undefined) updates.ruoloId = body.ruoloId;
  if (body.attivo !== undefined) updates.attivo = body.attivo;
  // A centro-bound admin cannot move users to another centro; only a global
  // admin may (re)assign the centro.
  if (caller == null && body.centroAscoltoId !== undefined && updates.isSuperAdmin !== true) {
    updates.centroAscoltoId = body.centroAscoltoId;
  }
  // A città-bound admin cannot move users to another città; only a città-global
  // admin may (re)assign the città.
  if (cittaCaller == null && body.cittaId !== undefined && updates.isSuperAdmin !== true) {
    updates.cittaId = body.cittaId;
  }
  // A zona-bound admin cannot move users to another zona; only a zona-global
  // admin may (re)assign the UDS zona. A user without città cannot keep a zona.
  if (zonaCaller == null && body.zonaUdsId !== undefined && updates.isSuperAdmin !== true) {
    const effectiveCittaId = updates.cittaId !== undefined ? (updates.cittaId ?? null) : target.cittaId;
    updates.zonaUdsId = effectiveCittaId == null ? null : body.zonaUdsId;
  }
  if (zonaCaller != null) {
    updates.zonaUdsId = zonaCaller;
  }
  if (updates.cittaId === null) {
    updates.zonaUdsId = null;
  }
  const effectiveIsSuperAdmin = updates.isSuperAdmin ?? target.isSuperAdmin;
  if (effectiveIsSuperAdmin) {
    updates.centroAscoltoId = null;
    updates.cittaId = null;
    updates.zonaUdsId = null;
  }
  const effectiveActive = updates.attivo ?? target.attivo;
  if (target.isSuperAdmin && (!effectiveIsSuperAdmin || !effectiveActive)) {
    if (!(await otherActiveSuperAdminExists(id))) {
      res.status(409).json({
        error: "Deve restare almeno un Super Admin attivo",
      });
      return;
    }
  }

  // If the user would be left without a matricola (legacy record, or the edit
  // cleared it), auto-generate one per the matricola rules — using the user's
  // ORIGINAL insertion year (yy) and the effective città after this update.
  const resultingMatricola = updates.matricola !== undefined ? updates.matricola : target.matricola;
  if (!(resultingMatricola ?? "").trim()) {
    const genNome = updates.nome !== undefined ? updates.nome : target.nome;
    const genCognome = (updates.cognome !== undefined ? updates.cognome : target.cognome) ?? "";
    const genCittaId = updates.cittaId !== undefined ? (updates.cittaId ?? null) : target.cittaId;
    const genYear = new Date(target.dataCreazione).getFullYear();
    updates.matricola = await generateMatricola(genNome, genCognome, genCittaId, genYear);
  }
  if (updates.matricola !== undefined && updates.matricola !== null) {
    if (await matricolaExists(updates.matricola, id)) {
      res.status(409).json({ error: "Matricola già assegnata a un altro utente" });
      return;
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(utentiTable).set(updates).where(eq(utentiTable.id, id));
  }

  const [row] = await selectUtente().where(eq(utentiTable.id, id));
  if (body.ruoloId !== undefined && body.ruoloId !== target.ruoloId) {
    await logSystemEvent({
      evento: "USER_ROLE_CHANGED",
      esito: "SUCCESS",
      targetUserId: id,
      userEmail: row.email,
      username: row.username,
      ...systemLogMetaFromRequest(req),
      details: { previousRoleId: target.ruoloId, newRoleId: body.ruoloId },
    });
  }
  if (target.attivo && updates.attivo === false) {
    await logSystemEvent({
      evento: "USER_DISABLED",
      esito: "SUCCESS",
      targetUserId: id,
      userEmail: row.email,
      username: row.username,
      ...systemLogMetaFromRequest(req),
    });
  }
  res.json(fmt(row));
});

router.delete("/utenti/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  if (req.user!.id === id) {
    res.status(400).json({ error: "Non puoi eliminare il tuo account" });
    return;
  }

  const [target] = await db.select().from(utentiTable).where(eq(utentiTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Utente non trovato" });
    return;
  }
  if (target.isSuperAdmin && !req.user?.isSuperAdmin) {
    res.status(403).json({ error: "Operazione riservata ai Super Admin" });
    return;
  }
  if (target.isSuperAdmin && !(await otherActiveSuperAdminExists(id))) {
    res.status(409).json({
      error: "Deve restare almeno un Super Admin attivo",
    });
    return;
  }

  const caller = callerCentroId(req);
  if (caller != null && target.centroAscoltoId !== caller) {
    res.status(403).json({ error: "Utente non accessibile per il tuo centro" });
    return;
  }
  const cittaCaller = callerCittaId(req);
  if (cittaCaller != null && target.cittaId !== cittaCaller) {
    res.status(403).json({ error: "Utente non accessibile per la tua città" });
    return;
  }
  const zonaCaller = callerZonaUdsId(req);
  if (zonaCaller != null && target.zonaUdsId !== zonaCaller) {
    res.status(403).json({ error: "Utente non accessibile per la tua zona" });
    return;
  }

  const isActiveAdmin = target.attivo && (await roleIsAdmin(target.ruoloId));
  if (isActiveAdmin && !(await otherActiveAdminExists(id))) {
    res.status(409).json({ error: "Deve restare almeno un amministratore attivo" });
    return;
  }

  await db.delete(utentiTable).where(eq(utentiTable.id, id));
  res.status(204).send();
});

router.post("/utenti/:id/reset-password", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const parsed = ResetUtentePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [target] = await db
    .select({
      id: utentiTable.id,
      centroAscoltoId: utentiTable.centroAscoltoId,
      cittaId: utentiTable.cittaId,
      zonaUdsId: utentiTable.zonaUdsId,
      isSuperAdmin: utentiTable.isSuperAdmin,
      email: utentiTable.email,
      username: utentiTable.username,
    })
    .from(utentiTable)
    .where(eq(utentiTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Utente non trovato" });
    return;
  }
  if (target.isSuperAdmin && !req.user?.isSuperAdmin) {
    res.status(403).json({ error: "Operazione riservata ai Super Admin" });
    return;
  }

  const caller = callerCentroId(req);
  if (caller != null && target.centroAscoltoId !== caller) {
    res.status(403).json({ error: "Utente non accessibile per il tuo centro" });
    return;
  }
  const cittaCaller = callerCittaId(req);
  if (cittaCaller != null && target.cittaId !== cittaCaller) {
    res.status(403).json({ error: "Utente non accessibile per la tua città" });
    return;
  }
  const zonaCaller = callerZonaUdsId(req);
  if (zonaCaller != null && target.zonaUdsId !== zonaCaller) {
    res.status(403).json({ error: "Utente non accessibile per la tua zona" });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db
    .update(utentiTable)
    .set({
      passwordHash,
      mustChangePassword: true,
      lastPasswordChangeAt: new Date(),
    })
    .where(eq(utentiTable.id, id));

  await logSystemEvent({
    evento: "PASSWORD_CHANGED_BY_ADMIN",
    esito: "SUCCESS",
    targetUserId: id,
    userEmail: target.email,
    username: target.username,
    ...systemLogMetaFromRequest(req),
  });

  res.status(204).send();
});

export default router;
