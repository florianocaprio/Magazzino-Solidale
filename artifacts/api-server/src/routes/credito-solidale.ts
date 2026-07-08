import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
  creditoSolidaleMovimentiTable,
  db,
  politicheCreditoSolidaleTable,
} from "@workspace/db";
import {
  callerCentroId,
  callerCittaId,
  callerZonaUdsId,
  canAccessCentro,
  canAccessCitta,
  canAccessZonaUds,
  centroScopeFilter,
  cittaScopeFilter,
} from "../lib/centroScope";
import { requireModulo } from "../lib/featureFlags";
import { EMPORIO_DISABLED_MSG, isEmporioEnabled } from "../lib/impostazioniModuli";

const router: IRouter = Router();

router.use("/credito-solidale", requireModulo("CREDITO_SOLIDALE"));

const BENEFICIARIO_NOT_FOUND_MSG = "Beneficiario non trovato.";
const MOVIMENTO_NOT_FOUND_MSG = "Movimento Credito Solidale non trovato.";
const ACCESS_DENIED_MSG = "Beneficiario non accessibile per il tuo profilo";
const NOT_ENABLED_MSG = "Il beneficiario non è abilitato al Credito Solidale.";
const NOT_ACTIVE_MSG = "Il Credito Solidale del beneficiario non è attivo.";
const NEGATIVE_BALANCE_MSG = "Il saldo Credito Solidale non può diventare negativo.";
const MONTHLY_ALREADY_DONE_MSG = "Ricarica mensile già eseguita per il periodo selezionato.";
const NO_QUOTA_MSG = "Quota mensile non assegnata";

const TIPI_MOVIMENTO = ["ricarica_mensile", "ricarica_manuale", "rettifica_positiva", "rettifica_negativa", "storno", "consumo_spesa"] as const;
type TipoMovimento = (typeof TIPI_MOVIMENTO)[number];
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFAULT_POLICY = {
  id: null as number | null,
  nome: "Politica predefinita",
  creditoBaseNucleo: "50.00",
  creditoPerComponente: "10.00",
  bonusMinore: "5.00",
  bonusAnziano: "5.00",
  bonusDisabile: "10.00",
  creditoMinimoMensile: "0.00",
  creditoMassimoMensile: null as string | null,
  giornoRicaricaMensile: 1,
  ricaricaAutomaticaAbilitata: false,
  arrotondamento: "nessuno",
};

type PoliticaCalcolo = typeof DEFAULT_POLICY;
type PoliticaOrigine = "centro" | "citta" | "globale" | "default";

const toNumber = (v: string | number | null | undefined): number => {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const decimalString = (n: number): string => round2(n).toFixed(2);

const nullableText = (v: unknown): string | null =>
  typeof v === "string" ? v.trim() || null : v == null ? null : String(v);

function currentPeriodo(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function parseDecimal(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? round2(n) : null;
}

function parsePeriodo(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

function parseOptionalId(value: unknown): { value?: number; error?: string } {
  if (value === undefined || value == null || value === "") return {};
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? { value: n } : { error: "Filtro non valido." };
}

function applyRounding(value: number, mode: string): number {
  switch (mode) {
    case "intero_superiore":
      return Math.ceil(value);
    case "intero_inferiore":
      return Math.floor(value);
    case "intero_piu_vicino":
      return Math.round(value);
    default:
      return value;
  }
}

function canAccessBeneficiario(beneficiario: typeof beneficiariTable.$inferSelect, req: Request): boolean {
  return (
    canAccessCentro(beneficiario.centroAscoltoId, callerCentroId(req)) &&
    canAccessCitta(beneficiario.cittaId, callerCittaId(req)) &&
    canAccessZonaUds(beneficiario.zonaUdsId, callerZonaUdsId(req))
  );
}

async function requireAccessibleBeneficiario(beneficiarioId: number, req: Request) {
  if (!Number.isInteger(beneficiarioId)) {
    return { error: BENEFICIARIO_NOT_FOUND_MSG, status: 404 } as const;
  }
  const [beneficiario] = await db
    .select()
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId))
    .limit(1);
  if (!beneficiario) return { error: BENEFICIARIO_NOT_FOUND_MSG, status: 404 } as const;
  if (!canAccessBeneficiario(beneficiario, req)) return { error: ACCESS_DENIED_MSG, status: 403 } as const;
  return { beneficiario } as const;
}

async function findPolicyByBeneficiario(
  beneficiario: typeof beneficiariTable.$inferSelect,
): Promise<{ politica: PoliticaCalcolo; origine: PoliticaOrigine }> {
  if (beneficiario.centroAscoltoId != null) {
    const [row] = await db
      .select()
      .from(politicheCreditoSolidaleTable)
      .where(and(
        eq(politicheCreditoSolidaleTable.attiva, true),
        eq(politicheCreditoSolidaleTable.centroAscoltoId, beneficiario.centroAscoltoId),
      ))
      .orderBy(desc(politicheCreditoSolidaleTable.id))
      .limit(1);
    if (row) return { politica: row, origine: "centro" };
  }

  if (beneficiario.cittaId != null) {
    const [row] = await db
      .select()
      .from(politicheCreditoSolidaleTable)
      .where(and(
        eq(politicheCreditoSolidaleTable.attiva, true),
        isNull(politicheCreditoSolidaleTable.centroAscoltoId),
        eq(politicheCreditoSolidaleTable.cittaId, beneficiario.cittaId),
      ))
      .orderBy(desc(politicheCreditoSolidaleTable.id))
      .limit(1);
    if (row) return { politica: row, origine: "citta" };
  }

  const [globalPolicy] = await db
    .select()
    .from(politicheCreditoSolidaleTable)
    .where(and(
      eq(politicheCreditoSolidaleTable.attiva, true),
      isNull(politicheCreditoSolidaleTable.centroAscoltoId),
      isNull(politicheCreditoSolidaleTable.cittaId),
    ))
    .orderBy(desc(politicheCreditoSolidaleTable.id))
    .limit(1);

  if (globalPolicy) return { politica: globalPolicy, origine: "globale" };
  return { politica: DEFAULT_POLICY, origine: "default" };
}

function calculate(
  beneficiario: typeof beneficiariTable.$inferSelect,
  politica: PoliticaCalcolo,
) {
  const creditoBaseNucleo = toNumber(politica.creditoBaseNucleo);
  const quotaComponenti = (beneficiario.numComponenti ?? 0) * toNumber(politica.creditoPerComponente);
  const quotaMinori = (beneficiario.numMinori ?? 0) * toNumber(politica.bonusMinore);
  const quotaAnziani = (beneficiario.numAnziani ?? 0) * toNumber(politica.bonusAnziano);
  const quotaDisabili = (beneficiario.numDisabili ?? 0) * toNumber(politica.bonusDisabile);
  const totalePrimaDeiLimiti = creditoBaseNucleo + quotaComponenti + quotaMinori + quotaAnziani + quotaDisabili;

  const minimo = toNumber(politica.creditoMinimoMensile);
  const massimo = politica.creditoMassimoMensile == null ? null : toNumber(politica.creditoMassimoMensile);
  let totaleLimitato = totalePrimaDeiLimiti;
  let creditoMinimoApplicato: number | null = null;
  let creditoMassimoApplicato: number | null = null;

  if (totaleLimitato < minimo) {
    totaleLimitato = minimo;
    creditoMinimoApplicato = minimo;
  }
  if (massimo != null && totaleLimitato > massimo) {
    totaleLimitato = massimo;
    creditoMassimoApplicato = massimo;
  }

  const totaleSuggerito = round2(applyRounding(totaleLimitato, politica.arrotondamento));
  return {
    creditoBaseNucleo: round2(creditoBaseNucleo),
    quotaComponenti: round2(quotaComponenti),
    quotaMinori: round2(quotaMinori),
    quotaAnziani: round2(quotaAnziani),
    quotaDisabili: round2(quotaDisabili),
    totalePrimaDeiLimiti: round2(totalePrimaDeiLimiti),
    creditoMinimoApplicato: creditoMinimoApplicato == null ? null : round2(creditoMinimoApplicato),
    creditoMassimoApplicato: creditoMassimoApplicato == null ? null : round2(creditoMassimoApplicato),
    arrotondamentoApplicato: politica.arrotondamento,
    totaleSuggerito,
  };
}

function fmtMovimento(row: {
  movimento: typeof creditoSolidaleMovimentiTable.$inferSelect;
  beneficiarioNome: string | null;
  centroAscoltoNome: string | null;
  cittaNome: string | null;
}) {
  const m = row.movimento;
  return {
    id: m.id,
    beneficiarioId: m.beneficiarioId,
    beneficiarioNome: row.beneficiarioNome ?? "",
    centroAscoltoId: m.centroAscoltoId ?? null,
    centroAscoltoNome: row.centroAscoltoNome ?? null,
    cittaId: m.cittaId ?? null,
    cittaNome: row.cittaNome ?? null,
    tipoMovimento: m.tipoMovimento,
    variazioneCredito: Number(m.variazioneCredito),
    saldoPrima: Number(m.saldoPrima),
    saldoDopo: Number(m.saldoDopo),
    periodoRiferimento: m.periodoRiferimento ?? null,
    politicaCreditoSolidaleId: m.politicaCreditoSolidaleId ?? null,
    quotaMensileAssegnata: m.quotaMensileAssegnata == null ? null : Number(m.quotaMensileAssegnata),
    origine: m.origine ?? null,
    riferimentoId: m.riferimentoId ?? null,
    riferimentoTipo: m.riferimentoTipo ?? null,
    note: m.note ?? null,
    motivo: m.motivo ?? null,
    dataMovimento: m.dataMovimento.toISOString(),
    dataCreazione: m.dataCreazione.toISOString(),
    annullato: m.annullato,
    annullatoDaMovimentoId: m.annullatoDaMovimentoId ?? null,
  };
}

async function selectMovimenti(where: SQL[] = [], limit?: number) {
  const query = db
    .select({
      movimento: creditoSolidaleMovimentiTable,
      beneficiarioNome: sqlBeneficiarioNome(),
      centroAscoltoNome: centriAscoltoTable.nome,
      cittaNome: cittaTable.nome,
    })
    .from(creditoSolidaleMovimentiTable)
    .leftJoin(beneficiariTable, eq(creditoSolidaleMovimentiTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(centriAscoltoTable, eq(creditoSolidaleMovimentiTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(cittaTable, eq(creditoSolidaleMovimentiTable.cittaId, cittaTable.id))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(creditoSolidaleMovimentiTable.dataMovimento), desc(creditoSolidaleMovimentiTable.id));
  return limit ? query.limit(limit) : query;
}

function sqlBeneficiarioNome() {
  return sql<string>`trim(coalesce(${beneficiariTable.cognome}, '') || ' ' || coalesce(${beneficiariTable.nome}, ''))`;
}

async function monthlyRechargeExists(beneficiarioId: number, periodoRiferimento: string, tx: Tx | typeof db = db): Promise<boolean> {
  const [hit] = await tx
    .select({ id: creditoSolidaleMovimentiTable.id })
    .from(creditoSolidaleMovimentiTable)
    .where(and(
      eq(creditoSolidaleMovimentiTable.beneficiarioId, beneficiarioId),
      eq(creditoSolidaleMovimentiTable.tipoMovimento, "ricarica_mensile"),
      eq(creditoSolidaleMovimentiTable.periodoRiferimento, periodoRiferimento),
      eq(creditoSolidaleMovimentiTable.annullato, false),
    ))
    .limit(1);
  return hit != null;
}

type CreaMovimentoInput = {
  beneficiarioId: number;
  tipoMovimento: TipoMovimento;
  variazioneCredito: number;
  periodoRiferimento?: string | null;
  politicaCreditoSolidaleId?: number | null;
  quotaMensileAssegnata?: number | null;
  origine?: string | null;
  riferimentoId?: number | null;
  riferimentoTipo?: string | null;
  note?: string | null;
  motivo?: string | null;
  operatoreId?: number | null;
};

async function creaMovimentoCreditoSolidaleTx(tx: Tx, input: CreaMovimentoInput) {
  const [beneficiario] = await tx
    .select()
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, input.beneficiarioId))
    .limit(1);
  if (!beneficiario) return { error: BENEFICIARIO_NOT_FOUND_MSG, status: 404 } as const;
  if (!beneficiario.attivo) return { error: NOT_ACTIVE_MSG, status: 400 } as const;
  if (!beneficiario.creditoSolidaleAbilitato) return { error: NOT_ENABLED_MSG, status: 400 } as const;
  if (beneficiario.creditoSolidaleStato !== "attivo") return { error: NOT_ACTIVE_MSG, status: 400 } as const;

  const saldoPrima = toNumber(beneficiario.creditoSolidaleSaldo);
  const saldoDopo = round2(saldoPrima + input.variazioneCredito);
  if (saldoDopo < 0) return { error: NEGATIVE_BALANCE_MSG, status: 400 } as const;

  const [movimento] = await tx
    .insert(creditoSolidaleMovimentiTable)
    .values({
      beneficiarioId: beneficiario.id,
      centroAscoltoId: beneficiario.centroAscoltoId ?? null,
      cittaId: beneficiario.cittaId ?? null,
      tipoMovimento: input.tipoMovimento,
      variazioneCredito: decimalString(input.variazioneCredito),
      saldoPrima: decimalString(saldoPrima),
      saldoDopo: decimalString(saldoDopo),
      periodoRiferimento: input.periodoRiferimento ?? null,
      politicaCreditoSolidaleId: input.politicaCreditoSolidaleId ?? null,
      quotaMensileAssegnata: input.quotaMensileAssegnata == null ? null : decimalString(input.quotaMensileAssegnata),
      origine: input.origine ?? null,
      riferimentoId: input.riferimentoId ?? null,
      riferimentoTipo: input.riferimentoTipo ?? null,
      note: input.note ?? null,
      motivo: input.motivo ?? null,
      operatoreId: input.operatoreId ?? null,
    })
    .returning();

  await tx
    .update(beneficiariTable)
    .set({
      creditoSolidaleSaldo: decimalString(saldoDopo),
      creditoSolidaleDataUltimoMovimento: movimento.dataMovimento,
      dataAggiornamento: new Date(),
    })
    .where(eq(beneficiariTable.id, beneficiario.id));

  return { movimento } as const;
}

async function creaMovimentoCreditoSolidale(input: CreaMovimentoInput) {
  if (!(await isEmporioEnabled())) return { error: EMPORIO_DISABLED_MSG, status: 403 } as const;
  return db.transaction((tx) => creaMovimentoCreditoSolidaleTx(tx, input));
}

async function getSaldoBeneficiarioResponse(beneficiarioId: number) {
  const [b] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, beneficiarioId));
  if (!b) return null;
  return {
    beneficiarioId: b.id,
    beneficiarioNome: `${b.cognome} ${b.nome}`,
    creditoSolidaleAbilitato: b.creditoSolidaleAbilitato,
    creditoSolidaleStato: b.creditoSolidaleStato,
    saldoAttuale: Number(b.creditoSolidaleSaldo ?? "0"),
    creditoSolidaleMensileAssegnato: b.creditoSolidaleMensileAssegnato == null ? null : Number(b.creditoSolidaleMensileAssegnato),
    dataUltimoMovimento: b.creditoSolidaleDataUltimoMovimento?.toISOString() ?? null,
  };
}

async function buildMonthlyPreview(req: Request, body: Record<string, unknown>) {
  const periodoRiferimento = parsePeriodo(body.periodoRiferimento);
  if (!periodoRiferimento) return { error: "Periodo di riferimento non valido.", status: 400 } as const;
  const centroAscolto = parseOptionalId(body.centroAscoltoId);
  const citta = parseOptionalId(body.cittaId);
  if (centroAscolto.error || citta.error) return { error: "Filtro non valido.", status: 400 } as const;
  const centroAscoltoId = centroAscolto.value;
  const cittaId = citta.value;

  const conditions: SQL[] = [
    eq(beneficiariTable.creditoSolidaleAbilitato, true),
    eq(beneficiariTable.creditoSolidaleStato, "attivo"),
    eq(beneficiariTable.attivo, true),
  ];
  const callerCentro = callerCentroId(req);
  const callerCitta = callerCittaId(req);
  if (callerCentro != null) {
    const f = centroScopeFilter(beneficiariTable.centroAscoltoId, callerCentro);
    if (f) conditions.push(f);
  } else if (centroAscoltoId !== undefined) {
    conditions.push(eq(beneficiariTable.centroAscoltoId, centroAscoltoId));
  }
  const cittaFilter = cittaScopeFilter(beneficiariTable.cittaId, callerCitta);
  if (cittaFilter) conditions.push(cittaFilter);
  else if (cittaId !== undefined) {
    conditions.push(eq(beneficiariTable.cittaId, cittaId));
  }

  const rows = await db
    .select({
      beneficiario: beneficiariTable,
      centroAscoltoNome: centriAscoltoTable.nome,
      cittaNome: cittaTable.nome,
    })
    .from(beneficiariTable)
    .leftJoin(centriAscoltoTable, eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(cittaTable, eq(beneficiariTable.cittaId, cittaTable.id))
    .where(and(...conditions))
    .orderBy(beneficiariTable.cognome, beneficiariTable.nome);

  const ids = rows.map((row) => row.beneficiario.id);
  const giaRicaricatiRows = ids.length === 0
    ? []
    : await db
        .select({ beneficiarioId: creditoSolidaleMovimentiTable.beneficiarioId })
        .from(creditoSolidaleMovimentiTable)
        .where(and(
          inArray(creditoSolidaleMovimentiTable.beneficiarioId, ids),
          eq(creditoSolidaleMovimentiTable.tipoMovimento, "ricarica_mensile"),
          eq(creditoSolidaleMovimentiTable.periodoRiferimento, periodoRiferimento),
          eq(creditoSolidaleMovimentiTable.annullato, false),
        ));
  const giaRicaricati = new Set(giaRicaricatiRows.map((row) => row.beneficiarioId));

  const righe = rows.map((row) => {
    const b = row.beneficiario;
    const quota = b.creditoSolidaleMensileAssegnato == null ? null : Number(b.creditoSolidaleMensileAssegnato);
    const saldoAttuale = Number(b.creditoSolidaleSaldo ?? "0");
    const giaRicaricato = giaRicaricati.has(b.id);
    const quotaValida = quota != null && quota > 0;
    const ricaricabile = quotaValida && !giaRicaricato;
    return {
      beneficiarioId: b.id,
      beneficiarioNome: `${b.cognome} ${b.nome}`,
      centroAscoltoId: b.centroAscoltoId ?? null,
      centroAscoltoNome: row.centroAscoltoNome ?? null,
      cittaId: b.cittaId ?? null,
      cittaNome: row.cittaNome ?? null,
      creditoSolidaleMensileAssegnato: quota,
      saldoAttuale,
      ricaricabile,
      giaRicaricato,
      motivoEsclusione: giaRicaricato ? MONTHLY_ALREADY_DONE_MSG : quotaValida ? null : NO_QUOTA_MSG,
      saldoPrevistoDopoRicarica: ricaricabile ? round2(saldoAttuale + quota) : null,
    };
  });

  const totaleRicaricabili = righe.filter((r) => r.ricaricabile).length;
  const totaleGiaRicaricati = righe.filter((r) => r.giaRicaricato).length;
  const totaleCreditoDaRicaricare = round2(righe.reduce((sum, r) => sum + (r.ricaricabile ? r.creditoSolidaleMensileAssegnato ?? 0 : 0), 0));
  return {
    periodoRiferimento,
    totaleBeneficiari: righe.length,
    totaleRicaricabili,
    totaleGiaRicaricati,
    totaleEsclusi: righe.length - totaleRicaricabili - totaleGiaRicaricati,
    totaleCreditoDaRicaricare,
    righe,
  };
}

router.get("/credito-solidale/calcola-beneficiario/:beneficiarioId", async (req, res) => {
  const beneficiarioId = Number(req.params.beneficiarioId);
  if (!Number.isInteger(beneficiarioId)) {
    res.status(404).json({ error: BENEFICIARIO_NOT_FOUND_MSG });
    return;
  }

  const [beneficiario] = await db
    .select()
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  if (!beneficiario) {
    res.status(404).json({ error: BENEFICIARIO_NOT_FOUND_MSG });
    return;
  }

  if (!canAccessBeneficiario(beneficiario, req)) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo profilo" });
    return;
  }

  const { politica, origine } = await findPolicyByBeneficiario(beneficiario);
  const dettaglio = calculate(beneficiario, politica);
  res.json({
    beneficiarioId: beneficiario.id,
    politicaId: politica.id,
    politicaNome: politica.nome,
    politicaOrigine: origine,
    giornoRicaricaMensile: politica.giornoRicaricaMensile,
    ricaricaAutomaticaAbilitata: politica.ricaricaAutomaticaAbilitata,
    totaleSuggerito: dettaglio.totaleSuggerito,
    dettaglio,
  });
});

router.get("/credito-solidale/movimenti", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const conditions: SQL[] = [];
  const callerCentro = callerCentroId(req);
  const callerCitta = callerCittaId(req);
  if (q.beneficiarioId) conditions.push(eq(creditoSolidaleMovimentiTable.beneficiarioId, Number(q.beneficiarioId)));
  if (q.periodoRiferimento) conditions.push(eq(creditoSolidaleMovimentiTable.periodoRiferimento, q.periodoRiferimento));
  if (q.tipoMovimento && TIPI_MOVIMENTO.includes(q.tipoMovimento as TipoMovimento)) {
    conditions.push(eq(creditoSolidaleMovimentiTable.tipoMovimento, q.tipoMovimento));
  }
  if (q.annullato === "true") conditions.push(eq(creditoSolidaleMovimentiTable.annullato, true));
  else if (q.annullato === "false") conditions.push(eq(creditoSolidaleMovimentiTable.annullato, false));
  if (callerCentro != null) {
    const f = centroScopeFilter(creditoSolidaleMovimentiTable.centroAscoltoId, callerCentro);
    if (f) conditions.push(f);
  } else if (q.centroAscoltoId) {
    conditions.push(eq(creditoSolidaleMovimentiTable.centroAscoltoId, Number(q.centroAscoltoId)));
  }
  const cittaFilter = cittaScopeFilter(creditoSolidaleMovimentiTable.cittaId, callerCitta);
  if (cittaFilter) conditions.push(cittaFilter);
  else if (q.cittaId) {
    conditions.push(eq(creditoSolidaleMovimentiTable.cittaId, Number(q.cittaId)));
  }
  const rows = await selectMovimenti(conditions);
  res.json(rows.map(fmtMovimento));
});

router.get("/credito-solidale/beneficiari/:beneficiarioId/saldo", async (req, res) => {
  const beneficiarioId = Number(req.params.beneficiarioId);
  const [b] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, beneficiarioId));
  if (!b) {
    res.status(404).json({ error: BENEFICIARIO_NOT_FOUND_MSG });
    return;
  }
  if (!canAccessBeneficiario(b, req)) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo profilo" });
    return;
  }
  res.json({
    beneficiarioId: b.id,
    beneficiarioNome: `${b.cognome} ${b.nome}`,
    creditoSolidaleAbilitato: b.creditoSolidaleAbilitato,
    creditoSolidaleStato: b.creditoSolidaleStato,
    saldoAttuale: Number(b.creditoSolidaleSaldo ?? "0"),
    creditoSolidaleMensileAssegnato: b.creditoSolidaleMensileAssegnato == null ? null : Number(b.creditoSolidaleMensileAssegnato),
    dataUltimoMovimento: b.creditoSolidaleDataUltimoMovimento?.toISOString() ?? null,
  });
});

router.post("/credito-solidale/beneficiari/:beneficiarioId/refresh-credito", async (req, res) => {
  if (!(await isEmporioEnabled())) {
    res.status(403).json({ error: EMPORIO_DISABLED_MSG });
    return;
  }
  const beneficiarioId = Number(req.params.beneficiarioId);
  const access = await requireAccessibleBeneficiario(beneficiarioId, req);
  if ("error" in access) {
    res.status(access.status ?? 400).json({ error: access.error });
    return;
  }
  const b = access.beneficiario;
  if (!b.attivo) {
    res.status(400).json({ error: NOT_ACTIVE_MSG });
    return;
  }
  if (!b.creditoSolidaleAbilitato) {
    res.status(400).json({ error: NOT_ENABLED_MSG });
    return;
  }
  if (b.creditoSolidaleStato !== "attivo") {
    res.status(400).json({ error: NOT_ACTIVE_MSG });
    return;
  }

  const periodoRiferimento = parsePeriodo(req.body?.periodoRiferimento) ?? currentPeriodo();
  const quota = b.creditoSolidaleMensileAssegnato == null ? null : Number(b.creditoSolidaleMensileAssegnato);
  if (quota == null || quota <= 0) {
    res.status(400).json({ error: NO_QUOTA_MSG });
    return;
  }

  if (await monthlyRechargeExists(b.id, periodoRiferimento)) {
    const saldo = await getSaldoBeneficiarioResponse(b.id);
    res.json({
      periodoRiferimento,
      ricaricaEseguita: false,
      movimento: null,
      saldo,
      messaggio: MONTHLY_ALREADY_DONE_MSG,
    });
    return;
  }

  const created = await creaMovimentoCreditoSolidale({
    beneficiarioId: b.id,
    tipoMovimento: "ricarica_mensile",
    variazioneCredito: quota,
    periodoRiferimento,
    quotaMensileAssegnata: quota,
    origine: "refresh_cassa",
    motivo: "Refresh Credito Solidale da Cassa Emporio",
    note: nullableText(req.body?.note),
    operatoreId: req.user?.id ?? null,
  });
  if ("error" in created) {
    res.status(created.status ?? 400).json({ error: created.error });
    return;
  }

  const rows = await selectMovimenti([eq(creditoSolidaleMovimentiTable.id, created.movimento.id)], 1);
  const saldo = await getSaldoBeneficiarioResponse(b.id);
  res.status(201).json({
    periodoRiferimento,
    ricaricaEseguita: true,
    movimento: fmtMovimento(rows[0]),
    saldo,
    messaggio: "Credito Solidale aggiornato.",
  });
});

router.get("/credito-solidale/beneficiari/:beneficiarioId/movimenti", async (req, res) => {
  const beneficiarioId = Number(req.params.beneficiarioId);
  const [b] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, beneficiarioId));
  if (!b) {
    res.status(404).json({ error: BENEFICIARIO_NOT_FOUND_MSG });
    return;
  }
  if (!canAccessBeneficiario(b, req)) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo profilo" });
    return;
  }
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const rows = await selectMovimenti([eq(creditoSolidaleMovimentiTable.beneficiarioId, beneficiarioId)], Number.isInteger(limit) ? limit : undefined);
  res.json(rows.map(fmtMovimento));
});

router.post("/credito-solidale/beneficiari/:beneficiarioId/ricarica-manuale", async (req, res) => {
  const beneficiarioId = Number(req.params.beneficiarioId);
  const access = await requireAccessibleBeneficiario(beneficiarioId, req);
  if ("error" in access) {
    res.status(access.status ?? 400).json({ error: access.error });
    return;
  }
  const variazioneCredito = parseDecimal(req.body?.variazioneCredito);
  if (variazioneCredito == null || variazioneCredito <= 0) {
    res.status(400).json({ error: "Il valore della ricarica deve essere maggiore di zero." });
    return;
  }
  const result = await creaMovimentoCreditoSolidale({
    beneficiarioId,
    tipoMovimento: "ricarica_manuale",
    variazioneCredito,
    motivo: nullableText(req.body?.motivo),
    note: nullableText(req.body?.note),
    origine: "manuale",
    operatoreId: req.user?.id ?? null,
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  const rows = await selectMovimenti([eq(creditoSolidaleMovimentiTable.id, result.movimento.id)], 1);
  res.status(201).json(fmtMovimento(rows[0]));
});

router.post("/credito-solidale/beneficiari/:beneficiarioId/rettifica", async (req, res) => {
  const beneficiarioId = Number(req.params.beneficiarioId);
  const access = await requireAccessibleBeneficiario(beneficiarioId, req);
  if ("error" in access) {
    res.status(access.status ?? 400).json({ error: access.error });
    return;
  }
  const variazioneCredito = parseDecimal(req.body?.variazioneCredito);
  if (variazioneCredito == null || variazioneCredito === 0) {
    res.status(400).json({ error: "La variazione Credito Solidale non può essere zero." });
    return;
  }
  const motivo = nullableText(req.body?.motivo);
  if (!motivo) {
    res.status(400).json({ error: "Il motivo della rettifica è obbligatorio." });
    return;
  }
  const result = await creaMovimentoCreditoSolidale({
    beneficiarioId,
    tipoMovimento: variazioneCredito > 0 ? "rettifica_positiva" : "rettifica_negativa",
    variazioneCredito,
    motivo,
    note: nullableText(req.body?.note),
    origine: "manuale",
    operatoreId: req.user?.id ?? null,
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  const rows = await selectMovimenti([eq(creditoSolidaleMovimentiTable.id, result.movimento.id)], 1);
  res.status(201).json(fmtMovimento(rows[0]));
});

router.post("/credito-solidale/movimenti/:id/storno", async (req, res) => {
  if (!(await isEmporioEnabled())) {
    res.status(403).json({ error: EMPORIO_DISABLED_MSG });
    return;
  }
  const id = Number(req.params.id);
  const motivo = nullableText(req.body?.motivo);
  if (!motivo) {
    res.status(400).json({ error: "Il motivo dello storno è obbligatorio." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [originale] = await tx
      .select()
      .from(creditoSolidaleMovimentiTable)
      .where(eq(creditoSolidaleMovimentiTable.id, id))
      .limit(1);
    if (!originale) return { error: MOVIMENTO_NOT_FOUND_MSG, status: 404 } as const;
    if (originale.annullato) return { error: "Il movimento è già stato stornato.", status: 400 } as const;
    const [beneficiario] = await tx
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, originale.beneficiarioId))
      .limit(1);
    if (!beneficiario) return { error: BENEFICIARIO_NOT_FOUND_MSG, status: 404 } as const;
    if (!canAccessBeneficiario(beneficiario, req)) return { error: ACCESS_DENIED_MSG, status: 403 } as const;
    const created = await creaMovimentoCreditoSolidaleTx(tx, {
      beneficiarioId: originale.beneficiarioId,
      tipoMovimento: "storno",
      variazioneCredito: -Number(originale.variazioneCredito),
      periodoRiferimento: originale.periodoRiferimento ?? null,
      quotaMensileAssegnata: originale.quotaMensileAssegnata == null ? null : Number(originale.quotaMensileAssegnata),
      origine: "storno",
      riferimentoId: originale.id,
      riferimentoTipo: originale.tipoMovimento,
      motivo,
      note: nullableText(req.body?.note),
      operatoreId: req.user?.id ?? null,
    });
    if ("error" in created) {
      return {
        error: created.error === NEGATIVE_BALANCE_MSG ? "Lo storno renderebbe il saldo negativo." : created.error,
        status: created.status,
      } as const;
    }
    await tx
      .update(creditoSolidaleMovimentiTable)
      .set({ annullato: true, annullatoDaMovimentoId: created.movimento.id })
      .where(eq(creditoSolidaleMovimentiTable.id, originale.id));
    return created;
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  const rows = await selectMovimenti([eq(creditoSolidaleMovimentiTable.id, result.movimento.id)], 1);
  res.status(201).json(fmtMovimento(rows[0]));
});

router.post("/credito-solidale/ricariche-mensili/preview", async (req, res) => {
  const preview = await buildMonthlyPreview(req, req.body ?? {});
  if ("error" in preview) {
    res.status(preview.status ?? 400).json({ error: preview.error });
    return;
  }
  res.json(preview);
});

router.post("/credito-solidale/ricariche-mensili/esegui", async (req, res) => {
  if (!(await isEmporioEnabled())) {
    res.status(403).json({ error: EMPORIO_DISABLED_MSG });
    return;
  }
  const preview = await buildMonthlyPreview(req, req.body ?? {});
  if ("error" in preview) {
    res.status(preview.status ?? 400).json({ error: preview.error });
    return;
  }

  const movimentiCreatiIds: number[] = [];
  let saltatiGiaRicaricati = preview.totaleGiaRicaricati;
  const note = nullableText(req.body?.note);
  await db.transaction(async (tx) => {
    for (const riga of preview.righe.filter((r) => r.ricaricabile)) {
      const exists = await monthlyRechargeExists(riga.beneficiarioId, preview.periodoRiferimento, tx);
      if (exists) {
        saltatiGiaRicaricati += 1;
        continue;
      }
      const created = await creaMovimentoCreditoSolidaleTx(tx, {
        beneficiarioId: riga.beneficiarioId,
        tipoMovimento: "ricarica_mensile",
        variazioneCredito: riga.creditoSolidaleMensileAssegnato ?? 0,
        periodoRiferimento: preview.periodoRiferimento,
        quotaMensileAssegnata: riga.creditoSolidaleMensileAssegnato ?? null,
        origine: "ricarica_mensile",
        note,
        operatoreId: req.user?.id ?? null,
      });
      if ("error" in created) throw new Error(created.error);
      movimentiCreatiIds.push(created.movimento.id);
    }
  });

  const movimenti = movimentiCreatiIds.length === 0
    ? []
    : await selectMovimenti([inArray(creditoSolidaleMovimentiTable.id, movimentiCreatiIds)]);
  const movimentiCreati = movimenti.map(fmtMovimento);
  res.json({
    periodoRiferimento: preview.periodoRiferimento,
    creati: movimentiCreati.length,
    saltatiGiaRicaricati,
    saltatiNonRicaricabili: preview.righe.filter((r) => !r.ricaricabile && !r.giaRicaricato).length,
    totaleCreditoRicaricato: round2(movimentiCreati.reduce((sum, m) => sum + Math.max(0, m.variazioneCredito), 0)),
    movimentiCreati,
  });
});

export default router;
