import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import {
  CARICO_PRATICA_STATI,
  FONDI_ORIGINE,
  ORIGINI_CARICO_MANUALI,
  areeOperativeTable,
  caricoIntegrazioneRigheTable,
  caricoIntegrazioniTable,
  caricoPraticaRettificheTable,
  caricoPraticaRigheTable,
  caricoPraticheTable,
  carichiMagazzinoRigheTable,
  carichiMagazzinoTable,
  db,
  fornitoriTable,
  fseImportRowRevisionsTable,
  fseImportRowsTable,
  fseImportSessionsTable,
  fseInitialBalanceCoverageTable,
  fseMovementClaimsTable,
  lottiLogiciTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  prodottiTable,
  type CaricoPratica,
  type FondoOrigine,
  type OrigineCarico,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import {
  callerAreaOperativaId,
  callerCentroId,
  canAccessMagazzino,
  magazzinoScopeFilter,
  visibleMagazzinoIds,
} from "../lib/centroScope";
import {
  auditContextFromRequest,
  auditFields,
  auditUserId,
  recordAuditEvent,
  type AuditCommandContext,
} from "../lib/auditEvent";
import {
  createWarehouseLoad,
  InventoryLedgerError,
  rettificaInventarialeConEsito,
  requireOperationalMagazzino,
  type WarehouseLoadLineInput,
} from "../lib/inventoryLedger";
import {
  InventoryDecimal,
  InventoryDecimalError,
} from "../lib/inventoryDecimal";
import { canonicalInventoryFactor } from "../lib/inventoryQuantityDimensions";
import {
  LogicalLotError,
  resolveOpenLogicalLotForWarehouse,
} from "../lib/logicalLots";
import {
  ProductOperationalQuantityError,
  validateProductOperationalQuantity,
} from "../lib/productQuantity";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import type { InventoryTransaction } from "../lib/scaricoInventory";
import { dataCivileEuropeRome } from "../lib/interventiWorkflow";
import { releaseFseClaimForPracticeRow } from "../lib/fsePracticeImportService";

const router: IRouter = Router();
router.use("/carico-pratiche", requireModulo("LOTTI"));

class CaricoPraticaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function positiveId(value: unknown, field: string): number {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new CaricoPraticaError(400, `${field} non valido`);
  return id;
}

function version(value: unknown): number {
  const result = positiveId(value, "versione");
  return result;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim())
    throw new CaricoPraticaError(400, `${field} è obbligatoria`);
  const result = value.trim();
  if (result.length > max)
    throw new CaricoPraticaError(400, `${field} supera ${max} caratteri`);
  return result;
}

function optionalText(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string")
    throw new CaricoPraticaError(400, `${field} non valido`);
  const result = value.trim();
  if (result.length > max)
    throw new CaricoPraticaError(400, `${field} supera ${max} caratteri`);
  return result || null;
}

function requiredDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !DATE_ONLY.test(value))
    throw new CaricoPraticaError(
      400,
      `${field} deve essere una data YYYY-MM-DD`,
    );
  return value;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  return requiredDate(value, field);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value != null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function semanticHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function practiceCode(): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `CM-${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function errorResponse(error: unknown, res: Response) {
  if (
    error instanceof CaricoPraticaError ||
    error instanceof InventoryLedgerError ||
    error instanceof LogicalLotError
  ) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  let current: unknown = error;
  let pg: { code?: string; constraint?: string } | undefined;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (typeof current !== "object") break;
    const candidate = current as {
      code?: string;
      constraint?: string;
      cause?: unknown;
    };
    if (candidate.code) {
      pg = candidate;
      break;
    }
    current = candidate.cause;
  }
  if (
    pg?.code === "23514" &&
    pg.constraint === "movimenti_fse_initial_balance_proposal_guard"
  ) {
    res.status(409).json({
      error: "Il Magazzino ha una proposta di saldo iniziale in corso",
      code: "SALDO_INIZIALE_IN_CORSO",
    });
    return true;
  }
  if (pg?.code === "23505") {
    res.status(409).json({
      error:
        pg.constraint === "carico_integrazione_righe_pratica_riga_unique"
          ? "Una o più righe sono già state registrate"
          : "Comando già acquisito o dati duplicati",
    });
    return true;
  }
  return false;
}

async function initialBalanceClaimedRows(
  tx: InventoryTransaction,
  coverage: {
    sourceRegistryId: number;
    sessioneId: number;
  },
) {
  return tx
    .select({
      claimId: fseMovementClaimsTable.id,
      rowId: fseImportRowRevisionsTable.rigaId,
    })
    .from(fseMovementClaimsTable)
    .innerJoin(
      fseImportRowRevisionsTable,
      eq(
        fseMovementClaimsTable.acceptedRevisionId,
        fseImportRowRevisionsTable.id,
      ),
    )
    .innerJoin(
      fseImportRowsTable,
      eq(fseImportRowRevisionsTable.rigaId, fseImportRowsTable.id),
    )
    .where(
      and(
        eq(fseMovementClaimsTable.sourceRegistryId, coverage.sourceRegistryId),
        eq(fseMovementClaimsTable.stato, "RISERVATA"),
        eq(fseImportRowsTable.sessioneId, coverage.sessioneId),
      ),
    );
}

async function validateHeader(
  tx: InventoryTransaction,
  body: Record<string, unknown>,
) {
  const areaOperativaId = positiveId(body.areaOperativaId, "areaOperativaId");
  const magazzinoId = positiveId(body.magazzinoId, "magazzinoId");
  const lottoLogicoId = positiveId(body.lottoLogicoId, "lottoLogicoId");
  const origineCarico = body.origineCarico as OrigineCarico;
  if (
    typeof origineCarico !== "string" ||
    !ORIGINI_CARICO_MANUALI.includes(
      origineCarico as (typeof ORIGINI_CARICO_MANUALI)[number],
    )
  ) {
    throw new CaricoPraticaError(
      400,
      "Provenienza non valida per un carico manuale",
    );
  }
  const dataCarico = requiredDate(body.dataCarico, "dataCarico");
  const descrizione = requiredText(body.descrizione, "descrizione", 4000);
  const fornitoreId =
    body.fornitoreId == null
      ? null
      : positiveId(body.fornitoreId, "fornitoreId");
  const numeroDocumento = optionalText(
    body.numeroDocumento,
    "numeroDocumento",
    100,
  );
  const dataDocumento = optionalDate(body.dataDocumento, "dataDocumento");
  const note = optionalText(body.note, "note", 4000);

  const magazzino = await requireOperationalMagazzino(tx, magazzinoId);
  if (magazzino.areaOperativaId !== areaOperativaId) {
    throw new CaricoPraticaError(
      400,
      "Il Magazzino non appartiene all'Area Operativa indicata",
    );
  }
  const { lotto } = await resolveOpenLogicalLotForWarehouse(tx, {
    magazzinoId,
    lottoLogicoId,
  });
  if (fornitoreId != null) {
    const [fornitore] = await tx
      .select()
      .from(fornitoriTable)
      .where(eq(fornitoriTable.id, fornitoreId));
    if (!fornitore) throw new CaricoPraticaError(404, "Fornitore non trovato");
    if (!fornitore.attivo)
      throw new CaricoPraticaError(400, "Il Fornitore non è attivo");
    if (
      fornitore.areaOperativaId != null &&
      fornitore.areaOperativaId !== areaOperativaId
    ) {
      throw new CaricoPraticaError(
        403,
        "Il Fornitore non appartiene all'Area Operativa",
      );
    }
  }
  return {
    areaOperativaId,
    magazzinoId,
    lottoLogicoId: lotto.id,
    origineCarico,
    dataCarico,
    descrizione,
    fornitoreId,
    numeroDocumento,
    dataDocumento,
    note,
    magazzino,
  };
}

async function normalizeDraftLine(
  tx: InventoryTransaction,
  input: Record<string, unknown>,
) {
  const prodottoId = positiveId(input.prodottoId, "prodottoId");
  const [prodotto] = await tx
    .select()
    .from(prodottiTable)
    .where(eq(prodottiTable.id, prodottoId));
  if (!prodotto) throw new CaricoPraticaError(404, "Prodotto non trovato");
  if (!prodotto.attivo)
    throw new CaricoPraticaError(400, "Il Prodotto non è attivo");
  const fondoOrigine = (input.fondoOrigine ?? "NESSUN_FONDO") as FondoOrigine;
  if (!FONDI_ORIGINE.includes(fondoOrigine))
    throw new CaricoPraticaError(400, "Fondo di origine non valido");
  let quantita: string | null = null;
  if (input.quantita != null && input.quantita !== "") {
    try {
      quantita = validateProductOperationalQuantity({
        quantita: input.quantita as string | number,
        quantitaFrazionabile: prodotto.quantitaFrazionabile,
        prodottoLabel: prodotto.nome,
      }).toDb();
    } catch (error) {
      if (
        error instanceof ProductOperationalQuantityError ||
        error instanceof InventoryDecimalError
      ) {
        throw new CaricoPraticaError(400, error.message);
      }
      throw error;
    }
  }
  let fattoreKgLtPezzo: string | null = null;
  if (input.fattoreKgLtPezzo != null && input.fattoreKgLtPezzo !== "") {
    try {
      fattoreKgLtPezzo = canonicalInventoryFactor(
        input.fattoreKgLtPezzo as string | number,
      );
    } catch (error) {
      if (error instanceof InventoryDecimalError)
        throw new CaricoPraticaError(400, error.message);
      throw error;
    }
  }
  return {
    prodottoId,
    fondoOrigine,
    quantita,
    codiceLottoProduttore: optionalText(
      input.codiceLottoProduttore,
      "codiceLottoProduttore",
      80,
    ),
    dataScadenza: optionalDate(input.dataScadenza, "dataScadenza"),
    fattoreKgLtPezzo,
    note: optionalText(input.note, "note riga", 4000),
    clientId: optionalText(input.clientId, "clientId", 100),
    prodotto,
  };
}

async function lockedPractice(tx: InventoryTransaction, id: number) {
  await tx.execute(
    sql`SELECT id FROM ${caricoPraticheTable} WHERE ${caricoPraticheTable.id} = ${id} FOR UPDATE`,
  );
  const [practice] = await tx
    .select()
    .from(caricoPraticheTable)
    .where(eq(caricoPraticheTable.id, id));
  if (!practice)
    throw new CaricoPraticaError(404, "Pratica di carico non trovata");
  return practice;
}

function requireVersion(practice: CaricoPratica, requested: number) {
  if (practice.versione !== requested) {
    throw new CaricoPraticaError(
      409,
      "La pratica è stata modificata da un altro operatore: ricarica e confronta le modifiche",
    );
  }
}

function requireWorkingState(practice: CaricoPratica) {
  if (
    !(["bozza", "aperta"] as const).includes(
      practice.stato as "bozza" | "aperta",
    )
  ) {
    throw new CaricoPraticaError(
      409,
      `La pratica in stato ${practice.stato} non è modificabile`,
    );
  }
}

function requireManualPracticeEdit(practice: CaricoPratica) {
  if (
    practice.tipoPratica === "SALDO_INIZIALE" ||
    practice.origineCarico === "AGEA_SIFEAD" ||
    practice.origineCarico === "SALDO_INIZIALE"
  )
    throw new CaricoPraticaError(
      409,
      "Le righe e la testata di una pratica FSE+ si correggono dalla procedura di import",
    );
}

async function detail(id: number) {
  const [header] = await db
    .select({
      pratica: caricoPraticheTable,
      areaOperativaNome: areeOperativeTable.nome,
      magazzinoNome: magazziniTable.nome,
      lottoLogicoDescrizione: lottiLogiciTable.descrizione,
      lottoLogicoCodice: lottiLogiciTable.codice,
      fornitoreNome: fornitoriTable.nome,
    })
    .from(caricoPraticheTable)
    .innerJoin(
      areeOperativeTable,
      eq(caricoPraticheTable.areaOperativaId, areeOperativeTable.id),
    )
    .innerJoin(
      magazziniTable,
      eq(caricoPraticheTable.magazzinoId, magazziniTable.id),
    )
    .innerJoin(
      lottiLogiciTable,
      eq(caricoPraticheTable.lottoLogicoId, lottiLogiciTable.id),
    )
    .leftJoin(
      fornitoriTable,
      eq(caricoPraticheTable.fornitoreId, fornitoriTable.id),
    )
    .where(eq(caricoPraticheTable.id, id));
  if (!header) return null;
  const rows = await db
    .select({
      riga: caricoPraticaRigheTable,
      prodottoNome: prodottiTable.nome,
      prodottoCodice: prodottiTable.codice,
      unitaMisura: prodottiTable.unitaMisura,
      quantitaFrazionabile: prodottiTable.quantitaFrazionabile,
      lottoFisicoObbligatorio: prodottiTable.lottoFisicoObbligatorio,
      gestioneScadenza: prodottiTable.gestioneScadenza,
      integrazioneId: caricoIntegrazioneRigheTable.caricoIntegrazioneId,
      caricoMagazzinoRigaId: caricoIntegrazioneRigheTable.caricoMagazzinoRigaId,
    })
    .from(caricoPraticaRigheTable)
    .innerJoin(
      prodottiTable,
      eq(caricoPraticaRigheTable.prodottoId, prodottiTable.id),
    )
    .leftJoin(
      caricoIntegrazioneRigheTable,
      eq(
        caricoPraticaRigheTable.id,
        caricoIntegrazioneRigheTable.caricoPraticaRigaId,
      ),
    )
    .where(eq(caricoPraticaRigheTable.caricoPraticaId, id))
    .orderBy(caricoPraticaRigheTable.id);
  const integrations = await db
    .select({
      id: caricoIntegrazioniTable.id,
      caricoMagazzinoId: caricoIntegrazioniTable.caricoMagazzinoId,
      versioneRisultante: caricoIntegrazioniTable.versioneRisultante,
      attoreId: caricoIntegrazioniTable.attoreId,
      dataRegistrazione: caricoIntegrazioniTable.dataRegistrazione,
    })
    .from(caricoIntegrazioniTable)
    .where(eq(caricoIntegrazioniTable.caricoPraticaId, id))
    .orderBy(caricoIntegrazioniTable.id);
  return {
    ...header.pratica,
    areaOperativaNome: header.areaOperativaNome,
    magazzinoNome: header.magazzinoNome,
    lottoLogicoDescrizione: header.lottoLogicoDescrizione,
    lottoLogicoCodice: header.lottoLogicoCodice,
    fornitoreNome: header.fornitoreNome,
    dataCreazione: header.pratica.dataCreazione.toISOString(),
    dataAggiornamento: header.pratica.dataAggiornamento.toISOString(),
    righe: rows.map((row) => ({
      ...row.riga,
      quantita: row.riga.quantita,
      prodottoNome: row.prodottoNome,
      prodottoCodice: row.prodottoCodice,
      unitaMisura: row.riga.unitaMisuraSnapshot ?? row.unitaMisura,
      quantitaFrazionabile:
        row.riga.quantitaFrazionabileSnapshot ?? row.quantitaFrazionabile,
      lottoFisicoObbligatorio: row.lottoFisicoObbligatorio,
      gestioneScadenza: row.gestioneScadenza,
      registrata: row.riga.registrataAt != null,
      integrazioneId: row.integrazioneId,
      caricoMagazzinoRigaId: row.caricoMagazzinoRigaId,
      registrataAt: row.riga.registrataAt?.toISOString() ?? null,
      dataCreazione: row.riga.dataCreazione.toISOString(),
      dataAggiornamento: row.riga.dataAggiornamento.toISOString(),
    })),
    integrazioni: integrations.map((item) => ({
      ...item,
      dataRegistrazione: item.dataRegistrazione.toISOString(),
    })),
  };
}

async function assertAccess(
  req: Parameters<typeof callerCentroId>[0],
  practice: Pick<CaricoPratica, "magazzinoId">,
) {
  if (
    !(await canAccessMagazzino(
      practice.magazzinoId,
      callerCentroId(req),
      callerAreaOperativaId(req),
    ))
  ) {
    throw new CaricoPraticaError(
      403,
      "Pratica non accessibile per il tuo profilo",
    );
  }
}

async function auditPractice(
  tx: InventoryTransaction,
  command: AuditCommandContext,
  practice: CaricoPratica,
  action: string,
  options: { motivo?: string | null; changes?: Record<string, unknown> } = {},
) {
  await recordAuditEvent(tx, {
    command,
    azione: action,
    entitaTipo: "carico_pratica",
    entitaId: practice.id,
    documentoTipo: "carico_pratica",
    documentoId: practice.id,
    areaOperativaIdSnapshot: practice.areaOperativaId,
    magazzinoIdSnapshot: practice.magazzinoId,
    dataOperativa: practice.dataCarico,
    motivo: options.motivo,
    changes: options.changes
      ? auditFields(options.changes, Object.keys(options.changes))
      : undefined,
  });
}

router.get(
  "/carico-pratiche",
  requirePermission("magazzino.view"),
  async (req, res) => {
    try {
      const areaOperativaId = positiveId(
        req.query.areaOperativaId,
        "areaOperativaId",
      );
      const callerArea = callerAreaOperativaId(req);
      if (callerArea != null && callerArea !== areaOperativaId)
        throw new CaricoPraticaError(403, "Area Operativa non accessibile");
      const conditions: SQL[] = [
        eq(caricoPraticheTable.areaOperativaId, areaOperativaId),
      ];
      if (req.query.magazzinoId != null) {
        conditions.push(
          eq(
            caricoPraticheTable.magazzinoId,
            positiveId(req.query.magazzinoId, "magazzinoId"),
          ),
        );
      }
      if (req.query.stato != null) {
        if (
          typeof req.query.stato !== "string" ||
          !CARICO_PRATICA_STATI.includes(
            req.query.stato as (typeof CARICO_PRATICA_STATI)[number],
          )
        )
          throw new CaricoPraticaError(400, "stato non valido");
        conditions.push(eq(caricoPraticheTable.stato, req.query.stato));
      }
      if (req.query.da)
        conditions.push(
          gte(caricoPraticheTable.dataCarico, requiredDate(req.query.da, "da")),
        );
      if (req.query.a)
        conditions.push(
          lte(caricoPraticheTable.dataCarico, requiredDate(req.query.a, "a")),
        );
      if (req.query.q) {
        const q = `%${String(req.query.q).trim()}%`;
        conditions.push(
          sql`(${caricoPraticheTable.codice} ilike ${q} or ${caricoPraticheTable.descrizione} ilike ${q})`,
        );
      }
      const scope = magazzinoScopeFilter(
        caricoPraticheTable.magazzinoId,
        await visibleMagazzinoIds(callerCentroId(req), callerArea),
      );
      if (scope) conditions.push(scope);
      const rows = await db
        .select({
          pratica: caricoPraticheTable,
          magazzinoNome: magazziniTable.nome,
          lottoLogicoDescrizione: lottiLogiciTable.descrizione,
          numeroRighe: sql<number>`count(distinct ${caricoPraticaRigheTable.id})::int`,
          numeroRigheRegistrate: sql<number>`count(distinct ${caricoPraticaRigheTable.id}) filter (where ${caricoPraticaRigheTable.registrataAt} is not null)::int`,
        })
        .from(caricoPraticheTable)
        .innerJoin(
          magazziniTable,
          eq(caricoPraticheTable.magazzinoId, magazziniTable.id),
        )
        .innerJoin(
          lottiLogiciTable,
          eq(caricoPraticheTable.lottoLogicoId, lottiLogiciTable.id),
        )
        .leftJoin(
          caricoPraticaRigheTable,
          eq(caricoPraticheTable.id, caricoPraticaRigheTable.caricoPraticaId),
        )
        .where(and(...conditions))
        .groupBy(
          caricoPraticheTable.id,
          magazziniTable.nome,
          lottiLogiciTable.descrizione,
        )
        .orderBy(
          desc(caricoPraticheTable.dataCarico),
          desc(caricoPraticheTable.id),
        );
      res.json(
        rows.map((row) => ({
          ...row.pratica,
          magazzinoNome: row.magazzinoNome,
          lottoLogicoDescrizione: row.lottoLogicoDescrizione,
          numeroRighe: row.numeroRighe,
          numeroRigheRegistrate: row.numeroRigheRegistrate,
          dataCreazione: row.pratica.dataCreazione.toISOString(),
          dataAggiornamento: row.pratica.dataAggiornamento.toISOString(),
        })),
      );
    } catch (error) {
      if (!errorResponse(error, res)) throw error;
    }
  },
);

router.post(
  "/carico-pratiche",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    try {
      const body = req.body ?? {};
      if (!Array.isArray(body.righe ?? []))
        throw new CaricoPraticaError(400, "righe non valide");
      if (
        !(await canAccessMagazzino(
          positiveId(body.magazzinoId, "magazzinoId"),
          callerCentroId(req),
          callerAreaOperativaId(req),
        ))
      )
        throw new CaricoPraticaError(403, "Magazzino non accessibile");
      const command = auditContextFromRequest(req);
      const created = await db.transaction(async (tx) => {
        const header = await validateHeader(tx, body);
        const { magazzino: _magazzino, ...headerValues } = header;
        const normalizedRows = [];
        for (const row of body.righe as Record<string, unknown>[]) {
          normalizedRows.push(await normalizeDraftLine(tx, row));
        }
        const [practice] = await tx
          .insert(caricoPraticheTable)
          .values({
            codice: practiceCode(),
            ...headerValues,
            creatoDa: req.user!.id,
            aggiornatoDa: req.user!.id,
          })
          .returning();
        for (const row of normalizedRows) {
          await tx.insert(caricoPraticaRigheTable).values({
            caricoPraticaId: practice.id,
            prodottoId: row.prodottoId,
            fondoOrigine: row.fondoOrigine,
            quantita: row.quantita,
            codiceLottoProduttore: row.codiceLottoProduttore,
            dataScadenza: row.dataScadenza,
            fattoreKgLtPezzo: row.fattoreKgLtPezzo,
            note: row.note,
            clientId: row.clientId,
            creatoDa: req.user!.id,
            aggiornatoDa: req.user!.id,
          });
        }
        await auditPractice(tx, command, practice, "CARICO_PRATICA_CREATA", {
          changes: { stato: "bozza", numeroRighe: normalizedRows.length },
        });
        return practice;
      });
      res.status(201).json(await detail(created.id));
    } catch (error) {
      if (!errorResponse(error, res)) throw error;
    }
  },
);

router.get(
  "/carico-pratiche/:id",
  requirePermission("magazzino.view"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id, "id");
      const result = await detail(id);
      if (!result) throw new CaricoPraticaError(404, "Pratica non trovata");
      await assertAccess(req, result);
      res.json(result);
    } catch (error) {
      if (!errorResponse(error, res)) throw error;
    }
  },
);

router.patch(
  "/carico-pratiche/:id",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id, "id");
      const body = req.body ?? {};
      const current = await detail(id);
      if (!current) throw new CaricoPraticaError(404, "Pratica non trovata");
      await assertAccess(req, current);
      const command = auditContextFromRequest(req);
      await db.transaction(async (tx) => {
        const practice = await lockedPractice(tx, id);
        requireVersion(practice, version(body.versione));
        requireWorkingState(practice);
        requireManualPracticeEdit(practice);
        let values: Partial<typeof caricoPraticheTable.$inferInsert>;
        if (practice.stato === "aperta") {
          const forbidden = [
            "areaOperativaId",
            "magazzinoId",
            "lottoLogicoId",
            "origineCarico",
            "dataCarico",
            "fornitoreId",
            "numeroDocumento",
            "dataDocumento",
          ].filter((key) => key in body);
          if (forbidden.length)
            throw new CaricoPraticaError(
              409,
              "Dopo la prima registrazione il contesto contabile della pratica è congelato",
            );
          values = {
            descrizione:
              body.descrizione === undefined
                ? practice.descrizione
                : requiredText(body.descrizione, "descrizione", 4000),
            note:
              body.note === undefined
                ? practice.note
                : optionalText(body.note, "note", 4000),
          };
        } else {
          const header = await validateHeader(tx, {
            ...practice,
            ...body,
          });
          values = header;
          delete (values as Record<string, unknown>).magazzino;
        }
        const [changed] = await tx
          .update(caricoPraticheTable)
          .set({
            ...values,
            versione: practice.versione + 1,
            aggiornatoDa: req.user!.id,
            dataAggiornamento: new Date(),
          })
          .where(
            and(
              eq(caricoPraticheTable.id, id),
              eq(caricoPraticheTable.versione, practice.versione),
            ),
          )
          .returning();
        if (!changed) requireVersion(practice, practice.versione + 1);
        await auditPractice(tx, command, changed, "CARICO_PRATICA_MODIFICATA", {
          changes: { versione: changed.versione },
        });
      });
      res.json(await detail(id));
    } catch (error) {
      if (!errorResponse(error, res)) throw error;
    }
  },
);

router.post(
  "/carico-pratiche/:id/righe",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id, "id");
      const current = await detail(id);
      if (!current) throw new CaricoPraticaError(404, "Pratica non trovata");
      await assertAccess(req, current);
      const command = auditContextFromRequest(req);
      let rowId = 0;
      await db.transaction(async (tx) => {
        const practice = await lockedPractice(tx, id);
        requireVersion(practice, version(req.body?.versione));
        requireWorkingState(practice);
        requireManualPracticeEdit(practice);
        const row = await normalizeDraftLine(tx, req.body ?? {});
        const [created] = await tx
          .insert(caricoPraticaRigheTable)
          .values({
            caricoPraticaId: id,
            prodottoId: row.prodottoId,
            fondoOrigine: row.fondoOrigine,
            quantita: row.quantita,
            codiceLottoProduttore: row.codiceLottoProduttore,
            dataScadenza: row.dataScadenza,
            fattoreKgLtPezzo: row.fattoreKgLtPezzo,
            note: row.note,
            clientId: row.clientId,
            creatoDa: req.user!.id,
            aggiornatoDa: req.user!.id,
          })
          .returning();
        rowId = created.id;
        const [changed] = await tx
          .update(caricoPraticheTable)
          .set({
            versione: practice.versione + 1,
            aggiornatoDa: req.user!.id,
            dataAggiornamento: new Date(),
          })
          .where(eq(caricoPraticheTable.id, id))
          .returning();
        await auditPractice(
          tx,
          command,
          changed,
          "CARICO_PRATICA_RIGA_AGGIUNTA",
          {
            changes: { rigaId: created.id },
          },
        );
      });
      const result = await detail(id);
      res.status(201).json({ ...result, rigaId: rowId });
    } catch (error) {
      if (!errorResponse(error, res)) throw error;
    }
  },
);

router.patch(
  "/carico-pratiche/:id/righe/:rigaId",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id, "id");
      const rowId = positiveId(req.params.rigaId, "rigaId");
      const current = await detail(id);
      if (!current) throw new CaricoPraticaError(404, "Pratica non trovata");
      await assertAccess(req, current);
      const command = auditContextFromRequest(req);
      await db.transaction(async (tx) => {
        const practice = await lockedPractice(tx, id);
        requireVersion(practice, version(req.body?.versione));
        requireWorkingState(practice);
        requireManualPracticeEdit(practice);
        const [existing] = await tx
          .select()
          .from(caricoPraticaRigheTable)
          .where(
            and(
              eq(caricoPraticaRigheTable.id, rowId),
              eq(caricoPraticaRigheTable.caricoPraticaId, id),
            ),
          );
        if (!existing)
          throw new CaricoPraticaError(
            404,
            "Riga non appartenente alla pratica",
          );
        if (existing.registrataAt)
          throw new CaricoPraticaError(409, "Una riga registrata è immutabile");
        const row = await normalizeDraftLine(tx, { ...existing, ...req.body });
        await tx
          .update(caricoPraticaRigheTable)
          .set({
            prodottoId: row.prodottoId,
            fondoOrigine: row.fondoOrigine,
            quantita: row.quantita,
            codiceLottoProduttore: row.codiceLottoProduttore,
            dataScadenza: row.dataScadenza,
            fattoreKgLtPezzo: row.fattoreKgLtPezzo,
            note: row.note,
            aggiornatoDa: req.user!.id,
            dataAggiornamento: new Date(),
          })
          .where(eq(caricoPraticaRigheTable.id, rowId));
        const [changed] = await tx
          .update(caricoPraticheTable)
          .set({
            versione: practice.versione + 1,
            aggiornatoDa: req.user!.id,
            dataAggiornamento: new Date(),
          })
          .where(eq(caricoPraticheTable.id, id))
          .returning();
        await auditPractice(
          tx,
          command,
          changed,
          "CARICO_PRATICA_RIGA_MODIFICATA",
          {
            changes: { rigaId: rowId },
          },
        );
      });
      res.json(await detail(id));
    } catch (error) {
      if (!errorResponse(error, res)) throw error;
    }
  },
);

router.delete(
  "/carico-pratiche/:id/righe/:rigaId",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id, "id");
      const rowId = positiveId(req.params.rigaId, "rigaId");
      const current = await detail(id);
      if (!current) throw new CaricoPraticaError(404, "Pratica non trovata");
      await assertAccess(req, current);
      const command = auditContextFromRequest(req);
      await db.transaction(async (tx) => {
        const practice = await lockedPractice(tx, id);
        requireVersion(practice, version(req.body?.versione));
        requireWorkingState(practice);
        if (practice.tipoPratica === "SALDO_INIZIALE")
          throw new CaricoPraticaError(
            409,
            "Le righe del saldo iniziale sono atomiche e non possono essere rimosse singolarmente",
          );
        const [existing] = await tx
          .select()
          .from(caricoPraticaRigheTable)
          .where(
            and(
              eq(caricoPraticaRigheTable.id, rowId),
              eq(caricoPraticaRigheTable.caricoPraticaId, id),
            ),
          );
        if (!existing)
          throw new CaricoPraticaError(
            404,
            "Riga non appartenente alla pratica",
          );
        if (existing.registrataAt)
          throw new CaricoPraticaError(409, "Una riga registrata è immutabile");
        await releaseFseClaimForPracticeRow(tx, existing.id, {
          actorId: req.user!.id,
          audit: command,
        });
        await tx
          .delete(caricoPraticaRigheTable)
          .where(eq(caricoPraticaRigheTable.id, rowId));
        const [changed] = await tx
          .update(caricoPraticheTable)
          .set({
            versione: practice.versione + 1,
            aggiornatoDa: req.user!.id,
            dataAggiornamento: new Date(),
          })
          .where(eq(caricoPraticheTable.id, id))
          .returning();
        await auditPractice(
          tx,
          command,
          changed,
          "CARICO_PRATICA_RIGA_RIMOSSA",
          {
            changes: { rigaId: rowId },
          },
        );
      });
      res.json(await detail(id));
    } catch (error) {
      if (!errorResponse(error, res)) throw error;
    }
  },
);

router.post(
  "/carico-pratiche/:id/registra",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id, "id");
      const current = await detail(id);
      if (!current) throw new CaricoPraticaError(404, "Pratica non trovata");
      await assertAccess(req, current);
      if (
        current.tipoPratica === "SALDO_INIZIALE" &&
        !req.user!.isAdmin &&
        !req.user!.isSuperAdmin &&
        !req.user!.permessi.includes("magazzino.agea.bootstrap")
      )
        throw new CaricoPraticaError(
          403,
          "Permesso amministrativo richiesto per registrare il saldo iniziale",
        );
      const key = requiredText(req.body?.idempotencyKey, "idempotencyKey", 100);
      if (!Array.isArray(req.body?.rigaIds) || req.body.rigaIds.length === 0)
        throw new CaricoPraticaError(400, "Seleziona almeno una riga completa");
      const ids = req.body.rigaIds.map((value: unknown) =>
        positiveId(value, "rigaId"),
      );
      if (new Set(ids).size !== ids.length)
        throw new CaricoPraticaError(
          400,
          "La selezione contiene righe duplicate",
        );
      ids.sort((a: number, b: number) => a - b);
      const requestedVersion = version(req.body.versione);
      const hash = semanticHash({
        praticaId: id,
        versione: requestedVersion,
        rigaIds: ids,
      });
      const command = auditContextFromRequest(req, {
        operationKey: `m3a:${key}`,
      });
      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`carico-pratica:${key}`}, 0))`,
        );
        const [replay] = await tx
          .select()
          .from(caricoIntegrazioniTable)
          .where(eq(caricoIntegrazioniTable.idempotencyKey, key));
        if (replay) {
          if (replay.caricoPraticaId !== id || replay.requestHash !== hash)
            throw new CaricoPraticaError(
              409,
              "Idempotency key già usata con un contenuto differente",
            );
          return { ...replay.resultSnapshot, replay: true };
        }
        const [coverageForLock] = await tx
          .select({
            sourceRegistryId: fseInitialBalanceCoverageTable.sourceRegistryId,
          })
          .from(fseInitialBalanceCoverageTable)
          .where(eq(fseInitialBalanceCoverageTable.caricoPraticaId, id));
        if (coverageForLock)
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-source:${coverageForLock.sourceRegistryId}`}, 0))`,
          );
        const practice = await lockedPractice(tx, id);
        requireVersion(practice, requestedVersion);
        requireWorkingState(practice);
        const selected = await tx
          .select({ riga: caricoPraticaRigheTable, prodotto: prodottiTable })
          .from(caricoPraticaRigheTable)
          .innerJoin(
            prodottiTable,
            eq(caricoPraticaRigheTable.prodottoId, prodottiTable.id),
          )
          .where(
            and(
              eq(caricoPraticaRigheTable.caricoPraticaId, id),
              inArray(caricoPraticaRigheTable.id, ids),
            ),
          )
          .orderBy(caricoPraticaRigheTable.id);
        if (selected.length !== ids.length)
          throw new CaricoPraticaError(
            400,
            "Una o più righe non appartengono alla pratica",
          );
        if (selected.some((item) => item.riga.registrataAt != null))
          throw new CaricoPraticaError(
            409,
            "Una o più righe sono già registrate",
          );
        if (practice.origineCarico === "AGEA_SIFEAD") {
          const reservedClaims = await tx
            .select({ rowId: fseMovementClaimsTable.caricoPraticaRigaId })
            .from(fseMovementClaimsTable)
            .where(
              and(
                inArray(fseMovementClaimsTable.caricoPraticaRigaId, ids),
                eq(fseMovementClaimsTable.stato, "RISERVATA"),
              ),
            );
          if (
            reservedClaims.length !== ids.length ||
            reservedClaims.some((claim) => claim.rowId == null)
          )
            throw new CaricoPraticaError(
              409,
              "Ogni riga FSE+ deve avere una presa in carico esterna valida",
            );
        }
        const pendingPracticeRows = await tx
          .select({ id: caricoPraticaRigheTable.id })
          .from(caricoPraticaRigheTable)
          .where(
            and(
              eq(caricoPraticaRigheTable.caricoPraticaId, id),
              sql`${caricoPraticaRigheTable.registrataAt} is null`,
            ),
          );
        const [initialCoverage] = await tx
          .select()
          .from(fseInitialBalanceCoverageTable)
          .where(eq(fseInitialBalanceCoverageTable.caricoPraticaId, id));
        if (practice.tipoPratica === "SALDO_INIZIALE") {
          if (!initialCoverage || initialCoverage.stato !== "PROPOSTA")
            throw new CaricoPraticaError(
              409,
              "Copertura del saldo iniziale non disponibile",
            );
          if (
            pendingPracticeRows.length !== ids.length ||
            pendingPracticeRows.some((row) => !ids.includes(row.id))
          )
            throw new CaricoPraticaError(
              409,
              "Il saldo iniziale deve essere registrato integralmente",
            );
          const [inventoryHistory] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(movimentiTable)
            .where(eq(movimentiTable.magazzinoId, practice.magazzinoId));
          if ((inventoryHistory?.count ?? 0) > 0)
            throw new CaricoPraticaError(
              409,
              "Il Magazzino ha acquisito storia inventariale dopo la preparazione del saldo",
            );
        }
        const loadLines: WarehouseLoadLineInput[] = selected.map(({ riga }) => {
          if (riga.quantita == null)
            throw new CaricoPraticaError(
              400,
              `La riga ${riga.id} è incompleta: quantità mancante`,
            );
          return {
            prodottoId: riga.prodottoId,
            fondoOrigine: riga.fondoOrigine as FondoOrigine,
            quantitaOperativa: riga.quantita,
            codiceLotto: riga.codiceLottoProduttore,
            dataScadenza: riga.dataScadenza,
            fattoreKgLtPezzo: riga.fattoreKgLtPezzo,
            descrizioneEsterna: riga.note,
            riferimentoEsterno:
              riga.numeroDocumentoEsterno == null
                ? null
                : `FSE:${riga.numeroDocumentoEsterno}:${riga.dataDocumentoEsterna ?? ""}`.slice(
                    0,
                    160,
                  ),
            note: riga.note,
          };
        });
        const accounting = await createWarehouseLoad(tx, {
          magazzinoId: practice.magazzinoId,
          lottoLogicoId: practice.lottoLogicoId,
          origineCarico: practice.origineCarico as OrigineCarico,
          numeroDocumento: practice.numeroDocumento,
          dataDocumento: practice.dataDocumento,
          dataCarico: practice.dataCarico,
          descrizione: practice.descrizione,
          fornitoreId: practice.fornitoreId,
          note: practice.note,
          idempotencyKey: `m3a:${key}`,
          executionContext:
            practice.origineCarico === "AGEA_SIFEAD" ||
            practice.origineCarico === "SALDO_INIZIALE"
              ? "system"
              : "manual",
          creatoDa: req.user!.id,
          audit: command,
          righe: loadLines,
        });
        const nextVersion = practice.versione + 1;
        const snapshotBase = {
          praticaId: id,
          caricoMagazzinoId: accounting.carico.id,
          versione: nextVersion,
          rigaIds: ids,
        };
        const [integration] = await tx
          .insert(caricoIntegrazioniTable)
          .values({
            caricoPraticaId: id,
            caricoMagazzinoId: accounting.carico.id,
            idempotencyKey: key,
            requestHash: hash,
            versioneRichiesta: requestedVersion,
            versioneRisultante: nextVersion,
            attoreId: req.user!.id,
            resultSnapshot: snapshotBase,
          })
          .returning();
        const now = new Date();
        for (let index = 0; index < selected.length; index += 1) {
          const work = selected[index];
          const registered = accounting.righe[index];
          await tx.insert(caricoIntegrazioneRigheTable).values({
            caricoIntegrazioneId: integration.id,
            caricoPraticaRigaId: work.riga.id,
            caricoMagazzinoRigaId: registered.riga.id,
          });
          await tx
            .update(caricoPraticaRigheTable)
            .set({
              registrataAt: now,
              unitaMisuraSnapshot: work.prodotto.unitaMisura,
              quantitaFrazionabileSnapshot: work.prodotto.quantitaFrazionabile,
              aggiornatoDa: req.user!.id,
              dataAggiornamento: now,
            })
            .where(
              and(
                eq(caricoPraticaRigheTable.id, work.riga.id),
                sql`${caricoPraticaRigheTable.registrataAt} is null`,
              ),
            );
          await tx
            .update(fseMovementClaimsTable)
            .set({
              stato: "REGISTRATA",
              caricoMagazzinoRigaId: registered.riga.id,
              dataAggiornamento: now,
            })
            .where(
              and(
                eq(fseMovementClaimsTable.caricoPraticaRigaId, work.riga.id),
                eq(fseMovementClaimsTable.stato, "RISERVATA"),
              ),
            );
        }
        if (initialCoverage) {
          const coveredRows = await initialBalanceClaimedRows(
            tx,
            initialCoverage,
          );
          const coveredClaimIds = coveredRows.map((row) => row.claimId);
          const coveredImportRowIds = [
            ...new Set(coveredRows.map((row) => row.rowId)),
          ];
          await tx
            .update(fseInitialBalanceCoverageTable)
            .set({
              stato: "ATTIVA",
              attivataDa: req.user!.id,
              dataAttivazione: now,
            })
            .where(eq(fseInitialBalanceCoverageTable.id, initialCoverage.id));
          if (coveredClaimIds.length > 0)
            await tx
              .update(fseMovementClaimsTable)
              .set({ stato: "COPERTA_SALDO", dataAggiornamento: now })
              .where(
                and(
                  inArray(fseMovementClaimsTable.id, coveredClaimIds),
                  eq(fseMovementClaimsTable.stato, "RISERVATA"),
                ),
              );
          if (coveredImportRowIds.length > 0)
            await tx
              .update(fseImportRowsTable)
              .set({ stato: "COPERTO_SALDO", dataAggiornamento: now })
              .where(inArray(fseImportRowsTable.id, coveredImportRowIds));
          await tx
            .update(fseImportSessionsTable)
            .set({
              stato: "REGISTRATA",
              coperturaConfermata: 1,
              aggiornatoDa: req.user!.id,
              dataAggiornamento: now,
            })
            .where(eq(fseImportSessionsTable.id, initialCoverage.sessioneId));
        }
        const [changed] = await tx
          .update(caricoPraticheTable)
          .set({
            stato: "aperta",
            versione: nextVersion,
            aggiornatoDa: req.user!.id,
            dataAggiornamento: now,
          })
          .where(
            and(
              eq(caricoPraticheTable.id, id),
              eq(caricoPraticheTable.versione, practice.versione),
            ),
          )
          .returning();
        if (!changed)
          throw new CaricoPraticaError(
            409,
            "Conflitto di versione della pratica",
          );
        await auditPractice(
          tx,
          command,
          changed,
          "CARICO_PRATICA_RIGHE_REGISTRATE",
          {
            changes: {
              integrazioneId: integration.id,
              caricoMagazzinoId: accounting.carico.id,
              rigaIds: ids,
              versione: nextVersion,
            },
          },
        );
        const snapshot = {
          ...snapshotBase,
          integrazioneId: integration.id,
          replay: false,
        };
        await tx
          .update(caricoIntegrazioniTable)
          .set({ resultSnapshot: snapshot })
          .where(eq(caricoIntegrazioniTable.id, integration.id));
        return snapshot;
      });
      res.status(result.replay ? 200 : 201).json(result);
    } catch (error) {
      if (!errorResponse(error, res)) throw error;
    }
  },
);

router.post(
  "/carico-pratiche/:id/righe/:rigaId/rettifica",
  requirePermission("magazzino.stock.adjust"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id, "id");
      const rigaId = positiveId(req.params.rigaId, "rigaId");
      const current = await detail(id);
      if (!current) throw new CaricoPraticaError(404, "Pratica non trovata");
      await assertAccess(req, current);
      const requestedVersion = version(req.body?.versione);
      const key = requiredText(req.body?.idempotencyKey, "idempotencyKey", 100);
      const motivo = requiredText(req.body?.motivo, "motivo", 1000);
      let quantita: InventoryDecimal;
      try {
        quantita = InventoryDecimal.parse(req.body?.quantita);
      } catch (error) {
        if (error instanceof InventoryDecimalError)
          throw new CaricoPraticaError(400, error.message);
        throw error;
      }
      if (!quantita.isPositive())
        throw new CaricoPraticaError(
          400,
          "La quantità da rettificare deve essere maggiore di zero",
        );
      const hash = semanticHash({
        praticaId: id,
        rigaId,
        versione: requestedVersion,
        quantita: quantita.toCanonical(),
        motivo,
      });
      const command = auditContextFromRequest(req, {
        operationKey: `m3a-rettifica:${key}`,
      });
      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`carico-pratica-rettifica:${key}`}, 0))`,
        );
        const [replay] = await tx
          .select()
          .from(caricoPraticaRettificheTable)
          .where(eq(caricoPraticaRettificheTable.idempotencyKey, key));
        if (replay) {
          const [replayLine] = await tx
            .select({
              caricoPraticaId: caricoPraticaRigheTable.caricoPraticaId,
            })
            .from(caricoPraticaRigheTable)
            .where(eq(caricoPraticaRigheTable.id, replay.caricoPraticaRigaId));
          if (
            replayLine?.caricoPraticaId !== id ||
            replay.caricoPraticaRigaId !== rigaId ||
            replay.requestHash !== hash
          )
            throw new CaricoPraticaError(
              409,
              "Idempotency key già usata con un contenuto differente",
            );
          return { ...replay.resultSnapshot, replay: true };
        }

        const practice = await lockedPractice(tx, id);
        requireVersion(practice, requestedVersion);
        const [source] = await tx
          .select({
            riga: caricoPraticaRigheTable,
            linkId: caricoIntegrazioneRigheTable.id,
            caricoRigaId: carichiMagazzinoRigheTable.id,
            lottoId: carichiMagazzinoRigheTable.lottoId,
            quantitaOriginale: carichiMagazzinoRigheTable.quantitaOperativa,
          })
          .from(caricoPraticaRigheTable)
          .innerJoin(
            caricoIntegrazioneRigheTable,
            eq(
              caricoPraticaRigheTable.id,
              caricoIntegrazioneRigheTable.caricoPraticaRigaId,
            ),
          )
          .innerJoin(
            carichiMagazzinoRigheTable,
            eq(
              caricoIntegrazioneRigheTable.caricoMagazzinoRigaId,
              carichiMagazzinoRigheTable.id,
            ),
          )
          .where(
            and(
              eq(caricoPraticaRigheTable.id, rigaId),
              eq(caricoPraticaRigheTable.caricoPraticaId, id),
            ),
          );
        if (!source)
          throw new CaricoPraticaError(
            404,
            "Riga registrata non trovata nella pratica",
          );
        if (source.riga.registrataAt == null)
          throw new CaricoPraticaError(
            409,
            "Una riga non ancora registrata non richiede rettifica inventariale",
          );
        if (
          source.riga.quantitaFrazionabileSnapshot === false &&
          !quantita.toDb().endsWith(".000000")
        )
          throw new CaricoPraticaError(
            400,
            "Il Prodotto non ammette quantità frazionarie",
          );

        await tx.execute(
          sql`SELECT id FROM ${lottiTable} WHERE ${lottiTable.id} = ${source.lottoId} FOR UPDATE`,
        );
        const [lotto] = await tx
          .select()
          .from(lottiTable)
          .where(eq(lottiTable.id, source.lottoId));
        if (!lotto) throw new CaricoPraticaError(404, "Partita non trovata");

        const positiveSources = await tx
          .select({
            id: movimentiTable.id,
            tipoMovimento: movimentiTable.tipoMovimento,
            tipoDettaglio: movimentiTable.tipoDettaglio,
            caricoMagazzinoRigaId: movimentiTable.caricoMagazzinoRigaId,
          })
          .from(movimentiTable)
          .where(
            and(
              eq(movimentiTable.lottoId, source.lottoId),
              sql`(${movimentiTable.tipoMovimento} = 'carico' or ${movimentiTable.tipoMovimento} = 'rettifica_positiva' or (${movimentiTable.tipoMovimento} = 'trasferimento' and ${movimentiTable.tipoDettaglio} = 'entrata'))`,
            ),
          );
        if (
          positiveSources.length !== 1 ||
          positiveSources[0].tipoMovimento !== "carico" ||
          positiveSources[0].caricoMagazzinoRigaId !== source.caricoRigaId
        )
          throw new CaricoPraticaError(
            409,
            "Rettifica bloccata: la partita consolida più provenienze e la quota della riga non è ricostruibile con affidabilità",
          );

        const [prior] = await tx
          .select({
            total: sql<string>`coalesce(sum(${caricoPraticaRettificheTable.quantita}), 0)`,
          })
          .from(caricoPraticaRettificheTable)
          .where(eq(caricoPraticaRettificheTable.caricoPraticaRigaId, rigaId));
        const remainingSource = InventoryDecimal.parse(
          source.quantitaOriginale,
        ).subtract(InventoryDecimal.parse(prior?.total ?? "0"));
        if (quantita.compare(remainingSource) > 0)
          throw new CaricoPraticaError(
            409,
            "La rettifica supera la quantità originaria ancora rettificabile",
          );
        const [reserved] = await tx
          .select({
            total: sql<string>`coalesce(sum(${prenotazioniMagazzinoTable.quantita}), 0)`,
          })
          .from(prenotazioniMagazzinoTable)
          .where(
            and(
              eq(prenotazioniMagazzinoTable.lottoId, source.lottoId),
              eq(prenotazioniMagazzinoTable.stato, "attiva"),
            ),
          );
        const available = InventoryDecimal.parse(
          lotto.quantitaResidua,
        ).subtract(InventoryDecimal.parse(reserved?.total ?? "0"));
        if (quantita.compare(available) > 0)
          throw new CaricoPraticaError(
            409,
            "Rettifica bloccata: la quantità è già distribuita o impegnata",
          );

        const corrected = await rettificaInventarialeConEsito(tx, {
          lottoId: source.lottoId,
          delta: `-${quantita.toDb()}`,
          causale: "altro",
          motivazione: motivo,
          dataMovimento: dataCivileEuropeRome(new Date()),
          operatoreId: req.user!.id,
          audit: command,
          origine: {
            entitaTipo: "carico_pratica",
            entitaId: id,
            rigaOrigineId: rigaId,
            documentoRiferimento: practice.codice,
          },
        });
        if (corrected.auditEventoId == null)
          throw new CaricoPraticaError(
            500,
            "Audit obbligatorio della rettifica non registrato",
          );
        const nextVersion = practice.versione + 1;
        const snapshot = {
          praticaId: id,
          rigaId,
          lottoId: source.lottoId,
          movimentoId: corrected.movimento.id,
          quantita: quantita.toDb(),
          versione: nextVersion,
          replay: false,
        };
        const [rectification] = await tx
          .insert(caricoPraticaRettificheTable)
          .values({
            caricoPraticaRigaId: rigaId,
            caricoIntegrazioneRigaId: source.linkId,
            lottoId: source.lottoId,
            movimentoId: corrected.movimento.id,
            auditEventoId: corrected.auditEventoId,
            idempotencyKey: key,
            requestHash: hash,
            quantita: quantita.toDb(),
            motivo,
            attoreId: req.user!.id,
            resultSnapshot: snapshot,
          })
          .returning({ id: caricoPraticaRettificheTable.id });
        await tx
          .update(caricoPraticheTable)
          .set({
            versione: nextVersion,
            aggiornatoDa: req.user!.id,
            dataAggiornamento: new Date(),
          })
          .where(eq(caricoPraticheTable.id, id));
        return { ...snapshot, rettificaId: rectification.id };
      });
      res.status(result.replay ? 200 : 201).json(result);
    } catch (error) {
      if (!errorResponse(error, res)) throw error;
    }
  },
);

for (const action of ["chiudi", "riapri", "annulla"] as const) {
  router.post(
    `/carico-pratiche/:id/${action}`,
    requirePermission("magazzino.stock.receive"),
    async (req, res) => {
      try {
        const id = positiveId(req.params.id, "id");
        const current = await detail(id);
        if (!current) throw new CaricoPraticaError(404, "Pratica non trovata");
        await assertAccess(req, current);
        const motivo = optionalText(req.body?.motivo, "motivo", 1000);
        if ((action === "riapri" || action === "annulla") && !motivo)
          throw new CaricoPraticaError(400, "Il motivo è obbligatorio");
        const command = auditContextFromRequest(req);
        await db.transaction(async (tx) => {
          const practice = await lockedPractice(tx, id);
          requireVersion(practice, version(req.body?.versione));
          const target =
            action === "chiudi"
              ? "chiusa"
              : action === "riapri"
                ? "aperta"
                : "annullata";
          if (action === "chiudi") {
            if (practice.stato !== "aperta")
              throw new CaricoPraticaError(
                409,
                "Solo una pratica aperta può essere chiusa",
              );
            const [pending] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(caricoPraticaRigheTable)
              .where(
                and(
                  eq(caricoPraticaRigheTable.caricoPraticaId, id),
                  sql`${caricoPraticaRigheTable.registrataAt} is null`,
                ),
              );
            if ((pending?.count ?? 0) > 0)
              throw new CaricoPraticaError(
                409,
                "Completa o rimuovi le righe ancora da registrare prima di chiudere",
              );
          } else if (action === "riapri") {
            if (practice.stato !== "chiusa")
              throw new CaricoPraticaError(
                409,
                "Solo una pratica chiusa può essere riaperta",
              );
          } else if (practice.stato !== "bozza") {
            throw new CaricoPraticaError(
              409,
              "Solo una bozza senza effetti inventariali può essere annullata",
            );
          }
          if (action === "annulla") {
            const pendingRows = await tx
              .select({ id: caricoPraticaRigheTable.id })
              .from(caricoPraticaRigheTable)
              .where(
                and(
                  eq(caricoPraticaRigheTable.caricoPraticaId, id),
                  sql`${caricoPraticaRigheTable.registrataAt} is null`,
                ),
              );
            for (const row of pendingRows)
              await releaseFseClaimForPracticeRow(tx, row.id, {
                actorId: req.user!.id,
                audit: command,
              });
            const [coverage] = await tx
              .select()
              .from(fseInitialBalanceCoverageTable)
              .where(
                and(
                  eq(fseInitialBalanceCoverageTable.caricoPraticaId, id),
                  eq(fseInitialBalanceCoverageTable.stato, "PROPOSTA"),
                ),
              );
            if (coverage) {
              const coveredRows = await initialBalanceClaimedRows(tx, coverage);
              const coveredClaimIds = coveredRows.map((row) => row.claimId);
              await tx
                .update(fseInitialBalanceCoverageTable)
                .set({ stato: "ANNULLATA" })
                .where(eq(fseInitialBalanceCoverageTable.id, coverage.id));
              if (coveredClaimIds.length > 0)
                await tx
                  .update(fseMovementClaimsTable)
                  .set({ stato: "RILASCIATA", dataAggiornamento: new Date() })
                  .where(
                    and(
                      inArray(fseMovementClaimsTable.id, coveredClaimIds),
                      eq(fseMovementClaimsTable.stato, "RISERVATA"),
                    ),
                  );
              await tx
                .update(fseImportSessionsTable)
                .set({
                  stato: "ANNULLATA",
                  aggiornatoDa: req.user!.id,
                  dataAggiornamento: new Date(),
                })
                .where(eq(fseImportSessionsTable.id, coverage.sessioneId));
              await recordAuditEvent(tx, {
                command,
                azione: "FSE_SALDO_PROPOSTA_ANNULLATA",
                entitaTipo: "fse_initial_balance_coverage",
                entitaId: coverage.id,
                documentoTipo: "carico_pratica",
                documentoId: id,
                areaOperativaIdSnapshot: practice.areaOperativaId,
                magazzinoIdSnapshot: practice.magazzinoId,
                motivo: motivo!,
              });
            }
            await tx
              .update(fseImportSessionsTable)
              .set({
                stato: "ANNULLATA",
                aggiornatoDa: req.user!.id,
                dataAggiornamento: new Date(),
              })
              .where(
                and(
                  eq(fseImportSessionsTable.caricoPraticaId, id),
                  sql`${fseImportSessionsTable.stato} <> 'REGISTRATA'`,
                ),
              );
          }
          const [changed] = await tx
            .update(caricoPraticheTable)
            .set({
              stato: target,
              versione: practice.versione + 1,
              aggiornatoDa: req.user!.id,
              dataAggiornamento: new Date(),
            })
            .where(eq(caricoPraticheTable.id, id))
            .returning();
          await auditPractice(
            tx,
            command,
            changed,
            `CARICO_PRATICA_${action.toUpperCase()}`,
            {
              motivo,
              changes: { statoPrecedente: practice.stato, statoNuovo: target },
            },
          );
        });
        res.json(await detail(id));
      } catch (error) {
        if (!errorResponse(error, res)) throw error;
      }
    },
  );
}

export default router;
