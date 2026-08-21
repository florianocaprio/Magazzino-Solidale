import { Router, type IRouter, type Request } from "express";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  bisogniPianificatiStoricoTable,
  bisogniPianificatiTable,
  db,
  interventiStoricoStatiTable,
  interventiTable,
  zoneUdsTable,
  type BisognoPianificato,
} from "@workspace/db";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { risolviFasciaEta } from "@workspace/api-zod";
import { requirePermission } from "../middlewares/auth";
import { requireModulo } from "../lib/featureFlags";
import { callerAreaOperativaId } from "../lib/centroScope";
import { canAccessBeneficiarioRecord } from "../lib/beneficiarioPolicy";
import { dataCivileEuropeRome, isDateOnly } from "../lib/interventiWorkflow";
import { canAccessUdsInterventoTerritory } from "../lib/udsInterventoPolicy";

const router: IRouter = Router();

router.use("/uds", requireModulo("UDS"));

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nullableText(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new UdsError(400, `${label} non valido`);
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new UdsError(400, `${label} non può superare ${maxLength} caratteri`);
  }
  return normalized || null;
}

class UdsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendUdsError(
  error: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): boolean {
  if (!(error instanceof UdsError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

function isAdmin(req: Request): boolean {
  return Boolean(req.user?.isAdmin || req.user?.isSuperAdmin);
}

function requireOperationalArea(req: Request): number | null {
  const areaId = callerAreaOperativaId(req);
  if (areaId == null && !isAdmin(req)) {
    throw new UdsError(
      403,
      "Un operatore UDS deve essere assegnato a un'Area Operativa",
    );
  }
  return areaId;
}

function buildUdsDirectoryScope(req: Request, source: Record<string, unknown>) {
  const conditions: SQL[] = [
    eq(beneficiariTable.uds, true),
    eq(beneficiariTable.attivo, true),
  ];
  const callerArea = requireOperationalArea(req);
  let requestedArea: number | null = null;
  if (source.areaOperativaId != null && source.areaOperativaId !== "") {
    requestedArea = positiveInteger(source.areaOperativaId);
    if (requestedArea == null) {
      throw new UdsError(400, "areaOperativaId non valido");
    }
  }
  const effectiveArea = callerArea ?? requestedArea;
  if (effectiveArea != null) {
    conditions.push(eq(beneficiariTable.areaOperativaId, effectiveArea));
  }
  let zonaUdsId: number | null = null;
  if (source.zonaUdsId != null && source.zonaUdsId !== "") {
    zonaUdsId = positiveInteger(source.zonaUdsId);
    if (zonaUdsId == null) throw new UdsError(400, "zonaUdsId non valido");
    conditions.push(eq(beneficiariTable.zonaUdsId, zonaUdsId));
  }
  const search = String(source.search ?? "").trim();
  if (search) {
    if (search.length < 2 || search.length > 120) {
      throw new UdsError(400, "La ricerca deve contenere da 2 a 120 caratteri");
    }
    const like = `%${search}%`;
    conditions.push(
      or(
        ilike(beneficiariTable.codice, like),
        ilike(beneficiariTable.nome, like),
        ilike(beneficiariTable.cognome, like),
        ilike(beneficiariTable.soprannome, like),
        ilike(beneficiariTable.codiceFiscale, like),
        ilike(beneficiariTable.telefono, like),
      )!,
    );
  }
  return {
    where: and(...conditions),
    auditFilters: {
      areaOperativaId: effectiveArea,
      zonaUdsId,
      searchApplied: search.length > 0,
    },
  };
}

function buildUdsLinkCandidatesScope(
  req: Request,
  source: Record<string, unknown>,
) {
  const callerArea = requireOperationalArea(req);
  let requestedArea: number | null = null;
  if (source.areaOperativaId != null && source.areaOperativaId !== "") {
    requestedArea = positiveInteger(source.areaOperativaId);
    if (requestedArea == null) {
      throw new UdsError(400, "areaOperativaId non valido");
    }
  }
  const effectiveArea = callerArea ?? requestedArea;
  const search = String(source.search ?? "").trim();
  if (search.length < 2 || search.length > 120) {
    throw new UdsError(400, "La ricerca deve contenere da 2 a 120 caratteri");
  }
  const like = `%${search}%`;
  return and(
    eq(beneficiariTable.uds, false),
    eq(beneficiariTable.attivo, true),
    effectiveArea != null
      ? eq(beneficiariTable.areaOperativaId, effectiveArea)
      : undefined,
    or(
      ilike(beneficiariTable.codice, like),
      ilike(beneficiariTable.nome, like),
      ilike(beneficiariTable.cognome, like),
      ilike(beneficiariTable.soprannome, like),
      ilike(beneficiariTable.codiceFiscale, like),
      ilike(beneficiariTable.telefono, like),
    ),
  );
}

async function selectUdsDirectoryRows(
  where: SQL | undefined,
  pagination?: { limit: number; offset: number },
) {
  const query = db
    .select({ beneficiario: beneficiariTable, zonaNome: zoneUdsTable.nome })
    .from(beneficiariTable)
    .leftJoin(zoneUdsTable, eq(beneficiariTable.zonaUdsId, zoneUdsTable.id))
    .where(where)
    .orderBy(
      beneficiariTable.cognome,
      beneficiariTable.nome,
      beneficiariTable.id,
    );
  return pagination
    ? query.limit(pagination.limit).offset(pagination.offset)
    : query;
}

function formatUdsDirectoryItem(
  row: Awaited<ReturnType<typeof selectUdsDirectoryRows>>[number],
  req: Request,
) {
  const { beneficiario, zonaNome } = row;
  return {
    id: beneficiario.id,
    codice: beneficiario.codice,
    nome: beneficiario.nome,
    cognome: beneficiario.cognome,
    soprannome: beneficiario.soprannome ?? null,
    fasciaEtaCorrente: risolviFasciaEta(
      beneficiario.dataNascita,
      beneficiario.fasciaEtaPresunta,
    ).fascia,
    zonaUdsId: beneficiario.zonaUdsId ?? null,
    zonaUdsNome: zonaNome ?? null,
    canale: beneficiario.centroAscoltoId == null ? "uds" : "uds_centro",
    accessoCompleto: canAccessBeneficiarioRecord(beneficiario, req),
  };
}

function formatInterventoUds(row: typeof interventiTable.$inferSelect) {
  return {
    id: row.id,
    beneficiarioId: row.beneficiarioId,
    operatoreId: row.operatoreId ?? null,
    dataIntervento: row.dataIntervento ?? null,
    tipoIntervento: row.tipoIntervento,
    descrizione: row.descrizione ?? null,
    note: row.note ?? null,
    noteUds: row.noteUds ?? null,
    stato: row.stato,
    ambito: row.ambito,
    areaOperativaIdSnapshot: row.areaOperativaIdSnapshot ?? null,
    zonaUdsIdSnapshot: row.zonaUdsIdSnapshot ?? null,
    territorioStoricoClassificato: row.areaOperativaIdSnapshot != null,
    dataOraConclusione: row.dataOraConclusione?.toISOString() ?? null,
    dataCreazione: row.dataCreazione.toISOString(),
    dataAggiornamento: row.dataAggiornamento?.toISOString() ?? null,
    versione: row.dataAggiornamento?.toISOString() ?? null,
  };
}

type NuovoBisogno = Omit<
  typeof bisogniPianificatiTable.$inferInsert,
  "id" | "interventoId" | "versione" | "dataCreazione" | "dataAggiornamento"
>;

function normalizeNuoviBisogni(value: unknown): NuovoBisogno[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new UdsError(400, "Bisogni Pianificati non validi");
  }
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new UdsError(400, "Bisogno Pianificato non valido");
    }
    const input = raw as Record<string, unknown>;
    if (input.tipo !== "richiesta" && input.tipo !== "azione") {
      throw new UdsError(400, "Tipo del Bisogno Pianificato non valido");
    }
    const descrizione = nullableText(input.descrizione, "La descrizione", 500);
    if (!descrizione) {
      throw new UdsError(
        400,
        "La descrizione del Bisogno Pianificato è obbligatoria",
      );
    }
    const stato = input.stato ?? "da_pianificare";
    if (
      !["da_pianificare", "pianificato", "completato", "annullato"].includes(
        String(stato),
      )
    ) {
      throw new UdsError(400, "Stato del Bisogno Pianificato non valido");
    }
    const priorita = input.priorita ?? "normale";
    if (!["bassa", "normale", "alta", "urgente"].includes(String(priorita))) {
      throw new UdsError(400, "Priorità del Bisogno Pianificato non valida");
    }
    const dataPrevista =
      input.dataPrevista == null || input.dataPrevista === ""
        ? null
        : input.dataPrevista;
    if (
      dataPrevista != null &&
      (typeof dataPrevista !== "string" || !isDateOnly(dataPrevista))
    ) {
      throw new UdsError(
        400,
        "Data prevista del Bisogno Pianificato non valida",
      );
    }
    if (stato === "pianificato" && dataPrevista == null) {
      throw new UdsError(
        400,
        "Un Bisogno Pianificato richiede una data prevista",
      );
    }
    return {
      tipo: input.tipo,
      descrizione,
      stato: String(stato),
      priorita: String(priorita),
      dataPrevista: dataPrevista as string | null,
      note: nullableText(input.note, "Le note", 2000),
      dataCompletamento: stato === "completato" ? new Date() : null,
    };
  });
}

function bisognoAuditValue(row: BisognoPianificato): Record<string, unknown> {
  return {
    id: row.id,
    interventoId: row.interventoId,
    tipo: row.tipo,
    descrizione: row.descrizione,
    stato: row.stato,
    dataPrevista: row.dataPrevista,
    priorita: row.priorita,
    note: row.note,
    versione: row.versione,
    dataCompletamento: row.dataCompletamento?.toISOString() ?? null,
  };
}

async function loadAccessibleUdsIntervento(id: number, req: Request) {
  const [result] = await db
    .select({
      intervento: interventiTable,
      beneficiarioAreaOperativaId: beneficiariTable.areaOperativaId,
    })
    .from(interventiTable)
    .innerJoin(
      beneficiariTable,
      eq(interventiTable.beneficiarioId, beneficiariTable.id),
    )
    .where(and(eq(interventiTable.id, id), eq(interventiTable.ambito, "uds")))
    .limit(1);
  if (!result) throw new UdsError(404, "Intervento UDS non trovato");
  requireOperationalArea(req);
  if (
    !canAccessUdsInterventoTerritory(
      req,
      result.intervento,
      result.beneficiarioAreaOperativaId,
    )
  ) {
    throw new UdsError(403, "Intervento UDS non accessibile");
  }
  return result.intervento;
}

function expectedVersion(value: unknown): Date {
  if (typeof value !== "string") {
    throw new UdsError(400, "La versione è obbligatoria");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new UdsError(400, "Versione non valida");
  }
  return parsed;
}

router.get(
  "/uds/directory",
  requirePermission("uds.directory.view"),
  async (req, res) => {
    try {
      const page = req.query.page == null ? 1 : Number(req.query.page);
      const limit = req.query.limit == null ? 50 : Number(req.query.limit);
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        throw new UdsError(
          400,
          "Paginazione non valida: page >= 1 e limit compreso tra 1 e 100",
        );
      }
      const { where } = buildUdsDirectoryScope(
        req,
        req.query as Record<string, unknown>,
      );
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(beneficiariTable)
        .where(where);
      const rows = await selectUdsDirectoryRows(where, {
        limit,
        offset: (page - 1) * limit,
      });
      res.setHeader("X-Total-Count", String(total));
      res.setHeader("X-Page", String(page));
      res.setHeader("X-Page-Size", String(limit));
      res.json(rows.map((row) => formatUdsDirectoryItem(row, req)));
    } catch (error) {
      if (sendUdsError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/uds/directory/link-candidates",
  requirePermission("uds.directory.view"),
  requirePermission("beneficiari.manage"),
  async (req, res) => {
    try {
      const where = buildUdsLinkCandidatesScope(
        req,
        req.query as Record<string, unknown>,
      );
      const rows = await db
        .select({
          id: beneficiariTable.id,
          codice: beneficiariTable.codice,
          nome: beneficiariTable.nome,
          cognome: beneficiariTable.cognome,
          soprannome: beneficiariTable.soprannome,
          dataNascita: beneficiariTable.dataNascita,
          fasciaEtaPresunta: beneficiariTable.fasciaEtaPresunta,
          versione: beneficiariTable.versione,
        })
        .from(beneficiariTable)
        .where(where)
        .orderBy(
          beneficiariTable.cognome,
          beneficiariTable.nome,
          beneficiariTable.id,
        )
        .limit(20);
      res.json(
        rows.map((row) => ({
          id: row.id,
          codice: row.codice,
          nome: row.nome,
          cognome: row.cognome,
          soprannome: row.soprannome ?? null,
          fasciaEtaCorrente: risolviFasciaEta(
            row.dataNascita,
            row.fasciaEtaPresunta,
          ).fascia,
          versione: row.versione,
        })),
      );
    } catch (error) {
      if (sendUdsError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/uds/directory/export",
  requirePermission("uds.directory.view"),
  requirePermission("beneficiari.export"),
  async (req, res) => {
    try {
      const source =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};
      const { where, auditFilters } = buildUdsDirectoryScope(req, source);
      const rows = await selectUdsDirectoryRows(where);
      await db.insert(auditConfigurazioniTable).values({
        area: "uds",
        chiave: "directory:export",
        azione: "export",
        valoreNuovo: {
          tipo: "directory UDS",
          ...auditFilters,
          recordCount: rows.length,
        },
        utenteId: req.user!.id,
        ip: req.ip ?? req.socket.remoteAddress ?? null,
      });
      res.json(rows.map((row) => formatUdsDirectoryItem(row, req)));
    } catch (error) {
      if (sendUdsError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/uds/interventi/:id",
  requirePermission("uds.interventi.view"),
  async (req, res) => {
    try {
      const id = positiveInteger(req.params.id);
      if (id == null) throw new UdsError(400, "id non valido");
      res.json(formatInterventoUds(await loadAccessibleUdsIntervento(id, req)));
    } catch (error) {
      if (sendUdsError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/uds/beneficiari/:beneficiarioId/interventi",
  requirePermission("uds.interventi.view"),
  async (req, res) => {
    try {
      const beneficiarioId = positiveInteger(req.params.beneficiarioId);
      if (beneficiarioId == null) {
        throw new UdsError(400, "beneficiarioId non valido");
      }
      const callerArea = requireOperationalArea(req);
      const [beneficiario] = await db
        .select({
          id: beneficiariTable.id,
          areaOperativaId: beneficiariTable.areaOperativaId,
        })
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, beneficiarioId))
        .limit(1);
      if (!beneficiario) {
        throw new UdsError(403, "Storico UDS non accessibile");
      }
      const rows = await db
        .select()
        .from(interventiTable)
        .where(
          and(
            eq(interventiTable.beneficiarioId, beneficiarioId),
            eq(interventiTable.ambito, "uds"),
          ),
        )
        .orderBy(desc(interventiTable.id));
      const visibleRows = rows.filter((row) =>
        canAccessUdsInterventoTerritory(req, row, beneficiario.areaOperativaId),
      );
      if (
        callerArea != null &&
        visibleRows.length === 0 &&
        beneficiario.areaOperativaId !== callerArea
      ) {
        throw new UdsError(403, "Storico UDS non accessibile");
      }
      res.json(visibleRows.map(formatInterventoUds));
    } catch (error) {
      if (sendUdsError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/uds/interventi",
  requirePermission("uds.interventi.create"),
  async (req, res) => {
    try {
      const beneficiarioId = positiveInteger(req.body?.beneficiarioId);
      if (beneficiarioId == null) {
        throw new UdsError(400, "beneficiarioId non valido");
      }
      const tipoIntervento = nullableText(
        req.body?.tipoIntervento,
        "Il tipo Intervento",
        120,
      );
      if (!tipoIntervento) {
        throw new UdsError(400, "Il tipo Intervento è obbligatorio");
      }
      const [beneficiario] = await db
        .select()
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, beneficiarioId))
        .limit(1);
      if (
        !beneficiario ||
        !beneficiario.attivo ||
        !beneficiario.uds ||
        beneficiario.areaOperativaId == null
      ) {
        throw new UdsError(
          403,
          "Persona non accessibile per un Intervento UDS",
        );
      }
      const callerArea = requireOperationalArea(req);
      if (callerArea != null && beneficiario.areaOperativaId !== callerArea) {
        throw new UdsError(
          403,
          "Persona non accessibile per un Intervento UDS",
        );
      }
      const now = new Date();
      const nuoviBisogni = normalizeNuoviBisogni(req.body?.bisogniPianificati);
      if (
        nuoviBisogni.length > 0 &&
        !isAdmin(req) &&
        !req.user?.permessi?.includes("uds.bisogni.manage")
      ) {
        throw new UdsError(
          403,
          "Permesso di gestione Bisogni UDS non consentito",
        );
      }
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(interventiTable)
          .values({
            beneficiarioId,
            operatoreId: req.user!.id,
            dataIntervento: dataCivileEuropeRome(now),
            tipoIntervento,
            descrizione: nullableText(
              req.body?.descrizione,
              "La descrizione",
              4000,
            ),
            note: nullableText(req.body?.note, "Le note", 4000),
            stato: "concluso",
            ambito: "uds",
            areaOperativaIdSnapshot: beneficiario.areaOperativaId,
            zonaUdsIdSnapshot: beneficiario.zonaUdsId,
            dataOraConclusione: now,
            dataAggiornamento: now,
          })
          .returning();
        await tx.insert(interventiStoricoStatiTable).values({
          interventoId: row.id,
          statoPrecedente: null,
          statoNuovo: "concluso",
          operatoreId: req.user!.id,
          dataTransizione: now,
          motivo: "Registrazione incontro UDS concluso",
        });
        if (nuoviBisogni.length > 0) {
          const needs = await tx
            .insert(bisogniPianificatiTable)
            .values(
              nuoviBisogni.map((need) => ({
                ...need,
                interventoId: row.id,
              })),
            )
            .returning();
          await tx.insert(bisogniPianificatiStoricoTable).values(
            needs.map((need) => ({
              bisognoId: need.id,
              statoPrecedente: null,
              statoNuovo: need.stato,
              operatoreId: req.user!.id,
              motivo: "Creazione contestuale all'Intervento UDS",
              valorePrecedente: null,
              valoreNuovo: bisognoAuditValue(need),
            })),
          );
        }
        await tx.insert(auditConfigurazioniTable).values({
          area: "uds",
          chiave: `intervento:${row.id}`,
          azione: "creazione",
          valoreNuovo: {
            beneficiarioId,
            stato: "concluso",
            areaOperativaIdSnapshot: beneficiario.areaOperativaId,
            zonaUdsIdSnapshot: beneficiario.zonaUdsId,
          },
          utenteId: req.user!.id,
          ip: req.ip ?? req.socket.remoteAddress ?? null,
        });
        return row;
      });
      res.status(201).json(formatInterventoUds(created));
    } catch (error) {
      if (sendUdsError(error, res)) return;
      throw error;
    }
  },
);

router.patch(
  "/uds/interventi/:id/nota",
  requirePermission("uds.interventi.note"),
  async (req, res) => {
    try {
      const id = positiveInteger(req.params.id);
      if (id == null) throw new UdsError(400, "id non valido");
      await loadAccessibleUdsIntervento(id, req);
      const version = expectedVersion(req.body?.versione);
      const noteUds = nullableText(req.body?.noteUds, "La nota UDS", 4000);
      const now = new Date();
      const updated = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(interventiTable)
          .where(eq(interventiTable.id, id))
          .for("update");
        if (!current || current.ambito !== "uds") {
          throw new UdsError(404, "Intervento UDS non trovato");
        }
        if (current.dataAggiornamento?.getTime() !== version.getTime()) {
          throw new UdsError(
            409,
            "L'Intervento è stato modificato; ricarica i dati",
          );
        }
        const [row] = await tx
          .update(interventiTable)
          .set({ noteUds, dataAggiornamento: now })
          // La riga è già bloccata FOR UPDATE e la versione è stata verificata
          // sopra. Evita un secondo confronto SQL che perderebbe i microsecondi
          // dei timestamp legacy durante la conversione JavaScript Date.
          .where(eq(interventiTable.id, id))
          .returning();
        if (!row) {
          throw new UdsError(
            409,
            "L'Intervento è stato modificato; ricarica i dati",
          );
        }
        await tx.insert(auditConfigurazioniTable).values({
          area: "uds",
          chiave: `intervento:${id}`,
          azione: "nota",
          valorePrecedente: { noteUds: current.noteUds ?? null },
          valoreNuovo: { noteUds },
          utenteId: req.user!.id,
          ip: req.ip ?? req.socket.remoteAddress ?? null,
        });
        return row;
      });
      res.json(formatInterventoUds(updated));
    } catch (error) {
      if (sendUdsError(error, res)) return;
      throw error;
    }
  },
);

router.patch(
  "/uds/interventi/:id/rettifica",
  requirePermission("uds.interventi.update"),
  async (req, res) => {
    try {
      const id = positiveInteger(req.params.id);
      if (id == null) throw new UdsError(400, "id non valido");
      await loadAccessibleUdsIntervento(id, req);
      const version = expectedVersion(req.body?.versione);
      const motivo = nullableText(req.body?.motivo, "Il motivo", 2000);
      if (!motivo)
        throw new UdsError(400, "Il motivo della rettifica è obbligatorio");
      const updates: Partial<typeof interventiTable.$inferInsert> = {};
      if (Object.hasOwn(req.body ?? {}, "tipoIntervento")) {
        const value = nullableText(
          req.body.tipoIntervento,
          "Il tipo Intervento",
          120,
        );
        if (!value)
          throw new UdsError(400, "Il tipo Intervento è obbligatorio");
        updates.tipoIntervento = value;
      }
      if (Object.hasOwn(req.body ?? {}, "descrizione")) {
        updates.descrizione = nullableText(
          req.body.descrizione,
          "La descrizione",
          4000,
        );
      }
      if (Object.hasOwn(req.body ?? {}, "note")) {
        updates.note = nullableText(req.body.note, "Le note", 4000);
      }
      if (Object.hasOwn(req.body ?? {}, "dataIntervento")) {
        if (!isDateOnly(req.body.dataIntervento)) {
          throw new UdsError(400, "dataIntervento non valida");
        }
        updates.dataIntervento = req.body.dataIntervento;
      }
      if (Object.keys(updates).length === 0) {
        throw new UdsError(400, "Nessun campo rettificabile specificato");
      }
      const now = new Date();
      const updated = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(interventiTable)
          .where(eq(interventiTable.id, id))
          .for("update");
        if (!current || current.ambito !== "uds") {
          throw new UdsError(404, "Intervento UDS non trovato");
        }
        if (current.dataAggiornamento?.getTime() !== version.getTime()) {
          throw new UdsError(
            409,
            "L'Intervento è stato modificato; ricarica i dati",
          );
        }
        const [row] = await tx
          .update(interventiTable)
          .set({ ...updates, dataAggiornamento: now })
          .where(eq(interventiTable.id, id))
          .returning();
        if (!row) {
          throw new UdsError(
            409,
            "L'Intervento è stato modificato; ricarica i dati",
          );
        }
        await tx.insert(auditConfigurazioniTable).values({
          area: "uds",
          chiave: `intervento:${id}`,
          azione: "rettifica",
          valorePrecedente: {
            tipoIntervento: current.tipoIntervento,
            descrizione: current.descrizione,
            note: current.note,
            dataIntervento: current.dataIntervento,
          },
          valoreNuovo: {
            tipoIntervento: row.tipoIntervento,
            descrizione: row.descrizione,
            note: row.note,
            dataIntervento: row.dataIntervento,
          },
          utenteId: req.user!.id,
          ip: req.ip ?? req.socket.remoteAddress ?? null,
          note: motivo,
        });
        return row;
      });
      res.json(formatInterventoUds(updated));
    } catch (error) {
      if (sendUdsError(error, res)) return;
      throw error;
    }
  },
);

export default router;
