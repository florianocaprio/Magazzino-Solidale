import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import {
  bolleTable, bollaRigheTable, beneficiariTable, magazziniTable,
  movimentiTable, lottiTable, prodottiTable, volontariTable, interventiTable,
  consegneTable, utentiTable, centriAscoltoTable,
  prenotazioniMagazzinoTable,
} from "@workspace/db";
import { eq, and, desc, asc, gt, sum, sql, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  callerZonaUdsId,
  centroScopeFilter,
  cittaScopeFilter,
  zonaUdsScopeFilter,
  canAccessCentro,
  canAccessCitta,
  canAccessZonaUds,
  beneficiarioCentroId,
  beneficiarioCittaId,
  beneficiarioZonaUdsId,
  canUseBeneficiario,
  visibleMagazzinoIds,
} from "../lib/centroScope";
import { parseDbNumber } from "../lib/disponibilitaMagazzino";

const router: IRouter = Router();

// stati che consentono ancora modifiche
const STATI_MODIFICABILI = ["bozza"];
const PRENOTAZIONE_ATTIVA = "attiva";
const PRENOTAZIONE_RILASCIATA = "rilasciata";
const PRENOTAZIONE_CONVERTITA = "convertita_in_scarico";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class BollaActionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function handleBollaActionError(err: unknown, res: Response): boolean {
  if (err instanceof BollaActionError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

// mappa tipo prodotto → etichetta tipo intervento sociale
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

// crea/aggiorna automaticamente l'intervento sociale collegato alla bolla,
// etichettato in base ai tipi di prodotto consegnati. Rimuove l'intervento se
// la bolla non ha più righe.
async function syncInterventoBolla(bollaId: number) {
  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) return;

  const righe = await db
    .select({ tipoProdotto: prodottiTable.tipoProdotto })
    .from(bollaRigheTable)
    .leftJoin(prodottiTable, eq(bollaRigheTable.prodottoId, prodottiTable.id))
    .where(eq(bollaRigheTable.bollaId, bollaId));

  const [esistente] = await db.select().from(interventiTable).where(eq(interventiTable.bollaId, bollaId));

  if (righe.length === 0) {
    if (esistente) await db.delete(interventiTable).where(eq(interventiTable.id, esistente.id));
    return;
  }

  // etichette distinte, in ordine di prima comparsa
  const etichette: string[] = [];
  for (const r of righe) {
    const tipo = r.tipoProdotto ?? "";
    const label = TIPO_PRODOTTO_INTERVENTO[tipo] ?? (tipo || "consegna");
    if (!etichette.includes(label)) etichette.push(label);
  }
  const tipoIntervento = etichette.join(",");
  const descLabels = etichette.map(e => LABEL_INTERVENTO[e] ?? e).join(", ");
  const descrizione = `Consegna automatica da bolla ${bolla.numeroBolla}: ${descLabels}`;

  if (esistente) {
    await db.update(interventiTable)
      .set({ tipoIntervento, descrizione, beneficiarioId: bolla.beneficiarioId, dataIntervento: bolla.dataBolla, operatoreId: bolla.operatoreId })
      .where(eq(interventiTable.id, esistente.id));
  } else {
    await db.insert(interventiTable).values({
      beneficiarioId: bolla.beneficiarioId,
      bollaId,
      dataIntervento: bolla.dataBolla,
      tipoIntervento,
      descrizione,
      operatoreId: bolla.operatoreId,
    });
  }
}

async function removeInterventoBolla(bollaId: number) {
  await db.delete(interventiTable).where(eq(interventiTable.bollaId, bollaId));
}

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

// Allinea la pianificazione consegne quando una bolla viene consegnata.
// - se la bolla è già collegata a una consegna, la marca come effettuata;
// - altrimenti crea una "consegna diretta" (fatta in sede dal centro di ascolto
//   a cui il beneficiario fa riferimento) già effettuata, e vi collega la bolla.
async function syncConsegnaDaBolla(bolla: typeof bolleTable.$inferSelect) {
  const now = new Date();

  if (bolla.consegnaId != null) {
    const [consegna] = await db.select().from(consegneTable).where(eq(consegneTable.id, bolla.consegnaId));
    if (consegna) {
      if (consegna.stato !== "effettuata") {
        await db.update(consegneTable)
          .set({ stato: "effettuata", dataEffettuata: now })
          .where(eq(consegneTable.id, bolla.consegnaId));
      }
      return;
    }
    // link pendente verso una consegna inesistente: ricade nella creazione diretta
  }

  const today = new Date().toISOString().split("T")[0];
  const codice = `CON-${Date.now()}`;
  const [nuova] = await db.insert(consegneTable).values({
    codice,
    beneficiarioId: bolla.beneficiarioId,
    tipoConsegna: "diretta",
    dataPrevista: today,
    magazzinoId: bolla.magazzinoId,
    stato: "effettuata",
    dataEffettuata: now,
    noteOperative: `Consegna diretta registrata dalla bolla ${bolla.numeroBolla}`,
  }).returning();
  await db.update(bolleTable).set({ consegnaId: nuova.id }).where(eq(bolleTable.id, bolla.id));
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
      prodottoFsePlus: prodottiTable.fsePlus,
    })
    .from(bollaRigheTable)
    .leftJoin(prodottiTable, eq(bollaRigheTable.prodottoId, prodottiTable.id))
    .leftJoin(lottiTable, eq(bollaRigheTable.lottoId, lottiTable.id))
    .where(eq(bollaRigheTable.bollaId, id));

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
    operatoreId: row.b.operatoreId ?? null,
    operatoreCodice: row.operatoreMatricola ?? row.operatoreUsername ?? null,
    dataCreazione: row.b.dataCreazione.toISOString(),
    righe: righe.map(r => ({
      id: r.r.id,
      bollaId: r.r.bollaId,
      prodottoId: r.r.prodottoId,
      prodottoNome: r.prodottoNome ?? null,
      lottoId: r.r.lottoId ?? null,
      codiceLotto: r.codiceLotto ?? null,
      fsePlus: r.r.lottoId ? !!r.lottoFsePlus : !!r.prodottoFsePlus,
      quantita: parseFloat(r.r.quantita),
      unitaMisura: r.r.unitaMisura,
      note: r.r.note ?? null,
    })),
  };
}

/** Calcola giacenza disponibile per un prodotto in un magazzino */
async function giacenzaDisponibile(prodottoId: number, magazzinoId: number): Promise<number> {
  const [res] = await db
    .select({ totale: sum(lottiTable.quantitaResidua) })
    .from(lottiTable)
    .where(and(
      eq(lottiTable.prodottoId, prodottoId),
      eq(lottiTable.magazzinoId, magazzinoId),
      gt(lottiTable.quantitaResidua, "0"),
    ));
  return parseFloat(res?.totale ?? "0");
}

/** Calcola quanto è già in bolla (bozza) per un prodotto */
async function quantitaGiaInBolla(bollaId: number, prodottoId: number, excludeRigaId?: number): Promise<number> {
  const righe = await db
    .select({ q: bollaRigheTable.quantita, id: bollaRigheTable.id })
    .from(bollaRigheTable)
    .where(and(eq(bollaRigheTable.bollaId, bollaId), eq(bollaRigheTable.prodottoId, prodottoId)));
  return righe
    .filter(r => r.id !== excludeRigaId)
    .reduce((acc, r) => acc + parseFloat(r.q), 0);
}

/** Calcola quanto è già in bolla (bozza) per uno specifico lotto */
async function quantitaGiaInBollaLotto(bollaId: number, lottoId: number): Promise<number> {
  const righe = await db
    .select({ q: bollaRigheTable.quantita })
    .from(bollaRigheTable)
    .where(and(eq(bollaRigheTable.bollaId, bollaId), eq(bollaRigheTable.lottoId, lottoId)));
  return righe.reduce((acc, r) => acc + parseFloat(r.q), 0);
}

async function canAccessBollaOperativa(
  bolla: typeof bolleTable.$inferSelect,
  caller: number | null,
  cittaId: number | null,
  zonaUdsId: number | null,
): Promise<boolean> {
  if (!canAccessCentro(await beneficiarioCentroId(bolla.beneficiarioId), caller)
      || !canAccessCitta(await beneficiarioCittaId(bolla.beneficiarioId), cittaId)
      || !canAccessZonaUds(await beneficiarioZonaUdsId(bolla.beneficiarioId), zonaUdsId)) {
    return false;
  }

  const visibili = await visibleMagazzinoIds(caller, cittaId);
  return visibili == null || visibili.includes(bolla.magazzinoId);
}

async function productName(prodottoId: number): Promise<string> {
  const [prod] = await db.select({ nome: prodottiTable.nome }).from(prodottiTable).where(eq(prodottiTable.id, prodottoId));
  return prod?.nome ?? `prodotto #${prodottoId}`;
}

async function lockBolla(tx: Tx, bollaId: number): Promise<typeof bolleTable.$inferSelect> {
  await tx.execute(sql`SELECT id FROM ${bolleTable} WHERE ${bolleTable.id} = ${bollaId} FOR UPDATE`);
  const [bolla] = await tx.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) throw new BollaActionError(404, "Bolla non trovata");
  return bolla;
}

async function lockLotto(tx: Tx, lottoId: number): Promise<typeof lottiTable.$inferSelect> {
  await tx.execute(sql`SELECT id FROM ${lottiTable} WHERE ${lottiTable.id} = ${lottoId} FOR UPDATE`);
  const [lotto] = await tx.select().from(lottiTable).where(eq(lottiTable.id, lottoId));
  if (!lotto) throw new BollaActionError(404, "Lotto non trovato");
  return lotto;
}

async function lockLottiFEFO(
  tx: Tx,
  prodottoId: number,
  magazzinoId: number,
): Promise<Array<typeof lottiTable.$inferSelect>> {
  await tx.execute(sql`
    SELECT id
    FROM ${lottiTable}
    WHERE ${lottiTable.prodottoId} = ${prodottoId}
      AND ${lottiTable.magazzinoId} = ${magazzinoId}
      AND ${lottiTable.quantitaResidua} > 0
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
    ))
    .orderBy(asc(lottiTable.dataScadenza), asc(lottiTable.dataCarico), asc(lottiTable.id));
}

async function impegnatoAttivoLotto(tx: Tx, lottoId: number): Promise<number> {
  const [res] = await tx
    .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
    .from(prenotazioniMagazzinoTable)
    .where(and(
      eq(prenotazioniMagazzinoTable.lottoId, lottoId),
      eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
    ));
  return parseDbNumber(res?.totale);
}

async function creaPrenotazione(
  tx: Tx,
  opts: {
    bollaId: number;
    rigaBollaId: number;
    prodottoId: number;
    lottoId: number;
    magazzinoId: number;
    quantita: number;
  },
): Promise<void> {
  await tx.insert(prenotazioniMagazzinoTable).values({
    bollaId: opts.bollaId,
    rigaBollaId: opts.rigaBollaId,
    prodottoId: opts.prodottoId,
    lottoId: opts.lottoId,
    magazzinoId: opts.magazzinoId,
    quantita: opts.quantita.toFixed(2),
    stato: PRENOTAZIONE_ATTIVA,
  });
}

async function prenotaRigaFEFO(
  tx: Tx,
  bolla: typeof bolleTable.$inferSelect,
  riga: typeof bollaRigheTable.$inferSelect,
): Promise<void> {
  const richiesta = parseDbNumber(riga.quantita);
  let rimanente = richiesta;
  let primoLottoId: number | null = null;

  if (riga.lottoId != null) {
    const lotto = await lockLotto(tx, riga.lottoId);
    if (lotto.prodottoId !== riga.prodottoId || lotto.magazzinoId !== bolla.magazzinoId) {
      throw new BollaActionError(400, "Il lotto selezionato non appartiene al prodotto o al magazzino della bolla");
    }
    const disponibileReale = parseDbNumber(lotto.quantitaResidua) - await impegnatoAttivoLotto(tx, lotto.id);
    if (disponibileReale < richiesta) {
      throw new BollaActionError(
        409,
        `Disponibilità reale insufficiente nel lotto ${lotto.codiceLotto ?? `#${lotto.id}`} per ${await productName(riga.prodottoId)}: disponibili ${Math.max(0, disponibileReale).toFixed(2)}, richiesti ${richiesta.toFixed(2)}`,
      );
    }
    await creaPrenotazione(tx, {
      bollaId: bolla.id,
      rigaBollaId: riga.id,
      prodottoId: riga.prodottoId,
      lottoId: lotto.id,
      magazzinoId: bolla.magazzinoId,
      quantita: richiesta,
    });
    return;
  }

  const lotti = await lockLottiFEFO(tx, riga.prodottoId, bolla.magazzinoId);
  for (const lotto of lotti) {
    if (rimanente <= 0) break;
    const disponibileReale = parseDbNumber(lotto.quantitaResidua) - await impegnatoAttivoLotto(tx, lotto.id);
    if (disponibileReale <= 0) continue;
    const prenota = Math.min(disponibileReale, rimanente);
    await creaPrenotazione(tx, {
      bollaId: bolla.id,
      rigaBollaId: riga.id,
      prodottoId: riga.prodottoId,
      lottoId: lotto.id,
      magazzinoId: bolla.magazzinoId,
      quantita: prenota,
    });
    if (primoLottoId == null) primoLottoId = lotto.id;
    rimanente = Math.round((rimanente - prenota) * 100) / 100;
  }

  if (rimanente > 0) {
    throw new BollaActionError(
      409,
      `Disponibilità reale insufficiente per ${await productName(riga.prodottoId)}: disponibili ${(richiesta - rimanente).toFixed(2)}, richiesti ${richiesta.toFixed(2)}`,
    );
  }

  if (primoLottoId != null) {
    await tx.update(bollaRigheTable).set({ lottoId: primoLottoId }).where(eq(bollaRigheTable.id, riga.id));
  }
}

async function stornoRigaTx(tx: Tx, riga: { id: number }, bollaId: number) {
  const movimenti = await tx.select()
    .from(movimentiTable)
    .where(and(
      eq(movimentiTable.bollaId, bollaId),
      eq(movimentiTable.bollaRigaId, riga.id),
    ));

  for (const mov of movimenti) {
    if (!mov.lottoId) continue;
    const lotto = await lockLotto(tx, mov.lottoId);
    const nuovaQta = parseDbNumber(lotto.quantitaResidua) + parseDbNumber(mov.quantita);
    await tx.update(lottiTable)
      .set({ quantitaResidua: nuovaQta.toFixed(2) })
      .where(eq(lottiTable.id, mov.lottoId));
  }

  await tx.delete(movimentiTable).where(
    and(eq(movimentiTable.bollaId, bollaId), eq(movimentiTable.bollaRigaId, riga.id))
  );
}

async function scarichiFisiciBolla(tx: Tx, bollaId: number): Promise<number> {
  const rows = await tx
    .select({ id: movimentiTable.id })
    .from(movimentiTable)
    .where(and(eq(movimentiTable.bollaId, bollaId), eq(movimentiTable.tipoMovimento, "scarico")));
  return rows.length;
}

async function convertiPrenotazioniAttiveInScarico(
  tx: Tx,
  bolla: typeof bolleTable.$inferSelect,
  opts: { dataMovimento: string },
): Promise<number> {
  const prenotazioni = await tx
    .select({ p: prenotazioniMagazzinoTable, r: bollaRigheTable })
    .from(prenotazioniMagazzinoTable)
    .leftJoin(bollaRigheTable, eq(prenotazioniMagazzinoTable.rigaBollaId, bollaRigheTable.id))
    .where(and(
      eq(prenotazioniMagazzinoTable.bollaId, bolla.id),
      eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
    ));

  for (const row of prenotazioni) {
    const prenotazione = row.p;
    const qta = parseDbNumber(prenotazione.quantita);
    const lotto = await lockLotto(tx, prenotazione.lottoId);
    const residua = parseDbNumber(lotto.quantitaResidua);
    if (residua < qta) {
      throw new BollaActionError(
        409,
        `Impossibile consegnare la bolla: il lotto ${lotto.codiceLotto ?? `#${lotto.id}`} ha ${residua.toFixed(2)} disponibili ma risultano prenotati ${qta.toFixed(2)}`,
      );
    }

    await tx.update(lottiTable)
      .set({ quantitaResidua: (residua - qta).toFixed(2) })
      .where(eq(lottiTable.id, lotto.id));

    await tx.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      dataMovimento: opts.dataMovimento,
      magazzinoId: prenotazione.magazzinoId,
      prodottoId: prenotazione.prodottoId,
      lottoId: prenotazione.lottoId,
      quantita: prenotazione.quantita,
      unitaMisura: row.r?.unitaMisura ?? "pz",
      beneficiarioId: bolla.beneficiarioId,
      bollaId: bolla.id,
      bollaRigaId: prenotazione.rigaBollaId,
      documentoRiferimento: bolla.numeroBolla,
      note: row.r?.note ?? undefined,
    });

    await tx.update(prenotazioniMagazzinoTable)
      .set({ stato: PRENOTAZIONE_CONVERTITA, updatedAt: new Date() })
      .where(eq(prenotazioniMagazzinoTable.id, prenotazione.id));
  }

  return prenotazioni.length;
}

// ─── LIST ────────────────────────────────────────────────────────────────────

router.get("/bolle", async (req, res) => {
  const { stato, magazzinoId, centroAscoltoId } = req.query as Record<string, string>;
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
  const cittaFilter = cittaScopeFilter(beneficiariTable.cittaId, callerCittaId(req));
  if (cittaFilter) conditions.push(cittaFilter);
  const zonaFilter = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
  if (zonaFilter) conditions.push(zonaFilter);

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
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(bolleTable.dataCreazione))
    .limit(200);

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
    operatoreId: r.b.operatoreId ?? null,
    operatoreCodice: r.operatoreMatricola ?? r.operatoreUsername ?? null,
    dataCreazione: r.b.dataCreazione.toISOString(),
  })));
});

// ─── CREATE ──────────────────────────────────────────────────────────────────

router.post("/bolle", async (req, res) => {
  const body = { ...req.body };
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const zid = callerZonaUdsId(req);
  if ((caller != null || cid != null || zid != null) && !(await canUseBeneficiario(body.beneficiarioId, caller, cid, zid))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }
  if ((caller != null || cid != null) && body.magazzinoId != null) {
    const visibili = await visibleMagazzinoIds(caller, cid);
    if (visibili != null && !visibili.includes(body.magazzinoId)) {
      res.status(403).json({ error: "Magazzino non accessibile per il tuo centro" });
      return;
    }
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
  const anno = new Date().getFullYear();
  const existing = await db.select({ n: bolleTable.numeroBolla }).from(bolleTable).orderBy(desc(bolleTable.id)).limit(1);
  const lastNum = existing.length > 0 ? parseInt(existing[0].n.split("-").pop() ?? "0") : 0;
  const numeroBolla = `BOLLA-${anno}-${String(lastNum + 1).padStart(4, "0")}`;
  const dataBolla = body.dataBolla ?? new Date().toISOString().split("T")[0];

  const [row] = await db.insert(bolleTable).values({ ...body, numeroBolla, dataBolla, operatoreId: req.user!.id }).returning();
  const det = await buildDettaglio(row.id);
  res.status(201).json(det);
});

// ─── GET BY ID ───────────────────────────────────────────────────────────────

router.get("/bolle/:id/righe", async (req, res) => {
  const det = await buildDettaglio(parseInt(req.params.id));
  if (!det) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(det.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(det.beneficiarioId), callerCittaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(det.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.json(det.righe);
});

router.get("/bolle/:id", async (req, res) => {
  const det = await buildDettaglio(parseInt(req.params.id));
  if (!det) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(det.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(det.beneficiarioId), callerCittaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(det.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.json(det);
});

// ─── UPDATE (magazzino/beneficiario/volontario) ──────────────────────────────

router.patch("/bolle/:id", async (req, res) => {
  const bollaId = parseInt(req.params.id);
  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Not found" }); return; }
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const zid = callerZonaUdsId(req);
  if (!canAccessCentro(await beneficiarioCentroId(bolla.beneficiarioId), caller)
      || !canAccessCitta(await beneficiarioCittaId(bolla.beneficiarioId), cid)
      || !canAccessZonaUds(await beneficiarioZonaUdsId(bolla.beneficiarioId), zid)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

  const body = { ...req.body };
  if ((caller != null || cid != null || zid != null) && body.beneficiarioId != null && body.beneficiarioId !== bolla.beneficiarioId
      && !(await canUseBeneficiario(body.beneficiarioId, caller, cid, zid))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }

  // i cambi di stato passano solo dagli endpoint dedicati (/conferma, /consegna, /annulla)
  // per garantire scarichi/storni e sincronizzazione dell'intervento collegato
  if (body.stato !== undefined && body.stato !== bolla.stato) {
    res.status(400).json({ error: "Lo stato della bolla si cambia solo tramite le azioni dedicate (conferma, consegna, annulla)" });
    return;
  }
  delete body.stato;

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
    await db.delete(bollaRigheTable).where(eq(bollaRigheTable.bollaId, bollaId));
  }

  const [row] = await db.update(bolleTable).set({ ...body, operatoreId: req.user!.id }).where(eq(bolleTable.id, bollaId)).returning();

  // se è cambiato il beneficiario su una bolla consegnata, allinea l'intervento collegato
  if (row.stato === "consegnato" && body.beneficiarioId && body.beneficiarioId !== bolla.beneficiarioId) {
    await syncInterventoBolla(bollaId);
  }

  const det = await buildDettaglio(row.id);
  res.json(det);
});

// ─── RIGHE — ADD ─────────────────────────────────────────────────────────────

router.post("/bolle/:id/righe", async (req, res) => {
  const bollaId = parseInt(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(bolla.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(bolla.beneficiarioId), callerCittaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(bolla.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!STATI_MODIFICABILI.includes(bolla.stato)) {
    res.status(400).json({ error: "Le righe della bolla sono modificabili solo in stato bozza" });
    return;
  }

  const { prodottoId, lottoId, quantita, unitaMisura, note } = req.body;

  const [prod] = await db.select().from(prodottiTable).where(eq(prodottiTable.id, prodottoId));

  if (lottoId) {
    const [lotto] = await db.select().from(lottiTable).where(eq(lottiTable.id, lottoId));
    if (!lotto) { res.status(404).json({ error: "Lotto non trovato" }); return; }
    const giaInBollaLotto = bolla.stato === "bozza" ? await quantitaGiaInBollaLotto(bollaId, lottoId) : 0;
    const nettaLotto = parseFloat(lotto.quantitaResidua) - giaInBollaLotto;
    if (nettaLotto < quantita) {
      res.status(400).json({
        error: `Disponibilità insufficiente nel lotto: ${Math.max(0, nettaLotto).toFixed(2)} disponibili, richiesti ${quantita}`,
      });
      return;
    }
  } else {
    const disponibile = await giacenzaDisponibile(prodottoId, bolla.magazzinoId);
    const giainBolla = bolla.stato === "bozza" ? await quantitaGiaInBolla(bollaId, prodottoId) : 0;
    const netta = disponibile - giainBolla;
    if (netta < quantita) {
      res.status(400).json({
        error: `Disponibilità insufficiente per ${prod?.nome ?? "prodotto"}: ${Math.max(0, netta).toFixed(2)} disponibili (giacenza ${disponibile.toFixed(2)} − già in bolla ${giainBolla.toFixed(2)}), richiesti ${quantita}`,
      });
      return;
    }
  }

  const [riga] = await db.insert(bollaRigheTable).values({
    bollaId,
    prodottoId,
    lottoId: lottoId ?? null,
    quantita: quantita.toString(),
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

router.delete("/bolle/:id/righe/:rigaId", async (req, res) => {
  const bollaId = parseInt(req.params.id);
  const rigaId = parseInt(req.params.rigaId);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(bolla.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(bolla.beneficiarioId), callerCittaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(bolla.beneficiarioId), callerZonaUdsId(req))) {
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

router.post("/bolle/:id/conferma", async (req, res) => {
  const bollaId = parseInt(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!(await canAccessBollaOperativa(bolla, callerCentroId(req), callerCittaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      const current = await lockBolla(tx, bollaId);
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
    throw err;
  }

  const det = await buildDettaglio(bollaId);
  res.json(det);
});

// ─── CONSEGNA (confermato → consegnato) ──────────────────────────────────────

router.post("/bolle/:id/consegna", async (req, res) => {
  const bollaId = parseInt(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!(await canAccessBollaOperativa(bolla, callerCentroId(req), callerCittaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

  const { noteRicezione, confermaRicezione } = req.body ?? {};
  const dataMovimento = new Date().toISOString().split("T")[0];

  try {
    await db.transaction(async (tx) => {
      const current = await lockBolla(tx, bollaId);
      if (current.stato !== "confermato") {
        throw new BollaActionError(400, "La bolla deve essere in stato confermato per essere consegnata");
      }

      const convertite = await convertiPrenotazioniAttiveInScarico(tx, current, { dataMovimento });
      if (convertite === 0) {
        const scarichiLegacy = await scarichiFisiciBolla(tx, bollaId);
        if (scarichiLegacy === 0) {
          throw new BollaActionError(409, "Nessuna prenotazione attiva da convertire in scarico per questa bolla");
        }
      }

      await tx.update(bolleTable).set({
        stato: "consegnato",
        confermaRicezione: confermaRicezione ?? true,
        noteRicezione: noteRicezione ?? null,
        operatoreId: req.user!.id,
      }).where(eq(bolleTable.id, bollaId));
    });
  } catch (err) {
    if (handleBollaActionError(err, res)) return;
    throw err;
  }

  await syncInterventoBolla(bollaId);

  // allinea la pianificazione consegne (aggiorna quella collegata o ne crea una diretta)
  await syncConsegnaDaBolla(bolla);

  const det = await buildDettaglio(bollaId);
  res.json(det);
});

// ─── ANNULLA ──────────────────────────────────────────────────────────────────

router.post("/bolle/:id/annulla", async (req, res) => {
  const bollaId = parseInt(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!(await canAccessBollaOperativa(bolla, callerCentroId(req), callerCittaId(req), callerZonaUdsId(req)))) {
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
            await stornoRigaTx(tx, riga, bollaId);
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

      await tx.update(bolleTable).set({ stato: "annullato", operatoreId: req.user!.id }).where(eq(bolleTable.id, bollaId));
    });
  } catch (err) {
    if (handleBollaActionError(err, res)) return;
    throw err;
  }

  await removeInterventoBolla(bollaId);
  const det = await buildDettaglio(bollaId);
  res.json(det);
});

export default router;
