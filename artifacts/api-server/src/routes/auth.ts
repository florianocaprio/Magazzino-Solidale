import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, utentiTable } from "@workspace/db";
import { LoginUserBody, ChangePasswordBody } from "@workspace/api-zod";
import {
  loadSessionUser,
  requireAuth,
  type SessionUser,
} from "../middlewares/auth";

const router: IRouter = Router();

const SESSION_COOKIE = "magazzino.sid";

function authUserResponse(u: SessionUser) {
  return {
    id: u.id,
    username: u.username,
    nome: u.nome,
    matricola: u.matricola,
    ruoloId: u.ruoloId,
    ruoloNome: u.ruoloNome,
    isAdmin: u.isAdmin,
    aree: u.aree,
    mustChangePassword: u.mustChangePassword,
  };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, password } = parsed.data;

  const [row] = await db
    .select()
    .from(utentiTable)
    .where(eq(utentiTable.username, username));

  if (!row || !row.attivo) {
    res.status(401).json({ error: "Credenziali non valide" });
    return;
  }

  const ok = await bcrypt.compare(password, row.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Credenziali non valide" });
    return;
  }

  await db
    .update(utentiTable)
    .set({ ultimoAccesso: new Date() })
    .where(eq(utentiTable.id, row.id));

  const user = await loadSessionUser(row.id);
  if (!user) {
    res.status(401).json({ error: "Credenziali non valide" });
    return;
  }

  // Regenerate the session id on login to prevent session fixation.
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      req.log.error({ err: regenErr }, "Failed to regenerate session on login");
      res.status(500).json({ error: "Errore di sessione" });
      return;
    }
    req.session.userId = row.id;
    req.session.save((err) => {
      if (err) {
        req.log.error({ err }, "Failed to persist session on login");
        res.status(500).json({ error: "Errore di sessione" });
        return;
      }
      res.json(authUserResponse(user));
    });
  });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.clearCookie(SESSION_COOKIE);
    res.status(204).send();
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  res.json(authUserResponse(req.user!));
});

router.post(
  "/auth/change-password",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = ChangePasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { currentPassword, newPassword } = parsed.data;

    const [row] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, req.user!.id));

    if (!row) {
      res.status(401).json({ error: "Non autenticato" });
      return;
    }

    const ok = await bcrypt.compare(currentPassword, row.passwordHash);
    if (!ok) {
      res.status(400).json({ error: "Password attuale non corretta" });
      return;
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db
      .update(utentiTable)
      .set({ passwordHash: hash, mustChangePassword: false })
      .where(eq(utentiTable.id, row.id));

    res.status(204).send();
  },
);

export default router;
