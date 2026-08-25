import { expect, test, type Page } from "@playwright/test";

const username = process.env.E2E_USERNAME ?? "sadmin";
const password = process.env.E2E_PASSWORD;

async function login(page: Page) {
  if (!password) throw new Error("E2E_PASSWORD is required");
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function assertViewportSafe(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const undersizedButtons = await page.locator("button:visible").evaluateAll((buttons) =>
    buttons
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return { text: button.textContent?.trim(), width: rect.width, height: rect.height };
      })
      .filter(({ width, height }) => width < 44 || height < 44),
  );
  expect(undersizedButtons).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("dashboard e navigazione operativa rispettano il viewport", async ({ page }) => {
  await expect(page.locator("h1").first()).toBeVisible();
  await assertViewportSafe(page);

  await page.goto("/consegne");
  await expect(page.locator("h1").first()).toBeVisible();
  await assertViewportSafe(page);
});

test("filtri Consegne sono utilizzabili da mobile e tablet portrait", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 1024, "Il filtro Sheet è il flusso portrait");
  await page.goto("/consegne");
  await page.getByRole("button", { name: /filtri e ricerca/i }).click();
  await expect(page.getByRole("heading", { name: /filtri consegne/i })).toBeVisible();
  await page.getByLabel(/ricerca/i).fill("inesistente-e2e");
  await page.getByRole("button", { name: /mostra risultati/i }).click();
  await expect(page.locator("p:visible, td:visible").filter({ hasText: /nessuna consegna/i })).toBeVisible();
  await assertViewportSafe(page);
});
