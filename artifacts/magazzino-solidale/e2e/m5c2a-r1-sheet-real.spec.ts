import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

let database: Awaited<typeof import("../../../lib/db/src/index.ts")>["pool"];
test.beforeAll(async () => {
  if (process.env.M5C2A_TEST_DISPOSABLE_DB !== "verified")
    throw Error("Disposable DB required");
  const target = new URL(process.env.E2E_DATABASE_URL!);
  expect(target.hostname).toBe("127.0.0.1");
  expect(target.pathname).toBe("/m5c2a_r1");
  process.env.DATABASE_URL = target.toString();
  const { pool } = await import("../../../lib/db/src/index.ts");
  const Pool = pool.constructor as new (options: {
    connectionString: string;
  }) => typeof pool;
  database = new Pool({ connectionString: target.toString() });
  const { rows } = await database.query(
    "SELECT current_database() AS name, (SELECT count(*)::integer FROM app_meta.schema_migrations) AS ledger",
  );
  expect(rows[0]).toEqual({ name: "m5c2a_r1", ledger: 46 });
});
test.afterAll(async () => {
  await database?.end();
});

async function post(page: Page, path: string, data: object, status: number) {
  const response = await page.request.post(`/api${path}`, {
    data,
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

test("M5C2-A/R1 reale: Bolla pronta in coda, annullamento da Sheet, stock e Intervento preservati", async ({
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
  const taken = await post(
    page,
    `/richieste-magazzino/${rm.id}/presa-in-carico`,
    { versione: rm.versione, idempotencyKey: randomUUID() },
    200,
  );
  const doc = await post(
    page,
    `/richieste-magazzino/${rm.id}/documento`,
    {
      versione: taken.versione,
      magazzinoId: warehouse.id,
      idempotencyKey: randomUUID(),
    },
    201,
  );
  const line = await post(
    page,
    `/bolle/${doc.documentoId}/righe`,
    {
      versione: doc.versioneDocumento,
      prodottoId: product.id,
      lottoId: lot.id,
      quantita: "3",
      unitaMisura: "pz",
      idempotencyKey: randomUUID(),
    },
    201,
  );
  await post(
    page,
    `/bolle/${doc.documentoId}/conferma`,
    { versione: line.versioneBolla, idempotencyKey: randomUUID() },
    200,
  );
  await page.goto("/consegne");
  await expect(
    page.locator(`[data-bolla-id="${doc.documentoId}"]`),
  ).toBeVisible();
  await page.goto(`/richieste-magazzino?filter=keep&richiestaId=${rm.id}`);
  const sheet = page.getByTestId("richiesta-sheet");
  await expect(sheet.getByText(/Pronta/)).toBeVisible();
  await sheet
    .getByRole("button", { name: "Annulla richiesta", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Annulla richiesta",
    exact: true,
  });
  await expect(
    dialog.getByText(/Verrà annullato anche il documento/),
  ).toBeVisible();
  await dialog.getByLabel(/Motivo dell'annullamento/).fill("Necessità cessata");
  await dialog.getByLabel("Nota aggiuntiva (opzionale)").fill(`Nota R1 ${key}`);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/richieste-magazzino/${rm.id}/annulla`) &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Conferma annullamento" }).click();
  expect((await response).status()).toBe(200);
  await expect(sheet.getByText("Annullata", { exact: true })).toBeVisible();
  await expect(
    sheet.getByText(`Nota R1 ${key}`, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    sheet.getByText("Conservare note operative", { exact: true }),
  ).toBeVisible();
  const {
    rows: [facts],
  } = await database.query(
    `
    SELECT r.stato, b.stato AS bolla, l.quantita_residua::float8 AS stock,
      i.stato AS intervento, d.corrente,
      (SELECT count(*)::int FROM movimenti WHERE bolla_id=b.id) AS movimenti,
      (SELECT count(*)::int FROM prenotazioni_magazzino WHERE bolla_id=b.id AND stato='attiva') AS attive
    FROM richieste_magazzino r JOIN richieste_magazzino_documenti d ON d.richiesta_id=r.id
    JOIN bolle b ON b.id=d.bolla_id JOIN interventi i ON i.id=r.intervento_id
    JOIN lotti l ON l.id=$2 WHERE r.id=$1`,
    [rm.id, lot.id],
  );
  expect(facts).toEqual({
    stato: "annullata",
    bolla: "annullato",
    stock: 10,
    intervento: "da_pianificare",
    corrente: false,
    movimenti: 0,
    attive: 0,
  });
  await page.goto("/consegne");
  await expect(
    page.locator(`[data-bolla-id="${doc.documentoId}"]`),
  ).toHaveCount(0);
});
