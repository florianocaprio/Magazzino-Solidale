import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { trasferimenti } from "../src/lib/i18n/namespaces/trasferimenti";
import { login } from "./helpers";

type SqlPool = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
};

type Transfer = { id: number; codice: string; stato: string; versione: number };
type Fixture = {
  originId: number;
  destinationId: number;
  productId: number;
  lotId: number;
};

let database: SqlPool;
const key = () => `m4b1-e2e-${randomUUID()}`;
const today = () => new Date().toISOString().slice(0, 10);

async function fixture(page: Page): Promise<Fixture> {
  const warehousesResponse = await page.request.get("/api/magazzini");
  const productsResponse = await page.request.get("/api/prodotti");
  expect(warehousesResponse.ok()).toBe(true);
  expect(productsResponse.ok()).toBe(true);
  const warehouses = (await warehousesResponse.json()) as Array<{
    id: number;
    nome: string;
  }>;
  const products = (await productsResponse.json()) as Array<{
    id: number;
    codice: string;
  }>;
  const originId = warehouses.find(
    (row) => row.nome === "Magazzino Demo Principale",
  )?.id;
  const destinationId = warehouses.find(
    (row) => row.nome === "Magazzino Demo Emporio",
  )?.id;
  const productId = products.find((row) => row.codice === "DEMO-PASTA-500")?.id;
  expect(originId).toBeTruthy();
  expect(destinationId).toBeTruthy();
  expect(productId).toBeTruthy();
  const lotsResponse = await page.request.get(
    `/api/lotti?magazzinoId=${originId}&prodottoId=${productId}`,
  );
  expect(lotsResponse.ok()).toBe(true);
  const lots = (await lotsResponse.json()) as Array<{
    id: number;
    disponibileReale: number;
  }>;
  const lotId = lots.find((row) => row.disponibileReale >= 2)?.id;
  expect(lotId).toBeTruthy();
  return {
    originId: originId!,
    destinationId: destinationId!,
    productId: productId!,
    lotId: lotId!,
  };
}

async function createTransfer(
  page: Page,
  data: Fixture,
  quantity: number,
): Promise<Transfer> {
  const response = await page.request.post("/api/trasferimenti", {
    data: {
      idempotencyKey: key(),
      magazzinoOrigineId: data.originId,
      magazzinoDestinoId: data.destinationId,
      dataRichiesta: today(),
      trasportatoreNome: "E2E M4B.1",
      righe: [
        {
          prodottoId: data.productId,
          lottoId: data.lotId,
          quantita: quantity,
          unitaMisura: "pz",
        },
      ],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Transfer;
}

async function openTransfer(page: Page, id: number) {
  await page.goto(`/bolle?documento=trasferimento%3A${id}`);
  const detail = page.getByRole("dialog", { name: /dettaglio trasferimento/i });
  await expect(detail).toBeVisible();
  return detail;
}

async function lotState(lotId: number) {
  const result = await database.query<{
    physical: string;
    committed: string;
    available: string;
  }>(
    `SELECT l.quantita_residua::text AS physical,
            COALESCE((SELECT sum(p.quantita) FROM prenotazioni_magazzino p
                      WHERE p.lotto_id=l.id AND p.stato='attiva'),0)::text AS committed,
            (l.quantita_residua - COALESCE((SELECT sum(p.quantita) FROM prenotazioni_magazzino p
                      WHERE p.lotto_id=l.id AND p.stato='attiva'),0))::text AS available
       FROM lotti l WHERE l.id=$1`,
    [lotId],
  );
  return result.rows[0];
}

test.describe("M4B.1 — azioni reali del dettaglio Trasferimento", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    if (!process.env.E2E_DATABASE_URL)
      throw new Error("E2E_DATABASE_URL required");
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    const db = await import("../../../lib/db/src/index.ts");
    database = db.pool as unknown as SqlPool;
  });
  test.afterAll(async () => database?.end());

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      ![
        "desktop-1440x900",
        "tablet-portrait-768x1024",
        "tablet-landscape-1024x768",
      ].includes(testInfo.project.name),
      "Lifecycle mutanti pertinenti al desktop e ai tablet emulati",
    );
    await login(page);
  });

  test("preparazione insufficiente non riserva; annullamento di Pronto ripristina solo il disponibile", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const data = await fixture(page);
    const before = await lotState(data.lotId);
    const insufficient = await createTransfer(
      page,
      data,
      Number(before.available) + 1,
    );
    const insufficientDetail = await openTransfer(page, insufficient.id);
    const failedResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/trasferimenti/${insufficient.id}/prepara`) &&
        response.request().method() === "POST",
    );
    await insufficientDetail
      .getByRole("button", { name: /segna pronto/i })
      .click();
    expect((await failedResponse).status()).toBe(409);
    expect(await lotState(data.lotId)).toEqual(before);
    const failedRows = await database.query(
      "SELECT id FROM prenotazioni_magazzino WHERE trasferimento_id=$1",
      [insufficient.id],
    );
    expect(failedRows.rows).toHaveLength(0);

    const valid = await createTransfer(page, data, 1);
    const detail = await openTransfer(page, valid.id);
    const readyResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/trasferimenti/${valid.id}/prepara`) &&
        response.request().method() === "POST",
    );
    await detail.getByRole("button", { name: /segna pronto/i }).click();
    expect((await readyResponse).status()).toBe(200);
    const prepared = await lotState(data.lotId);
    expect(Number(prepared.physical)).toBe(Number(before.physical));
    expect(Number(prepared.available)).toBe(Number(before.available) - 1);
    const cancelResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/trasferimenti/${valid.id}/annulla`) &&
        response.request().method() === "POST",
    );
    page.once("dialog", (dialog) => dialog.accept("Annullamento E2E M4B.1"));
    await detail.getByRole("button", { name: /^annulla$/i }).click();
    expect((await cancelResponse).status()).toBe(200);
    expect(await lotState(data.lotId)).toEqual(before);
    const rows = await database.query<{ stato: string }>(
      "SELECT stato FROM prenotazioni_magazzino WHERE trasferimento_id=$1",
      [valid.id],
    );
    expect(rows.rows.map((row) => row.stato)).toEqual(["rilasciata"]);
  });

  test("risposta persa su Pronto e Avvia: la UI ritenta con la stessa intenzione e scarica una sola volta", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const data = await fixture(page);
    const transfer = await createTransfer(page, data, 1);
    const detail = await openTransfer(page, transfer.id);
    const before = await lotState(data.lotId);

    async function lostResponseRetry(
      suffix: "prepara" | "avvia",
      buttonName: RegExp,
    ) {
      let firstBody: unknown;
      let secondBody: unknown;
      let attempts = 0;
      const path = `**/api/trasferimenti/${transfer.id}/${suffix}`;
      await page.route(path, async (route) => {
        attempts += 1;
        if (attempts === 1) {
          firstBody = route.request().postDataJSON();
          const committed = await route.fetch();
          expect(committed.status()).toBe(200);
          await route.abort("failed");
        } else {
          secondBody = route.request().postDataJSON();
          await route.continue();
        }
      });
      await detail.getByRole("button", { name: buttonName }).click();
      await expect(
        page.getByText("Impossibile aggiornare il trasferimento").last(),
      ).toBeVisible();
      const replayResponse = page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(`/api/trasferimenti/${transfer.id}/${suffix}`) &&
          response.request().method() === "POST" &&
          response.status() === 200,
      );
      await detail.getByRole("button", { name: buttonName }).click();
      await replayResponse;
      expect(attempts).toBe(2);
      expect(secondBody).toEqual(firstBody);
      await page.unroute(path);
    }

    await lostResponseRetry("prepara", /segna pronto/i);
    const prepared = await lotState(data.lotId);
    expect(Number(prepared.physical)).toBe(Number(before.physical));
    expect(Number(prepared.available)).toBe(Number(before.available) - 1);
    await expect(
      detail.getByRole("button", { name: /^avvia$/i }),
    ).toBeVisible();
    await lostResponseRetry("avvia", /^avvia$/i);
    const after = await lotState(data.lotId);
    expect(Number(after.physical)).toBe(Number(before.physical) - 1);
    const movements = await database.query<{ id: number }>(
      "SELECT id FROM movimenti WHERE trasferimento_id=$1 AND tipo_dettaglio='uscita'",
      [transfer.id],
    );
    expect(movements.rows).toHaveLength(1);
    const reservations = await database.query<{ stato: string }>(
      "SELECT stato FROM prenotazioni_magazzino WHERE trasferimento_id=$1",
      [transfer.id],
    );
    expect(reservations.rows.map((row) => row.stato)).toEqual([
      "convertita_in_trasferimento",
    ]);
  });

  test("nuove azioni Pronto in sei lingue e direzione RTL senza overflow", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const data = await fixture(page);
    const transfer = await createTransfer(page, data, 1);
    for (const language of ["it", "es", "en", "fr", "de", "ar"] as const) {
      await page.evaluate(
        (value) => localStorage.setItem("ms-lang", value),
        language,
      );
      const detail = await openTransfer(page, transfer.id);
      await expect(
        detail.getByRole("button", {
          name: trasferimenti[language].segnaPronto,
        }),
      ).toBeVisible();
      expect(await page.locator("html").getAttribute("lang")).toBe(language);
      expect(await page.locator("html").getAttribute("dir")).toBe(
        language === "ar" ? "rtl" : "ltr",
      );
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `Overflow in lingua ${language}`).toBeLessThanOrEqual(1);
    }
  });

  test("profili reali Mensa/Magazzino: richiesta, partenza autorizzata dall'origine e ricezione", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-1440x900",
      "Profilo Mensa reale verificato sul desktop; le azioni comuni sono già coperte sui tablet",
    );
    test.setTimeout(150_000);
    const data = await fixture(page);
    const mensaWarehouse = await database.query<{
      id: number;
      area_id: number;
    }>(
      `INSERT INTO magazzini (codice, nome, tipo_magazzino, area_operativa_id)
       SELECT $1, 'Magazzino Mensa E2E', 'mensa', area_operativa_id
       FROM magazzini WHERE id=$2
       RETURNING id, area_operativa_id AS area_id`,
      [`M4B1-MG-${randomUUID().slice(0, 8)}`, data.originId],
    );
    expect(mensaWarehouse.rows).toHaveLength(1);
    const mensa = await database.query<{
      id: number;
      warehouse_id: number;
      area_id: number;
    }>(
      `INSERT INTO mense (codice, nome, area_operativa_id, magazzino_id, created_by)
       SELECT $1, 'Mensa E2E M4B.1', $2, $3, id
       FROM utenti WHERE username='sadmin'
       RETURNING id, magazzino_id AS warehouse_id, area_operativa_id AS area_id`,
      [
        `M4B1-MENSA-${randomUUID().slice(0, 8)}`,
        mensaWarehouse.rows[0].area_id,
        mensaWarehouse.rows[0].id,
      ],
    );
    expect(mensa.rows).toHaveLength(1);
    const mensaProduct = await database.query<{ id: number }>(
      "INSERT INTO prodotti (codice,nome,tipo_prodotto,unita_misura) VALUES ($1,'Prodotto Mensa E2E','alimentare','pz') RETURNING id",
      [`M4B1-MENSA-${randomUUID().slice(0, 8)}`],
    );
    await database.query(
      `INSERT INTO lotti (lotto_logico_id,prodotto_id,data_carico,quantita_caricata,quantita_residua,magazzino_id)
       VALUES ((SELECT id FROM lotti_logici WHERE area_operativa_id=$1 AND is_generale=true),$2,$3,3,3,$4)`,
      [mensa.rows[0].area_id, mensaProduct.rows[0].id, today(), data.originId],
    );
    const roleName = `M4B1 Mensa E2E ${randomUUID().slice(0, 8)}`;
    const username = `m4b1_mensa_${randomUUID().slice(0, 12)}`;
    const role = await database.query<{ id: number }>(
      "INSERT INTO ruoli (nome, aree, permessi, is_admin) VALUES ($1,$2::jsonb,$3::jsonb,false) RETURNING id",
      [
        roleName,
        JSON.stringify(["mensa"]),
        JSON.stringify([
          "mensa.view",
          "mensa.transfers.request",
          "mensa.transfers.receive",
        ]),
      ],
    );
    const user = await database.query<{ id: number }>(
      `INSERT INTO utenti (username,password_hash,nome,ruolo_id,area_operativa_id,attivo,must_change_password)
       SELECT $1,password_hash,'E2E Mensa',$2,$3,true,false FROM utenti WHERE username='sadmin' RETURNING id`,
      [username, role.rows[0].id, mensa.rows[0].area_id],
    );
    expect(user.rows).toHaveLength(1);
    const mensaContext = await browser.newContext();
    try {
      const mensaPage = await mensaContext.newPage();
      await mensaPage.goto("/login");
      await mensaPage.getByLabel(/username|nome utente/i).fill(username);
      await mensaPage.getByLabel(/^password$/i).fill(process.env.E2E_PASSWORD!);
      await mensaPage
        .getByRole("button", { name: /accedi|sign in|login/i })
        .click();
      await expect(mensaPage).toHaveURL(/\/$/);
      const created = await mensaPage.request.post("/api/mensa/trasferimenti", {
        data: {
          mensaId: mensa.rows[0].id,
          magazzinoOrigineId: data.originId,
          dataRichiesta: today(),
          idempotencyKey: key(),
          righe: [{ prodottoId: mensaProduct.rows[0].id, quantita: 1 }],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const transfer = (await created.json()) as Transfer;
      await mensaPage.goto("/mensa/trasferimenti");
      const mensaRow = mensaPage.getByRole("row", {
        name: new RegExp(transfer.codice),
      });
      await expect(mensaRow).toBeVisible();
      expect(
        await mensaRow.getByRole("button", { name: /segna pronto/i }).count(),
      ).toBe(0);
      expect(
        await mensaRow.getByRole("button", { name: /^avvia$/i }).count(),
      ).toBe(0);
      const forbiddenPrepare = await mensaPage.request.post(
        `/api/trasferimenti/${transfer.id}/prepara`,
        { data: { idempotencyKey: key(), versione: transfer.versione } },
      );
      expect(forbiddenPrepare.status()).toBe(403);
      const forbiddenBolle = await mensaPage.request.get("/api/bolle");
      expect(forbiddenBolle.status()).toBe(403);

      await page.goto("/mensa/trasferimenti");
      const originRow = page.getByRole("row", {
        name: new RegExp(transfer.codice),
      });
      await originRow.getByRole("button", { name: /segna pronto/i }).click();
      await expect(
        originRow.getByRole("button", { name: /^avvia$/i }),
      ).toBeVisible();
      await originRow.getByRole("button", { name: /^avvia$/i }).click();
      await expect(originRow.getByText(/in transito/i)).toBeVisible();
      await mensaPage.reload();
      const arrivedRow = mensaPage.getByRole("row", {
        name: new RegExp(transfer.codice),
      });
      await expect(
        arrivedRow.getByRole("button", { name: /^conferma$/i }),
      ).toBeVisible();
      await arrivedRow.getByRole("button", { name: /^conferma$/i }).click();
      await expect(arrivedRow.getByText(/completato/i)).toBeVisible();
      const final = await database.query<{ stato: string }>(
        "SELECT stato FROM trasferimenti WHERE id=$1",
        [transfer.id],
      );
      expect(final.rows[0].stato).toBe("completato");
    } finally {
      await mensaContext.close();
    }
  });
});
