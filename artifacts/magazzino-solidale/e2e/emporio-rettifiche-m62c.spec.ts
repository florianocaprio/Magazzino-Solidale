import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
const require = createRequire(
  new URL("../../api-server/package.json", import.meta.url),
);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
let db: import("pg").Pool;
test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  expect(process.env.M62C_DISPOSABLE_DB).toBe("verified");
  expect([url.hostname, url.port, url.pathname]).toEqual([
    "127.0.0.1",
    "58621",
    "/m62a",
  ]);
  db = new Pool({ connectionString: url.href });
  // A fresh database has no bootstrap administrator. Keep this anchor separate
  // from the ordinary, territorially scoped actor exercised by every scenario.
  const suffix = randomUUID();
  const role = (
    await db.query(
      "insert into ruoli(nome,is_admin,aree,permessi)values($1,true,'[]','[]')returning id",
      [`Bootstrap C ${suffix}`],
    )
  ).rows[0].id;
  await db.query(
    "insert into utenti(username,nome,password_hash,ruolo_id,email,email_da_aggiornare)values($1,'Bootstrap sintetico',$2,$3,$4,false)",
    [
      `bootstrap_c_${suffix}`,
      await bcrypt.hash(randomUUID(), 4),
      role,
      `${suffix}@example.invalid`,
    ],
  );
});
test.afterAll(async () => {
  await db?.end();
});

async function fixture(
  page: Page,
  options: { quantity?: number; price?: number; uom?: string } = {},
) {
  const suffix = randomUUID().slice(0, 8);
  const insert = async (sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows[0].id as number;
  const area = await insert(
    "insert into aree_operative(nome)values($1)returning id",
    [`Area C ${suffix}`],
  );
  const center = await insert(
    "insert into centri_di_ascolto(nome,area_operativa_id)values($1,$2)returning id",
    [`Centro C ${suffix}`, area],
  );
  const warehouse = await insert(
    "insert into magazzini(codice,nome,tipo_magazzino,area_operativa_id,centro_ascolto_id)values($1,$1,'emporio',$2,$3)returning id",
    [`CWH-${suffix}`, area, center],
  );
  const beneficiary = await insert(
    "insert into beneficiari(codice,nome,cognome,sesso,area_operativa_id,centro_ascolto_id,credito_solidale_abilitato,credito_solidale_stato,credito_solidale_saldo,magazzino_emporio_preferito_id)values($1,'Persona','Sintetica','M',$2,$3,true,'attivo',20,$4)returning id",
    [`CBEN-${suffix}`, area, center, warehouse],
  );
  const grants = [
    "emporio.access.view",
    "emporio.access.manage",
    "emporio.cassa.view",
    "emporio.cassa.operate",
    "emporio.sales.view",
    "emporio.sales.reverse",
    "credito.view",
  ];
  const role = await insert(
    "insert into ruoli(nome,aree,permessi)values($1,'[\"emporio\"]',$2)returning id",
    [`C ruolo ${suffix}`, JSON.stringify(grants)],
  );
  const password = `Synthetic-C-${suffix}-Password!`,
    username = `m62c_${suffix}`;
  const user = await insert(
    "insert into utenti(username,nome,password_hash,ruolo_id,area_operativa_id,centro_ascolto_id,email,email_da_aggiornare)values($1,'Operatore C',$2,$3,$4,$5,$6,false)returning id",
    [
      username,
      await bcrypt.hash(password, 4),
      role,
      area,
      center,
      `${suffix}@example.invalid`,
    ],
  );
  await db.query(
    "insert into emporio_abilitazioni(beneficiario_id,area_operativa_id,stato,operatore_id,motivo)values($1,$2,'attivo',$3,'Fixture esplicita C')",
    [beneficiary, area, user],
  );
  const product = await insert(
    "insert into prodotti(codice,nome,tipo_prodotto,unita_misura,quantita_frazionabile,abilitato_emporio,credito_solidale_valore)values($1,'Prodotto sintetico C','alimenti',$2,$3,true,$4)returning id",
    [
      `CP-${suffix}`,
      options.uom ?? "pz",
      options.uom === "kg",
      options.price ?? 3,
    ],
  );
  await db.query(
    "insert into lotti(prodotto_id,magazzino_id,codice_lotto,data_carico,quantita_caricata,quantita_residua)values($1,$2,$3,CURRENT_DATE,10,10)",
    [product, warehouse, `CL-${suffix}`],
  );
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
  const post = async (url: string, data: unknown) => {
    const r = await page.request.post("/api" + url, { data });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const access = await post("/accessi-emporio", {
    beneficiarioId: beneficiary,
    magazzinoEmporioId: warehouse,
    dataOraInizio: new Date(Date.now() - 60_000).toISOString(),
  });
  const session = await post(
    `/cassa-emporio/accessi/${access.id}/apri-sessione`,
    {},
  );
  await post(`/cassa-emporio/sessioni/${session.id}/righe`, {
    prodottoId: product,
    quantita: options.quantity ?? 2,
    versione: session.versione,
  });
  const current = await (
    await page.request.get(`/api/cassa-emporio/sessioni/${session.id}`)
  ).json();
  const ready = await post(
    `/cassa-emporio/sessioni/${session.id}/pronta-per-chiusura`,
    { versione: current.versione },
  );
  const closed = await post(`/cassa-emporio/sessioni/${session.id}/chiudi`, {
    versione: ready.versione,
  });
  await page.goto(`/emporio/spese?spesaId=${closed.spesa.id}`);
  await expect(
    page.getByRole("button", { name: "Rettifica spesa", exact: true }),
  ).toBeVisible();
  return { spesa: closed.spesa, beneficiary, product, user, role, grants };
}

async function economicForm(page: Page) {
  await page
    .getByRole("button", { name: "Rettifica spesa", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Rettifica spesa",
    exact: true,
  });
  await dialog.getByRole("combobox", { name: "Tipologia rettifica" }).click();
  await page
    .getByRole("option", { name: "Rettifica solo credito", exact: true })
    .click();
  await dialog
    .getByRole("spinbutton", { name: "Credito intero da restituire" })
    .fill("1.5");
  await dialog
    .getByPlaceholder("Motivo obbligatorio dello storno")
    .fill("Correzione credito documentata");
  await dialog.getByRole("checkbox").check();
  await expect(
    dialog.getByRole("button", { name: "Conferma rettifica" }),
  ).toBeDisabled();
  await dialog
    .getByRole("spinbutton", { name: "Credito intero da restituire" })
    .fill("2");
  await expect(
    dialog.getByRole("button", { name: "Conferma rettifica" }),
  ).toBeEnabled();
  return dialog;
}

test("C29 credito-only reale: campi interi, cache aggiornata, stock invariato", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const f = await fixture(page),
    dialog = await economicForm(page);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/spese-emporio/${f.spesa.id}/storna`) &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Conferma rettifica" }).click();
  expect((await response).status()).toBe(201);
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "Rettifica spesa" }),
  ).toContainText("Correzione credito documentata");
  expect(
    (
      await db.query(
        "select credito_solidale_saldo from beneficiari where id=$1",
        [f.beneficiary],
      )
    ).rows[0].credito_solidale_saldo,
  ).toBe("16.00");
  expect(
    Number(
      (
        await db.query(
          "select quantita_residua from lotti where prodotto_id=$1",
          [f.product],
        )
      ).rows[0].quantita_residua,
    ),
  ).toBe(8);
  expect(errors).toEqual([]);
});

test("C14/C15 risposta persa dopo commit: GET recupera dopo refresh senza secondo POST", async ({
  page,
}) => {
  const f = await fixture(page);
  let posts = 0;
  await page.route(
    `**/api/spese-emporio/${f.spesa.id}/storna`,
    async (route) => {
      posts++;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("connectionfailed");
    },
  );
  const dialog = await economicForm(page);
  await dialog.getByRole("button", { name: "Conferma rettifica" }).click();
  await expect(
    dialog.getByRole("button", { name: "Verifica esito rettifica" }),
  ).toBeVisible();
  await page.reload();
  const recovery = page.getByRole("alert").filter({ hasText: "Esito incerto" });
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Verifica esito rettifica" })
    .click();
  await expect(recovery).not.toBeVisible();
  expect(posts).toBe(1);
  expect(
    (
      await db.query(
        "select count(*)::int n from spese_emporio_storni where spesa_emporio_id=$1",
        [f.spesa.id],
      )
    ).rows[0].n,
  ).toBe(1);
});

for (const kind of [
  "Reso fisico idoneo",
  "Reso fisico non distribuibile",
  "Errore amministrativo — solo credito",
]) {
  test(`C16/C17/C29 ${kind}: effetti dichiarati e scritture reali`, async ({
    page,
  }) => {
    const f = await fixture(page);
    await page
      .getByRole("button", { name: "Rettifica spesa", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Rettifica spesa",
      exact: true,
    });
    await expect(dialog).toContainText(
      "Addebitato: 6 · Già restituito: 0 · Rimborsabile: 6",
    );
    await dialog.getByRole("combobox", { name: "Tipologia rettifica" }).click();
    await page.getByRole("option", { name: kind, exact: true }).click();
    const admin = kind.startsWith("Errore"),
      idoneo = kind === "Reso fisico idoneo";
    if (admin) {
      await expect(dialog).toContainText(
        "stock e quantità distribuite non cambiano",
      );
      await dialog
        .getByRole("spinbutton", { name: "Credito intero da restituire" })
        .fill("2");
    } else {
      await expect(dialog).toContainText(
        "Originale: 2 pz · già stornato: 0 pz",
      );
      await expect(dialog).toContainText("Massimo residuo: 2 pz");
      await expect(dialog).toContainText(
        idoneo
          ? "torna al lotto originale"
          : "nessun aumento della disponibilità",
      );
    }
    await dialog
      .getByPlaceholder("Motivo obbligatorio dello storno")
      .fill(`Prova causale ${kind}`);
    await dialog.getByRole("checkbox").check();
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/spese-emporio/${f.spesa.id}/storna`) &&
        r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Conferma rettifica" }).click();
    expect((await response).status()).toBe(201);
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("region", { name: "Rettifica spesa" }),
    ).toContainText(`Prova causale ${kind}`);
    const facts = (
      await db.query(
        `SELECT
      (SELECT quantita_residua::float8 FROM lotti WHERE prodotto_id=$1) stock,
      (SELECT credito_solidale_saldo::float8 FROM beneficiari WHERE id=$2) saldo,
      (SELECT count(*)::int FROM spese_emporio_storni WHERE spesa_emporio_id=$3) rettifiche,
      (SELECT count(*)::int FROM movimenti WHERE prodotto_id=$1 AND natura_contabile='SCARTO') scarti`,
        [f.product, f.beneficiary, f.spesa.id],
      )
    ).rows[0];
    expect(facts).toEqual({
      stock: idoneo ? 10 : 8,
      saldo: admin ? 16 : 20,
      rettifiche: 1,
      scarti: kind === "Reso fisico non distribuibile" ? 1 : 0,
    });
    const movements = (
      await db.query(
        "SELECT variazione_credito,saldo_prima,saldo_dopo FROM credito_solidale_movimenti WHERE beneficiario_id=$1",
        [f.beneficiary],
      )
    ).rows;
    expect(
      movements.every(
        (r) =>
          Number(r.saldo_prima) + Number(r.variazione_credito) ===
          Number(r.saldo_dopo),
      ),
    ).toBe(true);
  });
}

test("C10/C29 mezzo kg a 3 crediti: preview blocca la frazione senza POST", async ({
  page,
}) => {
  const f = await fixture(page, { quantity: 1, uom: "kg" });
  let posts = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      r.url().endsWith(`/spese-emporio/${f.spesa.id}/storna`)
    )
      posts++;
  });
  await page
    .getByRole("button", { name: "Rettifica spesa", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Rettifica spesa",
    exact: true,
  });
  await dialog.getByRole("spinbutton").fill("0.5");
  await dialog
    .getByPlaceholder("Motivo obbligatorio dello storno")
    .fill("Mezzo kg non rappresentabile");
  await dialog.getByRole("checkbox").check();
  await expect(dialog).toContainText("Nessun arrotondamento automatico");
  await expect(
    dialog.getByRole("button", { name: "Conferma rettifica" }),
  ).toBeDisabled();
  expect(posts).toBe(0);
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM spese_emporio_storni WHERE spesa_emporio_id=$1",
        [f.spesa.id],
      )
    ).rows[0].n,
  ).toBe(0);
});

test("C15 interruzione prima del commit: GET 404, nessun falso successo o nuovo POST", async ({
  page,
}) => {
  const f = await fixture(page);
  let posts = 0;
  await page.route(
    `**/api/spese-emporio/${f.spesa.id}/storna`,
    async (route) => {
      posts++;
      await route.abort("timedout");
    },
  );
  const dialog = await economicForm(page);
  await dialog.getByRole("button", { name: "Conferma rettifica" }).click();
  const recovery = dialog.getByRole("button", {
    name: "Verifica esito rettifica",
  });
  await expect(recovery).toBeVisible();
  const response = page.waitForResponse((r) =>
    r.url().includes(`/spese-emporio/${f.spesa.id}/rettifiche/esito/`),
  );
  await recovery.click();
  expect((await response).status()).toBe(404);
  await expect(
    dialog.getByRole("button", { name: "Conferma rettifica" }),
  ).toBeDisabled();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(posts).toBe(1);
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM spese_emporio_storni WHERE spesa_emporio_id=$1",
        [f.spesa.id],
      )
    ).rows[0].n,
  ).toBe(0);
});

test("C22 revoca reale con stesso cookie: GET canonica nega, nessuna PII cached o rettifica", async ({
  page,
}) => {
  const f = await fixture(page),
    dialog = await economicForm(page);
  expect(
    (await page.request.get(`/api/spese-emporio/${f.spesa.id}`)).status(),
  ).toBe(200);
  await db.query("UPDATE ruoli SET permessi=$1 WHERE id=$2", [
    JSON.stringify(f.grants.filter((g) => !g.startsWith("emporio.sales."))),
    f.role,
  ]);
  const denied = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/spese-emporio/${f.spesa.id}/storna`) &&
      r.request().method() === "POST",
  );
  const reread = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/spese-emporio/${f.spesa.id}`) &&
      r.request().method() === "GET",
  );
  await dialog.getByRole("button", { name: "Conferma rettifica" }).click();
  expect((await denied).status()).toBe(403);
  expect((await reread).status()).toBe(403);
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText(f.spesa.numeroSpesa, { exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM spese_emporio_storni WHERE spesa_emporio_id=$1",
        [f.spesa.id],
      )
    ).rows[0].n,
  ).toBe(0);
});
