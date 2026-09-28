import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD;
if (!password)
  throw new Error(
    "E2E_PASSWORD is required for the disposable M5B browser test",
  );

async function loginAs(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password!);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("M5B: richiesta Centro → presa Magazzino → Bolla → annullamento M4 → sostituzione e replay", async ({
  browser,
}, testInfo) => {
  const centre = await browser.newContext();
  const warehouse = await browser.newContext();
  try {
    const centrePage = await centre.newPage();
    await loginAs(centrePage, "test-m5b-center-a1");
    const beneficiaryResponse = await centrePage.request.get(
      "/api/beneficiari?search=TEST-M5B-B1",
    );
    expect(beneficiaryResponse.status()).toBe(200);
    const beneficiaries = await beneficiaryResponse.json();
    const beneficiary = beneficiaries.find(
      (row: { codice: string }) => row.codice === "TEST-M5B-B1",
    );
    expect(beneficiary?.id).toBeTruthy();
    const submitted = await centrePage.request.post(
      "/api/richieste-magazzino",
      {
        data: {
          idempotencyKey: randomUUID(),
          tipoDestinatario: "beneficiario",
          sorgente: "beneficiario",
          beneficiarioId: beneficiary.id,
          bisogno:
            "TEST-M5B browser: pacco sintetico; M5B-PRIVATE-NEED-20260928",
          priorita: "normale",
        },
      },
    );
    expect(submitted.status(), await submitted.text()).toBe(201);
    const request = await submitted.json();
    expect(request.codice).toMatch(/^RM-/);

    const warehousePage = await warehouse.newPage();
    const warehouseHttp: Array<{
      method: string;
      path: string;
      status: number;
    }> = [];
    warehousePage.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith("/api/"))
        warehouseHttp.push({
          method: response.request().method(),
          path,
          status: response.status(),
        });
    });
    await loginAs(warehousePage, "test-m5b-warehouse-a");
    await warehousePage.goto("/richieste-magazzino");
    await warehousePage
      .getByRole("button", { name: new RegExp(request.codice) })
      .click();
    await warehousePage
      .getByRole("button", { name: "Prendi in carico" })
      .click();
    const prepare = warehousePage.getByTestId("m5b-prepare-document");
    await expect(prepare).toBeVisible();
    await prepare
      .locator("#rm-warehouse")
      .selectOption({ label: "TEST-M5B Deposito A1" });
    await prepare.getByRole("button").last().click();
    await expect(warehousePage.getByText("Documento corrente")).toBeVisible();

    const firstDetail = await warehousePage.request.get(
      `/api/richieste-magazzino/${request.id}`,
    );
    expect(firstDetail.status()).toBe(200);
    const first = await firstDetail.json();
    expect(first.documentoCorrente?.tipoDocumento).toBe("bolla");
    const firstPath = first.documentoCorrente?.percorsoDocumento as
      | string
      | undefined;
    expect(firstPath).toMatch(/^\/bolle\?bollaId=\d+$/);
    const firstId = Number(
      new URL(firstPath!, "http://web").searchParams.get("bollaId"),
    );
    const productResponse = await warehousePage.request.get(
      "/api/prodotti?search=TEST-M5B-P",
    );
    expect(productResponse.status()).toBe(200);
    const product = (await productResponse.json()).find(
      (item: { codice: string }) => item.codice === "TEST-M5B-P",
    );
    expect(product?.id).toBeTruthy();
    const draftResponse = await warehousePage.request.get(
      `/api/bolle/${firstId}`,
    );
    expect(draftResponse.status()).toBe(200);
    const draft = await draftResponse.json();
    const addedLine = await warehousePage.request.post(
      `/api/bolle/${firstId}/righe`,
      {
        data: {
          idempotencyKey: randomUUID(),
          versione: draft.versione,
          prodottoId: product.id,
          quantita: "1",
        },
      },
    );
    expect(addedLine.status(), await addedLine.text()).toBe(201);
    const bollaRequests: string[] = [];
    warehousePage.on("request", (entry) => {
      if (new URL(entry.url()).pathname.startsWith("/api/"))
        bollaRequests.push(entry.url());
    });
    await warehousePage.getByRole("link", { name: "Apri documento" }).click();
    await expect(warehousePage).toHaveURL(new RegExp(`bollaId=${firstId}`));
    await expect(
      warehousePage.getByText(first.documentoCorrente.codice).first(),
    ).toBeVisible();
    const beforePdf = await warehousePage.request.get(`/api/bolle/${firstId}`);
    expect(beforePdf.status()).toBe(200);
    const beforePdfBody = await beforePdf.json();
    const [download] = await Promise.all([
      warehousePage.waitForEvent("download"),
      warehousePage.getByRole("button", { name: /scarica pdf/i }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      `${first.documentoCorrente.codice}.pdf`,
    );
    await download.saveAs(testInfo.outputPath("m5b-contextual-bolla.pdf"));
    const afterPdf = await warehousePage.request.get(`/api/bolle/${firstId}`);
    expect(afterPdf.status()).toBe(200);
    expect(await afterPdf.json()).toEqual(beforePdfBody);
    expect
      .soft(
        bollaRequests
          .map((url) => new URL(url).pathname)
          .filter((path) => /^\/api\/beneficiari(?:\/|$)/.test(path)),
        "Opening a contextual M5B Bolla must not fetch the Beneficiari directory",
      )
      .toEqual([]);
    await warehousePage.goto(firstPath!);
    await expect(
      warehousePage.getByText(first.documentoCorrente.codice).first(),
    ).toBeVisible();
    await warehousePage.reload();
    await expect(
      warehousePage.getByText(first.documentoCorrente.codice).first(),
    ).toBeVisible();
    await warehousePage
      .getByRole("link", { name: new RegExp(request.codice) })
      .click();
    await expect(warehousePage).toHaveURL(/\/richieste-magazzino/);
    await warehousePage.getByRole("link", { name: "Apri documento" }).click();
    await expect(warehousePage).toHaveURL(
      new RegExp(`documento=bolla%3A${firstId}`),
    );
    expect
      .soft(
        warehouseHttp.filter((entry) =>
          /^\/api\/(?:beneficiari(?:\/|$)|fse-fascicoli(?:\/|$)|fascicoli(?:\/|$))/.test(
            entry.path,
          ),
        ),
        "Initial navigation, contextual document, direct link, reload and return must not fetch social directories or dossier",
      )
      .toEqual([]);
    const bollaResponse = await warehousePage.request.get(
      `/api/bolle/${firstId}`,
    );
    expect(bollaResponse.status()).toBe(200);
    const bolla = await bollaResponse.json();
    expect(bolla.noteConsegna ?? "").not.toContain(
      "TEST-M5B browser: pacco sintetico",
    );
    const cancelKey = randomUUID();
    const cancelBody = {
      idempotencyKey: cancelKey,
      versione: bolla.versione,
      motivo: "TEST-M5B sostituzione",
    };
    const cancelled = await warehousePage.request.post(
      `/api/bolle/${firstId}/annulla`,
      { data: cancelBody },
    );
    expect(cancelled.status(), await cancelled.text()).toBe(200);

    await warehousePage.goto("/richieste-magazzino");
    await warehousePage
      .getByRole("button", { name: new RegExp(request.codice) })
      .click();
    await expect(
      warehousePage.getByTestId("m5b-prepare-document"),
    ).toBeVisible();
    await expect(warehousePage.getByText("Documenti precedenti")).toBeVisible();
    const replacement = warehousePage.getByTestId("m5b-prepare-document");
    await replacement
      .locator("#rm-warehouse")
      .selectOption({ label: "TEST-M5B Deposito A1" });
    await replacement.getByRole("button").last().click();
    await expect(warehousePage.getByText("Documento corrente")).toBeVisible();
    const secondDetail = await warehousePage.request.get(
      `/api/richieste-magazzino/${request.id}`,
    );
    expect(secondDetail.status()).toBe(200);
    const second = await secondDetail.json();
    const secondPath = second.documentoCorrente?.percorsoDocumento as
      | string
      | undefined;
    expect(secondPath).toMatch(/^\/bolle\?bollaId=\d+$/);
    expect(secondPath).not.toBe(firstPath);

    const replay = await warehousePage.request.post(
      `/api/bolle/${firstId}/annulla`,
      { data: cancelBody },
    );
    expect(replay.status(), await replay.text()).toBe(200);
    const afterReplay = await warehousePage.request.get(
      `/api/richieste-magazzino/${request.id}`,
    );
    expect(afterReplay.status()).toBe(200);
    expect((await afterReplay.json()).documentoCorrente.percorsoDocumento).toBe(
      secondPath,
    );
  } finally {
    await warehouse.close();
    await centre.close();
  }
});

test("M5B-R1: il selettore Beneficiario legacy resta disponibile su una Bolla libera", async ({
  page,
}) => {
  await loginAs(page, "sadmin");
  await page.goto("/bolle");
  const directoryResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/beneficiari" &&
      response.request().method() === "GET" &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: /^nuovo$/i }).click();
  await page.getByRole("button", { name: /nuova bolla/i }).click();
  await directoryResponse;
  await expect(
    page.getByText("Beneficiario", { exact: true }).first(),
  ).toBeVisible();
});

test("M5B: richieste operative Ente e Magazzino creano documenti M4 distinti", async ({
  page,
  browser,
}, testInfo) => {
  await loginAs(page, "test-m5b-warehouse-a");
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "sadmin");
  const listed = await page.request.get("/api/richieste-magazzino?limit=100");
  expect(listed.status()).toBe(200);
  const items = (await listed.json()).items as Array<{
    id: number;
    codice: string;
  }>;
  const details = async (code: string) => {
    const item = items.find((entry) => entry.codice === code);
    expect(item).toBeTruthy();
    const response = await page.request.get(
      `/api/richieste-magazzino/${item!.id}`,
    );
    expect(response.status()).toBe(200);
    return response.json();
  };
  const entityTemplate = await details("TEST-M5B-R-ENTE");
  const transferTemplate = await details("TEST-M5B-R-TRANSFER");
  const warehousesResponse = await page.request.get("/api/magazzini");
  expect(warehousesResponse.status()).toBe(200);
  const warehouses = await warehousesResponse.json();
  const origin = warehouses.find(
    (row: { nome: string }) => row.nome === "TEST-M5B Deposito A1",
  );
  expect(origin?.id).toBeTruthy();
  const productsResponse = await page.request.get(
    "/api/prodotti?search=TEST-M5B-P",
  );
  expect(productsResponse.status()).toBe(200);
  const products = await productsResponse.json();
  const product = products.find(
    (row: { codice: string }) => row.codice === "TEST-M5B-P",
  );
  expect(product?.id).toBeTruthy();

  for (const [kind, template] of [
    ["ente", entityTemplate],
    ["magazzino", transferTemplate],
  ] as const) {
    const created = await adminPage.request.post("/api/richieste-magazzino", {
      data: {
        idempotencyKey: randomUUID(),
        tipoDestinatario: kind,
        sorgente: "operativa",
        areaOperativaId: template.areaOperativaId,
        ...(kind === "ente"
          ? { enteDestinatarioId: template.enteDestinatarioId }
          : { magazzinoDestinatarioId: template.magazzinoDestinatarioId }),
        bisogno: `TEST-M5B ${kind} browser isolato`,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const request = await created.json();
    const taken = await page.request.post(
      `/api/richieste-magazzino/${request.id}/presa-in-carico`,
      {
        data: { idempotencyKey: randomUUID(), versione: request.versione },
      },
    );
    expect(taken.status(), await taken.text()).toBe(200);
    const before = await page.request.get(
      `/api/richieste-magazzino/${request.id}`,
    );
    expect(before.status()).toBe(200);
    const beforeDetail = await before.json();
    const document = await page.request.post(
      `/api/richieste-magazzino/${request.id}/documento`,
      {
        data: {
          idempotencyKey: randomUUID(),
          versione: beforeDetail.versione,
          magazzinoId: origin.id,
          ...(kind === "magazzino"
            ? {
                righe: [
                  { prodottoId: product.id, quantita: "1", unitaMisura: "pz" },
                ],
              }
            : {}),
        },
      },
    );
    expect(document.status(), await document.text()).toBe(201);
    const createdDocument = await document.json();
    expect(createdDocument.tipoDocumento).toBe(
      kind === "ente" ? "bolla" : "trasferimento",
    );
    await page.goto("/richieste-magazzino");
    await page
      .getByRole("button", { name: new RegExp(request.codice) })
      .click();
    await expect(page.getByText("Documento corrente")).toBeVisible();
    const directLink = await page
      .getByRole("link", { name: "Apri documento" })
      .getAttribute("href");
    expect(directLink).toMatch(
      kind === "ente"
        ? /^\/bolle\?bollaId=/
        : /^\/trasferimenti\?trasferimentoId=/,
    );
    if (kind === "magazzino") {
      const beforePdf = await page.request.get(
        `/api/trasferimenti/${createdDocument.documentoId}`,
      );
      expect(beforePdf.status()).toBe(200);
      const beforePdfBody = await beforePdf.json();
      const documentRequests: string[] = [];
      page.on("request", (entry) => {
        if (new URL(entry.url()).pathname.startsWith("/api/"))
          documentRequests.push(new URL(entry.url()).pathname);
      });
      await page.goto(directLink!);
      const transferDialog = page.getByRole("dialog", {
        name: "Dettaglio trasferimento",
      });
      await expect(
        transferDialog.getByText(createdDocument.codiceDocumento),
      ).toBeVisible();
      await transferDialog.getByRole("button", { name: "Chiudi" }).click();
      const documentRow = page
        .getByRole("row")
        .filter({ hasText: createdDocument.codiceDocumento });
      await expect(documentRow).toBeVisible();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        documentRow.getByRole("button", { name: /bolla/i }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.pdf$/);
      await download.saveAs(testInfo.outputPath("m5b-contextual-transfer.pdf"));
      const afterPdf = await page.request.get(
        `/api/trasferimenti/${createdDocument.documentoId}`,
      );
      expect(afterPdf.status()).toBe(200);
      expect(await afterPdf.json()).toEqual(beforePdfBody);
      expect(
        documentRequests.filter((path) =>
          /^\/api\/(?:beneficiari|fse-fascicoli|fascicoli)(?:\/|$)/.test(path),
        ),
      ).toEqual([]);
    }
  }
  await adminContext.close();
});

test("M5B: scope Area/Centro e grant preparazione con sessioni reali", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () => browser.newContext()),
  );
  try {
    const [warehousePage, otherAreaPage, otherCenterPage, readerPage] =
      await Promise.all(contexts.map((context) => context.newPage()));
    await loginAs(warehousePage, "test-m5b-warehouse-a");
    await loginAs(otherAreaPage, "test-m5b-other-area-b");
    await loginAs(otherCenterPage, "test-m5b-other-center-a2");
    await loginAs(readerPage, "test-m5b-reader-a");

    const list = async (page: Page) => {
      const response = await page.request.get(
        "/api/richieste-magazzino?limit=100",
      );
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()).items as Array<{
        id: number;
        codice: string;
        versione: number;
      }>;
    };
    const own = await list(warehousePage);
    expect(own.map((item) => item.codice)).toContain("TEST-M5B-R-ENTE");
    expect(own.map((item) => item.codice)).toContain("TEST-M5B-R-TRANSFER");
    expect(
      (await list(otherAreaPage)).map((item) => item.codice),
    ).not.toContain("TEST-M5B-R-ENTE");
    const anotherCenter = (await list(otherCenterPage)).map(
      (item) => item.codice,
    );
    expect(anotherCenter).not.toContain("TEST-M5B-R-SENT");
    expect(anotherCenter).not.toContain("TEST-M5B-R-TAKEN");

    const readerRows = await list(readerPage);
    const operational = readerRows.find(
      (item) => item.codice === "TEST-M5B-R-ENTE",
    );
    expect(operational).toBeTruthy();
    const denied = await readerPage.request.post(
      `/api/richieste-magazzino/${operational!.id}/documento`,
      {
        data: {
          idempotencyKey: randomUUID(),
          versione: operational!.versione,
          magazzinoId: 1,
        },
      },
    );
    expect(denied.status()).toBe(403);
    const directory = await warehousePage.request.get(
      "/api/beneficiari?search=TEST-M5B-B1",
    );
    expect(directory.status()).toBe(403);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
