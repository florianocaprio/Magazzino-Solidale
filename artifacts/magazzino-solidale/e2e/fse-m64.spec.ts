import { expect, test } from "@playwright/test";
import { login, selectOption } from "./helpers";

test.describe("M6.4 — reporting verticale", () => {
  test("API reale: reporting e redirect Carico Merce sono raggiungibili", async ({
    page,
  }) => {
    await login(page);
    const response = await page.request.get("/api/magazzini");
    expect(response.status()).toBe(200);
    const warehouse = (await response.json()).find(
      (row: { areaOperativaId: number | null }) => row.areaOperativaId != null,
    );
    expect(warehouse).toBeTruthy();
    const ready = page.waitForResponse(
      (r) =>
        r.url().includes("/api/fse/rendicontazione/preview") &&
        r.status() === 200,
    );
    await page.goto(
      `/report/fse-plus?magazzinoId=${warehouse.id}&da=2026-01-01&a=2026-10-31`,
    );
    await ready;
    const panel = page.getByRole("region", {
      name: "Rendicontazione FSE+",
      exact: true,
    });
    await expect(
      panel.getByRole("tab", { name: "Da rendicontare", exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("tab", { name: "Da rendicontare", exact: true })
      .click();
    await expect(
      panel.getByRole("combobox", { name: "Filtro stato rendicontazione" }),
    ).toBeVisible();
    await panel.getByRole("tab", { name: "Panoramica", exact: true }).click();
    await panel.getByRole("link", { name: /Apri import AGEA/ }).click();
    await expect(page).toHaveURL(/\/carico-merce/);
    await expect(
      page
        .getByRole("navigation", { name: "Sezioni di Carico Merce" })
        .getByRole("link", { name: "Carichi", exact: true }),
    ).toBeVisible();
  });

  test("UI con API simulate: 51 testate, 201 righe e cambio contesto", async ({
    page,
  }) => {
    await login(page);
    const warehouses = (
      await (await page.request.get("/api/magazzini")).json()
    ).filter(
      (row: { areaOperativaId: number | null }) => row.areaOperativaId != null,
    );
    expect(warehouses.length).toBeGreaterThanOrEqual(2);
    const warehouse = warehouses[0];
    const pages: string[] = [];
    await page.route("**/api/fse/exportazioni**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/fse/exportazioni") return route.continue();
      pages.push(url.search);
      const pageNumber = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("pageSize"));
      const rows = Array.from({ length: 51 }, (_, index) => ({
        id: 1001 + index,
        formatCode: "FSE_CANONICAL_AUDIT_XLSX_V1",
        stato: "BOZZA_GENERATA",
        dataDa: "2026-10-01",
        dataA: "2026-10-31",
      }));
      await route.fulfill({
        json: {
          page: pageNumber,
          pageSize,
          total: rows.length,
          rows: rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        },
      });
    });
    await page.route("**/api/fse/riconciliazioni**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/301/righe")) {
        pages.push(url.search);
        const pageNumber = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("pageSize"));
        const rows = Array.from({ length: 201 }, (_, index) => ({
          id: 2001 + index,
          businessKey: `M64-LINE-${index + 1}`,
          status: "SOLO_AGEA",
        }));
        return route.fulfill({
          json: {
            page: pageNumber,
            pageSize,
            total: 201,
            rows: rows.slice(
              (pageNumber - 1) * pageSize,
              pageNumber * pageSize,
            ),
          },
        });
      }
      if (url.pathname.endsWith("/301"))
        return route.fulfill({
          json: { id: 301, versione: 1, stato: "DA_RIVEDERE" },
        });
      return route.fulfill({
        json: {
          total: 1,
          page: 1,
          pageSize: 20,
          rows: [{ id: 301, stato: "DA_RIVEDERE", businessKey: "M64-RECON" }],
        },
      });
    });
    await page.goto(
      `/report/fse-plus?magazzinoId=${warehouse.id}&da=2026-01-01&a=2026-10-31`,
    );
    const panel = page.getByRole("region", {
      name: "Rendicontazione FSE+",
      exact: true,
    });
    await panel.getByRole("tab", { name: "Esportazioni", exact: true }).click();
    await panel.getByRole("button", { name: "Pagina successiva" }).click();
    await expect(panel.getByText("21–40 / 51", { exact: false })).toBeVisible();
    await panel.getByRole("button", { name: "Pagina successiva" }).click();
    await expect(panel.getByText("#1051 ·", { exact: false })).toBeVisible();
    expect(
      pages.some((value) => new URLSearchParams(value).get("page") === "3"),
    ).toBe(true);
    await panel
      .getByRole("tab", { name: "Riconciliazioni", exact: true })
      .click();
    await panel.getByRole("button", { name: "Seleziona", exact: true }).click();
    for (let next = 2; next <= 11; next++) {
      await panel.getByRole("button", { name: "Pagina successiva" }).click();
      await expect(
        panel.getByText(`#${2001 + (next - 1) * 20} ·`, { exact: false }),
      ).toBeVisible();
    }
    await expect(
      panel.getByText("#2201 · M64-LINE-201", { exact: true }),
    ).toBeVisible();
    expect(
      pages.some(
        (value) =>
          new URLSearchParams(value).get("page") === "11" &&
          new URLSearchParams(value).get("pageSize") === "20",
      ),
    ).toBe(true);
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Magazzino", exact: true }),
      warehouses[1].nome,
    );
    await expect(
      panel.getByText("#2201 · M64-LINE-201", { exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("tab", { name: "Panoramica", exact: true }),
    ).toHaveAttribute("data-state", "active");
    expect(
      await panel.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
});
