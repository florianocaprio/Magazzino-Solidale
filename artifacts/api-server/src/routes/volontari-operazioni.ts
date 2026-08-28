import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  copertureAssicurativeVolontariTable,
  corsiDeiVolontariTable,
  corsiVolontariCatalogoTable,
  db,
  giornateServizioVolontariTable,
  qualificheDeiVolontariTable,
  qualificheVolontariCatalogoTable,
  statiVolontariTable,
  volontariTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  callerAreaOperativaId,
  callerCentroId,
  canAccessCentro,
  inVisibleCentroSet,
  visibleCentroIds,
} from "../lib/centroScope";
import { requireModulo } from "../lib/featureFlags";
import { auditLogistica } from "../lib/logisticaAudit";
import { parseRequiredVersion } from "../lib/logisticaPolicy";
import { requirePermission } from "../middlewares/auth";
import {
  addCalendarDays,
  extendedCoverageEnd,
  inclusiveCoverageEnd,
  isDateOnly,
  todayRome,
} from "../lib/volontariDomain";
import {
  appendVolontarioLedgerEvent,
  buildVolunteerEventSnapshot,
} from "../lib/volontariLedger";
import { operationalStateForVolunteer, operationalStatesForRows } from "../lib/volontariOperational";

const router: IRouter = Router();
router.use("/volontari", requireModulo("VOLONTARI"));

type ScopedVolunteer = typeof volontariTable.$inferSelect;

function idParam(req: Request): number | null {
  const id = Number(req.params.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function loadScopedVolunteer(req: Request, lock = false): Promise<
  | { ok: true; row: ScopedVolunteer }
  | { ok: false; status: 400 | 403 | 404; error: string }
> {
  const id = idParam(req);
  if (id == null) return { ok: false, status: 400, error: "Volontario non valido" };
  let query = db.select().from(volontariTable).where(eq(volontariTable.id, id));
  if (lock) query = query.for("update") as typeof query;
  const [row] = await query;
  if (!row) return { ok: false, status: 404, error: "Volontario non trovato" };
  if (!canAccessCentro(row.centroAscoltoId, callerCentroId(req))) {
    return { ok: false, status: 403, error: "Volontario non accessibile per il tuo centro" };
  }
  if (!inVisibleCentroSet(row.centroAscoltoId, await visibleCentroIds(callerAreaOperativaId(req)))) {
    return { ok: false, status: 403, error: "Volontario non accessibile per la tua area operativa" };
  }
  return { ok: true, row };
}

function userId(req: Request): number | null {
  return req.user?.id && req.user.id > 0 ? req.user.id : null;
}

function text(value: unknown, max = 2_000): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

const SUSPENSION_REASONS = [
  "indisponibilita_temporanea",
  "dimissioni_cessazione",
  "sospensione_organizzativa",
  "altro",
] as const;

router.post(
  "/volontari/:id/sospendi",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const scoped = await loadScopedVolunteer(req);
    if (!scoped.ok) { res.status(scoped.status).json({ error: scoped.error }); return; }
    const versione = parseRequiredVersion(req.body?.versione);
    const dataEffettiva = req.body?.dataEffettiva ?? todayRome();
    const motivo = text(req.body?.motivo, 80);
    if (versione == null || !isDateOnly(dataEffettiva) || !motivo || !SUSPENSION_REASONS.includes(motivo as typeof SUSPENSION_REASONS[number])) {
      res.status(400).json({ error: "versione, data sospensione e motivo validi sono obbligatori" });
      return;
    }
    const nowDate = todayRome();
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(volontariTable).where(eq(volontariTable.id, scoped.row.id)).for("update");
      if (!locked || locked.versione !== versione) return null;
      const [updated] = await tx.update(volontariTable).set({
        ...(dataEffettiva <= nowDate ? { attivo: false } : {}),
        versione: sql`${volontariTable.versione} + 1`,
        dataAggiornamento: new Date(),
      }).where(and(eq(volontariTable.id, locked.id), eq(volontariTable.versione, versione))).returning();
      if (!updated) return null;
      const [event] = await tx.insert(statiVolontariTable).values({
        volontarioId: locked.id,
        tipoEvento: "SOSPENSIONE",
        dataEffettiva,
        motivo,
        note: text(req.body?.note),
        creatoDa: userId(req),
      }).returning();
      await appendVolontarioLedgerEvent(tx, {
        sezione: locked.tipoVolontario as "PERMANENTE" | "TEMPORANEO",
        tipoEvento: "SOSPENSIONE_CESSAZIONE",
        volontarioId: locked.id,
        centroAscoltoId: locked.centroAscoltoId,
        dataEffettiva,
        snapshot: await buildVolunteerEventSnapshot(tx, updated, {
          statoPrecedente: locked.attivo ? "ATTIVO" : "NON_ATTIVO",
          nuovoStato:
            motivo === "dimissioni_cessazione" ? "CESSATO" : "SOSPESO",
          motivo,
          dataEffettiva,
          riferimentoEventoId: event.id,
          versione: updated.versione,
          datiEvento: { note: text(req.body?.note) },
        }),
        utenteId: userId(req),
      });
      await auditLogistica(tx, req, {
        entita: "volontario", id: locked.id, azione: "sospensione",
        precedente: { attivo: locked.attivo, versione: locked.versione },
        nuovo: { attivo: updated.attivo, dataEffettiva, motivo, versione: updated.versione },
      });
      return updated;
    });
    if (!result) { res.status(409).json({ error: "Il volontario è stato aggiornato da un altro operatore" }); return; }
    res.json({
      versione: result.versione,
      stato: await operationalStateForVolunteer(db, result.id, nowDate, result.centroAscoltoId),
    });
  },
);

router.post(
  "/volontari/:id/riattiva",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const scoped = await loadScopedVolunteer(req);
    if (!scoped.ok) { res.status(scoped.status).json({ error: scoped.error }); return; }
    const versione = parseRequiredVersion(req.body?.versione);
    const dataEffettiva = req.body?.dataEffettiva ?? todayRome();
    if (versione == null || !isDateOnly(dataEffettiva)) {
      res.status(400).json({ error: "versione e data riattivazione valide sono obbligatorie" }); return;
    }
    if (scoped.row.statoApprovazione !== "approvato") {
      res.status(409).json({ error: "Un volontario non approvato non può essere riattivato" }); return;
    }
    const nowDate = todayRome();
    const updated = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(volontariTable).where(eq(volontariTable.id, scoped.row.id)).for("update");
      if (!locked || locked.versione !== versione) return null;
      const [row] = await tx.update(volontariTable).set({
        ...(dataEffettiva <= nowDate ? { attivo: true } : {}),
        versione: sql`${volontariTable.versione} + 1`, dataAggiornamento: new Date(),
      }).where(and(eq(volontariTable.id, locked.id), eq(volontariTable.versione, versione))).returning();
      if (!row) return null;
      const [event] = await tx.insert(statiVolontariTable).values({
        volontarioId: locked.id, tipoEvento: "RIATTIVAZIONE", dataEffettiva,
        motivo: "riattivazione", note: text(req.body?.note), creatoDa: userId(req),
      }).returning();
      await appendVolontarioLedgerEvent(tx, {
        sezione: locked.tipoVolontario as "PERMANENTE" | "TEMPORANEO",
        tipoEvento: "RIATTIVAZIONE", volontarioId: locked.id,
        centroAscoltoId: locked.centroAscoltoId, dataEffettiva,
        snapshot: await buildVolunteerEventSnapshot(tx, row, {
          statoPrecedente: locked.attivo ? "ATTIVO" : "SOSPESO",
          nuovoStato: "ATTIVO",
          motivo: "riattivazione",
          dataEffettiva,
          riferimentoEventoId: event.id,
          versione: row.versione,
          datiEvento: { note: text(req.body?.note) },
        }),
        utenteId: userId(req),
      });
      await auditLogistica(tx, req, {
        entita: "volontario", id: locked.id, azione: "riattivazione",
        precedente: { attivo: locked.attivo, versione: locked.versione },
        nuovo: { attivo: row.attivo, dataEffettiva, versione: row.versione },
      });
      return row;
    });
    if (!updated) { res.status(409).json({ error: "Il volontario è stato aggiornato da un altro operatore" }); return; }
    const state = await operationalStateForVolunteer(db, updated.id, nowDate, updated.centroAscoltoId);
    res.json({
      versione: updated.versione,
      stato: state,
      messaggio: state?.operativo
        ? "Il volontario è nuovamente operativo."
        : state?.statoAssicurazione === "SCADUTA"
          ? `La sospensione è stata rimossa, ma il volontario non è operativo perché la copertura assicurativa è scaduta il ${state.scadenzaAssicurazione}.`
          : "La sospensione è stata rimossa, ma il volontario non è ancora operativo.",
      azioneSuggerita: state?.statoAssicurazione === "SCADUTA" || state?.statoAssicurazione === "MANCANTE"
        ? "REGISTRA_RINNOVA_ASSICURAZIONE" : null,
    });
  },
);

type CoverageRequest = {
  modalita?: "CONTINUA_SCADENZA" | "NUOVA_DA_DATA";
  dataDecorrenza?: string;
  durataMesi?: number;
  riferimentoPolizza?: string;
  note?: string;
};

async function coverageValues(
  volontarioId: number,
  body: CoverageRequest,
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db,
) {
  const durataMesi = Number(body.durataMesi ?? 12);
  if (!Number.isSafeInteger(durataMesi) || durataMesi <= 0 || durataMesi > 120) {
    return { ok: false as const, error: "La durata deve essere compresa tra 1 e 120 mesi" };
  }
  if (body.modalita !== "CONTINUA_SCADENZA" && body.modalita !== "NUOVA_DA_DATA") {
    return { ok: false as const, error: "Modalità assicurativa non valida" };
  }
  const [current] = await executor.select({ dataFine: copertureAssicurativeVolontariTable.dataFine })
    .from(copertureAssicurativeVolontariTable)
    .where(and(eq(copertureAssicurativeVolontariTable.volontarioId, volontarioId), eq(copertureAssicurativeVolontariTable.annullata, false)))
    .orderBy(desc(copertureAssicurativeVolontariTable.dataFine)).limit(1);
  if (body.modalita === "CONTINUA_SCADENZA") {
    if (!current) return { ok: false as const, error: "Non esiste una scadenza da cui continuare: usa Nuova copertura" };
    return {
      ok: true as const, durataMesi,
      dataInizio: addCalendarDays(current.dataFine, 1),
      dataFine: extendedCoverageEnd(current.dataFine, durataMesi),
      vecchiaScadenza: current.dataFine,
      tipoOperazione: "RINNOVO" as const,
    };
  }
  if (!isDateOnly(body.dataDecorrenza)) return { ok: false as const, error: "Data di decorrenza non valida" };
  return {
    ok: true as const, durataMesi, dataInizio: body.dataDecorrenza,
    dataFine: inclusiveCoverageEnd(body.dataDecorrenza, durataMesi),
    vecchiaScadenza: current?.dataFine ?? null,
    tipoOperazione: current ? "RINNOVO" as const : "NUOVA_COPERTURA" as const,
  };
}

router.post(
  "/volontari/:id/assicurazione",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const scoped = await loadScopedVolunteer(req);
    if (!scoped.ok) { res.status(scoped.status).json({ error: scoped.error }); return; }
    const versione = parseRequiredVersion(req.body?.versione);
    if (versione == null) { res.status(400).json({ error: "versione obbligatoria" }); return; }
    const values = await coverageValues(scoped.row.id, req.body as CoverageRequest);
    if (!values.ok) { res.status(400).json({ error: values.error }); return; }
    const created = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(volontariTable).where(eq(volontariTable.id, scoped.row.id)).for("update");
      if (!locked || locked.versione !== versione) return null;
      const [coverage] = await tx.insert(copertureAssicurativeVolontariTable).values({
        volontarioId: locked.id, dataInizio: values.dataInizio, dataFine: values.dataFine,
        durataMesi: values.durataMesi, tipoOperazione: values.tipoOperazione,
        riferimentoPolizza: text(req.body?.riferimentoPolizza, 120), note: text(req.body?.note),
        creatoDa: userId(req),
      }).returning();
      const [updated] = await tx.update(volontariTable).set({
        versione: sql`${volontariTable.versione} + 1`, dataAggiornamento: new Date(),
      }).where(and(eq(volontariTable.id, locked.id), eq(volontariTable.versione, versione))).returning();
      if (!updated) return null;
      await auditLogistica(tx, req, {
        entita: "volontario", id: locked.id, azione: "registrazione_assicurazione",
        precedente: { scadenzaAssicurazione: values.vecchiaScadenza, versione: locked.versione },
        nuovo: { coperturaId: coverage.id, dataInizio: coverage.dataInizio, dataFine: coverage.dataFine, versione: updated.versione },
      });
      return { coverage, updated };
    });
    if (!created) { res.status(409).json({ error: "Il volontario è stato aggiornato da un altro operatore" }); return; }
    res.status(201).json({
      copertura: created.coverage,
      versione: created.updated.versione,
      stato: await operationalStateForVolunteer(db, scoped.row.id, todayRome(), scoped.row.centroAscoltoId),
    });
  },
);

router.post(
  "/volontari/assicurazione/massivo/preview",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const ids: number[] = Array.isArray(req.body?.volontarioIds)
      ? [...new Set<number>(req.body.volontarioIds.map(Number).filter((id: number) => Number.isSafeInteger(id) && id > 0))]
      : [];
    if (!ids.length || ids.length > 2_000) { res.status(400).json({ error: "Seleziona da 1 a 2.000 volontari" }); return; }
    const visibleIds = await visibleCentroIds(callerAreaOperativaId(req));
    const rows = await db.select().from(volontariTable).where(inArray(volontariTable.id, ids));
    const allowed = rows.filter((row) => canAccessCentro(row.centroAscoltoId, callerCentroId(req)) && inVisibleCentroSet(row.centroAscoltoId, visibleIds));
    if (allowed.length !== ids.length) { res.status(403).json({ error: "La selezione contiene volontari fuori perimetro" }); return; }
    const states = await operationalStatesForRows(db, allowed, todayRome());
    const items = await Promise.all(allowed.map(async (row) => {
      const coverage = await coverageValues(row.id, req.body as CoverageRequest);
      const state = states.get(row.id)!;
      return coverage.ok ? {
        volontarioId: row.id, versione: row.versione,
        volontario: `${row.cognome} ${row.nome}`,
        vecchiaScadenza: coverage.vecchiaScadenza,
        motivoNonOperativo: state.motivoNonOperativo,
        nuovaDecorrenza: coverage.dataInizio, nuovaScadenza: coverage.dataFine,
        esitoPrevisto: state.sospesoManualmente ? "RESTA_NON_OPERATIVO_SOSPESO" : "RICALCOLATO_DOPO_CONFERMA",
        incluso: true, esclusioneMotivo: null,
      } : {
        volontarioId: row.id, versione: row.versione,
        volontario: `${row.cognome} ${row.nome}`,
        vecchiaScadenza: state.scadenzaAssicurazione,
        motivoNonOperativo: state.motivoNonOperativo,
        nuovaDecorrenza: null, nuovaScadenza: null,
        esitoPrevisto: "ESCLUSO", incluso: false, esclusioneMotivo: coverage.error,
      };
    }));
    res.json({ items });
  },
);

router.post(
  "/volontari/assicurazione/massivo/conferma",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const selections = Array.isArray(req.body?.righe) ? req.body.righe.filter((row: any) => row?.incluso !== false) : [];
    if (!selections.length || selections.length > 2_000) { res.status(400).json({ error: "Nessuna riga selezionata" }); return; }
    const ids: number[] = [...new Set<number>(selections.map((row: any) => Number(row.volontarioId)))];
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) { res.status(400).json({ error: "Selezione non valida" }); return; }
    const visibleIds = await visibleCentroIds(callerAreaOperativaId(req));
    const rows = await db.select().from(volontariTable).where(inArray(volontariTable.id, ids));
    if (rows.length !== ids.length || rows.some((row) => !canAccessCentro(row.centroAscoltoId, callerCentroId(req)) || !inVisibleCentroSet(row.centroAscoltoId, visibleIds))) {
      res.status(403).json({ error: "La selezione contiene volontari non accessibili" }); return;
    }
    const groupId = randomUUID();
    const result = await db.transaction(async (tx) => {
      const locked = await tx.select().from(volontariTable).where(inArray(volontariTable.id, ids)).orderBy(asc(volontariTable.id)).for("update");
      const output: Array<Record<string, unknown>> = [];
      for (const row of locked) {
        const input = selections.find((item: any) => Number(item.volontarioId) === row.id);
        if (parseRequiredVersion(input?.versione) !== row.versione) throw new Error("STALE_VERSION");
        const coverage = await coverageValues(row.id, req.body as CoverageRequest, tx);
        if (!coverage.ok) { output.push({ volontarioId: row.id, esito: "ESCLUSO", motivo: coverage.error }); continue; }
        const [created] = await tx.insert(copertureAssicurativeVolontariTable).values({
          volontarioId: row.id, dataInizio: coverage.dataInizio, dataFine: coverage.dataFine,
          durataMesi: coverage.durataMesi, tipoOperazione: coverage.tipoOperazione,
          riferimentoPolizza: text(req.body?.riferimentoPolizza, 120), note: text(req.body?.note),
          gruppoOperazioneId: groupId, creatoDa: userId(req),
        }).returning();
        const [updated] = await tx.update(volontariTable).set({ versione: sql`${volontariTable.versione} + 1`, dataAggiornamento: new Date() })
          .where(and(eq(volontariTable.id, row.id), eq(volontariTable.versione, row.versione))).returning();
        if (!updated) throw new Error("STALE_VERSION");
        await auditLogistica(tx, req, {
          entita: "volontario", id: row.id, azione: "rinnovo_assicurativo_massivo",
          precedente: { scadenzaAssicurazione: coverage.vecchiaScadenza, versione: row.versione },
          nuovo: { coperturaId: created.id, dataFine: created.dataFine, gruppoOperazioneId: groupId, versione: updated.versione },
        });
        output.push({ volontarioId: row.id, esito: "RINNOVATO", nuovaScadenza: created.dataFine, versione: updated.versione });
      }
      return output;
    }).catch((error) => {
      if (error instanceof Error && error.message === "STALE_VERSION") return null;
      throw error;
    });
    if (!result) { res.status(409).json({ error: "Almeno un volontario è stato aggiornato da un altro operatore" }); return; }
    res.json({ gruppoOperazioneId: groupId, risultati: result });
  },
);

router.get(
  "/volontari/:id/dossier",
  requirePermission("logistica.volontari.view"),
  async (req, res) => {
    const scoped = await loadScopedVolunteer(req);
    if (!scoped.ok) { res.status(scoped.status).json({ error: scoped.error }); return; }
    const [stati, coperture, giornate, corsi, qualifiche] = await Promise.all([
      db.select().from(statiVolontariTable).where(eq(statiVolontariTable.volontarioId, scoped.row.id)).orderBy(desc(statiVolontariTable.dataEffettiva), desc(statiVolontariTable.id)),
      db.select().from(copertureAssicurativeVolontariTable).where(eq(copertureAssicurativeVolontariTable.volontarioId, scoped.row.id)).orderBy(desc(copertureAssicurativeVolontariTable.dataFine)),
      db.select().from(giornateServizioVolontariTable).where(eq(giornateServizioVolontariTable.volontarioId, scoped.row.id)).orderBy(desc(giornateServizioVolontariTable.dataServizio)),
      db.select({ record: corsiDeiVolontariTable, catalogo: corsiVolontariCatalogoTable }).from(corsiDeiVolontariTable).innerJoin(corsiVolontariCatalogoTable, eq(corsiDeiVolontariTable.corsoId, corsiVolontariCatalogoTable.id)).where(eq(corsiDeiVolontariTable.volontarioId, scoped.row.id)).orderBy(desc(corsiDeiVolontariTable.dataCompletamento)),
      db.select({ record: qualificheDeiVolontariTable, catalogo: qualificheVolontariCatalogoTable }).from(qualificheDeiVolontariTable).innerJoin(qualificheVolontariCatalogoTable, eq(qualificheDeiVolontariTable.qualificaId, qualificheVolontariCatalogoTable.id)).where(eq(qualificheDeiVolontariTable.volontarioId, scoped.row.id)).orderBy(desc(qualificheDeiVolontariTable.dataOttenimento)),
    ]);
    res.json({
      statoOperativo: await operationalStateForVolunteer(db, scoped.row.id, todayRome(), scoped.row.centroAscoltoId),
      stati, coperture, giornate, corsi, qualifiche,
    });
  },
);

router.post(
  "/volontari/:id/giornate",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const scoped = await loadScopedVolunteer(req);
    if (!scoped.ok) { res.status(scoped.status).json({ error: scoped.error }); return; }
    if (scoped.row.tipoVolontario !== "TEMPORANEO") { res.status(409).json({ error: "Le giornate di servizio sono previste per i volontari temporanei" }); return; }
    const dataServizio = req.body?.dataServizio;
    const stato = String(req.body?.stato ?? "PIANIFICATA").toUpperCase();
    if (!isDateOnly(dataServizio) || !["PIANIFICATA", "PRESENTE", "ASSENTE", "ANNULLATA"].includes(stato)) {
      res.status(400).json({ error: "Data o stato della giornata non validi" }); return;
    }
    const centroAscoltoId = req.body?.centroAscoltoId == null ? scoped.row.centroAscoltoId : Number(req.body.centroAscoltoId);
    if (centroAscoltoId != null && (!canAccessCentro(centroAscoltoId, callerCentroId(req)) || !inVisibleCentroSet(centroAscoltoId, await visibleCentroIds(callerAreaOperativaId(req))))) {
      res.status(403).json({ error: "Centro della giornata non accessibile" }); return;
    }
    const state = await operationalStateForVolunteer(db, scoped.row.id, dataServizio, centroAscoltoId);
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(giornateServizioVolontariTable).values({
        volontarioId: scoped.row.id, dataServizio, centroAscoltoId,
        attivita: text(req.body?.attivita, 200), stato,
        coperturaVerificata: state?.statoAssicurazione === "VALIDA" || state?.statoAssicurazione === "IN_SCADENZA",
        note: text(req.body?.note), creatoDa: userId(req),
      }).returning();
      await appendVolontarioLedgerEvent(tx, {
        sezione: "TEMPORANEO", tipoEvento: "GIORNATA_TEMPORANEA",
        volontarioId: scoped.row.id, centroAscoltoId, dataEffettiva: dataServizio,
        snapshot: await buildVolunteerEventSnapshot(tx, scoped.row, {
          statoPrecedente: null,
          nuovoStato: stato,
          motivo: "giornata_temporanea",
          dataEffettiva: dataServizio,
          riferimentoEventoId: row.id,
          datiEvento: {
            giornataId: row.id,
            attivita: row.attivita,
            coperturaVerificata: row.coperturaVerificata,
          },
        }),
        utenteId: userId(req),
      });
      await auditLogistica(tx, req, { entita: "volontario", id: scoped.row.id, azione: "giornata_temporanea", nuovo: { giornataId: row.id, dataServizio, stato } });
      return row;
    });
    res.status(201).json(created);
  },
);

router.patch(
  "/volontari/:id/giornate/:giornataId",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const scoped = await loadScopedVolunteer(req);
    if (!scoped.ok) { res.status(scoped.status).json({ error: scoped.error }); return; }
    const giornataId = Number(req.params.giornataId);
    const versione = parseRequiredVersion(req.body?.versione);
    const stato = req.body?.stato == null ? undefined : String(req.body.stato).toUpperCase();
    if (!Number.isSafeInteger(giornataId) || giornataId <= 0 || versione == null || (stato && !["PIANIFICATA", "PRESENTE", "ASSENTE", "ANNULLATA"].includes(stato))) {
      res.status(400).json({ error: "Modifica giornata non valida" }); return;
    }
    const updated = await db.transaction(async (tx) => {
      const [previous] = await tx
        .select()
        .from(giornateServizioVolontariTable)
        .where(
          and(
            eq(giornateServizioVolontariTable.id, giornataId),
            eq(giornateServizioVolontariTable.volontarioId, scoped.row.id),
          ),
        )
        .for("update");
      if (!previous || previous.versione !== versione) return null;
      const [row] = await tx
        .update(giornateServizioVolontariTable)
        .set({
          ...(stato ? { stato } : {}),
          ...(req.body?.attivita !== undefined
            ? { attivita: text(req.body.attivita, 200) }
            : {}),
          ...(req.body?.note !== undefined
            ? { note: text(req.body.note) }
            : {}),
          versione: sql`${giornateServizioVolontariTable.versione} + 1`,
          dataAggiornamento: new Date(),
        })
        .where(
          and(
            eq(giornateServizioVolontariTable.id, giornataId),
            eq(giornateServizioVolontariTable.versione, versione),
          ),
        )
        .returning();
      if (!row) return null;
      await appendVolontarioLedgerEvent(tx, {
        sezione: "TEMPORANEO",
        tipoEvento: "GIORNATA_TEMPORANEA",
        volontarioId: scoped.row.id,
        centroAscoltoId: row.centroAscoltoId,
        dataEffettiva: row.dataServizio,
        snapshot: await buildVolunteerEventSnapshot(tx, scoped.row, {
          statoPrecedente: previous.stato,
          nuovoStato: row.stato,
          motivo: "modifica_giornata_temporanea",
          dataEffettiva: row.dataServizio,
          riferimentoEventoId: row.id,
          versione: row.versione,
          datiEvento: {
            attivitaPrecedente: previous.attivita,
            attivita: row.attivita,
          },
        }),
        utenteId: userId(req),
      });
      await auditLogistica(tx, req, {
        entita: "volontario",
        id: scoped.row.id,
        azione: "modifica_giornata_temporanea",
        precedente: {
          giornataId: previous.id,
          stato: previous.stato,
          versione: previous.versione,
        },
        nuovo: {
          giornataId: row.id,
          stato: row.stato,
          versione: row.versione,
        },
      });
      return row;
    });
    if (!updated) { res.status(409).json({ error: "Giornata non trovata o aggiornata da un altro operatore" }); return; }
    res.json(updated);
  },
);

export default router;
