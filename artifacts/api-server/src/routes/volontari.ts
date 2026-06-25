import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { volontariTable, centriAscoltoTable } from "@workspace/db";
import { eq, getTableColumns } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  centroScopeFilter,
  canAccessCentro,
  visibleCentroIds,
  idSetScopeFilter,
  inVisibleCentroSet,
  andScoped,
} from "../lib/centroScope";

const router: IRouter = Router();

type VolontarioRow = typeof volontariTable.$inferSelect & {
  centroAscoltoNome: string | null;
};

const fmt = (r: VolontarioRow) => ({
  id: r.id,
  nome: r.nome,
  cognome: r.cognome,
  centroAscoltoId: r.centroAscoltoId ?? null,
  centroAscoltoNome: r.centroAscoltoNome ?? null,
  telefono: r.telefono ?? null,
  email: r.email ?? null,
  ruolo: r.ruolo,
  patente: r.patente,
  mezzoPersonale: r.mezzoPersonale,
  maxConsegneTurno: r.maxConsegneTurno,
  attivo: r.attivo,
  note: r.note ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

const selectVolontario = () =>
  db
    .select({
      ...getTableColumns(volontariTable),
      centroAscoltoNome: centriAscoltoTable.nome,
    })
    .from(volontariTable)
    .leftJoin(centriAscoltoTable, eq(volontariTable.centroAscoltoId, centriAscoltoTable.id));

router.get("/volontari", async (req, res) => {
  const cittaCentroIds = await visibleCentroIds(callerCittaId(req));
  const rows = await selectVolontario()
    .where(
      andScoped(
        centroScopeFilter(volontariTable.centroAscoltoId, callerCentroId(req)),
        idSetScopeFilter(volontariTable.centroAscoltoId, cittaCentroIds),
      ),
    )
    .orderBy(volontariTable.cognome);
  res.json(rows.map(fmt));
});

router.post("/volontari", async (req, res) => {
  const caller = callerCentroId(req);
  const values = { ...req.body };
  if (caller != null) values.centroAscoltoId = caller;
  if (caller == null && values.centroAscoltoId != null
      && !inVisibleCentroSet(values.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Centro non accessibile per la tua città" });
    return;
  }
  const [created] = await db.insert(volontariTable).values(values).returning({ id: volontariTable.id });
  const [row] = await selectVolontario().where(eq(volontariTable.id, created.id));
  res.status(201).json(fmt(row));
});

router.get("/volontari/:id", async (req, res) => {
  const [row] = await selectVolontario().where(eq(volontariTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(row.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(row.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  res.json(fmt(row));
});

router.patch("/volontari/:id", async (req, res) => {
  const caller = callerCentroId(req);
  const [existing] = await db.select().from(volontariTable).where(eq(volontariTable.id, parseInt(req.params.id)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(existing.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  const updates = { ...req.body };
  if (caller != null) delete updates.centroAscoltoId;
  const [updated] = await db.update(volontariTable).set(updates).where(eq(volontariTable.id, parseInt(req.params.id))).returning({ id: volontariTable.id });
  const [row] = await selectVolontario().where(eq(volontariTable.id, updated.id));
  res.json(fmt(row));
});

router.delete("/volontari/:id", async (req, res) => {
  const caller = callerCentroId(req);
  const [existing] = await db.select().from(volontariTable).where(eq(volontariTable.id, parseInt(req.params.id)));
  if (!existing) { res.status(204).send(); return; }
  if (!canAccessCentro(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(existing.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  await db.delete(volontariTable).where(eq(volontariTable.id, parseInt(req.params.id)));
  res.status(204).send();
});

export default router;
