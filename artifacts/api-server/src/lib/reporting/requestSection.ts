import type { Request } from "express";
import type { ReportSection } from "./types";

/** Only known report paths may use a service gate. The handler still validates
 * the section and every source grant, including document preparation. */
export function reportRequestSection(
  req: Pick<Request, "originalUrl" | "path" | "query">,
): ReportSection | null {
  const path = (req.originalUrl || req.path)
    .split("?", 1)[0]
    .replace(/^\/api(?=\/|$)/, "")
    .replace(/\/+$/, "");
  if (
    ["/report/filter-options", "/report/drilldown", "/report/prepare"].includes(
      path,
    )
  ) {
    const section = req.query.section;
    return typeof section === "string" &&
      Object.hasOwn(REPORT_SERVICE_AREAS, section)
      ? (section as ReportSection)
      : null;
  }
  if (path === "/report/uds" || path.startsWith("/report/uds/")) return "uds";
  const sections: Record<string, ReportSection> = {
    "/report/dashboard": "generale",
    "/report/pacchi": "pacchi",
    "/report/centro-ascolto": "centro-ascolto",
    "/report/emporio": "emporio",
    "/report/mensa": "mensa",
    "/report/magazzino-logistica": "magazzino-logistica",
    "/report/fse-plus": "fse-plus",
    "/report/fse-plus/integrato": "fse-plus",
    "/report/giacenze-per-magazzino": "magazzino-logistica",
    "/report/allocazione-mezzi": "magazzino-logistica",
    "/report/consegne-per-mese": "pacchi",
    "/report/consegne-per-centro": "pacchi",
  };
  return sections[path] ?? null;
}

export const REPORT_SERVICE_AREAS: Record<ReportSection, string[]> = {
  generale: ["generale", "analisi"],
  pacchi: ["sociale"],
  "centro-ascolto": ["sociale"],
  emporio: ["emporio"],
  mensa: ["mensa"],
  uds: ["uds"],
  "magazzino-logistica": ["magazzino", "logistica"],
  "fse-plus": ["analisi"],
};
