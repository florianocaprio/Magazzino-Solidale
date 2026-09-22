import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { assertViewportSafe, login, selectOption } from "./helpers";

type Area = { id: number; nome: string; attivo: boolean };
type Warehouse = {
  id: number;
  nome: string;
  areaOperativaId: number | null;
  stato: string;
};
type Product = {
  id: number;
  codice: string;
  nome: string;
  attivo: boolean;
  unitaMisura: string;
  lottoFisicoObbligatorio: boolean;
  gestioneScadenza: boolean;
};
type LogicalLot = { id: number; isGenerale: boolean; stato: string };
type Stock = { prodottoId: number; giacenzaFisica: number };

const originalRegistryPath = process.env.FSE_REGISTRY_ORIGINAL_PATH;
const originalStockPath = process.env.FSE_STOCK_ORIGINAL_PATH;

const registryHeaders = [
  "Fondo",
  "Prodotto",
  "Giacenza al 17/09/2026 Pezzi",
  "Giacenza al 17/09/2026 KgLt",
  "Numero documento",
  "Data documento",
  "Data carico magazzino",
  "Lotto",
  "Mittente / destinatario",
  "Carico / scarico",
  "Carico / scarico pezzi",
  "Giacenza pezzi alla movimentazione",
  "Giacenza alla movimentazione",
  "Note",
  "Attività",
  "Pacchi",
  "Pasti",
  "Indigenti saltuari",
  "Indigenti continuativi",
];

function registryFixture(
  product: string,
  document: string,
  options: { warehouseDate?: string | null; quantity?: number } = {},
): Buffer {
  return registryFixtures(
    product,
    [{ document, quantity: options.quantity ?? 10 }],
    options.warehouseDate,
  );
}

function registryFixtures(
  product: string,
  rows: Array<{ document: string; quantity: number }>,
  warehouseDate: string | null = "17/09/2026",
): Buffer {
  const finalBalance = rows.reduce((total, row) => total + row.quantity, 0);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      registryHeaders,
      ...rows.map(({ document, quantity }) => [
        "Fondo Nazionale",
        product,
        finalBalance,
        null,
        document,
        "17/09/2026",
        warehouseDate,
        "006544",
        "Ente sintetico E2E",
        null,
        quantity,
        finalBalance,
        null,
        "fixture sintetica M3B",
        null,
        null,
        null,
        null,
        null,
      ]),
    ]),
    "Registro sintetico",
  );
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  );
}

async function openPractice(page: Page, area: Area, description: string) {
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Area Operativa" }),
    area.nome,
  );
  const card = page.getByText(description, { exact: true }).locator("../..");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /apri pratica/i }).click();
}

async function ensureContext(page: Page, suffix: number) {
  const areasResponse = await page.request.get("/api/aree-operative");
  let area = ((await areasResponse.json()) as Area[]).find(
    (item) => item.attivo,
  );
  if (!area) {
    const created = await page.request.post("/api/aree-operative", {
      data: { nome: `M3B Area E2E ${suffix}` },
    });
    expect(created.status()).toBe(201);
    area = (await created.json()) as Area;
  }
  const warehousesResponse = await page.request.get("/api/magazzini");
  let warehouse = ((await warehousesResponse.json()) as Warehouse[]).find(
    (item) => item.areaOperativaId === area.id && item.stato === "attivo",
  );
  if (!warehouse) {
    const created = await page.request.post("/api/magazzini", {
      data: {
        nome: `M3B Magazzino E2E ${suffix}`,
        areaOperativaId: area.id,
      },
    });
    expect(created.status()).toBe(201);
    warehouse = (await created.json()) as Warehouse;
  }
  const lotsResponse = await page.request.get(
    `/api/lotti-logici?areaOperativaId=${area.id}`,
  );
  const logicalLot = ((await lotsResponse.json()) as LogicalLot[]).find(
    (item) => item.isGenerale && item.stato === "aperto",
  );
  expect(logicalLot).toBeTruthy();
  return { area, warehouse, logicalLot: logicalLot! };
}

async function createSource(page: Page, area: Area, suffix: string | number) {
  const response = await page.request.post("/api/fse-importazioni/sorgenti", {
    data: {
      codice: `M3B-E2E-${suffix}`,
      descrizione: `Sorgente M3B E2E ${suffix}`,
      areaOperativaId: area.id,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: number; descrizione: string };
}

async function createPractice(
  page: Page,
  context: Awaited<ReturnType<typeof ensureContext>>,
  description: string,
) {
  const response = await page.request.post("/api/carico-pratiche", {
    data: {
      areaOperativaId: context.area.id,
      magazzinoId: context.warehouse.id,
      lottoLogicoId: context.logicalLot.id,
      origineCarico: "DONAZIONE",
      dataCarico: "2026-09-17",
      descrizione: description,
      righe: [],
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: number; versione: number };
}

function validEan13(seed: number) {
  const base = `290${String(seed).padStart(9, "0").slice(-9)}`;
  const sum = [...base].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return `${base}${(10 - (sum % 10)) % 10}`;
}

test.describe("M3B — Importa file FSE+ nella pratica", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-1440x900",
      "Il flusso inventariale mutante gira una sola volta",
    );
    await login(page);
  });

  test("file sintetico → mapping → pratica → nuova sessione → Registra → replay senza doppio stock", async ({
    page,
    browser,
  }) => {
    const suffix = Date.now();
    const description = `Pratica M3B E2E ${suffix}`;
    const document = `DOC-M3B-${suffix}`;
    const areasResponse = await page.request.get("/api/aree-operative");
    let area = ((await areasResponse.json()) as Area[]).find(
      (item) => item.attivo,
    );
    if (!area) {
      const created = await page.request.post("/api/aree-operative", {
        data: { nome: `M3B Area E2E ${suffix}` },
      });
      expect(created.status()).toBe(201);
      area = (await created.json()) as Area;
    }
    const warehousesResponse = await page.request.get("/api/magazzini");
    let warehouse = ((await warehousesResponse.json()) as Warehouse[]).find(
      (item) => item.areaOperativaId === area.id && item.stato === "attivo",
    );
    if (!warehouse) {
      const created = await page.request.post("/api/magazzini", {
        data: {
          nome: `M3B Magazzino E2E ${suffix}`,
          areaOperativaId: area.id,
        },
      });
      expect(created.status()).toBe(201);
      warehouse = (await created.json()) as Warehouse;
    }
    const productsResponse = await page.request.get("/api/prodotti");
    let product = ((await productsResponse.json()) as Product[]).find(
      (item) =>
        item.attivo &&
        item.unitaMisura === "pz" &&
        !item.lottoFisicoObbligatorio &&
        !item.gestioneScadenza,
    );
    if (!product) {
      const created = await page.request.post("/api/prodotti", {
        data: {
          nome: `Prodotto M3B E2E ${suffix}`,
          tipoProdotto: "alimentare",
          unitaMisura: "pz",
          quantitaFrazionabile: false,
          lottoFisicoObbligatorio: false,
          gestioneScadenza: false,
        },
      });
      expect(created.status()).toBe(201);
      product = (await created.json()) as Product;
    }
    const lotsResponse = await page.request.get(
      `/api/lotti-logici?areaOperativaId=${area.id}`,
    );
    const logicalLot = ((await lotsResponse.json()) as LogicalLot[]).find(
      (item) => item.isGenerale && item.stato === "aperto",
    )!;
    expect(logicalLot).toBeTruthy();

    const sourceResponse = await page.request.post(
      "/api/fse-importazioni/sorgenti",
      {
        data: {
          codice: `M3B-E2E-${suffix}`,
          descrizione: `Sorgente M3B E2E ${suffix}`,
          areaOperativaId: area.id,
        },
      },
    );
    expect(sourceResponse.status()).toBe(201);
    const source = (await sourceResponse.json()) as {
      id: number;
      descrizione: string;
    };
    const practiceResponse = await page.request.post("/api/carico-pratiche", {
      data: {
        areaOperativaId: area.id,
        magazzinoId: warehouse.id,
        lottoLogicoId: logicalLot.id,
        origineCarico: "DONAZIONE",
        dataCarico: "2026-09-17",
        descrizione: description,
        righe: [],
      },
    });
    expect(practiceResponse.status()).toBe(201);
    const practice = (await practiceResponse.json()) as {
      id: number;
      versione: number;
    };
    const file = registryFixture(product.nome, document, {
      warehouseDate: null,
    });

    const readStock = async (targetPage: Page) => {
      const response = await targetPage.request.get(
        `/api/giacenze?areaOperativaId=${area.id}&magazzinoId=${warehouse.id}`,
      );
      return (
        ((await response.json()) as Stock[]).find(
          (item) => item.prodottoId === product.id,
        )?.giacenzaFisica ?? 0
      );
    };
    const before = await readStock(page);

    await page.goto("/carico-merce");
    await openPractice(page, area, description);
    await page.getByRole("button", { name: "Importa file FSE+" }).click();
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Sorgente / registro esterno" }),
      source.descrizione,
    );
    await page.getByLabel(/Registro FSE\+/).setInputFiles({
      name: "registro-sintetico-m3b.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: file,
    });
    await page.getByRole("button", { name: "Carica e analizza" }).click();
    await expect(
      page.getByText(product.nome, { exact: true }).first(),
    ).toBeVisible();
    await selectOption(
      page,
      page.getByRole("combobox", {
        name: new RegExp(`Associa a un prodotto esistente: ${product.nome}`),
      }),
      `${product.codice} — ${product.nome}`,
    );
    await page.getByRole("button", { name: "Associa", exact: true }).click();
    await expect(
      page.getByText("Da verificare", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Correggi o conferma", exact: true })
      .click();
    await page
      .getByPlaceholder("Motivo obbligatorio")
      .fill("Conferma data documento come fallback E2E");
    await page
      .getByText("Confermo l'uso della data documento come fallback")
      .click();
    await page
      .getByRole("button", { name: "Salva revisione", exact: true })
      .click();
    await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
    const readySelection = page
      .getByRole("dialog")
      .locator('[role="checkbox"]:not([disabled])');
    await expect(readySelection).toHaveCount(1);
    await readySelection.check();
    expect(await readStock(page)).toBe(before);

    await page.getByRole("button", { name: "Vai al riepilogo" }).click();
    await expect(
      page.getByText(/Le giacenze non cambiano finché non registri la merce/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Aggiungi alla pratica" }).click();
    expect(await readStock(page)).toBe(before);

    const baseURL = new URL(page.url()).origin;
    await page.context().clearCookies();
    await page.close();
    const resumedContext = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    const resumedPage = await resumedContext.newPage();
    await login(resumedPage);
    await resumedPage.goto("/carico-merce");
    await openPractice(resumedPage, area, description);
    await expect(resumedPage.getByText(document)).toBeVisible();
    await resumedPage
      .getByRole("button", { name: /registra nuove righe/i })
      .click();
    const registration = resumedPage.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/carico-pratiche/${practice.id}/registra`) &&
        response.request().method() === "POST",
    );
    await resumedPage
      .getByRole("alertdialog")
      .getByRole("button", { name: /registra nuove righe/i })
      .click();
    expect((await registration).status()).toBe(201);
    expect(await readStock(resumedPage)).toBe(before + 10);

    const replayQuery = new URLSearchParams({
      sourceRegistryId: String(source.id),
      areaOperativaId: String(area.id),
      magazzinoId: String(warehouse.id),
      lottoLogicoId: String(logicalLot.id),
      caricoPraticaId: String(practice.id),
      modalita: "NUOVI_CARICHI",
      profilo: "REGISTRO",
      nomeFile: "registro-rinominato.xlsx",
    });
    const replay = await resumedPage.request.post(
      `/api/fse-importazioni/analizza?${replayQuery.toString()}`,
      {
        headers: { "Content-Type": "application/octet-stream" },
        data: file,
      },
    );
    expect(replay.status()).toBe(200);
    expect((await replay.json()).replay).toBe(true);
    expect(await readStock(resumedPage)).toBe(before + 10);
    await resumedContext.close();
  });

  test("crea prodotto e barcode con permesso e impedisce l'aggiramento senza products.manage", async ({
    page,
    browser,
  }) => {
    const suffix = Date.now();
    const context = await ensureContext(page, suffix);
    const source = await createSource(page, context.area, `PRODUCT-${suffix}`);
    const description = `Pratica M3B prodotto ${suffix}`;
    await createPractice(page, context, description);
    const externalProduct = `Prodotto esterno nuovo ${suffix}`;
    const barcode = validEan13(suffix);

    await page.goto("/carico-merce");
    await openPractice(page, context.area, description);
    await page.getByRole("button", { name: "Importa file FSE+" }).click();
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Sorgente / registro esterno" }),
      source.descrizione,
    );
    await page.getByLabel(/Registro FSE\+/).setInputFiles({
      name: "prodotto-nuovo.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: registryFixture(externalProduct, `DOC-NEW-${suffix}`),
    });
    await page.getByRole("button", { name: "Carica e analizza" }).click();
    await page
      .getByRole("button", { name: "Crea prodotto", exact: true })
      .click();
    await page
      .getByPlaceholder("Nome del prodotto")
      .fill(`Catalogo da FSE ${suffix}`);
    await page.getByPlaceholder(/Barcode/).fill(barcode);
    await page
      .getByRole("button", { name: "Crea e associa", exact: true })
      .click();
    await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
    const productsResponse = await page.request.get("/api/prodotti");
    const createdProduct = (
      (await productsResponse.json()) as Array<
        Product & { codiceBarre?: string }
      >
    ).find((product) => product.nome === `Catalogo da FSE ${suffix}`);
    expect(createdProduct?.codiceBarre).toBe(barcode);

    const roleResponse = await page.request.post("/api/ruoli", {
      data: {
        nome: `M3B senza catalogo ${suffix}`,
        descrizione: "Ruolo E2E privo della gestione Catalogo",
        aree: ["magazzino"],
        permessi: [
          "magazzino.view",
          "magazzino.stock.receive",
          "magazzino.agea.view",
          "magazzino.agea.import",
          "magazzino.agea.mapping.manage",
        ],
        isAdmin: false,
      },
    });
    expect(roleResponse.status()).toBe(201);
    const role = (await roleResponse.json()) as { id: number };
    const username = `m3b_no_catalog_${suffix}`;
    const initialPassword = "M3b-NoCatalog-2026!";
    const finalPassword = "M3b-NoCatalog-Changed-2026!";
    const userResponse = await page.request.post("/api/utenti", {
      data: {
        username,
        email: `${username}@example.org`,
        password: initialPassword,
        nome: "Operatore",
        cognome: "Senza Catalogo",
        ruoloId: role.id,
        areaOperativaId: context.area.id,
        attivo: true,
      },
    });
    expect(userResponse.status()).toBe(201);
    const deniedDescription = `Pratica M3B senza catalogo ${suffix}`;
    await createPractice(page, context, deniedDescription);

    const baseURL = new URL(page.url()).origin;
    const deniedContext = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    const deniedPage = await deniedContext.newPage();
    const deniedLogin = await deniedPage.request.post("/api/auth/login", {
      data: { username, password: initialPassword },
    });
    expect(deniedLogin.status()).toBe(200);
    const changedPassword = await deniedPage.request.post(
      "/api/auth/change-password",
      { data: { newPassword: finalPassword } },
    );
    expect(changedPassword.status()).toBe(204);
    await deniedPage.goto("/carico-merce");
    await openPractice(deniedPage, context.area, deniedDescription);
    await deniedPage.getByRole("button", { name: "Importa file FSE+" }).click();
    await selectOption(
      deniedPage,
      deniedPage.getByRole("combobox", {
        name: "Sorgente / registro esterno",
      }),
      source.descrizione,
    );
    await deniedPage.getByLabel(/Registro FSE\+/).setInputFiles({
      name: "prodotto-nuovo-senza-permesso.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: registryFixture(
        `Prodotto esterno non autorizzato ${suffix}`,
        `DOC-NO-PERM-${suffix}`,
      ),
    });
    await deniedPage.getByRole("button", { name: "Carica e analizza" }).click();
    await expect(
      deniedPage.getByRole("button", { name: "Crea prodotto", exact: true }),
    ).toHaveCount(0);
    const forbidden = await deniedPage.request.post("/api/prodotti", {
      data: {
        nome: `Tentativo vietato ${suffix}`,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
      },
    });
    expect(forbidden.status()).toBe(403);
    await deniedContext.close();
  });

  test("riprende un import parziale in un nuovo contesto e reimporta senza duplicare", async ({
    page,
  }) => {
    const suffix = Date.now();
    const context = await ensureContext(page, suffix);
    const source = await createSource(page, context.area, `PARTIAL-${suffix}`);
    const productResponse = await page.request.post("/api/prodotti", {
      data: {
        nome: `Prodotto parziale ${suffix}`,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
        quantitaFrazionabile: false,
        lottoFisicoObbligatorio: false,
        gestioneScadenza: false,
      },
    });
    expect(productResponse.status()).toBe(201);
    const product = (await productResponse.json()) as Product;
    const description = `Pratica M3B parziale ${suffix}`;
    const practice = await createPractice(page, context, description);
    const file = registryFixtures(product.nome, [
      { document: `DOC-PART-A-${suffix}`, quantity: 4 },
      { document: `DOC-PART-B-${suffix}`, quantity: 6 },
    ]);
    const stockBeforeResponse = await page.request.get(
      `/api/giacenze?areaOperativaId=${context.area.id}&magazzinoId=${context.warehouse.id}`,
    );
    const stockBefore =
      ((await stockBeforeResponse.json()) as Stock[]).find(
        (item) => item.prodottoId === product.id,
      )?.giacenzaFisica ?? 0;

    await page.goto("/carico-merce");
    await openPractice(page, context.area, description);
    await page.getByRole("button", { name: "Importa file FSE+" }).click();
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Sorgente / registro esterno" }),
      source.descrizione,
    );
    await page.getByLabel(/Registro FSE\+/).setInputFiles({
      name: "registro-parziale.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: file,
    });
    await page.getByRole("button", { name: "Carica e analizza" }).click();
    await selectOption(
      page,
      page.getByRole("combobox", {
        name: new RegExp(`Associa a un prodotto esistente: ${product.nome}`),
      }),
      `${product.codice} — ${product.nome}`,
    );
    await page.getByRole("button", { name: "Associa", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const rowChecks = dialog.getByRole("checkbox");
    await expect(rowChecks).toHaveCount(2);
    await rowChecks.nth(1).click();
    await page.getByRole("button", { name: "Vai al riepilogo" }).click();
    const attachPayloads: Array<Record<string, unknown>> = [];
    let interruptFirstResponse = true;
    await page.route(
      /\/api\/fse-importazioni\/sessioni\/\d+\/aggiungi-pratica$/,
      async (route) => {
        attachPayloads.push(
          route.request().postDataJSON() as Record<string, unknown>,
        );
        const backendResponse = await route.fetch();
        if (interruptFirstResponse) {
          interruptFirstResponse = false;
          await route.abort("failed");
          return;
        }
        await route.fulfill({ response: backendResponse });
      },
    );
    await page.getByRole("button", { name: "Aggiungi alla pratica" }).click();
    await expect.poll(() => attachPayloads.length).toBe(1);
    await expect(
      page.getByRole("button", { name: "Aggiungi alla pratica" }),
    ).toBeEnabled();
    await expect
      .poll(async () => {
        const committedAfterInterruptedResponse = await page.request.get(
          `/api/carico-pratiche/${practice.id}`,
        );
        expect(committedAfterInterruptedResponse.status()).toBe(200);
        return (
          (await committedAfterInterruptedResponse.json()) as {
            righe: Array<{ id: number }>;
          }
        ).righe.length;
      })
      .toBe(1);

    const retryAttach = page.waitForResponse(
      (response) =>
        /\/api\/fse-importazioni\/sessioni\/\d+\/aggiungi-pratica$/.test(
          response.url(),
        ) && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Aggiungi alla pratica" }).click();
    expect((await retryAttach).status()).toBe(200);
    expect(attachPayloads).toHaveLength(2);
    expect(attachPayloads[1]).toEqual(attachPayloads[0]);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.reload();
    await openPractice(page, context.area, description);
    await page.getByRole("button", { name: "Importa file FSE+" }).click();
    await page.getByRole("button", { name: /#\d+ · IN_PRATICA/ }).click();
    await expect(
      page.getByText("Già nella pratica", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Vai al riepilogo" }).click();
    const secondAttach = page.waitForResponse(
      (response) =>
        /\/api\/fse-importazioni\/sessioni\/\d+\/aggiungi-pratica$/.test(
          response.url(),
        ) && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Aggiungi alla pratica" }).click();
    expect((await secondAttach).status()).toBe(201);
    expect(attachPayloads).toHaveLength(3);
    expect(attachPayloads[2].idempotencyKey).not.toBe(
      attachPayloads[0].idempotencyKey,
    );
    expect(attachPayloads[2].rigaIds).not.toEqual(attachPayloads[0].rigaIds);

    const detailResponse = await page.request.get(
      `/api/carico-pratiche/${practice.id}`,
    );
    const detail = (await detailResponse.json()) as {
      versione: number;
      righe: Array<{ id: number }>;
    };
    expect(detail.righe).toHaveLength(2);
    const registered = await page.request.post(
      `/api/carico-pratiche/${practice.id}/registra`,
      {
        data: {
          versione: detail.versione,
          rigaIds: detail.righe.map((row) => row.id),
          idempotencyKey: `m3b-e2e-partial-register-${suffix}`,
        },
      },
    );
    expect(registered.status()).toBe(201);
    const stockAfterResponse = await page.request.get(
      `/api/giacenze?areaOperativaId=${context.area.id}&magazzinoId=${context.warehouse.id}`,
    );
    expect(
      ((await stockAfterResponse.json()) as Stock[]).find(
        (item) => item.prodottoId === product.id,
      )?.giacenzaFisica,
    ).toBe(stockBefore + 10);
    const replayQuery = new URLSearchParams({
      sourceRegistryId: String(source.id),
      areaOperativaId: String(context.area.id),
      magazzinoId: String(context.warehouse.id),
      lottoLogicoId: String(context.logicalLot.id),
      caricoPraticaId: String(practice.id),
      modalita: "NUOVI_CARICHI",
      profilo: "REGISTRO",
      nomeFile: "registro-parziale-rinominato.xlsx",
    });
    const replay = await page.request.post(
      `/api/fse-importazioni/analizza?${replayQuery.toString()}`,
      {
        headers: { "Content-Type": "application/octet-stream" },
        data: file,
      },
    );
    expect(replay.status()).toBe(200);
    expect((await replay.json()).replay).toBe(true);
  });

  test("inizializza da due originali, registra 1177 pezzi e reimporta senza effetti", async ({
    page,
  }) => {
    test.skip(
      !originalRegistryPath || !originalStockPath,
      "I due Excel originali M3B non sono disponibili",
    );
    const suffix = Date.now();
    const base = await ensureContext(page, suffix);
    const warehouseResponse = await page.request.post("/api/magazzini", {
      data: {
        nome: `M3B saldo reale E2E ${suffix}`,
        areaOperativaId: base.area.id,
      },
    });
    expect(warehouseResponse.status()).toBe(201);
    const warehouse = (await warehouseResponse.json()) as Warehouse;
    const context = { ...base, warehouse };
    const source = await createSource(page, base.area, `REAL-${suffix}`);
    const description = `Pratica M3B saldo reale ${suffix}`;
    const practice = await createPractice(page, context, description);
    const registryBytes = readFileSync(originalRegistryPath!);
    const stockBytes = readFileSync(originalStockPath!);
    const stockWorkbook = XLSX.read(stockBytes, { type: "buffer" });
    const stockSheet = stockWorkbook.Sheets.Table1;
    const externalProducts = [
      ...new Set(
        XLSX.utils
          .sheet_to_json<Record<string, unknown>>(stockSheet)
          .map((row) => String(row.Prodotto ?? "").trim())
          .filter(Boolean),
      ),
    ];
    expect(externalProducts).toHaveLength(7);
    const mappedProducts = new Map<string, Product>();
    for (const [index, externalProduct] of externalProducts.entries()) {
      const response = await page.request.post("/api/prodotti", {
        data: {
          nome: `Saldo reale E2E ${index + 1} ${suffix}`,
          tipoProdotto: "alimentare",
          unitaMisura: "pz",
          quantitaFrazionabile: false,
          lottoFisicoObbligatorio: true,
          gestioneScadenza: true,
        },
      });
      expect(response.status()).toBe(201);
      mappedProducts.set(externalProduct, (await response.json()) as Product);
    }

    await page.goto("/carico-merce");
    await openPractice(page, base.area, description);
    await page.getByRole("button", { name: "Importa file FSE+" }).click();
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Scopo dell'importazione" }),
      "Imposta giacenza iniziale",
    );
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Sorgente / registro esterno" }),
      source.descrizione,
    );
    await page.getByLabel(/Registro FSE\+/).setInputFiles({
      name: "Registro Feliciangeli originale.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: registryBytes,
    });
    await page.getByLabel(/Giacenze FSE\+/).setInputFiles({
      name: "Giacenze Feliciangeli originale.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: stockBytes,
    });
    await page.getByLabel("Data di riferimento").fill("2026-09-17");
    await page
      .getByText(/Confermo che il Registro copre lo storico necessario/)
      .click();
    await page.getByRole("button", { name: "Carica e analizza" }).click();
    for (const externalProduct of externalProducts) {
      const product = mappedProducts.get(externalProduct)!;
      const card = page
        .getByText(externalProduct, { exact: true })
        .first()
        .locator("../..");
      await selectOption(
        page,
        card.getByRole("combobox"),
        `${product.codice} — ${product.nome}`,
      );
      await card.getByRole("button", { name: "Associa", exact: true }).click();
    }
    await page.getByRole("button", { name: "Vai al riepilogo" }).click();
    await expect(page.getByText(/1177/)).toBeVisible();
    const balanceAttach = page.waitForResponse(
      (response) =>
        /\/api\/fse-importazioni\/sessioni\/\d+\/aggiungi-pratica$/.test(
          response.url(),
        ) && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Aggiungi alla pratica" }).click();
    expect((await balanceAttach).status()).toBe(201);

    const detailResponse = await page.request.get(
      `/api/carico-pratiche/${practice.id}`,
    );
    const detail = (await detailResponse.json()) as {
      versione: number;
      righe: Array<{ id: number }>;
    };
    expect(detail.righe).toHaveLength(7);
    const zeroStock = await page.request.get(
      `/api/giacenze?areaOperativaId=${base.area.id}&magazzinoId=${warehouse.id}`,
    );
    expect((await zeroStock.json()) as Stock[]).toHaveLength(0);
    const registerButton = page.getByRole("button", {
      name: /registra nuove righe/i,
    });
    await registerButton.scrollIntoViewIfNeeded();
    await registerButton.click();
    const registration = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/carico-pratiche/${practice.id}/registra`) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /registra nuove righe/i })
      .click();
    expect((await registration).status()).toBe(201);
    const stock = await page.request.get(
      `/api/giacenze?areaOperativaId=${base.area.id}&magazzinoId=${warehouse.id}`,
    );
    expect(
      ((await stock.json()) as Stock[]).reduce(
        (total, row) => total + row.giacenzaFisica,
        0,
      ),
    ).toBe(1_177);
    const movements = await page.request.get(
      `/api/movimenti?magazzinoId=${warehouse.id}`,
    );
    expect((await movements.json()) as unknown[]).toHaveLength(7);

    const replayQuery = new URLSearchParams({
      sourceRegistryId: String(source.id),
      areaOperativaId: String(base.area.id),
      magazzinoId: String(warehouse.id),
      lottoLogicoId: String(base.logicalLot.id),
      caricoPraticaId: String(practice.id),
      modalita: "SALDO_INIZIALE",
      profilo: "REGISTRO",
      nomeFile: "registro-originale-rinominato.xlsx",
    });
    const replay = await page.request.post(
      `/api/fse-importazioni/analizza?${replayQuery.toString()}`,
      {
        headers: { "Content-Type": "application/octet-stream" },
        data: registryBytes,
      },
    );
    expect(replay.status()).toBe(200);
    expect((await replay.json()).replay).toBe(true);
    const stockAfterReplay = await page.request.get(
      `/api/giacenze?areaOperativaId=${base.area.id}&magazzinoId=${warehouse.id}`,
    );
    expect(
      ((await stockAfterReplay.json()) as Stock[]).reduce(
        (total, row) => total + row.giacenzaFisica,
        0,
      ),
    ).toBe(1_177);
  });
});

test.describe("M3B — viewport tablet", () => {
  test.describe.configure({ mode: "serial" });

  test("apre, risolve un'eccezione, rivede il riepilogo e torna alla pratica", async ({
    page,
  }, testInfo) => {
    test.skip(
      !["tablet-landscape-1024x768", "tablet-portrait-768x1024"].includes(
        testInfo.project.name,
      ),
      "Scenario tablet M3B riservato ai due viewport obbligatori",
    );
    await login(page);
    const suffix = Date.now();
    const context = await ensureContext(page, suffix);
    const source = await createSource(
      page,
      context.area,
      `${testInfo.project.name}-${suffix}`,
    );
    const productResponse = await page.request.post("/api/prodotti", {
      data: {
        nome: `Prodotto tablet ${testInfo.project.name} ${suffix}`,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
        quantitaFrazionabile: false,
        lottoFisicoObbligatorio: false,
        gestioneScadenza: false,
      },
    });
    expect(productResponse.status()).toBe(201);
    const product = (await productResponse.json()) as Product;
    const description = `Pratica tablet ${testInfo.project.name} ${suffix}`;
    await createPractice(page, context, description);

    await page.goto("/carico-merce");
    await openPractice(page, context.area, description);
    await assertViewportSafe(page);
    await page.getByRole("button", { name: "Importa file FSE+" }).click();
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Sorgente / registro esterno" }),
      source.descrizione,
    );
    await page.getByLabel(/Registro FSE\+/).setInputFiles({
      name: "registro-tablet.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: registryFixture(product.nome, `DOC-TABLET-${suffix}`, {
        warehouseDate: null,
      }),
    });
    await page.getByRole("button", { name: "Carica e analizza" }).click();
    const productSelect = page.getByRole("combobox", {
      name: new RegExp(`Associa a un prodotto esistente: ${product.nome}`),
    });
    await productSelect.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(productSelect).toContainText(product.codice);
    await page.getByRole("button", { name: "Associa", exact: true }).click();
    await page
      .getByRole("button", { name: "Correggi o conferma", exact: true })
      .click();
    await page
      .getByPlaceholder("Motivo obbligatorio")
      .fill("Conferma fallback nel viewport tablet");
    await page
      .getByText("Confermo l'uso della data documento come fallback")
      .click();
    const saveRevision = page.getByRole("button", {
      name: "Salva revisione",
      exact: true,
    });
    await saveRevision.scrollIntoViewIfNeeded();
    await expect(saveRevision).toBeVisible();
    await saveRevision.click();
    await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
    const readySelection = page
      .getByRole("dialog")
      .locator('[role="checkbox"]:not([disabled])');
    await expect(readySelection).toHaveCount(1);
    await readySelection.check();
    await page.getByRole("button", { name: "Vai al riepilogo" }).click();
    await assertViewportSafe(page);
    await page.getByRole("button", { name: "Indietro" }).click();
    await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Vai al riepilogo" }).click();
    await page.getByRole("button", { name: "Aggiungi alla pratica" }).click();
    const register = page.getByRole("button", {
      name: /registra nuove righe/i,
    });
    await register.scrollIntoViewIfNeeded();
    await expect(register).toBeVisible();
    await expect(register).toBeEnabled();
    await assertViewportSafe(page);
  });
});
