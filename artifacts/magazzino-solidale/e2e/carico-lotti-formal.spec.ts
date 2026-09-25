import { expect, test, type Page } from "@playwright/test";
import { login, selectOption } from "./helpers";

async function createAreaAndWarehouse(page: Page, suffix: string) {
  const areaResponse = await page.request.post("/api/aree-operative", {
    data: { nome: `Area UX Lotti ${suffix}` },
  });
  expect(areaResponse.status()).toBe(201);
  const area = (await areaResponse.json()) as { id: number; nome: string };
  const warehouseResponse = await page.request.post("/api/magazzini", {
    data: {
      nome: `Magazzino UX Lotti ${suffix}`,
      areaOperativaId: area.id,
    },
  });
  expect(warehouseResponse.status()).toBe(201);
  const warehouse = (await warehouseResponse.json()) as {
    id: number;
    nome: string;
  };
  return { area, warehouse };
}

test("UX-LOT — ciclo Raccolta completo, Generale protetto e stock invariato", async ({
  page,
}, testInfo) => {
  await login(page);
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const { area, warehouse } = await createAreaAndWarehouse(page, suffix);
  const stockUrl = `/api/giacenze?areaOperativaId=${area.id}&magazzinoId=${warehouse.id}`;
  const stockBefore = await page.request.get(stockUrl);
  expect(stockBefore.ok()).toBe(true);

  await page.goto("/carico-merce?tab=raccolte");
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Area Operativa" }),
    area.nome,
  );
  const generalCard = page
    .locator(".rounded-xl.border.bg-card")
    .filter({ hasText: "GENERALE" });
  await expect(generalCard).toBeVisible();
  await generalCard.getByRole("button", { name: "Dettaglio" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Modifica" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Chiudi" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const code = `UX-${Date.now()}`;
  await page.getByRole("button", { name: "Nuova raccolta / attività" }).click();
  dialog = page.getByRole("dialog", { name: "Nuova raccolta / attività" });
  await dialog.getByLabel(/Codice della raccolta/).fill(code);
  await dialog
    .getByLabel(/Descrizione della raccolta/)
    .fill(`Raccolta ${suffix}`);
  await dialog
    .getByRole("button", { name: "Crea raccolta / attività" })
    .click();
  await expect(dialog).toHaveCount(0);

  const card = page.locator(".rounded-xl.border.bg-card").filter({
    hasText: code,
  });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Dettaglio" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Modifica" }).click();
  await dialog
    .getByRole("textbox", { name: /Descrizione della raccolta/ })
    .fill(`Raccolta aggiornata ${suffix}`);
  await dialog.getByRole("button", { name: "Salva" }).click();
  await expect(card).toContainText(`Raccolta aggiornata ${suffix}`);

  await card.getByRole("button", { name: "Dettaglio" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Chiudi" })
    .click();
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Stato" }),
    "Chiusa",
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Dettaglio" }).click();
  page.once("dialog", async (prompt) => prompt.accept("Riapertura test"));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Riapri" })
    .click();
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Stato" }),
    "Aperta",
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Dettaglio" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Chiudi" })
    .click();
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Stato" }),
    "Chiusa",
  );
  await card.getByRole("button", { name: "Dettaglio" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archivia" })
    .click();
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Stato" }),
    "Archiviata",
  );
  await expect(card).toBeVisible();

  const stockAfter = await page.request.get(stockUrl);
  expect(stockAfter.ok()).toBe(true);
  expect(await stockAfter.json()).toEqual(await stockBefore.json());
});

test("UX-LOT — lotto fisico: filtri, lineage e storico esauriti", async ({
  page,
}, testInfo) => {
  await login(page);
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const { area, warehouse } = await createAreaAndWarehouse(page, suffix);
  const productResponse = await page.request.post("/api/prodotti", {
    data: {
      nome: `Pasta UX Lotti ${suffix}`,
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
      lottoFisicoObbligatorio: false,
      gestioneScadenza: false,
    },
  });
  expect(productResponse.status()).toBe(201);
  const product = (await productResponse.json()) as {
    id: number;
    nome: string;
  };
  const supplierResponse = await page.request.post("/api/fornitori", {
    data: {
      nome: `Fornitore UX ${suffix}`,
      tipo: "azienda",
      areaOperativaId: area.id,
    },
  });
  expect(supplierResponse.status()).toBe(201);
  const supplier = (await supplierResponse.json()) as {
    id: number;
    nome: string;
  };
  const logicalResponse = await page.request.get(
    `/api/lotti-logici?areaOperativaId=${area.id}`,
  );
  expect(logicalResponse.ok()).toBe(true);
  const general = (
    (await logicalResponse.json()) as Array<{ id: number; isGenerale: boolean }>
  ).find((item) => item.isGenerale);
  expect(general).toBeDefined();

  let lotId: number | undefined;
  for (const [origin, number, quantity] of [
    ["DONAZIONE", "A", "2"],
    ["ACQUISTO", "B", "1"],
  ] as const) {
    const response = await page.request.post("/api/carichi", {
      data: {
        magazzinoId: warehouse.id,
        lottoLogicoId: general!.id,
        origineCarico: origin,
        fornitoreId: supplier.id,
        numeroDocumento: `DDT-${number}-${suffix}`,
        dataDocumento: "2026-09-25",
        dataCarico: "2026-09-25",
        righe: [
          {
            prodottoId: product.id,
            fondoOrigine: "NESSUN_FONDO",
            quantitaOperativa: quantity,
            codiceLotto: `LOT-${suffix}`,
          },
        ],
      },
    });
    expect(response.status()).toBe(201);
    const body = (await response.json()) as {
      righe: Array<{ lottoId: number }>;
    };
    if (lotId) expect(body.righe[0].lottoId).toBe(lotId);
    lotId = body.righe[0].lottoId;
  }

  await page.goto(
    `/carico-merce?tab=lotti&prodottoId=${product.id}&magazzinoId=${warehouse.id}`,
  );
  const row = page.getByRole("row").filter({ hasText: product.nome });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Donazione + Acquisto");
  await expect(row).toContainText(`DDT-A-${suffix}`);
  await expect(row).toContainText(`DDT-B-${suffix}`);
  await expect(row).toContainText(supplier.nome);
  await expect(row).toContainText("3.000000");
  await expect(row).toContainText("0.000000");
  await row.getByText("2 carichi collegati").click();
  await expect(row).toContainText("#");
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Fornitore" }),
    supplier.nome,
  );
  await expect(row).toBeVisible();

  const adjustment = await page.request.post(`/api/lotti/${lotId}/rettifica`, {
    data: { delta: "-3", causale: "inventario_fisico" },
  });
  expect(adjustment.ok()).toBe(true);
  await page.reload();
  await expect(row).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Includi esauriti / storico" })
    .check();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Esaurito");
});
