import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";

const require = createRequire(
  new URL("../../api-server/package.json", import.meta.url),
);
const bcrypt = require("bcryptjs") as typeof import("bcryptjs");
let database: Awaited<typeof import("../../../lib/db/src/index.ts")>["pool"];
const grants = [
  "emporio.access.view",
  "emporio.access.manage",
  "emporio.cassa.view",
  "emporio.cassa.operate",
  "emporio.cassa.force",
  "emporio.sales.view",
  "credito.view",
];

test.beforeAll(async () => {
  const url = new URL(process.env.E2E_DATABASE_URL!);
  if (
    process.env.M62A_DISPOSABLE_DB !== "verified" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "58621" ||
    url.pathname !== "/m62a"
  )
    throw new Error(
      "M62A E2E requires the verified independent disposable database",
    );
  process.env.DATABASE_URL = url.href;
  const { Pool } = createRequire(
    new URL("../../../lib/db/package.json", import.meta.url),
  )("pg");
  database = new Pool({ connectionString: url.href });
  // This setup needs the complete current schema, not a historical upgrade boundary.
  // Compare the actual set and checksums, so a missing migration still fails.
  const updates = new URL("../../../lib/db/updates/", import.meta.url);
  const required = await Promise.all(
    (await readdir(updates))
      .filter((name) => /^\d{8}_.*\.sql$/.test(name))
      .sort()
      .map(async (filename) => ({
        filename,
        checksum_sha256: createHash("sha256")
          .update(await readFile(new URL(filename, updates)))
          .digest("hex"),
      })),
  );
  const result = await database.query(
    "select filename, checksum_sha256 from app_meta.schema_migrations order by filename",
  );
  expect(required.length).toBeGreaterThan(0);
  expect(result.rows).toEqual(required);
});
test.afterAll(async () => {
  await database?.end();
});

// Each scenario has its own ordinary user, role, territory and stock. The
// entire named tmpfs database is disposed after the run; no production seed.
async function fixture() {
  const suffix = randomUUID().slice(0, 8);
  const insert = async (query: string, values: unknown[]) =>
    (await database.query(query, values)).rows[0].id as number;
  const area = await insert(
    "insert into aree_operative(nome) values($1) returning id",
    [`R2 Area ${suffix}`],
  );
  const center = await insert(
    "insert into centri_di_ascolto(nome,area_operativa_id) values($1,$2) returning id",
    [`R2 Centro ${suffix}`, area],
  );
  const warehouse = await insert(
    "insert into magazzini(codice,nome,tipo_magazzino,area_operativa_id,centro_ascolto_id) values($1,$2,'emporio',$3,$4) returning id",
    [`R2WH-${suffix}`, `R2 Emporio ${suffix}`, area, center],
  );
  const code = `R2BEN-${suffix}`;
  const beneficiary = await insert(
    "insert into beneficiari(codice,nome,cognome,sesso,area_operativa_id,centro_ascolto_id,credito_solidale_abilitato,credito_solidale_stato,credito_solidale_saldo,credito_solidale_mensile_assegnato,magazzino_emporio_preferito_id) values($1,'Persona sintetica',$2,'M',$3,$4,true,'attivo',100,50,$5) returning id",
    [code, suffix, area, center, warehouse],
  );
  const role = await insert(
    "insert into ruoli(nome,aree,permessi,is_admin) values($1,$2,$3,false) returning id",
    [`R2 Ruolo ${suffix}`, JSON.stringify(["emporio"]), JSON.stringify(grants)],
  );
  const password = `Synthetic-R2-${suffix}-Password!`;
  const username = `r2_${suffix}`;
  const user = await insert(
    "insert into utenti(username,nome,password_hash,ruolo_id,area_operativa_id,centro_ascolto_id,email,email_da_aggiornare) values($1,'Operatore R2',$2,$3,$4,$5,$6,false) returning id",
    [
      username,
      await bcrypt.hash(password, 4),
      role,
      area,
      center,
      `${suffix}@example.invalid`,
    ],
  );
  // Explicit positive service eligibility; credit/preferred warehouse never imply it.
  await database.query(
    "insert into emporio_abilitazioni(beneficiario_id,area_operativa_id,stato,operatore_id,motivo) values($1,$2,'attivo',$3,'Diritto esplicito fixture E2E positiva')",
    [beneficiary, area, user],
  );
  const productCode = `R2P-${suffix}`;
  const productName = `Prodotto R2 ${suffix}`;
  const product = await insert(
    "insert into prodotti(codice,nome,tipo_prodotto,unita_misura,abilitato_emporio,credito_solidale_valore) values($1,$2,'alimentare','pz',true,2) returning id",
    [productCode, productName],
  );
  await database.query(
    "insert into lotti(prodotto_id,magazzino_id,codice_lotto,data_carico,quantita_caricata,quantita_residua) values($1,$2,$3,CURRENT_DATE,10,10)",
    [product, warehouse, `R2LOT-${suffix}`],
  );
  return {
    area,
    center,
    warehouse,
    beneficiary,
    code,
    role,
    user,
    username,
    password,
    product,
    productCode,
    productName,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function login(page: Page, f: Fixture) {
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(f.username);
  await page.getByLabel(/^password$/i).fill(f.password);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}
async function createAccess(page: Page, f: Fixture) {
  const response = await page.request.post("/api/accessi-emporio", {
    data: {
      beneficiarioId: f.beneficiary,
      magazzinoEmporioId: f.warehouse,
      dataOraInizio: new Date(Date.now() - 60_000).toISOString(),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).id as number;
}
async function snapshot() {
  // Full business records, not just totals, across the isolated database.
  const result: Record<string, unknown> = {};
  for (const table of [
    "spese_emporio",
    "bolle",
    "scarichi",
    "movimenti",
    "credito_solidale_movimenti",
    "lotti",
    "audit_configurazioni",
    "audit_eventi",
    "sessioni_cassa_emporio",
    "sessioni_cassa_emporio_righe",
    "consegne",
  ])
    result[table] = (
      await database.query(
        `select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) value from ${table} t`,
      )
    ).rows[0].value;
  result.beneficiaries = (
    await database.query(
      "select id,credito_solidale_saldo from beneficiari order by id",
    )
  ).rows;
  return result;
}
async function quantities(f: Fixture) {
  return (
    await database.query(
      "select (select sum(quantita_residua)::text from lotti where prodotto_id=$1 and magazzino_id=$2) stock, (select credito_solidale_saldo::text from beneficiari where id=$3) credit, (select count(*)::int from spese_emporio where beneficiario_id=$3) sales",
      [f.product, f.warehouse, f.beneficiary],
    )
  ).rows[0];
}
async function safe(page: Page, errors: string[]) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
}
async function command(
  page: Page,
  id: number,
  action: string,
  click: () => Promise<void>,
) {
  const pending = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/cassa-emporio/sessioni/${id}/${action}`) &&
      r.request().method() === "POST",
  );
  await click();
  return pending;
}
async function openFromAccess(page: Page, f: Fixture, access: number) {
  await page.goto("/emporio/accessi");
  const row = page.getByRole("row").filter({ hasText: f.code });
  await expect(row).toBeVisible();
  const pending = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/cassa-emporio/accessi/${access}/apri-sessione`) &&
      r.request().method() === "POST",
  );
  await row.getByTitle("Apri / recupera Cassa", { exact: true }).click();
  const response = await pending;
  expect([200, 201]).toContain(response.status());
  return response.json();
}

test("A01/A16–18/A24: Accessi, recupero, sospensione, annullamento e checkout senza doppio stock", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const f = await fixture();
  await login(page, f);
  const access = await createAccess(page, f);
  const before = await quantities(f);
  const opened = await openFromAccess(page, f, access);
  await expect(
    page.getByText("Sessione aperta", { exact: true }),
  ).toBeVisible();
  await safe(page, errors);
  expect(await quantities(f)).toEqual(before);
  const suspended = await command(page, opened.id, "sospendi", () =>
    page.getByRole("button", { name: "Sospendi", exact: true }).click(),
  );
  expect(suspended.status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Riprendi", exact: true }),
  ).toBeEnabled();
  const resumed = await command(page, opened.id, "riprendi", () =>
    page.getByRole("button", { name: "Riprendi", exact: true }).click(),
  );
  expect(resumed.status()).toBe(200);
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  const cancel = page.getByRole("dialog", {
    name: "Conferma annullamento",
    exact: true,
  });
  await cancel
    .getByPlaceholder("Motivo annullamento", { exact: true })
    .fill("Scenario R2 annullamento verificato");
  const cancelled = await command(page, opened.id, "annulla", () =>
    cancel.getByRole("button", { name: "Salva motivo", exact: true }).click(),
  );
  expect(cancelled.status()).toBe(200);
  expect((await cancelled.json()).statoSessione).toBe("annullata");
  expect(await quantities(f)).toEqual(before);
  const second = await openFromAccess(page, f, access);
  expect(second.id).not.toBe(opened.id);
  const recovered = await openFromAccess(page, f, access);
  expect(recovered.id).toBe(second.id);
  const productSearch = page.getByPlaceholder(
    /cerca prodotto per nome, codice o codice a barre/i,
  );
  await productSearch.fill(f.productCode);
  const added = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/cassa-emporio/sessioni/${second.id}/righe`) &&
      r.request().method() === "POST",
  );
  await productSearch.press("Enter");
  expect((await added).status()).toBe(201);
  // Same semantic selector as the historical regression: the cart cell, not
  // the simultaneously visible product-search suggestion.
  await expect(
    page.getByRole("cell").getByText(f.productName, { exact: true }),
  ).toBeVisible();
  const prepared = await command(page, second.id, "pronta-per-chiusura", () =>
    page.getByRole("button", { name: "Prepara chiusura", exact: true }).click(),
  );
  expect(prepared.status()).toBe(200);
  expect(await quantities(f)).toEqual(before);
  await page
    .getByRole("button", { name: "Chiudi spesa Emporio", exact: true })
    .click();
  const close = page.getByRole("dialog", {
    name: "Conferma chiusura spesa",
    exact: true,
  });
  const closedResponse = await command(page, second.id, "chiudi", () =>
    close
      .getByRole("button", { name: "Chiudi spesa Emporio", exact: true })
      .click(),
  );
  expect(closedResponse.status(), await closedResponse.text()).toBe(200);
  const closed = await closedResponse.json();
  expect(closed.spesa).toMatchObject({
    totaleCreditoConsumati: 2,
    saldoPrima: 100,
    saldoDopo: 98,
  });
  expect(await quantities(f)).toEqual({
    stock: "9.000000",
    credit: "98.00",
    sales: 1,
  });
  const recoveredClosed = await openFromAccess(page, f, access);
  expect(recoveredClosed).toMatchObject({
    id: second.id,
    statoSessione: "chiusa",
  });
  await expect(
    page.getByRole("button", { name: "Chiudi spesa Emporio", exact: true }),
  ).toHaveCount(0);
  const records = await snapshot();
  const replay = await page.request.post(
    `/api/cassa-emporio/sessioni/${second.id}/chiudi`,
    { data: { versione: closed.sessione.versione } },
  );
  expect(replay.status()).toBe(400);
  expect(await snapshot()).toEqual(records);
  await safe(page, errors);
});

test("A13/A14/A24: errore azione mantiene draft; GET revocata nasconde cache e PII con lo stesso cookie", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const f = await fixture();
  await login(page, f);
  const access = await createAccess(page, f);
  const opened = await openFromAccess(page, f, access);
  const draft = page.getByPlaceholder(
    /cerca prodotto per nome, codice o codice a barre/i,
  );
  await draft.fill(f.productCode);
  const added = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/cassa-emporio/sessioni/${opened.id}/righe`) &&
      r.request().method() === "POST",
  );
  await draft.press("Enter");
  expect((await added).status()).toBe(201);
  await expect(
    page.getByRole("cell").getByText(f.productName, { exact: true }),
  ).toBeVisible();
  await draft.fill("Draft R2 da preservare");
  const unchangedIdentity = await snapshot();
  const invalidQuantity = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/cassa-emporio/sessioni/${opened.id}/righe/`) &&
      r.request().method() === "PATCH",
  );
  const quantity = page.getByRole("spinbutton", {
    name: "Quantità",
    exact: true,
  });
  await quantity.fill("11");
  await quantity.press("Tab");
  expect((await invalidQuantity).status()).toBe(400);
  await expect(draft).toHaveValue("Draft R2 da preservare");
  expect(await snapshot()).toEqual(unchangedIdentity);
  // A real grant change is ALSO an auth-context change. The approved boundary
  // deliberately discards local state in that case; it is not a simple action
  // failure at unchanged identity. The canonical document must still be readable.
  await database.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify(grants.filter((g) => g !== "emporio.cassa.operate")),
    f.role,
  ]);
  const records = await snapshot();
  const denied = await command(page, opened.id, "sospendi", () =>
    page.getByRole("button", { name: "Sospendi", exact: true }).click(),
  );
  expect(denied.status()).toBe(403);
  expect(
    (
      await page.request.get(`/api/cassa-emporio/sessioni/${opened.id}`)
    ).status(),
  ).toBe(200);
  const sessionButton = page
    .getByRole("button")
    .filter({ hasText: `${f.code.split("-")[1]} Persona sintetica` })
    .filter({ hasText: /Aperta/ });
  await expect(sessionButton).toBeVisible();
  await sessionButton.click();
  await expect(
    page.getByText("Sessione aperta", { exact: true }),
  ).toBeVisible();
  await expect(draft).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Sospendi", exact: true }),
  ).toBeDisabled();
  expect(await snapshot()).toEqual(records);
  await database.query(
    "update utenti set area_operativa_id=null,centro_ascolto_id=null where id=$1",
    [f.user],
  );
  expect(
    (
      await page.request.get(`/api/cassa-emporio/sessioni/${opened.id}`)
    ).status(),
  ).toBe(403);
  await expect(
    page.getByRole("alert").filter({ hasText: "Accesso non più autorizzato" }),
  ).toBeVisible();
  await expect(page.getByText(f.code, { exact: true })).toHaveCount(0);
  await expect(draft).toHaveCount(0);
  expect(await snapshot()).toEqual(records);
  await page.goto("/emporio/accessi");
  await expect(
    page.getByRole("alert").filter({ hasText: "Accesso non più autorizzato" }),
  ).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: f.code })).toHaveCount(
    0,
  );
  await safe(page, errors);
});
