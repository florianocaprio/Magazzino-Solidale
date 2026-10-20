import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, ilike, or, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  lottiProduttoreTable,
  lottiTable,
  prodottiTable,
  magazziniTable,
  prenotazioniMagazzinoTable,
  areeOperativeTable,
  utentiTable,
} from "@workspace/db";
import { requirePermission } from "../middlewares/auth";
import { requireWarehouseScope } from "../middlewares/warehouseReadScope";
import { requireModulo } from "../lib/featureFlags";
import { isGlobalAdmin } from "../lib/adminScope";
import {
  visibleMagazzinoIds,
  callerCentroId,
  callerAreaOperativaId,
  magazzinoScopeFilter,
} from "../lib/centroScope";
import {
  requireCurrentCommandActor,
  CurrentCommandActorError,
} from "../lib/currentCommandActor";
import { InventoryLedgerError } from "../lib/inventoryLedger";
import { InventoryDecimal } from "../lib/inventoryDecimal";
import { auditContextFromRequest } from "../lib/auditEvent";
import {
  lockProducerLotRegistry,
  resolveProducerLot,
  producerLotRequestHash,
  producerLotValues,
} from "../lib/producerLots";
const router: IRouter = Router();
router.use("/lotti-produttore", requireModulo("LOTTI"), requireWarehouseScope);
function positive(value: unknown, field: string) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new InventoryLedgerError(400, `${field} non valido`);
  return id;
}
async function areaFor(req: Request, selected: unknown) {
  const area =
    req.user!.areaOperativaId ??
    (isGlobalAdmin(req.user) ? positive(selected, "Area") : null);
  if (!area || (selected != null && Number(selected) !== area))
    throw new InventoryLedgerError(403, "Area non accessibile");
  const [row] = await db
    .select({ id: areeOperativeTable.id })
    .from(areeOperativeTable)
    .where(
      and(eq(areeOperativeTable.id, area), eq(areeOperativeTable.attivo, true)),
    );
  if (!row) throw new InventoryLedgerError(403, "Area non accessibile");
  return area;
}
function failure(error: unknown, res: Response) {
  if (
    error instanceof InventoryLedgerError ||
    error instanceof CurrentCommandActorError
  ) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}
async function masterView(req: Request, id: number, area: number) {
  const [row] = await db
    .select({
      master: lottiProduttoreTable,
      prodottoNome: prodottiTable.nome,
      prodottoCodice: prodottiTable.codice,
      unitaMisura: prodottiTable.unitaMisura,
      autoreNome: utentiTable.nome,
      autoreCognome: utentiTable.cognome,
    })
    .from(lottiProduttoreTable)
    .innerJoin(
      prodottiTable,
      eq(prodottiTable.id, lottiProduttoreTable.prodottoId),
    )
    .leftJoin(
      utentiTable,
      eq(utentiTable.id, lottiProduttoreTable.primoAutoreId),
    )
    .where(
      and(
        eq(lottiProduttoreTable.id, id),
        eq(lottiProduttoreTable.areaOperativaId, area),
      ),
    );
  if (!row)
    throw new InventoryLedgerError(404, "Anagrafica lotto non disponibile");
  const visible = await visibleMagazzinoIds(
    callerCentroId(req),
    callerAreaOperativaId(req),
  );
  const parties = await db
    .select({
      id: lottiTable.id,
      magazzinoId: lottiTable.magazzinoId,
      magazzinoNome: magazziniTable.nome,
      fondoOrigine: lottiTable.fondoOrigine,
      lottoLogicoId: lottiTable.lottoLogicoId,
      dataScadenza: lottiTable.dataScadenza,
      quantitaResidua: lottiTable.quantitaResidua,
    })
    .from(lottiTable)
    .innerJoin(magazziniTable, eq(lottiTable.magazzinoId, magazziniTable.id))
    .where(
      and(
        eq(lottiTable.lottoProduttoreId, id),
        eq(magazziniTable.areaOperativaId, area),
        magazzinoScopeFilter(lottiTable.magazzinoId, visible),
      ),
    );
  const reserved = parties.length
    ? await db
        .select({
          lottoId: prenotazioniMagazzinoTable.lottoId,
          q: sql<string>`sum(${prenotazioniMagazzinoTable.quantita})`,
        })
        .from(prenotazioniMagazzinoTable)
        .where(
          and(
            inArray(
              prenotazioniMagazzinoTable.lottoId,
              parties.map((p) => p.id),
            ),
            eq(prenotazioniMagazzinoTable.stato, "attiva"),
          ),
        )
        .groupBy(prenotazioniMagazzinoTable.lottoId)
    : [];
  const byId = new Map(reserved.map((r) => [r.lottoId, r.q]));
  let residuo = InventoryDecimal.zero(),
    prenotato = InventoryDecimal.zero();
  const partite = parties.map((p) => {
    const r = InventoryDecimal.parse(p.quantitaResidua);
    const q = InventoryDecimal.parse(byId.get(p.id) ?? "0");
    residuo = residuo.add(r);
    prenotato = prenotato.add(q);
    return {
      ...p,
      quantitaPrenotata: q.toDb(),
      disponibile: r.subtract(q).toDb(),
    };
  });
  const {
    requestHash: _hash,
    idempotencyKey: _key,
    fonte,
    ...master
  } = row.master;
  const [legacy] =
    partite.length === 0 && callerCentroId(req) == null
      ? await db
          .select({ id: lottiTable.id })
          .from(lottiTable)
          .innerJoin(
            magazziniTable,
            eq(magazziniTable.id, lottiTable.magazzinoId),
          )
          .where(
            and(
              eq(magazziniTable.areaOperativaId, area),
              eq(lottiTable.prodottoId, row.master.prodottoId),
              sql`${lottiTable.lottoProduttoreId} is null`,
            ),
          )
          .limit(1)
      : [];
  const canReadFse =
    req.user!.isAdmin ||
    (req.user!.permessi ?? []).includes("magazzino.agea.import");
  return {
    ...master,
    fonte: canReadFse ? fonte : null,
    prodottoNome: row.prodottoNome,
    prodottoCodice: row.prodottoCodice,
    unitaMisura: row.unitaMisura,
    autore:
      [row.autoreNome, row.autoreCognome].filter(Boolean).join(" ") || null,
    primaCreazioneAt: master.primaCreazioneAt?.toISOString() ?? null,
    dataAssociazione: master.dataAssociazione.toISOString(),
    partite,
    numeroPartiteVisibili: partite.length,
    residuo: residuo.toDb(),
    prenotato: prenotato.toDb(),
    disponibile: residuo.subtract(prenotato).toDb(),
    statoPartite: partite.length
      ? "PARTITE_VISIBILI"
      : callerCentroId(req) == null && !legacy
        ? "MAI_CARICATO"
        : "NESSUNA_PARTITA_VISIBILE",
  };
}
router.get(
  "/lotti-produttore",
  requirePermission("magazzino.view"),
  async (req, res) => {
    try {
      const area = await areaFor(req, req.query.areaOperativaId);
      const page = Math.max(1, Math.trunc(Number(req.query.page) || 1)),
        limit = Math.min(
          100,
          Math.max(1, Math.trunc(Number(req.query.limit) || 30)),
        );
      const term =
        typeof req.query.q === "string"
          ? req.query.q.normalize("NFC").trim()
          : "";
      const cond = and(
        eq(lottiProduttoreTable.areaOperativaId, area),
        req.query.prodottoId
          ? eq(
              lottiProduttoreTable.prodottoId,
              positive(req.query.prodottoId, "Prodotto"),
            )
          : undefined,
        req.query.origine
          ? eq(lottiProduttoreTable.origine, String(req.query.origine))
          : undefined,
        term
          ? or(
              ilike(lottiProduttoreTable.codiceOriginale, `%${term}%`),
              ilike(
                lottiProduttoreTable.codiceCanonico,
                `%${term.toLocaleUpperCase("it-IT")}%`,
              ),
              ilike(lottiProduttoreTable.riferimentoInterno, `%${term}%`),
              ilike(prodottiTable.nome, `%${term}%`),
            )
          : undefined,
      );
      const from = () =>
        db
          .select({ id: lottiProduttoreTable.id })
          .from(lottiProduttoreTable)
          .innerJoin(
            prodottiTable,
            eq(prodottiTable.id, lottiProduttoreTable.prodottoId),
          )
          .where(cond);
      const ids = await from()
        .orderBy(desc(lottiProduttoreTable.id))
        .limit(limit + 1)
        .offset((page - 1) * limit);
      const items = [];
      for (const r of ids.slice(0, limit))
        items.push(await masterView(req, r.id, area));
      res.json({ items, page, hasMore: ids.length > limit });
    } catch (error) {
      if (!failure(error, res)) throw error;
    }
  },
);
router.get(
  "/lotti-produttore/:id",
  requirePermission("magazzino.view"),
  async (req, res) => {
    try {
      const id = positive(req.params.id, "ID");
      const [m] = await db
        .select({ area: lottiProduttoreTable.areaOperativaId })
        .from(lottiProduttoreTable)
        .where(eq(lottiProduttoreTable.id, id));
      if (
        !m ||
        (!isGlobalAdmin(req.user) && req.user!.areaOperativaId !== m.area)
      )
        throw new InventoryLedgerError(404, "Anagrafica lotto non disponibile");
      const area = await areaFor(req, m.area);
      res.json(await masterView(req, id, area));
    } catch (error) {
      if (!failure(error, res)) throw error;
    }
  },
);
router.post(
  "/lotti-produttore",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    try {
      const area = await areaFor(req, req.body?.areaOperativaId),
        prodottoId = positive(req.body?.prodottoId, "Prodotto");
      const key = req.body?.idempotencyKey;
      if (typeof key !== "string" || !key.trim() || key.length > 100)
        throw new InventoryLedgerError(400, "Idempotency key richiesta");
      const input = {
        areaOperativaId: area,
        prodottoId,
        codiceLotto: req.body.codiceLotto ?? null,
        dataScadenza: req.body.dataScadenza ?? null,
        produttore: req.body.produttore ?? null,
      };
      const values = producerLotValues(input);
      const hash = producerLotRequestHash({
        area,
        prodottoId,
        ...values,
        note: req.body.note ?? null,
      });
      const result = await db.transaction(async (tx) => {
        const actor = await requireCurrentCommandActor(
          tx,
          req.user!.id,
          "magazzino.stock.receive",
        );
        if (actor.areaOperativaId != null && actor.areaOperativaId !== area)
          throw new InventoryLedgerError(403, "Area non accessibile");
        await lockProducerLotRegistry(tx);
        const [replay] = await tx
          .select()
          .from(lottiProduttoreTable)
          .where(eq(lottiProduttoreTable.idempotencyKey, key));
        if (replay) {
          if (replay.areaOperativaId !== area || replay.requestHash !== hash)
            throw new InventoryLedgerError(
              409,
              "Idempotency key non compatibile con la richiesta",
            );
          return { master: replay, creato: false };
        }
        return resolveProducerLot(tx, {
          ...input,
          actorId: req.user!.id,
          audit: auditContextFromRequest(req),
          origin: "MANUALE",
          note: req.body.note,
          idempotencyKey: key,
          requestHash: hash,
        });
      });
      res.status(result.creato ? 201 : 200).json({
        ...(await masterView(req, result.master.id, area)),
        creato: result.creato,
      });
    } catch (error) {
      if (!failure(error, res)) throw error;
    }
  },
);
export default router;
