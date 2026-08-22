import {
  beneficiariTable,
  bolleTable,
  bollaRigheTable,
  centriAscoltoTable,
  areeOperativeTable,
  consegneTable,
  creditoSolidaleMovimentiTable,
  db,
  lottiTable,
  magazziniTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  prodottiTable,
  scarichiTable,
  scaricoRigheTable,
  sessioniCassaEmporioRigheTable,
  sessioniCassaEmporioTable,
  speseEmporioRigheTable,
  speseEmporioStorniRigheTable,
  speseEmporioStorniTable,
  speseEmporioTable,
  utentiTable,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  like,
  lt,
  or,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";
import { parseDbNumber } from "./disponibilitaMagazzino";
import { auditEmporioTx } from "./emporioAudit";
import { magazzinoScopeFilter } from "./centroScope";
import { quantitaCompatibileConUnitaMisuraEmporio } from "./emporioQuantita";
import { dataCivileEuropeRome } from "./interventiWorkflow";
import {
  dateTimeEuropeRomeToUtc,
  intervalloGiornoEuropeRome,
} from "./interventiViste";
import {
  dataOperativaEuropeRome,
  isLottoDistribuibile,
  lottoDistribuibileCondition,
} from "./lottoPolicy";
import { InventoryDecimal } from "./inventoryDecimal";
import {
  ensureDistributionOperation,
  markDistributionOperationReversed,
} from "./distributionLedger";

const PRENOTAZIONE_ATTIVA = "attiva";

export const MSG_SESSIONE_NON_PRONTA =
  "La sessione Cassa Emporio non è pronta per la chiusura.";
export const MSG_SESSIONE_GIA_CHIUSA =
  "La sessione Cassa Emporio risulta già chiusa. Non è possibile chiudere due volte la stessa spesa.";
export const MSG_SALDO_INSUFFICIENTE =
  "Saldo Credito Solidale insufficiente. Riduci il carrello o effettua una ricarica prima della chiusura.";
export const MSG_GIACENZA_INSUFFICIENTE =
  "Giacenza insufficiente per chiudere la spesa Emporio. Verifica le disponibilità di magazzino prima di riprovare.";
export const MSG_CARRELLO_VUOTO = "Il Carrello Emporio è vuoto.";
export const MSG_PRODOTTO_NON_TROVATO =
  "Prodotto non trovato. Verifica il codice a barre o cerca il prodotto per nome.";
export const MSG_PRODOTTO_NON_ABILITATO =
  "Il prodotto non è abilitato per Emporio. Abilitalo nella scheda prodotto prima di aggiungerlo al carrello.";
export const MSG_PRODOTTO_SENZA_CREDITO =
  "Il prodotto non ha un Valore Credito Solidale configurato. Imposta il valore nella scheda prodotto.";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type CheckoutRow = typeof sessioniCassaEmporioRigheTable.$inferSelect;
type ProductRow = typeof prodottiTable.$inferSelect;
type EmailBollaStato =
  | "non_preparata"
  | "invio_manuale_avviato"
  | "nessun_destinatario"
  | "errore";

export class SpesaEmporioError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function asDecimal(value: number): string {
  return round2(value).toFixed(2);
}

function today(): string {
  return dataCivileEuropeRome();
}

function monthBoundsEuropeRome(referenceDate = new Date()): {
  start: Date;
  end: Date;
} {
  const [year, month] = dataCivileEuropeRome(referenceDate)
    .split("-")
    .map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  const nextMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return {
    start: dateTimeEuropeRomeToUtc(
      `${year}-${String(month).padStart(2, "0")}-01`,
    ),
    end: dateTimeEuropeRomeToUtc(nextMonth),
  };
}

function operatorLabel(row: {
  operatoreMatricola: string | null;
  operatoreUsername: string | null;
}): string | null {
  return row.operatoreMatricola ?? row.operatoreUsername ?? null;
}

function normalizeEmailBollaStato(value: string): EmailBollaStato {
  if (value === "inviata" || value === "invio_manuale_avviato")
    return "invio_manuale_avviato";
  if (value === "nessun_destinatario") return "nessun_destinatario";
  if (value === "errore") return "errore";
  return "non_preparata";
}

async function lockSessione(tx: Tx, sessioneId: number) {
  await tx.execute(
    sql`SELECT id FROM ${sessioniCassaEmporioTable} WHERE ${sessioniCassaEmporioTable.id} = ${sessioneId} FOR UPDATE`,
  );
  const [sessione] = await tx
    .select()
    .from(sessioniCassaEmporioTable)
    .where(eq(sessioniCassaEmporioTable.id, sessioneId));
  return sessione ?? null;
}

async function lockBeneficiario(tx: Tx, beneficiarioId: number) {
  await tx.execute(
    sql`SELECT id FROM ${beneficiariTable} WHERE ${beneficiariTable.id} = ${beneficiarioId} FOR UPDATE`,
  );
  const [beneficiario] = await tx
    .select()
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  return beneficiario ?? null;
}

async function generateNumeroSpesa(
  tx: Tx,
  dataOperativa: string,
): Promise<string> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('spese_emporio.numero_spesa'))`,
  );
  const year = Number(dataOperativa.slice(0, 4));
  const prefix = `EMP-${year}-`;
  const [last] = await tx
    .select({ numeroSpesa: speseEmporioTable.numeroSpesa })
    .from(speseEmporioTable)
    .where(like(speseEmporioTable.numeroSpesa, `${prefix}%`))
    .orderBy(desc(speseEmporioTable.numeroSpesa))
    .limit(1);
  const next = last?.numeroSpesa?.startsWith(prefix)
    ? Number(last.numeroSpesa.slice(prefix.length)) + 1
    : 1;
  return `${prefix}${String(Number.isFinite(next) ? next : 1).padStart(5, "0")}`;
}

async function generateNumeroBolla(
  tx: Tx,
  dataOperativa: string,
): Promise<string> {
  // Stessa chiave usata dalla route Bolle: un solo numeratore canonico.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('bolle.numero_bolla'))`,
  );
  const year = Number(dataOperativa.slice(0, 4));
  const prefix = `BOLLA-${year}-`;
  const [last] = await tx
    .select({ numeroBolla: bolleTable.numeroBolla })
    .from(bolleTable)
    .where(like(bolleTable.numeroBolla, `${prefix}%`))
    .orderBy(desc(bolleTable.numeroBolla))
    .limit(1);
  const next = last?.numeroBolla?.startsWith(prefix)
    ? Number(last.numeroBolla.slice(prefix.length)) + 1
    : 1;
  return `${prefix}${String(Number.isFinite(next) ? next : 1).padStart(4, "0")}`;
}

function generateCodiceScarico(dataOperativa: string): string {
  const year = dataOperativa.slice(0, 4);
  const millis = Date.now().toString(36).toUpperCase().slice(-8);
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `SCAR-${year}-${millis}-${suffix}`;
}

async function activeReservationsForLotto(
  tx: Tx,
  lottoId: number,
): Promise<InventoryDecimal> {
  const [row] = await tx
    .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
    .from(prenotazioniMagazzinoTable)
    .where(
      and(
        eq(prenotazioniMagazzinoTable.lottoId, lottoId),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
      ),
    );
  return InventoryDecimal.parse(row?.totale ?? "0");
}

export async function quantitaNettaMensileProdotto(
  tx: Tx | typeof db,
  beneficiarioId: number,
  prodottoId: number,
  referenceDate = new Date(),
): Promise<number> {
  const { start, end } = monthBoundsEuropeRome(referenceDate);
  const [gross] = await tx
    .select({ quantita: sum(speseEmporioRigheTable.quantita) })
    .from(speseEmporioRigheTable)
    .innerJoin(
      speseEmporioTable,
      eq(speseEmporioRigheTable.spesaEmporioId, speseEmporioTable.id),
    )
    .where(
      and(
        eq(speseEmporioTable.beneficiarioId, beneficiarioId),
        eq(speseEmporioRigheTable.prodottoId, prodottoId),
        gte(speseEmporioTable.dataChiusura, start),
        lt(speseEmporioTable.dataChiusura, end),
      ),
    );
  const [reversed] = await tx
    .select({ quantita: sum(speseEmporioStorniRigheTable.quantita) })
    .from(speseEmporioStorniRigheTable)
    .innerJoin(
      speseEmporioRigheTable,
      eq(speseEmporioStorniRigheTable.spesaRigaId, speseEmporioRigheTable.id),
    )
    .innerJoin(
      speseEmporioTable,
      eq(speseEmporioRigheTable.spesaEmporioId, speseEmporioTable.id),
    )
    .where(
      and(
        eq(speseEmporioTable.beneficiarioId, beneficiarioId),
        eq(speseEmporioRigheTable.prodottoId, prodottoId),
        gte(speseEmporioTable.dataChiusura, start),
        lt(speseEmporioTable.dataChiusura, end),
      ),
    );
  return round2(
    Math.max(
      0,
      parseDbNumber(gross?.quantita) - parseDbNumber(reversed?.quantita),
    ),
  );
}

async function validateRigheFinali(
  tx: Tx,
  righe: CheckoutRow[],
  beneficiarioId: number,
  referenceDate: Date,
): Promise<Map<number, ProductRow>> {
  if (righe.length === 0) throw new SpesaEmporioError(400, MSG_CARRELLO_VUOTO);
  const prodottoIds = [...new Set(righe.map((r) => r.prodottoId))];
  const prodotti = await tx
    .select()
    .from(prodottiTable)
    .where(inArray(prodottiTable.id, prodottoIds));
  const productMap = new Map(prodotti.map((p) => [p.id, p]));

  const quantityByProduct = new Map<number, number>();
  for (const riga of righe) {
    const prodotto = productMap.get(riga.prodottoId);
    if (!prodotto || !prodotto.attivo)
      throw new SpesaEmporioError(400, MSG_PRODOTTO_NON_TROVATO);
    if (!prodotto.abilitatoEmporio)
      throw new SpesaEmporioError(400, MSG_PRODOTTO_NON_ABILITATO);
    if (parseDbNumber(prodotto.creditoSolidaleValore) <= 0) {
      throw new SpesaEmporioError(400, MSG_PRODOTTO_SENZA_CREDITO);
    }
    if (riga.unitaMisura != null && riga.unitaMisura !== prodotto.unitaMisura) {
      throw new SpesaEmporioError(
        409,
        "L'unità di misura del Prodotto è cambiata: aggiornare il carrello prima della chiusura.",
      );
    }
    const quantitaRiga = parseDbNumber(riga.quantita);
    if (
      !quantitaCompatibileConUnitaMisuraEmporio(
        quantitaRiga,
        riga.unitaMisura ?? prodotto.unitaMisura,
      )
    ) {
      throw new SpesaEmporioError(
        409,
        'Il carrello contiene una quantità frazionaria per un prodotto in "pz": è necessaria una verifica manuale.',
      );
    }
    quantityByProduct.set(
      riga.prodottoId,
      (quantityByProduct.get(riga.prodottoId) ?? 0) + quantitaRiga,
    );
  }

  for (const [prodottoId, quantita] of quantityByProduct) {
    const prodotto = productMap.get(prodottoId)!;
    const limitePerSpesa =
      prodotto.quantitaMassimaPerSpesa == null
        ? null
        : parseDbNumber(prodotto.quantitaMassimaPerSpesa);
    const limiteMensile =
      prodotto.quantitaMassimaMensile == null
        ? null
        : parseDbNumber(prodotto.quantitaMassimaMensile);
    if (
      limitePerSpesa != null &&
      limitePerSpesa > 0 &&
      quantita > limitePerSpesa
    ) {
      throw new SpesaEmporioError(
        400,
        "La quantità supera il limite previsto per singola spesa.",
      );
    }
    const giaDistribuita = await quantitaNettaMensileProdotto(
      tx,
      beneficiarioId,
      prodottoId,
      referenceDate,
    );
    if (
      limiteMensile != null &&
      limiteMensile > 0 &&
      round2(giaDistribuita + quantita) > limiteMensile
    ) {
      throw new SpesaEmporioError(
        400,
        "La quantità supera il limite mensile previsto per questo prodotto.",
      );
    }
  }

  return productMap;
}

async function scaricaRigaEmporio(
  tx: Tx,
  opts: {
    riga: CheckoutRow;
    prodotto: ProductRow;
    spesaId: number;
    scaricoId: number;
    bollaId: number;
    numeroBolla: string;
    numeroSpesa: string;
    beneficiarioId: number;
    magazzinoId: number;
    dataMovimento: string;
    dataOperativa: string;
    operatoreId: number | null;
    operazioneDistribuzioneId: number;
  },
) {
  let remaining = InventoryDecimal.parse(opts.riga.quantita);
  const unitaMisura = opts.riga.unitaMisura ?? opts.prodotto.unitaMisura;
  const lotti = await tx
    .select()
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.prodottoId, opts.riga.prodottoId),
        eq(lottiTable.magazzinoId, opts.magazzinoId),
        gt(lottiTable.quantitaResidua, "0"),
        lottoDistribuibileCondition(opts.dataOperativa),
      ),
    )
    .orderBy(
      asc(lottiTable.dataScadenza),
      asc(lottiTable.dataCarico),
      asc(lottiTable.id),
    );

  for (const lotto of lotti) {
    if (!remaining.isPositive()) break;
    await tx.execute(
      sql`SELECT id FROM ${lottiTable} WHERE ${lottiTable.id} = ${lotto.id} FOR UPDATE`,
    );
    const [locked] = await tx
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lotto.id));
    if (!locked) continue;
    if (!isLottoDistribuibile(locked.dataScadenza, opts.dataOperativa))
      continue;
    const residua = InventoryDecimal.parse(locked.quantitaResidua);
    const netto = residua.subtract(
      await activeReservationsForLotto(tx, locked.id),
    );
    const disponibile = netto.isNegative() ? InventoryDecimal.zero() : netto;
    const take = disponibile.min(remaining);
    if (!take.isPositive()) continue;
    const takeNumber = Number(take.toCanonical());

    await tx
      .update(lottiTable)
      .set({ quantitaResidua: residua.subtract(take).toDb() })
      .where(eq(lottiTable.id, locked.id));

    const [bollaRiga] = await tx
      .insert(bollaRigheTable)
      .values({
        bollaId: opts.bollaId,
        prodottoId: opts.riga.prodottoId,
        lottoId: locked.id,
        quantita: take.toDb(),
        unitaMisura,
        note: `Spesa Emporio ${opts.numeroSpesa}`,
      })
      .returning();

    await tx.insert(scaricoRigheTable).values({
      scaricoId: opts.scaricoId,
      prodottoId: opts.riga.prodottoId,
      quantita: take.toDb(),
      unitaMisura,
      note: `Bolla Emporio ${opts.numeroBolla}`,
    });

    await tx.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "spesa_emporio",
      dataMovimento: opts.dataMovimento,
      magazzinoId: opts.magazzinoId,
      prodottoId: opts.riga.prodottoId,
      lottoId: locked.id,
      quantita: take.toDb(),
      quantitaPezzi: unitaMisura.toLowerCase() === "pz" ? take.toDb() : null,
      quantitaKgLt: ["kg", "lt", "l"].includes(unitaMisura.toLowerCase())
        ? take.toDb()
        : null,
      unitaMisura,
      beneficiarioId: opts.beneficiarioId,
      bollaId: opts.bollaId,
      bollaRigaId: bollaRiga.id,
      fondoOrigine: locked.fondoOrigine,
      naturaContabile: "DISTRIBUZIONE_FINALE",
      dominioOrigine: "EMPORIO",
      entitaOrigineTipo: "spesa_emporio",
      entitaOrigineId: opts.spesaId,
      rigaOrigineId: opts.riga.id,
      operazioneDistribuzioneId: opts.operazioneDistribuzioneId,
      canaleOperativo: "EMPORIO",
      operatoreId: opts.operatoreId,
      documentoRiferimento: opts.numeroBolla,
      note: `Scarico da Spesa Emporio ${opts.numeroSpesa}`,
    });

    await tx.insert(speseEmporioRigheTable).values({
      spesaEmporioId: opts.spesaId,
      sessioneCassaRigaId: opts.riga.id,
      prodottoId: opts.riga.prodottoId,
      lottoId: locked.id,
      codiceProdotto: opts.riga.codiceProdotto,
      descrizioneProdotto: opts.riga.descrizioneProdotto,
      quantita: take.toDb(),
      unitaMisura,
      creditoUnitario: opts.riga.creditoUnitario,
      creditoTotale: asDecimal(
        parseDbNumber(opts.riga.creditoUnitario) * takeNumber,
      ),
      scaricoId: opts.scaricoId,
      bollaRigaId: bollaRiga.id,
    });

    remaining = remaining.subtract(take);
  }

  if (remaining.isPositive()) {
    throw new SpesaEmporioError(409, MSG_GIACENZA_INSUFFICIENTE);
  }
}

export async function chiudiSessioneCassaEmporio(opts: {
  sessioneId: number;
  versione: number;
  operatoreId: number | null;
  note?: string | null;
  ip?: string | null;
}): Promise<{ spesaId: number }> {
  return db.transaction(async (tx) => {
    const sessione = await lockSessione(tx, opts.sessioneId);
    if (!sessione)
      throw new SpesaEmporioError(404, "Sessione Cassa Emporio non trovata.");
    if (sessione.versione !== opts.versione) {
      throw new SpesaEmporioError(
        409,
        "La Sessione Cassa Emporio è stata modificata da un altro operatore. Aggiorna i dati e riprova.",
      );
    }
    if (
      sessione.statoSessione === "chiusa" ||
      sessione.spesaEmporioId != null
    ) {
      throw new SpesaEmporioError(400, MSG_SESSIONE_GIA_CHIUSA);
    }
    if (sessione.statoSessione !== "pronta_per_chiusura") {
      throw new SpesaEmporioError(400, MSG_SESSIONE_NON_PRONTA);
    }

    const existingSpesa = await tx
      .select({ id: speseEmporioTable.id })
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.sessioneCassaId, sessione.id))
      .limit(1);
    if (existingSpesa.length > 0)
      throw new SpesaEmporioError(400, MSG_SESSIONE_GIA_CHIUSA);

    const [accesso] = await tx
      .select()
      .from(consegneTable)
      .where(eq(consegneTable.id, sessione.accessoEmporioId));
    if (!accesso || accesso.tipoPianificazione !== "accesso_emporio") {
      throw new SpesaEmporioError(
        400,
        "Accesso Emporio non valido per la Cassa.",
      );
    }
    if (
      accesso.beneficiarioId !== sessione.beneficiarioId ||
      accesso.magazzinoEmporioId !== sessione.magazzinoEmporioId
    ) {
      throw new SpesaEmporioError(
        409,
        "Accesso e Sessione Cassa Emporio non sono coerenti; il record legacy richiede verifica manuale.",
      );
    }

    const beneficiario = await lockBeneficiario(tx, sessione.beneficiarioId);
    if (
      !beneficiario ||
      !beneficiario.attivo ||
      !beneficiario.creditoSolidaleAbilitato ||
      beneficiario.creditoSolidaleStato !== "attivo"
    ) {
      throw new SpesaEmporioError(
        400,
        "Beneficiario non valido per la Cassa Emporio. Verifica che sia attivo, abilitato al Credito Solidale e con Credito Solidale attivo.",
      );
    }

    const dataChiusura = new Date();
    const dataDocumento = dataOperativaEuropeRome(dataChiusura);
    const righe = await tx
      .select()
      .from(sessioniCassaEmporioRigheTable)
      .where(eq(sessioniCassaEmporioRigheTable.sessioneCassaId, sessione.id))
      .orderBy(asc(sessioniCassaEmporioRigheTable.id));
    const productMap = await validateRigheFinali(
      tx,
      righe,
      sessione.beneficiarioId,
      dataChiusura,
    );

    const totaleCredito = round2(
      righe.reduce((acc, riga) => acc + parseDbNumber(riga.creditoTotale), 0),
    );
    if (totaleCredito <= 0)
      throw new SpesaEmporioError(400, MSG_CARRELLO_VUOTO);
    const saldoPrima = parseDbNumber(beneficiario.creditoSolidaleSaldo);
    const saldoDopo = round2(saldoPrima - totaleCredito);
    if (saldoDopo < 0)
      throw new SpesaEmporioError(400, MSG_SALDO_INSUFFICIENTE);

    const numeroSpesa = await generateNumeroSpesa(tx, dataDocumento);
    const numeroBolla = await generateNumeroBolla(tx, dataDocumento);
    const codiceScarico = generateCodiceScarico(dataDocumento);

    const [scarico] = await tx
      .insert(scarichiTable)
      .values({
        codice: codiceScarico,
        magazzinoId: sessione.magazzinoEmporioId,
        centroAscoltoId: sessione.centroAscoltoId,
        dataScarico: dataDocumento,
        causale: "altro",
        causaleAltro: "Spesa Emporio",
        note: `Scarico merce da Spesa Emporio ${numeroSpesa}`,
        operatoreId: opts.operatoreId,
      })
      .returning();

    const [bolla] = await tx
      .insert(bolleTable)
      .values({
        numeroBolla,
        dataBolla: dataDocumento,
        beneficiarioId: sessione.beneficiarioId,
        consegnaId: accesso.id,
        magazzinoId: sessione.magazzinoEmporioId,
        operatoreId: opts.operatoreId,
        stato: "consegnato",
        noteConsegna: `Bolla Emporio da Spesa ${numeroSpesa}`,
        confermaRicezione: true,
        noteRicezione: "Spesa Emporio chiusa da Cassa",
      })
      .returning();

    const [spesa] = await tx
      .insert(speseEmporioTable)
      .values({
        sessioneCassaId: sessione.id,
        accessoEmporioId: accesso.id,
        beneficiarioId: sessione.beneficiarioId,
        centroAscoltoId: sessione.centroAscoltoId,
        areaOperativaId: sessione.areaOperativaId,
        magazzinoEmporioId: sessione.magazzinoEmporioId,
        scaricoId: scarico.id,
        bollaId: bolla.id,
        numeroSpesa,
        dataChiusura,
        totaleCreditoConsumati: asDecimal(totaleCredito),
        saldoPrima: asDecimal(saldoPrima),
        saldoDopo: asDecimal(saldoDopo),
        operatoreChiusuraId: opts.operatoreId,
        note: opts.note ?? null,
      })
      .returning();

    const operationActorId =
      opts.operatoreId ??
      sessione.operatoreUltimaModificaId ??
      sessione.operatoreAperturaId;
    if (operationActorId == null) {
      throw new SpesaEmporioError(
        409,
        "Operatore Emporio non disponibile per l'audit contabile",
      );
    }
    const operation = await ensureDistributionOperation(tx, {
      magazzinoId: sessione.magazzinoEmporioId,
      dataDistribuzione: dataDocumento,
      canaleOperativo: "EMPORIO",
      dominioOrigine: "EMPORIO",
      entitaOrigineTipo: "spesa_emporio",
      entitaOrigineId: spesa.id,
      numeroDocumento: numeroSpesa,
      creatoDa: operationActorId,
    });

    for (const riga of righe) {
      const prodotto = productMap.get(riga.prodottoId);
      if (!prodotto) throw new SpesaEmporioError(400, MSG_PRODOTTO_NON_TROVATO);
      await scaricaRigaEmporio(tx, {
        riga,
        prodotto,
        spesaId: spesa.id,
        scaricoId: scarico.id,
        bollaId: bolla.id,
        numeroBolla,
        numeroSpesa,
        beneficiarioId: sessione.beneficiarioId,
        magazzinoId: sessione.magazzinoEmporioId,
        dataMovimento: dataDocumento,
        dataOperativa: dataDocumento,
        operatoreId: opts.operatoreId,
        operazioneDistribuzioneId: operation.id,
      });
    }

    const [movimento] = await tx
      .insert(creditoSolidaleMovimentiTable)
      .values({
        beneficiarioId: beneficiario.id,
        centroAscoltoId: beneficiario.centroAscoltoId,
        areaOperativaId: beneficiario.areaOperativaId,
        tipoMovimento: "consumo_spesa",
        variazioneCredito: asDecimal(-totaleCredito),
        saldoPrima: asDecimal(saldoPrima),
        saldoDopo: asDecimal(saldoDopo),
        origine: "cassa_emporio",
        riferimentoId: spesa.id,
        riferimentoTipo: "spesa_emporio",
        note: `Consumo Credito Solidale da Spesa Emporio ${numeroSpesa}`,
        motivo: "Spesa Emporio",
        operatoreId: opts.operatoreId,
        dataMovimento: dataChiusura,
      })
      .returning();

    await tx
      .update(beneficiariTable)
      .set({
        creditoSolidaleSaldo: asDecimal(saldoDopo),
        creditoSolidaleDataUltimoMovimento: movimento.dataMovimento,
        dataAggiornamento: dataChiusura,
      })
      .where(eq(beneficiariTable.id, beneficiario.id));

    await tx
      .update(speseEmporioTable)
      .set({
        movimentoCreditoSolidaleId: movimento.id,
        updatedAt: dataChiusura,
      })
      .where(eq(speseEmporioTable.id, spesa.id));

    await tx
      .update(sessioniCassaEmporioTable)
      .set({
        statoSessione: "chiusa",
        dataChiusura,
        spesaEmporioId: spesa.id,
        bollaId: bolla.id,
        movimentoCreditoSolidaleId: movimento.id,
        operatoreChiusuraId: opts.operatoreId,
        operatoreUltimaModificaId: opts.operatoreId,
        dataUltimaModifica: dataChiusura,
        versione: sql`${sessioniCassaEmporioTable.versione} + 1`,
      })
      .where(eq(sessioniCassaEmporioTable.id, sessione.id));

    await tx
      .update(consegneTable)
      .set({
        statoAccessoEmporio: "effettuato",
        stato: "effettuata",
        dataEffettuata: dataChiusura,
        dataOraEffettivaAccesso:
          accesso.dataOraEffettivaAccesso ?? dataChiusura,
        operatoreAccessoEmporioId:
          accesso.operatoreAccessoEmporioId ?? opts.operatoreId,
      })
      .where(eq(consegneTable.id, accesso.id));

    await auditEmporioTx(tx, {
      entityType: "sessione",
      entityId: sessione.id,
      action: "chiusura",
      operatoreId: opts.operatoreId,
      ip: opts.ip,
      before: { stato: sessione.statoSessione, versione: sessione.versione },
      after: {
        stato: "chiusa",
        versione: sessione.versione + 1,
        spesaId: spesa.id,
        bollaId: bolla.id,
        scaricoId: scarico.id,
      },
    });

    return { spesaId: spesa.id };
  });
}

function formatSpesa(
  row: {
    s: typeof speseEmporioTable.$inferSelect;
    beneficiarioNome: string | null;
    beneficiarioCodice: string | null;
    centroAscoltoNome: string | null;
    areaOperativaNome: string | null;
    magazzinoEmporioNome: string | null;
    bollaNumero: string | null;
    operatoreMatricola: string | null;
    operatoreUsername: string | null;
  },
  righe: Array<{
    r: typeof speseEmporioRigheTable.$inferSelect;
    prodottoNome: string | null;
    codiceLotto: string | null;
    fsePlus: boolean | null;
  }> = [],
  quantitaStornataByRiga = new Map<number, number>(),
) {
  return {
    id: row.s.id,
    sessioneCassaId: row.s.sessioneCassaId,
    accessoEmporioId: row.s.accessoEmporioId,
    beneficiarioId: row.s.beneficiarioId,
    beneficiarioNome: row.beneficiarioNome,
    beneficiarioCodice: row.beneficiarioCodice,
    centroAscoltoId: row.s.centroAscoltoId,
    centroAscoltoNome: row.centroAscoltoNome,
    areaOperativaId: row.s.areaOperativaId,
    areaOperativaNome: row.areaOperativaNome,
    magazzinoEmporioId: row.s.magazzinoEmporioId,
    magazzinoEmporioNome: row.magazzinoEmporioNome,
    scaricoId: row.s.scaricoId,
    bollaId: row.s.bollaId,
    bollaNumero: row.bollaNumero,
    movimentoCreditoSolidaleId: row.s.movimentoCreditoSolidaleId,
    numeroSpesa: row.s.numeroSpesa,
    dataChiusura: row.s.dataChiusura.toISOString(),
    totaleCreditoConsumati: parseDbNumber(row.s.totaleCreditoConsumati),
    saldoPrima: parseDbNumber(row.s.saldoPrima),
    saldoDopo: parseDbNumber(row.s.saldoDopo),
    statoSpesa: row.s.statoSpesa,
    operatoreChiusuraId: row.s.operatoreChiusuraId,
    operatoreCodice: operatorLabel(row),
    emailBollaStato: normalizeEmailBollaStato(row.s.emailBollaStato),
    emailBollaDestinatari: row.s.emailBollaDestinatari,
    emailBollaDataInvio: row.s.emailBollaDataInvio?.toISOString() ?? null,
    emailBollaDataUltimoClick:
      row.s.emailBollaDataUltimoClick?.toISOString() ??
      row.s.emailBollaDataInvio?.toISOString() ??
      null,
    emailBollaOperatoreId: row.s.emailBollaOperatoreId,
    emailBollaOggetto: row.s.emailBollaOggetto,
    emailBollaErrore: row.s.emailBollaErrore,
    note: row.s.note,
    righe: righe.map((r) => ({
      id: r.r.id,
      spesaEmporioId: r.r.spesaEmporioId,
      sessioneCassaRigaId: r.r.sessioneCassaRigaId,
      prodottoId: r.r.prodottoId,
      prodottoNome: r.prodottoNome ?? r.r.descrizioneProdotto,
      lottoId: r.r.lottoId,
      codiceLotto: r.codiceLotto,
      codiceProdotto: r.r.codiceProdotto,
      descrizioneProdotto: r.r.descrizioneProdotto,
      quantita: parseDbNumber(r.r.quantita),
      unitaMisura: r.r.unitaMisura,
      quantitaStornata: quantitaStornataByRiga.get(r.r.id) ?? 0,
      quantitaStornabile: round2(
        Math.max(
          0,
          parseDbNumber(r.r.quantita) -
            (quantitaStornataByRiga.get(r.r.id) ?? 0),
        ),
      ),
      creditoUnitario: parseDbNumber(r.r.creditoUnitario),
      creditoTotale: parseDbNumber(r.r.creditoTotale),
      scaricoId: r.r.scaricoId,
      bollaRigaId: r.r.bollaRigaId,
      fsePlus: r.fsePlus ?? false,
    })),
    createdAt: row.s.createdAt.toISOString(),
    updatedAt: row.s.updatedAt.toISOString(),
  };
}

function baseSpeseQuery(conditions: SQL[] = []) {
  return db
    .select({
      s: speseEmporioTable,
      beneficiarioNome: sql<string>`trim(coalesce(${beneficiariTable.cognome}, '') || ' ' || coalesce(${beneficiariTable.nome}, ''))`,
      beneficiarioCodice: beneficiariTable.codice,
      centroAscoltoNome: centriAscoltoTable.nome,
      areaOperativaNome: areeOperativeTable.nome,
      magazzinoEmporioNome: magazziniTable.nome,
      bollaNumero: bolleTable.numeroBolla,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
    })
    .from(speseEmporioTable)
    .leftJoin(
      beneficiariTable,
      eq(speseEmporioTable.beneficiarioId, beneficiariTable.id),
    )
    .leftJoin(
      centriAscoltoTable,
      eq(speseEmporioTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .leftJoin(
      areeOperativeTable,
      eq(speseEmporioTable.areaOperativaId, areeOperativeTable.id),
    )
    .leftJoin(
      magazziniTable,
      eq(speseEmporioTable.magazzinoEmporioId, magazziniTable.id),
    )
    .leftJoin(bolleTable, eq(speseEmporioTable.bollaId, bolleTable.id))
    .leftJoin(
      utentiTable,
      eq(speseEmporioTable.operatoreChiusuraId, utentiTable.id),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined);
}

export async function listSpeseEmporio(
  params: {
    dataDa?: string;
    dataA?: string;
    beneficiarioSearch?: string;
    beneficiarioId?: number;
    magazzinoEmporioId?: number;
    centroAscoltoId?: number;
    areaOperativaId?: number;
    zonaUdsId?: number;
    visibleMagazzinoIds?: number[] | null;
    page?: number;
    limit?: number;
  } = {},
) {
  const conditions: SQL[] = [];
  if (params.dataDa)
    conditions.push(
      gte(
        speseEmporioTable.dataChiusura,
        intervalloGiornoEuropeRome(params.dataDa).start,
      ),
    );
  if (params.dataA)
    conditions.push(
      lt(
        speseEmporioTable.dataChiusura,
        intervalloGiornoEuropeRome(params.dataA).end,
      ),
    );
  if (params.beneficiarioId != null)
    conditions.push(
      eq(speseEmporioTable.beneficiarioId, params.beneficiarioId),
    );
  if (params.magazzinoEmporioId != null)
    conditions.push(
      eq(speseEmporioTable.magazzinoEmporioId, params.magazzinoEmporioId),
    );
  if (params.centroAscoltoId != null)
    conditions.push(
      eq(speseEmporioTable.centroAscoltoId, params.centroAscoltoId),
    );
  if (params.areaOperativaId != null)
    conditions.push(
      eq(speseEmporioTable.areaOperativaId, params.areaOperativaId),
    );
  if (params.zonaUdsId != null)
    conditions.push(eq(beneficiariTable.zonaUdsId, params.zonaUdsId));
  const magazzinoFilter = magazzinoScopeFilter(
    speseEmporioTable.magazzinoEmporioId,
    params.visibleMagazzinoIds ?? null,
  );
  if (magazzinoFilter) conditions.push(magazzinoFilter);
  if (params.beneficiarioSearch) {
    const s = `%${params.beneficiarioSearch}%`;
    conditions.push(
      or(
        ilike(beneficiariTable.nome, s),
        ilike(beneficiariTable.cognome, s),
        ilike(beneficiariTable.codice, s),
        ilike(beneficiariTable.codiceFiscale, s),
        ilike(
          sql<string>`trim(coalesce(${beneficiariTable.cognome}, '') || ' ' || coalesce(${beneficiariTable.nome}, ''))`,
          s,
        ),
      )!,
    );
  }

  const page = params.page ?? 1;
  const limit = params.limit ?? 50;
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(speseEmporioTable)
    .leftJoin(
      beneficiariTable,
      eq(speseEmporioTable.beneficiarioId, beneficiariTable.id),
    )
    .where(where);
  const rows = await baseSpeseQuery(conditions)
    .orderBy(desc(speseEmporioTable.dataChiusura), desc(speseEmporioTable.id))
    .limit(limit)
    .offset((page - 1) * limit);
  return { rows: rows.map((row) => formatSpesa(row)), total };
}

export async function getSpesaEmporio(id: number) {
  const rows = await baseSpeseQuery([eq(speseEmporioTable.id, id)]).limit(1);
  if (rows.length === 0) return null;
  const righe = await db
    .select({
      r: speseEmporioRigheTable,
      prodottoNome: prodottiTable.nome,
      codiceLotto: lottiTable.codiceLotto,
      fsePlus: lottiTable.fsePlus,
    })
    .from(speseEmporioRigheTable)
    .leftJoin(
      prodottiTable,
      eq(speseEmporioRigheTable.prodottoId, prodottiTable.id),
    )
    .leftJoin(lottiTable, eq(speseEmporioRigheTable.lottoId, lottiTable.id))
    .where(eq(speseEmporioRigheTable.spesaEmporioId, id))
    .orderBy(asc(speseEmporioRigheTable.id));
  const reversed = await db
    .select({
      spesaRigaId: speseEmporioStorniRigheTable.spesaRigaId,
      quantita: sum(speseEmporioStorniRigheTable.quantita),
    })
    .from(speseEmporioStorniRigheTable)
    .innerJoin(
      speseEmporioRigheTable,
      eq(speseEmporioStorniRigheTable.spesaRigaId, speseEmporioRigheTable.id),
    )
    .where(eq(speseEmporioRigheTable.spesaEmporioId, id))
    .groupBy(speseEmporioStorniRigheTable.spesaRigaId);
  return formatSpesa(
    rows[0],
    righe,
    new Map(
      reversed.map((row) => [row.spesaRigaId, parseDbNumber(row.quantita)]),
    ),
  );
}

export async function getSpesaEmporioBySessione(sessioneCassaId: number) {
  const [row] = await db
    .select({ id: speseEmporioTable.id })
    .from(speseEmporioTable)
    .where(eq(speseEmporioTable.sessioneCassaId, sessioneCassaId))
    .limit(1);
  return row ? getSpesaEmporio(row.id) : null;
}

export async function getBollaStampaSpesaEmporio(id: number) {
  const spesa = await getSpesaEmporio(id);
  if (!spesa) return null;
  const [dati] = await db
    .select({
      beneficiarioNome: sql<string>`trim(coalesce(${beneficiariTable.cognome}, '') || ' ' || coalesce(${beneficiariTable.nome}, ''))`,
      beneficiarioCodice: beneficiariTable.codice,
      beneficiarioCodiceFiscale: beneficiariTable.codiceFiscale,
      centroAscoltoNome: centriAscoltoTable.nome,
      magazzinoNome: magazziniTable.nome,
      magazzinoIndirizzo: magazziniTable.indirizzo,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
      dataBolla: bolleTable.dataBolla,
    })
    .from(speseEmporioTable)
    .leftJoin(
      beneficiariTable,
      eq(speseEmporioTable.beneficiarioId, beneficiariTable.id),
    )
    .leftJoin(
      centriAscoltoTable,
      eq(speseEmporioTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .leftJoin(
      magazziniTable,
      eq(speseEmporioTable.magazzinoEmporioId, magazziniTable.id),
    )
    .leftJoin(
      utentiTable,
      eq(speseEmporioTable.operatoreChiusuraId, utentiTable.id),
    )
    .leftJoin(bolleTable, eq(speseEmporioTable.bollaId, bolleTable.id))
    .where(eq(speseEmporioTable.id, id));

  return {
    intestazione: "Magazzino Solidale / Angeli in Moto",
    numeroBolla: spesa.bollaNumero,
    numeroSpesa: spesa.numeroSpesa,
    dataChiusura: spesa.dataChiusura,
    dataBolla:
      dati?.dataBolla ?? dataOperativaEuropeRome(new Date(spesa.dataChiusura)),
    beneficiario: dati?.beneficiarioNome ?? spesa.beneficiarioNome,
    beneficiarioCodice: dati?.beneficiarioCodice ?? spesa.beneficiarioCodice,
    beneficiarioCodiceFiscale: dati?.beneficiarioCodiceFiscale ?? null,
    centroAscolto: dati?.centroAscoltoNome ?? spesa.centroAscoltoNome,
    emporio: dati?.magazzinoNome ?? spesa.magazzinoEmporioNome,
    emporioIndirizzo: dati?.magazzinoIndirizzo ?? null,
    operatore: dati ? operatorLabel(dati) : spesa.operatoreCodice,
    righe: spesa.righe,
    totaleCreditoConsumati: spesa.totaleCreditoConsumati,
    saldoPrima: spesa.saldoPrima,
    saldoDopo: spesa.saldoDopo,
    note: spesa.note,
  };
}

export type StornoSpesaEmporioInput = {
  spesaId: number;
  motivo: string;
  righe?: Array<{ spesaRigaId: number; quantita: number }>;
  operatoreId: number | null;
  idempotencyKey?: string | null;
  ip?: string | null;
};

export async function stornaSpesaEmporio(
  opts: StornoSpesaEmporioInput,
): Promise<{ stornoId: number; creditoRestituito: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ${speseEmporioTable} WHERE ${speseEmporioTable.id} = ${opts.spesaId} FOR UPDATE`,
    );
    const [spesa] = await tx
      .select()
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.id, opts.spesaId));
    if (!spesa) throw new SpesaEmporioError(404, "Spesa Emporio non trovata.");

    if (opts.idempotencyKey) {
      const [replay] = await tx
        .select()
        .from(speseEmporioStorniTable)
        .where(eq(speseEmporioStorniTable.idempotencyKey, opts.idempotencyKey));
      if (replay) {
        if (replay.spesaEmporioId !== spesa.id) {
          throw new SpesaEmporioError(
            409,
            "La chiave di idempotenza è già associata a un'altra Spesa.",
          );
        }
        return {
          stornoId: replay.id,
          creditoRestituito: parseDbNumber(replay.creditoRestituito),
        };
      }
    }

    const righe = await tx
      .select()
      .from(speseEmporioRigheTable)
      .where(eq(speseEmporioRigheTable.spesaEmporioId, spesa.id))
      .orderBy(asc(speseEmporioRigheTable.id));
    if (righe.length === 0) {
      throw new SpesaEmporioError(
        409,
        "La Spesa non contiene righe stornabili.",
      );
    }
    const reversed = await tx
      .select({
        spesaRigaId: speseEmporioStorniRigheTable.spesaRigaId,
        quantita: sum(speseEmporioStorniRigheTable.quantita),
      })
      .from(speseEmporioStorniRigheTable)
      .innerJoin(
        speseEmporioRigheTable,
        eq(speseEmporioStorniRigheTable.spesaRigaId, speseEmporioRigheTable.id),
      )
      .where(eq(speseEmporioRigheTable.spesaEmporioId, spesa.id))
      .groupBy(speseEmporioStorniRigheTable.spesaRigaId);
    const reversedByRiga = new Map(
      reversed.map((row) => [row.spesaRigaId, parseDbNumber(row.quantita)]),
    );
    const rowById = new Map(righe.map((row) => [row.id, row]));
    const requested = new Map<number, number>();
    if (opts.righe == null) {
      for (const row of righe) {
        const residual = round2(
          parseDbNumber(row.quantita) - (reversedByRiga.get(row.id) ?? 0),
        );
        if (residual > 0) requested.set(row.id, residual);
      }
    } else {
      for (const input of opts.righe) {
        if (requested.has(input.spesaRigaId)) {
          throw new SpesaEmporioError(
            400,
            "Una riga di Spesa è stata indicata più volte.",
          );
        }
        if (!Number.isFinite(input.quantita) || input.quantita <= 0) {
          throw new SpesaEmporioError(
            400,
            "Le quantità da stornare devono essere positive.",
          );
        }
        requested.set(input.spesaRigaId, round2(input.quantita));
      }
    }
    if (requested.size === 0) {
      throw new SpesaEmporioError(
        409,
        "La Spesa risulta già completamente stornata.",
      );
    }

    let creditoRestituito = 0;
    for (const [rowId, quantity] of requested) {
      const row = rowById.get(rowId);
      if (!row) throw new SpesaEmporioError(400, "Riga Spesa non valida.");
      const residual = round2(
        parseDbNumber(row.quantita) - (reversedByRiga.get(rowId) ?? 0),
      );
      if (quantity > residual) {
        throw new SpesaEmporioError(
          409,
          "La quantità richiesta supera quella ancora stornabile.",
        );
      }
      creditoRestituito = round2(
        creditoRestituito + parseDbNumber(row.creditoUnitario) * quantity,
      );
    }
    if (creditoRestituito <= 0) {
      throw new SpesaEmporioError(
        409,
        "Lo storno non produce Credito restituibile.",
      );
    }

    const beneficiario = await lockBeneficiario(tx, spesa.beneficiarioId);
    if (!beneficiario) {
      throw new SpesaEmporioError(409, "Beneficiario della Spesa non trovato.");
    }
    const saldoPrima = parseDbNumber(beneficiario.creditoSolidaleSaldo);
    const saldoDopo = round2(saldoPrima + creditoRestituito);
    const [storno] = await tx
      .insert(speseEmporioStorniTable)
      .values({
        spesaEmporioId: spesa.id,
        motivo: opts.motivo,
        operatoreId: opts.operatoreId,
        creditoRestituito: asDecimal(creditoRestituito),
        idempotencyKey: opts.idempotencyKey ?? null,
      })
      .returning();

    const dataMovimento = dataOperativaEuropeRome();
    const distributionOperationIds = new Set<number>();
    for (const [rowId, quantity] of requested) {
      const row = rowById.get(rowId)!;
      if (row.lottoId == null || row.bollaRigaId == null) {
        throw new SpesaEmporioError(
          409,
          "La riga legacy non contiene riferimenti sufficienti per ripristinare il Lotto esatto.",
        );
      }
      await tx.execute(
        sql`SELECT id FROM ${lottiTable} WHERE ${lottiTable.id} = ${row.lottoId} FOR UPDATE`,
      );
      const [lotto] = await tx
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.id, row.lottoId));
      if (!lotto)
        throw new SpesaEmporioError(409, "Lotto originale non trovato.");
      const [originalMovement] = await tx
        .select()
        .from(movimentiTable)
        .where(
          and(
            eq(movimentiTable.bollaRigaId, row.bollaRigaId),
            eq(movimentiTable.tipoMovimento, "scarico"),
            eq(movimentiTable.lottoId, row.lottoId),
          ),
        )
        .orderBy(asc(movimentiTable.id))
        .limit(1);
      if (!originalMovement) {
        throw new SpesaEmporioError(
          409,
          "Movimento inventariale originale non trovato; storno automatico non sicuro.",
        );
      }
      const unitaMisura = row.unitaMisura ?? originalMovement.unitaMisura;
      await tx
        .update(lottiTable)
        .set({
          quantitaResidua: InventoryDecimal.parse(lotto.quantitaResidua)
            .add(InventoryDecimal.parse(quantity))
            .toDb(),
        })
        .where(eq(lottiTable.id, lotto.id));
      const [movement] = await tx
        .insert(movimentiTable)
        .values({
          tipoMovimento: "carico",
          tipoDettaglio: "storno_spesa_emporio",
          dataMovimento,
          magazzinoId: spesa.magazzinoEmporioId,
          prodottoId: row.prodottoId,
          lottoId: lotto.id,
          quantita: InventoryDecimal.parse(quantity).toDb(),
          unitaMisura,
          beneficiarioId: spesa.beneficiarioId,
          bollaId: spesa.bollaId,
          bollaRigaId: row.bollaRigaId,
          quantitaPezzi: originalMovement.quantitaPezzi,
          quantitaKgLt: originalMovement.quantitaKgLt,
          fondoOrigine: originalMovement.fondoOrigine,
          naturaContabile: "STORNO",
          dominioOrigine: originalMovement.dominioOrigine,
          entitaOrigineTipo: originalMovement.entitaOrigineTipo,
          entitaOrigineId: originalMovement.entitaOrigineId,
          rigaOrigineId: originalMovement.rigaOrigineId,
          operazioneDistribuzioneId: originalMovement.operazioneDistribuzioneId,
          canaleOperativo: originalMovement.canaleOperativo,
          operatoreId: opts.operatoreId,
          documentoRiferimento: `STORNO-${storno.id}`,
          note: `Storno compensativo Spesa Emporio ${spesa.numeroSpesa}: ${opts.motivo}`,
        })
        .returning();
      if (originalMovement.operazioneDistribuzioneId != null) {
        distributionOperationIds.add(
          originalMovement.operazioneDistribuzioneId,
        );
      }
      await tx.insert(speseEmporioStorniRigheTable).values({
        stornoId: storno.id,
        spesaRigaId: row.id,
        quantita: asDecimal(quantity),
        creditoRestituito: asDecimal(
          parseDbNumber(row.creditoUnitario) * quantity,
        ),
        movimentoInventarioId: movement.id,
        movimentoInventarioOriginaleId: originalMovement.id,
      });
    }

    const now = new Date();
    const [creditMovement] = await tx
      .insert(creditoSolidaleMovimentiTable)
      .values({
        beneficiarioId: beneficiario.id,
        centroAscoltoId: beneficiario.centroAscoltoId,
        areaOperativaId: beneficiario.areaOperativaId,
        tipoMovimento: "storno",
        variazioneCredito: asDecimal(creditoRestituito),
        saldoPrima: asDecimal(saldoPrima),
        saldoDopo: asDecimal(saldoDopo),
        origine: "storno_spesa_emporio",
        riferimentoId: storno.id,
        riferimentoTipo: "storno_spesa_emporio",
        motivo: opts.motivo,
        note: `Restituzione Credito da Spesa ${spesa.numeroSpesa}`,
        operatoreId: opts.operatoreId,
        dataMovimento: now,
      })
      .returning();
    await tx
      .update(beneficiariTable)
      .set({
        creditoSolidaleSaldo: asDecimal(saldoDopo),
        creditoSolidaleDataUltimoMovimento: creditMovement.dataMovimento,
        dataAggiornamento: now,
      })
      .where(eq(beneficiariTable.id, beneficiario.id));
    await tx
      .update(speseEmporioStorniTable)
      .set({ movimentoCreditoSolidaleId: creditMovement.id })
      .where(eq(speseEmporioStorniTable.id, storno.id));

    const fullyReversed = righe.every((row) => {
      const residual = round2(
        parseDbNumber(row.quantita) - (reversedByRiga.get(row.id) ?? 0),
      );
      return round2(residual - (requested.get(row.id) ?? 0)) === 0;
    });
    const statoSpesa = fullyReversed ? "stornata" : "stornata_parzialmente";
    if (fullyReversed) {
      for (const operationId of distributionOperationIds) {
        await markDistributionOperationReversed(tx, operationId);
      }
    }
    await tx
      .update(speseEmporioTable)
      .set({ statoSpesa, updatedAt: now })
      .where(eq(speseEmporioTable.id, spesa.id));
    await auditEmporioTx(tx, {
      entityType: "storno",
      entityId: storno.id,
      action: statoSpesa === "stornata" ? "storno-totale" : "storno-parziale",
      operatoreId: opts.operatoreId,
      ip: opts.ip,
      motivo: opts.motivo,
      metadata: {
        spesaId: spesa.id,
        righe: [...requested].map(([spesaRigaId, quantita]) => ({
          spesaRigaId,
          quantita,
        })),
        creditoRestituito,
      },
    });
    return { stornoId: storno.id, creditoRestituito };
  });
}

function uniqueEmails(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const email = value?.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

function buildMailtoHref(
  recipients: string[],
  subject: string,
  body: string,
): string {
  const to = recipients
    .map((recipient) => encodeURIComponent(recipient))
    .join(",");
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function getDestinatariBollaEmporio(spesaId: number): Promise<string[]> {
  const [recipientsRow] = await db
    .select({
      centroEmail: centriAscoltoTable.email,
      beneficiarioEmail: beneficiariTable.email,
    })
    .from(speseEmporioTable)
    .leftJoin(
      centriAscoltoTable,
      eq(speseEmporioTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .leftJoin(
      beneficiariTable,
      eq(speseEmporioTable.beneficiarioId, beneficiariTable.id),
    )
    .where(eq(speseEmporioTable.id, spesaId));

  return uniqueEmails([
    recipientsRow?.centroEmail,
    recipientsRow?.beneficiarioEmail,
  ]);
}

export async function registraInvioManualeBollaEmporio(opts: {
  spesaId: number;
  operatoreId: number | null;
  linkBolla: string;
  ip?: string | null;
}) {
  const spesa = await getSpesaEmporio(opts.spesaId);
  if (!spesa) throw new SpesaEmporioError(404, "Spesa Emporio non trovata.");

  const recipients = await getDestinatariBollaEmporio(opts.spesaId);
  const subject =
    `Bolla Emporio Solidale ${spesa.bollaNumero ?? spesa.numeroSpesa} - ${spesa.beneficiarioNome ?? ""}`.trim();
  const body = [
    "Gentili,",
    "",
    "è disponibile la Bolla Emporio Solidale relativa alla spesa effettuata.",
    "",
    `Numero Bolla: ${spesa.bollaNumero ?? "-"}`,
    `Numero Spesa: ${spesa.numeroSpesa}`,
    `Beneficiario: ${spesa.beneficiarioNome ?? "-"}`,
    `Data: ${new Date(spesa.dataChiusura).toLocaleString("it-IT")}`,
    `Emporio: ${spesa.magazzinoEmporioNome ?? "-"}`,
    "",
    `Link Bolla: ${opts.linkBolla}`,
    "",
    "Cordiali saluti",
    "Magazzino Solidale",
  ].join("\n");

  const now = new Date();
  const stato: EmailBollaStato =
    recipients.length === 0 ? "nessun_destinatario" : "invio_manuale_avviato";
  const messaggio =
    recipients.length === 0
      ? "Nessun destinatario email disponibile. Copia manualmente il link alla Bolla e invialo dal tuo client di posta."
      : "Apertura email Bolla avviata nel client mail locale.";

  await db.transaction(async (tx) => {
    await tx
      .update(speseEmporioTable)
      .set({
        emailBollaStato: stato,
        emailBollaDestinatari:
          recipients.length > 0 ? recipients.join(", ") : null,
        emailBollaDataUltimoClick: now,
        emailBollaOperatoreId: opts.operatoreId,
        emailBollaOggetto: subject,
        emailBollaErrore:
          recipients.length === 0
            ? "Nessun destinatario email disponibile. Copia manualmente il link alla Bolla e invialo dal tuo client di posta."
            : null,
        updatedAt: now,
      })
      .where(eq(speseEmporioTable.id, opts.spesaId));
    await auditEmporioTx(tx, {
      entityType: "spesa",
      entityId: opts.spesaId,
      action: "preparazione-email-bolla",
      operatoreId: opts.operatoreId,
      ip: opts.ip,
      metadata: { stato, destinatari: recipients.length },
    });
  });

  return {
    stato,
    destinatari: recipients,
    destinatario: recipients[0] ?? null,
    oggetto: subject,
    corpo: body,
    linkBolla: opts.linkBolla,
    mailtoHref:
      recipients.length > 0 ? buildMailtoHref(recipients, subject, body) : null,
    messaggio,
  };
}
