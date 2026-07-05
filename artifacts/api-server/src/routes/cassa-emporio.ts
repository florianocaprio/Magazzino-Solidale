import { Router, type IRouter } from "express";
import {
  beneficiariTable,
  bolleTable,
  centriAscoltoTable,
  consegneTable,
  cittaTable,
  creditoSolidaleMovimentiTable,
  db,
  lottiTable,
  magazziniTable,
  prodottiTable,
  scarichiTable,
  sessioniCassaEmporioRigheTable,
  sessioniCassaEmporioTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, ne, or, sum, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  callerZonaUdsId,
  canAccessMagazzino,
  canUseBeneficiario,
  centroScopeFilter,
  cittaScopeFilter,
  zonaUdsScopeFilter,
} from "../lib/centroScope";
import { calcolaDisponibilitaMagazzino, parseDbNumber } from "../lib/disponibilitaMagazzino";
import { EMPORIO_DISABLED_MSG, isEmporioEnabled } from "../lib/impostazioniModuli";

const router: IRouter = Router();

const TIPO_ACCESSO = "accesso_emporio";
const STATI_ACCESSO_VALIDI = ["pianificato", "confermato", "effettuato"] as const;
const STATI_SESSIONE = ["aperta", "sospesa", "annullata", "pronta_per_chiusura"] as const;
const STATI_SESSIONE_MODIFICABILI = ["aperta", "sospesa"] as const;
const STATI_SESSIONE_NON_DUPLICABILI = ["aperta", "sospesa", "pronta_per_chiusura"] as const;

type StatoSessione = (typeof STATI_SESSIONE)[number];

const MSG_SESSIONE_GIA_APERTA = "Esiste già una sessione Cassa Emporio aperta per questo Accesso Emporio.";
const MSG_ACCESSO_NON_VALIDO = "Accesso Emporio non valido per la Cassa.";
const MSG_BENEFICIARIO_NON_ATTIVO = "Il beneficiario non è attivo.";
const MSG_CENTRO_RICHIESTO = "Per usare la Cassa Emporio è necessario associare il beneficiario a un Centro di Ascolto.";
const MSG_CREDITO_RICHIESTO = "Il beneficiario non è abilitato al Credito Solidale.";
const MSG_CREDITO_NON_ATTIVO = "Il Credito Solidale del beneficiario non è attivo.";
const MSG_MAGAZZINO_EMPORIO = "La Cassa Emporio può essere aperta solo su un magazzino di tipo Emporio o Misto.";
const MSG_PRODOTTO_NON_TROVATO = "Prodotto non trovato o non abilitato per Emporio.";
const MSG_GIACENZA_NON_DISPONIBILE = "Giacenza non disponibile.";
const MSG_GIACENZA_INSUFFICIENTE = "La quantità richiesta supera la giacenza disponibile.";
const MSG_LIMITE_SPESA = "La quantità supera il limite previsto per singola spesa.";
const MSG_LIMITE_MENSILE = "La quantità supera il limite mensile previsto per questo prodotto.";
const MSG_SALDO_INSUFFICIENTE = "Il totale Credito previsto supera il Saldo Credito Solidale disponibile.";
const MSG_SESSIONE_PRONTA = "Sessione pronta per la chiusura. La chiusura definitiva sarà disponibile nella Fase4-7.";

function asInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function asPositiveQuantity(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asMoney(value: number): string {
  return value.toFixed(2);
}

function dayBounds(value: string | null): { start: Date; end: Date } | null {
  if (!value) return null;
  const start = new Date(`${value}T00:00:00.000`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function operatorId(req: import("express").Request): number | null {
  const user = (req as unknown as { user?: { id?: unknown } }).user;
  return typeof user?.id === "number" ? user.id : null;
}

function isStatoSessione(value: unknown): value is StatoSessione {
  return typeof value === "string" && STATI_SESSIONE.includes(value as StatoSessione);
}

function isSessioneModificabile(stato: string): boolean {
  return STATI_SESSIONE_MODIFICABILI.includes(stato as (typeof STATI_SESSIONE_MODIFICABILI)[number]);
}

async function assertEmporioEnabled(res: import("express").Response): Promise<boolean> {
  if (await isEmporioEnabled()) return true;
  res.status(403).json({ error: EMPORIO_DISABLED_MSG });
  return false;
}

function validateBeneficiarioCassa(beneficiario: typeof beneficiariTable.$inferSelect | null): string | null {
  if (!beneficiario) return "Beneficiario non trovato.";
  if (!beneficiario.attivo) return MSG_BENEFICIARIO_NON_ATTIVO;
  if (beneficiario.centroAscoltoId == null) return MSG_CENTRO_RICHIESTO;
  if (!beneficiario.creditoSolidaleAbilitato) return MSG_CREDITO_RICHIESTO;
  if (beneficiario.creditoSolidaleStato !== "attivo") return MSG_CREDITO_NON_ATTIVO;
  return null;
}

async function validateMagazzinoEmporio(id: number, req: import("express").Request): Promise<{ error: string; status: number } | { magazzino: typeof magazziniTable.$inferSelect }> {
  const [magazzino] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, id));
  if (!magazzino || !["emporio", "misto"].includes(magazzino.tipoMagazzino)) return { error: MSG_MAGAZZINO_EMPORIO, status: 400 };
  if (!(await canAccessMagazzino(id, callerCentroId(req), callerCittaId(req)))) return { error: "Magazzino non accessibile per il tuo profilo", status: 403 };
  return { magazzino };
}

async function ensureSessioneAccessibile(sessione: typeof sessioniCassaEmporioTable.$inferSelect, req: import("express").Request, res: import("express").Response): Promise<boolean> {
  if (!(await canUseBeneficiario(sessione.beneficiarioId, callerCentroId(req), callerCittaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo profilo" });
    return false;
  }
  if (!(await canAccessMagazzino(sessione.magazzinoEmporioId, callerCentroId(req), callerCittaId(req)))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo profilo" });
    return false;
  }
  return true;
}

async function loadSessione(id: number) {
  const [sessione] = await db.select().from(sessioniCassaEmporioTable).where(eq(sessioniCassaEmporioTable.id, id));
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
    quantita: row.quantita,
    creditoUnitario: parseDbNumber(row.creditoUnitario),
    creditoTotale: parseDbNumber(row.creditoTotale),
    giacenzaDisponibileAlMomento: row.giacenzaDisponibileAlMomento,
    limitePerSpesa: row.limitePerSpesa,
    limiteMensile: row.limiteMensile,
    superaLimitePerSpesa: row.superaLimitePerSpesa,
    superaLimiteMensile: row.superaLimiteMensile,
    superaGiacenza: row.superaGiacenza,
    note: row.note,
    dataCreazione: row.dataCreazione.toISOString(),
    dataAggiornamento: row.dataAggiornamento.toISOString(),
  };
}

async function formatSessione(sessione: typeof sessioniCassaEmporioTable.$inferSelect, includeRighe = false) {
  const [beneficiario] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, sessione.beneficiarioId));
  const [magazzino] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, sessione.magazzinoEmporioId));
  const [accesso] = await db.select().from(consegneTable).where(eq(consegneTable.id, sessione.accessoEmporioId));
  const righe = includeRighe ? await loadRighe(sessione.id) : [];
  return {
    id: sessione.id,
    accessoEmporioId: sessione.accessoEmporioId,
    beneficiarioId: sessione.beneficiarioId,
    beneficiarioNome: beneficiario ? `${beneficiario.cognome} ${beneficiario.nome}` : null,
    beneficiarioCodice: beneficiario?.codice ?? null,
    centroAscoltoId: sessione.centroAscoltoId,
    cittaId: sessione.cittaId,
    magazzinoEmporioId: sessione.magazzinoEmporioId,
    magazzinoEmporioNome: magazzino?.nome ?? null,
    statoSessione: sessione.statoSessione,
    saldoCreditoIniziale: parseDbNumber(sessione.saldoCreditoIniziale),
    totaleCreditoPrevisto: parseDbNumber(sessione.totaleCreditoPrevisto),
    creditoResiduoPrevisto: parseDbNumber(sessione.creditoResiduoPrevisto),
    statoAccessoEmporio: accesso?.statoAccessoEmporio ?? null,
    dataOraAccesso: accesso?.dataOraInizio?.toISOString() ?? null,
    operatoreAperturaId: sessione.operatoreAperturaId,
    operatoreUltimaModificaId: sessione.operatoreUltimaModificaId,
    dataApertura: sessione.dataApertura.toISOString(),
    dataUltimaModifica: sessione.dataUltimaModifica.toISOString(),
    dataSospensione: sessione.dataSospensione?.toISOString() ?? null,
    dataAnnullamento: sessione.dataAnnullamento?.toISOString() ?? null,
    motivoAnnullamento: sessione.motivoAnnullamento,
    note: sessione.note,
    righe: righe.map(formatRiga),
  };
}

async function recalcSessione(sessioneId: number, operatoreUltimaModificaId: number | null) {
  const [totale] = await db
    .select({ creditoTotale: sum(sessioniCassaEmporioRigheTable.creditoTotale) })
    .from(sessioniCassaEmporioRigheTable)
    .where(eq(sessioniCassaEmporioRigheTable.sessioneCassaId, sessioneId));
  const sessione = await loadSessione(sessioneId);
  if (!sessione) return null;
  const totaleCreditoPrevisto = parseDbNumber(totale?.creditoTotale);
  const saldoCreditoIniziale = parseDbNumber(sessione.saldoCreditoIniziale);
  const creditoResiduoPrevisto = saldoCreditoIniziale - totaleCreditoPrevisto;
  const [updated] = await db
    .update(sessioniCassaEmporioTable)
    .set({
      totaleCreditoPrevisto: asMoney(totaleCreditoPrevisto),
      creditoResiduoPrevisto: asMoney(creditoResiduoPrevisto),
      operatoreUltimaModificaId,
      dataUltimaModifica: new Date(),
    })
    .where(eq(sessioniCassaEmporioTable.id, sessioneId))
    .returning();
  return updated;
}

async function quantitaProdottoInSessione(sessioneId: number, prodottoId: number, excludeRigaId?: number): Promise<number> {
  const conditions: SQL[] = [
    eq(sessioniCassaEmporioRigheTable.sessioneCassaId, sessioneId),
    eq(sessioniCassaEmporioRigheTable.prodottoId, prodottoId),
  ];
  if (excludeRigaId != null) conditions.push(ne(sessioniCassaEmporioRigheTable.id, excludeRigaId));
  const [row] = await db
    .select({ quantita: sum(sessioniCassaEmporioRigheTable.quantita) })
    .from(sessioniCassaEmporioRigheTable)
    .where(and(...conditions));
  return parseDbNumber(row?.quantita);
}

async function firstLottoId(prodottoId: number, magazzinoId: number): Promise<number | null> {
  const [lotto] = await db
    .select({ id: lottiTable.id })
    .from(lottiTable)
    .where(and(eq(lottiTable.prodottoId, prodottoId), eq(lottiTable.magazzinoId, magazzinoId), gt(lottiTable.quantitaResidua, "0")))
    .orderBy(asc(lottiTable.dataScadenza), asc(lottiTable.id))
    .limit(1);
  return lotto?.id ?? null;
}

async function buildRigaValues(sessione: typeof sessioniCassaEmporioTable.$inferSelect, prodottoId: number, quantita: number, excludeRigaId?: number) {
  const [prodotto] = await db.select().from(prodottiTable).where(eq(prodottiTable.id, prodottoId));
  const creditoUnitario = parseDbNumber(prodotto?.creditoSolidaleValore);
  if (!prodotto || !prodotto.attivo || !prodotto.abilitatoEmporio || creditoUnitario <= 0) {
    return { error: MSG_PRODOTTO_NON_TROVATO, status: 400 } as const;
  }

  const otherQuantity = await quantitaProdottoInSessione(sessione.id, prodottoId, excludeRigaId);
  const totalQuantityForProduct = otherQuantity + quantita;
  const limitePerSpesa = prodotto.quantitaMassimaPerSpesa == null ? null : Math.floor(parseDbNumber(prodotto.quantitaMassimaPerSpesa));
  const limiteMensile = prodotto.quantitaMassimaMensile == null ? null : Math.floor(parseDbNumber(prodotto.quantitaMassimaMensile));
  if (limitePerSpesa != null && totalQuantityForProduct > limitePerSpesa) return { error: MSG_LIMITE_SPESA, status: 400 } as const;
  if (limiteMensile != null && totalQuantityForProduct > limiteMensile) return { error: MSG_LIMITE_MENSILE, status: 400 } as const;

  const disponibilita = await calcolaDisponibilitaMagazzino(prodottoId, sessione.magazzinoEmporioId);
  const disponibile = Math.floor(disponibilita.disponibileReale);
  if (disponibile <= 0) return { error: MSG_GIACENZA_NON_DISPONIBILE, status: 400 } as const;
  if (totalQuantityForProduct > disponibile) return { error: MSG_GIACENZA_INSUFFICIENTE, status: 400 } as const;

  return {
    prodotto,
    values: {
      prodottoId,
      lottoId: await firstLottoId(prodottoId, sessione.magazzinoEmporioId),
      codiceProdotto: prodotto.codiceBarre ?? prodotto.codice,
      descrizioneProdotto: prodotto.nome,
      quantita,
      creditoUnitario: asMoney(creditoUnitario),
      creditoTotale: asMoney(creditoUnitario * quantita),
      giacenzaDisponibileAlMomento: disponibile,
      limitePerSpesa,
      limiteMensile,
      superaLimitePerSpesa: false,
      superaLimiteMensile: false,
      superaGiacenza: false,
    },
  } as const;
}

router.get("/cassa-emporio/beneficiari/ricerca", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const query = req.query as Record<string, string>;
  const q = asText(query.search);
  const requestedCittaId = asInt(query.cittaId ?? query.areaId);
  const magazzinoEmporioId = asInt(query.magazzinoEmporioId);
  const dateBounds = dayBounds(asText(query.data));
  if (!q && requestedCittaId == null && magazzinoEmporioId == null && dateBounds == null) { res.json([]); return; }
  if (magazzinoEmporioId != null) {
    const magazzino = await validateMagazzinoEmporio(magazzinoEmporioId, req);
    if ("error" in magazzino) { res.status(magazzino.status).json({ error: magazzino.error }); return; }
  }

  const conditions: SQL[] = [];
  if (q) {
    const search = `%${q}%`;
    conditions.push(or(
      ilike(beneficiariTable.nome, search),
      ilike(beneficiariTable.cognome, search),
      ilike(beneficiariTable.codice, search),
      ilike(beneficiariTable.codiceFiscale, search),
    )!);
  }
  if (requestedCittaId != null) conditions.push(eq(beneficiariTable.cittaId, requestedCittaId));
  const centroFilter = centroScopeFilter(beneficiariTable.centroAscoltoId, callerCentroId(req));
  if (centroFilter) conditions.push(centroFilter);
  const cittaFilter = cittaScopeFilter(beneficiariTable.cittaId, callerCittaId(req));
  if (cittaFilter) conditions.push(cittaFilter);
  const zonaFilter = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
  if (zonaFilter) conditions.push(zonaFilter);

  const beneficiari = await db
    .select()
    .from(beneficiariTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(beneficiariTable.cognome), asc(beneficiariTable.nome))
    .limit(50);
  const results = [];
  for (const beneficiario of beneficiari) {
    const accessoConditions: SQL[] = [
      eq(consegneTable.tipoPianificazione, TIPO_ACCESSO),
      eq(consegneTable.beneficiarioId, beneficiario.id),
      inArray(consegneTable.statoAccessoEmporio, [...STATI_ACCESSO_VALIDI]),
    ];
    if (magazzinoEmporioId != null) accessoConditions.push(eq(consegneTable.magazzinoEmporioId, magazzinoEmporioId));
    if (dateBounds != null) {
      accessoConditions.push(gte(consegneTable.dataOraInizio, dateBounds.start));
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
      .leftJoin(magazziniTable, eq(consegneTable.magazzinoEmporioId, magazziniTable.id))
      .where(and(...accessoConditions))
      .orderBy(desc(consegneTable.dataOraInizio), desc(consegneTable.id));
    if (!q && accessi.length === 0) continue;
    results.push({
      beneficiarioId: beneficiario.id,
      beneficiarioNome: `${beneficiario.cognome} ${beneficiario.nome}`,
      beneficiarioCodice: beneficiario.codice,
      beneficiarioCodiceFiscale: beneficiario.codiceFiscale,
      centroAscoltoId: beneficiario.centroAscoltoId,
      cittaId: beneficiario.cittaId,
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
});

router.get("/cassa-emporio/prodotti/ricerca", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const query = req.query as Record<string, string>;
  const q = asText(query.search);
  const magazzinoEmporioId = asInt(query.magazzinoEmporioId);
  if (!q) { res.json([]); return; }
  if (magazzinoEmporioId != null) {
    const magazzino = await validateMagazzinoEmporio(magazzinoEmporioId, req);
    if ("error" in magazzino) { res.status(magazzino.status).json({ error: magazzino.error }); return; }
  }
  const search = `%${q}%`;
  const rows = await db
    .select()
    .from(prodottiTable)
    .where(
      and(
        eq(prodottiTable.attivo, true),
        eq(prodottiTable.abilitatoEmporio, true),
        gt(prodottiTable.creditoSolidaleValore, "0"),
        or(
          ilike(prodottiTable.nome, search),
          ilike(prodottiTable.descrizione, search),
          ilike(prodottiTable.codice, search),
          ilike(prodottiTable.codiceBarre, search),
        ),
      ),
    )
    .orderBy(asc(prodottiTable.nome))
    .limit(20);

  const result = [];
  for (const prodotto of rows) {
    const disponibilita = magazzinoEmporioId == null ? null : await calcolaDisponibilitaMagazzino(prodotto.id, magazzinoEmporioId);
    result.push({
      prodottoId: prodotto.id,
      codice: prodotto.codice,
      codiceBarre: prodotto.codiceBarre,
      nome: prodotto.nome,
      descrizione: prodotto.descrizione,
      creditoSolidaleValore: parseDbNumber(prodotto.creditoSolidaleValore),
      quantitaMassimaPerSpesa: prodotto.quantitaMassimaPerSpesa == null ? null : parseDbNumber(prodotto.quantitaMassimaPerSpesa),
      quantitaMassimaMensile: prodotto.quantitaMassimaMensile == null ? null : parseDbNumber(prodotto.quantitaMassimaMensile),
      giacenzaDisponibile: disponibilita == null ? null : Math.floor(disponibilita.disponibileReale),
    });
  }
  res.json(result);
});

router.get("/cassa-emporio/sessioni", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const q = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (isStatoSessione(q.statoSessione)) conditions.push(eq(sessioniCassaEmporioTable.statoSessione, q.statoSessione));
  if (q.magazzinoEmporioId) conditions.push(eq(sessioniCassaEmporioTable.magazzinoEmporioId, Number(q.magazzinoEmporioId)));
  const requestedCittaId = asInt(q.cittaId ?? q.areaId);
  if (requestedCittaId != null) conditions.push(eq(sessioniCassaEmporioTable.cittaId, requestedCittaId));
  const dateBounds = dayBounds(asText(q.data));
  if (dateBounds != null) {
    conditions.push(gte(sessioniCassaEmporioTable.dataApertura, dateBounds.start));
    conditions.push(lt(sessioniCassaEmporioTable.dataApertura, dateBounds.end));
  }
  if (q.beneficiarioSearch) {
    const s = `%${q.beneficiarioSearch}%`;
    conditions.push(or(ilike(beneficiariTable.nome, s), ilike(beneficiariTable.cognome, s), ilike(beneficiariTable.codice, s), ilike(beneficiariTable.codiceFiscale, s))!);
  }
  const centroFilter = centroScopeFilter(beneficiariTable.centroAscoltoId, callerCentroId(req));
  if (centroFilter) conditions.push(centroFilter);
  const cittaFilter = cittaScopeFilter(beneficiariTable.cittaId, callerCittaId(req));
  if (cittaFilter) conditions.push(cittaFilter);
  const zonaFilter = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
  if (zonaFilter) conditions.push(zonaFilter);
  const rows = await db
    .select({ s: sessioniCassaEmporioTable })
    .from(sessioniCassaEmporioTable)
    .leftJoin(beneficiariTable, eq(sessioniCassaEmporioTable.beneficiarioId, beneficiariTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sessioniCassaEmporioTable.dataUltimaModifica), desc(sessioniCassaEmporioTable.id))
    .limit(100);
  res.json(await Promise.all(rows.map((r) => formatSessione(r.s, false))));
});

router.get("/cassa-emporio/sessioni/:id", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const sessione = await loadSessione(Number(req.params.id));
  if (!sessione) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
  res.json(await formatSessione(sessione, true));
});

router.post("/cassa-emporio/accessi/:accessoEmporioId/apri-sessione", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const accessoEmporioId = Number(req.params.accessoEmporioId);
  const [accesso] = await db.select().from(consegneTable).where(and(eq(consegneTable.id, accessoEmporioId), eq(consegneTable.tipoPianificazione, TIPO_ACCESSO)));
  if (!accesso || !STATI_ACCESSO_VALIDI.includes(accesso.statoAccessoEmporio as (typeof STATI_ACCESSO_VALIDI)[number]) || accesso.magazzinoEmporioId == null) {
    res.status(400).json({ error: MSG_ACCESSO_NON_VALIDO });
    return;
  }
  if (!(await canUseBeneficiario(accesso.beneficiarioId, callerCentroId(req), callerCittaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo profilo" });
    return;
  }
  const [beneficiario] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, accesso.beneficiarioId));
  const beneficiarioError = validateBeneficiarioCassa(beneficiario ?? null);
  if (beneficiarioError) { res.status(400).json({ error: beneficiarioError }); return; }
  const magazzino = await validateMagazzinoEmporio(accesso.magazzinoEmporioId, req);
  if ("error" in magazzino) { res.status(magazzino.status).json({ error: magazzino.error }); return; }
  const duplicate = await db
    .select({ id: sessioniCassaEmporioTable.id })
    .from(sessioniCassaEmporioTable)
    .where(and(eq(sessioniCassaEmporioTable.accessoEmporioId, accessoEmporioId), inArray(sessioniCassaEmporioTable.statoSessione, [...STATI_SESSIONE_NON_DUPLICABILI])))
    .limit(1);
  if (duplicate.length > 0) {
    const existing = await loadSessione(duplicate[0].id);
    if (existing) {
      res.json(await formatSessione(existing, true));
      return;
    }
    res.status(409).json({ error: MSG_SESSIONE_GIA_APERTA });
    return;
  }

  const saldoCreditoIniziale = parseDbNumber(beneficiario!.creditoSolidaleSaldo);
  const [created] = await db
    .insert(sessioniCassaEmporioTable)
    .values({
      accessoEmporioId,
      beneficiarioId: accesso.beneficiarioId,
      magazzinoEmporioId: accesso.magazzinoEmporioId,
      centroAscoltoId: beneficiario!.centroAscoltoId,
      cittaId: beneficiario!.cittaId,
      saldoCreditoIniziale: asMoney(saldoCreditoIniziale),
      totaleCreditoPrevisto: "0.00",
      creditoResiduoPrevisto: asMoney(saldoCreditoIniziale),
      operatoreAperturaId: operatorId(req),
      operatoreUltimaModificaId: operatorId(req),
      note: asText(req.body?.note),
    })
    .returning();

  if (accesso.statoAccessoEmporio === "pianificato" || accesso.statoAccessoEmporio === "confermato") {
    await db.update(consegneTable).set({ statoAccessoEmporio: "effettuato", stato: "effettuata", dataEffettuata: new Date() }).where(eq(consegneTable.id, accesso.id));
  }

  res.status(201).json(await formatSessione(created, true));
});

router.post("/cassa-emporio/sessioni/:id/righe", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const sessione = await loadSessione(Number(req.params.id));
  if (!sessione) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
  if (!isSessioneModificabile(sessione.statoSessione)) { res.status(400).json({ error: "La sessione Cassa Emporio non è modificabile." }); return; }
  const prodottoId = asInt(req.body?.prodottoId);
  const quantita = asPositiveQuantity(req.body?.quantita);
  if (prodottoId == null || quantita == null) { res.status(400).json({ error: "Prodotto e quantità sono obbligatori." }); return; }
  const built = await buildRigaValues(sessione, prodottoId, quantita);
  if ("error" in built) { res.status(built.status ?? 400).json({ error: built.error }); return; }
  const [created] = await db
    .insert(sessioniCassaEmporioRigheTable)
    .values({ sessioneCassaId: sessione.id, ...built.values, note: asText(req.body?.note) })
    .returning();
  await recalcSessione(sessione.id, operatorId(req));
  res.status(201).json(formatRiga(created));
});

router.patch("/cassa-emporio/sessioni/:id/righe/:rigaId", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const sessione = await loadSessione(Number(req.params.id));
  if (!sessione) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
  if (!isSessioneModificabile(sessione.statoSessione)) { res.status(400).json({ error: "La sessione Cassa Emporio non è modificabile." }); return; }
  const rigaId = Number(req.params.rigaId);
  const [existing] = await db
    .select()
    .from(sessioniCassaEmporioRigheTable)
    .where(and(eq(sessioniCassaEmporioRigheTable.id, rigaId), eq(sessioniCassaEmporioRigheTable.sessioneCassaId, sessione.id)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const quantita = asPositiveQuantity(req.body?.quantita);
  if (quantita == null) { res.status(400).json({ error: "La quantità deve essere maggiore di zero." }); return; }
  const built = await buildRigaValues(sessione, existing.prodottoId, quantita, existing.id);
  if ("error" in built) { res.status(built.status ?? 400).json({ error: built.error }); return; }
  const [updated] = await db
    .update(sessioniCassaEmporioRigheTable)
    .set({ ...built.values, note: "note" in (req.body ?? {}) ? asText(req.body.note) : existing.note, dataAggiornamento: new Date() })
    .where(eq(sessioniCassaEmporioRigheTable.id, existing.id))
    .returning();
  await recalcSessione(sessione.id, operatorId(req));
  res.json(formatRiga(updated));
});

router.delete("/cassa-emporio/sessioni/:id/righe/:rigaId", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const sessione = await loadSessione(Number(req.params.id));
  if (!sessione) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
  if (!isSessioneModificabile(sessione.statoSessione)) { res.status(400).json({ error: "La sessione Cassa Emporio non è modificabile." }); return; }
  await db.delete(sessioniCassaEmporioRigheTable).where(and(eq(sessioniCassaEmporioRigheTable.id, Number(req.params.rigaId)), eq(sessioniCassaEmporioRigheTable.sessioneCassaId, sessione.id)));
  const updated = await recalcSessione(sessione.id, operatorId(req));
  res.json(await formatSessione(updated ?? sessione, true));
});

router.post("/cassa-emporio/sessioni/:id/sospendi", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const sessione = await loadSessione(Number(req.params.id));
  if (!sessione) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
  if (!isSessioneModificabile(sessione.statoSessione)) { res.status(400).json({ error: "La sessione Cassa Emporio non è modificabile." }); return; }
  const [updated] = await db
    .update(sessioniCassaEmporioTable)
    .set({ statoSessione: "sospesa", dataSospensione: new Date(), dataUltimaModifica: new Date(), operatoreUltimaModificaId: operatorId(req) })
    .where(eq(sessioniCassaEmporioTable.id, sessione.id))
    .returning();
  res.json(await formatSessione(updated, true));
});

router.post("/cassa-emporio/sessioni/:id/riprendi", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const sessione = await loadSessione(Number(req.params.id));
  if (!sessione) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
  if (sessione.statoSessione !== "sospesa") { res.status(400).json({ error: "Solo una sessione sospesa può essere ripresa." }); return; }
  const [updated] = await db
    .update(sessioniCassaEmporioTable)
    .set({ statoSessione: "aperta", dataUltimaModifica: new Date(), operatoreUltimaModificaId: operatorId(req) })
    .where(eq(sessioniCassaEmporioTable.id, sessione.id))
    .returning();
  res.json(await formatSessione(updated, true));
});

router.post("/cassa-emporio/sessioni/:id/annulla", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const sessione = await loadSessione(Number(req.params.id));
  if (!sessione) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
  if (sessione.statoSessione === "annullata") { res.status(400).json({ error: "La sessione Cassa Emporio è già annullata." }); return; }
  const motivo = asText(req.body?.motivoAnnullamento);
  if (!motivo) { res.status(400).json({ error: "Il motivo annullamento è obbligatorio." }); return; }
  const [updated] = await db
    .update(sessioniCassaEmporioTable)
    .set({ statoSessione: "annullata", motivoAnnullamento: motivo, dataAnnullamento: new Date(), dataUltimaModifica: new Date(), operatoreUltimaModificaId: operatorId(req) })
    .where(eq(sessioniCassaEmporioTable.id, sessione.id))
    .returning();
  res.json(await formatSessione(updated, true));
});

router.post("/cassa-emporio/sessioni/:id/pronta-per-chiusura", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const sessione = await loadSessione(Number(req.params.id));
  if (!sessione) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureSessioneAccessibile(sessione, req, res))) return;
  if (!isSessioneModificabile(sessione.statoSessione)) { res.status(400).json({ error: "La sessione Cassa Emporio non è modificabile." }); return; }
  const recalculated = await recalcSessione(sessione.id, operatorId(req));
  const current = recalculated ?? sessione;
  const righe = await loadRighe(sessione.id);
  if (righe.length === 0) { res.status(400).json({ error: "Il Carrello Emporio è vuoto." }); return; }
  if (parseDbNumber(current.creditoResiduoPrevisto) < 0) { res.status(400).json({ error: MSG_SALDO_INSUFFICIENTE }); return; }
  if (righe.some((r) => r.superaGiacenza)) { res.status(400).json({ error: MSG_GIACENZA_INSUFFICIENTE }); return; }
  if (righe.some((r) => r.superaLimitePerSpesa)) { res.status(400).json({ error: MSG_LIMITE_SPESA }); return; }
  if (righe.some((r) => r.superaLimiteMensile)) { res.status(400).json({ error: MSG_LIMITE_MENSILE }); return; }

  const beforeEffects = await Promise.all([
    db.select({ id: creditoSolidaleMovimentiTable.id }).from(creditoSolidaleMovimentiTable).where(eq(creditoSolidaleMovimentiTable.beneficiarioId, current.beneficiarioId)),
    db.select({ id: bolleTable.id }).from(bolleTable).where(eq(bolleTable.beneficiarioId, current.beneficiarioId)),
    db.select({ id: scarichiTable.id }).from(scarichiTable).where(eq(scarichiTable.magazzinoId, current.magazzinoEmporioId)),
  ]);

  const [updated] = await db
    .update(sessioniCassaEmporioTable)
    .set({ statoSessione: "pronta_per_chiusura", dataUltimaModifica: new Date(), operatoreUltimaModificaId: operatorId(req) })
    .where(eq(sessioniCassaEmporioTable.id, sessione.id))
    .returning();

  const afterEffects = await Promise.all([
    db.select({ id: creditoSolidaleMovimentiTable.id }).from(creditoSolidaleMovimentiTable).where(eq(creditoSolidaleMovimentiTable.beneficiarioId, current.beneficiarioId)),
    db.select({ id: bolleTable.id }).from(bolleTable).where(eq(bolleTable.beneficiarioId, current.beneficiarioId)),
    db.select({ id: scarichiTable.id }).from(scarichiTable).where(eq(scarichiTable.magazzinoId, current.magazzinoEmporioId)),
  ]);

  res.json({
    ...(await formatSessione(updated, true)),
    messaggio: MSG_SESSIONE_PRONTA,
    effettiDefinitivi: {
      movimentiCreditoCreati: afterEffects[0].length - beforeEffects[0].length,
      bolleCreate: afterEffects[1].length - beforeEffects[1].length,
      scarichiCreati: afterEffects[2].length - beforeEffects[2].length,
    },
  });
});

export default router;
