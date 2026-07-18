import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, utentiTable } from "@workspace/db";
import { LoginUserBody, ChangePasswordBody } from "@workspace/api-zod";
import { loadSessionUser, requireAuth, type SessionUser } from "../middlewares/auth";
import { isBootstrapMode } from "../lib/bootstrap";
import { logSystemEvent, systemLogMetaFromRequest } from "../lib/systemLog";

const router: IRouter = Router();

const SESSION_COOKIE = "magazzino.sid";

// Public: tells the frontend whether the system still needs first-run setup
// (no administrator exists yet). When true, the app shows the setup screen
// instead of the login screen.
router.get("/auth/bootstrap-status", async (_req, res): Promise<void> => {
  res.json({ bootstrap: await isBootstrapMode() });
});

function authUserResponse(u: SessionUser) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    emailDaAggiornare: u.emailDaAggiornare,
    nome: u.nome,
    cognome: u.cognome,
    matricola: u.matricola,
    ruoloId: u.ruoloId,
    ruoloNome: u.ruoloNome,
    centroAscoltoId: u.centroAscoltoId,
    centroAscoltoNome: u.centroAscoltoNome,
    cittaId: u.cittaId,
    cittaNome: u.cittaNome,
    zonaUdsId: u.zonaUdsId,
    zonaUdsNome: u.zonaUdsNome,
    isSuperAdmin: u.isSuperAdmin,
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

  const [row] = await db.select().from(utentiTable).where(eq(utentiTable.username, username));

  if (!row || !row.attivo) {
    await logSystemEvent({
      evento: "LOGIN_FAILED",
      esito: "FAILED",
      username,
      ...systemLogMetaFromRequest(req),
      details: { reason: "invalid_credentials_or_inactive" },
    });
    res.status(401).json({ error: "Credenziali non valide" });
    return;
  }

  const ok = await bcrypt.compare(password, row.passwordHash);
  if (!ok) {
    await logSystemEvent({
      evento: "LOGIN_FAILED",
      esito: "FAILED",
      targetUserId: row.id,
      userEmail: row.email,
      username: row.username,
      ...systemLogMetaFromRequest(req),
      details: { reason: "invalid_password" },
    });
    res.status(401).json({ error: "Credenziali non valide" });
    return;
  }

  await db.update(utentiTable).set({ ultimoAccesso: new Date() }).where(eq(utentiTable.id, row.id));

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
      void logSystemEvent({
        evento: "LOGIN_SUCCESS",
        esito: "SUCCESS",
        actorUserId: row.id,
        targetUserId: row.id,
        userEmail: row.email,
        username: row.username,
        ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
        userAgent: req.get("user-agent") ?? null,
      });
      res.json(authUserResponse(user));
    });
  });
});

router.post("/auth/logout", (req, res): void => {
  const userId = req.session?.userId ?? null;
  req.session.destroy(() => {
    void logSystemEvent({
      evento: "LOGOUT",
      esito: "SUCCESS",
      actorUserId: userId,
      targetUserId: userId,
      ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    res.clearCookie(SESSION_COOKIE);
    res.status(204).send();
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  res.json(authUserResponse(req.user!));
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { newPassword } = parsed.data;

  const [row] = await db.select().from(utentiTable).where(eq(utentiTable.id, req.user!.id));

  if (!row) {
    res.status(401).json({ error: "Non autenticato" });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await db
    .update(utentiTable)
    .set({
      passwordHash: hash,
      mustChangePassword: false,
      lastPasswordChangeAt: new Date(),
    })
    .where(eq(utentiTable.id, row.id));

  await logSystemEvent({
    evento: "PASSWORD_CHANGED_BY_USER",
    esito: "SUCCESS",
    targetUserId: row.id,
    userEmail: row.email,
    username: row.username,
    ...systemLogMetaFromRequest(req),
  });

  res.status(204).send();
});

export default router;
