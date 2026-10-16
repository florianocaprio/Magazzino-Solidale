import { expect, test, type Page } from "@playwright/test";

async function syntheticApp(page: Page) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("Explicit isolated baseURL required");
  const base = new URL(baseURL);
  if (
    !["127.0.0.1", "localhost"].includes(base.hostname) ||
    ["8082", "8083", ""].includes(base.port)
  )
    throw new Error(
      "Disposable local server required; persistent ports forbidden",
    );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base.origin) {
      await route.fulfill({ status: 200, body: "", contentType: "text/css" });
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    let body: unknown = [];
    if (url.pathname === "/api/auth/me")
      body = {
        id: 1,
        username: "fixture-m67c",
        nome: "Test",
        cognome: "Sintetico",
        isAdmin: true,
        aree: ["sociale", "magazzino"],
        permessi: [],
        areaOperativaId: null,
        centroAscoltoId: null,
      };
    else if (url.pathname === "/api/auth/bootstrap-status")
      body = { bootstrap: false };
    else if (url.pathname.includes("configurazione-ambiente"))
      body = {
        moduliAttivi: [
          "CENTRO_ASCOLTO",
          "MAGAZZINO_SOLIDALE",
          "CONSEGNE",
          "BOLLE",
          "MENSA",
          "EMPORIO_SOLIDALE",
          "UDS",
          "REPORT",
          "LOTTI",
          "SCARICHI",
          "TRASFERIMENTI",
        ],
        mapsAbilitato: true,
      };
    else if (url.pathname === "/api/maps/capabilities")
      body = { operational: true, layers: [] };
    else if (url.pathname === "/api/richieste-magazzino")
      body = { items: [], total: 0, page: 1, limit: 30 };
    else if (url.pathname === "/api/consegne")
      body = { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 };
    else if (url.pathname === "/api/beneficiari")
      body = [
        {
          id: 11,
          codice: "B-SYN",
          nome: "Persona",
          cognome: "Sintetica",
          attivo: true,
        },
      ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test("M67-13 baseline: cancel protects an unsent social need", async ({
  page,
}) => {
  await syntheticApp(page);
  await page.goto("/richieste-magazzino");
  await page
    .getByRole("button", { name: "Nuova richiesta", exact: true })
    .click();
  await page
    .getByLabel("Descrizione del bisogno", { exact: true })
    .fill("Bozza sintetica M67C");
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Resta e continua", exact: true })
    .click();
  await expect(
    page.getByLabel("Descrizione del bisogno", { exact: true }),
  ).toHaveValue("Bozza sintetica M67C");
});

test("M67-15 baseline: touch sidebar trigger remains reachable at 768px", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await syntheticApp(page);
  await page.goto("/richieste-magazzino");
  await expect(
    page.getByRole("heading", { name: "Richieste al Magazzino" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("sidebar-768.png"),
    fullPage: true,
  });
  await expect(page.locator('header [data-sidebar="trigger"]')).toBeVisible();
});

test("M67-17 baseline: failed capabilities are not an authorized empty map", async ({
  page,
}) => {
  await syntheticApp(page);
  await page.route("**/api/maps/capabilities", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fixture servizio indisponibile" }),
    }),
  );
  await page.goto("/maps");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByText(
      "Non sono disponibili livelli geografici per il tuo profilo.",
    ),
  ).toHaveCount(0);
});

for (const [width, height] of [
  [390, 844],
  [767, 1024],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1440, 900],
]) {
  test(`M67-15 touch menu, dense form and rotation ${width}x${height}`, async ({
    page,
  }, info) => {
    await syntheticApp(page);
    await page.setViewportSize({ width, height });
    await page.goto("/richieste-magazzino");
    const trigger = page.locator('header [data-sidebar="trigger"]');
    await expect(trigger).toBeVisible();
    const box = await trigger.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await trigger.tap();
    if (width < 768) {
      const menu = page.getByRole("dialog");
      await expect(menu).toBeVisible();
      const groups = menu.locator('[data-slot="sidebar-group-label"]');
      for (const group of await groups.all()) await group.click();
      await menu.getByRole("button", { name: "Chiudi", exact: true }).tap();
      await expect(menu).toBeHidden();
    } else {
      await expect(
        page.locator('[data-state="collapsed"][data-collapsible="offcanvas"]'),
      ).toBeVisible();
      await trigger.tap();
      await expect(
        page.locator('[data-state="expanded"][data-side]'),
      ).toBeVisible();
      await trigger.tap();
    }
    await page
      .getByRole("button", { name: "Nuova richiesta", exact: true })
      .click();
    await page.locator("#rm-need").fill("Need synthetic");
    await page.locator("#rm-notes").fill("Synthetic notes");
    const cancel = page.getByRole("button", { name: "Annulla", exact: true });
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`form-${width}.png`) });
    await page.setViewportSize({ width: height, height: width });
    await expect(page.locator("#rm-need")).toHaveValue("Need synthetic");
    await cancel.scrollIntoViewIfNeeded();
    await cancel.click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page
      .getByRole("button", { name: "Scarta modifiche", exact: true })
      .click();
  });
}

test("M67-13/14 mandatory fields, failed send preserved, successful send clean", async ({
  page,
}) => {
  await syntheticApp(page);
  let status = 503;
  const sent: any[] = [];
  await page.route("**/api/richieste-magazzino", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.push(route.request().postDataJSON());
    if (status === 0) return route.abort("internetdisconnected");
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(
        status === 503
          ? { error: "Synthetic unavailable" }
          : { id: 90, codice: "RM-SYN", stato: "inviata" },
      ),
    });
  });
  await page.goto("/richieste-magazzino");
  await page
    .getByRole("button", { name: "Nuova richiesta", exact: true })
    .click();
  const send = page.locator('form button[type="submit"]');
  await send.click();
  await expect(page.locator("#rm-beneficiary")).toBeFocused();
  await expect(page.locator("#rm-beneficiary")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("#rm-need")).toHaveAttribute(
    "aria-describedby",
    "rm-need-error",
  );
  expect(sent).toHaveLength(0);
  await page.locator("#rm-beneficiary").selectOption("11");
  await send.click();
  await expect(page.locator("#rm-need")).toBeFocused();
  await page.locator("#rm-need").fill("Synthetic need");
  await page.locator("#rm-notes").fill("Synthetic private notes");
  await send.click();
  await expect(page.getByRole("alert")).toContainText("Synthetic unavailable");
  await expect(page.locator("#rm-need")).toHaveValue("Synthetic need");
  await expect(page.locator("#rm-notes")).toHaveValue(
    "Synthetic private notes",
  );
  expect(sent).toHaveLength(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "Synthetic private notes",
  );
  status = 0;
  await send.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(send).toBeEnabled();
  expect(sent).toHaveLength(2);
  status = 200;
  await send.click();
  await expect(page.locator("#rm-need")).toHaveCount(0);
  expect(sent).toHaveLength(3);
  expect(sent[2]).toEqual(sent[1]);
  await page
    .getByRole("button", { name: "Nuova richiesta", exact: true })
    .click();
  await expect(page.locator("#rm-need")).toHaveValue("");
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("M67-13 browser back/reload stay and menu discard protect the draft", async ({
  page,
}) => {
  await syntheticApp(page);
  await page.goto("/richieste-magazzino");
  await page.getByRole("button", { name: "Concluse", exact: true }).click();
  await page
    .getByRole("button", { name: "Nuova richiesta", exact: true })
    .click();
  await page.locator("#rm-notes").fill("Unsaved notes only");
  const backDialog = page.waitForEvent("dialog");
  const back = page.goBack();
  const dialog = await backDialog;
  expect(dialog.type()).toBe("confirm");
  await dialog.dismiss();
  await back;
  await expect(page.locator("#rm-notes")).toHaveValue("Unsaved notes only");
  await expect(page).toHaveURL(/vista=chiusa/);
  const reloadDialog = page.waitForEvent("dialog");
  // A cancelled navigation has no load event to await. Assert the surviving DOM.
  void page.reload().catch(() => null);
  const confirm = await reloadDialog;
  expect(confirm.type()).toBe("beforeunload");
  await confirm.dismiss();
  await expect(page.locator("#rm-notes")).toHaveValue("Unsaved notes only");
  // Actual sidebar navigation, not a synthetic history replacement.
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.locator('header [data-sidebar="trigger"]').click();
    await expect(
      page.getByRole("dialog", { name: "Sidebar", exact: true }),
    ).toBeVisible();
  }
  await page.getByText("Magazzino", { exact: true }).click();
  await page.getByRole("link", { name: "Movimenti", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Resta e continua", exact: true })
    .click();
  await expect(page.locator("#rm-notes")).toHaveValue("Unsaved notes only");
  await page.getByRole("link", { name: "Movimenti", exact: true }).click();
  await page
    .getByRole("button", { name: "Scarta modifiche", exact: true })
    .click();
  await expect(page).toHaveURL(/\/movimenti$/);
});

const reads = [
  {
    url: "/consegne?tab=consegne",
    api: "/api/consegne",
    empty: "Nessuna consegna pianificata.",
  },
  {
    url: "/movimenti",
    api: "/api/movimenti",
    empty: "Nessun movimento trovato.",
  },
  {
    url: "/maps",
    api: "/api/maps/capabilities",
    empty: "Non sono disponibili livelli geografici per il tuo profilo.",
  },
];
for (const read of reads)
  test(`M67-17 loading ${read.api} before authorized empty result`, async ({
    page,
  }) => {
    await syntheticApp(page);
    let release!: () => void,
      hits = 0;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${read.api}*`, async (route) => {
      hits++;
      await barrier;
      await route.fallback();
    });
    try {
      await page.goto(read.url);
      await expect.poll(() => hits).toBeGreaterThan(0);
      await expect
        .poll(() =>
          page.locator("main .animate-pulse").filter({ visible: true }).count(),
        )
        .toBeGreaterThan(0);
      await expect(page.getByText(read.empty, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      release();
      await expect(
        page.getByText(read.empty, { exact: true }).filter({ visible: true }),
      ).toBeVisible();
    } finally {
      release();
    }
  });
for (const read of reads) {
  for (const status of [401, 403, 500, 503])
    test(`M67-17 cold ${read.api} ${status} recovery`, async ({ page }) => {
      await syntheticApp(page);
      let failed = true,
        requests = 0;
      await page.route(`**${read.api}*`, (route) => {
        if (!failed) return route.fallback();
        requests++;
        return route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic failure" }),
        });
      });
      await page.goto(read.url);
      await expect(page.getByRole("alert")).toContainText(
        status < 500 ? "Accesso negato" : "Impossibile caricare",
      );
      await expect(page.getByText(read.empty, { exact: true })).toHaveCount(0);
      // Maps layout has a separate capability observer; neither observer loops.
      expect(requests).toBeLessThanOrEqual(read.api.includes("maps") ? 2 : 1);
      failed = false;
      await page.getByRole("button", { name: "Riprova lettura" }).click();
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  test(`M67-17 warm ${read.api} transient, denial, offline, recovery`, async ({
    page,
  }) => {
    await syntheticApp(page);
    let status = 200;
    let hits = 0;
    await page.route(`**${read.api}*`, (route) => {
      hits++;
      if (status === 200) return route.fallback();
      if (status === 0) return route.abort("internetdisconnected");
      return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic failure" }),
      });
    });
    await page.goto(read.url);
    await expect.poll(() => hits).toBeGreaterThan(0);
    // Wait for the successful authorized empty state before invalidation.
    if (read.api.includes("maps"))
      await expect(page.getByText(read.empty, { exact: true })).toBeVisible();
    else
      await expect(
        page.getByText(read.empty, { exact: true }).filter({ visible: true }),
      ).toBeVisible();
    status = 503;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(page.getByRole("alert")).toContainText(
      "Dati precedenti non aggiornati",
    );
    status = 403;
    await page.getByRole("button", { name: "Riprova lettura" }).click();
    await expect(page.getByRole("alert")).toContainText("Accesso negato");
    for (const nextStatus of [401, 500]) {
      status = nextStatus;
      await page.getByRole("button", { name: "Riprova lettura" }).click();
      await expect(page.getByRole("alert")).toContainText(
        nextStatus === 401
          ? "Accesso negato"
          : "Dati precedenti non aggiornati",
      );
    }
    status = 0;
    await page.getByRole("button", { name: "Riprova lettura" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Dati precedenti non aggiornati",
    );
    status = 200;
    await page.getByRole("button", { name: "Riprova lettura" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("Budget: lazy first-run setup still renders without creating users", async ({
  page,
}) => {
  await syntheticApp(page);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/auth/bootstrap-status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"bootstrap":true}',
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Configurazione iniziale", { exact: true }),
  ).toBeVisible();
});

for (const kind of ["consegne", "movimenti"] as const)
  test(`M67-17 populated ${kind}: cache withheld on denial and scope change`, async ({
    page,
  }) => {
    await syntheticApp(page);
    const delivery = {
      id: 701,
      codice: "C-SYN",
      dataPrevista: "2026-10-15",
      fasciaOraria: "Mattina",
      beneficiarioNome: "Protected synthetic record",
      beneficiarioId: 11,
      stato: "pianificata",
      tipoConsegna: "in_sede",
      bollaId: null,
    };
    const movement = {
      id: 701,
      tipoMovimento: "carico",
      tipoDettaglio: "donazione",
      effettoFisico: 1,
      dataMovimento: "2026-10-15",
      quantita: 1,
      quantitaPrecisa: "1",
      unitaMisura: "pz",
      prodottoNome: "Protected synthetic record",
      magazzinoNome: "Fixture",
    };
    let status = 200;
    await page.route(`**/api/${kind}*`, (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(
          status === 200
            ? kind === "consegne"
              ? {
                  items: [delivery],
                  total: 1,
                  page: 1,
                  pageSize: 25,
                  totalPages: 1,
                }
              : [movement]
            : { error: "Synthetic error" },
        ),
      }),
    );
    await page.goto(
      kind === "consegne" ? "/consegne?tab=consegne" : "/movimenti",
    );
    await expect(
      page
        .getByText("Protected synthetic record", { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    status = 403;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(page.getByRole("alert")).toContainText("Accesso negato");
    await expect(
      page.getByText("Protected synthetic record", { exact: true }),
    ).toHaveCount(0);
    status = 500;
    await page.getByRole("button", { name: "Riprova lettura" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Dati precedenti non aggiornati",
    );
    await expect(
      page.getByText("Protected synthetic record", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Esporta/ })).toBeDisabled();
    status = 200;
    await page.getByRole("button", { name: "Riprova lettura" }).click();
    await expect(
      page
        .getByText("Protected synthetic record", { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    if (kind === "consegne") {
      await page.route("**/api/aree-operative", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify([{ id: 2, nome: "Area sintetica B" }]),
        }),
      );
      // Change territory via the real page's URL/popstate filter restoration.
      status = 403;
      await page.evaluate(() => {
        history.pushState(null, "", "/consegne?tab=consegne&area=2");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect(page.getByRole("alert")).toContainText("Accesso negato");
      await expect(
        page.getByText("Protected synthetic record", { exact: true }),
      ).toHaveCount(0);
    }
  });

for (const read of reads)
  test(`M67-17 cold network/timeout ${read.api}, then recovery`, async ({
    page,
  }) => {
    await syntheticApp(page);
    let fault = "timedout";
    await page.route(`**${read.api}*`, (route) =>
      fault ? route.abort(fault) : route.fallback(),
    );
    await page.goto(read.url);
    await expect(page.getByRole("alert")).toContainText("Impossibile caricare");
    await expect(page.getByText(read.empty, { exact: true })).toHaveCount(0);
    fault = "internetdisconnected";
    await page.getByRole("button", { name: "Riprova lettura" }).click();
    await expect(page.getByRole("alert")).toContainText("Impossibile caricare");
    fault = "";
    await page.getByRole("button", { name: "Riprova lettura" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
