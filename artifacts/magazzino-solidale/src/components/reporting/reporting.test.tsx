import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ReportEmptyState } from "./report-empty-state";
import { ReportDataQuality } from "./report-data-quality";
import { getReportingFilterLocks } from "./report-filters";
import { isReportingCardVisible } from "@/pages/reporting-landing";
import { MODULO_BY_ROUTE } from "@/lib/use-moduli";
import { NAV_ITEMS } from "@/components/layout";

describe("reportistica integrata", () => {
  it("blocca i filtri corrispondenti allo scope del caller", () => {
    expect(getReportingFilterLocks({ areaOperativaId: 1, centroAscoltoId: 2, zonaUdsId: 3 })).toEqual({
      areaOperativaLocked: true,
      centreLocked: true,
      zoneLocked: true,
    });
    expect(getReportingFilterLocks({ areaOperativaId: null, centroAscoltoId: null, zonaUdsId: null })).toEqual({
      areaOperativaLocked: false,
      centreLocked: false,
      zoneLocked: false,
    });
  });

  it("mostra le card solo con area, modulo e permesso richiesti", () => {
    const active = new Set(["MENSA"]);
    const areas = new Set(["mensa"]);
    const permissions = new Set(["mensa.reports.view"]);
    const card = { section: "mensa", path: "/report/mensa", icon: (() => null) as never, areas: ["mensa"], modules: ["MENSA"], permission: "mensa.reports.view" };
    const checks = {
      hasArea: (area: string) => areas.has(area),
      hasPermission: (permission: string) => permissions.has(permission),
      isModuloAttivo: (code: string) => active.has(code),
    };
    expect(isReportingCardVisible(card, checks)).toBe(true);
    permissions.clear();
    expect(isReportingCardVisible(card, checks)).toBe(false);
  });

  it("registra le nuove route e mantiene nascosto l'alias legacy dalla navigazione", () => {
    const paths = ["/report", "/report/dashboard", "/report/pacchi", "/report/centro-ascolto", "/report/emporio", "/report/mensa", "/report/uds", "/report/magazzino-logistica", "/report/fse-plus"];
    for (const path of paths) {
      expect(MODULO_BY_ROUTE[path]).toBe("REPORT");
      expect(NAV_ITEMS.some((item) => item.url === path)).toBe(true);
    }
    expect(NAV_ITEMS.some((item) => item.url === "/report-uds")).toBe(false);
  });

  it("rende empty state e warning di qualità senza confondere zero e dato mancante", () => {
    expect(renderToStaticMarkup(<ReportEmptyState />)).toContain("reporting.empty.title");
    const html = renderToStaticMarkup(
      <ReportDataQuality items={[
        { key: "sessoMancante", count: 0, availability: "ok", note: null },
        { key: "dimensioniSifeadMancanti", count: null, availability: "missing", note: null },
      ]} />,
    );
    expect(html).toContain("reporting.quality.sessoMancante");
    expect(html).toContain("reporting.quality.dimensioniSifeadMancanti");
    expect(html).toContain("reporting.availability.missing");
  });
});
