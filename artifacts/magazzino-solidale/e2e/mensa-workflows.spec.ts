import { expect, test } from "@playwright/test";
import { login, selectOption } from "./helpers";

type Named = { id: number; nome: string };
type Mensa = Named & { codice: string };

test("Mensa autorizza una persona temporanea, registra il pasto e rende il replay idempotente", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440x900",
    "Il lifecycle mutante gira una volta; la matrice viewport è coperta separatamente",
  );
  await login(page);

  const [areasResponse, centersResponse, canteensResponse] = await Promise.all([
    page.request.get("/api/aree-operative"),
    page.request.get("/api/centri-ascolto"),
    page.request.get("/api/mensa/mense"),
  ]);
  const area = ((await areasResponse.json()) as Named[]).find(
    (item) => item.nome === "Area Demo",
  )!;
  const center = ((await centersResponse.json()) as Named[]).find(
    (item) => item.nome === "Centro di Ascolto Demo",
  )!;
  let canteen = ((await canteensResponse.json()) as Mensa[]).find(
    (item) => item.codice === "MEN-E2E-OPERATIVA",
  );
  if (!canteen) {
    const response = await page.request.post("/api/mensa/mense", {
      data: {
        codice: "MEN-E2E-OPERATIVA",
        nome: "Mensa E2E Operativa",
        areaOperativaId: area.id,
        centroAscoltoId: center.id,
        indirizzo: "Via Sintetica 1",
        comune: "Roma",
        note: "Fixture sintetica Playwright",
      },
    });
    expect(response.status()).toBe(201);
    canteen = (await response.json()) as Mensa;
  }

  const suffix = Date.now();
  await page.goto("/mensa/postazione");
  await selectOption(
    page,
    page.getByRole("combobox", { name: /^mensa$/i }),
    "Mensa E2E Operativa",
  );
  await page
    .getByRole("button", { name: /nuova persona.*accesso temporaneo/i })
    .click();
  await page.getByLabel(/^nome$/i).fill(`Persona${suffix}`);
  await page.getByLabel(/^cognome$/i).fill("Temporanea E2E");

  await selectOption(
    page,
    page.getByRole("combobox", { name: /^sesso$/i }),
    "Altro",
  );
  await selectOption(
    page,
    page.getByRole("combobox", { name: /fascia d'età presunta/i }),
    "30–64",
  );
  await page
    .getByLabel(/motivazione/i)
    .fill("Autorizzazione temporanea operativa E2E");

  const temporaryAccessPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/mensa/accessi/temporaneo") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: /verifica e autorizza per oggi/i })
    .click();
  const temporaryAccessResponse = await temporaryAccessPromise;
  expect(temporaryAccessResponse.status()).toBe(201);
  const access = (await temporaryAccessResponse.json()) as {
    id: number;
    beneficiarioId: number;
    esito: string;
  };
  expect(access.esito).not.toBe("negato");
  await expect(page.getByRole("status")).toContainText(/accesso consentito/i);

  const mealPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/mensa/pasti") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /registra pasto/i }).click();
  const mealResponse = await mealPromise;
  expect(mealResponse.status()).toBe(201);
  const mealRequest = mealResponse.request().postDataJSON() as {
    accessoMensaId: number;
    tipoServizio: string;
    idempotencyKey: string;
  };
  const meal = (await mealResponse.json()) as {
    id: number;
    beneficiarioId: number;
  };
  expect(meal).toMatchObject({
    beneficiarioId: access.beneficiarioId,
  });
  await expect(
    page.getByText("Pasto registrato", { exact: true }),
  ).toBeVisible();

  const replay = await page.request.post("/api/mensa/pasti", {
    data: mealRequest,
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toMatchObject({
    id: meal.id,
    idempotentReplay: true,
  });
  const listResponse = await page.request.get(
    `/api/mensa/pasti?mensaId=${canteen.id}`,
  );
  expect(listResponse.ok()).toBe(true);
  const meals = (await listResponse.json()) as Array<{
    id: number;
    beneficiarioId: number;
  }>;
  expect(
    meals.filter((item) => item.beneficiarioId === access.beneficiarioId),
  ).toEqual([expect.objectContaining({ id: meal.id })]);
});
