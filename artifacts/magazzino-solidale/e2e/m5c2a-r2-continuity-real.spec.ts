import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { login, selectOption } from "./helpers";

let database: Awaited<typeof import("../../../lib/db/src/index.ts")>["pool"];
test.beforeAll(async () => {
  if (process.env.M5C2A_TEST_DISPOSABLE_DB !== "verified")
    throw Error("Disposable DB required");
  const target = new URL(process.env.E2E_DATABASE_URL!);
  expect(target.hostname).toBe("127.0.0.1");
  expect(target.pathname).toBe("/m5c2a_r2_e2e");
  process.env.DATABASE_URL = target.toString();
  const { pool } = await import("../../../lib/db/src/index.ts");
  const Pool = pool.constructor as new (options: {
    connectionString: string;
  }) => typeof pool;
  database = new Pool({ connectionString: target.toString() });
  const { rows } = await database.query(
    "SELECT current_database() AS name, (SELECT count(*)::integer FROM app_meta.schema_migrations) AS ledger",
  );
  expect(rows[0]).toEqual({ name: "m5c2a_r2_e2e", ledger: 46 });
});
test.afterAll(async () => {
  await database?.end();
});

test("R2: Bolla diretta Beneficiario/Ente apre il nuovo ID e riallinea elenco e filtri", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  const key = randomUUID().slice(0, 8);
  const {
    rows: [area],
  } = await database.query(
    "INSERT INTO aree_operative(nome) VALUES ($1) RETURNING id",
    [`R2 dir ${key}`],
  );
  const {
    rows: [centre],
  } = await database.query(
    "INSERT INTO centri_di_ascolto(nome,area_operativa_id) VALUES ($1,$2) RETURNING id",
    [`R2 dir ${key}`, area.id],
  );
  const {
    rows: [warehouse],
  } = await database.query(
    "INSERT INTO magazzini(codice,nome,area_operativa_id,centro_ascolto_id) VALUES ($1,$2,$3,$4) RETURNING id",
    [`R2-${key}`, `R2 deposito ${key}`, area.id, centre.id],
  );
  const {
    rows: [person],
  } = await database.query(
    "INSERT INTO beneficiari(codice,nome,cognome,area_operativa_id,centro_ascolto_id) VALUES ($1,'Ada',$2,$3,$4) RETURNING id",
    [`R2-${key}`, `R2-${key}`, area.id, centre.id],
  );
  const {
    rows: [ente],
  } = await database.query(
    "INSERT INTO enti_destinatari(denominazione,indirizzo,area_operativa_id) VALUES ($1,'Via test',$2) RETURNING id",
    [`R2 ente ${key}`, area.id],
  );
  await database.query(
    "INSERT INTO bolle(numero_bolla,data_bolla,beneficiario_id,magazzino_id,data_creazione) SELECT $1||g,CURRENT_DATE,$2,$3,'2020-01-01'::timestamp FROM generate_series(1,60) g",
    [`R2-PRE-${key}-`, person.id, warehouse.id],
  );
  for (const tipo of ["beneficiario", "ente"]) {
    await page.goto(
      `/bolle?areaOperativaId=${area.id}&magazzinoId=${warehouse.id}&centroAscoltoId=${centre.id}&stato=annullato&ricerca=INCOMPATIBILE&dataA=2000-01-01&page=3`,
    );
    await page.getByRole("button", { name: "Nuovo", exact: true }).click();
    await page.getByRole("button", { name: /Nuova Bolla/ }).click();
    const form = page.getByRole("dialog", {
      name: "Nuova Bolla di Consegna",
      exact: true,
    });
    if (tipo === "beneficiario") {
      await form
        .getByRole("combobox", { name: "Seleziona beneficiario..." })
        .click();
      await page.getByRole("option", { name: new RegExp(`R2-${key}`) }).click();
    } else {
      await selectOption(
        page,
        form.getByRole("combobox").first(),
        "Ente esterno",
      );
      await form
        .getByRole("combobox")
        .filter({ hasText: "Seleziona Ente" })
        .click();
      await page
        .getByRole("option", { name: new RegExp(`R2 ente ${key}`) })
        .click();
    }
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/bolle") && r.request().method() === "POST",
    );
    await form.getByRole("button", { name: "Crea Bolla", exact: true }).click();
    const result = await response;
    expect(result.status(), await result.text()).toBe(201);
    const created = await result.json();
    const sheet = page.getByRole("dialog", {
      name: "Dettaglio Bolla",
      exact: true,
    });
    await expect(sheet).toBeVisible();
    const url = new URL(page.url());
    expect(url.searchParams.get("documento")).toBe(`bolla:${created.id}`);
    expect(url.searchParams.get("page")).toBeNull();
    expect(url.searchParams.get("areaOperativaId")).toBe(String(area.id));
    expect(url.searchParams.get("magazzinoId")).toBe(String(warehouse.id));
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("row").nth(1)).toContainText(
      created.numeroBolla,
    );
    // A backdated civil date must not move a newly inserted record to an older page.
    await database.query(
      "UPDATE bolle SET data_bolla='1999-01-01' WHERE id=$1",
      [created.id],
    );
    await page.reload();
    await expect(page.getByRole("row").nth(1)).toContainText(
      created.numeroBolla,
    );
  }
});

async function post(page: Page, path: string, data: object, status: number) {
  const response = await page.request.post(`/api${path}`, {
    data,
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

test("M5C2-A/R2 reale: Sheet contestuale, due righe e Richiesta conclusa", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  const key = randomUUID().slice(0, 8);
  const {
    rows: [actor],
  } = await database.query("SELECT id FROM utenti WHERE username='sadmin'");
  const {
    rows: [area],
  } = await database.query(
    "INSERT INTO aree_operative(nome) VALUES ($1) RETURNING id",
    [`R1 ${key}`],
  );
  const {
    rows: [centre],
  } = await database.query(
    "INSERT INTO centri_di_ascolto(nome,area_operativa_id) VALUES ($1,$2) RETURNING id",
    [`R1 ${key}`, area.id],
  );
  const {
    rows: [person],
  } = await database.query(
    "INSERT INTO beneficiari(codice,nome,cognome,area_operativa_id,centro_ascolto_id) VALUES ($1,'Ada','R1',$2,$3) RETURNING id",
    [`R1-${key}`, area.id, centre.id],
  );
  const {
    rows: [warehouse],
  } = await database.query(
    "INSERT INTO magazzini(codice,nome,area_operativa_id,centro_ascolto_id) VALUES ($1,$2,$3,$4) RETURNING id",
    [`R1-${key}`, `R1 deposito ${key}`, area.id, centre.id],
  );
  const {
    rows: [product],
  } = await database.query(
    "INSERT INTO prodotti(codice,nome,tipo_prodotto,unita_misura) VALUES ($1,'R1 prodotto','alimentare','pz') RETURNING id",
    [`R1-${key}`],
  );
  const {
    rows: [lot],
  } = await database.query(
    "INSERT INTO lotti(prodotto_id,magazzino_id,data_carico,quantita_caricata,quantita_residua,data_scadenza) VALUES ($1,$2,CURRENT_DATE,10,10,'2098-01-01') RETURNING id",
    [product.id, warehouse.id],
  );
  const {
    rows: [intervention],
  } = await database.query(
    "INSERT INTO interventi(beneficiario_id,tipo_intervento,ambito,stato,operatore_id,area_operativa_id_snapshot,centro_ascolto_id_snapshot) VALUES ($1,'R1','sociale','da_pianificare',$2,$3,$4) RETURNING id",
    [person.id, actor.id, area.id, centre.id],
  );
  const rm = await post(
    page,
    "/richieste-magazzino",
    {
      idempotencyKey: randomUUID(),
      tipoDestinatario: "beneficiario",
      beneficiarioId: person.id,
      sorgente: "intervento_sociale",
      interventoId: intervention.id,
      bisogno: `R1 bisogno ${key}`,
      noteOperative: "Conservare note operative",
    },
    201,
  );

  await database
    .query(
      "INSERT INTO prodotti(codice,nome,tipo_prodotto,unita_misura) VALUES ($1,'R2 altro','alimentare','pz') RETURNING id",
      [`R2-altro-${key}`],
    )
    .then(async ({ rows: [p] }) => {
      await database.query(
        "INSERT INTO lotti(prodotto_id,magazzino_id,data_carico,quantita_caricata,quantita_residua,data_scadenza) VALUES ($1,$2,CURRENT_DATE,10,10,'2098-01-01')",
        [p.id, warehouse.id],
      );
    });
  await page.goto(`/richieste-magazzino?filter=keep&richiestaId=${rm.id}`);
  const sheet = page.getByTestId("richiesta-sheet");
  await sheet
    .getByRole("button", { name: "Prendi in carico", exact: true })
    .click();
  await sheet
    .getByLabel("Magazzino di evasione")
    .selectOption(String(warehouse.id));
  const createdResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/richieste-magazzino/${rm.id}/documento`) &&
      r.request().method() === "POST",
  );
  await sheet.getByRole("button", { name: "Crea Bolla", exact: true }).click();
  const created = await createdResponse;
  expect(created.status(), await created.text()).toBe(201);
  const doc = await created.json();
  await expect(page).toHaveURL(
    new RegExp("richieste-magazzino.*documento=bolla%3A" + doc.documentoId),
  );
  await expect(
    sheet
      .getByRole("button", { name: "Torna alla richiesta", exact: true })
      .first(),
  ).toBeVisible();
  for (const name of ["R1 prodotto", "R2 altro"]) {
    await sheet
      .getByRole("button", { name: "Aggiungi prodotto", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Aggiungi Prodotto alla Bolla",
      exact: true,
    });
    await selectOption(
      page,
      dialog.getByRole("combobox", {
        name: "Prodotto disponibile in magazzino",
      }),
      new RegExp(name),
    );
    await dialog.getByLabel("Quantità", { exact: true }).fill("2");
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/bolle/${doc.documentoId}/righe`) &&
        r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Aggiungi", exact: true }).click();
    expect((await saved).status()).toBe(201);
    await expect(dialog.getByLabel("Quantità", { exact: true })).toHaveValue(
      "",
    );
    await dialog.getByRole("button", { name: "Chiudi", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await page.reload();
  await expect(sheet.getByText("R1 prodotto", { exact: true })).toBeVisible();
  await expect(sheet.getByText("R2 altro", { exact: true })).toBeVisible();
  await sheet
    .getByRole("button", { name: "Torna alla richiesta", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(
    new RegExp("richieste-magazzino.*richiestaId=" + rm.id),
  );
  expect(new URL(page.url()).searchParams.has("documento")).toBe(false);
  await sheet
    .getByRole("button", { name: "Apri documento", exact: true })
    .click();
  const getBolla = async () =>
    (
      await page.request.get(
        `/api/documenti-operativi/bolla/${doc.documentoId}`,
      )
    ).json();
  let current = await getBolla();
  await post(
    page,
    `/bolle/${doc.documentoId}/conferma`,
    { versione: current.dettaglio.versione, idempotencyKey: randomUUID() },
    200,
  );
  current = await getBolla();
  const planned = await post(
    page,
    `/consegne/da-bolla/${doc.documentoId}`,
    {
      versione: current.dettaglio.versione,
      idempotencyKey: randomUUID(),
      tipoConsegna: "domicilio",
      dataPrevista: "2026-10-15",
      fasciaOraria: "Mattina",
      indirizzoConsegna: "Via R2",
    },
    201,
  );
  current = await getBolla();
  await post(
    page,
    `/consegne/${planned.id}/completa`,
    { versione: current.dettaglio.versione, idempotencyKey: randomUUID() },
    200,
  );
  await page.goto("/richieste-magazzino");
  await expect(
    page.getByRole("button").filter({ hasText: rm.codice }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Concluse", exact: true }).click();
  await expect(
    page.getByRole("button").filter({ hasText: rm.codice }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button").filter({ hasText: rm.codice }).click();
  await sheet
    .getByRole("button", { name: "Apri documento", exact: true })
    .click();
  await expect(sheet.getByText(/Consegna completata/)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/richieste-magazzino");
  const {
    rows: [facts],
  } = await database.query(
    "select r.stato, i.stato as intervento, l.quantita_residua::float8 as residuo from richieste_magazzino r join interventi i on i.id=r.intervento_id join lotti l on l.id=$2 where r.id=$1",
    [rm.id, lot.id],
  );
  expect(facts).toEqual({
    stato: "chiusa",
    intervento: "da_pianificare",
    residuo: 8,
  });
});
