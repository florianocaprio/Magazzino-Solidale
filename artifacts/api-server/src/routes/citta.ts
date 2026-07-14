import { Router, type IRouter } from "express";
import {
  db,
  cittaTable,
  zoneUdsTable,
  beneficiariTable,
  utentiTable,
  centriAscoltoTable,
  magazziniTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateCittaBody, UpdateCittaBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";
import { callerCittaId } from "../lib/centroScope";

const router: IRouter = Router();

function fmt(r: typeof cittaTable.$inferSelect) {
  return {
    id: r.id,
    nome: r.nome,
    provincia: r.provincia ?? null,
    sigla: r.sigla ?? null,
    attivo: r.attivo,
    note: r.note ?? null,
    dataCreazione: r.dataCreazione.toISOString(),
  };
}

// City is a HARD boundary: a città-scoped caller only ever sees their own città.
router.get("/citta", async (req, res) => {
  const cittaId = callerCittaId(req);
  const rows =
    cittaId == null
      ? await db.select().from(cittaTable).orderBy(cittaTable.nome)
      : await db
          .select()
          .from(cittaTable)
          .where(eq(cittaTable.id, cittaId))
          .orderBy(cittaTable.nome);
  res.json(rows.map(fmt));
});

router.get("/citta/:id", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const cittaId = callerCittaId(req);
  if (cittaId != null && cittaId !== id) {
    res.status(403).json({ error: "Città non accessibile per il tuo profilo" });
    return;
  }
  const [row] = await db.select().from(cittaTable).where(eq(cittaTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.post("/citta", requireAdmin, async (req, res) => {
  const result = CreateCittaBody.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Inserimento area non valido" });
    return;
  }
  const values = result.data;
  if (values.sigla) values.sigla = values.sigla.toUpperCase();
  const [row] = await db.insert(cittaTable).values(values).returning();
  res.status(201).json(fmt(row));
});

router.patch("/citta/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const result = UpdateCittaBody.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Modifica area non valida" });
    return;
  }
  const values = result.data;
  if (values.sigla) values.sigla = values.sigla.toUpperCase();
  const [row] = await db
    .update(cittaTable)
    .set(values)
    .where(eq(cittaTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.delete("/citta/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  // Clear all FK references before deleting (FKs are RESTRICT by default).
  await db
    .update(beneficiariTable)
    .set({ cittaId: null, zonaUdsId: null })
    .where(eq(beneficiariTable.cittaId, id));
  await db
    .update(utentiTable)
    .set({ cittaId: null, zonaUdsId: null })
    .where(eq(utentiTable.cittaId, id));
  await db
    .update(centriAscoltoTable)
    .set({ cittaId: null })
    .where(eq(centriAscoltoTable.cittaId, id));
  await db
    .update(magazziniTable)
    .set({ cittaId: null })
    .where(eq(magazziniTable.cittaId, id));
  await db.delete(zoneUdsTable).where(eq(zoneUdsTable.cittaId, id));
  await db.delete(cittaTable).where(eq(cittaTable.id, id));
  res.status(204).send();
});

export default router;
