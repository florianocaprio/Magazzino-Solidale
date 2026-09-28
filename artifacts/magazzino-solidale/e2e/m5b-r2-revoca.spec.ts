import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD;
if (!password)
  throw new Error(
    "E2E_PASSWORD is required for the disposable R2 browser test",
  );

async function loginAs(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password!);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("R2-17: revoca durante pagina aperta, refresh e deep link non espongono richiesta o documento", async ({
  browser,
}, testInfo) => {
  const origin = new URL(String(testInfo.project.use.baseURL)).origin;
  // APIRequestContext does not add Origin by itself; keep the real CSRF gate.
  const contextOptions = { extraHTTPHeaders: { Origin: origin } };
  const centre = await browser.newContext(contextOptions);
  const warehouse = await browser.newContext(contextOptions);
  const admin = await browser.newContext(contextOptions);
  let adminPage: Page | undefined;
  let warehouseUserId: number | undefined;
  let areaId: number | undefined;
  try {
    const centrePage = await centre.newPage();
    const warehousePage = await warehouse.newPage();
    adminPage = await admin.newPage();
    const pageErrors: string[] = [];
    warehousePage.on("pageerror", (error) => pageErrors.push(error.message));
    await loginAs(centrePage, "test-m5b-center-a1");
    await loginAs(warehousePage, "test-m5b-warehouse-a");
    await loginAs(adminPage, "sadmin");

    const usersResponse = await adminPage.request.get("/api/utenti");
    expect(usersResponse.status(), await usersResponse.text()).toBe(200);
    const warehouseUser = (await usersResponse.json()).find(
      (user: { username: string }) => user.username === "test-m5b-warehouse-a",
    );
    expect(warehouseUser?.id).toBeTruthy();
    warehouseUserId = warehouseUser.id;
    areaId = warehouseUser.areaOperativaId;
    expect(areaId).toBeTruthy();

    const beneficiaries = await centrePage.request.get(
      "/api/beneficiari?search=TEST-M5B-B1",
    );
    expect(beneficiaries.status()).toBe(200);
    const beneficiary = (await beneficiaries.json()).find(
      (row: { codice: string }) => row.codice === "TEST-M5B-B1",
    );
    expect(beneficiary?.id).toBeTruthy();
    const need = `R2 browser synthetic ${randomUUID()}`;
    const sent = await centrePage.request.post("/api/richieste-magazzino", {
      data: {
        idempotencyKey: randomUUID(),
        tipoDestinatario: "beneficiario",
        sorgente: "beneficiario",
        beneficiarioId: beneficiary.id,
        bisogno: need,
        priorita: "normale",
      },
    });
    expect(sent.status(), await sent.text()).toBe(201);
    const request = await sent.json();
    const taken = await warehousePage.request.post(
      `/api/richieste-magazzino/${request.id}/presa-in-carico`,
      { data: { idempotencyKey: randomUUID(), versione: 1 } },
    );
    expect(taken.status(), await taken.text()).toBe(200);
    const warehouses = await warehousePage.request.get("/api/magazzini");
    expect(warehouses.status()).toBe(200);
    const origin = (await warehouses.json()).find(
      (item: { nome: string }) => item.nome === "TEST-M5B Deposito A1",
    );
    expect(origin?.id).toBeTruthy();
    const created = await warehousePage.request.post(
      `/api/richieste-magazzino/${request.id}/documento`,
      {
        data: {
          idempotencyKey: randomUUID(),
          versione: 2,
          magazzinoId: origin.id,
        },
      },
    );
    expect(created.status(), await created.text()).toBe(201);
    const document = await created.json();

    await warehousePage.goto(`/richieste-magazzino?richiestaId=${request.id}`);
    await expect(warehousePage.getByText(need).last()).toBeVisible();
    await expect(warehousePage.getByText("Documento corrente")).toBeVisible();

    const revoked = await adminPage.request.patch(
      `/api/utenti/${warehouseUserId}`,
      { data: { areaOperativaId: null, centroAscoltoId: null } },
    );
    expect(revoked.status(), await revoked.text()).toBe(200);

    const deniedDetail = await warehousePage.request.get(
      `/api/richieste-magazzino/${request.id}`,
    );
    expect(deniedDetail.status()).toBe(404);
    const deniedDocument = await warehousePage.request.get(
      `/api/bolle/${document.documentoId}`,
    );
    expect(deniedDocument.status()).toBe(404);

    await warehousePage.reload();
    await expect(warehousePage.getByRole("alert")).toContainText(
      /caricare|load/i,
    );
    await expect(warehousePage.getByText(need)).toHaveCount(0);
    await expect(warehousePage.getByText("Documento corrente")).toHaveCount(0);
    await warehousePage.goto("/richieste-magazzino");
    await expect(
      warehousePage.getByRole("button", { name: new RegExp(request.codice) }),
    ).toHaveCount(0);
    await warehousePage.goto(`/richieste-magazzino?richiestaId=${request.id}`);
    await expect(warehousePage.getByRole("alert")).toBeVisible();
    await expect(warehousePage.getByText(need)).toHaveCount(0);
    await warehousePage.goto(`/bolle?bollaId=${document.documentoId}`);
    await expect(
      warehousePage.getByRole("button", { name: /scarica pdf/i }),
    ).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    if (adminPage && warehouseUserId && areaId) {
      const restored = await adminPage.request.patch(
        `/api/utenti/${warehouseUserId}`,
        { data: { areaOperativaId: areaId, centroAscoltoId: null } },
      );
      expect(restored.status(), await restored.text()).toBe(200);
    }
    await centre.close();
    await warehouse.close();
    await admin.close();
  }
});
