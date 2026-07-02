import { Router, type IRouter, type Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  centriAscoltoTable,
  cittaTable,
  db,
  politicheCreditoSolidaleTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import {
  andScoped,
  callerCentroId,
  callerCittaId,
  canAccessCentro,
  canAccessCitta,
  centroScopeFilter,
  cittaScopeFilter,
} from "../lib/centroScope";

const router: IRouter = Router();

const ARROTONDAMENTI = ["nessuno", "intero_superiore", "intero_inferiore", "intero_piu_vicino"] as const;
type Arrotondamento = (typeof ARROTONDAMENTI)[number];
type PolicyInsert = typeof politicheCreditoSolidaleTable.$inferInsert;
type PolicySelect = typeof politicheCreditoSolidaleTable.$inferSelect;

const DECIMAL_DEFAULTS = {
  creditoBaseNucleo: "50.00",
  creditoPerComponente: "10.00",
  bonusMinore: "5.00",
  bonusAnziano: "5.00",
  bonusDisabile: "10.00",
  creditoMinimoMensile: "0.00",
} satisfies Partial<Record<keyof PolicyInsert, string>>;

const DECIMAL_KEYS = [
  "creditoBaseNucleo",
  "creditoPerComponente",
  "bonusMinore",
  "bonusAnziano",
  "bonusDisabile",
  "creditoMinimoMensile",
] as const;

const NOT_FOUND_MSG = "Politica Credito Solidale non trovata.";
const DAY_MSG = "Il giorno di ricarica mensile deve essere compreso tra 1 e 28.";
const MAX_MSG = "Il credito massimo mensile deve essere maggiore o uguale al minimo.";
const ROUNDING_MSG = "Tipo di arrotondamento non valido.";

const toNumber = (v: string | number | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const decimalString = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
};

const nullableText = (v: unknown): string | null =>
  typeof v === "string" ? v.trim() || null : v == null ? null : String(v);

const optionalText = (v: unknown, partial: boolean): string | null | undefined => {
  if (v === undefined && partial) return undefined;
  return nullableText(v);
};

const optionalId = (v: unknown, partial: boolean): number | null | undefined => {
  if (v === undefined && partial) return undefined;
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const optionalBool = (v: unknown, partial: boolean, fallback: boolean): boolean | undefined => {
  if (v === undefined && partial) return undefined;
  if (v === undefined) return fallback;
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && (v === 0 || v === 1)) return Boolean(v);
  if (typeof v === "string") {
    const normalized = v.trim().toLowerCase();
    if (["true", "1", "si", "sì", "yes", "vero"].includes(normalized)) return true;
    if (["false", "0", "no", "falso"].includes(normalized)) return false;
  }
  return fallback;
};

function fmt(row: { politica: PolicySelect; centroAscoltoNome: string | null; cittaNome: string | null }) {
  const r = row.politica;
  return {
    id: r.id,
    nome: r.nome,
    descrizione: r.descrizione ?? null,
    centroAscoltoId: r.centroAscoltoId ?? null,
    centroAscoltoNome: row.centroAscoltoNome ?? null,
    cittaId: r.cittaId ?? null,
    cittaNome: row.cittaNome ?? null,
    attiva: r.attiva,
    creditoBaseNucleo: Number(r.creditoBaseNucleo),
    creditoPerComponente: Number(r.creditoPerComponente),
    bonusMinore: Number(r.bonusMinore),
    bonusAnziano: Number(r.bonusAnziano),
    bonusDisabile: Number(r.bonusDisabile),
    creditoMinimoMensile: Number(r.creditoMinimoMensile),
    creditoMassimoMensile: r.creditoMassimoMensile == null ? null : Number(r.creditoMassimoMensile),
    giornoRicaricaMensile: r.giornoRicaricaMensile,
    ricaricaAutomaticaAbilitata: r.ricaricaAutomaticaAbilitata,
    arrotondamento: r.arrotondamento,
    note: r.note ?? null,
    dataCreazione: r.dataCreazione.toISOString(),
    dataAggiornamento: r.dataAggiornamento?.toISOString() ?? null,
  };
}

function parseBody(body: Record<string, unknown>, partial: boolean): { values?: Partial<PolicyInsert>; error?: string } {
  const values: Partial<PolicyInsert> = {};

  if (!partial || body.nome !== undefined) {
    const nome = typeof body.nome === "string" ? body.nome.trim() : "";
    if (!nome) return { error: "Nome politica obbligatorio." };
    values.nome = nome;
  }

  const descrizione = optionalText(body.descrizione, partial);
  if (descrizione !== undefined) values.descrizione = descrizione;

  const centroAscoltoId = optionalId(body.centroAscoltoId, partial);
  if (centroAscoltoId !== undefined) values.centroAscoltoId = centroAscoltoId;

  const cittaId = optionalId(body.cittaId, partial);
  if (cittaId !== undefined) values.cittaId = cittaId;

  const attiva = optionalBool(body.attiva, partial, true);
  if (attiva !== undefined) values.attiva = attiva;

  for (const key of DECIMAL_KEYS) {
    if (body[key] === undefined && partial) continue;
    const parsed = decimalString(body[key] ?? DECIMAL_DEFAULTS[key]);
    if (parsed == null) return { error: "I valori della politica Credito Solidale devono essere maggiori o uguali a 0." };
    values[key] = parsed;
  }

  if (!partial || body.creditoMassimoMensile !== undefined) {
    const max = decimalString(body.creditoMassimoMensile);
    if (body.creditoMassimoMensile != null && body.creditoMassimoMensile !== "" && max == null) {
      return { error: "I valori della politica Credito Solidale devono essere maggiori o uguali a 0." };
    }
    values.creditoMassimoMensile = max;
  }

  if (!partial || body.giornoRicaricaMensile !== undefined) {
    const giorno = body.giornoRicaricaMensile == null || body.giornoRicaricaMensile === "" ? 1 : Number(body.giornoRicaricaMensile);
    if (!Number.isInteger(giorno) || giorno < 1 || giorno > 28) return { error: DAY_MSG };
    values.giornoRicaricaMensile = giorno;
  }

  const ricaricaAutomaticaAbilitata = optionalBool(body.ricaricaAutomaticaAbilitata, partial, false);
  if (ricaricaAutomaticaAbilitata !== undefined) values.ricaricaAutomaticaAbilitata = ricaricaAutomaticaAbilitata;

  if (!partial || body.arrotondamento !== undefined) {
    const arrotondamento = body.arrotondamento == null || body.arrotondamento === "" ? "nessuno" : String(body.arrotondamento);
    if (!ARROTONDAMENTI.includes(arrotondamento as Arrotondamento)) return { error: ROUNDING_MSG };
    values.arrotondamento = arrotondamento;
  }

  const note = optionalText(body.note, partial);
  if (note !== undefined) values.note = note;

  return { values };
}

function validateMaxMin(values: Partial<PolicyInsert>, existing?: PolicySelect): string | null {
  const min = toNumber(values.creditoMinimoMensile ?? existing?.creditoMinimoMensile ?? DECIMAL_DEFAULTS.creditoMinimoMensile);
  const max = values.creditoMassimoMensile === undefined
    ? toNumber(existing?.creditoMassimoMensile)
    : toNumber(values.creditoMassimoMensile);
  if (min == null) return "I valori della politica Credito Solidale devono essere maggiori o uguali a 0.";
  if (max != null && max < min) return MAX_MSG;
  return null;
}

async function validateScope(
  values: Partial<PolicyInsert>,
  req: Request,
): Promise<{ status: number; error: string } | null> {
  if (values.cittaId != null) {
    const [citta] = await db.select({ id: cittaTable.id }).from(cittaTable).where(eq(cittaTable.id, values.cittaId));
    if (!citta) return { status: 404, error: "Città non trovata." };
    if (!canAccessCitta(citta.id, callerCittaId(req))) {
      return { status: 403, error: "Risorsa non accessibile per la tua città" };
    }
  }

  if (values.centroAscoltoId != null) {
    const [centro] = await db
      .select({ id: centriAscoltoTable.id, cittaId: centriAscoltoTable.cittaId })
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, values.centroAscoltoId));
    if (!centro) return { status: 404, error: "Centro di Ascolto non trovato." };
    if (!canAccessCentro(centro.id, callerCentroId(req)) || !canAccessCitta(centro.cittaId, callerCittaId(req))) {
      return { status: 403, error: "Risorsa non accessibile per il tuo profilo" };
    }
    if (values.cittaId != null && centro.cittaId != null && centro.cittaId !== values.cittaId) {
      return { status: 400, error: "Il Centro di Ascolto selezionato non appartiene alla città indicata." };
    }
  }

  return null;
}

async function findPolicy(id: number, req: Request) {
  const [row] = await db
    .select({
      politica: politicheCreditoSolidaleTable,
      centroAscoltoNome: centriAscoltoTable.nome,
      cittaNome: cittaTable.nome,
    })
    .from(politicheCreditoSolidaleTable)
    .leftJoin(centriAscoltoTable, eq(politicheCreditoSolidaleTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(cittaTable, eq(politicheCreditoSolidaleTable.cittaId, cittaTable.id))
    .where(andScoped(
      eq(politicheCreditoSolidaleTable.id, id),
      centroScopeFilter(politicheCreditoSolidaleTable.centroAscoltoId, callerCentroId(req)),
      cittaScopeFilter(politicheCreditoSolidaleTable.cittaId, callerCittaId(req)),
    ));
  return row ?? null;
}

router.get("/politiche-credito-solidale", async (req, res) => {
  const rows = await db
    .select({
      politica: politicheCreditoSolidaleTable,
      centroAscoltoNome: centriAscoltoTable.nome,
      cittaNome: cittaTable.nome,
    })
    .from(politicheCreditoSolidaleTable)
    .leftJoin(centriAscoltoTable, eq(politicheCreditoSolidaleTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(cittaTable, eq(politicheCreditoSolidaleTable.cittaId, cittaTable.id))
    .where(andScoped(
      centroScopeFilter(politicheCreditoSolidaleTable.centroAscoltoId, callerCentroId(req)),
      cittaScopeFilter(politicheCreditoSolidaleTable.cittaId, callerCittaId(req)),
    ))
    .orderBy(desc(politicheCreditoSolidaleTable.attiva), desc(politicheCreditoSolidaleTable.id));
  res.json(rows.map(fmt));
});

router.get("/politiche-credito-solidale/:id", async (req, res) => {
  const id = Number(req.params.id);
  const row = Number.isInteger(id) ? await findPolicy(id, req) : null;
  if (!row) {
    res.status(404).json({ error: NOT_FOUND_MSG });
    return;
  }
  res.json(fmt(row));
});

router.post("/politiche-credito-solidale", requireAdmin, async (req, res) => {
  const parsed = parseBody(req.body ?? {}, false);
  if (!parsed.values) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const maxError = validateMaxMin(parsed.values);
  if (maxError) {
    res.status(400).json({ error: maxError });
    return;
  }
  const scopeError = await validateScope(parsed.values, req);
  if (scopeError) {
    res.status(scopeError.status).json({ error: scopeError.error });
    return;
  }

  const [created] = await db.insert(politicheCreditoSolidaleTable).values(parsed.values as PolicyInsert).returning();
  const row = await findPolicy(created.id, req);
  res.status(201).json(fmt(row!));
});

router.patch("/politiche-credito-solidale/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = Number.isInteger(id) ? await findPolicy(id, req) : null;
  if (!existing) {
    res.status(404).json({ error: NOT_FOUND_MSG });
    return;
  }

  const parsed = parseBody(req.body ?? {}, true);
  if (!parsed.values) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const effective = { ...existing.politica, ...parsed.values };
  const maxError = validateMaxMin(effective, existing.politica);
  if (maxError) {
    res.status(400).json({ error: maxError });
    return;
  }
  const scopeError = await validateScope(effective, req);
  if (scopeError) {
    res.status(scopeError.status).json({ error: scopeError.error });
    return;
  }

  const [updated] = await db
    .update(politicheCreditoSolidaleTable)
    .set({ ...parsed.values, dataAggiornamento: new Date() })
    .where(eq(politicheCreditoSolidaleTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: NOT_FOUND_MSG });
    return;
  }
  const row = await findPolicy(updated.id, req);
  res.json(fmt(row!));
});

router.delete("/politiche-credito-solidale/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = Number.isInteger(id) ? await findPolicy(id, req) : null;
  if (!existing) {
    res.status(404).json({ error: NOT_FOUND_MSG });
    return;
  }
  await db
    .update(politicheCreditoSolidaleTable)
    .set({ attiva: false, dataAggiornamento: new Date() })
    .where(eq(politicheCreditoSolidaleTable.id, id));
  res.status(204).send();
});

export default router;
