import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import {
  db,
  pool,
  ruoliTable,
  utentiTable,
  areeOperativeTable,
  magazziniTable,
  prodottiTable,
  lottiTable,
} from "../../../lib/db/src/index";
import { base } from "../src/lib/i18n/namespaces/base";

const requireApi = createRequire(
  new URL("../../api-server/package.json", import.meta.url),
);
const bcrypt = requireApi(
  "bcryptjs",
) as typeof import("../../api-server/node_modules/bcryptjs");
const XLSX = createRequire(new URL("../package.json", import.meta.url))(
  "xlsx",
) as typeof import("xlsx");
const sections = [
  "dashboard",
  "pacchi",
  "centro-ascolto",
  "emporio",
  "mensa",
  "uds",
  "magazzino-logistica",
  "fse-plus",
];
let username: string, password: string, areaId: number;

test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  expect(process.env.REPORTING_TEST_DISPOSABLE_DB).toBe("verified");
  expect([url.hostname, url.port, url.pathname]).toEqual([
    "127.0.0.1",
    "59666",
    "/m66_dev",
  ]);
  const suffix = randomUUID();
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `Report E2E ${suffix}`,
      isAdmin: true,
      aree: [
        "analisi",
        "sociale",
        "magazzino",
        "logistica",
        "mensa",
        "uds",
        "emporio",
      ],
      permessi: [],
    })
    .returning();
  username = `report-${suffix}`;
  password = `Synthetic-${randomUUID()}!`;
  await db.insert(utentiTable).values({
    username,
    nome: "Operatore sintetico reporting",
    passwordHash: await bcrypt.hash(password, 4),
    ruoloId: role.id,
    mustChangePassword: false,
  });
  const [area] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Area sintetica PDF ${suffix}` })
    .returning();
  areaId = area.id;
  const [warehouse] = await db
    .insert(magazziniTable)
    .values({
      codice: `PDF-${suffix.slice(0, 8)}`,
      nome: "Deposito sintetico àèìòù",
      areaOperativaId: area.id,
    })
    .returning();
  const products = await db
    .insert(prodottiTable)
    .values(
      Array.from({ length: 301 }, (_, i) => ({
        codice: `PDF-${suffix.slice(0, 8)}-${i}`,
        nome:
          i === 0
            ? '=HYPERLINK("https://invalid.example","Riga sintetica 001")'
            : i === 1
              ? '<svg onload="throw 1">Riga sintetica 002</svg>'
              : `Riga sintetica ${String(i + 1).padStart(3, "0")} — caffè, qualità e confezioni`,
        tipoProdotto: "alimentare",
        unitaMisura: "kg",
        quantitaFrazionabile: true,
        scortaMinima: "5",
      })),
    )
    .returning();
  await db.insert(lottiTable).values(
    products.map((p) => ({
      prodottoId: p.id,
      magazzinoId: warehouse.id,
      dataCarico: "2026-01-01",
      quantitaCaricata: "0.300000",
      quantitaResidua: "0.300000",
      fondoOrigine: "NESSUN_FONDO",
      fsePlus: false,
    })),
  );
});
test.afterAll(async () => {
  await pool.end();
});

test("PDF/XLSX reali delle otto sezioni, tabella 301 righe e revoca export", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const evidence = process.env.REPORTING_EVIDENCE_DIR!;
  expect(evidence.startsWith("/private/tmp/magazzino-m66-")).toBe(true);
  const output = `${evidence}/documents/${process.env.REPORTING_RUN}/${info.project.name}`;
  await mkdir(output, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
  for (const section of sections) {
    const query = new URLSearchParams({ da: "2026-01-01", a: "2026-12-31" });
    if (section === "magazzino-logistica")
      query.set("areaOperativaId", String(areaId));
    await page.goto(`/report/${section}?${query}`);
    const pdf = page.getByRole("button", {
      name: "Esporta in PDF",
      exact: true,
    });
    await expect(pdf).toBeEnabled();
    const rect = await pdf.boundingBox();
    expect(rect!.height).toBeGreaterThanOrEqual(44);
    expect(rect!.width).toBeGreaterThanOrEqual(44);
    const preparedResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/api/report/prepare") &&
        r.request().method() === "POST",
    );
    const downloaded = page.waitForEvent("download");
    await pdf.click();
    const prepared = await preparedResponse;
    expect(prepared.status()).toBe(200);
    const dataset = await prepared.json();
    await writeFile(
      `${output}/${section}.json`,
      JSON.stringify(dataset, null, 2),
    );
    await (await downloaded).saveAs(`${output}/${section}.pdf`);
    // Reuse exactly the server-prepared payload through the application's real
    // workbook builder; no reconstruction of accounting data in the harness.
    const sameDownload = page.waitForEvent("download");
    const expected = await page.evaluate(async (prepared) => {
      const exportPath = "/src/lib/export.ts",
        i18nPath = "/src/lib/i18n/index.ts",
        textPath = "/src/lib/reporting-text.ts";
      const exports = await import(exportPath),
        { default: i18n } = await import(i18nPath),
        { localizeReportingText } = await import(textPath);
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
        title: t(`reporting.sections.${prepared.report.section}.title`),
        kpi: (key: string) => t(`reporting.kpi.${key}`),
        table: (key: string) => t(`reporting.tables.${key}`),
        column: (key: string) => t(`reporting.columns.${key}`),
        quality: (key: string) => t(`reporting.quality.${key}`),
        unit: (key: string) => t(`reporting.units.${key}`),
        availability: (key: string) => t(`reporting.availability.${key}`),
        text: (value: unknown) => localizeReportingText(t, value),
        unavailable: t("reporting.unavailable"),
        locale: "it",
        metadata,
      };
      const names = Object.fromEntries(
        [
          ["areaOperativa", "areeOperative", "areaOperativaId"],
          ["centre", "centres", "centroAscoltoId"],
          ["warehouse", "warehouses", "magazzinoId"],
          ["mensa", "mense", "mensaId"],
          ["zone", "zones", "zonaUdsId"],
        ].map(([key, list, id]) => [
          key,
          prepared.options[list].find(
            (row: { id: number }) => row.id === prepared.report.filters[id],
          )?.nome,
        ]),
      );
      exports.exportReportingWorkbook(
        "same-dataset",
        prepared.report,
        labels,
        names,
        prepared.detail,
        prepared.datasetId,
      );
      return {
        kpi: prepared.report.kpi.map(
          (k: {
            key: string;
            exactValue: string | null;
            unit: string;
            availability: string;
          }) => [
            labels.kpi(k.key),
            k.exactValue ?? labels.unavailable,
            labels.unit(k.unit),
            labels.availability(k.availability),
          ],
        ),
        unavailable: labels.unavailable,
      };
    }, dataset);
    await (await sameDownload).saveAs(`${output}/${section}-same-dataset.xlsx`);
    await writeFile(
      `${output}/${section}-expected.json`,
      JSON.stringify(expected, null, 2),
    );
    const sameWorkbook = XLSX.read(
      await readFile(`${output}/${section}-same-dataset.xlsx`),
    );
    const summary = XLSX.utils.sheet_to_json<unknown[]>(
      sameWorkbook.Sheets["00_Riepilogo"],
      { header: 1 },
    );
    expect(summary).toContainEqual(["Dataset", dataset.datasetId]);
    for (const [label, exact, unit] of expected.kpi)
      expect(
        summary.some(
          (row) => row[0] === label && row[1] === exact && row[2] === unit,
        ),
      ).toBe(true);
    const excelDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Esporta in Excel (XLSX)", exact: true })
      .click();
    await (await excelDownload).saveAs(`${output}/${section}.xlsx`);
    const workbook = XLSX.read(await readFile(`${output}/${section}.xlsx`));
    expect(workbook.SheetNames).toContain("00_Riepilogo");
    if (section === "magazzino-logistica") {
      expect(
        dataset.report.tables.find(
          (t: { key: string }) => t.key === "disponibilitaCorrente",
        ).rows,
      ).toHaveLength(301);
      expect(
        XLSX.utils.sheet_to_json(workbook.Sheets.disponibilitaCorrente),
      ).toHaveLength(301);
    }
  }
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Stampa PDF", exact: true }).click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("link", { name: "Esporta in PDF", exact: true }),
  ).toHaveAttribute("href", /^blob:/);
  await expect(popup.locator("iframe")).toHaveAttribute(
    "src",
    (await popup.getByRole("link").getAttribute("href")) as string,
  );
  await popup.close();
  await page.evaluate(() => {
    window.open = () => null;
  });
  await page.getByRole("button", { name: "Stampa PDF", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Anteprima bloccata" }),
  ).toBeVisible();
  if (info.project.name === "desktop-1440x900") {
    for (const language of ["en", "es", "fr", "de", "ar"] as const) {
      await page.evaluate(
        (lng) => localStorage.setItem("ms-lang", lng),
        language,
      );
      await page.goto("/report/mensa?da=2026-01-01&a=2026-12-31");
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", {
          name: base[language].common.exportPdf,
          exact: true,
        })
        .click();
      await (await download).saveAs(`${output}/mensa-${language}.pdf`);
    }
    await page.evaluate(() => localStorage.setItem("ms-lang", "it"));
    await page.goto("/report/mensa?da=2026-01-01&a=2026-12-31");
  }
  expect(errors).toEqual([]);
  // Real logout, previously loaded report retained on screen: generation must fail.
  await expect(
    page.getByRole("button", { name: "Esporta in PDF", exact: true }),
  ).toBeEnabled();
  expect((await page.request.post("/api/auth/logout")).status()).toBe(204);
  const response = page.waitForResponse((r) =>
    r.url().includes("/api/report/prepare"),
  );
  await page
    .getByRole("button", { name: "Esporta in PDF", exact: true })
    .click();
  expect([401, 403]).toContain((await response).status());
});
