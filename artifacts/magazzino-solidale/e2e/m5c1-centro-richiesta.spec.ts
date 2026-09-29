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
