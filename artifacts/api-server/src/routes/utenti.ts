import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, utentiTable, ruoliTable, centriAscoltoTable } from "@workspace/db";
import {
  CreateUtenteBody,
  UpdateUtenteBody,
  ResetUtentePasswordBody,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { callerCentroId, callerCittaId, andScoped } from "../lib/centroScope";

const router: IRouter = Router();

router.use("/utenti", requireAuth, requireAdmin);

type UtenteRow = {
  id: number;
  username: string;
  nome: string;
  cognome: string | null;
  matricola: string | null;
  ruoloId: number | null;
  ruoloNome: string | null;
  centroAscoltoId: number | null;
  centroAscoltoNome: string | null;
  cittaId: number | null;
  attivo: boolean;
  mustChangePassword: boolean;
  ultimoAccesso: Date | null;
  dataCreazione: Date;
};

const fmt = (r: UtenteRow) => ({
  id: r.id,
  username: r.username,
  nome: r.nome,
  cognome: r.cognome ?? null,
  matricola: r.matricola ?? null,
  ruoloId: r.ruoloId ?? null,
  ruoloNome: r.ruoloNome ?? null,
  centroAscoltoId: r.centroAscoltoId ?? null,
  centroAscoltoNome: r.centroAscoltoNome ?? null,
  attivo: r.attivo,
  mustChangePassword: r.mustChangePassword,
  ultimoAccesso: r.ultimoAccesso ? r.ultimoAccesso.toISOString() : null,
  dataCreazione: r.dataCreazione.toISOString(),
});

const selectUtente = () =>
  db
    .select({
      id: utentiTable.id,
      username: utentiTable.username,
      nome: utentiTable.nome,
      cognome: utentiTable.cognome,
      matricola: utentiTable.matricola,
      ruoloId: utentiTable.ruoloId,
      ruoloNome: ruoliTable.nome,
      centroAscoltoId: utentiTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      cittaId: utentiTable.cittaId,
      attivo: utentiTable.attivo,
      mustChangePassword: utentiTable.mustChangePassword,
      ultimoAccesso: utentiTable.ultimoAccesso,
      dataCreazione: utentiTable.dataCreazione,
    })
    .from(utentiTable)
    .leftJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .leftJoin(centriAscoltoTable, eq(utentiTable.centroAscoltoId, centriAscoltoTable.id));

async function otherActiveAdminExists(excludeId: number): Promise<boolean> {
  const rows = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .innerJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .where(
      and(
        eq(utentiTable.attivo, true),
        eq(ruoliTable.isAdmin, true),
        ne(utentiTable.id, excludeId),
      ),
    );
  return rows.length > 0;
}

/**
 * Generates a matricola from the initials of nome + cognome followed by the
 * current day-of-month and 2-digit year (ddyy). Example: Mario Rossi on
 * 24 June 2026 → "MR2426".
 */
function generateMatricola(nome: string, cognome: string): string {
  const initials = `${nome.trim().charAt(0)}${cognome.trim().charAt(0)}`.toUpperCase();
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${initials}${dd}${yy}`;
}

async function roleIsAdmin(ruoloId: number | null): Promise<boolean> {
  if (ruoloId == null) return false;
  const [r] = await db
    .select({ isAdmin: ruoliTable.isAdmin })
    .from(ruoliTable)
    .where(eq(ruoliTable.id, ruoloId));
  return r?.isAdmin ?? false;
}

router.get("/utenti", async (req, res): Promise<void> => {
  const caller = callerCentroId(req);
  // STRICT città boundary on utenti: a città-bound admin sees ONLY users of
  // their own città (no NULL/global users), mirroring the strict centro rule.
  const cittaCaller = callerCittaId(req);
  const rows = await selectUtente()
    .where(
      andScoped(
        caller != null ? eq(utentiTable.centroAscoltoId, caller) : undefined,
        cittaCaller != null ? eq(utentiTable.cittaId, cittaCaller) : undefined,
      ),
    )
    .orderBy(utentiTable.username);
  res.json(rows.map(fmt));
});

router.post("/utenti", async (req, res): Promise<void> => {
  const parsed = CreateUtenteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, password, nome, cognome, matricola, ruoloId, attivo, centroAscoltoId, cittaId } = parsed.data;

  // A centro-bound admin can only create users inside their own centro; the
  // caller's centro is auto-assigned and locked (any body value is ignored).
  const caller = callerCentroId(req);
  const finalCentroId = caller != null ? caller : (centroAscoltoId ?? null);
  // Likewise a città-bound admin can only create users inside their own città;
  // the caller's città is auto-assigned and locked (any body value is ignored).
  const cittaCaller = callerCittaId(req);
  const finalCittaId = cittaCaller != null ? cittaCaller : (cittaId ?? null);

  const [existing] = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(eq(utentiTable.username, username));
  if (existing) {
    res.status(409).json({ error: "Username già esistente" });
    return;
  }

  const nomeTrim = nome.trim();
  const cognomeTrim = cognome.trim();
  const finalMatricola = matricola?.trim() || generateMatricola(nomeTrim, cognomeTrim);

  const passwordHash = await bcrypt.hash(password, 10);
  const [created] = await db
    .insert(utentiTable)
    .values({
      username,
      passwordHash,
      nome: nomeTrim,
      cognome: cognomeTrim,
      matricola: finalMatricola,
      ruoloId: ruoloId ?? null,
      centroAscoltoId: finalCentroId,
      cittaId: finalCittaId,
      attivo: attivo ?? true,
      mustChangePassword: true,
    })
    .returning({ id: utentiTable.id });

  const [row] = await selectUtente().where(eq(utentiTable.id, created.id));
  res.status(201).json(fmt(row));
});

router.get("/utenti/:id", async (req, res): Promise<void> => {
  const id = parseInt(
    Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    10,
  );
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
  res.json(fmt(row));
});

router.patch("/utenti/:id", async (req, res): Promise<void> => {
  const id = parseInt(
    Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    10,
  );
  const parsed = UpdateUtenteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  const [target] = await db
    .select()
    .from(utentiTable)
    .where(eq(utentiTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Utente non trovato" });
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

  const wasActiveAdmin =
    target.attivo && (await roleIsAdmin(target.ruoloId));
  if (wasActiveAdmin) {
    const willBeActive = body.attivo ?? target.attivo;
    const newRoleId =
      body.ruoloId !== undefined ? body.ruoloId : target.ruoloId;
    const willBeAdmin = willBeActive && (await roleIsAdmin(newRoleId));
    if (!willBeAdmin && !(await otherActiveAdminExists(id))) {
      res.status(409).json({
        error: "Deve restare almeno un amministratore attivo",
      });
      return;
    }
  }

  const updates: Partial<typeof utentiTable.$inferInsert> = {};
  if (body.nome !== undefined) updates.nome = body.nome;
  if (body.cognome !== undefined) updates.cognome = body.cognome;
  if (body.matricola !== undefined) updates.matricola = body.matricola;
  if (body.ruoloId !== undefined) updates.ruoloId = body.ruoloId;
  if (body.attivo !== undefined) updates.attivo = body.attivo;
  // A centro-bound admin cannot move users to another centro; only a global
  // admin may (re)assign the centro.
  if (caller == null && body.centroAscoltoId !== undefined) {
    updates.centroAscoltoId = body.centroAscoltoId;
  }
  // A città-bound admin cannot move users to another città; only a città-global
  // admin may (re)assign the città.
  if (cittaCaller == null && body.cittaId !== undefined) {
    updates.cittaId = body.cittaId;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(utentiTable).set(updates).where(eq(utentiTable.id, id));
  }

  const [row] = await selectUtente().where(eq(utentiTable.id, id));
  res.json(fmt(row));
});

router.delete("/utenti/:id", async (req, res): Promise<void> => {
  const id = parseInt(
    Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    10,
  );

  if (req.user!.id === id) {
    res.status(400).json({ error: "Non puoi eliminare il tuo account" });
    return;
  }

  const [target] = await db
    .select()
    .from(utentiTable)
    .where(eq(utentiTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Utente non trovato" });
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

  const isActiveAdmin =
    target.attivo && (await roleIsAdmin(target.ruoloId));
  if (isActiveAdmin && !(await otherActiveAdminExists(id))) {
    res
      .status(409)
      .json({ error: "Deve restare almeno un amministratore attivo" });
    return;
  }

  await db.delete(utentiTable).where(eq(utentiTable.id, id));
  res.status(204).send();
});

router.post("/utenti/:id/reset-password", async (req, res): Promise<void> => {
  const id = parseInt(
    Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    10,
  );
  const parsed = ResetUtentePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [target] = await db
    .select({ id: utentiTable.id, centroAscoltoId: utentiTable.centroAscoltoId, cittaId: utentiTable.cittaId })
    .from(utentiTable)
    .where(eq(utentiTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Utente non trovato" });
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

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db
    .update(utentiTable)
    .set({ passwordHash, mustChangePassword: true })
    .where(eq(utentiTable.id, id));

  res.status(204).send();
});

export default router;
