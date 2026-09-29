import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD;
if (!password)
  throw new Error("E2E_PASSWORD is required for disposable M5C1 browser tests");

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password!);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("M5C1 Centro: Intervento pianificato, prefill, invio esplicito, nessuna Bolla", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "m5c1-e2e-social");
  const beneficiaryResponse = await page.request.get(
    "/api/beneficiari?search=M5C1-E2E-B1",
  );
  expect(beneficiaryResponse.status()).toBe(200);
  const beneficiary = (await beneficiaryResponse.json()).find(
    (item: { codice: string }) => item.codice === "M5C1-E2E-B1",
  );
  expect(beneficiary?.id).toBeTruthy();
  const created = await page.request.post("/api/interventi", {
    headers: { Origin: "http://web" },
    data: {
      beneficiarioId: beneficiary.id,
      ambito: "sociale",
      stato: "pianificato",
      tipoIntervento: `M5C1 E2E ${randomUUID()}`,
      priorita: "alta",
      dataOraPianificata: "2026-09-30T22:30:00Z",
      sede: "M5C1 E2E Centro",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const intervention = await created.json();
  const before = await page.request.get(
    `/api/richieste-magazzino?interventoId=${intervention.id}&stato=aperte`,
  );
  expect(before.status()).toBe(200);
  expect((await before.json()).items).toHaveLength(0);

  await page.goto(`/interventi?interventoId=${intervention.id}`);
  const detail = page.getByRole("dialog", { name: /dettaglio intervento/i });
  await expect(detail).toBeVisible();
  const requestSection = detail.getByTestId("intervento-richiesta-magazzino");
  await expect(requestSection).toContainText("Richiesta al Magazzino");
  await expect(detail.getByText("Materiale da preparare")).toHaveCount(0);
  await expect(detail.getByText("Quantità consegnata")).toHaveCount(0);
  await requestSection
    .getByRole("link", { name: "Invia richiesta al Magazzino" })
    .click();
  await expect(page).toHaveURL(new RegExp(`interventoId=${intervention.id}`));
  await expect(page.getByTestId("richieste-magazzino-page")).toBeVisible();
  await expect(page.locator("#rm-priority")).toHaveValue("alta");
  await expect(page.locator("#rm-date")).toHaveValue("2026-10-01");
  await expect(page.locator("#rm-mode")).toHaveValue("da_definire");
  await expect(page.locator("#rm-need")).toHaveValue("");
  await expect(page.getByText(`Beneficiario #${beneficiary.id}`)).toBeVisible();
  await expect(
    page.locator("#rm-warehouse, #rm-product, #rm-quantity, #rm-lot"),
  ).toHaveCount(0);
  const need = `M5C1 bisogno sintetico ${randomUUID()}`;
  await page.locator("#rm-need").fill(need);
  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/richieste-magazzino") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Invia al Magazzino" }).click();
  const sentResponse = await sent;
  expect(sentResponse.status(), await sentResponse.text()).toBe(201);
  const request = await sentResponse.json();
  const stored = await page.request.get(
    `/api/richieste-magazzino/${request.id}`,
  );
  expect(stored.status()).toBe(200);
  expect(await stored.json()).toMatchObject({
    interventoId: intervention.id,
    beneficiarioId: beneficiary.id,
    bisogno: need,
    priorita: "alta",
    dataDesiderata: "2026-10-01",
    stato: "inviata",
  });
  await page.goto(`/interventi?interventoId=${intervention.id}`);
  const afterSection = page.getByTestId("intervento-richiesta-magazzino");
  await expect(
    afterSection.getByRole("link", { name: "Apri richiesta" }),
  ).toBeVisible();
  await expect(
    afterSection.getByRole("link", { name: "Invia richiesta al Magazzino" }),
  ).toHaveCount(0);
  await page.goto("/bolle");
  await expect(
    page.getByRole("heading", { name: /bolle/i }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^nuovo$/i })).toHaveCount(0);
  await page.goto("/consegne?dal=2026-09-29&al=2026-10-02");
  await expect(
    page
      .locator(
        '[data-testid="consegne-mobile-list"]:visible, [data-testid="consegne-desktop-list"]:visible',
      )
      .getByText("M5C1-E2E-C1"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /crea bolla/i })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});

test("M5C1 grant Bolla legacy forzati: route consultiva, UI senza bypass e POST negata", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "m5c1-e2e-legacy");
  await page.goto("/bolle");
  await expect(
    page.getByRole("heading", { name: /bolle/i }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^nuovo$/i })).toHaveCount(0);
  await page.goto("/consegne?dal=2026-09-29&al=2026-10-02");
  await expect(
    page
      .locator(
        '[data-testid="consegne-mobile-list"]:visible, [data-testid="consegne-desktop-list"]:visible',
      )
      .getByText("M5C1-E2E-C1"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /crea bolla/i })).toHaveCount(
    0,
  );
  const denied = await page.request.post("/api/bolle", {
    headers: { Origin: "http://web" },
    data: { idempotencyKey: randomUUID(), beneficiarioId: 1, magazzinoId: 1 },
  });
  expect(denied.status(), await denied.text()).toBe(403);
  expect(errors).toEqual([]);
});

test("M5C1-R1: creazione da vista Annullati, dettaglio e pianificazione continui", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "m5c1-e2e-social");
  await page.goto(
    "/interventi?vista=annullati&areaOperativa=1&centro=1&q=inesistente&priorita=urgente&operatore=99999&tipo=inesistente&da=2020-01-01&a=2020-01-02&stato=annullato&legacy=legacy",
  );
  await page.getByRole("button", { name: /Nuovo intervento/i }).click();
  await page
    .getByRole("menuitem", { name: /Registra intervento da pianificare/i })
    .click();
  const form = page.getByRole("dialog", { name: /Intervento da pianificare/i });
  await expect(form).toBeVisible();
  await form.getByRole("combobox", { name: "Beneficiario" }).click();
  await page.getByRole("option", { name: /M5C1-E2E-B1/ }).click();
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/interventi") &&
      response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Salva" }).click();
  const response = await createdResponse;
  expect(response.status(), await response.text()).toBe(201);
  const created = await response.json();
  expect(created).toMatchObject({ stato: "da_pianificare" });
  expect(created.dataOraPianificata).toBeNull();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("vista"))
    .toBe("da_pianificare");
  expect(new URL(page.url()).searchParams.get("interventoId")).toBe(
    String(created.id),
  );
  expect(new URL(page.url()).searchParams.get("areaOperativa")).toBe("1");
  expect(new URL(page.url()).searchParams.get("centro")).toBe("1");
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  for (const filter of [
    "priorita",
    "operatore",
    "tipo",
    "da",
    "a",
    "stato",
    "legacy",
  ]) {
    expect(new URL(page.url()).searchParams.has(filter)).toBe(false);
  }
  const detail = page.getByRole("dialog", { name: /Dettaglio intervento/i });
  await expect(detail).toBeVisible();
  await page.reload();
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("M5C1-E2E-B1");
  await expect(
    page.locator('[role="tab"]').filter({ hasText: /Da pianificare/i }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    detail.getByRole("heading", { name: "Appuntamento" }),
  ).toBeVisible();
  await expect(
    detail.getByRole("link", { name: "Invia richiesta al Magazzino" }),
  ).toBeVisible();
  const requestsBefore = await page.request.get(
    `/api/richieste-magazzino?interventoId=${created.id}&stato=aperte`,
  );
  expect(requestsBefore.status()).toBe(200);
  expect((await requestsBefore.json()).items).toHaveLength(0);

  // The undated CTA must carry context without creating a request.
  await detail
    .getByRole("link", { name: "Invia richiesta al Magazzino" })
    .click();
  await expect(page).toHaveURL(new RegExp(`interventoId=${created.id}`));
  expect(new URL(page.url()).searchParams.get("beneficiarioId")).toBe(
    String(created.beneficiarioId),
  );
  await expect(page.locator("#rm-priority")).toHaveValue("normale");
  await expect(page.locator("#rm-date")).toHaveValue("");
  await expect(
    page.locator("#rm-warehouse, #rm-product, #rm-quantity, #rm-lot"),
  ).toHaveCount(0);
  const requestsAfterUndatedNavigation = await page.request.get(
    `/api/richieste-magazzino?interventoId=${created.id}&stato=aperte`,
  );
  expect((await requestsAfterUndatedNavigation.json()).items).toHaveLength(0);

  await page.goto(
    `/interventi?vista=da_pianificare&areaOperativa=1&centro=1&interventoId=${created.id}`,
  );
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "Close" }).click();
  const row = page.locator(`[data-intervento-id="${created.id}"]:visible`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("M5C1-E2E-B1");
  await expect(row).toContainText(created.tipoIntervento);
  await expect(row).toContainText("Normale");
  const count = async (name: RegExp) =>
    Number(
      (
        await page
          .getByRole("tab", { name })
          .locator("span")
          .last()
          .textContent()
      )?.trim(),
    );
  const beforeToPlan = await count(/Da pianificare/i);
  const beforePlanned = await count(/^Pianificati/i);
  expect(beforeToPlan).toBeGreaterThan(0);

  // Reopen from the actual list, not from an already-open detail/deep-link.
  await row.click();
  await expect(detail).toBeVisible();
  expect(new URL(page.url()).searchParams.get("interventoId")).toBe(
    String(created.id),
  );
  await detail.getByLabel("Data pianificata").fill("2026-10-15");
  await detail.getByLabel("Ora pianificata").fill("10:30");
  await detail.getByRole("button", { name: "Pianifica", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("vista"))
    .toBe("pianificati");
  await expect(detail).toBeVisible();
  expect(new URL(page.url()).searchParams.get("interventoId")).toBe(
    String(created.id),
  );
  const plannedResponse = await page.request.get(
    `/api/interventi/${created.id}`,
  );
  expect(plannedResponse.status()).toBe(200);
  const planned = await plannedResponse.json();
  expect(planned.stato).toBe("pianificato");
  expect(new Date(planned.dataOraPianificata).toISOString()).toBe(
    "2026-10-15T08:30:00.000Z",
  );
  await expect(
    detail.getByRole("link", { name: "Invia richiesta al Magazzino" }),
  ).toBeVisible();
  await page.reload();
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("M5C1-E2E-B1");
  await expect(
    page.locator('[role="tab"]').filter({ hasText: /^Pianificati/i }),
  ).toHaveAttribute("aria-selected", "true");
  await detail.getByRole("button", { name: "Close" }).click();
  await expect(detail).not.toBeVisible();
  await expect(row).toBeVisible();
  await expect(row).toContainText("M5C1-E2E-B1");
  await expect(row).toContainText("15/10/2026 10:30");
  await expect.poll(() => count(/Da pianificare/i)).toBe(beforeToPlan - 1);
  await expect.poll(() => count(/^Pianificati/i)).toBe(beforePlanned + 1);
  await page.getByRole("tab", { name: /Da pianificare/i }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("tab", { name: /^Pianificati/i }).click();
  await expect(row).toBeVisible();
  await row.click();
  await expect(detail).toBeVisible();
  await detail
    .getByRole("link", { name: "Invia richiesta al Magazzino" })
    .click();
  expect(new URL(page.url()).searchParams.get("interventoId")).toBe(
    String(created.id),
  );
  expect(new URL(page.url()).searchParams.get("beneficiarioId")).toBe(
    String(created.beneficiarioId),
  );
  await expect(page.locator("#rm-priority")).toHaveValue("normale");
  await expect(page.locator("#rm-date")).toHaveValue("2026-10-15");
  await expect(
    page.locator("#rm-warehouse, #rm-product, #rm-quantity, #rm-lot"),
  ).toHaveCount(0);
  const beforeSubmit = await page.request.get(
    `/api/richieste-magazzino?interventoId=${created.id}&stato=aperte`,
  );
  expect((await beforeSubmit.json()).items).toHaveLength(0);
  await page.locator("#rm-need").fill(`Bisogno R1 ${randomUUID()}`);
  const requestResponse = page.waitForResponse(
    (item) =>
      item.url().endsWith("/api/richieste-magazzino") &&
      item.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Invia al Magazzino" }).click();
  expect((await requestResponse).status()).toBe(201);
  const afterSubmit = await page.request.get(
    `/api/richieste-magazzino?interventoId=${created.id}&stato=aperte`,
  );
  expect((await afterSubmit.json()).items).toHaveLength(1);
  await page.goto(`/interventi?vista=pianificati&interventoId=${created.id}`);
  await expect(
    page.getByTestId("intervento-richiesta-magazzino").getByRole("link", {
      name: "Apri richiesta",
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("M5C1-R1: creazione direttamente pianificata da vista incompatibile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "m5c1-e2e-social");
  await page.goto(
    "/interventi?vista=conclusi&areaOperativa=1&centro=1&q=inesistente&priorita=urgente&stato=concluso",
  );
  await page.getByRole("button", { name: /Nuovo intervento/i }).click();
  await page
    .getByRole("menuitem", { name: /Pianifica nuovo intervento/i })
    .click();
  const form = page.getByRole("dialog", { name: /Intervento pianificato/i });
  await expect(form).toBeVisible();
  await form.getByRole("combobox", { name: "Beneficiario" }).click();
  await page.getByRole("option", { name: /M5C1-E2E-B1/ }).click();
  await form.getByLabel("Data pianificata").fill("");
  await form.getByLabel("Ora pianificata").fill("");
  await form.getByRole("button", { name: "Salva" }).click();
  await expect(form.getByText(/Campo obbligatorio/i)).toHaveCount(2);
  await form.getByLabel("Data pianificata").fill("2026-10-16");
  await form.getByLabel("Ora pianificata").fill("11:30");
  const createdResponse = page.waitForResponse(
    (item) =>
      item.url().endsWith("/api/interventi") &&
      item.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Salva" }).click();
  const response = await createdResponse;
  expect(response.status(), await response.text()).toBe(201);
  const created = await response.json();
  expect(created.stato).toBe("pianificato");
  expect(new Date(created.dataOraPianificata).toISOString()).toBe(
    "2026-10-16T09:30:00.000Z",
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.get("vista"))
    .toBe("pianificati");
  expect(new URL(page.url()).searchParams.get("interventoId")).toBe(
    String(created.id),
  );
  expect(new URL(page.url()).searchParams.get("areaOperativa")).toBe("1");
  expect(new URL(page.url()).searchParams.get("centro")).toBe("1");
  for (const filter of ["q", "priorita", "stato"]) {
    expect(new URL(page.url()).searchParams.has(filter)).toBe(false);
  }
  const detail = page.getByRole("dialog", { name: /Dettaglio intervento/i });
  await expect(detail).toBeVisible();
  await expect(
    detail.getByRole("link", { name: "Invia richiesta al Magazzino" }),
  ).toBeVisible();
  const requests = await page.request.get(
    `/api/richieste-magazzino?interventoId=${created.id}&stato=aperte`,
  );
  expect((await requests.json()).items).toHaveLength(0);
  await page.reload();
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "Close" }).click();
  const row = page.locator(`[data-intervento-id="${created.id}"]:visible`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("M5C1-E2E-B1");
  await expect(row).toContainText("16/10/2026 11:30");
  await row.click();
  await expect(detail).toBeVisible();
  await expect(
    detail.getByRole("link", { name: "Invia richiesta al Magazzino" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
