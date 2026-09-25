import { expect, test } from "@playwright/test";
import { login, selectOption } from "./helpers";

test.describe("UX-CARICO-01 — bozza e conferma carico", () => {
  test("evidenzia errori, conserva A quando salva B, crea attività e carica solo B", async ({
    page,
  }, testInfo) => {
    test.skip(
      !["desktop-1440x900", "tablet-820x1180", "mobile-390x844"].includes(
        testInfo.project.name,
      ),
      "Flusso UX verificato su desktop, tablet e mobile simulati",
    );
    await login(page);
    const suffix = `${Date.now()}-${testInfo.project.name}`;
    const areasResponse = await page.request.get("/api/aree-operative");
    expect(areasResponse.ok()).toBe(true);
    let area = (
      (await areasResponse.json()) as Array<{
        id: number;
        nome: string;
        attivo: boolean;
      }>
    ).find((item) => item.attivo);
    if (!area) {
      const areaResponse = await page.request.post("/api/aree-operative", {
        data: { nome: `UX Carico Area ${suffix}` },
      });
      expect(areaResponse.status()).toBe(201);
      area = (await areaResponse.json()) as {
        id: number;
        nome: string;
        attivo: boolean;
      };
    }
    const warehouseResponse = await page.request.post("/api/magazzini", {
      data: {
        nome: `A0 UX Carico Magazzino ${suffix}`,
        areaOperativaId: area.id,
      },
    });
    expect(warehouseResponse.status()).toBe(201);
    const warehouse = (await warehouseResponse.json()) as {
      id: number;
      nome: string;
    };
    const requiredResponse = await page.request.post("/api/prodotti", {
      data: {
        nome: `UX Lotto ${suffix}`,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
        quantitaFrazionabile: false,
        lottoFisicoObbligatorio: true,
        gestioneScadenza: true,
      },
    });
    expect(requiredResponse.status()).toBe(201);
    const required = (await requiredResponse.json()) as {
      id: number;
      codice: string;
      nome: string;
    };
    const optionalResponse = await page.request.post("/api/prodotti", {
      data: {
        nome: `UX Libero ${suffix}`,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
        quantitaFrazionabile: false,
        lottoFisicoObbligatorio: false,
        gestioneScadenza: false,
      },
    });
    expect(optionalResponse.status()).toBe(201);
    const optional = (await optionalResponse.json()) as {
      id: number;
      codice: string;
      nome: string;
    };
    const emptyResponse = await page.request.post("/api/prodotti", {
      data: {
        nome: `UX Pendente ${suffix}`,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
        quantitaFrazionabile: false,
        lottoFisicoObbligatorio: false,
        gestioneScadenza: false,
      },
    });
    expect(emptyResponse.status()).toBe(201);
    const empty = (await emptyResponse.json()) as {
      id: number;
      codice: string;
      nome: string;
    };

    await page.goto("/prodotti");
    const requiredCatalogRow = page
      .getByRole("row")
      .filter({ hasText: required.nome });
    const optionalCatalogRow = page
      .getByRole("row")
      .filter({ hasText: optional.nome });
    await expect(
      page.getByText("Blu = codice lotto obbligatorio"),
    ).toBeVisible();
    await expect(
      requiredCatalogRow.getByText(required.nome, { exact: true }),
    ).toHaveClass(/text-blue-700/);
    await expect(requiredCatalogRow.getByText("Lotto richiesto")).toBeVisible();
    await expect(
      optionalCatalogRow.getByText(optional.nome, { exact: true }),
    ).toHaveClass(/text-foreground/);
    await expect(optionalCatalogRow.getByText("Lotto richiesto")).toHaveCount(
      0,
    );
    const requiredName = requiredCatalogRow.getByText(required.nome, {
      exact: true,
    });
    const lightColor = await requiredName.evaluate(
      (element) => getComputedStyle(element).color,
    );
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const darkColor = await requiredName.evaluate(
      (element) => getComputedStyle(element).color,
    );
    expect(darkColor).not.toBe(lightColor);
    await page.evaluate(() =>
      document.documentElement.classList.remove("dark"),
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    await page.goto("/carico-merce");
    await page.getByRole("button", { name: "Nuova pratica" }).click();
    await page.getByRole("button", { name: "Salva bozza" }).click();
    await expect(page.getByText("Inserisci la Descrizione.")).toBeVisible();
    await expect(page.getByLabel("Descrizione")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Area Operativa" }),
      area.nome,
    );
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Magazzino destinazione" }),
      warehouse.nome,
    );
    await page.getByLabel("Descrizione").fill(`Pratica UX ${suffix}`);
    await expect(page.getByText("Inserisci la Descrizione.")).toHaveCount(0);
    await page.getByRole("button", { name: "Salva bozza" }).click();
    await expect(
      page.getByText("Aggiungi prodotto", { exact: true }),
    ).toBeVisible();

    await page.getByLabel("Cerca per nome o codice").fill(required.codice);
    const requiredChoice = page.getByRole("button", {
      name: new RegExp(required.codice),
    });
    await expect(requiredChoice.getByText(required.nome)).toHaveClass(
      /text-blue-700/,
    );
    await expect(requiredChoice.getByText("Lotto richiesto")).toBeVisible();
    await expect(
      page.getByText("Blu = codice lotto obbligatorio"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: new RegExp(required.codice) })
      .click();
    await page.getByLabel("Cerca per nome o codice").fill(optional.codice);
    const optionalChoice = page.getByRole("button", {
      name: new RegExp(optional.codice),
    });
    await expect(optionalChoice.getByText(optional.nome)).toHaveClass(
      /text-foreground/,
    );
    await expect(optionalChoice.getByText("Lotto richiesto")).toHaveCount(0);
    await page
      .getByRole("button", { name: new RegExp(optional.codice) })
      .click();
    await page.getByLabel("Cerca per nome o codice").fill(empty.codice);
    await page.getByRole("button", { name: new RegExp(empty.codice) }).click();
    const rowA = page
      .locator('[data-testid^="carico-row-"]')
      .filter({ hasText: required.nome });
    const rowB = page
      .locator('[data-testid^="carico-row-"]')
      .filter({ hasText: optional.nome });
    const rowC = page
      .locator('[data-testid^="carico-row-"]')
      .filter({ hasText: empty.nome });
    await expect(rowA.getByText(required.nome, { exact: true })).toHaveClass(
      /text-blue-700/,
    );
    await expect(rowA.getByText("Lotto richiesto")).toBeVisible();
    await expect(rowA.getByText("Codice lotto produttore *")).toBeVisible();
    await expect(rowB.getByText(optional.nome, { exact: true })).toHaveClass(
      /text-foreground/,
    );
    await expect(rowB.getByText("Lotto richiesto")).toHaveCount(0);
    await expect(
      rowB.getByText("Codice lotto produttore", { exact: true }),
    ).toBeVisible();
    await rowA.getByRole("button", { name: "Salva bozza" }).click();
    await expect(rowA.getByText("Inserisci la quantità.")).toBeVisible();
    await expect(
      rowA.getByText("Per questo prodotto è obbligatorio il codice lotto."),
    ).toBeVisible();
    await expect(rowA.getByText("Inserisci la scadenza.")).toBeVisible();
    await expect(rowA.getByText(/Bozza salvata\. Completa/i)).toBeVisible();
    await expect(rowA.getByLabel(/Quantità/)).toBeFocused();
    await expect(rowA.getByRole("checkbox")).not.toBeChecked();
    await expect(rowC.getByRole("checkbox")).not.toBeChecked();
    await rowA.getByRole("checkbox").check();
    await expect(
      page.getByText(/Righe selezionate incomplete: 1/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Conferma carico a magazzino" }),
    ).toBeDisabled();
    await rowA.getByRole("checkbox").uncheck();
    await rowA.getByLabel(/Quantità/).fill("7");
    await expect(rowA.getByText("Inserisci la quantità.")).toHaveCount(0);
    await expect(rowA.getByText("Inserisci la scadenza.")).toBeVisible();

    await rowB.getByLabel(/Quantità/).fill("3");
    await rowB.getByRole("button", { name: "Salva bozza" }).click();
    await expect(rowB.getByRole("checkbox")).toBeChecked();
    await expect(rowA.getByLabel(/Quantità/)).toHaveValue("7");
    await expect(
      rowA.getByText("Per questo prodotto è obbligatorio il codice lotto."),
    ).toBeVisible();
    await expect(rowC.getByLabel(/Quantità/)).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Conferma carico a magazzino" }),
    ).toBeEnabled();

    await page
      .getByRole("button", { name: "Nuova raccolta / attività" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Nuova raccolta / attività",
    });
    await expect(dialog).toContainText(area.nome);
    await dialog
      .getByRole("button", { name: "Crea raccolta / attività" })
      .click();
    await expect(dialog.getByText("Inserisci il Codice.")).toBeVisible();
    await expect(dialog.getByText("Inserisci la Descrizione.")).toBeVisible();
    await dialog.getByLabel(/Codice della raccolta/).fill(`UX-${Date.now()}`);
    await dialog
      .getByLabel(/Descrizione della raccolta/)
      .fill(`Raccolta UX ${suffix}`);
    let failedOnce = false;
    await page.route("**/api/lotti-logici", async (route) => {
      if (route.request().method() === "POST" && !failedOnce) {
        failedOnce = true;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "Conflitto raccolta UX" }),
        });
      } else await route.continue();
    });
    await dialog
      .getByRole("button", { name: "Crea raccolta / attività" })
      .click();
    await expect(dialog.getByText("Conflitto raccolta UX")).toBeVisible();
    await page.waitForTimeout(6000);
    await expect(dialog.getByText("Conflitto raccolta UX")).toBeVisible();
    await expect(dialog.getByLabel(/Descrizione della raccolta/)).toHaveValue(
      `Raccolta UX ${suffix}`,
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await dialog
      .getByRole("button", { name: "Crea raccolta / attività" })
      .click();
    await page.unroute("**/api/lotti-logici");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Raccolta / attività" }),
    ).toContainText(`Raccolta UX ${suffix}`);
    await expect(rowA.getByLabel(/Quantità/)).toHaveValue("7");
    await expect(
      page.getByText(
        "Salva le modifiche alla testata prima di caricare a magazzino.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Salva bozza" }).first().click();
    await expect(rowA.getByLabel(/Quantità/)).toHaveValue("7");
    await expect(rowB.getByRole("checkbox")).toBeChecked();

    await rowB.getByLabel(/Quantità/).fill("4");
    await expect(rowB.getByRole("checkbox")).toBeChecked();
    await expect(
      page.getByText(
        "Salva le modifiche alle righe selezionate prima di caricare a magazzino.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Conferma carico a magazzino" }),
    ).toBeDisabled();
    await rowB.getByRole("button", { name: "Salva bozza" }).click();
    await expect(rowB.getByRole("checkbox")).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Conferma carico a magazzino" }),
    ).toBeEnabled();

    await rowB.getByLabel(/Quantità/).fill("");
    await rowB.getByRole("button", { name: "Salva bozza" }).click();
    await expect(rowB.getByText(/Bozza salvata\. Completa/i)).toBeVisible();
    await expect(rowB.getByRole("checkbox")).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Conferma carico a magazzino" }),
    ).toBeDisabled();
    await rowB.getByLabel(/Quantità/).fill("3");
    await rowB.getByRole("button", { name: "Salva bozza" }).click();
    await expect(rowB.getByRole("checkbox")).toBeChecked();
    await expect(rowA.getByLabel(/Quantità/)).toHaveValue("7");

    await expect(
      page.getByRole("button", { name: "Conferma carico a magazzino" }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Conferma carico a magazzino" })
      .click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Confermi il carico a magazzino?",
    });
    await expect(confirmation).toContainText(warehouse.nome);
    await expect(confirmation).toContainText(optional.nome);
    await expect(confirmation).not.toContainText(required.nome);
    const registrationResponse = page.waitForResponse(
      (response) =>
        /\/api\/carico-pratiche\/\d+\/registra$/.test(response.url()) &&
        response.request().method() === "POST",
    );
    await confirmation.getByRole("button", { name: "Conferma carico" }).click();
    const registered = await registrationResponse;
    expect(registered.status()).toBe(201);
    const retry = await page.request.post(new URL(registered.url()).pathname, {
      data: registered.request().postDataJSON(),
    });
    expect(retry.status()).toBe(200);
    expect(((await retry.json()) as { replay: boolean }).replay).toBe(true);
    const detailResponse = await page.request.get(
      new URL(registered.url()).pathname.replace(/\/registra$/, ""),
    );
    expect(detailResponse.ok()).toBe(true);
    const detail = (await detailResponse.json()) as {
      integrazioni: unknown[];
      righe: Array<{ prodottoId: number; registrata: boolean }>;
    };
    expect(detail.integrazioni).toHaveLength(1);
    expect(detail.righe.filter((row) => row.registrata)).toEqual([
      expect.objectContaining({ prodottoId: optional.id }),
    ]);
    expect(detail.righe.filter((row) => !row.registrata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prodottoId: required.id }),
        expect.objectContaining({ prodottoId: empty.id }),
      ]),
    );
    await expect(
      page.getByText("Carico registrato a magazzino", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Prodotti caricati a magazzino")).toBeVisible();

    const stockResponse = await page.request.get(
      `/api/giacenze?areaOperativaId=${area.id}&magazzinoId=${warehouse.id}`,
    );
    expect(stockResponse.ok()).toBe(true);
    const stock = (await stockResponse.json()) as Array<{
      prodottoId: number;
      giacenzaFisica: number;
    }>;
    expect(
      stock.find((item) => item.prodottoId === optional.id)?.giacenzaFisica,
    ).toBe(3);
    expect(
      stock.find((item) => item.prodottoId === required.id)?.giacenzaFisica ??
        0,
    ).toBe(0);
    expect(
      stock.find((item) => item.prodottoId === empty.id)?.giacenzaFisica ?? 0,
    ).toBe(0);
    await rowA.getByRole("button", { name: "Rimuovi riga" }).click();
    await rowC.getByRole("button", { name: "Rimuovi riga" }).click();
    await page.getByRole("button", { name: "Chiudi carico" }).click();
    await expect(
      page.getByRole("button", { name: "Salva bozza" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Nuova raccolta / attività" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Conferma carico a magazzino" }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
});
