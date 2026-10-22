import { Router, type IRouter } from "express";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import {
  db,
  magazziniTable,
  fornitoriTable,
  prodottiTable,
  volontariTable,
  mezziTable,
  centriAscoltoTable,
  ruoliVolontariTable,
  impostazioniStampaTable,
} from "@workspace/db";
import { getVolontariCarico } from "./volontari";
import { selectionPolicy } from "../lib/operationalSelections";
import { isModuloAttivo } from "../lib/featureFlags";
import { requireWarehouseScope } from "../middlewares/warehouseReadScope";
import {
  callerAreaOperativaId,
  areaOperativaScopeFilter,
  visibleCentroIds,
} from "../lib/centroScope";
import {
  volunteerAreaFilter,
  volunteerContextFilter,
} from "../lib/volontariArea";
import {
  effectiveAreaOperativaFilter,
  effectiveCentroFilter,
  effectiveMezzoCentroExpr,
} from "../lib/logisticaPolicy";
import { operationalStatesForRows } from "../lib/volontariOperational";
import { todayRome, isDateOnly } from "../lib/volontariDomain";

const router: IRouter = Router();
// Archive switches do not disable the minimum projections required by another
// active service. The context policy remains the authorization/module boundary.
const resourceModule: Record<string, string> = {
  magazzini: "MAGAZZINO",
  prodotti: "PRODOTTI",
};

/** Explicit read-only projections: these URLs never dispatch archive handlers. */
router.get("/operativita/:risorsa", requireWarehouseScope, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  const resource = String(req.params.risorsa);
  const rule = selectionPolicy(req.user, req.query.contesto, resource);
  if (!rule) {
    res
      .status(403)
      .json({ error: "Selezione non autorizzata per questo servizio" });
    return;
  }
  const modules = [
    ...rule.modules,
    ...(resourceModule[resource] ? [resourceModule[resource]] : []),
  ];
  if (!(await Promise.all(modules.map(isModuloAttivo))).every(Boolean)) {
    res
      .status(403)
      .json({ error: "Modulo del servizio o della selezione disabilitato" });
    return;
  }
  const ownArea = callerAreaOperativaId(req);
  const requestedArea =
    req.query.areaOperativaId == null
      ? null
      : Number(req.query.areaOperativaId);
  if (
    requestedArea != null &&
    (!Number.isSafeInteger(requestedArea) || requestedArea < 1)
  ) {
    res.status(400).json({ error: "Area non valida" });
    return;
  }
  if (ownArea != null && requestedArea != null && ownArea !== requestedArea) {
    res.status(403).json({ error: "Area non accessibile" });
    return;
  }
  const area = ownArea ?? requestedArea;
  const centreId =
    req.query.centroAscoltoId == null
      ? null
      : Number(req.query.centroAscoltoId);
  if (centreId != null) {
    if (!Number.isSafeInteger(centreId) || centreId < 1) {
      res.status(400).json({ error: "Centro non valido" });
      return;
    }
    const [centre] = await db
      .select({ area: centriAscoltoTable.areaOperativaId })
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, centreId));
    if (!centre || (area != null && centre.area !== area)) {
      res.status(403).json({ error: "Centro non accessibile" });
      return;
    }
  }
  if (resource === "carico-volontari") {
    await getVolontariCarico(req, res, () => {});
    return;
  }
  if (resource === "stampa") {
    const [settings] = await db
      .select({
        templateBolla: impostazioniStampaTable.templateBolla,
        footerBolla: impostazioniStampaTable.footerBolla,
        dataAggiornamento: impostazioniStampaTable.dataAggiornamento,
      })
      .from(impostazioniStampaTable)
      .where(eq(impostazioniStampaTable.id, 1));
    res.json(
      settings
        ? {
            ...settings,
            dataAggiornamento: settings.dataAggiornamento.toISOString(),
          }
        : {
            templateBolla: "standard",
            footerBolla: null,
            dataAggiornamento: new Date(0).toISOString(),
          },
    );
    return;
  }
  if (resource === "magazzini") {
    const conditions: (SQL | undefined)[] = [
      areaOperativaScopeFilter(magazziniTable.areaOperativaId, area),
    ];
    if (req.query.contesto === "emporio")
      conditions.push(
        sql`${magazziniTable.tipoMagazzino} in ('emporio', 'misto')`,
      );
    res.json(
      await db
        .select({
          id: magazziniTable.id,
          nome: magazziniTable.nome,
          areaOperativaId: magazziniTable.areaOperativaId,
          centroAscoltoId: magazziniTable.centroAscoltoId,
          stato: magazziniTable.stato,
          tipoMagazzino: magazziniTable.tipoMagazzino,
        })
        .from(magazziniTable)
        .where(and(...conditions))
        .orderBy(asc(magazziniTable.nome)),
    );
    return;
  }
  if (resource === "fornitori") {
    res.json(
      await db
        .select({
          id: fornitoriTable.id,
          nome: fornitoriTable.nome,
          tipo: fornitoriTable.tipo,
          areaOperativaId: fornitoriTable.areaOperativaId,
          attivo: fornitoriTable.attivo,
        })
        .from(fornitoriTable)
        .where(areaOperativaScopeFilter(fornitoriTable.areaOperativaId, area))
        .orderBy(asc(fornitoriTable.nome)),
    );
    return;
  }
  if (resource === "prodotti") {
    res.json(
      await db
        .select({
          id: prodottiTable.id,
          nome: prodottiTable.nome,
          codice: prodottiTable.codice,
          unitaMisura: prodottiTable.unitaMisura,
          attivo: prodottiTable.attivo,
          lottoFisicoObbligatorio: prodottiTable.lottoFisicoObbligatorio,
        })
        .from(prodottiTable)
        .orderBy(asc(prodottiTable.nome)),
    );
    return;
  }
  if (resource === "ruoli-volontari") {
    res.json(
      await db
        .select({
          id: ruoliVolontariTable.id,
          nome: ruoliVolontariTable.nome,
          attivo: ruoliVolontariTable.attivo,
        })
        .from(ruoliVolontariTable)
        .orderBy(asc(ruoliVolontariTable.nome)),
    );
    return;
  }
  if (resource === "volontari") {
    const date =
      req.query.dataRiferimento == null
        ? todayRome()
        : String(req.query.dataRiferimento);
    if (
      !isDateOnly(date) ||
      (req.query.stato != null &&
        !["attivi", "non_attivi", "tutti"].includes(String(req.query.stato)))
    ) {
      res.status(400).json({ error: "Data o stato non valido" });
      return;
    }
    const rows = await db
      .select({
        id: volontariTable.id,
        nome: volontariTable.nome,
        cognome: volontariTable.cognome,
        matricola: volontariTable.matricola,
        areaOperativaId: volontariTable.areaOperativaId,
        centroAscoltoId: volontariTable.centroAscoltoId,
        centroAscoltoNome: centriAscoltoTable.nome,
        tipoVolontario: volontariTable.tipoVolontario,
        ruolo: volontariTable.ruolo,
        ruoloVolontarioId: volontariTable.ruoloVolontarioId,
        patente: volontariTable.patente,
        mezzoPersonale: volontariTable.mezzoPersonale,
        maxConsegneTurno: volontariTable.maxConsegneTurno,
        attivo: volontariTable.attivo,
        statoApprovazione: volontariTable.statoApprovazione,
      })
      .from(volontariTable)
      .leftJoin(
        centriAscoltoTable,
        eq(centriAscoltoTable.id, volontariTable.centroAscoltoId),
      )
      .where(
        and(
          volunteerAreaFilter(area),
          centreId == null ? undefined : volunteerContextFilter(centreId),
        ),
      )
      .orderBy(asc(volontariTable.cognome), asc(volontariTable.nome));
    const states = await operationalStatesForRows(db, rows, date, centreId);
    res.json(
      rows
        .map((row) => ({
          ...row,
          operativo: states.get(row.id)?.operativo ?? false,
          motivoNonOperativo:
            states.get(row.id)?.motivoNonOperativo ?? "STATO_NON_CALCOLATO",
        }))
        .filter((row) =>
          req.query.stato === "attivi"
            ? row.operativo
            : req.query.stato === "non_attivi"
              ? !row.operativo
              : true,
        ),
    );
    return;
  }
  if (resource === "mezzi") {
    const rows = await db
      .select({
        id: mezziTable.id,
        codice: mezziTable.codice,
        tipo: mezziTable.tipo,
        targa: mezziTable.targa,
        volontarioId: mezziTable.volontarioId,
        centroAscoltoId: mezziTable.centroAscoltoId,
        areaOperativaId: volontariTable.areaOperativaId,
        effectiveCentroId: effectiveMezzoCentroExpr,
        stato: mezziTable.stato,
        statoApprovazione: mezziTable.statoApprovazione,
        scadenzaAssicurazione: mezziTable.scadenzaAssicurazione,
        scadenzaRevisione: mezziTable.scadenzaRevisione,
      })
      .from(mezziTable)
      .leftJoin(volontariTable, eq(mezziTable.volontarioId, volontariTable.id))
      .where(
        and(
          effectiveAreaOperativaFilter(await visibleCentroIds(area), area),
          effectiveCentroFilter(centreId),
        ),
      )
      .orderBy(asc(mezziTable.codice));
    res.json(rows);
    return;
  }
  res.status(404).json({ error: "Selezione non disponibile" });
});

export default router;
