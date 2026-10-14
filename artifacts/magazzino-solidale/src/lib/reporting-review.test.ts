import { expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { ReportingDashboard } from "@workspace/api-client-react";
import { buildReportingWorkbook, type ReportingExportLabels } from "./export";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsPDF } from "jspdf";
import { reporting } from "./i18n/namespaces/reporting";

it.each(["it", "es", "en", "fr", "de", "ar"] as const)(
  "PDF definitions retain the negation and every glyph in %s",
  (language) => {
    const pdf = new jsPDF();
    pdf.addFileToVFS(
      "Amiri.ttf",
      readFileSync(
        resolve(process.cwd(), "src/assets/reporting/Amiri-Regular.ttf"),
      ).toString("base64"),
    );
    pdf.addFont("Amiri.ttf", "Amiri", "normal");
    pdf.setFont("Amiri");
    const font = pdf.getFont().metadata as unknown as {
      cmap: { unicode: { codeMap: Record<number, number> } };
    };
    const definitions = reporting[language].text;
    const negations = {
      it: ["non equivale", "non sono"],
      es: ["no equivale", "no son"],
      en: ["is not", "are not"],
      fr: ["ne vaut pas", "ne sont pas"],
      de: ["ist kein", "sind keine"],
      ar: ["لا يعني", "ليست"],
    };
    for (const [index, value] of [
      definitions.requestsCohort,
      definitions.mensaHistoricalDemography,
    ].entries()) {
      expect(value).toContain(negations[language][index]);
      for (const character of value)
        if (!/\s/.test(character))
          expect(
            font.cmap.unicode.codeMap[character.codePointAt(0)!],
            character,
          ).toBeGreaterThan(0);
    }
  },
);

const identity = (value: string) => value;
const labels = {
  title: "Review",
  kpi: identity,
  table: identity,
  quality: identity,
  column: identity,
  unit: identity,
  availability: identity,
  text: identity,
  unavailable: "Missing",
  locale: "it",
  metadata: Object.fromEntries(
    [
      "from",
      "to",
      "areaOperativa",
      "centre",
      "warehouse",
      "mensa",
      "zone",
      "allAreeOperative",
      "allCentres",
      "allWarehouses",
      "allMense",
      "allZones",
      "generatedAt",
      "application",
      "indicator",
      "value",
      "unit",
      "availability",
      "definitions",
      "notes",
      "rows",
      "reportGeneratedBy",
    ].map((k) => [k, k]),
  ),
} as ReportingExportLabels;
const report: ReportingDashboard = {
  reportingModelVersion: "REPORTING_2_0_V1",
  section: "mensa",
  filters: {
    da: "2026-01-01",
    a: "2026-01-31",
    anno: 2026,
    areaOperativaId: null,
    centroAscoltoId: null,
    magazzinoId: null,
    mensaId: null,
    zonaUdsId: null,
    operatoreId: 42,
    tipoIntervento: "Accompagnamento",
    tipoServizio: "pranzo",
  },
  kpi: [],
  series: [],
  tables: [],
  quality: [],
  definitions: [],
  timezone: "Europe/Rome",
  generatedAt: "2026-01-31T12:00:00Z",
};
it("R66-06 exported summary includes every non-territorial applied filter", () => {
  const workbook = buildReportingWorkbook(report, labels);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["00_Riepilogo"], {
    header: 1,
  });
  expect(rows).toContainEqual(["operatore", "42"]);
  expect(rows).toContainEqual(["tipoIntervento", "Accompagnamento"]);
  expect(rows).toContainEqual(["tipoServizio", "pranzo"]);
});
it("R66-07 series columns carry declared meaning and units, not generic values", () => {
  const series = {
    key: "spesePerMese",
    primary: { label: "spese", unit: "count" },
    secondary: { label: "credito", unit: "credit" },
    points: [
      {
        label: "2026-01",
        value: 1,
        exactValue: "1",
        secondaryValue: -0.2,
        exactSecondaryValue: "-0.200000",
      },
    ],
  };
  const workbook = buildReportingWorkbook(
    { ...report, series: [series] },
    labels,
  );
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Serie_1, { header: 1 });
  expect(rows).toContainEqual(["data", "spese (count)", "credito (credit)"]);
  expect(rows).toContainEqual(["2026-01", "1", "-0.200000"]);
});

it("AC-12 Emporio exports exact product quantities as text, including negative and zero values", () => {
  const quantities = ["1000099991233.683456", "-0.300000", "0"];
  const workbook = buildReportingWorkbook(
    {
      ...report,
      section: "emporio",
      tables: [
        {
          key: "prodotti",
          columns: ["quantita", "quantitaFse", "quantitaNonFse"],
          rows: quantities.map((value) => ({
            quantita: value,
            quantitaFse: value,
            quantitaNonFse: "0",
          })),
        },
      ],
    },
    labels,
  );
  const sheet =
    workbook.Sheets[
      workbook.SheetNames.find((name) => name.includes("prodotti"))!
    ];
  expect(sheet).toBeDefined();
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  for (const value of quantities) {
    expect(rows).toContainEqual([value, value, "0"]);
    const cells = Object.entries(sheet).filter(([key]) => !key.startsWith("!"));
    expect(
      cells.some(([, cell]) => cell.v === value && cell.t === "s" && !cell.f),
    ).toBe(true);
  }
});
