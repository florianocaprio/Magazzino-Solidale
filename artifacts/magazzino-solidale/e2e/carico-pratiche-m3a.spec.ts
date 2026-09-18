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
  unitaMisura: string;
  lottoFisicoObbligatorio: boolean;
  gestioneScadenza: boolean;
};
type Stock = { prodottoId: number; giacenzaFisica: number };
type LogicalLot = { id: number; isGenerale: boolean };
type Movement = { id: number; quantita: number };
type PhysicalLot = {
  codiceLotto: string | null;
  dataScadenza: string | null;
  quantitaResidua: number;
};

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
    const [areasResponse, productsResponse] = await Promise.all([
      page.request.get("/api/aree-operative"),
      page.request.get("/api/prodotti"),
    ]);
    let area = ((await areasResponse.json()) as Area[]).find(
      (item) => item.attivo,
    );
    if (!area) {
      const areaResponse = await page.request.post("/api/aree-operative", {
        data: { nome: `M3A Area E2E ${suffix}` },
      });
      expect(areaResponse.status()).toBe(201);
      area = (await areaResponse.json()) as Area;
    }
    const warehousesResponse = await page.request.get("/api/magazzini");
    let warehouse = ((await warehousesResponse.json()) as Warehouse[]).find(
      (item) => item.areaOperativaId === area.id && item.stato === "attivo",
    );
    if (!warehouse) {
      const warehouseResponse = await page.request.post("/api/magazzini", {
        data: {
          nome: `M3A Magazzino E2E ${suffix}`,
          areaOperativaId: area.id,
        },
      });
      expect(warehouseResponse.status()).toBe(201);
      warehouse = (await warehouseResponse.json()) as Warehouse;
    }
    let product = ((await productsResponse.json()) as Product[]).find(
      (item) =>
        item.attivo && !item.lottoFisicoObbligatorio && !item.gestioneScadenza,
    );
    if (!product) {
      const productResponse = await page.request.post("/api/prodotti", {
        data: {
          nome: `Prodotto M3A E2E ${suffix}`,
          tipoProdotto: "alimentare",
          unitaMisura: "pz",
          quantitaFrazionabile: false,
          lottoFisicoObbligatorio: false,
          gestioneScadenza: false,
        },
      });
      expect(productResponse.status()).toBe(201);
      product = (await productResponse.json()) as Product;
    }
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
    await expect(resumedPage.getByRole("checkbox")).toBeDisabled();
    await expect(
      resumedPage.getByRole("button", { name: /registra nuove righe/i }),
    ).toBeDisabled();
    await resumedPage
      .getByRole("button", { name: /salva bozza/i })
      .last()
      .click();
    await expect(resumedPage.getByRole("checkbox")).toBeEnabled();
    await expect(resumedPage.getByRole("checkbox")).toBeChecked();
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
      resumedPage.getByText(`80.00 ${product.unitaMisura}`, { exact: true }),
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

  test("blocca quantità, lotto e scadenza locali finché la riga non è salvata e protegge la sidebar", async ({
    page,
  }) => {
    const suffix = Date.now();
    const description = `Pratica M3A stale draft ${suffix}`;
    const [areasResponse, warehousesResponse] = await Promise.all([
      page.request.get("/api/aree-operative"),
      page.request.get("/api/magazzini"),
    ]);
    const area = ((await areasResponse.json()) as Area[]).find(
      (item) => item.attivo,
    )!;
    const warehouse = ((await warehousesResponse.json()) as Warehouse[]).find(
      (item) => item.areaOperativaId === area.id && item.stato === "attivo",
    )!;
    const logicalLotsResponse = await page.request.get(
      `/api/lotti-logici?areaOperativaId=${area.id}`,
    );
    const generalLot = (
      (await logicalLotsResponse.json()) as LogicalLot[]
    ).find((item) => item.isGenerale)!;
    expect(area).toBeTruthy();
    expect(warehouse).toBeTruthy();
    expect(generalLot).toBeTruthy();

    const productResponse = await page.request.post("/api/prodotti", {
      data: {
        nome: `Prodotto stale draft ${suffix}`,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
        quantitaFrazionabile: false,
        lottoFisicoObbligatorio: true,
        gestioneScadenza: true,
      },
    });
    expect(productResponse.status()).toBe(201);
    const product = (await productResponse.json()) as Product;

    const practiceResponse = await page.request.post("/api/carico-pratiche", {
      data: {
        areaOperativaId: area.id,
        magazzinoId: warehouse.id,
        lottoLogicoId: generalLot.id,
        origineCarico: "DONAZIONE",
        dataCarico: "2026-09-17",
        descrizione: description,
        righe: [
          {
            prodottoId: product.id,
            fondoOrigine: "NESSUN_FONDO",
            quantita: "5",
            codiceLottoProduttore: "LOT-A",
            dataScadenza: "2027-12-31",
          },
        ],
      },
    });
    expect(practiceResponse.status()).toBe(201);
    const practice = (await practiceResponse.json()) as {
      id: number;
      righe: Array<{ id: number }>;
    };

    const readStock = async () => {
      const response = await page.request.get(
        `/api/giacenze?areaOperativaId=${area.id}&magazzinoId=${warehouse.id}`,
      );
      expect(response.ok()).toBe(true);
      return (
        ((await response.json()) as Stock[]).find(
          (item) => item.prodottoId === product.id,
        )?.giacenzaFisica ?? 0
      );
    };
    const readMovements = async () => {
      const response = await page.request.get(
        `/api/movimenti?magazzinoId=${warehouse.id}&prodottoId=${product.id}`,
      );
      expect(response.ok()).toBe(true);
      return (await response.json()) as Movement[];
    };

    expect(await readStock()).toBe(0);
    expect(await readMovements()).toHaveLength(0);
    await page.goto("/carico-merce");
    await openPracticeFromList(page, area, description);

    const quantity = page.getByLabel(/quantità/i);
    await expect(quantity).toHaveValue("5.00");
    await quantity.fill("8");
    await page.getByLabel("Codice lotto produttore").fill("LOT-B");
    await page.getByLabel("Scadenza effettiva").fill("2028-01-31");

    const register = page.getByRole("button", {
      name: /registra nuove righe/i,
    });
    await expect(register).toBeDisabled();
    await expect(
      page.getByText(
        "Salva le modifiche alle righe selezionate prima di registrare la merce.",
      ),
    ).toBeVisible();

    await page
      .getByRole("link", { name: /giacenze/i })
      .first()
      .click();
    const unsavedDialog = page.getByRole("alertdialog", {
      name: /modifiche non salvate/i,
    });
    await expect(unsavedDialog).toBeVisible();
    await unsavedDialog
      .getByRole("button", { name: /resta e continua/i })
      .click();
    await expect(page).toHaveURL(/\/carico-merce$/);
    await expect(quantity).toHaveValue("8");

    const staleDetailResponse = await page.request.get(
      `/api/carico-pratiche/${practice.id}`,
    );
    const staleDetail = (await staleDetailResponse.json()) as {
      righe: Array<{
        quantita: string;
        codiceLottoProduttore: string | null;
        dataScadenza: string | null;
      }>;
      integrazioni: unknown[];
    };
    expect(staleDetail.righe[0]).toMatchObject({
      quantita: "5.00",
      codiceLottoProduttore: "LOT-A",
      dataScadenza: "2027-12-31",
    });
    expect(staleDetail.integrazioni).toHaveLength(0);
    expect(await readStock()).toBe(0);
    expect(await readMovements()).toHaveLength(0);

    const saveResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(
            `/api/carico-pratiche/${practice.id}/righe/${practice.righe[0].id}`,
          ) && response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: /salva bozza/i })
      .last()
      .click();
    expect((await saveResponse).status()).toBe(200);
    await expect(register).toBeEnabled();

    await register.click();
    const registrationResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/carico-pratiche/${practice.id}/registra`) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /registra nuove righe/i })
      .click();
    expect((await registrationResponse).status()).toBe(201);

    const persistedResponse = await page.request.get(
      `/api/carico-pratiche/${practice.id}`,
    );
    const persisted = (await persistedResponse.json()) as {
      righe: Array<{
        quantita: string;
        codiceLottoProduttore: string | null;
        dataScadenza: string | null;
      }>;
      integrazioni: unknown[];
    };
    expect(persisted.righe[0]).toMatchObject({
      quantita: "8.00",
      codiceLottoProduttore: "LOT-B",
      dataScadenza: "2028-01-31",
    });
    expect(persisted.integrazioni).toHaveLength(1);
    expect(await readStock()).toBe(8);
    expect(await readMovements()).toHaveLength(1);
    expect((await readMovements())[0].quantita).toBe(8);

    const lotsResponse = await page.request.get(
      `/api/lotti?magazzinoId=${warehouse.id}&prodottoId=${product.id}`,
    );
    expect(lotsResponse.ok()).toBe(true);
    expect((await lotsResponse.json()) as PhysicalLot[]).toEqual([
      expect.objectContaining({
        codiceLotto: "LOT-B",
        dataScadenza: "2028-01-31",
        quantitaResidua: 8,
      }),
    ]);
  });
});
