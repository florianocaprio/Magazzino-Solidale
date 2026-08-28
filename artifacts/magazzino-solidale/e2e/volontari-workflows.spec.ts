import { expect, test } from "@playwright/test";
import { assertViewportSafe, login } from "./helpers";

type Role = { id: number; nome: string; attivo: boolean };
type Volunteer = { id: number; versione: number; matricola: string };

function todayRome(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("Volontari 2.0 mantiene lista, dossier e azioni accessibili", async ({
  page,
  viewport,
}, testInfo) => {
  const rolesResponse = await page.request.get("/api/ruoli-volontari");
  expect(rolesResponse.ok()).toBe(true);
  const role = ((await rolesResponse.json()) as Role[]).find(
    (item) => item.attivo,
  );
  expect(role, "seed sintetico ruolo volontario mancante").toBeDefined();

  const suffix = `${testInfo.project.name.slice(0, 8).replace(/\W/g, "-")}-${Date.now().toString(36)}`;
  const matricola = `E2E-VOL-${suffix}`;
  const createResponse = await page.request.post("/api/volontari", {
    data: {
      nome: "Ada",
      cognome: "Esempio",
      matricola,
      tipoVolontario: "PERMANENTE",
      ruoloVolontarioId: role!.id,
      email: `ada.${suffix}@example.test`,
    },
  });
  const createBody = (await createResponse.json()) as Volunteer & {
    error?: string;
  };
  expect(createResponse.status(), JSON.stringify(createBody)).toBe(201);
  const created = createBody;

  const approvalResponse = await page.request.post(
    `/api/approvazioni-logistica/volontari/${created.id}/approva`,
    { data: { versione: created.versione } },
  );
  expect(approvalResponse.ok()).toBe(true);
  const approval = (await approvalResponse.json()) as { versione: number };

  const insuranceResponse = await page.request.post(
    `/api/volontari/${created.id}/assicurazione`,
    {
      data: {
        versione: approval.versione,
        modalita: "NUOVA_DA_DATA",
        dataDecorrenza: todayRome(),
        durataMesi: 12,
        riferimentoPolizza: `POL-${suffix}`,
      },
    },
  );
  expect(insuranceResponse.status()).toBe(201);

  await page.goto("/volontari");
  await page
    .getByPlaceholder(/cerca nome, cognome o matricola/i)
    .fill(matricola);
  const compact = (viewport?.width ?? 0) < 1024;
  const visibleList = page.getByTestId(
    compact ? "volontari-mobile-list" : "volontari-desktop-list",
  );
  await expect(
    visibleList.getByText(matricola, { exact: false }),
  ).toBeVisible();

  if (compact) {
    await expect(page.getByTestId("volontari-mobile-list")).toBeVisible();
    await expect(page.getByTestId("volontari-desktop-list")).toBeHidden();
    await page.getByRole("button", { name: /scheda/i }).click();
  } else {
    await expect(page.getByTestId("volontari-mobile-list")).toBeHidden();
    await expect(page.getByTestId("volontari-desktop-list")).toBeVisible();
    await page.getByRole("button", { name: /apri scheda/i }).click();
  }
  const dossierHeading = page.getByRole("heading", { name: /esempio ada/i });
  await expect(dossierHeading).toBeVisible();
  await expect(page.getByRole("tab", { name: /anagrafica/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /operatività/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /assicurazione/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /formazione/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /storico/i })).toBeVisible();
  await assertViewportSafe(page);
  await page.getByRole("button", { name: /registra \/ rinnova/i }).click();
  const insuranceHeading = page.getByRole("heading", {
    name: /registra \/ rinnova assicurazione/i,
  });
  await expect(insuranceHeading).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(insuranceHeading).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dossierHeading).toBeHidden();

  await expect(
    page.getByRole("heading", { name: /^volontari$/i }),
  ).toBeVisible();
  await assertViewportSafe(page);
});

test("il form volontario espone tipologia e giornata temporanea", async ({
  page,
}) => {
  await page.goto("/volontari");
  await page.getByRole("button", { name: /nuovo volontario/i }).click();
  const form = page.getByRole("dialog");
  await expect(
    form.getByRole("heading", { name: /nuovo volontario/i }),
  ).toBeVisible();
  await expect(form.getByText(/identità e contatti/i)).toBeVisible();
  await form.getByText("Permanente", { exact: true }).click();
  await page.getByRole("option", { name: "Temporaneo", exact: true }).click();
  await expect(form.getByText(/prima giornata di servizio/i)).toBeVisible();
});
