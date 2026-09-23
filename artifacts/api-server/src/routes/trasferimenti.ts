import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  trasferimentiTable,
  trasferimentoRigheTable,
  magazziniTable,
  prodottiTable,
  lottiTable,
  movimentiTable,
  utentiTable,
  volontariTable,
  prenotazioniMagazzinoTable,
  auditConfigurazioniTable,
  menseTable,
  type FondoOrigine,
} from "@workspace/db";
import {
  eq,
  and,
  desc,
  inArray,
  gt,
  sum,
  asc,
  gte,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  canAccessAreaOperativa,
  canAccessCentro,
  callerCentroId,
  callerAreaOperativaId,
  visibleMagazzinoIds,
  trasferimentoScopeFilter,
} from "../lib/centroScope";
import { PRENOTAZIONE_MAGAZZINO_ATTIVA } from "../lib/disponibilitaMagazzino";
import { requireModulo } from "../lib/featureFlags";
import { dataCivileEuropeRome } from "../lib/interventiWorkflow";
import {
  inventoryPartyBusinessKey,
  lockInventoryPartyBusinessKeys,
  requireOperationalMagazzino,
  InventoryLedgerError,
} from "../lib/inventoryLedger";
import { lockInventoryLotsInGlobalOrder } from "../lib/inventoryLocks";
import {
  createTransferRequest,
  normalizeTransferRows,
  TransferRequestError,
} from "../lib/transferWorkflow";
import { InventoryDecimal } from "../lib/inventoryDecimal";
import { resolveInventoryQuantityDimensions } from "../lib/inventoryQuantityDimensions";
import { operationalStateForVolunteer } from "../lib/volontariOperational";
import {
  auditContextFromRequest,
  auditFields,
  recordAuditEvent,
} from "../lib/auditEvent";
import {
  LogicalLotError,
  resolveOpenLogicalLotForWarehouse,
} from "../lib/logicalLots";
import {
  commandRequestHash,
  findDocumentCommand,
  isDocumentCommandError,
  lockDocumentCommand,
  requireExpectedVersion,
  requireIdempotencyKey,
  storeDocumentCommand,
} from "../lib/documentCommand";

const router: IRouter = Router();
router.use("/trasferimenti", requireModulo("TRASFERIMENTI"));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isMensaOnly(req: Request): boolean {
  return (
    !req.user?.isAdmin &&
    (req.user?.aree ?? []).includes("mensa") &&
    !(req.user?.aree ?? []).includes("magazzino")
  );
}

function canManageMensaTransfers(req: Request): boolean {
  return (
    !!req.user?.isAdmin ||
    [
      "mensa.transfers.manage",
      "mensa.transfers.request",
      "mensa.transfers.receive",
    ].some((permission) => (req.user?.permessi ?? []).includes(permission))
  );
}

function hasPermission(req: Request, permission: string): boolean {
  return !!req.user?.isAdmin || (req.user?.permessi ?? []).includes(permission);
}

function sendDocumentCommandError(error: unknown, res: Response): boolean {
  if (databaseErrorCode(error) === "40P01") {
    res.status(409).json({
      error: "Operazione concorrente sul magazzino: ricarica i dati e riprova",
    });
    return true;
  }
  if (!isDocumentCommandError(error)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

async function lockTransfer(tx: Tx, id: number) {
  const [current] = await tx
    .select()
    .from(trasferimentiTable)
    .where(eq(trasferimentiTable.id, id))
    .for("update");
  if (!current) throw new TransferRequestError(404, "Not found");
  return current;
}

async function assertCurrentTransferScope(
  tx: Tx,
  req: Request,
  transfer: Pick<
    typeof trasferimentiTable.$inferSelect,
    "magazzinoOrigineId" | "magazzinoDestinoId"
  >,
  requiredWarehouse: "both" | "either" | "origin" | "destination",
): Promise<void> {
  const centroId = callerCentroId(req);
  const areaOperativaId = callerAreaOperativaId(req);
  if (centroId == null && areaOperativaId == null) return;
  const warehouseIds = [
    ...new Set([transfer.magazzinoOrigineId, transfer.magazzinoDestinoId]),
  ];
  const warehouses = await tx
    .select({
      id: magazziniTable.id,
      centroAscoltoId: magazziniTable.centroAscoltoId,
      areaOperativaId: magazziniTable.areaOperativaId,
    })
    .from(magazziniTable)
    .where(inArray(magazziniTable.id, warehouseIds))
    .for("share");
  const visibleIds = new Set(
    warehouses
      .filter(
        (warehouse) =>
          canAccessCentro(warehouse.centroAscoltoId, centroId) &&
          canAccessAreaOperativa(warehouse.areaOperativaId, areaOperativaId),
      )
      .map((warehouse) => warehouse.id),
  );
  const allowed =
    requiredWarehouse === "both"
      ? visibleIds.has(transfer.magazzinoOrigineId) &&
        visibleIds.has(transfer.magazzinoDestinoId)
      : requiredWarehouse === "origin"
        ? visibleIds.has(transfer.magazzinoOrigineId)
        : requiredWarehouse === "destination"
          ? visibleIds.has(transfer.magazzinoDestinoId)
          : visibleIds.has(transfer.magazzinoOrigineId) ||
            visibleIds.has(transfer.magazzinoDestinoId);
  if (!allowed) {
    throw new TransferRequestError(
      403,
      "Risorsa non accessibile per il tuo centro",
    );
  }
}

function assertExpectedVersion(
  current: { versione: number },
  expected: number,
) {
  if (current.versione !== expected) {
    throw new TransferRequestError(
      409,
      "Il Trasferimento è stato modificato da un altro operatore",
    );
  }
}

/**
 * L'unità operativa è derivata dal catalogo: non identifica una nuova
 * intenzione. Anche rappresentazioni decimali equivalenti devono quindi
 * produrre la stessa impronta idempotente.
 */
function transferRowsForCommandHash(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows;
  return rows.map((value) => {
    if (value === null || typeof value !== "object") return value;
    const row = value as Record<string, unknown>;
    let quantita = row.quantita;
    if (typeof quantita === "string" || typeof quantita === "number") {
      try {
        quantita = InventoryDecimal.parse(quantita).toCanonical();
      } catch {
        // Il validatore di dominio produrrà l'errore descrittivo. Per una
        // richiesta invalida conserviamo il valore grezzo nell'impronta.
      }
    }
    return {
      prodottoId: row.prodottoId,
      lottoId: row.lottoId ?? null,
      quantita,
      note: row.note ?? null,
    };
  });
}

function databaseErrorCode(error: unknown): unknown {
  const candidate = error as {
    code?: unknown;
    cause?: { code?: unknown };
  } | null;
  return candidate?.code ?? candidate?.cause?.code;
}

function requireGenericTransferPermission(
  req: Request,
  res: import("express").Response,
  permission: string,
): boolean {
  if (isMensaOnly(req)) {
    const mensaPermission =
      permission === "magazzino.transfers.create"
        ? "mensa.transfers.request"
        : permission === "magazzino.transfers.receive"
          ? "mensa.transfers.receive"
          : null;
    if (
      mensaPermission != null &&
      (hasPermission(req, mensaPermission) ||
        hasPermission(req, "mensa.transfers.manage"))
    ) {
      return true;
    }
    if (permission === "magazzino.view" && canManageMensaTransfers(req)) {
      return true;
    }
    if (hasPermission(req, permission)) return true;
    // La spedizione è sempre un'operazione del magazzino origine: il solo
    // ruolo Mensa non la eredita più implicitamente.
    res.status(403).json({
      error:
        permission === "magazzino.transfers.dispatch"
          ? "La spedizione richiede il permesso del Magazzino origine"
          : "Permesso Mensa non consentito per il workflow richiesto",
    });
    return false;
  }
  if (hasPermission(req, permission)) return true;
  res
    .status(403)
    .json({ error: "Permesso Magazzino non consentito per il ruolo" });
  return false;
}

async function enforceMensaTransfer(
  req: Request,
  mensaId: number | null,
): Promise<string | null> {
  if (!isMensaOnly(req)) return null;
  if (!canManageMensaTransfers(req)) return "Permesso Mensa non consentito";
  if (mensaId == null) return "Trasferimento non associato a una Mensa";
  const ownAreaOperativa = callerAreaOperativaId(req);
  if (ownAreaOperativa != null) {
    const [mensa] = await db
      .select({ areaOperativaId: menseTable.areaOperativaId })
      .from(menseTable)
      .where(eq(menseTable.id, mensaId));
    if (!mensa || mensa.areaOperativaId !== ownAreaOperativa) {
      return "Trasferimento non accessibile per la tua area operativa";
    }
  }
  return null;
}

async function fseBreakdownTrasferimenti(ids: number[]) {
  const result = new Map<string, { fse: number; nonFse: number }>();
  if (ids.length === 0) return result;
  const rows = await db
    .select({
      trasferimentoId: movimentiTable.trasferimentoId,
      prodottoId: movimentiTable.prodottoId,
      fsePlus: lottiTable.fsePlus,
      quantita: sql<string>`sum(${movimentiTable.quantita})`,
    })
    .from(movimentiTable)
    .innerJoin(lottiTable, eq(movimentiTable.lottoId, lottiTable.id))
    .where(
      and(
        inArray(movimentiTable.trasferimentoId, ids),
        eq(movimentiTable.tipoMovimento, "trasferimento"),
        eq(movimentiTable.tipoDettaglio, "uscita"),
      ),
    )
    .groupBy(
      movimentiTable.trasferimentoId,
      movimentiTable.prodottoId,
      lottiTable.fsePlus,
    );
  for (const row of rows) {
    if (row.trasferimentoId == null) continue;
    const key = `${row.trasferimentoId}:${row.prodottoId}`;
    const current = result.get(key) ?? { fse: 0, nonFse: 0 };
    const qty = Number(row.quantita ?? 0);
    if (row.fsePlus) current.fse += qty;
    else current.nonFse += qty;
    result.set(key, current);
  }
  return result;
}

async function impegnatoAttivoLotto(
  tx: Tx,
  lottoId: number,
): Promise<InventoryDecimal> {
  const [res] = await tx
    .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
    .from(prenotazioniMagazzinoTable)
    .where(
      and(
        eq(prenotazioniMagazzinoTable.lottoId, lottoId),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_MAGAZZINO_ATTIVA),
      ),
    );
  return InventoryDecimal.parse(res?.totale ?? "0");
}

/**
 * Uscita FEFO dal magazzino origine: scala la quantità dai lotti per scadenza
 * crescente e registra un movimento "trasferimento/uscita" per ogni lotto toccato.
 * I movimenti registrano il lotto origine così che la conferma possa ricreare i
 * lotti a destinazione preservando scadenza e provenienza (FEFO).
 */
async function trasferimentoUscitaFEFO(
  tx: Tx,
  opts: {
    prodottoId: number;
    magazzinoId: number;
    quantita: string | number;
    unitaMisura: string;
    dataMovimento: string;
    trasferimentoId: number;
    rigaOrigineId: number;
    trasferimentoCodice: string;
    operatoreId: number;
    auditEventoId: number;
    lottoId: number | null;
  },
) {
  let rimanente = InventoryDecimal.parse(opts.quantita);
  const lotti = await tx
    .select()
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.prodottoId, opts.prodottoId),
        eq(lottiTable.magazzinoId, opts.magazzinoId),
        opts.lottoId == null
          ? gt(lottiTable.quantitaResidua, "0")
          : eq(lottiTable.id, opts.lottoId),
        or(
          isNull(lottiTable.dataScadenza),
          gte(lottiTable.dataScadenza, opts.dataMovimento),
        ),
      ),
    )
    .orderBy(
      asc(lottiTable.dataScadenza),
      asc(lottiTable.dataCarico),
      asc(lottiTable.id),
    )
    .for("update");

  if (opts.lottoId != null && lotti.length !== 1) {
    throw new TransferRequestError(
      409,
      "Lotto selezionato non disponibile per Prodotto, Magazzino o data operativa",
    );
  }

  for (const lotto of lotti) {
    if (!rimanente.isPositive()) break;
    const disp = InventoryDecimal.parse(lotto.quantitaResidua);
    const netto = disp.subtract(await impegnatoAttivoLotto(tx, lotto.id));
    const disponibileReale = netto.isNegative()
      ? InventoryDecimal.zero()
      : netto;
    const scala = disponibileReale.min(rimanente);
    if (!scala.isPositive()) continue;

    await tx
      .update(lottiTable)
      .set({ quantitaResidua: disp.subtract(scala).toDb() })
      .where(eq(lottiTable.id, lotto.id));

    const dimensions = resolveInventoryQuantityDimensions({
      quantitaOperativa: scala.toDb(),
      unitaMisura: opts.unitaMisura,
      fattorePartita: lotto.fattoreKgLtPezzo,
    });

    await tx.insert(movimentiTable).values({
      tipoMovimento: "trasferimento",
      tipoDettaglio: "uscita",
      dataMovimento: opts.dataMovimento,
      magazzinoId: opts.magazzinoId,
      prodottoId: opts.prodottoId,
      lottoId: lotto.id,
      quantita: scala.toDb(),
      quantitaPezzi: dimensions.quantitaPezzi,
      quantitaKgLt: dimensions.quantitaKgLt,
      fattoreKgLtPezzo: dimensions.fattoreKgLtPezzo,
      unitaMisura: opts.unitaMisura,
      fornitoreId: lotto.fornitoreId,
      operatoreId: opts.operatoreId,
      auditEventoId: opts.auditEventoId,
      trasferimentoId: opts.trasferimentoId,
      fondoOrigine: lotto.fondoOrigine,
      naturaContabile: "TRASFERIMENTO_INTERNO_USCITA",
      dominioOrigine: "TRASFERIMENTO",
      entitaOrigineTipo: "trasferimento",
      entitaOrigineId: opts.trasferimentoId,
      rigaOrigineId: opts.rigaOrigineId,
      documentoRiferimento: opts.trasferimentoCodice,
      note: `Trasferimento ${opts.trasferimentoCodice} — uscita`,
    });

    rimanente = rimanente.subtract(scala);
  }
  if (rimanente.isPositive()) {
    if (opts.lottoId != null) {
      throw new TransferRequestError(
        409,
        "Disponibilità del lotto selezionato insufficiente",
      );
    }
    throw new Error(
      "Disponibilità FEFO insufficiente o composta solo da lotti scaduti",
    );
  }
}

type TrasportatoreResult =
  | { ok: true; volontarioId: number | null; nome: string | null }
  | { ok: false; error: string };

// Enforces the contract rule: exactly one of volontario / free name when a
// transporter is being set. Returns normalized columns (the unused one nulled).
function normalizeTrasportatore(body: {
  trasportatoreVolontarioId?: unknown;
  trasportatoreNome?: unknown;
}): TrasportatoreResult {
  const hasVol = body.trasportatoreVolontarioId != null;
  const nome =
    typeof body.trasportatoreNome === "string"
      ? body.trasportatoreNome.trim()
      : "";
  const hasNome = nome.length > 0;
  if (hasVol && hasNome) {
    return {
      ok: false,
      error:
        "Specificare un volontario oppure un nome trasportatore, non entrambi",
    };
  }
  if (!hasVol && !hasNome) {
    return {
      ok: false,
      error: "Indicare un trasportatore: un volontario oppure un nome libero",
    };
  }
  return {
    ok: true,
    volontarioId: hasVol ? Number(body.trasportatoreVolontarioId) : null,
    nome: hasVol ? null : nome,
  };
}

export async function getTrasferimentoWithRighe(id: number) {
  const [t] = await db
    .select({
      t: trasferimentiTable,
      origineNome: magazziniTable.nome,
      origineIndirizzo: magazziniTable.indirizzo,
      origineComune: magazziniTable.comune,
      origineZona: magazziniTable.zona,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
    })
    .from(trasferimentiTable)
    .leftJoin(
      magazziniTable,
      eq(trasferimentiTable.magazzinoOrigineId, magazziniTable.id),
    )
    .leftJoin(utentiTable, eq(trasferimentiTable.operatoreId, utentiTable.id))
    .where(eq(trasferimentiTable.id, id));
  if (!t) return null;

  const [destRow] = await db
    .select({
      nome: magazziniTable.nome,
      indirizzo: magazziniTable.indirizzo,
      comune: magazziniTable.comune,
      zona: magazziniTable.zona,
    })
    .from(magazziniTable)
    .where(eq(magazziniTable.id, t.t.magazzinoDestinoId));

  let trasportatoreVolontarioNome: string | null = null;
  if (t.t.trasportatoreVolontarioId != null) {
    const [v] = await db
      .select({ nome: volontariTable.nome, cognome: volontariTable.cognome })
      .from(volontariTable)
      .where(eq(volontariTable.id, t.t.trasportatoreVolontarioId));
    if (v) trasportatoreVolontarioNome = `${v.nome} ${v.cognome}`.trim();
  }

  const righe = await db
    .select({
      r: trasferimentoRigheTable,
      prodottoNome: prodottiTable.nome,
      codiceLotto: lottiTable.codiceLotto,
      fondoOrigine: lottiTable.fondoOrigine,
      lottoFsePlus: lottiTable.fsePlus,
    })
    .from(trasferimentoRigheTable)
    .leftJoin(
      prodottiTable,
      eq(trasferimentoRigheTable.prodottoId, prodottiTable.id),
    )
    .leftJoin(lottiTable, eq(trasferimentoRigheTable.lottoId, lottiTable.id))
    .where(eq(trasferimentoRigheTable.trasferimentoId, id));
  const ripartizioniUscita = await db
    .select({
      rigaOrigineId: movimentiTable.rigaOrigineId,
      lottoId: movimentiTable.lottoId,
      codiceLotto: lottiTable.codiceLotto,
      fondoOrigine: movimentiTable.fondoOrigine,
      unitaMisura: movimentiTable.unitaMisura,
      quantita: sum(movimentiTable.quantita),
    })
    .from(movimentiTable)
    .leftJoin(lottiTable, eq(movimentiTable.lottoId, lottiTable.id))
    .where(
      and(
        eq(movimentiTable.trasferimentoId, id),
        eq(movimentiTable.tipoMovimento, "trasferimento"),
        eq(movimentiTable.tipoDettaglio, "uscita"),
      ),
    )
    .groupBy(
      movimentiTable.rigaOrigineId,
      movimentiTable.lottoId,
      lottiTable.codiceLotto,
      movimentiTable.fondoOrigine,
      movimentiTable.unitaMisura,
    )
    .orderBy(asc(movimentiTable.rigaOrigineId), asc(movimentiTable.lottoId));
  const ripartizioniPerRiga = new Map<
    number,
    Array<{
      lottoId: number | null;
      codiceLotto: string | null;
      fondoOrigine: string;
      quantita: number;
    }>
  >();
  for (const ripartizione of ripartizioniUscita) {
    if (ripartizione.rigaOrigineId == null) continue;
    const current = ripartizioniPerRiga.get(ripartizione.rigaOrigineId) ?? [];
    current.push({
      lottoId: ripartizione.lottoId ?? null,
      codiceLotto: ripartizione.codiceLotto ?? null,
      fondoOrigine: ripartizione.fondoOrigine,
      quantita: parseFloat(ripartizione.quantita ?? "0"),
    });
    ripartizioniPerRiga.set(ripartizione.rigaOrigineId, current);
  }
  const provenance = await fseBreakdownTrasferimenti([id]);

  return {
    id: t.t.id,
    versione: t.t.versione,
    codice: t.t.codice,
    magazzinoOrigineId: t.t.magazzinoOrigineId,
    magazzinoOrigineNome: t.origineNome ?? null,
    magazzinoOrigineIndirizzo: t.origineIndirizzo ?? null,
    magazzinoOrigineComune: t.origineComune ?? null,
    magazzinoOrigineZona: t.origineZona ?? null,
    magazzinoDestinoId: t.t.magazzinoDestinoId,
    magazzinoDestinoNome: destRow?.nome ?? null,
    magazzinoDestinoIndirizzo: destRow?.indirizzo ?? null,
    magazzinoDestinoComune: destRow?.comune ?? null,
    magazzinoDestinoZona: destRow?.zona ?? null,
    trasportatoreVolontarioId: t.t.trasportatoreVolontarioId ?? null,
    trasportatoreVolontarioNome,
    trasportatoreNome: t.t.trasportatoreNome ?? null,
    dataRichiesta: t.t.dataRichiesta,
    dataEsecuzione: t.t.dataEsecuzione ?? null,
    dataConfermaRicezione: t.t.dataConfermaRicezione ?? null,
    stato: t.t.stato,
    note: t.t.note ?? null,
    operatoreId: t.t.operatoreId ?? null,
    operatoreCodice: t.operatoreMatricola ?? t.operatoreUsername ?? null,
    mensaId: t.t.mensaId ?? null,
    idempotencyKey: t.t.idempotencyKey ?? null,
    righe: righe.map((r) => {
      const split = provenance.get(`${id}:${r.r.prodottoId}`) ?? {
        fse: 0,
        nonFse: 0,
      };
      return {
        id: r.r.id,
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
        fsePlus:
          split.fse > 0
            ? split.nonFse === 0
            : r.r.lottoId
              ? !!r.lottoFsePlus
              : false,
        fsePlusQuantita: split.fse,
        nonFsePlusQuantita: split.nonFse,
        quantita: parseFloat(r.r.quantita),
        unitaMisura: r.r.unitaMisura,
        note: r.r.note ?? null,
      };
    }),
    dataCreazione: t.t.dataCreazione.toISOString(),
  };
}

router.get("/trasferimenti", async (req, res) => {
  if (!requireGenericTransferPermission(req, res, "magazzino.view")) return;
  const { stato } = req.query as Record<string, string>;
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
  if (stato) conditions.push(eq(trasferimentiTable.stato, stato));
  if (isMensaOnly(req)) {
    if (!canManageMensaTransfers(req)) {
      res.status(403).json({ error: "Permesso Mensa non consentito" });
      return;
    }
    conditions.push(sql`${trasferimentiTable.mensaId} is not null`);
    const ownAreaOperativa = callerAreaOperativaId(req);
    if (ownAreaOperativa != null) {
      const visibleMense = await db
        .select({ id: menseTable.id })
        .from(menseTable)
        .where(eq(menseTable.areaOperativaId, ownAreaOperativa));
      const ids = visibleMense.map((row) => row.id);
      conditions.push(
        ids.length ? inArray(trasferimentiTable.mensaId, ids) : sql`false`,
      );
    }
  }
  const scope = trasferimentoScopeFilter(
    trasferimentiTable.magazzinoOrigineId,
    trasferimentiTable.magazzinoDestinoId,
    await visibleMagazzinoIds(callerCentroId(req), callerAreaOperativaId(req)),
  );
  if (scope) conditions.push(scope);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(trasferimentiTable)
    .where(where);
  const rows = await db
    .select()
    .from(trasferimentiTable)
    .where(where)
    .orderBy(desc(trasferimentiTable.dataCreazione))
    .limit(limit)
    .offset((page - 1) * limit);

  const magazzini = await db
    .select({
      id: magazziniTable.id,
      nome: magazziniTable.nome,
      indirizzo: magazziniTable.indirizzo,
      comune: magazziniTable.comune,
      zona: magazziniTable.zona,
    })
    .from(magazziniTable);
  const magMap = new Map(magazzini.map((m) => [m.id, m]));

  const volontariRows = await db
    .select({
      id: volontariTable.id,
      nome: volontariTable.nome,
      cognome: volontariTable.cognome,
    })
    .from(volontariTable);
  const volMap = new Map(
    volontariRows.map((v) => [v.id, `${v.nome} ${v.cognome}`.trim()]),
  );

  const operatoreIds = [
    ...new Set(
      rows.map((r) => r.operatoreId).filter((x): x is number => x != null),
    ),
  ];
  const opMap = new Map<number, string | null>();
  if (operatoreIds.length > 0) {
    const utenti = await db
      .select({
        id: utentiTable.id,
        matricola: utentiTable.matricola,
        username: utentiTable.username,
      })
      .from(utentiTable)
      .where(inArray(utentiTable.id, operatoreIds));
    for (const u of utenti) opMap.set(u.id, u.matricola ?? u.username ?? null);
  }

  const ids = rows.map((r) => r.id);
  const provenance = await fseBreakdownTrasferimenti(ids);
  const righeByT = new Map<
    number,
    Array<{
      id: number;
      prodottoId: number;
      prodottoNome: string | null;
      lottoId: number | null;
      fsePlus: boolean;
      fsePlusQuantita: number;
      nonFsePlusQuantita: number;
      quantita: number;
      unitaMisura: string;
      note: string | null;
    }>
  >();
  if (ids.length > 0) {
    const righe = await db
      .select({
        r: trasferimentoRigheTable,
        prodottoNome: prodottiTable.nome,
        lottoFsePlus: lottiTable.fsePlus,
      })
      .from(trasferimentoRigheTable)
      .leftJoin(
        prodottiTable,
        eq(trasferimentoRigheTable.prodottoId, prodottiTable.id),
      )
      .leftJoin(lottiTable, eq(trasferimentoRigheTable.lottoId, lottiTable.id))
      .where(inArray(trasferimentoRigheTable.trasferimentoId, ids));
    for (const x of righe) {
      const arr = righeByT.get(x.r.trasferimentoId) ?? [];
      const split = provenance.get(
        `${x.r.trasferimentoId}:${x.r.prodottoId}`,
      ) ?? { fse: 0, nonFse: 0 };
      arr.push({
        id: x.r.id,
        prodottoId: x.r.prodottoId,
        prodottoNome: x.prodottoNome ?? null,
        lottoId: x.r.lottoId ?? null,
        fsePlus:
          split.fse > 0
            ? split.nonFse === 0
            : x.r.lottoId
              ? !!x.lottoFsePlus
              : false,
        fsePlusQuantita: split.fse,
        nonFsePlusQuantita: split.nonFse,
        quantita: parseFloat(x.r.quantita),
        unitaMisura: x.r.unitaMisura,
        note: x.r.note ?? null,
      });
      righeByT.set(x.r.trasferimentoId, arr);
    }
  }

  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(limit));
  res.json(
    rows.map((r) => {
      const orig = magMap.get(r.magazzinoOrigineId);
      const dest = magMap.get(r.magazzinoDestinoId);
      return {
        id: r.id,
        versione: r.versione,
        codice: r.codice,
        magazzinoOrigineId: r.magazzinoOrigineId,
        magazzinoOrigineNome: orig?.nome ?? null,
        magazzinoOrigineIndirizzo: orig?.indirizzo ?? null,
        magazzinoOrigineComune: orig?.comune ?? null,
        magazzinoOrigineZona: orig?.zona ?? null,
        magazzinoDestinoId: r.magazzinoDestinoId,
        magazzinoDestinoNome: dest?.nome ?? null,
        magazzinoDestinoIndirizzo: dest?.indirizzo ?? null,
        magazzinoDestinoComune: dest?.comune ?? null,
        magazzinoDestinoZona: dest?.zona ?? null,
        trasportatoreVolontarioId: r.trasportatoreVolontarioId ?? null,
        trasportatoreVolontarioNome:
          r.trasportatoreVolontarioId != null
            ? (volMap.get(r.trasportatoreVolontarioId) ?? null)
            : null,
        trasportatoreNome: r.trasportatoreNome ?? null,
        dataRichiesta: r.dataRichiesta,
        dataEsecuzione: r.dataEsecuzione ?? null,
        dataConfermaRicezione: r.dataConfermaRicezione ?? null,
        stato: r.stato,
        note: r.note ?? null,
        operatoreId: r.operatoreId ?? null,
        operatoreCodice:
          r.operatoreId != null ? (opMap.get(r.operatoreId) ?? null) : null,
        mensaId: r.mensaId ?? null,
        idempotencyKey: r.idempotencyKey ?? null,
        righe: righeByT.get(r.id) ?? [],
        dataCreazione: r.dataCreazione.toISOString(),
      };
    }),
  );
});

router.post("/trasferimenti", async (req, res) => {
  const body = req.body ?? {};
  if (isMensaOnly(req)) {
    res
      .status(403)
      .json({ error: "Usare il flusso Rifornimenti del modulo Mensa" });
    return;
  }
  if (!requireGenericTransferPermission(req, res, "magazzino.transfers.create"))
    return;
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(body.idempotencyKey);
  } catch (error) {
    if (sendDocumentCommandError(error, res)) return;
    throw error;
  }
  if (
    !Number.isSafeInteger(body.magazzinoOrigineId) ||
    body.magazzinoOrigineId <= 0 ||
    !Number.isSafeInteger(body.magazzinoDestinoId) ||
    body.magazzinoDestinoId <= 0
  ) {
    res
      .status(400)
      .json({ error: "Origine e destinazione devono essere Magazzini validi" });
    return;
  }
  if (body.magazzinoOrigineId === body.magazzinoDestinoId) {
    res
      .status(400)
      .json({ error: "Origine e destinazione devono essere diverse" });
    return;
  }
  const visIds = await visibleMagazzinoIds(
    callerCentroId(req),
    callerAreaOperativaId(req),
  );
  if (
    visIds != null &&
    (!visIds.includes(body.magazzinoOrigineId) ||
      !visIds.includes(body.magazzinoDestinoId))
  ) {
    res
      .status(403)
      .json({ error: "Magazzino non accessibile per il tuo centro" });
    return;
  }
  const righeInput: Array<{
    prodottoId: number;
    quantita: string | number;
    unitaMisura?: string;
  }> = body.righe ?? [];
  if (
    righeInput.length === 0 ||
    righeInput.some(
      (r) => !Number.isSafeInteger(r.prodottoId) || r.prodottoId <= 0,
    )
  ) {
    res.status(400).json({
      error: "Indicare almeno una riga con Prodotto e quantità validi",
    });
    return;
  }
  const trasportatore = normalizeTrasportatore(body);
  if (!trasportatore.ok) {
    res.status(400).json({ error: trasportatore.error });
    return;
  }
  let t: Awaited<ReturnType<typeof createTransferRequest>>;
  try {
    const requestHash = commandRequestHash({
      magazzinoOrigineId: body.magazzinoOrigineId,
      magazzinoDestinoId: body.magazzinoDestinoId,
      dataRichiesta: body.dataRichiesta,
      trasportatoreVolontarioId: trasportatore.volontarioId,
      trasportatoreNome: trasportatore.nome,
      note: body.note ?? null,
      righe: transferRowsForCommandHash(body.righe),
    });
    t = await createTransferRequest({
      magazzinoOrigineId: body.magazzinoOrigineId,
      magazzinoDestinoId: body.magazzinoDestinoId,
      dataRichiesta: body.dataRichiesta,
      trasportatoreVolontarioId: trasportatore.volontarioId,
      trasportatoreNome: trasportatore.nome,
      note: body.note,
      operatoreId: req.user!.id,
      audit: auditContextFromRequest(req, { operationKey: idempotencyKey }),
      command: {
        idempotencyKey,
        requestHash,
        actorUserId: req.user!.id,
      },
      authorizeCurrent: (tx, current) =>
        assertCurrentTransferScope(tx, req, current, "both"),
      beforeCreate: async (tx) => {
        await assertCurrentTransferScope(
          tx,
          req,
          {
            magazzinoOrigineId: body.magazzinoOrigineId,
            magazzinoDestinoId: body.magazzinoDestinoId,
          },
          "both",
        );
        if (trasportatore.volontarioId == null) return;
        const state = await operationalStateForVolunteer(
          tx,
          trasportatore.volontarioId,
          body.dataRichiesta,
        );
        if (!state?.operativo) {
          throw new TransferRequestError(
            403,
            `Il volontario selezionato non è operativo alla data richiesta (${state?.motivoNonOperativo ?? "requisiti non soddisfatti"})`,
          );
        }
      },
      righe: body.righe,
    });
  } catch (error) {
    if (sendDocumentCommandError(error, res)) return;
    if (error instanceof TransferRequestError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof InventoryLedgerError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (databaseErrorCode(error) === "23503") {
      res.status(400).json({
        error: "Una riga indica un Lotto o una risorsa collegata inesistente",
      });
      return;
    }
    throw error;
  }

  const result = await getTrasferimentoWithRighe(t.id);
  res.status(t.idempotentReplay ? 200 : 201).json(result);
});

router.get("/trasferimenti/:id", async (req, res) => {
  if (!requireGenericTransferPermission(req, res, "magazzino.view")) return;
  const result = await getTrasferimentoWithRighe(Number(req.params.id));
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const mensaError = await enforceMensaTransfer(req, result.mensaId);
  if (mensaError) {
    res.status(403).json({ error: mensaError });
    return;
  }
  const visIds = await visibleMagazzinoIds(
    callerCentroId(req),
    callerAreaOperativaId(req),
  );
  if (
    visIds != null &&
    !visIds.includes(result.magazzinoOrigineId) &&
    !visIds.includes(result.magazzinoDestinoId)
  ) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.json(result);
});

router.get("/trasferimenti/:id/documento", async (req, res) => {
  if (!requireGenericTransferPermission(req, res, "magazzino.view")) return;
  const id = Number(req.params.id);
  const result = await getTrasferimentoWithRighe(id);
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const mensaError = await enforceMensaTransfer(req, result.mensaId);
  if (mensaError) {
    res.status(403).json({ error: mensaError });
    return;
  }
  const visible = await visibleMagazzinoIds(
    callerCentroId(req),
    callerAreaOperativaId(req),
  );
  if (
    visible != null &&
    !visible.includes(result.magazzinoOrigineId) &&
    !visible.includes(result.magazzinoDestinoId)
  ) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  await db.insert(auditConfigurazioniTable).values({
    area: result.mensaId == null ? "magazzino" : "mensa",
    chiave: `trasferimento:${id}:documento`,
    azione: "emissione-documento",
    valoreNuovo: {
      codice: result.codice,
      stato: result.stato,
      mensaId: result.mensaId,
    },
    utenteId: req.user!.id,
    ip: req.ip ?? null,
  });
  res.json(result);
});

router.patch("/trasferimenti/:id", async (req, res) => {
  if (!requireGenericTransferPermission(req, res, "magazzino.transfers.create"))
    return;
  const id = Number(req.params.id);
  const body = req.body ?? {};
  let versione: number;
  let idempotencyKey: string;
  try {
    versione = requireExpectedVersion(body.versione);
    idempotencyKey = requireIdempotencyKey(body.idempotencyKey);
  } catch (error) {
    if (sendDocumentCommandError(error, res)) return;
    throw error;
  }

  const [current] = await db
    .select()
    .from(trasferimentiTable)
    .where(eq(trasferimentiTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const mensaError = await enforceMensaTransfer(req, current.mensaId);
  if (mensaError) {
    res.status(403).json({ error: mensaError });
    return;
  }
  const preflightVisibleIds = await visibleMagazzinoIds(
    callerCentroId(req),
    callerAreaOperativaId(req),
  );
  if (
    preflightVisibleIds != null &&
    !preflightVisibleIds.includes(current.magazzinoOrigineId) &&
    !preflightVisibleIds.includes(current.magazzinoDestinoId)
  ) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

  if (
    "stato" in body ||
    "dataEsecuzione" in body ||
    "dataConfermaRicezione" in body
  ) {
    res.status(400).json({
      error:
        "Lo stato e le date di workflow si modificano solo tramite Avvia e Conferma",
    });
    return;
  }
  const updates: Partial<typeof trasferimentiTable.$inferInsert> = {};
  if ("note" in body) updates.note = body.note;

  // Normalize transporter only when the request touches either field, so that
  // a transporter switch (volontario <-> "Altro") always clears the opposite column.
  let normalizedTransporter: TrasportatoreResult | null = null;
  if ("trasportatoreVolontarioId" in body || "trasportatoreNome" in body) {
    const trasportatore = normalizeTrasportatore(body);
    if (!trasportatore.ok) {
      res.status(400).json({ error: trasportatore.error });
      return;
    }
    normalizedTransporter = trasportatore;
    updates.trasportatoreVolontarioId = trasportatore.volontarioId;
    updates.trasportatoreNome = trasportatore.nome;
  }

  // Item rows can only be edited before the transfer is started ("avvia"
  // deducts stock from the origin lots, so rewriting righe afterwards would
  // desync giacenze). Allowed states: richiesto / preparato.
  const editRighe = "righe" in body;
  let righeInput: Array<{
    prodottoId: number;
    lottoId?: number;
    quantita: number;
    unitaMisura?: string;
    note?: string;
  }> = [];
  if (editRighe) {
    righeInput = body.righe ?? [];
    if (righeInput.length === 0) {
      res
        .status(400)
        .json({ error: "Indicare almeno un prodotto da trasferire" });
      return;
    }
    if (righeInput.some((r) => !(r.quantita > 0))) {
      res
        .status(400)
        .json({ error: "Le quantità devono essere maggiori di zero" });
      return;
    }
  }

  if (Object.keys(updates).length === 0 && !editRighe) {
    res.status(400).json({ error: "Indicare almeno un campo modificabile" });
    return;
  }

  // Stamp the operator who performed this mutation alongside the allow-listed updates.
  updates.operatoreId = req.user!.id;
  const requestHash = commandRequestHash({
    id,
    versione,
    note: "note" in body ? body.note : undefined,
    trasportatoreVolontarioId:
      normalizedTransporter && normalizedTransporter.ok
        ? normalizedTransporter.volontarioId
        : undefined,
    trasportatoreNome:
      normalizedTransporter && normalizedTransporter.ok
        ? normalizedTransporter.nome
        : undefined,
    righe: editRighe ? transferRowsForCommandHash(righeInput) : undefined,
  });
  const audit = auditContextFromRequest(req, {
    operationKey: idempotencyKey,
  });
  try {
    await db.transaction(async (tx) => {
      await lockDocumentCommand(tx, "trasferimento.update", idempotencyKey);
      const locked = await lockTransfer(tx, id);
      await assertCurrentTransferScope(tx, req, locked, "either");
      const receipt = await findDocumentCommand(tx, {
        tipoComando: "trasferimento.update",
        idempotencyKey,
        requestHash,
        actorUserId: req.user!.id,
        aggregatoTipo: "trasferimento",
        aggregatoId: id,
      });
      if (receipt) return;
      assertExpectedVersion(locked, versione);
      if (
        editRighe &&
        locked.stato !== "richiesto" &&
        locked.stato !== "preparato"
      ) {
        throw new TransferRequestError(
          400,
          "Le righe possono essere modificate solo prima dell'avvio del trasferimento",
        );
      }
      if (
        normalizedTransporter?.ok &&
        normalizedTransporter.volontarioId != null
      ) {
        const state = await operationalStateForVolunteer(
          tx,
          normalizedTransporter.volontarioId,
          locked.dataRichiesta,
        );
        if (!state?.operativo) {
          throw new TransferRequestError(
            403,
            `Il volontario selezionato non è operativo alla data richiesta (${state?.motivoNonOperativo ?? "requisiti non soddisfatti"})`,
          );
        }
      }
      const normalizedRows = editRighe
        ? await normalizeTransferRows(tx, righeInput)
        : [];
      const [updated] = await tx
        .update(trasferimentiTable)
        .set({ ...updates, versione: locked.versione + 1 })
        .where(eq(trasferimentiTable.id, id))
        .returning();
      if (editRighe) {
        await tx
          .delete(trasferimentoRigheTable)
          .where(eq(trasferimentoRigheTable.trasferimentoId, id));
        await tx.insert(trasferimentoRigheTable).values(
          normalizedRows.map((r) => ({
            trasferimentoId: id,
            prodottoId: r.prodottoId,
            lottoId: r.lottoId,
            quantita: r.quantita,
            unitaMisura: r.unitaMisura,
            note: r.note,
          })),
        );
      }
      await recordAuditEvent(tx, {
        command: audit,
        azione: "TRASFERIMENTO_MODIFICATO",
        entitaTipo: "trasferimento",
        entitaId: id,
        documentoTipo: "trasferimento",
        documentoId: id,
        magazzinoIdSnapshot: locked.magazzinoOrigineId,
        dataOperativa: locked.dataRichiesta,
        changes: auditFields(
          {
            versionePrecedente: locked.versione,
            versioneNuova: updated.versione,
          },
          ["versionePrecedente", "versioneNuova"],
        ),
        metadata: auditFields(
          {
            righeModificate: editRighe,
            numeroRighe: editRighe ? normalizedRows.length : undefined,
          },
          ["righeModificate", "numeroRighe"],
        ),
      });
      await storeDocumentCommand(tx, {
        tipoComando: "trasferimento.update",
        idempotencyKey,
        requestHash,
        aggregatoTipo: "trasferimento",
        aggregatoId: id,
        versioneRichiesta: versione,
        versioneRisultante: updated.versione,
        resultSnapshot: {
          id,
          stato: updated.stato,
          versione: updated.versione,
        },
        actorUserId: req.user!.id,
      });
    });
  } catch (error) {
    if (sendDocumentCommandError(error, res)) return;
    if (error instanceof TransferRequestError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof InventoryLedgerError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (databaseErrorCode(error) === "23503") {
      res.status(400).json({
        error:
          "Una riga indica un Prodotto, Lotto o risorsa collegata inesistente",
      });
      return;
    }
    throw error;
  }

  const result = await getTrasferimentoWithRighe(id);
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(result);
});

// Avvia: deduce le quantità dai lotti del magazzino origine (FEFO) e mette il
// trasferimento "in_transito". Da qui in poi le righe non sono più modificabili.
router.post("/trasferimenti/:id/avvia", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body ?? {};
  let versione: number;
  let idempotencyKey: string;
  try {
    versione = requireExpectedVersion(body.versione);
    idempotencyKey = requireIdempotencyKey(body.idempotencyKey);
  } catch (error) {
    if (sendDocumentCommandError(error, res)) return;
    throw error;
  }
  const [current] = await db
    .select()
    .from(trasferimentiTable)
    .where(eq(trasferimentiTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const mensaError = await enforceMensaTransfer(req, current.mensaId);
  if (mensaError) {
    res.status(403).json({ error: mensaError });
    return;
  }
  if (
    !requireGenericTransferPermission(req, res, "magazzino.transfers.dispatch")
  )
    return;
  const preflightVisibleIds = await visibleMagazzinoIds(
    callerCentroId(req),
    callerAreaOperativaId(req),
  );
  if (
    preflightVisibleIds != null &&
    !preflightVisibleIds.includes(current.magazzinoOrigineId)
  ) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const dataEsecuzione = dataCivileEuropeRome(new Date());
  const requestHash = commandRequestHash({ id, versione });

  try {
    const audit = auditContextFromRequest(req, {
      operationKey: idempotencyKey,
    });
    await db.transaction(async (tx) => {
      await lockDocumentCommand(tx, "trasferimento.dispatch", idempotencyKey);
      const locked = await lockTransfer(tx, id);
      await assertCurrentTransferScope(tx, req, locked, "origin");
      const receipt = await findDocumentCommand(tx, {
        tipoComando: "trasferimento.dispatch",
        idempotencyKey,
        requestHash,
        actorUserId: req.user!.id,
        aggregatoTipo: "trasferimento",
        aggregatoId: id,
      });
      if (receipt) return;
      assertExpectedVersion(locked, versione);
      if (locked.stato !== "richiesto" && locked.stato !== "preparato") {
        throw new TransferRequestError(
          400,
          "Il trasferimento è già stato avviato",
        );
      }
      await requireOperationalMagazzino(tx, locked.magazzinoOrigineId);
      const righe = await tx
        .select()
        .from(trasferimentoRigheTable)
        .where(eq(trasferimentoRigheTable.trasferimentoId, id))
        .orderBy(
          asc(trasferimentoRigheTable.prodottoId),
          asc(trasferimentoRigheTable.lottoId),
          asc(trasferimentoRigheTable.id),
        );
      if (righe.length === 0) {
        throw new TransferRequestError(
          400,
          "Il trasferimento non ha prodotti da trasferire",
        );
      }
      await lockInventoryLotsInGlobalOrder(tx, {
        kind: "warehouse-products",
        magazzinoId: locked.magazzinoOrigineId,
        prodottoIds: righe.map((riga) => riga.prodottoId),
      });
      const [claimed] = await tx
        .update(trasferimentiTable)
        .set({
          stato: "in_transito",
          dataEsecuzione,
          operatoreId: req.user!.id,
          versione: locked.versione + 1,
        })
        .where(eq(trasferimentiTable.id, id))
        .returning();
      const auditEventoId = await recordAuditEvent(tx, {
        command: audit,
        azione: "TRASFERIMENTO_AVVIATO",
        entitaTipo: "trasferimento",
        entitaId: locked.id,
        documentoTipo: "trasferimento",
        documentoId: locked.id,
        magazzinoIdSnapshot: locked.magazzinoOrigineId,
        dataOperativa: dataEsecuzione,
        changes: auditFields(
          { statoPrecedente: locked.stato, statoNuovo: "in_transito" },
          ["statoPrecedente", "statoNuovo"],
        ),
        metadata: auditFields(
          { magazzinoDestinoId: locked.magazzinoDestinoId },
          ["magazzinoDestinoId"],
        ),
      });
      for (const r of righe) {
        await trasferimentoUscitaFEFO(tx, {
          prodottoId: r.prodottoId,
          lottoId: r.lottoId ?? null,
          magazzinoId: locked.magazzinoOrigineId,
          quantita: r.quantita,
          unitaMisura: r.unitaMisura,
          dataMovimento: dataEsecuzione,
          trasferimentoId: id,
          rigaOrigineId: r.id,
          trasferimentoCodice: locked.codice,
          operatoreId: req.user!.id,
          auditEventoId,
        });
      }
      if (locked.mensaId != null) {
        await tx.insert(auditConfigurazioniTable).values({
          area: "mensa",
          chiave: `mensa-trasferimento:${id}`,
          azione: "avvio",
          valoreNuovo: { stato: "in_transito", dataEsecuzione },
          utenteId: req.user!.id,
          ip: req.ip ?? null,
        });
      }
      await storeDocumentCommand(tx, {
        tipoComando: "trasferimento.dispatch",
        idempotencyKey,
        requestHash,
        aggregatoTipo: "trasferimento",
        aggregatoId: id,
        versioneRichiesta: versione,
        versioneRisultante: claimed.versione,
        resultSnapshot: {
          id,
          stato: claimed.stato,
          versione: claimed.versione,
        },
        actorUserId: req.user!.id,
      });
    });
  } catch (error) {
    if (sendDocumentCommandError(error, res)) return;
    if (error instanceof TransferRequestError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Disponibilità FEFO insufficiente")) {
      res.status(409).json({ error: message });
      return;
    }
    if (error instanceof InventoryLedgerError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }

  const result = await getTrasferimentoWithRighe(id);
  res.json(result);
});

// Conferma: aggiunge le quantità ricevute al magazzino destinazione come nuovi
// lotti, ricostruiti dai movimenti di uscita per preservare scadenza/provenienza.
router.post("/trasferimenti/:id/conferma", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body ?? {};
  let versione: number;
  let idempotencyKey: string;
  try {
    versione = requireExpectedVersion(body.versione);
    idempotencyKey = requireIdempotencyKey(body.idempotencyKey);
  } catch (error) {
    if (sendDocumentCommandError(error, res)) return;
    throw error;
  }
  const [current] = await db
    .select()
    .from(trasferimentiTable)
    .where(eq(trasferimentiTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const mensaError = await enforceMensaTransfer(req, current.mensaId);
  if (mensaError) {
    res.status(403).json({ error: mensaError });
    return;
  }
  if (
    !requireGenericTransferPermission(req, res, "magazzino.transfers.receive")
  )
    return;
  const preflightVisibleIds = await visibleMagazzinoIds(
    callerCentroId(req),
    callerAreaOperativaId(req),
  );
  if (
    preflightVisibleIds != null &&
    !preflightVisibleIds.includes(current.magazzinoDestinoId)
  ) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const dataConferma = body.dataConferma ?? dataCivileEuropeRome(new Date());
  const requestHash = commandRequestHash({
    id,
    versione,
    dataConferma: body.dataConferma ?? null,
    note: body.note ?? null,
  });

  try {
    const audit = auditContextFromRequest(req, {
      operationKey: idempotencyKey,
    });
    await db.transaction(async (tx) => {
      await lockDocumentCommand(tx, "trasferimento.receive", idempotencyKey);
      const locked = await lockTransfer(tx, id);
      await assertCurrentTransferScope(tx, req, locked, "destination");
      const receipt = await findDocumentCommand(tx, {
        tipoComando: "trasferimento.receive",
        idempotencyKey,
        requestHash,
        actorUserId: req.user!.id,
        aggregatoTipo: "trasferimento",
        aggregatoId: id,
      });
      if (receipt) return;
      assertExpectedVersion(locked, versione);
      if (locked.stato !== "in_transito") {
        throw new TransferRequestError(
          400,
          "Solo un trasferimento in transito può essere confermato",
        );
      }
      const destinationWarehouse = await requireOperationalMagazzino(
        tx,
        locked.magazzinoDestinoId,
      );
      const [sourceWarehouse] = await tx
        .select()
        .from(magazziniTable)
        .where(eq(magazziniTable.id, locked.magazzinoOrigineId));
      if (
        destinationWarehouse.areaOperativaId == null ||
        !sourceWarehouse ||
        sourceWarehouse.areaOperativaId == null
      ) {
        throw new InventoryLedgerError(
          409,
          "I Magazzini del trasferimento devono appartenere a un'Area Operativa",
        );
      }
      const [claimed] = await tx
        .update(trasferimentiTable)
        .set({
          stato: "completato",
          dataConfermaRicezione: dataConferma,
          note: body.note,
          operatoreId: req.user!.id,
          versione: locked.versione + 1,
        })
        .where(eq(trasferimentiTable.id, id))
        .returning();
      const auditEventoId = await recordAuditEvent(tx, {
        command: audit,
        azione: "TRASFERIMENTO_RICEVUTO",
        entitaTipo: "trasferimento",
        entitaId: locked.id,
        documentoTipo: "trasferimento",
        documentoId: locked.id,
        magazzinoIdSnapshot: locked.magazzinoDestinoId,
        dataOperativa: dataConferma,
        changes: auditFields(
          { statoPrecedente: locked.stato, statoNuovo: "completato" },
          ["statoPrecedente", "statoNuovo"],
        ),
        metadata: auditFields(
          { magazzinoOrigineId: locked.magazzinoOrigineId },
          ["magazzinoOrigineId"],
        ),
      });
      // I movimenti di uscita portano il lotto origine: lo si rilegge per copiare
      // scadenza, codice lotto e provenienza nei lotti creati a destinazione.
      const uscite = await tx
        .select({ m: movimentiTable, lotto: lottiTable })
        .from(movimentiTable)
        .leftJoin(lottiTable, eq(movimentiTable.lottoId, lottiTable.id))
        .where(
          and(
            eq(movimentiTable.trasferimentoId, id),
            eq(movimentiTable.tipoMovimento, "trasferimento"),
            eq(movimentiTable.tipoDettaglio, "uscita"),
          ),
        )
        .orderBy(
          asc(movimentiTable.prodottoId),
          asc(movimentiTable.lottoId),
          asc(movimentiTable.id),
        );

      const incoming = [];
      for (const u of uscite) {
        const normalized = u.lotto?.codiceLottoNormalizzato ?? null;
        let lottoLogicoId = u.lotto?.lottoLogicoId ?? null;
        if (
          lottoLogicoId == null ||
          sourceWarehouse.areaOperativaId !==
            destinationWarehouse.areaOperativaId
        ) {
          try {
            lottoLogicoId = (
              await resolveOpenLogicalLotForWarehouse(tx, {
                magazzinoId: locked.magazzinoDestinoId,
              })
            ).lotto.id;
          } catch (error) {
            if (error instanceof LogicalLotError) {
              throw new InventoryLedgerError(error.status, error.message);
            }
            throw error;
          }
        }
        const fattoreKgLtPezzo =
          u.m.fattoreKgLtPezzo ?? u.lotto?.fattoreKgLtPezzo ?? null;
        incoming.push({
          u,
          normalized,
          lottoLogicoId,
          fattoreKgLtPezzo,
          businessKey:
            normalized == null
              ? null
              : inventoryPartyBusinessKey({
                  magazzinoId: locked.magazzinoDestinoId,
                  prodottoId: u.m.prodottoId,
                  lottoLogicoId,
                  fondoOrigine: u.m.fondoOrigine as FondoOrigine,
                  fornitoreId: u.lotto?.fornitoreId ?? null,
                  lottoNormalizzato: normalized,
                  dataScadenza: u.lotto?.dataScadenza ?? null,
                  fattoreKgLtPezzo,
                }),
        });
      }
      await lockInventoryPartyBusinessKeys(
        tx,
        incoming.flatMap((item) =>
          item.businessKey == null ? [] : [item.businessKey],
        ),
      );

      for (const item of incoming) {
        const { u, normalized, lottoLogicoId, fattoreKgLtPezzo } = item;
        const qty = u.m.quantita;
        let destLotto: typeof lottiTable.$inferSelect | undefined;
        if (normalized != null) {
          [destLotto] = await tx
            .select()
            .from(lottiTable)
            .where(
              and(
                eq(lottiTable.magazzinoId, locked.magazzinoDestinoId),
                eq(lottiTable.prodottoId, u.m.prodottoId),
                eq(lottiTable.lottoLogicoId, lottoLogicoId),
                eq(lottiTable.fondoOrigine, u.m.fondoOrigine),
                eq(lottiTable.codiceLottoNormalizzato, normalized),
                u.lotto?.fornitoreId == null
                  ? isNull(lottiTable.fornitoreId)
                  : eq(lottiTable.fornitoreId, u.lotto.fornitoreId),
                u.lotto?.dataScadenza == null
                  ? isNull(lottiTable.dataScadenza)
                  : eq(lottiTable.dataScadenza, u.lotto.dataScadenza),
                fattoreKgLtPezzo == null
                  ? isNull(lottiTable.fattoreKgLtPezzo)
                  : eq(lottiTable.fattoreKgLtPezzo, fattoreKgLtPezzo),
              ),
            )
            .for("update");
        }
        if (destLotto) {
          if (
            (destLotto.dataScadenza ?? null) !== (u.lotto?.dataScadenza ?? null)
          ) {
            throw new Error("PARTITA_DESTINAZIONE_INCOERENTE");
          }
          if (
            destLotto.fattoreKgLtPezzo != null &&
            u.m.fattoreKgLtPezzo != null &&
            destLotto.fattoreKgLtPezzo !== u.m.fattoreKgLtPezzo
          ) {
            throw new Error("PARTITA_DESTINAZIONE_FATTORE_INCOERENTE");
          }
          const increment = InventoryDecimal.parse(qty);
          [destLotto] = await tx
            .update(lottiTable)
            .set({
              quantitaCaricata: InventoryDecimal.parse(
                destLotto.quantitaCaricata,
              )
                .add(increment)
                .toDb(),
              quantitaResidua: InventoryDecimal.parse(destLotto.quantitaResidua)
                .add(increment)
                .toDb(),
              dataUltimoCarico: dataConferma,
              fattoreKgLtPezzo:
                destLotto.fattoreKgLtPezzo ?? u.m.fattoreKgLtPezzo,
            })
            .where(eq(lottiTable.id, destLotto.id))
            .returning();
        } else {
          [destLotto] = await tx
            .insert(lottiTable)
            .values({
              prodottoId: u.m.prodottoId,
              lottoLogicoId,
              codiceLotto: u.lotto?.codiceLotto ?? null,
              codiceLottoNormalizzato: normalized,
              dataScadenza: u.lotto?.dataScadenza ?? null,
              dataCarico: dataConferma,
              dataUltimoCarico: dataConferma,
              quantitaCaricata: qty,
              quantitaResidua: qty,
              magazzinoId: locked.magazzinoDestinoId,
              fornitoreId: u.lotto?.fornitoreId ?? null,
              fsePlus: u.m.fondoOrigine === "FSE_PLUS",
              fondoOrigine: u.m.fondoOrigine,
              fattoreKgLtPezzo:
                u.m.fattoreKgLtPezzo ?? u.lotto?.fattoreKgLtPezzo ?? null,
              note: `Da trasferimento ${locked.codice}`,
            })
            .returning();
        }

        await tx.insert(movimentiTable).values({
          tipoMovimento: "trasferimento",
          tipoDettaglio: "entrata",
          dataMovimento: dataConferma,
          magazzinoId: locked.magazzinoDestinoId,
          prodottoId: u.m.prodottoId,
          lottoId: destLotto.id,
          quantita: qty,
          quantitaPezzi: u.m.quantitaPezzi,
          quantitaKgLt: u.m.quantitaKgLt,
          fattoreKgLtPezzo: u.m.fattoreKgLtPezzo,
          unitaMisura: u.m.unitaMisura,
          fornitoreId: u.lotto?.fornitoreId ?? null,
          operatoreId: req.user!.id,
          auditEventoId,
          trasferimentoId: id,
          movimentoOrigineId: u.m.id,
          fondoOrigine: u.m.fondoOrigine,
          naturaContabile: "TRASFERIMENTO_INTERNO_ENTRATA",
          dominioOrigine: "TRASFERIMENTO",
          entitaOrigineTipo: "trasferimento",
          entitaOrigineId: id,
          rigaOrigineId: u.m.rigaOrigineId,
          documentoRiferimento: locked.codice,
          note: `Trasferimento ${locked.codice} — entrata`,
        });
      }

      if (locked.mensaId != null) {
        await tx.insert(auditConfigurazioniTable).values({
          area: "mensa",
          chiave: `mensa-trasferimento:${id}`,
          azione: "conferma-ricezione",
          valoreNuovo: { stato: "completato", dataConferma },
          utenteId: req.user!.id,
          ip: req.ip ?? null,
        });
      }
      await storeDocumentCommand(tx, {
        tipoComando: "trasferimento.receive",
        idempotencyKey,
        requestHash,
        aggregatoTipo: "trasferimento",
        aggregatoId: id,
        versioneRichiesta: versione,
        versioneRisultante: claimed.versione,
        resultSnapshot: {
          id,
          stato: claimed.stato,
          versione: claimed.versione,
        },
        actorUserId: req.user!.id,
      });
    });
  } catch (error) {
    if (sendDocumentCommandError(error, res)) return;
    if (error instanceof TransferRequestError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof InventoryLedgerError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }

  const result = await getTrasferimentoWithRighe(id);
  res.json(result);
});

export default router;
