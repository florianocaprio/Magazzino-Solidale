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
