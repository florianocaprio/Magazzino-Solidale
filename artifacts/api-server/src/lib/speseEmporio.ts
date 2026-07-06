import {
  beneficiariTable,
  bolleTable,
  bollaRigheTable,
  centriAscoltoTable,
  cittaTable,
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
  speseEmporioTable,
  utentiTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, gte, ilike, inArray, like, lt, or, sql, sum, type SQL } from "drizzle-orm";
import { parseDbNumber } from "./disponibilitaMagazzino";

const PRENOTAZIONE_ATTIVA = "attiva";

export const MSG_SESSIONE_NON_PRONTA = "La sessione Cassa Emporio non è pronta per la chiusura.";
export const MSG_SESSIONE_GIA_CHIUSA = "La sessione Cassa Emporio risulta già chiusa.";
export const MSG_SALDO_INSUFFICIENTE = "Saldo Credito Solidale insufficiente per chiudere la spesa.";
export const MSG_GIACENZA_INSUFFICIENTE = "Giacenza insufficiente per chiudere la spesa Emporio.";
export const MSG_CARRELLO_VUOTO = "Il Carrello Emporio è vuoto.";
export const MSG_PRODOTTO_NON_ABILITATO = "Prodotto non trovato o non abilitato per Emporio.";
export const MSG_PRODOTTO_SENZA_CREDITO = "Il prodotto non ha un Valore Credito Solidale configurato.";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type CheckoutRow = typeof sessioniCassaEmporioRigheTable.$inferSelect;
type ProductRow = typeof prodottiTable.$inferSelect;
type EmailBollaStato = "non_preparata" | "invio_manuale_avviato" | "nessun_destinatario" | "errore";

export class SpesaEmporioError extends Error {
  constructor(public status: number, message: string) {
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
  return new Date().toISOString().slice(0, 10);
}

function operatorLabel(row: { operatoreMatricola: string | null; operatoreUsername: string | null }): string | null {
  return row.operatoreMatricola ?? row.operatoreUsername ?? null;
}

function normalizeEmailBollaStato(value: string): EmailBollaStato {
  if (value === "inviata" || value === "invio_manuale_avviato") return "invio_manuale_avviato";
  if (value === "nessun_destinatario") return "nessun_destinatario";
  if (value === "errore") return "errore";
  return "non_preparata";
}

async function lockSessione(tx: Tx, sessioneId: number) {
  await tx.execute(sql`SELECT id FROM ${sessioniCassaEmporioTable} WHERE ${sessioniCassaEmporioTable.id} = ${sessioneId} FOR UPDATE`);
  const [sessione] = await tx.select().from(sessioniCassaEmporioTable).where(eq(sessioniCassaEmporioTable.id, sessioneId));
  return sessione ?? null;
}

async function lockBeneficiario(tx: Tx, beneficiarioId: number) {
  await tx.execute(sql`SELECT id FROM ${beneficiariTable} WHERE ${beneficiariTable.id} = ${beneficiarioId} FOR UPDATE`);
  const [beneficiario] = await tx.select().from(beneficiariTable).where(eq(beneficiariTable.id, beneficiarioId));
  return beneficiario ?? null;
}

async function generateNumeroSpesa(tx: Tx): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `EMP-${year}-`;
  const [last] = await tx
    .select({ numeroSpesa: speseEmporioTable.numeroSpesa })
    .from(speseEmporioTable)
    .where(like(speseEmporioTable.numeroSpesa, `${prefix}%`))
    .orderBy(desc(speseEmporioTable.numeroSpesa))
    .limit(1);
  const next = last?.numeroSpesa?.startsWith(prefix) ? Number(last.numeroSpesa.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(Number.isFinite(next) ? next : 1).padStart(5, "0")}`;
}

async function generateNumeroBolla(tx: Tx): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `BOLLA-${year}-`;
  const [last] = await tx
    .select({ numeroBolla: bolleTable.numeroBolla })
    .from(bolleTable)
    .where(like(bolleTable.numeroBolla, `${prefix}%`))
    .orderBy(desc(bolleTable.numeroBolla))
    .limit(1);
  const next = last?.numeroBolla?.startsWith(prefix) ? Number(last.numeroBolla.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(Number.isFinite(next) ? next : 1).padStart(4, "0")}`;
}

function generateCodiceScarico(): string {
  const year = new Date().getFullYear();
  const millis = Date.now().toString(36).toUpperCase().slice(-8);
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `SCAR-${year}-${millis}-${suffix}`;
}

async function activeReservationsForLotto(tx: Tx, lottoId: number): Promise<number> {
  const [row] = await tx
    .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
    .from(prenotazioniMagazzinoTable)
    .where(and(
      eq(prenotazioniMagazzinoTable.lottoId, lottoId),
      eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
    ));
  return parseDbNumber(row?.totale);
}

async function validateRigheFinali(tx: Tx, righe: CheckoutRow[]): Promise<Map<number, ProductRow>> {
  if (righe.length === 0) throw new SpesaEmporioError(400, MSG_CARRELLO_VUOTO);
  const prodottoIds = [...new Set(righe.map((r) => r.prodottoId))];
  const prodotti = await tx.select().from(prodottiTable).where(inArray(prodottiTable.id, prodottoIds));
  const productMap = new Map(prodotti.map((p) => [p.id, p]));

  const quantityByProduct = new Map<number, number>();
  for (const riga of righe) {
    const prodotto = productMap.get(riga.prodottoId);
    if (!prodotto || !prodotto.attivo || !prodotto.abilitatoEmporio) {
      throw new SpesaEmporioError(400, MSG_PRODOTTO_NON_ABILITATO);
    }
    if (parseDbNumber(prodotto.creditoSolidaleValore) <= 0) {
      throw new SpesaEmporioError(400, MSG_PRODOTTO_SENZA_CREDITO);
    }
    quantityByProduct.set(riga.prodottoId, (quantityByProduct.get(riga.prodottoId) ?? 0) + Number(riga.quantita));
  }

  for (const [prodottoId, quantita] of quantityByProduct) {
    const prodotto = productMap.get(prodottoId)!;
    const limitePerSpesa = prodotto.quantitaMassimaPerSpesa == null ? null : parseDbNumber(prodotto.quantitaMassimaPerSpesa);
    const limiteMensile = prodotto.quantitaMassimaMensile == null ? null : parseDbNumber(prodotto.quantitaMassimaMensile);
    if (limitePerSpesa != null && limitePerSpesa > 0 && quantita > limitePerSpesa) {
      throw new SpesaEmporioError(400, "La quantità supera il limite previsto per singola spesa.");
    }
    if (limiteMensile != null && limiteMensile > 0 && quantita > limiteMensile) {
      throw new SpesaEmporioError(400, "La quantità supera il limite mensile previsto per questo prodotto.");
    }
  }

  return productMap;
}

async function scaricaRigaEmporio(tx: Tx, opts: {
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
}) {
  let remaining = Number(opts.riga.quantita);
  const lotti = await tx
    .select()
    .from(lottiTable)
    .where(and(
      eq(lottiTable.prodottoId, opts.riga.prodottoId),
      eq(lottiTable.magazzinoId, opts.magazzinoId),
      gt(lottiTable.quantitaResidua, "0"),
    ))
    .orderBy(asc(lottiTable.dataScadenza), asc(lottiTable.dataCarico), asc(lottiTable.id));

  for (const lotto of lotti) {
    if (remaining <= 0) break;
    await tx.execute(sql`SELECT id FROM ${lottiTable} WHERE ${lottiTable.id} = ${lotto.id} FOR UPDATE`);
    const [locked] = await tx.select().from(lottiTable).where(eq(lottiTable.id, lotto.id));
    if (!locked) continue;
    const residua = parseDbNumber(locked.quantitaResidua);
    const disponibile = Math.max(0, residua - await activeReservationsForLotto(tx, locked.id));
    const take = Math.min(disponibile, remaining);
    if (take <= 0) continue;

    await tx
      .update(lottiTable)
      .set({ quantitaResidua: asDecimal(residua - take) })
      .where(eq(lottiTable.id, locked.id));

    const [bollaRiga] = await tx
      .insert(bollaRigheTable)
      .values({
        bollaId: opts.bollaId,
        prodottoId: opts.riga.prodottoId,
        lottoId: locked.id,
        quantita: asDecimal(take),
        unitaMisura: opts.prodotto.unitaMisura ?? "pz",
        note: `Spesa Emporio ${opts.numeroSpesa}`,
      })
      .returning();

    await tx.insert(scaricoRigheTable).values({
      scaricoId: opts.scaricoId,
      prodottoId: opts.riga.prodottoId,
      quantita: asDecimal(take),
      unitaMisura: opts.prodotto.unitaMisura ?? "pz",
      note: `Bolla Emporio ${opts.numeroBolla}`,
    });

    await tx.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "spesa_emporio",
      dataMovimento: opts.dataMovimento,
      magazzinoId: opts.magazzinoId,
      prodottoId: opts.riga.prodottoId,
      lottoId: locked.id,
      quantita: asDecimal(take),
      unitaMisura: opts.prodotto.unitaMisura ?? "pz",
      beneficiarioId: opts.beneficiarioId,
      bollaId: opts.bollaId,
      bollaRigaId: bollaRiga.id,
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
      quantita: asDecimal(take),
      creditoUnitario: opts.riga.creditoUnitario,
      creditoTotale: asDecimal(parseDbNumber(opts.riga.creditoUnitario) * take),
      scaricoId: opts.scaricoId,
      bollaRigaId: bollaRiga.id,
    });

    remaining = round2(remaining - take);
  }

  if (remaining > 0) {
    throw new SpesaEmporioError(409, MSG_GIACENZA_INSUFFICIENTE);
  }
}

export async function chiudiSessioneCassaEmporio(opts: {
  sessioneId: number;
  operatoreId: number | null;
  note?: string | null;
}): Promise<{ spesaId: number }> {
  return db.transaction(async (tx) => {
    const sessione = await lockSessione(tx, opts.sessioneId);
    if (!sessione) throw new SpesaEmporioError(404, "Sessione Cassa Emporio non trovata.");
    if (sessione.statoSessione === "chiusa" || sessione.spesaEmporioId != null) {
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
    if (existingSpesa.length > 0) throw new SpesaEmporioError(400, MSG_SESSIONE_GIA_CHIUSA);

    const [accesso] = await tx.select().from(consegneTable).where(eq(consegneTable.id, sessione.accessoEmporioId));
    if (!accesso || accesso.tipoPianificazione !== "accesso_emporio") {
      throw new SpesaEmporioError(400, "Accesso Emporio non valido per la Cassa.");
    }

    const beneficiario = await lockBeneficiario(tx, sessione.beneficiarioId);
    if (!beneficiario || !beneficiario.attivo || !beneficiario.creditoSolidaleAbilitato || beneficiario.creditoSolidaleStato !== "attivo") {
      throw new SpesaEmporioError(400, "Beneficiario non valido per la Cassa Emporio.");
    }

    const righe = await tx
      .select()
      .from(sessioniCassaEmporioRigheTable)
      .where(eq(sessioniCassaEmporioRigheTable.sessioneCassaId, sessione.id))
      .orderBy(asc(sessioniCassaEmporioRigheTable.id));
    const productMap = await validateRigheFinali(tx, righe);

    const totaleCredito = round2(righe.reduce((acc, riga) => acc + parseDbNumber(riga.creditoTotale), 0));
    if (totaleCredito <= 0) throw new SpesaEmporioError(400, MSG_CARRELLO_VUOTO);
    const saldoPrima = parseDbNumber(beneficiario.creditoSolidaleSaldo);
    const saldoDopo = round2(saldoPrima - totaleCredito);
    if (saldoDopo < 0) throw new SpesaEmporioError(400, MSG_SALDO_INSUFFICIENTE);

    const dataChiusura = new Date();
    const dataDocumento = today();
    const numeroSpesa = await generateNumeroSpesa(tx);
    const numeroBolla = await generateNumeroBolla(tx);
    const codiceScarico = generateCodiceScarico();

    const [scarico] = await tx.insert(scarichiTable).values({
      codice: codiceScarico,
      magazzinoId: sessione.magazzinoEmporioId,
      centroAscoltoId: sessione.centroAscoltoId,
      dataScarico: dataDocumento,
      causale: "altro",
      causaleAltro: "Spesa Emporio",
      note: `Scarico merce da Spesa Emporio ${numeroSpesa}`,
      operatoreId: opts.operatoreId,
    }).returning();

    const [bolla] = await tx.insert(bolleTable).values({
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
    }).returning();

    const [spesa] = await tx.insert(speseEmporioTable).values({
      sessioneCassaId: sessione.id,
      accessoEmporioId: accesso.id,
      beneficiarioId: sessione.beneficiarioId,
      centroAscoltoId: sessione.centroAscoltoId,
      cittaId: sessione.cittaId,
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
    }).returning();

    for (const riga of righe) {
      const prodotto = productMap.get(riga.prodottoId);
      if (!prodotto) throw new SpesaEmporioError(400, MSG_PRODOTTO_NON_ABILITATO);
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
      });
    }

    const [movimento] = await tx.insert(creditoSolidaleMovimentiTable).values({
      beneficiarioId: beneficiario.id,
      centroAscoltoId: beneficiario.centroAscoltoId,
      cittaId: beneficiario.cittaId,
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
    }).returning();

    await tx.update(beneficiariTable).set({
      creditoSolidaleSaldo: asDecimal(saldoDopo),
      creditoSolidaleDataUltimoMovimento: movimento.dataMovimento,
      dataAggiornamento: dataChiusura,
    }).where(eq(beneficiariTable.id, beneficiario.id));

    await tx.update(speseEmporioTable).set({
      movimentoCreditoSolidaleId: movimento.id,
      updatedAt: dataChiusura,
    }).where(eq(speseEmporioTable.id, spesa.id));

    await tx.update(sessioniCassaEmporioTable).set({
      statoSessione: "chiusa",
      dataChiusura,
      spesaEmporioId: spesa.id,
      bollaId: bolla.id,
      movimentoCreditoSolidaleId: movimento.id,
      operatoreChiusuraId: opts.operatoreId,
      operatoreUltimaModificaId: opts.operatoreId,
      dataUltimaModifica: dataChiusura,
    }).where(eq(sessioniCassaEmporioTable.id, sessione.id));

    await tx.update(consegneTable).set({
      statoAccessoEmporio: "effettuato",
      stato: "effettuata",
      dataEffettuata: dataChiusura,
      dataOraEffettivaAccesso: accesso.dataOraEffettivaAccesso ?? dataChiusura,
      operatoreAccessoEmporioId: accesso.operatoreAccessoEmporioId ?? opts.operatoreId,
    }).where(eq(consegneTable.id, accesso.id));

    return { spesaId: spesa.id };
  });
}

function formatSpesa(row: {
  s: typeof speseEmporioTable.$inferSelect;
  beneficiarioNome: string | null;
  beneficiarioCodice: string | null;
  centroAscoltoNome: string | null;
  cittaNome: string | null;
  magazzinoEmporioNome: string | null;
  bollaNumero: string | null;
  operatoreMatricola: string | null;
  operatoreUsername: string | null;
}, righe: Array<{
  r: typeof speseEmporioRigheTable.$inferSelect;
  prodottoNome: string | null;
  codiceLotto: string | null;
}> = []) {
  return {
    id: row.s.id,
    sessioneCassaId: row.s.sessioneCassaId,
    accessoEmporioId: row.s.accessoEmporioId,
    beneficiarioId: row.s.beneficiarioId,
    beneficiarioNome: row.beneficiarioNome,
    beneficiarioCodice: row.beneficiarioCodice,
    centroAscoltoId: row.s.centroAscoltoId,
    centroAscoltoNome: row.centroAscoltoNome,
    cittaId: row.s.cittaId,
    cittaNome: row.cittaNome,
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
    emailBollaDataUltimoClick: row.s.emailBollaDataUltimoClick?.toISOString() ?? row.s.emailBollaDataInvio?.toISOString() ?? null,
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
      creditoUnitario: parseDbNumber(r.r.creditoUnitario),
      creditoTotale: parseDbNumber(r.r.creditoTotale),
      scaricoId: r.r.scaricoId,
      bollaRigaId: r.r.bollaRigaId,
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
      cittaNome: cittaTable.nome,
      magazzinoEmporioNome: magazziniTable.nome,
      bollaNumero: bolleTable.numeroBolla,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
    })
    .from(speseEmporioTable)
    .leftJoin(beneficiariTable, eq(speseEmporioTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(centriAscoltoTable, eq(speseEmporioTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(cittaTable, eq(speseEmporioTable.cittaId, cittaTable.id))
    .leftJoin(magazziniTable, eq(speseEmporioTable.magazzinoEmporioId, magazziniTable.id))
    .leftJoin(bolleTable, eq(speseEmporioTable.bollaId, bolleTable.id))
    .leftJoin(utentiTable, eq(speseEmporioTable.operatoreChiusuraId, utentiTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);
}

export async function listSpeseEmporio(params: {
  dataDa?: string;
  dataA?: string;
  beneficiarioSearch?: string;
  beneficiarioId?: number;
  magazzinoEmporioId?: number;
  centroAscoltoId?: number;
  cittaId?: number;
  zonaUdsId?: number;
} = {}) {
  const conditions: SQL[] = [];
  if (params.dataDa) conditions.push(gte(speseEmporioTable.dataChiusura, new Date(`${params.dataDa}T00:00:00.000`)));
  if (params.dataA) conditions.push(lt(speseEmporioTable.dataChiusura, new Date(`${params.dataA}T23:59:59.999`)));
  if (params.beneficiarioId != null) conditions.push(eq(speseEmporioTable.beneficiarioId, params.beneficiarioId));
  if (params.magazzinoEmporioId != null) conditions.push(eq(speseEmporioTable.magazzinoEmporioId, params.magazzinoEmporioId));
  if (params.centroAscoltoId != null) conditions.push(eq(speseEmporioTable.centroAscoltoId, params.centroAscoltoId));
  if (params.cittaId != null) conditions.push(eq(speseEmporioTable.cittaId, params.cittaId));
  if (params.zonaUdsId != null) conditions.push(eq(beneficiariTable.zonaUdsId, params.zonaUdsId));
  if (params.beneficiarioSearch) {
    const s = `%${params.beneficiarioSearch}%`;
    conditions.push(or(
      ilike(beneficiariTable.nome, s),
      ilike(beneficiariTable.cognome, s),
      ilike(beneficiariTable.codice, s),
      ilike(beneficiariTable.codiceFiscale, s),
      ilike(sql<string>`trim(coalesce(${beneficiariTable.cognome}, '') || ' ' || coalesce(${beneficiariTable.nome}, ''))`, s),
    )!);
  }

  const rows = await baseSpeseQuery(conditions).orderBy(desc(speseEmporioTable.dataChiusura), desc(speseEmporioTable.id)).limit(200);
  return rows.map((row) => formatSpesa(row));
}

export async function getSpesaEmporio(id: number) {
  const rows = await baseSpeseQuery([eq(speseEmporioTable.id, id)]).limit(1);
  if (rows.length === 0) return null;
  const righe = await db
    .select({
      r: speseEmporioRigheTable,
      prodottoNome: prodottiTable.nome,
      codiceLotto: lottiTable.codiceLotto,
    })
    .from(speseEmporioRigheTable)
    .leftJoin(prodottiTable, eq(speseEmporioRigheTable.prodottoId, prodottiTable.id))
    .leftJoin(lottiTable, eq(speseEmporioRigheTable.lottoId, lottiTable.id))
    .where(eq(speseEmporioRigheTable.spesaEmporioId, id))
    .orderBy(asc(speseEmporioRigheTable.id));
  return formatSpesa(rows[0], righe);
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
    })
    .from(speseEmporioTable)
    .leftJoin(beneficiariTable, eq(speseEmporioTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(centriAscoltoTable, eq(speseEmporioTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(magazziniTable, eq(speseEmporioTable.magazzinoEmporioId, magazziniTable.id))
    .leftJoin(utentiTable, eq(speseEmporioTable.operatoreChiusuraId, utentiTable.id))
    .where(eq(speseEmporioTable.id, id));

  return {
    intestazione: "Magazzino Solidale / Angeli in Moto",
    numeroBolla: spesa.bollaNumero,
    numeroSpesa: spesa.numeroSpesa,
    dataChiusura: spesa.dataChiusura,
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

function uniqueEmails(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const email = value?.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

function buildMailtoHref(recipients: string[], subject: string, body: string): string {
  const to = recipients.map((recipient) => encodeURIComponent(recipient)).join(",");
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function getDestinatariBollaEmporio(spesaId: number): Promise<string[]> {
  const [recipientsRow] = await db
    .select({
      centroEmail: centriAscoltoTable.email,
      beneficiarioEmail: beneficiariTable.email,
    })
    .from(speseEmporioTable)
    .leftJoin(centriAscoltoTable, eq(speseEmporioTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(beneficiariTable, eq(speseEmporioTable.beneficiarioId, beneficiariTable.id))
    .where(eq(speseEmporioTable.id, spesaId));

  return uniqueEmails([recipientsRow?.centroEmail, recipientsRow?.beneficiarioEmail]);
}

export async function registraInvioManualeBollaEmporio(opts: {
  spesaId: number;
  operatoreId: number | null;
  linkBolla: string;
}) {
  const spesa = await getSpesaEmporio(opts.spesaId);
  if (!spesa) throw new SpesaEmporioError(404, "Spesa Emporio non trovata.");

  const recipients = await getDestinatariBollaEmporio(opts.spesaId);
  const subject = `Bolla Emporio Solidale ${spesa.bollaNumero ?? spesa.numeroSpesa} - ${spesa.beneficiarioNome ?? ""}`.trim();
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
  const stato: EmailBollaStato = recipients.length === 0 ? "nessun_destinatario" : "invio_manuale_avviato";
  const messaggio = recipients.length === 0
    ? "Nessun destinatario email disponibile. Copiare manualmente il link alla Bolla."
    : "Apertura email Bolla avviata nel client mail locale.";

  await db.update(speseEmporioTable).set({
    emailBollaStato: stato,
    emailBollaDestinatari: recipients.length > 0 ? recipients.join(", ") : null,
    emailBollaDataUltimoClick: now,
    emailBollaOperatoreId: opts.operatoreId,
    emailBollaOggetto: subject,
    emailBollaErrore: recipients.length === 0 ? "Nessun destinatario email disponibile." : null,
    updatedAt: now,
  }).where(eq(speseEmporioTable.id, opts.spesaId));

  return {
    stato,
    destinatari: recipients,
    destinatario: recipients[0] ?? null,
    oggetto: subject,
    corpo: body,
    linkBolla: opts.linkBolla,
    mailtoHref: recipients.length > 0 ? buildMailtoHref(recipients, subject, body) : null,
    messaggio,
  };
}
