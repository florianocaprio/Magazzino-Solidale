import { test, expect, type Page } from "@playwright/test";
import { m67aMensaFixture } from "../../api-server/tests/helpers/m67a-mensa-fixture";
import {
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createMagazzino,
  createProdotto,
  insertConsegna,
  newScope,
} from "../../api-server/tests/scope-helpers";
import { db, pool } from "../../../lib/db/src/index";
import { updateModuloAmbiente } from "../../api-server/src/lib/configurazioneAmbiente";
import {
  createWarehouseLoad,
  rettificaInventarialeConEsito,
} from "../../api-server/src/lib/inventoryLedger";
import { readFileSync } from "node:fs";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname))
      return route.continue();
    if (url.hostname === "fonts.googleapis.com")
      return route.fulfill({ contentType: "text/css", body: "/* offline */" });
    throw new Error(`Unexpected external request: ${url.hostname}`);
  });
});
test.afterAll(async () => {
  await pool.end();
});
async function login(
  page: Page,
  account: { username: string; password: string },
) {
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(account.username);
  await page.getByLabel(/^password$/i).fill(account.password);
  await page.getByRole("button", { name: /accedi|login/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
}

test("M67-04..07 Area URL/back/forward and exact keyboard scanner beyond 51/101", async ({
  page,
}) => {
  const tablet = page.viewportSize()!.width < 1024;
  const record = () =>
    tablet
      ? page.getByRole("heading", { name: "FuoriPagina0 Scanner", exact: true })
      : page.getByRole("cell", { name: "FuoriPagina0 Scanner", exact: true });
  const f = await m67aMensaFixture(),
    scope = newScope();
  for (const module of ["CONSEGNE", "CENTRO_ASCOLTO"])
    await updateModuloAmbiente(module, true, null);
  await pool.query("update utenti set area_operativa_id=null where id=$1", [
    f.users.admin.id,
  ]);
  const areaB = await createAreaOperativa(scope);
  const centreA = await createCentroRec(scope, { areaOperativaId: f.area });
  const centreB = await createCentroRec(scope, { areaOperativaId: areaB });
  const warehouseB = await createMagazzino(scope, centreB.id, {
    areaOperativaId: areaB,
  });
  const other = await createBeneficiario(scope, centreB.id, {
    areaOperativaId: areaB,
  });
  const codes: string[] = [];
  async function addPeople(from: number, to: number) {
    for (let n = from; n < to; n++) {
      const id = await createBeneficiario(scope, centreA.id, {
        areaOperativaId: f.area,
      });
      const code = `B-${f.area}-${n}`;
      codes.push(code);
      await pool.query(
        "update beneficiari set codice=$1,nome='Scanner',cognome=$2 where id=$3",
        [code, `FuoriPagina${n}`, id],
      );
      if (n === 0)
        await insertConsegna(scope, {
          beneficiarioId: id,
          magazzinoId: f.origin,
        });
    }
  }
  await addPeople(0, 51);
  await insertConsegna(scope, {
    beneficiarioId: other,
    magazzinoId: warehouseB,
  });
  await login(page, f.users.admin);
  await page.goto(
    `/consegne?area=${f.area}&centro=${centreA.id}&tab=consegne&dal=2000-01-01&al=2100-12-31`,
  );
  await expect(record()).toBeVisible();
  if (tablet)
    await page
      .getByRole("button", { name: "Filtri e ricerca", exact: true })
      .click();
  const areaBName = (
    await pool.query("select nome from aree_operative where id=$1", [areaB])
  ).rows[0].nome;
  const areaAName = (
    await pool.query("select nome from aree_operative where id=$1", [f.area])
  ).rows[0].nome;
  const area = page.getByRole("combobox").filter({ hasText: areaAName });
  await area.click();
  const filtered = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/consegne" &&
      new URL(r.url()).searchParams.get("areaOperativaId") === String(areaB),
  );
  // Radix typeahead selects the named Area even in a long, scrollable list.
  await page.keyboard.type(areaBName);
  await expect(
    page.getByRole("option", { name: areaBName, exact: true }),
  ).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("Enter");
  expect((await filtered).status()).toBe(200);
  if (tablet)
    await page
      .getByRole("dialog", { name: "Filtri consegne", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click();
  await expect(page).toHaveURL(new RegExp(`area=${areaB}`));
  expect(new URL(page.url()).searchParams.has("centro")).toBe(false);
  await expect(record()).toHaveCount(0);
  await page.goBack();
  await expect(record()).toBeVisible();
  await page.goForward();
  await expect(record()).toHaveCount(0);
  await page.goto(
    `/consegne?area=${f.area}&centro=${centreA.id}&tab=consegne&dal=2000-01-01&al=2100-12-31`,
  );
  for (const count of [51, 101]) {
    if (count === 101) await addPeople(51, 101);
    await page
      .getByRole("button", { name: "Pianifica Consegna", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const before = (
      await pool.query(
        "select (select count(*) from consegne)::int c,(select count(*) from movimenti)::int m",
      )
    ).rows[0];
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/consegne/beneficiario-da-codice",
    );
    await dialog
      .getByPlaceholder("Scansiona o digita il codice…")
      .fill(codes[0]);
    await dialog
      .getByPlaceholder("Scansiona o digita il codice…")
      .press("Enter");
    expect((await response).status()).toBe(200);
    await expect(
      dialog.getByRole("combobox", { name: "Beneficiario", exact: true }),
    ).toContainText("FuoriPagina0");
    expect(
      (
        await pool.query(
          "select (select count(*) from consegne)::int c,(select count(*) from movimenti)::int m",
        )
      ).rows[0],
    ).toEqual(before);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
});

test("M67-08/09 real ledger quantities and civil dates in UI and XLSX", async ({
  page,
}, testInfo) => {
  const f = await m67aMensaFixture(),
    scope = newScope();
  const product = await createProdotto(scope, {
    unitaMisura: "kg",
    quantitaFrazionabile: true,
  });
  const load = await db.transaction((tx) =>
    createWarehouseLoad(tx, {
      magazzinoId: f.origin,
      origineCarico: "DONAZIONE",
      dataCarico: "2026-03-29",
      creatoDa: f.users.admin.id,
      righe: [
        {
          prodottoId: product,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "10.123456",
        },
      ],
    }),
  );
  for (const delta of ["1.000001", "-0.000001"])
    await db.transaction((tx) =>
      rettificaInventarialeConEsito(tx, {
        lottoId: load.righe[0].lotto.id,
        delta,
        causale: "inventario_fisico",
        motivazione: "Fixture M67B",
        dataMovimento: "2026-03-29",
        operatoreId: f.users.admin.id,
      }),
    );
  const snapshot = async () =>
    (
      await pool.query(
        "select (select jsonb_agg(m order by id) from movimenti m where prodotto_id=$1) m,(select jsonb_agg(l order by id) from lotti l where prodotto_id=$1) l",
        [product],
      )
    ).rows[0];
  const before = await snapshot();
  await login(page, f.users.mixed);
  await page.goto("/movimenti");
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: /10\.123456/ }) });
  await expect(row).toContainText("29/03/2026");
  await expect(row).toContainText("+ 10.123456");
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: /1\.000001/ }) }),
  ).toContainText("+");
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: /0\.000001/ }) }),
  ).toContainText("-");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta", exact: true }).click();
  await page.getByRole("menuitem", { name: /Excel/ }).click();
  const file = await download;
  const path = testInfo.outputPath("movimenti.xlsx");
  await file.saveAs(path);
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(readFileSync(path));
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[workbook.SheetNames[0]],
  );
  expect(
    rows.some(
      (r) =>
        r["Quantità"] === "10.123456" &&
        r["Data"] === "29/03/2026" &&
        r["Effetto fisico"] === "(+)",
    ),
  ).toBe(true);
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta", exact: true }).click();
  await page.getByRole("menuitem", { name: /PDF/ }).click();
  await (await pdfDownload).saveAs(testInfo.outputPath("movimenti.pdf"));
  expect(await snapshot()).toEqual(before);
});
