import { expect, test } from "@playwright/test";
import { login, selectOption } from "./helpers";

type Magazzino = { id: number; nome: string };
type Prodotto = { id: number; codice: string };
type Giacenza = { prodottoId: number; disponibileReale: number };

test("Cassa Emporio forza un accesso tracciato, calcola credito e chiude la spesa una sola volta", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440x900",
    "Il lifecycle mutante gira una volta; la matrice viewport è coperta separatamente",
  );
  await login(page);

  const [warehousesResponse, productsResponse] = await Promise.all([
    page.request.get("/api/magazzini"),
    page.request.get("/api/prodotti"),
  ]);
  const warehouse = ((await warehousesResponse.json()) as Magazzino[]).find(
    (item) => item.nome === "Magazzino Demo Emporio",
  )!;
  const product = ((await productsResponse.json()) as Prodotto[]).find(
    (item) => item.codice === "DEMO-RISO-1KG",
  )!;
  const readStock = async () => {
    const response = await page.request.get(
      `/api/giacenze?magazzinoId=${warehouse.id}`,
    );
    return (
      ((await response.json()) as Giacenza[]).find(
        (item) => item.prodottoId === product.id,
      )?.disponibileReale ?? 0
    );
  };
  const stockBefore = await readStock();
  expect(stockBefore).toBeGreaterThan(0);

  await page.goto("/emporio/cassa");
  await selectOption(
    page,
    page.getByRole("combobox", { name: /area operativa/i }),
    "Area Demo",
  );
  await selectOption(
    page,
    page.getByRole("combobox", { name: /^emporio$/i }),
    "Magazzino Demo Emporio",
  );
  const beneficiarySearch = page.getByRole("textbox", {
    name: /cerca beneficiario per nome/i,
  });
  await beneficiarySearch.fill("DEMO-BEN-001");
  const beneficiary = page
    .getByRole("button")
    .filter({ hasText: "DEMO-BEN-001" });
  await expect(beneficiary).toBeVisible();
  await beneficiary.click();

  await page.getByRole("button", { name: /sì, forza accesso/i }).click();
  const forceDialog = page.getByRole("dialog", {
    name: /pianificazione non presente/i,
  });
  await forceDialog
    .getByPlaceholder(/motivo accesso forzato/i)
    .fill("Presenza operativa verificata dal lifecycle E2E");
  const forcePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/cassa-emporio/accessi/forza") &&
      response.request().method() === "POST",
  );
  await forceDialog.getByRole("button", { name: /sì, forza accesso/i }).click();
  const forceResponse = await forcePromise;
  expect(forceResponse.status()).toBe(201);
  const forced = (await forceResponse.json()) as {
    origineAccesso: string;
    sessione: {
      id: number;
      versione: number;
      saldoCreditoIniziale: number;
    };
  };
  expect(forced.origineAccesso).toBe("forzato_da_cassa");
  await expect(
    page.getByText("Sessione aperta", { exact: true }),
  ).toBeVisible();

  const productSearch = page.getByPlaceholder(
    /cerca prodotto per nome, codice o codice a barre/i,
  );
  await productSearch.fill("DEMO-RISO-1KG");
  const addLinePromise = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/api/cassa-emporio/sessioni/${forced.sessione.id}/righe`) &&
      response.request().method() === "POST",
  );
  await productSearch.press("Enter");
  expect((await addLinePromise).status()).toBe(201);
  await expect(page.getByText("Riso Demo 1kg", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/credito residuo previsto/i).locator(".."),
  ).toContainText(/49(?:,00)?/);

  const preparePromise = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(
          `/api/cassa-emporio/sessioni/${forced.sessione.id}/pronta-per-chiusura`,
        ) && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /prepara chiusura/i }).click();
  expect((await preparePromise).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: /chiudi spesa emporio/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /chiudi spesa emporio/i }).click();

  const closeDialog = page.getByRole("dialog", {
    name: /conferma chiusura spesa/i,
  });
  const closePromise = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/api/cassa-emporio/sessioni/${forced.sessione.id}/chiudi`) &&
      response.request().method() === "POST",
  );
  await closeDialog
    .getByRole("button", { name: /chiudi spesa emporio/i })
    .click();
  const closeResponse = await closePromise;
  expect(closeResponse.status()).toBe(200);
  const closed = (await closeResponse.json()) as {
    sessione: { id: number; statoSessione: string; versione: number };
    spesa: {
      id: number;
      totaleCreditoConsumati: number;
      saldoPrima: number;
      saldoDopo: number;
      bollaId: number;
      scaricoId: number;
    };
  };
  expect(closed.sessione).toMatchObject({
    id: forced.sessione.id,
    statoSessione: "chiusa",
  });
  expect(closed.spesa).toMatchObject({
    totaleCreditoConsumati: 1,
    saldoPrima: forced.sessione.saldoCreditoIniziale,
    saldoDopo: forced.sessione.saldoCreditoIniziale - 1,
  });
  expect(closed.spesa.bollaId).toBeGreaterThan(0);
  expect(closed.spesa.scaricoId).toBeGreaterThan(0);
  await expect(
    page.getByText("Spesa Emporio chiusa correttamente", { exact: true }),
  ).toBeVisible();
  expect(await readStock()).toBe(stockBefore - 1);

  const duplicateClose = await page.request.post(
    `/api/cassa-emporio/sessioni/${forced.sessione.id}/chiudi`,
    { data: { versione: closed.sessione.versione } },
  );
  expect(duplicateClose.status()).toBe(400);
  expect(await readStock()).toBe(stockBefore - 1);
});
