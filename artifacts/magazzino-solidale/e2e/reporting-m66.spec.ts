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
  beneficiariTable,
  bolleTable,
} from "../../../lib/db/src/index";
import { base } from "../src/lib/i18n/namespaces/base";
import i18n from "../src/lib/i18n";
import {
  localizeReportingText,
  reportingColumnLabel,
} from "../src/lib/reporting-text";

const requireApi = createRequire(
  new URL("../../api-server/package.json", import.meta.url),
);
const { sql } = requireApi(
  "drizzle-orm",
) as typeof import("../../api-server/node_modules/drizzle-orm");
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
const externalRequests: string[] = [];
test.beforeEach(async ({ page }) => {
  externalRequests.length = 0;
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (["127.0.0.1", "localhost"].includes(host)) return route.fallback();
    if (host === "fonts.googleapis.com")
      return route.fulfill({
        status: 200,
        contentType: "text/css",
        body: "/* offline font fixture */",
      });
    externalRequests.push(host);
    return route.abort();
  });
});
test.afterEach(() => expect(externalRequests).toEqual([]));
const privateSentinels = [
  "PDF_PRIVATE_NAME",
  "PDF_PRIVATE_NOTE",
  "pdf-private-contact@invalid.example",
];
let username: string,
  password: string,
  areaId: number,
  userId: number,
  exactStock: string;

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
  const [user] = await db
    .insert(utentiTable)
    .values({
      username,
      nome: "Operatore sintetico reporting",
      passwordHash: await bcrypt.hash(password, 4),
      ruoloId: role.id,
      mustChangePassword: false,
    })
    .returning();
  userId = user.id;
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
  // A real database record contributing to Pacchi counts, with private fields
  // that must never be projected into the aggregate or its exported documents.
  // This is a legacy read fixture, not evidence of a stock-writing workflow.
  const [beneficiary] = await db
    .insert(beneficiariTable)
    .values({
      codice: `PII-${suffix.slice(0, 8)}`,
      nome: privateSentinels[0],
      cognome: "Synthetic",
      noteInterne: privateSentinels[1],
      email: privateSentinels[2],
      areaOperativaId: area.id,
    })
    .returning();
  await db.insert(bolleTable).values({
    numeroBolla: `PDF-PII-${suffix.slice(0, 8)}`,
    dataBolla: "2026-01-15",
    beneficiarioId: beneficiary.id,
    magazzinoId: warehouse.id,
    areaOperativaIdSnapshot: area.id,
    numeroComponentiNucleoSnapshot: 1,
    stato: "consegnato",
    destinatarioNomeSnapshot: privateSentinels[0],
    destinatarioEmailSnapshot: privateSentinels[2],
    noteConsegna: privateSentinels[1],
  });
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
  // Real PostgreSQL aggregate beyond IEEE-754 precision, never injected into the API response.
  await db.execute(sql`INSERT INTO lotti(prodotto_id,magazzino_id,codice_lotto,quantita_caricata,quantita_residua,data_carico)
    SELECT ${products[0].id},${warehouse.id},'REVIEW-'||i,99999999.123456,99999999.123456,'2026-01-15'
    FROM generate_series(1,10001) i`);
  exactStock = String(
    (
      await db.execute(
        sql`SELECT sum(quantita_residua)::text AS total FROM lotti WHERE magazzino_id=${warehouse.id}`,
      )
    ).rows[0].total,
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
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
  // Deep links and browser history must restore the actual controls, not only
  // the URL. Options failures stay explicit and are not presented as zero data.
  await page.goto("/report/mensa?da=2026-01-04&a=2026-01-20");
  await expect(page.locator("#report-da")).toHaveValue("2026-01-04");
  await page.goto("/report/uds?da=2026-02-02&a=2026-02-20");
  await expect(page.locator("#report-da")).toHaveValue("2026-02-02");
  await page.goBack();
  await expect(page.locator("#report-da")).toHaveValue("2026-01-04");
  await page.goForward();
  await expect(page.locator("#report-da")).toHaveValue("2026-02-02");
  await page.route("**/api/report/filter-options?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Synthetic options unavailable" }),
    }),
  );
  await page.reload();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /Impossibile caricare le opzioni/ }),
  ).toBeVisible({ timeout: 15000 });
  await page.unroute("**/api/report/filter-options?**");
  for (const section of sections) {
    const query = new URLSearchParams({ da: "2026-01-01", a: "2026-12-31" });
    if (section === "magazzino-logistica")
      query.set("areaOperativaId", String(areaId));
    if (section === "centro-ascolto") {
      query.set("operatoreId", String(userId));
      query.set("tipoIntervento", "Accompagnamento");
    }
    if (section === "mensa") query.set("tipoServizio", "pranzo");
    await page.goto(`/report/${section}?${query}`);
    const pdf = page.getByRole("button", {
      name: "Esporta in PDF",
      exact: true,
    });
    await expect(pdf).toBeEnabled();
    const rect = await pdf.boundingBox();
    expect(rect!.height).toBeGreaterThanOrEqual(44);
    expect(rect!.width).toBeGreaterThanOrEqual(44);
    const filterControls = page.locator(
      'input[id^="report-"], button[id^="report-"], select[id^="report-"]',
    );
    expect(await filterControls.count()).toBeGreaterThanOrEqual(3);
    for (const control of await filterControls.all()) {
      if (!(await control.isVisible())) continue;
      const bounds = await control.boundingBox();
      expect(
        bounds!.height,
        await control.getAttribute("id"),
      ).toBeGreaterThanOrEqual(44);
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
    }
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
    for (const sentinel of privateSentinels)
      expect(JSON.stringify(dataset)).not.toContain(sentinel);
    if (section === "pacchi")
      expect(
        Number(
          dataset.report.kpi.find(
            (item: { key: string }) => item.key === "pacchiDistribuiti",
          ).exactValue,
        ),
      ).toBeGreaterThanOrEqual(1);
    if (section === "dashboard")
      expect(dataset.report.series[0].secondary).toEqual({
        label: "personeMese",
        unit: "count",
      });
    if (section === "centro-ascolto")
      expect(dataset.report.filters).toMatchObject({
        operatoreId: userId,
        tipoIntervento: "Accompagnamento",
      });
    if (section === "mensa")
      expect(dataset.report.filters.tipoServizio).toBe("pranzo");
    if (section === "magazzino-logistica")
      expect(
        dataset.report.tables.find((t: { key: string }) => t.key === "giacenze")
          .rows[0].quantita,
      ).toBe(exactStock);
    await writeFile(
      `${output}/${section}.json`,
      JSON.stringify(dataset, null, 2),
    );
    await (await downloaded).saveAs(`${output}/${section}.pdf`);
    // Replay only the captured prepare response, then exercise the real built
    // UI workbook path. A second live XLSX request below checks the endpoint.
    const preparePattern = (url: URL) => url.pathname === "/api/report/prepare";
    let preparedReplayCount = 0;
    await page.route(preparePattern, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      preparedReplayCount++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(dataset),
      });
    });
    const sameDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Esporta in Excel (XLSX)", exact: true })
      .click();
    await i18n.changeLanguage("it");
    const expected = ((prepared: typeof dataset) => {
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
        column: (key: string) => reportingColumnLabel(t, key),
        quality: (key: string) => t(`reporting.quality.${key}`),
        unit: (key: string) => t(`reporting.units.${key}`),
        availability: (key: string) => t(`reporting.availability.${key}`),
        text: (value: unknown) => localizeReportingText(t, value),
        unavailable: t("reporting.unavailable"),
        locale: "it",
        metadata,
      };
      return {
        tables: prepared.report.tables.map(
          (table: {
            key: string;
            columns: string[];
            rows: Record<string, unknown>[];
          }) => ({
            key: table.key,
            title: labels.table(table.key),
            columns: table.columns.map(labels.column),
            rows: table.rows.map((row) =>
              table.columns.map((column) =>
                typeof row[column] === "string"
                  ? labels.text(row[column])
                  : (row[column] ?? labels.unavailable),
              ),
            ),
          }),
        ),
        series: prepared.report.series.map(
          (series: {
            key: string;
            points: Array<{
              label: string;
              exactValue?: string;
              value: number;
              exactSecondaryValue?: string;
              secondaryValue?: number;
            }>;
          }) => ({
            title: labels.table(series.key),
            rows: series.points.map((point) => [
              point.label,
              point.exactValue ?? String(point.value),
              point.exactSecondaryValue ??
                point.secondaryValue ??
                labels.unavailable,
            ]),
          }),
        ),
        definitions: [
          ...(prepared.report.excludedSources ?? []),
          ...prepared.report.definitions,
        ].map(labels.text),
        quality: prepared.report.quality.map(
          (item: {
            key: string;
            count: number | null;
            availability: string;
            note?: unknown;
          }) => [
            labels.quality(item.key),
            item.count ?? labels.unavailable,
            labels.availability(item.availability),
            item.note ? labels.text(item.note) : "",
          ],
        ),
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
    })(dataset);
    await (await sameDownload).saveAs(`${output}/${section}-same-dataset.xlsx`);
    await page.unroute(preparePattern);
    expect(preparedReplayCount).toBe(1);
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
    if (section === "centro-ascolto") {
      expect(summary).toContainEqual(["Operatore", String(userId)]);
      expect(summary).toContainEqual(["Tipo Intervento", "Accompagnamento"]);
    }
    if (section === "mensa")
      expect(summary).toContainEqual(["Tipo servizio", "pranzo"]);
    if (section === "magazzino-logistica")
      expect(
        XLSX.utils
          .sheet_to_json<unknown[]>(sameWorkbook.Sheets.giacenze, { header: 1 })
          .some((row) => row.includes(exactStock)),
      ).toBe(true);
    for (const [label, exact, unit] of expected.kpi)
      expect(
        summary.some(
          (row) => row[0] === label && row[1] === exact && row[2] === unit,
        ),
      ).toBe(true);
    for (const table of expected.tables) {
      const key = table.key.replace(/[\\/?*\[\]:]/g, "_").slice(0, 31);
      const values = XLSX.utils.sheet_to_json<unknown[]>(
        sameWorkbook.Sheets[key],
        { header: 1, defval: expected.unavailable },
      );
      expect(values, `${section}/${key}`).toEqual([
        table.columns,
        ...table.rows.map((row) =>
          row.map((cell) =>
            typeof cell === "string" &&
            /^[=+\-@]/.test(cell) &&
            !/^-?\d+(\.\d+)?$/.test(cell)
              ? `'${cell}`
              : cell,
          ),
        ),
      ]);
    }
    for (const [index, series] of expected.series.entries()) {
      const values = XLSX.utils.sheet_to_json<unknown[]>(
        sameWorkbook.Sheets[`Serie_${index + 1}`],
        { header: 1, defval: expected.unavailable },
      );
      expect(values.slice(2), `${section}/${series.title}`).toEqual(
        series.rows,
      );
    }
    const qualitySheet =
      section === "fse-plus" ? "08_Qualita_Dati" : "Qualita_Dati";
    expect(
      XLSX.utils
        .sheet_to_json<
          unknown[]
        >(sameWorkbook.Sheets[qualitySheet], { header: 1, defval: "" })
        .slice(1),
    ).toEqual(expected.quality);
    for (const definition of expected.definitions)
      expect(summary).toContainEqual([definition]);
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
  {
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
