import { Router, type IRouter, type Request } from "express";
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
  callerCentroId,
  callerCittaId,
  visibleMagazzinoIds,
  trasferimentoScopeFilter,
} from "../lib/centroScope";
import {
  PRENOTAZIONE_MAGAZZINO_ATTIVA,
  calcolaDisponibilitaMagazzino,
  parseDbNumber,
} from "../lib/disponibilitaMagazzino";
import { requireModulo } from "../lib/featureFlags";
import { dataCivileEuropeRome } from "../lib/interventiWorkflow";
import {
  requireOperationalMagazzino,
  InventoryLedgerError,
} from "../lib/inventoryLedger";
import {
  createTransferRequest,
  normalizeTransferRows,
  TransferRequestError,
} from "../lib/transferWorkflow";

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

function requestedVersion(body: unknown): number | null {
  const value = (body as { versione?: unknown } | null)?.versione;
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : null;
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

async function operationalMagazzino(id: number) {
  const [row] = await db
    .select()
    .from(magazziniTable)
    .where(eq(magazziniTable.id, id));
  if (!row) return { error: "Magazzino non trovato", status: 404 } as const;
  if (row.stato !== "attivo")
    return {
      error: "Il Magazzino selezionato non è attivo",
      status: 400,
    } as const;
  return { row } as const;
}

async function enforceMensaTransfer(
  req: Request,
  mensaId: number | null,
): Promise<string | null> {
  if (!isMensaOnly(req)) return null;
  if (!canManageMensaTransfers(req)) return "Permesso Mensa non consentito";
  if (mensaId == null) return "Trasferimento non associato a una Mensa";
  const ownCity = callerCittaId(req);
  if (ownCity != null) {
    const [mensa] = await db
      .select({ cittaId: menseTable.cittaId })
      .from(menseTable)
      .where(eq(menseTable.id, mensaId));
    if (!mensa || mensa.cittaId !== ownCity) {
      return "Trasferimento non accessibile per la tua città";
    }
  }
  return null;
}

async function disponibileRealeProdotto(
  prodottoId: number,
  magazzinoId: number,
): Promise<number> {
  const disponibilita = await calcolaDisponibilitaMagazzino(
    prodottoId,
    magazzinoId,
  );
  return Math.max(0, disponibilita.disponibileReale);
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

async function impegnatoAttivoLotto(tx: Tx, lottoId: number): Promise<number> {
  const [res] = await tx
    .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
    .from(prenotazioniMagazzinoTable)
    .where(
      and(
        eq(prenotazioniMagazzinoTable.lottoId, lottoId),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_MAGAZZINO_ATTIVA),
      ),
    );
  return parseDbNumber(res?.totale);
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
    quantita: number;
    unitaMisura: string;
    dataMovimento: string;
    trasferimentoId: number;
    trasferimentoCodice: string;
    operatoreId: number;
  },
) {
  let rimanente = opts.quantita;
  const lotti = await tx
    .select()
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.prodottoId, opts.prodottoId),
        eq(lottiTable.magazzinoId, opts.magazzinoId),
        gt(lottiTable.quantitaResidua, "0"),
        or(
          isNull(lottiTable.dataScadenza),
          gte(lottiTable.dataScadenza, opts.dataMovimento),
        ),
      ),
    )
    .orderBy(asc(lottiTable.dataScadenza), asc(lottiTable.dataCarico))
    .for("update");

  for (const lotto of lotti) {
    if (rimanente <= 0) break;
    const disp = parseDbNumber(lotto.quantitaResidua);
    const disponibileReale = Math.max(
      0,
      disp - (await impegnatoAttivoLotto(tx, lotto.id)),
    );
    const scala = Math.min(disponibileReale, rimanente);
    if (scala <= 0) continue;

    await tx
      .update(lottiTable)
      .set({ quantitaResidua: (disp - scala).toFixed(2) })
      .where(eq(lottiTable.id, lotto.id));

    await tx.insert(movimentiTable).values({
      tipoMovimento: "trasferimento",
      tipoDettaglio: "uscita",
      dataMovimento: opts.dataMovimento,
      magazzinoId: opts.magazzinoId,
      prodottoId: opts.prodottoId,
      lottoId: lotto.id,
      quantita: scala.toFixed(2),
      unitaMisura: opts.unitaMisura,
      fornitoreId: lotto.fornitoreId,
      operatoreId: opts.operatoreId,
      trasferimentoId: opts.trasferimentoId,
      documentoRiferimento: opts.trasferimentoCodice,
      note: `Trasferimento ${opts.trasferimentoCodice} — uscita`,
    });

    rimanente = Math.round((rimanente - scala) * 100) / 100;
  }
  if (rimanente > 0) {
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

async function getTrasferimentoWithRighe(id: number) {
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
      lottoFsePlus: lottiTable.fsePlus,
    })
    .from(trasferimentoRigheTable)
    .leftJoin(
      prodottiTable,
      eq(trasferimentoRigheTable.prodottoId, prodottiTable.id),
    )
    .leftJoin(lottiTable, eq(trasferimentoRigheTable.lottoId, lottiTable.id))
    .where(eq(trasferimentoRigheTable.trasferimentoId, id));
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
    const ownCity = callerCittaId(req);
    if (ownCity != null) {
      const visibleMense = await db
        .select({ id: menseTable.id })
        .from(menseTable)
        .where(eq(menseTable.cittaId, ownCity));
      const ids = visibleMense.map((row) => row.id);
      conditions.push(
        ids.length ? inArray(trasferimentiTable.mensaId, ids) : sql`false`,
      );
    }
  }
  const scope = trasferimentoScopeFilter(
    trasferimentiTable.magazzinoOrigineId,
    trasferimentiTable.magazzinoDestinoId,
    await visibleMagazzinoIds(callerCentroId(req), callerCittaId(req)),
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
    callerCittaId(req),
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
  for (const magazzinoId of [
    body.magazzinoOrigineId,
    body.magazzinoDestinoId,
  ]) {
    const operational = await operationalMagazzino(Number(magazzinoId));
    if ("error" in operational) {
      res.status(operational.status ?? 400).json({ error: operational.error });
      return;
    }
  }
  const righeInput: Array<{
    prodottoId: number;
    quantita: number;
    unitaMisura?: string;
  }> = body.righe ?? [];
  if (
    righeInput.length === 0 ||
    righeInput.some(
      (r) =>
        !Number.isSafeInteger(r.prodottoId) ||
        r.prodottoId <= 0 ||
        !Number.isFinite(r.quantita) ||
        r.quantita <= 0,
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
  let t: typeof trasferimentiTable.$inferSelect;
  try {
    t = await createTransferRequest({
      magazzinoOrigineId: body.magazzinoOrigineId,
      magazzinoDestinoId: body.magazzinoDestinoId,
      dataRichiesta: body.dataRichiesta,
      trasportatoreVolontarioId: trasportatore.volontarioId,
      trasportatoreNome: trasportatore.nome,
      note: body.note,
      operatoreId: req.user!.id,
      righe: body.righe,
    });
  } catch (error) {
    if (error instanceof TransferRequestError) {
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
  res.status(201).json(result);
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
    callerCittaId(req),
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
    callerCittaId(req),
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
  const versione = requestedVersion(body);
  if (versione == null) {
    res
      .status(400)
      .json({ error: "La versione corrente del Trasferimento è obbligatoria" });
    return;
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
  const visIds = await visibleMagazzinoIds(
    callerCentroId(req),
    callerCittaId(req),
  );
  if (
    visIds != null &&
    !visIds.includes(current.magazzinoOrigineId) &&
    !visIds.includes(current.magazzinoDestinoId)
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
  if ("trasportatoreVolontarioId" in body || "trasportatoreNome" in body) {
    const trasportatore = normalizeTrasportatore(body);
    if (!trasportatore.ok) {
      res.status(400).json({ error: trasportatore.error });
      return;
    }
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
    if (current.stato !== "richiesto" && current.stato !== "preparato") {
      res.status(400).json({
        error:
          "Le righe possono essere modificate solo prima dell'avvio del trasferimento",
      });
      return;
    }
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
  const mutationApplied = await db
    .transaction(async (tx) => {
      const normalizedRows = editRighe
        ? await normalizeTransferRows(tx, righeInput)
        : [];
      const [updated] = await tx
        .update(trasferimentiTable)
        .set({ ...updates, versione: sql`${trasferimentiTable.versione} + 1` })
        .where(
          and(
            eq(trasferimentiTable.id, id),
            eq(trasferimentiTable.versione, versione),
          ),
        )
        .returning({ id: trasferimentiTable.id });
      if (!updated) throw new Error("VERSIONE_TRASFERIMENTO_SUPERATA");
      if (editRighe) {
        await tx
          .delete(trasferimentoRigheTable)
          .where(eq(trasferimentoRigheTable.trasferimentoId, id));
        await tx.insert(trasferimentoRigheTable).values(
          normalizedRows.map((r) => ({
            trasferimentoId: id,
            prodottoId: r.prodottoId,
            lottoId: r.lottoId,
            quantita: r.quantita.toString(),
            unitaMisura: r.unitaMisura,
            note: r.note,
          })),
        );
      }
      return true;
    })
    .catch((error) => {
      if (
        error instanceof Error &&
        error.message === "VERSIONE_TRASFERIMENTO_SUPERATA"
      )
        return false;
      if (databaseErrorCode(error) === "23503")
        return "riga_non_valida" as const;
      if (error instanceof TransferRequestError) return error;
      throw error;
    });
  if (mutationApplied instanceof TransferRequestError) {
    res.status(mutationApplied.status).json({ error: mutationApplied.message });
    return;
  }
  if (mutationApplied === "riga_non_valida") {
    res.status(400).json({
      error:
        "Una riga indica un Prodotto, Lotto o risorsa collegata inesistente",
    });
    return;
  }
  if (!mutationApplied) {
    res.status(409).json({
      error: "Il Trasferimento è stato modificato da un altro operatore",
    });
    return;
  }

  const result = await getTrasferimentoWithRighe(id);
  res.json(result);
});

// Avvia: deduce le quantità dai lotti del magazzino origine (FEFO) e mette il
// trasferimento "in_transito". Da qui in poi le righe non sono più modificabili.
router.post("/trasferimenti/:id/avvia", async (req, res) => {
  const id = Number(req.params.id);
  const versione = requestedVersion(req.body);
  if (versione == null) {
    res
      .status(400)
      .json({ error: "La versione corrente del Trasferimento è obbligatoria" });
    return;
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
  const visIds = await visibleMagazzinoIds(
    callerCentroId(req),
    callerCittaId(req),
  );
  if (visIds != null && !visIds.includes(current.magazzinoOrigineId)) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const origine = await operationalMagazzino(
    Number(current.magazzinoOrigineId),
  );
  if ("error" in origine) {
    res.status(origine.status ?? 400).json({ error: origine.error });
    return;
  }
  if (current.stato !== "richiesto" && current.stato !== "preparato") {
    res.status(400).json({ error: "Il trasferimento è già stato avviato" });
    return;
  }

  const righe = await db
    .select()
    .from(trasferimentoRigheTable)
    .where(eq(trasferimentoRigheTable.trasferimentoId, id));
  if (righe.length === 0) {
    res
      .status(400)
      .json({ error: "Il trasferimento non ha prodotti da trasferire" });
    return;
  }

  // Nomi prodotto per messaggi di errore leggibili.
  const prodottoIds = [...new Set(righe.map((r) => r.prodottoId))];
  const prodotti = await db
    .select({ id: prodottiTable.id, nome: prodottiTable.nome })
    .from(prodottiTable)
    .where(inArray(prodottiTable.id, prodottoIds));
  const prodottoMap = new Map(prodotti.map((p) => [p.id, p.nome]));

  // Valida la disponibilità all'origine sommando per prodotto.
  const richiestaPerProdotto = new Map<number, number>();
  for (const r of righe) {
    richiestaPerProdotto.set(
      r.prodottoId,
      (richiestaPerProdotto.get(r.prodottoId) ?? 0) + parseFloat(r.quantita),
    );
  }
  for (const [prodottoId, richiesta] of richiestaPerProdotto) {
    const disponibilita = await calcolaDisponibilitaMagazzino(
      prodottoId,
      current.magazzinoOrigineId,
    );
    const disp = Math.max(0, disponibilita.disponibileReale);
    if (richiesta > disp) {
      if (
        richiesta <= disponibilita.giacenzaFisica &&
        disponibilita.giacenzaScaduta > 0
      ) {
        res.status(409).json({
          error:
            "Disponibilità FEFO insufficiente o composta solo da lotti scaduti",
        });
        return;
      }
      res.status(400).json({
        error: `Disponibilità insufficiente all'origine per ${prodottoMap.get(prodottoId) ?? `prodotto #${prodottoId}`}: ${disp} disponibili, richiesti ${richiesta}`,
      });
      return;
    }
  }

  const dataEsecuzione = dataCivileEuropeRome(new Date());

  try {
    await db.transaction(async (tx) => {
      await requireOperationalMagazzino(tx, current.magazzinoOrigineId);
      const [claimed] = await tx
        .update(trasferimentiTable)
        .set({
          stato: "in_transito",
          dataEsecuzione,
          operatoreId: req.user!.id,
          versione: sql`${trasferimentiTable.versione} + 1`,
        })
        .where(
          and(
            eq(trasferimentiTable.id, id),
            eq(trasferimentiTable.versione, versione),
            inArray(trasferimentiTable.stato, ["richiesto", "preparato"]),
          ),
        )
        .returning({ id: trasferimentiTable.id });
      if (!claimed) throw new Error("VERSIONE_TRASFERIMENTO_SUPERATA");
      for (const r of righe) {
        await trasferimentoUscitaFEFO(tx, {
          prodottoId: r.prodottoId,
          magazzinoId: current.magazzinoOrigineId,
          quantita: parseFloat(r.quantita),
          unitaMisura: r.unitaMisura,
          dataMovimento: dataEsecuzione,
          trasferimentoId: id,
          trasferimentoCodice: current.codice,
          operatoreId: req.user!.id,
        });
      }
      if (current.mensaId != null) {
        await tx.insert(auditConfigurazioniTable).values({
          area: "mensa",
          chiave: `mensa-trasferimento:${id}`,
          azione: "avvio",
          valoreNuovo: { stato: "in_transito", dataEsecuzione },
          utenteId: req.user!.id,
          ip: req.ip ?? null,
        });
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("VERSIONE_TRASFERIMENTO_SUPERATA")) {
      res.status(409).json({
        error:
          "Il Trasferimento è stato modificato o avviato da un altro operatore",
      });
      return;
    }
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
  const versione = requestedVersion(body);
  if (versione == null) {
    res
      .status(400)
      .json({ error: "La versione corrente del Trasferimento è obbligatoria" });
    return;
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
  const visIds = await visibleMagazzinoIds(
    callerCentroId(req),
    callerCittaId(req),
  );
  if (visIds != null && !visIds.includes(current.magazzinoDestinoId)) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const destinazione = await operationalMagazzino(
    Number(current.magazzinoDestinoId),
  );
  if ("error" in destinazione) {
    res.status(destinazione.status ?? 400).json({ error: destinazione.error });
    return;
  }
  if (current.stato !== "in_transito") {
    res.status(400).json({
      error: "Solo un trasferimento in transito può essere confermato",
    });
    return;
  }

  const dataConferma = body.dataConferma ?? dataCivileEuropeRome(new Date());

  try {
    await db.transaction(async (tx) => {
      await requireOperationalMagazzino(tx, current.magazzinoDestinoId);
      const [claimed] = await tx
        .update(trasferimentiTable)
        .set({
          stato: "completato",
          dataConfermaRicezione: dataConferma,
          note: body.note,
          operatoreId: req.user!.id,
          versione: sql`${trasferimentiTable.versione} + 1`,
        })
        .where(
          and(
            eq(trasferimentiTable.id, id),
            eq(trasferimentiTable.versione, versione),
            eq(trasferimentiTable.stato, "in_transito"),
          ),
        )
        .returning({ id: trasferimentiTable.id });
      if (!claimed) throw new Error("VERSIONE_TRASFERIMENTO_SUPERATA");
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
        );

      for (const u of uscite) {
        const qty = u.m.quantita;
        const [destLotto] = await tx
          .insert(lottiTable)
          .values({
            prodottoId: u.m.prodottoId,
            codiceLotto: u.lotto?.codiceLotto ?? null,
            dataScadenza: u.lotto?.dataScadenza ?? null,
            dataCarico: dataConferma,
            quantitaCaricata: qty,
            quantitaResidua: qty,
            magazzinoId: current.magazzinoDestinoId,
            fornitoreId: u.lotto?.fornitoreId ?? null,
            fsePlus: u.lotto?.fsePlus ?? false,
            note: `Da trasferimento ${current.codice}`,
          })
          .returning();

        await tx.insert(movimentiTable).values({
          tipoMovimento: "trasferimento",
          tipoDettaglio: "entrata",
          dataMovimento: dataConferma,
          magazzinoId: current.magazzinoDestinoId,
          prodottoId: u.m.prodottoId,
          lottoId: destLotto.id,
          quantita: qty,
          unitaMisura: u.m.unitaMisura,
          fornitoreId: u.lotto?.fornitoreId ?? null,
          operatoreId: req.user!.id,
          trasferimentoId: id,
          documentoRiferimento: current.codice,
          note: `Trasferimento ${current.codice} — entrata`,
        });
      }

      if (current.mensaId != null) {
        await tx.insert(auditConfigurazioniTable).values({
          area: "mensa",
          chiave: `mensa-trasferimento:${id}`,
          azione: "conferma-ricezione",
          valoreNuovo: { stato: "completato", dataConferma },
          utenteId: req.user!.id,
          ip: req.ip ?? null,
        });
      }
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("VERSIONE_TRASFERIMENTO_SUPERATA")
    ) {
      res.status(409).json({
        error:
          "Il Trasferimento è stato modificato o confermato da un altro operatore",
      });
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
