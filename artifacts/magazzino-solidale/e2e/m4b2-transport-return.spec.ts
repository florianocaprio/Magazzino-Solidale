import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { login } from "./helpers";

type SqlPool = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
};

type Document = { id: number; stato: string; versione: number };
type Fixture = {
  areaId: number;
  originId: number;
  destinationId: number;
  beneficiaryId: number;
  productId: number;
  lotId: number;
};

let database: SqlPool;
const key = () => `m4b2-e2e-${randomUUID()}`;
const today = () => new Date().toISOString().slice(0, 10);

async function json<T>(response: APIResponse, expected: number): Promise<T> {
  const body = await response.text();
  expect(response.status(), body).toBe(expected);
  return JSON.parse(body) as T;
}

async function fixture(page: Page): Promise<Fixture> {
  const [warehousesResponse, beneficiaryResponse, productsResponse] =
    await Promise.all([
      page.request.get("/api/magazzini"),
      page.request.get("/api/beneficiari?search=DEMO-BEN-001"),
      page.request.get("/api/prodotti"),
    ]);
  const warehouses = await json<
    Array<{ id: number; nome: string; areaOperativaId: number }>
  >(warehousesResponse, 200);
  const beneficiaries = await json<Array<{ id: number; codice: string }>>(
    beneficiaryResponse,
    200,
  );
  const products = await json<Array<{ id: number; codice: string }>>(
    productsResponse,
    200,
  );
  const origin = warehouses.find(
    (item) => item.nome === "Magazzino Demo Principale",
  );
  const destination = warehouses.find(
    (item) => item.nome === "Magazzino Demo Emporio",
  );
  const beneficiary = beneficiaries.find(
    (item) => item.codice === "DEMO-BEN-001",
  );
  const product = products.find((item) => item.codice === "DEMO-PASTA-500");
  expect(origin).toBeTruthy();
  expect(destination).toBeTruthy();
  expect(beneficiary).toBeTruthy();
  expect(product).toBeTruthy();
  const lots = await json<Array<{ id: number; disponibileReale: number }>>(
    await page.request.get(
      `/api/lotti?magazzinoId=${origin!.id}&prodottoId=${product!.id}`,
    ),
    200,
  );
  const sourceLot = lots[0];
  expect(sourceLot).toBeTruthy();
  const lotResult = await database.query<{ id: number }>(
    `INSERT INTO lotti (
       lotto_logico_id, prodotto_id, codice_lotto, codice_lotto_normalizzato,
       data_scadenza, data_carico, quantita_caricata, quantita_residua,
       magazzino_id, fse_plus, fondo_origine
     )
     SELECT lotto_logico_id, prodotto_id, $1, $1,
            '2030-12-31', $2, 10, 10, magazzino_id, fse_plus, fondo_origine
     FROM lotti WHERE id = $3 RETURNING id`,
    [`M4B2-E2E-${randomUUID().slice(0, 12)}`, today(), sourceLot.id],
  );
  expect(lotResult.rows).toHaveLength(1);
  return {
    areaId: origin!.areaOperativaId,
    originId: origin!.id,
    destinationId: destination!.id,
    beneficiaryId: beneficiary!.id,
    productId: product!.id,
    lotId: lotResult.rows[0].id,
  };
}

async function quantity(lotId: number): Promise<number> {
  const result = await database.query<{ amount: string }>(
    "SELECT quantita_residua::text AS amount FROM lotti WHERE id=$1",
    [lotId],
  );
  return Number(result.rows[0].amount);
}

async function createReadyBolla(
  page: Page,
  data: Fixture,
  amount: number,
  owner: "beneficiario" | "ente" = "beneficiario",
): Promise<Document> {
  let enteId: number | undefined;
  if (owner === "ente") {
    const result = await database.query<{ id: number }>(
      "INSERT INTO enti_destinatari (denominazione, indirizzo, area_operativa_id) VALUES ($1, $2, $3) RETURNING id",
      [`Ente M4B2 ${randomUUID().slice(0, 8)}`, "Via M4B2 1", data.areaId],
    );
    enteId = result.rows[0].id;
  }
  const draft = await json<Document>(
    await page.request.post("/api/bolle", {
      data: {
        idempotencyKey: key(),
        tipoDestinatario: owner,
        beneficiarioId: owner === "beneficiario" ? data.beneficiaryId : null,
        enteDestinatarioId: enteId ?? null,
        magazzinoId: data.originId,
      },
    }),
    201,
  );
  const row = await json<{ versioneBolla: number }>(
    await page.request.post(`/api/bolle/${draft.id}/righe`, {
      data: {
        idempotencyKey: key(),
        versione: draft.versione,
        prodottoId: data.productId,
        lottoId: data.lotId,
        quantita: amount,
        unitaMisura: "pz",
      },
    }),
    201,
  );
  return json<Document>(
    await page.request.post(`/api/bolle/${draft.id}/conferma`, {
      data: { idempotencyKey: key(), versione: row.versioneBolla },
    }),
    200,
  );
}

async function openBolla(page: Page, id: number) {
  await page.goto(`/bolle?documento=bolla%3A${id}`);
  const dialog = page.getByRole("dialog", { name: /dettaglio bolla/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function entrustBolla(page: Page, id: number) {
  const detail = await openBolla(page, id);
  await detail.getByRole("button", { name: /affida al trasporto/i }).click();
  const dialog = page.getByRole("dialog", { name: /affida al trasporto/i });
  await dialog
    .getByLabel(/trasportatore o incaricato/i)
    .fill("Incaricato M4B2 senza account");
  const response = page.waitForResponse(
    (item) =>
      item.url().endsWith(`/api/bolle/${id}/affida`) &&
      item.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: /conferma affidamento/i }).click();
  expect((await response).status()).toBe(200);
  await expect(detail).toContainText("In consegna");
  return detail;
}

test.describe("M4B.2 — browser, API e ledger su candidato reale", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    if (!process.env.E2E_DATABASE_URL)
      throw new Error("E2E_DATABASE_URL required");
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    const module = await import("../../../lib/db/src/index.ts");
    database = module.pool as unknown as SqlPool;
  });
  test.afterAll(async () => database?.end());
  test.beforeEach(async ({ page }, info) => {
    test.skip(
      info.project.name !== "desktop-1440x900",
      "I lifecycle mutanti M4B.2 girano una volta sul desktop",
    );
    await login(page);
  });

  test("Beneficiario: Affida → Conferma consegna senza secondo scarico", async ({
    page,
  }) => {
    const data = await fixture(page);
    const ready = await createReadyBolla(page, data, 2);
    const before = await quantity(data.lotId);
    const detail = await entrustBolla(page, ready.id);
    expect(await quantity(data.lotId)).toBe(before - 2);
    const response = page.waitForResponse(
      (item) =>
        item.url().endsWith(`/api/bolle/${ready.id}/consegna`) &&
        item.request().method() === "POST",
    );
    await detail.getByRole("button", { name: /conferma consegna/i }).click();
    expect((await response).status()).toBe(200);
    await expect(detail).toContainText("Consegnato");
    expect(await quantity(data.lotId)).toBe(before - 2);
    const movements = await database.query<{
      tipo_movimento: string;
      natura_contabile: string;
    }>(
      "SELECT tipo_movimento,natura_contabile FROM movimenti WHERE bolla_id=$1 ORDER BY id",
      [ready.id],
    );
    expect(movements.rows).toEqual([
      { tipo_movimento: "scarico", natura_contabile: "AFFIDAMENTO_TRASPORTO" },
      { tipo_movimento: "esito", natura_contabile: "DISTRIBUZIONE_FINALE" },
    ]);
  });

  test("Ente: Pronta → Affida → Conferma e nessuna distribuzione Beneficiario", async ({
    page,
  }) => {
    const data = await fixture(page);
    const ready = await createReadyBolla(page, data, 1, "ente");
    const before = await quantity(data.lotId);
    const detail = await entrustBolla(page, ready.id);
    await detail.getByRole("button", { name: /conferma consegna/i }).click();
    await expect(detail).toContainText("Consegnato");
    expect(await quantity(data.lotId)).toBe(before - 1);
    const rows = await database.query<{
      nature: string;
      distributions: string;
    }>(
      `SELECT (SELECT string_agg(natura_contabile, ',' ORDER BY id)
                 FROM movimenti WHERE bolla_id=$1) AS nature,
              (SELECT count(*)::text FROM operazioni_distribuzione_magazzino
                 WHERE entita_origine_tipo='bolla' AND entita_origine_id=$1) AS distributions`,
      [ready.id],
    );
    expect(rows.rows[0]).toEqual({
      nature: "AFFIDAMENTO_TRASPORTO,CONSEGNA_ENTE",
      distributions: "0",
    });
  });

  test("Mancata consegna: tutto idoneo rientra nel medesimo Magazzino", async ({
    page,
  }) => {
    const data = await fixture(page);
    const ready = await createReadyBolla(page, data, 2);
    const before = await quantity(data.lotId);
    const detail = await entrustBolla(page, ready.id);
    expect(await quantity(data.lotId)).toBe(before - 2);
    await detail.getByRole("button", { name: /mancata consegna/i }).click();
    const missed = page.getByRole("dialog", { name: /mancata consegna/i });
    await missed
      .getByLabel(/motivo obbligatorio/i)
      .fill("Destinatario assente");
    await missed
      .getByRole("button", { name: /conferma segnalazione/i })
      .click();
    await expect(detail).toContainText("Rientro atteso");
    await detail.getByRole("button", { name: /^registra rientro$/i }).click();
    const panel = page.getByRole("dialog", { name: /registra rientro merce/i });
    await panel.getByLabel(/^idonea$/i).fill("2");
    const response = page.waitForResponse(
      (item) =>
        item.url().endsWith(`/api/bolle/${ready.id}/rientro`) &&
        item.request().method() === "POST",
    );
    await panel.getByRole("button", { name: /conferma rientro/i }).click();
    expect((await response).status()).toBe(200);
    await expect(detail).toContainText("Rientro chiuso");
    expect(await quantity(data.lotId)).toBe(before);
    const result = await database.query<{
      warehouse: number;
      distribution: string;
    }>(
      `SELECT rt.magazzino_origine_id AS warehouse,
              (SELECT count(*)::text FROM operazioni_distribuzione_magazzino od
               WHERE od.entita_origine_tipo='bolla' AND od.entita_origine_id=$1) AS distribution
       FROM rientri_trasporto rt WHERE rt.bolla_id=$1`,
      [ready.id],
    );
    expect(result.rows[0]).toEqual({
      warehouse: data.originId,
      distribution: "0",
    });
  });

  test("Mancata consegna: il pannello impone 3/3 e documenta idonea, avariata e mancante", async ({
    page,
  }) => {
    const data = await fixture(page);
    const ready = await createReadyBolla(page, data, 3);
    const before = await quantity(data.lotId);
    const detail = await entrustBolla(page, ready.id);
    await detail.getByRole("button", { name: /mancata consegna/i }).click();
    const missed = page.getByRole("dialog", { name: /mancata consegna/i });
    await missed
      .getByLabel(/motivo obbligatorio/i)
      .fill("Destinatario assente");
    await missed
      .getByRole("button", { name: /conferma segnalazione/i })
      .click();
    await expect(detail).toContainText("Rientro atteso");
    await detail.getByRole("button", { name: /^registra rientro$/i }).click();
    const panel = page.getByRole("dialog", { name: /registra rientro merce/i });
    const confirm = panel.getByRole("button", { name: /conferma rientro/i });
    await expect(confirm).toBeDisabled();
    await panel.getByLabel(/^idonea$/i).fill("1");
    await panel.getByLabel(/^avariata$/i).fill("1");
    await expect(confirm).toBeDisabled();
    await panel.getByLabel(/^mancante$/i).fill("1");
    await expect(confirm).toBeEnabled();
    const response = page.waitForResponse(
      (item) =>
        item.url().endsWith(`/api/bolle/${ready.id}/rientro`) &&
        item.request().method() === "POST",
    );
    await confirm.click();
    expect((await response).status()).toBe(200);
    await expect(detail).toContainText("Rientro chiuso");
    expect(await quantity(data.lotId)).toBe(before - 2);
    await expect(
      detail.getByText(/documento automatico — merce avariata/i),
    ).toBeVisible();
    await expect(
      detail.getByText(/documento automatico — merce mancante/i),
    ).toBeVisible();
    const documents = await database.query<{
      tipo_esito: string;
      scarico_id: number | null;
    }>(
      "SELECT tipo_esito,scarico_id FROM rientro_trasporto_righe WHERE bolla_id=$1 ORDER BY id",
      [ready.id],
    );
    expect(documents.rows.map((row) => row.tipo_esito)).toEqual([
      "idonea",
      "deteriorata",
      "mancante",
    ]);
    expect(documents.rows[1].scarico_id).toBeTruthy();
    expect(documents.rows[2].scarico_id).toBeNull();
    const download = page.waitForEvent("download");
    await detail
      .getByRole("button", { name: /scarica documento pdf/i })
      .last()
      .click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/i);
  });

  test("Trasferimento: mancato arrivo → rientro origine, nessuna entrata destino", async ({
    page,
  }) => {
    const data = await fixture(page);
    const created = await json<Document>(
      await page.request.post("/api/trasferimenti", {
        data: {
          idempotencyKey: key(),
          magazzinoOrigineId: data.originId,
          magazzinoDestinoId: data.destinationId,
          dataRichiesta: today(),
          trasportatoreNome: "Incaricato M4B2",
          righe: [
            {
              prodottoId: data.productId,
              lottoId: data.lotId,
              quantita: 2,
              unitaMisura: "pz",
            },
          ],
        },
      }),
      201,
    );
    const before = await quantity(data.lotId);
    await page.goto(`/bolle?documento=trasferimento%3A${created.id}`);
    const detail = page.getByRole("dialog", {
      name: /dettaglio trasferimento/i,
    });
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: /segna pronto/i }).click();
    await expect(
      detail.getByRole("button", { name: /^avvia$/i }),
    ).toBeVisible();
    await detail.getByRole("button", { name: /^avvia$/i }).click();
    await expect(detail).toContainText(/in transito/i);
    expect(await quantity(data.lotId)).toBe(before - 2);
    await detail
      .getByRole("button", { name: /segnala mancato arrivo/i })
      .click();
    const missed = page.getByRole("dialog", {
      name: /segnala mancato arrivo/i,
    });
    await missed.getByLabel(/motivo obbligatorio/i).fill("Destinazione chiusa");
    await missed
      .getByRole("button", { name: /conferma segnalazione/i })
      .click();
    await expect(detail).toContainText("Rientro atteso");
    await detail.getByRole("button", { name: /^registra rientro$/i }).click();
    const panel = page.getByRole("dialog", { name: /registra rientro merce/i });
    await panel.getByLabel(/^idonea$/i).fill("2");
    await panel.getByRole("button", { name: /conferma rientro/i }).click();
    await expect(detail).toContainText("Rientro chiuso");
    expect(await quantity(data.lotId)).toBe(before);
    const arrival = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM movimenti WHERE trasferimento_id=$1 AND tipo_dettaglio='entrata'",
      [created.id],
    );
    expect(arrival.rows[0].count).toBe("0");
  });
});
