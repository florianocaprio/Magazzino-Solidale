import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { impostazioniStampaTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const SINGLETON_ID = 1;
const VALID_TEMPLATES = ["standard", "moderno", "minimal"] as const;

function fmt(r: typeof impostazioniStampaTable.$inferSelect) {
  return {
    templateBolla: r.templateBolla,
    footerBolla: r.footerBolla ?? null,
    dataAggiornamento: r.dataAggiornamento.toISOString(),
  };
}

async function ensureRow() {
  await db
    .insert(impostazioniStampaTable)
    .values({ id: SINGLETON_ID })
    .onConflictDoNothing();
  const [row] = await db.select().from(impostazioniStampaTable).where(eq(impostazioniStampaTable.id, SINGLETON_ID));
  return row;
}

router.get("/impostazioni-stampa", async (_req, res) => {
  const row = await ensureRow();
  res.json(fmt(row));
});

router.put("/impostazioni-stampa", async (req, res) => {
  const { templateBolla, footerBolla } = req.body ?? {};
  if (templateBolla !== undefined && !VALID_TEMPLATES.includes(templateBolla)) {
    res.status(400).json({ error: `templateBolla deve essere uno tra: ${VALID_TEMPLATES.join(", ")}` });
    return;
  }
  await ensureRow();
  const [row] = await db
    .update(impostazioniStampaTable)
    .set({
      ...(templateBolla !== undefined ? { templateBolla } : {}),
      ...(footerBolla !== undefined ? { footerBolla } : {}),
      dataAggiornamento: new Date(),
    })
    .where(eq(impostazioniStampaTable.id, SINGLETON_ID))
    .returning();
  res.json(fmt(row));
});

export default router;
