import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

test("R66-07 renderer reale: due misure, negativi, null, logo, RTL e orientamenti", async ({
  page,
}, info) => {
  const evidence = process.env.REPORTING_EVIDENCE_DIR!;
  expect(evidence.startsWith("/private/tmp/magazzino-m66-")).toBe(true);
  await page.goto("/login");
  // Presentation fixture only: real application builders, no mock API response
  // and no assertion that these synthetic measures were written by business workflows.
  const results = await page.evaluate(async () => {
    const pdfPath = "/src/lib/reporting-document.ts",
      exportPath = "/src/lib/export.ts",
      i18nPath = "/src/lib/i18n/index.ts";
    const { buildReportingPdf } = await import(pdfPath),
      { buildReportingWorkbook } = await import(exportPath),
      { default: i18n } = await import(i18nPath);
    const textPath = "/src/lib/reporting-text.ts";
    const { reportingColumnLabel } = await import(textPath);
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 40;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1a4971";
    ctx.fillRect(0, 0, 120, 40);
    ctx.fillStyle = "white";
    ctx.font = "20px sans-serif";
    ctx.fillText("TEST", 34, 28);
    const results = [];
    for (const language of ["it", "ar"]) {
      await i18n.changeLanguage(language);
      const t = i18n.t.bind(i18n);
      const metadata = Object.fromEntries(
        [
          "from",
          "to",
          "areaOperativa",
          "centre",
          "warehouse",
          "mensa",
          "zone",
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
        ].map((key) => [key, t(`reporting.export.${key}`)]),
      );
      for (const key of [
        "allAreeOperative",
        "allCentres",
        "allWarehouses",
        "allMense",
        "allZones",
      ])
        metadata[key] = t(`reporting.filters.${key}`);
      const labels = {
        title: "Review R66-07",
        kpi: (k: string) => t(`reporting.kpi.${k}`),
        table: (k: string) => t(`reporting.tables.${k}`),
        column: (k: string) => reportingColumnLabel(t, k),
        quality: (k: string) => t(`reporting.quality.${k}`),
        unit: (k: string) => t(`reporting.units.${k}`),
        availability: (k: string) => t(`reporting.availability.${k}`),
        text: (v: unknown) => String(v),
        unavailable: t("reporting.unavailable"),
        locale: language,
        metadata,
      };
      for (const wide of [false, true]) {
        const columns = wide
          ? [
              "data",
              "documento",
              "prodotto",
              "lotto",
              "quantita",
              "unita",
              "canale",
            ]
          : ["prodotto", "quantita", "unita"];
        const report = {
          reportingModelVersion: "REPORTING_2_0_V1",
          section: "emporio",
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
          kpi: [
            {
              key: "speseConcluse",
              value: 0,
              exactValue: "0",
              unit: "count",
              availability: "ok",
              drilldownMetric: null,
            },
            {
              key: "personeRaggiunte",
              value: null,
              exactValue: null,
              unit: "count",
              availability: "missing",
              drilldownMetric: null,
            },
            {
              key: "mediaPastiGiornata",
              value: 1.5,
              exactValue: "1.50",
              unit: "count",
              availability: "derivable",
              drilldownMetric: null,
              numerator: "3",
              denominator: "2",
              presentationDecimals: 2,
            },
            {
              key: "fseEventiQualitaBloccante",
              value: 1,
              exactValue: "1",
              unit: "count",
              availability: "ok",
              drilldownMetric: null,
            },
          ],
          series: [
            {
              key: "spesePerMese",
              primary: { label: "spese", unit: "count" },
              secondary: { label: "credito", unit: "credit" },
              points: [
                {
                  label: "2026-01",
                  value: 3,
                  exactValue: "3",
                  secondaryValue: 12.123456,
                  exactSecondaryValue: "12.123456",
                },
                {
                  label: "2026-02",
                  value: 1,
                  exactValue: "1",
                  secondaryValue: -0.2,
                  exactSecondaryValue: "-0.200000",
                },
                {
                  label: "2026-03",
                  value: 0,
                  exactValue: "0",
                  secondaryValue: null,
                  exactSecondaryValue: null,
                },
              ],
            },
          ],
          tables: [
            {
              key: "giacenze",
              columns,
              rows: Array.from({ length: 42 }, (_, i) => ({
                data: "2026-01-15",
                documento: `TEST-${i}`,
                prodotto: `Prodotto ${i} / منتج`,
                lotto: "LOT-TEST",
                quantita:
                  i === 0
                    ? "1000099991233.683456"
                    : i === 1
                      ? "-0.200000"
                      : i === 2
                        ? null
                        : "1.234567",
                unita: i % 2 ? "pz" : "kg",
                canale: "EMPORIO",
              })),
            },
          ],
          quality: [
            {
              key: "dimensioniSifeadMancanti",
              count: 1,
              availability: "missing",
              note: "Synthetic coverage 1/2; administrative export blocked.",
            },
          ],
          definitions: [],
          timezone: "Europe/Rome",
          generatedAt: "2026-01-31T12:00:00Z",
        };
        const pdf = await buildReportingPdf({
          title: labels.title,
          report,
          labels,
          datasetId: `R66-${language}-${wide}`,
          branding: {
            nomeDocumento: "Brand sintetico",
            logoDataUrl: canvas.toDataURL("image/png"),
            sottotitoloDocumento: null,
            contattiDocumento: null,
            footerDocumenti: "Solo prova renderer",
          },
        });
        const workbook = buildReportingWorkbook(report, labels);
        results.push({
          name: `renderer-${language}-${wide ? "wide" : "narrow"}`,
          bytes: Array.from(new Uint8Array(await pdf.arrayBuffer())),
          summary: workbook.Sheets["00_Riepilogo"],
          series: workbook.Sheets.Serie_1,
          table: workbook.Sheets.giacenze,
          quality: workbook.Sheets.Qualita_Dati,
          expectedMissing: labels.unavailable,
          expectedAvailability: ["ok", "missing", "derivable"].map(
            labels.availability,
          ),
          filters: [
            labels.column("operatore"),
            labels.column("tipoIntervento"),
            labels.column("tipoServizio"),
          ],
        });
      }
    }
    return results;
  });
  const dir = `${evidence}/documents/${process.env.REPORTING_RUN}/${info.project.name}`;
  await mkdir(dir, { recursive: true });
  for (const result of results) {
    expect(Buffer.from(result.bytes).subarray(0, 4).toString()).toBe("%PDF");
    const cellValues = (sheet: Record<string, unknown>) =>
      Object.values(sheet)
        .filter(
          (c): c is { v: string } =>
            typeof c === "object" && c !== null && "v" in c,
        )
        .map((c) => c.v);
    expect(cellValues(result.series)).toContain("-0.200000");
    expect(cellValues(result.series)).toContain(result.expectedMissing);
    expect(cellValues(result.table)).toContain("1000099991233.683456");
    expect(cellValues(result.table)).toContain(result.expectedMissing);
    expect(cellValues(result.summary)).toContain("1.50");
    expect(
      cellValues(result.summary).some((value) =>
        String(value).startsWith("reporting."),
      ),
    ).toBe(false);
    expect(cellValues(result.summary)).toContain(
      `${result.expectedAvailability[2]} (3/2; 2 dec.)`,
    );
    expect(cellValues(result.summary)).toContain(
      result.expectedAvailability[0],
    );
    expect(cellValues(result.summary)).toContain(
      result.expectedAvailability[1],
    );
    expect(cellValues(result.quality)).toContain(
      "Synthetic coverage 1/2; administrative export blocked.",
    );
    for (const filter of result.filters)
      expect(cellValues(result.summary)).toContain(filter);
    await writeFile(`${dir}/${result.name}.pdf`, Buffer.from(result.bytes));
    const { bytes: _bytes, ...expected } = result;
    await writeFile(
      `${dir}/${result.name}.json`,
      JSON.stringify(expected, null, 2),
    );
  }
});
