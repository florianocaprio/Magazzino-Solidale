import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type Page, type Locator } from "@playwright/test";
const require = createRequire(
  new URL("../../api-server/package.json", import.meta.url),
);
const { Pool } = require("pg"),
  bcrypt = require("bcryptjs");
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
  await db.query(
    "update ambiente_moduli set attivo=true where modulo_id in(select id from moduli_funzionali where codice in('EMPORIO_SOLIDALE','CREDITO_SOLIDALE'))",
  );
});
test.afterAll(async () => {
  await db?.end();
});
async function fixture(page: Page, admin = false) {
  const suffix = randomUUID().slice(0, 8);
  const insert = async (s: string, p: unknown[] = []) =>
    (await db.query(s, p)).rows[0].id as number;
  const area = await insert(
    "insert into aree_operative(nome)values($1)returning id",
    ["CF1 " + suffix],
  );
  const center = await insert(
    "insert into centri_di_ascolto(nome,area_operativa_id)values($1,$2)returning id",
    ["CF1 " + suffix, area],
  );
  const warehouse = await insert(
    "insert into magazzini(codice,nome,tipo_magazzino,area_operativa_id,centro_ascolto_id)values($1,$1,'emporio',$2,$3)returning id",
    ["CF1W-" + suffix, area, center],
  );
  const beneficiary = await insert(
    "insert into beneficiari(codice,nome,cognome,sesso,area_operativa_id,centro_ascolto_id,credito_solidale_abilitato,credito_solidale_stato,credito_solidale_saldo,magazzino_emporio_preferito_id)values($1,'Persona','Sintetica','M',$2,$3,true,'attivo',210,$4)returning id",
    ["CF1B-" + suffix, area, center, warehouse],
  );
  const grants = [
    "credito.view",
    "credito.adjust",
    "credito.monthly.execute",
    "emporio.access.view",
    "emporio.access.manage",
    "emporio.cassa.view",
    "emporio.cassa.operate",
    "emporio.sales.view",
    "beneficiari.view",
    "prodotti.view",
    "prodotti.manage",
    "magazzino.products.manage",
    "magazzino.view",
    "magazzini.view",
    "magazzini.manage",
  ];
  const role = await insert(
    'insert into ruoli(nome,aree,permessi,is_admin)values($1,\'["emporio","magazzino","sociale"]\',$2,$3)returning id',
    ["CF1 " + suffix, JSON.stringify(grants), admin],
  );
  const username = "cf1_" + suffix,
    password = "Synthetic-CF1-" + suffix + "-Password!";
  const user = await insert(
    "insert into utenti(username,nome,password_hash,ruolo_id,area_operativa_id,centro_ascolto_id,email,email_da_aggiornare)values($1,'Operatore F1',$2,$3,$4,$5,$6,false)returning id",
    [
      username,
      await bcrypt.hash(password, 4),
      role,
      area,
      center,
      suffix + "@example.invalid",
    ],
  );
  await db.query(
    "insert into emporio_abilitazioni(beneficiario_id,area_operativa_id,stato,operatore_id,motivo)values($1,$2,'attivo',$3,'Fixture F1')",
    [beneficiary, area, user],
  );
  const product = await insert(
    "insert into prodotti(codice,nome,tipo_prodotto,unita_misura,quantita_frazionabile,abilitato_emporio,credito_solidale_valore)values($1,'Prodotto F1','alimenti','pz',false,true,20)returning id",
    ["CF1P-" + suffix],
  );
  await db.query(
    "insert into lotti(prodotto_id,magazzino_id,codice_lotto,data_carico,quantita_caricata,quantita_residua)values($1,$2,$3,CURRENT_DATE,100,100)",
    [product, warehouse, "CF1L-" + suffix],
  );
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto(`/emporio/crediti-saldo?beneficiarioId=${beneficiary}`);
  await expect(
    page.getByRole("button", {
      name: "Rettifica Credito Solidale",
      exact: true,
    }),
  ).toBeVisible();
  return { beneficiary, warehouse, product, role, grants };
}
async function dialog(page: Page) {
  await page
    .getByRole("button", { name: "Rettifica Credito Solidale", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Rettifica credito", exact: true });
}
async function operation(page: Page, d: Locator, name: string) {
  await d.getByRole("combobox", { name: /Operazione/ }).click();
  await page.getByRole("option", { name, exact: true }).click();
}
async function balance(id: number) {
  return Number(
    (
      await db.query(
        "select credito_solidale_saldo s from beneficiari where id=$1",
        [id],
      )
    ).rows[0].s,
  );
}
async function red(control: Locator) {
  await expect(control).toHaveAttribute("aria-invalid", "true");
  await control.focus();
  await expect(control).toHaveCSS(
    "border-color",
    /^(?:rgb\(220, 38, 38\)|oklch\(0\.577 0\.245 27\.325\))$/,
  );
}

test("R01/R02/R04 V01-V04: segno esplicito, errori simultanei rossi e note facoltative", async ({
  page,
}) => {
  const f = await fixture(page),
    d = await dialog(page);
  await expect(d.getByRole("combobox")).toContainText("Scegli l’operazione");
  await d.getByRole("button", { name: "Salva rettifica" }).click();
  await expect(d.locator('[aria-invalid="true"]')).toHaveCount(3);
  await red(d.getByRole("combobox"));
  await red(d.getByLabel(/Quantità di crediti/));
  await red(d.getByLabel(/^Motivo/));
  await expect(d.getByLabel("Note operative")).toHaveAttribute(
    "aria-invalid",
    "false",
  );
  await operation(page, d, "Aggiungi credito");
  await d.getByLabel(/Quantità di crediti/).fill("12");
  await d.getByLabel(/^Motivo/).fill("Ridurre");
  await expect(d).toContainText("Saldo risultante previsto: 222");
  await operation(page, d, "Riduci credito");
  await expect(d).toContainText("Saldo risultante previsto: 198");
  await expect(d.getByLabel(/Quantità di crediti/)).toHaveValue("12");
  await operation(page, d, "Aggiungi credito");
  await d.getByRole("button", { name: "Salva rettifica" }).click();
  await expect(d).not.toBeVisible();
  expect(await balance(f.beneficiary)).toBe(222);
  expect(
    (
      await db.query(
        "select quantita_residua from lotti where prodotto_id=$1",
        [f.product],
      )
    ).rows[0].quantita_residua,
  ).toBe("100.000000");
});
test("R03/R06 V05: errore saldo mappato, modulo conservato, riduzione effettiva", async ({
  page,
}) => {
  const f = await fixture(page),
    d = await dialog(page);
  await operation(page, d, "Riduci credito");
  await d.getByLabel(/Quantità di crediti/).fill("211");
  await d.getByLabel(/^Motivo/).fill("Riduzione motivata");
  await d.getByRole("button", { name: "Salva rettifica" }).click();
  await expect(d.getByRole("alert")).toContainText(
    "non può diventare negativo",
  );
  await red(d.getByLabel(/Quantità di crediti/));
  expect(await balance(f.beneficiary)).toBe(210);
  await d.getByLabel(/Quantità di crediti/).fill("12");
  await expect(d.getByLabel(/^Motivo/)).toHaveValue("Riduzione motivata");
  await d.getByRole("button", { name: "Salva rettifica" }).click();
  await expect(d).not.toBeVisible();
  expect(await balance(f.beneficiary)).toBe(198);
});
test("R08/V05: risposta persa recuperata con GET, nessun secondo POST", async ({
  page,
}) => {
  const f = await fixture(page),
    d = await dialog(page);
  await operation(page, d, "Aggiungi credito");
  await d.getByLabel(/Quantità di crediti/).fill("12");
  await d.getByLabel(/^Motivo/).fill("Risposta persa");
  let posts = 0;
  await page.route(
    `**/credito-solidale/beneficiari/${f.beneficiary}/rettifica`,
    async (route) => {
      posts++;
      await route.fetch();
      await route.abort("failed");
    },
  );
  await d.getByRole("button", { name: "Salva rettifica" }).click();
  await expect(d.getByRole("button", { name: "Recupera esito" })).toBeVisible();
  await expect(d.getByLabel(/^Motivo/)).toHaveValue("Risposta persa");
  await page.reload();
  await dialog(page);
  await d.getByRole("button", { name: "Recupera esito" }).click();
  await expect(d).not.toBeVisible();
  expect(posts).toBe(1);
  expect(await balance(f.beneficiary)).toBe(222);
});
test("V05: 403 azione non mascherato da campo obbligatorio", async ({
  page,
}) => {
  const f = await fixture(page),
    d = await dialog(page);
  await operation(page, d, "Aggiungi credito");
  await d.getByLabel(/Quantità di crediti/).fill("12");
  await d.getByLabel(/^Motivo/).fill("Grant revocato");
  await db.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify(f.grants.filter((g) => g !== "credito.adjust")),
    f.role,
  ]);
  await d.getByRole("button", { name: "Salva rettifica" }).click();
  await expect(d.getByRole("alert")).toBeVisible();
  await expect(d.locator('[aria-invalid="true"]')).toHaveCount(0);
  await expect(d.getByLabel(/^Motivo/)).toHaveValue("Grant revocato");
  expect(await balance(f.beneficiary)).toBe(210);
});

for (const [path, title, save] of [
  ["/prodotti", "Nuovo Prodotto", "Crea Prodotto"],
  ["/magazzini", "Nuovo Magazzino", "Crea Magazzino"],
]) {
  test(`V06: obbligatori reali e opzionali preservati in ${path}`, async ({
    page,
  }) => {
    // Magazzini is intentionally an administration-only page; no production
    // grants are changed. All financial and denial scenarios use ordinary actors.
    await fixture(page, path === "/magazzini");
    await page.goto(path);
    await page.getByRole("button", { name: title, exact: true }).click();
    const sheet = page.getByRole("dialog", { name: title, exact: true });
    await sheet.getByRole("button", { name: save, exact: true }).click();
    const name = sheet.getByLabel(/^Nome/);
    await red(name);
    await expect(name).toBeFocused();
    await expect(
      sheet.getByText("Campo obbligatorio", { exact: true }),
    ).toBeVisible();
    await expect(sheet.getByLabel(/^Codice$/)).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await name.fill("   ");
    await sheet.getByRole("button", { name: save, exact: true }).click();
    await red(name);
    await name.fill("Valore conservato");
    await expect(name).toHaveAttribute("aria-invalid", "false");
    await expect(sheet).toBeVisible();
    await expect(name).toHaveValue("Valore conservato");
  });
}
test("M10/Cassa: nessuna ricarica da UI, avviso sotto carrello vicino alla chiusura", async ({
  page,
}) => {
  const f = await fixture(page);
  await expect(
    page.getByRole("button", { name: /ricarica|aggiorna credito/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Ricarica mensile automatica" }),
  ).toBeVisible();
  const post = async (url: string, data: unknown) => {
    const r = await page.request.post("/api" + url, { data });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const access = await post("/accessi-emporio", {
    beneficiarioId: f.beneficiary,
    magazzinoEmporioId: f.warehouse,
    dataOraInizio: new Date(Date.now() - 60000).toISOString(),
  });
  const session = await post(
    `/cassa-emporio/accessi/${access.id}/apri-sessione`,
    {},
  );
  await post(`/cassa-emporio/sessioni/${session.id}/righe`, {
    prodottoId: f.product,
    quantita: 11,
    versione: session.versione,
  });
  await page.goto(`/emporio/cassa?sessioneId=${session.id}`);
  const alert = page.getByTestId("credito-insufficiente-carrello");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Riduci il carrello");
  await expect(
    page.getByRole("button", { name: /aggiorna credito/i }),
  ).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: "Prodotto F1" });
  await expect(row).toBeVisible();
  expect((await alert.boundingBox())!.y).toBeGreaterThan(
    (await row.boundingBox())!.y,
  );
  expect(await balance(f.beneficiary)).toBe(210);
});

test("C2B: conferma integrata con deroga totale 80, prima quota unica e riapertura",async({page})=>{
  const f=await fixture(page,true);
  await db.query(`insert into politiche_credito_solidale(nome,centro_ascolto_id,credito_base_nucleo,credito_per_componente) select 'C2B 60',centro_ascolto_id,50,10 from beneficiari where id=$1`,[f.beneficiary]);
  const alternative=(await db.query(`insert into politiche_credito_solidale(nome,area_operativa_id,credito_base_nucleo,credito_per_componente) select 'C2B Alternativa',area_operativa_id,20,5 from beneficiari where id=$1 returning id`,[f.beneficiary])).rows[0].id;
  await page.goto(`/beneficiari/${f.beneficiary}`);
  await page.getByRole("button",{name:"Modifica anagrafica",exact:true}).click();
  await expect(page.getByRole("button",{name:"Salva configurazione Credito",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Salva quota assegnata",exact:true})).toHaveCount(1);
  const card=page.getByRole("region",{name:"Emporio Solidale",exact:true});
  await card.getByRole("textbox",{name:"Motivo dell'abilitazione o della variazione"}).fill("Conferma C2B");
  await card.getByRole("button",{name:"Completa o aggiorna Emporio e credito",exact:true}).click();
  const d=page.getByRole("dialog",{name:"Conferma Emporio e Credito Solidale",exact:true});
  await expect(d).toBeVisible();await expect(d).toContainText("Suggerito dal calcolo: 60");
  await d.getByRole("combobox",{name:"Politica per questo beneficiario",exact:true}).click();
  await page.getByRole("option",{name:"C2B Alternativa · Area",exact:true}).click();
  await expect(d).toContainText("Suggerito dal calcolo: 25");
  await expect(d.getByText("Politica applicata:",{exact:true}).locator("..")).toContainText("C2B Alternativa");
  expect((await db.query("select politica_credito_solidale_id from beneficiari where id=$1",[f.beneficiary])).rows[0].politica_credito_solidale_id).toBeNull();
  expect(await balance(f.beneficiary)).toBe(210);
  await d.getByLabel("Quota mensile assegnata",{exact:true}).fill("80");
  await d.getByRole("button",{name:"Conferma attivazione e quota",exact:true}).click();
  await expect(d.locator('[aria-invalid="true"]')).toHaveCount(1);
  await d.getByLabel(/Motivo modifica quota/).fill("Deroga totale C2B");
  await d.getByRole("button",{name:"Conferma attivazione e quota",exact:true}).click();await expect(d).not.toBeVisible();
  expect(await balance(f.beneficiary)).toBe(290);
  expect((await db.query("select politica_credito_solidale_id from beneficiari where id=$1",[f.beneficiary])).rows[0].politica_credito_solidale_id).toBe(alternative);
  await expect(page.getByText("Politica applicata",{exact:true}).locator("..")).toContainText("C2B Alternativa");
  await card.getByRole("textbox",{name:"Motivo dell'abilitazione o della variazione"}).fill("Verifica riapertura C2B");
  await card.getByRole("button",{name:"Completa o aggiorna Emporio e credito",exact:true}).click();await expect(d).toContainText("Nessuna nuova prima ricarica");
  await d.getByRole("button",{name:"Conferma attivazione e quota",exact:true}).click();await expect(d).not.toBeVisible();expect(await balance(f.beneficiary)).toBe(290);
  expect((await db.query("select count(*)::int n from credito_solidale_movimenti where beneficiario_id=$1 and origine='attivazione_emporio'",[f.beneficiary])).rows[0].n).toBe(1);
});
