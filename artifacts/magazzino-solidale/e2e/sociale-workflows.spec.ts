import { expect, test } from "@playwright/test";
import { login } from "./helpers";

type Area = { id: number; nome: string };

test("Beneficiario → intervento pianificato → avvio → conclusione e storico", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440x900",
    "Il lifecycle mutante gira una volta; il layout tablet è coperto separatamente",
  );
  await login(page);
  const areasResponse = await page.request.get("/api/aree-operative");
  const area = ((await areasResponse.json()) as Area[]).find(
    (item) => item.nome === "Area Demo",
  )!;
  const uniqueDescription = `Intervento sociale E2E ${Date.now()}`;

  await page.goto(`/interventi?areaOperativa=${area.id}&vista=oggi`);
  await page.getByRole("button", { name: /nuovo intervento/i }).click();
  await page
    .getByRole("menuitem", { name: /nuovo intervento pianificato/i })
    .click();
  const form = page.getByRole("dialog", {
    name: /intervento pianificato/i,
  });
  await expect(form).toBeVisible();

  const beneficiaryPicker = form.getByRole("combobox", {
    name: /beneficiario/i,
  });
  await beneficiaryPicker.click();
  await page
    .getByPlaceholder("Cerca per nome o codice...", { exact: true })
    .fill("DEMO-BEN-001");
  await page.getByRole("option", { name: /Demo 001 Beneficiario/i }).click();
  await form
    .getByRole("textbox", { name: /descrizione/i })
    .fill(uniqueDescription);

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/interventi") &&
      response.request().method() === "POST",
  );
  await form.getByRole("button", { name: /^salva$/i }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = (await createResponse.json()) as { id: number };
  await expect(form).toBeHidden();

  const result = page.locator(
    `[data-testid="interventi-desktop-list"] [data-intervento-id="${created.id}"]`,
  );
  await expect(result).toBeVisible();
  await result.click();
  const detail = page.getByRole("dialog", { name: /dettaglio intervento/i });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(/pianificato/i);

  const startResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/interventi/${created.id}/avvia`) &&
      response.request().method() === "POST",
  );
  await detail.getByRole("button", { name: /avvia intervento/i }).click();
  expect((await startResponse).status()).toBe(200);
  await expect(detail).toContainText(/in corso/i);

  await detail
    .getByPlaceholder("Risultato")
    .fill("Esito operativo E2E positivo");
  await detail
    .getByRole("checkbox", {
      name: /confermo la conclusione di questo intervento/i,
    })
    .check();
  const concludeResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/interventi/${created.id}/concludi`) &&
      response.request().method() === "POST",
  );
  await detail.getByRole("button", { name: /^concludi$/i }).click();
  expect((await concludeResponse).status()).toBe(200);
  await expect(detail).toContainText(/concluso/i);
  await expect(detail.getByPlaceholder("Risultato")).toHaveValue(
    "Esito operativo E2E positivo",
  );

  const [detailResponse, historyResponse] = await Promise.all([
    page.request.get(`/api/interventi/${created.id}`),
    page.request.get(`/api/interventi/${created.id}/storico-stati`),
  ]);
  expect(detailResponse.ok()).toBe(true);
  expect(await detailResponse.json()).toMatchObject({
    id: created.id,
    stato: "concluso",
  });
  const history = (await historyResponse.json()) as Array<{
    statoNuovo: string;
  }>;
  expect(history.map((entry) => entry.statoNuovo)).toEqual(
    expect.arrayContaining(["pianificato", "in_corso", "concluso"]),
  );
});
