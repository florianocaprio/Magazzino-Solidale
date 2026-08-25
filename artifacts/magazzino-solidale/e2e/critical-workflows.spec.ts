import { expect, test } from "@playwright/test";
import { assertViewportSafe, login } from "./helpers";

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("dashboard e navigazione operativa rispettano il viewport", async ({
  page,
}) => {
  await expect(page.locator("h1").first()).toBeVisible();
  await assertViewportSafe(page);

  await page.goto("/consegne");
  await expect(page.locator("h1").first()).toBeVisible();
  await assertViewportSafe(page);

  const menuTrigger = page
    .locator('button[aria-haspopup="menu"]:visible')
    .first();
  if (await menuTrigger.count()) {
    await menuTrigger.click();
    await expect(
      page.locator('[role="menuitem"]:visible').first(),
    ).toBeVisible();
    await assertViewportSafe(page);
    await page.keyboard.press("Escape");
  }
});

test("filtri Consegne sono utilizzabili da mobile e tablet portrait", async ({
  page,
  viewport,
}) => {
  test.skip(
    (viewport?.width ?? 0) >= 1024,
    "Il filtro Sheet è il flusso portrait",
  );
  await page.goto("/consegne");
  await page.getByRole("button", { name: /filtri e ricerca/i }).click();
  await expect(
    page.getByRole("heading", { name: /filtri consegne/i }),
  ).toBeVisible();
  await page.getByLabel(/ricerca/i).fill("inesistente-e2e");
  await page.getByRole("button", { name: /mostra risultati/i }).click();
  await expect(
    page
      .locator("p:visible, td:visible")
      .filter({ hasText: /nessuna consegna/i }),
  ).toBeVisible();
  await assertViewportSafe(page);
});
