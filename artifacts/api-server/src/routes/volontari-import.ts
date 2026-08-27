import { createHash } from "node:crypto";
import express, { Router, type IRouter, type Request } from "express";
import {
  centriAscoltoTable,
  copertureAssicurativeVolontariTable,
  db,
  giornateServizioVolontariTable,
  importazioniVolontariRigheTable,
  importazioniVolontariTable,
  ruoliVolontariTable,
  volontariTable,
} from "@workspace/db";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  callerAreaOperativaId,
  callerCentroId,
  canAccessCentro,
  inVisibleCentroSet,
  visibleCentroIds,
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
  todayRome,
} from "../lib/volontariDomain";
import { appendVolontarioLedgerEvent, canonicalSnapshotHash } from "../lib/volontariLedger";
import {
  parseVolontariWorkbook,
  VOLONTARI_IMPORT_MAX_BYTES,
  VOLONTARI_XLSX_MIME,
  VolontariWorkbookError,
} from "../lib/volontariWorkbook";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/volontari", requireModulo("VOLONTARI"));
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
  if (!row.codice) errors.push("Codice/matricola obbligatorio");
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
    && existing.matricola === row.matricola
    && (existing.luogoNascita ?? null) === row.luogoNascita
    && (existing.dataNascita ?? null) === row.dataNascita
    && (existing.indirizzoResidenza ?? null) === row.indirizzoResidenza
    && (existing.codiceFiscaleNormalizzato ?? null) === row.codiceFiscaleNormalizzato
    && (existing.telefono ?? null) === row.telefono
    && (existing.telefonoSecondario ?? null) === row.telefonoSecondario
    && (existing.email?.toLowerCase() ?? null) === row.email
    && existing.tipoVolontario === row.tipoVolontario
    && existing.ruoloVolontarioId === ruoloId
    && existing.centroAscoltoId === centroId;
}

function previewBatch(batch: typeof importazioniVolontariTable.$inferSelect, rows: Array<typeof importazioniVolontariRigheTable.$inferSelect>) {
  return {
    importazioneId: batch.id,
    nomeFile: batch.nomeFile,
    stato: batch.stato,
    hashFile: batch.sha256File,
    numeroRighe: batch.numeroRighe,
    righe: rows.map((row) => ({
      numeroRiga: row.numeroRiga,
      stato: row.statoRiga,
      hashRiga: row.hashRiga,
      datiOriginali: row.datiOriginali,
      datiNormalizzati: row.datiNormalizzati,
      volontarioCandidatoId: row.volontarioCandidatoId,
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
    const visibleIds = await visibleCentroIds(callerAreaOperativaId(req));
    const requestedCenter = req.query.centroAscoltoId == null ? null : Number(req.query.centroAscoltoId);
    if (requestedCenter != null && (!Number.isSafeInteger(requestedCenter) || !canAccessCentro(requestedCenter, caller) || !inVisibleCentroSet(requestedCenter, visibleIds))) {
      res.status(403).json({ error: "Centro import non accessibile" }); return;
    }
    const effectiveCenter = caller ?? requestedCenter;
    if (callerAreaOperativaId(req) != null && effectiveCenter == null) {
      res.status(400).json({ error: "Seleziona il Centro a cui attribuire le righe senza gruppo riconosciuto" }); return;
    }
    const [roles, centers, volunteers] = await Promise.all([
      db.select().from(ruoliVolontariTable),
      db.select().from(centriAscoltoTable),
      db.select().from(volontariTable),
    ]);
    const allowedCenters = centers.filter((center) => canAccessCentro(center.id, caller) && inVisibleCentroSet(center.id, visibleIds));
    const visibleVolunteers = volunteers.filter((volunteer) => canAccessCentro(volunteer.centroAscoltoId, caller) && inVisibleCentroSet(volunteer.centroAscoltoId, visibleIds));
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

      const byCode = row.data.matricola ? volunteers.filter((item) => item.matricola === row.data.matricola) : [];
      const byTax = row.data.codiceFiscaleNormalizzato ? volunteers.filter((item) => item.codiceFiscaleNormalizzato === row.data.codiceFiscaleNormalizzato) : [];
      const exact = byCode.length === 1 ? byCode[0] : byTax.length === 1 ? byTax[0] : null;
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
        roleId: role?.id ?? null,
        centerId: center?.id ?? null,
      };
    });
    const sha256File = createHash("sha256").update(req.body).digest("hex");
    const normalizedHash = canonicalSnapshotHash(normalized.map((row) => ({ numeroRiga: row.numeroRiga, data: row.data })));
    const replay = await db.select().from(importazioniVolontariTable)
      .where(and(eq(importazioniVolontariTable.sha256File, sha256File), eq(importazioniVolontariTable.stato, "CONFERMATO")))
      .orderBy(asc(importazioniVolontariTable.id)).limit(1);
    if (replay[0]) {
      const rows = await db.select().from(importazioniVolontariRigheTable).where(eq(importazioniVolontariRigheTable.importazioneId, replay[0].id)).orderBy(asc(importazioniVolontariRigheTable.numeroRiga));
      res.json({ ...previewBatch(replay[0], rows), replayIdempotente: true });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [batch] = await tx.insert(importazioniVolontariTable).values({
        nomeFile: fileName, mimeType: VOLONTARI_XLSX_MIME, dimensioneBytes: req.body.length,
        sha256File, hashContenutoNormalizzato: normalizedHash, centroAscoltoId: effectiveCenter,
        numeroRighe: normalized.length, creatoDa: req.user?.id ?? null,
      }).returning();
      const rows = await tx.insert(importazioniVolontariRigheTable).values(normalized.map((row) => ({
        importazioneId: batch.id, numeroRiga: row.numeroRiga, statoRiga: row.stato,
        hashRiga: canonicalSnapshotHash(row.data), datiOriginali: row.originale,
        datiNormalizzati: row.data as unknown as Record<string, unknown>,
        volontarioCandidatoId: row.candidateId, ruoloPropostoId: row.roleId,
        centroPropostoId: row.centerId, errori: row.errori, avvisi: row.avvisi,
      }))).returning();
      await auditLogistica(tx, req, {
        entita: "volontario", id: batch.id, azione: "import_analisi",
        nuovo: { importazioneId: batch.id, sha256File, numeroRighe: rows.length },
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
    if (!canAccessCentro(batch.centroAscoltoId, callerCentroId(req)) || !inVisibleCentroSet(batch.centroAscoltoId, await visibleCentroIds(callerAreaOperativaId(req)))) {
      res.status(403).json({ error: "Importazione non accessibile" }); return;
    }
    if (batch.stato === "CONFERMATO") { res.json({ ...resultSummary(batch), replayIdempotente: true }); return; }
    const resolutionByRow = new Map(resolutions.map((item) => [Number(item.numeroRiga), item]));
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('volontari-import'), hashtext(${batch.sha256File}))`);
      const [alreadyConfirmed] = await tx.select().from(importazioniVolontariTable).where(and(
        eq(importazioniVolontariTable.sha256File, batch.sha256File),
        eq(importazioniVolontariTable.stato, "CONFERMATO"),
        ne(importazioniVolontariTable.id, batch.id),
        sql`${importazioniVolontariTable.centroAscoltoId} IS NOT DISTINCT FROM ${batch.centroAscoltoId}`,
      )).orderBy(asc(importazioniVolontariTable.id)).limit(1);
      if (alreadyConfirmed) return { batch: alreadyConfirmed, replay: true };
      const [lockedBatch] = await tx.select().from(importazioniVolontariTable).where(eq(importazioniVolontariTable.id, batch.id)).for("update");
      if (!lockedBatch) throw new Error("IMPORT_NOT_FOUND");
      if (lockedBatch.stato === "CONFERMATO") return { batch: lockedBatch, replay: true };
      const rows = await tx.select().from(importazioniVolontariRigheTable)
        .where(eq(importazioniVolontariRigheTable.importazioneId, batch.id)).orderBy(asc(importazioniVolontariRigheTable.numeroRiga));
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
        const data = { ...(stored.datiNormalizzati as NormalizedImport), ...(resolution?.correzioni ?? {}) } as NormalizedImport;
        if (!data.matricola || !data.nome || !data.cognome || !data.tipoVolontario || !["PERMANENTE", "TEMPORANEO"].includes(data.tipoVolontario)) {
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
        if (!role || !role.attivo || (centroId != null && (!canAccessCentro(centroId, callerCentroId(req)) || !inVisibleCentroSet(centroId, await visibleCentroIds(callerAreaOperativaId(req)))))) {
          errori += 1;
          await tx.update(importazioniVolontariRigheTable).set({ esitoCommit: "ERRORE_MAPPING" }).where(eq(importazioniVolontariRigheTable.id, stored.id));
          continue;
        }
        const exactRows = await tx.select().from(volontariTable).where(
          data.codiceFiscaleNormalizzato
            ? sql`${volontariTable.matricola} = ${data.matricola} OR ${volontariTable.codiceFiscaleNormalizzato} = ${data.codiceFiscaleNormalizzato}`
            : eq(volontariTable.matricola, data.matricola),
        ).orderBy(asc(volontariTable.id)).for("update");
        const explicitId = resolution?.volontarioId ?? null;
        let target = explicitId ? exactRows.find((item) => item.id === explicitId) : null;
        if (!target && explicitId) {
          const [explicit] = await tx.select().from(volontariTable).where(eq(volontariTable.id, explicitId)).for("update");
          if (explicit && canAccessCentro(explicit.centroAscoltoId, callerCentroId(req)) && inVisibleCentroSet(explicit.centroAscoltoId, await visibleCentroIds(callerAreaOperativaId(req)))) target = explicit;
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
        let volunteer: typeof volontariTable.$inferSelect;
        let esito: "CREATO" | "AGGIORNATO" | "INVARIATO";
        if (target) {
          if (!canAccessCentro(target.centroAscoltoId, callerCentroId(req)) || !inVisibleCentroSet(target.centroAscoltoId, await visibleCentroIds(callerAreaOperativaId(req)))) {
            errori += 1;
            await tx.update(importazioniVolontariRigheTable).set({ esitoCommit: "ERRORE_SCOPE" }).where(eq(importazioniVolontariRigheTable.id, stored.id));
            continue;
          }
          if (sameImportedFields(target, data, role.id, centroId)) {
            volunteer = target; esito = "INVARIATO"; invariati += 1;
          } else {
            [volunteer] = await tx.update(volontariTable).set({
              nome: data.nome, cognome: data.cognome, matricola: data.matricola,
              tipoVolontario: data.tipoVolontario, centroAscoltoId: centroId,
              telefono: data.telefono, telefonoSecondario: data.telefonoSecondario,
              email: data.email, luogoNascita: data.luogoNascita, dataNascita: data.dataNascita,
              indirizzoResidenza: data.indirizzoResidenza,
              codiceFiscale: data.codiceFiscaleNormalizzato,
              codiceFiscaleNormalizzato: data.codiceFiscaleNormalizzato,
              dataInizioImportata: data.dataInizioImportata,
              categoriaImportataOriginale: data.categoriaOriginale,
              gruppoImportatoOriginale: data.gruppoOriginale,
              ruoloVolontarioId: role.id, ruolo: role.nome,
              versione: sql`${volontariTable.versione} + 1`, dataAggiornamento: new Date(),
            }).where(eq(volontariTable.id, target.id)).returning();
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
            dataInizioImportata: data.dataInizioImportata,
            categoriaImportataOriginale: data.categoriaOriginale,
            gruppoImportatoOriginale: data.gruppoOriginale,
            ruoloVolontarioId: role.id, ruolo: role.nome,
            attivo: false, statoApprovazione: "in_attesa",
          }).returning();
          esito = "CREATO"; creati += 1;
          await appendVolontarioLedgerEvent(tx, {
            sezione: data.tipoVolontario, tipoEvento: "REGISTRAZIONE", volontarioId: volunteer.id,
            centroAscoltoId: centroId, dataEffettiva: data.dataInizioImportata ?? todayRome(),
            snapshot: { origine: "IMPORT_VOLONTARI_2_0", importazioneId: batch.id, numeroRiga: stored.numeroRiga, matricola: data.matricola },
            utenteId: req.user?.id ?? null,
          });
        }
        if (data.scadenzaAssicurazione) {
          await tx.insert(copertureAssicurativeVolontariTable).values({
            volontarioId: volunteer.id, dataInizio: null, dataFine: data.scadenzaAssicurazione,
            durataMesi: null, tipoOperazione: "IMPORTAZIONE",
            note: `Importazione ${batch.id}, riga ${stored.numeroRiga}`, creatoDa: req.user?.id ?? null,
          }).onConflictDoNothing();
        }
        if (data.tipoVolontario === "TEMPORANEO" && data.dataServizio) {
          await tx.insert(giornateServizioVolontariTable).values({
            volontarioId: volunteer.id, dataServizio: data.dataServizio, centroAscoltoId: centroId,
            stato: "PIANIFICATA", coperturaVerificata: Boolean(data.scadenzaAssicurazione && data.scadenzaAssicurazione >= data.dataServizio),
            note: `Importazione ${batch.id}, riga ${stored.numeroRiga}`, creatoDa: req.user?.id ?? null,
          }).onConflictDoNothing();
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
        confermatoDa: req.user?.id ?? null, dataConferma: new Date(),
      }).where(eq(importazioniVolontariTable.id, batch.id)).returning();
      await auditLogistica(tx, req, {
        entita: "volontario", id: batch.id, azione: "import_conferma",
        nuovo: { importazioneId: batch.id, stato, creati, aggiornati, invariati, esclusi, errori },
      });
      return { batch: finalBatch, replay: false };
    });
    res.json({ ...resultSummary(outcome.batch), replayIdempotente: outcome.replay });
  },
);

export default router;
