import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { centriAscoltoTable, beneficiariTable, areeOperativeTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { CreateCentroAscoltoBody, UpdateCentroAscoltoBody } from "@workspace/api-zod";
import { callerAreaOperativaId, areaOperativaScopeFilter, canAccessAreaOperativa } from "../lib/centroScope";
import { requireAdmin } from "../middlewares/auth";
import { canMutateScopedResource } from "../lib/adminScope";
import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

function paramId(v: string | string[]): number {
  return parseInt(Array.isArray(v) ? v[0] : v, 10);
}

function fmt(r: typeof centriAscoltoTable.$inferSelect, beneficiariCount = 0) {
  return {
    id: r.id,
    nome: r.nome,
    areaOperativaId: r.areaOperativaId ?? null,
    logoUrl: r.logoUrl ?? null,
    indirizzo: r.indirizzo ?? null,
    comune: r.comune ?? null,
    responsabile: r.responsabile ?? null,
    telefono: r.telefono ?? null,
    email: r.email ?? null,
    attivo: r.attivo,
    note: r.note ?? null,
    beneficiariCount,
    dataCreazione: r.dataCreazione.toISOString(),
  };
}

async function validateAreaAssignment(areaOperativaId: number): Promise<string | null> {
  const [row] = await db.select({ id: areeOperativeTable.id, attivo: areeOperativeTable.attivo }).from(areeOperativeTable).where(eq(areeOperativeTable.id, areaOperativaId));
  if (!row) return "L'Area Operativa selezionata non esiste";
  if (!row.attivo) return "L'Area Operativa selezionata non è attiva";
  return null;
}

router.get("/centri-ascolto", async (req, res) => {
  const rows = await db
    .select()
    .from(centriAscoltoTable)
    .where(areaOperativaScopeFilter(centriAscoltoTable.areaOperativaId, callerAreaOperativaId(req)))
    .orderBy(centriAscoltoTable.nome);
  const counts = await db.select({ centroId: beneficiariTable.centroAscoltoId, n: count() }).from(beneficiariTable).groupBy(beneficiariTable.centroAscoltoId);
  const countMap = new Map(counts.map((c) => [c.centroId, c.n]));
  res.json(rows.map((r) => fmt(r, countMap.get(r.id) ?? 0)));
});

router.post("/centri-ascolto", requireAdmin, async (req, res) => {
  const parsed = CreateCentroAscoltoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Inserimento centro di ascolto non valido" });
    return;
  }
  const cid = callerAreaOperativaId(req);
  const values = { ...parsed.data };
  if (cid != null && values.areaOperativaId != null && values.areaOperativaId !== cid) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" });
    return;
  }
  if (cid != null) values.areaOperativaId = cid;
  if (values.areaOperativaId != null) {
    const areaError = await validateAreaAssignment(values.areaOperativaId);
    if (areaError) {
      res.status(400).json({ error: areaError });
      return;
    }
  }
  const [row] = await db.insert(centriAscoltoTable).values(values).returning();
  res.status(201).json(fmt(row));
});

router.get("/centri-ascolto/:id", async (req, res) => {
  const id = paramId(req.params.id);
  const [row] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!canAccessAreaOperativa(row.areaOperativaId, callerAreaOperativaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua area operativa" });
    return;
  }
  const [c] = await db.select({ n: count() }).from(beneficiariTable).where(eq(beneficiariTable.centroAscoltoId, id));
  res.json(fmt(row, c?.n ?? 0));
});

router.patch("/centri-ascolto/:id", requireAdmin, async (req, res) => {
  const id = paramId(req.params.id);
  const cid = callerAreaOperativaId(req);
  const [existing] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!canMutateScopedResource(existing.areaOperativaId, cid)) {
    res.status(403).json({ error: "Centro non modificabile per il tuo profilo" });
    return;
  }
  const parsed = UpdateCentroAscoltoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Modifica centro di ascolto non valida" });
    return;
  }
  const updates = { ...parsed.data };
  if (cid != null && updates.areaOperativaId !== undefined && updates.areaOperativaId !== cid) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" });
    return;
  }
  if (cid != null) delete updates.areaOperativaId;
  if (updates.areaOperativaId != null) {
    const areaError = await validateAreaAssignment(updates.areaOperativaId);
    if (areaError) {
      res.status(400).json({ error: areaError });
      return;
    }
  }
  const [row] = await db.update(centriAscoltoTable).set(updates).where(eq(centriAscoltoTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.post(
  "/centri-ascolto/:id/logo",
  requireAdmin,
  express.raw({
    type: ["image/png", "image/jpeg", "image/webp"],
    limit: MAX_LOGO_BYTES,
  }),
  async (req, res) => {
    const id = paramId(req.params.id);
    const [existing] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Centro di ascolto non trovato" });
      return;
    }
    if (!canMutateScopedResource(existing.areaOperativaId, callerAreaOperativaId(req))) {
      res.status(403).json({ error: "Centro non modificabile per il tuo profilo" });
      return;
    }
    const extension = LOGO_TYPES.get(req.get("content-type")?.split(";")[0] ?? "");
    if (!extension || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({
        error: "Il logo deve essere un'immagine PNG, JPEG o WebP valida",
      });
      return;
    }
    const relativeDir = path.join("centri", String(id));
    const uploadRoot = process.env.UPLOAD_DIR ?? "/app/uploads";
    await mkdir(path.join(uploadRoot, relativeDir), { recursive: true });
    const fileName = `${randomUUID()}${extension}`;
    await writeFile(path.join(uploadRoot, relativeDir, fileName), req.body, {
      flag: "wx",
    });
    const logoUrl = `/uploads/${relativeDir.split(path.sep).join("/")}/${fileName}`;
    const [row] = await db.update(centriAscoltoTable).set({ logoUrl }).where(eq(centriAscoltoTable.id, id)).returning();
    res.json(fmt(row));
  },
);

router.delete("/centri-ascolto/:id", requireAdmin, async (req, res) => {
  const id = paramId(req.params.id);
  const [existing] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
  if (!existing) {
    res.status(204).send();
    return;
  }
  if (!canMutateScopedResource(existing.areaOperativaId, callerAreaOperativaId(req))) {
    res.status(403).json({ error: "Centro non modificabile per il tuo profilo" });
    return;
  }
  await db.update(centriAscoltoTable).set({ attivo: false }).where(eq(centriAscoltoTable.id, id));
  res.status(204).send();
});

export default router;
