import { createHash } from "node:crypto";
import express, { Router, type IRouter, type Request } from "express";
import {
  centriAscoltoTable,
  copertureAssicurativeVolontariTable,
  db,
  giornateServizioVolontariTable,
  importazioniVolontariRigheTable,
  importazioniVolontariTable,
  matricoleVolontariTable,
  ruoliVolontariTable,
  volontariTable,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  callerAreaOperativaId,
  callerCentroId,
  canAccessCentro,
} from "../lib/centroScope";
import { requireModulo } from "../lib/featureFlags";
import { auditLogistica } from "../lib/logisticaAudit";
import {
  normalizeCodiceFiscale,
  normalizeComparableText,
  normalizeEmail,
  normalizePhone,
  normalizeRoleName,
  parseFullName,
  isDateOnly,
  todayRome,
} from "../lib/volontariDomain";
import {
  appendVolontarioLedgerEvent,
  buildVolunteerEventSnapshot,
  buildVolunteerRegistrationSnapshot,
  canonicalSnapshotHash,
} from "../lib/volontariLedger";
import {
  isVolontarioCodiceFiscaleUniqueViolation,
  isVolontarioMatricolaUniqueViolation,
  MATRICOLA_DUPLICATA_MSG,
  normalizeVolunteerIdentifier,
  assignPermanentVolunteerIdentifier,
  assignTemporaryVolunteerIdentifier,
  registerImportedVolunteerIdentifier,
  VolunteerIdentifierError,
} from "../lib/volontariMatricola";
import {
  canAccessVolunteerOwnerScope,
  resolveVolunteerOwnerScope,
  scopeContainsCenter,
} from "../lib/volontariScope";
import {
  parseVolontariWorkbook,
  VOLONTARI_IMPORT_MAX_BYTES,
  VOLONTARI_XLSX_MIME,
  VolontariWorkbookError,
} from "../lib/volontariWorkbook";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/volontari", requireModulo("VOLONTARI"));
const actorId = (req: Request): number | null =>
  req.user?.id && req.user.id > 0 ? req.user.id : null;
const xlsxBody = express.raw({
  type: [VOLONTARI_XLSX_MIME, "application/octet-stream"],
  limit: VOLONTARI_IMPORT_MAX_BYTES,
});

type NormalizedImport = {
  nome: string | null;
  cognome: string | null;
  matricola: string | null;
  luogoNascita: string | null;
  dataNascita: string | null;
  indirizzoResidenza: string | null;
  codiceFiscale: string | null;
  codiceFiscaleNormalizzato: string | null;
  dataInizioImportata: string | null;
  scadenzaAssicurazione: string | null;
  telefono: string | null;
  telefonoSecondario: string | null;
  email: string | null;
  gruppoOriginale: string | null;
  categoriaOriginale: string | null;
  tipoVolontario: "PERMANENTE" | "TEMPORANEO" | null;
  dataServizio: string | null;
};

function levenshtein(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = old;
    }
  }
  return row[right.length];
}

function parsedType(value: string | null): "PERMANENTE" | "TEMPORANEO" | null {
  if (!value) return "PERMANENTE";
  const normalized = normalizeComparableText(value);
  if (["permanente", "effettivo", "permanente effettivo"].includes(normalized)) return "PERMANENTE";
  if (["temporaneo", "occasionale"].includes(normalized)) return "TEMPORANEO";
  return null;
}

function normalizeRow(row: ReturnType<typeof parseVolontariWorkbook>["rows"][number]): {
  data: NormalizedImport;
  errors: string[];
  warnings: string[];
} {
  const parsedName = parseFullName(row.nominativo);
  const tipoVolontario = parsedType(row.tipoVolontario);
  const errors = [...row.errori];
  const warnings: string[] = [];
  if (!row.codice) warnings.push("Matricola assente: sarà generata automaticamente al commit");
  if (!row.dataInizioImportata) warnings.push("Data di iscrizione/inizio attività mancante");
  if (!parsedName.nome || !parsedName.cognome) errors.push("Cognome e Nome non separabili");
  else if (parsedName.warning) warnings.push(parsedName.warning);
  if (!row.categoria) errors.push("Categoria/ruolo obbligatoria");
  if (!tipoVolontario) errors.push("Tipo volontario non riconosciuto");
  if (tipoVolontario === "TEMPORANEO" && !row.dataServizio) errors.push("Data servizio obbligatoria per un temporaneo importato");
  return {
    data: {
      nome: parsedName.nome,
      cognome: parsedName.cognome,
      matricola: row.codice?.trim() ?? null,
      luogoNascita: row.luogoNascita,
      dataNascita: row.dataNascita,
      indirizzoResidenza: row.indirizzoResidenza,
      codiceFiscale: normalizeCodiceFiscale(row.codiceFiscale),
      codiceFiscaleNormalizzato: normalizeCodiceFiscale(row.codiceFiscale),
      dataInizioImportata: row.dataInizioImportata,
      scadenzaAssicurazione: row.scadenzaAssicurazione,
      telefono: normalizePhone(row.cellulare),
      telefonoSecondario: normalizePhone(row.telefono),
      email: normalizeEmail(row.email),
      gruppoOriginale: row.gruppo,
      categoriaOriginale: row.categoria,
      tipoVolontario,
      dataServizio: row.dataServizio,
    },
    errors,
    warnings,
  };
}

function sameImportedFields(existing: typeof volontariTable.$inferSelect, row: NormalizedImport, ruoloId: number | null, centroId: number | null): boolean {
  return existing.nome === row.nome
    && existing.cognome === row.cognome
    && (!row.matricola || normalizeVolunteerIdentifier(existing.matricola) === normalizeVolunteerIdentifier(row.matricola))
    && (existing.luogoNascita ?? null) === row.luogoNascita
    && (existing.dataNascita ?? null) === row.dataNascita
    && (existing.indirizzoResidenza ?? null) === row.indirizzoResidenza
    && (existing.codiceFiscaleNormalizzato ?? null) === row.codiceFiscaleNormalizzato
    && (existing.telefono ?? null) === row.telefono
    && (existing.telefonoSecondario ?? null) === row.telefonoSecondario
    && (existing.email?.toLowerCase() ?? null) === row.email
    && existing.tipoVolontario === row.tipoVolontario
    && (existing.dataInizioImportata ?? existing.dataIscrizione ?? null) === row.dataInizioImportata
    && (existing.categoriaImportataOriginale ?? null) === row.categoriaOriginale
    && (existing.gruppoImportatoOriginale ?? null) === row.gruppoOriginale
    && existing.ruoloVolontarioId === ruoloId
    && existing.centroAscoltoId === centroId;
}

function volunteerCandidateFingerprint(row: typeof volontariTable.$inferSelect): string {
  return canonicalSnapshotHash({
    versione: row.versione,
    nome: row.nome,
    cognome: row.cognome,
    matricolaNormalizzata: normalizeVolunteerIdentifier(row.matricola),
    codiceFiscaleNormalizzato: row.codiceFiscaleNormalizzato,
    tipoVolontario: row.tipoVolontario,
    centroAscoltoId: row.centroAscoltoId,
    ruoloVolontarioId: row.ruoloVolontarioId,
    dataInizioImportata: row.dataInizioImportata,
    dataIscrizione: row.dataIscrizione,
    categoriaImportataOriginale: row.categoriaImportataOriginale,
    gruppoImportatoOriginale: row.gruppoImportatoOriginale,
    telefono: row.telefono,
    email: row.email?.trim().toLowerCase() ?? null,
  });
}

const IMPORT_CORRECTION_FIELDS = new Set<keyof NormalizedImport>([
  "nome", "cognome", "matricola", "luogoNascita", "dataNascita",
  "indirizzoResidenza", "codiceFiscale",
  "dataInizioImportata", "scadenzaAssicurazione", "telefono",
  "telefonoSecondario", "email", "gruppoOriginale", "categoriaOriginale",
  "tipoVolontario", "dataServizio",
]);

function validatedCorrections(value: unknown): Partial<NormalizedImport> | null {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([key]) => !IMPORT_CORRECTION_FIELDS.has(key as keyof NormalizedImport)))
    return null;
  if (entries.some(([, item]) => item !== null && typeof item !== "string")) return null;
  return Object.fromEntries(entries) as Partial<NormalizedImport>;
}

function previewBatch(batch: typeof importazioniVolontariTable.$inferSelect, rows: Array<typeof importazioniVolontariRigheTable.$inferSelect>) {
  return {
    importazioneId: batch.id,
    nomeFile: batch.nomeFile,
    stato: batch.stato,
    hashFile: batch.sha256File,
    sha256File: batch.sha256File,
    hashContenutoNormalizzato: batch.hashContenutoNormalizzato,
    scopeTipo: batch.scopeTipo,
    scopeCentroId: batch.scopeCentroId,
    scopeAreaOperativaId: batch.scopeAreaOperativaId,
    scopeCentroIdsSnapshot: batch.scopeCentroIdsSnapshot,
    scopeFingerprint: batch.scopeFingerprint,
    numeroRighe: batch.numeroRighe,
    righe: rows.map((row) => ({
      numeroRiga: row.numeroRiga,
      stato: row.statoRiga,
      hashRiga: row.hashRiga,
      datiOriginali: row.datiOriginali,
      datiNormalizzati: row.datiNormalizzati,
      matricolaProposta: (() => {
        const data = row.datiNormalizzati as NormalizedImport;
        if (data.matricola) return null;
        return {
          modalita: "AUTOMATICA_AL_COMMIT",
          tipoIdentificativo: data.tipoVolontario === "TEMPORANEO" ? "TEMPORANEA" : "PERMANENTE",
          formato: data.tipoVolontario === "TEMPORANEO" ? "XXX-XXX" : "Configurazione matricole vigente",
          consumaProgressivo: false,
        };
      })(),
      volontarioCandidatoId: row.volontarioCandidatoId,
      versioneCandidato: row.versioneCandidato,
      fingerprintCandidato: row.fingerprintCandidato,
      fingerprintMappingPreview: row.fingerprintMappingPreview,
      dataAnalisi: row.dataAnalisi,
      ruoloPropostoId: row.ruoloPropostoId,
      centroPropostoId: row.centroPropostoId,
      errori: row.errori,
      avvisi: row.avvisi,
      esclusa: row.esclusa,
      esitoCommit: row.esitoCommit,
      volontarioRisultatoId: row.volontarioRisultatoId,
    })),
  };
}

router.post(
  "/volontari/import/analizza",
  requirePermission("logistica.volontari.manage"),
  xlsxBody,
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "File XLSX mancante" }); return;
    }
    const fileName = (req.get("x-file-name") ?? "RegistroVolontari.xlsx").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 255);
    if (!fileName.toLowerCase().endsWith(".xlsx")) { res.status(400).json({ error: "È richiesto un file .xlsx" }); return; }
    let parsed: ReturnType<typeof parseVolontariWorkbook>;
    try {
      parsed = parseVolontariWorkbook(req.body);
    } catch (error) {
      if (error instanceof VolontariWorkbookError) { res.status(400).json({ error: error.message, code: error.code }); return; }
      throw error;
    }
    const caller = callerCentroId(req);
    const callerAreaId = callerAreaOperativaId(req);
    const requestedCenter = req.query.centroAscoltoId == null ? null : Number(req.query.centroAscoltoId);
    const [requestedCenterRow] = requestedCenter == null
      ? []
      : await db
          .select({ areaOperativaId: centriAscoltoTable.areaOperativaId })
          .from(centriAscoltoTable)
          .where(eq(centriAscoltoTable.id, requestedCenter));
    if (
      requestedCenter != null &&
      (!Number.isSafeInteger(requestedCenter) ||
        !canAccessCentro(requestedCenter, caller) ||
        !requestedCenterRow ||
        (callerAreaId != null &&
          requestedCenterRow.areaOperativaId !== callerAreaId))
    ) {
      res.status(403).json({ error: "Centro import non accessibile" }); return;
    }
    const effectiveCenter = caller ?? requestedCenter;
    const ownerScope = await resolveVolunteerOwnerScope(req, effectiveCenter);
    const [roles, centers, volunteers, identifiers] = await Promise.all([
      db.select().from(ruoliVolontariTable),
      db.select().from(centriAscoltoTable),
      db.select().from(volontariTable),
      db.select().from(matricoleVolontariTable),
    ]);
    const allowedCenters = centers.filter((center) =>
      caller != null
        ? center.id === caller
        : callerAreaId != null
          ? center.areaOperativaId === callerAreaId
          : true,
    );
    const allowedCenterSet = new Set(allowedCenters.map((center) => center.id));
    const visibleVolunteers = volunteers.filter((volunteer) =>
      caller == null && callerAreaId == null
        ? true
        : volunteer.centroAscoltoId != null &&
          allowedCenterSet.has(volunteer.centroAscoltoId),
    );
    const normalized = parsed.rows.map((source) => {
      const row = normalizeRow(source);
      const roleKey = normalizeRoleName(row.data.categoriaOriginale);
      let role = roles.find((item) => (item.nomeNormalizzato ?? normalizeRoleName(item.nome)) === roleKey) ?? null;
      if (!role && roleKey) {
        const close = roles.filter((item) => levenshtein(item.nomeNormalizzato ?? normalizeRoleName(item.nome), roleKey) <= 2);
        if (close.length === 1) {
          role = close[0];
          row.warnings.push(`Categoria simile al ruolo “${role.nome}”: confermare la mappatura`);
        } else row.warnings.push(`Ruolo “${row.data.categoriaOriginale}” non presente: mappare o crearne uno`);
      }
      const groupKey = normalizeComparableText(row.data.gruppoOriginale);
      const groupMatches = groupKey ? allowedCenters.filter((item) => normalizeComparableText(item.nome) === groupKey) : [];
      const center = caller != null
        ? centers.find((item) => item.id === caller) ?? null
        : groupMatches.length === 1
          ? groupMatches[0]
          : effectiveCenter != null
            ? allowedCenters.find((item) => item.id === effectiveCenter) ?? null
            : null;
      if (groupKey && groupMatches.length === 0) row.warnings.push(`Gruppo “${row.data.gruppoOriginale}” non riconosciuto: confermare il Centro proposto`);
      if (!center && callerAreaOperativaId(req) != null) row.errors.push("Centro/Gruppo non risolto");

      const normalizedIdentifier = normalizeVolunteerIdentifier(row.data.matricola);
      const identifierVolunteerIds = new Set(
        normalizedIdentifier
          ? identifiers
              .filter((item) => item.matricolaNormalizzata === normalizedIdentifier)
              .map((item) => item.volontarioId)
          : [],
      );
      const byCode = volunteers.filter((item) => identifierVolunteerIds.has(item.id));
      const byTax = row.data.codiceFiscaleNormalizzato ? volunteers.filter((item) => item.codiceFiscaleNormalizzato === row.data.codiceFiscaleNormalizzato) : [];
      const exactCandidates = [
        ...new Map([...byCode, ...byTax].map((item) => [item.id, item])).values(),
      ];
      if (exactCandidates.length > 1)
        row.errors.push("Matricola e codice fiscale identificano volontari differenti");
      const exact = exactCandidates.length === 1 ? exactCandidates[0] : null;
      const exactVisible = exact && visibleVolunteers.some((item) => item.id === exact.id) ? exact : null;
      if (exact && !exactVisible) row.errors.push("La matricola o il codice fiscale appartengono a un volontario fuori perimetro");
      const byContact = visibleVolunteers.filter((item) =>
        (row.data.email && item.email?.trim().toLowerCase() === row.data.email)
        || (row.data.telefono && normalizePhone(item.telefono) === row.data.telefono),
      );
      const byIdentity = visibleVolunteers.filter((item) =>
        row.data.nome && row.data.cognome && row.data.dataNascita
        && normalizeComparableText(item.nome) === normalizeComparableText(row.data.nome)
        && normalizeComparableText(item.cognome) === normalizeComparableText(row.data.cognome)
        && item.dataNascita === row.data.dataNascita,
      );
      let candidate = exactVisible;
      let status = "NUOVO";
      if (row.errors.length) status = "ERRORE";
      else if (exactVisible) {
        status = sameImportedFields(exactVisible, row.data, role?.id ?? null, center?.id ?? null) ? "INVARIATO" : "AGGIORNAMENTO_CERTO";
      } else if (byContact.length || byIdentity.length) {
        const candidates = [...new Map([...byContact, ...byIdentity].map((item) => [item.id, item])).values()];
        candidate = candidates.length === 1 ? candidates[0] : null;
        status = "POSSIBILE_DUPLICATO";
        row.warnings.push(candidates.length === 1 ? "Corrispondenza debole da confermare: nessun merge automatico" : "Più possibili duplicati: scegliere manualmente");
      } else if (row.warnings.length || !role || !center) status = "DA_VERIFICARE";
      return {
        numeroRiga: source.numeroRiga,
        originale: source.originale,
        data: row.data,
        errori: row.errors,
        avvisi: row.warnings,
        stato: status,
        candidateId: candidate?.id ?? null,
        candidateVersion: candidate?.versione ?? null,
        candidateFingerprint: candidate ? volunteerCandidateFingerprint(candidate) : null,
        roleId: role?.id ?? null,
        centerId: center?.id ?? null,
        mappingFingerprint: canonicalSnapshotHash({
          ruoloVolontarioId: role?.id ?? null,
          centroAscoltoId: center?.id ?? null,
        }),
      };
    });
    const sha256File = createHash("sha256").update(req.body).digest("hex");
    const normalizedHash = canonicalSnapshotHash(
      normalized.map((row) => canonicalSnapshotHash(row.data)).sort(),
    );
    const result = await db.transaction(async (tx) => {
      const [batch] = await tx.insert(importazioniVolontariTable).values({
        nomeFile: fileName, mimeType: VOLONTARI_XLSX_MIME, dimensioneBytes: req.body.length,
        sha256File, hashContenutoNormalizzato: normalizedHash,
        chiaveIdempotenza: null, centroAscoltoId: effectiveCenter,
        ...ownerScope,
        numeroRighe: normalized.length, creatoDa: actorId(req),
      }).returning();
      const rows = await tx.insert(importazioniVolontariRigheTable).values(normalized.map((row) => ({
        importazioneId: batch.id, numeroRiga: row.numeroRiga, statoRiga: row.stato,
        hashRiga: canonicalSnapshotHash(row.data), datiOriginali: row.originale,
        datiNormalizzati: row.data as unknown as Record<string, unknown>,
        volontarioCandidatoId: row.candidateId, ruoloPropostoId: row.roleId,
        centroPropostoId: row.centerId, errori: row.errori, avvisi: row.avvisi,
        versioneCandidato: row.candidateVersion,
        fingerprintCandidato: row.candidateFingerprint,
        fingerprintMappingPreview: row.mappingFingerprint,
      }))).returning();
      await auditLogistica(tx, req, {
        entita: "volontario", id: batch.id, azione: "import_analisi",
        nuovo: {
          importazioneId: batch.id,
          sha256File,
          hashContenutoNormalizzato: normalizedHash,
          numeroRighe: rows.length,
          scope: ownerScope,
        },
      });
      return { batch, rows };
    });
    res.status(201).json(previewBatch(result.batch, result.rows));
  },
);

type Resolution = {
  numeroRiga: number;
  inclusa?: boolean;
  volontarioId?: number | null;
  creaNuovo?: boolean;
  ruoloVolontarioId?: number | null;
  centroAscoltoId?: number | null;
  creaRuolo?: boolean;
  correzioni?: Partial<NormalizedImport>;
};

function resultSummary(batch: typeof importazioniVolontariTable.$inferSelect) {
  return {
    importazioneId: batch.id, stato: batch.stato, creati: batch.creati,
    aggiornati: batch.aggiornati, invariati: batch.invariati,
    esclusi: batch.esclusi, errori: batch.errori,
  };
}

router.post(
  "/volontari/import/conferma",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const importazioneId = Number(req.body?.importazioneId);
    const resolutions = Array.isArray(req.body?.righe) ? req.body.righe as Resolution[] : [];
    if (!Number.isSafeInteger(importazioneId) || importazioneId <= 0 || resolutions.length > 2_000) {
      res.status(400).json({ error: "Conferma import non valida" }); return;
    }
    const [batch] = await db.select().from(importazioniVolontariTable).where(eq(importazioniVolontariTable.id, importazioneId));
    if (!batch) { res.status(404).json({ error: "Importazione non trovata" }); return; }
    if (!canAccessVolunteerOwnerScope(req, batch)) {
      res.status(403).json({ error: "Importazione non accessibile" }); return;
    }
    const resolutionByRow = new Map(resolutions.map((item) => [Number(item.numeroRiga), item]));
    let outcome: { batch: typeof importazioniVolontariTable.$inferSelect; replay: boolean };
    try {
      outcome = await db.transaction(async (tx) => {
      const previewRows = await tx.select().from(importazioniVolontariRigheTable)
        .where(eq(importazioniVolontariRigheTable.importazioneId, batch.id))
        .orderBy(asc(importazioniVolontariRigheTable.numeroRiga));
      const decisionEntries = previewRows.map((stored) => {
        const resolution = resolutionByRow.get(stored.numeroRiga);
        const corrections = validatedCorrections(resolution?.correzioni);
        return canonicalSnapshotHash({
          hashRiga: stored.hashRiga,
          inclusa: resolution?.inclusa !== false,
          volontarioId: resolution?.volontarioId ?? null,
          creaNuovo: resolution?.creaNuovo === true,
          ruoloVolontarioId: resolution?.ruoloVolontarioId ?? stored.ruoloPropostoId,
          centroAscoltoId: resolution?.centroAscoltoId ?? stored.centroPropostoId,
          creaRuolo: resolution?.creaRuolo === true,
          correzioni: corrections,
        });
      }).sort();
      const finalDecisionsHash = canonicalSnapshotHash(decisionEntries);
      const idempotencyKey = canonicalSnapshotHash({
        hashContenutoNormalizzato: batch.hashContenutoNormalizzato,
        scopeFingerprint: batch.scopeFingerprint,
        hashDecisioniFinali: finalDecisionsHash,
      });
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('volontari-import'), hashtext(${idempotencyKey}))`);
      const [alreadyConfirmed] = await tx.select().from(importazioniVolontariTable).where(and(
        eq(importazioniVolontariTable.chiaveIdempotenza, idempotencyKey),
        eq(importazioniVolontariTable.stato, "CONFERMATO"),
        ne(importazioniVolontariTable.id, batch.id),
      )).orderBy(asc(importazioniVolontariTable.id)).limit(1);
      if (alreadyConfirmed) return { batch: alreadyConfirmed, replay: true };
      const [lockedBatch] = await tx.select().from(importazioniVolontariTable).where(eq(importazioniVolontariTable.id, batch.id)).for("update");
      if (!lockedBatch) throw new Error("IMPORT_NOT_FOUND");
      if (lockedBatch.stato === "CONFERMATO") {
        if (lockedBatch.hashDecisioniFinali === finalDecisionsHash)
          return { batch: lockedBatch, replay: true };
        throw new Error("IMPORT_GIA_CONFERMATO_CON_DECISIONI_DIVERSE");
      }
      const rows = previewRows;
      let creati = 0; let aggiornati = 0; let invariati = 0; let esclusi = 0; let errori = 0;
      for (const stored of rows) {
        const resolution = resolutionByRow.get(stored.numeroRiga);
        if (stored.esitoCommit === "CREATO") { creati += 1; continue; }
        if (stored.esitoCommit === "AGGIORNATO") { aggiornati += 1; continue; }
        if (stored.esitoCommit === "INVARIATO") { invariati += 1; continue; }
        if (stored.esitoCommit === "ESCLUSO") { esclusi += 1; continue; }
        if (resolution?.inclusa === false) {
          esclusi += 1;
          await tx.update(importazioniVolontariRigheTable).set({ esclusa: true, esitoCommit: "ESCLUSO" }).where(eq(importazioniVolontariRigheTable.id, stored.id));
          continue;
        }
        if (stored.statoRiga === "ERRORE") {
          errori += 1;
          await tx.update(importazioniVolontariRigheTable).set({ esitoCommit: "ERRORE_VALIDAZIONE" }).where(eq(importazioniVolontariRigheTable.id, stored.id));
          continue;
        }
        if (stored.statoRiga === "POSSIBILE_DUPLICATO" && !resolution?.volontarioId && resolution?.creaNuovo !== true) {
          errori += 1;
          await tx.update(importazioniVolontariRigheTable).set({ esitoCommit: "ERRORE_DECISIONE_DUPLICATO" }).where(eq(importazioniVolontariRigheTable.id, stored.id));
          continue;
        }
        let previewCandidate: typeof volontariTable.$inferSelect | null = null;
        if (stored.volontarioCandidatoId != null) {
          const [candidate] = await tx
            .select()
            .from(volontariTable)
            .where(eq(volontariTable.id, stored.volontarioCandidatoId))
            .for("update");
          if (!candidate || !scopeContainsCenter(batch, candidate.centroAscoltoId)) {
            errori += 1;
            await tx.update(importazioniVolontariRigheTable).set({
              esitoCommit: "ERRORE_SCOPE_CANDIDATO",
            }).where(eq(importazioniVolontariRigheTable.id, stored.id));
            continue;
          }
          if (
            stored.versioneCandidato !== candidate.versione ||
            stored.fingerprintCandidato !== volunteerCandidateFingerprint(candidate)
          ) {
            errori += 1;
            await tx.update(importazioniVolontariRigheTable).set({
              esitoCommit: "CONFLITTO_DATI_MODIFICATI",
              avvisi: [...stored.avvisi, "Il volontario è cambiato dopo la preview: ripetere l’analisi"],
            }).where(eq(importazioniVolontariRigheTable.id, stored.id));
            continue;
          }
          previewCandidate = candidate;
        }
        const corrections = validatedCorrections(resolution?.correzioni);
        if (!corrections) {
          errori += 1;
          await tx.update(importazioniVolontariRigheTable).set({ esitoCommit: "ERRORE_CORREZIONE" }).where(eq(importazioniVolontariRigheTable.id, stored.id));
          continue;
        }
        const data = { ...(stored.datiNormalizzati as NormalizedImport), ...corrections } as NormalizedImport;
        data.matricola = typeof data.matricola === "string" ? data.matricola.trim() || null : null;
        data.codiceFiscaleNormalizzato = normalizeCodiceFiscale(
          data.codiceFiscale,
        );
        data.codiceFiscale = data.codiceFiscaleNormalizzato;
        if (!data.dataInizioImportata || !isDateOnly(data.dataInizioImportata)) {
          throw new Error(`IMPORT_DATA_INIZIO_MANCANTE:${stored.numeroRiga}`);
        }
        if (!data.nome || !data.cognome || !data.tipoVolontario || !["PERMANENTE", "TEMPORANEO"].includes(data.tipoVolontario)) {
          errori += 1;
          await tx.update(importazioniVolontariRigheTable).set({ esitoCommit: "ERRORE_CORREZIONE" }).where(eq(importazioniVolontariRigheTable.id, stored.id));
          continue;
        }
        let ruoloId = resolution?.ruoloVolontarioId ?? stored.ruoloPropostoId;
        const roleName = data.categoriaOriginale?.trim() ?? "";
        const roleKey = normalizeRoleName(roleName);
        if (!ruoloId && resolution?.creaRuolo && roleKey) {
          const [existingRole] = await tx.select().from(ruoliVolontariTable).where(eq(ruoliVolontariTable.nomeNormalizzato, roleKey)).limit(1);
          if (existingRole) ruoloId = existingRole.id;
          else {
            const [createdRole] = await tx.insert(ruoliVolontariTable).values({ nome: roleName, nomeNormalizzato: roleKey, attivo: true }).returning();
            ruoloId = createdRole.id;
          }
        }
        const [role] = ruoloId ? await tx.select().from(ruoliVolontariTable).where(eq(ruoliVolontariTable.id, ruoloId)).limit(1) : [];
        const centroId = callerCentroId(req) ?? resolution?.centroAscoltoId ?? stored.centroPropostoId ?? batch.centroAscoltoId;
        if (!role || !role.attivo || !scopeContainsCenter(batch, centroId)) {
          errori += 1;
          await tx.update(importazioniVolontariRigheTable).set({ esitoCommit: "ERRORE_MAPPING" }).where(eq(importazioniVolontariRigheTable.id, stored.id));
          continue;
        }
        const normalizedIdentifier = normalizeVolunteerIdentifier(data.matricola);
        const identifierRows = normalizedIdentifier
          ? await tx
              .select({ volontarioId: matricoleVolontariTable.volontarioId })
              .from(matricoleVolontariTable)
              .where(eq(matricoleVolontariTable.matricolaNormalizzata, normalizedIdentifier))
          : [];
        const identifierIds = identifierRows.map((item) => item.volontarioId);
        const exactCondition = data.codiceFiscaleNormalizzato
          ? or(
              identifierIds.length ? inArray(volontariTable.id, identifierIds) : sql`false`,
              eq(volontariTable.codiceFiscaleNormalizzato, data.codiceFiscaleNormalizzato),
            )
          : identifierIds.length
            ? inArray(volontariTable.id, identifierIds)
            : sql`false`;
        const exactRows = await tx.select().from(volontariTable).where(exactCondition)
          .orderBy(asc(volontariTable.id)).for("update");
        const explicitId =
          resolution?.volontarioId ??
          (["AGGIORNAMENTO_CERTO", "INVARIATO"].includes(stored.statoRiga)
            ? stored.volontarioCandidatoId
            : null);
        let target = explicitId
          ? exactRows.find((item) => item.id === explicitId) ??
            (previewCandidate?.id === explicitId ? previewCandidate : null)
          : null;
        if (!target && explicitId) {
          const [explicit] = await tx.select().from(volontariTable).where(eq(volontariTable.id, explicitId)).for("update");
          if (explicit && scopeContainsCenter(batch, explicit.centroAscoltoId)) target = explicit;
        }
        if (!target && ["AGGIORNAMENTO_CERTO", "INVARIATO"].includes(stored.statoRiga) && exactRows.length === 1) target = exactRows[0];
        if (target && exactRows.some((item) => item.id !== target!.id)) {
          errori += 1;
          await tx.update(importazioniVolontariRigheTable).set({ esitoCommit: "ERRORE_DUPLICATO" }).where(eq(importazioniVolontariRigheTable.id, stored.id));
          continue;
        }
        if (!target && exactRows.length > 0) {
          errori += 1;
          await tx.update(importazioniVolontariRigheTable).set({ esitoCommit: "ERRORE_DUPLICATO" }).where(eq(importazioniVolontariRigheTable.id, stored.id));
          continue;
        }
        if (target && data.scadenzaAssicurazione) {
          const coverageKey = canonicalSnapshotHash({
            volontarioId: target.id,
            dataInizio: null,
            dataFine: data.scadenzaAssicurazione,
            origine: "IMPORT_VOLONTARI_2_0",
          });
          const existingCoverages = await tx
            .select({
              chiaveIdempotenza:
                copertureAssicurativeVolontariTable.chiaveIdempotenza,
            })
            .from(copertureAssicurativeVolontariTable)
            .where(
              and(
                eq(
                  copertureAssicurativeVolontariTable.volontarioId,
                  target.id,
                ),
                eq(
                  copertureAssicurativeVolontariTable.dataFine,
                  data.scadenzaAssicurazione,
                ),
                eq(copertureAssicurativeVolontariTable.annullata, false),
              ),
            );
          if (
            existingCoverages.some(
              (coverage) => coverage.chiaveIdempotenza !== coverageKey,
            )
          ) {
            errori += 1;
            await tx
              .update(importazioniVolontariRigheTable)
              .set({
                esitoCommit: "CONFLITTO_COPERTURA_ESISTENTE",
                avvisi: [
                  ...stored.avvisi,
                  "Esiste una copertura non originata da questo replay: verificare manualmente",
                ],
              })
              .where(eq(importazioniVolontariRigheTable.id, stored.id));
            continue;
          }
        }
        if (target && data.tipoVolontario === "TEMPORANEO" && data.dataServizio) {
          const serviceKey = canonicalSnapshotHash({
            volontarioId: target.id,
            dataServizio: data.dataServizio,
            centroAscoltoId: centroId,
            origine: "IMPORT_VOLONTARI_2_0",
          });
          const [existingService] = await tx
            .select({
              chiaveIdempotenza:
                giornateServizioVolontariTable.chiaveIdempotenza,
            })
            .from(giornateServizioVolontariTable)
            .where(
              and(
                eq(giornateServizioVolontariTable.volontarioId, target.id),
                eq(
                  giornateServizioVolontariTable.dataServizio,
                  data.dataServizio,
                ),
                centroId == null
                  ? isNull(giornateServizioVolontariTable.centroAscoltoId)
                  : eq(
                      giornateServizioVolontariTable.centroAscoltoId,
                      centroId,
                    ),
              ),
            )
            .limit(1);
          if (
            existingService &&
            existingService.chiaveIdempotenza !== serviceKey
          ) {
            errori += 1;
            await tx
              .update(importazioniVolontariRigheTable)
              .set({
                esitoCommit: "CONFLITTO_GIORNATA_ESISTENTE",
                avvisi: [
                  ...stored.avvisi,
                  "Esiste una giornata non originata da questo replay: verificare manualmente",
                ],
              })
              .where(eq(importazioniVolontariRigheTable.id, stored.id));
            continue;
          }
        }
        let volunteer: typeof volontariTable.$inferSelect;
        let esito: "CREATO" | "AGGIORNATO" | "INVARIATO";
        if (target) {
          if (!scopeContainsCenter(batch, target.centroAscoltoId)) {
            errori += 1;
            await tx.update(importazioniVolontariRigheTable).set({ esitoCommit: "ERRORE_SCOPE" }).where(eq(importazioniVolontariRigheTable.id, stored.id));
            continue;
          }
          if (target.tipoVolontario !== data.tipoVolontario) {
            errori += 1;
            await tx.update(importazioniVolontariRigheTable).set({
              esitoCommit:
                target.tipoVolontario === "TEMPORANEO" &&
                data.tipoVolontario === "PERMANENTE"
                  ? "CONVERSIONE_RICHIESTA"
                  : "CONFLITTO_TIPO_VOLONTARIO",
              avvisi: [
                ...stored.avvisi,
                target.tipoVolontario === "TEMPORANEO" &&
                data.tipoVolontario === "PERMANENTE"
                  ? "Usare il workflow Converti in permanente"
                  : "Il tipo volontario non può essere modificato dall'import",
              ],
            }).where(eq(importazioniVolontariRigheTable.id, stored.id));
            continue;
          }
          if (sameImportedFields(target, data, role.id, centroId)) {
            volunteer = target; esito = "INVARIATO"; invariati += 1;
          } else {
            [volunteer] = await tx.update(volontariTable).set({
              nome: data.nome, cognome: data.cognome, matricola: data.matricola ?? target.matricola,
              tipoVolontario: data.tipoVolontario, centroAscoltoId: centroId,
              telefono: data.telefono, telefonoSecondario: data.telefonoSecondario,
              email: data.email, luogoNascita: data.luogoNascita, dataNascita: data.dataNascita,
              indirizzoResidenza: data.indirizzoResidenza,
              codiceFiscale: data.codiceFiscaleNormalizzato,
              codiceFiscaleNormalizzato: data.codiceFiscaleNormalizzato,
              codiceFiscaleNonDisponibile:
                data.codiceFiscaleNormalizzato == null,
              codiceFiscaleNota:
                data.codiceFiscaleNormalizzato == null
                  ? "Codice fiscale assente nel file importato"
                  : null,
              dataInizioImportata: data.dataInizioImportata,
              dataIscrizione: data.dataInizioImportata,
              categoriaImportataOriginale: data.categoriaOriginale,
              gruppoImportatoOriginale: data.gruppoOriginale,
              ruoloVolontarioId: role.id, ruolo: role.nome,
              versione: sql`${volontariTable.versione} + 1`, dataAggiornamento: new Date(),
            }).where(eq(volontariTable.id, target.id)).returning();
            if (data.matricola) {
              await registerImportedVolunteerIdentifier(
                tx, volunteer.id, data.matricola, data.tipoVolontario,
                data.dataInizioImportata, actorId(req),
              );
            }
            await appendVolontarioLedgerEvent(tx, {
              sezione: volunteer.tipoVolontario as
                | "PERMANENTE"
                | "TEMPORANEO",
              tipoEvento: "AGGIORNAMENTO_ANAGRAFICA",
              volontarioId: volunteer.id,
              centroAscoltoId: volunteer.centroAscoltoId,
              dataEffettiva: todayRome(),
              snapshot: await buildVolunteerEventSnapshot(tx, volunteer, {
                statoPrecedente: target.tipoVolontario,
                nuovoStato: volunteer.tipoVolontario,
                motivo: "aggiornamento_da_import",
                dataEffettiva: todayRome(),
                versione: volunteer.versione,
                datiEvento: {
                  importazioneId: batch.id,
                  numeroRiga: stored.numeroRiga,
                },
              }),
              utenteId: actorId(req),
            });
            esito = "AGGIORNATO"; aggiornati += 1;
          }
        } else {
          [volunteer] = await tx.insert(volontariTable).values({
            nome: data.nome, cognome: data.cognome, matricola: data.matricola,
            tipoVolontario: data.tipoVolontario, centroAscoltoId: centroId,
            telefono: data.telefono, telefonoSecondario: data.telefonoSecondario,
            email: data.email, luogoNascita: data.luogoNascita, dataNascita: data.dataNascita,
            indirizzoResidenza: data.indirizzoResidenza,
            codiceFiscale: data.codiceFiscaleNormalizzato,
            codiceFiscaleNormalizzato: data.codiceFiscaleNormalizzato,
            codiceFiscaleNonDisponibile:
              data.codiceFiscaleNormalizzato == null,
            codiceFiscaleNota:
              data.codiceFiscaleNormalizzato == null
                ? "Codice fiscale assente nel file importato"
                : null,
            dataInizioImportata: data.dataInizioImportata,
            dataIscrizione: data.dataInizioImportata,
            categoriaImportataOriginale: data.categoriaOriginale,
            gruppoImportatoOriginale: data.gruppoOriginale,
            ruoloVolontarioId: role.id, ruolo: role.nome,
            attivo: false, statoApprovazione: "in_attesa",
          }).returning();
          let matricola: string;
          if (data.matricola) {
            await registerImportedVolunteerIdentifier(
              tx, volunteer.id, data.matricola, data.tipoVolontario,
              data.dataInizioImportata, actorId(req),
            );
            matricola = data.matricola;
          } else if (data.tipoVolontario === "TEMPORANEO") {
            matricola = await assignTemporaryVolunteerIdentifier(
              tx, volunteer.id, data.dataInizioImportata, actorId(req),
            );
          } else {
            matricola = await assignPermanentVolunteerIdentifier(
              tx, volunteer.id, centroId, data.dataInizioImportata, actorId(req),
            );
          }
          volunteer = { ...volunteer, matricola };
          esito = "CREATO"; creati += 1;
          await appendVolontarioLedgerEvent(tx, {
            sezione: data.tipoVolontario, tipoEvento: "REGISTRAZIONE", volontarioId: volunteer.id,
            centroAscoltoId: centroId, dataEffettiva: data.dataInizioImportata,
            snapshot: await buildVolunteerRegistrationSnapshot(tx, volunteer, {
              origine: "IMPORT_VOLONTARI_2_0",
              dataInizio: data.dataInizioImportata,
              importazioneId: batch.id,
              numeroRiga: stored.numeroRiga,
            }),
            utenteId: actorId(req),
          });
        }
        if (data.scadenzaAssicurazione) {
          const coverageKey = canonicalSnapshotHash({
            volontarioId: volunteer.id,
            dataInizio: null,
            dataFine: data.scadenzaAssicurazione,
            origine: "IMPORT_VOLONTARI_2_0",
          });
          await tx.insert(copertureAssicurativeVolontariTable).values({
            volontarioId: volunteer.id, dataInizio: null, dataFine: data.scadenzaAssicurazione,
            durataMesi: null, tipoOperazione: "IMPORTAZIONE",
            chiaveIdempotenza: coverageKey,
            note: `Importazione ${batch.id}, riga ${stored.numeroRiga}`, creatoDa: actorId(req),
          }).onConflictDoNothing({
            target: copertureAssicurativeVolontariTable.chiaveIdempotenza,
            where: sql`${copertureAssicurativeVolontariTable.chiaveIdempotenza} is not null and ${copertureAssicurativeVolontariTable.tipoOperazione} = 'IMPORTAZIONE' and ${copertureAssicurativeVolontariTable.annullata} = false`,
          });
        }
        if (data.tipoVolontario === "TEMPORANEO" && data.dataServizio) {
          const serviceKey = canonicalSnapshotHash({
            volontarioId: volunteer.id,
            dataServizio: data.dataServizio,
            centroAscoltoId: centroId,
            origine: "IMPORT_VOLONTARI_2_0",
          });
          await tx.insert(giornateServizioVolontariTable).values({
            volontarioId: volunteer.id, dataServizio: data.dataServizio, centroAscoltoId: centroId,
            stato: "PIANIFICATA", coperturaVerificata: Boolean(data.scadenzaAssicurazione && data.scadenzaAssicurazione >= data.dataServizio),
            chiaveIdempotenza: serviceKey,
            note: `Importazione ${batch.id}, riga ${stored.numeroRiga}`, creatoDa: actorId(req),
          }).onConflictDoNothing({
            target: giornateServizioVolontariTable.chiaveIdempotenza,
            where: sql`${giornateServizioVolontariTable.chiaveIdempotenza} is not null`,
          });
        }
        await auditLogistica(tx, req, {
          entita: "volontario", id: volunteer.id, azione: `import_${esito.toLowerCase()}`,
          nuovo: { importazioneId: batch.id, numeroRiga: stored.numeroRiga, esito },
        });
        await tx.update(importazioniVolontariRigheTable).set({ esitoCommit: esito, volontarioRisultatoId: volunteer.id }).where(eq(importazioniVolontariRigheTable.id, stored.id));
      }
      const stato = errori > 0 ? "PARZIALE" : "CONFERMATO";
      const [finalBatch] = await tx.update(importazioniVolontariTable).set({
        stato, creati, aggiornati, invariati, esclusi, errori,
        ...(stato === "CONFERMATO" ? { chiaveIdempotenza: idempotencyKey } : {}),
        hashDecisioniFinali: finalDecisionsHash,
        confermatoDa: actorId(req), dataConferma: new Date(),
      }).where(eq(importazioniVolontariTable.id, batch.id)).returning();
      await auditLogistica(tx, req, {
        entita: "volontario", id: batch.id, azione: "import_conferma",
        nuovo: { importazioneId: batch.id, stato, creati, aggiornati, invariati, esclusi, errori },
      });
      return { batch: finalBatch, replay: false };
      });
    } catch (error) {
      if (isVolontarioCodiceFiscaleUniqueViolation(error)) {
        res.status(409).json({
          error: "Codice fiscale già associato a un altro volontario",
          code: "CODICE_FISCALE_DUPLICATO",
        });
        return;
      }
      if (isVolontarioMatricolaUniqueViolation(error) || (error as Error)?.message === "MATRICOLA_DUPLICATA") {
        res.status(409).json({ error: MATRICOLA_DUPLICATA_MSG, code: "MATRICOLA_DUPLICATA" });
        return;
      }
      if ((error as Error)?.message.startsWith("IMPORT_DATA_INIZIO_MANCANTE:")) {
        const numeroRiga = Number((error as Error).message.split(":")[1]);
        res.status(422).json({
          error: "Data di iscrizione/inizio attività mancante",
          code: "DATA_INIZIO_IMPORTATA_OBBLIGATORIA",
          numeroRiga,
        });
        return;
      }
      if (error instanceof VolunteerIdentifierError) {
        res.status(422).json({ error: error.message, code: error.code });
        return;
      }
      if ((error as Error)?.message === "IMPORT_GIA_CONFERMATO_CON_DECISIONI_DIVERSE") {
        res.status(409).json({
          error: "Il batch è già stato confermato con decisioni differenti",
          code: "IMPORT_GIA_CONFERMATO_CON_DECISIONI_DIVERSE",
        });
        return;
      }
      throw error;
    }
    res.json({ ...resultSummary(outcome.batch), replayIdempotente: outcome.replay });
  },
);

export default router;
