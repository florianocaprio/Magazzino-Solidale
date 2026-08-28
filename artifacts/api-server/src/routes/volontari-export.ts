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
} from "../lib/volontariLedger";
import { operationalStatesForRows } from "../lib/volontariOperational";
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
  const visibleIds = await visibleCentroIds(callerAreaOperativaId(req));
  if (
    requestedCenter != null &&
    (!Number.isSafeInteger(requestedCenter) ||
      requestedCenter <= 0 ||
      !canAccessCentro(requestedCenter, callerCentroId(req)) ||
      !inVisibleCentroSet(requestedCenter, visibleIds))
  ) {
    return { ok: false, status: 403, error: "Centro non accessibile" };
  }
  const conditions: SQL[] = [];
  const tipo =
    typeof filters.tipo === "string" ? filters.tipo.toUpperCase() : "TUTTI";
  if (!["TUTTI", "PERMANENTE", "TEMPORANEO"].includes(tipo))
    return { ok: false, status: 400, error: "tipo non valido" };
  if (tipo !== "TUTTI")
    conditions.push(eq(volontariTable.tipoVolontario, tipo));
  const roleId =
    filters.ruoloVolontarioId == null || filters.ruoloVolontarioId === ""
      ? null
      : Number(filters.ruoloVolontarioId);
  if (roleId != null && (!Number.isSafeInteger(roleId) || roleId <= 0))
    return { ok: false, status: 400, error: "ruolo non valido" };
  if (roleId != null)
    conditions.push(eq(volontariTable.ruoloVolontarioId, roleId));
  const search =
    typeof filters.search === "string" ? filters.search.trim() : "";
  if (search) {
    conditions.push(
      or(
        ilike(volontariTable.nome, `%${search}%`),
        ilike(volontariTable.cognome, `%${search}%`),
        ilike(volontariTable.matricola, `%${search}%`),
      )!,
    );
  }
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
        centroScopeFilter(volontariTable.centroAscoltoId, callerCentroId(req)),
        idSetScopeFilter(volontariTable.centroAscoltoId, visibleIds),
        requestedCenter == null
          ? undefined
          : eq(volontariTable.centroAscoltoId, requestedCenter),
        ...conditions,
      ),
    )
    .orderBy(volontariTable.cognome, volontariTable.nome);
  const states = await operationalStatesForRows(
    db,
    rows,
    reference,
    requestedCenter,
  );
  let filtered = rows;
  const stato =
    typeof filters.stato === "string" ? filters.stato.toLowerCase() : "tutti";
  if (!["tutti", "attivi", "non_attivi"].includes(stato))
    return { ok: false, status: 400, error: "stato non valido" };
  if (stato === "attivi")
    filtered = rows.filter((row) => states.get(row.id)?.operativo);
  if (stato === "non_attivi")
    filtered = rows.filter((row) => !states.get(row.id)?.operativo);
  const assicurazione =
    typeof filters.assicurazione === "string"
      ? filters.assicurazione.toUpperCase()
      : "";
  if (assicurazione)
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
  if (servizioDa || servizioA) {
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

async function officialRegisterRows(rows: ExportRow[], reference: string) {
  const ids = rows.map((row) => row.id);
  const states = await operationalStatesForRows(db, rows, reference);
  const [registrations, stateEvents, serviceDays] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(registroVolontariEventiTable)
          .where(
            and(
              inArray(registroVolontariEventiTable.volontarioId, ids),
              eq(registroVolontariEventiTable.tipoEvento, "REGISTRAZIONE"),
              lte(registroVolontariEventiTable.dataEffettiva, reference),
            ),
          )
          .orderBy(asc(registroVolontariEventiTable.progressivo)),
        db
          .select()
          .from(statiVolontariTable)
          .where(
            and(
              inArray(statiVolontariTable.volontarioId, ids),
              lte(statiVolontariTable.dataEffettiva, reference),
            ),
          )
          .orderBy(
            asc(statiVolontariTable.dataEffettiva),
            asc(statiVolontariTable.id),
          ),
        db
          .select()
          .from(giornateServizioVolontariTable)
          .where(
            and(
              inArray(giornateServizioVolontariTable.volontarioId, ids),
              lte(giornateServizioVolontariTable.dataServizio, reference),
              ne(giornateServizioVolontariTable.stato, "ANNULLATA"),
            ),
          )
          .orderBy(asc(giornateServizioVolontariTable.dataServizio)),
      ])
    : [[], [], []];
  const firstRegistration = new Map<number, (typeof registrations)[number]>();
  for (const event of registrations) {
    if (!firstRegistration.has(event.volontarioId)) {
      firstRegistration.set(event.volontarioId, event);
    }
  }
  return rows.map((row, index) => {
    const state = states.get(row.id)!;
    const registration = firstRegistration.get(row.id);
    const registrationSnapshot = registration?.snapshot ?? {};
    const volunteerStateEvents = stateEvents.filter(
      (event) => event.volontarioId === row.id,
    );
    const latestStateEvent = volunteerStateEvents.at(-1);
    const cessation = volunteerStateEvents
      .filter(
        (event) =>
          event.tipoEvento === "SOSPENSIONE" &&
          event.motivo === "dimissioni_cessazione",
      )
      .at(-1);
    const volunteerServiceDays = serviceDays
      .filter((event) => event.volontarioId === row.id)
      .map((event) => event.dataServizio);
    const serviceInterval = volunteerServiceDays.length
      ? `${volunteerServiceDays[0]} – ${volunteerServiceDays.at(-1)}`
      : "";
    const origin =
      typeof registrationSnapshot.origine === "string"
        ? registrationSnapshot.origine
        : row.dataInizioImportata
          ? "IMPORT_VOLONTARI_2_0"
          : "MANUALE";
    const activityStart =
      row.dataInizioImportata ??
      registration?.dataEffettiva ??
      todayRome(row.dataCreazione);
    return {
      Progressivo: String(index + 1),
      Matricola: row.matricola ?? "",
      Cognome: row.cognome,
      Nome: row.nome,
      "Codice fiscale": row.codiceFiscale ?? "",
      "Data di nascita": row.dataNascita ?? "",
      "Luogo di nascita": row.luogoNascita ?? "",
      Residenza: row.indirizzoResidenza ?? "",
      Domicilio: "",
      "Tipo volontario": row.tipoVolontario,
      "Data inizio attività/iscrizione": activityStart,
      "Origine iscrizione": origin,
      "Da Data importata": row.dataInizioImportata ?? "",
      "Data cessazione": cessation?.dataEffettiva ?? "",
      "Stato alla data di riferimento":
        latestStateEvent?.tipoEvento === "SOSPENSIONE" &&
        latestStateEvent.motivo === "dimissioni_cessazione"
          ? "CESSATO"
          : state.operativo
            ? "ATTIVO"
            : "NON ATTIVO",
      "Motivo stato":
        latestStateEvent?.tipoEvento === "SOSPENSIONE"
          ? (latestStateEvent.motivo ?? state.motivoNonOperativo ?? "")
          : (state.motivoNonOperativo ?? ""),
      "Centro/Gruppo":
        row.centroAscoltoNome ?? row.gruppoImportatoOriginale ?? "",
      "Ruolo/Categoria":
        row.ruoloCatalogoNome ?? row.categoriaImportataOriginale ?? row.ruolo,
      "Scadenza assicurazione": state.scadenzaAssicurazione ?? "",
      "Date servizio temporaneo": volunteerServiceDays.join(", "),
      "Intervallo servizio temporaneo": serviceInterval,
      "Data di riferimento": reference,
      "Riferimento iscrizione": registration
        ? `REG-${registration.progressivo}`
        : "LEGACY-SENZA-EVENTO",
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
    const scoped = await scopedRows(req, params(req));
    if (!scoped.ok) {
      res.status(scoped.status).json({ error: scoped.error });
      return;
    }
    const type = String(req.body?.tipo ?? "PDF").toUpperCase();
    if (type !== "PDF" && type !== "XLSX") {
      res.status(400).json({ error: "Formato registro non valido" });
      return;
    }
    const snapshot = await officialRegisterRows(scoped.rows, scoped.reference);
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
      .orderBy(desc(emissioniRegistroVolontariTable.generatoAt));
    const visibleIds = await visibleCentroIds(callerAreaOperativaId(req));
    res.json(
      rows.filter(
        (row) =>
          canAccessCentro(row.centroAscoltoId, callerCentroId(req)) &&
          inVisibleCentroSet(row.centroAscoltoId, visibleIds),
      ),
    );
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
    if (
      !canAccessCentro(row.centroAscoltoId, callerCentroId(req)) ||
      !inVisibleCentroSet(
        row.centroAscoltoId,
        await visibleCentroIds(callerAreaOperativaId(req)),
      )
    ) {
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
  "/volontari/registro/eventi",
  requirePermission("logistica.volontari.view"),
  async (req, res) => {
    const visibleIds = await visibleCentroIds(callerAreaOperativaId(req));
    const rows = await db
      .select()
      .from(registroVolontariEventiTable)
      .orderBy(desc(registroVolontariEventiTable.progressivo))
      .limit(500);
    const scoped = rows.filter(
      (row) =>
        canAccessCentro(row.centroAscoltoId, callerCentroId(req)) &&
        inVisibleCentroSet(row.centroAscoltoId, visibleIds),
    );
    res.json(
      canReadFullLedger(req)
        ? scoped
        : scoped.map((row) => ({
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
    if (
      !motivo ||
      !req.body?.snapshot ||
      typeof req.body.snapshot !== "object" ||
      Array.isArray(req.body.snapshot)
    ) {
      res
        .status(400)
        .json({ error: "Motivo e snapshot di rettifica sono obbligatori" });
      return;
    }
    const corrected = await db.transaction(async (tx) => {
      const [volunteer] = await tx
        .select()
        .from(volontariTable)
        .where(eq(volontariTable.id, event.volontarioId))
        .limit(1);
      if (!volunteer) throw new Error("VOLUNTEER_NOT_FOUND");
      const dataEffettiva =
        req.body?.dataEffettiva && isDateOnly(req.body.dataEffettiva)
          ? req.body.dataEffettiva
          : todayRome();
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
          datiEvento: { datiRettificati: req.body.snapshot },
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
          hashEvento: correction.hashEvento,
        },
      });
      return correction;
    });
    res.status(201).json(corrected);
  },
);

export default router;
