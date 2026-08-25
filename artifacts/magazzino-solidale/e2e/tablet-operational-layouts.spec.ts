import { expect, test } from "@playwright/test";
import { assertViewportSafe, login, selectOption } from "./helpers";

type Area = { id: number; nome: string };
type Beneficiario = { id: number; codice: string };

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("Consegne, Sociale e UDS usano card sotto 1024px", async ({
  page,
  viewport,
}, testInfo) => {
  const compact = (viewport?.width ?? 0) < 1024;
  const areasResponse = await page.request.get("/api/aree-operative");
  expect(areasResponse.ok()).toBe(true);
  const area = ((await areasResponse.json()) as Area[]).find(
    (item) => item.nome === "Area Demo",
  );
  expect(area, "seed sintetico Area Demo mancante").toBeDefined();

  const beneficiariResponse = await page.request.get(
    "/api/beneficiari?search=DEMO-BEN-001",
  );
  expect(beneficiariResponse.ok()).toBe(true);
  const beneficiario = (
    (await beneficiariResponse.json()) as Beneficiario[]
  ).find((item) => item.codice === "DEMO-BEN-001");
  expect(
    beneficiario,
    "seed sintetico Beneficiario Demo mancante",
  ).toBeDefined();

  const socialFixture = await page.request.post("/api/interventi", {
    data: {
      beneficiarioId: beneficiario!.id,
      tipoIntervento: `E2E layout ${testInfo.project.name}`,
      stato: "da_pianificare",
      ambito: "sociale",
      priorita: "normale",
    },
  });
  expect(socialFixture.status()).toBe(201);

  await page.goto("/consegne");
  if (compact) {
    await expect(page.getByTestId("consegne-mobile-list")).toBeVisible();
    await expect(page.getByTestId("consegne-desktop-list")).toBeHidden();
  } else {
    await expect(page.getByTestId("consegne-mobile-list")).toBeHidden();
    await expect(page.getByTestId("consegne-desktop-list")).toBeVisible();
  }
  await assertViewportSafe(page);

  await page.goto(`/interventi?areaOperativa=${area!.id}&vista=da_pianificare`);
  if (compact) {
    await expect(page.getByTestId("interventi-mobile-list")).toBeVisible();
    await expect(page.getByTestId("interventi-desktop-list")).toBeHidden();
  } else {
    await expect(page.getByTestId("interventi-mobile-list")).toBeHidden();
    await expect(page.getByTestId("interventi-desktop-list")).toBeVisible();
  }
  await assertViewportSafe(page);

  await page.goto("/uds/interventi");
  await selectOption(
    page,
    page.getByRole("combobox", { name: /area operativa/i }),
    "Area Demo",
  );
  const personPicker = page.getByRole("combobox", {
    name: /seleziona.*persona/i,
  });
  await personPicker.click();
  await page.getByPlaceholder(/cerca.*nome.*codice/i).fill("DEMO-BEN-001");
  const personOption = page.getByRole("option", {
    name: /Demo 001 Beneficiario/i,
  });
  await personOption.click();
  await expect(personOption).toBeHidden();
  if (compact) {
    await expect(page.getByTestId("uds-interventi-mobile")).toBeVisible();
    await expect(page.getByTestId("uds-interventi-desktop")).toBeHidden();
  } else {
    await expect(page.getByTestId("uds-interventi-mobile")).toBeHidden();
    await expect(page.getByTestId("uds-interventi-desktop")).toBeVisible();
  }
  await assertViewportSafe(page);
});

test("le altre postazioni operative restano accessibili senza overflow documento", async ({
  page,
}) => {
  for (const route of [
    "/beneficiari",
    "/scarichi",
    "/trasferimenti",
    "/emporio/cassa",
    "/mensa/postazione",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    await assertViewportSafe(page);
  }
});
