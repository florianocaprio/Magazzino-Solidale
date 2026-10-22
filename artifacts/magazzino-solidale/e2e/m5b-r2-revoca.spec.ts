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
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
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
    expect(deniedDetail.status()).toBe(403);
    expect(await deniedDetail.json()).toMatchObject({
      code: "RICHIESTE_MAGAZZINO_FORBIDDEN",
      error:
        "Assegna un'Area Operativa all'utente prima di utilizzare le funzionalità.",
    });
    const deniedDocument = await warehousePage.request.get(
      `/api/bolle/${document.documentoId}`,
    );
    // BUG01 rejects an unassigned Area before the linked-document
    // lookup. Require that specific territorial denial, not an arbitrary 403.
    expect(deniedDocument.status()).toBe(403);
    const deniedBody = await deniedDocument.json();
    expect(deniedBody).toMatchObject({
      code: "BOLLE_FORBIDDEN",
      error:
        "Assegna un'Area Operativa all'utente prima di utilizzare le funzionalità.",
    });
    expect(Object.keys(deniedBody).sort()).toEqual([
      "code",
      "correlationId",
      "details",
      "error",
      "message",
    ]);
    expect(JSON.stringify(deniedBody)).not.toContain(need);
    expect(JSON.stringify(deniedBody)).not.toContain("TEST-M5B-B1");

    await warehousePage.reload();
    // BUG6 blocks the entire private subtree before its document queries mount.
    // The direct API denials above remain mandatory, as do URL/cache cleanup.
    await expect(warehousePage.getByRole("alert")).toContainText(
      "Area Operativa non assegnata",
    );
    await expect(warehousePage.getByTestId("richiesta-sheet")).toHaveCount(0);
    await expect(warehousePage).not.toHaveURL(/richiestaId=/);
    await expect(warehousePage.getByText(need)).toHaveCount(0);
    await expect(warehousePage.getByText("Documento corrente")).toHaveCount(0);
    await warehousePage.goto("/richieste-magazzino");
    await expect(
      warehousePage.getByRole("button", { name: new RegExp(request.codice) }),
    ).toHaveCount(0);
    const privateReads: string[] = [];
    warehousePage.on("request", (req) => {
      const path = new URL(req.url()).pathname;
      if (
        path === `/api/richieste-magazzino/${request.id}` ||
        path === `/api/bolle/${document.documentoId}`
      )
        privateReads.push(path);
    });
    await warehousePage.goto(`/richieste-magazzino?richiestaId=${request.id}`);
    await expect(warehousePage.getByRole("alert")).toContainText(
      "Area Operativa non assegnata",
    );
    await expect(warehousePage.getByTestId("richiesta-sheet")).toHaveCount(0);
    await expect(warehousePage).not.toHaveURL(/richiestaId=/);
    await expect(warehousePage.getByText(need)).toHaveCount(0);
    await warehousePage.goto(`/bolle?bollaId=${document.documentoId}`);
    await expect(warehousePage.getByRole("alert")).toContainText(
      "Area Operativa non assegnata",
    );
    await expect(warehousePage).not.toHaveURL(/bollaId=/);
    await expect(
      warehousePage.getByRole("button", { name: /scarica pdf/i }),
    ).toHaveCount(0);
    expect(privateReads).toEqual([]);
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
