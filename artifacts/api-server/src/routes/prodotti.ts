import { randomInt } from "node:crypto";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { prodottiTable } from "@workspace/db";
import { runBulk } from "../lib/bulk";
import { eq, ilike, and, ne, or, desc, type SQL } from "drizzle-orm";
import { EMPORIO_DISABLED_MSG, isEmporioEnabled } from "../lib/impostazioniModuli";

const router: IRouter = Router();

const CODICE_DUPLICATO_MSG = "Il codice prodotto indicato è già associato a un altro prodotto.";
const BARCODE_DUPLICATO_MSG = "Il codice a barre indicato è già associato a un altro prodotto.";
const BARCODE_NON_VALIDO_MSG = "Il codice a barre deve essere un EAN-13 numerico valido.";

function parseNonNegativeDecimal(value: unknown, label: string): { value: string } | { error: string } {
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: `${label} non valido.` };
  if (n < 0) return { error: `${label} non può essere negativo.` };
  return { value: String(n) };
}

function parseOptionalNonNegativeDecimal(value: unknown, label: string): { value: string | null } | { error: string } {
  if (value == null || value === "") return { value: null };
  return parseNonNegativeDecimal(value, label);
}

function parseOptionalBoolean(value: unknown, fallback: boolean): boolean | null {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return Boolean(value);
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["si", "sì", "true", "1", "yes", "y", "vero"].includes(normalized)) return true;
    if (["no", "false", "0", "n", "falso"].includes(normalized)) return false;
  }
  return null;
}

const fmtProdotto = (r: typeof prodottiTable.$inferSelect) => ({
  id: r.id,
  codice: r.codice,
  nome: r.nome,
  descrizione: r.descrizione ?? null,
  tipoProdotto: r.tipoProdotto,
  unitaMisura: r.unitaMisura,
  codiceBarre: r.codiceBarre ?? null,
  gestioneLotto: r.gestioneLotto,
  gestioneScadenza: r.gestioneScadenza,
  fsePlus: r.fsePlus,
  scortaMinima: parseFloat(r.scortaMinima ?? "0"),
  scortaConsigliata: parseFloat(r.scortaConsigliata ?? "0"),
  abilitatoEmporio: r.abilitatoEmporio ?? false,
  creditoSolidaleValore: parseFloat(r.creditoSolidaleValore ?? "0"),
  quantitaMassimaPerSpesa: r.quantitaMassimaPerSpesa == null ? null : parseFloat(r.quantitaMassimaPerSpesa),
  quantitaMassimaMensile: r.quantitaMassimaMensile == null ? null : parseFloat(r.quantitaMassimaMensile),
  conservazione: r.conservazione ?? null,
  taglia: r.taglia ?? null,
  genere: r.genere ?? null,
  stagione: r.stagione ?? null,
  condizione: r.condizione ?? null,
  attivo: r.attivo,
  note: r.note ?? null,
  fornitoreId: r.fornitoreId ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

const trimOrUndefined = (v: unknown): string | undefined =>
  typeof v === "string" ? v.trim() || undefined : undefined;

function prefissoProdotto(tipo: unknown): string {
  const normalized = typeof tipo === "string" ? tipo.trim().toLowerCase() : "";
  const map: Record<string, string> = {
    alimenti: "ALI",
    alimentare: "ALI",
    vestiti: "VES",
    vestiario: "VES",
    medicinali: "MED",
    scarpe: "SCA",
    igiene: "IGI",
    sanitario: "SAN",
    altro: "ALT",
  };
  return map[normalized] ?? "ALT";
}

async function codiceProdottoEsiste(codice: string, excludeId?: number): Promise<boolean> {
  const where = excludeId != null
    ? and(eq(prodottiTable.codice, codice), ne(prodottiTable.id, excludeId))
    : eq(prodottiTable.codice, codice);
  const [hit] = await db.select({ id: prodottiTable.id }).from(prodottiTable).where(where).limit(1);
  return hit != null;
}

async function barcodeProdottoEsiste(codiceBarre: string, excludeId?: number): Promise<boolean> {
  const where = excludeId != null
    ? and(eq(prodottiTable.codiceBarre, codiceBarre), ne(prodottiTable.id, excludeId))
    : eq(prodottiTable.codiceBarre, codiceBarre);
  const [hit] = await db.select({ id: prodottiTable.id }).from(prodottiTable).where(where).limit(1);
  return hit != null;
}

async function generaCodiceProdotto(tipoProdotto: unknown): Promise<string> {
  const prefisso = prefissoProdotto(tipoProdotto);
  const rows = await db
    .select({ codice: prodottiTable.codice })
    .from(prodottiTable)
    .where(ilike(prodottiTable.codice, `${prefisso}-%`));
  let max = 0;
  for (const row of rows) {
    const match = new RegExp(`^${prefisso}-(\\d{6})$`).exec(row.codice);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  for (let next = max + 1; next <= 999999 && next < max + 1000; next++) {
    const codice = `${prefisso}-${String(next).padStart(6, "0")}`;
    if (!(await codiceProdottoEsiste(codice))) return codice;
  }
  throw new Error("Impossibile generare un codice prodotto univoco");
}

function ean13CheckDigit(first12: string): string {
  const sum = first12
    .split("")
    .reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

function isEan13Valido(codice: string): boolean {
  return /^\d{13}$/.test(codice) && ean13CheckDigit(codice.slice(0, 12)) === codice[12];
}

async function generaCodiceBarreEan13(): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const first12 = `200${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
    const candidate = `${first12}${ean13CheckDigit(first12)}`;
    if (!(await barcodeProdottoEsiste(candidate))) return candidate;
  }
  throw new Error("Impossibile generare un codice a barre univoco");
}

function isUniqueViolation(error: unknown, field: "codice" | "codiceBarre"): boolean {
  const e = error as { code?: string; constraint?: string; detail?: string } | null | undefined;
  if (e?.code !== "23505") return false;
  if (field === "codice") return e.constraint === "prodotti_codice_unique" || (e.detail?.includes("codice") ?? false);
  return e.constraint === "prodotti_codice_barre_unique" || (e.detail?.includes("codice_barre") ?? false);
}

router.get("/prodotti", async (req, res) => {
  const { tipo, search } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (tipo) conditions.push(eq(prodottiTable.tipoProdotto, tipo));
  if (search) {
    const q = `%${search}%`;
    const searchFilter = or(
      ilike(prodottiTable.nome, q),
      ilike(prodottiTable.codice, q),
      ilike(prodottiTable.codiceBarre, q),
    );
    if (searchFilter) conditions.push(searchFilter);
  }
  const rows = await db.select().from(prodottiTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(prodottiTable.dataCreazione), desc(prodottiTable.id));
  res.json(rows.map(fmtProdotto));
});

async function createProdottoOne(
  body: Record<string, unknown>,
): Promise<{ row: typeof prodottiTable.$inferSelect } | { error: string; status?: number }> {
  const b = body as Record<string, any>;
  const codice = trimOrUndefined(b.codice) ?? await generaCodiceProdotto(b.tipoProdotto);
  const codiceBarre = trimOrUndefined(b.codiceBarre) ?? await generaCodiceBarreEan13();
  if (await codiceProdottoEsiste(codice)) return { error: CODICE_DUPLICATO_MSG, status: 409 };
  if (!isEan13Valido(codiceBarre)) return { error: BARCODE_NON_VALIDO_MSG, status: 400 };
  if (await barcodeProdottoEsiste(codiceBarre)) return { error: BARCODE_DUPLICATO_MSG, status: 409 };
  const abilitatoEmporio = parseOptionalBoolean(b.abilitatoEmporio, false);
  if (abilitatoEmporio == null) return { error: "Abilitato Emporio non valido.", status: 400 };
  if (abilitatoEmporio && !(await isEmporioEnabled())) {
    return { error: EMPORIO_DISABLED_MSG, status: 403 };
  }
  const creditoSolidaleDefault = abilitatoEmporio ? 1 : 0;
  const creditoSolidaleValore = parseNonNegativeDecimal(b.creditoSolidaleValore ?? creditoSolidaleDefault, "Valore Credito Solidale");
  if ("error" in creditoSolidaleValore) return { error: creditoSolidaleValore.error, status: 400 };
  const quantitaMassimaPerSpesa = parseOptionalNonNegativeDecimal(b.quantitaMassimaPerSpesa, "Quantità massima per singola spesa");
  if ("error" in quantitaMassimaPerSpesa) return { error: quantitaMassimaPerSpesa.error, status: 400 };
  const quantitaMassimaMensile = parseOptionalNonNegativeDecimal(b.quantitaMassimaMensile, "Quantità massima mensile");
  if ("error" in quantitaMassimaMensile) return { error: quantitaMassimaMensile.error, status: 400 };
  try {
    const [row] = await db.insert(prodottiTable).values({
      codice,
      nome: b.nome,
      descrizione: b.descrizione,
      tipoProdotto: b.tipoProdotto,
      unitaMisura: b.unitaMisura,
      codiceBarre,
      gestioneLotto: b.gestioneLotto ?? false,
      gestioneScadenza: b.gestioneScadenza ?? false,
      fsePlus: b.fsePlus ?? false,
      scortaMinima: b.scortaMinima?.toString() ?? "0",
      scortaConsigliata: b.scortaConsigliata?.toString() ?? "0",
      abilitatoEmporio,
      creditoSolidaleValore: creditoSolidaleValore.value,
      quantitaMassimaPerSpesa: quantitaMassimaPerSpesa.value,
      quantitaMassimaMensile: quantitaMassimaMensile.value,
      conservazione: b.conservazione,
      taglia: b.taglia,
      genere: b.genere,
      stagione: b.stagione,
      condizione: b.condizione,
      attivo: b.attivo ?? true,
      note: b.note,
      fornitoreId: b.fornitoreId,
    }).returning();
    return { row };
  } catch (e) {
    if (isUniqueViolation(e, "codice")) return { error: CODICE_DUPLICATO_MSG, status: 409 };
    if (isUniqueViolation(e, "codiceBarre")) return { error: BARCODE_DUPLICATO_MSG, status: 409 };
    throw e;
  }
}

router.post("/prodotti", async (req, res) => {
  const r = await createProdottoOne(req.body);
  if ("error" in r) { res.status(r.status ?? 400).json({ error: r.error }); return; }
  res.status(201).json(fmtProdotto(r.row));
});

router.post("/prodotti/bulk", async (req, res) => {
  const righe = (req.body?.righe ?? []) as Record<string, unknown>[];
  const result = await runBulk(righe, async (row) => {
    const r = await createProdottoOne(row);
    return "error" in r ? { error: r.error } : { ok: true };
  });
  res.json(result);
});

router.get("/prodotti/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(prodottiTable).where(eq(prodottiTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmtProdotto(row));
});

router.patch("/prodotti/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(prodottiTable).where(eq(prodottiTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body;
  const update: Record<string, unknown> = { ...body };
  if ("codice" in update) {
    const codice = trimOrUndefined(update.codice);
    if (!codice) { res.status(400).json({ error: "Codice prodotto obbligatorio" }); return; }
    if (await codiceProdottoEsiste(codice, id)) { res.status(409).json({ error: CODICE_DUPLICATO_MSG }); return; }
    update.codice = codice;
  }
  if ("codiceBarre" in update) {
    const codiceBarre = trimOrUndefined(update.codiceBarre);
    if (codiceBarre == null) {
      update.codiceBarre = null;
    } else {
      if (!isEan13Valido(codiceBarre)) { res.status(400).json({ error: BARCODE_NON_VALIDO_MSG }); return; }
      if (await barcodeProdottoEsiste(codiceBarre, id)) { res.status(409).json({ error: BARCODE_DUPLICATO_MSG }); return; }
      update.codiceBarre = codiceBarre;
    }
  }
  if (body.scortaMinima !== undefined) update.scortaMinima = body.scortaMinima.toString();
  if (body.scortaConsigliata !== undefined) update.scortaConsigliata = body.scortaConsigliata.toString();
  if ("abilitatoEmporio" in update) {
    const abilitatoEmporio = parseOptionalBoolean(update.abilitatoEmporio, false);
    if (abilitatoEmporio == null) { res.status(400).json({ error: "Abilitato Emporio non valido." }); return; }
    if (abilitatoEmporio && !existing.abilitatoEmporio && !(await isEmporioEnabled())) {
      res.status(403).json({ error: EMPORIO_DISABLED_MSG });
      return;
    }
    if (abilitatoEmporio && !existing.abilitatoEmporio && !("creditoSolidaleValore" in update) && Number(existing.creditoSolidaleValore ?? "0") <= 0) {
      update.creditoSolidaleValore = "1";
    }
    update.abilitatoEmporio = abilitatoEmporio;
  }
  if ("creditoSolidaleValore" in update) {
    const creditoSolidaleValore = parseNonNegativeDecimal(update.creditoSolidaleValore, "Valore Credito Solidale");
    if ("error" in creditoSolidaleValore) { res.status(400).json({ error: creditoSolidaleValore.error }); return; }
    update.creditoSolidaleValore = creditoSolidaleValore.value;
  }
  if ("quantitaMassimaPerSpesa" in update) {
    const quantitaMassimaPerSpesa = parseOptionalNonNegativeDecimal(update.quantitaMassimaPerSpesa, "Quantità massima per singola spesa");
    if ("error" in quantitaMassimaPerSpesa) { res.status(400).json({ error: quantitaMassimaPerSpesa.error }); return; }
    update.quantitaMassimaPerSpesa = quantitaMassimaPerSpesa.value;
  }
  if ("quantitaMassimaMensile" in update) {
    const quantitaMassimaMensile = parseOptionalNonNegativeDecimal(update.quantitaMassimaMensile, "Quantità massima mensile");
    if ("error" in quantitaMassimaMensile) { res.status(400).json({ error: quantitaMassimaMensile.error }); return; }
    update.quantitaMassimaMensile = quantitaMassimaMensile.value;
  }
  try {
    const [row] = await db.update(prodottiTable).set(update).where(eq(prodottiTable.id, id)).returning();
    res.json(fmtProdotto(row));
  } catch (e) {
    if (isUniqueViolation(e, "codice")) { res.status(409).json({ error: CODICE_DUPLICATO_MSG }); return; }
    if (isUniqueViolation(e, "codiceBarre")) { res.status(409).json({ error: BARCODE_DUPLICATO_MSG }); return; }
    throw e;
  }
});

router.delete("/prodotti/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(prodottiTable).where(eq(prodottiTable.id, id));
  res.status(204).send();
});

export default router;
