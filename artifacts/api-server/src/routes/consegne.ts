import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  consegneTable,
  beneficiariTable,
  magazziniTable,
  volontariTable,
  bolleTable,
  centriAscoltoTable,
  turniTable,
  turniVolontariTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, inArray, type SQL } from "drizzle-orm";
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
  canAccessMagazzino,
} from "../lib/centroScope";
import { volontarioOverLimit } from "../lib/volontarioCarico";
import { sendEmail } from "../lib/emailService";
import { buildIcs } from "../lib/ics";
import { completeBollaDelivery, handleBollaActionError } from "../lib/bollaDelivery";

const LIMITE_TURNO_MSG = "Il volontario ha già raggiunto il numero massimo di consegne per questo turno";

const router: IRouter = Router();

// priorità con cui scegliere la bolla "rappresentativa" di una consegna quando
// ce ne fosse più d'una collegata (le annullate sono ignorate del tutto)
const BOLLA_PRIORITA: Record<string, number> = { consegnato: 3, confermato: 2, bozza: 1 };

function normalizeText(v: unknown): string | null {
  if (typeof v !== "string") return v == null ? null : String(v).trim() || null;
  return v.trim() || null;
}

function normalizeConsegnaPayload(raw: Record<string, any>) {
  const body = { ...raw };
  if ("volontarioAltro" in body) {
    body.volontarioAltro = normalizeText(body.volontarioAltro);
    if (body.volontarioAltro) body.volontarioId = null;
  }
  return body;
}

function fasciaTurnoFromConsegna(fascia: string | null | undefined): string | null {
  const normalized = (fascia ?? "").toLowerCase();
  if (normalized.includes("matt")) return "09-13";
  if (normalized.includes("pom")) return "14-18";
  if (normalized.includes("sera") || normalized.includes("18")) return "18-20";
  return null;
}

async function syncTurnoDaConsegna(consegna: typeof consegneTable.$inferSelect) {
  if (consegna.volontarioId == null && consegna.mezzoId == null) return;
  const centroAscoltoId = await beneficiarioCentroId(consegna.beneficiarioId);
  const fascia = fasciaTurnoFromConsegna(consegna.fasciaOraria);
  if (centroAscoltoId == null || fascia == null) return;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(turniTable)
      .where(and(
        eq(turniTable.centroAscoltoId, centroAscoltoId),
        eq(turniTable.data, consegna.dataPrevista),
        eq(turniTable.fascia, fascia),
      ));

    let turnoId: number;
    if (existing) {
      turnoId = existing.id;
      if (consegna.mezzoId != null && existing.mezzoId !== consegna.mezzoId) {
        await tx.update(turniTable).set({ mezzoId: consegna.mezzoId }).where(eq(turniTable.id, turnoId));
      }
    } else {
      const [created] = await tx
        .insert(turniTable)
        .values({
          centroAscoltoId,
          data: consegna.dataPrevista,
          fascia,
          mezzoId: consegna.mezzoId ?? null,
        })
        .returning();
      turnoId = created.id;
    }

    if (consegna.volontarioId != null) {
      const [already] = await tx
        .select({ id: turniVolontariTable.id })
        .from(turniVolontariTable)
        .where(and(
          eq(turniVolontariTable.turnoId, turnoId),
          eq(turniVolontariTable.volontarioId, consegna.volontarioId),
        ));
      if (!already) {
        await tx.insert(turniVolontariTable).values({
          turnoId,
          volontarioId: consegna.volontarioId,
          ruolo: "Consegna",
        });
      }
    }
  });
}

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
  const { stato, data, dataInizio, dataFine, beneficiarioId, centroAscoltoId } = req.query as Record<string, string>;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  for (const [name, val] of [["data", data], ["dataInizio", dataInizio], ["dataFine", dataFine]] as const) {
    if (val && !dateRe.test(val)) {
      res.status(400).json({ error: `Parametro '${name}' non valido (formato atteso: YYYY-MM-DD)` });
      return;
    }
  }
  const conditions: SQL[] = [];
  if (stato) conditions.push(eq(consegneTable.stato, stato));
  if (data) conditions.push(eq(consegneTable.dataPrevista, data));
  if (dataInizio) conditions.push(gte(consegneTable.dataPrevista, dataInizio));
  if (dataFine) conditions.push(lte(consegneTable.dataPrevista, dataFine));
  if (beneficiarioId) conditions.push(eq(consegneTable.beneficiarioId, parseInt(beneficiarioId)));
  const caller = callerCentroId(req);
  if (caller != null) {
    const f = centroScopeFilter(beneficiariTable.centroAscoltoId, caller);
    if (f) conditions.push(f);
  } else if (centroAscoltoId) {
    conditions.push(eq(beneficiariTable.centroAscoltoId, parseInt(centroAscoltoId)));
  }
  const cittaFilter = cittaScopeFilter(beneficiariTable.cittaId, callerCittaId(req));
  if (cittaFilter) conditions.push(cittaFilter);
  const zonaFilter = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
  if (zonaFilter) conditions.push(zonaFilter);

  const rows = await db
    .select({
      c: consegneTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      magazzinoNome: magazziniTable.nome,
      volNome: volontariTable.nome,
      volCognome: volontariTable.cognome,
    })
    .from(consegneTable)
    .leftJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(centriAscoltoTable, eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(magazziniTable, eq(consegneTable.magazzinoId, magazziniTable.id))
    .leftJoin(volontariTable, eq(consegneTable.volontarioId, volontariTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(consegneTable.dataCreazione), desc(consegneTable.id))
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
      centroAscoltoId: r.centroAscoltoId ?? null,
      centroAscoltoNome: r.centroAscoltoNome ?? null,
      volontarioId: r.c.volontarioId ?? null,
      volontarioNome: r.volNome && r.volCognome ? `${r.volCognome} ${r.volNome}` : null,
      volontarioAltro: r.c.volontarioAltro ?? null,
      mezzoId: r.c.mezzoId ?? null,
      mezzoAltro: r.c.mezzoAltro ?? false,
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
  const body = normalizeConsegnaPayload(req.body);
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const zid = callerZonaUdsId(req);
  if (body.volontarioId != null && body.volontarioAltro) {
    res.status(400).json({ error: "Indicare un volontario censito oppure Altro, non entrambi" });
    return;
  }
  if ((caller != null || cid != null || zid != null) && !(await canUseBeneficiario(body.beneficiarioId, caller, cid, zid))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }
  if ((caller != null || cid != null) && body.magazzinoId != null
      && !(await canAccessMagazzino(body.magazzinoId, caller, cid))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo centro" });
    return;
  }
  if (body.volontarioId != null && body.dataPrevista
      && await volontarioOverLimit(body.volontarioId, body.dataPrevista)) {
    res.status(400).json({ error: LIMITE_TURNO_MSG });
    return;
  }
  const codice = `CON-${Date.now()}`;
  const [row] = await db.insert(consegneTable).values({ ...body, codice } as typeof consegneTable.$inferInsert).returning();
  await syncTurnoDaConsegna(row);
  res.status(201).json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.get("/consegne/:id", async (req, res) => {
  const [row] = await db.select().from(consegneTable).where(eq(consegneTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(row.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(row.beneficiarioId), callerCittaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(row.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.patch("/consegne/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(consegneTable).where(eq(consegneTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const zid = callerZonaUdsId(req);
  if (!canAccessCentro(await beneficiarioCentroId(existing.beneficiarioId), caller)
      || !canAccessCitta(await beneficiarioCittaId(existing.beneficiarioId), cid)
      || !canAccessZonaUds(await beneficiarioZonaUdsId(existing.beneficiarioId), zid)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if ((caller != null || cid != null || zid != null) && req.body.beneficiarioId != null && req.body.beneficiarioId !== existing.beneficiarioId
      && !(await canUseBeneficiario(req.body.beneficiarioId, caller, cid, zid))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }
  if ((caller != null || cid != null) && req.body.magazzinoId != null && req.body.magazzinoId !== existing.magazzinoId
      && !(await canAccessMagazzino(req.body.magazzinoId, caller, cid))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo centro" });
    return;
  }
  const body = normalizeConsegnaPayload(req.body);
  const nextVol = body.volontarioId !== undefined ? body.volontarioId : existing.volontarioId;
  const nextAltro = body.volontarioAltro !== undefined ? body.volontarioAltro : existing.volontarioAltro;
  if (nextVol != null && nextAltro) {
    res.status(400).json({ error: "Indicare un volontario censito oppure Altro, non entrambi" });
    return;
  }
  const nextData = body.dataPrevista !== undefined ? body.dataPrevista : existing.dataPrevista;
  if (nextVol != null && nextData
      && await volontarioOverLimit(nextVol, nextData, { excludeConsegnaId: id })) {
    res.status(400).json({ error: LIMITE_TURNO_MSG });
    return;
  }
  const [row] = await db.update(consegneTable).set(body).where(eq(consegneTable.id, id)).returning();
  await syncTurnoDaConsegna(row);
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

// ─── ANNULLA (ELIMINA) PIANIFICAZIONE ────────────────────────────────────────
// Annulla un'intera pianificazione di consegna: scollega le eventuali bolle
// (il documento merce resta in archivio) ed elimina la riga consegna.
router.delete("/consegne/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(consegneTable).where(eq(consegneTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(existing.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(existing.beneficiarioId), callerCittaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(existing.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  await db.update(bolleTable).set({ consegnaId: null }).where(eq(bolleTable.consegnaId, id));
  await db.delete(consegneTable).where(eq(consegneTable.id, id));
  res.status(204).end();
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
  if (!canAccessCentro(await beneficiarioCentroId(consegna.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(consegna.beneficiarioId), callerCittaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(consegna.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

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

  const [row] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.post("/consegne/:id/completa", async (req, res) => {
  const consegnaId = parseInt(req.params.id);

  const [consegna] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
  if (!consegna) { res.status(404).json({ error: "Not found" }); return; }
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const zid = callerZonaUdsId(req);
  if (!canAccessCentro(await beneficiarioCentroId(consegna.beneficiarioId), caller)
      || !canAccessCitta(await beneficiarioCittaId(consegna.beneficiarioId), cid)
      || !canAccessZonaUds(await beneficiarioZonaUdsId(consegna.beneficiarioId), zid)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
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
  if (!(await canAccessMagazzino(bollaPronta.magazzinoId, caller, cid))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo profilo" });
    return;
  }

  try {
    await completeBollaDelivery({
      bollaId: bollaPronta.id,
      userId: req.user!.id,
      confermaRicezione: true,
      allowAlreadyConsegnata: true,
    });
  } catch (err) {
    if (handleBollaActionError(err, res)) return;
    throw err;
  }

  const [row] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

/** Costruisce la rappresentazione della consegna con info bolla (per le risposte delle azioni). */
async function dettaglioConsegna(id: number) {
  const [r] = await db
    .select({
      c: consegneTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      magazzinoNome: magazziniTable.nome,
      volNome: volontariTable.nome,
      volCognome: volontariTable.cognome,
    })
    .from(consegneTable)
    .leftJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(centriAscoltoTable, eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id))
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
    centroAscoltoId: r.centroAscoltoId ?? null,
    centroAscoltoNome: r.centroAscoltoNome ?? null,
    volontarioId: r.c.volontarioId ?? null,
    volontarioNome: r.volNome && r.volCognome ? `${r.volCognome} ${r.volNome}` : null,
    volontarioAltro: r.c.volontarioAltro ?? null,
    mezzoId: r.c.mezzoId ?? null,
    mezzoAltro: r.c.mezzoAltro ?? false,
    stato: r.c.stato,
    bollaId: bolla?.id ?? null,
    bollaNumero: bolla?.numeroBolla ?? null,
    bollaStato: bolla?.stato ?? null,
    noteOperative: r.c.noteOperative ?? null,
    dataEffettuata: r.c.dataEffettuata?.toISOString() ?? null,
    dataCreazione: r.c.dataCreazione.toISOString(),
  };
}

// ─── REMINDER EMAIL (con ICS) ────────────────────────────────────────────────
type EmailDestinatario = "beneficiario" | "volontario";

async function caricaConsegnaPerEmail(consegnaId: number) {
  const [r] = await db
    .select({
      c: consegneTable,
      benNome: beneficiariTable.nome,
      benCognome: beneficiariTable.cognome,
      benEmail: beneficiariTable.email,
      magazzinoNome: magazziniTable.nome,
      magazzinoIndirizzo: magazziniTable.indirizzo,
      volNome: volontariTable.nome,
      volCognome: volontariTable.cognome,
      volEmail: volontariTable.email,
    })
    .from(consegneTable)
    .leftJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(magazziniTable, eq(consegneTable.magazzinoId, magazziniTable.id))
    .leftJoin(volontariTable, eq(consegneTable.volontarioId, volontariTable.id))
    .where(eq(consegneTable.id, consegnaId));
  return r ?? null;
}

function luogoConsegna(r: NonNullable<Awaited<ReturnType<typeof caricaConsegnaPerEmail>>>): string {
  if (r.c.tipoConsegna === "domicilio") {
    return r.c.indirizzoConsegna?.trim() || "Domicilio del beneficiario";
  }
  return [r.magazzinoNome, r.magazzinoIndirizzo].filter(Boolean).join(" — ") || "Magazzino";
}

async function inviaReminderConsegna(req: import("express").Request, res: import("express").Response, destinatario: EmailDestinatario) {
  const consegnaId = parseInt(req.params.id as string);
  const r = await caricaConsegnaPerEmail(consegnaId);
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(r.c.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(r.c.beneficiarioId), callerCittaId(req))
      || !canAccessZonaUds(await beneficiarioZonaUdsId(r.c.beneficiarioId), callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

  const benNomeCompleto = r.benNome && r.benCognome ? `${r.benCognome} ${r.benNome}` : "il beneficiario";
  const volNomeCompleto = r.volNome && r.volCognome ? `${r.volCognome} ${r.volNome}` : null;
  const luogo = luogoConsegna(r);
  const fascia = r.c.fasciaOraria?.trim();
  const dataFmt = r.c.dataPrevista;

  let to: string | null;
  let subject: string;
  let text: string;
  if (destinatario === "beneficiario") {
    to = r.benEmail?.trim() || null;
    if (!to) { res.json({ sent: false, error: "Il beneficiario non ha un indirizzo email" }); return; }
    subject = `Promemoria consegna — ${dataFmt}`;
    text = [
      `Gentile ${benNomeCompleto},`,
      ``,
      `le ricordiamo la consegna prevista per il giorno ${dataFmt}${fascia ? ` (${fascia})` : ""}.`,
      `Luogo: ${luogo}.`,
      ``,
      `In allegato trova l'evento da aggiungere al suo calendario.`,
      ``,
      `Magazzino Solidale AIM`,
    ].join("\n");
  } else {
    to = r.volEmail?.trim() || null;
    if (r.c.volontarioId == null) { res.json({ sent: false, error: "Nessun volontario assegnato a questa consegna" }); return; }
    if (!to) { res.json({ sent: false, error: "Il volontario non ha un indirizzo email" }); return; }
    subject = `Promemoria consegna da effettuare — ${dataFmt}`;
    text = [
      `Ciao ${volNomeCompleto ?? ""},`.trim(),
      ``,
      `ti ricordiamo la consegna assegnata per il giorno ${dataFmt}${fascia ? ` (${fascia})` : ""}.`,
      `Beneficiario: ${benNomeCompleto}.`,
      `Luogo: ${luogo}.`,
      ``,
      `In allegato trovi l'evento da aggiungere al tuo calendario.`,
      ``,
      `Magazzino Solidale AIM`,
    ].join("\n");
  }

  const ics = buildIcs({
    uid: `consegna-${consegnaId}-${destinatario}@magazzino-solidale`,
    date: dataFmt,
    summary: destinatario === "beneficiario" ? "Consegna prevista" : `Consegna a ${benNomeCompleto}`,
    description: fascia ? `Fascia oraria: ${fascia}` : undefined,
    location: luogo,
  });

  try {
    await sendEmail({
      to,
      subject,
      text,
      attachments: [{ filename: "consegna.ics", content: ics, contentType: "text/calendar; charset=utf-8" }],
    });
    res.json({ sent: true, error: null });
  } catch (err) {
    req.log.error({ err }, `Invio email consegna (${destinatario}) fallito`);
    res.json({ sent: false, error: err instanceof Error ? err.message : "Invio fallito" });
  }
}

router.post("/consegne/:id/invia-email-beneficiario", (req, res) => inviaReminderConsegna(req, res, "beneficiario"));
router.post("/consegne/:id/invia-email-volontario", (req, res) => inviaReminderConsegna(req, res, "volontario"));

export default router;
