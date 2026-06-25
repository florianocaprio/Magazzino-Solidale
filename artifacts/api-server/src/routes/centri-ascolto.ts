import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { centriAscoltoTable, beneficiariTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import {
  callerCittaId,
  cittaScopeFilter,
  canAccessCitta,
} from "../lib/centroScope";

const router: IRouter = Router();

function fmt(r: typeof centriAscoltoTable.$inferSelect, beneficiariCount = 0) {
  return {
    id: r.id,
    nome: r.nome,
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

router.post("/centri-ascolto", async (req, res) => {
  const cid = callerCittaId(req);
  const values = { ...req.body };
  if (cid != null) values.cittaId = cid;
  const [row] = await db.insert(centriAscoltoTable).values(values).returning();
  res.status(201).json(fmt(row));
});

router.get("/centri-ascolto/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCitta(row.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  const [c] = await db.select({ n: count() }).from(beneficiariTable).where(eq(beneficiariTable.centroAscoltoId, id));
  res.json(fmt(row, c?.n ?? 0));
});

router.patch("/centri-ascolto/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const cid = callerCittaId(req);
  const [existing] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCitta(existing.cittaId, cid)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  const updates = { ...req.body };
  if (cid != null) delete updates.cittaId;
  const [row] = await db.update(centriAscoltoTable).set(updates).where(eq(centriAscoltoTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row));
});

router.delete("/centri-ascolto/:id", async (req, res) => {
  const id = parseInt(req.params.id);
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
