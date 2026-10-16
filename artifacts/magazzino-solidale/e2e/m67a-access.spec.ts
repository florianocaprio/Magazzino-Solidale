import { test, expect, type Page } from "@playwright/test";
import {
  m67aMensaFixture,
  m67aNeed,
} from "../../api-server/tests/helpers/m67a-mensa-fixture";
import { pool } from "../../../lib/db/src/index";
import { randomUUID } from "node:crypto";

const externalRequests = new WeakMap<Page, string[]>();
async function openSidebar(page: Page) {
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.locator('header [data-sidebar="trigger"]').click();
    await expect(
      page.getByRole("dialog", { name: "Sidebar", exact: true }),
    ).toBeVisible();
  }
}
test.beforeEach(async ({ page }) => {
  const unexpected: string[] = [];
  externalRequests.set(page, unexpected);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname))
      return route.continue();
    // Deterministic local substitute for the existing remote stylesheet: no
    // request reaches a font, geocoding or other external service.
    if (url.hostname === "fonts.googleapis.com")
      return route.fulfill({
        status: 200,
        contentType: "text/css",
        body: "/* offline synthetic test fonts */",
      });
    unexpected.push(url.hostname);
    return route.abort();
  });
});
test.afterEach(async ({ page }) => {
  expect(externalRequests.get(page)).toEqual([]);
});

test.afterAll(async () => {
  await pool.end();
});

for (const role of ["requester", "manager", "reporter", "mixed"] as const) {
  test(`M67-11 ${role}: menu and direct route respect source capabilities`, async ({
    page,
  }) => {
    const f = await m67aMensaFixture();
    await page.goto("/login");
    await page.getByLabel(/username|nome utente/i).fill(f.users[role].username);
    await page.getByLabel(/^password$/i).fill(f.users[role].password);
    await page.getByRole("button", { name: /accedi|login/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await openSidebar(page);
    const group = page.locator('[data-slot="sidebar-group"]').filter({
      has: page
        .locator('[data-slot="sidebar-group-label"]')
        .filter({ hasText: /^Mensa$/ }),
    });
    const trigger = group.locator('[data-slot="sidebar-group-label"]');
    if ((await trigger.getAttribute("aria-expanded")) === "false")
      await trigger.click();
    const menu = group.getByRole("link", { name: "Rifornimenti", exact: true });
    if (role === "reporter") await expect(menu).toHaveCount(0);
    else await expect(menu).toBeVisible();
    await page.goto("/mensa/trasferimenti");
    if (role === "reporter") {
      await expect(
        page.getByText(
          "Usa il menu per accedere alle sezioni a tua disposizione.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByText("Richieste al Magazzino", { exact: true }),
      ).toHaveCount(0);
      await page.goto("/m67a-unknown-route");
      await expect(
        page.getByRole("heading", {
          name: "404 Pagina non trovata",
          exact: true,
        }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByText("Richieste al Magazzino", { exact: true }),
      ).toBeVisible();
      const create = page.getByRole("button", {
        name: "Invia richiesta al Magazzino",
        exact: true,
      });
      if (role === "mixed") await expect(create).toHaveCount(0);
      else await expect(create).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Conferma ricezione", exact: true }),
      ).toHaveCount(0);
    }
  });
}

test("M67-03 warehouse page revalidates cached rows after same-session territory revocation", async ({
  page,
}) => {
  const f = await m67aMensaFixture();
  await pool.query(
    "insert into movimenti(tipo_movimento,tipo_dettaglio,data_movimento,magazzino_id,prodotto_id,quantita,unita_misura) values('carico','donazione',current_date,$1,$2,1,'kg')",
    [f.origin, f.product],
  );
  const product = (
    await pool.query("select nome from prodotti where id=$1", [f.product])
  ).rows[0].nome;
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(f.users.mixed.username);
  await page.getByLabel(/^password$/i).fill(f.users.mixed.password);
  await page.getByRole("button", { name: /accedi|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/movimenti");
  await expect(
    page.getByRole("cell", { name: product, exact: true }),
  ).toBeVisible();
  await openSidebar(page);
  const mensaGroup = page.locator('[data-slot="sidebar-group"]').filter({
    has: page
      .locator('[data-slot="sidebar-group-label"]')
      .filter({ hasText: /^Mensa$/ }),
  });
  const trigger = mensaGroup.locator('[data-slot="sidebar-group-label"]');
  if ((await trigger.getAttribute("aria-expanded")) === "false")
    await trigger.click();
  await mensaGroup
    .getByRole("link", { name: "Rifornimenti", exact: true })
    .click();
  await expect(page).toHaveURL(/\/mensa\/trasferimenti$/);
  await expect(
    page.getByText("Richieste al Magazzino", { exact: true }),
  ).toBeVisible();
  await pool.query(
    "update utenti set area_operativa_id=null, centro_ascolto_id=null where id=$1",
    [f.users.mixed.id],
  );
  await openSidebar(page);
  const warehouseGroup = page.locator('[data-slot="sidebar-group"]').filter({
    has: page
      .locator('[data-slot="sidebar-group-label"]')
      .filter({ hasText: /^Magazzino$/ }),
  });
  const warehouseTrigger = warehouseGroup.locator(
    '[data-slot="sidebar-group-label"]',
  );
  if ((await warehouseTrigger.getAttribute("aria-expanded")) === "false")
    await warehouseTrigger.click();
  const deniedRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/movimenti" &&
      response.status() === 403,
  );
  await warehouseGroup
    .getByRole("link", { name: "Movimenti", exact: true })
    .click();
  expect((await (await deniedRead).json()).error).toBe(
    "Assegnazione territoriale valida richiesta per consultare il Magazzino",
  );
  await expect(page).toHaveURL(/\/movimenti$/);
  await expect(
    page.getByRole("cell", { name: product, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "Accesso negato o sessione scaduta. I dati precedenti non sono consultabili.",
  );
});

test("M67-10/12 receive-only navigation, exact request beyond page one, report return and same-session revocation", async ({
  page,
  request,
}) => {
  const f = await m67aMensaFixture();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = await request.post("/api/auth/login", {
    data: f.users.requester,
  });
  expect(login.status()).toBe(200);
  const input = m67aNeed(f);
  const created = await request.post("/api/richieste-magazzino", {
    data: input,
  });
  expect(created.status(), await created.text()).toBe(201);
  const target = await created.json();
  // The exact target must not rely on the first page (20 records).
  for (let n = 0; n < 21; n++)
    expect(
      (
        await request.post("/api/richieste-magazzino", { data: m67aNeed(f) })
      ).status(),
    ).toBe(201);

  expect(
    (
      await request.post("/api/auth/login", { data: f.users.warehouse })
    ).status(),
  ).toBe(200);
  const taken = await request.post(
    `/api/richieste-magazzino/${target.id}/presa-in-carico`,
    { data: { versione: 1, idempotencyKey: randomUUID() } },
  );
  expect(taken.status(), await taken.text()).toBe(200);
  const document = await request.post(
    `/api/richieste-magazzino/${target.id}/documento`,
    {
      data: {
        versione: (await taken.json()).versione,
        idempotencyKey: randomUUID(),
        magazzinoId: f.origin,
        righe: [{ prodottoId: f.product, quantita: "12", unitaMisura: "kg" }],
      },
    },
  );
  expect(document.status(), await document.text()).toBe(201);
  const transfer = (
    await pool.query(
      "select id,versione,codice from trasferimenti where magazzino_origine_id=$1",
      [f.origin],
    )
  ).rows[0];
  const path = `/api/trasferimenti/${transfer.id}`;
  const edited = await request.patch(path, {
    data: {
      versione: transfer.versione,
      idempotencyKey: randomUUID(),
      trasportatoreNome: "Trasporto sintetico browser",
      righe: [{ prodottoId: f.product, quantita: "12", unitaMisura: "kg" }],
    },
  });
  expect(edited.status(), await edited.text()).toBe(200);
  const prepared = await request.post(`${path}/prepara`, {
    data: {
      versione: (await edited.json()).versione,
      idempotencyKey: randomUUID(),
    },
  });
  expect(prepared.status(), await prepared.text()).toBe(200);
  const shipped = await request.post(`${path}/avvia`, {
    data: {
      versione: (await prepared.json()).versione,
      idempotencyKey: randomUUID(),
    },
  });
  expect(shipped.status(), await shipped.text()).toBe(200);

  await page.goto("/login");
  await page
    .getByLabel(/username|nome utente/i)
    .fill(f.users.receiver.username);
  await page.getByLabel(/^password$/i).fill(f.users.receiver.password);
  await page.getByRole("button", { name: /accedi|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
  // Open via the actual sidebar, not just a manually constructed URL.
  await openSidebar(page);
  const group = page.locator('[data-slot="sidebar-group"]').filter({
    has: page
      .locator('[data-slot="sidebar-group-label"]')
      .filter({ hasText: /^Mensa$/ }),
  });
  const trigger = group.locator('[data-slot="sidebar-group-label"]');
  if ((await trigger.getAttribute("aria-expanded")) === "false")
    await trigger.click();
  const link = group.getByRole("link", { name: "Rifornimenti", exact: true });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/mensa\/trasferimenti$/);
  await expect(
    page.getByText("Richieste al Magazzino", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Invia richiesta al Magazzino",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: target.codice, exact: true }),
  ).toHaveCount(0);

  const report = `/report/mensa?da=2026-01-01&a=2026-12-31&mensaId=${f.canteens[0].id}`;
  await page.goto(report);
  const exact = page.getByRole("link", { name: target.codice, exact: true });
  await expect(exact).toHaveAttribute(
    "href",
    new RegExp(`^/mensa/trasferimenti\\?richiestaId=${target.id}&`),
  );
  await exact.click();
  await expect(
    page.getByRole("article", { name: target.codice, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: target.codice, exact: true }),
  ).toContainText(input.bisogno);
  await page
    .getByRole("article", { name: target.codice, exact: true })
    .getByRole("button", { name: new RegExp(transfer.codice) })
    .click();
  const supply = page.getByRole("dialog", {
    name: "Fornitura effettiva",
    exact: true,
  });
  await expect(supply).toContainText(transfer.codice);
  await expect(supply).toContainText("12");
  await page.keyboard.press("Escape");
  await expect(supply).toHaveCount(0);
  const receipt = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${path}/conferma`) &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Conferma ricezione", exact: true })
    .click();
  expect((await receipt).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Conferma ricezione", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await pool.query(
        "select sum(quantita_residua)::text qty from lotti where prodotto_id=$1 and magazzino_id=$2",
        [f.product, f.canteens[0].magazzinoId],
      )
    ).rows[0].qty,
  ).toBe("12.000000");
  expect(
    (
      await pool.query(
        "select count(*)::int n from movimenti where trasferimento_id=$1 and tipo_dettaglio='entrata'",
        [transfer.id],
      )
    ).rows[0].n,
  ).toBe(1);
  await page
    .getByRole("link", { name: "Torna al report", exact: true })
    .click();
  await expect(page).toHaveURL(new URL(report, "http://127.0.0.1:19672").href);
  await page.getByRole("link", { name: target.codice, exact: true }).click();
  await expect(
    page.getByRole("article", { name: target.codice, exact: true }),
  ).toBeVisible();
  expect(
    (await request.post("/api/auth/login", { data: f.users.admin })).status(),
  ).toBe(200);
  const revoke = await request.put(
    `/api/utenti/${f.users.receiver.id}/mense/${f.canteens[0].id}`,
    { data: { attiva: false, motivo: "Revoca sintetica browser" } },
  );
  expect(revoke.status(), await revoke.text()).toBe(200);
  await page
    .getByRole("group", { name: "Area Operativa", exact: true })
    .locator("..")
    .getByRole("button", { name: "Aggiorna", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: target.codice, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Nessuna assegnazione Mensa valida: contatta l'amministratore.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
