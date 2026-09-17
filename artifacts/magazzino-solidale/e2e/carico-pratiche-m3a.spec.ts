import { expect, test, type Page } from "@playwright/test";
import { login, selectOption } from "./helpers";

type Area = { id: number; nome: string; attivo: boolean };
type Warehouse = {
  id: number;
  nome: string;
  areaOperativaId: number | null;
  stato: string;
};
type Product = {
  id: number;
  codice: string;
  nome: string;
  attivo: boolean;
  lottoFisicoObbligatorio: boolean;
  gestioneScadenza: boolean;
};
type Stock = { prodottoId: number; giacenzaFisica: number };

async function openPracticeFromList(
  page: Page,
  area: Area,
  description: string,
) {
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Area Operativa" }),
    area.nome,
  );
  const card = page.getByText(description, { exact: true }).locator("../..");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /apri pratica/i }).click();
}

test.describe("M3A — pratica di carico persistente", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-1440x900",
      "Il lifecycle inventariale mutante gira una sola volta",
    );
    await login(page);
  });

  test("crea bozza → seconda sessione → registra 80 → riprende → aggiunge 20 → verifica 100", async ({
    page,
    browser,
  }) => {
    const suffix = Date.now();
    const description = `Pratica M3A E2E ${suffix}`;
    const [areasResponse, warehousesResponse, productsResponse] =
      await Promise.all([
        page.request.get("/api/aree-operative"),
        page.request.get("/api/magazzini"),
        page.request.get("/api/prodotti"),
      ]);
    const area = ((await areasResponse.json()) as Area[]).find(
      (item) => item.attivo,
    )!;
    const warehouse = ((await warehousesResponse.json()) as Warehouse[]).find(
      (item) => item.areaOperativaId === area.id && item.stato === "attivo",
    )!;
    const product = ((await productsResponse.json()) as Product[]).find(
      (item) =>
        item.attivo && !item.lottoFisicoObbligatorio && !item.gestioneScadenza,
    )!;
    expect(area).toBeTruthy();
    expect(warehouse).toBeTruthy();
    expect(product).toBeTruthy();

    const readStock = async (targetPage: Page) => {
      const response = await targetPage.request.get(
        `/api/giacenze?areaOperativaId=${area.id}&magazzinoId=${warehouse.id}`,
      );
      expect(response.ok()).toBe(true);
      return (
        ((await response.json()) as Stock[]).find(
          (item) => item.prodottoId === product.id,
        )?.giacenzaFisica ?? 0
      );
    };
    const before = await readStock(page);

    await page.goto("/carico-merce");
    await page.getByRole("button", { name: /nuova pratica/i }).click();
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Area Operativa" }),
      area.nome,
    );
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Magazzino destinazione" }),
      warehouse.nome,
    );
    await expect(
      page.getByRole("combobox", { name: "Raccolta / attività" }),
    ).not.toHaveText("");
    await page.getByLabel("Descrizione").fill(description);
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/carico-pratiche") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /salva bozza/i }).click();
    expect((await createResponse).status()).toBe(201);
    expect(await readStock(page)).toBe(before);

    const baseURL = new URL(page.url()).origin;
    await page.context().clearCookies();
    await page.close();
    const resumedContext = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    const resumedPage = await resumedContext.newPage();
    await login(resumedPage);
    await resumedPage.goto("/carico-merce");
    await openPracticeFromList(resumedPage, area, description);
    await resumedPage
      .getByLabel(/cerca per nome o codice/i)
      .fill(product.codice);
    await resumedPage
      .getByRole("button", { name: new RegExp(product.codice, "i") })
      .click();
    await resumedPage.getByLabel(/quantità/i).fill("80");
    await resumedPage
      .getByRole("button", { name: /salva bozza/i })
      .last()
      .click();
    await resumedPage
      .getByRole("button", { name: /registra nuove righe/i })
      .click();
    const firstRegistrationResponse = resumedPage.waitForResponse(
      (response) =>
        /\/api\/carico-pratiche\/\d+\/registra$/.test(response.url()) &&
        response.request().method() === "POST",
    );
    await resumedPage
      .getByRole("alertdialog")
      .getByRole("button", { name: /registra nuove righe/i })
      .click();
    expect((await firstRegistrationResponse).status()).toBe(201);
    await expect(
      resumedPage.getByText(/80.*già registrate|80.*pz/i),
    ).toBeVisible();
    expect(await readStock(resumedPage)).toBe(before + 80);

    await resumedPage.reload();
    await openPracticeFromList(resumedPage, area, description);
    await resumedPage
      .getByLabel(/cerca per nome o codice/i)
      .fill(product.codice);
    await resumedPage
      .getByRole("button", { name: new RegExp(product.codice, "i") })
      .click();
    await resumedPage.getByLabel(/quantità/i).fill("20");
    await resumedPage
      .getByRole("button", { name: /salva bozza/i })
      .last()
      .click();
    await resumedPage
      .getByRole("button", { name: /registra nuove righe/i })
      .click();
    const secondRegistrationResponse = resumedPage.waitForResponse(
      (response) =>
        /\/api\/carico-pratiche\/\d+\/registra$/.test(response.url()) &&
        response.request().method() === "POST",
    );
    await resumedPage
      .getByRole("alertdialog")
      .getByRole("button", { name: /registra nuove righe/i })
      .click();
    expect((await secondRegistrationResponse).status()).toBe(201);

    expect(await readStock(resumedPage)).toBe(before + 100);
    const practiceResponse = await resumedPage.request.get(
      `/api/carico-pratiche?areaOperativaId=${area.id}&q=${encodeURIComponent(description)}`,
    );
    const [practice] = (await practiceResponse.json()) as Array<{
      id: number;
    }>;
    const detailResponse = await resumedPage.request.get(
      `/api/carico-pratiche/${practice.id}`,
    );
    const detail = (await detailResponse.json()) as {
      righe: Array<{ quantita: string; registrata: boolean }>;
      integrazioni: unknown[];
    };
    expect(
      detail.righe.map((row) => [Number(row.quantita), row.registrata]),
    ).toEqual([
      [80, true],
      [20, true],
    ]);
    expect(detail.integrazioni).toHaveLength(2);

    const concurrentContext = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    const concurrentPage = await concurrentContext.newPage();
    await login(concurrentPage);
    const [sessionA, sessionB] = await Promise.all([
      resumedPage.request.get(`/api/carico-pratiche/${practice.id}`),
      concurrentPage.request.get(`/api/carico-pratiche/${practice.id}`),
    ]);
    const version = ((await sessionA.json()) as { versione: number }).versione;
    expect(((await sessionB.json()) as { versione: number }).versione).toBe(
      version,
    );
    const savedByA = await resumedPage.request.patch(
      `/api/carico-pratiche/${practice.id}`,
      { data: { versione: version, note: "Modifica dalla sessione A" } },
    );
    expect(savedByA.status()).toBe(200);
    const staleFromB = await concurrentPage.request.patch(
      `/api/carico-pratiche/${practice.id}`,
      { data: { versione: version, note: "Modifica dalla sessione B" } },
    );
    expect(staleFromB.status()).toBe(409);
    await concurrentContext.close();
    await resumedContext.close();
  });
});
