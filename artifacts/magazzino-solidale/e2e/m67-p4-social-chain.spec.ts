import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { m67aMensaFixture } from "../../api-server/tests/helpers/m67a-mensa-fixture";
import {
  createCentroRec,
  createBeneficiario,
  createVolontario,
  newScope,
} from "../../api-server/tests/scope-helpers";
import { updateModuloAmbiente } from "../../api-server/src/lib/configurazioneAmbiente";
import { pool } from "../../../lib/db/src/index";
import { selectOption } from "./helpers";

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
async function login(page: Page, user: { username: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(user.username);
  await page.getByLabel(/^password$/i).fill(user.password);
  await page.getByRole("button", { name: /accedi|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}
test("M67-18/19: two ordinary actors carry one intervention/request through preparation, volunteer planning, delivery and Reporting", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const f = await m67aMensaFixture(),
    scope = newScope();
  for (const code of [
    "CENTRO_ASCOLTO",
    "CONSEGNE",
    "BOLLE",
    "REPORT",
    "VOLONTARI",
    "LOGISTICA",
  ])
    await updateModuloAmbiente(code, true, null);
  const centre = await createCentroRec(scope, { areaOperativaId: f.area });
  const person = await createBeneficiario(scope, centre.id, {
    areaOperativaId: f.area,
  });
  const volunteer = await createVolontario(scope, centre.id);
  const v = (
    await pool.query("select nome,cognome from volontari where id=$1", [
      volunteer,
    ])
  ).rows[0];
  await pool.query("update utenti set centro_ascolto_id=$1 where id=$2", [
    centre.id,
    f.users.requester.id,
  ]);
  await pool.query("update ruoli set aree=$1,permessi=$2 where id=$3", [
    JSON.stringify(["sociale", "logistica", "analisi"]),
    JSON.stringify([
      "beneficiari.view",
      "sociale.interventi.create",
      "sociale.interventi.view",
      "richieste_magazzino.create",
      "richieste_magazzino.view",
      "consegne.view",
      "consegne.manage",
      "consegne.complete",
      "bolle.view",
      "logistica.volontari.view",
      "logistica.turni.view",
      "logistica.mezzi.view",
    ]),
    f.users.requester.roleId,
  ]);
  await pool.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify([
      "richieste_magazzino.view",
      "richieste_magazzino.take",
      "richieste_magazzino.prepare",
      "magazzino.view",
      "bolle.view",
      "bolle.manage",
      "bolle.deliver",
    ]),
    f.users.warehouse.roleId,
  ]);
  const before = Number(
    (
      await pool.query(
        "select sum(quantita_residua) qty from lotti where prodotto_id=$1 and magazzino_id=$2",
        [f.product, f.origin],
      )
    ).rows[0].qty,
  );
  const product = (
    await pool.query("select nome from prodotti where id=$1", [f.product])
  ).rows[0].nome;
  await login(page, f.users.requester);
  const created = await page.request.post("/api/interventi", {
    data: {
      beneficiarioId: person,
      tipoIntervento: "P4 chain " + scope,
      ambito: "sociale",
      stato: "da_pianificare",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const intervention = await created.json();
  await page.goto(`/interventi?interventoId=${intervention.id}`);
  await page
    .getByTestId("intervento-richiesta-magazzino")
    .getByRole("link", { name: "Invia richiesta al Magazzino" })
    .click();
  await page
    .locator("#rm-need")
    .fill("Bisogno P4: non una quantità inventariale");
  const sent = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/richieste-magazzino" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Invia al Magazzino", exact: true })
    .click();
  const response = await sent;
  expect(response.status(), await response.text()).toBe(201);
  const need = await response.json();
  const warehouseContext = await browser.newContext({
    viewport: page.viewportSize(),
  });
  try {
    const warehouse = await warehouseContext.newPage();
    await login(warehouse, f.users.warehouse);
    await warehouse.goto(`/richieste-magazzino?richiestaId=${need.id}`);
    const sheet = warehouse.getByTestId("richiesta-sheet");
    await sheet
      .getByRole("button", { name: "Prendi in carico", exact: true })
      .click();
    await sheet
      .getByLabel("Magazzino di evasione")
      .selectOption(String(f.origin));
    const docResponse = warehouse.waitForResponse(
      (r) =>
        r.url().endsWith(`/richieste-magazzino/${need.id}/documento`) &&
        r.request().method() === "POST",
    );
    await sheet
      .getByRole("button", { name: "Crea Bolla", exact: true })
      .click();
    const dr = await docResponse;
    expect(dr.status(), await dr.text()).toBe(201);
    const doc = await dr.json();
    const id = doc.documentoId;
    await page.goto("/consegne?tab=da-pianificare");
    await expect(page.locator(`[data-bolla-id="${id}"]`)).toHaveCount(0);
    const version = async () =>
      (await pool.query("select versione from bolle where id=$1", [id])).rows[0]
        .versione;
    const early = await page.request.post(`/api/consegne/da-bolla/${id}`, {
      data: {
        versione: await version(),
        idempotencyKey: randomUUID(),
        tipoConsegna: "domicilio",
        dataPrevista: "2026-10-17",
        fasciaOraria: "Mattina",
        indirizzoConsegna: "Via sintetica P4",
      },
    });
    expect(early.status(), await early.text()).toBe(409);
    await sheet
      .getByRole("button", { name: "Aggiungi prodotto", exact: true })
      .click();
    const add = warehouse.getByRole("dialog", {
      name: "Aggiungi Prodotto alla Bolla",
      exact: true,
    });
    await selectOption(
      warehouse,
      add.getByRole("combobox", { name: "Prodotto disponibile in magazzino" }),
      new RegExp(product),
    );
    await add.getByLabel("Quantità", { exact: true }).fill("3");
    const rowResponse = warehouse.waitForResponse(
      (r) =>
        r.url().endsWith(`/bolle/${id}/righe`) &&
        r.request().method() === "POST",
    );
    await add.getByRole("button", { name: "Aggiungi", exact: true }).click();
    expect((await rowResponse).status()).toBe(201);
    await add.getByRole("button", { name: "Chiudi", exact: true }).click();
    // Preparation is a real command by the warehouse actor; subsequent UI rereads the same ID.
    const ready = await warehouse.request.post(`/api/bolle/${id}/conferma`, {
      data: { versione: await version(), idempotencyKey: randomUUID() },
    });
    expect(ready.status(), await ready.text()).toBe(200);
    await page.reload();
    await page
      .locator(`[data-bolla-id="${id}"]`)
      .getByRole("button", { name: "Pianifica consegna", exact: true })
      .click();
    const planning = page.getByRole("dialog", {
      name: "Pianifica consegna",
      exact: true,
    });
    await planning.getByLabel("Data", { exact: true }).fill("2026-10-17");
    await selectOption(
      page,
      planning.getByRole("combobox", { name: "Modalità", exact: true }),
      "A Domicilio",
    );
    await planning
      .getByLabel("Indirizzo di Consegna", { exact: true })
      .fill("Via sintetica P4");
    await selectOption(
      page,
      planning.getByRole("combobox", {
        name: "Assegna Volontario (Opzionale)",
        exact: true,
      }),
      new RegExp(v.cognome),
    );
    const plannedResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/consegne/da-bolla/${id}`) &&
        r.request().method() === "POST",
    );
    await planning.getByRole("button", { name: "Salva", exact: true }).click();
    const pr = await plannedResponse;
    expect(pr.status(), await pr.text()).toBe(201);
    const delivery = await pr.json();
    expect(
      (
        await pool.query(
          "select volontario_id,fascia_oraria from consegne where id=$1",
          [delivery.id],
        )
      ).rows[0],
    ).toEqual({ volontario_id: volunteer, fascia_oraria: "Mattina" });
    await page.goto(`/consegne?tab=consegne&consegnaId=${delivery.id}`);
    await page
      .getByTestId("consegna-collegata")
      .getByRole("button", { name: "Conferma Consegna", exact: true })
      .click();
    const completed = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/consegne/${delivery.id}/completa`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Conferma Consegna", exact: true })
      .click();
    const cr = await completed;
    expect(cr.status(), await cr.text()).toBe(200);
    const replay = await page.request.post(
      `/api/consegne/${delivery.id}/completa`,
      { data: cr.request().postDataJSON() },
    );
    expect(replay.status()).toBe(200);
    expect(
      (
        await pool.query(
          "select r.stato,b.stato bolla,i.stato intervento from richieste_magazzino r join richieste_magazzino_documenti d on d.richiesta_id=r.id and d.corrente join bolle b on b.id=d.bolla_id join interventi i on i.id=r.intervento_id where r.id=$1",
          [need.id],
        )
      ).rows[0],
    ).toEqual({
      stato: "chiusa",
      bolla: "consegnato",
      intervento: "da_pianificare",
    });
    expect(
      Number(
        (
          await pool.query(
            "select sum(quantita_residua) qty from lotti where prodotto_id=$1 and magazzino_id=$2",
            [f.product, f.origin],
          )
        ).rows[0].qty,
      ),
    ).toBe(before - 3);
    expect(
      (
        await pool.query(
          "select count(*)::int n from movimenti where bolla_id=$1 and tipo_movimento='scarico'",
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
    // Keep reporting authorizations explicit; they are not inferred from Social grants.
    await pool.query("update ruoli set aree=$1 where id=$2", [
      JSON.stringify(["sociale", "analisi", "magazzino"]),
      f.users.requester.roleId,
    ]);
    const day = (
      await pool.query(
        "select (current_timestamp at time zone 'Europe/Rome')::date::text AS day",
      )
    ).rows[0].day;
    const reportResponse = page.waitForResponse(
      (r) => r.url().includes("/api/report/pacchi?") && r.status() === 200,
    );
    await page.goto(
      `/report/pacchi?da=${day}&a=${day}&areaOperativaId=${f.area}&centroAscoltoId=${centre.id}`,
    );
    const report = await (await reportResponse).json();
    const flow = report.tables.find(
      (t: { key: string }) => t.key === "flussiDistribuzionePeriodo",
    ).rows;
    expect(flow).toHaveLength(1);
    expect(flow[0].prodotto).toBe(product);
    expect(Number(flow[0].netto)).toBe(3);
    await expect(
      page.getByRole("table").filter({
        has: page.getByRole("columnheader", {
          name: "Compensazioni",
          exact: true,
        }),
      }),
    ).toContainText(product);
  } finally {
    await warehouseContext.close();
  }
});
