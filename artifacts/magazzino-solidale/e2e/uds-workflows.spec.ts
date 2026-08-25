import { expect, test } from "@playwright/test";
import { login, selectOption } from "./helpers";

type UdsIntervento = {
  id: number;
  descrizione: string | null;
  dataAggiornamento: string;
};

test("UDS registra incontro e bisogno, rettifica con versione e rifiuta una versione obsoleta", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440x900",
    "Il lifecycle mutante gira una volta; il layout tablet è coperto separatamente",
  );
  await login(page);
  const suffix = Date.now();
  const initialDescription = `Incontro UDS E2E ${suffix}`;
  const rectifiedDescription = `${initialDescription} rettificato`;

  await page.goto("/uds/interventi");
  await selectOption(
    page,
    page.getByRole("combobox", { name: /area operativa/i }),
    "Area Demo",
  );
  const personPicker = page.getByRole("combobox", {
    name: /seleziona una persona/i,
  });
  await personPicker.click();
  await page
    .getByPlaceholder("Cerca per nome o codice...", { exact: true })
    .fill("DEMO-BEN-001");
  await page.getByRole("option", { name: /Demo 001 Beneficiario/i }).click();

  await page.getByRole("button", { name: /nuovo intervento/i }).click();
  const form = page.getByRole("dialog", {
    name: /nuovo intervento di strada/i,
  });
  await form
    .getByRole("textbox", { name: /sintesi dell'incontro/i })
    .fill(initialDescription);
  await form
    .getByRole("textbox", { name: /materiale consegnato/i })
    .fill("Kit igiene E2E");
  await form.getByRole("button", { name: /aggiungi bisogno/i }).click();
  await form
    .getByRole("textbox", { name: /cosa serve/i })
    .fill("Ricontatto operatore E2E");
  await form.getByRole("button", { name: /^pianifica$/i }).click();
  await form.getByLabel(/data prevista/i).fill("2028-12-31");

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/uds/interventi") &&
      response.request().method() === "POST",
  );
  await form.getByRole("button", { name: /^salva$/i }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = (await createResponse.json()) as UdsIntervento;
  expect(created).toMatchObject({
    descrizione: initialDescription,
  });
  await expect(form).toBeHidden();

  const row = page.locator(
    `[data-testid="uds-interventi-desktop"] [data-intervento-id="${created.id}"]`,
  );
  await expect(row).toContainText(initialDescription);
  await expect(row).toContainText(/totali:\s*1/i);
  await row.getByRole("button", { name: /rettifica/i }).click();

  const rectification = page.getByRole("dialog", {
    name: /rettifica intervento/i,
  });
  await rectification
    .getByRole("textbox", { name: /sintesi dell'incontro/i })
    .fill(rectifiedDescription);
  await rectification
    .getByRole("textbox", { name: /motivo della rettifica/i })
    .fill("Correzione verificata dal test E2E");
  const rectifyResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/uds/interventi/${created.id}/rettifica`) &&
      response.request().method() === "PATCH",
  );
  await rectification.getByRole("button", { name: /^salva$/i }).click();
  const rectifyResponse = await rectifyResponsePromise;
  expect(rectifyResponse.status()).toBe(200);
  const rectified = (await rectifyResponse.json()) as UdsIntervento;
  expect(rectified.descrizione).toBe(rectifiedDescription);
  expect(rectified.dataAggiornamento).not.toBe(created.dataAggiornamento);
  await expect(row).toContainText(rectifiedDescription);

  const staleResponse = await page.request.patch(
    `/api/uds/interventi/${created.id}/rettifica`,
    {
      data: {
        versione: created.dataAggiornamento,
        motivo: "Tentativo con versione obsoleta",
        descrizione: "Valore che non deve essere salvato",
      },
    },
  );
  expect(staleResponse.status()).toBe(409);
  const finalResponse = await page.request.get(
    `/api/uds/interventi/${created.id}`,
  );
  expect(finalResponse.ok()).toBe(true);
  expect(await finalResponse.json()).toMatchObject({
    id: created.id,
    descrizione: rectifiedDescription,
  });
});
