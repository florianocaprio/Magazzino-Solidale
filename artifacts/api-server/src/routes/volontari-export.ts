import { createHash } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  centriAscoltoTable,
  corsiDeiVolontariTable,
  db,
  emissioniRegistroVolontariTable,
  giornateServizioVolontariTable,
  qualificheDeiVolontariTable,
  registroVolontariEventiTable,
  ruoliVolontariTable,
  statiVolontariTable,
  volontariTable,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  callerAreaOperativaId,
  callerCentroId,
  canAccessCentro,
  centroScopeFilter,
  idSetScopeFilter,
  inVisibleCentroSet,
  visibleCentroIds,
  andScoped,
} from "../lib/centroScope";
import { requireModulo } from "../lib/featureFlags";
import { auditLogistica } from "../lib/logisticaAudit";
import { buildSimpleLandscapePdf } from "../lib/simplePdf";
import { addCalendarDays, isDateOnly, todayRome } from "../lib/volontariDomain";
import {
  appendVolontarioLedgerEvent,
  buildVolunteerEventSnapshot,
  canonicalSnapshotHash,
  verifyVolontarioLedgerChain,
} from "../lib/volontariLedger";
import { operationalStatesForRows } from "../lib/volontariOperational";
import {
  resolveVolunteerRegisterStatesAt,
  VOLUNTEER_REGISTER_CORRECTION_FIELDS,
  type StructuredVolunteerRegisterCorrection,
} from "../lib/volontariRegisterResolver";
import {
  canAccessVolunteerOwnerScope,
  resolveVolunteerOwnerScope,
  volunteerOwnerScopeSql,
} from "../lib/volontariScope";
import {
  buildExtendedVolunteerWorkbook,
  buildHistoricalVolunteerWorkbook,
  buildOfficialVolunteerWorkbook,
  VOLONTARI_OFFICIAL_HEADERS,
  VOLONTARI_XLSX_MIME,
} from "../lib/volontariWorkbook";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/volontari", requireModulo("VOLONTARI"));
const actorId = (req: Request): number | null =>
  req.user?.id && req.user.id > 0 ? req.user.id : null;

type ExportRow = typeof volontariTable.$inferSelect & {
  centroAscoltoNome: string | null;
  ruoloCatalogoNome: string | null;
};

function params(req: Request) {
  return { ...req.query, ...(req.body?.filtri ?? {}) } as Record<
    string,
    unknown
  >;
}

async function scopedRows(
  req: Request,
  filters = params(req),
  historicalResolution = false,
): Promise<
  | { ok: true; rows: ExportRow[]; reference: string; centerId: number | null }
  | { ok: false; status: 400 | 403; error: string }
> {
  const reference =
    typeof filters.dataRiferimento === "string"
      ? filters.dataRiferimento
      : todayRome();
  if (!isDateOnly(reference))
    return { ok: false, status: 400, error: "dataRiferimento non valida" };
  const requestedCenter =
    filters.centroAscoltoId == null || filters.centroAscoltoId === ""
      ? null
      : Number(filters.centroAscoltoId);
  const callerAreaId = callerAreaOperativaId(req);
  const visibleIds = await visibleCentroIds(callerAreaId);
  const strictAreaCenterIds =
    historicalResolution && callerAreaId != null
      ? (
          await db
            .select({ id: centriAscoltoTable.id })
            .from(centriAscoltoTable)
            .where(eq(centriAscoltoTable.areaOperativaId, callerAreaId))
        ).map((center) => center.id)
      : visibleIds;
  if (
    requestedCenter != null &&
    (!Number.isSafeInteger(requestedCenter) ||
      requestedCenter <= 0 ||
      !canAccessCentro(requestedCenter, callerCentroId(req)) ||
      !inVisibleCentroSet(requestedCenter, strictAreaCenterIds))
  ) {
    return { ok: false, status: 403, error: "Centro non accessibile" };
  }
  const conditions: SQL[] = [];
  const tipo =
    typeof filters.tipo === "string" ? filters.tipo.toUpperCase() : "TUTTI";
  if (!["TUTTI", "PERMANENTE", "TEMPORANEO"].includes(tipo))
    return { ok: false, status: 400, error: "tipo non valido" };
  if (tipo !== "TUTTI" && !historicalResolution)
    conditions.push(eq(volontariTable.tipoVolontario, tipo));
  const roleId =
    filters.ruoloVolontarioId == null || filters.ruoloVolontarioId === ""
      ? null
      : Number(filters.ruoloVolontarioId);
  if (roleId != null && (!Number.isSafeInteger(roleId) || roleId <= 0))
    return { ok: false, status: 400, error: "ruolo non valido" };
  if (roleId != null && !historicalResolution)
    conditions.push(eq(volontariTable.ruoloVolontarioId, roleId));
  const search =
    typeof filters.search === "string" ? filters.search.trim() : "";
  if (search && !historicalResolution) {
    conditions.push(
      or(
        ilike(volontariTable.nome, `%${search}%`),
        ilike(volontariTable.cognome, `%${search}%`),
        ilike(volontariTable.matricola, `%${search}%`),
      )!,
    );
  }
  const historicalCenterIds = historicalResolution
    ? requestedCenter != null
      ? [requestedCenter]
      : callerCentroId(req) != null
        ? [callerCentroId(req)!]
        : callerAreaId != null
          ? (strictAreaCenterIds ?? [])
          : null
    : null;
  const historicalScope =
    historicalCenterIds == null
      ? undefined
      : historicalCenterIds.length
        ? or(
            inArray(volontariTable.centroAscoltoId, historicalCenterIds),
            inArray(
              volontariTable.id,
              db
                .select({ volontarioId: registroVolontariEventiTable.volontarioId })
                .from(registroVolontariEventiTable)
                .where(
                  and(
                    inArray(
                      registroVolontariEventiTable.centroAscoltoId,
                      historicalCenterIds,
                    ),
                    lte(
                      registroVolontariEventiTable.dataEffettiva,
                      reference,
                    ),
                  ),
                ),
            ),
          )
        : sql`false`;
  const rows = await db
    .select({
      ...getTableColumns(volontariTable),
      centroAscoltoNome: centriAscoltoTable.nome,
      ruoloCatalogoNome: ruoliVolontariTable.nome,
    })
    .from(volontariTable)
    .leftJoin(
      centriAscoltoTable,
      eq(volontariTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .leftJoin(
      ruoliVolontariTable,
      eq(volontariTable.ruoloVolontarioId, ruoliVolontariTable.id),
    )
    .where(
      andScoped(
        historicalResolution
          ? historicalScope
          : centroScopeFilter(
              volontariTable.centroAscoltoId,
              callerCentroId(req),
            ),
        historicalResolution
          ? undefined
          : idSetScopeFilter(volontariTable.centroAscoltoId, visibleIds),
        historicalResolution || requestedCenter == null
          ? undefined
          : eq(volontariTable.centroAscoltoId, requestedCenter),
        ...conditions,
      ),
    )
    .orderBy(volontariTable.cognome, volontariTable.nome);
  const states = historicalResolution
    ? new Map()
    : await operationalStatesForRows(db, rows, reference, requestedCenter);
  let filtered = rows;
  const stato =
    typeof filters.stato === "string" ? filters.stato.toLowerCase() : "tutti";
  if (!["tutti", "attivi", "non_attivi"].includes(stato))
    return { ok: false, status: 400, error: "stato non valido" };
  if (stato === "attivi" && !historicalResolution)
    filtered = rows.filter((row) => states.get(row.id)?.operativo);
  if (stato === "non_attivi" && !historicalResolution)
    filtered = rows.filter((row) => !states.get(row.id)?.operativo);
  const assicurazione =
    typeof filters.assicurazione === "string"
      ? filters.assicurazione.toUpperCase()
      : "";
  if (assicurazione && !historicalResolution)
    filtered = filtered.filter(
      (row) => states.get(row.id)?.statoAssicurazione === assicurazione,
    );
  const dataServizio =
    typeof filters.dataServizio === "string" ? filters.dataServizio : null;
  const servizioDa =
    dataServizio ??
    (typeof filters.servizioDa === "string" ? filters.servizioDa : null);
  const servizioA =
    dataServizio ??
    (typeof filters.servizioA === "string" ? filters.servizioA : null);
  if (
    (servizioDa && !isDateOnly(servizioDa)) ||
    (servizioA && !isDateOnly(servizioA)) ||
    (servizioDa && servizioA && servizioDa > servizioA)
  ) {
    return {
      ok: false,
      status: 400,
      error: "Intervallo giornate di servizio non valido",
    };
  }
  if ((servizioDa || servizioA) && !historicalResolution) {
    const serviceConditions: SQL[] = [
      ne(giornateServizioVolontariTable.stato, "ANNULLATA"),
    ];
    if (servizioDa)
      serviceConditions.push(
        gte(giornateServizioVolontariTable.dataServizio, servizioDa),
      );
    if (servizioA)
      serviceConditions.push(
        lte(giornateServizioVolontariTable.dataServizio, servizioA),
      );
    const serviceRows = await db
      .select({ volontarioId: giornateServizioVolontariTable.volontarioId })
      .from(giornateServizioVolontariTable)
      .where(and(...serviceConditions));
    const serviceIds = new Set(serviceRows.map((row) => row.volontarioId));
    filtered = filtered.filter(
      (row) => row.tipoVolontario === "TEMPORANEO" && serviceIds.has(row.id),
    );
  }
  return {
    ok: true,
    rows: filtered,
    reference,
    centerId: requestedCenter ?? callerCentroId(req),
  };
}

async function extendedRows(rows: ExportRow[], reference: string) {
  const states = await operationalStatesForRows(db, rows, reference);
  const ids = rows.map((row) => row.id);
  const warningEnd = addCalendarDays(reference, 60);
  const [courses, qualifications] = ids.length
    ? await Promise.all([
        db
          .select({
            volontarioId: corsiDeiVolontariTable.volontarioId,
            dataScadenza: corsiDeiVolontariTable.dataScadenza,
          })
          .from(corsiDeiVolontariTable)
          .where(
            and(
              inArray(corsiDeiVolontariTable.volontarioId, ids),
              gte(corsiDeiVolontariTable.dataScadenza, reference),
              lte(corsiDeiVolontariTable.dataScadenza, warningEnd),
            ),
          ),
        db
          .select({
            volontarioId: qualificheDeiVolontariTable.volontarioId,
            dataScadenza: qualificheDeiVolontariTable.dataScadenza,
          })
          .from(qualificheDeiVolontariTable)
          .where(
            and(
              inArray(qualificheDeiVolontariTable.volontarioId, ids),
              gte(qualificheDeiVolontariTable.dataScadenza, reference),
              lte(qualificheDeiVolontariTable.dataScadenza, warningEnd),
            ),
          ),
      ])
    : [[], []];
  return rows.map((row) => {
    const state = states.get(row.id)!;
    return {
      Codice: row.matricola ?? "",
      Cognome: row.cognome,
      Nome: row.nome,
      "Tipo volontario": row.tipoVolontario,
      "Stato operativo": state.operativo ? "Attivo" : "Non attivo",
      "Motivo non operativo": state.motivoNonOperativo ?? "",
      Approvazione: row.statoApprovazione,
      Ruolo: row.ruoloCatalogoNome ?? row.ruolo,
      "Gruppo/Centro":
        row.centroAscoltoNome ?? row.gruppoImportatoOriginale ?? "",
      "Scadenza assicurazione": state.scadenzaAssicurazione ?? "",
      "Corsi in scadenza": courses
        .filter((item) => item.volontarioId === row.id)
        .map((item) => item.dataScadenza)
        .join(", "),
      "Qualifiche in scadenza": qualifications
        .filter((item) => item.volontarioId === row.id)
        .map((item) => item.dataScadenza)
        .join(", "),
    };
  });
}

function historicalRows(
  rows: ExportRow[],
  stateById: Awaited<ReturnType<typeof operationalStatesForRows>>,
) {
  return rows.map((row, index) => ({
    "N°": String(index + 1),
    Codice: row.matricola ?? "",
    "Cognome e Nome": `${row.cognome} ${row.nome}`.trim(),
    "Città di Nascita": row.luogoNascita ?? "",
    "Data N.": row.dataNascita ?? "",
    "Indirizzo di Residenza": row.indirizzoResidenza ?? "",
    "Cod. Fiscale": row.codiceFiscale ?? "",
    "Da Data": row.dataInizioImportata ?? "",
    "A Data": stateById.get(row.id)?.scadenzaAssicurazione ?? "",
    Cellulare: row.telefono ?? "",
    Telefono: row.telefonoSecondario ?? "",
    Email: row.email ?? "",
    Gruppo: row.centroAscoltoNome ?? row.gruppoImportatoOriginale ?? "",
    Categoria: row.ruoloCatalogoNome ?? row.ruolo,
  }));
}

async function officialRegisterRows(
  rows: ExportRow[],
  reference: string,
  filters: Record<string, unknown>,
  allowedCenterIds: number[] | null,
) {
  const servizioDa =
    typeof filters.servizioDa === "string" ? filters.servizioDa : null;
  const servizioA =
    typeof filters.servizioA === "string" ? filters.servizioA : null;
  const resolved = await resolveVolunteerRegisterStatesAt(rows, reference, {
    servizioDa,
    servizioA,
    allowedCenterIds,
  });
  const stateById = await operationalStatesForRows(db, rows, reference);
  const tipo =
    typeof filters.tipo === "string" ? filters.tipo.toUpperCase() : "TUTTI";
  const stato =
    typeof filters.stato === "string" ? filters.stato.toLowerCase() : "tutti";
  const roleId =
    filters.ruoloVolontarioId == null || filters.ruoloVolontarioId === ""
      ? null
      : Number(filters.ruoloVolontarioId);
  const search =
    typeof filters.search === "string"
      ? filters.search.trim().toLocaleLowerCase("it")
      : "";
  const assicurazione =
    typeof filters.assicurazione === "string"
      ? filters.assicurazione.toUpperCase()
      : "";
  const filtered = resolved.filter((item) => {
    const identity = item.identity;
    if (
      allowedCenterIds != null &&
      (typeof identity.centroAscoltoId !== "number" ||
        !allowedCenterIds.includes(identity.centroAscoltoId))
    )
      return false;
    if (tipo !== "TUTTI" && identity.tipoVolontario !== tipo) return false;
    if (stato === "attivi" && item.status !== "ATTIVO") return false;
    if (stato === "non_attivi" && item.status === "ATTIVO") return false;
    if (roleId != null && identity.ruoloVolontarioId !== roleId) return false;
    if (
      assicurazione &&
      stateById.get(item.volontarioId)?.statoAssicurazione !== assicurazione
    )
      return false;
    if (servizioDa || servizioA) {
      if (identity.tipoVolontario !== "TEMPORANEO" || !item.serviceDays.length)
        return false;
    }
    if (search) {
      const haystack = [identity.nome, identity.cognome, identity.matricola]
        .map((value) => String(value ?? "").toLocaleLowerCase("it"))
        .join(" ");
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  const incomplete = filtered.filter((item) => item.incomplete.length);
  if (incomplete.length) {
    const error = new Error("REGISTRO_VOLONTARI_INCOMPLETO") as Error & {
      details?: unknown;
    };
    error.details = incomplete.map((item) => ({
      volontarioId: item.volontarioId,
      campi: item.incomplete,
    }));
    throw error;
  }
  return filtered
    .sort((left, right) => left.progressivoRegistro - right.progressivoRegistro)
    .map((item) => {
      const identity = item.identity;
      const operational = stateById.get(item.volontarioId);
      const serviceInterval = item.serviceDays.length
        ? `${item.serviceDays[0]} – ${item.serviceDays.at(-1)}`
        : "";
      return {
        Progressivo: String(item.progressivoRegistro),
        Matricola: String(identity.matricola ?? ""),
        Cognome: String(identity.cognome ?? ""),
        Nome: String(identity.nome ?? ""),
        "Codice fiscale": String(identity.codiceFiscale ?? ""),
        "Data di nascita": String(identity.dataNascita ?? ""),
        "Luogo di nascita": String(identity.luogoNascita ?? ""),
        Residenza: String(identity.indirizzoResidenza ?? ""),
        Domicilio: String(identity.indirizzoDomicilio ?? ""),
        "Tipo volontario": String(identity.tipoVolontario ?? ""),
        "Data inizio attività/iscrizione": item.registrationDate ?? "",
        "Origine iscrizione": item.origin,
        "Da Data importata": String(identity.dataInizioImportata ?? ""),
        "Data cessazione": item.cessationDate ?? "",
        "Stato alla data di riferimento": item.status,
        "Motivo stato": item.statusReason,
        "Centro/Gruppo": String(identity.centroAscoltoNome ?? ""),
        "Ruolo/Categoria": String(identity.ruoloNome ?? ""),
        "Scadenza assicurazione": operational?.scadenzaAssicurazione ?? "",
        "Date servizio temporaneo": item.serviceDays.join(", "),
        "Intervallo servizio temporaneo": serviceInterval,
        "Data di riferimento": reference,
        "Riferimento iscrizione": item.registrationEventProgressive
          ? `REG-${item.registrationEventProgressive}`
          : `LEGACY-${item.progressivoRegistro}`,
      };
    });
}

function canReadFullLedger(req: Request): boolean {
  return Boolean(
    req.user?.isAdmin ||
    req.user?.isSuperAdmin ||
    req.user?.permessi?.includes("logistica.volontari.export") ||
    req.user?.permessi?.includes("logistica.volontari.manage"),
  );
}

function sanitizedLedgerSnapshot(snapshot: Record<string, unknown>) {
  const allowed = [
    "volontarioId",
    "tipoVolontario",
    "centroAscoltoId",
    "centroAscoltoNome",
    "ruoloVolontarioId",
    "ruoloNome",
    "ruoloVolontarioNome",
    "statoApprovazione",
    "origine",
    "dataInizio",
    "statoPrecedente",
    "nuovoStato",
    "motivo",
    "dataEffettiva",
    "riferimentoEventoId",
    "versione",
  ];
  return Object.fromEntries(
    allowed.flatMap((key) =>
      Object.hasOwn(snapshot, key) ? [[key, snapshot[key]]] : [],
    ),
  );
}

function sendXlsx(
  res: Parameters<Parameters<IRouter["get"]>[1]>[1],
  buffer: Buffer,
  filename: string,
) {
  res.setHeader("Content-Type", VOLONTARI_XLSX_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

router.get(
  "/volontari/export/storico.xlsx",
  requirePermission("logistica.volontari.export"),
  async (req, res) => {
    const scoped = await scopedRows(req);
    if (!scoped.ok) {
      res.status(scoped.status).json({ error: scoped.error });
      return;
    }
    const states = await operationalStatesForRows(
      db,
      scoped.rows,
      scoped.reference,
    );
    const buffer = buildHistoricalVolunteerWorkbook(
      historicalRows(scoped.rows, states),
    );
    await db.transaction(async (tx) =>
      auditLogistica(tx, req, {
        entita: "volontario",
        id: 0,
        azione: "export_storico",
        nuovo: {
          numeroRighe: scoped.rows.length,
          dataRiferimento: scoped.reference,
          sha256: createHash("sha256").update(buffer).digest("hex"),
        },
      }),
    );
    sendXlsx(
      res,
      buffer,
      `registro-volontari-storico-${scoped.reference}.xlsx`,
    );
  },
);

router.get(
  "/volontari/export/esteso.xlsx",
  requirePermission("logistica.volontari.export"),
  async (req, res) => {
    const scoped = await scopedRows(req);
    if (!scoped.ok) {
      res.status(scoped.status).json({ error: scoped.error });
      return;
    }
    const buffer = buildExtendedVolunteerWorkbook(
      await extendedRows(scoped.rows, scoped.reference),
    );
    await db.transaction(async (tx) =>
      auditLogistica(tx, req, {
        entita: "volontario",
        id: 0,
        azione: "export_esteso",
        nuovo: {
          numeroRighe: scoped.rows.length,
          dataRiferimento: scoped.reference,
          sha256: createHash("sha256").update(buffer).digest("hex"),
        },
      }),
    );
    sendXlsx(res, buffer, `volontari-operativo-${scoped.reference}.xlsx`);
  },
);

router.post(
  "/volontari/registro/genera",
  requirePermission("logistica.volontari.export"),
  async (req, res) => {
    const appliedFilters = params(req);
    const scoped = await scopedRows(req, appliedFilters, true);
    if (!scoped.ok) {
      res.status(scoped.status).json({ error: scoped.error });
      return;
    }
    const type = String(req.body?.tipo ?? "PDF").toUpperCase();
    if (type !== "PDF" && type !== "XLSX") {
      res.status(400).json({ error: "Formato registro non valido" });
      return;
    }
    const areaId = callerAreaOperativaId(req);
    const allowedCenterIds =
      scoped.centerId != null
        ? [scoped.centerId]
        : areaId != null
          ? (
              await db
                .select({ id: centriAscoltoTable.id })
                .from(centriAscoltoTable)
                .where(eq(centriAscoltoTable.areaOperativaId, areaId))
            ).map((center) => center.id)
          : null;
    let snapshot: Awaited<ReturnType<typeof officialRegisterRows>>;
    try {
      snapshot = await officialRegisterRows(
        scoped.rows,
        scoped.reference,
        appliedFilters,
        allowedCenterIds,
      );
    } catch (error) {
      if (error instanceof Error && error.message === "REGISTRO_VOLONTARI_INCOMPLETO") {
        res.status(422).json({
          error: "Il registro contiene volontari privi dei dati storici obbligatori",
          code: error.message,
          dettagli: (error as Error & { details?: unknown }).details,
        });
        return;
      }
      throw error;
    }
    const buffer =
      type === "PDF"
        ? buildSimpleLandscapePdf(
            `Registro volontari al ${scoped.reference}`,
            snapshot.map((row) =>
              VOLONTARI_OFFICIAL_HEADERS.map(
                (header) => `${header}: ${row[header] ?? ""}`,
              ).join(" | "),
            ),
          )
        : buildOfficialVolunteerWorkbook(snapshot);
    const hashFile = createHash("sha256").update(buffer).digest("hex");
    const hashSnapshot = canonicalSnapshotHash(snapshot);
    const ownerScope = await resolveVolunteerOwnerScope(req, scoped.centerId);
    const [emission] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(emissioniRegistroVolontariTable)
        .values({
          tipo: type,
          sezione:
            req.body?.filtri?.tipo && req.body.filtri.tipo !== "TUTTI"
              ? String(req.body.filtri.tipo).toUpperCase()
              : null,
          centroAscoltoId: scoped.centerId,
          ...ownerScope,
          filtri: params(req),
          dataRiferimento: scoped.reference,
          generatoDa: actorId(req),
          numeroRighe: snapshot.length,
          hashFile,
          hashSnapshot,
          versioneLayout: "VOLONTARI_REGISTRO_UFFICIALE_V2",
          snapshot,
          contenutoBase64: buffer.toString("base64"),
        })
        .returning();
      await auditLogistica(tx, req, {
        entita: "volontario",
        id: created.id,
        azione: "emissione_registro",
        nuovo: {
          emissioneId: created.id,
          tipo: type,
          numeroRighe: snapshot.length,
          hashFile,
          hashSnapshot,
          scope: ownerScope,
        },
      });
      return [created];
    });
    res.setHeader("X-Registro-Emissione-Id", String(emission.id));
    res.setHeader("X-Registro-Sha256", hashFile);
    res.setHeader(
      "Content-Type",
      type === "PDF" ? "application/pdf" : VOLONTARI_XLSX_MIME,
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="registro-volontari-${scoped.reference}.${type.toLowerCase()}"`,
    );
    res.send(buffer);
  },
);

router.get(
  "/volontari/registro/emissioni",
  requirePermission("logistica.volontari.export"),
  async (req, res) => {
    const rows = await db
      .select({
        id: emissioniRegistroVolontariTable.id,
        tipo: emissioniRegistroVolontariTable.tipo,
        sezione: emissioniRegistroVolontariTable.sezione,
        centroAscoltoId: emissioniRegistroVolontariTable.centroAscoltoId,
        scopeTipo: emissioniRegistroVolontariTable.scopeTipo,
        scopeCentroId: emissioniRegistroVolontariTable.scopeCentroId,
        scopeAreaOperativaId:
          emissioniRegistroVolontariTable.scopeAreaOperativaId,
        scopeCentroIdsSnapshot:
          emissioniRegistroVolontariTable.scopeCentroIdsSnapshot,
        scopeFingerprint: emissioniRegistroVolontariTable.scopeFingerprint,
        filtri: emissioniRegistroVolontariTable.filtri,
        dataRiferimento: emissioniRegistroVolontariTable.dataRiferimento,
        generatoDa: emissioniRegistroVolontariTable.generatoDa,
        generatoAt: emissioniRegistroVolontariTable.generatoAt,
        numeroRighe: emissioniRegistroVolontariTable.numeroRighe,
        hashFile: emissioniRegistroVolontariTable.hashFile,
        hashSnapshot: emissioniRegistroVolontariTable.hashSnapshot,
        versioneLayout: emissioniRegistroVolontariTable.versioneLayout,
      })
      .from(emissioniRegistroVolontariTable)
      .where(
        volunteerOwnerScopeSql(req, {
          scopeTipo: emissioniRegistroVolontariTable.scopeTipo,
          scopeCentroId: emissioniRegistroVolontariTable.scopeCentroId,
          scopeAreaOperativaId: emissioniRegistroVolontariTable.scopeAreaOperativaId,
        }),
      )
      .orderBy(desc(emissioniRegistroVolontariTable.generatoAt));
    res.json(rows);
  },
);

router.get(
  "/volontari/registro/emissioni/:emissioneId/file",
  requirePermission("logistica.volontari.export"),
  async (req, res) => {
    const id = Number(req.params.emissioneId);
    const [row] = Number.isSafeInteger(id)
      ? await db
          .select()
          .from(emissioniRegistroVolontariTable)
          .where(eq(emissioniRegistroVolontariTable.id, id))
      : [];
    if (!row) {
      res.status(404).json({ error: "Emissione non trovata" });
      return;
    }
    if (!canAccessVolunteerOwnerScope(req, row)) {
      res.status(403).json({ error: "Emissione non accessibile" });
      return;
    }
    const buffer = Buffer.from(row.contenutoBase64, "base64");
    if (
      createHash("sha256").update(buffer).digest("hex") !== row.hashFile ||
      canonicalSnapshotHash(row.snapshot) !== row.hashSnapshot
    ) {
      res
        .status(409)
        .json({ error: "Verifica di integrità dell’emissione non superata" });
      return;
    }
    await db.transaction((tx) =>
      auditLogistica(tx, req, {
        entita: "volontario",
        id: row.id,
        azione: "download_emissione_registro",
        nuovo: {
          emissioneId: row.id,
          tipo: row.tipo,
          hashFile: row.hashFile,
          hashSnapshot: row.hashSnapshot,
        },
      }),
    );
    res.setHeader(
      "Content-Type",
      row.tipo === "PDF" ? "application/pdf" : VOLONTARI_XLSX_MIME,
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="registro-volontari-emissione-${row.id}.${row.tipo.toLowerCase()}"`,
    );
    res.send(buffer);
  },
);

router.get(
  "/volontari/registro/verifica-integrita",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    if (!req.user?.isSuperAdmin) {
      res.status(403).json({ error: "Funzione riservata al Super Admin" });
      return;
    }
    const result = await verifyVolontarioLedgerChain();
    await db.transaction((tx) =>
      auditLogistica(tx, req, {
        entita: "volontario",
        id: 0,
        azione: "verifica_integrita_ledger",
        nuovo: result,
      }),
    );
    res.status(result.valid ? 200 : 409).json(result);
  },
);

router.get(
  "/volontari/registro/eventi",
  requirePermission("logistica.volontari.view"),
  async (req, res) => {
    const centerId = callerCentroId(req);
    const areaId = callerAreaOperativaId(req);
    const eventCenterIds =
      centerId != null
        ? [centerId]
        : areaId != null
          ? (
              await db
                .select({ id: centriAscoltoTable.id })
                .from(centriAscoltoTable)
                .where(eq(centriAscoltoTable.areaOperativaId, areaId))
            ).map((center) => center.id)
          : null;
    const rows = await db
      .select()
      .from(registroVolontariEventiTable)
      .where(
        eventCenterIds == null
          ? undefined
          : eventCenterIds.length
            ? inArray(registroVolontariEventiTable.centroAscoltoId, eventCenterIds)
            : sql`false`,
      )
      .orderBy(desc(registroVolontariEventiTable.progressivo))
      .limit(500);
    res.json(
      canReadFullLedger(req)
        ? rows
        : rows.map((row) => ({
            ...row,
            snapshot: sanitizedLedgerSnapshot(row.snapshot),
          })),
    );
  },
);

router.post(
  "/volontari/registro/eventi/:eventoId/rettifica",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const id = Number(req.params.eventoId);
    const [event] = Number.isSafeInteger(id)
      ? await db
          .select()
          .from(registroVolontariEventiTable)
          .where(eq(registroVolontariEventiTable.id, id))
      : [];
    if (!event) {
      res.status(404).json({ error: "Evento non trovato" });
      return;
    }
    if (
      !canAccessCentro(event.centroAscoltoId, callerCentroId(req)) ||
      !inVisibleCentroSet(
        event.centroAscoltoId,
        await visibleCentroIds(callerAreaOperativaId(req)),
      )
    ) {
      res.status(403).json({ error: "Evento non accessibile" });
      return;
    }
    const motivo =
      typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    const requestedCorrections = req.body?.rettifiche;
    if (!motivo || !Array.isArray(requestedCorrections) || !requestedCorrections.length || requestedCorrections.length > 20) {
      res
        .status(400)
        .json({ error: "Motivo e rettifiche strutturate sono obbligatori" });
      return;
    }
    const corrections: StructuredVolunteerRegisterCorrection[] = [];
    for (const item of requestedCorrections) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        res.status(400).json({ error: "Rettifica non valida" });
        return;
      }
      const value = item as Record<string, unknown>;
      if (
        typeof value.campo !== "string" ||
        !VOLUNTEER_REGISTER_CORRECTION_FIELDS.includes(
          value.campo as (typeof VOLUNTEER_REGISTER_CORRECTION_FIELDS)[number],
        ) ||
        (value.nuovoValore != null &&
          typeof value.nuovoValore !== "string" &&
          typeof value.nuovoValore !== "number")
      ) {
        res.status(400).json({ error: "Campo o valore di rettifica non ammesso" });
        return;
      }
      const previous = event.snapshot[value.campo];
      if (JSON.stringify(value.valorePrecedente ?? null) !== JSON.stringify(previous ?? null)) {
        res.status(409).json({
          error: `Il valore precedente di ${value.campo} non coincide con l'evento`,
          code: "RETTIFICA_VALORE_PRECEDENTE_NON_CORRISPONDENTE",
        });
        return;
      }
      corrections.push({
        campo: value.campo as StructuredVolunteerRegisterCorrection["campo"],
        valorePrecedente: (value.valorePrecedente ?? null) as string | number | null,
        nuovoValore: (value.nuovoValore ?? null) as string | number | null,
      });
    }
    const requestedEffectiveDate = req.body?.dataEffettiva ?? todayRome();
    if (
      typeof requestedEffectiveDate !== "string" ||
      !isDateOnly(requestedEffectiveDate) ||
      requestedEffectiveDate < event.dataEffettiva
    ) {
      res.status(400).json({
        error: "La data di efficacia non può precedere l'evento rettificato",
      });
      return;
    }
    const corrected = await db.transaction(async (tx) => {
      const [volunteer] = await tx
        .select()
        .from(volontariTable)
        .where(eq(volontariTable.id, event.volontarioId))
        .limit(1);
      if (!volunteer) throw new Error("VOLUNTEER_NOT_FOUND");
      const dataEffettiva = requestedEffectiveDate;
      const correction = await appendVolontarioLedgerEvent(tx, {
        sezione: event.sezione as "PERMANENTE" | "TEMPORANEO",
        tipoEvento: "RETTIFICA",
        volontarioId: event.volontarioId,
        centroAscoltoId: event.centroAscoltoId,
        dataEffettiva,
        snapshot: await buildVolunteerEventSnapshot(tx, volunteer, {
          statoPrecedente:
            typeof event.snapshot.nuovoStato === "string"
              ? event.snapshot.nuovoStato
              : event.tipoEvento,
          nuovoStato: "RETTIFICATO",
          motivo,
          dataEffettiva,
          riferimentoEventoId: event.id,
          datiEvento: { rettifiche: corrections },
        }),
        eventoRettificatoId: event.id,
        utenteId: actorId(req),
      });
      await auditLogistica(tx, req, {
        entita: "volontario",
        id: event.volontarioId,
        azione: "rettifica_registro_volontari",
        precedente: { eventoId: event.id, hashEvento: event.hashEvento },
        nuovo: {
          eventoRettificaId: correction.id,
          motivo,
          rettifiche: corrections,
          hashEvento: correction.hashEvento,
        },
      });
      return correction;
    });
    res.status(201).json(corrected);
  },
);

export default router;
