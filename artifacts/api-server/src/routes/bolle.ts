import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  bolleTable,
  bollaRigheTable,
  beneficiariTable,
  magazziniTable,
  lottiTable,
  prodottiTable,
  volontariTable,
  consegneTable,
  utentiTable,
  centriAscoltoTable,
  prenotazioniMagazzinoTable,
  speseEmporioRigheTable,
  speseEmporioTable,
  movimentiTable,
  entiDestinatariTable,
} from "@workspace/db";
import {
  eq,
  and,
  or,
  inArray,
  desc,
  asc,
  gt,
  isNull,
  ne,
  sum,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
  callerZonaUdsId,
  centroScopeFilter,
  areaOperativaScopeFilter,
  magazzinoScopeFilter,
  canAccessCentro,
  canAccessAreaOperativa,
  canAccessZonaUds,
  beneficiarioCentroId,
  beneficiarioAreaOperativaId,
  beneficiarioZonaUdsId,
  canUseBeneficiario,
  visibleMagazzinoIds,
} from "../lib/centroScope";
import {
  calcolaDisponibilitaMagazzino,
  parseDbNumber,
} from "../lib/disponibilitaMagazzino";
import {
  BollaActionError,
  completeBollaDelivery,
  handleBollaActionError,
  lockBolla,
  lockLotto,
  annullaInterventoDaBollaTx,
  scarichiFisiciBolla,
  stornoRigheTx,
  convertiPrenotazioniAttiveInScarico,
} from "../lib/bollaDelivery";
import { InventoryDecimal } from "../lib/inventoryDecimal";
import {
  ProductOperationalQuantityError,
  validateProductOperationalQuantity,
} from "../lib/productQuantity";
import {
  beneficiarioAccessScopeFromRequest,
  canAccessBeneficiarioScope,
  isBeneficiarioActive,
} from "../lib/beneficiarioPolicy";
import { requireAllModuli } from "../lib/featureFlags";
import { dataCivileEuropeRome, isDateOnly } from "../lib/interventiWorkflow";
import {
  ConsegnaPlanningError,
  isFasciaConsegna,
  validateConsegnaPlanningTx,
} from "../lib/consegneTurni";
import {
  lockConsegnaPlanningContextTx,
  reconcileConsegnaPlanningTx,
} from "../lib/consegneReconciliation";
import {
  isPlanningConcurrencyError,
  PLANNING_CONCURRENCY_MESSAGE,
} from "../lib/logisticaPolicy";
import { logger } from "../lib/logger";
import { requirePermission } from "../middlewares/auth";
import {
  InventoryLedgerError,
  requireOperationalMagazzino,
} from "../lib/inventoryLedger";
import { lockInventoryLotsInGlobalOrder } from "../lib/inventoryLocks";
import {
  InventoryReservationError,
  reserveInventoryRow,
} from "../lib/inventoryReservations";
import { isLottoDistribuibile } from "../lib/lottoPolicy";
import {
  effectiveBollaRigaId,
  fseDistributionNatureCondition,
  fseNetDistributedQuantity,
} from "../lib/reporting/fseCanonicalFacts";
import {
  auditContextFromRequest,
  auditFields,
  recordAuditEvent,
} from "../lib/auditEvent";
import {
  DocumentCommandError,
  commandRequestHash,
  findDocumentCommand,
  isDocumentCommandError,
  loadDocumentCommand,
  lockConsegnaBollaRelation,
  lockDocumentCommand,
  requireExpectedVersion,
  requireIdempotencyKey,
  storeDocumentCommand,
  validateDocumentCommand,
} from "../lib/documentCommand";
import { requireCurrentCommandActor } from "../lib/currentCommandActor";
import {
  loadTransportReturnDetail,
  reconcileTransportReturnTx,
  TransportReturnError,
  type ReturnLineInput,
} from "../lib/transportReturn";

const router: IRouter = Router();

router.use("/bolle", requireAllModuli(["MAGAZZINO_SOLIDALE", "BOLLE"]));

// stati che consentono ancora modifiche
const STATI_MODIFICABILI = ["bozza"];
const PRENOTAZIONE_ATTIVA = "attiva";
const PRENOTAZIONE_RILASCIATA = "rilasciata";
// Il dettaglio Bolla deve mostrare il lineage inventariale anche per l'Ente,
// senza promuovere CONSEGNA_ENTE a distribuzione sociale nei report FSE/DDC.
const bollaDeliveryNatureCondition = sql`(
  ${fseDistributionNatureCondition}
  OR mv.natura_contabile = 'CONSEGNA_ENTE'
  OR (mv.natura_contabile = 'STORNO'
    AND original.natura_contabile = 'CONSEGNA_ENTE')
)`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function commandEnvelope(
  body: unknown,
  withVersion: true,
): {
  idempotencyKey: string;
  expectedVersion: number;
};
function commandEnvelope(
  body: unknown,
  withVersion: false,
): {
  idempotencyKey: string;
};
function commandEnvelope(body: unknown, withVersion: boolean) {
  const value = (body ?? {}) as Record<string, unknown>;
  const idempotencyKey = requireIdempotencyKey(value.idempotencyKey);
  return withVersion
    ? {
        idempotencyKey,
        expectedVersion: requireExpectedVersion(value.versione),
      }
    : { idempotencyKey };
}

function sendDocumentCommandError(
  error: unknown,
  res: import("express").Response,
) {
  if (!isDocumentCommandError(error)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

async function canUseVolontarioConsegna(
  volontarioId: unknown,
  beneficiarioId: number,
): Promise<boolean> {
  const id = Number(volontarioId);
  if (!Number.isInteger(id)) return false;
  const centroBeneficiario = await beneficiarioCentroId(beneficiarioId);
  const [volontario] = await db
    .select({
      centroAscoltoId: volontariTable.centroAscoltoId,
      attivo: volontariTable.attivo,
      statoApprovazione: volontariTable.statoApprovazione,
    })
    .from(volontariTable)
    .where(eq(volontariTable.id, id));
  if (!volontario) return false;
  if (!volontario.attivo || volontario.statoApprovazione !== "approvato")
    return false;
  return canAccessCentro(volontario.centroAscoltoId, centroBeneficiario);
}

export async function buildDettaglio(id: number) {
  const [row] = await db
    .select({
      b: bolleTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      benefResidenza: beneficiariTable.residenza,
      benefDomicilio: beneficiariTable.domicilio,
      benefComune: beneficiariTable.comune,
      benefTelefono: beneficiariTable.telefono,
      enteDenominazione: entiDestinatariTable.denominazione,
      enteIndirizzo: entiDestinatariTable.indirizzo,
      enteTelefono: entiDestinatariTable.telefono,
      enteEmail: entiDestinatariTable.email,
      magazzinoNome: magazziniTable.nome,
      magazzinoIndirizzo: magazziniTable.indirizzo,
      magazzinoComune: magazziniTable.comune,
      volontarioNome: volontariTable.nome,
      volontarioCognome: volontariTable.cognome,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
    })
    .from(bolleTable)
    .leftJoin(
      beneficiariTable,
      eq(bolleTable.beneficiarioId, beneficiariTable.id),
    )
    .leftJoin(
      entiDestinatariTable,
      eq(bolleTable.enteDestinatarioId, entiDestinatariTable.id),
    )
    .leftJoin(magazziniTable, eq(bolleTable.magazzinoId, magazziniTable.id))
    .leftJoin(
      volontariTable,
      eq(bolleTable.volontarioConsegnaId, volontariTable.id),
    )
    .leftJoin(utentiTable, eq(bolleTable.operatoreId, utentiTable.id))
    .where(eq(bolleTable.id, id));

  if (!row) return null;

  // Dopo la conferma lo snapshot è la sola fonte autorevole, anche quando un
  // campo opzionale era intenzionalmente NULL. Il fallback live è riservato a
  // bozze e documenti legacy privi del marcatore esplicito.
  const enteSnapshotCongelato =
    row.b.tipoDestinatario === "ente" && row.b.destinatarioSnapshotCongelato;

  const righe = await db
    .select({
      r: bollaRigheTable,
      prodottoNome: prodottiTable.nome,
      codiceLotto: lottiTable.codiceLotto,
      fondoOrigine: lottiTable.fondoOrigine,
      lottoFsePlus: lottiTable.fsePlus,
    })
    .from(bollaRigheTable)
    .leftJoin(prodottiTable, eq(bollaRigheTable.prodottoId, prodottiTable.id))
    .leftJoin(lottiTable, eq(bollaRigheTable.lottoId, lottiTable.id))
    .where(eq(bollaRigheTable.bollaId, id));

  const righeFallbackEmporio =
    righe.length > 0
      ? []
      : await db
          .select({
            r: speseEmporioRigheTable,
            prodottoNome: prodottiTable.nome,
            codiceLotto: lottiTable.codiceLotto,
            fondoOrigine: lottiTable.fondoOrigine,
            lottoFsePlus: lottiTable.fsePlus,
          })
          .from(speseEmporioRigheTable)
          .innerJoin(
            speseEmporioTable,
            eq(speseEmporioRigheTable.spesaEmporioId, speseEmporioTable.id),
          )
          .leftJoin(
            prodottiTable,
            eq(speseEmporioRigheTable.prodottoId, prodottiTable.id),
          )
          .leftJoin(
            lottiTable,
            eq(speseEmporioRigheTable.lottoId, lottiTable.id),
          )
          .where(eq(speseEmporioTable.bollaId, id));

  const ripartizioniPrenotate = await db
    .select({
      rigaBollaId: prenotazioniMagazzinoTable.rigaBollaId,
      lottoId: prenotazioniMagazzinoTable.lottoId,
      codiceLotto: lottiTable.codiceLotto,
      fondoOrigine: lottiTable.fondoOrigine,
      quantita: prenotazioniMagazzinoTable.quantita,
    })
    .from(prenotazioniMagazzinoTable)
    .innerJoin(
      lottiTable,
      eq(prenotazioniMagazzinoTable.lottoId, lottiTable.id),
    )
    .where(eq(prenotazioniMagazzinoTable.bollaId, id))
    .orderBy(
      asc(prenotazioniMagazzinoTable.rigaBollaId),
      asc(prenotazioniMagazzinoTable.lottoId),
      asc(prenotazioniMagazzinoTable.id),
    );
  const ripartizioniPerRiga = new Map<
    number,
    Array<{
      lottoId: number;
      codiceLotto: string | null;
      fondoOrigine: string;
      quantita: number;
    }>
  >();
  for (const ripartizione of ripartizioniPrenotate) {
    if (ripartizione.rigaBollaId == null) continue;
    const current = ripartizioniPerRiga.get(ripartizione.rigaBollaId) ?? [];
    current.push({
      lottoId: ripartizione.lottoId,
      codiceLotto: ripartizione.codiceLotto ?? null,
      fondoOrigine: ripartizione.fondoOrigine,
      quantita: parseFloat(ripartizione.quantita),
    });
    ripartizioniPerRiga.set(ripartizione.rigaBollaId, current);
  }

  const provenanceResult = await db.execute(sql`
    SELECT ${effectiveBollaRigaId} AS bolla_riga_id,
           CASE WHEN mv.natura_contabile = 'STORNO'
             THEN COALESCE(original.fondo_origine, mv.fondo_origine, 'NESSUN_FONDO')
             ELSE COALESCE(mv.fondo_origine, 'NESSUN_FONDO')
           END AS fondo_origine,
           SUM(CASE WHEN mv.natura_contabile = 'STORNO'
             THEN 0 ELSE abs(mv.quantita::numeric) END) AS quantita_lorda,
           SUM(CASE WHEN mv.natura_contabile = 'STORNO'
             THEN abs(mv.quantita::numeric) ELSE 0 END) AS quantita_stornata,
           SUM(${fseNetDistributedQuantity(sql`mv.quantita`)}) AS quantita_netta
    FROM movimenti mv
    LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
    WHERE COALESCE(mv.bolla_id, original.bolla_id) = ${id}
      AND ${effectiveBollaRigaId} IS NOT NULL
      AND ${bollaDeliveryNatureCondition}
    GROUP BY ${effectiveBollaRigaId}, 2
  `);
  const provenance = new Map<
    number,
    {
      fse: number;
      nonFse: number;
      lorda: number;
      stornata: number;
      netta: number;
    }
  >();
  for (const movement of provenanceResult.rows as Array<
    Record<string, unknown>
  >) {
    const bollaRigaId = Number(movement.bolla_riga_id);
    if (!Number.isSafeInteger(bollaRigaId)) continue;
    const split = provenance.get(bollaRigaId) ?? {
      fse: 0,
      nonFse: 0,
      lorda: 0,
      stornata: 0,
      netta: 0,
    };
    const netta = Number(movement.quantita_netta ?? 0);
    if (movement.fondo_origine === "FSE_PLUS") split.fse += netta;
    else split.nonFse += netta;
    split.lorda += Number(movement.quantita_lorda ?? 0);
    split.stornata += Number(movement.quantita_stornata ?? 0);
    split.netta += netta;
    provenance.set(bollaRigaId, split);
  }

  return {
    id: row.b.id,
    numeroBolla: row.b.numeroBolla,
    dataBolla: row.b.dataBolla,
    tipoDestinatario: row.b.tipoDestinatario,
    areaOperativaIdSnapshot: row.b.areaOperativaIdSnapshot,
    beneficiarioId: row.b.beneficiarioId,
    beneficiarioNome:
      row.cognome && row.nome ? `${row.cognome} ${row.nome}` : null,
    enteDestinatarioId: row.b.enteDestinatarioId ?? null,
    destinatarioSnapshotCongelato: enteSnapshotCongelato,
    destinatarioSnapshotFonte: enteSnapshotCongelato
      ? "confermato"
      : row.b.tipoDestinatario === "ente"
        ? "legacy_live"
        : null,
    enteDestinatarioNome: enteSnapshotCongelato
      ? row.b.destinatarioNomeSnapshot
      : (row.enteDenominazione ?? row.b.destinatarioNomeSnapshot ?? null),
    enteDestinatarioIndirizzo: enteSnapshotCongelato
      ? row.b.destinatarioIndirizzoSnapshot
      : (row.enteIndirizzo ?? row.b.destinatarioIndirizzoSnapshot ?? null),
    enteDestinatarioTelefono: enteSnapshotCongelato
      ? row.b.destinatarioTelefonoSnapshot
      : (row.enteTelefono ?? row.b.destinatarioTelefonoSnapshot ?? null),
    enteDestinatarioEmail: enteSnapshotCongelato
      ? row.b.destinatarioEmailSnapshot
      : (row.enteEmail ?? row.b.destinatarioEmailSnapshot ?? null),
    consegnaId: row.b.consegnaId ?? null,
    daPianificazione: row.b.consegnaId != null,
    magazzinoId: row.b.magazzinoId,
    magazzinoNome: row.magazzinoNome ?? null,
    magazzinoIndirizzo: row.magazzinoIndirizzo ?? null,
    magazzinoComune: row.magazzinoComune ?? null,
    indirizzoConsegna: row.b.indirizzoConsegna ?? null,
    beneficiarioIndirizzo:
      row.benefDomicilio ?? row.benefResidenza ?? row.benefComune ?? null,
    beneficiarioTelefono: row.benefTelefono ?? null,
    volontarioConsegnaId: row.b.volontarioConsegnaId ?? null,
    volontarioNome:
      row.volontarioNome && row.volontarioCognome
        ? `${row.volontarioCognome} ${row.volontarioNome}`
        : null,
    trasportatoreNome: row.b.trasportatoreNome ?? null,
    mezzoId: row.b.mezzoId ?? null,
    mezzoAltro: row.b.mezzoAltro ?? false,
    stato: row.b.stato,
    noteConsegna: row.b.noteConsegna ?? null,
    confermaRicezione: row.b.confermaRicezione,
    noteRicezione: row.b.noteRicezione ?? null,
    ritiroNonEffettuatoAt: row.b.ritiroNonEffettuatoAt?.toISOString() ?? null,
    ritiroNonEffettuatoOperatoreId:
      row.b.ritiroNonEffettuatoOperatoreId ?? null,
    ritiroNonEffettuatoMotivo: row.b.ritiroNonEffettuatoMotivo ?? null,
    operatoreId: row.b.operatoreId ?? null,
    operatoreCodice: row.operatoreMatricola ?? row.operatoreUsername ?? null,
    motivoAnnullamento: row.b.motivoAnnullamento ?? null,
    motivoMancataConsegna: row.b.motivoMancataConsegna ?? null,
    versione: row.b.versione,
    dataCreazione: row.b.dataCreazione.toISOString(),
    righe:
      righe.length > 0
        ? righe.map((r) => {
            const split = provenance.get(r.r.id) ?? {
              fse: 0,
              nonFse: 0,
              lorda: 0,
              stornata: 0,
              netta: 0,
            };
            const hasCanonicalProvenance =
              split.lorda > 0 || split.stornata > 0;
            return {
              id: r.r.id,
              bollaId: r.r.bollaId,
              prodottoId: r.r.prodottoId,
              prodottoNome: r.prodottoNome ?? null,
              lottoId: r.r.lottoId ?? null,
              codiceLotto: r.codiceLotto ?? null,
              fondoOrigine: r.fondoOrigine ?? null,
              ripartizioniLotto:
                ripartizioniPerRiga.get(r.r.id) ??
                (r.r.lottoId != null
                  ? [
                      {
                        lottoId: r.r.lottoId,
                        codiceLotto: r.codiceLotto ?? null,
                        fondoOrigine: r.fondoOrigine ?? "NESSUN_FONDO",
                        quantita: parseFloat(r.r.quantita),
                      },
                    ]
                  : []),
              fsePlus: hasCanonicalProvenance
                ? split.fse > 0 && split.nonFse === 0
                : r.r.lottoId
                  ? !!r.lottoFsePlus
                  : false,
              fsePlusQuantita: split.fse,
              nonFsePlusQuantita: split.nonFse,
              quantitaLorda: split.lorda,
              quantitaStornata: split.stornata,
              quantitaNetta: split.netta,
              quantita: parseFloat(r.r.quantita),
              unitaMisura: r.r.unitaMisura,
              note: r.r.note ?? null,
            };
          })
        : righeFallbackEmporio.map((r) => {
            const effectiveRigaId = r.r.bollaRigaId ?? r.r.id;
            const split = provenance.get(effectiveRigaId) ?? {
              fse: 0,
              nonFse: 0,
              lorda: 0,
              stornata: 0,
              netta: 0,
            };
            const hasCanonicalProvenance =
              split.lorda > 0 || split.stornata > 0;
            return {
              id: effectiveRigaId,
              bollaId: id,
              prodottoId: r.r.prodottoId,
              prodottoNome: r.prodottoNome ?? r.r.descrizioneProdotto ?? null,
              lottoId: r.r.lottoId ?? null,
              codiceLotto: r.codiceLotto ?? null,
              fondoOrigine: r.fondoOrigine ?? null,
              ripartizioniLotto:
                ripartizioniPerRiga.get(effectiveRigaId) ??
                (r.r.lottoId != null
                  ? [
                      {
                        lottoId: r.r.lottoId,
                        codiceLotto: r.codiceLotto ?? null,
                        fondoOrigine: r.fondoOrigine ?? "NESSUN_FONDO",
                        quantita: parseFloat(r.r.quantita),
                      },
                    ]
                  : []),
              fsePlus: hasCanonicalProvenance
                ? split.fse > 0 && split.nonFse === 0
                : r.r.lottoId
                  ? !!r.lottoFsePlus
                  : false,
              fsePlusQuantita: split.fse,
              nonFsePlusQuantita: split.nonFse,
              quantitaLorda: split.lorda,
              quantitaStornata: split.stornata,
              quantitaNetta: split.netta,
              quantita: parseFloat(r.r.quantita),
              unitaMisura: r.r.unitaMisura,
              note: "Riga da Spesa Emporio",
            };
          }),
  };
}

/** Calcola giacenza disponibile per un prodotto in un magazzino */
async function giacenzaDisponibile(
  prodottoId: number,
  magazzinoId: number,
): Promise<InventoryDecimal> {
  const result = await calcolaDisponibilitaMagazzino(prodottoId, magazzinoId);
  const value = InventoryDecimal.parse(result.disponibileRealePrecisa, {
    allowNegative: true,
  });
  return value.isNegative() ? InventoryDecimal.zero() : value;
}

/** Calcola quanto è già in bolla (bozza) per un prodotto */
async function quantitaGiaInBolla(
  bollaId: number,
  prodottoId: number,
  excludeRigaId?: number,
): Promise<InventoryDecimal> {
  const righe = await db
    .select({ q: bollaRigheTable.quantita, id: bollaRigheTable.id })
    .from(bollaRigheTable)
    .where(
      and(
        eq(bollaRigheTable.bollaId, bollaId),
        eq(bollaRigheTable.prodottoId, prodottoId),
      ),
    );
  return righe
    .filter((r) => r.id !== excludeRigaId)
    .reduce(
      (total, r) => total.add(InventoryDecimal.parse(r.q)),
      InventoryDecimal.zero(),
    );
}

/** Calcola quanto è già in bolla (bozza) per uno specifico lotto */
async function quantitaGiaInBollaLotto(
  bollaId: number,
  lottoId: number,
): Promise<InventoryDecimal> {
  const righe = await db
    .select({ q: bollaRigheTable.quantita })
    .from(bollaRigheTable)
    .where(
      and(
        eq(bollaRigheTable.bollaId, bollaId),
        eq(bollaRigheTable.lottoId, lottoId),
      ),
    );
  return righe.reduce(
    (total, r) => total.add(InventoryDecimal.parse(r.q)),
    InventoryDecimal.zero(),
  );
}

export async function canAccessBollaOperativa(
  bolla: Pick<
    typeof bolleTable.$inferSelect,
    | "tipoDestinatario"
    | "beneficiarioId"
    | "magazzinoId"
    | "areaOperativaIdSnapshot"
  >,
  caller: number | null,
  areaOperativaId: number | null,
  zonaUdsId: number | null,
): Promise<boolean> {
  if (bolla.tipoDestinatario === "beneficiario") {
    if (bolla.beneficiarioId == null) return false;
    if (
      !canAccessCentro(
        await beneficiarioCentroId(bolla.beneficiarioId),
        caller,
      ) ||
      !canAccessAreaOperativa(
        await beneficiarioAreaOperativaId(bolla.beneficiarioId),
        areaOperativaId,
      ) ||
      !canAccessZonaUds(
        await beneficiarioZonaUdsId(bolla.beneficiarioId),
        zonaUdsId,
      )
    )
      return false;
  }
  if (bolla.tipoDestinatario === "ente") {
    if (!canAccessAreaOperativa(bolla.areaOperativaIdSnapshot, areaOperativaId))
      return false;
    // Una sessione UDS priva di Area non ha uno scope territoriale utile
    // per un Ente: fail closed, senza inferire una Zona sull'anagrafica Ente.
    if (zonaUdsId != null && areaOperativaId == null) return false;
  }

  const visibili = await visibleMagazzinoIds(caller, areaOperativaId);
  return visibili == null || visibili.includes(bolla.magazzinoId);
}

/**
 * Variante transazionale usata dai comandi: blocca e rivalida lo scope
 * corrente prima di consultare una ricevuta idempotente.
 */
export async function canAccessBollaOperativaTx(
  tx: Tx,
  bolla: Pick<
    typeof bolleTable.$inferSelect,
    | "tipoDestinatario"
    | "beneficiarioId"
    | "magazzinoId"
    | "areaOperativaIdSnapshot"
  >,
  caller: number | null,
  areaOperativaId: number | null,
  zonaUdsId: number | null,
): Promise<boolean> {
  if (bolla.tipoDestinatario === "beneficiario") {
    if (bolla.beneficiarioId == null) return false;
    const [beneficiario] = await tx
      .select({
        centroAscoltoId: beneficiariTable.centroAscoltoId,
        areaOperativaId: beneficiariTable.areaOperativaId,
        zonaUdsId: beneficiariTable.zonaUdsId,
      })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, bolla.beneficiarioId))
      .for("share");
    if (
      !beneficiario ||
      !canAccessBeneficiarioScope(beneficiario, {
        centroAscoltoId: caller,
        areaOperativaId,
        zonaUdsId,
      })
    ) {
      return false;
    }
  } else if (bolla.tipoDestinatario === "ente") {
    if (!canAccessAreaOperativa(bolla.areaOperativaIdSnapshot, areaOperativaId))
      return false;
    if (zonaUdsId != null && areaOperativaId == null) return false;
  } else {
    return false;
  }

  const [magazzino] = await tx
    .select({
      centroAscoltoId: magazziniTable.centroAscoltoId,
      areaOperativaId: magazziniTable.areaOperativaId,
    })
    .from(magazziniTable)
    .where(eq(magazziniTable.id, bolla.magazzinoId))
    .for("share");
  return Boolean(
    magazzino &&
    canAccessCentro(magazzino.centroAscoltoId, caller) &&
    canAccessAreaOperativa(magazzino.areaOperativaId, areaOperativaId),
  );
}

async function productName(prodottoId: number): Promise<string> {
  const [prod] = await db
    .select({ nome: prodottiTable.nome })
    .from(prodottiTable)
    .where(eq(prodottiTable.id, prodottoId));
  return prod?.nome ?? `prodotto #${prodottoId}`;
}

async function prenotaRigaFEFO(
  tx: Tx,
  bolla: typeof bolleTable.$inferSelect,
  riga: typeof bollaRigheTable.$inferSelect,
): Promise<void> {
  try {
    const { firstLotId } = await reserveInventoryRow(tx, {
      bollaId: bolla.id,
      rigaBollaId: riga.id,
      prodottoId: riga.prodottoId,
      magazzinoId: bolla.magazzinoId,
      lottoId: riga.lottoId,
      quantita: riga.quantita,
    });
    if (riga.lottoId == null) {
      await tx
        .update(bollaRigheTable)
        .set({ lottoId: firstLotId })
        .where(eq(bollaRigheTable.id, riga.id));
    }
  } catch (error) {
    if (error instanceof InventoryReservationError) {
      throw new BollaActionError(error.status, error.message);
    }
    throw error;
  }
}

// ─── LIST ────────────────────────────────────────────────────────────────────

router.get("/bolle", requirePermission("bolle.view"), async (req, res) => {
  const { stato, magazzinoId, centroAscoltoId } = req.query as Record<
    string,
    string
  >;
  const page = req.query.page == null ? 1 : Number(req.query.page);
  const limit = req.query.limit == null ? 50 : Number(req.query.limit);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    res
      .status(400)
      .json({ error: "Paginazione non valida: page >= 1 e limit tra 1 e 100" });
    return;
  }
  const conditions: SQL[] = [];
  if (stato) conditions.push(eq(bolleTable.stato, stato));
  if (magazzinoId) {
    const mid = Number(magazzinoId);
    if (!Number.isInteger(mid)) {
      res.status(400).json({ error: "magazzinoId non valido" });
      return;
    }
    conditions.push(eq(bolleTable.magazzinoId, mid));
  }
  const caller = callerCentroId(req);
  const callerArea = callerAreaOperativaId(req);
  const visibleWarehouses = await visibleMagazzinoIds(caller, callerArea);
  const warehouseFilter = magazzinoScopeFilter(
    bolleTable.magazzinoId,
    visibleWarehouses,
  );
  if (warehouseFilter) conditions.push(warehouseFilter);
  if (caller != null) {
    conditions.push(
      or(
        and(
          eq(bolleTable.tipoDestinatario, "beneficiario"),
          or(
            eq(beneficiariTable.centroAscoltoId, caller),
            isNull(beneficiariTable.centroAscoltoId),
          ),
        ),
        and(
          eq(bolleTable.tipoDestinatario, "ente"),
          visibleWarehouses?.length
            ? inArray(bolleTable.magazzinoId, visibleWarehouses)
            : sql`false`,
        ),
      )!,
    );
  } else if (centroAscoltoId) {
    const cid = Number(centroAscoltoId);
    if (!Number.isInteger(cid)) {
      res.status(400).json({ error: "centroAscoltoId non valido" });
      return;
    }
    conditions.push(eq(beneficiariTable.centroAscoltoId, cid));
  }
  if (callerArea != null)
    conditions.push(
      or(
        and(
          eq(bolleTable.tipoDestinatario, "beneficiario"),
          eq(beneficiariTable.areaOperativaId, callerArea),
        ),
        and(
          eq(bolleTable.tipoDestinatario, "ente"),
          eq(bolleTable.areaOperativaIdSnapshot, callerArea),
        ),
      )!,
    );
  const zonaId = callerZonaUdsId(req);
  if (zonaId != null) {
    conditions.push(
      or(
        callerArea != null
          ? eq(bolleTable.tipoDestinatario, "ente")
          : sql`false`,
        and(
          eq(bolleTable.tipoDestinatario, "beneficiario"),
          eq(beneficiariTable.zonaUdsId, zonaId),
        ),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(bolleTable)
    .leftJoin(
      beneficiariTable,
      eq(bolleTable.beneficiarioId, beneficiariTable.id),
    )
    .where(where);
  const rows = await db
    .select({
      b: bolleTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      enteDenominazione: entiDestinatariTable.denominazione,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      magazzinoNome: magazziniTable.nome,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
    })
    .from(bolleTable)
    .leftJoin(
      beneficiariTable,
      eq(bolleTable.beneficiarioId, beneficiariTable.id),
    )
    .leftJoin(
      entiDestinatariTable,
      eq(bolleTable.enteDestinatarioId, entiDestinatariTable.id),
    )
    .leftJoin(
      centriAscoltoTable,
      eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .leftJoin(magazziniTable, eq(bolleTable.magazzinoId, magazziniTable.id))
    .leftJoin(utentiTable, eq(bolleTable.operatoreId, utentiTable.id))
    .where(where)
    .orderBy(desc(bolleTable.dataCreazione))
    .limit(limit)
    .offset((page - 1) * limit);

  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(limit));
  res.json(
    rows.map((r) => ({
      id: r.b.id,
      numeroBolla: r.b.numeroBolla,
      dataBolla: r.b.dataBolla,
      tipoDestinatario: r.b.tipoDestinatario,
      beneficiarioId: r.b.beneficiarioId,
      beneficiarioNome: r.cognome && r.nome ? `${r.cognome} ${r.nome}` : null,
      enteDestinatarioId: r.b.enteDestinatarioId ?? null,
      destinatarioSnapshotCongelato:
        r.b.tipoDestinatario === "ente" && r.b.destinatarioSnapshotCongelato,
      destinatarioSnapshotFonte:
        r.b.tipoDestinatario !== "ente"
          ? null
          : r.b.destinatarioSnapshotCongelato
            ? "confermato"
            : "legacy_live",
      enteDestinatarioNome:
        r.b.tipoDestinatario === "ente" && r.b.destinatarioSnapshotCongelato
          ? r.b.destinatarioNomeSnapshot
          : (r.enteDenominazione ?? r.b.destinatarioNomeSnapshot ?? null),
      consegnaId: r.b.consegnaId ?? null,
      daPianificazione: r.b.consegnaId != null,
      magazzinoId: r.b.magazzinoId,
      magazzinoNome: r.magazzinoNome ?? null,
      centroAscoltoId: r.centroAscoltoId ?? null,
      centroAscoltoNome: r.centroAscoltoNome ?? null,
      indirizzoConsegna: r.b.indirizzoConsegna ?? null,
      volontarioConsegnaId: r.b.volontarioConsegnaId ?? null,
      trasportatoreNome: r.b.trasportatoreNome ?? null,
      mezzoId: r.b.mezzoId ?? null,
      mezzoAltro: r.b.mezzoAltro ?? false,
      stato: r.b.stato,
      noteConsegna: r.b.noteConsegna ?? null,
      confermaRicezione: r.b.confermaRicezione,
      noteRicezione: r.b.noteRicezione ?? null,
      ritiroNonEffettuatoAt: r.b.ritiroNonEffettuatoAt?.toISOString() ?? null,
      ritiroNonEffettuatoOperatoreId:
        r.b.ritiroNonEffettuatoOperatoreId ?? null,
      ritiroNonEffettuatoMotivo: r.b.ritiroNonEffettuatoMotivo ?? null,
      operatoreId: r.b.operatoreId ?? null,
      operatoreCodice: r.operatoreMatricola ?? r.operatoreUsername ?? null,
      motivoAnnullamento: r.b.motivoAnnullamento ?? null,
      motivoMancataConsegna: r.b.motivoMancataConsegna ?? null,
      versione: r.b.versione,
      dataCreazione: r.b.dataCreazione.toISOString(),
    })),
  );
});

// ─── CREATE ──────────────────────────────────────────────────────────────────

router.post("/bolle", requirePermission("bolle.manage"), async (req, res) => {
  const body = { ...req.body };
  let idempotencyKey: string;
  try {
    ({ idempotencyKey } = commandEnvelope(body, false));
  } catch (error) {
    if (sendDocumentCommandError(error, res)) return;
    if (handleBollaActionError(error, res)) return;
    throw error;
  }
  const tipoComando = "BOLLA_CREA";
  const accepted = new Set([
    "idempotencyKey",
    "tipoDestinatario",
    "beneficiarioId",
    "enteDestinatarioId",
    "consegnaId",
    "magazzinoId",
    "dataBolla",
    "indirizzoConsegna",
    "volontarioConsegnaId",
    "trasportatoreNome",
    "mezzoId",
    "mezzoAltro",
    "noteConsegna",
  ]);
  const serverManaged = [
    "numeroBolla",
    "stato",
    "operatoreId",
    "confermaRicezione",
    "noteRicezione",
    "firmaNota",
    "ritiroNonEffettuatoAt",
    "ritiroNonEffettuatoOperatoreId",
    "ritiroNonEffettuatoMotivo",
  ];
  const forbidden = serverManaged.filter((key) => key in body);
  if (forbidden.length > 0) {
    res.status(400).json({
      error: `Campi gestiti dal server non accettati: ${forbidden.join(", ")}`,
    });
    return;
  }
  const unsupported = Object.keys(body).filter((key) => !accepted.has(key));
  if (unsupported.length > 0) {
    res
      .status(400)
      .json({ error: `Campi Bolla non supportati: ${unsupported.join(", ")}` });
    return;
  }
  const tipoDestinatario = body.tipoDestinatario ?? "beneficiario";
  const isBeneficiario = tipoDestinatario === "beneficiario";
  const isEnte = tipoDestinatario === "ente";
  if (
    (!isBeneficiario && !isEnte) ||
    (isBeneficiario &&
      (!Number.isInteger(body.beneficiarioId) ||
        body.beneficiarioId <= 0 ||
        body.enteDestinatarioId != null)) ||
    (isEnte &&
      (!Number.isInteger(body.enteDestinatarioId) ||
        body.enteDestinatarioId <= 0 ||
        body.beneficiarioId != null ||
        body.consegnaId != null)) ||
    !Number.isInteger(body.magazzinoId) ||
    body.magazzinoId <= 0
  ) {
    res
      .status(400)
      .json({ error: "Destinatario tipizzato e Magazzino non validi" });
    return;
  }
  const requestHash = commandRequestHash({
    tipoDestinatario,
    beneficiarioId: isBeneficiario ? body.beneficiarioId : null,
    enteDestinatarioId: isEnte ? body.enteDestinatarioId : null,
    consegnaId: body.consegnaId ?? null,
    magazzinoId: body.magazzinoId,
    dataBolla: body.dataBolla ?? null,
    indirizzoConsegna: body.indirizzoConsegna ?? null,
    volontarioConsegnaId: body.volontarioConsegnaId ?? null,
    trasportatoreNome: body.trasportatoreNome ?? null,
    mezzoId: body.mezzoId ?? null,
    mezzoAltro: body.mezzoAltro === true,
    noteConsegna: body.noteConsegna ?? null,
  });
  const caller = callerCentroId(req);
  const cid = callerAreaOperativaId(req);
  const zid = callerZonaUdsId(req);
  if (
    isBeneficiario &&
    (caller != null || cid != null || zid != null) &&
    !(await canUseBeneficiario(body.beneficiarioId, caller, cid, zid))
  ) {
    res
      .status(403)
      .json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }
  if ((caller != null || cid != null) && body.magazzinoId != null) {
    const visibili = await visibleMagazzinoIds(caller, cid);
    if (visibili != null && !visibili.includes(body.magazzinoId)) {
      res
        .status(403)
        .json({ error: "Magazzino non accessibile per il tuo centro" });
      return;
    }
  }
  const [magazzino] = await db
    .select()
    .from(magazziniTable)
    .where(eq(magazziniTable.id, body.magazzinoId));
  if (!magazzino) {
    res.status(404).json({ error: "Magazzino non trovato" });
    return;
  }
  const centroBeneficiarioId = isBeneficiario
    ? await beneficiarioCentroId(body.beneficiarioId)
    : null;
  const [ente] = isEnte
    ? await db
        .select()
        .from(entiDestinatariTable)
        .where(eq(entiDestinatariTable.id, body.enteDestinatarioId))
    : [null];
  if (isEnte && !ente) {
    res.status(400).json({ error: "Ente destinatario non trovato" });
    return;
  }
  if (ente && ente.areaOperativaId !== magazzino.areaOperativaId) {
    res.status(400).json({
      error: "Ente e Magazzino devono appartenere alla stessa Area Operativa",
    });
    return;
  }

  // Fast-path di replay dopo i controlli autorizzativi sul destinatario e sul
  // magazzino. Il lock viene ripreso nella transazione dell'effetto per
  // serializzare anche due prime richieste concorrenti.
  try {
    const replay = await db.transaction(async (tx) => {
      await lockDocumentCommand(tx, tipoComando, idempotencyKey);
      const receipt = await loadDocumentCommand(tx, {
        tipoComando,
        idempotencyKey,
      });
      if (!receipt) return null;
      const replayBolla = await lockBolla(tx, receipt.aggregatoId);
      if (
        !(await canAccessBollaOperativaTx(tx, replayBolla, caller, cid, zid))
      ) {
        throw new BollaActionError(
          403,
          "Risorsa non accessibile per il tuo centro",
        );
      }
      return validateDocumentCommand(receipt, {
        tipoComando,
        idempotencyKey,
        requestHash,
        actorUserId: req.user!.id,
        aggregatoTipo: "bolla",
      });
    });
    if (replay) {
      const detail = await buildDettaglio(replay.aggregatoId);
      if (!detail) throw new Error("COMMAND_RECEIPT_ENTITY_NOT_FOUND");
      if (!(await canAccessBollaOperativa(detail, caller, cid, zid))) {
        res
          .status(403)
          .json({ error: "Risorsa non accessibile per il tuo centro" });
        return;
      }
      res.json(detail);
      return;
    }
  } catch (error) {
    if (sendDocumentCommandError(error, res)) return;
    if (handleBollaActionError(error, res)) return;
    throw error;
  }
  // La ricevuta viene consultata dopo RBAC e scope correnti, ma prima delle
  // regole di operatività: un retry autentico deve poter ritrovare il comando
  // già concluso anche se nel frattempo il destinatario o il deposito sono
  // stati disattivati.
  if (isBeneficiario && !(await isBeneficiarioActive(body.beneficiarioId))) {
    res.status(400).json({
      error: "Il Beneficiario deve essere attivo per creare una nuova Bolla.",
    });
    return;
  }
  if (magazzino.stato !== "attivo") {
    res.status(400).json({ error: "Il Magazzino selezionato non è attivo" });
    return;
  }
  if (ente && !ente.attivo) {
    res.status(400).json({ error: "L'Ente destinatario deve essere attivo" });
    return;
  }
  if (body.volontarioConsegnaId != null && body.trasportatoreNome != null) {
    res.status(400).json({
      error:
        "Indicare un volontario OPPURE un trasportatore esterno, non entrambi",
    });
    return;
  }
  if (isBeneficiario && body.consegnaId != null) {
    const [consegna] = await db
      .select()
      .from(consegneTable)
      .where(eq(consegneTable.id, body.consegnaId));
    if (!consegna) {
      res.status(400).json({ error: "Consegna non trovata" });
      return;
    }
    if (consegna.beneficiarioId !== body.beneficiarioId) {
      res.status(400).json({
        error:
          "La bolla deve appartenere allo stesso beneficiario della consegna",
      });
      return;
    }
    const collegate = await db
      .select({ stato: bolleTable.stato })
      .from(bolleTable)
      .where(eq(bolleTable.consegnaId, body.consegnaId));
    if (collegate.some((b) => b.stato !== "annullato")) {
      res.status(400).json({ error: "La consegna ha già una bolla associata" });
      return;
    }
    if (body.volontarioConsegnaId == null && !body.trasportatoreNome) {
      if (consegna.volontarioId != null)
        body.volontarioConsegnaId = consegna.volontarioId;
      else if (consegna.volontarioAltro)
        body.trasportatoreNome = consegna.volontarioAltro;
    }
    if (body.mezzoId == null && body.mezzoAltro == null) {
      if (consegna.mezzoId != null) body.mezzoId = consegna.mezzoId;
      else if (consegna.mezzoAltro) body.mezzoAltro = true;
    }
    if (!body.indirizzoConsegna && consegna.indirizzoConsegna) {
      body.indirizzoConsegna = consegna.indirizzoConsegna;
    }
  }
  if (
    isBeneficiario &&
    body.volontarioConsegnaId != null &&
    !(await canUseVolontarioConsegna(
      body.volontarioConsegnaId,
      body.beneficiarioId,
    ))
  ) {
    res
      .status(403)
      .json({ error: "Volontario non accessibile per il centro della bolla" });
    return;
  }
  if (body.dataBolla != null && !isDateOnly(body.dataBolla)) {
    res.status(400).json({ error: "Data Bolla non valida" });
    return;
  }
  const dataBolla = body.dataBolla ?? dataCivileEuropeRome(new Date());
  const audit = auditContextFromRequest(req);
  let result: { id: number; replay: boolean };
  try {
    result = await db.transaction(async (tx) => {
      await lockDocumentCommand(tx, tipoComando, idempotencyKey);
      const receipt = await loadDocumentCommand(tx, {
        tipoComando,
        idempotencyKey,
      });
      if (receipt) {
        const replayBolla = await lockBolla(tx, receipt.aggregatoId);
        if (
          !(await canAccessBollaOperativaTx(tx, replayBolla, caller, cid, zid))
        ) {
          throw new BollaActionError(
            403,
            "Risorsa non accessibile per il tuo centro",
          );
        }
        const replay = validateDocumentCommand(receipt, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
        });
        return { id: replay.aggregatoId, replay: true };
      }
      if (isBeneficiario && body.consegnaId != null) {
        await lockConsegnaBollaRelation(tx, body.consegnaId);
        const linkedIds = await tx
          .select({ id: bolleTable.id })
          .from(bolleTable)
          .where(
            and(
              eq(bolleTable.consegnaId, body.consegnaId),
              ne(bolleTable.stato, "annullato"),
            ),
          )
          .orderBy(asc(bolleTable.id));
        if (linkedIds.length > 0) {
          await tx
            .select({ id: bolleTable.id })
            .from(bolleTable)
            .where(
              inArray(
                bolleTable.id,
                linkedIds.map((row) => row.id),
              ),
            )
            .orderBy(asc(bolleTable.id))
            .for("update");
        }
        const [lockedConsegna] = await tx
          .select()
          .from(consegneTable)
          .where(eq(consegneTable.id, body.consegnaId))
          .for("update");
        if (
          !lockedConsegna ||
          lockedConsegna.tipoPianificazione !== "consegna_pacco"
        ) {
          throw new BollaActionError(409, "La Consegna non esiste più");
        }
        if (lockedConsegna.stato !== "pianificata") {
          throw new BollaActionError(
            409,
            "Una Consegna conclusa non può ricevere una nuova Bolla",
          );
        }
        if (lockedConsegna.beneficiarioId !== body.beneficiarioId) {
          throw new BollaActionError(
            409,
            "La Bolla e la Consegna non appartengono più allo stesso Beneficiario",
          );
        }
        if (linkedIds.length > 0) {
          throw new BollaActionError(
            409,
            "La Consegna ha già una Bolla operativa associata",
          );
        }
      }
      let lockedBeneficiario: typeof beneficiariTable.$inferSelect | null =
        null;
      if (isBeneficiario) {
        [lockedBeneficiario] = await tx
          .select()
          .from(beneficiariTable)
          .where(eq(beneficiariTable.id, body.beneficiarioId))
          .for("update");
        if (
          !lockedBeneficiario ||
          !lockedBeneficiario.attivo ||
          !canAccessBeneficiarioScope(lockedBeneficiario, {
            centroAscoltoId: caller,
            areaOperativaId: cid,
            zonaUdsId: zid,
          })
        ) {
          throw new BollaActionError(
            lockedBeneficiario ? 403 : 409,
            "Il Beneficiario non è più attivo o accessibile",
          );
        }
      }
      const [lockedMagazzino] = await tx
        .select()
        .from(magazziniTable)
        .where(eq(magazziniTable.id, body.magazzinoId))
        .for("update");
      if (!lockedMagazzino || lockedMagazzino.stato !== "attivo") {
        throw new BollaActionError(
          409,
          "Il Magazzino selezionato non è più operativo",
        );
      }
      if (isEnte) {
        const [lockedEnte] = await tx
          .select()
          .from(entiDestinatariTable)
          .where(eq(entiDestinatariTable.id, body.enteDestinatarioId))
          .for("update");
        if (
          !lockedEnte ||
          !lockedEnte.attivo ||
          lockedEnte.areaOperativaId !== lockedMagazzino.areaOperativaId
        ) {
          throw new BollaActionError(
            409,
            "L'Ente destinatario non è più attivo o coerente con il Magazzino",
          );
        }
      }
      if (isBeneficiario && body.volontarioConsegnaId != null) {
        const [lockedVolontario] = await tx
          .select({
            centroAscoltoId: volontariTable.centroAscoltoId,
            attivo: volontariTable.attivo,
            statoApprovazione: volontariTable.statoApprovazione,
          })
          .from(volontariTable)
          .where(eq(volontariTable.id, body.volontarioConsegnaId))
          .for("update");
        if (
          !lockedVolontario ||
          !lockedVolontario.attivo ||
          lockedVolontario.statoApprovazione !== "approvato" ||
          !canAccessCentro(
            lockedVolontario.centroAscoltoId,
            lockedBeneficiario?.centroAscoltoId ?? null,
          )
        ) {
          throw new BollaActionError(
            409,
            "Il Volontario non è più utilizzabile per questa Bolla",
          );
        }
      }
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('bolle.numero_bolla'))`,
      );
      const anno = Number(dataBolla.slice(0, 4));
      const existing = await tx
        .select({ n: bolleTable.numeroBolla })
        .from(bolleTable)
        .where(sql`${bolleTable.numeroBolla} like ${`BOLLA-${anno}-%`}`)
        .orderBy(desc(bolleTable.id))
        .limit(1);
      const lastNum =
        existing.length > 0 ? Number(existing[0].n.split("-").pop() ?? 0) : 0;
      const numeroBolla = `BOLLA-${anno}-${String(lastNum + 1).padStart(4, "0")}`;
      const [created] = await tx
        .insert(bolleTable)
        .values({
          numeroBolla,
          dataBolla,
          tipoDestinatario,
          beneficiarioId: isBeneficiario ? body.beneficiarioId : null,
          enteDestinatarioId: isEnte ? body.enteDestinatarioId : null,
          consegnaId: body.consegnaId ?? null,
          magazzinoId: body.magazzinoId,
          indirizzoConsegna: body.indirizzoConsegna ?? null,
          volontarioConsegnaId: body.volontarioConsegnaId ?? null,
          trasportatoreNome: body.trasportatoreNome ?? null,
          mezzoId: body.mezzoId ?? null,
          mezzoAltro: body.mezzoAltro === true,
          noteConsegna: body.noteConsegna ?? null,
          stato: "bozza",
          operatoreId: req.user!.id,
          // Per il Beneficiario gli snapshot reporting vengono determinati e
          // validati atomicamente alla consegna. Un Centro legacy senza Area non
          // può essere congelato da solo (trigger di coerenza Area/Centro).
          areaOperativaIdSnapshot: isEnte
            ? lockedMagazzino.areaOperativaId
            : null,
          centroAscoltoIdSnapshot: null,
          // L'anagrafica resta live finché il documento è in bozza. I valori
          // autorevoli vengono congelati atomicamente dalla conferma.
          destinatarioNomeSnapshot: null,
          destinatarioIndirizzoSnapshot: null,
          destinatarioTelefonoSnapshot: null,
          destinatarioEmailSnapshot: null,
          destinatarioSnapshotCongelato: false,
        })
        .returning();
      await recordAuditEvent(tx, {
        command: {
          ...audit,
          operationKey: `m4a:${tipoComando}:${idempotencyKey}`,
        },
        azione: "BOLLA_CREATA",
        entitaTipo: "bolla",
        entitaId: created.id,
        documentoTipo: "bolla",
        documentoId: created.id,
        areaOperativaIdSnapshot: lockedMagazzino.areaOperativaId,
        centroAscoltoIdSnapshot:
          lockedBeneficiario?.centroAscoltoId ?? centroBeneficiarioId,
        magazzinoIdSnapshot: created.magazzinoId,
        dataOperativa: created.dataBolla,
        changes: auditFields({ statoNuovo: "bozza" }, ["statoNuovo"]),
      });
      await storeDocumentCommand(tx, {
        tipoComando,
        idempotencyKey,
        requestHash,
        aggregatoTipo: "bolla",
        aggregatoId: created.id,
        versioneRisultante: created.versione,
        resultSnapshot: { id: created.id, versione: created.versione },
        actorUserId: req.user!.id,
      });
      return { id: created.id, replay: false };
    });
  } catch (error) {
    if (sendDocumentCommandError(error, res)) return;
    if (handleBollaActionError(error, res)) return;
    throw error;
  }
  const det = await buildDettaglio(result.id);
  if (!det) throw new Error("BOLLA_CREATED_BUT_NOT_FOUND");
  if (!(await canAccessBollaOperativa(det, caller, cid, zid))) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.status(result.replay ? 200 : 201).json(det);
});

// ─── GET BY ID ───────────────────────────────────────────────────────────────

router.get(
  "/bolle/:id/righe",
  requirePermission("bolle.view"),
  async (req, res) => {
    const det = await buildDettaglio(Number(req.params.id));
    if (!det) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (
      !(await canAccessBollaOperativa(
        det,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }
    res.json(det.righe);
  },
);

router.get("/bolle/:id", requirePermission("bolle.view"), async (req, res) => {
  const det = await buildDettaglio(Number(req.params.id));
  if (!det) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (
    !(await canAccessBollaOperativa(
      det,
      callerCentroId(req),
      callerAreaOperativaId(req),
      callerZonaUdsId(req),
    ))
  ) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.json(det);
});

// ─── UPDATE (magazzino/beneficiario/volontario) ──────────────────────────────

router.patch(
  "/bolle/:id",
  requirePermission("bolle.manage"),
  async (req, res) => {
    const bollaId = Number(req.params.id);
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    if (!bolla) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const caller = callerCentroId(req);
    const cid = callerAreaOperativaId(req);
    const zid = callerZonaUdsId(req);
    if (!(await canAccessBollaOperativa(bolla, caller, cid, zid))) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }

    const rawBody = { ...req.body };
    let idempotencyKey: string;
    let expectedVersion: number;
    try {
      ({ idempotencyKey, expectedVersion } = commandEnvelope(rawBody, true));
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      if (handleBollaActionError(error, res)) return;
      throw error;
    }
    const { idempotencyKey: _key, versione: _version, ...body } = rawBody;
    const tipoComando = "BOLLA_MODIFICA";
    const requestHash = commandRequestHash({
      id: bollaId,
      versione: expectedVersion,
      body,
    });
    const allowed = new Set([
      "beneficiarioId",
      "magazzinoId",
      "indirizzoConsegna",
      "volontarioConsegnaId",
      "trasportatoreNome",
      "mezzoId",
      "mezzoAltro",
      "noteConsegna",
      "dataBolla",
    ]);
    const unsupported = Object.keys(body).filter((key) => !allowed.has(key));
    if (unsupported.length > 0) {
      res.status(400).json({
        error: `Campi non modificabili dal PATCH Bolla: ${unsupported.join(", ")}`,
      });
      return;
    }
    try {
      const replay = await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const current = await lockBolla(tx, bollaId);
        if (!(await canAccessBollaOperativaTx(tx, current, caller, cid, zid))) {
          throw new BollaActionError(
            403,
            "Risorsa non accessibile per il tuo centro",
          );
        }
        return findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
      });
      if (replay) {
        const detail = await buildDettaglio(bollaId);
        if (!detail) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        if (!(await canAccessBollaOperativa(detail, caller, cid, zid))) {
          res
            .status(403)
            .json({ error: "Risorsa non accessibile per il tuo centro" });
          return;
        }
        res.json(detail);
        return;
      }
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      if (handleBollaActionError(error, res)) return;
      throw error;
    }
    if (bolla.stato !== "bozza") {
      res.status(409).json({
        error:
          "Una Bolla confermata o consegnata non è modificabile; usa le azioni dedicate",
      });
      return;
    }
    if (bolla.tipoDestinatario === "ente" && "beneficiarioId" in body) {
      res.status(400).json({
        error:
          "Il tipo destinatario è immutabile; annullare la bozza e crearne una nuova",
      });
      return;
    }
    if (body.dataBolla != null && !isDateOnly(body.dataBolla)) {
      res.status(400).json({ error: "Data Bolla non valida" });
      return;
    }
    if (
      ("beneficiarioId" in body &&
        (!Number.isInteger(body.beneficiarioId) || body.beneficiarioId <= 0)) ||
      ("magazzinoId" in body &&
        (!Number.isInteger(body.magazzinoId) || body.magazzinoId <= 0)) ||
      (body.volontarioConsegnaId != null &&
        (!Number.isInteger(body.volontarioConsegnaId) ||
          body.volontarioConsegnaId <= 0))
    ) {
      res.status(400).json({ error: "Riferimento Bolla non valido" });
      return;
    }
    if (
      bolla.tipoDestinatario === "beneficiario" &&
      (caller != null || cid != null || zid != null) &&
      body.beneficiarioId != null &&
      body.beneficiarioId !== bolla.beneficiarioId &&
      !(await canUseBeneficiario(body.beneficiarioId, caller, cid, zid))
    ) {
      res
        .status(403)
        .json({ error: "Beneficiario non accessibile per il tuo centro" });
      return;
    }

    // trasportatore: volontario OPPURE nome esterno, mai entrambi (coerente col POST e con la UI)
    const nextVolontario =
      body.volontarioConsegnaId !== undefined
        ? body.volontarioConsegnaId
        : bolla.volontarioConsegnaId;
    const nextTrasportatore =
      body.trasportatoreNome !== undefined
        ? body.trasportatoreNome
        : bolla.trasportatoreNome;
    if (nextVolontario != null && nextTrasportatore != null) {
      res.status(400).json({
        error:
          "Indicare un volontario OPPURE un trasportatore esterno, non entrambi",
      });
      return;
    }
    if (
      bolla.tipoDestinatario === "beneficiario" &&
      (body.volontarioConsegnaId !== undefined ||
        body.beneficiarioId !== undefined) &&
      nextVolontario != null &&
      !(await canUseVolontarioConsegna(
        nextVolontario,
        body.beneficiarioId ?? bolla.beneficiarioId,
      ))
    ) {
      res.status(403).json({
        error: "Volontario non accessibile per il centro della bolla",
      });
      return;
    }

    // cambio magazzino: consentito solo in bozza (nessuno scarico ancora effettuato).
    // Le righe esistenti fanno riferimento alle giacenze/lotti del vecchio magazzino,
    // quindi vengono rimosse: l'utente le ri-seleziona dal nuovo magazzino.
    if (body.magazzinoId && body.magazzinoId !== bolla.magazzinoId) {
      if (caller != null || cid != null) {
        const visibili = await visibleMagazzinoIds(caller, cid);
        if (visibili != null && !visibili.includes(body.magazzinoId)) {
          res
            .status(403)
            .json({ error: "Magazzino non accessibile per il tuo centro" });
          return;
        }
      }
      if (bolla.stato !== "bozza") {
        res.status(400).json({
          error: "Il magazzino si può cambiare solo quando la bolla è in bozza",
        });
        return;
      }
      const [targetMagazzino] = await db
        .select()
        .from(magazziniTable)
        .where(eq(magazziniTable.id, body.magazzinoId));
      if (!targetMagazzino) {
        res.status(404).json({ error: "Magazzino non trovato" });
        return;
      }
      if (targetMagazzino.stato !== "attivo") {
        res
          .status(400)
          .json({ error: "Il Magazzino selezionato non è attivo" });
        return;
      }
    }

    let row: typeof bolleTable.$inferSelect;
    try {
      row = await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        if (bolla.consegnaId != null) {
          await lockConsegnaBollaRelation(tx, bolla.consegnaId);
        }
        const current = await lockBolla(tx, bollaId);
        if (current.consegnaId !== bolla.consegnaId) {
          throw new DocumentCommandError(
            409,
            "L'associazione della Bolla è cambiata; ricaricare i dati",
          );
        }
        let lockedConsegna: Pick<
          typeof consegneTable.$inferSelect,
          "beneficiarioId"
        > | null = null;
        if (current.consegnaId != null) {
          const [candidateConsegna] = await tx
            .select({ beneficiarioId: consegneTable.beneficiarioId })
            .from(consegneTable)
            .where(eq(consegneTable.id, current.consegnaId))
            .for("update");
          lockedConsegna = candidateConsegna ?? null;
        }
        if (!(await canAccessBollaOperativaTx(tx, current, caller, cid, zid))) {
          throw new BollaActionError(
            403,
            "Risorsa non accessibile per il tuo centro",
          );
        }
        const replay = await findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
        if (replay) return current;
        if (current.versione !== expectedVersion) {
          throw new DocumentCommandError(
            409,
            "Versione non aggiornata; ricaricare i dati",
          );
        }
        if (current.stato !== "bozza") {
          throw new BollaActionError(
            409,
            "Una Bolla confermata o consegnata non è modificabile",
          );
        }
        const nextMagazzinoId = body.magazzinoId ?? current.magazzinoId;
        const nextBeneficiarioId =
          body.beneficiarioId ?? current.beneficiarioId;
        const nextVolontarioId =
          body.volontarioConsegnaId !== undefined
            ? body.volontarioConsegnaId
            : current.volontarioConsegnaId;
        const nextTrasportatoreNome =
          body.trasportatoreNome !== undefined
            ? body.trasportatoreNome
            : current.trasportatoreNome;
        if (nextVolontarioId != null && nextTrasportatoreNome != null) {
          throw new BollaActionError(
            400,
            "Indicare un volontario OPPURE un trasportatore esterno, non entrambi",
          );
        }
        let lockedBeneficiario: typeof beneficiariTable.$inferSelect | null =
          null;
        if (current.tipoDestinatario === "beneficiario") {
          if (nextBeneficiarioId == null) {
            throw new BollaActionError(409, "Beneficiario non valido");
          }
          [lockedBeneficiario] = await tx
            .select()
            .from(beneficiariTable)
            .where(eq(beneficiariTable.id, nextBeneficiarioId))
            .for("update");
          if (
            !lockedBeneficiario ||
            !lockedBeneficiario.attivo ||
            !canAccessBeneficiarioScope(lockedBeneficiario, {
              centroAscoltoId: caller,
              areaOperativaId: cid,
              zonaUdsId: zid,
            })
          ) {
            throw new BollaActionError(
              lockedBeneficiario ? 403 : 409,
              "Il Beneficiario non è più attivo o accessibile",
            );
          }
          if (
            current.consegnaId != null &&
            (!lockedConsegna ||
              lockedConsegna.beneficiarioId !== nextBeneficiarioId)
          ) {
            throw new BollaActionError(
              409,
              "La Bolla deve mantenere il Beneficiario della Consegna collegata",
            );
          }
        }
        const [lockedMagazzino] = await tx
          .select()
          .from(magazziniTable)
          .where(eq(magazziniTable.id, nextMagazzinoId))
          .for("update");
        if (!lockedMagazzino || lockedMagazzino.stato !== "attivo") {
          throw new BollaActionError(
            409,
            "Il Magazzino selezionato non è più operativo",
          );
        }
        const magazziniVisibili = await visibleMagazzinoIds(caller, cid);
        if (
          magazziniVisibili != null &&
          !magazziniVisibili.includes(lockedMagazzino.id)
        ) {
          throw new BollaActionError(
            403,
            "Magazzino non accessibile per il tuo centro",
          );
        }

        let areaOperativaIdSnapshot = current.areaOperativaIdSnapshot;
        if (current.tipoDestinatario === "ente") {
          const [lockedEnte] = await tx
            .select()
            .from(entiDestinatariTable)
            .where(eq(entiDestinatariTable.id, current.enteDestinatarioId!))
            .for("update");
          if (
            !lockedEnte ||
            !lockedEnte.attivo ||
            lockedEnte.areaOperativaId !== lockedMagazzino.areaOperativaId
          ) {
            throw new BollaActionError(
              409,
              "L'Ente destinatario non è più attivo o coerente con il Magazzino",
            );
          }
          areaOperativaIdSnapshot = lockedEnte.areaOperativaId;
        } else {
          if (nextVolontarioId != null) {
            const [lockedVolontario] = await tx
              .select({
                centroAscoltoId: volontariTable.centroAscoltoId,
                attivo: volontariTable.attivo,
                statoApprovazione: volontariTable.statoApprovazione,
              })
              .from(volontariTable)
              .where(eq(volontariTable.id, nextVolontarioId))
              .for("update");
            if (
              !lockedVolontario ||
              !lockedVolontario.attivo ||
              lockedVolontario.statoApprovazione !== "approvato" ||
              !canAccessCentro(
                lockedVolontario.centroAscoltoId,
                lockedBeneficiario!.centroAscoltoId,
              )
            ) {
              throw new BollaActionError(
                409,
                "Il Volontario non è più utilizzabile per questa Bolla",
              );
            }
          }
        }
        if (nextMagazzinoId !== current.magazzinoId) {
          await tx
            .delete(bollaRigheTable)
            .where(eq(bollaRigheTable.bollaId, bollaId));
        }
        const [updated] = await tx
          .update(bolleTable)
          .set({
            ...body,
            areaOperativaIdSnapshot,
            operatoreId: req.user!.id,
            versione: sql`${bolleTable.versione} + 1`,
          })
          .where(eq(bolleTable.id, bollaId))
          .returning();
        await recordAuditEvent(tx, {
          command: auditContextFromRequest(req, {
            operationKey: `m4a:${tipoComando}:${idempotencyKey}`,
          }),
          azione: "BOLLA_MODIFICATA",
          entitaTipo: "bolla",
          entitaId: bollaId,
          documentoTipo: "bolla",
          documentoId: bollaId,
          areaOperativaIdSnapshot: updated.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: updated.centroAscoltoIdSnapshot,
          magazzinoIdSnapshot: updated.magazzinoId,
          dataOperativa: updated.dataBolla,
          changes: auditFields(
            {
              versionePrecedente: current.versione,
              versioneNuova: updated.versione,
            },
            ["versionePrecedente", "versioneNuova"],
          ),
        });
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
          versioneRichiesta: expectedVersion,
          versioneRisultante: updated.versione,
          resultSnapshot: { id: bollaId, versione: updated.versione },
          actorUserId: req.user!.id,
        });
        return updated;
      });
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      if (handleBollaActionError(error, res)) return;
      throw error;
    }

    const det = await buildDettaglio(row.id);
    res.json(det);
  },
);

// ─── RIGHE — ADD ─────────────────────────────────────────────────────────────

router.post(
  "/bolle/:id/righe",
  requirePermission("bolle.manage"),
  async (req, res) => {
    const bollaId = Number(req.params.id);

    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    if (!bolla) {
      res.status(404).json({ error: "Bolla non trovata" });
      return;
    }
    if (
      !(await canAccessBollaOperativa(
        bolla,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }
    let idempotencyKey: string;
    let expectedVersion: number;
    try {
      ({ idempotencyKey, expectedVersion } = commandEnvelope(req.body, true));
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      if (handleBollaActionError(error, res)) return;
      throw error;
    }
    const { prodottoId, lottoId, quantita, unitaMisura, note } = req.body ?? {};
    const tipoComando = "BOLLA_RIGA_AGGIUNGI";
    if (!Number.isInteger(prodottoId) || prodottoId <= 0) {
      res.status(400).json({ error: "Prodotto non valido" });
      return;
    }
    if (lottoId != null && (!Number.isInteger(lottoId) || lottoId <= 0)) {
      res.status(400).json({ error: "Lotto non valido" });
      return;
    }
    const [prod] = await db
      .select()
      .from(prodottiTable)
      .where(eq(prodottiTable.id, prodottoId));
    if (!prod) {
      res.status(400).json({ error: "Prodotto non trovato" });
      return;
    }
    if (unitaMisura != null && unitaMisura !== prod.unitaMisura) {
      res.status(400).json({
        error: "L'unità di misura deve coincidere con quella del Catalogo",
      });
      return;
    }
    let quantitaContabile: InventoryDecimal;
    try {
      quantitaContabile = validateProductOperationalQuantity({
        quantita,
        quantitaFrazionabile: prod.quantitaFrazionabile,
        prodottoLabel: prod.nome,
      });
    } catch (error) {
      if (error instanceof ProductOperationalQuantityError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
    const requestHash = commandRequestHash({
      bollaId,
      versione: expectedVersion,
      prodottoId,
      lottoId: lottoId ?? null,
      quantita: quantitaContabile.toCanonical(),
      unitaMisura: prod.unitaMisura,
      note: note ?? null,
    });
    try {
      const replay = await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const current = await lockBolla(tx, bollaId);
        if (
          !(await canAccessBollaOperativaTx(
            tx,
            current,
            callerCentroId(req),
            callerAreaOperativaId(req),
            callerZonaUdsId(req),
          ))
        ) {
          throw new BollaActionError(
            403,
            "Risorsa non accessibile per il tuo centro",
          );
        }
        return findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
      });
      if (replay) {
        res.json(replay.resultSnapshot);
        return;
      }
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      if (handleBollaActionError(error, res)) return;
      throw error;
    }
    if (!STATI_MODIFICABILI.includes(bolla.stato)) {
      res.status(400).json({
        error: "Le righe della bolla sono modificabili solo in stato bozza",
      });
      return;
    }
    if (!prod.attivo) {
      res.status(400).json({ error: "Prodotto non trovato o non attivo" });
      return;
    }

    if (lottoId != null) {
      const [lotto] = await db
        .select()
        .from(lottiTable)
        .where(
          and(
            eq(lottiTable.id, lottoId),
            eq(lottiTable.magazzinoId, bolla.magazzinoId),
          ),
        );
      if (!lotto) {
        res
          .status(404)
          .json({ error: "Lotto non trovato per il Magazzino della Bolla" });
        return;
      }
      if (lotto.prodottoId !== prodottoId) {
        res.status(400).json({
          error: "Il lotto selezionato non appartiene al prodotto richiesto",
        });
        return;
      }
      if (!isLottoDistribuibile(lotto.dataScadenza)) {
        res.status(409).json({
          error: "Il lotto selezionato è scaduto e non può essere distribuito",
        });
        return;
      }
      const giaInBollaLotto =
        bolla.stato === "bozza"
          ? await quantitaGiaInBollaLotto(bollaId, lottoId)
          : InventoryDecimal.zero();
      const [impegno] = await db
        .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
        .from(prenotazioniMagazzinoTable)
        .where(
          and(
            eq(prenotazioniMagazzinoTable.lottoId, lottoId),
            eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
          ),
        );
      const nettaLotto = InventoryDecimal.parse(lotto.quantitaResidua)
        .subtract(InventoryDecimal.parse(impegno?.totale ?? "0"))
        .subtract(giaInBollaLotto);
      if (nettaLotto.compare(quantitaContabile) < 0) {
        res.status(400).json({
          error: `Disponibilità insufficiente nel lotto: ${(nettaLotto.isNegative() ? InventoryDecimal.zero() : nettaLotto).toCanonical()} disponibili, richiesti ${quantitaContabile.toCanonical()}`,
        });
        return;
      }
    } else {
      const disponibile = await giacenzaDisponibile(
        prodottoId,
        bolla.magazzinoId,
      );
      const giainBolla =
        bolla.stato === "bozza"
          ? await quantitaGiaInBolla(bollaId, prodottoId)
          : InventoryDecimal.zero();
      const netta = disponibile.subtract(giainBolla);
      if (netta.compare(quantitaContabile) < 0) {
        res.status(400).json({
          error: `Disponibilità insufficiente per ${prod?.nome ?? "prodotto"}: ${(netta.isNegative() ? InventoryDecimal.zero() : netta).toCanonical()} disponibili (giacenza ${disponibile.toCanonical()} − già in bolla ${giainBolla.toCanonical()}), richiesti ${quantitaContabile.toCanonical()}`,
        });
        return;
      }
    }

    try {
      const result = await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const current = await lockBolla(tx, bollaId);
        if (
          !(await canAccessBollaOperativaTx(
            tx,
            current,
            callerCentroId(req),
            callerAreaOperativaId(req),
            callerZonaUdsId(req),
          ))
        ) {
          throw new BollaActionError(
            403,
            "Risorsa non accessibile per il tuo centro",
          );
        }
        const replay = await findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
        if (replay) return { snapshot: replay.resultSnapshot, replay: true };
        if (current.versione !== expectedVersion) {
          throw new DocumentCommandError(
            409,
            "Versione non aggiornata; ricaricare i dati",
          );
        }
        if (!STATI_MODIFICABILI.includes(current.stato)) {
          throw new BollaActionError(
            409,
            "Le righe della bolla sono modificabili solo in stato bozza",
          );
        }
        const [riga] = await tx
          .insert(bollaRigheTable)
          .values({
            bollaId,
            prodottoId,
            lottoId: lottoId ?? null,
            quantita: quantitaContabile.toDb(),
            unitaMisura: unitaMisura ?? prod?.unitaMisura ?? "pz",
            note: note ?? null,
          })
          .returning();
        const lotto = riga.lottoId
          ? (
              await tx
                .select()
                .from(lottiTable)
                .where(eq(lottiTable.id, riga.lottoId))
            )[0]
          : null;
        const [updated] = await tx
          .update(bolleTable)
          .set({
            operatoreId: req.user!.id,
            versione: sql`${bolleTable.versione} + 1`,
          })
          .where(eq(bolleTable.id, bollaId))
          .returning();
        const snapshot = {
          id: riga.id,
          bollaId: riga.bollaId,
          prodottoId: riga.prodottoId,
          prodottoNome: prod?.nome ?? null,
          lottoId: riga.lottoId ?? null,
          codiceLotto: lotto?.codiceLotto ?? null,
          fsePlus: riga.lottoId ? !!lotto?.fsePlus : !!prod?.fsePlus,
          quantita: parseFloat(riga.quantita),
          unitaMisura: riga.unitaMisura,
          note: riga.note ?? null,
          versioneBolla: updated.versione,
        };
        await recordAuditEvent(tx, {
          command: auditContextFromRequest(req, {
            operationKey: `m4a:${tipoComando}:${idempotencyKey}`,
          }),
          azione: "BOLLA_RIGA_AGGIUNTA",
          entitaTipo: "bolla",
          entitaId: bollaId,
          documentoTipo: "bolla",
          documentoId: bollaId,
          areaOperativaIdSnapshot: current.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: current.centroAscoltoIdSnapshot,
          magazzinoIdSnapshot: current.magazzinoId,
          dataOperativa: current.dataBolla,
          metadata: auditFields({ rigaId: riga.id }, ["rigaId"]),
        });
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
          versioneRichiesta: expectedVersion,
          versioneRisultante: updated.versione,
          resultSnapshot: snapshot,
          actorUserId: req.user!.id,
        });
        return { snapshot, replay: false };
      });
      res.status(result.replay ? 200 : 201).json(result.snapshot);
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      if (handleBollaActionError(error, res)) return;
      throw error;
    }
  },
);

// ─── RIGHE — DELETE ───────────────────────────────────────────────────────────

router.delete(
  "/bolle/:id/righe/:rigaId",
  requirePermission("bolle.manage"),
  async (req, res) => {
    const bollaId = Number(req.params.id);
    const rigaId = Number(req.params.rigaId);

    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    if (!bolla) {
      res.status(404).json({ error: "Bolla non trovata" });
      return;
    }
    if (
      !(await canAccessBollaOperativa(
        bolla,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }
    let idempotencyKey: string;
    let expectedVersion: number;
    try {
      ({ idempotencyKey, expectedVersion } = commandEnvelope(req.body, true));
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      throw error;
    }
    const tipoComando = "BOLLA_RIGA_ELIMINA";
    const requestHash = commandRequestHash({
      bollaId,
      rigaId,
      versione: expectedVersion,
    });
    try {
      const replay = await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const current = await lockBolla(tx, bollaId);
        if (
          !(await canAccessBollaOperativaTx(
            tx,
            current,
            callerCentroId(req),
            callerAreaOperativaId(req),
            callerZonaUdsId(req),
          ))
        ) {
          throw new BollaActionError(
            403,
            "Risorsa non accessibile per il tuo centro",
          );
        }
        return findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
      });
      if (replay) {
        res.status(204).end();
        return;
      }
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      if (handleBollaActionError(error, res)) return;
      throw error;
    }
    if (!STATI_MODIFICABILI.includes(bolla.stato)) {
      res.status(400).json({
        error: "Le righe della bolla sono modificabili solo in stato bozza",
      });
      return;
    }

    const [riga] = await db
      .select()
      .from(bollaRigheTable)
      .where(
        and(
          eq(bollaRigheTable.id, rigaId),
          eq(bollaRigheTable.bollaId, bollaId),
        ),
      );
    if (!riga) {
      res.status(404).json({ error: "Riga non trovata" });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const current = await lockBolla(tx, bollaId);
        if (
          !(await canAccessBollaOperativaTx(
            tx,
            current,
            callerCentroId(req),
            callerAreaOperativaId(req),
            callerZonaUdsId(req),
          ))
        ) {
          throw new BollaActionError(
            403,
            "Risorsa non accessibile per il tuo centro",
          );
        }
        const replay = await findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
        if (replay) return;
        if (current.versione !== expectedVersion) {
          throw new DocumentCommandError(
            409,
            "Versione non aggiornata; ricaricare i dati",
          );
        }
        if (!STATI_MODIFICABILI.includes(current.stato)) {
          throw new BollaActionError(
            409,
            "Le righe della bolla sono modificabili solo in stato bozza",
          );
        }
        const [lockedRiga] = await tx
          .select()
          .from(bollaRigheTable)
          .where(
            and(
              eq(bollaRigheTable.id, rigaId),
              eq(bollaRigheTable.bollaId, bollaId),
            ),
          )
          .for("update");
        if (!lockedRiga) {
          throw new BollaActionError(404, "Riga non trovata");
        }
        await tx.delete(bollaRigheTable).where(eq(bollaRigheTable.id, rigaId));
        const [updated] = await tx
          .update(bolleTable)
          .set({
            operatoreId: req.user!.id,
            versione: sql`${bolleTable.versione} + 1`,
          })
          .where(eq(bolleTable.id, bollaId))
          .returning();
        await recordAuditEvent(tx, {
          command: auditContextFromRequest(req, {
            operationKey: `m4a:${tipoComando}:${idempotencyKey}`,
          }),
          azione: "BOLLA_RIGA_ELIMINATA",
          entitaTipo: "bolla",
          entitaId: bollaId,
          documentoTipo: "bolla",
          documentoId: bollaId,
          areaOperativaIdSnapshot: current.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: current.centroAscoltoIdSnapshot,
          magazzinoIdSnapshot: current.magazzinoId,
          dataOperativa: current.dataBolla,
          metadata: auditFields({ rigaId }, ["rigaId"]),
        });
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
          versioneRichiesta: expectedVersion,
          versioneRisultante: updated.versione,
          resultSnapshot: {
            id: bollaId,
            rigaId,
            eliminata: true,
            versione: updated.versione,
          },
          actorUserId: req.user!.id,
        });
      });
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      if (handleBollaActionError(error, res)) return;
      throw error;
    }

    res.status(204).end();
  },
);

// ─── CONFERMA (bozza → confermato + prenotazione FEFO) ───────────────────────

router.post(
  "/bolle/:id/conferma",
  requirePermission("bolle.deliver"),
  async (req, res) => {
    const bollaId = Number(req.params.id);

    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    if (!bolla) {
      res.status(404).json({ error: "Bolla non trovata" });
      return;
    }
    if (
      !(await canAccessBollaOperativa(
        bolla,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }

    let idempotencyKey: string;
    let expectedVersion: number;
    try {
      ({ idempotencyKey, expectedVersion } = commandEnvelope(req.body, true));
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      throw error;
    }
    const tipoComando = "BOLLA_CONFERMA";
    const requestHash = commandRequestHash({
      bollaId,
      versione: expectedVersion,
    });

    try {
      const audit = auditContextFromRequest(req, {
        operationKey: `m4a:${tipoComando}:${idempotencyKey}`,
      });
      await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const current = await lockBolla(tx, bollaId);
        if (
          !(await canAccessBollaOperativaTx(
            tx,
            current,
            callerCentroId(req),
            callerAreaOperativaId(req),
            callerZonaUdsId(req),
          ))
        ) {
          throw new BollaActionError(
            403,
            "Risorsa non accessibile per il tuo centro",
          );
        }
        const replay = await findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
        if (replay) return;
        if (current.versione !== expectedVersion) {
          throw new DocumentCommandError(
            409,
            "Versione non aggiornata; ricaricare i dati",
          );
        }
        await requireOperationalMagazzino(tx, current.magazzinoId);
        if (current.stato !== "bozza") {
          throw new BollaActionError(400, "La bolla non è in stato bozza");
        }

        const righe = await tx
          .select()
          .from(bollaRigheTable)
          .where(eq(bollaRigheTable.bollaId, bollaId))
          .orderBy(asc(bollaRigheTable.id));
        if (righe.length === 0) {
          throw new BollaActionError(
            400,
            "Impossibile confermare una bolla senza prodotti",
          );
        }

        await lockInventoryLotsInGlobalOrder(tx, {
          kind: "warehouse-products",
          magazzinoId: current.magazzinoId,
          prodottoIds: righe.map((riga) => riga.prodottoId),
        });

        for (const riga of righe) {
          await prenotaRigaFEFO(tx, current, riga);
        }

        const [enteDaCongelare] =
          current.tipoDestinatario === "ente" &&
          current.enteDestinatarioId != null
            ? await tx
                .select({
                  denominazione: entiDestinatariTable.denominazione,
                  indirizzo: entiDestinatariTable.indirizzo,
                  telefono: entiDestinatariTable.telefono,
                  email: entiDestinatariTable.email,
                  areaOperativaId: entiDestinatariTable.areaOperativaId,
                  attivo: entiDestinatariTable.attivo,
                })
                .from(entiDestinatariTable)
                .where(eq(entiDestinatariTable.id, current.enteDestinatarioId))
                .for("update")
            : [];

        if (
          current.tipoDestinatario === "ente" &&
          (!enteDaCongelare ||
            !enteDaCongelare.attivo ||
            enteDaCongelare.areaOperativaId !== current.areaOperativaIdSnapshot)
        ) {
          throw new BollaActionError(
            409,
            "L'Ente destinatario non è più attivo o coerente con l'Area della Bolla",
          );
        }

        const [updated] = await tx
          .update(bolleTable)
          .set({
            stato: "confermato",
            operatoreId: req.user!.id,
            versione: sql`${bolleTable.versione} + 1`,
            ...(current.tipoDestinatario === "ente"
              ? {
                  destinatarioNomeSnapshot: enteDaCongelare!.denominazione,
                  destinatarioIndirizzoSnapshot: enteDaCongelare!.indirizzo,
                  destinatarioTelefonoSnapshot: enteDaCongelare!.telefono,
                  destinatarioEmailSnapshot: enteDaCongelare!.email,
                  destinatarioSnapshotCongelato: true,
                }
              : {}),
          })
          .where(eq(bolleTable.id, bollaId))
          .returning();
        await recordAuditEvent(tx, {
          command: audit,
          azione: "BOLLA_CONFERMATA",
          entitaTipo: "bolla",
          entitaId: current.id,
          documentoTipo: "bolla",
          documentoId: current.id,
          areaOperativaIdSnapshot: current.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: current.centroAscoltoIdSnapshot,
          magazzinoIdSnapshot: current.magazzinoId,
          dataOperativa: current.dataBolla,
          changes: auditFields(
            { statoPrecedente: current.stato, statoNuovo: "confermato" },
            ["statoPrecedente", "statoNuovo"],
          ),
          metadata: auditFields({ numeroRighe: righe.length }, ["numeroRighe"]),
        });
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
          versioneRichiesta: expectedVersion,
          versioneRisultante: updated.versione,
          resultSnapshot: {
            id: bollaId,
            stato: updated.stato,
            versione: updated.versione,
          },
          actorUserId: req.user!.id,
        });
      });
    } catch (err) {
      if (handleBollaActionError(err, res)) return;
      if (err instanceof InventoryLedgerError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }

    const det = await buildDettaglio(bollaId);
    res.json(det);
  },
);

// ─── CONSEGNA (confermato → consegnato) ──────────────────────────────────────

async function assertBollaTransportAccessTx(
  tx: Tx,
  req: import("express").Request,
  bolla: typeof bolleTable.$inferSelect,
  permission: string,
) {
  const actor = await requireCurrentCommandActor(tx, req.user!.id, permission);
  if (
    !(await canAccessBollaOperativaTx(
      tx,
      bolla,
      actor.centroAscoltoId,
      actor.areaOperativaId,
      actor.zonaUdsId,
    ))
  ) {
    throw new BollaActionError(
      403,
      "Risorsa non accessibile per il tuo centro",
    );
  }
  return actor;
}

router.post(
  "/bolle/:id/affida",
  requirePermission("bolle.deliver"),
  async (req, res) => {
    const bollaId = Number(req.params.id);
    if (!Number.isSafeInteger(bollaId) || bollaId <= 0) {
      res.status(400).json({ error: "ID Bolla non valido" });
      return;
    }
    let idempotencyKey: string;
    let expectedVersion: number;
    try {
      ({ idempotencyKey, expectedVersion } = commandEnvelope(req.body, true));
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      throw error;
    }
    const trasportatoreNome =
      typeof req.body?.trasportatoreNome === "string"
        ? req.body.trasportatoreNome.trim()
        : null;
    if (
      trasportatoreNome != null &&
      (!trasportatoreNome || trasportatoreNome.length > 120)
    ) {
      res.status(400).json({
        error: "Indicare un incaricato valido (massimo 120 caratteri)",
      });
      return;
    }
    const tipoComando = "BOLLA_AFFIDA";
    const requestHash = commandRequestHash({
      bollaId,
      versione: expectedVersion,
      trasportatoreNome,
    });
    try {
      await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const [beforeLock] = await tx
          .select({ consegnaId: bolleTable.consegnaId })
          .from(bolleTable)
          .where(eq(bolleTable.id, bollaId));
        if (beforeLock?.consegnaId != null) {
          await lockConsegnaBollaRelation(tx, beforeLock.consegnaId);
        }
        const current = await lockBolla(tx, bollaId);
        if (current.consegnaId !== (beforeLock?.consegnaId ?? null)) {
          throw new BollaActionError(
            409,
            "La pianificazione è cambiata; ricaricare i dati",
          );
        }
        await assertBollaTransportAccessTx(tx, req, current, "bolle.deliver");
        const receipt = await findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
        if (receipt) return;
        if (current.versione !== expectedVersion)
          throw new DocumentCommandError(
            409,
            "Versione non aggiornata; ricaricare i dati",
          );
        if (current.stato !== "confermato")
          throw new BollaActionError(
            409,
            "Solo una Bolla pronta può essere affidata",
          );
        if (
          current.tipoDestinatario === "ente" &&
          !current.destinatarioSnapshotCongelato
        ) {
          throw new BollaActionError(
            409,
            "Lo snapshot del destinatario non è congelato",
          );
        }
        const existingName = current.trasportatoreNome?.trim() || null;
        if (current.volontarioConsegnaId != null && existingName) {
          throw new BollaActionError(
            409,
            "La Bolla ha già due incaricati; correggere il documento",
          );
        }
        if (current.volontarioConsegnaId != null && trasportatoreNome) {
          throw new BollaActionError(
            400,
            "Indicare un volontario OPPURE un trasportatore esterno, non entrambi",
          );
        }
        if (
          existingName &&
          trasportatoreNome &&
          trasportatoreNome !== existingName
        ) {
          throw new BollaActionError(
            400,
            "L'incaricato già assegnato non può essere cambiato in Affida",
          );
        }
        if (
          current.volontarioConsegnaId == null &&
          !existingName &&
          !trasportatoreNome
        ) {
          throw new BollaActionError(
            400,
            "Indicare il trasportatore o incaricato",
          );
        }
        await requireOperationalMagazzino(tx, current.magazzinoId);
        const dataMovimento = dataCivileEuropeRome(new Date());
        const auditEventoId = await recordAuditEvent(tx, {
          command: auditContextFromRequest(req, {
            operationKey: `m4b2:${tipoComando}:${idempotencyKey}`,
          }),
          azione: "BOLLA_AFFIDATA",
          entitaTipo: "bolla",
          entitaId: bollaId,
          documentoTipo: "bolla",
          documentoId: bollaId,
          areaOperativaIdSnapshot: current.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: current.centroAscoltoIdSnapshot,
          magazzinoIdSnapshot: current.magazzinoId,
          dataOperativa: dataMovimento,
          changes: auditFields(
            { statoPrecedente: current.stato, statoNuovo: "in_trasporto" },
            ["statoPrecedente", "statoNuovo"],
          ),
        });
        const count = await convertiPrenotazioniAttiveInScarico(tx, current, {
          dataMovimento,
          operatoreId: req.user!.id,
          auditEventoId,
          mode: "affidamento",
        });
        if (count === 0)
          throw new BollaActionError(
            409,
            "Nessuna prenotazione attiva da affidare",
          );
        const [updated] = await tx
          .update(bolleTable)
          .set({
            stato: "in_trasporto",
            trasportatoreNome:
              current.volontarioConsegnaId != null
                ? null
                : existingName
                  ? current.trasportatoreNome
                  : trasportatoreNome,
            operatoreId: req.user!.id,
            versione: current.versione + 1,
          })
          .where(eq(bolleTable.id, bollaId))
          .returning();
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
          versioneRichiesta: expectedVersion,
          versioneRisultante: updated.versione,
          resultSnapshot: {
            id: bollaId,
            stato: updated.stato,
            versione: updated.versione,
          },
          actorUserId: req.user!.id,
        });
      });
    } catch (error) {
      if (handleBollaActionError(error, res)) return;
      if (error instanceof InventoryLedgerError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
    res.json(await buildDettaglio(bollaId));
  },
);

router.post(
  "/bolle/:id/mancata-consegna",
  requirePermission("bolle.deliver"),
  async (req, res) => {
    const bollaId = Number(req.params.id);
    const motivo =
      typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    if (!motivo || motivo.length > 500) {
      res
        .status(400)
        .json({ error: "Motivo obbligatorio (massimo 500 caratteri)" });
      return;
    }
    let idempotencyKey: string;
    let expectedVersion: number;
    try {
      ({ idempotencyKey, expectedVersion } = commandEnvelope(req.body, true));
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      throw error;
    }
    const tipoComando = "BOLLA_MANCATA_CONSEGNA";
    const requestHash = commandRequestHash({
      bollaId,
      versione: expectedVersion,
      motivo,
    });
    try {
      await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const current = await lockBolla(tx, bollaId);
        await assertBollaTransportAccessTx(tx, req, current, "bolle.deliver");
        const receipt = await findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
        if (receipt) return;
        if (current.versione !== expectedVersion)
          throw new DocumentCommandError(
            409,
            "Versione non aggiornata; ricaricare i dati",
          );
        if (current.stato !== "in_trasporto")
          throw new BollaActionError(409, "La Bolla non è in consegna");
        const dataOperativa = dataCivileEuropeRome(new Date());
        await recordAuditEvent(tx, {
          command: auditContextFromRequest(req, {
            operationKey: `m4b2:${tipoComando}:${idempotencyKey}`,
          }),
          azione: "BOLLA_MANCATA_CONSEGNA",
          entitaTipo: "bolla",
          entitaId: bollaId,
          documentoTipo: "bolla",
          documentoId: bollaId,
          areaOperativaIdSnapshot: current.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: current.centroAscoltoIdSnapshot,
          magazzinoIdSnapshot: current.magazzinoId,
          dataOperativa,
          motivo,
          changes: auditFields(
            { statoPrecedente: current.stato, statoNuovo: "rientro_atteso" },
            ["statoPrecedente", "statoNuovo"],
          ),
        });
        const [updated] = await tx
          .update(bolleTable)
          .set({
            stato: "rientro_atteso",
            motivoMancataConsegna: motivo,
            operatoreId: req.user!.id,
            versione: current.versione + 1,
          })
          .where(eq(bolleTable.id, bollaId))
          .returning();
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
          versioneRichiesta: expectedVersion,
          versioneRisultante: updated.versione,
          resultSnapshot: {
            id: bollaId,
            stato: updated.stato,
            versione: updated.versione,
          },
          actorUserId: req.user!.id,
        });
      });
    } catch (error) {
      if (handleBollaActionError(error, res)) return;
      throw error;
    }
    res.json(await buildDettaglio(bollaId));
  },
);

router.get(
  "/bolle/:id/rientro",
  requirePermission("bolle.view"),
  async (req, res) => {
    const id = Number(req.params.id);
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, id));
    if (!bolla) {
      res.status(404).json({ error: "Bolla non trovata" });
      return;
    }
    if (
      !(await canAccessBollaOperativa(
        bolla,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }
    res.json(
      await db.transaction(async (tx) =>
        loadTransportReturnDetail(
          tx,
          {
            tipo: "bolla",
            id,
            magazzinoOrigineId: bolla.magazzinoId,
            numeroDocumento: bolla.numeroBolla,
          },
          bolla.stato,
        ),
      ),
    );
  },
);

router.post(
  "/bolle/:id/rientro",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    const bollaId = Number(req.params.id);
    let idempotencyKey: string;
    let expectedVersion: number;
    try {
      ({ idempotencyKey, expectedVersion } = commandEnvelope(req.body, true));
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      throw error;
    }
    const lines = req.body?.righe as ReturnLineInput[];
    const dataRientro =
      req.body?.dataRientro ?? dataCivileEuropeRome(new Date());
    if (
      !Array.isArray(lines) ||
      typeof dataRientro !== "string" ||
      !isDateOnly(dataRientro) ||
      Object.keys(req.body ?? {}).some(
        (key) =>
          ![
            "idempotencyKey",
            "versione",
            "dataRientro",
            "note",
            "righe",
          ].includes(key),
      )
    ) {
      res.status(400).json({
        error: "Righe/data non valide o Magazzino di rientro non ammesso",
      });
      return;
    }
    const tipoComando = "BOLLA_RIENTRO";
    const requestHash = commandRequestHash({
      bollaId,
      versione: expectedVersion,
      dataRientro,
      righe: lines,
      note: req.body?.note ?? null,
    });
    let rientroId: number | null = null;
    try {
      await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const current = await lockBolla(tx, bollaId);
        await assertBollaTransportAccessTx(
          tx,
          req,
          current,
          "magazzino.stock.receive",
        );
        const receipt = await findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
        if (receipt) {
          rientroId = Number(
            (receipt.resultSnapshot as { rientroId: number }).rientroId,
          );
          return;
        }
        if (current.versione !== expectedVersion)
          throw new DocumentCommandError(
            409,
            "Versione non aggiornata; ricaricare i dati",
          );
        if (current.stato !== "rientro_atteso")
          throw new BollaActionError(
            409,
            "Il rientro non è atteso per questa Bolla",
          );
        const rientro = await reconcileTransportReturnTx(tx, {
          owner: {
            tipo: "bolla",
            id: bollaId,
            magazzinoOrigineId: current.magazzinoId,
            numeroDocumento: current.numeroBolla,
            areaOperativaIdSnapshot: current.areaOperativaIdSnapshot,
            centroAscoltoIdSnapshot: current.centroAscoltoIdSnapshot,
          },
          dataRientro,
          note: req.body?.note,
          lines,
          audit: auditContextFromRequest(req, {
            operationKey: `m4b2:${tipoComando}:${idempotencyKey}`,
          }),
        });
        rientroId = rientro.id;
        const [updated] = await tx
          .update(bolleTable)
          .set({
            stato: "rientrato",
            operatoreId: req.user!.id,
            versione: current.versione + 1,
          })
          .where(eq(bolleTable.id, bollaId))
          .returning();
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
          versioneRichiesta: expectedVersion,
          versioneRisultante: updated.versione,
          resultSnapshot: {
            id: bollaId,
            stato: updated.stato,
            versione: updated.versione,
            rientroId,
          },
          actorUserId: req.user!.id,
        });
      });
    } catch (error) {
      if (handleBollaActionError(error, res)) return;
      if (error instanceof TransportReturnError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
    res.json({ ...(await buildDettaglio(bollaId)), rientroId });
  },
);

router.post(
  "/bolle/:id/consegna",
  requirePermission("bolle.deliver"),
  async (req, res) => {
    const bollaId = Number(req.params.id);

    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    if (!bolla) {
      res.status(404).json({ error: "Bolla non trovata" });
      return;
    }
    if (
      !(await canAccessBollaOperativa(
        bolla,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }

    let idempotencyKey: string;
    let expectedVersion: number;
    try {
      ({ idempotencyKey, expectedVersion } = commandEnvelope(req.body, true));
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      throw error;
    }
    const { noteRicezione, confermaRicezione } = req.body ?? {};
    const tipoComando = "BOLLA_CONSEGNA";
    const requestHash = commandRequestHash({
      bollaId,
      versione: expectedVersion,
      noteRicezione: noteRicezione ?? null,
      confermaRicezione: confermaRicezione ?? true,
    });

    try {
      await completeBollaDelivery({
        bollaId,
        audit: auditContextFromRequest(req, {
          operationKey: `m4a:${tipoComando}:${idempotencyKey}`,
        }),
        noteRicezione,
        confermaRicezione,
        beneficiaryAccessScope: beneficiarioAccessScopeFromRequest(req),
        expectedConsegna:
          bolla.consegnaId != null && bolla.beneficiarioId != null
            ? {
                id: bolla.consegnaId,
                beneficiarioId: bolla.beneficiarioId,
              }
            : null,
        documentCommand: {
          tipoComando,
          idempotencyKey,
          requestHash,
          expectedVersion,
          actorUserId: req.user!.id,
        },
      });
    } catch (err) {
      if (handleBollaActionError(err, res)) return;
      if (err instanceof InventoryLedgerError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }

    const det = await buildDettaglio(bollaId);
    res.json(det);
  },
);

// ─── ESITO RITIRO (separato dallo stato logistico) ──────────────────────────

router.post(
  "/bolle/:id/ritiro-non-effettuato",
  requirePermission("bolle.deliver"),
  async (req, res) => {
    const bollaId = Number(req.params.id);
    if (!Number.isInteger(bollaId) || bollaId <= 0) {
      res.status(400).json({ error: "ID bolla non valido" });
      return;
    }
    const motivoRaw = req.body?.motivo;
    if (motivoRaw != null && typeof motivoRaw !== "string") {
      res.status(400).json({ error: "Il motivo deve essere testuale" });
      return;
    }
    const motivo =
      typeof motivoRaw === "string" ? motivoRaw.trim() || null : null;
    if (motivo && motivo.length > 500) {
      res
        .status(400)
        .json({ error: "Il motivo non può superare 500 caratteri" });
      return;
    }
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    if (!bolla) {
      res.status(404).json({ error: "Bolla non trovata" });
      return;
    }
    if (
      !(await canAccessBollaOperativa(
        bolla,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }
    try {
      const recorded = await db.transaction(async (tx) => {
        const current = await lockBolla(tx, bollaId);
        if (current.consegnaId != null)
          throw new BollaActionError(
            409,
            "La bolla è già associata a una consegna",
          );
        if (current.stato !== "confermato")
          throw new BollaActionError(
            409,
            "Il ritiro non effettuato è registrabile solo su una bolla confermata per il ritiro in sede",
          );
        if (current.ritiroNonEffettuatoAt != null) return false;
        await tx
          .update(bolleTable)
          .set({
            ritiroNonEffettuatoAt: new Date(),
            ritiroNonEffettuatoOperatoreId: req.user!.id,
            ritiroNonEffettuatoMotivo: motivo,
            operatoreId: req.user!.id,
          })
          .where(eq(bolleTable.id, bollaId));
        return true;
      });
      if (recorded)
        logger.info(
          { bollaId, operatoreId: req.user!.id },
          "Ritiro bolla segnato come non effettuato",
        );
    } catch (error) {
      if (handleBollaActionError(error, res)) return;
      throw error;
    }
    res.json(await buildDettaglio(bollaId));
  },
);

router.post(
  "/bolle/:id/converti-consegna",
  requireAllModuli(["CENTRO_ASCOLTO", "CONSEGNE"]),
  requirePermission("bolle.deliver"),
  async (req, res) => {
    const bollaId = Number(req.params.id);
    if (!Number.isInteger(bollaId) || bollaId <= 0) {
      res.status(400).json({ error: "ID bolla non valido" });
      return;
    }
    const body = req.body ?? {};
    const indirizzoConsegna =
      typeof body.indirizzoConsegna === "string"
        ? body.indirizzoConsegna.trim()
        : "";
    if (!indirizzoConsegna || indirizzoConsegna.length > 200) {
      res.status(400).json({
        error: "Indirizzo di consegna obbligatorio (massimo 200 caratteri)",
      });
      return;
    }
    if (!isDateOnly(body.dataPrevista)) {
      res
        .status(400)
        .json({ error: "dataPrevista deve essere una data YYYY-MM-DD" });
      return;
    }
    const fasciaOraria =
      body.fasciaOraria === undefined || body.fasciaOraria === null
        ? null
        : typeof body.fasciaOraria === "string" &&
            isFasciaConsegna(body.fasciaOraria.trim())
          ? body.fasciaOraria.trim()
          : undefined;
    if (fasciaOraria === undefined) {
      res.status(400).json({
        error: "fasciaOraria non valida: usare Mattina, Pomeriggio o Sera",
      });
      return;
    }
    const requestedVolontarioId =
      body.volontarioId === undefined
        ? undefined
        : body.volontarioId === null
          ? null
          : Number.isInteger(body.volontarioId) && body.volontarioId > 0
            ? body.volontarioId
            : false;
    if (requestedVolontarioId === false) {
      res.status(400).json({ error: "volontarioId non valido" });
      return;
    }
    const requestedMezzoId =
      body.mezzoId === undefined
        ? undefined
        : body.mezzoId === null
          ? null
          : Number.isInteger(body.mezzoId) && body.mezzoId > 0
            ? body.mezzoId
            : false;
    if (requestedMezzoId === false) {
      res.status(400).json({ error: "mezzoId non valido" });
      return;
    }
    if (body.mezzoAltro !== undefined && typeof body.mezzoAltro !== "boolean") {
      res.status(400).json({ error: "mezzoAltro deve essere booleano" });
      return;
    }
    if (
      body.volontarioAltro !== undefined &&
      body.volontarioAltro !== null &&
      typeof body.volontarioAltro !== "string"
    ) {
      res
        .status(400)
        .json({ error: "volontarioAltro deve essere testuale o NULL" });
      return;
    }
    if (
      body.noteOperative !== undefined &&
      body.noteOperative !== null &&
      typeof body.noteOperative !== "string"
    ) {
      res
        .status(400)
        .json({ error: "noteOperative deve essere testuale o NULL" });
      return;
    }
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    if (!bolla) {
      res.status(404).json({ error: "Bolla non trovata" });
      return;
    }
    if (
      bolla.tipoDestinatario !== "beneficiario" ||
      bolla.beneficiarioId == null
    ) {
      res.status(409).json({
        error:
          "Solo una Bolla Beneficiario può essere convertita in pianificazione personale",
      });
      return;
    }
    if (
      !(await canAccessBollaOperativa(
        bolla,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }
    const preliminaryVolontarioId =
      requestedVolontarioId === undefined
        ? bolla.volontarioConsegnaId
        : requestedVolontarioId;
    const preliminaryMezzoId =
      requestedMezzoId === undefined ? bolla.mezzoId : requestedMezzoId;
    const preliminaryMezzoAltro =
      body.mezzoAltro !== undefined
        ? body.mezzoAltro
        : requestedMezzoId === undefined
          ? bolla.mezzoAltro
          : false;
    const preliminaryPlanningInput = {
      beneficiarioId: bolla.beneficiarioId,
      dataPrevista: body.dataPrevista,
      fasciaOraria,
      volontarioId: preliminaryVolontarioId,
      mezzoId: preliminaryMezzoId,
      mezzoAltro: preliminaryMezzoAltro,
    };
    let result: {
      consegna: typeof consegneTable.$inferSelect;
      existing: boolean;
    } | null = null;
    type ConversionOutcome =
      | {
          kind: "retry-association";
          consegnaId: number | null;
        }
      | {
          kind: "result";
          consegna: typeof consegneTable.$inferSelect;
          existing: boolean;
        };
    try {
      let expectedConsegnaId = bolla.consegnaId;
      for (let attempt = 0; attempt < 3 && result == null; attempt += 1) {
        const outcome: ConversionOutcome = await db.transaction(async (tx) => {
          if (expectedConsegnaId != null) {
            await lockConsegnaBollaRelation(tx, expectedConsegnaId);
          }
          const current = await lockBolla(tx, bollaId);
          if (current.consegnaId !== expectedConsegnaId) {
            return {
              kind: "retry-association",
              consegnaId: current.consegnaId,
            };
          }
          if (
            current.tipoDestinatario !== "beneficiario" ||
            current.beneficiarioId == null
          ) {
            throw new BollaActionError(
              409,
              "Il destinatario non supporta pianificazioni personali",
            );
          }
          if (current.ritiroNonEffettuatoAt == null)
            throw new BollaActionError(
              409,
              "La bolla non è marcata come ritiro non effettuato",
            );
          if (current.stato !== "confermato")
            throw new BollaActionError(409, "La bolla non è più convertibile");
          let linkedBefore: typeof consegneTable.$inferSelect | undefined;
          let planning: Awaited<
            ReturnType<typeof lockConsegnaPlanningContextTx>
          >;
          if (current.consegnaId != null) {
            [linkedBefore] = await tx
              .select()
              .from(consegneTable)
              .where(eq(consegneTable.id, current.consegnaId))
              .for("update");
            if (!linkedBefore)
              throw new BollaActionError(
                409,
                "La bolla risulta già convertita ma la consegna collegata non è disponibile",
              );
            planning = await lockConsegnaPlanningContextTx(
              tx,
              linkedBefore,
              linkedBefore,
            );
          } else {
            planning = await lockConsegnaPlanningContextTx(
              tx,
              null,
              preliminaryPlanningInput,
            );
          }
          if (current.consegnaId != null) {
            const [linked] =
              linkedBefore?.id === current.consegnaId
                ? [linkedBefore]
                : await tx
                    .select()
                    .from(consegneTable)
                    .where(eq(consegneTable.id, current.consegnaId));
            if (!linked)
              throw new BollaActionError(
                409,
                "La bolla risulta già convertita ma la consegna collegata non è disponibile",
              );
            if (linkedBefore?.id !== linked.id)
              return { kind: "result", consegna: linked, existing: true };
            await validateConsegnaPlanningTx(tx, linked, {
              excludeConsegnaId: linked.id,
              context: planning.nuovo ?? undefined,
            });
            await reconcileConsegnaPlanningTx(
              tx,
              linked,
              linked,
              req,
              planning.nuovo,
            );
            return { kind: "result", consegna: linked, existing: true };
          }
          if (linkedBefore != null)
            throw new BollaActionError(409, PLANNING_CONCURRENCY_MESSAGE);
          const volontarioId =
            requestedVolontarioId === undefined
              ? current.volontarioConsegnaId
              : requestedVolontarioId;
          const volontarioAltro =
            body.volontarioAltro === undefined
              ? current.trasportatoreNome
              : typeof body.volontarioAltro === "string"
                ? body.volontarioAltro.trim() || null
                : null;
          const mezzoId =
            requestedMezzoId === undefined ? current.mezzoId : requestedMezzoId;
          const mezzoAltro =
            body.mezzoAltro !== undefined
              ? body.mezzoAltro
              : requestedMezzoId === undefined
                ? current.mezzoAltro
                : false;
          if (volontarioId != null && volontarioAltro) {
            throw new ConsegnaPlanningError(
              400,
              "Indicare un volontario censito oppure Altro, non entrambi",
            );
          }
          if (mezzoId != null && mezzoAltro) {
            throw new ConsegnaPlanningError(
              400,
              "Indicare un mezzo censito oppure Altro, non entrambi",
            );
          }
          const planningInput = {
            beneficiarioId: current.beneficiarioId,
            dataPrevista: body.dataPrevista,
            fasciaOraria,
            volontarioId,
            mezzoId,
            mezzoAltro,
          };
          await validateConsegnaPlanningTx(tx, planningInput, {
            context: planning.nuovo ?? undefined,
          });
          const codice = `CON-${Date.now()}-${bollaId}`.slice(0, 30);
          const [created] = await tx
            .insert(consegneTable)
            .values({
              codice,
              beneficiarioId: current.beneficiarioId,
              tipoPianificazione: "consegna_pacco",
              tipoConsegna: "domicilio",
              dataPrevista: body.dataPrevista,
              fasciaOraria,
              indirizzoConsegna,
              zona: null,
              magazzinoId: current.magazzinoId,
              volontarioId,
              volontarioAltro,
              mezzoId,
              mezzoAltro,
              stato: "pianificata",
              noteOperative:
                typeof body.noteOperative === "string"
                  ? body.noteOperative.trim() || null
                  : null,
            })
            .returning();
          await tx
            .update(bolleTable)
            .set({
              consegnaId: created.id,
              indirizzoConsegna,
              operatoreId: req.user!.id,
            })
            .where(eq(bolleTable.id, bollaId));
          await reconcileConsegnaPlanningTx(
            tx,
            null,
            created,
            req,
            planning.nuovo,
          );
          return { kind: "result", consegna: created, existing: false };
        });
        if (outcome.kind === "retry-association") {
          expectedConsegnaId = outcome.consegnaId;
          continue;
        }
        result = {
          consegna: outcome.consegna,
          existing: outcome.existing,
        };
      }
      if (result == null) {
        throw new BollaActionError(
          409,
          "L'associazione della Bolla continua a cambiare; ricaricare i dati",
        );
      }
    } catch (error) {
      if (isPlanningConcurrencyError(error)) {
        res.status(409).json({ error: PLANNING_CONCURRENCY_MESSAGE });
        return;
      }
      if (error instanceof ConsegnaPlanningError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (handleBollaActionError(error, res)) return;
      throw error;
    }
    if (!result.existing)
      logger.info(
        { bollaId, consegnaId: result.consegna.id, operatoreId: req.user!.id },
        "Bolla convertita in consegna domiciliare",
      );
    res.status(result.existing ? 200 : 201).json({
      created: !result.existing,
      consegnaId: result.consegna.id,
      codice: result.consegna.codice,
    });
  },
);

// ─── STORNO AMMINISTRATIVO POST-USCITA ───────────────────────────────────────

router.post(
  "/bolle/:id/storno-amministrativo",
  requirePermission("bolle.reverse.admin"),
  async (req, res) => {
    const bollaId = Number(req.params.id);
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    if (!bolla) {
      res.status(404).json({ error: "Bolla non trovata" });
      return;
    }
    if (
      !(await canAccessBollaOperativa(
        bolla,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }

    const motivo =
      typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    const rigaIds: number[] = Array.isArray(req.body?.rigaIds)
      ? [
          ...new Set<number>(
            (req.body.rigaIds as unknown[]).map((value) => Number(value)),
          ),
        ].sort((a, b) => a - b)
      : [];
    if (!motivo || motivo.length > 500) {
      res.status(400).json({
        error: "Il motivo dello storno è obbligatorio (massimo 500 caratteri)",
      });
      return;
    }
    if (
      rigaIds.length === 0 ||
      rigaIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
    ) {
      res.status(400).json({ error: "Indicare almeno una riga Bolla valida" });
      return;
    }
    let idempotencyKey: string;
    let expectedVersion: number;
    try {
      ({ idempotencyKey, expectedVersion } = commandEnvelope(req.body, true));
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      throw error;
    }
    const tipoComando = "BOLLA_STORNO_AMMINISTRATIVO";
    const requestHash = commandRequestHash({
      bollaId,
      versione: expectedVersion,
      motivo,
      rigaIds,
    });

    try {
      await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const current = await lockBolla(tx, bollaId);
        if (
          !(await canAccessBollaOperativaTx(
            tx,
            current,
            callerCentroId(req),
            callerAreaOperativaId(req),
            callerZonaUdsId(req),
          ))
        ) {
          throw new BollaActionError(
            403,
            "Risorsa non accessibile per il tuo centro",
          );
        }
        const replay = await findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
        if (replay) return;
        if (current.versione !== expectedVersion) {
          throw new DocumentCommandError(
            409,
            "Versione non aggiornata; ricaricare i dati",
          );
        }
        if (current.stato !== "consegnato") {
          throw new BollaActionError(
            409,
            "Lo storno amministrativo è ammesso solo dopo una consegna contabilizzata",
          );
        }
        const righe = await tx
          .select({ id: bollaRigheTable.id })
          .from(bollaRigheTable)
          .where(
            and(
              eq(bollaRigheTable.bollaId, bollaId),
              inArray(bollaRigheTable.id, rigaIds),
            ),
          )
          .orderBy(asc(bollaRigheTable.id))
          .for("update");
        if (righe.length !== rigaIds.length) {
          throw new BollaActionError(
            400,
            "Una o più righe non appartengono alla Bolla",
          );
        }
        const auditEventoId = await recordAuditEvent(tx, {
          command: auditContextFromRequest(req, {
            operationKey: `m4a:${tipoComando}:${idempotencyKey}`,
          }),
          azione: "BOLLA_STORNO_AMMINISTRATIVO",
          entitaTipo: "bolla",
          entitaId: bollaId,
          documentoTipo: "bolla",
          documentoId: bollaId,
          areaOperativaIdSnapshot: current.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: current.centroAscoltoIdSnapshot,
          magazzinoIdSnapshot: current.magazzinoId,
          dataOperativa: dataCivileEuropeRome(new Date()),
          motivo,
          metadata: auditFields({ rigaIds }, ["rigaIds"]),
        });
        await stornoRigheTx(tx, righe, bollaId, req.user!.id, auditEventoId);
        const [updated] = await tx
          .update(bolleTable)
          .set({
            operatoreId: req.user!.id,
            versione: sql`${bolleTable.versione} + 1`,
          })
          .where(eq(bolleTable.id, bollaId))
          .returning();
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
          versioneRichiesta: expectedVersion,
          versioneRisultante: updated.versione,
          resultSnapshot: {
            id: bollaId,
            rigaIds,
            versione: updated.versione,
          },
          actorUserId: req.user!.id,
        });
      });
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      if (handleBollaActionError(error, res)) return;
      throw error;
    }
    res.json(await buildDettaglio(bollaId));
  },
);

// ─── ANNULLA (solo prima dell'uscita fisica) ─────────────────────────────────

router.post(
  "/bolle/:id/annulla",
  requirePermission("bolle.cancel"),
  async (req, res) => {
    const bollaId = Number(req.params.id);

    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    if (!bolla) {
      res.status(404).json({ error: "Bolla non trovata" });
      return;
    }
    if (
      !(await canAccessBollaOperativa(
        bolla,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }
    const motivo =
      typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    if (!motivo) {
      res
        .status(400)
        .json({ error: "Il motivo dell'annullamento è obbligatorio" });
      return;
    }
    let idempotencyKey: string;
    let expectedVersion: number;
    try {
      ({ idempotencyKey, expectedVersion } = commandEnvelope(req.body, true));
    } catch (error) {
      if (sendDocumentCommandError(error, res)) return;
      throw error;
    }
    const tipoComando = "BOLLA_ANNULLA";
    const requestHash = commandRequestHash({
      bollaId,
      versione: expectedVersion,
      motivo,
    });

    try {
      const audit = auditContextFromRequest(req, {
        operationKey: `m4a:${tipoComando}:${idempotencyKey}`,
      });
      await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const current = await lockBolla(tx, bollaId);
        if (
          !(await canAccessBollaOperativaTx(
            tx,
            current,
            callerCentroId(req),
            callerAreaOperativaId(req),
            callerZonaUdsId(req),
          ))
        ) {
          throw new BollaActionError(
            403,
            "Risorsa non accessibile per il tuo centro",
          );
        }
        const replay = await findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
        });
        if (replay) return;
        if (current.versione !== expectedVersion) {
          throw new DocumentCommandError(
            409,
            "Versione non aggiornata; ricaricare i dati",
          );
        }
        if (current.stato === "annullato") {
          throw new BollaActionError(400, "La bolla è già annullata");
        }
        if (
          current.stato === "consegnato" ||
          (await scarichiFisiciBolla(tx, bollaId)) > 0
        ) {
          throw new BollaActionError(
            409,
            "Dopo l'uscita fisica non è consentito il normale annullamento; usare la rettifica amministrativa autorizzata",
          );
        }

        await recordAuditEvent(tx, {
          command: audit,
          azione: "BOLLA_ANNULLATA",
          entitaTipo: "bolla",
          entitaId: current.id,
          documentoTipo: "bolla",
          documentoId: current.id,
          areaOperativaIdSnapshot: current.areaOperativaIdSnapshot,
          centroAscoltoIdSnapshot: current.centroAscoltoIdSnapshot,
          magazzinoIdSnapshot: current.magazzinoId,
          dataOperativa: dataCivileEuropeRome(new Date()),
          motivo,
          changes: auditFields(
            { statoPrecedente: current.stato, statoNuovo: "annullato" },
            ["statoPrecedente", "statoNuovo"],
          ),
        });

        const activePrenotazioni = await tx
          .select({ id: prenotazioniMagazzinoTable.id })
          .from(prenotazioniMagazzinoTable)
          .where(
            and(
              eq(prenotazioniMagazzinoTable.bollaId, bollaId),
              eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
            ),
          );

        if (current.stato === "confermato" && activePrenotazioni.length > 0) {
          await tx
            .update(prenotazioniMagazzinoTable)
            .set({ stato: PRENOTAZIONE_RILASCIATA, updatedAt: new Date() })
            .where(
              and(
                eq(prenotazioniMagazzinoTable.bollaId, bollaId),
                eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
              ),
            );
        }

        // se era consegnata e collegata a una consegna effettuata, riportiamo la
        // consegna a "pianificata" così i dati restano coerenti dopo lo storno.
        if (current.stato === "consegnato" && current.consegnaId != null) {
          await tx
            .update(consegneTable)
            .set({ stato: "pianificata", dataEffettuata: null })
            .where(
              and(
                eq(consegneTable.id, current.consegnaId),
                eq(consegneTable.stato, "effettuata"),
              ),
            );
        }

        const motivoIntervento =
          typeof req.body?.motivo === "string" && req.body.motivo.trim()
            ? `Annullamento Bolla ${current.numeroBolla}: ${req.body.motivo.trim()}`
            : `Annullamento Bolla ${current.numeroBolla}`;
        if (current.tipoDestinatario === "beneficiario") {
          await annullaInterventoDaBollaTx(
            tx,
            bollaId,
            req.user!.id,
            motivoIntervento,
          );
        }
        const [updated] = await tx
          .update(bolleTable)
          .set({
            stato: "annullato",
            motivoAnnullamento: motivo,
            operatoreId: req.user!.id,
            versione: sql`${bolleTable.versione} + 1`,
          })
          .where(eq(bolleTable.id, bollaId))
          .returning();
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "bolla",
          aggregatoId: bollaId,
          versioneRichiesta: expectedVersion,
          versioneRisultante: updated.versione,
          resultSnapshot: {
            id: bollaId,
            stato: updated.stato,
            versione: updated.versione,
          },
          actorUserId: req.user!.id,
        });
      });
    } catch (err) {
      if (handleBollaActionError(err, res)) return;
      throw err;
    }

    const det = await buildDettaglio(bollaId);
    res.json(det);
  },
);

export default router;
