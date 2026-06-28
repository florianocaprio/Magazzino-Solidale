import { Router, type IRouter } from "express";
import { db, impostazioniEmailTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

const SINGLETON_ID = 1;
const VALID_PROVIDERS = ["connector", "smtp"] as const;

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

router.put("/impostazioni-email", requireAdmin, async (req, res) => {
  const b = req.body ?? {};
  if (b.provider !== undefined && !VALID_PROVIDERS.includes(b.provider)) {
    res.status(400).json({ error: `provider deve essere uno tra: ${VALID_PROVIDERS.join(", ")}` });
    return;
  }
  await ensureRow();

  const updates: Partial<typeof impostazioniEmailTable.$inferInsert> = { dataAggiornamento: new Date() };
  if (b.provider !== undefined) updates.provider = b.provider;
  if (b.mittenteEmail !== undefined) updates.mittenteEmail = b.mittenteEmail || null;
  if (b.mittenteNome !== undefined) updates.mittenteNome = b.mittenteNome || null;
  if (b.adminEmail !== undefined) updates.adminEmail = b.adminEmail || null;
  if (b.smtpHost !== undefined) updates.smtpHost = b.smtpHost || null;
  if (b.smtpPort !== undefined) updates.smtpPort = b.smtpPort === null || b.smtpPort === "" ? null : Number(b.smtpPort);
  if (b.smtpSecure !== undefined) updates.smtpSecure = !!b.smtpSecure;
  if (b.smtpUser !== undefined) updates.smtpUser = b.smtpUser || null;
  // Password is write-only: only overwrite when a non-empty value is sent.
  // Send an empty string explicitly to clear it.
  if (b.smtpPassword !== undefined) {
    if (b.smtpPassword === "") updates.smtpPassword = null;
    else if (typeof b.smtpPassword === "string") updates.smtpPassword = b.smtpPassword;
  }

  const [row] = await db
    .update(impostazioniEmailTable)
    .set(updates)
    .where(eq(impostazioniEmailTable.id, SINGLETON_ID))
    .returning();
  res.json(fmt(row));
});

export default router;
