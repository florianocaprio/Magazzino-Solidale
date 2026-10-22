import { test, expect, type Page } from "@playwright/test";
import {
  m67aMensaFixture,
  m67aNeed,
} from "../../api-server/tests/helpers/m67a-mensa-fixture";
import { pool } from "../../../lib/db/src/index";
import { selectOption } from "./helpers";
import { randomUUID } from "node:crypto";

async function signIn(
  page: Page,
  user: { username: string; password: string },
) {
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(user.username);
  await page.getByLabel(/^password$/i).fill(user.password);
  await page.getByRole("button", { name: /accedi|login/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
}

test.afterAll(async () => {
  await pool.end();
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    await info.attach("synthetic-dom", {
      body: await page.locator("body").ariaSnapshot(),
      contentType: "text/plain",
    });
});

test("M67-21 residual: direct warehouse UI transfer reaches a Mensa in the Area without creating a request", async ({
  page,
  browser,
}) => {
  const f = await m67aMensaFixture();
  const names = (
    await pool.query("select id,nome from magazzini where id=any($1::int[])", [
      [f.origin, f.canteens[0].magazzinoId],
    ])
  ).rows;
  const product = (
    await pool.query("select nome from prodotti where id=$1", [f.product])
  ).rows[0].nome;
  const stock = async () =>
    (
      await pool.query(
        "select magazzino_id,sum(quantita_residua)::text qty from lotti where prodotto_id=$1 group by magazzino_id order by magazzino_id",
        [f.product],
      )
    ).rows;
  const requestsBefore = (
    await pool.query(
      "select count(*)::int n from richieste_magazzino where mensa_id=$1",
      [f.canteens[0].id],
    )
  ).rows[0].n;
  await signIn(page, f.users.warehouse);
  await page.goto("/trasferimenti");
  await page.getByRole("button", { name: "Nuovo", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Nuovo documento operativo", exact: true })
    .getByRole("button", {
      name: "Trasferimenti Movimento tra due magazzini",
      exact: true,
    })
    .click();
  const form = page.getByRole("dialog", {
    name: "Nuovo Trasferimento",
    exact: true,
  });
  await selectOption(
    page,
    form.getByRole("combobox", { name: "Magazzino di partenza", exact: true }),
    names.find((r) => r.id === f.origin).nome,
  );
  await selectOption(
    page,
    form.getByRole("combobox", {
      name: "Magazzino di destinazione",
      exact: true,
    }),
    names.find((r) => r.id === f.canteens[0].magazzinoId).nome,
  );
  await selectOption(
    page,
    form.getByRole("combobox", { name: "Trasportatore", exact: true }),
    "Altro…",
  );
  await form
    .getByPlaceholder("Nome del trasportatore")
    .fill("Trasporto sintetico P4");
  await selectOption(
    page,
    form.getByRole("combobox", { name: "Prodotto 1", exact: true }),
    new RegExp(product),
  );
  await form
    .getByRole("spinbutton", { name: "Quantità 1", exact: true })
    .fill("2");
  const creation = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/trasferimenti" &&
      r.request().method() === "POST",
  );
  await form
    .getByRole("button", { name: "Crea e genera bolla", exact: true })
    .click();
  const response = await creation;
  expect(response.status(), await response.text()).toBe(201);
  const transfer = await response.json();
  const row = page.getByRole("dialog", {
    name: "Dettaglio trasferimento",
    exact: true,
  });
  await expect(row).toContainText(transfer.codice);
  await row.getByRole("button", { name: "Segna pronto", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Avvia", exact: true }),
  ).toBeVisible();
  expect((await stock()).find((r) => r.magazzino_id === f.origin).qty).toBe(
    "12.000000",
  );
  await row.getByRole("button", { name: "Avvia", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await pool.query("select stato from trasferimenti where id=$1", [
            transfer.id,
          ])
        ).rows[0].stato,
    )
    .toBe("in_transito");
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize()!,
  });
  try {
    const receiver = await context.newPage();
    await signIn(receiver, f.users.receiver);
    await receiver.goto("/mensa/trasferimenti");
    await selectOption(
      receiver,
      receiver.getByRole("combobox", { name: "Mensa", exact: true }),
      f.canteens[0].nome,
    );
    const incoming = receiver.locator("article").filter({
      has: receiver.getByRole("heading", {
        name: new RegExp(transfer.codice),
      }),
    });
    await expect(incoming).toBeVisible();
    const receipt = receiver.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/trasferimenti/${transfer.id}/conferma`) &&
        r.request().method() === "POST",
    );
    await incoming
      .getByRole("button", { name: "Conferma ricezione", exact: true })
      .click();
    expect((await receipt).status()).toBe(200);
    await expect(incoming).toContainText("completato");
    const final = await stock();
    expect(final.find((r) => r.magazzino_id === f.origin).qty).toBe(
      "10.000000",
    );
    expect(
      final.find((r) => r.magazzino_id === f.canteens[0].magazzinoId).qty,
    ).toBe("2.000000");
    expect(
      (
        await pool.query(
          "select count(*)::int n from movimenti where trasferimento_id=$1",
          [transfer.id],
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await pool.query(
          "select count(*)::int n from richieste_magazzino where mensa_id=$1",
          [f.canteens[0].id],
        )
      ).rows[0].n,
    ).toBe(requestsBefore);
  } finally {
    await context.close();
  }
});

test("M67-26 residual: late request list cannot contaminate another Mensa in the Area", async ({
  page,
  request,
}) => {
  const f = await m67aMensaFixture();
  expect(
    (
      await request.post("/api/auth/login", { data: f.users.requester })
    ).status(),
  ).toBe(200);
  const records = [];
  for (const mensa of f.canteens) {
    const response = await request.post("/api/richieste-magazzino", {
      data: m67aNeed(f, mensa.id),
    });
    expect(response.status(), await response.text()).toBe(201);
    records.push(await response.json());
  }
  await signIn(page, f.users.requester);
  let release!: () => void, captured!: () => void, delivered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route("**/api/richieste-magazzino?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("mensaId") !== String(f.canteens[0].id))
      return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    captured();
    await barrier;
    try {
      await route.fulfill({ response });
    } finally {
      delivered();
    }
  });
  try {
    await page.goto("/mensa/trasferimenti");
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Mensa", exact: true }),
      f.canteens[0].nome,
    );
    await started;
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Mensa", exact: true }),
      f.canteens[1].nome,
    );
    await expect(
      page.getByText(records[1].codice, { exact: true }),
    ).toBeVisible();
    release();
    await finished;
    await expect(
      page.getByText(records[0].codice, { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(records[1].codice, { exact: true }),
    ).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("M67-23 residual: committed load survives lost response and UI reopening without a second stock increment", async ({
  page,
}) => {
  const f = await m67aMensaFixture();
  await pool.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify(["magazzino.view", "magazzino.stock.receive"]),
    f.users.warehouse.roleId,
  ]);
  await signIn(page, f.users.warehouse);
  const area = (
    await pool.query("select nome from aree_operative where id=$1", [f.area])
  ).rows[0];
  const [logical] = (
    await pool.query(
      "select id from lotti_logici where area_operativa_id=$1 and is_generale",
      [f.area],
    )
  ).rows;
  expect(logical).toBeTruthy();
  const description = `P4 load recovery ${randomUUID()}`;
  const created = await page.request.post("/api/carico-pratiche", {
    data: {
      areaOperativaId: f.area,
      magazzinoId: f.origin,
      lottoLogicoId: logical.id,
      origineCarico: "DONAZIONE",
      dataCarico: "2026-10-17",
      descrizione: description,
      righe: [
        { prodottoId: f.product, fondoOrigine: "NESSUN_FONDO", quantita: "2" },
      ],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const practice = await created.json();
  const snapshot = async () =>
    (
      await pool.query(
        "select (select sum(quantita_residua)::text from lotti where prodotto_id=$1) qty,(select count(*)::int from carico_integrazioni where carico_pratica_id=$2) integrations,(select count(*)::int from movimenti where prodotto_id=$1) movements",
        [f.product, practice.id],
      )
    ).rows[0];
  const before = await snapshot();
  const open = async () => {
    await page.goto("/carico-merce?tab=carichi");
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Area Operativa", exact: true }),
      area.nome,
    );
    const card = page.getByText(description, { exact: true }).locator("../..");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /apri pratica/i }).click();
  };
  await open();
  await page.getByRole("checkbox").check();
  let submitted: unknown,
    posts = 0,
    committed!: () => void;
  const committedPromise = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const endpoint = `/api/carico-pratiche/${practice.id}/registra`;
  await page.route(`**${endpoint}`, async (route) => {
    posts++;
    submitted = route.request().postDataJSON();
    const response = await route.fetch();
    expect(response.status(), await response.text()).toBe(201);
    await route.abort("connectionreset");
    committed();
  });
  await page
    .getByRole("button", { name: "Conferma carico a magazzino", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /conferma carico$/i })
    .click();
  await committedPromise;
  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  // Reopen the persisted practice, not a locally reconstructed form.
  await open();
  await expect(
    page.getByRole("button", {
      name: "Conferma carico a magazzino",
      exact: true,
    }),
  ).toBeDisabled();
  const detail = await page.request.get(`/api/carico-pratiche/${practice.id}`);
  expect(detail.status()).toBe(200);
  const data = await detail.json();
  expect(data.righe).toHaveLength(1);
  expect(data.righe[0].registrata).toBe(true);
  expect(data.integrazioni).toHaveLength(1);
  const after = await snapshot();
  expect(Number(after.qty) - Number(before.qty)).toBe(2);
  expect(after.integrations - before.integrations).toBe(1);
  expect(after.movements - before.movements).toBe(1);
  expect(posts).toBe(1);
  const replay = await page.request.post(endpoint, { data: submitted });
  expect(replay.status(), await replay.text()).toBe(200);
  expect(await snapshot()).toEqual(after);
});
