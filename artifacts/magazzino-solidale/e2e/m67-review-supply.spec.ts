import { test, expect } from "@playwright/test";
import { m67aMensaFixture } from "../../api-server/tests/helpers/m67a-mensa-fixture";
import { updateModuloAmbiente } from "../../api-server/src/lib/configurazioneAmbiente";
import { createProdotto, newScope } from "../../api-server/tests/scope-helpers";
import { pool } from "../../../lib/db/src/index";

test.afterAll(async () => {
  await pool.end();
});
test("EXT67-04 real receipt form retains exact quantity and acquires required physical data", async ({
  page,
}) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname))
      return route.continue();
    if (url.hostname === "fonts.googleapis.com")
      return route.fulfill({ contentType: "text/css", body: "/* offline */" });
    throw new Error(`Unexpected external host ${url.hostname}`);
  });
  const f = await m67aMensaFixture();
  await updateModuloAmbiente("APPROVVIGIONAMENTI", true, null);
  const product = await createProdotto(newScope(), {
    unitaMisura: "kg",
    quantitaFrazionabile: true,
  });
  await pool.query(
    "update prodotti set lotto_fisico_obbligatorio=true,gestione_scadenza=true where id=$1",
    [product],
  );
  const supplier = (
    await pool.query(
      "insert into fornitori(nome,tipo,area_operativa_id) values('Synthetic browser supplier','azienda',$1) returning id",
      [f.area],
    )
  ).rows[0].id;
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(f.users.admin.username);
  await page.getByLabel(/^password$/i).fill(f.users.admin.password);
  await page.getByRole("button", { name: /accedi|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
  const create = await page.request.post("/api/approvvigionamenti", {
    data: {
      areaOperativaId: f.area,
      fornitoreId: supplier,
      magazzinoId: f.origin,
      dataRichiesta: "2026-10-16",
      righe: [
        {
          prodottoId: product,
          quantitaRichiesta: "1.000001",
          unitaMisura: "kg",
        },
      ],
    },
  });
  expect(create.status()).toBe(201);
  const order = await create.json();
  expect(
    (
      await page.request.post(
        `/api/approvvigionamenti/${order.id}/sottometti`,
        { data: { versione: order.versione } },
      )
    ).status(),
  ).toBe(200);
  const before = (
    await pool.query(
      "select count(*)::int n from movimenti where prodotto_id=$1",
      [product],
    )
  ).rows[0].n;
  expect(before).toBe(0);
  await page.goto("/approvvigionamenti");
  const row = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: order.codice, exact: true }),
  });
  await row.getByRole("button", { name: "Completato", exact: true }).click();
  const receipt = page.getByRole("dialog", {
    name: "Ricevi approvvigionamento",
    exact: true,
  });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByLabel(/^Quantità/)).toHaveValue("1.000001");
  await receipt
    .getByRole("button", { name: "Conferma ricezione", exact: true })
    .click();
  await expect(receipt).toBeVisible();
  expect(
    (
      await pool.query(
        "select count(*)::int n from movimenti where prodotto_id=$1",
        [product],
      )
    ).rows[0].n,
  ).toBe(0);
  await receipt.getByLabel(/^Codice lotto produttore/).fill("SYNTH-BROWSER");
  await receipt.getByLabel(/^Scadenza/).fill("2027-10-16");
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      new URL(r.url()).pathname === `/api/approvvigionamenti/${order.id}`,
  );
  await receipt
    .getByRole("button", { name: "Conferma ricezione", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(receipt).toHaveCount(0);
  await expect(row).toContainText("Completato");
  expect(
    (
      await pool.query(
        `select m.quantita::text quantity,l.codice_lotto lot,l.data_scadenza::text expiry,m.documento_riferimento document
    from movimenti m join lotti l on l.id=m.lotto_id where m.prodotto_id=$1`,
        [product],
      )
    ).rows,
  ).toEqual([
    {
      quantity: "1.000001",
      lot: "SYNTH-BROWSER",
      expiry: "2027-10-16",
      document: order.codice,
    },
  ]);
});
