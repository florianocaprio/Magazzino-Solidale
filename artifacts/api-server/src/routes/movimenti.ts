import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  FONDI_ORIGINE,
  auditEventiTable,
  movimentiTable,
  prodottiTable,
  magazziniTable,
  utentiTable,
  type FondoOrigine,
} from "@workspace/db";
import { eq, and, gte, lte, desc, sql, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
  visibleMagazzinoIds,
  magazzinoScopeFilter,
} from "../lib/centroScope";
import { loadSessionUser, requirePermission } from "../middlewares/auth";
import { alias } from "drizzle-orm/pg-core";
import { movementPhysicalEffect } from "../lib/movementPhysicalEffect";

const router: IRouter = Router();
const originalMovement = alias(movimentiTable, "original_movement");

router.get(
  ["/movimenti", "/movimenti/export"],
  requirePermission("magazzino.view"),
  async (req, res) => {
    const exporting = req.path === "/movimenti/export";
    const initialUser = req.user;
    const sessionUserId = req.session?.userId;
    if (exporting && !sessionUserId) {
      res.status(401).json({ error: "Sessione richiesta" });
      return;
    }
    if (exporting && (req.query.page != null || req.query.limit != null)) {
      res.status(400).json({ error: "L'export non usa paginazione" });
      return;
    }
    const {
      tipo,
      magazzinoId,
      prodottoId,
      centroAscoltoId,
      da,
      a,
      fondoOrigine,
      naturaContabile,
      canaleOperativo,
    } = req.query as Record<string, string>;
    const page = req.query.page == null ? 1 : Number(req.query.page);
    const limit = req.query.limit == null ? 50 : Number(req.query.limit);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      res.status(400).json({
        error: "Paginazione non valida: page >= 1 e limit tra 1 e 100",
      });
      return;
    }
    for (const [name, raw] of [
      ["magazzinoId", magazzinoId],
      ["prodottoId", prodottoId],
      ["centroAscoltoId", centroAscoltoId],
    ] as const) {
      if (
        raw != null &&
        (!Number.isSafeInteger(Number(raw)) || Number(raw) <= 0)
      ) {
        res.status(400).json({ error: `${name} non valido` });
        return;
      }
    }
    const conditions: SQL[] = [];
    if (tipo) conditions.push(eq(movimentiTable.tipoMovimento, tipo));
    if (magazzinoId)
      conditions.push(eq(movimentiTable.magazzinoId, parseInt(magazzinoId)));
    if (prodottoId)
      conditions.push(eq(movimentiTable.prodottoId, parseInt(prodottoId)));
    if (centroAscoltoId)
      conditions.push(
        eq(magazziniTable.centroAscoltoId, parseInt(centroAscoltoId)),
      );
    if (da) conditions.push(gte(movimentiTable.dataMovimento, da));
    if (a) conditions.push(lte(movimentiTable.dataMovimento, a));
    if (fondoOrigine) {
      if (!FONDI_ORIGINE.includes(fondoOrigine as FondoOrigine)) {
        res.status(400).json({ error: "fondoOrigine non valido" });
        return;
      }
      conditions.push(eq(movimentiTable.fondoOrigine, fondoOrigine));
    }
    if (naturaContabile)
      conditions.push(eq(movimentiTable.naturaContabile, naturaContabile));
    if (canaleOperativo)
      conditions.push(eq(movimentiTable.canaleOperativo, canaleOperativo));
    const visibleIds = await visibleMagazzinoIds(
      callerCentroId(req),
      callerAreaOperativaId(req),
    );
    const scope = magazzinoScopeFilter(movimentiTable.magazzinoId, visibleIds);
    if (scope) conditions.push(scope);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ total }] = exporting
      ? [{ total: 0 }]
      : await db
          .select({ total: sql<number>`count(*)::int` })
          .from(movimentiTable)
          .leftJoin(
            magazziniTable,
            eq(movimentiTable.magazzinoId, magazziniTable.id),
          )
          .where(where);
    const readRows = (executor: Pick<typeof db, "select">) =>
      executor
        .select({
          mov: movimentiTable,
          originalType: originalMovement.tipoMovimento,
          originalDetail: originalMovement.tipoDettaglio,
          prodottoNome: prodottiTable.nome,
          magazzinoNome: magazziniTable.nome,
          auditActorCode: auditEventiTable.actorCodeSnapshot,
          operatoreMatricola: utentiTable.matricola,
          operatoreUsername: utentiTable.username,
        })
        .from(movimentiTable)
        .leftJoin(
          originalMovement,
          eq(movimentiTable.movimentoOrigineId, originalMovement.id),
        )
        .leftJoin(
          prodottiTable,
          eq(movimentiTable.prodottoId, prodottiTable.id),
        )
        .leftJoin(
          magazziniTable,
          eq(movimentiTable.magazzinoId, magazziniTable.id),
        )
        .leftJoin(
          auditEventiTable,
          eq(movimentiTable.auditEventoId, auditEventiTable.id),
        )
        .leftJoin(utentiTable, eq(movimentiTable.operatoreId, utentiTable.id))
        .where(where)
        .orderBy(desc(movimentiTable.dataCreazione), desc(movimentiTable.id))
        .limit(exporting ? 10001 : limit)
        .offset(exporting ? 0 : (page - 1) * limit);

    // One PostgreSQL snapshot, not independently paged HTTP reads. The extra
    // row detects overflow; never silently truncate or deduplicate an export.
    const rows = exporting
      ? await db.transaction(
          async (tx) => {
            await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
            return readRows(tx);
          },
          { isolationLevel: "repeatable read", accessMode: "read only" },
        )
      : await readRows(db);

    if (exporting) {
      // Revalidate OUTSIDE the snapshot, including same-session revocation and
      // warehouse territorial changes. Never reissue a logged-out session.
      const validSession = await new Promise<boolean>((resolve) =>
        req.session.reload((error) => resolve(!error)),
      );
      const currentSessionUserId = req.session?.userId;
      // This read-only response may arrive after logout/login in another tab.
      // Do not roll the captured session cookie over the newer login. Detaching
      // this request does not destroy the stored session or change other routes.
      Reflect.deleteProperty(req, "session");
      if (!validSession || currentSessionUserId !== sessionUserId) {
        res.status(401).json({ error: "Sessione terminata o cambiata" });
        return;
      }
      const currentUser = await loadSessionUser(sessionUserId!);
      const currentIds = await visibleMagazzinoIds(
        callerCentroId(req),
        callerAreaOperativaId(req),
      );
      if (
        !currentUser ||
        JSON.stringify(currentUser) !== JSON.stringify(initialUser) ||
        JSON.stringify(currentIds?.sort((a, b) => a - b)) !==
          JSON.stringify(visibleIds?.sort((a, b) => a - b))
      ) {
        res
          .status(403)
          .json({ error: "Autorizzazione cambiata durante l'export" });
        return;
      }
      if (
        rows.length > 10000 ||
        Buffer.byteLength(JSON.stringify(rows), "utf8") > 16 * 1024 * 1024
      ) {
        res.status(413).json({
          error:
            "Export troppo ampio: restringere i filtri (massimo 10000 righe / 16 MiB)",
        });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
    }

    res.setHeader("X-Total-Count", String(exporting ? rows.length : total));
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Page-Size", String(exporting ? rows.length : limit));
    res.json(
      rows.map((r) => ({
        id: r.mov.id,
        tipoMovimento: r.mov.tipoMovimento,
        tipoDettaglio: r.mov.tipoDettaglio,
        effettoFisico: (() => {
          try {
            return movementPhysicalEffect(
              r.mov,
              r.originalType && r.originalDetail
                ? {
                    tipoMovimento: r.originalType,
                    tipoDettaglio: r.originalDetail,
                  }
                : null,
            );
          } catch {
            // Incomplete legacy reversals must not be assigned an invented sign.
            return null;
          }
        })(),
        dataMovimento: r.mov.dataMovimento,
        magazzinoId: r.mov.magazzinoId,
        magazzinoNome: r.magazzinoNome ?? null,
        prodottoId: r.mov.prodottoId,
        prodottoNome: r.prodottoNome ?? null,
        lottoId: r.mov.lottoId ?? null,
        quantita: parseFloat(r.mov.quantita),
        quantitaPrecisa: r.mov.quantita,
        quantitaPezzi: r.mov.quantitaPezzi,
        quantitaKgLt: r.mov.quantitaKgLt,
        fattoreKgLtPezzo: r.mov.fattoreKgLtPezzo,
        unitaMisura: r.mov.unitaMisura,
        fornitoreId: r.mov.fornitoreId ?? null,
        beneficiarioId: r.mov.beneficiarioId ?? null,
        movimentoOrigineId: r.mov.movimentoOrigineId ?? null,
        fondoOrigine: r.mov.fondoOrigine,
        naturaContabile: r.mov.naturaContabile,
        dominioOrigine: r.mov.dominioOrigine,
        entitaOrigineTipo: r.mov.entitaOrigineTipo,
        entitaOrigineId: r.mov.entitaOrigineId,
        rigaOrigineId: r.mov.rigaOrigineId,
        caricoMagazzinoRigaId: r.mov.caricoMagazzinoRigaId,
        operazioneDistribuzioneId: r.mov.operazioneDistribuzioneId,
        canaleOperativo: r.mov.canaleOperativo,
        operatoreId: r.mov.operatoreId ?? null,
        operatoreCodice:
          r.auditActorCode ??
          r.operatoreMatricola ??
          r.operatoreUsername ??
          null,
        auditEventoId: r.mov.auditEventoId ?? null,
        documentoRiferimento: r.mov.documentoRiferimento ?? null,
        note: r.mov.note ?? null,
        dataCreazione: r.mov.dataCreazione.toISOString(),
      })),
    );
  },
);

router.post(
  "/movimenti",
  requirePermission("magazzino.stock.adjust"),
  (_req, res) => {
    res.status(405).json({
      error:
        "Il giornale Movimenti è append-only: usa Carico, Scarico, Trasferimento o Rettifica",
    });
  },
);

export default router;
