import { expect, test } from "@playwright/test";
import { login, selectOption } from "./helpers";

type Magazzino = { id: number; nome: string };
type Prodotto = { id: number; codice: string };
type Giacenza = { prodottoId: number; disponibileReale: number };
type Lotto = {
  id: number;
  codiceLotto: string;
  quantitaResidua: string | number;
};

test.describe("workflow Magazzino reali", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-1440x900",
      "I lifecycle mutanti girano una sola volta; la matrice viewport è separata",
    );
    await login(page);
  });

  test("Carico multi-riga valida lotto/scadenza, contabilizza e protegge il draft", async ({
    page,
  }) => {
    const suffix = Date.now();
    const lotCode = `LOT-E2E-CARICO-${suffix}`;
    await page.goto("/lotti");
    await page.getByRole("button", { name: /nuovo carico/i }).click();
    const sheet = page.getByRole("dialog", {
      name: /nuovo carico multi-riga/i,
    });
    await expect(sheet).toBeVisible();

    await page.getByLabel("Descrizione carico").fill("draft E2E da preservare");
    await sheet.getByRole("button", { name: /annulla/i }).click();
    await expect(
      page.getByRole("alertdialog", { name: /modifiche non salvate/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /resta e continua/i }).click();
    await expect(page.getByLabel("Descrizione carico")).toHaveValue(
      "draft E2E da preservare",
    );
    await page.getByLabel("Descrizione carico").fill(`Carico E2E ${suffix}`);

    await selectOption(
      page,
      page.getByRole("combobox", { name: "Magazzino carico" }),
      "Magazzino Demo Principale",
    );
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Prodotto riga 1" }),
      /Pasta Demo 500g/,
    );
    await page.getByLabel("Quantità operativa riga 1").fill("0");
    await sheet.getByRole("button", { name: /conferma carico/i }).click();
    await expect(sheet.getByRole("alert")).toContainText(/quantità positiva/i);

    await page.getByLabel("Quantità operativa riga 1").fill("3");
    await sheet.getByRole("button", { name: /conferma carico/i }).click();
    await expect(sheet.getByRole("alert")).toContainText(
      /codice lotto obbligatorio/i,
    );
    await expect(sheet.getByRole("alert")).toContainText(
      /scadenza obbligatoria/i,
    );

    await page.getByLabel("Codice lotto riga 1").fill(lotCode);
    await page.getByLabel("Scadenza riga 1").fill("2028-12-31");
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/carichi") &&
        response.request().method() === "POST",
    );
    await sheet.getByRole("button", { name: /conferma carico/i }).click();
    expect((await createResponse).status()).toBe(201);
    await expect(
      page.getByText("Carico contabilizzato", { exact: true }),
    ).toBeVisible();
    await expect(sheet).toBeHidden();

    const lottiResponse = await page.request.get("/api/lotti");
    expect(lottiResponse.ok()).toBe(true);
    const createdLot = ((await lottiResponse.json()) as Lotto[]).find(
      (lotto) => lotto.codiceLotto === lotCode,
    );
    expect(createdLot).toMatchObject({ codiceLotto: lotCode });
    expect(Number(createdLot?.quantitaResidua)).toBe(3);

    const movementsResponse = await page.request.get("/api/movimenti");
    expect(movementsResponse.ok()).toBe(true);
    const movements = (await movementsResponse.json()) as Array<{
      lottoId?: number;
      tipoMovimento: string;
    }>;
    expect(movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lottoId: createdLot!.id,
          tipoMovimento: "carico",
        }),
      ]),
    );
  });

  test("Scarico blocca l'eccesso, scala la giacenza e applica FEFO", async ({
    page,
  }) => {
    const [warehousesResponse, productsResponse] = await Promise.all([
      page.request.get("/api/magazzini"),
      page.request.get("/api/prodotti"),
    ]);
    const warehouse = ((await warehousesResponse.json()) as Magazzino[]).find(
      (item) => item.nome === "Magazzino Demo Principale",
    )!;
    const product = ((await productsResponse.json()) as Prodotto[]).find(
      (item) => item.codice === "DEMO-PASTA-500",
    )!;
    const stockBeforeResponse = await page.request.get(
      `/api/giacenze?magazzinoId=${warehouse.id}`,
    );
    const stockBefore = ((await stockBeforeResponse.json()) as Giacenza[]).find(
      (item) => item.prodottoId === product.id,
    )!;
    const lotsBeforeResponse = await page.request.get(
      `/api/lotti?magazzinoId=${warehouse.id}`,
    );
    const lotsBefore = (await lotsBeforeResponse.json()) as Lotto[];
    const firstExpiryBefore = lotsBefore.find(
      (item) => item.codiceLotto === "LOT-DEMO-001",
    )!;
    const laterLotBefore = lotsBefore.find((item) =>
      item.codiceLotto.startsWith("LOT-E2E-CARICO-"),
    )!;

    await page.goto("/scarichi");
    await page.getByRole("button", { name: /^nuovo$/i }).click();
    const sheet = page.getByRole("dialog", { name: /nuovo scarico/i });
    await selectOption(
      page,
      sheet.getByRole("combobox", { name: /magazzino/i }),
      "Magazzino Demo Principale",
    );
    await selectOption(
      page,
      sheet.getByRole("combobox", { name: /causale/i }),
      /deteriorata/i,
    );
    await selectOption(
      page,
      sheet.getByRole("combobox", { name: /prodotto 1/i }),
      /Pasta Demo 500g/,
    );
    const quantity = sheet.getByRole("spinbutton", { name: /quantità 1/i });
    await quantity.fill(String(stockBefore.disponibileReale + 1));
    await expect(sheet.getByText(/massimo disponibile/i)).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /registra e genera bolla/i }),
    ).toBeDisabled();

    await quantity.fill("1");
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/scarichi") &&
        response.request().method() === "POST",
    );
    await sheet
      .getByRole("button", { name: /registra e genera bolla/i })
      .click();
    const created = await createResponse;
    expect(created.status()).toBe(201);
    await expect(
      page.getByRole("dialog", { name: /bolla creata/i }),
    ).toBeVisible();

    const stockAfterResponse = await page.request.get(
      `/api/giacenze?magazzinoId=${warehouse.id}`,
    );
    const stockAfter = ((await stockAfterResponse.json()) as Giacenza[]).find(
      (item) => item.prodottoId === product.id,
    )!;
    expect(stockAfter.disponibileReale).toBe(stockBefore.disponibileReale - 1);

    const lotsAfterResponse = await page.request.get(
      `/api/lotti?magazzinoId=${warehouse.id}`,
    );
    const lotsAfter = (await lotsAfterResponse.json()) as Lotto[];
    expect(
      Number(
        lotsAfter.find((item) => item.id === firstExpiryBefore.id)
          ?.quantitaResidua,
      ),
    ).toBe(Number(firstExpiryBefore.quantitaResidua) - 1);
    expect(
      Number(
        lotsAfter.find((item) => item.id === laterLotBefore.id)
          ?.quantitaResidua,
      ),
    ).toBe(Number(laterLotBefore.quantitaResidua));
  });

  test("Trasferimento completa richiesto → in transito → ricevuto senza duplicare stock", async ({
    page,
  }) => {
    const [warehousesResponse, productsResponse] = await Promise.all([
      page.request.get("/api/magazzini"),
      page.request.get("/api/prodotti"),
    ]);
    const warehouses = (await warehousesResponse.json()) as Magazzino[];
    const origin = warehouses.find(
      (item) => item.nome === "Magazzino Demo Principale",
    )!;
    const destination = warehouses.find(
      (item) => item.nome === "Magazzino Demo Emporio",
    )!;
    const product = ((await productsResponse.json()) as Prodotto[]).find(
      (item) => item.codice === "DEMO-PASTA-500",
    )!;
    const readStock = async (warehouseId: number) => {
      const response = await page.request.get(
        `/api/giacenze?magazzinoId=${warehouseId}`,
      );
      return (
        ((await response.json()) as Giacenza[]).find(
          (item) => item.prodottoId === product.id,
        )?.disponibileReale ?? 0
      );
    };
    const originBefore = await readStock(origin.id);
    const destinationBefore = await readStock(destination.id);

    await page.goto("/trasferimenti");
    await page.getByRole("button", { name: /^nuovo$/i }).click();
    const sheet = page.getByRole("dialog", { name: /nuovo trasferimento/i });
    await selectOption(
      page,
      sheet.getByRole("combobox", { name: /magazzino di partenza/i }),
      "Magazzino Demo Principale",
    );
    await selectOption(
      page,
      sheet.getByRole("combobox", { name: /magazzino di destinazione/i }),
      "Magazzino Demo Emporio",
    );
    await selectOption(
      page,
      sheet.getByRole("combobox", { name: /trasportatore/i }),
      /altro/i,
    );
    await sheet
      .getByPlaceholder(/nome.*trasportatore/i)
      .fill("Corriere sintetico E2E");
    await selectOption(
      page,
      sheet.getByRole("combobox", { name: /prodotto 1/i }),
      /Pasta Demo 500g/,
    );
    const quantity = sheet.getByRole("spinbutton", { name: /quantità 1/i });
    await quantity.fill(String(originBefore + 1));
    await expect(sheet.getByText(/massimo disponibile/i)).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /crea e genera bolla/i }),
    ).toBeDisabled();
    await quantity.fill("1");

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/trasferimenti") &&
        response.request().method() === "POST",
    );
    await sheet.getByRole("button", { name: /crea e genera bolla/i }).click();
    const createdResponse = await createResponse;
    expect(createdResponse.status()).toBe(201);
    const created = (await createdResponse.json()) as {
      id: number;
      codice: string;
    };
    await page.getByRole("button", { name: /chiudi/i }).click();

    let row = page.getByRole("row").filter({ hasText: created.codice });
    const dispatchResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/trasferimenti/${created.id}/avvia`) &&
        response.request().method() === "POST",
    );
    await row.getByRole("button", { name: /avvia/i }).click();
    expect((await dispatchResponse).status()).toBe(200);
    await expect(row).toContainText(/in transito/i);
    expect(await readStock(origin.id)).toBe(originBefore - 1);

    row = page.getByRole("row").filter({ hasText: created.codice });
    const receiveResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/trasferimenti/${created.id}/conferma`) &&
        response.request().method() === "POST",
    );
    await row.getByRole("button", { name: /conferma ric/i }).click();
    expect((await receiveResponse).status()).toBe(200);
    await expect(row).toContainText(/completato/i);
    expect(await readStock(destination.id)).toBe(destinationBefore + 1);
    await expect(
      row.getByRole("button", { name: /conferma ric/i }),
    ).toHaveCount(0);
  });
});
