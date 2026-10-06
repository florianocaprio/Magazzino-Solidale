import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  beneficiariTable,
  bolleTable,
  bollaRigheTable,
  centriAscoltoTable,
  consegneTable,
  entiDestinatariTable,
  magazziniTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  richiesteMagazzinoTable,
  richiesteMagazzinoDocumentiTable,
} from "@workspace/db";
import { InventoryDecimal } from "./inventoryDecimal";
import {
  auditFields,
  recordAuditEvent,
  type AuditCommandContext,
} from "./auditEvent";
import { M5bLinkError } from "./m5bDocumentLink";
import { canAccessCentro } from "./centroScope";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Read-only proof. No locks/writes: usable in an explicit READ ONLY snapshot. */
export async function inspectRequestClosure(tx: Tx, richiestaId: number) {
  const [request] = await tx
    .select({
      id: richiesteMagazzinoTable.id,
      versione: richiesteMagazzinoTable.versione,
      stato: richiesteMagazzinoTable.stato,
      tipoDestinatario: richiesteMagazzinoTable.tipoDestinatario,
      beneficiarioId: richiesteMagazzinoTable.beneficiarioId,
      enteDestinatarioId: richiesteMagazzinoTable.enteDestinatarioId,
      areaOperativaId: richiesteMagazzinoTable.areaOperativaId,
      centroAscoltoId: richiesteMagazzinoTable.centroAscoltoId,
      interventoId: richiesteMagazzinoTable.interventoId,
    })
    .from(richiesteMagazzinoTable)
    .where(eq(richiesteMagazzinoTable.id, richiestaId));
  const links = await tx
    .select({
      id: richiesteMagazzinoDocumentiTable.id,
      tipoDocumento: richiesteMagazzinoDocumentiTable.tipoDocumento,
      bollaId: richiesteMagazzinoDocumentiTable.bollaId,
      trasferimentoId: richiesteMagazzinoDocumentiTable.trasferimentoId,
      corrente: richiesteMagazzinoDocumentiTable.corrente,
    })
    .from(richiesteMagazzinoDocumentiTable)
    .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, richiestaId))
    .orderBy(richiesteMagazzinoDocumentiTable.id);
  const current = links.filter((link) => link.corrente);
  const link = current.length === 1 ? current[0] : null;
  const [bolla] = link?.bollaId
    ? await tx
        .select({
          id: bolleTable.id,
          versione: bolleTable.versione,
          stato: bolleTable.stato,
          tipoDestinatario: bolleTable.tipoDestinatario,
          beneficiarioId: bolleTable.beneficiarioId,
          enteDestinatarioId: bolleTable.enteDestinatarioId,
          magazzinoId: bolleTable.magazzinoId,
          consegnaId: bolleTable.consegnaId,
          areaOperativaIdSnapshot: bolleTable.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: bolleTable.centroAscoltoIdSnapshot,
        })
        .from(bolleTable)
        .where(eq(bolleTable.id, link.bollaId))
    : [];
  const [warehouse] = bolla
    ? await tx
        .select({
          areaOperativaId: magazziniTable.areaOperativaId,
          centroAscoltoId: magazziniTable.centroAscoltoId,
        })
        .from(magazziniTable)
        .where(eq(magazziniTable.id, bolla.magazzinoId))
    : [];
  const [beneficiary] = request?.beneficiarioId
    ? await tx
        .select({
          areaOperativaId: beneficiariTable.areaOperativaId,
          centroAscoltoId: beneficiariTable.centroAscoltoId,
        })
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, request.beneficiarioId))
    : [];
  const [entity] = request?.enteDestinatarioId
    ? await tx
        .select({ areaOperativaId: entiDestinatariTable.areaOperativaId })
        .from(entiDestinatariTable)
        .where(eq(entiDestinatariTable.id, request.enteDestinatarioId))
    : [];
  const [centre] = request?.centroAscoltoId
    ? await tx
        .select({ areaOperativaId: centriAscoltoTable.areaOperativaId })
        .from(centriAscoltoTable)
        .where(eq(centriAscoltoTable.id, request.centroAscoltoId))
    : [];
  const [consegna] = bolla?.consegnaId
    ? await tx
        .select({
          id: consegneTable.id,
          stato: consegneTable.stato,
          tipoPianificazione: consegneTable.tipoPianificazione,
          beneficiarioId: consegneTable.beneficiarioId,
          magazzinoId: consegneTable.magazzinoId,
          dataEffettuata: consegneTable.dataEffettuata,
          areaOperativaIdSnapshot: consegneTable.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: consegneTable.centroAscoltoIdSnapshot,
        })
        .from(consegneTable)
        .where(eq(consegneTable.id, bolla.consegnaId))
    : [];
  const rows = bolla
    ? await tx
        .select({
          id: bollaRigheTable.id,
          prodottoId: bollaRigheTable.prodottoId,
          lottoId: bollaRigheTable.lottoId,
          quantita: bollaRigheTable.quantita,
          unitaMisura: bollaRigheTable.unitaMisura,
        })
        .from(bollaRigheTable)
        .where(eq(bollaRigheTable.bollaId, bolla.id))
        .orderBy(bollaRigheTable.id)
    : [];
  const movements = bolla
    ? await tx
        .select({
          id: movimentiTable.id,
          tipoMovimento: movimentiTable.tipoMovimento,
          tipoDettaglio: movimentiTable.tipoDettaglio,
          naturaContabile: movimentiTable.naturaContabile,
          movimentoOrigineId: movimentiTable.movimentoOrigineId,
          bollaRigaId: movimentiTable.bollaRigaId,
          prodottoId: movimentiTable.prodottoId,
          lottoId: movimentiTable.lottoId,
          magazzinoId: movimentiTable.magazzinoId,
          quantita: movimentiTable.quantita,
          unitaMisura: movimentiTable.unitaMisura,
          auditEventoId: movimentiTable.auditEventoId,
        })
        .from(movimentiTable)
        .where(eq(movimentiTable.bollaId, bolla.id))
        .orderBy(movimentiTable.id)
    : [];
  const reservations = bolla
    ? await tx
        .select()
        .from(prenotazioniMagazzinoTable)
        .where(eq(prenotazioniMagazzinoTable.bollaId, bolla.id))
        .orderBy(prenotazioniMagazzinoTable.id)
    : [];
  const reversals = movements.length
    ? await tx
        .select({ id: movimentiTable.id })
        .from(movimentiTable)
        .where(
          and(
            inArray(
              movimentiTable.movimentoOrigineId,
              movements.map((m) => m.id),
            ),
            eq(movimentiTable.tipoMovimento, "storno"),
          ),
        )
        .orderBy(movimentiTable.id)
    : [];
  const finalMovements = movements.filter(
    (m) =>
      (m.tipoMovimento === "scarico" || m.tipoMovimento === "esito") &&
      m.naturaContabile ===
        (request?.tipoDestinatario === "beneficiario"
          ? "DISTRIBUZIONE_FINALE"
          : "CONSEGNA_ENTE"),
  );
  let reason: string | null = null;
  if (!request) reason = "richiesta_assente";
  else if (request.tipoDestinatario === "magazzino")
    reason = "trasferimento_fuori_perimetro";
  else if (!link || link.tipoDocumento !== "bolla" || !bolla)
    reason = "documento_corrente_assente_o_ambiguo";
  else if (!["presa_in_carico", "chiusa"].includes(request.stato))
    reason = "stato_richiesta_incompatibile";
  else if (
    bolla.tipoDestinatario !== request.tipoDestinatario ||
    bolla.beneficiarioId !== request.beneficiarioId ||
    bolla.enteDestinatarioId !== request.enteDestinatarioId
  )
    reason = "destinatario_incoerente";
  else if (
    !warehouse?.areaOperativaId ||
    warehouse.areaOperativaId !== request.areaOperativaId ||
    (bolla.areaOperativaIdSnapshot != null &&
      bolla.areaOperativaIdSnapshot !== request.areaOperativaId) ||
    (consegna?.areaOperativaIdSnapshot != null &&
      consegna.areaOperativaIdSnapshot !== request.areaOperativaId) ||
    (request.tipoDestinatario === "beneficiario" &&
      (!beneficiary?.areaOperativaId ||
        beneficiary.areaOperativaId !== request.areaOperativaId)) ||
    (request.tipoDestinatario === "ente" &&
      entity?.areaOperativaId !== request.areaOperativaId)
  )
    reason = "area_incoerente";
  else if (
    (request.centroAscoltoId != null &&
      (!centre || centre.areaOperativaId !== request.areaOperativaId)) ||
    !canAccessCentro(warehouse.centroAscoltoId, request.centroAscoltoId) ||
    (bolla.centroAscoltoIdSnapshot != null &&
      bolla.centroAscoltoIdSnapshot !== request.centroAscoltoId) ||
    (consegna?.centroAscoltoIdSnapshot != null &&
      consegna.centroAscoltoIdSnapshot !== request.centroAscoltoId) ||
    (request.tipoDestinatario === "beneficiario" &&
      beneficiary?.centroAscoltoId !== request.centroAscoltoId)
  )
    reason = "centro_incoerente";
  else if (bolla.stato !== "consegnato") reason = "documento_non_consegnato";
  else if (
    request.tipoDestinatario === "beneficiario" &&
    (!consegna ||
      consegna.stato !== "effettuata" ||
      !consegna.dataEffettuata ||
      consegna.tipoPianificazione !== "consegna_pacco" ||
      consegna.beneficiarioId !== request.beneficiarioId ||
      consegna.magazzinoId !== bolla.magazzinoId)
  )
    reason = "consegna_incoerente";
  else if (request.tipoDestinatario === "ente" && bolla.consegnaId != null)
    reason = "consegna_ente_incompatibile";
  else if (
    reservations.some((r) => r.stato === "attiva") ||
    reversals.length ||
    movements.some(
      (m) =>
        m.tipoMovimento === "storno" ||
        /rientro|perdita|deterior|scadut/.test(m.tipoDettaglio),
    )
  )
    reason = "prenotazioni_o_esiti_non_riconciliati";
  else if (
    !rows.length ||
    !finalMovements.length ||
    finalMovements.some(
      (m) =>
        !m.auditEventoId ||
        !rows.some(
          (r) =>
            r.id === m.bollaRigaId &&
            r.prodottoId === m.prodottoId &&
            r.unitaMisura === m.unitaMisura,
        ),
    ) ||
    rows.some((r) => {
      const sum = finalMovements
        .filter((m) => m.bollaRigaId === r.id)
        .reduce(
          (value, m) => value.add(InventoryDecimal.parse(m.quantita)),
          InventoryDecimal.zero(),
        );
      return sum.compare(InventoryDecimal.parse(r.quantita)) !== 0;
    })
  )
    reason = "prova_contabile_incompleta";
  const proof = {
    richiestaId,
    versione: request?.versione ?? null,
    stato: request?.stato ?? null,
    relazioneId: link?.id ?? null,
    bollaId: bolla?.id ?? null,
    versioneBolla: bolla?.versione ?? null,
    consegnaId: consegna?.id ?? null,
    statoConsegna: consegna?.stato ?? null,
    movimentiId: finalMovements.map((m) => m.id),
    auditId: [...new Set(finalMovements.map((m) => m.auditEventoId))],
    esito:
      reason == null
        ? request?.stato === "chiusa"
          ? "coerente"
          : "candidata"
        : "esclusa",
    motivo: reason ?? "consegna_documentata",
  };
  // Include the underlying proof in the hash, but never expose personal snapshots.
  const evidenceFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        links,
        bolla,
        warehouse,
        beneficiary,
        entity,
        centre,
        consegna,
        rows,
        movements,
        reservations,
        reversals,
        recipient: request
          ? [
              request.tipoDestinatario,
              request.beneficiarioId,
              request.enteDestinatarioId,
              request.areaOperativaId,
              request.centroAscoltoId,
              request.interventoId,
            ]
          : null,
      }),
    )
    .digest("hex");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ proof, evidenceFingerprint }))
    .digest("hex");
  return { ...proof, fingerprint, evidenceFingerprint };
}

/** Caller holds canonical request → document/consegna locks and authorizes current actor. */
export async function closeDeliveredRequestTx(
  tx: Tx,
  richiestaId: number,
  bollaId: number,
  audit: AuditCommandContext,
) {
  const proof = await inspectRequestClosure(tx, richiestaId);
  if (proof.bollaId !== bollaId || proof.esito === "esclusa")
    throw new M5bLinkError(
      409,
      `Richiesta non riconciliabile: ${proof.motivo}`,
    );
  if (proof.esito === "coerente") return proof;
  const [request] = await tx
    .update(richiesteMagazzinoTable)
    .set({
      stato: "chiusa",
      versione: proof.versione! + 1,
      dataAggiornamento: new Date(),
    })
    .where(
      and(
        eq(richiesteMagazzinoTable.id, richiestaId),
        eq(richiesteMagazzinoTable.versione, proof.versione!),
        eq(richiesteMagazzinoTable.stato, "presa_in_carico"),
      ),
    )
    .returning();
  if (!request)
    throw new M5bLinkError(409, "Versione Richiesta cambiata; ricarica");
  await recordAuditEvent(tx, {
    command: audit,
    azione: "richiesta_magazzino.chiusa_da_consegna",
    entitaTipo: "richiesta_magazzino",
    entitaId: richiestaId,
    areaOperativaIdSnapshot: request.areaOperativaId,
    centroAscoltoIdSnapshot: request.centroAscoltoId,
    changes: auditFields(
      { statoPrecedente: "presa_in_carico", statoNuovo: "chiusa" },
      ["statoPrecedente", "statoNuovo"],
    ),
    metadata: auditFields(
      {
        bollaId,
        consegnaId: proof.consegnaId,
        provaFingerprint: proof.fingerprint,
        movimentiId: proof.movimentiId,
      },
      ["bollaId", "consegnaId", "provaFingerprint", "movimentiId"],
    ),
  });
  return proof;
}
