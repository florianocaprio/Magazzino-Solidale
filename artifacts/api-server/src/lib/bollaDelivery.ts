import type { Response } from "express";
import { db } from "@workspace/db";
import {
  bolleTable,
  bollaRigheTable,
  consegneTable,
  interventiStoricoStatiTable,
  interventiTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  prodottiTable,
} from "@workspace/db";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { dataCivileEuropeRome } from "./interventiWorkflow";
import { requireOperationalMagazzino } from "./inventoryLedger";
import { lockInventoryLotsInGlobalOrder } from "./inventoryLocks";
import { isLottoDistribuibile } from "./lottoPolicy";
import { InventoryDecimal } from "./inventoryDecimal";
import {
  ensureDistributionOperation,
  markDistributionOperationReversed,
} from "./distributionLedger";
import { resolveInventoryQuantityDimensions } from "./inventoryQuantityDimensions";
import {
  BeneficiaryReportingScopeError,
  isReportingSnapshotConcurrencyError,
  lockBeneficiaryReportingContextTx,
} from "./reporting/eventSnapshots";
import {
  canAccessBeneficiarioScope,
  type BeneficiarioAccessScope,
} from "./beneficiarioPolicy";
import { canAccessAreaOperativa, canAccessCentro } from "./centroScope";
import {
  auditFields,
  auditUserId,
  recordAuditEvent,
  type AuditCommandContext,
} from "./auditEvent";
import {
  DocumentCommandError,
  loadDocumentCommand,
  lockConsegnaBollaRelation,
  lockDocumentCommand,
  storeDocumentCommand,
  validateDocumentCommand,
} from "./documentCommand";
import { movementPhysicalEffect } from "./movementPhysicalEffect";
import {
  CurrentCommandActorError,
  requireCurrentCommandActor,
} from "./currentCommandActor";

const PRENOTAZIONE_ATTIVA = "attiva";
const PRENOTAZIONE_CONVERTITA = "convertita_in_scarico";
const PRENOTAZIONE_CONVERTITA_AFFIDAMENTO = "convertita_in_affidamento";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class BollaActionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function handleBollaActionError(err: unknown, res: Response): boolean {
  if (err instanceof BeneficiaryReportingScopeError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  if (isReportingSnapshotConcurrencyError(err)) {
    res.status(409).json({
      error: "Finalizzazione concorrente: ricarica i dati e riprova",
    });
    return true;
  }
  if (err instanceof BollaActionError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  if (err instanceof CurrentCommandActorError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  if (err instanceof DocumentCommandError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

// mappa tipo prodotto -> etichetta tipo intervento sociale
const TIPO_PRODOTTO_INTERVENTO: Record<string, string> = {
  alimentare: "pacco_alimentare",
  vestiario: "vestiti",
  igiene: "igiene",
  medicinali: "medicinali",
  farmaci: "medicinali",
};

const LABEL_INTERVENTO: Record<string, string> = {
  pacco_alimentare: "Pacco Alimentare",
  vestiti: "Vestiti",
  igiene: "Igiene",
  medicinali: "Medicinali",
};

export async function lockBolla(
  tx: Tx,
  bollaId: number,
): Promise<typeof bolleTable.$inferSelect> {
  await tx.execute(
    sql`SELECT id FROM ${bolleTable} WHERE ${bolleTable.id} = ${bollaId} FOR UPDATE`,
  );
  const [bolla] = await tx
    .select()
    .from(bolleTable)
    .where(eq(bolleTable.id, bollaId));
  if (!bolla) throw new BollaActionError(404, "Bolla non trovata");
  return bolla;
}

export async function lockLotto(
  tx: Tx,
  lottoId: number,
): Promise<typeof lottiTable.$inferSelect> {
  await tx.execute(
    sql`SELECT id FROM ${lottiTable} WHERE ${lottiTable.id} = ${lottoId} FOR UPDATE`,
  );
  const [lotto] = await tx
    .select()
    .from(lottiTable)
    .where(eq(lottiTable.id, lottoId));
  if (!lotto) throw new BollaActionError(404, "Lotto non trovato");
  return lotto;
}

async function syncInterventoBollaTx(tx: Tx, bollaId: number) {
  const [bolla] = await tx
    .select()
    .from(bolleTable)
    .where(eq(bolleTable.id, bollaId));
  if (!bolla) return;
  if (bolla.tipoDestinatario !== "beneficiario" || bolla.beneficiarioId == null)
    return;

  const righe = await tx
    .select({ tipoProdotto: prodottiTable.tipoProdotto })
    .from(bollaRigheTable)
    .leftJoin(prodottiTable, eq(bollaRigheTable.prodottoId, prodottiTable.id))
    .where(eq(bollaRigheTable.bollaId, bollaId));

  const [esistente] = await tx
    .select()
    .from(interventiTable)
    .where(eq(interventiTable.bollaId, bollaId));

  if (righe.length === 0) {
    return;
  }

  const etichette: string[] = [];
  for (const r of righe) {
    const tipo = r.tipoProdotto ?? "";
    const label = TIPO_PRODOTTO_INTERVENTO[tipo] ?? (tipo || "consegna");
    if (!etichette.includes(label)) etichette.push(label);
  }
  const tipoIntervento = etichette.join(",");
  const descLabels = etichette.map((e) => LABEL_INTERVENTO[e] ?? e).join(", ");
  const descrizione = `Consegna automatica da bolla ${bolla.numeroBolla}: ${descLabels}`;

  if (esistente) {
    await tx
      .update(interventiTable)
      .set({
        tipoIntervento,
        descrizione,
        beneficiarioId: bolla.beneficiarioId,
        dataIntervento: bolla.dataBolla,
        operatoreId: bolla.operatoreId,
        areaOperativaIdSnapshot:
          esistente.areaOperativaIdSnapshot ?? bolla.areaOperativaIdSnapshot,
        centroAscoltoIdSnapshot:
          esistente.centroAscoltoIdSnapshot ?? bolla.centroAscoltoIdSnapshot,
      })
      .where(eq(interventiTable.id, esistente.id));
  } else {
    await tx.insert(interventiTable).values({
      beneficiarioId: bolla.beneficiarioId,
      bollaId,
      dataIntervento: bolla.dataBolla,
      tipoIntervento,
      descrizione,
      operatoreId: bolla.operatoreId,
      areaOperativaIdSnapshot: bolla.areaOperativaIdSnapshot,
      centroAscoltoIdSnapshot: bolla.centroAscoltoIdSnapshot,
    });
  }
}

export async function syncInterventoBolla(bollaId: number) {
  await db.transaction((tx) => syncInterventoBollaTx(tx, bollaId));
}

export async function annullaInterventoDaBollaTx(
  tx: Tx,
  bollaId: number,
  operatoreId: number,
  motivo: string,
): Promise<void> {
  const [intervento] = await tx
    .select()
    .from(interventiTable)
    .where(eq(interventiTable.bollaId, bollaId))
    .for("update");
  if (!intervento || intervento.stato === "annullato") return;

  const now = new Date();
  await tx
    .update(interventiTable)
    .set({
      stato: "annullato",
      motivoAnnullamento: motivo,
      operatoreId,
      dataAggiornamento: now,
    })
    .where(eq(interventiTable.id, intervento.id));
  await tx.insert(interventiStoricoStatiTable).values({
    interventoId: intervento.id,
    statoPrecedente: intervento.stato,
    statoNuovo: "annullato",
    operatoreId,
    dataTransizione: now,
    motivo,
  });
}

export async function stornoRigaTx(
  tx: Tx,
  riga: { id: number },
  bollaId: number,
  operatoreId: number,
  auditEventoId: number | null = null,
) {
  return stornoRigheTx(tx, [riga], bollaId, operatoreId, auditEventoId);
}

export async function stornoRigheTx(
  tx: Tx,
  righe: Array<{ id: number }>,
  bollaId: number,
  operatoreId: number,
  auditEventoId: number | null = null,
) {
  const rigaIds = [...new Set(righe.map((riga) => riga.id))].sort(
    (a, b) => a - b,
  );
  if (rigaIds.length === 0) return;

  const movimenti = await tx
    .select()
    .from(movimentiTable)
    .where(
      and(
        eq(movimentiTable.bollaId, bollaId),
        inArray(movimentiTable.bollaRigaId, rigaIds),
        or(
          and(
            eq(movimentiTable.tipoMovimento, "scarico"),
            ne(movimentiTable.tipoDettaglio, "affidamento_trasporto"),
          ),
          and(
            eq(movimentiTable.tipoMovimento, "esito"),
            inArray(movimentiTable.naturaContabile, [
              "DISTRIBUZIONE_FINALE",
              "CONSEGNA_ENTE",
            ]),
          ),
        ),
      ),
    )
    .orderBy(
      asc(movimentiTable.prodottoId),
      asc(movimentiTable.lottoId),
      asc(movimentiTable.id),
    )
    .for("update");

  await lockInventoryLotsInGlobalOrder(tx, {
    kind: "lot-ids",
    lottoIds: movimenti.flatMap((movimento) =>
      movimento.lottoId == null ? [] : [movimento.lottoId],
    ),
  });

  for (const mov of movimenti) {
    if (!mov.lottoId) continue;
    const [stornoEsistente] = await tx
      .select({ id: movimentiTable.id })
      .from(movimentiTable)
      .where(eq(movimentiTable.movimentoOrigineId, mov.id));
    if (stornoEsistente) {
      throw new BollaActionError(
        409,
        "Il movimento della Bolla è già stato stornato",
      );
    }
    const physicalEffect = movementPhysicalEffect(mov);
    if (physicalEffect !== 0) {
      const lotto = await lockLotto(tx, mov.lottoId);
      const quantity = InventoryDecimal.parse(mov.quantita);
      const nuovaQta =
        physicalEffect < 0
          ? InventoryDecimal.parse(lotto.quantitaResidua).add(quantity)
          : InventoryDecimal.parse(lotto.quantitaResidua).subtract(quantity);
      if (nuovaQta.isNegative()) {
        throw new BollaActionError(
          409,
          "Lo storno supererebbe la giacenza reale del lotto",
        );
      }
      await tx
        .update(lottiTable)
        .set({ quantitaResidua: nuovaQta.toDb() })
        .where(eq(lottiTable.id, mov.lottoId));
    }
    await tx.insert(movimentiTable).values({
      tipoMovimento: "storno",
      tipoDettaglio: "storno_bolla",
      dataMovimento: dataCivileEuropeRome(new Date()),
      magazzinoId: mov.magazzinoId,
      prodottoId: mov.prodottoId,
      lottoId: mov.lottoId,
      quantita: mov.quantita,
      unitaMisura: mov.unitaMisura,
      fornitoreId: mov.fornitoreId,
      beneficiarioId: mov.beneficiarioId,
      bollaId: mov.bollaId,
      bollaRigaId: mov.bollaRigaId,
      trasferimentoId: mov.trasferimentoId,
      movimentoOrigineId: mov.id,
      quantitaPezzi: mov.quantitaPezzi,
      quantitaKgLt: mov.quantitaKgLt,
      fattoreKgLtPezzo: mov.fattoreKgLtPezzo,
      fondoOrigine: mov.fondoOrigine,
      naturaContabile: "STORNO",
      dominioOrigine: mov.dominioOrigine,
      entitaOrigineTipo: mov.entitaOrigineTipo,
      entitaOrigineId: mov.entitaOrigineId,
      rigaOrigineId: mov.rigaOrigineId,
      operazioneDistribuzioneId: mov.operazioneDistribuzioneId,
      canaleOperativo: mov.canaleOperativo,
      operatoreId,
      auditEventoId,
      documentoRiferimento: mov.documentoRiferimento,
      note: `Storno del movimento #${mov.id}${mov.note ? ` — ${mov.note}` : ""}`,
    });
    await markDistributionOperationReversed(tx, mov.operazioneDistribuzioneId);
  }
}

export async function scarichiFisiciBolla(
  tx: Tx,
  bollaId: number,
): Promise<number> {
  const rows = await tx
    .select({ id: movimentiTable.id })
    .from(movimentiTable)
    .where(
      and(
        eq(movimentiTable.bollaId, bollaId),
        eq(movimentiTable.tipoMovimento, "scarico"),
      ),
    );
  return rows.length;
}

export async function convertiPrenotazioniAttiveInScarico(
  tx: Tx,
  bolla: typeof bolleTable.$inferSelect,
  opts: {
    dataMovimento: string;
    operatoreId: number;
    auditEventoId: number | null;
    mode?: "consegna" | "affidamento";
  },
): Promise<number> {
  const prenotazioni = await tx
    .select({ p: prenotazioniMagazzinoTable, r: bollaRigheTable })
    .from(prenotazioniMagazzinoTable)
    .leftJoin(
      bollaRigheTable,
      eq(prenotazioniMagazzinoTable.rigaBollaId, bollaRigheTable.id),
    )
    .where(
      and(
        eq(prenotazioniMagazzinoTable.bollaId, bolla.id),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
      ),
    )
    .orderBy(
      asc(prenotazioniMagazzinoTable.prodottoId),
      asc(prenotazioniMagazzinoTable.lottoId),
      asc(prenotazioniMagazzinoTable.id),
    );

  const righeBolla = await tx
    .select({
      id: bollaRigheTable.id,
      quantita: bollaRigheTable.quantita,
    })
    .from(bollaRigheTable)
    .where(eq(bollaRigheTable.bollaId, bolla.id));
  const reservedByRow = new Map<number, InventoryDecimal>();
  for (const item of prenotazioni) {
    if (item.p.rigaBollaId == null || !item.r || item.r.bollaId !== bolla.id) {
      throw new BollaActionError(
        409,
        "Prenotazione priva di riga Bolla coerente",
      );
    }
    reservedByRow.set(
      item.p.rigaBollaId,
      (reservedByRow.get(item.p.rigaBollaId) ?? InventoryDecimal.zero()).add(
        InventoryDecimal.parse(item.p.quantita),
      ),
    );
  }
  if (
    opts.mode === "affidamento" &&
    (righeBolla.length === 0 ||
      righeBolla.some(
        (riga) =>
          (reservedByRow.get(riga.id) ?? InventoryDecimal.zero()).compare(
            InventoryDecimal.parse(riga.quantita),
          ) !== 0,
      ))
  ) {
    throw new BollaActionError(
      409,
      "Le prenotazioni non coprono esattamente la Bolla",
    );
  }

  await lockInventoryLotsInGlobalOrder(tx, {
    kind: "lot-ids",
    lottoIds: prenotazioni.map((row) => row.p.lottoId),
  });

  const isBeneficiario = bolla.tipoDestinatario === "beneficiario";
  const canaleOperativo = isBeneficiario
    ? bolla.consegnaId != null
      ? "DOMICILIARE"
      : "RITIRO_SEDE"
    : "ALTRO";
  const operation =
    isBeneficiario && opts.mode !== "affidamento"
      ? await ensureDistributionOperation(tx, {
          magazzinoId: bolla.magazzinoId,
          dataDistribuzione: opts.dataMovimento,
          canaleOperativo,
          dominioOrigine: "BOLLA",
          entitaOrigineTipo: "bolla",
          entitaOrigineId: bolla.id,
          areaOperativaIdSnapshot: bolla.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: bolla.centroAscoltoIdSnapshot,
          territorioClassificazione:
            bolla.areaOperativaIdSnapshot == null
              ? "legacy_sconosciuto"
              : "attribuito",
          numeroDocumento: bolla.numeroBolla,
          numeroPacchi: 1,
          creatoDa: opts.operatoreId,
        })
      : null;

  for (const row of prenotazioni) {
    const prenotazione = row.p;
    const qta = InventoryDecimal.parse(prenotazione.quantita);
    const lotto = await lockLotto(tx, prenotazione.lottoId);
    if (!isLottoDistribuibile(lotto.dataScadenza, opts.dataMovimento)) {
      throw new BollaActionError(
        409,
        `Impossibile consegnare la bolla: il lotto ${lotto.codiceLotto ?? `#${lotto.id}`} è scaduto`,
      );
    }
    const residua = InventoryDecimal.parse(lotto.quantitaResidua);
    if (residua.compare(qta) < 0) {
      throw new BollaActionError(
        409,
        `Impossibile consegnare la bolla: il lotto ${lotto.codiceLotto ?? `#${lotto.id}`} ha ${residua.toCanonical()} disponibili ma risultano prenotati ${qta.toCanonical()}`,
      );
    }

    await tx
      .update(lottiTable)
      .set({ quantitaResidua: residua.subtract(qta).toDb() })
      .where(eq(lottiTable.id, lotto.id));

    const unitaMisura = row.r?.unitaMisura ?? "pz";
    const dimensions = resolveInventoryQuantityDimensions({
      quantitaOperativa: prenotazione.quantita,
      unitaMisura,
      fattorePartita: lotto.fattoreKgLtPezzo,
    });

    await tx.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio:
        opts.mode === "affidamento"
          ? "affidamento_trasporto"
          : isBeneficiario
            ? "consegna_beneficiario"
            : "consegna_ente",
      dataMovimento: opts.dataMovimento,
      magazzinoId: prenotazione.magazzinoId,
      prodottoId: prenotazione.prodottoId,
      lottoId: prenotazione.lottoId,
      quantita: prenotazione.quantita,
      quantitaPezzi: dimensions.quantitaPezzi,
      quantitaKgLt: dimensions.quantitaKgLt,
      fattoreKgLtPezzo: dimensions.fattoreKgLtPezzo,
      unitaMisura,
      beneficiarioId: isBeneficiario ? bolla.beneficiarioId : null,
      operatoreId: opts.operatoreId,
      auditEventoId: opts.auditEventoId,
      bollaId: bolla.id,
      bollaRigaId: prenotazione.rigaBollaId,
      fondoOrigine: lotto.fondoOrigine,
      naturaContabile:
        opts.mode === "affidamento"
          ? "AFFIDAMENTO_TRASPORTO"
          : isBeneficiario
            ? "DISTRIBUZIONE_FINALE"
            : "CONSEGNA_ENTE",
      dominioOrigine: "BOLLA",
      entitaOrigineTipo: "bolla",
      entitaOrigineId: bolla.id,
      rigaOrigineId: prenotazione.rigaBollaId,
      operazioneDistribuzioneId: operation?.id ?? null,
      canaleOperativo,
      documentoRiferimento: bolla.numeroBolla,
      note: row.r?.note ?? undefined,
    });

    await tx
      .update(prenotazioniMagazzinoTable)
      .set({
        stato:
          opts.mode === "affidamento"
            ? PRENOTAZIONE_CONVERTITA_AFFIDAMENTO
            : PRENOTAZIONE_CONVERTITA,
        updatedAt: new Date(),
      })
      .where(eq(prenotazioniMagazzinoTable.id, prenotazione.id));
  }

  return prenotazioni.length;
}

/** Final outcome of entrusted goods: accounting distribution, zero physical stock. */
async function registraEsitoAffidamentoTx(
  tx: Tx,
  bolla: typeof bolleTable.$inferSelect,
  opts: { dataMovimento: string; operatoreId: number; auditEventoId: number },
): Promise<number> {
  const uscite = await tx
    .select()
    .from(movimentiTable)
    .where(
      and(
        eq(movimentiTable.bollaId, bolla.id),
        eq(movimentiTable.tipoMovimento, "scarico"),
        eq(movimentiTable.tipoDettaglio, "affidamento_trasporto"),
      ),
    )
    .orderBy(asc(movimentiTable.id))
    .for("update");
  if (uscite.length === 0) {
    throw new BollaActionError(409, "Nessuna merce affidata da consegnare");
  }
  const isBeneficiario = bolla.tipoDestinatario === "beneficiario";
  const canaleOperativo = isBeneficiario
    ? bolla.consegnaId != null
      ? "DOMICILIARE"
      : "RITIRO_SEDE"
    : "ALTRO";
  const operation = isBeneficiario
    ? await ensureDistributionOperation(tx, {
        magazzinoId: bolla.magazzinoId,
        dataDistribuzione: opts.dataMovimento,
        canaleOperativo,
        dominioOrigine: "BOLLA",
        entitaOrigineTipo: "bolla",
        entitaOrigineId: bolla.id,
        areaOperativaIdSnapshot: bolla.areaOperativaIdSnapshot,
        centroAscoltoIdSnapshot: bolla.centroAscoltoIdSnapshot,
        territorioClassificazione:
          bolla.areaOperativaIdSnapshot == null
            ? "legacy_sconosciuto"
            : "attribuito",
        numeroDocumento: bolla.numeroBolla,
        numeroPacchi: 1,
        creatoDa: opts.operatoreId,
      })
    : null;
  for (const uscita of uscite) {
    const [existing] = await tx
      .select({ id: movimentiTable.id })
      .from(movimentiTable)
      .where(
        and(
          eq(movimentiTable.movimentoOrigineId, uscita.id),
          eq(movimentiTable.tipoMovimento, "esito"),
          inArray(movimentiTable.naturaContabile, [
            "DISTRIBUZIONE_FINALE",
            "CONSEGNA_ENTE",
          ]),
        ),
      );
    if (existing)
      throw new BollaActionError(409, "Esito di consegna già registrato");
    await tx.insert(movimentiTable).values({
      tipoMovimento: "esito",
      tipoDettaglio: isBeneficiario ? "consegna_beneficiario" : "consegna_ente",
      dataMovimento: opts.dataMovimento,
      magazzinoId: uscita.magazzinoId,
      prodottoId: uscita.prodottoId,
      lottoId: uscita.lottoId,
      quantita: uscita.quantita,
      quantitaPezzi: uscita.quantitaPezzi,
      quantitaKgLt: uscita.quantitaKgLt,
      fattoreKgLtPezzo: uscita.fattoreKgLtPezzo,
      unitaMisura: uscita.unitaMisura,
      fornitoreId: uscita.fornitoreId,
      beneficiarioId: isBeneficiario ? bolla.beneficiarioId : null,
      bollaId: bolla.id,
      bollaRigaId: uscita.bollaRigaId,
      movimentoOrigineId: uscita.id,
      fondoOrigine: uscita.fondoOrigine,
      naturaContabile: isBeneficiario
        ? "DISTRIBUZIONE_FINALE"
        : "CONSEGNA_ENTE",
      dominioOrigine: "BOLLA",
      entitaOrigineTipo: "bolla",
      entitaOrigineId: bolla.id,
      rigaOrigineId: uscita.bollaRigaId,
      operazioneDistribuzioneId: operation?.id ?? null,
      canaleOperativo,
      operatoreId: opts.operatoreId,
      auditEventoId: opts.auditEventoId,
      documentoRiferimento: bolla.numeroBolla,
    });
  }
  return uscite.length;
}

async function syncConsegnaDaBollaTx(
  tx: Tx,
  bolla: typeof bolleTable.$inferSelect,
  lockedConsegna: typeof consegneTable.$inferSelect | null,
) {
  if (bolla.tipoDestinatario !== "beneficiario" || bolla.beneficiarioId == null)
    return;
  const now = new Date();

  if (bolla.consegnaId != null) {
    if (!lockedConsegna || lockedConsegna.id !== bolla.consegnaId) {
      throw new BollaActionError(
        409,
        "La Consegna collegata non è stata bloccata in modo coerente",
      );
    }
    if (lockedConsegna.stato !== "effettuata") {
      await tx
        .update(consegneTable)
        .set({
          stato: "effettuata",
          dataEffettuata: now,
          areaOperativaIdSnapshot: bolla.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: bolla.centroAscoltoIdSnapshot,
        })
        .where(eq(consegneTable.id, bolla.consegnaId));
    }
    return;
  }

  const today = dataCivileEuropeRome(now);
  const codice = `CON-${Date.now()}`;
  const [nuova] = await tx
    .insert(consegneTable)
    .values({
      codice,
      beneficiarioId: bolla.beneficiarioId,
      tipoConsegna: "diretta",
      dataPrevista: today,
      magazzinoId: bolla.magazzinoId,
      stato: "effettuata",
      dataEffettuata: now,
      areaOperativaIdSnapshot: bolla.areaOperativaIdSnapshot,
      centroAscoltoIdSnapshot: bolla.centroAscoltoIdSnapshot,
      noteOperative: `Consegna diretta registrata dalla bolla ${bolla.numeroBolla}`,
    })
    .returning();
  await tx
    .update(bolleTable)
    .set({ consegnaId: nuova.id })
    .where(eq(bolleTable.id, bolla.id));
}

async function lockAndAuthorizeBollaDeliveryScope(
  tx: Tx,
  bolla: typeof bolleTable.$inferSelect,
  accessScope: BeneficiarioAccessScope,
) {
  const reportingContext =
    bolla.tipoDestinatario === "beneficiario"
      ? await lockBeneficiaryReportingContextTx(tx, bolla.beneficiarioId!)
      : null;
  if (
    reportingContext &&
    !canAccessBeneficiarioScope(reportingContext, accessScope)
  ) {
    throw new BeneficiaryReportingScopeError();
  }
  const [lockedMagazzino] = await tx
    .select()
    .from(magazziniTable)
    .where(eq(magazziniTable.id, bolla.magazzinoId))
    .for("share");
  if (
    !lockedMagazzino ||
    !canAccessCentro(
      lockedMagazzino.centroAscoltoId,
      accessScope.centroAscoltoId,
    ) ||
    !canAccessAreaOperativa(
      lockedMagazzino.areaOperativaId,
      accessScope.areaOperativaId,
    )
  ) {
    throw new BollaActionError(
      403,
      "Magazzino non accessibile per il tuo profilo",
    );
  }
  return reportingContext;
}

export async function completeBollaDelivery(opts: {
  bollaId: number;
  audit: AuditCommandContext;
  noteRicezione?: string | null;
  confermaRicezione?: boolean;
  allowAlreadyConsegnata?: boolean;
  beneficiaryAccessScope: BeneficiarioAccessScope;
  expectedConsegna: { id: number; beneficiarioId: number } | null;
  requiredPermission?: "bolle.deliver" | "consegne.complete";
  documentCommand?: {
    tipoComando: string;
    idempotencyKey: string;
    requestHash: string;
    expectedVersion: number;
    actorUserId: number;
  };
}): Promise<{ alreadyConsegnata: boolean; replay: boolean }> {
  const dataMovimento = dataCivileEuropeRome(new Date());
  let alreadyConsegnata = false;
  let replay = false;

  await db.transaction(async (tx) => {
    if (opts.documentCommand) {
      await lockDocumentCommand(
        tx,
        opts.documentCommand.tipoComando,
        opts.documentCommand.idempotencyKey,
      );
    }
    if (opts.expectedConsegna) {
      await lockConsegnaBollaRelation(tx, opts.expectedConsegna.id);
    }
    const current = await lockBolla(tx, opts.bollaId);
    const freshActor = await requireCurrentCommandActor(
      tx,
      auditUserId(opts.audit),
      opts.requiredPermission ?? "bolle.deliver",
    );
    const currentScope = {
      areaOperativaId: freshActor.areaOperativaId,
      centroAscoltoId: freshActor.centroAscoltoId,
      zonaUdsId: freshActor.zonaUdsId,
    };
    const isBeneficiario = current.tipoDestinatario === "beneficiario";
    const existingReceipt = opts.documentCommand
      ? await loadDocumentCommand(tx, {
          tipoComando: opts.documentCommand.tipoComando,
          idempotencyKey: opts.documentCommand.idempotencyKey,
        })
      : null;
    if (existingReceipt && opts.documentCommand) {
      await lockAndAuthorizeBollaDeliveryScope(tx, current, currentScope);
      validateDocumentCommand(existingReceipt, {
        tipoComando: opts.documentCommand.tipoComando,
        idempotencyKey: opts.documentCommand.idempotencyKey,
        requestHash: opts.documentCommand.requestHash,
        actorUserId: opts.documentCommand.actorUserId,
        aggregatoTipo: "bolla",
        aggregatoId: opts.bollaId,
      });
      replay = true;
      return;
    }
    let lockedConsegna: typeof consegneTable.$inferSelect | null = null;
    if (opts.expectedConsegna) {
      const [candidateConsegna] = await tx
        .select()
        .from(consegneTable)
        .where(eq(consegneTable.id, opts.expectedConsegna.id))
        .for("update");
      lockedConsegna = candidateConsegna ?? null;
      if (
        !lockedConsegna ||
        lockedConsegna.tipoPianificazione !== "consegna_pacco" ||
        lockedConsegna.beneficiarioId !==
          opts.expectedConsegna.beneficiarioId ||
        current.tipoDestinatario !== "beneficiario" ||
        current.beneficiarioId !== opts.expectedConsegna.beneficiarioId ||
        current.consegnaId !== opts.expectedConsegna.id
      ) {
        throw new BollaActionError(
          409,
          "La Consegna e la Bolla non risultano più associate allo stesso Beneficiario",
        );
      }
    } else if (current.consegnaId != null) {
      throw new BollaActionError(
        409,
        "L'associazione della Bolla a una Consegna è cambiata; ricaricare i dati",
      );
    }
    const reportingContext = await lockAndAuthorizeBollaDeliveryScope(
      tx,
      current,
      currentScope,
    );
    if (
      opts.documentCommand &&
      current.versione !== opts.documentCommand.expectedVersion
    ) {
      throw new DocumentCommandError(
        409,
        "Versione non aggiornata; ricaricare i dati",
      );
    }
    if (reportingContext && !reportingContext.attivo) {
      throw new BeneficiaryReportingScopeError();
    }

    if (current.stato === "consegnato") {
      if (!opts.allowAlreadyConsegnata) {
        throw new BollaActionError(400, "La bolla risulta già consegnata");
      }
      alreadyConsegnata = true;
      await recordAuditEvent(tx, {
        command: opts.audit,
        azione: "CONSEGNA_LEGACY_RICONCILIATA",
        entitaTipo: "bolla",
        entitaId: current.id,
        documentoTipo: "bolla",
        documentoId: current.id,
        areaOperativaIdSnapshot: current.areaOperativaIdSnapshot,
        centroAscoltoIdSnapshot: current.centroAscoltoIdSnapshot,
        magazzinoIdSnapshot: current.magazzinoId,
        dataOperativa: dataMovimento,
        metadata: auditFields(
          { consegnaId: current.consegnaId, stato: current.stato },
          ["consegnaId", "stato"],
        ),
      });
      if (isBeneficiario) {
        await syncConsegnaDaBollaTx(tx, current, lockedConsegna);
        await syncInterventoBollaTx(tx, opts.bollaId);
      }
      if (opts.documentCommand) {
        await storeDocumentCommand(tx, {
          tipoComando: opts.documentCommand.tipoComando,
          idempotencyKey: opts.documentCommand.idempotencyKey,
          requestHash: opts.documentCommand.requestHash,
          aggregatoTipo: "bolla",
          aggregatoId: opts.bollaId,
          versioneRichiesta: opts.documentCommand.expectedVersion,
          versioneRisultante: current.versione,
          resultSnapshot: {
            id: opts.bollaId,
            stato: current.stato,
            versione: current.versione,
          },
          actorUserId: opts.documentCommand.actorUserId,
        });
      }
      return;
    }

    if (current.stato !== "confermato" && current.stato !== "in_trasporto") {
      throw new BollaActionError(
        400,
        "La bolla deve essere in stato confermato per essere consegnata",
      );
    }

    const reportingSnapshot = reportingContext?.snapshot ?? {
      areaOperativaIdSnapshot: current.areaOperativaIdSnapshot,
      centroAscoltoIdSnapshot: null,
      numeroComponentiNucleoSnapshot: null,
    };
    let areaOperativaIdSnapshot = current.areaOperativaIdSnapshot;
    let centroAscoltoIdSnapshot = current.centroAscoltoIdSnapshot;
    if (areaOperativaIdSnapshot == null && centroAscoltoIdSnapshot == null) {
      areaOperativaIdSnapshot = reportingSnapshot.areaOperativaIdSnapshot;
      centroAscoltoIdSnapshot = reportingSnapshot.centroAscoltoIdSnapshot;
    } else if (
      areaOperativaIdSnapshot != null &&
      centroAscoltoIdSnapshot == null &&
      reportingSnapshot.areaOperativaIdSnapshot === areaOperativaIdSnapshot
    ) {
      centroAscoltoIdSnapshot = reportingSnapshot.centroAscoltoIdSnapshot;
    } else if (
      areaOperativaIdSnapshot == null &&
      centroAscoltoIdSnapshot != null &&
      reportingSnapshot.centroAscoltoIdSnapshot === centroAscoltoIdSnapshot
    ) {
      areaOperativaIdSnapshot = reportingSnapshot.areaOperativaIdSnapshot;
    }
    const effectiveReportingSnapshot = {
      areaOperativaIdSnapshot,
      centroAscoltoIdSnapshot,
      numeroComponentiNucleoSnapshot:
        current.numeroComponentiNucleoSnapshot ??
        reportingSnapshot.numeroComponentiNucleoSnapshot,
    };
    const [snapshotted] = await tx
      .update(bolleTable)
      .set(effectiveReportingSnapshot)
      .where(eq(bolleTable.id, opts.bollaId))
      .returning();
    const effectiveBolla = snapshotted ?? {
      ...current,
      ...effectiveReportingSnapshot,
    };

    if (current.stato === "confermato") {
      await requireOperationalMagazzino(tx, effectiveBolla.magazzinoId);
    }
    const operatoreId = auditUserId(opts.audit);
    const auditEventoId = await recordAuditEvent(tx, {
      command: opts.audit,
      azione: "BOLLA_CONSEGNATA",
      entitaTipo: "bolla",
      entitaId: effectiveBolla.id,
      documentoTipo: "bolla",
      documentoId: effectiveBolla.id,
      areaOperativaIdSnapshot: effectiveBolla.areaOperativaIdSnapshot,
      centroAscoltoIdSnapshot: effectiveBolla.centroAscoltoIdSnapshot,
      magazzinoIdSnapshot: effectiveBolla.magazzinoId,
      dataOperativa: dataMovimento,
      changes: auditFields(
        { statoPrecedente: current.stato, statoNuovo: "consegnato" },
        ["statoPrecedente", "statoNuovo"],
      ),
      metadata: auditFields(
        { confermaRicezione: opts.confermaRicezione ?? true },
        ["confermaRicezione"],
      ),
    });
    const convertite =
      current.stato === "in_trasporto"
        ? await registraEsitoAffidamentoTx(tx, effectiveBolla, {
            dataMovimento,
            operatoreId,
            auditEventoId,
          })
        : await convertiPrenotazioniAttiveInScarico(tx, effectiveBolla, {
            dataMovimento,
            operatoreId,
            auditEventoId,
          });
    if (convertite === 0 && current.stato === "confermato") {
      const scarichiLegacy = await scarichiFisiciBolla(tx, opts.bollaId);
      if (scarichiLegacy === 0) {
        throw new BollaActionError(
          409,
          "Nessuna prenotazione attiva da convertire in scarico per questa bolla",
        );
      }
    }

    const [updated] = await tx
      .update(bolleTable)
      .set({
        stato: "consegnato",
        confermaRicezione: opts.confermaRicezione ?? true,
        noteRicezione: opts.noteRicezione ?? null,
        operatoreId,
        versione: sql`${bolleTable.versione} + 1`,
        ...effectiveReportingSnapshot,
      })
      .where(eq(bolleTable.id, opts.bollaId))
      .returning();

    if (isBeneficiario) {
      await syncConsegnaDaBollaTx(
        tx,
        updated ?? {
          ...effectiveBolla,
          stato: "consegnato",
          operatoreId,
        },
        lockedConsegna,
      );
      await syncInterventoBollaTx(tx, opts.bollaId);
    }
    if (opts.documentCommand) {
      const resultingVersion = updated?.versione ?? current.versione + 1;
      await storeDocumentCommand(tx, {
        tipoComando: opts.documentCommand.tipoComando,
        idempotencyKey: opts.documentCommand.idempotencyKey,
        requestHash: opts.documentCommand.requestHash,
        aggregatoTipo: "bolla",
        aggregatoId: opts.bollaId,
        versioneRichiesta: opts.documentCommand.expectedVersion,
        versioneRisultante: resultingVersion,
        resultSnapshot: {
          id: opts.bollaId,
          stato: "consegnato",
          versione: resultingVersion,
        },
        actorUserId: opts.documentCommand.actorUserId,
      });
    }
  });

  return { alreadyConsegnata, replay };
}
