import { expect, test } from "@playwright/test";
import { login, selectOption } from "./helpers";

type Magazzino = { id: number; nome: string; areaOperativaId: number };
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

  test("Catalogo resta anagrafico e preserva la scelta esplicita sulla frazionabilità", async ({
    page,
  }) => {
    const suffix = Date.now();
    await page.goto("/prodotti");
    await expect(
      page.getByRole("heading", { name: /catalogo prodotti/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^carica$/i })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("combobox", { name: /magazzino/i }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: /nuovo prodotto/i }).click();
    const sheet = page.getByRole("dialog", { name: /nuovo prodotto/i });
    const fractional = sheet.getByRole("switch", {
      name: /quantità frazionabile/i,
    });
    await expect(fractional).not.toBeChecked();

    const unit = sheet.getByRole("combobox", { name: /unità.*misura/i });
    await selectOption(page, unit, /chilogrammi/i);
    await expect(fractional).toBeChecked();
    await fractional.click();
    await expect(fractional).not.toBeChecked();
    await selectOption(page, unit, /pezzi/i);
    await selectOption(page, unit, /chilogrammi/i);
    await expect(fractional).not.toBeChecked();
    await expect(
      sheet.getByRole("switch", { name: /lotto fisico obbligatorio/i }),
    ).not.toBeChecked();

    await sheet.getByLabel(/^nome$/i).fill(`Prodotto Catalogo E2E ${suffix}`);
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/prodotti") &&
        response.request().method() === "POST",
    );
    await sheet.getByRole("button", { name: /crea prodotto/i }).click();
    const response = await createResponse;
    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({
      unitaMisura: "kg",
      quantitaFrazionabile: false,
      lottoFisicoObbligatorio: false,
    });
    await expect(sheet).toBeHidden();
  });

  test("Carico multi-riga valida lotto/scadenza, contabilizza e protegge il draft", async ({
    page,
  }) => {
    const suffix = Date.now();
    const lotCode = `LOT-E2E-CARICO-${suffix}`;
    const warehouses = await page.request.get("/api/magazzini");
    expect(warehouses.status()).toBe(200);
    const warehouse = (await warehouses.json()).find(
      (w: { nome: string }) => w.nome === "Magazzino Demo Principale",
    );
    const areas = await page.request.get("/api/aree-operative");
    expect(areas.status()).toBe(200);
    const area = (await areas.json()).find(
      (a: { id: number }) => a.id === warehouse.areaOperativaId,
    );
    const createdProduct = await page.request.post("/api/prodotti", {
      data: {
        nome: `Carico con tracciabilità ${suffix}`,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
        quantitaFrazionabile: false,
        lottoFisicoObbligatorio: true,
        gestioneScadenza: true,
      },
    });
    expect(createdProduct.status()).toBe(201);
    const product = await createdProduct.json();
    await page.goto("/carico-merce");
    await page
      .getByRole("button", { name: "Nuova pratica", exact: true })
      .click();
    await page
      .getByLabel("Descrizione", { exact: true })
      .fill("draft E2E da preservare");
    await page
      .getByRole("button", { name: "Torna all'elenco", exact: true })
      .click();
    await expect(
      page.getByRole("alertdialog", { name: /modifiche non salvate/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /resta e continua/i }).click();
    await expect(page.getByLabel("Descrizione", { exact: true })).toHaveValue(
      "draft E2E da preservare",
    );
    await page
      .getByLabel("Descrizione", { exact: true })
      .fill(`Carico E2E ${suffix}`);

    await selectOption(
      page,
      page.getByRole("combobox", { name: "Area Operativa", exact: true }),
      area.nome,
    );
    await selectOption(
      page,
      page.getByRole("combobox", {
        name: "Magazzino destinazione",
        exact: true,
      }),
      "Magazzino Demo Principale",
    );
    await page
      .getByRole("button", { name: "Apertura Pratica", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Inserimento prodotti", exact: true })
      .click();
    await page
      .getByLabel("Cerca per nome, codice o barcode")
      .fill(product.codice);
    await page
      .getByRole("button", { name: new RegExp(product.codice) })
      .click();
    await page
      .getByRole("button", { name: "Chiudi pannello", exact: true })
      .click();
    const row = page
      .locator('[data-testid^="carico-row-"]')
      .filter({ hasText: product.nome });
    const register = page.getByRole("button", {
      name: "Conferma carico a magazzino",
      exact: true,
    });
    await row.getByLabel(/Quantità/).fill("0");
    await row
      .getByRole("button", { name: "Inserisci Prodotto", exact: true })
      .click();
    await expect(
      row.getByText("La quantità deve essere maggiore di zero.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(register).toBeDisabled();

    await row.getByLabel(/Quantità/).fill("3");
    await row
      .getByRole("button", { name: "Inserisci Prodotto", exact: true })
      .click();
    await expect(
      row.getByText("Per questo prodotto è obbligatorio il codice lotto.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      row.getByText("Inserisci la scadenza.", { exact: true }),
    ).toBeVisible();
    await expect(register).toBeDisabled();

    await row
      .getByRole("textbox", { name: "Codice lotto produttore", exact: true })
      .fill(lotCode);
    await row
      .getByLabel("Scadenza effettiva")
      .fill(`${new Date().getUTCFullYear() + 2}-12-31`);
    await row
      .getByRole("button", { name: "Inserisci Prodotto", exact: true })
      .click();
    await expect(row.getByRole("checkbox")).toBeChecked();
    await register.click();
    const createResponse = page.waitForResponse(
      (response) =>
        /\/api\/carico-pratiche\/\d+\/registra$/.test(response.url()) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Conferma carico", exact: true })
      .click();
    expect((await createResponse).status()).toBe(201);
    await expect(
      page.getByText("Carico registrato a magazzino", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alertdialog")).toBeHidden();

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
      `/api/giacenze?areaOperativaId=${warehouse.areaOperativaId}&magazzinoId=${warehouse.id}`,
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
    await expect(
      sheet.getByRole("combobox", { name: /magazzino/i }),
    ).toBeDisabled();
    await selectOption(
      page,
      sheet.getByRole("combobox", { name: "Area", exact: true }),
      "Area Demo",
    );
    await expect(sheet.getByRole("combobox", { name: /centro/i })).toHaveCount(
      0,
    );
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
    expect(created.request().postDataJSON()).not.toHaveProperty(
      "centroAscoltoId",
    );
    await expect(
      page.getByRole("dialog", { name: /bolla creata/i }),
    ).toBeVisible();

    const stockAfterResponse = await page.request.get(
      `/api/giacenze?areaOperativaId=${warehouse.areaOperativaId}&magazzinoId=${warehouse.id}`,
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
    const readStock = async (warehouse: Magazzino) => {
      const response = await page.request.get(
        `/api/giacenze?areaOperativaId=${warehouse.areaOperativaId}&magazzinoId=${warehouse.id}`,
      );
      return (
        ((await response.json()) as Giacenza[]).find(
          (item) => item.prodottoId === product.id,
        )?.disponibileReale ?? 0
      );
    };
    const originBefore = await readStock(origin);
    const destinationBefore = await readStock(destination);

    await page.goto("/trasferimenti");
    await page.getByRole("button", { name: /^nuovo$/i }).click();
    await page
      .getByRole("dialog", { name: /nuovo documento operativo/i })
      .getByRole("button", { name: /trasferimenti/i })
      .click();
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
    await selectOption(
      page,
      sheet.getByRole("combobox", { name: /lotto fisico 1/i }),
      /LOT-DEMO-001/,
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

    const row = page.getByRole("row").filter({ hasText: created.codice });
    await row.click();
    const detail = page.getByRole("dialog", {
      name: /dettaglio trasferimento/i,
    });
    const prepareResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/trasferimenti/${created.id}/prepara`) &&
        response.request().method() === "POST",
    );
    await detail.getByRole("button", { name: /segna pronto/i }).click();
    expect((await prepareResponse).status()).toBe(200);
    await expect(detail).toContainText(/pronto/i);
    // Pronto riserva una unità: il disponibile cala, lo stock fisico solo ad Avvia.
    expect(await readStock(origin)).toBe(originBefore - 1);

    const dispatchResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/trasferimenti/${created.id}/avvia`) &&
        response.request().method() === "POST",
    );
    await detail.getByRole("button", { name: /avvia/i }).click();
    expect((await dispatchResponse).status()).toBe(200);
    await expect(detail).toContainText(/in transito/i);
    expect(await readStock(origin)).toBe(originBefore - 1);

    const receiveResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/trasferimenti/${created.id}/conferma`) &&
        response.request().method() === "POST",
    );
    await detail.getByRole("button", { name: /conferma ric/i }).click();
    expect((await receiveResponse).status()).toBe(200);
    await expect(detail).toContainText(/completato/i);
    expect(await readStock(destination)).toBe(destinationBefore + 1);
    await expect(
      detail.getByRole("button", { name: /conferma ric/i }),
    ).toHaveCount(0);
  });
});
