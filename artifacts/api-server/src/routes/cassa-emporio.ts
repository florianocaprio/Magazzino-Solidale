import { Router, type IRouter } from "express";
import {
  beneficiariTable,
  centriAscoltoTable,
  consegneTable,
  areeOperativeTable,
  db,
  lottiTable,
  magazziniTable,
  prodottiTable,
  sessioniCassaEmporioRigheTable,
  sessioniCassaEmporioTable,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  ne,
  or,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
  callerZonaUdsId,
  canAccessMagazzino,
  canUseBeneficiario,
  centroScopeFilter,
  areaOperativaScopeFilter,
  magazzinoScopeFilter,
  visibleMagazzinoIds,
  zonaUdsScopeFilter,
} from "../lib/centroScope";
import {
  calcolaDisponibilitaMagazzino,
  parseDbNumber,
} from "../lib/disponibilitaMagazzino";
import {
  EMPORIO_DISABLED_MSG,
  isEmporioEnabled,
} from "../lib/impostazioniModuli";
import { requireModulo } from "../lib/featureFlags";
import {
  chiudiSessioneCassaEmporio,
  getSpesaEmporio,
  quantitaNettaMensileProdottoPrecisa,
  SpesaEmporioError,
} from "../lib/speseEmporio";
import { lottoDistribuibileCondition } from "../lib/lottoPolicy";
import { requirePermission } from "../middlewares/auth";
import { dataCivileEuropeRome } from "../lib/interventiWorkflow";
import {
  dateTimeEuropeRomeToUtc,
  intervalloGiornoEuropeRome,
} from "../lib/interventiViste";
import { auditEmporioTx } from "../lib/emporioAudit";
import { quantitaCompatibileConUnitaMisuraEmporio } from "../lib/emporioQuantita";
import {
  InventoryDecimal,
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "../lib/inventoryDecimal";

const router: IRouter = Router();
router.use(
  "/cassa-emporio",
  requireModulo("EMPORIO_SOLIDALE", EMPORIO_DISABLED_MSG),
);

const TIPO_ACCESSO = "accesso_emporio";
const STATI_ACCESSO_VALIDI = [
  "pianificato",
  "confermato",
  "effettuato",
] as const;
const STATI_SESSIONE = [
  "aperta",
  "sospesa",
  "annullata",
  "pronta_per_chiusura",
  "chiusa",
] as const;
const STATI_SESSIONE_NON_DUPLICABILI = [
  "aperta",
  "sospesa",
  "pronta_per_chiusura",
  "chiusa",
] as const;

type StatoSessione = (typeof STATI_SESSIONE)[number];
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MSG_SESSIONE_GIA_APERTA =
  "Esiste già una sessione Cassa Emporio aperta per questo Accesso Emporio.";
const MSG_SESSIONE_NON_TROVATA =
  "Sessione Cassa Emporio non trovata. Verifica la sessione selezionata e riprova.";
const MSG_RIGA_NON_TROVATA =
  "Riga carrello Emporio non trovata. Aggiorna la sessione e riprova.";
const MSG_ACCESSO_NON_VALIDO =
  "Accesso Emporio non valido per la Cassa. Verifica che l'accesso sia pianificato o confermato e non sia annullato o non presentato.";
const MSG_BENEFICIARIO_NON_ATTIVO = "Il beneficiario non è attivo.";
const MSG_CENTRO_RICHIESTO =
  "Per effettuare l'accesso Emporio è necessario associare il beneficiario a un Centro di Ascolto.";
const MSG_CREDITO_RICHIESTO =
  "Il beneficiario non è abilitato al Credito Solidale.";
const MSG_CREDITO_NON_ATTIVO =
  "Il Credito Solidale del beneficiario non è attivo.";
const MSG_MAGAZZINO_EMPORIO =
  "La Cassa Emporio può essere aperta solo su un magazzino di tipo Emporio o Misto.";
const MSG_PRODOTTO_NON_TROVATO =
  "Prodotto non trovato. Verifica il codice a barre o cerca il prodotto per nome.";
const MSG_PRODOTTO_NON_ABILITATO =
  "Il prodotto non è abilitato per Emporio. Abilitalo nella scheda prodotto prima di aggiungerlo al carrello.";
const MSG_PRODOTTO_SENZA_CREDITO =
  "Il prodotto non ha un Valore Credito Solidale configurato. Imposta il valore nella scheda prodotto.";
const MSG_QUANTITA_PZ_INTERA =
  'I prodotti con unità di misura "pz" richiedono una quantità intera positiva.';
const MSG_GIACENZA_INSUFFICIENTE =
  "La quantità richiesta supera la giacenza disponibile nel magazzino Emporio selezionato.";
const MSG_LIMITE_SPESA =
  "La quantità supera il limite previsto per singola spesa.";
const MSG_LIMITE_MENSILE =
  "La quantità supera il limite mensile previsto per questo prodotto.";
const MSG_SALDO_INSUFFICIENTE =
  "Saldo Credito Solidale insufficiente. Riduci il carrello o effettua una ricarica prima della chiusura.";
const MSG_SESSIONE_PRONTA = "Sessione pronta per la chiusura.";

class CassaEmporioError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function expectedVersion(body: unknown): number | null {
  const value = (body as { versione?: unknown } | null)?.versione;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function databaseErrorCode(error: unknown): unknown {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  return candidate?.code ?? candidate?.cause?.code;
}

function handleCassaError(
  error: unknown,
  res: import("express").Response,
): boolean {
  if (
    error instanceof CassaEmporioError ||
    error instanceof SpesaEmporioError
  ) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

async function lockSessioneTx(tx: Tx, id: number) {
  await tx.execute(
    sql`SELECT id FROM ${sessioniCassaEmporioTable} WHERE ${sessioniCassaEmporioTable.id} = ${id} FOR UPDATE`,
  );
  const [sessione] = await tx
    .select()
    .from(sessioniCassaEmporioTable)
    .where(eq(sessioniCassaEmporioTable.id, id));
  return sessione ?? null;
}

function assertExpectedVersion(
  sessione: typeof sessioniCassaEmporioTable.$inferSelect,
  versione: number,
) {
  if (sessione.versione !== versione) {
    throw new CassaEmporioError(
      409,
      "La Sessione Cassa Emporio è stata modificata da un altro operatore. Aggiorna i dati e riprova.",
    );
  }
}

async function mutateSessioneLocked(
  req: import("express").Request,
  id: number,
  versione: number,
  allowedStates: readonly StatoSessione[],
  action: string,
  mutation: (
    tx: Tx,
    sessione: typeof sessioniCassaEmporioTable.$inferSelect,
  ) => Promise<typeof sessioniCassaEmporioTable.$inferSelect>,
) {
  return db.transaction(async (tx) => {
    const sessione = await lockSessioneTx(tx, id);
    if (!sessione) throw new CassaEmporioError(404, MSG_SESSIONE_NON_TROVATA);
    assertExpectedVersion(sessione, versione);
    if (!allowedStates.includes(sessione.statoSessione as StatoSessione)) {
      throw new CassaEmporioError(
        409,
        `Operazione non consentita per una Sessione nello stato ${sessione.statoSessione}.`,
      );
    }
    const updated = await mutation(tx, sessione);
    await auditEmporioTx(tx, {
      entityType: "sessione",
      entityId: sessione.id,
      action,
      operatoreId: operatorId(req),
      ip: req.ip,
      before: { stato: sessione.statoSessione, versione: sessione.versione },
      after: { stato: updated.statoSessione, versione: updated.versione },
    });
    return updated;
  });
}

function asInt(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function asPositiveQuantity(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    const quantity = positiveInventoryDecimal(value);
    return quantity.compare(InventoryDecimal.parse("99999999.99")) <= 0
      ? quantity.toDb()
      : null;
  } catch (error) {
    if (error instanceof InventoryDecimalError) return null;
    throw error;
  }
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSearchToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function searchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function asMoney(value: number): string {
  return value.toFixed(2);
}

function dayBounds(value: string | null): { start: Date; end: Date } | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try {
    return intervalloGiornoEuropeRome(value);
  } catch {
    return null;
  }
}

function todayDate(): string {
  return dataCivileEuropeRome();
}

function parseAccessoDate(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return dataCivileEuropeRome(parsed);
  }
  return todayDate();
}

function operatorId(req: import("express").Request): number | null {
  const user = (req as unknown as { user?: { id?: unknown } }).user;
  return typeof user?.id === "number" ? user.id : null;
}

function isStatoSessione(value: unknown): value is StatoSessione {
  return (
    typeof value === "string" && STATI_SESSIONE.includes(value as StatoSessione)
  );
}

async function assertEmporioEnabled(
  res: import("express").Response,
): Promise<boolean> {
  if (await isEmporioEnabled()) return true;
  res.status(403).json({ error: EMPORIO_DISABLED_MSG });
  return false;
}

function validateBeneficiarioCassa(
  beneficiario: typeof beneficiariTable.$inferSelect | null,
): string | null {
  if (!beneficiario) return "Beneficiario non trovato.";
  if (!beneficiario.attivo) return MSG_BENEFICIARIO_NON_ATTIVO;
  if (beneficiario.centroAscoltoId == null) return MSG_CENTRO_RICHIESTO;
  if (!beneficiario.creditoSolidaleAbilitato) return MSG_CREDITO_RICHIESTO;
  if (beneficiario.creditoSolidaleStato !== "attivo")
    return MSG_CREDITO_NON_ATTIVO;
  return null;
}

async function validateMagazzinoEmporio(
  id: number,
  req: import("express").Request,
): Promise<
  | { error: string; status: number }
  | { magazzino: typeof magazziniTable.$inferSelect }
> {
  const [magazzino] = await db
    .select()
    .from(magazziniTable)
    .where(eq(magazziniTable.id, id));
  if (!magazzino || !["emporio", "misto"].includes(magazzino.tipoMagazzino))
    return { error: MSG_MAGAZZINO_EMPORIO, status: 400 };
  if (!(await canAccessMagazzino(id, callerCentroId(req), callerAreaOperativaId(req))))
    return {
      error: "Magazzino non accessibile per il tuo profilo",
      status: 403,
    };
  if (magazzino.stato !== "attivo")
    return { error: "L'Emporio selezionato non è attivo.", status: 400 };
  return { magazzino };
}

async function ensureSessioneAccessibile(
  sessione: typeof sessioniCassaEmporioTable.$inferSelect,
  req: import("express").Request,
  res: import("express").Response,
): Promise<boolean> {
  if (
    !(await canUseBeneficiario(
      sessione.beneficiarioId,
      callerCentroId(req),
      callerAreaOperativaId(req),
      callerZonaUdsId(req),
    ))
  ) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo profilo" });
    return false;
  }
  if (
    !(await canAccessMagazzino(
      sessione.magazzinoEmporioId,
      callerCentroId(req),
      callerAreaOperativaId(req),
    ))
  ) {
    res
      .status(403)
      .json({ error: "Magazzino non accessibile per il tuo profilo" });
    return false;
  }
  return true;
}

async function loadSessione(id: number) {
  const [sessione] = await db
    .select()
    .from(sessioniCassaEmporioTable)
    .where(eq(sessioniCassaEmporioTable.id, id));
  return sessione ?? null;
}

async function loadRighe(sessioneId: number) {
  return db
    .select()
    .from(sessioniCassaEmporioRigheTable)
    .where(eq(sessioniCassaEmporioRigheTable.sessioneCassaId, sessioneId))
    .orderBy(asc(sessioniCassaEmporioRigheTable.id));
}

function formatRiga(row: typeof sessioniCassaEmporioRigheTable.$inferSelect) {
  return {
    id: row.id,
    sessioneCassaId: row.sessioneCassaId,
    prodottoId: row.prodottoId,
    lottoId: row.lottoId,
    codiceProdotto: row.codiceProdotto,
    descrizioneProdotto: row.descrizioneProdotto,
    quantita: parseDbNumber(row.quantita),
    unitaMisura: row.unitaMisura,
    creditoUnitario: parseDbNumber(row.creditoUnitario),
    creditoTotale: parseDbNumber(row.creditoTotale),
    giacenzaDisponibileAlMomento:
      row.giacenzaDisponibileAlMomento == null
        ? null
        : parseDbNumber(row.giacenzaDisponibileAlMomento),
    limitePerSpesa:
      row.limitePerSpesa == null ? null : parseDbNumber(row.limitePerSpesa),
    limiteMensile:
      row.limiteMensile == null ? null : parseDbNumber(row.limiteMensile),
    superaLimitePerSpesa: row.superaLimitePerSpesa,
    superaLimiteMensile: row.superaLimiteMensile,
    superaGiacenza: row.superaGiacenza,
    note: row.note,
    dataCreazione: row.dataCreazione.toISOString(),
    dataAggiornamento: row.dataAggiornamento.toISOString(),
  };
}

async function formatSessione(
  sessione: typeof sessioniCassaEmporioTable.$inferSelect,
  includeRighe = false,
) {
  const [beneficiario] = await db
    .select()
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, sessione.beneficiarioId));
  const [magazzino] = await db
    .select()
    .from(magazziniTable)
    .where(eq(magazziniTable.id, sessione.magazzinoEmporioId));
  const [accesso] = await db
    .select()
    .from(consegneTable)
    .where(eq(consegneTable.id, sessione.accessoEmporioId));
  const righe = includeRighe ? await loadRighe(sessione.id) : [];
  const totaleCreditoPrevisto = parseDbNumber(sessione.totaleCreditoPrevisto);
  const saldoCreditoDisponibile =
    sessione.statoSessione === "chiusa"
      ? parseDbNumber(sessione.saldoCreditoIniziale)
      : parseDbNumber(
          beneficiario?.creditoSolidaleSaldo ?? sessione.saldoCreditoIniziale,
        );
  return {
    id: sessione.id,
    accessoEmporioId: sessione.accessoEmporioId,
    beneficiarioId: sessione.beneficiarioId,
    beneficiarioNome: beneficiario
      ? `${beneficiario.cognome} ${beneficiario.nome}`
      : null,
    beneficiarioCodice: beneficiario?.codice ?? null,
    centroAscoltoId: sessione.centroAscoltoId,
    areaOperativaId: sessione.areaOperativaId,
    magazzinoEmporioId: sessione.magazzinoEmporioId,
    magazzinoEmporioNome: magazzino?.nome ?? null,
    statoSessione: sessione.statoSessione,
    versione: sessione.versione,
    saldoCreditoIniziale: saldoCreditoDisponibile,
    totaleCreditoPrevisto,
    creditoResiduoPrevisto: saldoCreditoDisponibile - totaleCreditoPrevisto,
    statoAccessoEmporio: accesso?.statoAccessoEmporio ?? null,
    dataOraAccesso: accesso?.dataOraInizio?.toISOString() ?? null,
    operatoreAperturaId: sessione.operatoreAperturaId,
    operatoreUltimaModificaId: sessione.operatoreUltimaModificaId,
    dataApertura: sessione.dataApertura.toISOString(),
    dataUltimaModifica: sessione.dataUltimaModifica.toISOString(),
    dataSospensione: sessione.dataSospensione?.toISOString() ?? null,
    dataAnnullamento: sessione.dataAnnullamento?.toISOString() ?? null,
    dataChiusura: sessione.dataChiusura?.toISOString() ?? null,
    spesaEmporioId: sessione.spesaEmporioId,
    bollaId: sessione.bollaId,
    movimentoCreditoSolidaleId: sessione.movimentoCreditoSolidaleId,
    operatoreChiusuraId: sessione.operatoreChiusuraId,
    motivoAnnullamento: sessione.motivoAnnullamento,
    note: sessione.note,
    righe: righe.map(formatRiga),
  };
}

async function recalcSessioneTx(
  tx: Tx,
  sessione: typeof sessioniCassaEmporioTable.$inferSelect,
  operatoreUltimaModificaId: number | null,
) {
  const [totale] = await tx
    .select({
      creditoTotale: sum(sessioniCassaEmporioRigheTable.creditoTotale),
    })
    .from(sessioniCassaEmporioRigheTable)
    .where(eq(sessioniCassaEmporioRigheTable.sessioneCassaId, sessione.id));
  const [beneficiario] = await tx
    .select()
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, sessione.beneficiarioId));
  const totaleCreditoPrevisto = parseDbNumber(totale?.creditoTotale);
  const saldoCreditoIniziale = parseDbNumber(
    beneficiario?.creditoSolidaleSaldo ?? sessione.saldoCreditoIniziale,
  );
  const creditoResiduoPrevisto = saldoCreditoIniziale - totaleCreditoPrevisto;
  const riapriSessione = sessione.statoSessione === "pronta_per_chiusura";
  const [updated] = await tx
    .update(sessioniCassaEmporioTable)
    .set({
      ...(riapriSessione ? { statoSessione: "aperta" } : {}),
      saldoCreditoIniziale: asMoney(saldoCreditoIniziale),
      totaleCreditoPrevisto: asMoney(totaleCreditoPrevisto),
      creditoResiduoPrevisto: asMoney(creditoResiduoPrevisto),
      operatoreUltimaModificaId,
      dataUltimaModifica: new Date(),
      versione: sql`${sessioniCassaEmporioTable.versione} + 1`,
    })
    .where(eq(sessioniCassaEmporioTable.id, sessione.id))
    .returning();
  return updated;
}

async function quantitaProdottoInSessionePrecisa(
  executor: Tx | typeof db,
  sessioneId: number,
  prodottoId: number,
  excludeRigaId?: number,
): Promise<InventoryDecimal> {
  const conditions: SQL[] = [
    eq(sessioniCassaEmporioRigheTable.sessioneCassaId, sessioneId),
    eq(sessioniCassaEmporioRigheTable.prodottoId, prodottoId),
  ];
  if (excludeRigaId != null)
    conditions.push(ne(sessioniCassaEmporioRigheTable.id, excludeRigaId));
  const [row] = await executor
    .select({ quantita: sum(sessioniCassaEmporioRigheTable.quantita) })
    .from(sessioniCassaEmporioRigheTable)
    .where(and(...conditions));
  return InventoryDecimal.parse(row?.quantita ?? "0");
}

async function firstLottoId(
  executor: Tx | typeof db,
  prodottoId: number,
  magazzinoId: number,
): Promise<number | null> {
  const [lotto] = await executor
    .select({ id: lottiTable.id })
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.prodottoId, prodottoId),
        eq(lottiTable.magazzinoId, magazzinoId),
        gt(lottiTable.quantitaResidua, "0"),
        lottoDistribuibileCondition(),
      ),
    )
    .orderBy(asc(lottiTable.dataScadenza), asc(lottiTable.id))
    .limit(1);
  return lotto?.id ?? null;
}

async function buildRigaValues(
  executor: Tx | typeof db,
  sessione: typeof sessioniCassaEmporioTable.$inferSelect,
  prodottoId: number,
  quantita: string,
  excludeRigaId?: number,
) {
  const [prodotto] = await executor
    .select()
    .from(prodottiTable)
    .where(eq(prodottiTable.id, prodottoId));
  const creditoUnitario = parseDbNumber(prodotto?.creditoSolidaleValore);
  if (!prodotto || !prodotto.attivo) {
    return { error: MSG_PRODOTTO_NON_TROVATO, status: 400 } as const;
  }
  if (!prodotto.abilitatoEmporio)
    return { error: MSG_PRODOTTO_NON_ABILITATO, status: 400 } as const;
  if (creditoUnitario <= 0)
    return { error: MSG_PRODOTTO_SENZA_CREDITO, status: 400 } as const;
  if (!quantitaCompatibileConUnitaMisuraEmporio(quantita, prodotto.unitaMisura))
    return { error: MSG_QUANTITA_PZ_INTERA, status: 400 } as const;

  const quantity = InventoryDecimal.parse(quantita);
  const creditQuantity = Number(quantity.toCanonical());
  const otherQuantity = await quantitaProdottoInSessionePrecisa(
    executor,
    sessione.id,
    prodottoId,
    excludeRigaId,
  );
  const totalQuantityForProduct = otherQuantity.add(quantity);
  const limitePerSpesa =
    prodotto.quantitaMassimaPerSpesa == null
      ? null
      : InventoryDecimal.parse(prodotto.quantitaMassimaPerSpesa);
  const limiteMensile =
    prodotto.quantitaMassimaMensile == null
      ? null
      : InventoryDecimal.parse(prodotto.quantitaMassimaMensile);
  if (
    limitePerSpesa != null &&
    totalQuantityForProduct.compare(limitePerSpesa) > 0
  )
    return { error: MSG_LIMITE_SPESA, status: 400 } as const;
  const alreadyDistributed = await quantitaNettaMensileProdottoPrecisa(
    executor,
    sessione.beneficiarioId,
    prodottoId,
  );
  if (
    limiteMensile != null &&
    alreadyDistributed.add(totalQuantityForProduct).compare(limiteMensile) > 0
  )
    return { error: MSG_LIMITE_MENSILE, status: 400 } as const;

  const disponibilita = await calcolaDisponibilitaMagazzino(
    prodottoId,
    sessione.magazzinoEmporioId,
  );
  const disponibile = InventoryDecimal.parse(
    disponibilita.disponibileRealePrecisa,
    { allowNegative: true },
  );
  if (!disponibile.isPositive())
    return { error: MSG_GIACENZA_INSUFFICIENTE, status: 400 } as const;
  if (
    totalQuantityForProduct.compare(disponibile) > 0
  )
    return { error: MSG_GIACENZA_INSUFFICIENTE, status: 400 } as const;

  return {
    prodotto,
    values: {
      prodottoId,
      lottoId: await firstLottoId(
        executor,
        prodottoId,
        sessione.magazzinoEmporioId,
      ),
      codiceProdotto: prodotto.codiceBarre ?? prodotto.codice,
      descrizioneProdotto: prodotto.nome,
      quantita: quantity.toDb(),
      unitaMisura: prodotto.unitaMisura,
      creditoUnitario: asMoney(creditoUnitario),
      creditoTotale: asMoney(creditoUnitario * creditQuantity),
      giacenzaDisponibileAlMomento: asMoney(
        parseDbNumber(disponibile.toDb()),
      ),
      limitePerSpesa:
        limitePerSpesa == null
          ? null
          : asMoney(Number(limitePerSpesa.toCanonical())),
      limiteMensile:
        limiteMensile == null
          ? null
          : asMoney(Number(limiteMensile.toCanonical())),
      superaLimitePerSpesa: false,
      superaLimiteMensile: false,
      superaGiacenza: false,
    },
  } as const;
}

router.get(
  "/cassa-emporio/beneficiari/ricerca",
  requirePermission("emporio.cassa.view"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const query = req.query as Record<string, string>;
    const q = asText(query.search);
    const requestedAreaOperativaId = asInt(query.areaOperativaId ?? query.areaId);
    const magazzinoEmporioId = asInt(query.magazzinoEmporioId);
    const dateBounds = dayBounds(asText(query.data));
    if (!q && requestedAreaOperativaId == null && magazzinoEmporioId == null) {
      res.json([]);
      return;
    }
    let selectedMagazzino: typeof magazziniTable.$inferSelect | null = null;
    if (magazzinoEmporioId != null) {
      const magazzino = await validateMagazzinoEmporio(magazzinoEmporioId, req);
      if ("error" in magazzino) {
        res.status(magazzino.status).json({ error: magazzino.error });
        return;
      }
      selectedMagazzino = magazzino.magazzino;
      if (
        requestedAreaOperativaId != null &&
        selectedMagazzino.areaOperativaId != null &&
        selectedMagazzino.areaOperativaId !== requestedAreaOperativaId
      ) {
        res.json([]);
        return;
      }
    }

    const conditions: SQL[] = [
      eq(beneficiariTable.attivo, true),
      isNotNull(beneficiariTable.centroAscoltoId),
      eq(beneficiariTable.creditoSolidaleAbilitato, true),
      eq(beneficiariTable.creditoSolidaleStato, "attivo"),
    ];
    if (q) {
      const search = `%${q}%`;
      const normalized = normalizeSearchToken(q);
      const searchConditions: SQL[] = [
        ilike(beneficiariTable.nome, search),
        ilike(beneficiariTable.cognome, search),
        ilike(
          sql<string>`trim(coalesce(${beneficiariTable.cognome}, '') || ' ' || coalesce(${beneficiariTable.nome}, ''))`,
          search,
        ),
        ilike(
          sql<string>`trim(coalesce(${beneficiariTable.nome}, '') || ' ' || coalesce(${beneficiariTable.cognome}, ''))`,
          search,
        ),
        ilike(beneficiariTable.codice, search),
        ilike(beneficiariTable.codiceFiscale, search),
      ];
      const tokens = searchTokens(q);
      if (tokens.length > 1) {
        const tokenConditions = tokens.map((token) => {
          const textSearch = `%${token.length > 5 ? token.slice(0, 5) : token}%`;
          const exactSearch = `%${token}%`;
          return or(
            ilike(beneficiariTable.nome, textSearch),
            ilike(beneficiariTable.cognome, textSearch),
            ilike(beneficiariTable.codice, exactSearch),
            ilike(beneficiariTable.codiceFiscale, exactSearch),
          )!;
        });
        searchConditions.push(and(...tokenConditions)!);
      }
      if (normalized) {
        const normalizedSearch = `%${normalized}%`;
        searchConditions.push(
          ilike(
            sql<string>`regexp_replace(lower(coalesce(${beneficiariTable.codice}, '')), '[^a-z0-9]', '', 'g')`,
            normalizedSearch,
          ),
          ilike(
            sql<string>`regexp_replace(lower(coalesce(${beneficiariTable.codiceFiscale}, '')), '[^a-z0-9]', '', 'g')`,
            normalizedSearch,
          ),
        );
      }
      conditions.push(or(...searchConditions)!);
    }
    if (magazzinoEmporioId != null) {
      const accessoEmporioConditions: SQL[] = [
        eq(consegneTable.tipoPianificazione, TIPO_ACCESSO),
        eq(consegneTable.beneficiarioId, beneficiariTable.id),
        eq(consegneTable.magazzinoEmporioId, magazzinoEmporioId),
        inArray(consegneTable.statoAccessoEmporio, [...STATI_ACCESSO_VALIDI]),
      ];
      if (dateBounds != null) {
        accessoEmporioConditions.push(
          gte(consegneTable.dataOraInizio, dateBounds.start),
        );
        accessoEmporioConditions.push(
          lt(consegneTable.dataOraInizio, dateBounds.end),
        );
      }
      conditions.push(
        or(
          eq(beneficiariTable.magazzinoEmporioPreferitoId, magazzinoEmporioId),
          exists(
            db
              .select({ id: consegneTable.id })
              .from(consegneTable)
              .where(and(...accessoEmporioConditions)),
          ),
        )!,
      );
    } else if (requestedAreaOperativaId != null) {
      conditions.push(eq(beneficiariTable.areaOperativaId, requestedAreaOperativaId));
    } else if (!q && selectedMagazzino?.areaOperativaId != null) {
      conditions.push(eq(beneficiariTable.areaOperativaId, selectedMagazzino.areaOperativaId));
    }
    const centroFilter = centroScopeFilter(
      beneficiariTable.centroAscoltoId,
      callerCentroId(req),
    );
    if (centroFilter) conditions.push(centroFilter);
    const areaOperativaFilter = areaOperativaScopeFilter(
      beneficiariTable.areaOperativaId,
      callerAreaOperativaId(req),
    );
    if (areaOperativaFilter) conditions.push(areaOperativaFilter);
    const zonaFilter = zonaUdsScopeFilter(
      beneficiariTable.zonaUdsId,
      callerZonaUdsId(req),
    );
    if (zonaFilter) conditions.push(zonaFilter);

    const beneficiari = await db
      .select()
      .from(beneficiariTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(beneficiariTable.cognome), asc(beneficiariTable.nome))
      .limit(50);
    const results = [];
    for (const beneficiario of beneficiari) {
      const [magazzinoPreferito] =
        beneficiario.magazzinoEmporioPreferitoId == null
          ? []
          : await db
              .select({ id: magazziniTable.id, nome: magazziniTable.nome })
              .from(magazziniTable)
              .where(
                eq(magazziniTable.id, beneficiario.magazzinoEmporioPreferitoId),
              )
              .limit(1);
      const accessoConditions: SQL[] = [
        eq(consegneTable.tipoPianificazione, TIPO_ACCESSO),
        eq(consegneTable.beneficiarioId, beneficiario.id),
        inArray(consegneTable.statoAccessoEmporio, [...STATI_ACCESSO_VALIDI]),
      ];
      if (magazzinoEmporioId != null)
        accessoConditions.push(
          eq(consegneTable.magazzinoEmporioId, magazzinoEmporioId),
        );
      if (dateBounds != null) {
        accessoConditions.push(
          gte(consegneTable.dataOraInizio, dateBounds.start),
        );
        accessoConditions.push(lt(consegneTable.dataOraInizio, dateBounds.end));
      }
      const accessi = await db
        .select({
          id: consegneTable.id,
          magazzinoEmporioId: consegneTable.magazzinoEmporioId,
          magazzinoEmporioNome: magazziniTable.nome,
          dataOraInizio: consegneTable.dataOraInizio,
          dataOraFine: consegneTable.dataOraFine,
          statoAccessoEmporio: consegneTable.statoAccessoEmporio,
        })
        .from(consegneTable)
        .leftJoin(
          magazziniTable,
          eq(consegneTable.magazzinoEmporioId, magazziniTable.id),
        )
        .where(and(...accessoConditions))
        .orderBy(desc(consegneTable.dataOraInizio), desc(consegneTable.id));
      results.push({
        beneficiarioId: beneficiario.id,
        beneficiarioNome: `${beneficiario.cognome} ${beneficiario.nome}`,
        beneficiarioCodice: beneficiario.codice,
        beneficiarioCodiceFiscale: beneficiario.codiceFiscale,
        centroAscoltoId: beneficiario.centroAscoltoId,
        areaOperativaId: beneficiario.areaOperativaId,
        magazzinoEmporioPreferitoId: beneficiario.magazzinoEmporioPreferitoId,
        magazzinoEmporioPreferitoNome: magazzinoPreferito?.nome ?? null,
        saldoCreditoSolidale: parseDbNumber(beneficiario.creditoSolidaleSaldo),
        creditoSolidaleAbilitato: beneficiario.creditoSolidaleAbilitato,
        creditoSolidaleStato: beneficiario.creditoSolidaleStato,
        attivo: beneficiario.attivo,
        accessi: accessi.map((a) => ({
          id: a.id,
          magazzinoEmporioId: a.magazzinoEmporioId,
          magazzinoEmporioNome: a.magazzinoEmporioNome,
          dataOraInizio: a.dataOraInizio?.toISOString() ?? null,
          dataOraFine: a.dataOraFine?.toISOString() ?? null,
          statoAccessoEmporio: a.statoAccessoEmporio,
        })),
      });
    }
    res.json(results);
  },
);

router.get(
  "/cassa-emporio/prodotti/ricerca",
  requirePermission("emporio.cassa.view"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const query = req.query as Record<string, string>;
    const q = asText(query.search);
    const magazzinoEmporioId = asInt(query.magazzinoEmporioId);
    if (magazzinoEmporioId == null) {
      res.json([]);
      return;
    }
    const magazzino = await validateMagazzinoEmporio(magazzinoEmporioId, req);
    if ("error" in magazzino) {
      res.status(magazzino.status).json({ error: magazzino.error });
      return;
    }
    const conditions: SQL[] = [
      eq(lottiTable.magazzinoId, magazzinoEmporioId),
      gt(lottiTable.quantitaResidua, "0"),
      lottoDistribuibileCondition(),
      eq(prodottiTable.attivo, true),
      eq(prodottiTable.abilitatoEmporio, true),
      gt(prodottiTable.creditoSolidaleValore, "0"),
    ];
    if (q) {
      const search = `%${q}%`;
      conditions.push(
        or(
          ilike(prodottiTable.nome, search),
          ilike(prodottiTable.descrizione, search),
          ilike(prodottiTable.codice, search),
          ilike(prodottiTable.codiceBarre, search),
        )!,
      );
    }
    const rows = await db
      .select({
        id: prodottiTable.id,
        codice: prodottiTable.codice,
        codiceBarre: prodottiTable.codiceBarre,
        nome: prodottiTable.nome,
        descrizione: prodottiTable.descrizione,
        unitaMisura: prodottiTable.unitaMisura,
        creditoSolidaleValore: prodottiTable.creditoSolidaleValore,
        quantitaMassimaPerSpesa: prodottiTable.quantitaMassimaPerSpesa,
        quantitaMassimaMensile: prodottiTable.quantitaMassimaMensile,
        quantitaResiduaFisica: sum(lottiTable.quantitaResidua),
      })
      .from(lottiTable)
      .innerJoin(prodottiTable, eq(lottiTable.prodottoId, prodottiTable.id))
      .where(and(...conditions))
      .groupBy(
        prodottiTable.id,
        prodottiTable.codice,
        prodottiTable.codiceBarre,
        prodottiTable.nome,
        prodottiTable.descrizione,
        prodottiTable.unitaMisura,
        prodottiTable.creditoSolidaleValore,
        prodottiTable.quantitaMassimaPerSpesa,
        prodottiTable.quantitaMassimaMensile,
      )
      .orderBy(asc(prodottiTable.nome))
      .limit(q ? 20 : 50);

    const result = [];
    for (const prodotto of rows) {
      const disponibilita = await calcolaDisponibilitaMagazzino(
        prodotto.id,
        magazzinoEmporioId,
      );
      const giacenzaDisponibilePrecisa = InventoryDecimal.parse(
        disponibilita.disponibileRealePrecisa,
        { allowNegative: true },
      );
      if (!giacenzaDisponibilePrecisa.isPositive()) continue;
      const giacenzaDisponibile = parseDbNumber(
        giacenzaDisponibilePrecisa.toDb(),
      );
      result.push({
        prodottoId: prodotto.id,
        codice: prodotto.codice,
        codiceBarre: prodotto.codiceBarre,
        nome: prodotto.nome,
        descrizione: prodotto.descrizione,
        unitaMisura: prodotto.unitaMisura,
        creditoSolidaleValore: parseDbNumber(prodotto.creditoSolidaleValore),
        quantitaMassimaPerSpesa:
          prodotto.quantitaMassimaPerSpesa == null
            ? null
            : parseDbNumber(prodotto.quantitaMassimaPerSpesa),
        quantitaMassimaMensile:
          prodotto.quantitaMassimaMensile == null
            ? null
            : parseDbNumber(prodotto.quantitaMassimaMensile),
        giacenzaDisponibile,
      });
    }
    res.json(result);
  },
);

router.get(
  "/cassa-emporio/sessioni",
  requirePermission("emporio.cassa.view"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const q = req.query as Record<string, string>;
    const page = q.page == null ? 1 : Number(q.page);
    const limit = q.limit == null ? 50 : Number(q.limit);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      res.status(400).json({
        error:
          "Paginazione non valida: page >= 1 e limit compreso tra 1 e 100.",
      });
      return;
    }
    const conditions: SQL[] = [];
    if (isStatoSessione(q.statoSessione))
      conditions.push(
        eq(sessioniCassaEmporioTable.statoSessione, q.statoSessione),
      );
    if (q.magazzinoEmporioId)
      conditions.push(
        eq(
          sessioniCassaEmporioTable.magazzinoEmporioId,
          Number(q.magazzinoEmporioId),
        ),
      );
    const requestedAreaOperativaId = asInt(q.areaOperativaId ?? q.areaId);
    if (requestedAreaOperativaId != null)
      conditions.push(eq(sessioniCassaEmporioTable.areaOperativaId, requestedAreaOperativaId));
    const dateBounds = dayBounds(asText(q.data));
    if (dateBounds != null) {
      conditions.push(
        gte(sessioniCassaEmporioTable.dataApertura, dateBounds.start),
      );
      conditions.push(
        lt(sessioniCassaEmporioTable.dataApertura, dateBounds.end),
      );
    }
    if (q.beneficiarioSearch) {
      const s = `%${q.beneficiarioSearch}%`;
      conditions.push(
        or(
          ilike(beneficiariTable.nome, s),
          ilike(beneficiariTable.cognome, s),
          ilike(
            sql<string>`trim(coalesce(${beneficiariTable.cognome}, '') || ' ' || coalesce(${beneficiariTable.nome}, ''))`,
            s,
          ),
          ilike(
            sql<string>`trim(coalesce(${beneficiariTable.nome}, '') || ' ' || coalesce(${beneficiariTable.cognome}, ''))`,
            s,
          ),
          ilike(beneficiariTable.codice, s),
          ilike(beneficiariTable.codiceFiscale, s),
        )!,
      );
    }
    const centroFilter = centroScopeFilter(
      beneficiariTable.centroAscoltoId,
      callerCentroId(req),
    );
    if (centroFilter) conditions.push(centroFilter);
    const areaOperativaFilter = areaOperativaScopeFilter(
      beneficiariTable.areaOperativaId,
      callerAreaOperativaId(req),
    );
    if (areaOperativaFilter) conditions.push(areaOperativaFilter);
    const zonaFilter = zonaUdsScopeFilter(
      beneficiariTable.zonaUdsId,
      callerZonaUdsId(req),
    );
    if (zonaFilter) conditions.push(zonaFilter);
    const magazzinoFilter = magazzinoScopeFilter(
      sessioniCassaEmporioTable.magazzinoEmporioId,
      await visibleMagazzinoIds(callerCentroId(req), callerAreaOperativaId(req)),
    );
    if (magazzinoFilter) conditions.push(magazzinoFilter);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(sessioniCassaEmporioTable)
      .leftJoin(
        beneficiariTable,
        eq(sessioniCassaEmporioTable.beneficiarioId, beneficiariTable.id),
      )
      .where(where);
    const rows = await db
      .select({ s: sessioniCassaEmporioTable })
      .from(sessioniCassaEmporioTable)
      .leftJoin(
        beneficiariTable,
        eq(sessioniCassaEmporioTable.beneficiarioId, beneficiariTable.id),
      )
      .where(where)
      .orderBy(
        desc(sessioniCassaEmporioTable.dataUltimaModifica),
        desc(sessioniCassaEmporioTable.id),
      )
      .limit(limit)
      .offset((page - 1) * limit);
    res.setHeader("X-Total-Count", String(total));
    res.json(await Promise.all(rows.map((r) => formatSessione(r.s, false))));
  },
);

router.get(
  "/cassa-emporio/sessioni/:id",
  requirePermission("emporio.cassa.view"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const sessione = await loadSessione(Number(req.params.id));
    if (!sessione) {
      res.status(404).json({ error: MSG_SESSIONE_NON_TROVATA });
      return;
    }
    if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
    res.json(await formatSessione(sessione, true));
  },
);

router.post(
  "/cassa-emporio/accessi/:accessoEmporioId/apri-sessione",
  requirePermission("emporio.cassa.operate"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const accessoEmporioId = Number(req.params.accessoEmporioId);
    const [accesso] = await db
      .select()
      .from(consegneTable)
      .where(
        and(
          eq(consegneTable.id, accessoEmporioId),
          eq(consegneTable.tipoPianificazione, TIPO_ACCESSO),
        ),
      );
    if (
      !accesso ||
      !STATI_ACCESSO_VALIDI.includes(
        accesso.statoAccessoEmporio as (typeof STATI_ACCESSO_VALIDI)[number],
      ) ||
      accesso.magazzinoEmporioId == null
    ) {
      res.status(400).json({ error: MSG_ACCESSO_NON_VALIDO });
      return;
    }
    if (
      !(await canUseBeneficiario(
        accesso.beneficiarioId,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Beneficiario non accessibile per il tuo profilo" });
      return;
    }
    const [beneficiario] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, accesso.beneficiarioId));
    const beneficiarioError = validateBeneficiarioCassa(beneficiario ?? null);
    if (beneficiarioError) {
      res.status(400).json({ error: beneficiarioError });
      return;
    }
    const magazzino = await validateMagazzinoEmporio(
      accesso.magazzinoEmporioId,
      req,
    );
    if ("error" in magazzino) {
      res.status(magazzino.status).json({ error: magazzino.error });
      return;
    }
    if (magazzino.magazzino.areaOperativaId !== beneficiario!.areaOperativaId) {
      res.status(400).json({
        error: "L'Emporio deve appartenere alla stessa Area Operativa del Beneficiario.",
      });
      return;
    }
    const saldoCreditoIniziale = parseDbNumber(
      beneficiario!.creditoSolidaleSaldo,
    );
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('sessione-cassa-emporio'), ${accessoEmporioId})`,
        );
        await tx.execute(
          sql`SELECT id FROM ${consegneTable} WHERE ${consegneTable.id} = ${accessoEmporioId} FOR UPDATE`,
        );
        const [lockedAccess] = await tx
          .select()
          .from(consegneTable)
          .where(eq(consegneTable.id, accessoEmporioId));
        if (
          !lockedAccess ||
          !STATI_ACCESSO_VALIDI.includes(
            lockedAccess.statoAccessoEmporio as (typeof STATI_ACCESSO_VALIDI)[number],
          ) ||
          lockedAccess.magazzinoEmporioId == null
        ) {
          throw new CassaEmporioError(400, MSG_ACCESSO_NON_VALIDO);
        }
        const [lockedWarehouse] = await tx
          .select()
          .from(magazziniTable)
          .where(eq(magazziniTable.id, lockedAccess.magazzinoEmporioId));
        if (!lockedWarehouse || lockedWarehouse.stato !== "attivo") {
          throw new CassaEmporioError(
            400,
            "L'Emporio selezionato non è attivo.",
          );
        }
        const [duplicate] = await tx
          .select()
          .from(sessioniCassaEmporioTable)
          .where(
            and(
              eq(sessioniCassaEmporioTable.accessoEmporioId, accessoEmporioId),
              inArray(sessioniCassaEmporioTable.statoSessione, [
                ...STATI_SESSIONE_NON_DUPLICABILI,
              ]),
            ),
          )
          .limit(1);
        if (duplicate) return { created: false as const, sessione: duplicate };
        const [created] = await tx
          .insert(sessioniCassaEmporioTable)
          .values({
            accessoEmporioId,
            beneficiarioId: lockedAccess.beneficiarioId,
            magazzinoEmporioId: lockedAccess.magazzinoEmporioId,
            centroAscoltoId: beneficiario!.centroAscoltoId,
            areaOperativaId: beneficiario!.areaOperativaId,
            saldoCreditoIniziale: asMoney(saldoCreditoIniziale),
            totaleCreditoPrevisto: "0.00",
            creditoResiduoPrevisto: asMoney(saldoCreditoIniziale),
            operatoreAperturaId: operatorId(req),
            operatoreUltimaModificaId: operatorId(req),
            note: asText(req.body?.note),
          })
          .returning();
        if (
          lockedAccess.statoAccessoEmporio === "pianificato" ||
          lockedAccess.statoAccessoEmporio === "confermato"
        ) {
          await tx
            .update(consegneTable)
            .set({
              statoAccessoEmporio: "effettuato",
              stato: "effettuata",
              dataEffettuata: new Date(),
            })
            .where(eq(consegneTable.id, lockedAccess.id));
        }
        await auditEmporioTx(tx, {
          entityType: "sessione",
          entityId: created.id,
          action: "apertura",
          operatoreId: operatorId(req),
          ip: req.ip,
          after: { accessoEmporioId, stato: "aperta", versione: 1 },
        });
        return { created: true as const, sessione: created };
      });
      res
        .status(result.created ? 201 : 200)
        .json(await formatSessione(result.sessione, true));
    } catch (error) {
      if (error instanceof CassaEmporioError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (databaseErrorCode(error) === "23505") {
        res.status(409).json({ error: MSG_SESSIONE_GIA_APERTA });
        return;
      }
      throw error;
    }
  },
);

router.post(
  "/cassa-emporio/accessi/forza",
  requirePermission("emporio.cassa.force"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const beneficiarioId = asInt(req.body?.beneficiarioId);
    const magazzinoEmporioId = asInt(req.body?.magazzinoEmporioId);
    const motivo = asText(req.body?.motivoAccessoForzato ?? req.body?.motivo);
    const note = asText(req.body?.noteAccessoEmporio ?? req.body?.note);
    if (beneficiarioId == null || magazzinoEmporioId == null) {
      res
        .status(400)
        .json({ error: "Beneficiario ed Emporio sono obbligatori." });
      return;
    }
    if (!motivo) {
      res
        .status(400)
        .json({ error: "Il motivo dell'accesso forzato è obbligatorio." });
      return;
    }
    if (
      !(await canUseBeneficiario(
        beneficiarioId,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Beneficiario non accessibile per il tuo profilo" });
      return;
    }
    const [beneficiario] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, beneficiarioId));
    const beneficiarioError = validateBeneficiarioCassa(beneficiario ?? null);
    if (beneficiarioError) {
      res.status(400).json({ error: beneficiarioError });
      return;
    }
    const magazzino = await validateMagazzinoEmporio(magazzinoEmporioId, req);
    if ("error" in magazzino) {
      res.status(magazzino.status).json({ error: magazzino.error });
      return;
    }
    if (magazzino.magazzino.areaOperativaId !== beneficiario!.areaOperativaId) {
      res.status(400).json({
        error: "L'Emporio deve appartenere alla stessa Area Operativa del Beneficiario.",
      });
      return;
    }

    const date = parseAccessoDate(req.body?.data ?? req.body?.dataOraInizio);
    const now = new Date();
    const suppliedDateTime =
      typeof req.body?.dataOraInizio === "string"
        ? new Date(req.body.dataOraInizio)
        : null;
    const romeParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Rome",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(
      romeParts.find((part) => part.type === "hour")?.value ?? 0,
    );
    const minute = Number(
      romeParts.find((part) => part.type === "minute")?.value ?? 0,
    );
    const dataOraInizio =
      suppliedDateTime && !Number.isNaN(suppliedDateTime.getTime())
        ? suppliedDateTime
        : dateTimeEuropeRomeToUtc(date, hour, minute);
    const codice = `EMP-FOR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const saldoCreditoIniziale = parseDbNumber(
      beneficiario!.creditoSolidaleSaldo,
    );
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('sessione-forzata-emporio'), hashtext(${`${beneficiarioId}:${magazzinoEmporioId}`}))`,
        );
        const [duplicateSession] = await tx
          .select()
          .from(sessioniCassaEmporioTable)
          .where(
            and(
              eq(sessioniCassaEmporioTable.beneficiarioId, beneficiarioId),
              eq(
                sessioniCassaEmporioTable.magazzinoEmporioId,
                magazzinoEmporioId,
              ),
              inArray(sessioniCassaEmporioTable.statoSessione, [
                "aperta",
                "sospesa",
                "pronta_per_chiusura",
              ]),
            ),
          )
          .orderBy(desc(sessioniCassaEmporioTable.id))
          .limit(1);
        if (duplicateSession)
          return {
            duplicate: true as const,
            sessione: duplicateSession,
            accessoId: duplicateSession.accessoEmporioId,
          };
        const [accesso] = await tx
          .insert(consegneTable)
          .values({
            codice,
            beneficiarioId,
            tipoPianificazione: TIPO_ACCESSO,
            tipoConsegna: TIPO_ACCESSO,
            dataPrevista: date,
            magazzinoId: magazzinoEmporioId,
            magazzinoEmporioId,
            dataOraInizio,
            stato: "effettuata",
            statoAccessoEmporio: "effettuato",
            noteAccessoEmporio: note,
            origineAccesso: "forzato_da_cassa",
            accessoForzato: true,
            motivoAccessoForzato: motivo,
            dataOraEffettivaAccesso: now,
            dataEffettuata: now,
            operatoreAccessoEmporioId: operatorId(req),
          })
          .returning();
        const [sessione] = await tx
          .insert(sessioniCassaEmporioTable)
          .values({
            accessoEmporioId: accesso.id,
            beneficiarioId,
            magazzinoEmporioId,
            centroAscoltoId: beneficiario!.centroAscoltoId,
            areaOperativaId: beneficiario!.areaOperativaId,
            saldoCreditoIniziale: asMoney(saldoCreditoIniziale),
            totaleCreditoPrevisto: "0.00",
            creditoResiduoPrevisto: asMoney(saldoCreditoIniziale),
            operatoreAperturaId: operatorId(req),
            operatoreUltimaModificaId: operatorId(req),
            note,
          })
          .returning();
        await auditEmporioTx(tx, {
          entityType: "accesso",
          entityId: accesso.id,
          action: "accesso-forzato",
          operatoreId: operatorId(req),
          ip: req.ip,
          motivo,
          metadata: {
            sessioneId: sessione.id,
            beneficiarioId,
            magazzinoEmporioId,
          },
        });
        await auditEmporioTx(tx, {
          entityType: "sessione",
          entityId: sessione.id,
          action: "apertura-forzata",
          operatoreId: operatorId(req),
          ip: req.ip,
          motivo,
          after: { accessoEmporioId: accesso.id, stato: "aperta", versione: 1 },
        });
        return { duplicate: false as const, sessione, accessoId: accesso.id };
      });
      res.status(result.duplicate ? 200 : 201).json({
        accessoEmporioId: result.accessoId,
        origineAccesso: result.duplicate ? null : "forzato_da_cassa",
        sessione: await formatSessione(result.sessione, true),
        messaggio: result.duplicate
          ? "Sessione Cassa Emporio già aperta per il beneficiario selezionato."
          : "Accesso Emporio forzato creato e tracciato correttamente.",
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        res.status(409).json({
          error:
            "Esiste già un Accesso Emporio operativo per il Beneficiario nella data selezionata.",
        });
        return;
      }
      throw error;
    }
  },
);

router.post(
  "/cassa-emporio/sessioni/:id/righe",
  requirePermission("emporio.cassa.operate"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const sessione = await loadSessione(Number(req.params.id));
    if (!sessione) {
      res.status(404).json({ error: MSG_SESSIONE_NON_TROVATA });
      return;
    }
    if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
    const versione = expectedVersion(req.body);
    if (versione == null) {
      res
        .status(400)
        .json({ error: "La versione della Sessione è obbligatoria." });
      return;
    }
    const prodottoId = asInt(req.body?.prodottoId);
    const quantita = asPositiveQuantity(req.body?.quantita);
    if (prodottoId == null || quantita == null) {
      res.status(400).json({ error: "Prodotto e quantità sono obbligatori." });
      return;
    }
    try {
      const created = await db.transaction(async (tx) => {
        const locked = await lockSessioneTx(tx, sessione.id);
        if (!locked) throw new CassaEmporioError(404, MSG_SESSIONE_NON_TROVATA);
        assertExpectedVersion(locked, versione);
        if (!["aperta", "pronta_per_chiusura"].includes(locked.statoSessione)) {
          throw new CassaEmporioError(
            409,
            "La Sessione Cassa Emporio non è modificabile nello stato corrente.",
          );
        }
        const built = await buildRigaValues(tx, locked, prodottoId, quantita);
        if ("error" in built)
          throw new CassaEmporioError(
            built.status ?? 400,
            built.error ?? "Riga Cassa Emporio non valida.",
          );
        const [row] = await tx
          .insert(sessioniCassaEmporioRigheTable)
          .values({
            sessioneCassaId: locked.id,
            ...built.values,
            note: asText(req.body?.note),
          })
          .returning();
        await recalcSessioneTx(tx, locked, operatorId(req));
        await auditEmporioTx(tx, {
          entityType: "riga_sessione",
          entityId: row.id,
          action: "aggiunta",
          operatoreId: operatorId(req),
          ip: req.ip,
          after: {
            sessioneId: locked.id,
            prodottoId,
            quantita,
            unitaMisura: row.unitaMisura,
          },
        });
        return row;
      });
      res.status(201).json(formatRiga(created));
    } catch (error) {
      if (handleCassaError(error, res)) return;
      throw error;
    }
  },
);

router.patch(
  "/cassa-emporio/sessioni/:id/righe/:rigaId",
  requirePermission("emporio.cassa.operate"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const sessione = await loadSessione(Number(req.params.id));
    if (!sessione) {
      res.status(404).json({ error: MSG_SESSIONE_NON_TROVATA });
      return;
    }
    if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
    const versione = expectedVersion(req.body);
    if (versione == null) {
      res
        .status(400)
        .json({ error: "La versione della Sessione è obbligatoria." });
      return;
    }
    const rigaId = Number(req.params.rigaId);
    const quantita = asPositiveQuantity(req.body?.quantita);
    if (quantita == null) {
      res
        .status(400)
        .json({ error: "La quantità deve essere maggiore di zero." });
      return;
    }
    try {
      const updated = await db.transaction(async (tx) => {
        const locked = await lockSessioneTx(tx, sessione.id);
        if (!locked) throw new CassaEmporioError(404, MSG_SESSIONE_NON_TROVATA);
        assertExpectedVersion(locked, versione);
        if (!["aperta", "pronta_per_chiusura"].includes(locked.statoSessione)) {
          throw new CassaEmporioError(
            409,
            "La Sessione Cassa Emporio non è modificabile nello stato corrente.",
          );
        }
        const [existing] = await tx
          .select()
          .from(sessioniCassaEmporioRigheTable)
          .where(
            and(
              eq(sessioniCassaEmporioRigheTable.id, rigaId),
              eq(sessioniCassaEmporioRigheTable.sessioneCassaId, locked.id),
            ),
          );
        if (!existing) throw new CassaEmporioError(404, MSG_RIGA_NON_TROVATA);
        const built = await buildRigaValues(
          tx,
          locked,
          existing.prodottoId,
          quantita,
          existing.id,
        );
        if ("error" in built)
          throw new CassaEmporioError(
            built.status ?? 400,
            built.error ?? "Riga Cassa Emporio non valida.",
          );
        const [row] = await tx
          .update(sessioniCassaEmporioRigheTable)
          .set({
            ...built.values,
            note:
              "note" in (req.body ?? {})
                ? asText(req.body.note)
                : existing.note,
            dataAggiornamento: new Date(),
          })
          .where(eq(sessioniCassaEmporioRigheTable.id, existing.id))
          .returning();
        await recalcSessioneTx(tx, locked, operatorId(req));
        await auditEmporioTx(tx, {
          entityType: "riga_sessione",
          entityId: row.id,
          action: "modifica-quantita",
          operatoreId: operatorId(req),
          ip: req.ip,
          before: { quantita: parseDbNumber(existing.quantita) },
          after: { quantita, unitaMisura: row.unitaMisura },
        });
        return row;
      });
      res.json(formatRiga(updated));
    } catch (error) {
      if (handleCassaError(error, res)) return;
      throw error;
    }
  },
);

router.delete(
  "/cassa-emporio/sessioni/:id/righe/:rigaId",
  requirePermission("emporio.cassa.operate"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const sessione = await loadSessione(Number(req.params.id));
    if (!sessione) {
      res.status(404).json({ error: MSG_SESSIONE_NON_TROVATA });
      return;
    }
    if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
    const versione = expectedVersion(req.body);
    if (versione == null) {
      res
        .status(400)
        .json({ error: "La versione della Sessione è obbligatoria." });
      return;
    }
    const rigaId = Number(req.params.rigaId);
    try {
      const updated = await db.transaction(async (tx) => {
        const locked = await lockSessioneTx(tx, sessione.id);
        if (!locked) throw new CassaEmporioError(404, MSG_SESSIONE_NON_TROVATA);
        assertExpectedVersion(locked, versione);
        if (!["aperta", "pronta_per_chiusura"].includes(locked.statoSessione)) {
          throw new CassaEmporioError(
            409,
            "La Sessione Cassa Emporio non è modificabile nello stato corrente.",
          );
        }
        const [deleted] = await tx
          .delete(sessioniCassaEmporioRigheTable)
          .where(
            and(
              eq(sessioniCassaEmporioRigheTable.id, rigaId),
              eq(sessioniCassaEmporioRigheTable.sessioneCassaId, locked.id),
            ),
          )
          .returning();
        if (!deleted) throw new CassaEmporioError(404, MSG_RIGA_NON_TROVATA);
        const recalculated = await recalcSessioneTx(
          tx,
          locked,
          operatorId(req),
        );
        await auditEmporioTx(tx, {
          entityType: "riga_sessione",
          entityId: deleted.id,
          action: "rimozione",
          operatoreId: operatorId(req),
          ip: req.ip,
          before: {
            sessioneId: locked.id,
            prodottoId: deleted.prodottoId,
            quantita: parseDbNumber(deleted.quantita),
          },
        });
        return recalculated;
      });
      res.json(await formatSessione(updated, true));
    } catch (error) {
      if (handleCassaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/cassa-emporio/sessioni/:id/sospendi",
  requirePermission("emporio.cassa.operate"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const sessione = await loadSessione(Number(req.params.id));
    if (!sessione) {
      res.status(404).json({ error: MSG_SESSIONE_NON_TROVATA });
      return;
    }
    if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
    const versione = expectedVersion(req.body);
    if (versione == null) {
      res
        .status(400)
        .json({ error: "La versione della Sessione è obbligatoria." });
      return;
    }
    try {
      const updated = await mutateSessioneLocked(
        req,
        sessione.id,
        versione,
        ["aperta"],
        "sospensione",
        async (tx, locked) => {
          const [row] = await tx
            .update(sessioniCassaEmporioTable)
            .set({
              statoSessione: "sospesa",
              dataSospensione: new Date(),
              dataUltimaModifica: new Date(),
              operatoreUltimaModificaId: operatorId(req),
              versione: sql`${sessioniCassaEmporioTable.versione} + 1`,
            })
            .where(eq(sessioniCassaEmporioTable.id, locked.id))
            .returning();
          return row;
        },
      );
      res.json(await formatSessione(updated, true));
    } catch (error) {
      if (handleCassaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/cassa-emporio/sessioni/:id/riprendi",
  requirePermission("emporio.cassa.operate"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const sessione = await loadSessione(Number(req.params.id));
    if (!sessione) {
      res.status(404).json({ error: MSG_SESSIONE_NON_TROVATA });
      return;
    }
    if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
    const versione = expectedVersion(req.body);
    if (versione == null) {
      res
        .status(400)
        .json({ error: "La versione della Sessione è obbligatoria." });
      return;
    }
    try {
      const updated = await mutateSessioneLocked(
        req,
        sessione.id,
        versione,
        ["sospesa"],
        "ripresa",
        async (tx, locked) => {
          const [row] = await tx
            .update(sessioniCassaEmporioTable)
            .set({
              statoSessione: "aperta",
              dataUltimaModifica: new Date(),
              operatoreUltimaModificaId: operatorId(req),
              versione: sql`${sessioniCassaEmporioTable.versione} + 1`,
            })
            .where(eq(sessioniCassaEmporioTable.id, locked.id))
            .returning();
          return row;
        },
      );
      res.json(await formatSessione(updated, true));
    } catch (error) {
      if (handleCassaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/cassa-emporio/sessioni/:id/annulla",
  requirePermission("emporio.cassa.operate"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const sessione = await loadSessione(Number(req.params.id));
    if (!sessione) {
      res.status(404).json({ error: MSG_SESSIONE_NON_TROVATA });
      return;
    }
    if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
    const motivo = asText(req.body?.motivoAnnullamento);
    if (!motivo) {
      res.status(400).json({ error: "Il motivo annullamento è obbligatorio." });
      return;
    }
    const versione = expectedVersion(req.body);
    if (versione == null) {
      res
        .status(400)
        .json({ error: "La versione della Sessione è obbligatoria." });
      return;
    }
    try {
      const updated = await mutateSessioneLocked(
        req,
        sessione.id,
        versione,
        ["aperta", "sospesa", "pronta_per_chiusura"],
        "annullamento",
        async (tx, locked) => {
          const [row] = await tx
            .update(sessioniCassaEmporioTable)
            .set({
              statoSessione: "annullata",
              motivoAnnullamento: motivo,
              dataAnnullamento: new Date(),
              dataUltimaModifica: new Date(),
              operatoreUltimaModificaId: operatorId(req),
              versione: sql`${sessioniCassaEmporioTable.versione} + 1`,
            })
            .where(eq(sessioniCassaEmporioTable.id, locked.id))
            .returning();
          return row;
        },
      );
      res.json(await formatSessione(updated, true));
    } catch (error) {
      if (handleCassaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/cassa-emporio/sessioni/:id/pronta-per-chiusura",
  requirePermission("emporio.cassa.operate"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const sessione = await loadSessione(Number(req.params.id));
    if (!sessione) {
      res.status(404).json({ error: MSG_SESSIONE_NON_TROVATA });
      return;
    }
    if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
    const versione = expectedVersion(req.body);
    if (versione == null) {
      res
        .status(400)
        .json({ error: "La versione della Sessione è obbligatoria." });
      return;
    }
    try {
      const updated = await mutateSessioneLocked(
        req,
        sessione.id,
        versione,
        ["aperta"],
        "pronta-per-chiusura",
        async (tx, locked) => {
          const righe = await tx
            .select()
            .from(sessioniCassaEmporioRigheTable)
            .where(
              eq(sessioniCassaEmporioRigheTable.sessioneCassaId, locked.id),
            );
          if (righe.length === 0)
            throw new CassaEmporioError(400, "Il Carrello Emporio è vuoto.");
          const recalculated = await recalcSessioneTx(
            tx,
            locked,
            operatorId(req),
          );
          if (parseDbNumber(recalculated.creditoResiduoPrevisto) < 0)
            throw new CassaEmporioError(400, MSG_SALDO_INSUFFICIENTE);
          if (righe.some((r) => r.superaGiacenza))
            throw new CassaEmporioError(400, MSG_GIACENZA_INSUFFICIENTE);
          if (righe.some((r) => r.superaLimitePerSpesa))
            throw new CassaEmporioError(400, MSG_LIMITE_SPESA);
          if (righe.some((r) => r.superaLimiteMensile))
            throw new CassaEmporioError(400, MSG_LIMITE_MENSILE);
          const [row] = await tx
            .update(sessioniCassaEmporioTable)
            .set({
              statoSessione: "pronta_per_chiusura",
              dataUltimaModifica: new Date(),
              operatoreUltimaModificaId: operatorId(req),
            })
            .where(eq(sessioniCassaEmporioTable.id, locked.id))
            .returning();
          return row;
        },
      );
      res.json({
        ...(await formatSessione(updated, true)),
        messaggio: MSG_SESSIONE_PRONTA,
        effettiDefinitivi: {
          movimentiCreditoCreati: 0,
          bolleCreate: 0,
          scarichiCreati: 0,
        },
      });
    } catch (error) {
      if (handleCassaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/cassa-emporio/sessioni/:id/chiudi",
  requirePermission("emporio.cassa.operate"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const sessione = await loadSessione(Number(req.params.id));
    if (!sessione) {
      res.status(404).json({ error: MSG_SESSIONE_NON_TROVATA });
      return;
    }
    if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
    const versione = expectedVersion(req.body);
    if (versione == null) {
      res
        .status(400)
        .json({ error: "La versione della Sessione è obbligatoria." });
      return;
    }
    try {
      const { spesaId } = await chiudiSessioneCassaEmporio({
        sessioneId: sessione.id,
        versione,
        operatoreId: operatorId(req),
        note: asText(req.body?.note),
        ip: req.ip,
      });
      const spesa = await getSpesaEmporio(spesaId);
      const updatedSessione = await loadSessione(sessione.id);
      const emailBolla = {
        stato: "non_preparata" as const,
        destinatari: [],
        messaggio: "Bolla pronta per l'apertura email nel client locale.",
      };
      res.json({
        sessione: updatedSessione
          ? await formatSessione(updatedSessione, true)
          : null,
        spesa,
        emailBolla,
        messaggio: "Spesa Emporio chiusa correttamente.",
      });
    } catch (err) {
      if (err instanceof SpesaEmporioError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
