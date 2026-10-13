import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { selectOption, assertViewportSafe } from "./helpers";

test("Mensa → richiesta → Magazzino → fornitura 12/20 → ricezione; diretto senza richiesta", async ({
  browser,
}, testInfo) => {
  const url = new URL(process.env.E2E_DATABASE_URL ?? "");
  expect(process.env.M5C1_TEST_DISPOSABLE_DB).toBe("verified");
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.port).toBe("58461");
  expect(url.pathname).toBe("/m61_e2e");
  process.env.DATABASE_URL = url.href;
  const { pool: template } = await import("../../../lib/db/src/index.ts");
  const Pool = template.constructor as new (options: {
    connectionString: string;
  }) => typeof template;
  const pool = new Pool({ connectionString: url.href });
  const bcrypt = (
    await import("../../../artifacts/api-server/node_modules/bcryptjs/index.js")
  ).default;
  const suffix = randomUUID().slice(0, 8),
    password = `Synthetic-${randomUUID()}-1!`;
  const options = {
    baseURL: testInfo.project.use.baseURL,
    viewport: testInfo.project.use.viewport,
    hasTouch: testInfo.project.use.hasTouch,
  };
  const mensaContext = await browser.newContext(options),
    warehouseContext = await browser.newContext(options);
  const mensaPage = await mensaContext.newPage(),
    warehousePage = await warehouseContext.newPage();
  const errors: string[] = [];
  for (const page of [mensaPage, warehousePage])
    page.on("pageerror", (e) => errors.push(e.message));
  try {
    const area = (
      await pool.query(
        "insert into aree_operative(nome) values($1) returning id",
        [`MM Area ${suffix}`],
      )
    ).rows[0].id;
    // Canonical Area creation also creates its General logical lot (no legacy stock backfill).
    await pool.query(
      "insert into lotti_logici(area_operativa_id,codice,descrizione,is_generale) values($1,'GENERALE','Generale',true)",
      [area],
    );
    const origin = (
      await pool.query(
        "insert into magazzini(codice,nome,area_operativa_id) values($1,$2,$3) returning id",
        [`MMO-${suffix}`, `Origine ${suffix}`, area],
      )
    ).rows[0].id;
    const destination = (
      await pool.query(
        "insert into magazzini(codice,nome,area_operativa_id,tipo_magazzino) values($1,$2,$3,'mensa') returning id",
        [`MMD-${suffix}`, `Mensa ${suffix}`, area],
      )
    ).rows[0].id;
    const requestedWarehouse = (
      await pool.query(
        "insert into magazzini(codice,nome,area_operativa_id) values($1,$2,$3) returning id",
        [`MMR-${suffix}`, `Preferito ${suffix}`, area],
      )
    ).rows[0].id;
    const mensa = (
      await pool.query(
        "insert into mense(codice,nome,area_operativa_id,magazzino_id) values($1,$2,$3,$4) returning id",
        [`MEN-MAG-${destination}`, `Mensa ${suffix}`, area, destination],
      )
    ).rows[0].id;
    const product = (
      await pool.query(
        "insert into prodotti(codice,nome,tipo_prodotto,unita_misura,quantita_frazionabile) values($1,$2,'alimentare','kg',true) returning id",
        [`MMP-${suffix}`, `Riso ${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      "insert into lotti(prodotto_id,magazzino_id,data_carico,data_scadenza,quantita_caricata,quantita_residua) values($1,$2,current_date,'2030-01-01',12,12)",
      [product, origin],
    );
    const warehouseGrants = [
      "richieste_magazzino.view",
      "richieste_magazzino.take",
      "richieste_magazzino.prepare",
      "magazzino.view",
      "magazzino.transfers.create",
      "magazzino.transfers.prepare",
      "magazzino.transfers.dispatch",
      "logistica.volontari.view",
    ];
    const mensaGrants = [
      "mensa.view",
      "mensa.transfers.request",
      "mensa.transfers.receive",
    ];
    const login = async (
      page: Page,
      kind: "mensa" | "magazzino",
      grants: string[],
    ) => {
      const role = (
        await pool.query(
          "insert into ruoli(nome,aree,permessi) values($1,$2,$3) returning id",
          [
            `MM ${kind} ${suffix}`,
            JSON.stringify([kind]),
            JSON.stringify(grants),
          ],
        )
      ).rows[0].id;
      const username = `mm_${kind}_${suffix}`;
      const user = (
        await pool.query(
          "insert into utenti(username,password_hash,nome,ruolo_id,area_operativa_id) values($1,$2,$3,$4,$5) returning id",
          [
            username,
            await bcrypt.hash(password, 4),
            `Operatore ${kind}`,
            role,
            area,
          ],
        )
      ).rows[0].id;
      if (kind === "mensa")
        await pool.query(
          "insert into utenti_mense(utente_id,mensa_id,assegnata_da) values($1,$2,$1)",
          [user, mensa],
        );
      await page.goto("/login");
      await page.getByLabel(/username|nome utente/i).fill(username);
      await page.getByLabel(/^password$/i).fill(password);
      await page.getByRole("button", { name: /accedi|login/i }).click();
      await expect(page).toHaveURL(/\/$/);
    };
    const counts = async () =>
      (
        await pool.query(
          "select (select count(*) from trasferimenti) transfers,(select count(*) from movimenti) movements,(select count(*) from prenotazioni_magazzino) reservations,(select count(*) from mensa_pasti) meals,(select count(*) from mensa_consumi) consumptions",
        )
      ).rows[0];
    const stock = async () =>
      (
        await pool.query(
          "select magazzino_id,sum(quantita_residua)::text qty from lotti where prodotto_id=$1 group by magazzino_id order by magazzino_id",
          [product],
        )
      ).rows;
    await login(mensaPage, "mensa", mensaGrants);
    await login(warehousePage, "magazzino", warehouseGrants);
    const before = await counts();
    await mensaPage.goto("/mensa/trasferimenti");
    await expect(
      mensaPage.getByRole("combobox", { name: "Area Operativa" }),
    ).toBeDisabled();
    await expect(
      mensaPage.getByRole("combobox", { name: "Mensa", exact: true }),
    ).toContainText(`Mensa ${suffix}`);
    await mensaPage
      .getByLabel("Descrizione delle esigenze", { exact: false })
      .fill("20 kg di riso e 10 litri di olio");
    await mensaPage
      .getByLabel("Magazzino di approvvigionamento richiesto", { exact: false })
      .selectOption(String(requestedWarehouse));
    const response = mensaPage.waitForResponse(
      (r) =>
        r.url().endsWith("/api/richieste-magazzino") &&
        r.request().method() === "POST",
    );
    await mensaPage
      .getByRole("button", { name: "Invia richiesta al Magazzino" })
      .click();
    const created = await response;
    expect(created.status(), await created.text()).toBe(201);
    const request = await created.json();
    expect(await counts()).toEqual(before);
    await expect(
      mensaPage.getByRole("heading", {
        name: "Richiesta inviata",
        exact: true,
      }),
    ).toBeVisible();
    await expect(mensaPage.locator("#mensa-needs")).toHaveCount(0);
    const requestArticle = mensaPage.getByRole("article", {
      name: request.codice,
      exact: true,
    });
    await expect(
      requestArticle.getByText("INVIATA", { exact: true }),
    ).toBeVisible();
    await expect(
      requestArticle.getByText("INVIATA", { exact: true }),
    ).toHaveClass(/bg-blue-50/);
    await assertViewportSafe(mensaPage);
    await mensaPage
      .getByRole("group", { name: "Area Operativa", exact: true })
      .click();
    await expect(
      mensaPage.getByRole("heading", {
        name: "Richiesta inviata",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(mensaPage.locator("#mensa-needs")).toBeVisible();
    await warehousePage.goto("/richieste-magazzino");
    await warehousePage
      .getByRole("button", { name: new RegExp(request.codice) })
      .click();
    const sheet = warehousePage.getByTestId("richiesta-sheet");
    await sheet
      .getByRole("button", { name: "Prendi in carico", exact: true })
      .click();
    await expect(sheet.locator("#rm-warehouse")).toBeVisible();
    await mensaPage.reload();
    await expect(
      requestArticle.getByText("PRESA IN CARICO", { exact: true }),
    ).toBeVisible();
    await expect(
      requestArticle.getByText("PRESA IN CARICO", { exact: true }),
    ).toHaveClass(/bg-amber-50/);
    await expect(sheet.locator("#rm-warehouse")).toHaveValue(
      String(requestedWarehouse),
    );
    await expect(
      sheet.getByText(
        `Magazzino di approvvigionamento richiesto: Preferito ${suffix}`,
        { exact: true },
      ),
    ).toBeVisible();
    expect(await counts()).toEqual(before);
    await sheet.locator("#rm-warehouse").selectOption(String(origin));
    await selectOption(
      warehousePage,
      sheet.getByRole("combobox", { name: "Prodotto 1", exact: true }),
      new RegExp(`Riso ${suffix}`),
    );
    await sheet.getByRole("spinbutton", { name: "Quantità 1" }).fill("12");
    await sheet
      .getByRole("button", { name: "Prepara documento", exact: true })
      .click();
    await expect(
      sheet.getByRole("button", { name: "Segna pronto", exact: true }),
    ).toBeVisible();
    const transfer = (
      await pool.query(
        "select id,codice from trasferimenti where magazzino_origine_id=$1",
        [origin],
      )
    ).rows[0];
    const preference = (
      await pool.query(
        "select magazzino_richiesto_id,magazzino_richiesto_nome_snapshot from richieste_magazzino where id=$1",
        [request.id],
      )
    ).rows[0];
    expect(preference.magazzino_richiesto_id).toBe(requestedWarehouse);
    expect(preference.magazzino_richiesto_nome_snapshot).toBe(
      `Preferito ${suffix}`,
    );
    await sheet
      .getByRole("button", { name: "Riassegna trasportatore", exact: true })
      .click();
    const carrier = warehousePage.getByRole("dialog", {
      name: "Riassegna trasportatore",
      exact: true,
    });
    await selectOption(
      warehousePage,
      carrier.getByRole("combobox", { name: "Trasportatore", exact: true }),
      "Altro…",
    );
    await carrier
      .getByPlaceholder("Nome del trasportatore")
      .fill("Trasporto sintetico");
    await carrier.getByRole("button", { name: /salva/i }).click();
    await expect(carrier).not.toBeVisible();
    await expect(
      sheet.getByRole("button", {
        name: "Riassegna trasportatore",
        exact: true,
      }),
    ).toContainText("Trasporto sintetico");
    await sheet
      .getByRole("button", { name: "Segna pronto", exact: true })
      .click();
    await expect(
      sheet.getByRole("button", { name: "Avvia", exact: true }),
    ).toBeVisible();
    expect((await stock()).find((r) => r.magazzino_id === origin).qty).toBe(
      "12.000000",
    );
    await sheet.getByRole("button", { name: "Avvia", exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await pool.query("select stato from trasferimenti where id=$1", [
              transfer.id,
            ])
          ).rows[0].stato,
      )
      .toBe("in_transito");
    await mensaPage.reload();
    const incoming = mensaPage.locator("article").filter({
      has: mensaPage.getByRole("heading", {
        name: new RegExp(transfer.codice),
      }),
    });
    await expect(incoming).toBeVisible();
    await expect(
      mensaPage.getByText("20 kg di riso e 10 litri di olio", { exact: true }),
    ).toBeVisible();
    await incoming.getByRole("button", { name: "Apri fornitura" }).click();
    const detail = mensaPage.getByRole("dialog", {
      name: "Fornitura effettiva",
    });
    await expect(
      detail.getByText(new RegExp(`Riso ${suffix}: 12 kg`)),
    ).toBeVisible();
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    const receiptResponse = mensaPage.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/trasferimenti/${transfer.id}/conferma`) &&
        r.request().method() === "POST",
    );
    await incoming.getByRole("button", { name: "Conferma ricezione" }).click();
    const receipt = await receiptResponse;
    expect(receipt.status(), await receipt.text()).toBe(200);
    await expect(incoming).toContainText("completato");
    await expect(
      requestArticle.getByText("COMPLETATA", { exact: true }),
    ).toBeVisible();
    await expect(
      requestArticle.getByText("COMPLETATA", { exact: true }),
    ).toHaveClass(/bg-emerald-50/);
    const final = await stock();
    expect(final.find((r) => r.magazzino_id === origin).qty).toBe("0.000000");
    expect(final.find((r) => r.magazzino_id === destination).qty).toBe(
      "12.000000",
    );
    const after = await counts();
    expect(after.meals).toBe(before.meals);
    expect(after.consumptions).toBe(before.consumptions);
    await warehousePage.reload();
    await expect(
      warehousePage.getByTestId("richiesta-sheet").getByText(/completato/i),
    ).toBeVisible();
    // A direct canonical transfer, without a request, must also be visible.
    const direct = await warehousePage.request.post("/api/trasferimenti", {
      data: {
        magazzinoOrigineId: origin,
        magazzinoDestinoId: destination,
        dataRichiesta: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Rome",
        }).format(new Date()),
        trasportatoreNome: "Diretto",
        righe: [{ prodottoId: product, quantita: 1, unitaMisura: "kg" }],
        idempotencyKey: randomUUID(),
      },
    });
    expect(direct.status(), await direct.text()).toBe(201);
    const directRow = await direct.json();
    await mensaPage.reload();
    await expect(
      mensaPage.getByRole("heading", { name: new RegExp(directRow.codice) }),
    ).toBeVisible();
    expect(
      Number(
        (
          await pool.query(
            "select count(*) from richieste_magazzino where mensa_id=$1",
            [mensa],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await mensaContext.close();
    await warehouseContext.close();
    await pool.end();
  }
});
