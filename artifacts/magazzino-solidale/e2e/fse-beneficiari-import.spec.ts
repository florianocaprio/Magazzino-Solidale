import { massivoFixture } from "../../api-server/tests/helpers/fse-massivo-workbook";
import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";
import { login, selectOption } from "./helpers";

// Current FSE+ export, with both intermediate date columns and distinct dossiers
// sharing a name. All personal data here are synthetic.
function workbook(suffix: string) {
  const headers = [
    "Nome Referente fascicolo",
    "Cognome Referente fascicolo",
    "Codice fascicolo",
    "Data di presa in carico",
    "Data Cambio Stato",
    "Data Ultimo Aggiornamento",
    "Numero componenti fascicolo",
    "Tipologia di Attività",
    "Stato attuale",
    "Donne",
    "Uomini",
    "Età<18",
    "Età 18-29",
    "Età 30-64",
    "Età>=65",
    "Origine straniera e minoranze",
    "Disabili",
    "Cittadini di Paesi Terzi",
    "Senzatetto o colpiti da esclusione abitativa",
  ];
  const rows = [1, 2].map((id) => [
    "Persona",
    `Sintetica ${suffix}`,
    `FSE-${id}-${suffix}`,
    "20/10/2026",
    "20/10/2026",
    "20/10/2026",
    1,
    "Pacchi",
    "Attivo",
    1,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    0,
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    "Table1",
  );
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

test("FSE+ beneficiari: Area prima del Centro, allegato esplicito, import e Fascicolo", async ({
  page,
}, testInfo) => {
  await login(page);
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const areas: Array<{ id: number; nome: string }> = [];
  const centres: Array<{ id: number; nome: string }> = [];
  for (const letter of ["A", "B"]) {
    const areaResponse = await page.request.post("/api/aree-operative", {
      data: { nome: `Import ${letter} ${suffix}` },
    });
    expect(areaResponse.status()).toBe(201);
    const area = await areaResponse.json();
    areas.push(area);
    const centreResponse = await page.request.post("/api/centri-ascolto", {
      data: {
        nome: `Centro ${letter} ${suffix}`,
        areaOperativaId: area.id,
        attivo: true,
      },
    });
    expect(centreResponse.status()).toBe(201);
    centres.push(await centreResponse.json());
  }
  await page.goto("/beneficiari");
  await page.getByRole("button", { name: "Importa FSE+", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Importa FSE+" });
  const areaSelect = dialog.getByRole("combobox", {
    name: "Area Operativa FSE+",
  });
  const centreSelect = dialog.getByRole("combobox", {
    name: "Centro di Ascolto FSE+",
  });
  await expect(centreSelect).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Carica e analizza" }),
  ).toBeDisabled();
  await selectOption(page, areaSelect, areas[0].nome);
  await centreSelect.click();
  await expect(
    page.getByRole("option", { name: centres[0].nome, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: centres[1].nome, exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("option", { name: centres[0].nome, exact: true })
    .click();
  const fileChooser = page.waitForEvent("filechooser");
  await dialog
    .getByRole("button", {
      name: "Seleziona file Beneficiari FSE+",
      exact: true,
    })
    .click();
  await (
    await fileChooser
  ).setFiles({
    name: "ElencoFascicoliSociali-prova.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook(suffix),
  });
  await expect(
    dialog.getByText("ElencoFascicoliSociali-prova.xlsx", { exact: true }),
  ).toBeVisible();
  expect(
    await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  const preview = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/beneficiari/fse/preview") &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Carica e analizza" }).click();
  const response = await preview;
  expect(response.status()).toBe(200);
  expect((await response.json()).numeroRighe).toBe(2);
  await expect(
    dialog.getByRole("button", { name: "Conferma importazione" }),
  ).toBeEnabled();
  // Changing Area invalidates the previous preview and forces a new centre choice.
  await selectOption(page, areaSelect, areas[1].nome);
  await expect(
    dialog.getByRole("button", { name: "Conferma importazione" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Carica e analizza" }),
  ).toBeDisabled();
  await selectOption(page, areaSelect, areas[0].nome);
  await selectOption(page, centreSelect, centres[0].nome);
  await dialog.getByRole("button", { name: "Carica e analizza" }).click();
  await expect(
    dialog.getByRole("button", { name: "Conferma importazione" }),
  ).toBeEnabled();
  const imported = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/beneficiari/fse/import") &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Conferma importazione" }).click();
  const result = await imported;
  expect(result.status()).toBe(200);
  expect({
    creati: (await result.json()).creati,
    errori: (await result.json()).errori,
  }).toEqual({ creati: 2, errori: 0 });
  await dialog.getByRole("button", { name: "Chiudi", exact: true }).click();
  const list = await (
    await page.request.get(
      `/api/beneficiari?areaOperativaId=${areas[0].id}&centroAscoltoId=${centres[0].id}`,
    )
  ).json();
  expect(list).toHaveLength(2);
  const importedDetail = await (
    await page.request.get(`/api/beneficiari/${list[0].id}`)
  ).json();
  expect(importedDetail.fascicolo).toMatch(/^FSE-[12]-/);
  const warehouseResponse = await page.request.post("/api/magazzini", {
    data: { nome: `Bolla FSE ${suffix}`, areaOperativaId: areas[0].id },
  });
  expect(warehouseResponse.status()).toBe(201);
  const warehouse = await warehouseResponse.json();
  const bollaResponse = await page.request.post("/api/bolle", {
    data: {
      idempotencyKey: `fse-bolla-${suffix}`,
      tipoDestinatario: "beneficiario",
      beneficiarioId: list[0].id,
      magazzinoId: warehouse.id,
      contestoBeneficiarioAtteso: {
        areaOperativaId: areas[0].id,
        centroAscoltoId: centres[0].id,
      },
    },
  });
  expect(bollaResponse.status()).toBe(201);
  const bolla = await bollaResponse.json();
  const bollaDetail = await (
    await page.request.get(`/api/bolle/${bolla.id}`)
  ).json();
  expect(bollaDetail.beneficiarioFascicolo).toBe(importedDetail.fascicolo);
  await page.goto(`/beneficiari/${list[0].id}`);
  await expect(
    page.getByText(new RegExp(`Fascicolo: FSE-[12]-${suffix}`)),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("fascicolo-importato.png"),
    fullPage: true,
  });
});

test("Fascicolo facoltativo inserito manualmente e modificato nell’anagrafica", async ({
  page,
}, testInfo) => {
  await login(page);
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const areaResponse = await page.request.post("/api/aree-operative", {
    data: { nome: `Manuale ${suffix}` },
  });
  expect(areaResponse.status()).toBe(201);
  const area = await areaResponse.json();
  const centreResponse = await page.request.post("/api/centri-ascolto", {
    data: {
      nome: `Centro manuale ${suffix}`,
      areaOperativaId: area.id,
      attivo: true,
    },
  });
  expect(centreResponse.status()).toBe(201);
  const centre = await centreResponse.json();
  const created = await page.request.post("/api/beneficiari", {
    data: {
      nome: "Persona",
      cognome: "Manuale",
      sesso: "F",
      dataNascita: "1990-01-01",
      areaProvenienza: "IT",
      areaOperativaId: area.id,
      centroAscoltoId: centre.id,
      fascicolo: `MAN-${suffix}`,
    },
  });
  expect(created.status()).toBe(201);
  const beneficiary = await created.json();
  await page.goto(`/beneficiari/${beneficiary.id}`);
  await page
    .getByRole("button", { name: "Modifica anagrafica", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Fascicolo (facoltativo)")).toHaveValue(
    `MAN-${suffix}`,
  );
  await dialog.getByLabel("Fascicolo (facoltativo)").fill(`MAN-EDIT-${suffix}`);
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/beneficiari/${beneficiary.id}`) &&
      r.request().method() === "PATCH",
  );
  await dialog.getByRole("button", { name: /salva/i }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect((await response.json()).fascicolo).toBe(`MAN-EDIT-${suffix}`);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(`Fascicolo: MAN-EDIT-${suffix}`, { exact: true }),
  ).toBeVisible();
});

test("confronta il beneficiario registrato con il file e distingue collega, salta e crea", async ({
  page,
}, testInfo) => {
  await login(page);
  const suffix = `review-${Date.now()}-${testInfo.project.name}`;
  const areaResponse = await page.request.post("/api/aree-operative", {
    data: { nome: `Confronto ${suffix}` },
  });
  expect(areaResponse.status()).toBe(201);
  const area = await areaResponse.json();
  const centreResponse = await page.request.post("/api/centri-ascolto", {
    data: { nome: `Centro ${suffix}`, areaOperativaId: area.id, attivo: true },
  });
  expect(centreResponse.status()).toBe(201);
  const centre = await centreResponse.json();
  const created = await page.request.post("/api/beneficiari", {
    data: {
      nome: "Persona",
      cognome: `Sintetica ${suffix}`,
      sesso: "F",
      dataNascita: "1990-01-01",
      areaProvenienza: "IT",
      areaOperativaId: area.id,
      centroAscoltoId: centre.id,
    },
  });
  expect(created.status()).toBe(201);
  const existing = await created.json();
  const book = XLSX.read(workbook(suffix));
  const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Table1, {
    header: 1,
  });
  const third = [...rows[1]];
  third[2] = `FSE-3-${suffix}`;
  rows.push(third);
  book.Sheets.Table1 = XLSX.utils.aoa_to_sheet(rows);
  await page.goto("/beneficiari");
  await page.getByRole("button", { name: "Importa FSE+", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Importa FSE+" });
  await selectOption(
    page,
    dialog.getByRole("combobox", { name: "Area Operativa FSE+" }),
    area.nome,
  );
  await selectOption(
    page,
    dialog.getByRole("combobox", { name: "Centro di Ascolto FSE+" }),
    centre.nome,
  );
  await dialog.getByLabel("File FSE+", { exact: true }).setInputFiles({
    name: "ElencoFascicoliSociali-confronto.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })),
  });
  await dialog.getByRole("button", { name: "Carica e analizza" }).click();
  const first = dialog.locator('[data-fse-review-row="2"]');
  await expect(
    first.getByText(`Persona Sintetica ${suffix} · ${existing.codice}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    first.getByText("Data di nascita: 01/01/1990", { exact: true }),
  ).toBeVisible();
  await expect(
    first.getByRole("columnheader", { name: "Dati registrati" }),
  ).toBeVisible();
  await expect(
    first.getByRole("columnheader", { name: "Dati nel file FSE+" }),
  ).toBeVisible();
  await expect(
    first.getByText("Non presente nel file", { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Conferma importazione" }),
  ).toBeDisabled();
  expect(
    await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath("confronto-fse.png"),
    fullPage: true,
  });
  await first
    .getByRole("button", { name: "Collega e aggiorna anagrafica", exact: true })
    .click();
  await dialog
    .locator('[data-fse-review-row="3"]')
    .getByRole("button", { name: "Salta questa riga", exact: true })
    .click();
  await dialog
    .locator('[data-fse-review-row="4"]')
    .getByRole("button", { name: "Crea nuovo", exact: true })
    .click();
  const imported = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/beneficiari/fse/import") &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Conferma importazione" }).click();
  const response = await imported;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    creati: 1,
    collegati: 1,
    saltati: 1,
    errori: 0,
    conflitti: 0,
  });
  await expect(
    dialog.getByText("Righe saltate: 1", { exact: true }),
  ).toBeVisible();
  const detail = await (
    await page.request.get(`/api/beneficiari/${existing.id}`)
  ).json();
  expect(detail).toMatchObject({
    dataNascita: "1990-01-01",
    fascicolo: `FSE-1-${suffix}`,
  });
  const list = await (
    await page.request.get(
      `/api/beneficiari?areaOperativaId=${area.id}&centroAscoltoId=${centre.id}`,
    )
  ).json();
  expect(list).toHaveLength(2);
});

test("Massivo XLSM: propone solo differenze, aggiorna l’anagrafica e non ripropone righe identiche", async ({
  page,
}, testInfo) => {
  await login(page);
  const suffix = `massivo-${Date.now()}-${testInfo.project.name}`;
  const area = await (
    await page.request.post("/api/aree-operative", {
      data: { nome: `Massivo ${suffix}` },
    })
  ).json();
  const centre = await (
    await page.request.post("/api/centri-ascolto", {
      data: {
        nome: `Centro ${suffix}`,
        areaOperativaId: area.id,
        attivo: true,
      },
    })
  ).json();
  const existingResponse = await page.request.post("/api/beneficiari", {
    data: {
      nome: "Persona",
      cognome: "Massiva",
      dataNascita: "1991-01-01",
      sesso: "F",
      areaProvenienza: "IT",
      numComponenti: 1,
      areaOperativaId: area.id,
      centroAscoltoId: centre.id,
      fascicolo: `MASSIVO-${suffix}`,
    },
  });
  expect(existingResponse.status()).toBe(201);
  const existing = await existingResponse.json();
  const buffer = massivoFixture({ CodiceFascicolo: `MASSIVO-${suffix}` });
  const attach = {
    name: "Elenco_Fascicoli_Sociali_Massivo.xlsm",
    mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12",
    buffer,
  };
  await page.goto("/beneficiari");
  const open = async () => {
    await page
      .getByRole("button", { name: "Importa FSE+", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Importa FSE+" });
    await selectOption(
      page,
      dialog.getByRole("combobox", { name: "Area Operativa FSE+" }),
      area.nome,
    );
    await selectOption(
      page,
      dialog.getByRole("combobox", { name: "Centro di Ascolto FSE+" }),
      centre.nome,
    );
    await dialog.getByLabel("File FSE+", { exact: true }).setInputFiles(attach);
    await dialog.getByRole("button", { name: "Carica e analizza" }).click();
    await expect(
      dialog.getByText("Massivo (XLSM)", { exact: true }),
    ).toBeVisible();
    return dialog;
  };
  let dialog = await open();
  const review = dialog.locator('[data-fse-review-row="9"]');
  await expect(review).toBeVisible();
  await expect(
    review.getByRole("rowheader", { name: "Data di nascita", exact: true }),
  ).toBeVisible();
  // Equal identity values are context in the title, never repeated as comparison rows.
  await expect(
    review.getByRole("rowheader", { name: "Nome", exact: true }),
  ).toHaveCount(0);
  await expect(
    review.getByRole("button", { name: "Aggiorna anagrafica", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Conferma importazione" }),
  ).toBeDisabled();
  await review
    .getByRole("button", { name: "Aggiorna anagrafica", exact: true })
    .click();
  await review
    .getByRole("columnheader", { name: "Dati registrati" })
    .scrollIntoViewIfNeeded();
  expect(
    await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath("massivo-differenze.png"),
    fullPage: true,
  });
  const imported = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/beneficiari/fse/import") &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Conferma importazione" }).click();
  expect(await (await imported).json()).toMatchObject({
    aggiornati: 1,
    creati: 0,
    errori: 0,
  });
  const after = await (
    await page.request.get(`/api/beneficiari/${existing.id}`)
  ).json();
  expect(after).toMatchObject({
    dataNascita: "1990-01-01",
    codiceFiscale: "RSSMRA90A01H501U",
    numComponenti: 3,
    numMinori: 1,
    numAnziani: 1,
  });
  await dialog.getByRole("button", { name: "Chiudi", exact: true }).click();
  dialog = await open();
  await expect(dialog.locator("[data-fse-review-row]")).toHaveCount(0);
  const replay = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/beneficiari/fse/import") &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Conferma importazione" }).click();
  expect(await (await replay).json()).toMatchObject({
    invariati: 1,
    aggiornati: 0,
    errori: 0,
  });
  expect(
    (await (await page.request.get(`/api/beneficiari/${existing.id}`)).json())
      .versione,
  ).toBe(after.versione);
});
