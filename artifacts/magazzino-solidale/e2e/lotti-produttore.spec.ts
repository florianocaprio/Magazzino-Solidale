import { blocco07 } from "../src/lib/i18n/namespaces/blocco07";
import { expect, test } from "@playwright/test";
import { login, selectOption } from "./helpers";

test("BUG18 — preregistrazione senza stock, filtro origine e riuso sulla pratica", async ({
  page,
}, testInfo) => {
  await login(page);
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const areaResponse = await page.request.post("/api/aree-operative", {
    data: { nome: `Area LP ${suffix}` },
  });
  expect(areaResponse.status()).toBe(201);
  const area = await areaResponse.json();
  const warehouseResponse = await page.request.post("/api/magazzini", {
    data: { nome: `Deposito LP ${suffix}`, areaOperativaId: area.id },
  });
  expect(warehouseResponse.status()).toBe(201);
  const warehouse = await warehouseResponse.json();
  const productResponse = await page.request.post("/api/prodotti", {
    data: {
      nome: `Prodotto LP ${suffix}`,
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
      lottoFisicoObbligatorio: true,
      gestioneScadenza: true,
      fsePlus: true,
    },
  });
  expect(productResponse.status()).toBe(201);
  const product = await productResponse.json();
  const stockUrl = `/api/giacenze?areaOperativaId=${area.id}&magazzinoId=${warehouse.id}`;
  const stock = await (await page.request.get(stockUrl)).json();
  await page.goto(`/carico-merce?tab=lotti&magazzinoId=${warehouse.id}`);
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Area Operativa", exact: true }),
    area.nome,
  );
  await page
    .getByRole("button", { name: "Pre-registra lotto", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Pre-registra lotto" });
  await expect(
    dialog.getByText(/La preregistrazione non carica merce/),
  ).toBeVisible();
  await expect(dialog.locator('input[type="number"]')).toHaveCount(0);
  await selectOption(
    page,
    dialog.locator("#master-product"),
    new RegExp(product.nome),
  );
  const code = `LP-00-${suffix}`;
  await dialog.locator("#master-code").fill(code);
  await dialog.locator("#master-expiry").fill("2028-12-31");
  await dialog.locator("#master-manufacturer").fill("Fabbrica prova");
  await page.screenshot({
    path: testInfo.outputPath("preregistrazione.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await dialog
    .getByRole("button", { name: "Pre-registra lotto", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByTestId(/^producer-master-/).filter({ hasText: code }),
  ).toBeVisible();
  await expect(
    page.getByText("Creato manualmente", { exact: true }),
  ).toBeVisible();
  expect(await (await page.request.get(stockUrl)).json()).toEqual(stock);
  const registry = await (
    await page.request.get(
      `/api/lotti-produttore?areaOperativaId=${area.id}&prodottoId=${product.id}`,
    )
  ).json();
  expect(registry.items).toHaveLength(1);
  expect(registry.items[0].numeroPartiteVisibili).toBe(0);
  const master = registry.items[0];
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Origine anagrafica" }),
    "Automatico",
  );
  await expect(
    page.getByTestId(/^producer-master-/).filter({ hasText: code }),
  ).toHaveCount(0);
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Origine anagrafica" }),
    "Creato manualmente",
  );
  await expect(
    page.getByTestId(/^producer-master-/).filter({ hasText: code }),
  ).toBeVisible();
  const logical = await (
    await page.request.get(`/api/lotti-logici?areaOperativaId=${area.id}`)
  ).json();
  const description = `Pratica LP ${suffix}`;
  const response = await page.request.post("/api/carico-pratiche", {
    data: {
      areaOperativaId: area.id,
      magazzinoId: warehouse.id,
      lottoLogicoId: logical.find((l: { isGenerale: boolean }) => l.isGenerale)
        .id,
      origineCarico: "DONAZIONE",
      dataCarico: "2026-10-20",
      descrizione: description,
      righe: [
        {
          prodottoId: product.id,
          fondoOrigine: "NESSUN_FONDO",
          quantita: "2",
          codiceLottoProduttore: code,
          dataScadenza: "2028-12-31",
          lottoProduttoreId: master.id,
        },
      ],
    },
  });
  expect(response.status()).toBe(201);
  const practice = await response.json();
  expect(practice.righe[0].lottoProduttoreId).toBe(master.id);
  await page.goto("/carico-merce");
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Area Operativa", exact: true }),
    area.nome,
  );
  await page
    .locator(".rounded-xl.border.bg-card")
    .filter({ hasText: description })
    .getByRole("button", { name: "Apri pratica", exact: true })
    .click();
  // The persisted selection remains visible after a full page navigation.
  await expect(page.getByText(`#${master.id}`, { exact: true })).toBeVisible();
  const secondResponse = await page.request.post("/api/lotti-produttore", {
    data: {
      areaOperativaId: area.id,
      prodottoId: product.id,
      codiceLotto: code + "-B",
      dataScadenza: "2028-12-31",
      idempotencyKey: `lp-${suffix}`,
    },
  });
  expect(secondResponse.status()).toBe(201);
  const second = await secondResponse.json();
  await page.getByRole("button", { name: "Scollega selezione" }).click();
  await page
    .locator(`[id="carico-lot-${practice.righe[0].id}"]`)
    .fill(code + "-B");
  await page
    .getByRole("button", { name: "Cerca lotto preregistrato o già utilizzato" })
    .click();
  await page
    .getByRole("button")
    .filter({ hasText: code + "-B" })
    .click();
  await expect(page.getByText(`#${second.id}`, { exact: true })).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(
          `/carico-pratiche/${practice.id}/righe/${practice.righe[0].id}`,
        ) && response.request().method() === "PATCH",
  );
  await page
    .getByRole("button", { name: "Inserisci Prodotto", exact: true })
    .click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  expect(savedResponse.request().postDataJSON().lottoProduttoreId).toBe(
    second.id,
  );
  const persisted = await (
    await page.request.get(`/api/carico-pratiche/${practice.id}`)
  ).json();
  expect(persisted.righe[0].lottoProduttoreId).toBe(second.id);
  expect(await (await page.request.get(stockUrl)).json()).toEqual(stock);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});

test("BUG18 — preregistrazione nelle sei lingue senza overflow o campi stock", async ({
  page,
}, testInfo) => {
  await login(page);
  for (const language of ["it", "en", "es", "fr", "de", "ar"] as const) {
    await page.evaluate(
      (value) => localStorage.setItem("ms-lang", value),
      language,
    );
    await page.goto("/carico-merce?tab=lotti");
    await page
      .getByRole("button", {
        name: blocco07[language].preregister,
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: blocco07[language].preregister,
    });
    await expect(
      dialog.getByText(blocco07[language].noStock, { exact: true }),
    ).toBeVisible();
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await expect(dialog.locator('input[type="number"]')).toHaveCount(0);
    expect(await page.locator("html").getAttribute("lang")).toBe(language);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    if (language === "ar")
      await page.screenshot({
        path: testInfo.outputPath("preregistrazione-ar.png"),
        fullPage: true,
        animations: "disabled",
      });
    await page.keyboard.press("Escape");
  }
});
