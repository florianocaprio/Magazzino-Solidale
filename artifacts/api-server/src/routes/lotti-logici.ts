import { Router, type IRouter } from "express";
import {
  db,
  lottiLogiciTable,
  lottiTable,
  movimentiTable,
  trasferimentiTable,
} from "@workspace/db";
import { and, asc, eq, inArray, ne, or, sql, sum } from "drizzle-orm";
import {
  auditContextFromRequest,
  auditFields,
  auditUserId,
  recordAuditEvent,
} from "../lib/auditEvent";
import { callerAreaOperativaId } from "../lib/centroScope";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

class LogicalLotRouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new LogicalLotRouteError(400, `${field} non valido`);
  }
  return id;
}

function optionalText(value: unknown, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string")
    throw new LogicalLotRouteError(400, "Testo non valido");
  const normalized = value.trim();
  if (normalized.length > max)
    throw new LogicalLotRouteError(400, `Testo troppo lungo (massimo ${max})`);
  return normalized || null;
}

function optionalDate(value: unknown, field: string): string | null {
  const normalized = optionalText(value, 10);
  if (normalized != null && !DATE_ONLY.test(normalized)) {
    throw new LogicalLotRouteError(400, `${field} deve essere YYYY-MM-DD`);
  }
  return normalized;
}

function requireAreaScope(
  req: Parameters<typeof callerAreaOperativaId>[0],
  areaOperativaId: number,
) {
  const scopedAreaId = callerAreaOperativaId(req);
  if (scopedAreaId != null && scopedAreaId !== areaOperativaId) {
    throw new LogicalLotRouteError(
      403,
      "Area non accessibile per il tuo profilo",
    );
  }
}

async function derivedState(logicalLotId: number) {
  const [stock] = await db
    .select({
      dettagli: sql<number>`count(${lottiTable.id})::int`,
      residuo: sum(lottiTable.quantitaResidua),
    })
    .from(lottiTable)
    .where(eq(lottiTable.lottoLogicoId, logicalLotId));
  const [inTransit] = await db
    .select({ id: movimentiTable.id })
    .from(movimentiTable)
    .innerJoin(
      trasferimentiTable,
      eq(movimentiTable.trasferimentoId, trasferimentiTable.id),
    )
    .innerJoin(lottiTable, eq(movimentiTable.lottoId, lottiTable.id))
    .where(
      and(
        eq(lottiTable.lottoLogicoId, logicalLotId),
        inArray(trasferimentiTable.stato, ["in_transito", "rientro_atteso"]),
        eq(movimentiTable.tipoMovimento, "trasferimento"),
        eq(movimentiTable.tipoDettaglio, "uscita"),
      ),
    )
    .limit(1);
  const dettagli = stock?.dettagli ?? 0;
  const inTransito = inTransit != null;
  const quantitaResiduaPrecisa = stock?.residuo ?? "0";
  return {
    maiCaricato: dettagli === 0,
    esaurito:
      dettagli > 0 &&
      !inTransito &&
      /^0(?:\.0+)?$/.test(quantitaResiduaPrecisa),
    inTransito,
    quantitaResiduaPrecisa,
  };
}

async function formatLogicalLot(row: typeof lottiLogiciTable.$inferSelect) {
  return {
    id: row.id,
    areaOperativaId: row.areaOperativaId,
    codice: row.codice,
    descrizione: row.descrizione,
    dataInizio: row.dataInizio ?? null,
    dataFine: row.dataFine ?? null,
    note: row.note ?? null,
    stato: row.stato,
    isGenerale: row.isGenerale,
    creatoDa: row.creatoDa ?? null,
    aggiornatoDa: row.aggiornatoDa ?? null,
    dataCreazione: row.dataCreazione.toISOString(),
    dataAggiornamento: row.dataAggiornamento.toISOString(),
    ...(await derivedState(row.id)),
  };
}

async function loadScoped(
  req: Parameters<typeof callerAreaOperativaId>[0],
  id: number,
) {
  const [row] = await db
    .select()
    .from(lottiLogiciTable)
    .where(eq(lottiLogiciTable.id, id));
  if (!row) throw new LogicalLotRouteError(404, "Lotto logico non trovato");
  requireAreaScope(req, row.areaOperativaId);
  return row;
}

router.get(
  "/lotti-logici",
  requirePermission("magazzino.view"),
  async (req, res) => {
    try {
      const scopedAreaId = callerAreaOperativaId(req);
      const requestedAreaId =
        req.query.areaOperativaId == null
          ? scopedAreaId
          : positiveId(req.query.areaOperativaId, "areaOperativaId");
      if (requestedAreaId == null)
        throw new LogicalLotRouteError(400, "areaOperativaId obbligatorio");
      requireAreaScope(req, requestedAreaId);
      const includeStorico = req.query.includeStorico === "true";
      const rows = await db
        .select()
        .from(lottiLogiciTable)
        .where(
          and(
            eq(lottiLogiciTable.areaOperativaId, requestedAreaId),
            includeStorico
              ? undefined
              : or(
                  eq(lottiLogiciTable.stato, "aperto"),
                  eq(lottiLogiciTable.isGenerale, true),
                ),
          ),
        )
        .orderBy(
          sql`${lottiLogiciTable.isGenerale} desc`,
          asc(lottiLogiciTable.codice),
        );
      res.json(await Promise.all(rows.map(formatLogicalLot)));
    } catch (error) {
      if (error instanceof LogicalLotRouteError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/lotti-logici/:id",
  requirePermission("magazzino.view"),
  async (req, res) => {
    try {
      res.json(
        await formatLogicalLot(
          await loadScoped(req, positiveId(req.params.id, "id")),
        ),
      );
    } catch (error) {
      if (error instanceof LogicalLotRouteError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

router.post(
  "/lotti-logici",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    try {
      const areaOperativaId = positiveId(
        req.body?.areaOperativaId,
        "areaOperativaId",
      );
      requireAreaScope(req, areaOperativaId);
      const codice = optionalText(req.body?.codice, 80)?.toLocaleUpperCase(
        "it-IT",
      );
      const descrizione = optionalText(req.body?.descrizione, 200);
      if (!codice || !descrizione)
        throw new LogicalLotRouteError(
          400,
          "Codice e descrizione sono obbligatori",
        );
      if (codice === "GENERALE")
        throw new LogicalLotRouteError(
          409,
          "Il codice GENERALE è riservato al sistema",
        );
      const command = auditContextFromRequest(req);
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(lottiLogiciTable)
          .values({
            areaOperativaId,
            codice,
            descrizione,
            dataInizio: optionalDate(req.body?.dataInizio, "dataInizio"),
            dataFine: optionalDate(req.body?.dataFine, "dataFine"),
            note: optionalText(req.body?.note, 4000),
            creatoDa: auditUserId(command),
            aggiornatoDa: auditUserId(command),
          })
          .returning();
        await recordAuditEvent(tx, {
          command,
          azione: "LOTTO_LOGICO_CREATO",
          entitaTipo: "lotto_logico",
          entitaId: created.id,
          areaOperativaIdSnapshot: areaOperativaId,
          changes: auditFields(created, [
            "codice",
            "descrizione",
            "dataInizio",
            "dataFine",
            "stato",
          ]),
        });
        return created;
      });
      res.status(201).json(await formatLogicalLot(row));
    } catch (error) {
      if (error instanceof LogicalLotRouteError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      const pg = error as { code?: string };
      if (pg?.code === "23505") {
        res
          .status(409)
          .json({ error: "Codice lotto logico già presente nell'Area" });
        return;
      }
      throw error;
    }
  },
);

router.patch(
  "/lotti-logici/:id",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id, "id");
      const existing = await loadScoped(req, id);
      if (existing.isGenerale)
        throw new LogicalLotRouteError(409, "Il Lotto Generale è immutabile");
      const allowed = new Set([
        "codice",
        "descrizione",
        "dataInizio",
        "dataFine",
        "note",
      ]);
      const unsupported = Object.keys(req.body ?? {}).filter(
        (key) => !allowed.has(key),
      );
      if (unsupported.length)
        throw new LogicalLotRouteError(
          400,
          `Campi non modificabili: ${unsupported.join(", ")}`,
        );
      const update: Record<string, unknown> = { dataAggiornamento: new Date() };
      if ("codice" in req.body) {
        const codice = optionalText(req.body.codice, 80)?.toLocaleUpperCase(
          "it-IT",
        );
        if (!codice || codice === "GENERALE")
          throw new LogicalLotRouteError(400, "Codice non valido");
        update.codice = codice;
      }
      if ("descrizione" in req.body) {
        const value = optionalText(req.body.descrizione, 200);
        if (!value)
          throw new LogicalLotRouteError(400, "Descrizione obbligatoria");
        update.descrizione = value;
      }
      if ("dataInizio" in req.body)
        update.dataInizio = optionalDate(req.body.dataInizio, "dataInizio");
      if ("dataFine" in req.body)
        update.dataFine = optionalDate(req.body.dataFine, "dataFine");
      if ("note" in req.body) update.note = optionalText(req.body.note, 4000);
      const command = auditContextFromRequest(req);
      update.aggiornatoDa = auditUserId(command);
      const row = await db.transaction(async (tx) => {
        const [changed] = await tx
          .update(lottiLogiciTable)
          .set(update)
          .where(eq(lottiLogiciTable.id, id))
          .returning();
        await recordAuditEvent(tx, {
          command,
          azione: "LOTTO_LOGICO_MODIFICATO",
          entitaTipo: "lotto_logico",
          entitaId: id,
          areaOperativaIdSnapshot: existing.areaOperativaId,
          changes: auditFields(update, [
            "codice",
            "descrizione",
            "dataInizio",
            "dataFine",
            "note",
          ]),
        });
        return changed;
      });
      res.json(await formatLogicalLot(row));
    } catch (error) {
      if (error instanceof LogicalLotRouteError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      const pg = error as { code?: string };
      if (pg?.code === "23505") {
        res
          .status(409)
          .json({ error: "Codice lotto logico già presente nell'Area" });
        return;
      }
      throw error;
    }
  },
);

async function transition(
  req: Parameters<typeof callerAreaOperativaId>[0],
  id: number,
  action: "chiudi" | "riapri" | "archivia",
  body: Record<string, unknown>,
) {
  const existing = await loadScoped(req, id);
  if (existing.isGenerale)
    throw new LogicalLotRouteError(
      409,
      "Il Lotto Generale non può essere chiuso o archiviato",
    );
  const transitions = {
    chiudi: { from: ["aperto"], to: "chiuso", audit: "LOTTO_LOGICO_CHIUSO" },
    riapri: {
      from: ["chiuso", "archiviato"],
      to: "aperto",
      audit: "LOTTO_LOGICO_RIAPERTO",
    },
    archivia: {
      from: ["chiuso"],
      to: "archiviato",
      audit: "LOTTO_LOGICO_ARCHIVIATO",
    },
  } as const;
  const spec = transitions[action];
  if (!(spec.from as readonly string[]).includes(existing.stato)) {
    throw new LogicalLotRouteError(
      409,
      `Transizione ${action} non ammessa dallo stato ${existing.stato}`,
    );
  }
  const motivo = optionalText(body?.motivo, 1000);
  if (action === "riapri" && !motivo)
    throw new LogicalLotRouteError(
      400,
      "Motivo obbligatorio per la riapertura",
    );
  const command = auditContextFromRequest(req);
  return db.transaction(async (tx) => {
    const [changed] = await tx
      .update(lottiLogiciTable)
      .set({
        stato: spec.to,
        aggiornatoDa: auditUserId(command),
        dataAggiornamento: new Date(),
      })
      .where(
        and(
          eq(lottiLogiciTable.id, id),
          inArray(lottiLogiciTable.stato, [...spec.from]),
          ne(lottiLogiciTable.isGenerale, true),
        ),
      )
      .returning();
    if (!changed)
      throw new LogicalLotRouteError(
        409,
        "Il Lotto logico è stato modificato da un altro operatore",
      );
    await recordAuditEvent(tx, {
      command,
      azione: spec.audit,
      entitaTipo: "lotto_logico",
      entitaId: id,
      areaOperativaIdSnapshot: existing.areaOperativaId,
      motivo,
      changes: auditFields(
        { statoPrecedente: existing.stato, statoNuovo: spec.to },
        ["statoPrecedente", "statoNuovo"],
      ),
    });
    return changed;
  });
}

for (const action of ["chiudi", "riapri", "archivia"] as const) {
  router.post(
    `/lotti-logici/:id/${action}`,
    requirePermission("magazzino.stock.receive"),
    async (req, res) => {
      try {
        const row = await transition(
          req,
          positiveId(req.params.id, "id"),
          action,
          req.body ?? {},
        );
        res.json(await formatLogicalLot(row));
      } catch (error) {
        if (error instanceof LogicalLotRouteError) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        throw error;
      }
    },
  );
}

export default router;
