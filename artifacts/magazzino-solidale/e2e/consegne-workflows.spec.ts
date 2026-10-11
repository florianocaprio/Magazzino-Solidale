import { expect, test, type Page } from "@playwright/test";
import { assertViewportSafe, login, selectOption } from "./helpers";

type Identifiable = { id: number; nome: string; areaOperativaId: number };
type Prodotto = { id: number; codice: string };
type Giacenza = { prodottoId: number; disponibileReale: number };

async function runConsegnaLifecycle(
  page: Page,
  listTestId: "consegne-mobile-list" | "consegne-desktop-list",
  auditTablet = false,
) {
  await login(page);

  const [warehousesResponse, productsResponse] = await Promise.all([
    page.request.get("/api/magazzini"),
    page.request.get("/api/prodotti"),
  ]);
  const warehouse = ((await warehousesResponse.json()) as Identifiable[]).find(
    (item) => item.nome === "Magazzino Demo Principale",
  )!;
  const product = ((await productsResponse.json()) as Prodotto[]).find(
    (item) => item.codice === "DEMO-PASTA-500",
  )!;
  const readStock = async () => {
    const response = await page.request.get(
      `/api/giacenze?areaOperativaId=${warehouse.areaOperativaId}&magazzinoId=${warehouse.id}`,
    );
    return (
      ((await response.json()) as Giacenza[]).find(
        (item) => item.prodottoId === product.id,
      )?.disponibileReale ?? 0
    );
  };
  const stockBefore = await readStock();
  expect(stockBefore).toBeGreaterThan(0);

  await page.goto("/consegne");
  await page
    .getByRole("navigation", { name: "Stato pianificazione consegne" })
    .getByRole("button", { name: "Consegne pianificate", exact: true })
    .click();
  await expect(page.getByTestId(listTestId)).toBeVisible();
  if (auditTablet) {
    await expect(page.getByTestId("consegne-mobile-list")).toBeVisible();
    await expect(page.getByTestId("consegne-desktop-list")).toBeHidden();
    await assertViewportSafe(page);
  }
  await page.getByRole("button", { name: /pianifica consegna/i }).click();
  const planning = page.getByRole("dialog", { name: /pianifica consegna/i });
  if (auditTablet) await assertViewportSafe(page);
  await selectOption(
    page,
    planning.getByRole("combobox", { name: /area operativa/i }),
    "Area Demo",
  );
  await selectOption(
    page,
    planning.getByRole("combobox", { name: /centro di ascolto/i }),
    "Centro di Ascolto Demo",
  );
  const beneficiaryPicker = planning.getByRole("combobox", {
    name: /beneficiario/i,
  });
  await beneficiaryPicker.click();
  await page
    .getByPlaceholder("Cerca per nome o codice...", { exact: true })
    .fill("DEMO-BEN-001");
  await page.getByRole("option", { name: /Demo 001 Beneficiario/i }).click();
  await selectOption(
    page,
    planning.getByRole("combobox", { name: /magazzino di partenza/i }),
    "Magazzino Demo Principale",
  );

  const createDeliveryPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/consegne") &&
      response.request().method() === "POST",
  );
  await planning.getByRole("button", { name: /^salva$/i }).click();
  const createDeliveryResponse = await createDeliveryPromise;
  expect(createDeliveryResponse.status()).toBe(201);
  const delivery = (await createDeliveryResponse.json()) as {
    id: number;
    codice: string;
  };
  await expect(planning).toBeHidden();
  await page
    .getByRole("navigation", { name: "Stato pianificazione consegne" })
    .getByRole("button", { name: "Consegne pianificate", exact: true })
    .click();

  let row = page.locator(
    `[data-testid="${listTestId}"] [data-consegna-id="${delivery.id}"]`,
  );
  await expect(row).toContainText(delivery.codice);
  await expect(row).toBeVisible();
  if (auditTablet) await assertViewportSafe(page);
  await row.getByRole("button", { name: /crea bolla/i }).click();

  const createNote = page.getByRole("dialog", {
    name: /nuova bolla di consegna/i,
  });
  await expect(createNote).toContainText(/Demo 001 Beneficiario/i);
  await selectOption(
    page,
    createNote.getByRole("combobox", { name: /magazzino di uscita/i }),
    "Magazzino Demo Principale",
  );
  const createNotePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/bolle") &&
      response.request().method() === "POST",
  );
  await createNote.getByRole("button", { name: /^crea bolla$/i }).click();
  const createNoteResponse = await createNotePromise;
  expect(createNoteResponse.status()).toBe(201);
  const note = (await createNoteResponse.json()) as { id: number };

  const noteSheet = page.getByRole("dialog", {
    name: /bolla della consegna/i,
  });
  await expect(noteSheet).toBeVisible();
  if (auditTablet) await assertViewportSafe(page);
  await noteSheet
    .getByRole("button", { name: /aggiungi il primo prodotto/i })
    .click();
  const addProduct = page.getByRole("dialog", {
    name: /aggiungi prodotto alla bolla/i,
  });
  await selectOption(
    page,
    addProduct.getByRole("combobox", {
      name: /prodotto disponibile in magazzino/i,
    }),
    /Pasta Demo 500g/,
  );
  // Il prodotto demo richiede un lotto fisico: attraversa la selezione reale,
  // senza rimuovere il requisito di catalogo per adattare la fixture al test.
  const lotsResponse = await page.request.get(
    `/api/lotti?prodottoId=${product.id}&magazzinoId=${warehouse.id}`,
  );
  expect(lotsResponse.status()).toBe(200);
  const lots = (await lotsResponse.json()) as {
    id: number;
    codiceLotto: string;
    quantitaResidua: number;
    dataScadenza: string | null;
  }[];
  const lot = lots
    .filter(
      (item) =>
        item.quantitaResidua >= 1 &&
        (!item.dataScadenza ||
          item.dataScadenza.slice(0, 10) >=
            new Date().toISOString().slice(0, 10)),
    )
    .sort(
      (a, b) =>
        (a.dataScadenza ?? "9999").localeCompare(b.dataScadenza ?? "9999") ||
        a.id - b.id,
    )[0];
  expect(lot).toBeDefined();
  await selectOption(
    page,
    addProduct.getByRole("combobox", { name: /lotto/i }),
    new RegExp(`^${lot.codiceLotto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} —`),
  );
  // La scelta del lotto azzera intenzionalmente la quantità precedente.
  await addProduct.getByRole("spinbutton", { name: /quantità/i }).fill("1");
  await expect(
    addProduct.getByRole("button", { name: /^aggiungi$/i }),
  ).toBeEnabled();
  const addLinePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/bolle/${note.id}/righe`) &&
      response.request().method() === "POST",
  );
  await addProduct.getByRole("button", { name: /^aggiungi$/i }).click();
  const addedLine = await addLinePromise;
  expect(addedLine.status()).toBe(201);
  expect(addedLine.request().postDataJSON()).toMatchObject({ lottoId: lot.id });
  await addProduct.getByRole("button", { name: /^chiudi$/i }).click();
  await expect(noteSheet).toContainText(/Pasta Demo 500g/i);

  const confirmNotePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/bolle/${note.id}/conferma`) &&
      response.request().method() === "POST",
  );
  await noteSheet
    .getByRole("button", { name: /conferma bolla e impegna merce/i })
    .click();
  expect((await confirmNotePromise).status()).toBe(200);
  await expect(noteSheet).toContainText(/pronta per la consegna/i);
  await noteSheet
    .getByRole("button", { name: /torna a pianificazione/i })
    .click();

  row = page.locator(
    `[data-testid="${listTestId}"] [data-consegna-id="${delivery.id}"]`,
  );
  const completeButton = row.getByRole("button", {
    name: /segna come consegnata/i,
  });
  if (auditTablet) await expect(completeButton).toBeVisible();
  else await expect(row).toContainText(/pronta/i);
  await completeButton.click();
  const confirmation = page.getByRole("alertdialog", {
    name: /segna come consegnato/i,
  });
  const completePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/consegne/${delivery.id}/completa`) &&
      response.request().method() === "POST",
  );
  await confirmation
    .getByRole("button", { name: /conferma consegna/i })
    .click();
  const completed = await completePromise;
  expect(completed.status()).toBe(200);

  await expect(row).toContainText(/consegnata/i);
  await expect(
    row.getByRole("button", { name: /segna come consegnata/i }),
  ).toHaveCount(0);
  const [finalDeliveryResponse, finalNoteResponse] = await Promise.all([
    page.request.get(`/api/consegne/${delivery.id}`),
    page.request.get(`/api/bolle/${note.id}`),
  ]);
  expect(await finalDeliveryResponse.json()).toMatchObject({
    id: delivery.id,
    stato: "effettuata",
  });
  expect(await finalNoteResponse.json()).toMatchObject({
    id: note.id,
    stato: "consegnato",
    consegnaId: delivery.id,
  });
  expect(await readStock()).toBe(stockBefore - 1);
  const replay = await page.request.post(
    `/api/consegne/${delivery.id}/completa`,
    {
      data: completed.request().postDataJSON(),
    },
  );
  expect(replay.status()).toBe(200);
  expect(await readStock()).toBe(stockBefore - 1);
}

test("Consegna pianificata → Bolla FEFO → conferma → consegna scarica la merce una sola volta", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440x900",
    "Il lifecycle mutante desktop gira una volta",
  );
  await runConsegnaLifecycle(page, "consegne-desktop-list");
});

test("tablet 768: completa la Consegna dalla card fino allo scarico finale", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "tablet-portrait-768x1024",
    "Lifecycle tablet Consegne dedicato al portrait 768",
  );
  await runConsegnaLifecycle(page, "consegne-mobile-list", true);
});
