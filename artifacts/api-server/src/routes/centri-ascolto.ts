import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  centriAscoltoTable,
  beneficiariTable,
  cittaTable,
} from "@workspace/db";
import { eq, count } from "drizzle-orm";
import {
  CreateCentroAscoltoBody,
  UpdateCentroAscoltoBody,
} from "@workspace/api-zod";
import {
  callerCittaId,
  cittaScopeFilter,
  canAccessCitta,
} from "../lib/centroScope";
import { requireAdmin } from "../middlewares/auth";
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
    cittaId: r.cittaId ?? null,
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

async function cittaExists(cittaId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: cittaTable.id })
    .from(cittaTable)
    .where(eq(cittaTable.id, cittaId));
  return Boolean(row);
}

router.get("/centri-ascolto", async (req, res) => {
  const rows = await db
    .select()
    .from(centriAscoltoTable)
    .where(cittaScopeFilter(centriAscoltoTable.cittaId, callerCittaId(req)))
    .orderBy(centriAscoltoTable.nome);
  const counts = await db
    .select({ centroId: beneficiariTable.centroAscoltoId, n: count() })
    .from(beneficiariTable)
    .groupBy(beneficiariTable.centroAscoltoId);
  const countMap = new Map(counts.map(c => [c.centroId, c.n]));
  res.json(rows.map(r => fmt(r, countMap.get(r.id) ?? 0)));
});

router.post("/centri-ascolto", requireAdmin, async (req, res) => {
  const parsed = CreateCentroAscoltoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Inserimento centro di ascolto non valido" });
    return;
  }
  const cid = callerCittaId(req);
  const values = { ...parsed.data };
  if (cid != null) values.cittaId = cid;
  if (values.cittaId != null && !(await cittaExists(values.cittaId))) {
    res.status(400).json({ error: "L'area selezionata non esiste" });
    return;
  }
  const [row] = await db.insert(centriAscoltoTable).values(values).returning();
  res.status(201).json(fmt(row));
});

router.get("/centri-ascolto/:id", async (req, res) => {
  const id = paramId(req.params.id);
  const [row] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCitta(row.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  const [c] = await db.select({ n: count() }).from(beneficiariTable).where(eq(beneficiariTable.centroAscoltoId, id));
  res.json(fmt(row, c?.n ?? 0));
});

router.patch("/centri-ascolto/:id", requireAdmin, async (req, res) => {
  const id = paramId(req.params.id);
  const cid = callerCittaId(req);
  const [existing] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCitta(existing.cittaId, cid)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  const parsed = UpdateCentroAscoltoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Modifica centro di ascolto non valida" });
    return;
  }
  const updates = { ...parsed.data };
  if (cid != null) delete updates.cittaId;
  if (updates.cittaId != null && !(await cittaExists(updates.cittaId))) {
    res.status(400).json({ error: "L'area selezionata non esiste" });
    return;
  }
  const [row] = await db.update(centriAscoltoTable).set(updates).where(eq(centriAscoltoTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row));
});

router.post(
  "/centri-ascolto/:id/logo",
  requireAdmin,
  express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: MAX_LOGO_BYTES }),
  async (req, res) => {
    const id = paramId(req.params.id);
    const [existing] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
    if (!existing) { res.status(404).json({ error: "Centro di ascolto non trovato" }); return; }
    if (!canAccessCitta(existing.cittaId, callerCittaId(req))) {
      res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
      return;
    }
    const extension = LOGO_TYPES.get(req.get("content-type")?.split(";")[0] ?? "");
    if (!extension || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Il logo deve essere un'immagine PNG, JPEG o WebP valida" });
      return;
    }
    const relativeDir = path.join("centri", String(id));
    const uploadRoot = process.env.UPLOAD_DIR ?? "/app/uploads";
    await mkdir(path.join(uploadRoot, relativeDir), { recursive: true });
    const fileName = `${randomUUID()}${extension}`;
    await writeFile(path.join(uploadRoot, relativeDir, fileName), req.body, { flag: "wx" });
    const logoUrl = `/uploads/${relativeDir.split(path.sep).join("/")}/${fileName}`;
    const [row] = await db.update(centriAscoltoTable).set({ logoUrl }).where(eq(centriAscoltoTable.id, id)).returning();
    res.json(fmt(row));
  },
);

router.delete("/centri-ascolto/:id", requireAdmin, async (req, res) => {
  const id = paramId(req.params.id);
  const [existing] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
  if (!existing) { res.status(204).send(); return; }
  if (!canAccessCitta(existing.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  await db.update(beneficiariTable).set({ centroAscoltoId: null }).where(eq(beneficiariTable.centroAscoltoId, id));
  await db.delete(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
  res.status(204).send();
});

export default router;
