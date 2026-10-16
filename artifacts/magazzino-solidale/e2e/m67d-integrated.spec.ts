import { test, expect, type Page } from "@playwright/test";
import { m67aMensaFixture } from "../../api-server/tests/helpers/m67a-mensa-fixture";
import {
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createMagazzino,
  createProdotto,
  insertConsegna,
  insertBolla,
  insertBollaRiga,
  newScope,
} from "../../api-server/tests/scope-helpers";
import { db, pool } from "../../../lib/db/src/index";
import { updateModuloAmbiente } from "../../api-server/src/lib/configurazioneAmbiente";
import {
  createWarehouseLoad,
  rettificaInventarialeConEsito,
} from "../../api-server/src/lib/inventoryLedger";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  creaScaricoInventariale,
  stornaScaricoInventariale,
} from "../../api-server/src/lib/scaricoInventory";

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
test("M67-08 real transfer receipt, return, outcome and unload reversal in binary exports", async ({
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

  await login(page, f.users.admin);
  const destination = await createMagazzino(scope, null, {
    areaOperativaId: f.area,
  });
  async function command(
    id: number,
    suffix: string,
    versione: number,
    fields = {},
  ) {
    const result = await page.request.post(
      "/api/trasferimenti/" + id + "/" + suffix,
      { data: { versione, idempotencyKey: randomUUID(), ...fields } },
    );
    expect(result.status(), await result.text()).toBe(200);
    return result.json();
  }
  for (const receive of [true, false]) {
    const response = await page.request.post("/api/trasferimenti", {
      data: {
        idempotencyKey: randomUUID(),
        magazzinoOrigineId: f.origin,
        magazzinoDestinoId: destination,
        dataRichiesta: "2026-03-29",
        trasportatoreNome: "Sintetico D",
        righe: [{ prodottoId: product, quantita: "2", unitaMisura: "kg" }],
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    const created = await response.json(),
      prepared = await command(created.id, "prepara", created.versione),
      started = await command(created.id, "avvia", prepared.versione);
    if (receive) await command(created.id, "conferma", started.versione);
    else {
      const missing = await command(
        created.id,
        "mancato-arrivo",
        started.versione,
        { motivo: "Fixture sintetica" },
      );
      const preview = await (
        await page.request.get("/api/trasferimenti/" + created.id + "/rientro")
      ).json();
      await command(created.id, "rientro", missing.versione, {
        righe: [
          {
            movimentoUscitaId: preview.partite[0].movimentoUscitaId,
            idonea: "1",
            mancante: "1",
          },
        ],
      });
    }
  }
  const reference = "M67D-" + randomUUID().slice(0, 12);
  await db.transaction((tx) =>
    creaScaricoInventariale(tx, {
      codice: reference,
      documentoRiferimento: reference,
      magazzinoId: f.origin,
      centroAscoltoId: null,
      dataScarico: "2026-03-29",
      causale: "smaltimento",
      operatoreId: f.users.admin.id,
      righe: [{ prodottoId: product, quantita: "1", unitaMisura: "kg" }],
    }),
  );
  await db.transaction((tx) =>
    stornaScaricoInventariale(tx, {
      documentoRiferimento: reference,
      dataMovimento: "2026-03-29",
      operatoreId: f.users.admin.id,
      tipoDettaglio: "storno_scarico",
      note: "Fixture D",
    }),
  );

  // E-FIX-03: a true M4 Bolla reversal, not the differently typed legacy
  // unload compensation above. All physical effects are written by M4.
  await updateModuloAmbiente("BOLLE", true, null);
  const person = await createBeneficiario(scope, null, {
    areaOperativaId: f.area,
  });
  const bolla = await insertBolla(scope, {
    beneficiarioId: person,
    magazzinoId: f.origin,
  });
  const bollaRow = await insertBollaRiga(scope, {
    bollaId: bolla,
    prodottoId: product,
    quantita: 1,
    unitaMisura: "kg",
  });
  for (const [action, extra] of [
    ["conferma", {}],
    ["consegna", { confermaRicezione: true }],
    [
      "storno-amministrativo",
      { motivo: "Storno sintetico E", rigaIds: [bollaRow] },
    ],
  ] as const) {
    const version = (
      await pool.query("select versione from bolle where id=$1", [bolla])
    ).rows[0].versione;
    const response = await page.request.post(`/api/bolle/${bolla}/${action}`, {
      data: { versione: version, idempotencyKey: randomUUID(), ...extra },
    });
    expect(response.status(), await response.text()).toBe(200);
  }

  const snapshot = async () =>
    (
      await pool.query(
        "select (select jsonb_agg(m order by id) from movimenti m where prodotto_id=$1) m,(select jsonb_agg(l order by id) from lotti l where prodotto_id=$1) l",
        [product],
      )
    ).rows[0];
  const before = await snapshot();

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

  const oracle = (
    await pool.query(
      "select m.*,o.tipo_movimento original_type from movimenti m left join movimenti o on o.id=m.movimento_origine_id where m.prodotto_id=$1 order by m.id",
      [product],
    )
  ).rows;
  const name = (
    await pool.query("select nome from prodotti where id=$1", [product])
  ).rows[0].nome;
  const actual = rows.filter((r) => r["Prodotto"] === name);
  expect(
    oracle.some(
      (m) => m.tipo_movimento === "storno" && m.original_type === "scarico",
    ),
  ).toBe(true);
  expect(actual).toHaveLength(oracle.length);
  const expected = oracle.map((m) => ({
    quantity: m.quantita,
    sign:
      m.tipo_movimento === "esito"
        ? "0: Nessuna variazione fisica"
        : m.tipo_movimento === "scarico" ||
            m.tipo_movimento === "rettifica_negativa" ||
            (m.tipo_movimento === "trasferimento" &&
              m.tipo_dettaglio === "uscita")
          ? "(-)"
          : "(+)",
  }));
  expect(
    actual
      .map((r) => ({ quantity: r["Quantità"], sign: r["Effetto fisico"] }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ).toEqual(
    expected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
  await testInfo.attach("ledger-oracle", {
    body: JSON.stringify({ product: name, oracle }),
    contentType: "application/json",
  });

  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta", exact: true }).click();
  await page.getByRole("menuitem", { name: /PDF/ }).click();
  await (await pdfDownload).saveAs(testInfo.outputPath("movimenti.pdf"));
  expect(await snapshot()).toEqual(before);
});
async function login(
  page: Page,
  account: { username: string; password: string },
) {
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(account.username);
  await page.getByLabel(/^password$/i).fill(account.password);
  await page.getByRole("button", { name: /accedi|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

for (const change of ["logout", "different-user"] as const) {
  test(`M67-35/37 pending real export cannot download after ${change} in another tab`, async ({
    page,
    context,
  }) => {
    const f = await m67aMensaFixture();
    await db.transaction((tx) =>
      createWarehouseLoad(tx, {
        magazzinoId: f.origin,
        origineCarico: "DONAZIONE",
        dataCarico: "2026-03-29",
        creatoDa: f.users.admin.id,
        righe: [
          {
            prodottoId: f.product,
            fondoOrigine: "NESSUN_FONDO",
            quantitaOperativa: "1.000001",
          },
        ],
      }),
    );
    await login(page, f.users.warehouse);
    await page.goto("/movimenti");
    await expect(
      page.getByRole("button", { name: "Esporta", exact: true }),
    ).toBeEnabled();
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const captured = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const downloads: string[] = [];
    page.on("download", (download) =>
      downloads.push(download.suggestedFilename()),
    );
    await page.route("**/api/movimenti/export*", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect((await response.json()).length).toBeGreaterThan(0);
      reached();
      await held;
      await route.fulfill({ response });
    });
    const other = await context.newPage();
    try {
      await page.getByRole("button", { name: "Esporta", exact: true }).click();
      await page.getByRole("menuitem", { name: /Excel/ }).click();
      await captured;
      expect((await other.request.post("/api/auth/logout")).status()).toBe(204);
      if (change === "different-user") {
        const next = await m67aMensaFixture();
        await login(other, next.users.warehouse);
      }
      release();
      // The visual notification is the completion barrier: no sleep or negative
      // timeout is used to infer that an asynchronous export has terminated.
      await expect(
        page.getByRole("region", { name: "Notifications (F8)", exact: true }),
      ).toContainText("Esportazione non completata");
      expect(downloads).toEqual([]);
      expect((await other.request.get("/api/auth/me")).status()).toBe(
        change === "logout" ? 401 : 200,
      );
    } finally {
      release();
      await other.close();
    }
  });
}

test("M67-04 Area all Centres, page 2 and complete binary export match the database", async ({
  page,
}, testInfo) => {
  const f = await m67aMensaFixture(),
    scope = newScope();
  for (const module of ["CONSEGNE", "CENTRO_ASCOLTO"])
    await updateModuloAmbiente(module, true, null);
  await pool.query("update utenti set area_operativa_id=null where id=$1", [
    f.users.admin.id,
  ]);
  const areaB = await createAreaOperativa(scope);
  const sets = [];
  for (const area of [f.area, areaB]) {
    const centres = await Promise.all([
      createCentroRec(scope, { areaOperativaId: area }),
      createCentroRec(scope, { areaOperativaId: area }),
    ]);
    const warehouse = await createMagazzino(scope, null, {
      areaOperativaId: area,
    });
    const people = await Promise.all(
      centres.map((c) =>
        createBeneficiario(scope, c.id, { areaOperativaId: area }),
      ),
    );
    const ids = [];
    for (let n = 0; n < 27; n++)
      ids.push(
        await insertConsegna(scope, {
          beneficiarioId: people[n % 2],
          magazzinoId: warehouse,
        }),
      );
    const civilDates = [
      "2026-01-01",
      "2026-03-08",
      "2026-03-29",
      "2026-06-01",
      "2026-10-25",
      "2026-11-01",
      "2026-12-31",
    ];
    for (let n = 0; n < ids.length; n++)
      await pool.query("update consegne set data_prevista=$1 where id=$2", [
        civilDates[n % civilDates.length],
        ids[n],
      ]);
    sets.push({ area, ids });
  }
  await login(page, f.users.admin);
  for (const set of sets) {
    const oracle = (
      await pool.query(
        "select id,codice,data_prevista::text civil_date from consegne where id=any($1) order by id",
        [set.ids],
      )
    ).rows;
    const initial = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/consegne" &&
        new URL(r.url()).searchParams.get("areaOperativaId") ===
          String(set.area),
    );
    await page.goto(
      "/consegne?area=" +
        set.area +
        "&tab=consegne&dal=2000-01-01&al=2100-12-31",
    );
    const first = await (await initial).json();
    expect(first.total).toBe(27);
    expect(first.items).toHaveLength(25);
    const next = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/consegne" &&
        new URL(r.url()).searchParams.get("page") === "2",
    );
    await page.getByRole("button", { name: "Successiva", exact: true }).click();
    const last = await (await next).json();
    expect(last.items).toHaveLength(2);
    expect(
      [...first.items, ...last.items].map((x) => x.id).sort((a, b) => a - b),
    ).toEqual(oracle.map((x) => x.id));
    for (const row of last.items) {
      await expect(
        page
          .getByTestId(
            page.viewportSize()!.width < 1024
              ? "consegne-mobile-list"
              : "consegne-desktop-list",
          )
          .getByText(row.codice, { exact: true }),
      ).toBeVisible();
      const [year, month, day] = oracle
        .find((o) => o.id === row.id)!
        .civil_date.split("-");
      const displayed =
        page.viewportSize()!.width < 1024
          ? page
              .getByTestId("consegne-mobile-list")
              .locator(`article[data-consegna-id="${row.id}"]`)
          : page
              .getByTestId("consegne-desktop-list")
              .getByRole("row")
              .filter({ has: page.getByText(row.codice, { exact: true }) });
      await expect(displayed).toContainText(`${day}/${month}/${year}`);
    }
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Esporta", exact: true }).click();
    await page.getByRole("menuitem", { name: /Excel/ }).click();
    const path = testInfo.outputPath("consegne-" + set.area + ".xlsx");
    await (await download).saveAs(path);
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(readFileSync(path));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[workbook.SheetNames[0]],
    );
    expect(rows.map((x) => x["Codice"]).sort()).toEqual(
      oracle.map((x) => x.codice).sort(),
    );
    // E-FIX-02: independent SQL DATE oracle includes month/year and both DST
    // boundaries. It is not derived from the application's formatter.
    for (const row of rows) {
      const date = oracle.find((o) => o.codice === row["Codice"])!.civil_date;
      const [year, month, day] = date.split("-");
      expect(row["Data Prevista"]).toBe(`${day}/${month}/${year}`);
    }
    await testInfo.attach(`civil-date-oracle-${set.area}`, {
      body: JSON.stringify(oracle),
      contentType: "application/json",
    });
    const pdf = page.waitForEvent("download");
    await page.getByRole("button", { name: "Esporta", exact: true }).click();
    await page.getByRole("menuitem", { name: /PDF/ }).click();
    await (
      await pdf
    ).saveAs(testInfo.outputPath("consegne-" + set.area + ".pdf"));
  }
});
