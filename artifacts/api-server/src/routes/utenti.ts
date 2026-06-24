import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, utentiTable, ruoliTable } from "@workspace/db";
import {
  CreateUtenteBody,
  UpdateUtenteBody,
  ResetUtentePasswordBody,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.use("/utenti", requireAuth, requireAdmin);

type UtenteRow = {
  id: number;
  username: string;
  nome: string;
  matricola: string | null;
  ruoloId: number | null;
  ruoloNome: string | null;
  attivo: boolean;
  mustChangePassword: boolean;
  ultimoAccesso: Date | null;
  dataCreazione: Date;
};

const fmt = (r: UtenteRow) => ({
  id: r.id,
  username: r.username,
  nome: r.nome,
  matricola: r.matricola ?? null,
  ruoloId: r.ruoloId ?? null,
  ruoloNome: r.ruoloNome ?? null,
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
      matricola: utentiTable.matricola,
      ruoloId: utentiTable.ruoloId,
      ruoloNome: ruoliTable.nome,
      attivo: utentiTable.attivo,
      mustChangePassword: utentiTable.mustChangePassword,
      ultimoAccesso: utentiTable.ultimoAccesso,
      dataCreazione: utentiTable.dataCreazione,
    })
    .from(utentiTable)
    .leftJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id));

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

async function roleIsAdmin(ruoloId: number | null): Promise<boolean> {
  if (ruoloId == null) return false;
  const [r] = await db
    .select({ isAdmin: ruoliTable.isAdmin })
    .from(ruoliTable)
    .where(eq(ruoliTable.id, ruoloId));
  return r?.isAdmin ?? false;
}

router.get("/utenti", async (_req, res): Promise<void> => {
  const rows = await selectUtente().orderBy(utentiTable.username);
  res.json(rows.map(fmt));
});

router.post("/utenti", async (req, res): Promise<void> => {
  const parsed = CreateUtenteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, password, nome, matricola, ruoloId, attivo } = parsed.data;

  const [existing] = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(eq(utentiTable.username, username));
  if (existing) {
    res.status(409).json({ error: "Username già esistente" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [created] = await db
    .insert(utentiTable)
    .values({
      username,
      passwordHash,
      nome,
      matricola: matricola ?? null,
      ruoloId: ruoloId ?? null,
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
  if (body.matricola !== undefined) updates.matricola = body.matricola;
  if (body.ruoloId !== undefined) updates.ruoloId = body.ruoloId;
  if (body.attivo !== undefined) updates.attivo = body.attivo;

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
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(eq(utentiTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Utente non trovato" });
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
