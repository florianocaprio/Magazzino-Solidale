import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  bolleTable, bollaRigheTable, beneficiariTable, magazziniTable,
  lottiTable, prodottiTable, volontariTable,
  consegneTable, utentiTable, centriAscoltoTable,
  prenotazioniMagazzinoTable, speseEmporioRigheTable, speseEmporioTable,
  movimentiTable,
} from "@workspace/db";
import { eq, and, desc, asc, gt, sum, sql, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
  callerZonaUdsId,
  centroScopeFilter,
  areaOperativaScopeFilter,
  zonaUdsScopeFilter,
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
  stornoRigaTx,
} from "../lib/bollaDelivery";
import {
  InventoryDecimal,
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "../lib/inventoryDecimal";
import {
  beneficiarioAccessScopeFromRequest,
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
import { InventoryLedgerError, requireOperationalMagazzino } from "../lib/inventoryLedger";
import {
  dataOperativaEuropeRome,
  isLottoDistribuibile,
  lottoDistribuibileCondition,
} from "../lib/lottoPolicy";

const router: IRouter = Router();

router.use("/bolle", requireAllModuli(["MAGAZZINO_SOLIDALE", "BOLLE"]));

// stati che consentono ancora modifiche
const STATI_MODIFICABILI = ["bozza"];
const PRENOTAZIONE_ATTIVA = "attiva";
const PRENOTAZIONE_RILASCIATA = "rilasciata";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function canUseVolontarioConsegna(volontarioId: unknown, beneficiarioId: number): Promise<boolean> {
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
  if (!volontario.attivo || volontario.statoApprovazione !== "approvato") return false;
  return canAccessCentro(volontario.centroAscoltoId, centroBeneficiario);
}

async function buildDettaglio(id: number) {
  const [row] = await db
    .select({
      b: bolleTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      benefResidenza: beneficiariTable.residenza,
      benefDomicilio: beneficiariTable.domicilio,
      benefComune: beneficiariTable.comune,
      benefTelefono: beneficiariTable.telefono,
      magazzinoNome: magazziniTable.nome,
      magazzinoIndirizzo: magazziniTable.indirizzo,
      magazzinoComune: magazziniTable.comune,
      volontarioNome: volontariTable.nome,
      volontarioCognome: volontariTable.cognome,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
    })
    .from(bolleTable)
    .leftJoin(beneficiariTable, eq(bolleTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(magazziniTable, eq(bolleTable.magazzinoId, magazziniTable.id))
    .leftJoin(volontariTable, eq(bolleTable.volontarioConsegnaId, volontariTable.id))
    .leftJoin(utentiTable, eq(bolleTable.operatoreId, utentiTable.id))
    .where(eq(bolleTable.id, id));

  if (!row) return null;

  const righe = await db
    .select({
      r: bollaRigheTable,
      prodottoNome: prodottiTable.nome,
      codiceLotto: lottiTable.codiceLotto,
      lottoFsePlus: lottiTable.fsePlus,
    })
    .from(bollaRigheTable)
    .leftJoin(prodottiTable, eq(bollaRigheTable.prodottoId, prodottiTable.id))
    .leftJoin(lottiTable, eq(bollaRigheTable.lottoId, lottiTable.id))
    .where(eq(bollaRigheTable.bollaId, id));

  const righeFallbackEmporio = righe.length > 0
    ? []
    : await db
        .select({
          r: speseEmporioRigheTable,
          prodottoNome: prodottiTable.nome,
          codiceLotto: lottiTable.codiceLotto,
          lottoFsePlus: lottiTable.fsePlus,
        })
        .from(speseEmporioRigheTable)
        .innerJoin(speseEmporioTable, eq(speseEmporioRigheTable.spesaEmporioId, speseEmporioTable.id))
        .leftJoin(prodottiTable, eq(speseEmporioRigheTable.prodottoId, prodottiTable.id))
        .leftJoin(lottiTable, eq(speseEmporioRigheTable.lottoId, lottiTable.id))
        .where(eq(speseEmporioTable.bollaId, id));

  const provenanceRows = await db.select({
    bollaRigaId: movimentiTable.bollaRigaId,
    fsePlus: lottiTable.fsePlus,
    quantita: sql<string>`sum(${movimentiTable.quantita})`,
  })
    .from(movimentiTable)
    .innerJoin(lottiTable, eq(movimentiTable.lottoId, lottiTable.id))
    .where(and(eq(movimentiTable.bollaId, id), eq(movimentiTable.tipoMovimento, "scarico")))
    .groupBy(movimentiTable.bollaRigaId, lottiTable.fsePlus);
  const provenance = new Map<number, { fse: number; nonFse: number }>();
  for (const movement of provenanceRows) {
    if (movement.bollaRigaId == null) continue;
    const split = provenance.get(movement.bollaRigaId) ?? { fse: 0, nonFse: 0 };
    if (movement.fsePlus) split.fse += Number(movement.quantita ?? 0);
    else split.nonFse += Number(movement.quantita ?? 0);
    provenance.set(movement.bollaRigaId, split);
  }

  return {
    id: row.b.id,
    numeroBolla: row.b.numeroBolla,
    dataBolla: row.b.dataBolla,
    beneficiarioId: row.b.beneficiarioId,
    beneficiarioNome: row.cognome && row.nome ? `${row.cognome} ${row.nome}` : null,
    consegnaId: row.b.consegnaId ?? null,
    daPianificazione: row.b.consegnaId != null,
    magazzinoId: row.b.magazzinoId,
    magazzinoNome: row.magazzinoNome ?? null,
    magazzinoIndirizzo: row.magazzinoIndirizzo ?? null,
    magazzinoComune: row.magazzinoComune ?? null,
    indirizzoConsegna: row.b.indirizzoConsegna ?? null,
    beneficiarioIndirizzo: row.benefDomicilio ?? row.benefResidenza ?? row.benefComune ?? null,
    beneficiarioTelefono: row.benefTelefono ?? null,
    volontarioConsegnaId: row.b.volontarioConsegnaId ?? null,
    volontarioNome: row.volontarioNome && row.volontarioCognome
      ? `${row.volontarioCognome} ${row.volontarioNome}` : null,
    trasportatoreNome: row.b.trasportatoreNome ?? null,
    mezzoId: row.b.mezzoId ?? null,
    mezzoAltro: row.b.mezzoAltro ?? false,
    stato: row.b.stato,
    noteConsegna: row.b.noteConsegna ?? null,
    confermaRicezione: row.b.confermaRicezione,
    noteRicezione: row.b.noteRicezione ?? null,
    ritiroNonEffettuatoAt: row.b.ritiroNonEffettuatoAt?.toISOString() ?? null,
    ritiroNonEffettuatoOperatoreId: row.b.ritiroNonEffettuatoOperatoreId ?? null,
    ritiroNonEffettuatoMotivo: row.b.ritiroNonEffettuatoMotivo ?? null,
    operatoreId: row.b.operatoreId ?? null,
    operatoreCodice: row.operatoreMatricola ?? row.operatoreUsername ?? null,
    dataCreazione: row.b.dataCreazione.toISOString(),
    righe: righe.length > 0 ? righe.map(r => {
      const split = provenance.get(r.r.id) ?? { fse: 0, nonFse: 0 };
      return {
      id: r.r.id,
      bollaId: r.r.bollaId,
      prodottoId: r.r.prodottoId,
      prodottoNome: r.prodottoNome ?? null,
      lottoId: r.r.lottoId ?? null,
      codiceLotto: r.codiceLotto ?? null,
      fsePlus: split.fse > 0 ? split.nonFse === 0 : (r.r.lottoId ? !!r.lottoFsePlus : false),
      fsePlusQuantita: split.fse,
      nonFsePlusQuantita: split.nonFse,
      quantita: parseFloat(r.r.quantita),
      unitaMisura: r.r.unitaMisura,
      note: r.r.note ?? null,
      };
    }) : righeFallbackEmporio.map(r => {
      const effectiveRigaId = r.r.bollaRigaId ?? r.r.id;
      const split = provenance.get(effectiveRigaId) ?? { fse: 0, nonFse: 0 };
      return {
      id: effectiveRigaId,
      bollaId: id,
      prodottoId: r.r.prodottoId,
      prodottoNome: r.prodottoNome ?? r.r.descrizioneProdotto ?? null,
      lottoId: r.r.lottoId ?? null,
      codiceLotto: r.codiceLotto ?? null,
      fsePlus: split.fse > 0 ? split.nonFse === 0 : (r.r.lottoId ? !!r.lottoFsePlus : false),
      fsePlusQuantita: split.fse,
      nonFsePlusQuantita: split.nonFse,
      quantita: parseFloat(r.r.quantita),
      unitaMisura: r.r.unitaMisura,
      note: "Riga da Spesa Emporio",
      };
    }),
  };
}

/** Calcola giacenza disponibile per un prodotto in un magazzino */
async function giacenzaDisponibile(prodottoId: number, magazzinoId: number): Promise<InventoryDecimal> {
  const result = await calcolaDisponibilitaMagazzino(prodottoId, magazzinoId);
  const value = InventoryDecimal.parse(result.disponibileRealePrecisa, {
    allowNegative: true,
  });
  return value.isNegative() ? InventoryDecimal.zero() : value;
}

/** Calcola quanto è già in bolla (bozza) per un prodotto */
async function quantitaGiaInBolla(bollaId: number, prodottoId: number, excludeRigaId?: number): Promise<InventoryDecimal> {
  const righe = await db
    .select({ q: bollaRigheTable.quantita, id: bollaRigheTable.id })
    .from(bollaRigheTable)
    .where(and(eq(bollaRigheTable.bollaId, bollaId), eq(bollaRigheTable.prodottoId, prodottoId)));
  return righe
    .filter(r => r.id !== excludeRigaId)
    .reduce(
      (total, r) => total.add(InventoryDecimal.parse(r.q)),
      InventoryDecimal.zero(),
    );
}

/** Calcola quanto è già in bolla (bozza) per uno specifico lotto */
async function quantitaGiaInBollaLotto(bollaId: number, lottoId: number): Promise<InventoryDecimal> {
  const righe = await db
    .select({ q: bollaRigheTable.quantita })
    .from(bollaRigheTable)
    .where(and(eq(bollaRigheTable.bollaId, bollaId), eq(bollaRigheTable.lottoId, lottoId)));
  return righe.reduce(
    (total, r) => total.add(InventoryDecimal.parse(r.q)),
    InventoryDecimal.zero(),
  );
}

async function canAccessBollaOperativa(
  bolla: Pick<typeof bolleTable.$inferSelect, "beneficiarioId" | "magazzinoId">,
  caller: number | null,
  areaOperativaId: number | null,
  zonaUdsId: number | null,
): Promise<boolean> {
  if (!canAccessCentro(await beneficiarioCentroId(bolla.beneficiarioId), caller)
      || !canAccessAreaOperativa(await beneficiarioAreaOperativaId(bolla.beneficiarioId), areaOperativaId)
      || !canAccessZonaUds(await beneficiarioZonaUdsId(bolla.beneficiarioId), zonaUdsId)) {
    return false;
  }

  const visibili = await visibleMagazzinoIds(caller, areaOperativaId);
  return visibili == null || visibili.includes(bolla.magazzinoId);
}

async function productName(prodottoId: number): Promise<string> {
  const [prod] = await db.select({ nome: prodottiTable.nome }).from(prodottiTable).where(eq(prodottiTable.id, prodottoId));
  return prod?.nome ?? `prodotto #${prodottoId}`;
}

async function lockLottiFEFO(
  tx: Tx,
  prodottoId: number,
  magazzinoId: number,
): Promise<Array<typeof lottiTable.$inferSelect>> {
  const dataOperativa = dataOperativaEuropeRome();
  await tx.execute(sql`
    SELECT id
    FROM ${lottiTable}
    WHERE ${lottiTable.prodottoId} = ${prodottoId}
      AND ${lottiTable.magazzinoId} = ${magazzinoId}
      AND ${lottiTable.quantitaResidua} > 0
      AND (${lottiTable.dataScadenza} IS NULL OR ${lottiTable.dataScadenza} >= ${dataOperativa})
    ORDER BY ${lottiTable.dataScadenza} ASC, ${lottiTable.dataCarico} ASC, ${lottiTable.id} ASC
    FOR UPDATE
  `);

  return tx
    .select()
    .from(lottiTable)
    .where(and(
      eq(lottiTable.prodottoId, prodottoId),
      eq(lottiTable.magazzinoId, magazzinoId),
      gt(lottiTable.quantitaResidua, "0"),
      lottoDistribuibileCondition(dataOperativa),
    ))
    .orderBy(asc(lottiTable.dataScadenza), asc(lottiTable.dataCarico), asc(lottiTable.id));
}

async function impegnatoAttivoLotto(
  tx: Tx,
  lottoId: number,
): Promise<InventoryDecimal> {
  const [res] = await tx
    .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
    .from(prenotazioniMagazzinoTable)
    .where(and(
      eq(prenotazioniMagazzinoTable.lottoId, lottoId),
      eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
    ));
  return InventoryDecimal.parse(res?.totale ?? "0");
}

async function creaPrenotazione(
  tx: Tx,
  opts: {
    bollaId: number;
    rigaBollaId: number;
    prodottoId: number;
    lottoId: number;
    magazzinoId: number;
    quantita: string;
  },
): Promise<void> {
  await tx.insert(prenotazioniMagazzinoTable).values({
    bollaId: opts.bollaId,
    rigaBollaId: opts.rigaBollaId,
    prodottoId: opts.prodottoId,
    lottoId: opts.lottoId,
    magazzinoId: opts.magazzinoId,
    quantita: opts.quantita,
    stato: PRENOTAZIONE_ATTIVA,
  });
}

async function prenotaRigaFEFO(
  tx: Tx,
  bolla: typeof bolleTable.$inferSelect,
  riga: typeof bollaRigheTable.$inferSelect,
): Promise<void> {
  const richiesta = InventoryDecimal.parse(riga.quantita);
  let rimanente = richiesta;
  let primoLottoId: number | null = null;

  if (riga.lottoId != null) {
    const lotto = await lockLotto(tx, riga.lottoId);
    if (lotto.prodottoId !== riga.prodottoId || lotto.magazzinoId !== bolla.magazzinoId) {
      throw new BollaActionError(400, "Il lotto selezionato non appartiene al prodotto o al magazzino della bolla");
    }
    if (!isLottoDistribuibile(lotto.dataScadenza)) {
      throw new BollaActionError(409, "Il lotto selezionato è scaduto e non può essere distribuito");
    }
    const disponibileReale = InventoryDecimal.parse(
      lotto.quantitaResidua,
    ).subtract(await impegnatoAttivoLotto(tx, lotto.id));
    if (disponibileReale.compare(richiesta) < 0) {
      throw new BollaActionError(
        409,
        `Disponibilità reale insufficiente nel lotto ${lotto.codiceLotto ?? `#${lotto.id}`} per ${await productName(riga.prodottoId)}: disponibili ${disponibileReale.isNegative() ? "0" : disponibileReale.toCanonical()}, richiesti ${richiesta.toCanonical()}`,
      );
    }
    await creaPrenotazione(tx, {
      bollaId: bolla.id,
      rigaBollaId: riga.id,
      prodottoId: riga.prodottoId,
      lottoId: lotto.id,
      magazzinoId: bolla.magazzinoId,
      quantita: richiesta.toDb(),
    });
    return;
  }

  const lotti = await lockLottiFEFO(tx, riga.prodottoId, bolla.magazzinoId);
  for (const lotto of lotti) {
    if (!rimanente.isPositive()) break;
    const disponibileReale = InventoryDecimal.parse(
      lotto.quantitaResidua,
    ).subtract(await impegnatoAttivoLotto(tx, lotto.id));
    if (!disponibileReale.isPositive()) continue;
    const prenota = disponibileReale.min(rimanente);
    await creaPrenotazione(tx, {
      bollaId: bolla.id,
      rigaBollaId: riga.id,
      prodottoId: riga.prodottoId,
      lottoId: lotto.id,
      magazzinoId: bolla.magazzinoId,
      quantita: prenota.toDb(),
    });
    if (primoLottoId == null) primoLottoId = lotto.id;
    rimanente = rimanente.subtract(prenota);
  }

  if (rimanente.isPositive()) {
    throw new BollaActionError(
      409,
      `Disponibilità reale insufficiente per ${await productName(riga.prodottoId)}: disponibili ${richiesta.subtract(rimanente).toCanonical()}, richiesti ${richiesta.toCanonical()}`,
    );
  }

  if (primoLottoId != null) {
    await tx.update(bollaRigheTable).set({ lottoId: primoLottoId }).where(eq(bollaRigheTable.id, riga.id));
  }
}

// ─── LIST ────────────────────────────────────────────────────────────────────

router.get("/bolle", requirePermission("bolle.view"), async (req, res) => {
  const { stato, magazzinoId, centroAscoltoId } = req.query as Record<string, string>;
  const page = req.query.page == null ? 1 : Number(req.query.page);
  const limit = req.query.limit == null ? 50 : Number(req.query.limit);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: "Paginazione non valida: page >= 1 e limit tra 1 e 100" });
    return;
  }
  const conditions: SQL[] = [];
  if (stato) conditions.push(eq(bolleTable.stato, stato));
  if (magazzinoId) {
    const mid = Number(magazzinoId);
    if (!Number.isInteger(mid)) { res.status(400).json({ error: "magazzinoId non valido" }); return; }
    conditions.push(eq(bolleTable.magazzinoId, mid));
  }
  const caller = callerCentroId(req);
  if (caller != null) {
    const f = centroScopeFilter(beneficiariTable.centroAscoltoId, caller);
    if (f) conditions.push(f);
  } else if (centroAscoltoId) {
    const cid = Number(centroAscoltoId);
    if (!Number.isInteger(cid)) { res.status(400).json({ error: "centroAscoltoId non valido" }); return; }
    conditions.push(eq(beneficiariTable.centroAscoltoId, cid));
  }
  const areaOperativaFilter = areaOperativaScopeFilter(beneficiariTable.areaOperativaId, callerAreaOperativaId(req));
  if (areaOperativaFilter) conditions.push(areaOperativaFilter);
  const zonaFilter = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
  if (zonaFilter) conditions.push(zonaFilter);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(bolleTable)
    .leftJoin(beneficiariTable, eq(bolleTable.beneficiarioId, beneficiariTable.id))
    .where(where);
  const rows = await db
    .select({
      b: bolleTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      magazzinoNome: magazziniTable.nome,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
    })
    .from(bolleTable)
    .leftJoin(beneficiariTable, eq(bolleTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(centriAscoltoTable, eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(magazziniTable, eq(bolleTable.magazzinoId, magazziniTable.id))
    .leftJoin(utentiTable, eq(bolleTable.operatoreId, utentiTable.id))
    .where(where)
    .orderBy(desc(bolleTable.dataCreazione))
    .limit(limit)
    .offset((page - 1) * limit);

  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(limit));
  res.json(rows.map(r => ({
    id: r.b.id,
    numeroBolla: r.b.numeroBolla,
    dataBolla: r.b.dataBolla,
    beneficiarioId: r.b.beneficiarioId,
    beneficiarioNome: r.cognome && r.nome ? `${r.cognome} ${r.nome}` : null,
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
    ritiroNonEffettuatoOperatoreId: r.b.ritiroNonEffettuatoOperatoreId ?? null,
    ritiroNonEffettuatoMotivo: r.b.ritiroNonEffettuatoMotivo ?? null,
    operatoreId: r.b.operatoreId ?? null,
    operatoreCodice: r.operatoreMatricola ?? r.operatoreUsername ?? null,
    dataCreazione: r.b.dataCreazione.toISOString(),
  })));
});

// ─── CREATE ──────────────────────────────────────────────────────────────────

router.post("/bolle", requirePermission("bolle.manage"), async (req, res) => {
  const body = { ...req.body };
  const accepted = new Set([
    "beneficiarioId", "consegnaId", "magazzinoId", "dataBolla", "indirizzoConsegna",
    "volontarioConsegnaId", "trasportatoreNome", "mezzoId", "mezzoAltro", "noteConsegna",
  ]);
  const serverManaged = [
    "numeroBolla", "stato", "operatoreId", "confermaRicezione", "noteRicezione",
    "firmaNota", "ritiroNonEffettuatoAt", "ritiroNonEffettuatoOperatoreId", "ritiroNonEffettuatoMotivo",
  ];
  const forbidden = serverManaged.filter((key) => key in body);
  if (forbidden.length > 0) {
    res.status(400).json({ error: `Campi gestiti dal server non accettati: ${forbidden.join(", ")}` });
    return;
  }
  const unsupported = Object.keys(body).filter((key) => !accepted.has(key));
  if (unsupported.length > 0) {
    res.status(400).json({ error: `Campi Bolla non supportati: ${unsupported.join(", ")}` });
    return;
  }
  if (!Number.isInteger(body.beneficiarioId) || body.beneficiarioId <= 0
      || !Number.isInteger(body.magazzinoId) || body.magazzinoId <= 0) {
    res.status(400).json({ error: "Beneficiario e Magazzino non validi" });
    return;
  }
  const caller = callerCentroId(req);
  const cid = callerAreaOperativaId(req);
  const zid = callerZonaUdsId(req);
  if ((caller != null || cid != null || zid != null) && !(await canUseBeneficiario(body.beneficiarioId, caller, cid, zid))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }
  if (!(await isBeneficiarioActive(body.beneficiarioId))) {
    res.status(400).json({ error: "Il Beneficiario deve essere attivo per creare una nuova Bolla." });
    return;
  }
  if ((caller != null || cid != null) && body.magazzinoId != null) {
    const visibili = await visibleMagazzinoIds(caller, cid);
    if (visibili != null && !visibili.includes(body.magazzinoId)) {
      res.status(403).json({ error: "Magazzino non accessibile per il tuo centro" });
      return;
    }
  }
  const [magazzino] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, body.magazzinoId));
  if (!magazzino) { res.status(404).json({ error: "Magazzino non trovato" }); return; }
  if (magazzino.stato !== "attivo") {
    res.status(400).json({ error: "Il Magazzino selezionato non è attivo" });
    return;
  }
  if (body.volontarioConsegnaId != null && body.trasportatoreNome != null) {
    res.status(400).json({ error: "Indicare un volontario OPPURE un trasportatore esterno, non entrambi" });
    return;
  }
  if (body.consegnaId != null) {
    const [consegna] = await db.select().from(consegneTable).where(eq(consegneTable.id, body.consegnaId));
    if (!consegna) {
      res.status(400).json({ error: "Consegna non trovata" });
      return;
    }
    if (consegna.beneficiarioId !== body.beneficiarioId) {
      res.status(400).json({ error: "La bolla deve appartenere allo stesso beneficiario della consegna" });
      return;
    }
    const collegate = await db.select({ stato: bolleTable.stato }).from(bolleTable).where(eq(bolleTable.consegnaId, body.consegnaId));
    if (collegate.some((b) => b.stato !== "annullato")) {
      res.status(400).json({ error: "La consegna ha già una bolla associata" });
      return;
    }
    if (body.volontarioConsegnaId == null && !body.trasportatoreNome) {
      if (consegna.volontarioId != null) body.volontarioConsegnaId = consegna.volontarioId;
      else if (consegna.volontarioAltro) body.trasportatoreNome = consegna.volontarioAltro;
    }
    if (body.mezzoId == null && body.mezzoAltro == null) {
      if (consegna.mezzoId != null) body.mezzoId = consegna.mezzoId;
      else if (consegna.mezzoAltro) body.mezzoAltro = true;
    }
    if (!body.indirizzoConsegna && consegna.indirizzoConsegna) {
      body.indirizzoConsegna = consegna.indirizzoConsegna;
    }
  }
  if (body.volontarioConsegnaId != null && !(await canUseVolontarioConsegna(body.volontarioConsegnaId, body.beneficiarioId))) {
    res.status(403).json({ error: "Volontario non accessibile per il centro della bolla" });
    return;
  }
  if (body.dataBolla != null && !isDateOnly(body.dataBolla)) {
    res.status(400).json({ error: "Data Bolla non valida" });
    return;
  }
  const dataBolla = body.dataBolla ?? dataCivileEuropeRome(new Date());
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bolle.numero_bolla'))`);
    const anno = Number(dataBolla.slice(0, 4));
    const existing = await tx.select({ n: bolleTable.numeroBolla })
      .from(bolleTable)
      .where(sql`${bolleTable.numeroBolla} like ${`BOLLA-${anno}-%`}`)
      .orderBy(desc(bolleTable.id))
      .limit(1);
    const lastNum = existing.length > 0 ? Number(existing[0].n.split("-").pop() ?? 0) : 0;
    const numeroBolla = `BOLLA-${anno}-${String(lastNum + 1).padStart(4, "0")}`;
    const [created] = await tx.insert(bolleTable).values({
      numeroBolla,
      dataBolla,
      beneficiarioId: body.beneficiarioId,
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
    }).returning();
    return created;
  });
  const det = await buildDettaglio(row.id);
  res.status(201).json(det);
});

// ─── GET BY ID ───────────────────────────────────────────────────────────────

router.get("/bolle/:id/righe", requirePermission("bolle.view"), async (req, res) => {
  const det = await buildDettaglio(Number(req.params.id));
  if (!det) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(det.beneficiarioId), callerCentroId(req))
      || !canAccessAreaOperativa(await beneficiarioAreaOperativaId(det.beneficiarioId), callerAreaOperativaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(det.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.json(det.righe);
});

router.get("/bolle/:id", requirePermission("bolle.view"), async (req, res) => {
  const det = await buildDettaglio(Number(req.params.id));
  if (!det) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(det.beneficiarioId), callerCentroId(req))
      || !canAccessAreaOperativa(await beneficiarioAreaOperativaId(det.beneficiarioId), callerAreaOperativaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(det.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.json(det);
});

// ─── UPDATE (magazzino/beneficiario/volontario) ──────────────────────────────

router.patch("/bolle/:id", requirePermission("bolle.manage"), async (req, res) => {
  const bollaId = Number(req.params.id);
  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Not found" }); return; }
  const caller = callerCentroId(req);
  const cid = callerAreaOperativaId(req);
  const zid = callerZonaUdsId(req);
  if (!canAccessCentro(await beneficiarioCentroId(bolla.beneficiarioId), caller)
      || !canAccessAreaOperativa(await beneficiarioAreaOperativaId(bolla.beneficiarioId), cid)
      || !canAccessZonaUds(await beneficiarioZonaUdsId(bolla.beneficiarioId), zid)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

  if (bolla.stato !== "bozza") {
    res.status(409).json({ error: "Una Bolla confermata o consegnata non è modificabile; usa le azioni dedicate" });
    return;
  }
  const body = { ...req.body };
  const allowed = new Set([
    "beneficiarioId", "magazzinoId", "indirizzoConsegna", "volontarioConsegnaId",
    "trasportatoreNome", "mezzoId", "mezzoAltro", "noteConsegna", "dataBolla",
  ]);
  const unsupported = Object.keys(body).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) {
    res.status(400).json({ error: `Campi non modificabili dal PATCH Bolla: ${unsupported.join(", ")}` });
    return;
  }
  if (body.dataBolla != null && !isDateOnly(body.dataBolla)) {
    res.status(400).json({ error: "Data Bolla non valida" });
    return;
  }
  if ((caller != null || cid != null || zid != null) && body.beneficiarioId != null && body.beneficiarioId !== bolla.beneficiarioId
      && !(await canUseBeneficiario(body.beneficiarioId, caller, cid, zid))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }

  // trasportatore: volontario OPPURE nome esterno, mai entrambi (coerente col POST e con la UI)
  const nextVolontario = body.volontarioConsegnaId !== undefined ? body.volontarioConsegnaId : bolla.volontarioConsegnaId;
  const nextTrasportatore = body.trasportatoreNome !== undefined ? body.trasportatoreNome : bolla.trasportatoreNome;
  if (nextVolontario != null && nextTrasportatore != null) {
    res.status(400).json({ error: "Indicare un volontario OPPURE un trasportatore esterno, non entrambi" });
    return;
  }
  if (
    (body.volontarioConsegnaId !== undefined || body.beneficiarioId !== undefined) &&
    nextVolontario != null &&
    !(await canUseVolontarioConsegna(nextVolontario, body.beneficiarioId ?? bolla.beneficiarioId))
  ) {
    res.status(403).json({ error: "Volontario non accessibile per il centro della bolla" });
    return;
  }

  // cambio magazzino: consentito solo in bozza (nessuno scarico ancora effettuato).
  // Le righe esistenti fanno riferimento alle giacenze/lotti del vecchio magazzino,
  // quindi vengono rimosse: l'utente le ri-seleziona dal nuovo magazzino.
  if (body.magazzinoId && body.magazzinoId !== bolla.magazzinoId) {
    if (caller != null || cid != null) {
      const visibili = await visibleMagazzinoIds(caller, cid);
      if (visibili != null && !visibili.includes(body.magazzinoId)) {
        res.status(403).json({ error: "Magazzino non accessibile per il tuo centro" });
        return;
      }
    }
    if (bolla.stato !== "bozza") {
      res.status(400).json({ error: "Il magazzino si può cambiare solo quando la bolla è in bozza" });
      return;
    }
    const [targetMagazzino] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, body.magazzinoId));
    if (!targetMagazzino) { res.status(404).json({ error: "Magazzino non trovato" }); return; }
    if (targetMagazzino.stato !== "attivo") { res.status(400).json({ error: "Il Magazzino selezionato non è attivo" }); return; }
  }

  const row = await db.transaction(async (tx) => {
    if (body.magazzinoId && body.magazzinoId !== bolla.magazzinoId) {
      await tx.delete(bollaRigheTable).where(eq(bollaRigheTable.bollaId, bollaId));
    }
    const [updated] = await tx.update(bolleTable).set({ ...body, operatoreId: req.user!.id }).where(eq(bolleTable.id, bollaId)).returning();
    return updated;
  });

  const det = await buildDettaglio(row.id);
  res.json(det);
});

// ─── RIGHE — ADD ─────────────────────────────────────────────────────────────

router.post("/bolle/:id/righe", requirePermission("bolle.manage"), async (req, res) => {
  const bollaId = Number(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!(await canAccessBollaOperativa(bolla, callerCentroId(req), callerAreaOperativaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const { prodottoId, lottoId, quantita, unitaMisura, note } = req.body ?? {};
  if (!Number.isInteger(prodottoId) || prodottoId <= 0) {
    res.status(400).json({ error: "Prodotto non valido" });
    return;
  }
  if (lottoId != null && (!Number.isInteger(lottoId) || lottoId <= 0)) {
    res.status(400).json({ error: "Lotto non valido" });
    return;
  }
  let quantitaContabile: InventoryDecimal;
  try {
    quantitaContabile = positiveInventoryDecimal(quantita);
  } catch (error) {
    if (error instanceof InventoryDecimalError) {
      res.status(400).json({ error: "Quantità non valida" });
      return;
    }
    throw error;
  }
  if (!STATI_MODIFICABILI.includes(bolla.stato)) {
    res.status(400).json({ error: "Le righe della bolla sono modificabili solo in stato bozza" });
    return;
  }

  const [prod] = await db.select().from(prodottiTable).where(eq(prodottiTable.id, prodottoId));
  if (!prod || !prod.attivo) {
    res.status(400).json({ error: "Prodotto non trovato o non attivo" });
    return;
  }

  if (lottoId != null) {
    const [lotto] = await db.select().from(lottiTable).where(and(
      eq(lottiTable.id, lottoId),
      eq(lottiTable.magazzinoId, bolla.magazzinoId),
    ));
    if (!lotto) { res.status(404).json({ error: "Lotto non trovato per il Magazzino della Bolla" }); return; }
    if (lotto.prodottoId !== prodottoId) {
      res.status(400).json({ error: "Il lotto selezionato non appartiene al prodotto richiesto" });
      return;
    }
    if (!isLottoDistribuibile(lotto.dataScadenza)) {
      res.status(409).json({ error: "Il lotto selezionato è scaduto e non può essere distribuito" });
      return;
    }
    const giaInBollaLotto = bolla.stato === "bozza" ? await quantitaGiaInBollaLotto(bollaId, lottoId) : InventoryDecimal.zero();
    const [impegno] = await db
      .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
      .from(prenotazioniMagazzinoTable)
      .where(and(
        eq(prenotazioniMagazzinoTable.lottoId, lottoId),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
      ));
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
    const disponibile = await giacenzaDisponibile(prodottoId, bolla.magazzinoId);
    const giainBolla = bolla.stato === "bozza" ? await quantitaGiaInBolla(bollaId, prodottoId) : InventoryDecimal.zero();
    const netta = disponibile.subtract(giainBolla);
    if (netta.compare(quantitaContabile) < 0) {
      res.status(400).json({
        error: `Disponibilità insufficiente per ${prod?.nome ?? "prodotto"}: ${(netta.isNegative() ? InventoryDecimal.zero() : netta).toCanonical()} disponibili (giacenza ${disponibile.toCanonical()} − già in bolla ${giainBolla.toCanonical()}), richiesti ${quantitaContabile.toCanonical()}`,
      });
      return;
    }
  }

  const [riga] = await db.insert(bollaRigheTable).values({
    bollaId,
    prodottoId,
    lottoId: lottoId ?? null,
    quantita: quantitaContabile.toDb(),
    unitaMisura: unitaMisura ?? prod?.unitaMisura ?? "pz",
    note: note ?? null,
  }).returning();

  // stampa l'operatore PRIMA del sync così l'intervento collegato eredita
  // l'operatore corrente (syncInterventoBolla rilegge bolla.operatoreId)
  await db.update(bolleTable).set({ operatoreId: req.user!.id }).where(eq(bolleTable.id, bollaId));

  const lotto = riga.lottoId ? (await db.select().from(lottiTable).where(eq(lottiTable.id, riga.lottoId)))[0] : null;

  res.status(201).json({
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
  });
});

// ─── RIGHE — DELETE ───────────────────────────────────────────────────────────

router.delete("/bolle/:id/righe/:rigaId", requirePermission("bolle.manage"), async (req, res) => {
  const bollaId = Number(req.params.id);
  const rigaId = Number(req.params.rigaId);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!(await canAccessBollaOperativa(bolla, callerCentroId(req), callerAreaOperativaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!STATI_MODIFICABILI.includes(bolla.stato)) {
    res.status(400).json({ error: "Le righe della bolla sono modificabili solo in stato bozza" });
    return;
  }

  const [riga] = await db.select().from(bollaRigheTable)
    .where(and(eq(bollaRigheTable.id, rigaId), eq(bollaRigheTable.bollaId, bollaId)));
  if (!riga) { res.status(404).json({ error: "Riga non trovata" }); return; }

  await db.delete(bollaRigheTable).where(eq(bollaRigheTable.id, rigaId));

  // stampa l'operatore PRIMA del sync così l'intervento collegato eredita
  // l'operatore corrente (syncInterventoBolla rilegge bolla.operatoreId)
  await db.update(bolleTable).set({ operatoreId: req.user!.id }).where(eq(bolleTable.id, bollaId));

  res.status(204).end();
});

// ─── CONFERMA (bozza → confermato + prenotazione FEFO) ───────────────────────

router.post("/bolle/:id/conferma", requirePermission("bolle.deliver"), async (req, res) => {
  const bollaId = Number(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!(await canAccessBollaOperativa(bolla, callerCentroId(req), callerAreaOperativaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      const current = await lockBolla(tx, bollaId);
      await requireOperationalMagazzino(tx, current.magazzinoId);
      if (current.stato !== "bozza") {
        throw new BollaActionError(400, "La bolla non è in stato bozza");
      }

      const righe = await tx.select().from(bollaRigheTable).where(eq(bollaRigheTable.bollaId, bollaId));
      if (righe.length === 0) {
        throw new BollaActionError(400, "Impossibile confermare una bolla senza prodotti");
      }

      for (const riga of righe) {
        await prenotaRigaFEFO(tx, current, riga);
      }

      await tx.update(bolleTable)
        .set({ stato: "confermato", operatoreId: req.user!.id })
        .where(eq(bolleTable.id, bollaId));
    });
  } catch (err) {
    if (handleBollaActionError(err, res)) return;
    if (err instanceof InventoryLedgerError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }

  const det = await buildDettaglio(bollaId);
  res.json(det);
});

// ─── CONSEGNA (confermato → consegnato) ──────────────────────────────────────

router.post("/bolle/:id/consegna", requirePermission("bolle.deliver"), async (req, res) => {
  const bollaId = Number(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!(await canAccessBollaOperativa(bolla, callerCentroId(req), callerAreaOperativaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

  const { noteRicezione, confermaRicezione } = req.body ?? {};

  try {
    await completeBollaDelivery({
      bollaId,
      userId: req.user!.id,
      noteRicezione,
      confermaRicezione,
      beneficiaryAccessScope: beneficiarioAccessScopeFromRequest(req),
    });
  } catch (err) {
    if (handleBollaActionError(err, res)) return;
    if (err instanceof InventoryLedgerError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }

  const det = await buildDettaglio(bollaId);
  res.json(det);
});

// ─── ESITO RITIRO (separato dallo stato logistico) ──────────────────────────

router.post("/bolle/:id/ritiro-non-effettuato", requirePermission("bolle.deliver"), async (req, res) => {
  const bollaId = Number(req.params.id);
  if (!Number.isInteger(bollaId) || bollaId <= 0) {
    res.status(400).json({ error: "ID bolla non valido" }); return;
  }
  const motivoRaw = req.body?.motivo;
  if (motivoRaw != null && typeof motivoRaw !== "string") {
    res.status(400).json({ error: "Il motivo deve essere testuale" }); return;
  }
  const motivo = typeof motivoRaw === "string" ? motivoRaw.trim() || null : null;
  if (motivo && motivo.length > 500) {
    res.status(400).json({ error: "Il motivo non può superare 500 caratteri" }); return;
  }
  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!(await canAccessBollaOperativa(bolla, callerCentroId(req), callerAreaOperativaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" }); return;
  }
  try {
    const recorded = await db.transaction(async (tx) => {
      const current = await lockBolla(tx, bollaId);
      if (current.consegnaId != null) throw new BollaActionError(409, "La bolla è già associata a una consegna");
      if (current.stato !== "confermato") throw new BollaActionError(409, "Il ritiro non effettuato è registrabile solo su una bolla confermata per il ritiro in sede");
      if (current.ritiroNonEffettuatoAt != null) return false;
      await tx.update(bolleTable).set({
        ritiroNonEffettuatoAt: new Date(),
        ritiroNonEffettuatoOperatoreId: req.user!.id,
        ritiroNonEffettuatoMotivo: motivo,
        operatoreId: req.user!.id,
      }).where(eq(bolleTable.id, bollaId));
      return true;
    });
    if (recorded) logger.info({ bollaId, operatoreId: req.user!.id }, "Ritiro bolla segnato come non effettuato");
  } catch (error) {
    if (handleBollaActionError(error, res)) return;
    throw error;
  }
  res.json(await buildDettaglio(bollaId));
});

router.post(
  "/bolle/:id/converti-consegna",
  requireAllModuli(["CENTRO_ASCOLTO", "CONSEGNE"]),
  requirePermission("bolle.deliver"),
  async (req, res) => {
  const bollaId = Number(req.params.id);
  if (!Number.isInteger(bollaId) || bollaId <= 0) {
    res.status(400).json({ error: "ID bolla non valido" }); return;
  }
  const body = req.body ?? {};
  const indirizzoConsegna = typeof body.indirizzoConsegna === "string" ? body.indirizzoConsegna.trim() : "";
  if (!indirizzoConsegna || indirizzoConsegna.length > 200) {
    res.status(400).json({ error: "Indirizzo di consegna obbligatorio (massimo 200 caratteri)" }); return;
  }
  if (!isDateOnly(body.dataPrevista)) {
    res.status(400).json({ error: "dataPrevista deve essere una data YYYY-MM-DD" }); return;
  }
  const fasciaOraria = body.fasciaOraria === undefined || body.fasciaOraria === null
    ? null
    : typeof body.fasciaOraria === "string" && isFasciaConsegna(body.fasciaOraria.trim())
      ? body.fasciaOraria.trim()
      : undefined;
  if (fasciaOraria === undefined) {
    res.status(400).json({ error: "fasciaOraria non valida: usare Mattina, Pomeriggio o Sera" }); return;
  }
  const requestedVolontarioId = body.volontarioId === undefined
    ? undefined
    : body.volontarioId === null
      ? null
      : Number.isInteger(body.volontarioId) && body.volontarioId > 0
        ? body.volontarioId
        : false;
  if (requestedVolontarioId === false) {
    res.status(400).json({ error: "volontarioId non valido" }); return;
  }
  const requestedMezzoId = body.mezzoId === undefined
    ? undefined
    : body.mezzoId === null
      ? null
      : Number.isInteger(body.mezzoId) && body.mezzoId > 0
        ? body.mezzoId
        : false;
  if (requestedMezzoId === false) {
    res.status(400).json({ error: "mezzoId non valido" }); return;
  }
  if (body.mezzoAltro !== undefined && typeof body.mezzoAltro !== "boolean") {
    res.status(400).json({ error: "mezzoAltro deve essere booleano" }); return;
  }
  if (body.volontarioAltro !== undefined && body.volontarioAltro !== null && typeof body.volontarioAltro !== "string") {
    res.status(400).json({ error: "volontarioAltro deve essere testuale o NULL" }); return;
  }
  if (body.noteOperative !== undefined && body.noteOperative !== null && typeof body.noteOperative !== "string") {
    res.status(400).json({ error: "noteOperative deve essere testuale o NULL" }); return;
  }
  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!(await canAccessBollaOperativa(bolla, callerCentroId(req), callerAreaOperativaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" }); return;
  }
  const preliminaryVolontarioId = requestedVolontarioId === undefined ? bolla.volontarioConsegnaId : requestedVolontarioId;
  const preliminaryMezzoId = requestedMezzoId === undefined ? bolla.mezzoId : requestedMezzoId;
  const preliminaryMezzoAltro = body.mezzoAltro !== undefined
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
  let result: { consegna: typeof consegneTable.$inferSelect; existing: boolean };
  try {
    result = await db.transaction(async (tx) => {
      let linkedBefore: typeof consegneTable.$inferSelect | undefined;
      let planning: Awaited<ReturnType<typeof lockConsegnaPlanningContextTx>>;
      if (bolla.consegnaId != null) {
        [linkedBefore] = await tx.select().from(consegneTable)
          .where(eq(consegneTable.id, bolla.consegnaId)).for("update");
        if (!linkedBefore) throw new BollaActionError(409, "La bolla risulta già convertita ma la consegna collegata non è disponibile");
        planning = await lockConsegnaPlanningContextTx(tx, linkedBefore, linkedBefore);
      } else {
        planning = await lockConsegnaPlanningContextTx(tx, null, preliminaryPlanningInput);
      }
      const current = await lockBolla(tx, bollaId);
      if (current.ritiroNonEffettuatoAt == null) throw new BollaActionError(409, "La bolla non è marcata come ritiro non effettuato");
      if (current.stato !== "confermato") throw new BollaActionError(409, "La bolla non è più convertibile");
      if (current.consegnaId != null) {
        const [linked] = linkedBefore?.id === current.consegnaId
          ? [linkedBefore]
          : await tx.select().from(consegneTable).where(eq(consegneTable.id, current.consegnaId));
        if (!linked) throw new BollaActionError(409, "La bolla risulta già convertita ma la consegna collegata non è disponibile");
        if (linkedBefore?.id !== linked.id) return { consegna: linked, existing: true };
        await validateConsegnaPlanningTx(tx, linked, { excludeConsegnaId: linked.id, context: planning.nuovo ?? undefined });
        await reconcileConsegnaPlanningTx(tx, linked, linked, req, planning.nuovo);
        return { consegna: linked, existing: true };
      }
      if (linkedBefore != null) throw new BollaActionError(409, PLANNING_CONCURRENCY_MESSAGE);
      const volontarioId = requestedVolontarioId === undefined ? current.volontarioConsegnaId : requestedVolontarioId;
      const volontarioAltro = body.volontarioAltro === undefined
        ? current.trasportatoreNome
        : typeof body.volontarioAltro === "string"
          ? body.volontarioAltro.trim() || null
          : null;
      const mezzoId = requestedMezzoId === undefined ? current.mezzoId : requestedMezzoId;
      const mezzoAltro = body.mezzoAltro !== undefined
        ? body.mezzoAltro
        : requestedMezzoId === undefined
          ? current.mezzoAltro
          : false;
      if (volontarioId != null && volontarioAltro) {
        throw new ConsegnaPlanningError(400, "Indicare un volontario censito oppure Altro, non entrambi");
      }
      if (mezzoId != null && mezzoAltro) {
        throw new ConsegnaPlanningError(400, "Indicare un mezzo censito oppure Altro, non entrambi");
      }
      const planningInput = {
        beneficiarioId: current.beneficiarioId,
        dataPrevista: body.dataPrevista,
        fasciaOraria,
        volontarioId,
        mezzoId,
        mezzoAltro,
      };
      await validateConsegnaPlanningTx(tx, planningInput, { context: planning.nuovo ?? undefined });
      const codice = `CON-${Date.now()}-${bollaId}`.slice(0, 30);
      const [created] = await tx.insert(consegneTable).values({
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
        noteOperative: typeof body.noteOperative === "string" ? body.noteOperative.trim() || null : null,
      }).returning();
      await tx.update(bolleTable).set({
        consegnaId: created.id,
        indirizzoConsegna,
        operatoreId: req.user!.id,
      }).where(eq(bolleTable.id, bollaId));
      await reconcileConsegnaPlanningTx(tx, null, created, req, planning.nuovo);
      return { consegna: created, existing: false };
    });
  } catch (error) {
    if (isPlanningConcurrencyError(error)) {
      res.status(409).json({ error: PLANNING_CONCURRENCY_MESSAGE }); return;
    }
    if (error instanceof ConsegnaPlanningError) {
      res.status(error.status).json({ error: error.message }); return;
    }
    if (handleBollaActionError(error, res)) return;
    throw error;
  }
  if (!result.existing) logger.info({ bollaId, consegnaId: result.consegna.id, operatoreId: req.user!.id }, "Bolla convertita in consegna domiciliare");
  res.status(result.existing ? 200 : 201).json({ created: !result.existing, consegnaId: result.consegna.id, codice: result.consegna.codice });
  },
);

// ─── ANNULLA ──────────────────────────────────────────────────────────────────

router.post("/bolle/:id/annulla", requirePermission("bolle.cancel"), async (req, res) => {
  const bollaId = Number(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!(await canAccessBollaOperativa(bolla, callerCentroId(req), callerAreaOperativaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      const current = await lockBolla(tx, bollaId);
      if (current.stato === "annullato") {
        throw new BollaActionError(400, "La bolla è già annullata");
      }

      const activePrenotazioni = await tx
        .select({ id: prenotazioniMagazzinoTable.id })
        .from(prenotazioniMagazzinoTable)
        .where(and(
          eq(prenotazioniMagazzinoTable.bollaId, bollaId),
          eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
        ));

      if (current.stato === "confermato" && activePrenotazioni.length > 0) {
        await tx.update(prenotazioniMagazzinoTable)
          .set({ stato: PRENOTAZIONE_RILASCIATA, updatedAt: new Date() })
          .where(and(
            eq(prenotazioniMagazzinoTable.bollaId, bollaId),
            eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
          ));
      } else if (current.stato === "confermato" || current.stato === "consegnato") {
        const scarichi = await scarichiFisiciBolla(tx, bollaId);
        if (scarichi > 0) {
          const righe = await tx.select().from(bollaRigheTable).where(eq(bollaRigheTable.bollaId, bollaId));
          for (const riga of righe) {
            await stornoRigaTx(tx, riga, bollaId, req.user!.id);
          }
        }
      }

      // se era consegnata e collegata a una consegna effettuata, riportiamo la
      // consegna a "pianificata" così i dati restano coerenti dopo lo storno.
      if (current.stato === "consegnato" && current.consegnaId != null) {
        await tx.update(consegneTable)
          .set({ stato: "pianificata", dataEffettuata: null })
          .where(and(eq(consegneTable.id, current.consegnaId), eq(consegneTable.stato, "effettuata")));
      }

      const motivoIntervento =
        typeof req.body?.motivo === "string" && req.body.motivo.trim()
          ? `Annullamento Bolla ${current.numeroBolla}: ${req.body.motivo.trim()}`
          : `Annullamento Bolla ${current.numeroBolla}`;
      await annullaInterventoDaBollaTx(
        tx,
        bollaId,
        req.user!.id,
        motivoIntervento,
      );
      await tx.update(bolleTable).set({ stato: "annullato", operatoreId: req.user!.id }).where(eq(bolleTable.id, bollaId));
    });
  } catch (err) {
    if (handleBollaActionError(err, res)) return;
    throw err;
  }

  const det = await buildDettaglio(bollaId);
  res.json(det);
});

export default router;
