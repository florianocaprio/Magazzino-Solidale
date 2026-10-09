import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test, expect, type Page } from "@playwright/test";
import { selectOption } from "./helpers";
const require = createRequire(
  new URL("../../api-server/package.json", import.meta.url),
);
const bcrypt = require("bcryptjs") as typeof import("bcryptjs");
let database: Awaited<typeof import("../../../lib/db/src/index.ts")>["pool"];
test.beforeAll(async () => {
  const url = new URL(process.env.E2E_DATABASE_URL!);
  if (
    process.env.M62A_F1_DISPOSABLE_DB !== "verified" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "58621" ||
    url.pathname !== "/m62a"
  )
    throw Error("Only verified F1 disposable PostgreSQL");
  process.env.DATABASE_URL = url.href;
  const { Pool } = createRequire(
    new URL("../../../lib/db/package.json", import.meta.url),
  )("pg");
  database = new Pool({ connectionString: url.href });
  // Fresh disposable DB must be past bootstrap; ordinary actors below retain their grants.
  const admin = await database.query(
    "select u.id from utenti u join ruoli r on r.id=u.ruolo_id where u.attivo and r.is_admin limit 1",
  );
  if (admin.rows.length === 0) {
    const suffix = randomUUID();
    const {
      rows: [role],
    } = await database.query(
      "insert into ruoli(nome,is_admin,aree,permessi) values($1,true,'[]','[]') returning id",
      [`E2E bootstrap ${suffix}`],
    );
    await database.query(
      "insert into utenti(username,nome,password_hash,ruolo_id) values($1,'E2E bootstrap only','not-a-login-hash',$2)",
      [`e2e_boot_${suffix}`, role.id],
    );
  }
});
test.afterAll(async () => {
  await database?.end();
});
async function fixture(count: number, eligible = true, owner = false) {
  const s = randomUUID().slice(0, 8);
  const insert = async (sql: string, values: unknown[]) =>
    (await database.query(sql, values)).rows[0].id as number;
  const area = await insert(
    "insert into aree_operative(nome) values($1) returning id",
    [`F1 Area ${s}`],
  );
  const centers = [];
  for (const n of [1, 2, 3])
    centers.push(
      await insert(
        "insert into centri_di_ascolto(nome,area_operativa_id) values($1,$2) returning id",
        [`F1 Centro ${n} ${s}`, area],
      ),
    );
  const warehouses = [];
  for (let n = 0; n < count; n++)
    warehouses.push({
      id: await insert(
        "insert into magazzini(codice,nome,tipo_magazzino,area_operativa_id,centro_ascolto_id) values($1,$2,'emporio',$3,$4) returning id",
        [`F1W-${n}-${s}`, `F1 Emporio ${n + 1} ${s}`, area, centers[2]],
      ),
      nome: `F1 Emporio ${n + 1} ${s}`,
    });
  const code = `F1BEN-${s}`;
  const beneficiary = await insert(
    "insert into beneficiari(codice,nome,cognome,sesso,area_operativa_id,centro_ascolto_id,credito_solidale_abilitato,credito_solidale_stato,credito_solidale_saldo,magazzino_emporio_preferito_id) values($1,'Anna Maria','Rossi','F',$2,$3,true,'attivo',100,$4) returning id",
    [code, area, centers[1], warehouses[0]?.id ?? null],
  );
  const grants = [
    "emporio.access.view",
    "emporio.access.manage",
    "emporio.cassa.view",
    "emporio.cassa.operate",
    ...(owner
      ? [
          "beneficiari.view",
          "beneficiari.manage",
          "credito.view",
          "emporio.eligibility.manage",
        ]
      : []),
  ];
  const role = await insert(
    "insert into ruoli(nome,aree,permessi) values($1,$2,$3) returning id",
    [
      `F1 Role ${s}`,
      JSON.stringify(owner ? ["sociale", "emporio"] : ["emporio"]),
      JSON.stringify(grants),
    ],
  );
  const username = `f1_e2e_${s}`,
    password = `Synthetic-F1-${s}-Only!`;
  const user = await insert(
    "insert into utenti(username,nome,password_hash,ruolo_id,area_operativa_id,centro_ascolto_id,email,email_da_aggiornare) values($1,'F1 E2E',$2,$3,$4,$5,$6,false) returning id",
    [
      username,
      await bcrypt.hash(password, 4),
      role,
      area,
      owner ? centers[1] : centers[0],
      `${s}@example.invalid`,
    ],
  );
  if (eligible)
    await database.query(
      "insert into emporio_abilitazioni(beneficiario_id,area_operativa_id,stato,operatore_id,motivo) values($1,$2,'attivo',$3,'Fixture con diritto esplicito')",
      [beneficiary, area, user],
    );
  const card = `MS-${s}`;
  await database.query(
    "insert into tessere_beneficiari(beneficiario_id,codice) values($1,$2)",
    [beneficiary, card],
  );
  return {
    area,
    centers,
    warehouses,
    beneficiary,
    code,
    card,
    user,
    username,
    password,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function checkoutFixture(page: Page) {
  const f = await fixture(1);
  const suffix = randomUUID().slice(0, 8);
  const code = `BSCAN-${suffix}`;
  const insertProduct = async (productCode: string, barcode: string) => {
    const {
      rows: [product],
    } = await database.query(
      "insert into prodotti(codice,nome,tipo_prodotto,unita_misura,quantita_frazionabile,abilitato_emporio,credito_solidale_valore,codice_barre) values($1,$2,'alimenti','pz',true,true,2,$3) returning id",
      [productCode, `B prodotto ${productCode}`, barcode],
    );
    await database.query(
      "insert into lotti(prodotto_id,magazzino_id,codice_lotto,data_carico,quantita_caricata,quantita_residua) values($1,$2,$3,CURRENT_DATE,10,10)",
      [product.id, f.warehouses[0].id, `LOT-${productCode}`],
    );
    return product.id as number;
  };
  const product = await insertProduct(code, `BC-${suffix}`);
  await insertProduct(`SECOND-${suffix}`, code); // Identificatori distinti per colonna, match cross-colonna ambiguo.
  const {
    rows: [access],
  } = await database.query(
    "insert into consegne(codice,beneficiario_id,tipo_pianificazione,tipo_consegna,data_prevista,magazzino_id,magazzino_emporio_id,data_ora_inizio,data_ora_fine,stato_accesso_emporio) values($1,$2,'accesso_emporio','accesso_emporio',CURRENT_DATE,$3,$3,now(),now()+interval '1 hour','confermato') returning id",
    [`BAC-${suffix}`, f.beneficiary, f.warehouses[0].id],
  );
  await login(page, f);
  // Hold the warehouse response until opening completes: an unloaded list must
  // not invalidate the newly selected Sessione (observable barrier, no sleep).
  let releaseWarehouses!: () => void;
  const warehouseBarrier = new Promise<void>((resolve) => {
    releaseWarehouses = resolve;
  });
  await page.route("**/api/emporio/magazzini", async (route) => {
    await warehouseBarrier;
    await route.continue();
  });
  const opened = page.waitForResponse(
    (r) =>
      r.url().includes(`/accessi/${access.id}/apri-sessione`) &&
      r.request().method() === "POST",
  );
  await page.goto(`/emporio/cassa?accessoEmporioId=${access.id}`);
  expect((await opened).status()).toBe(201);
  const input = page.getByPlaceholder(
    "Cerca prodotto per nome, codice o codice a barre",
  );
  await expect(input).toBeEnabled();
  await expect(page).toHaveURL(/sessioneId=\d+/);
  releaseWarehouses();
  await expect(
    page.getByRole("combobox", { name: "Emporio", exact: true }),
  ).toContainText(f.warehouses[0].nome);
  const session = Number(new URL(page.url()).searchParams.get("sessioneId"));
  return { ...f, product, code, barcode: `BC-${suffix}`, input, session };
}

test("M62B B19/B20/B21: scanner esatto, ambiguo e doppio Enter senza inserimenti silenziosi", async ({
  page,
}) => {
  const f = await checkoutFixture(page);
  await f.input.fill(f.code);
  await f.input.press("Enter");
  const notifications = page.getByRole("region", {
    name: "Notifications (F8)",
  });
  await expect(
    notifications.getByText(
      "Codice ambiguo: scegli esplicitamente il prodotto dai risultati.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    (
      await database.query(
        "select count(*)::int n from sessioni_cassa_emporio_righe where sessione_cassa_id=$1",
        [f.session],
      )
    ).rows[0].n,
  ).toBe(0);
  await f.input.fill("B prodotto");
  await f.input.press("Enter");
  await expect(notifications.getByText(/Prodotto non trovato/)).toBeVisible();
  expect(
    (
      await database.query(
        "select count(*)::int n from sessioni_cassa_emporio_righe where sessione_cassa_id=$1",
        [f.session],
      )
    ).rows[0].n,
  ).toBe(0);
  await f.input.fill(f.barcode);
  const saved = page.waitForResponse(
    (r) =>
      /\/sessioni\/\d+\/righe$/.test(r.url()) &&
      r.request().method() === "POST",
  );
  await f.input.evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect((await saved).status()).toBe(201);
  const quantity = page.getByRole("spinbutton", {
    name: "Quantità",
    exact: true,
  });
  await expect(quantity).toHaveValue("1");
  await expect(quantity).toHaveAttribute("step", "0.000001");
  expect(
    (
      await database.query(
        "select count(*)::int n from sessioni_cassa_emporio_righe where sessione_cassa_id=$1",
        [f.session],
      )
    ).rows[0].n,
  ).toBe(1);
});

test("M62B B22/B24: risposta persa dopo commit, GET recovery e refresh senza secondo POST", async ({
  page,
}) => {
  const f = await checkoutFixture(page);
  await f.input.fill(f.barcode);
  await f.input.press("Enter");
  await expect(
    page.getByRole("spinbutton", { name: "Quantità", exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("button", { name: "Prepara chiusura", exact: true })
    .click();
  const close = page.getByRole("button", {
    name: "Chiudi spesa Emporio",
    exact: true,
  });
  await expect(close).toBeEnabled();
  let posts = 0;
  page.on("request", (r) => {
    if (/\/sessioni\/\d+\/chiudi$/.test(r.url()) && r.method() === "POST")
      posts++;
  });
  await page.route(
    /\/api\/cassa-emporio\/sessioni\/\d+\/chiudi$/,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    },
  );
  await close.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Chiudi spesa Emporio", exact: true })
    .click();
  await expect(
    page.getByText(/Spesa Emporio chiusa correttamente.*Numero Spesa/),
  ).toBeVisible();
  const {
    rows: [expense],
  } = await database.query(
    "select id,numero_spesa from spese_emporio where sessione_cassa_id=$1",
    [f.session],
  );
  await expect(page.getByText(new RegExp(expense.numero_spesa))).toBeVisible();
  await page.reload();
  await expect(page.getByText(new RegExp(expense.numero_spesa))).toBeVisible();
  expect(posts).toBe(1);
  const {
    rows: [facts],
  } = await database.query(
    "select (select count(*) from spese_emporio where sessione_cassa_id=$1)::int expenses,(select sum(quantita) from movimenti where prodotto_id=$2)::text issued,(select quantita_residua from lotti where prodotto_id=$2)::text residual",
    [f.session, f.product],
  );
  expect(facts.expenses).toBe(1);
  expect(Number(facts.issued)).toBe(1);
  expect(Number(facts.residual)).toBe(9);
  await database.query(
    "update emporio_abilitazioni set stato='revocato' where beneficiario_id=$1",
    [f.beneficiary],
  );
  const revoked = page.waitForResponse(
    (r) =>
      r.url().includes(`/spese-emporio/sessione/${f.session}`) &&
      r.status() === 400,
  );
  await page
    .getByRole("heading", { name: "Cassa Emporio", exact: true })
    .click();
  await revoked;
  await expect(page.getByText(new RegExp(expense.numero_spesa))).toHaveCount(0);
});

for (const outcome of ["rollback", "commit"] as const) {
  test(`M62B R2 B23 timeout pre-commit: ${outcome}, GET e nessun secondo POST`, async ({
    page,
  }) => {
    const f = await checkoutFixture(page);
    await f.input.fill(f.barcode);
    await f.input.press("Enter");
    await expect(
      page.getByRole("spinbutton", { name: "Quantità", exact: true }),
    ).toHaveValue("1");
    await page
      .getByRole("button", { name: "Prepara chiusura", exact: true })
      .click();
    const close = page.getByRole("button", {
      name: "Chiudi spesa Emporio",
      exact: true,
    });
    await expect(close).toBeEnabled();
    const blocker = await database.connect();
    let forwarded: Promise<import("@playwright/test").APIResponse> | undefined;
    let posts = 0,
      uncertain = true,
      commandPid = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/sessioni\/\d+\/chiudi$/.test(r.url()))
        posts++;
    });
    const recoveryPath = new RegExp(
      `/api/cassa-emporio/sessioni/${f.session}$`,
    );
    await page.route(recoveryPath, async (route) => {
      if (route.request().method() === "GET" && uncertain)
        await route.abort("timedout");
      else await route.continue();
    });
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM sessioni_cassa_emporio WHERE id=$1 FOR UPDATE",
        [f.session],
      );
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
        .pid;
      await page.route(
        /\/api\/cassa-emporio\/sessioni\/\d+\/chiudi$/,
        async (route) => {
          forwarded = route.fetch({ timeout: 45_000 });
          // Observe the real command waiting BEFORE losing the browser response.
          await expect
            .poll(
              async () => {
                const { rows } = await database.query(
                  "SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",
                  [pid],
                );
                commandPid = rows[0]?.pid ?? 0;
                return commandPid;
              },
              { timeout: 15_000 },
            )
            .toBeGreaterThan(0);
          await route.abort("timedout");
        },
      );
      await close.click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Chiudi spesa Emporio", exact: true })
        .click();
      const verify = page.getByRole("button", {
        name: "Verifica esito della chiusura",
        exact: true,
      });
      await expect(verify).toBeVisible();
      await expect(page.getByText(/Numero Spesa:/)).toHaveCount(0);
      expect(posts).toBe(1);
      expect(
        (
          await database.query(
            "SELECT count(*)::int n FROM spese_emporio WHERE sessione_cassa_id=$1",
            [f.session],
          )
        ).rows[0].n,
      ).toBe(0);
      if (outcome === "rollback")
        expect(
          (
            await database.query("SELECT pg_cancel_backend($1) cancelled", [
              commandPid,
            ])
          ).rows[0].cancelled,
        ).toBe(true);
      await blocker.query("COMMIT");
      expect((await forwarded!).status()).toBe(
        outcome === "commit" ? 200 : 500,
      );
      uncertain = false;
      await verify.click();
      if (outcome === "commit") {
        await expect(
          page.getByText(/Spesa Emporio chiusa correttamente.*Numero Spesa/),
        ).toBeVisible();
      } else {
        await expect(
          page
            .getByRole("alert")
            .filter({ hasText: "La Sessione non risulta chiusa" }),
        ).toBeVisible();
        await expect(page.getByText(/Numero Spesa:/)).toHaveCount(0);
        await expect(close).toBeEnabled();
      }
      const {
        rows: [facts],
      } = await database.query(
        `SELECT
        (SELECT count(*)::int FROM spese_emporio WHERE sessione_cassa_id=$1) expenses,
        (SELECT quantita_residua::float8 FROM lotti WHERE prodotto_id=$2) stock,
        (SELECT credito_solidale_saldo::float8 FROM beneficiari WHERE id=$3) credit,
        (SELECT count(*)::int FROM bolle WHERE magazzino_id=$4) bills,
        (SELECT count(*)::int FROM scarichi WHERE magazzino_id=$4) issues,
        (SELECT count(*)::int FROM credito_solidale_movimenti WHERE beneficiario_id=$3) credit_entries,
        (SELECT count(*)::int FROM audit_eventi WHERE azione='EMPORIO_CHECKOUT' AND metadata->>'cassaId'=$1::text) audits`,
        [f.session, f.product, f.beneficiary, f.warehouses[0].id],
      );
      const n = outcome === "commit" ? 1 : 0;
      expect(facts).toEqual({
        expenses: n,
        stock: 10 - n,
        credit: 100 - 2 * n,
        bills: n,
        issues: n,
        credit_entries: n,
        audits: n,
      });
      await page.reload();
      if (n)
        await expect(
          page.getByText(/Spesa Emporio chiusa correttamente.*Numero Spesa/),
        ).toBeVisible();
      else await expect(close).toBeEnabled();
      expect(posts).toBe(1);
    } finally {
      uncertain = false;
      await blocker.query("ROLLBACK");
      blocker.release();
      await forwarded?.catch(() => undefined);
    }
  });
}

test("M62B B23: checkout respinto conserva l'errore backend e non inventa una ricevuta", async ({
  page,
}) => {
  const f = await checkoutFixture(page);
  await f.input.fill(f.barcode);
  await f.input.press("Enter");
  await expect(
    page.getByRole("spinbutton", { name: "Quantità", exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("button", { name: "Prepara chiusura", exact: true })
    .click();
  const close = page.getByRole("button", {
    name: "Chiudi spesa Emporio",
    exact: true,
  });
  await expect(close).toBeEnabled();
  await database.query("update prodotti set attivo=false where id=$1", [
    f.product,
  ]);
  const rejected = page.waitForResponse(
    (r) =>
      /\/sessioni\/\d+\/chiudi$/.test(r.url()) &&
      r.request().method() === "POST",
  );
  await close.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Chiudi spesa Emporio", exact: true })
    .click();
  const response = await rejected;
  expect(response.status()).toBe(400);
  const error = (await response.json()).error;
  await expect(
    page.getByRole("alert").filter({ hasText: error }),
  ).toBeVisible();
  await expect(close).toBeEnabled();
  await expect(page.getByText(/Numero Spesa:/)).toHaveCount(0);
  expect(
    (
      await database.query(
        "select count(*)::int n from spese_emporio where sessione_cassa_id=$1",
        [f.session],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    Number(
      (
        await database.query(
          "select quantita_residua from lotti where prodotto_id=$1",
          [f.product],
        )
      ).rows[0].quantita_residua,
    ),
  ).toBe(10);
});

test("T11/T12/T20 Cassa: name is explicit, USB legacy card is unique, financial details stay hidden", async ({
  page,
}) => {
  const f = await fixture(1);
  const legacy = `LEGACY-USB-${f.beneficiary}`;
  await database.query(
    "update tessere_beneficiari set codice=$1 where beneficiario_id=$2",
    [legacy, f.beneficiary],
  );
  await login(page, f);
  await page.goto("/emporio/cassa");
  const input = page.getByRole("textbox", {
    name: "Cerca beneficiario per nome, codice o codice a barre",
    exact: true,
  });
  await expect(input).toBeEnabled();
  await input.fill("Rossi");
  await expect(
    page.getByRole("button").filter({ hasText: f.code }),
  ).toBeVisible();
  const accessPanel = page
    .getByText("Accesso Emporio", { exact: true })
    .locator("..")
    .locator("..");
  await input.press("Enter");
  await expect(accessPanel.getByText(f.code, { exact: true })).toHaveCount(0);
  await input.fill(legacy);
  await input.press("Enter");
  await expect(accessPanel.getByText(f.code, { exact: true })).toBeVisible();
  await expect(input).toHaveValue(f.code);
  await expect(
    page.getByText("Saldo credito disponibile", { exact: false }),
  ).toHaveCount(0);
});
async function login(page: Page, f: Fixture) {
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(f.username);
  await page.getByLabel(/^password$/i).fill(f.password);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}
async function open(page: Page) {
  await page.goto("/emporio/accessi");
  await page
    .getByRole("button", { name: "Nuovo Accesso Emporio", exact: true })
    .click();
  return page.getByRole("dialog", {
    name: "Nuovo Accesso Emporio",
    exact: true,
  });
}
for (const count of [0, 1, 2])
  test(`T01/T02/T03: ${count} Empori — selection before beneficiary`, async ({
    page,
  }) => {
    const f = await fixture(count);
    await login(page, f);
    const queries: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/accessi-emporio/beneficiari/ricerca"))
        queries.push(r.url());
    });
    const d = await open(page);
    const input = d.getByPlaceholder(/cerca beneficiario per nome/i);
    await expect(
      d.getByRole("combobox", { name: "Emporio", exact: true }),
    ).toBeVisible();
    if (count === 1) {
      await expect(
        d.getByRole("combobox", { name: "Emporio", exact: true }),
      ).toContainText(f.warehouses[0].nome);
      await expect(input).toBeEnabled();
    } else {
      await expect(input).toBeDisabled();
      expect(queries).toEqual([]);
      await expect(
        d.getByRole("button", { name: "Salva", exact: true }),
      ).toBeDisabled();
      if (count === 0)
        await expect(
          d.getByText(/Nessun Emporio attivo accessibile/),
        ).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
test("T04/T06/T11/T12/T13/T20: cross-Center name, card, context reset and explicit choice", async ({
  page,
}) => {
  const f = await fixture(2);
  await login(page, f);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const d = await open(page);
  const wh = d.getByRole("combobox", { name: "Emporio", exact: true });
  await selectOption(page, wh, f.warehouses[1].nome);
  const input = d.getByPlaceholder(/cerca beneficiario per nome/i);
  // F2 B08/B09: Enter on a name must not convert it to a card-only query.
  const nameResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/accessi-emporio/beneficiari/ricerca") &&
      new URL(r.url()).searchParams.get("search") === "Rossi Anna",
  );
  await input.fill("Rossi Anna");
  await input.press("Enter");
  expect((await nameResponse).status()).toBe(200);
  await expect(
    d.getByRole("region", { name: "Beneficiario selezionato", exact: true }),
  ).toHaveCount(0);
  await d
    .getByRole("button", {
      name: `Rossi Anna Maria · ${f.code} · F1 Centro 2 ${f.code.slice(6)}`,
      exact: true,
    })
    .click();
  await expect(wh).toContainText(f.warehouses[1].nome);
  await expect(
    d.getByRole("button", { name: "Salva", exact: true }),
  ).toBeEnabled();
  await selectOption(page, wh, f.warehouses[0].nome);
  await expect(
    d.getByRole("button", { name: "Salva", exact: true }),
  ).toBeDisabled();
  await expect(input).toHaveValue("");
  const legacyCard = `opaque-usb-${f.beneficiary}`;
  await database.query(
    "update tessere_beneficiari set codice=$1 where beneficiario_id=$2",
    [legacyCard, f.beneficiary],
  );
  await input.fill(legacyCard);
  await input.press("Enter");
  await expect(
    d.getByRole("region", { name: "Beneficiario selezionato", exact: true }),
  ).toContainText(f.code);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/accessi-emporio") &&
      r.request().method() === "POST",
  );
  await d.getByRole("button", { name: "Salva", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(d).not.toBeVisible();
  expect(
    (
      await database.query(
        "select centro_ascolto_id from beneficiari where id=$1",
        [f.beneficiary],
      )
    ).rows[0].centro_ascolto_id,
  ).toBe(f.centers[1]);
  expect(errors).toEqual([]);
});
test("T08/T15: beneficiary service panel enables explicitly without credit increment", async ({
  page,
}) => {
  const f = await fixture(1, false, true);
  await login(page, f);
  await page.goto(`/beneficiari/${f.beneficiary}`);
  const card = page.getByRole("region", {
    name: "Emporio Solidale",
    exact: true,
  });
  await expect(card.getByText("NON ABILITATO", { exact: true })).toBeVisible();
  const enable = card.getByRole("button", {
    name: "Abilita all'Emporio",
    exact: true,
  });
  await expect(enable).toBeDisabled();
  await card
    .getByRole("textbox", {
      name: "Motivo dell'abilitazione o della variazione",
    })
    .fill("Decisione sociale esplicita E2E");
  await enable.click();
  await expect(card.getByText("ATTIVO", { exact: true })).toBeVisible();
  expect(
    (
      await database.query(
        "select credito_solidale_saldo from beneficiari where id=$1",
        [f.beneficiary],
      )
    ).rows[0].credito_solidale_saldo,
  ).toBe("100.00");
});

test("F2 B14/B15/B19/B24: service transitions update cached directory and deep-link eligibility without logout", async ({
  page,
}) => {
  const f = await fixture(1, false, true);
  await login(page, f);
  await page.goto("/beneficiari");
  await expect(
    page.getByRole("columnheader", { name: "Emporio", exact: true }),
  ).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: f.code });
  await expect(row.getByText("NON ABILITATO", { exact: true })).toBeVisible();
  await row.locator(`a[href='/beneficiari/${f.beneficiary}']`).click();
  const card = page.getByRole("region", {
    name: "Emporio Solidale",
    exact: true,
  });
  const planning = page.getByRole("link", {
    name: "Pianifica accesso",
    exact: true,
  });
  await expect(planning).toHaveCount(0);
  await card
    .getByRole("textbox", {
      name: "Motivo dell'abilitazione o della variazione",
    })
    .fill("F2 attivazione esplicita");
  await card
    .getByRole("button", { name: "Abilita all'Emporio", exact: true })
    .click();
  await expect(card.getByText("ATTIVO", { exact: true })).toBeVisible();
  await expect(planning).toBeVisible();
  await page.goBack();
  await expect(row.getByText("ATTIVO", { exact: true })).toBeVisible();
  await row.locator(`a[href='/beneficiari/${f.beneficiary}']`).click();
  await planning.click();
  await page
    .getByRole("button", { name: "Nuovo Accesso Emporio", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Nuovo Accesso Emporio",
    exact: true,
  });
  await expect(
    dialog.getByRole("region", {
      name: "Beneficiario selezionato",
      exact: true,
    }),
  ).toContainText(f.code);
  await expect(
    dialog.getByRole("button", { name: "Salva", exact: true }),
  ).toBeEnabled();
  await page.goBack();
  for (const state of ["sospeso", "attivo", "revocato"]) {
    await card
      .getByRole("textbox", {
        name: "Motivo dell'abilitazione o della variazione",
      })
      .fill(`F2 variazione ${state}`);
    await card
      .getByRole("button", {
        name:
          state === "sospeso"
            ? "Sospendi abilitazione"
            : state === "attivo"
              ? "Riattiva abilitazione"
              : "Revoca abilitazione",
        exact: true,
      })
      .click();
    await expect(
      card.getByText(state.toUpperCase(), { exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      row.getByText(state.toUpperCase(), { exact: true }),
    ).toBeVisible();
    await row.locator(`a[href='/beneficiari/${f.beneficiary}']`).click();
  }
  await expect(planning).toHaveCount(0);
  await page.goto(`/emporio/accessi?beneficiarioId=${f.beneficiary}`);
  await page
    .getByRole("button", { name: "Nuovo Accesso Emporio", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Salva", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button").filter({ hasText: f.code }),
  ).toBeDisabled();
  await expect(
    dialog.getByText("Abilitazione Emporio revocata.", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await database.query(
        "select count(*)::int n from consegne where beneficiario_id=$1",
        [f.beneficiary],
      )
    ).rows[0].n,
  ).toBe(0);
});

test("F3: luca is immediately selectable; empty, blocked and deep-link results are explicit", async ({
  page,
}) => {
  const f = await fixture(1);
  await database.query(
    "update beneficiari set nome='Luca',cognome='Romano' where id=$1",
    [f.beneficiary],
  );
  const other = (
    await database.query(
      "insert into beneficiari(codice,nome,cognome,area_operativa_id,centro_ascolto_id,credito_solidale_abilitato,credito_solidale_stato) values($1,'Simone','De Luca',$2,$3,true,'attivo') returning id",
      [`F3-OTHER-${f.beneficiary}`, f.area, f.centers[0]],
    )
  ).rows[0].id;
  await database.query(
    "insert into emporio_abilitazioni(beneficiario_id,area_operativa_id,stato,operatore_id,motivo) values($1,$2,'attivo',$3,'Synthetic F3')",
    [other, f.area, f.user],
  );
  await login(page, f);
  const d = await open(page);
  await expect(d.getByText(/I risultati compariranno qui/)).toBeVisible();
  const input = d.getByPlaceholder(/cerca beneficiario per nome/i);
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/accessi-emporio/beneficiari/ricerca") &&
      new URL(r.url()).searchParams.get("search") === "luca",
  );
  await input.fill("luca");
  const rows = await (await response).json();
  expect(rows.map((b: { beneficiarioId: number }) => b.beneficiarioId)).toEqual(
    [other, f.beneficiary],
  );
  const choice = d
    .getByRole("button")
    .filter({ hasText: `Romano Luca · ${f.code}` });
  await expect(choice).toBeVisible();
  await choice.click();
  await expect(
    d.getByRole("region", { name: "Beneficiario selezionato", exact: true }),
  ).toContainText(f.code);
  await expect(
    d.getByRole("button", { name: "Salva", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole("main", { includeHidden: true })
      .getByPlaceholder(/cerca beneficiario per nome/i),
  ).toHaveValue("");
  await input.fill("nomeinesistente");
  await expect(
    d.getByText(/Nessun beneficiario trovato nell'Area/),
  ).toBeVisible();
  await expect(
    d.getByRole("button", { name: "Salva", exact: true }),
  ).toBeDisabled();
  await database.query(
    "update beneficiari set credito_solidale_abilitato=false where id=$1",
    [f.beneficiary],
  );
  await input.fill("luca");
  await expect(choice).toBeDisabled();
  await expect(d.getByText(/Credito Solidale non abilitato:/)).toBeVisible();
  await expect(
    d.getByRole("button", { name: "Salva", exact: true }),
  ).toBeDisabled();
  await page.goto(`/emporio/accessi?beneficiarioId=${f.beneficiary}`);
  await page
    .getByRole("button", { name: "Nuovo Accesso Emporio", exact: true })
    .click();
  await expect(choice).toBeDisabled();
  await expect(d.getByText(/Credito Solidale non abilitato:/)).toBeVisible();
  await expect(
    d.getByRole("button", { name: "Salva", exact: true }),
  ).toBeDisabled();
  expect(
    (
      await database.query(
        "select count(*)::int n from consegne where beneficiario_id=$1",
        [f.beneficiary],
      )
    ).rows[0].n,
  ).toBe(0);
});
