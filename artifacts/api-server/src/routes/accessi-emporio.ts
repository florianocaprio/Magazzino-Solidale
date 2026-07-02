import { Router, type IRouter } from "express";
import {
  beneficiariTable,
  centriAscoltoTable,
  consegneTable,
  cittaTable,
  db,
  magazziniTable,
} from "@workspace/db";
import { and, desc, eq, gte, ilike, lt, lte, ne, or, type SQL } from "drizzle-orm";
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
import { EMPORIO_DISABLED_MSG, isEmporioEnabled } from "../lib/impostazioniModuli";

const router: IRouter = Router();

const TIPO_ACCESSO = "accesso_emporio";
const TIPO_CONSEGNA_ACCESSO = "accesso_emporio";
const STATI_ACCESSO = ["pianificato", "confermato", "effettuato", "annullato", "non_presentato"] as const;
type StatoAccesso = (typeof STATI_ACCESSO)[number];

const MSG_BENEFICIARIO_NON_ATTIVO = "Il beneficiario non è attivo.";
const MSG_CENTRO_RICHIESTO = "Per pianificare un Accesso Emporio è necessario associare il beneficiario a un Centro di Ascolto.";
const MSG_CREDITO_RICHIESTO = "Il beneficiario non è abilitato al Credito Solidale.";
const MSG_CREDITO_NON_ATTIVO = "Il Credito Solidale del beneficiario non è attivo.";
const MSG_MAGAZZINO_EMPORIO = "Selezionare un magazzino di tipo Emporio o Misto.";
const MSG_DUPLICATO = "Esiste già un Accesso Emporio pianificato per questo beneficiario nella data selezionata.";

function asInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseDateTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function yyyyMmDd(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dayBounds(value: Date): { start: Date; end: Date } {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function isStatoAccesso(value: unknown): value is StatoAccesso {
  return typeof value === "string" && STATI_ACCESSO.includes(value as StatoAccesso);
}

function statoConsegnaFromAccesso(stato: StatoAccesso): string {
  if (stato === "effettuato") return "effettuata";
  if (stato === "annullato") return "annullata";
  if (stato === "non_presentato") return "mancata";
  return "pianificata";
}

async function assertEmporioEnabled(res: import("express").Response): Promise<boolean> {
  if (await isEmporioEnabled()) return true;
  res.status(403).json({ error: EMPORIO_DISABLED_MSG });
  return false;
}

async function loadBeneficiario(beneficiarioId: number) {
  const [beneficiario] = await db
    .select()
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  return beneficiario ?? null;
}

function validateBeneficiarioAccesso(beneficiario: typeof beneficiariTable.$inferSelect | null): string | null {
  if (!beneficiario) return "Beneficiario non trovato.";
  if (!beneficiario.attivo) return MSG_BENEFICIARIO_NON_ATTIVO;
  if (beneficiario.centroAscoltoId == null) return MSG_CENTRO_RICHIESTO;
  if (!beneficiario.creditoSolidaleAbilitato) return MSG_CREDITO_RICHIESTO;
  if (beneficiario.creditoSolidaleStato !== "attivo") return MSG_CREDITO_NON_ATTIVO;
  return null;
}

async function validateMagazzinoEmporio(id: number, req: import("express").Request): Promise<{ error: string; status: number } | { magazzino: typeof magazziniTable.$inferSelect }> {
  const [magazzino] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, id));
  if (!magazzino || !["emporio", "misto"].includes(magazzino.tipoMagazzino)) {
    return { error: MSG_MAGAZZINO_EMPORIO, status: 400 };
  }
  if (!(await canAccessMagazzino(id, callerCentroId(req), callerCittaId(req)))) {
    return { error: "Magazzino non accessibile per il tuo profilo", status: 403 };
  }
  return { magazzino };
}

async function hasDuplicateAccesso(beneficiarioId: number, dataOraInizio: Date, excludeId?: number): Promise<boolean> {
  const { start, end } = dayBounds(dataOraInizio);
  const conditions: SQL[] = [
    eq(consegneTable.tipoPianificazione, TIPO_ACCESSO),
    eq(consegneTable.beneficiarioId, beneficiarioId),
    gte(consegneTable.dataOraInizio, start),
    lt(consegneTable.dataOraInizio, end),
    ne(consegneTable.statoAccessoEmporio, "annullato"),
    ne(consegneTable.statoAccessoEmporio, "non_presentato"),
  ];
  if (excludeId != null) conditions.push(ne(consegneTable.id, excludeId));
  const rows = await db.select({ id: consegneTable.id }).from(consegneTable).where(and(...conditions)).limit(1);
  return rows.length > 0;
}

function formatAccesso(row: {
  c: typeof consegneTable.$inferSelect;
  beneficiarioNome: string | null;
  beneficiarioCognome: string | null;
  beneficiarioCodice: string | null;
  beneficiarioCodiceFiscale: string | null;
  centroAscoltoId: number | null;
  centroAscoltoNome: string | null;
  cittaId: number | null;
  cittaNome: string | null;
  magazzinoEmporioNome: string | null;
  creditoSolidaleSaldo: string | null;
  creditoSolidaleMensileAssegnato: string | null;
}) {
  return {
    id: row.c.id,
    codice: row.c.codice,
    beneficiarioId: row.c.beneficiarioId,
    beneficiarioNome: row.beneficiarioCognome && row.beneficiarioNome ? `${row.beneficiarioCognome} ${row.beneficiarioNome}` : null,
    beneficiarioCodice: row.beneficiarioCodice,
    beneficiarioCodiceFiscale: row.beneficiarioCodiceFiscale,
    centroAscoltoId: row.centroAscoltoId,
    centroAscoltoNome: row.centroAscoltoNome,
    cittaId: row.cittaId,
    cittaNome: row.cittaNome,
    tipoPianificazione: row.c.tipoPianificazione,
    magazzinoEmporioId: row.c.magazzinoEmporioId,
    magazzinoEmporioNome: row.magazzinoEmporioNome,
    dataOraInizio: row.c.dataOraInizio?.toISOString() ?? null,
    dataOraFine: row.c.dataOraFine?.toISOString() ?? null,
    statoAccessoEmporio: row.c.statoAccessoEmporio,
    motivoAnnullamento: row.c.motivoAnnullamento ?? null,
    noteAccessoEmporio: row.c.noteAccessoEmporio ?? null,
    saldoCreditoSolidale: Number(row.creditoSolidaleSaldo ?? "0"),
    quotaMensileAssegnata: row.creditoSolidaleMensileAssegnato == null ? null : Number(row.creditoSolidaleMensileAssegnato),
    dataCreazione: row.c.dataCreazione.toISOString(),
  };
}

function selectAccessi(conditions: SQL[] = []) {
  return db
    .select({
      c: consegneTable,
      beneficiarioNome: beneficiariTable.nome,
      beneficiarioCognome: beneficiariTable.cognome,
      beneficiarioCodice: beneficiariTable.codice,
      beneficiarioCodiceFiscale: beneficiariTable.codiceFiscale,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      cittaId: beneficiariTable.cittaId,
      cittaNome: cittaTable.nome,
      magazzinoEmporioNome: magazziniTable.nome,
      creditoSolidaleSaldo: beneficiariTable.creditoSolidaleSaldo,
      creditoSolidaleMensileAssegnato: beneficiariTable.creditoSolidaleMensileAssegnato,
    })
    .from(consegneTable)
    .leftJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(centriAscoltoTable, eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(cittaTable, eq(beneficiariTable.cittaId, cittaTable.id))
    .leftJoin(magazziniTable, eq(consegneTable.magazzinoEmporioId, magazziniTable.id))
    .where(and(eq(consegneTable.tipoPianificazione, TIPO_ACCESSO), ...conditions))
    .orderBy(desc(consegneTable.dataOraInizio), desc(consegneTable.id));
}

router.get("/accessi-emporio", async (req, res) => {
  const q = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (q.dataDa) conditions.push(gte(consegneTable.dataOraInizio, new Date(`${q.dataDa}T00:00:00.000`)));
  if (q.dataA) conditions.push(lte(consegneTable.dataOraInizio, new Date(`${q.dataA}T23:59:59.999`)));
  if (q.magazzinoEmporioId) conditions.push(eq(consegneTable.magazzinoEmporioId, Number(q.magazzinoEmporioId)));
  if (q.statoAccessoEmporio) conditions.push(eq(consegneTable.statoAccessoEmporio, q.statoAccessoEmporio));
  if (q.beneficiarioId) conditions.push(eq(consegneTable.beneficiarioId, Number(q.beneficiarioId)));
  if (q.beneficiarioSearch) {
    const s = `%${q.beneficiarioSearch}%`;
    const filter = or(
      ilike(beneficiariTable.nome, s),
      ilike(beneficiariTable.cognome, s),
      ilike(beneficiariTable.codice, s),
      ilike(beneficiariTable.codiceFiscale, s),
    );
    if (filter) conditions.push(filter);
  }
  const caller = callerCentroId(req);
  if (caller != null) {
    const f = centroScopeFilter(beneficiariTable.centroAscoltoId, caller);
    if (f) conditions.push(f);
  } else if (q.centroAscoltoId) {
    conditions.push(eq(beneficiariTable.centroAscoltoId, Number(q.centroAscoltoId)));
  }
  const requestedCitta = q.cittaId ?? q.areaId;
  if (requestedCitta) conditions.push(eq(beneficiariTable.cittaId, Number(requestedCitta)));
  const cittaFilter = cittaScopeFilter(beneficiariTable.cittaId, callerCittaId(req));
  if (cittaFilter) conditions.push(cittaFilter);
  const zonaFilter = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
  if (zonaFilter) conditions.push(zonaFilter);

  const rows = await selectAccessi(conditions).limit(250);
  res.json(rows.map(formatAccesso));
});

router.get("/accessi-emporio/:id", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await selectAccessi([eq(consegneTable.id, id)]).limit(1);
  if (rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  const row = rows[0];
  if (!(await canUseBeneficiario(row.c.beneficiarioId, callerCentroId(req), callerCittaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo profilo" });
    return;
  }
  res.json(formatAccesso(row));
});

router.post("/accessi-emporio", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const beneficiarioId = asInt(req.body?.beneficiarioId);
  const magazzinoEmporioId = asInt(req.body?.magazzinoEmporioId);
  const dataOraInizio = parseDateTime(req.body?.dataOraInizio);
  const dataOraFine = parseDateTime(req.body?.dataOraFine);
  const statoAccessoEmporio = isStatoAccesso(req.body?.statoAccessoEmporio) ? req.body.statoAccessoEmporio : "pianificato";
  if (beneficiarioId == null || magazzinoEmporioId == null || dataOraInizio == null) {
    res.status(400).json({ error: "Beneficiario, Emporio e data/ora inizio sono obbligatori." });
    return;
  }
  if (dataOraFine != null && dataOraFine <= dataOraInizio) {
    res.status(400).json({ error: "L'ora fine deve essere successiva all'ora inizio." });
    return;
  }
  if (!(await canUseBeneficiario(beneficiarioId, callerCentroId(req), callerCittaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo profilo" });
    return;
  }
  const beneficiario = await loadBeneficiario(beneficiarioId);
  const beneficiarioError = validateBeneficiarioAccesso(beneficiario);
  if (beneficiarioError) { res.status(400).json({ error: beneficiarioError }); return; }
  const emporio = await validateMagazzinoEmporio(magazzinoEmporioId, req);
  if ("error" in emporio) { res.status(emporio.status).json({ error: emporio.error }); return; }
  if (await hasDuplicateAccesso(beneficiarioId, dataOraInizio)) {
    res.status(409).json({ error: MSG_DUPLICATO });
    return;
  }

  const [created] = await db
    .insert(consegneTable)
    .values({
      codice: `EMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      beneficiarioId,
      tipoPianificazione: TIPO_ACCESSO,
      tipoConsegna: TIPO_CONSEGNA_ACCESSO,
      dataPrevista: yyyyMmDd(dataOraInizio),
      magazzinoId: magazzinoEmporioId,
      magazzinoEmporioId,
      dataOraInizio,
      dataOraFine,
      stato: statoConsegnaFromAccesso(statoAccessoEmporio),
      statoAccessoEmporio,
      noteAccessoEmporio: asText(req.body?.noteAccessoEmporio),
    })
    .returning({ id: consegneTable.id });
  const rows = await selectAccessi([eq(consegneTable.id, created.id)]).limit(1);
  res.status(201).json(formatAccesso(rows[0]));
});

router.patch("/accessi-emporio/:id", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(consegneTable).where(and(eq(consegneTable.id, id), eq(consegneTable.tipoPianificazione, TIPO_ACCESSO)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canUseBeneficiario(existing.beneficiarioId, callerCentroId(req), callerCittaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo profilo" });
    return;
  }

  const beneficiarioId = asInt(req.body?.beneficiarioId) ?? existing.beneficiarioId;
  const magazzinoEmporioId = asInt(req.body?.magazzinoEmporioId) ?? existing.magazzinoEmporioId;
  const dataOraInizio = "dataOraInizio" in req.body ? parseDateTime(req.body.dataOraInizio) : existing.dataOraInizio;
  const dataOraFine = "dataOraFine" in req.body ? parseDateTime(req.body.dataOraFine) : existing.dataOraFine;
  if (magazzinoEmporioId == null || dataOraInizio == null) {
    res.status(400).json({ error: "Emporio e data/ora inizio sono obbligatori." });
    return;
  }
  if (dataOraFine != null && dataOraFine <= dataOraInizio) {
    res.status(400).json({ error: "L'ora fine deve essere successiva all'ora inizio." });
    return;
  }
  if (!(await canUseBeneficiario(beneficiarioId, callerCentroId(req), callerCittaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo profilo" });
    return;
  }
  const beneficiario = await loadBeneficiario(beneficiarioId);
  const beneficiarioError = validateBeneficiarioAccesso(beneficiario);
  if (beneficiarioError) { res.status(400).json({ error: beneficiarioError }); return; }
  const emporio = await validateMagazzinoEmporio(magazzinoEmporioId, req);
  if ("error" in emporio) { res.status(emporio.status).json({ error: emporio.error }); return; }
  if (await hasDuplicateAccesso(beneficiarioId, dataOraInizio, id)) {
    res.status(409).json({ error: MSG_DUPLICATO });
    return;
  }

  const updates: Partial<typeof consegneTable.$inferInsert> = {
    beneficiarioId,
    magazzinoId: magazzinoEmporioId,
    magazzinoEmporioId,
    dataOraInizio,
    dataOraFine,
    dataPrevista: yyyyMmDd(dataOraInizio),
    noteAccessoEmporio: "noteAccessoEmporio" in req.body ? asText(req.body.noteAccessoEmporio) : existing.noteAccessoEmporio,
  };
  if (isStatoAccesso(req.body?.statoAccessoEmporio)) {
    updates.statoAccessoEmporio = req.body.statoAccessoEmporio;
    updates.stato = statoConsegnaFromAccesso(req.body.statoAccessoEmporio);
  }

  await db.update(consegneTable).set(updates).where(eq(consegneTable.id, id));
  const rows = await selectAccessi([eq(consegneTable.id, id)]).limit(1);
  res.json(formatAccesso(rows[0]));
});

router.patch("/accessi-emporio/:id/stato", async (req, res) => {
  if (!(await assertEmporioEnabled(res))) return;
  const id = Number(req.params.id);
  const stato = req.body?.statoAccessoEmporio ?? req.body?.stato;
  if (!isStatoAccesso(stato)) {
    res.status(400).json({ error: "Stato Accesso Emporio non valido." });
    return;
  }
  const [existing] = await db.select().from(consegneTable).where(and(eq(consegneTable.id, id), eq(consegneTable.tipoPianificazione, TIPO_ACCESSO)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canUseBeneficiario(existing.beneficiarioId, callerCentroId(req), callerCittaId(req), callerZonaUdsId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo profilo" });
    return;
  }
  const motivoAnnullamento = asText(req.body?.motivoAnnullamento);
  if (stato === "annullato" && !motivoAnnullamento) {
    res.status(400).json({ error: "Il motivo annullamento è obbligatorio." });
    return;
  }
  await db
    .update(consegneTable)
    .set({
      statoAccessoEmporio: stato,
      stato: statoConsegnaFromAccesso(stato),
      motivoAnnullamento: stato === "annullato" ? motivoAnnullamento : existing.motivoAnnullamento,
      dataEffettuata: stato === "effettuato" ? new Date() : existing.dataEffettuata,
    })
    .where(eq(consegneTable.id, id));
  const rows = await selectAccessi([eq(consegneTable.id, id)]).limit(1);
  res.json(formatAccesso(rows[0]));
});

export default router;
