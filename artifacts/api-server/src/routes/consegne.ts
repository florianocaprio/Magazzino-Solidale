import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { consegneTable, beneficiariTable, magazziniTable, volontariTable, bolleTable } from "@workspace/db";
import { eq, and, desc, inArray, type SQL } from "drizzle-orm";

const router: IRouter = Router();

// priorità con cui scegliere la bolla "rappresentativa" di una consegna quando
// ce ne fosse più d'una collegata (le annullate sono ignorate del tutto)
const BOLLA_PRIORITA: Record<string, number> = { consegnato: 3, confermato: 2, bozza: 1 };

/** Ritorna, per ogni consegnaId, la bolla collegata più rilevante (non annullata). */
async function bollePerConsegne(consegnaIds: number[]) {
  const map = new Map<number, { id: number; numeroBolla: string; stato: string }>();
  if (consegnaIds.length === 0) return map;
  const rows = await db
    .select({ id: bolleTable.id, numeroBolla: bolleTable.numeroBolla, stato: bolleTable.stato, consegnaId: bolleTable.consegnaId })
    .from(bolleTable)
    .where(inArray(bolleTable.consegnaId, consegnaIds));
  for (const r of rows) {
    if (r.consegnaId == null || r.stato === "annullato") continue;
    const current = map.get(r.consegnaId);
    if (!current || (BOLLA_PRIORITA[r.stato] ?? 0) > (BOLLA_PRIORITA[current.stato] ?? 0)) {
      map.set(r.consegnaId, { id: r.id, numeroBolla: r.numeroBolla, stato: r.stato });
    }
  }
  return map;
}

router.get("/consegne", async (req, res) => {
  const { stato, beneficiarioId, centroAscoltoId } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (stato) conditions.push(eq(consegneTable.stato, stato));
  if (beneficiarioId) conditions.push(eq(consegneTable.beneficiarioId, parseInt(beneficiarioId)));
  if (centroAscoltoId) conditions.push(eq(beneficiariTable.centroAscoltoId, parseInt(centroAscoltoId)));

  const rows = await db
    .select({
      c: consegneTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      magazzinoNome: magazziniTable.nome,
      volNome: volontariTable.nome,
      volCognome: volontariTable.cognome,
    })
    .from(consegneTable)
    .leftJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(magazziniTable, eq(consegneTable.magazzinoId, magazziniTable.id))
    .leftJoin(volontariTable, eq(consegneTable.volontarioId, volontariTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(consegneTable.dataPrevista))
    .limit(200);

  const bolle = await bollePerConsegne(rows.map(r => r.c.id));

  res.json(rows.map(r => {
    const bolla = bolle.get(r.c.id) ?? null;
    return {
      id: r.c.id,
      codice: r.c.codice,
      beneficiarioId: r.c.beneficiarioId,
      beneficiarioNome: r.cognome && r.nome ? `${r.cognome} ${r.nome}` : null,
      tipoConsegna: r.c.tipoConsegna,
      dataPrevista: r.c.dataPrevista,
      fasciaOraria: r.c.fasciaOraria ?? null,
      indirizzoConsegna: r.c.indirizzoConsegna ?? null,
      zona: r.c.zona ?? null,
      magazzinoId: r.c.magazzinoId,
      magazzinoNome: r.magazzinoNome ?? null,
      volontarioId: r.c.volontarioId ?? null,
      volontarioNome: r.volNome && r.volCognome ? `${r.volCognome} ${r.volNome}` : null,
      mezzoId: r.c.mezzoId ?? null,
      stato: r.c.stato,
      bollaId: bolla?.id ?? null,
      bollaNumero: bolla?.numeroBolla ?? null,
      bollaStato: bolla?.stato ?? null,
      noteOperative: r.c.noteOperative ?? null,
      dataEffettuata: r.c.dataEffettuata?.toISOString() ?? null,
      dataCreazione: r.c.dataCreazione.toISOString(),
    };
  }));
});

router.post("/consegne", async (req, res) => {
  const body = req.body;
  const codice = `CON-${Date.now()}`;
  const [row] = await db.insert(consegneTable).values({ ...body, codice }).returning();
  res.status(201).json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.get("/consegne/:id", async (req, res) => {
  const [row] = await db.select().from(consegneTable).where(eq(consegneTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.patch("/consegne/:id", async (req, res) => {
  const [row] = await db.update(consegneTable).set(req.body).where(eq(consegneTable.id, parseInt(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

// ─── ASSOCIA / DISSOCIA BOLLA ────────────────────────────────────────────────
// Collega una bolla alla consegna (o la scollega passando bollaId null).
// La "prontezza" della consegna deriva dallo stato della bolla:
//   bozza = in preparazione · confermato = pronta · consegnato = consegnata
router.post("/consegne/:id/associa-bolla", async (req, res) => {
  const consegnaId = parseInt(req.params.id);
  const { bollaId } = req.body ?? {};

  const [consegna] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
  if (!consegna) { res.status(404).json({ error: "Consegna non trovata" }); return; }

  // scollega: rimuovi il legame da tutte le bolle puntate a questa consegna
  if (bollaId == null) {
    await db.update(bolleTable).set({ consegnaId: null }).where(eq(bolleTable.consegnaId, consegnaId));
    res.json(await dettaglioConsegna(consegnaId));
    return;
  }

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (bolla.beneficiarioId !== consegna.beneficiarioId) {
    res.status(400).json({ error: "La bolla appartiene a un altro beneficiario" });
    return;
  }
  if (bolla.stato === "annullato") {
    res.status(400).json({ error: "Non è possibile associare una bolla annullata" });
    return;
  }
  if (bolla.consegnaId != null && bolla.consegnaId !== consegnaId) {
    res.status(400).json({ error: "La bolla è già associata a un'altra consegna" });
    return;
  }

  // una sola bolla per consegna: scollega le altre, poi collega quella scelta
  await db.update(bolleTable).set({ consegnaId: null }).where(eq(bolleTable.consegnaId, consegnaId));
  await db.update(bolleTable).set({ consegnaId }).where(eq(bolleTable.id, bollaId));

  res.json(await dettaglioConsegna(consegnaId));
});

router.post("/consegne/:id/completa", async (req, res) => {
  const consegnaId = parseInt(req.params.id);

  const [consegna] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
  if (!consegna) { res.status(404).json({ error: "Not found" }); return; }
  if (consegna.stato === "effettuata") {
    res.status(400).json({ error: "La consegna risulta già consegnata" });
    return;
  }

  // serve una bolla pronta (confermata) o già consegnata, dello stesso beneficiario
  const bolle = await db.select().from(bolleTable).where(eq(bolleTable.consegnaId, consegnaId));
  const bollaPronta = bolle.find(b =>
    (b.stato === "confermato" || b.stato === "consegnato") && b.beneficiarioId === consegna.beneficiarioId
  );
  if (!bollaPronta) {
    res.status(400).json({ error: "Associa prima una bolla pronta: la merce non risulta ancora preparata." });
    return;
  }

  // marca la bolla come consegnata (l'intervento collegato è già stato creato
  // alla conferma della bolla, quindi figura nello storico interventi del beneficiario)
  if (bollaPronta.stato === "confermato") {
    await db.update(bolleTable).set({ stato: "consegnato", confermaRicezione: true }).where(eq(bolleTable.id, bollaPronta.id));
  }

  const [row] = await db.update(consegneTable)
    .set({ stato: "effettuata", dataEffettuata: new Date() })
    .where(eq(consegneTable.id, consegnaId))
    .returning();
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

/** Costruisce la rappresentazione della consegna con info bolla (per le risposte delle azioni). */
async function dettaglioConsegna(id: number) {
  const [r] = await db
    .select({
      c: consegneTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      magazzinoNome: magazziniTable.nome,
      volNome: volontariTable.nome,
      volCognome: volontariTable.cognome,
    })
    .from(consegneTable)
    .leftJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(magazziniTable, eq(consegneTable.magazzinoId, magazziniTable.id))
    .leftJoin(volontariTable, eq(consegneTable.volontarioId, volontariTable.id))
    .where(eq(consegneTable.id, id));
  if (!r) return null;
  const bolla = (await bollePerConsegne([id])).get(id) ?? null;
  return {
    id: r.c.id,
    codice: r.c.codice,
    beneficiarioId: r.c.beneficiarioId,
    beneficiarioNome: r.cognome && r.nome ? `${r.cognome} ${r.nome}` : null,
    tipoConsegna: r.c.tipoConsegna,
    dataPrevista: r.c.dataPrevista,
    fasciaOraria: r.c.fasciaOraria ?? null,
    indirizzoConsegna: r.c.indirizzoConsegna ?? null,
    zona: r.c.zona ?? null,
    magazzinoId: r.c.magazzinoId,
    magazzinoNome: r.magazzinoNome ?? null,
    volontarioId: r.c.volontarioId ?? null,
    volontarioNome: r.volNome && r.volCognome ? `${r.volCognome} ${r.volNome}` : null,
    mezzoId: r.c.mezzoId ?? null,
    stato: r.c.stato,
    bollaId: bolla?.id ?? null,
    bollaNumero: bolla?.numeroBolla ?? null,
    bollaStato: bolla?.stato ?? null,
    noteOperative: r.c.noteOperative ?? null,
    dataEffettuata: r.c.dataEffettuata?.toISOString() ?? null,
    dataCreazione: r.c.dataCreazione.toISOString(),
  };
}

export default router;
