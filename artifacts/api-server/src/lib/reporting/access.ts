import type { Request } from "express";
import { isReportModuleActive as isModuloAttivo } from "./queryContext";
import { assertReportTerritory, ReportingError } from "./filters";
import type { ReportSection } from "./types";

const policy: Record<
  ReportSection,
  { areas: string[]; all?: string[]; any?: string[]; grant?: string }
> = {
  generale: { areas: [] },
  pacchi: { areas: ["sociale"], all: ["MAGAZZINO_SOLIDALE", "BOLLE"] },
  "centro-ascolto": { areas: ["sociale"], all: ["CENTRO_ASCOLTO"] },
  emporio: { areas: ["emporio"], all: ["EMPORIO_SOLIDALE"] },
  mensa: { areas: ["mensa"], all: ["MENSA"], grant: "mensa.reports.view" },
  uds: { areas: ["uds"], all: ["UDS"], grant: "uds.reports.view" },
  "magazzino-logistica": {
    areas: ["magazzino", "logistica"],
    any: [
      "MAGAZZINO_SOLIDALE",
      "LOTTI",
      "TRASFERIMENTI",
      "MEZZI",
      "FORNITORI",
      "APPROVVIGIONAMENTI",
    ],
  },
  "fse-plus": {
    areas: ["sociale", "emporio", "mensa", "uds", "magazzino", "logistica"],
    any: ["MAGAZZINO_SOLIDALE", "BOLLE", "EMPORIO_SOLIDALE", "MENSA", "UDS"],
    grant: "magazzino.fse.view",
  },
};

/** Same read gate for dashboard, options, details and document preparation. */
export async function assertReportSectionAccess(
  req: Request,
  section: ReportSection,
) {
  assertReportTerritory(req);
  const user = req.user!;
  const rule = policy[section];
  if (!rule) throw new ReportingError(400, "Sezione non valida");
  if (
    !user.isAdmin &&
    (!user.aree.includes("analisi") ||
      (rule.areas.length &&
        !rule.areas.some((area) => user.aree.includes(area))) ||
      (rule.grant && !user.permessi.includes(rule.grant)))
  )
    throw new ReportingError(
      403,
      "Report non autorizzato per il ruolo corrente",
    );
  const all = await Promise.all(
    ["REPORT", ...(rule.all ?? [])].map(isModuloAttivo),
  );
  const any = rule.any
    ? await Promise.all(rule.any.map(isModuloAttivo))
    : [true];
  if (!all.every(Boolean) || !any.some(Boolean))
    throw new ReportingError(403, "Modulo sorgente del report non abilitato");
}
