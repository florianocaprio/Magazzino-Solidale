import { expect, test, type Page } from "@playwright/test";
import { assertViewportSafe, login, selectOption } from "./helpers";

type UdsIntervento = {
  id: number;
  descrizione: string | null;
  dataAggiornamento: string;
};

async function runUdsLifecycle(
  page: Page,
  listTestId: "uds-interventi-mobile" | "uds-interventi-desktop",
  auditTablet = false,
) {
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
  const personOption = page.getByRole("option", {
    name: /Demo 001 Beneficiario/i,
  });
  await personOption.click();
  await expect(personOption).toBeHidden();
  if (auditTablet) {
    await expect(page.getByTestId("uds-interventi-mobile")).toBeVisible();
    await expect(page.getByTestId("uds-interventi-desktop")).toBeHidden();
    await assertViewportSafe(page);
  }

  await page.getByRole("button", { name: /nuovo intervento/i }).click();
  const form = page.getByRole("dialog", {
    name: /nuovo intervento di strada/i,
  });
  if (auditTablet) await assertViewportSafe(page);
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
    `[data-testid="${listTestId}"] [data-intervento-id="${created.id}"]`,
  );
  await expect(row).toContainText(initialDescription);
  await expect(row).toContainText(
    auditTablet ? /1 cose da fare/i : /totali:\s*1/i,
  );
  if (auditTablet) await assertViewportSafe(page);
  await row.getByRole("button", { name: /rettifica/i }).click();

  const rectification = page.getByRole("dialog", {
    name: /rettifica intervento/i,
  });
  if (auditTablet) await assertViewportSafe(page);
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
}

test("UDS registra incontro e bisogno, rettifica con versione e rifiuta una versione obsoleta", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440x900",
    "Il lifecycle mutante desktop gira una volta",
  );
  await runUdsLifecycle(page, "uds-interventi-desktop");
});

test("tablet 820: crea e rettifica un intervento UDS dalla card", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "tablet-820x1180",
    "Lifecycle UDS dedicato al tablet 820",
  );
  await runUdsLifecycle(page, "uds-interventi-mobile", true);
});

test("BUG21: scheda UDS provvisoria, ristampa stabile, PATCH minime e ritorno filtrato", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440x900", "Lifecycle mutante desktop una volta");
  await login(page);
  const areas = await (await page.request.get("/api/aree-operative")).json();
  const area = areas.find((item: { nome: string }) => item.nome === "Area Demo");
  expect(area).toBeTruthy();
  const centres = await (await page.request.get("/api/centri-ascolto")).json();
  const centre = centres.find((item: { areaOperativaId: number; attivo: boolean }) => item.areaOperativaId === area.id && item.attivo);
  expect(centre).toBeTruthy();
  const zoneResponse = await page.request.post("/api/zone-uds", { data: { nome: `BUG21Zona${Date.now()}`, areaOperativaId: area.id } });
  expect(zoneResponse.status(), await zoneResponse.text()).toBe(201);
  const zone = await zoneResponse.json();
  const created = await page.request.post("/api/beneficiari", { data: { nome: "Persona", cognome: `BUG21Browser${Date.now()}`, sesso: "M", fasciaEtaPresunta: "30_64", areaProvenienza: "UE", uds: true, statoAnagrafica: "provvisoria", areaOperativaId: area.id, centroAscoltoId: null } });
  expect(created.status(), await created.text()).toBe(201);
  const person = await created.json();
  const directoryPath = `/uds/anagrafica?search=${person.cognome}`;
  await page.goto(directoryPath);
  await page.getByRole("link", { name: person.cognome, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/uds/anagrafica/${person.id}\\?ritorno=`));
  // Il riepilogo ha solo stati, senza azioni per i servizi o richieste.
  await expect(page.getByLabel("Stati dei servizi")).toBeVisible();
  await expect(page.getByRole("button", { name: /abilita all.emporio|abilita alla mensa|nuova richiesta/i })).toHaveCount(0);
  await expect(page.getByTestId("beneficiario-mensa-card")).toHaveCount(0);
  const download = page.getByRole("button", { name: /scarica tessera pdf/i });
  for (let attempt = 0; attempt < 2; attempt++) {
    const downloaded = page.waitForEvent("download");
    await download.click();
    expect((await downloaded).suggestedFilename()).toMatch(/\.pdf$/i);
  }
  const cards = await (await page.request.get(`/api/beneficiari/${person.id}/tessere`)).json();
  expect(cards).toHaveLength(1);
  // I pulsanti sono nel contenitore immediato del rispettivo selettore.
  const centrePicker = page.getByRole("combobox", { name: /centro di ascolto di riferimento/i });
  await selectOption(page, centrePicker, centre.nome);
  const centrePatch = page.waitForRequest((request) => request.method() === "PATCH" && new URL(request.url()).pathname === `/api/beneficiari/${person.id}`);
  await centrePicker.locator("..").getByRole("button", { name: /^salva$/i }).click();
  expect(Object.keys((await centrePatch).postDataJSON()).sort()).toEqual(["centroAscoltoId", "versione"]);
  const zonePicker = page.getByRole("combobox", { name: /^zona uds$/i });
  await selectOption(page, zonePicker, zone.nome);
  const zonePatch = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/beneficiari/${person.id}`);
  await zonePicker.locator("..").getByRole("button", { name: /^salva$/i }).click();
  const response = await zonePatch;
  expect(response.status(), await response.text()).toBe(200);
  expect(Object.keys(response.request().postDataJSON()).sort()).toEqual(["versione", "zonaUdsId"]);
  await page.reload();
  await expect(zonePicker).toContainText(zone.nome);
  await expect(centrePicker).toContainText(centre.nome);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertViewportSafe(page);
  await page.getByRole("link", { name: /indietro/i }).click();
  await expect(page).toHaveURL(new RegExp(`/uds/anagrafica\\?search=${person.cognome}$`));
  await expect(page.getByRole("link", { name: person.cognome, exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: person.cognome });
  await expect(row).toContainText(zone.nome);
  await page.goto(`/beneficiari/${person.id}`);
  await expect(page.getByTestId("beneficiario-mensa-card")).toBeVisible();
});
