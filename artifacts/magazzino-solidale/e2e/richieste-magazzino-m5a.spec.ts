import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// UI-only contract fixture. Login still requires an explicitly isolated E2E DB;
// these interceptions never create operational data.
test("M5A: unica coda, campi sociali minimi e 409 senza perdita del bisogno", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/richieste-magazzino*", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "RICHIESTA_CONFLITTO",
          error: "Versione superata",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, page: 1, limit: 30 }),
    });
  });
  await page.route("**/api/beneficiari?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 987654321,
          codice: "BEN-TEST",
          nome: "Ada",
          cognome: "Prova",
          attivo: true,
        },
      ]),
    });
  });
  await page.goto("/richieste-magazzino");
  await expect(page.getByTestId("richieste-magazzino-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Richieste al Magazzino" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Nuova richiesta" }).click();
  await page
    .getByRole("combobox", { name: "Beneficiario" })
    .selectOption("987654321");
  await page
    .getByLabel("Descrizione del bisogno")
    .fill("Bisogno da conservare");
  await expect(
    page.getByText("Le note operative saranno visibili al Magazzino."),
  ).toBeVisible();
  await expect(
    page.getByLabel(/quantità|lotto|magazzino di evasione/i),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Invia al Magazzino" }).click();
  await expect(page.getByRole("alert")).toContainText("Versione superata");
  await expect(page.getByLabel("Descrizione del bisogno")).toHaveValue(
    "Bisogno da conservare",
  );
  await expect(page).not.toHaveURL(/Bisogno da conservare/);
});

test("M5A: coda condivisa, presa in carico e annullamento motivato", async ({
  page,
}) => {
  await login(page);
  let state: "inviata" | "presa_in_carico" | "annullata" = "inviata";
  let version = 1;
  const observed: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/richieste-magazzino**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      observed.push({ path, body });
      if (path.endsWith("/presa-in-carico")) state = "presa_in_carico";
      else if (path.endsWith("/annulla")) state = "annullata";
      version += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 101,
          codice: "RM-00000101",
          stato: state,
          versione: version,
        }),
      });
      return;
    }
    if (path.endsWith("/storico")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
      return;
    }
    const item = {
      id: 101,
      codice: "RM-00000101",
      tipoDestinatario: "beneficiario",
      destinatarioNomeSnapshot: "Test Ada",
      areaNomeSnapshot: "Area A",
      centroNomeSnapshot: "Centro A",
      bisogno: "Bisogno test",
      priorita: "normale",
      modalitaPreferita: "da_definire",
      stato: state,
      versione: version,
      interventoId: null,
      noteOperative: null,
      dataDesiderata: null,
      presoInCaricoCodiceSnapshot: state === "inviata" ? null : "MAG-TEST",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        path.endsWith("/101")
          ? item
          : { items: [item], total: 1, page: 1, limit: 30 },
      ),
    });
  });
  await page.goto("/richieste-magazzino");
  await page.getByRole("button", { name: /RM-00000101/ }).click();
  await page.getByRole("button", { name: "Prendi in carico" }).click();
  await expect(page.getByText(/Presa in carico da: MAG-TEST/)).toBeVisible();
  await page
    .getByRole("textbox", { name: "Motivo dell'annullamento" })
    .fill("Necessità cessata");
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  expect(observed).toHaveLength(2);
  expect(observed[0].path).toMatch(/presa-in-carico$/);
  expect(observed[0].body).toMatchObject({ versione: 1 });
  expect(observed[0].body.idempotencyKey).toBeTruthy();
  expect(observed[1].path).toMatch(/annulla$/);
  expect(observed[1].body).toMatchObject({
    versione: 2,
    motivo: "Necessità cessata",
  });
  expect(observed[1].body.idempotencyKey).toBeTruthy();
});
