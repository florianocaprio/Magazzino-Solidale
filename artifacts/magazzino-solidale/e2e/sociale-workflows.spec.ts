import { expect, test } from "@playwright/test";
import { login, selectOption } from "./helpers";

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
    .getByRole("menuitem", { name: /pianifica nuovo intervento/i })
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
  await form
    .getByLabel("Data pianificata")
    .fill(`${new Date().getUTCFullYear() + 1}-10-15`);
  await form.getByLabel("Ora pianificata").fill("10:30");

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
  const detail = page.getByRole("dialog", { name: /dettaglio intervento/i });
  // M5C1-R1 keeps the new intervention open in the matching list. Verify the
  // actual record by closing and reopening it, not just a tab counter.
  await expect(detail).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("vista") === "pianificati" &&
      url.searchParams.get("interventoId") === String(created.id),
  );
  await detail.getByRole("button", { name: "Close", exact: true }).click();

  const result = page.locator(
    `[data-testid="interventi-desktop-list"] [data-intervento-id="${created.id}"]`,
  );
  await expect(result).toBeVisible();
  await result.click();
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


test("BUG05: Emporio con risposta persa e doppio invio, retry sullo stesso beneficiario", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440x900", "Lifecycle mutante desktop una volta");
  await login(page);
  const areas = await (await page.request.get("/api/aree-operative")).json();
  const area = areas.find((item: Area) => item.nome === "Area Demo");
  const centres = await (await page.request.get("/api/centri-ascolto")).json();
  const centre = centres.find((item: { areaOperativaId: number; attivo: boolean }) => item.areaOperativaId === area.id && item.attivo);
  let creates = 0, rights = 0, personId = 0;
  page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/beneficiari") creates++; });
  await page.route("**/api/emporio/beneficiari/*/abilitazione", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    rights++;
    const response = await route.fetch();
    expect(response.status(), await response.text()).toBe(200);
    personId = Number(new URL(route.request().url()).pathname.split("/")[4]);
    await route.abort("failed");
  });
  await page.goto("/beneficiari");
  await page.getByRole("button", { name: /nuovo beneficiario/i }).click();
  const form = page.getByRole("dialog", { name: /nuovo beneficiario/i });
  await form.getByRole("textbox", { name: /^nome$/i }).fill("Persona");
  await form.getByRole("textbox", { name: /^cognome$/i }).fill(`BUG05Browser${Date.now()}`);
  await form.getByLabel(/data di nascita/i).fill("1990-01-01");
  await selectOption(page, form.getByRole("combobox", { name: /^sesso/i }), "Maschio");
  await selectOption(page, form.getByRole("combobox", { name: /area.*provenienza/i }), "UE");
  await selectOption(page, form.getByRole("combobox", { name: "Area *", exact: true }), area.nome);
  await selectOption(page, form.getByRole("combobox", { name: /centro di ascolto di riferimento/i }), centre.nome);
  await form.getByRole("switch", { name: /abilita all.emporio/i }).click();
  await form.getByRole("textbox", { name: /motivo/i }).fill("Verifica sintetica BUG05");
  await form.locator("form").evaluate((element) => { const form = element as HTMLFormElement; form.requestSubmit(); form.requestSubmit(); });
  await expect(form).toContainText(/persona già creata/i);
  expect(creates).toBe(1); expect(rights).toBe(1); expect(personId).toBeGreaterThan(0);
  await form.getByRole("button", { name: /^riprova$/i }).click();
  await expect(form).toBeHidden();
  expect(creates).toBe(1); expect(rights).toBe(1);
  const right = await (await page.request.get(`/api/emporio/beneficiari/${personId}/abilitazione`)).json();
  expect(right.statoEffettivo).toBe("attivo");
  const cards = await (await page.request.get(`/api/beneficiari/${personId}/tessere`)).json();
  expect(cards).toEqual([]);
});
