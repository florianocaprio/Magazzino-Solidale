import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { login, selectOption } from "./helpers";

type SqlPool = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
  end(): Promise<void>;
};

type Magazzino = {
  id: number;
  nome: string;
  areaOperativaId: number;
  stato: string;
};

type Beneficiario = {
  id: number;
  codice: string;
  nome: string;
  cognome: string;
  consegnaDomicilio: boolean;
};

type Prodotto = {
  id: number;
  codice: string;
  nome: string;
  unitaMisura: string;
};

type Giacenza = {
  prodottoId: number;
  disponibileReale: number;
};

type Bolla = {
  id: number;
  numeroBolla: string;
  versione: number;
  stato: string;
};

type BollaRiga = {
  id: number;
  versioneBolla: number;
};

type Ente = {
  id: number;
  versione: number;
  denominazione: string;
};

type Trasferimento = {
  id: number;
  codice: string;
  versione: number;
  stato: string;
};

type DemoFixtures = {
  origin: Magazzino;
  destination: Magazzino;
  beneficiary: Beneficiario;
  product: Prodotto;
};

let database: SqlPool;
const runSuffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const key = (label: string) => `m4a-e2e-${label}-${runSuffix}`;
const today = () => new Date().toISOString().slice(0, 10);

async function expectJson<T>(
  response: APIResponse,
  status: number,
): Promise<T> {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  return JSON.parse(text) as T;
}

async function capturePdf(
  page: Page,
  button: ReturnType<Page["getByRole"]>,
  name: string,
) {
  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  expect(downloadPath).not.toBeNull();
  expect((await stat(downloadPath!)).size).toBeGreaterThan(1_000);
  const evidenceDir = process.env.M4A_PDF_EVIDENCE_DIR;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await download.saveAs(join(evidenceDir, `${name}.pdf`));
  }
}

async function loadDemoFixtures(page: Page): Promise<DemoFixtures> {
  const [warehousesResponse, beneficiariesResponse, productsResponse] =
    await Promise.all([
      page.request.get("/api/magazzini"),
      page.request.get("/api/beneficiari?search=DEMO-BEN-001"),
      page.request.get("/api/prodotti"),
    ]);
  expect(warehousesResponse.ok()).toBe(true);
  expect(beneficiariesResponse.ok()).toBe(true);
  expect(productsResponse.ok()).toBe(true);

  const warehouses = (await warehousesResponse.json()) as Magazzino[];
  const beneficiaries = (await beneficiariesResponse.json()) as Beneficiario[];
  const products = (await productsResponse.json()) as Prodotto[];
  const origin = warehouses.find(
    (item) =>
      item.nome === "Magazzino Demo Principale" && item.stato === "attivo",
  );
  const destination = warehouses.find(
    (item) => item.nome === "Magazzino Demo Emporio" && item.stato === "attivo",
  );
  const beneficiary = beneficiaries.find(
    (item) => item.codice === "DEMO-BEN-001" && !item.consegnaDomicilio,
  );
  expect(
    origin,
    "Magazzino Demo Principale attivo non disponibile",
  ).toBeTruthy();
  expect(
    destination,
    "Magazzino Demo Emporio attivo non disponibile",
  ).toBeTruthy();
  expect(
    beneficiary,
    "Beneficiario demo non domiciliare non disponibile",
  ).toBeTruthy();

  const stockResponse = await page.request.get(
    `/api/giacenze?areaOperativaId=${origin!.areaOperativaId}&magazzinoId=${origin!.id}`,
  );
  expect(stockResponse.ok()).toBe(true);
  const stock = (await stockResponse.json()) as Giacenza[];
  const available = stock.find((item) => item.disponibileReale >= 2);
  const product = products.find((item) => item.id === available?.prodottoId);
  expect(
    product,
    "Prodotto demo con almeno 2 unità disponibili non trovato",
  ).toBeTruthy();

  return {
    origin: origin!,
    destination: destination!,
    beneficiary: beneficiary!,
    product: product!,
  };
}

async function openCreateBollaDialog(page: Page) {
  const beneficiariesLoaded = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes("/api/beneficiari") &&
      response.ok(),
  );
  await page.goto("/bolle");
  await expect(page.getByRole("heading", { name: /bolle/i })).toBeVisible();
  await beneficiariesLoaded;
  await page.getByRole("button", { name: /^nuovo$/i }).click();
  const choice = page.getByRole("dialog", {
    name: /nuovo documento operativo/i,
  });
  await choice.getByRole("button", { name: /nuova bolla/i }).click();
  const dialog = page.getByRole("dialog", {
    name: /nuova bolla di consegna/i,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openDocument(
  page: Page,
  type: "bolla" | "trasferimento",
  id: number,
) {
  await page.goto(`/bolle?documento=${encodeURIComponent(`${type}:${id}`)}`);
  const title =
    type === "bolla" ? /dettaglio bolla/i : /dettaglio trasferimento/i;
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("M4A — tre destinatari su UI, API e PostgreSQL reali", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const databaseUrl = process.env.E2E_DATABASE_URL;
    if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required");
    process.env.DATABASE_URL = databaseUrl;
    const databaseModule = await import("../../../lib/db/src/index.ts");
    database = databaseModule.pool as unknown as SqlPool;
  });

  test.afterAll(async () => {
    await database?.end();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-1440x900",
      "I lifecycle mutanti M4A girano una sola volta sul progetto desktop",
    );
    await login(page);
  });

  test("Beneficiario: una risposta persa conserva payload/key, crea una sola bozza e la riprende dopo login", async ({
    page,
  }) => {
    const fixtures = await loadDemoFixtures(page);
    const dialog = await openCreateBollaDialog(page);
    const scan = dialog.getByPlaceholder(/scansiona o digita il codice/i);
    await scan.fill(fixtures.beneficiary.codice);
    await scan.press("Enter");
    await expect(dialog).toContainText(
      `${fixtures.beneficiary.cognome} ${fixtures.beneficiary.nome}`,
    );
    await selectOption(
      page,
      dialog.getByRole("combobox", { name: /magazzino di uscita/i }),
      fixtures.origin.nome,
    );

    let committed:
      | { status: number; payload: Record<string, unknown>; bolla: Bolla }
      | undefined;
    let interceptionError: unknown;
    await page.route("**/api/bolle", async (route) => {
      if (route.request().method() !== "POST" || committed) {
        await route.continue();
        return;
      }
      try {
        const payload = route.request().postDataJSON() as Record<
          string,
          unknown
        >;
        const upstream = await route.fetch();
        committed = {
          status: upstream.status(),
          payload,
          bolla: (await upstream.json()) as Bolla,
        };
        await route.abort("failed");
      } catch (error) {
        interceptionError = error;
        await route.abort("failed");
      }
    });

    const createButton = dialog.getByRole("button", { name: /crea bolla/i });
    await createButton.click();
    await expect
      .poll(() => {
        if (interceptionError) throw interceptionError;
        return committed?.status;
      })
      .toBe(201);
    await expect(
      page.getByText("Impossibile creare la bolla", { exact: true }),
    ).toBeVisible();
    await expect(createButton).toBeEnabled();
    await page.unroute("**/api/bolle");

    const replayResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/bolle") &&
        response.request().method() === "POST",
    );
    await createButton.click();
    const replayResponse = await replayResponsePromise;
    const replayPayload = replayResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    const replayed = await expectJson<Bolla>(replayResponse, 200);
    expect(replayPayload).toEqual(committed!.payload);
    expect(replayed.id).toBe(committed!.bolla.id);
    await expect(dialog).toBeHidden();

    const persisted = await database.query<{
      aggregato_id: number;
      numero_bolla: string;
      receipts: string;
      righe: string;
      prenotazioni: string;
      movimenti: string;
    }>(
      `SELECT c.aggregato_id,
              b.numero_bolla,
              count(*) OVER ()::text AS receipts,
              (SELECT count(*)::text FROM bolla_righe br WHERE br.bolla_id = b.id) AS righe,
              (SELECT count(*)::text FROM prenotazioni_magazzino pm WHERE pm.bolla_id = b.id) AS prenotazioni,
              (SELECT count(*)::text FROM movimenti m WHERE m.bolla_id = b.id) AS movimenti
         FROM comandi_operativi c
         JOIN bolle b ON b.id = c.aggregato_id
        WHERE c.tipo_comando = 'BOLLA_CREA'
          AND c.idempotency_key = $1`,
      [String(committed!.payload.idempotencyKey)],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      aggregato_id: replayed.id,
      numero_bolla: replayed.numeroBolla,
      receipts: "1",
      righe: "0",
      prenotazioni: "0",
      movimenti: "0",
    });

    await page.goto(
      `/bolle?tipoAggregato=bolla&destinatario=beneficiario&ricerca=${encodeURIComponent(replayed.numeroBolla)}`,
    );
    await expect(
      page.getByRole("row").filter({ hasText: replayed.numeroBolla }),
    ).toBeVisible();

    await page.context().clearCookies();
    await login(page);
    const resumed = await openDocument(page, "bolla", replayed.id);
    await expect(resumed).toContainText(replayed.numeroBolla);
    await expect(resumed).toContainText(
      `${fixtures.beneficiary.cognome} ${fixtures.beneficiary.nome}`,
    );
    await capturePdf(
      page,
      resumed.getByRole("button", { name: /scarica pdf/i }),
      "beneficiario-bozza",
    );
  });

  test("Ente: crea una bozza vuota dalla UI e la riprende dopo logout/login senza effetti inventariali", async ({
    page,
  }) => {
    const fixtures = await loadDemoFixtures(page);
    const ente = await expectJson<Ente>(
      await page.request.post("/api/enti-destinatari", {
        data: {
          idempotencyKey: key("ente-ui-create"),
          denominazione: `Ente UI M4A ${runSuffix}`,
          indirizzo: `Via UI M4A ${runSuffix}`,
          areaOperativaId: fixtures.origin.areaOperativaId,
        },
      }),
      201,
    );
    const dialog = await openCreateBollaDialog(page);
    await selectOption(
      page,
      dialog.getByRole("combobox").first(),
      "Ente esterno",
    );
    await selectOption(
      page,
      dialog.getByRole("combobox").nth(1),
      ente.denominazione,
    );
    await selectOption(
      page,
      dialog.getByRole("combobox", { name: /magazzino di uscita/i }),
      fixtures.origin.nome,
    );
    await dialog.getByRole("button", { name: /annulla/i }).click();
    const unsaved = page.getByRole("alertdialog");
    await expect(unsaved).toBeVisible();
    await unsaved.getByRole("button", { name: /resta e continua/i }).click();
    await expect(dialog).toBeVisible();
    const createdResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/bolle") &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: /crea bolla/i }).click();
    const bolla = await expectJson<Bolla>(await createdResponse, 201);
    expect(bolla.stato).toBe("bozza");
    const effects = await database.query<{
      righe: string;
      prenotazioni: string;
      movimenti: string;
    }>(
      `SELECT (SELECT count(*)::text FROM bolla_righe WHERE bolla_id = $1) AS righe,
              (SELECT count(*)::text FROM prenotazioni_magazzino WHERE bolla_id = $1) AS prenotazioni,
              (SELECT count(*)::text FROM movimenti WHERE bolla_id = $1) AS movimenti`,
      [bolla.id],
    );
    expect(effects.rows[0]).toEqual({
      righe: "0",
      prenotazioni: "0",
      movimenti: "0",
    });
    await expectJson<BollaRiga>(
      await page.request.post(`/api/bolle/${bolla.id}/righe`, {
        data: {
          idempotencyKey: key("ente-ui-row"),
          versione: bolla.versione,
          prodottoId: fixtures.product.id,
          quantita: 1,
          unitaMisura: fixtures.product.unitaMisura,
        },
      }),
      201,
    );
    await page.context().clearCookies();
    await login(page);
    const resumed = await openDocument(page, "bolla", bolla.id);
    await expect(resumed).toContainText(ente.denominazione);
    await expect(resumed).toContainText(bolla.numeroBolla);
    await expect(resumed).toContainText(fixtures.product.nome);
    await capturePdf(
      page,
      resumed.getByRole("button", { name: /scarica pdf/i }),
      "ente-bozza",
    );
  });

  test("Bolla: risposta persa dopo conferma versionata, retry con stessa intenzione e una sola prenotazione", async ({
    page,
  }) => {
    const fixtures = await loadDemoFixtures(page);
    const draft = await expectJson<Bolla>(
      await page.request.post("/api/bolle", {
        data: {
          idempotencyKey: key("confirm-draft"),
          tipoDestinatario: "beneficiario",
          beneficiarioId: fixtures.beneficiary.id,
          magazzinoId: fixtures.origin.id,
        },
      }),
      201,
    );
    const row = await expectJson<BollaRiga>(
      await page.request.post(`/api/bolle/${draft.id}/righe`, {
        data: {
          idempotencyKey: key("confirm-row"),
          versione: draft.versione,
          prodottoId: fixtures.product.id,
          quantita: 1,
          unitaMisura: fixtures.product.unitaMisura,
        },
      }),
      201,
    );
    const detail = await openDocument(page, "bolla", draft.id);
    const confirmButton = detail.getByRole("button", {
      name: /conferma bolla/i,
    });
    await expect(confirmButton).toBeEnabled();
    let committed:
      | { status: number; payload: Record<string, unknown>; bolla: Bolla }
      | undefined;
    let interceptionError: unknown;
    await page.route(`**/api/bolle/${draft.id}/conferma`, async (route) => {
      if (route.request().method() !== "POST" || committed) {
        await route.continue();
        return;
      }
      try {
        const payload = route.request().postDataJSON() as Record<
          string,
          unknown
        >;
        const upstream = await route.fetch();
        committed = {
          status: upstream.status(),
          payload,
          bolla: (await upstream.json()) as Bolla,
        };
        await route.abort("failed");
      } catch (error) {
        interceptionError = error;
        await route.abort("failed");
      }
    });
    await confirmButton.click();
    await expect
      .poll(() => {
        if (interceptionError) throw interceptionError;
        return committed?.status;
      })
      .toBe(200);
    await page.unroute(`**/api/bolle/${draft.id}/conferma`);
    const replayResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/bolle/${draft.id}/conferma`) &&
        response.request().method() === "POST",
    );
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();
    const replayResponse = await replayResponsePromise;
    const replayPayload = replayResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    const replayed = await expectJson<Bolla>(replayResponse, 200);
    expect(replayPayload).toEqual(committed!.payload);
    expect(replayPayload.versione).toBe(row.versioneBolla);
    expect(replayed.id).toBe(committed!.bolla.id);
    expect(replayed.stato).toBe("confermato");
    const effects = await database.query<{
      receipts: string;
      prenotazioni: string;
      movimenti: string;
    }>(
      `SELECT (SELECT count(*)::text FROM comandi_operativi WHERE tipo_comando = 'BOLLA_CONFERMA' AND idempotency_key = $2) AS receipts,
              (SELECT count(*)::text FROM prenotazioni_magazzino WHERE bolla_id = $1) AS prenotazioni,
              (SELECT count(*)::text FROM movimenti WHERE bolla_id = $1) AS movimenti`,
      [draft.id, String(replayPayload.idempotencyKey)],
    );
    expect(effects.rows[0].receipts).toBe("1");
    expect(Number(effects.rows[0].prenotazioni)).toBeGreaterThan(0);
    expect(effects.rows[0].movimenti).toBe("0");
  });

  test("PDF reali: ripartizioni FEFO e fondo origine, righe ripetute multipagina senza effetti di stampa", async ({
    page,
  }) => {
    const fixtures = await loadDemoFixtures(page);
    async function seedProduct(label: string) {
      const code = `PDF-${randomUUID().slice(0, 12)}`;
      const created = await database.query<{ id: number }>(
        `INSERT INTO prodotti (codice, nome, tipo_prodotto, unita_misura)
         VALUES ($1, $2, 'alimentare', 'pz') RETURNING id`,
        [code, `Prodotto PDF ${label} ${runSuffix}`],
      );
      const productId = created.rows[0].id;
      await database.query(
        `INSERT INTO lotti (prodotto_id, codice_lotto, data_scadenza, data_carico, quantita_caricata, quantita_residua, magazzino_id, fondo_origine, fse_plus)
         VALUES ($1, $2, '2027-01-01', $4, 5, 5, $5, 'FSE_PLUS', true),
                ($1, $3, '2027-02-01', $4, 5, 5, $5, 'NESSUN_FONDO', false)`,
        [productId, `${code}-A`, `${code}-B`, today(), fixtures.origin.id],
      );
      return { id: productId, firstLot: `${code}-A`, secondLot: `${code}-B` };
    }

    const bollaProduct = await seedProduct("Bolla");
    const draft = await expectJson<Bolla>(
      await page.request.post("/api/bolle", {
        data: {
          idempotencyKey: key("pdf-fefo-bolla"),
          tipoDestinatario: "beneficiario",
          beneficiarioId: fixtures.beneficiary.id,
          magazzinoId: fixtures.origin.id,
        },
      }),
      201,
    );
    const line = await expectJson<BollaRiga>(
      await page.request.post(`/api/bolle/${draft.id}/righe`, {
        data: {
          idempotencyKey: key("pdf-fefo-bolla-row"),
          versione: draft.versione,
          prodottoId: bollaProduct.id,
          quantita: 10,
          unitaMisura: "pz",
        },
      }),
      201,
    );
    const confirmed = await expectJson<Bolla>(
      await page.request.post(`/api/bolle/${draft.id}/conferma`, {
        data: {
          idempotencyKey: key("pdf-fefo-bolla-confirm"),
          versione: line.versioneBolla,
        },
      }),
      200,
    );
    expect(confirmed.stato).toBe("confermato");
    const beforePrint = await database.query<{
      movements: string;
      reservations: string;
    }>(
      `SELECT (SELECT count(*)::text FROM movimenti WHERE bolla_id = $1) AS movements,
              (SELECT count(*)::text FROM prenotazioni_magazzino WHERE bolla_id = $1) AS reservations`,
      [draft.id],
    );
    expect(beforePrint.rows[0]).toEqual({ movements: "0", reservations: "2" });
    const bollaDetail = await openDocument(page, "bolla", draft.id);
    await capturePdf(
      page,
      bollaDetail.getByRole("button", { name: /scarica pdf/i }),
      "beneficiario-confermata-fefo",
    );
    const afterPrint = await database.query<{
      movements: string;
      reservations: string;
    }>(
      `SELECT (SELECT count(*)::text FROM movimenti WHERE bolla_id = $1) AS movements,
              (SELECT count(*)::text FROM prenotazioni_magazzino WHERE bolla_id = $1) AS reservations`,
      [draft.id],
    );
    expect(afterPrint.rows[0]).toEqual(beforePrint.rows[0]);

    const transferProduct = await seedProduct("Trasferimento");
    const transfer = await expectJson<Trasferimento>(
      await page.request.post("/api/trasferimenti", {
        data: {
          idempotencyKey: key("pdf-fefo-transfer"),
          magazzinoOrigineId: fixtures.origin.id,
          magazzinoDestinoId: fixtures.destination.id,
          dataRichiesta: today(),
          trasportatoreNome: "Corriere PDF M4A",
          righe: [
            { prodottoId: transferProduct.id, quantita: 10, unitaMisura: "pz" },
          ],
        },
      }),
      201,
    );
    const started = await expectJson<Trasferimento>(
      await page.request.post(`/api/trasferimenti/${transfer.id}/avvia`, {
        data: {
          idempotencyKey: key("pdf-fefo-transfer-start"),
          versione: transfer.versione,
        },
      }),
      200,
    );
    expect(started.stato).toBe("in_transito");
    const splits = await database.query<{ codice_lotto: string }>(
      `SELECT l.codice_lotto FROM movimenti m JOIN lotti l ON l.id = m.lotto_id
        WHERE m.trasferimento_id = $1 AND m.tipo_dettaglio = 'uscita' ORDER BY l.codice_lotto`,
      [transfer.id],
    );
    expect(splits.rows.map((item) => item.codice_lotto)).toEqual([
      transferProduct.firstLot,
      transferProduct.secondLot,
    ]);
    await page.goto(
      `/bolle?tipoAggregato=trasferimento&destinatario=magazzino&ricerca=${encodeURIComponent(transfer.codice)}`,
    );
    const transferRow = page
      .getByRole("row")
      .filter({ hasText: transfer.codice });
    await expect(transferRow).toBeVisible();
    await capturePdf(
      page,
      transferRow.getByRole("button", { name: /bolla/i }),
      "trasferimento-transito-fefo",
    );

    const multipage = await expectJson<Bolla>(
      await page.request.post("/api/bolle", {
        data: {
          idempotencyKey: key("pdf-multipage"),
          tipoDestinatario: "beneficiario",
          beneficiarioId: fixtures.beneficiary.id,
          magazzinoId: fixtures.origin.id,
        },
      }),
      201,
    );
    await database.query(
      `INSERT INTO bolla_righe (bolla_id, prodotto_id, quantita, unita_misura, note)
       SELECT $1, $2, 1, 'pz', 'Riga ripetuta ' || g::text FROM generate_series(1, 60) AS g`,
      [multipage.id, bollaProduct.id],
    );
    const multipageDetail = await openDocument(page, "bolla", multipage.id);
    const repeated = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bolla_righe WHERE bolla_id = $1`,
      [multipage.id],
    );
    expect(repeated.rows[0].count).toBe("60");
    await capturePdf(
      page,
      multipageDetail.getByRole("button", { name: /scarica pdf/i }),
      "beneficiario-multipagina-ripetuta",
    );
    const multipageEffects = await database.query<{
      movements: string;
      reservations: string;
    }>(
      `SELECT (SELECT count(*)::text FROM movimenti WHERE bolla_id = $1) AS movements,
              (SELECT count(*)::text FROM prenotazioni_magazzino WHERE bolla_id = $1) AS reservations`,
      [multipage.id],
    );
    expect(multipageEffects.rows[0]).toEqual({
      movements: "0",
      reservations: "0",
    });
  });

  test("Ente: conferma congela A, modifica/disattivazione resta B e il legacy usa fallback esplicito", async ({
    page,
  }) => {
    const fixtures = await loadDemoFixtures(page);
    const nameA = `Ente M4A A ${runSuffix}`;
    const addressA = `Via Snapshot A ${runSuffix}`;
    const nameB = `Ente M4A B ${runSuffix}`;
    const addressB = `Via Snapshot B ${runSuffix}`;
    const phoneB = "0600000000";
    const emailB = `ente-${runSuffix}@example.test`;

    const ente = await expectJson<Ente>(
      await page.request.post("/api/enti-destinatari", {
        data: {
          idempotencyKey: key("ente-create"),
          denominazione: nameA,
          indirizzo: addressA,
          areaOperativaId: fixtures.origin.areaOperativaId,
        },
      }),
      201,
    );
    const bolla = await expectJson<Bolla>(
      await page.request.post("/api/bolle", {
        data: {
          idempotencyKey: key("ente-bolla-create"),
          tipoDestinatario: "ente",
          enteDestinatarioId: ente.id,
          magazzinoId: fixtures.origin.id,
        },
      }),
      201,
    );
    const row = await expectJson<BollaRiga>(
      await page.request.post(`/api/bolle/${bolla.id}/righe`, {
        data: {
          idempotencyKey: key("ente-bolla-row"),
          versione: bolla.versione,
          prodottoId: fixtures.product.id,
          quantita: 1,
          unitaMisura: fixtures.product.unitaMisura,
        },
      }),
      201,
    );
    const confirmed = await expectJson<Bolla>(
      await page.request.post(`/api/bolle/${bolla.id}/conferma`, {
        data: {
          idempotencyKey: key("ente-bolla-confirm"),
          versione: row.versioneBolla,
        },
      }),
      200,
    );
    expect(confirmed.stato).toBe("confermato");

    await expectJson<Ente>(
      await page.request.patch(`/api/enti-destinatari/${ente.id}`, {
        data: {
          idempotencyKey: key("ente-update"),
          versione: ente.versione,
          denominazione: nameB,
          indirizzo: addressB,
          telefono: phoneB,
          email: emailB,
          attivo: false,
        },
      }),
      200,
    );

    const snapshot = await database.query<{
      destinatario_nome_snapshot: string | null;
      destinatario_indirizzo_snapshot: string | null;
      destinatario_telefono_snapshot: string | null;
      destinatario_email_snapshot: string | null;
      destinatario_snapshot_congelato: boolean;
      ente_live: string;
      ente_attivo: boolean;
    }>(
      `SELECT b.destinatario_nome_snapshot,
              b.destinatario_indirizzo_snapshot,
              b.destinatario_telefono_snapshot,
              b.destinatario_email_snapshot,
              b.destinatario_snapshot_congelato,
              e.denominazione AS ente_live,
              e.attivo AS ente_attivo
         FROM bolle b
         JOIN enti_destinatari e ON e.id = b.ente_destinatario_id
        WHERE b.id = $1`,
      [bolla.id],
    );
    expect(snapshot.rows[0]).toEqual({
      destinatario_nome_snapshot: nameA,
      destinatario_indirizzo_snapshot: addressA,
      destinatario_telefono_snapshot: null,
      destinatario_email_snapshot: null,
      destinatario_snapshot_congelato: true,
      ente_live: nameB,
      ente_attivo: false,
    });

    const historical = await expectJson<{
      documentoId: string;
      tipoAggregato: "bolla";
      dettaglio: {
        enteDestinatarioNome: string;
        enteDestinatarioIndirizzo: string;
        enteDestinatarioTelefono: string | null;
        enteDestinatarioEmail: string | null;
        destinatarioSnapshotCongelato: boolean;
        destinatarioSnapshotFonte: string;
      };
    }>(
      await page.request.get(`/api/documenti-operativi/bolla/${bolla.id}`),
      200,
    );
    expect(historical.dettaglio).toMatchObject({
      enteDestinatarioNome: nameA,
      enteDestinatarioIndirizzo: addressA,
      enteDestinatarioTelefono: null,
      enteDestinatarioEmail: null,
      destinatarioSnapshotCongelato: true,
      destinatarioSnapshotFonte: "confermato",
    });

    await page.goto(
      `/bolle?tipoAggregato=bolla&destinatario=ente&ricerca=${encodeURIComponent(bolla.numeroBolla)}`,
    );
    await expect(
      page.getByRole("row").filter({ hasText: bolla.numeroBolla }),
    ).toBeVisible();
    const historicalDialog = await openDocument(page, "bolla", bolla.id);
    await expect(historicalDialog).toContainText(nameA);
    await expect(historicalDialog).toContainText(addressA);
    await expect(historicalDialog).not.toContainText(nameB);

    await capturePdf(
      page,
      historicalDialog.getByRole("button", { name: /scarica pdf/i }),
      "ente-confermata",
    );

    const legacyNumber = `LEG-M4A-${runSuffix}`.slice(0, 30);
    const legacyInsert = await database.query<{ id: number }>(
      `INSERT INTO bolle (
          numero_bolla,
          data_bolla,
          tipo_destinatario,
          beneficiario_id,
          ente_destinatario_id,
          magazzino_id,
          area_operativa_id_snapshot,
          destinatario_snapshot_congelato,
          stato
        ) VALUES ($1, $2, 'ente', NULL, $3, $4, $5, false, 'confermato')
        RETURNING id`,
      [
        legacyNumber,
        today(),
        ente.id,
        fixtures.origin.id,
        fixtures.origin.areaOperativaId,
      ],
    );
    const legacyId = legacyInsert.rows[0].id;
    const legacy = await expectJson<{
      documentoId: string;
      tipoAggregato: "bolla";
      dettaglio: {
        enteDestinatarioNome: string;
        enteDestinatarioIndirizzo: string;
        enteDestinatarioTelefono: string;
        enteDestinatarioEmail: string;
        destinatarioSnapshotCongelato: boolean;
        destinatarioSnapshotFonte: string;
      };
    }>(
      await page.request.get(`/api/documenti-operativi/bolla/${legacyId}`),
      200,
    );
    expect(legacy.dettaglio).toMatchObject({
      enteDestinatarioNome: nameB,
      enteDestinatarioIndirizzo: addressB,
      enteDestinatarioTelefono: phoneB,
      enteDestinatarioEmail: emailB,
      destinatarioSnapshotCongelato: false,
      destinatarioSnapshotFonte: "legacy_live",
    });
    const legacyDialog = await openDocument(page, "bolla", legacyId);
    await expect(legacyDialog).toContainText(nameB);
    await expect(legacyDialog).toContainText(addressB);
  });

  test("Magazzino: il Trasferimento resta una bozza persistente senza effetti di stock e si riprende dal dettaglio comune", async ({
    page,
  }) => {
    const fixtures = await loadDemoFixtures(page);
    const before = await database.query<{ residuo: string }>(
      `SELECT COALESCE(sum(quantita_residua), 0)::text AS residuo
         FROM lotti
        WHERE magazzino_id = $1 AND prodotto_id = $2`,
      [fixtures.origin.id, fixtures.product.id],
    );
    const lotsResponse = await page.request.get(
      `/api/lotti?magazzinoId=${fixtures.origin.id}&prodottoId=${fixtures.product.id}`,
    );
    expect(lotsResponse.ok()).toBe(true);
    const availableLot = (
      (await lotsResponse.json()) as Array<{
        id: number;
        disponibileReale: number;
      }>
    ).find((lot) => lot.disponibileReale >= 1);
    expect(availableLot).toBeTruthy();
    const idempotencyKey = key("transfer-create");
    const transfer = await expectJson<Trasferimento>(
      await page.request.post("/api/trasferimenti", {
        data: {
          idempotencyKey,
          magazzinoOrigineId: fixtures.origin.id,
          magazzinoDestinoId: fixtures.destination.id,
          dataRichiesta: today(),
          trasportatoreNome: "Corriere M4A E2E",
          note: `Bozza persistente ${runSuffix}`,
          righe: [
            {
              prodottoId: fixtures.product.id,
              lottoId: availableLot!.id,
              quantita: 1,
              unitaMisura: fixtures.product.unitaMisura,
            },
          ],
        },
      }),
      201,
    );
    expect(transfer.stato).toBe("richiesto");

    const persisted = await database.query<{
      righe: string;
      movimenti: string;
      receipts: string;
      residuo: string;
    }>(
      `SELECT
          (SELECT count(*)::text FROM trasferimento_righe tr WHERE tr.trasferimento_id = t.id) AS righe,
          (SELECT count(*)::text FROM movimenti m WHERE m.trasferimento_id = t.id) AS movimenti,
          (SELECT count(*)::text
             FROM comandi_operativi c
            WHERE c.tipo_comando = 'trasferimento.create'
              AND c.idempotency_key = $2
              AND c.aggregato_id = t.id) AS receipts,
          (SELECT COALESCE(sum(l.quantita_residua), 0)::text
             FROM lotti l
            WHERE l.magazzino_id = t.magazzino_origine_id
              AND l.prodotto_id = $3) AS residuo
        FROM trasferimenti t
        WHERE t.id = $1`,
      [transfer.id, idempotencyKey, fixtures.product.id],
    );
    expect(persisted.rows[0]).toMatchObject({
      righe: "1",
      movimenti: "0",
      receipts: "1",
      residuo: before.rows[0].residuo,
    });

    const commonList = await expectJson<{
      items: Array<{
        documentoId: string;
        tipoAggregato: string;
        tipoDestinatario: string;
      }>;
    }>(
      await page.request.get(
        `/api/documenti-operativi?tipoAggregato=trasferimento&destinatario=magazzino&ricerca=${encodeURIComponent(transfer.codice)}`,
      ),
      200,
    );
    expect(commonList.items).toEqual([
      expect.objectContaining({
        documentoId: `trasferimento:${transfer.id}`,
        tipoAggregato: "trasferimento",
        tipoDestinatario: "magazzino",
      }),
    ]);

    await page.goto(
      `/bolle?tipoAggregato=trasferimento&destinatario=magazzino&ricerca=${encodeURIComponent(transfer.codice)}`,
    );
    await expect(
      page.getByRole("row").filter({ hasText: transfer.codice }),
    ).toBeVisible();

    await page.context().clearCookies();
    await login(page);
    const resumed = await openDocument(page, "trasferimento", transfer.id);
    await expect(resumed).toContainText(transfer.codice);
    await expect(resumed).toContainText(fixtures.origin.nome);
    await expect(resumed).toContainText(fixtures.destination.nome);
    await expect(resumed).toContainText(fixtures.product.nome);
    await page.goto(
      `/bolle?tipoAggregato=trasferimento&destinatario=magazzino&ricerca=${encodeURIComponent(transfer.codice)}`,
    );
    const row = page.getByRole("row").filter({ hasText: transfer.codice });
    await expect(row).toBeVisible();
    await capturePdf(
      page,
      row.getByRole("button", { name: /bolla/i }),
      "trasferimento-bozza",
    );
  });

  test("LOT-EX E2E: la scelta del lotto fisico nella UI prevale sul FEFO alla partenza", async ({
    page,
  }) => {
    const fixtures = await loadDemoFixtures(page);
    const code = `M4A-EX-${randomUUID().slice(0, 8)}`;
    const product = await database.query<{ id: number }>(
      `INSERT INTO prodotti (codice, nome, tipo_prodotto, unita_misura)
       VALUES ($1, $2, 'alimentare', 'pz') RETURNING id`,
      [code, `Prodotto lotto esplicito ${runSuffix}`],
    );
    const lots = await database.query<{ id: number; codice_lotto: string }>(
      `INSERT INTO lotti (prodotto_id, codice_lotto, data_scadenza, data_carico,
                          quantita_caricata, quantita_residua, magazzino_id,
                          fondo_origine, fse_plus)
       VALUES ($1, $2, '2027-01-01', $4, 3, 3, $5, 'NESSUN_FONDO', false),
              ($1, $3, '2027-06-01', $4, 3, 3, $5, 'NESSUN_FONDO', false)
       RETURNING id, codice_lotto`,
      [
        product.rows[0].id,
        `${code}-A`,
        `${code}-B`,
        today(),
        fixtures.origin.id,
      ],
    );
    const earlier = lots.rows.find((lot) => lot.codice_lotto === `${code}-A`)!;
    const selected = lots.rows.find((lot) => lot.codice_lotto === `${code}-B`)!;

    await page.goto("/trasferimenti");
    await page.getByRole("button", { name: /^nuovo$/i }).click();
    await page
      .getByRole("dialog", { name: /nuovo documento operativo/i })
      .getByRole("button", { name: /trasferimenti/i })
      .click();
    const form = page.getByRole("dialog", { name: /nuovo trasferimento/i });
    await selectOption(
      page,
      form.getByRole("combobox", { name: /magazzino di partenza/i }),
      fixtures.origin.nome,
    );
    await selectOption(
      page,
      form.getByRole("combobox", { name: /magazzino di destinazione/i }),
      fixtures.destination.nome,
    );
    await selectOption(
      page,
      form.getByRole("combobox", { name: /trasportatore/i }),
      /altro/i,
    );
    await form
      .getByPlaceholder(/nome.*trasportatore/i)
      .fill("Corriere lotto esplicito");
    await selectOption(
      page,
      form.getByRole("combobox", { name: /prodotto 1/i }),
      new RegExp(`Prodotto lotto esplicito ${runSuffix}`),
    );
    await selectOption(
      page,
      form.getByRole("combobox", { name: /lotto fisico 1/i }),
      new RegExp(`${code}-B`),
    );
    await form.getByRole("spinbutton", { name: /quantità 1/i }).fill("2");
    const createdResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/trasferimenti") &&
        response.request().method() === "POST",
    );
    await form.getByRole("button", { name: /crea e genera bolla/i }).click();
    const createdHttp = await createdResponse;
    expect(createdHttp.status(), await createdHttp.text()).toBe(201);
    const created = (await createdHttp.json()) as Trasferimento;
    const draftLot = await database.query<{ lotto_id: number }>(
      `SELECT lotto_id FROM trasferimento_righe WHERE trasferimento_id = $1`,
      [created.id],
    );
    expect(draftLot.rows).toEqual([{ lotto_id: selected.id }]);
    const dispatched = await expectJson<Trasferimento>(
      await page.request.post(`/api/trasferimenti/${created.id}/avvia`, {
        data: {
          idempotencyKey: key("lot-explicit-dispatch"),
          versione: created.versione,
        },
      }),
      200,
    );
    expect(dispatched.stato).toBe("in_transito");
    const actual = await database.query<{
      id: number;
      quantita_residua: string;
      movements: string;
    }>(
      `SELECT l.id, l.quantita_residua::text,
              (SELECT count(*)::text FROM movimenti m
                WHERE m.trasferimento_id = $3 AND m.lotto_id = l.id
                  AND m.tipo_dettaglio = 'uscita') AS movements
         FROM lotti l WHERE l.id IN ($1, $2) ORDER BY l.id`,
      [earlier.id, selected.id, created.id],
    );
    const earlyState = actual.rows.find((lot) => lot.id === earlier.id)!;
    const chosenState = actual.rows.find((lot) => lot.id === selected.id)!;
    expect(Number(earlyState.quantita_residua)).toBe(3);
    expect(earlyState.movements).toBe("0");
    expect(Number(chosenState.quantita_residua)).toBe(1);
    expect(chosenState.movements).toBe("1");
  });
});
