import { Router, type IRouter, type RequestHandler } from "express";
import { requirePermission } from "../middlewares/auth";
import {
  isModuloAttivo,
  requireAllModuli,
  requireAnyModulo,
  requireModulo,
} from "../lib/featureFlags";
import { buildGeneralReport } from "../lib/reporting/generale";
import { buildPacchiReport } from "../lib/reporting/pacchi";
import { buildCentroAscoltoReport } from "../lib/reporting/centroAscolto";
import { buildEmporioReport } from "../lib/reporting/emporio";
import { buildMensaReport } from "../lib/reporting/mensa";
import { buildUdsReport } from "../lib/reporting/uds";
import { buildLogisticaReport } from "../lib/reporting/logistica";
import { buildFsePlusReport } from "../lib/reporting/fsePlus";
import {
  parsePagination,
  parseReportFilters,
  ReportingError,
} from "../lib/reporting/filters";
import { buildDrilldown } from "../lib/reporting/drilldown";
import type { ReportSection } from "../lib/reporting/types";
import { buildReportFilterOptions } from "../lib/reporting/filterOptions";

const router: IRouter = Router();

const sections = new Set<ReportSection>([
  "generale",
  "pacchi",
  "centro-ascolto",
  "emporio",
  "mensa",
  "uds",
  "magazzino-logistica",
  "fse-plus",
]);

export function requireSourceArea(...areas: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "Non autenticato" });
      return;
    }
    if (req.user.isAdmin || areas.some((area) => req.user?.aree.includes(area))) {
      next();
      return;
    }
    res.status(403).json({ error: "Area sorgente non consentita per il ruolo" });
  };
}

function sendError(error: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): boolean {
  if (!(error instanceof ReportingError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

function reportHandler(
  builder: (filters: ReturnType<typeof parseReportFilters>) => Promise<unknown>,
): RequestHandler {
  return async (req, res) => {
    try {
      res.json(await builder(parseReportFilters(req)));
    } catch (error) {
      if (sendError(error, res)) return;
      throw error;
    }
  };
}

router.use(
  [
    "/report/dashboard",
    "/report/pacchi",
    "/report/centro-ascolto",
    "/report/emporio",
    "/report/mensa",
    "/report/uds",
    "/report/magazzino-logistica",
    "/report/fse-plus/integrato",
    "/report/filter-options",
    "/report/drilldown",
  ],
  requireModulo("REPORT"),
);

router.get("/report/dashboard", reportHandler(buildGeneralReport));
router.get(
  "/report/pacchi",
  requireSourceArea("sociale"),
  requireAllModuli(["MAGAZZINO_SOLIDALE", "BOLLE"]),
  reportHandler(buildPacchiReport),
);
router.get(
  "/report/centro-ascolto",
  requireSourceArea("sociale"),
  requireModulo("CENTRO_ASCOLTO"),
  reportHandler(buildCentroAscoltoReport),
);
router.get(
  "/report/emporio",
  requireSourceArea("emporio"),
  requireModulo("EMPORIO_SOLIDALE"),
  reportHandler(buildEmporioReport),
);
router.get(
  "/report/mensa",
  requireSourceArea("mensa"),
  requireModulo("MENSA"),
  requirePermission("mensa.reports.view"),
  reportHandler(buildMensaReport),
);
router.get(
  "/report/uds",
  requireSourceArea("uds"),
  requireModulo("UDS"),
  reportHandler(buildUdsReport),
);
router.get(
  "/report/magazzino-logistica",
  requireSourceArea("magazzino", "logistica"),
  requireAnyModulo([
    "MAGAZZINO_SOLIDALE",
    "LOTTI",
    "TRASFERIMENTI",
    "MEZZI",
    "FORNITORI",
    "APPROVVIGIONAMENTI",
  ]),
  reportHandler(buildLogisticaReport),
);
router.get(
  "/report/fse-plus/integrato",
  requireSourceArea("sociale", "emporio", "mensa", "uds", "magazzino", "logistica"),
  requireAnyModulo(["MAGAZZINO_SOLIDALE", "BOLLE", "EMPORIO_SOLIDALE", "MENSA", "UDS"]),
  reportHandler(buildFsePlusReport),
);

router.get("/report/filter-options", async (req, res) => {
  try {
    const section = String(req.query.section ?? "") as ReportSection;
    if (!sections.has(section)) throw new ReportingError(400, "section non valida");
    const rawAreaOperativaId = req.query.areaOperativaId;
    const requestedAreaOperativaId = rawAreaOperativaId == null || rawAreaOperativaId === "" ? null : Number(rawAreaOperativaId);
    if (requestedAreaOperativaId != null && (!Number.isInteger(requestedAreaOperativaId) || requestedAreaOperativaId <= 0)) {
      throw new ReportingError(400, "areaOperativaId non valido");
    }
    if (req.user?.areaOperativaId != null && requestedAreaOperativaId != null && req.user.areaOperativaId !== requestedAreaOperativaId) {
      throw new ReportingError(403, "La area operativa richiesta è fuori dal perimetro del ruolo");
    }
    res.json(await buildReportFilterOptions(req, section, requestedAreaOperativaId));
  } catch (error) {
    if (sendError(error, res)) return;
    throw error;
  }
});

router.get("/report/drilldown", async (req, res) => {
  try {
    const section = String(req.query.section ?? "") as ReportSection;
    const metric = String(req.query.metric ?? "").trim();
    if (!sections.has(section)) throw new ReportingError(400, "section non valida");
    if (!metric || metric.length > 80) throw new ReportingError(400, "metric non valida");
    const requiredModule: Partial<Record<ReportSection, string>> = {
      pacchi: "MAGAZZINO_SOLIDALE",
      "centro-ascolto": "CENTRO_ASCOLTO",
      emporio: "EMPORIO_SOLIDALE",
      mensa: "MENSA",
      uds: "UDS",
    };
    const moduleCode = requiredModule[section];
    if (moduleCode && !(await isModuloAttivo(moduleCode))) {
      throw new ReportingError(403, `Modulo ${moduleCode} non abilitato`);
    }
    if (
      section === "mensa" &&
      !req.user?.isAdmin &&
      !req.user?.permessi.includes("mensa.reports.view")
    ) {
      throw new ReportingError(403, "Permesso mensa.reports.view richiesto");
    }
    const sourceAreas: Partial<Record<ReportSection, string[]>> = {
      pacchi: ["sociale"],
      "centro-ascolto": ["sociale"],
      emporio: ["emporio"],
      mensa: ["mensa"],
      uds: ["uds"],
      "magazzino-logistica": ["magazzino", "logistica"],
    };
    const allowedAreas = sourceAreas[section];
    if (
      allowedAreas &&
      !req.user?.isAdmin &&
      !allowedAreas.some((area) => req.user?.aree.includes(area))
    ) {
      throw new ReportingError(403, "Area sorgente non consentita per il ruolo");
    }
    const filters = parseReportFilters(req);
    const pagination = parsePagination(req);
    res.json(await buildDrilldown({ section, metric, filters, ...pagination }));
  } catch (error) {
    if (sendError(error, res)) return;
    throw error;
  }
});

export default router;
