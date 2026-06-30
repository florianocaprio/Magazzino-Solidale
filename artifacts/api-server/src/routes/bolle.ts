import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  bolleTable, bollaRigheTable, beneficiariTable, magazziniTable,
  movimentiTable, lottiTable, prodottiTable, volontariTable, interventiTable,
  consegneTable, utentiTable, centriAscoltoTable,
} from "@workspace/db";
import { eq, and, desc, asc, gt, sum, type SQL } from "drizzle-orm";
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

const router: IRouter = Router();

// stati che consentono ancora modifiche
const STATI_MODIFICABILI = ["bozza", "confermato"];

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

/** Scarico FEFO: scala quantità cercando lotti per scadenza crescente */
async function scaricoFEFO(
  prodottoId: number,
  magazzinoId: number,
  quantitaDaScaricare: number,
  bollaId: number,
  bolla: { beneficiarioId: number; numeroBolla: string },
  unitaMisura: string,
  note: string | null,
  rigaId: number,
) {
  const today = new Date().toISOString().split("T")[0];
  let rimanente = quantitaDaScaricare;

  const lotti = await db
    .select()
    .from(lottiTable)
    .where(and(
      eq(lottiTable.prodottoId, prodottoId),
      eq(lottiTable.magazzinoId, magazzinoId),
      gt(lottiTable.quantitaResidua, "0"),
    ))
    .orderBy(asc(lottiTable.dataScadenza), asc(lottiTable.dataCarico));

  let primoLottoId: number | null = null;

  for (const lotto of lotti) {
    if (rimanente <= 0) break;
    const disp = parseFloat(lotto.quantitaResidua);
    const scala = Math.min(disp, rimanente);

    await db.update(lottiTable)
      .set({ quantitaResidua: (disp - scala).toFixed(2) })
      .where(eq(lottiTable.id, lotto.id));

    await db.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      dataMovimento: today,
      magazzinoId,
      prodottoId,
      lottoId: lotto.id,
      quantita: scala.toFixed(2),
      unitaMisura,
      beneficiarioId: bolla.beneficiarioId,
      bollaId,
      bollaRigaId: rigaId,
      documentoRiferimento: bolla.numeroBolla,
      note: note ?? undefined,
    });

    if (!primoLottoId) primoLottoId = lotto.id;
    rimanente -= scala;
  }

  if (primoLottoId) {
    await db.update(bollaRigheTable).set({ lottoId: primoLottoId }).where(eq(bollaRigheTable.id, rigaId));
  }
}

/** Storna una riga già scaricata: ripristina lotti e cancella i movimenti di QUELLA riga */
async function stornoRiga(riga: { id: number }, bollaId: number) {
  const movimenti = await db.select()
    .from(movimentiTable)
    .where(and(
      eq(movimentiTable.bollaId, bollaId),
      eq(movimentiTable.bollaRigaId, riga.id),
    ));

  for (const mov of movimenti) {
    if (!mov.lottoId) continue;
    const [lotto] = await db.select().from(lottiTable).where(eq(lottiTable.id, mov.lottoId));
    if (lotto) {
      const nuovaQta = parseFloat(lotto.quantitaResidua) + parseFloat(mov.quantita);
      await db.update(lottiTable)
        .set({ quantitaResidua: nuovaQta.toFixed(2) })
        .where(eq(lottiTable.id, mov.lottoId));
    }
  }

  await db.delete(movimentiTable).where(
    and(eq(movimentiTable.bollaId, bollaId), eq(movimentiTable.bollaRigaId, riga.id))
  );
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
  const body = req.body;
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

  // se è cambiato il beneficiario su una bolla confermata, allinea l'intervento collegato
  if (row.stato === "confermato" && body.beneficiarioId && body.beneficiarioId !== bolla.beneficiarioId) {
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
    res.status(400).json({ error: "Non è possibile aggiungere prodotti a una bolla consegnata o annullata" });
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

  // se bolla già confermata: scarica subito (FEFO auto se non c'è lotto)
  if (bolla.stato === "confermato") {
    if (riga.lottoId) {
      const [lotto] = await db.select().from(lottiTable).where(eq(lottiTable.id, riga.lottoId));
      if (lotto) {
        const disp = parseFloat(lotto.quantitaResidua);
        await db.update(lottiTable)
          .set({ quantitaResidua: (disp - quantita).toFixed(2) })
          .where(eq(lottiTable.id, riga.lottoId));
        const today = new Date().toISOString().split("T")[0];
        await db.insert(movimentiTable).values({
          tipoMovimento: "scarico",
          tipoDettaglio: "consegna_beneficiario",
          dataMovimento: today,
          magazzinoId: bolla.magazzinoId,
          prodottoId: riga.prodottoId,
          lottoId: riga.lottoId,
          quantita: riga.quantita,
          unitaMisura: riga.unitaMisura,
          beneficiarioId: bolla.beneficiarioId,
          bollaId,
          bollaRigaId: riga.id,
          documentoRiferimento: bolla.numeroBolla,
          note: riga.note ?? undefined,
        });
      }
    } else {
      await scaricoFEFO(
        prodottoId, bolla.magazzinoId, quantita, bollaId,
        { beneficiarioId: bolla.beneficiarioId, numeroBolla: bolla.numeroBolla },
        unitaMisura ?? "pz", note ?? null, riga.id,
      );
    }
  }

  // stampa l'operatore PRIMA del sync così l'intervento collegato eredita
  // l'operatore corrente (syncInterventoBolla rilegge bolla.operatoreId)
  await db.update(bolleTable).set({ operatoreId: req.user!.id }).where(eq(bolleTable.id, bollaId));

  // aggiorna l'intervento sociale collegato se la bolla è già confermata
  if (bolla.stato === "confermato") {
    await syncInterventoBolla(bollaId);
  }

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
    res.status(400).json({ error: "Non è possibile modificare una bolla consegnata o annullata" });
    return;
  }

  const [riga] = await db.select().from(bollaRigheTable)
    .where(and(eq(bollaRigheTable.id, rigaId), eq(bollaRigheTable.bollaId, bollaId)));
  if (!riga) { res.status(404).json({ error: "Riga non trovata" }); return; }

  // se bolla già confermata: storna lo scarico
  if (bolla.stato === "confermato") {
    await stornoRiga(riga, bollaId);
  }

  await db.delete(bollaRigheTable).where(eq(bollaRigheTable.id, rigaId));

  // stampa l'operatore PRIMA del sync così l'intervento collegato eredita
  // l'operatore corrente (syncInterventoBolla rilegge bolla.operatoreId)
  await db.update(bolleTable).set({ operatoreId: req.user!.id }).where(eq(bolleTable.id, bollaId));

  // aggiorna (o rimuove) l'intervento sociale collegato
  if (bolla.stato === "confermato") {
    await syncInterventoBolla(bollaId);
  }

  res.status(204).end();
});

// ─── CONFERMA (bozza → confermato + scarico FEFO) ────────────────────────────

router.post("/bolle/:id/conferma", async (req, res) => {
  const bollaId = parseInt(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(bolla.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(bolla.beneficiarioId), callerCittaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(bolla.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (bolla.stato !== "bozza") {
    res.status(400).json({ error: "La bolla non è in stato bozza" });
    return;
  }

  const righe = await db.select().from(bollaRigheTable).where(eq(bollaRigheTable.bollaId, bollaId));
  if (righe.length === 0) {
    res.status(400).json({ error: "Impossibile confermare una bolla senza prodotti" });
    return;
  }

  // verifica disponibilità totale per prodotto
  const byProdotto: Record<number, number> = {};
  for (const riga of righe) {
    byProdotto[riga.prodottoId] = (byProdotto[riga.prodottoId] ?? 0) + parseFloat(riga.quantita);
  }
  for (const [prodIdStr, qtaRichiesta] of Object.entries(byProdotto)) {
    const prodId = parseInt(prodIdStr);
    const disponibile = await giacenzaDisponibile(prodId, bolla.magazzinoId);
    if (disponibile < qtaRichiesta) {
      const [prod] = await db.select().from(prodottiTable).where(eq(prodottiTable.id, prodId));
      res.status(400).json({
        error: `Disponibilità insufficiente per ${prod?.nome ?? `prodotto #${prodId}`}: disponibile ${disponibile.toFixed(2)}, totale in bolla ${qtaRichiesta.toFixed(2)}`,
      });
      return;
    }
  }

  // verifica disponibilità per singolo lotto (somma righe sullo stesso lotto)
  const byLotto: Record<number, number> = {};
  for (const riga of righe) {
    if (riga.lottoId) byLotto[riga.lottoId] = (byLotto[riga.lottoId] ?? 0) + parseFloat(riga.quantita);
  }
  for (const [lottoIdStr, qtaRichiesta] of Object.entries(byLotto)) {
    const lId = parseInt(lottoIdStr);
    const [lotto] = await db.select().from(lottiTable).where(eq(lottiTable.id, lId));
    const disp = lotto ? parseFloat(lotto.quantitaResidua) : 0;
    if (disp < qtaRichiesta) {
      const [prod] = lotto ? await db.select().from(prodottiTable).where(eq(prodottiTable.id, lotto.prodottoId)) : [];
      res.status(400).json({
        error: `Disponibilità insufficiente nel lotto ${lotto?.codiceLotto ?? `#${lId}`}${prod ? ` per ${prod.nome}` : ""}: disponibile ${disp.toFixed(2)}, totale in bolla ${qtaRichiesta.toFixed(2)}`,
      });
      return;
    }
  }

  const today = new Date().toISOString().split("T")[0];

  for (const riga of righe) {
    if (riga.lottoId) {
      const [lotto] = await db.select().from(lottiTable).where(eq(lottiTable.id, riga.lottoId));
      if (lotto) {
        const disp = parseFloat(lotto.quantitaResidua);
        const scala = parseFloat(riga.quantita);
        if (disp < scala) {
          const [prod] = await db.select().from(prodottiTable).where(eq(prodottiTable.id, riga.prodottoId));
          res.status(400).json({
            error: `Disponibilità insufficiente nel lotto ${lotto.codiceLotto ?? `#${lotto.id}`} per ${prod?.nome ?? "prodotto"}: disponibile ${disp.toFixed(2)}, richiesto ${scala.toFixed(2)}`,
          });
          return;
        }
        await db.update(lottiTable)
          .set({ quantitaResidua: (disp - scala).toFixed(2) })
          .where(eq(lottiTable.id, riga.lottoId));

        await db.insert(movimentiTable).values({
          tipoMovimento: "scarico",
          tipoDettaglio: "consegna_beneficiario",
          dataMovimento: today,
          magazzinoId: bolla.magazzinoId,
          prodottoId: riga.prodottoId,
          lottoId: riga.lottoId,
          quantita: riga.quantita,
          unitaMisura: riga.unitaMisura,
          beneficiarioId: bolla.beneficiarioId,
          bollaId,
          bollaRigaId: riga.id,
          documentoRiferimento: bolla.numeroBolla,
          note: riga.note ?? undefined,
        });
      }
    } else {
      await scaricoFEFO(
        riga.prodottoId, bolla.magazzinoId, parseFloat(riga.quantita), bollaId,
        { beneficiarioId: bolla.beneficiarioId, numeroBolla: bolla.numeroBolla },
        riga.unitaMisura, riga.note ?? null, riga.id,
      );
    }
  }

  await db.update(bolleTable).set({ stato: "confermato", operatoreId: req.user!.id }).where(eq(bolleTable.id, bollaId));
  await syncInterventoBolla(bollaId);
  const det = await buildDettaglio(bollaId);
  res.json(det);
});

// ─── CONSEGNA (confermato → consegnato) ──────────────────────────────────────

router.post("/bolle/:id/consegna", async (req, res) => {
  const bollaId = parseInt(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(bolla.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(bolla.beneficiarioId), callerCittaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(bolla.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (bolla.stato !== "confermato") {
    res.status(400).json({ error: "La bolla deve essere in stato confermato per essere consegnata" });
    return;
  }

  const { noteRicezione, confermaRicezione } = req.body ?? {};

  await db.update(bolleTable).set({
    stato: "consegnato",
    confermaRicezione: confermaRicezione ?? true,
    noteRicezione: noteRicezione ?? null,
    operatoreId: req.user!.id,
  }).where(eq(bolleTable.id, bollaId));

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
  if (!canAccessCentro(await beneficiarioCentroId(bolla.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(bolla.beneficiarioId), callerCittaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(bolla.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (bolla.stato === "annullato") {
    res.status(400).json({ error: "La bolla è già annullata" });
    return;
  }

  // se confermata o consegnata: la merce è già stata scaricata dal magazzino,
  // quindi va stornata (ripristino lotti + cancellazione movimenti) per riga.
  if (bolla.stato === "confermato" || bolla.stato === "consegnato") {
    const righe = await db.select().from(bollaRigheTable).where(eq(bollaRigheTable.bollaId, bollaId));
    for (const riga of righe) {
      await stornoRiga(riga, bollaId);
    }
  }

  // se era consegnata e collegata a una consegna effettuata, riportiamo la
  // consegna a "pianificata" così i dati restano coerenti dopo lo storno.
  if (bolla.stato === "consegnato" && bolla.consegnaId != null) {
    await db.update(consegneTable)
      .set({ stato: "pianificata", dataEffettuata: null })
      .where(and(eq(consegneTable.id, bolla.consegnaId), eq(consegneTable.stato, "effettuata")));
  }

  await db.update(bolleTable).set({ stato: "annullato", operatoreId: req.user!.id }).where(eq(bolleTable.id, bollaId));
  await removeInterventoBolla(bollaId);
  const det = await buildDettaglio(bollaId);
  res.json(det);
});

export default router;
