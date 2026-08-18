import { Router, type IRouter } from "express";
import { db, impostazioniEmailTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireGlobalAdmin } from "../lib/adminScope";

const router: IRouter = Router();

const SINGLETON_ID = 1;
const LEGACY_TRANSPORT_FIELDS = ["provider", "smtpHost", "smtpPort", "smtpSecure", "smtpUser", "smtpPassword"] as const;

function fmt(r: typeof impostazioniEmailTable.$inferSelect) {
  // smtpPassword is write-only: never returned, only a hasPassword flag.
  return {
    provider: r.provider,
    mittenteEmail: r.mittenteEmail ?? null,
    mittenteNome: r.mittenteNome ?? null,
    adminEmail: r.adminEmail ?? null,
    smtpHost: r.smtpHost ?? null,
    smtpPort: r.smtpPort ?? null,
    smtpSecure: r.smtpSecure,
    smtpUser: r.smtpUser ?? null,
    hasPassword: !!(r.smtpPassword && r.smtpPassword.length > 0),
    smtpManagedByEnvironment: true,
    dataAggiornamento: r.dataAggiornamento.toISOString(),
  };
}

async function ensureRow() {
  await db.insert(impostazioniEmailTable).values({ id: SINGLETON_ID }).onConflictDoNothing();
  const [row] = await db.select().from(impostazioniEmailTable).where(eq(impostazioniEmailTable.id, SINGLETON_ID));
  return row;
}

router.get("/impostazioni-email", async (_req, res) => {
  const row = await ensureRow();
  res.json(fmt(row));
});

router.put("/impostazioni-email", requireGlobalAdmin, async (req, res) => {
  const b = req.body ?? {};
  if (LEGACY_TRANSPORT_FIELDS.some((field) => b[field] !== undefined)) {
    res.status(400).json({
      error: "Il trasporto SMTP è gestito tramite variabili MAIL_* e secret di ambiente; le credenziali non vengono salvate nel database.",
    });
    return;
  }
  await ensureRow();

  const updates: Partial<typeof impostazioniEmailTable.$inferInsert> = {
    dataAggiornamento: new Date(),
  };
  if (b.mittenteEmail !== undefined) updates.mittenteEmail = b.mittenteEmail || null;
  if (b.mittenteNome !== undefined) updates.mittenteNome = b.mittenteNome || null;
  if (b.adminEmail !== undefined) updates.adminEmail = b.adminEmail || null;

  const [row] = await db.update(impostazioniEmailTable).set(updates).where(eq(impostazioniEmailTable.id, SINGLETON_ID)).returning();
  res.json(fmt(row));
});

export default router;
