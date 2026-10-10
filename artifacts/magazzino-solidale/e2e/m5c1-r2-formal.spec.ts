import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { getMigrationStatus } from "../../../lib/db/scripts/migration-runner.mjs";

const password = process.env.E2E_PASSWORD;
if (!password || process.env.M5C1_TEST_DISPOSABLE_DB !== "verified")
  throw new Error("M5C1-R2 requires a verified disposable E2E database");

let database: Awaited<typeof import("../../../lib/db/src/index.ts")>["pool"];

test.beforeAll(async () => {
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  const { pool: templatePool } = await import("../../../lib/db/src/index.ts");
  const PoolConstructor = templatePool.constructor as new (options: {
    connectionString: string;
  }) => typeof templatePool;
  database = new PoolConstructor({
    connectionString: process.env.E2E_DATABASE_URL!,
  });
  const { rows } = await database.query(
    "SELECT current_database() AS name, (SELECT count(*)::integer FROM app_meta.schema_migrations) AS ledger",
  );
  expect(rows[0].name).toBe("m5c1_r2_e2e");
  // Questi E2E usano lo schema corrente, non una base storica di upgrade.
  // Il runner canonico verifica tutte le migration disponibili e i checksum.
  const status = await getMigrationStatus({
    databaseUrl: process.env.E2E_DATABASE_URL!,
    updatesDirectory: fileURLToPath(
      new URL("../../../lib/db/updates", import.meta.url),
    ),
    manifestPath: fileURLToPath(
      new URL(
        "../../../lib/db/legacy-migrations-baseline.json",
        import.meta.url,
      ),
    ),
  });
  expect(status.totalFiles).toBeGreaterThan(0);
  expect(status).toMatchObject({
    initialized: true,
    appliedFiles: status.totalFiles,
    pendingFiles: [],
    checksumMismatches: [],
    appliedFilesMissing: [],
    outOfOrderFiles: [],
  });
  expect(rows[0].ledger).toBe(status.totalFiles);
});

test.afterAll(async () => {
  await database?.end();
});

async function loginAs(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password!);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("R2-02: presa in carico, Bolla aperta, P1/P2 persistenti e volontario con errore reale", async ({
  browser,
  viewport,
}) => {
  test.setTimeout(90_000);
  const suffix = randomUUID().slice(0, 8);
  const names = [`R2P1 ${suffix}`, `R2P2 ${suffix}`];
  const { rows: warehouseRows } = await database.query(
    "SELECT id FROM magazzini WHERE nome='M5C1 E2E Deposito'",
  );
  const warehouseId = warehouseRows[0].id as number;
  for (const [index, name] of names.entries()) {
    const { rows: products } = await database.query(
      `INSERT INTO prodotti(codice,nome,tipo_prodotto,unita_misura)
       VALUES ($1,$2,'alimentare','pz') RETURNING id`,
      [`R2-${suffix}-${index}`, name],
    );
    await database.query(
      `INSERT INTO lotti(prodotto_id,data_carico,quantita_caricata,quantita_residua,magazzino_id,codice_lotto)
       VALUES ($1,CURRENT_DATE,20,20,$2,$3)`,
      [products[0].id, warehouseId, `R2LOT-${suffix}-${index}`],
    );
  }
  const { rows: centerRows } = await database.query(
    "SELECT id FROM centri_di_ascolto WHERE nome='M5C1 E2E Centro'",
  );
  const { rows: volunteers } = await database.query(
    `INSERT INTO volontari(nome,cognome,ruolo,centro_ascolto_id,tipo_volontario,stato_approvazione,attivo)
     VALUES ($1,$2,'Volontario',$3,'PERMANENTE','approvato',true) RETURNING id`,
    [`V${suffix}`, `R2${suffix}`, centerRows[0].id],
  );
  const volunteerId = volunteers[0].id as number;
  await database.query(
    `INSERT INTO coperture_assicurative_volontari(volontario_id,data_inizio,data_fine,tipo_operazione)
     VALUES ($1,'2020-01-01','2030-12-31','NUOVA_COPERTURA')`,
    [volunteerId],
  );

  const social = await browser.newContext({ viewport });
  const warehouse = await browser.newContext({ viewport });
  try {
    const socialPage = await social.newPage();
    await loginAs(socialPage, "m5c1-e2e-social");
    const { rows: beneficiaryRows } = await database.query(
      "SELECT id FROM beneficiari WHERE codice='M5C1-E2E-B1'",
    );
    const requestResponse = await socialPage.request.post(
      "/api/richieste-magazzino",
      {
        data: {
          idempotencyKey: randomUUID(),
          tipoDestinatario: "beneficiario",
          sorgente: "beneficiario",
          beneficiarioId: beneficiaryRows[0].id,
          bisogno: `R2-02 synthetic ${suffix}`,
          priorita: "normale",
        },
      },
    );
    expect(requestResponse.status(), await requestResponse.text()).toBe(201);
    const request = await requestResponse.json();

    const page = await warehouse.newPage();
    await loginAs(page, "m5c1-e2e-warehouse");
    await page.goto("/richieste-magazzino");
    await page
      .getByRole("button", { name: new RegExp(request.codice) })
      .click();
    const requestSheet = page.getByRole("dialog", {
      name: request.codice,
      exact: true,
    });
    await expect(requestSheet).toBeVisible();
    const takenResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/richieste-magazzino/${request.id}/presa-in-carico`) &&
        response.request().method() === "POST",
    );
    await requestSheet
      .getByRole("button", { name: "Prendi in carico" })
      .click();
    const takeResult = await takenResponse;
    expect(takeResult.status(), await takeResult.text()).toBe(200);
    const taken = await page.request.get(
      `/api/richieste-magazzino/${request.id}`,
    );
    expect(taken.status()).toBe(200);
    expect(await taken.json()).toMatchObject({
      stato: "presa_in_carico",
      documentoCorrente: null,
    });
    await requestSheet
      .getByLabel("Magazzino di evasione", { exact: true })
      .selectOption({ label: "M5C1 E2E Deposito" });
    // M5C2 mantiene preparazione e documento nel medesimo Sheet della richiesta.
    const createBolla = requestSheet.getByRole("button", {
      name: "Crea Bolla",
      exact: true,
    });
    await expect(createBolla).toBeVisible();
    await expect(createBolla).toBeEnabled();
    const createdResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/richieste-magazzino/${request.id}/documento`) &&
        response.request().method() === "POST",
    );
    await createBolla.click();
    const created = await createdResponse;
    expect(created.status(), await created.text()).toBe(201);
    const document = await created.json();
    expect(document).toMatchObject({
      richiestaId: request.id,
      tipoDocumento: "bolla",
    });
    const bollaId = document.documentoId;
    expect(bollaId).toBeGreaterThan(0);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/richieste-magazzino" &&
        url.searchParams.get("richiestaId") === String(request.id) &&
        url.searchParams.get("documento") === `bolla:${bollaId}`,
    );
    const linked = await page.request.get(
      `/api/richieste-magazzino/${request.id}`,
    );
    expect((await linked.json()).documentoCorrente?.percorsoDocumento).toBe(
      `/bolle?bollaId=${bollaId}`,
    );

    let detail = requestSheet;
    await expect(detail).toBeVisible();
    await detail
      .getByRole("button", { name: /aggiungi il primo prodotto/i })
      .click();
    const add = page.getByRole("dialog", {
      name: /aggiungi prodotto alla bolla/i,
    });
    for (const [index, name] of names.entries()) {
      await add
        .getByPlaceholder(/scansiona o digita il codice prodotto/i)
        .fill(`R2-${suffix}-${index}`);
      await add.getByRole("button", { name: /^cerca$/i }).click();
      await expect(
        add.getByRole("combobox", { name: /prodotto disponibile/i }),
      ).toContainText(name);
      await add.getByRole("spinbutton", { name: /quantità/i }).fill("2");
      const addedResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/bolle/${bollaId}/righe`) &&
          response.request().method() === "POST",
      );
      await add.getByRole("button", { name: /^aggiungi$/i }).click();
      expect((await addedResponse).status()).toBe(201);
      await expect(
        add.getByRole("combobox", { name: /prodotto disponibile/i }),
      ).toContainText(/seleziona prodotto/i);
      await add.getByRole("button", { name: /chiudi/i }).click();
      await expect(add).toBeHidden();
      await expect(
        detail.getByRole("row", { name: new RegExp(name) }),
      ).toBeVisible();
      if (index === 0)
        await detail
          .getByRole("button", { name: /^aggiungi prodotto$/i })
          .click();
    }
    await page.goto("/bolle");
    await page.goto(`/bolle?bollaId=${bollaId}`);
    detail = page.getByRole("dialog", { name: /dettaglio bolla/i });
    await expect(detail).toBeVisible();
    for (const name of names)
      await expect(
        detail.getByRole("row", { name: new RegExp(name) }),
      ).toBeVisible();
    await page.reload();
    for (const name of names)
      await expect(
        detail.getByRole("row", { name: new RegExp(name) }),
      ).toBeVisible();
    const { rows: persisted } = await database.query(
      "SELECT p.nome FROM bolla_righe br JOIN prodotti p ON p.id=br.prodotto_id WHERE br.bolla_id=$1 ORDER BY p.nome",
      [bollaId],
    );
    expect(persisted.map((row) => row.nome)).toEqual([...names].sort());
    const removedResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/bolle/${bollaId}/righe/`) &&
        response.request().method() === "DELETE",
    );
    await detail
      .getByRole("row", { name: new RegExp(names[1]) })
      .getByRole("button")
      .click();
    expect((await removedResponse).status()).toBe(204);
    await expect(
      detail.getByRole("row", { name: new RegExp(names[1]) }),
    ).toHaveCount(0);
    await page.goto("/bolle");
    await page.goto(`/bolle?bollaId=${bollaId}`);
    await expect(
      detail.getByRole("row", { name: new RegExp(names[0]) }),
    ).toBeVisible();
    await expect(
      detail.getByRole("row", { name: new RegExp(names[1]) }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      detail.getByRole("row", { name: new RegExp(names[1]) }),
    ).toHaveCount(0);
    const { rows: afterRemoval } = await database.query(
      "SELECT p.nome FROM bolla_righe br JOIN prodotti p ON p.id=br.prodotto_id WHERE br.bolla_id=$1",
      [bollaId],
    );
    expect(afterRemoval.map((row) => row.nome)).toEqual([names[0]]);

    const delivery = detail
      .getByText(/chi effettua la consegna/i)
      .locator("..");
    await delivery.getByRole("combobox").click();
    await page.getByRole("option", { name: `R2${suffix} V${suffix}` }).click();
    await expect(detail).toContainText(`R2${suffix} V${suffix}`);
    await page.reload();
    await expect(detail).toContainText(`R2${suffix} V${suffix}`);
    const { rows: assigned } = await database.query(
      "SELECT volontario_consegna_id FROM bolle WHERE id=$1",
      [bollaId],
    );
    expect(assigned[0].volontario_consegna_id).toBe(volunteerId);

    await database.query("UPDATE volontari SET attivo=false WHERE id=$1", [
      volunteerId,
    ]);
    await delivery.getByRole("combobox").click();
    await page.getByRole("option", { name: /presso il centro/i }).click();
    await expect(detail).toContainText(/presso il centro/i);
    await delivery.getByRole("combobox").click();
    const facts = async () => {
      const { rows } = await database.query(
        `SELECT to_jsonb(b) AS bolla,
        (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM bolla_righe r WHERE r.bolla_id=b.id) AS righe,
        (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM lotti l JOIN prodotti p ON p.id=l.prodotto_id WHERE p.nome=ANY($2::text[])) AS lotti,
        (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM movimenti m JOIN prodotti p ON p.id=m.prodotto_id WHERE p.nome=ANY($2::text[])) AS movimenti,
        (SELECT jsonb_object_agg(s.prodotto_id,s.residuo) FROM (SELECT l.prodotto_id,sum(l.quantita_residua) AS residuo FROM lotti l JOIN prodotti p ON p.id=l.prodotto_id WHERE p.nome=ANY($2::text[]) GROUP BY l.prodotto_id) s) AS stock,
        (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM prenotazioni_magazzino p WHERE p.bolla_id=b.id) AS prenotazioni,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_eventi a WHERE a.entita_tipo='bolla' AND a.entita_id=b.id AND a.azione LIKE 'BOLLA_%') AS audit_successo
        FROM bolle b WHERE b.id=$1`,
        [bollaId, names],
      );
      return rows;
    };
    const beforeDenied = await facts();
    const sent: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().endsWith(`/api/bolle/${bollaId}`))
        sent.push(r.url());
    });
    const deniedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/bolle/${bollaId}`) &&
        response.request().method() === "PATCH",
    );
    const browserRead = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/documenti-operativi/bolla/${bollaId}`) &&
        r.request().method() === "GET",
    );
    await page.getByRole("option", { name: `R2${suffix} V${suffix}` }).click();
    const denied = await deniedResponse;
    expect(denied.status(), await denied.text()).toBe(403);
    const message = (await denied.json()).error;
    expect(message).toMatch(/^Volontario (non accessibile|non operativo)/);
    // Il portale visivo è fuori dallo Sheet; lo status live separato va preservato.
    await expect(
      page
        .getByRole("region", {
          name: "Notifications (F8)",
          includeHidden: true,
        })
        .getByText(message, { exact: true }),
    ).toBeVisible();
    const canonical = await page.request.get(
      `/api/documenti-operativi/bolla/${bollaId}`,
    );
    expect(canonical.status(), await canonical.text()).toBe(200);
    expect((await canonical.json()).dettaglio.id).toBe(bollaId);
    await expect(
      page
        .getByRole("status", { includeHidden: true })
        .filter({ hasText: message }),
    ).toContainText(message);
    expect((await browserRead).status()).toBe(200);
    expect(sent).toHaveLength(1);
    expect(await facts()).toEqual(beforeDenied);
    await expect(
      detail.getByRole("row", { name: new RegExp(names[0]) }),
    ).toBeVisible();

    // La stessa Bolla nel contesto Richiesta: stesso ruolo ordinario e diniego reale.
    await database.query("UPDATE volontari SET attivo=true WHERE id=$1", [
      volunteerId,
    ]);
    await page.goto(
      `/richieste-magazzino?filter=keep&richiestaId=${request.id}&documento=bolla%3A${bollaId}`,
    );
    const contextual = page.getByTestId("richiesta-sheet");
    await expect(
      contextual.getByRole("row", { name: new RegExp(names[0]) }),
    ).toBeVisible();
    const contextualDelivery = contextual
      .getByText(/chi effettua la consegna/i)
      .locator("..");
    await contextualDelivery.getByRole("combobox").click();
    await expect(
      page.getByRole("option", { name: `R2${suffix} V${suffix}` }),
    ).toBeVisible();
    await database.query("UPDATE volontari SET attivo=false WHERE id=$1", [
      volunteerId,
    ]);
    const contextualBefore = await facts();
    const sentBefore = sent.length;
    const contextualDenied = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/bolle/${bollaId}`) &&
        r.request().method() === "PATCH",
    );
    const contextualRead = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/documenti-operativi/bolla/${bollaId}`) &&
        r.request().method() === "GET",
    );
    await page.getByRole("option", { name: `R2${suffix} V${suffix}` }).click();
    expect((await contextualDenied).status()).toBe(403);
    expect((await contextualRead).status()).toBe(200);
    await expect(
      contextual.getByRole("row", { name: new RegExp(names[0]) }),
    ).toBeVisible();
    expect(await facts()).toEqual(contextualBefore);
    expect(sent.length - sentBefore).toBe(1);
    expect(new URL(page.url()).pathname).toBe("/richieste-magazzino");
    expect(new URL(page.url()).searchParams.get("filter")).toBe("keep");

    // Una nuova intenzione consentita funziona, senza ripetere quella negata.
    const allowed = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/bolle/${bollaId}`) &&
        r.request().method() === "PATCH",
    );
    await contextualDelivery.getByRole("combobox").click();
    await page.getByRole("option", { name: /altro.*ritiro/i }).click();
    expect((await allowed).status()).toBe(200);
    await page.reload();
    await expect(
      contextual.getByRole("row", { name: new RegExp(names[0]) }),
    ).toBeVisible();
    const { rows: persistedDelivery } = await database.query(
      "SELECT volontario_consegna_id,trasportatore_nome FROM bolle WHERE id=$1",
      [bollaId],
    );
    expect(persistedDelivery[0]).toEqual({
      volontario_consegna_id: null,
      trasportatore_nome: "Ritiro presso il magazzino",
    });

    // Revoca territoriale reale sulla sessione ancora aperta, dopo popolamento cache.
    const { rows: actorScope } = await database.query(
      "SELECT area_operativa_id,centro_ascolto_id FROM utenti WHERE username='m5c1-e2e-warehouse'",
    );
    try {
      await database.query(
        "UPDATE utenti SET area_operativa_id=null,centro_ascolto_id=null WHERE username='m5c1-e2e-warehouse'",
      );
      const revoked = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/documenti-operativi/bolla/${bollaId}`) &&
          r.request().method() === "GET",
      );
      await page.evaluate(() =>
        window.dispatchEvent(new Event("visibilitychange")),
      );
      // Il documento collegato fuori perimetro viene minimizzato come 404.
      expect((await revoked).status()).toBe(404);
      await expect(
        contextual.getByRole("row", { name: new RegExp(names[0]) }),
      ).toHaveCount(0);
      await expect(
        contextual.getByRole("button", {
          name: "Aggiungi prodotto",
          exact: true,
        }),
      ).toHaveCount(0);
      const deniedAgain = await page.request.get(
        `/api/documenti-operativi/bolla/${bollaId}`,
      );
      expect(deniedAgain.status()).toBe(404);
    } finally {
      await database.query(
        "UPDATE utenti SET area_operativa_id=$1,centro_ascolto_id=$2 WHERE username='m5c1-e2e-warehouse'",
        [actorScope[0].area_operativa_id, actorScope[0].centro_ascolto_id],
      );
    }
  } finally {
    await social.close();
    await warehouse.close();
  }
});

test("R2-03: Centro gestisce Enti, Magazzino cerca e crea Bolla ma non modifica l'anagrafica", async ({
  browser,
  viewport,
}) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const token = `Q${suffix.slice(0, 2)}`;
  const names = ["Alfa", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"].map(
    (name) => `${token} ${name} ${suffix}`,
  );
  // L'Area appartiene alla fixture Sociale, non alla sequenza degli ID del DB.
  const { rows: actors } = await database.query<{ area_operativa_id: number }>(
    "SELECT area_operativa_id FROM utenti WHERE username='m5c1-e2e-social'",
  );
  expect(actors).toHaveLength(1);
  const areaId = actors[0].area_operativa_id;
  expect(areaId).toBeGreaterThan(0);
  const social = await browser.newContext({ viewport });
  const warehouse = await browser.newContext({ viewport });
  const custom = await browser.newContext({ viewport });
  try {
    const centerPage = await social.newPage();
    await loginAs(centerPage, "m5c1-e2e-social");
    await centerPage.goto("/enti-esterni");
    await expect(centerPage.getByTestId("enti-esterni-page")).toBeVisible();
    await centerPage.getByRole("button", { name: "Nuovo Ente" }).click();
    const create = centerPage.getByRole("dialog", { name: "Nuovo Ente" });
    await create.getByLabel("Denominazione").fill(names[0]);
    await create.getByLabel("Indirizzo").fill(`Via ${suffix} 1`);
    await create.getByLabel("Telefono").fill("0600000001");
    await create.getByRole("button", { name: "Salva" }).click();
    await expect(create).toBeHidden();
    const createdResponse = await centerPage.request.get(
      `/api/enti-destinatari?search=${encodeURIComponent(suffix)}`,
    );
    expect(createdResponse.status()).toBe(200);
    const first = (await createdResponse.json()).find(
      (item: { denominazione: string }) => item.denominazione === names[0],
    );
    expect(first?.areaOperativaId).toBe(areaId);
    for (const [index, name] of names.entries()) {
      if (index === 0) continue;
      const response = await centerPage.request.post("/api/enti-destinatari", {
        data: {
          idempotencyKey: randomUUID(),
          denominazione: name,
          indirizzo: `Via ${suffix} ${index + 1}`,
          email: `${index}-${suffix}@example.invalid`,
          areaOperativaId: areaId,
        },
      });
      expect(response.status(), await response.text()).toBe(201);
    }

    const search = centerPage.getByLabel(/cerca per denominazione/i);
    const searchResponse = centerPage.waitForResponse(
      (response) =>
        response.url().includes(`/api/enti-destinatari?`) &&
        response.url().toLowerCase().includes(`search=${token.toLowerCase()}`),
    );
    await search.fill(token.toLowerCase());
    expect((await searchResponse).status()).toBe(200);
    const centerCards = centerPage
      .getByTestId("enti-esterni-page")
      .locator("div.space-y-2 > div.rounded-xl");
    await expect(centerCards).toHaveCount(6);
    await search.fill(`Via ${suffix} 1`);
    await expect(centerCards).toHaveCount(1);
    await expect(centerCards.first()).toContainText(names[0]);
    await search.fill(token.toLowerCase());
    await expect(centerCards).toHaveCount(6);
    const firstCard = centerCards.filter({ hasText: names[0] });
    await firstCard.getByRole("button", { name: "Modifica" }).click();
    const edit = centerPage.getByRole("dialog", { name: "Modifica" });
    await edit.getByLabel("Indirizzo").fill(`Via aggiornata ${suffix}`);
    await edit.getByRole("button", { name: "Salva" }).click();
    await expect(firstCard).toContainText(`Via aggiornata ${suffix}`);
    await firstCard.getByRole("button", { name: "Disattiva" }).click();
    await expect(firstCard).toContainText("Inattivo");
    await firstCard.getByRole("button", { name: "Riattiva" }).click();
    await expect(firstCard).toContainText("Attivo");

    const warehousePage = await warehouse.newPage();
    await loginAs(warehousePage, "m5c1-e2e-warehouse");
    const warehouseSearch = await warehousePage.request.get(
      `/api/enti-destinatari?search=${encodeURIComponent(token)}`,
    );
    expect(warehouseSearch.status()).toBe(200);
    expect(
      (await warehouseSearch.json())
        .map((item: { denominazione: string }) => item.denominazione)
        .sort(),
    ).toEqual([...names].sort());

    const roleName = `R2 Custom Warehouse ${suffix}`;
    const { rows: roles } = await database.query(
      `INSERT INTO ruoli(nome,aree,permessi,is_admin)
       VALUES ($1,'["magazzino"]'::jsonb,
         '["enti-destinatari.view","enti-destinatari.manage"]'::jsonb,false)
       RETURNING id`,
      [roleName],
    );
    const customUsername = `r2-custom-${suffix}`;
    await database.query(
      `INSERT INTO utenti(username,password_hash,nome,ruolo_id,area_operativa_id,must_change_password)
       SELECT $1,password_hash,$1,$2,$3,false FROM utenti WHERE username='m5c1-e2e-warehouse'`,
      [customUsername, roles[0].id, areaId],
    );
    const customPage = await custom.newPage();
    await loginAs(customPage, customUsername);
    const deniedCreate = await customPage.request.post(
      "/api/enti-destinatari",
      {
        data: {
          idempotencyKey: randomUUID(),
          denominazione: `Forbidden ${suffix}`,
          indirizzo: "Via vietata",
          areaOperativaId: areaId,
        },
      },
    );
    expect(deniedCreate.status()).toBe(403);
    const deniedUpdate = await customPage.request.patch(
      `/api/enti-destinatari/${first.id}`,
      { data: { idempotencyKey: randomUUID(), versione: 3, attivo: false } },
    );
    expect(deniedUpdate.status()).toBe(403);
    const { rows: unchanged } = await database.query(
      "SELECT attivo FROM enti_destinatari WHERE id=$1",
      [first.id],
    );
    expect(unchanged[0].attivo).toBe(true);

    await warehousePage.goto("/bolle");
    await warehousePage.getByRole("button", { name: /^nuovo$/i }).click();
    const choice = warehousePage.getByRole("dialog", {
      name: /nuovo documento operativo/i,
    });
    await choice.getByRole("button", { name: /nuova bolla/i }).click();
    const bollaForm = warehousePage.getByRole("dialog", {
      name: /nuova bolla di consegna/i,
    });
    await bollaForm.getByRole("combobox").first().click();
    await warehousePage.getByRole("option", { name: "Ente esterno" }).click();
    await expect(bollaForm.getByText("Nuovo Ente")).toHaveCount(0);
    await bollaForm.getByRole("button", { name: /crea bolla/i }).click();
    await expect(bollaForm.getByRole("alert")).toContainText(
      "Seleziona un Ente",
    );
    const picker = bollaForm.locator('button[role="combobox"]').nth(1);
    await expect(picker).toContainText(/seleziona ente/i);
    await picker.click();
    await warehousePage
      .getByPlaceholder(/denominazione|indirizzo|telefono|email/i)
      .fill(names[0]);
    await warehousePage
      .getByRole("option", { name: new RegExp(names[0]) })
      .click();
    await bollaForm.getByRole("button", { name: /crea bolla/i }).click();
    await expect(bollaForm.getByRole("alert")).toContainText(
      "Seleziona il Magazzino",
    );
    await bollaForm
      .getByRole("combobox", { name: /magazzino di uscita/i })
      .click();
    await warehousePage
      .getByRole("option", { name: "M5C1 E2E Deposito" })
      .click();
    const bollaResponse = warehousePage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/bolle") &&
        response.request().method() === "POST",
    );
    await bollaForm.getByRole("button", { name: /crea bolla/i }).click();
    const createdBolla = await bollaResponse;
    expect(createdBolla.status(), await createdBolla.text()).toBe(201);
    const bolla = await createdBolla.json();
    await warehousePage.goto(`/bolle?bollaId=${bolla.id}`);
    const detail = warehousePage.getByRole("dialog", {
      name: /dettaglio bolla/i,
    });
    await expect(detail).toContainText(names[0]);
    await warehousePage.reload();
    await expect(detail).toContainText(names[0]);
    const { rows: persisted } = await database.query(
      "SELECT ente_destinatario_id FROM bolle WHERE id=$1",
      [bolla.id],
    );
    expect(persisted[0].ente_destinatario_id).toBe(first.id);
  } finally {
    await social.close();
    await warehouse.close();
    await custom.close();
  }
});
