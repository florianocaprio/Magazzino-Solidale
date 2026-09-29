import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { login, selectOption } from "./helpers";

type Named = { id: number; nome: string };
type Mensa = Named & { codice: string };
let r2DatabasePool: { end(): Promise<void> } | undefined;

test.afterAll(async () => {
  await r2DatabasePool?.end();
});

test("Mensa autorizza una persona temporanea, registra il pasto e rende il replay idempotente", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440x900",
    "Il lifecycle mutante gira una volta; la matrice viewport è coperta separatamente",
  );
  await login(page);

  const [areasResponse, centersResponse, canteensResponse] = await Promise.all([
    page.request.get("/api/aree-operative"),
    page.request.get("/api/centri-ascolto"),
    page.request.get("/api/mensa/mense"),
  ]);
  const area = ((await areasResponse.json()) as Named[]).find(
    (item) => item.nome === "Area Demo",
  )!;
  const center = ((await centersResponse.json()) as Named[]).find(
    (item) => item.nome === "Centro di Ascolto Demo",
  )!;
  let canteen = ((await canteensResponse.json()) as Mensa[]).find(
    (item) => item.codice === "MEN-E2E-OPERATIVA",
  );
  if (!canteen) {
    const response = await page.request.post("/api/mensa/mense", {
      data: {
        codice: "MEN-E2E-OPERATIVA",
        nome: "Mensa E2E Operativa",
        areaOperativaId: area.id,
        centroAscoltoId: center.id,
        indirizzo: "Via Sintetica 1",
        comune: "Roma",
        note: "Fixture sintetica Playwright",
      },
    });
    expect(response.status()).toBe(201);
    canteen = (await response.json()) as Mensa;
  }

  const suffix = randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)
    .replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));
  await page.goto("/mensa/postazione");
  await selectOption(
    page,
    page.getByRole("combobox", { name: /^mensa$/i }),
    "Mensa E2E Operativa",
  );
  await page
    .getByRole("button", { name: /nuova persona.*accesso temporaneo/i })
    .click();
  await page.getByLabel(/^nome$/i).fill(`U${suffix}`);
  await page.getByLabel(/^cognome$/i).fill(`V${suffix}`);

  await selectOption(
    page,
    page.getByRole("combobox", { name: /^sesso$/i }),
    "Altro",
  );
  await selectOption(
    page,
    page.getByRole("combobox", { name: /fascia d'età presunta/i }),
    "30–64",
  );
  await page
    .getByLabel(/motivazione/i)
    .fill("Autorizzazione temporanea operativa E2E");

  const temporaryAccessPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/mensa/accessi/temporaneo") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: /verifica e autorizza per oggi/i })
    .click();
  let temporaryAccessResponse = await temporaryAccessPromise;
  if (temporaryAccessResponse.status() === 409) {
    expect(
      (await temporaryAccessResponse.json()).possibiliDuplicati?.length,
    ).toBeGreaterThan(0);
    const confirmed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/mensa/accessi/temporaneo") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: /persona diversa e crea comunque/i })
      .click();
    temporaryAccessResponse = await confirmed;
  }
  expect(
    temporaryAccessResponse.status(),
    await temporaryAccessResponse.text(),
  ).toBe(201);
  const access = (await temporaryAccessResponse.json()) as {
    id: number;
    beneficiarioId: number;
    esito: string;
  };
  expect(access.esito).not.toBe("negato");
  await expect(page.getByRole("status")).toContainText(/accesso consentito/i);

  const mealPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/mensa/pasti") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /registra pasto/i }).click();
  const mealResponse = await mealPromise;
  expect(mealResponse.status()).toBe(201);
  const mealRequest = mealResponse.request().postDataJSON() as {
    accessoMensaId: number;
    tipoServizio: string;
    idempotencyKey: string;
  };
  const meal = (await mealResponse.json()) as {
    id: number;
    beneficiarioId: number;
  };
  expect(meal).toMatchObject({
    beneficiarioId: access.beneficiarioId,
  });
  await expect(
    page.getByText("Pasto registrato", { exact: true }),
  ).toBeVisible();

  const replay = await page.request.post("/api/mensa/pasti", {
    data: mealRequest,
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toMatchObject({
    id: meal.id,
    idempotentReplay: true,
  });
  const listResponse = await page.request.get(
    `/api/mensa/pasti?mensaId=${canteen.id}`,
  );
  expect(listResponse.ok()).toBe(true);
  const meals = (await listResponse.json()) as Array<{
    id: number;
    beneficiarioId: number;
  }>;
  expect(
    meals.filter((item) => item.beneficiarioId === access.beneficiarioId),
  ).toEqual([expect.objectContaining({ id: meal.id })]);
});

test("R2-04: rifornimento Mensa sceglie un lotto reale; prodotto non tracciato resta utilizzabile", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440x900",
    "Il ciclo inventariale mutante gira una volta sul DB E2E effimero",
  );
  if (
    !process.env.E2E_DATABASE_URL ||
    process.env.M5C1_TEST_DISPOSABLE_DB !== "verified"
  )
    throw new Error("R2-04 richiede PostgreSQL E2E effimero verificato");
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  const { pool: templatePool } = await import("../../../lib/db/src/index.ts");
  const PoolConstructor = templatePool.constructor as new (options: {
    connectionString: string;
  }) => typeof templatePool;
  const pool = new PoolConstructor({
    connectionString: process.env.E2E_DATABASE_URL!,
  });
  r2DatabasePool = pool;
  await login(page);
  const suffix = randomUUID().slice(0, 8);
  const warehousesResponse = await page.request.get(
    "/api/mensa/logistica/magazzini",
  );
  expect(warehousesResponse.ok()).toBe(true);
  const warehouses = (await warehousesResponse.json()) as Array<{
    id: number;
    nome: string;
    areaOperativaId: number;
  }>;
  const origin =
    warehouses.find((item) => item.nome === "Magazzino Demo Principale") ??
    warehouses.find((item) => item.areaOperativaId != null);
  expect(origin).toBeTruthy();
  const [destination] = (
    await pool.query<{ id: number }>(
      `INSERT INTO magazzini (codice,nome,tipo_magazzino,area_operativa_id)
     VALUES ($1,$2,'mensa',$3) RETURNING id`,
      [`R2-MENSA-WH-${suffix}`, `Mensa R2 ${suffix}`, origin!.areaOperativaId],
    )
  ).rows;
  const [mensa] = (
    await pool.query<{ id: number }>(
      `INSERT INTO mense (codice,nome,area_operativa_id,magazzino_id,created_by)
     SELECT $1,$2,$3,$4,id FROM utenti WHERE username='sadmin' RETURNING id`,
      [
        `R2-MENSA-${suffix}`,
        `Mensa R2 ${suffix}`,
        origin!.areaOperativaId,
        destination.id,
      ],
    )
  ).rows;
  const products = (
    await pool.query<{ id: number; lotto_fisico_obbligatorio: boolean }>(
      `INSERT INTO prodotti (codice,nome,tipo_prodotto,unita_misura,lotto_fisico_obbligatorio)
     VALUES ($1,$2,'alimentare','cf',true),($3,$4,'alimentare','cf',false)
     RETURNING id,lotto_fisico_obbligatorio`,
      [
        `R2-LOT-${suffix}`,
        `Biscotti R2 ${suffix}`,
        `R2-NOLOT-${suffix}`,
        `Pasta R2 ${suffix}`,
      ],
    )
  ).rows;
  const required = products.find((item) => item.lotto_fisico_obbligatorio)!;
  const optional = products.find((item) => !item.lotto_fisico_obbligatorio)!;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const expiry = (days: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const lots = (
    await pool.query<{ id: number; codice_lotto: string }>(
      `INSERT INTO lotti (prodotto_id,magazzino_id,codice_lotto,data_carico,data_scadenza,quantita_caricata,quantita_residua)
     VALUES ($1,$2,$3,$4,$5,10,10),($1,$2,$6,$4,$7,58,58),($8,$2,$9,$4,NULL,2,2)
     RETURNING id,codice_lotto`,
      [
        required.id,
        origin!.id,
        `R2-A-${suffix}`,
        today,
        expiry(20),
        `R2-B-${suffix}`,
        expiry(40),
        optional.id,
        `R2-O-${suffix}`,
      ],
    )
  ).rows;
  const lotA = lots.find((item) => item.codice_lotto === `R2-A-${suffix}`)!;
  await page.goto("/mensa/trasferimenti");
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Mensa destinazione" }),
    `Mensa R2 ${suffix}`,
  );
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Magazzino origine" }),
    origin!.nome,
  );
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Prodotto disponibile" }),
    new RegExp(`Biscotti R2 ${suffix}`),
  );
  await expect(page.getByTestId("mensa-lotto-field")).toBeVisible();
  const create = page.getByRole("button", { name: "Crea trasferimento" });
  await expect(create).toBeDisabled();
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Lotto" }),
    new RegExp(`R2-A-${suffix}`),
  );
  await page.getByRole("spinbutton", { name: "Quantità" }).fill("23");
  await expect(create).toBeDisabled();
  await page.getByRole("spinbutton", { name: "Quantità" }).fill("10");
  await expect(create).toBeEnabled();
  const createdResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/mensa/trasferimenti") &&
      response.request().method() === "POST",
  );
  await create.click();
  const createdResponse = await createdResponsePromise;
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const submitted = createdResponse.request().postDataJSON() as {
    righe: Array<{ lottoId: number }>;
  };
  expect(submitted.righe[0].lottoId).toBe(lotA.id);
  const transfer = (await createdResponse.json()) as { id: number };
  const [saved] = (
    await pool.query<{ lotto_id: number }>(
      "SELECT lotto_id FROM trasferimento_righe WHERE trasferimento_id=$1",
      [transfer.id],
    )
  ).rows;
  expect(saved.lotto_id).toBe(lotA.id);
  const prepared = await page.request.post(
    `/api/trasferimenti/${transfer.id}/prepara`,
    {
      data: { versione: 1, idempotencyKey: `r2-prepare-${suffix}` },
    },
  );
  expect(prepared.status(), await prepared.text()).toBe(200);
  const [reservation] = (
    await pool.query<{ lotto_id: number; quantita: string }>(
      "SELECT lotto_id,quantita::text FROM prenotazioni_magazzino WHERE trasferimento_id=$1 AND stato='attiva'",
      [transfer.id],
    )
  ).rows;
  expect(reservation.lotto_id).toBe(lotA.id);
  expect(Number(reservation.quantita)).toBe(10);
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Prodotto disponibile" }),
    new RegExp(`Pasta R2 ${suffix}`),
  );
  await expect(page.getByTestId("mensa-lotto-field")).toHaveCount(0);
  await page.getByRole("spinbutton", { name: "Quantità" }).fill("1");
  const optionalPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/mensa/trasferimenti") &&
      response.request().method() === "POST",
  );
  await create.click();
  const optionalResponse = await optionalPromise;
  expect(optionalResponse.status(), await optionalResponse.text()).toBe(201);
  expect(
    (
      optionalResponse.request().postDataJSON() as {
        righe: Array<{ lottoId?: number }>;
      }
    ).righe[0].lottoId,
  ).toBeUndefined();
});
