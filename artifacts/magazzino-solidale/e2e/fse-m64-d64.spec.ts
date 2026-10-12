import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test, expect, type Page, type APIResponse } from "@playwright/test";
import * as XLSX from "xlsx";
import { login, assertViewportSafe } from "./helpers";

async function json(response: APIResponse, status: number) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}
async function context(page: Page) {
  const areas = await json(await page.request.get("/api/aree-operative"), 200);
  const area = areas.find((a: { attivo: boolean }) => a.attivo);
  expect(area).toBeTruthy();
  const warehouse = await json(
    await page.request.post("/api/magazzini", {
      data: { nome: `D64 ${randomUUID()}`, areaOperativaId: area.id },
    }),
    201,
  );
  const lots = await json(
    await page.request.get(`/api/lotti-logici?areaOperativaId=${area.id}`),
    200,
  );
  const lot = lots.find((l: { isGenerale: boolean }) => l.isGenerale);
  expect(lot).toBeTruthy();
  const source = await json(
    await page.request.post("/api/fse-importazioni/sorgenti", {
      data: {
        codice: `D64-${randomUUID()}`,
        descrizione: "Fonte D64 browser sintetica",
        areaOperativaId: area.id,
      },
    }),
    201,
  );
  return { area, warehouse, lot, source };
}
function registry(
  product: string,
  document: string,
  reference = "17/09/2026",
  count = 2,
) {
  const h = [
    "Fondo",
    "Prodotto",
    `Giacenza al ${reference} Pezzi`,
    `Giacenza al ${reference} KgLt`,
    "Numero documento",
    "Data documento",
    "Data carico magazzino",
    "Lotto",
    "Mittente / destinatario",
    "Carico / scarico",
    "Carico / scarico pezzi",
    "Giacenza pezzi alla movimentazione",
    "Giacenza alla movimentazione",
    "Note",
    "Attività",
    "Pacchi",
    "Pasti",
    "Indigenti saltuari",
    "Indigenti continuativi",
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      h,
      ...Array.from({ length: count }, (_, i) => [
        "FSE+",
        product,
        20,
        null,
        `${document}-${i}`,
        "17/09/2026",
        "17/09/2026",
        "D64-LOT",
        "Ente sintetico",
        null,
        10,
        20,
        null,
        "D64_PRIVATE_NOTE",
        null,
        null,
        null,
        null,
        null,
      ]),
    ]),
    "Registro",
  );
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}
async function upload(
  page: Page,
  c: Awaited<ReturnType<typeof context>>,
  buffer: Buffer,
  options: Record<string, string> = {},
) {
  const q = new URLSearchParams({
    sourceRegistryId: String(c.source.id),
    areaOperativaId: String(c.area.id),
    magazzinoId: String(c.warehouse.id),
    lottoLogicoId: String(c.lot.id),
    profilo: "REGISTRO",
    modalita: "NUOVI_CARICHI",
    nomeFile: "registro-d64.xlsx",
    ...options,
  });
  return json(
    await page.request.post(`/api/fse-importazioni/analizza?${q}`, {
      data: buffer,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    }),
    201,
  );
}
const panel = (page: Page) =>
  page.getByRole("region", { name: "Rendicontazione FSE+", exact: true });

async function acceptExternalRow(page: Page, headerId: number) {
  const response = await json(
    await page.request.get(`/api/fse/riconciliazioni/${headerId}/righe`),
    200,
  );
  const row = response.rows.find(
    (r: { movimentoId: number | null }) => r.movimentoId == null,
  );
  expect(row).toBeTruthy();
  const region = panel(page);
  await region
    .getByText(`#${row.id} · ${row.businessKey}`, { exact: true })
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Seleziona", exact: true })
    .click();
  await region
    .getByRole("combobox", { name: "Azione", exact: true })
    .selectOption("ACCETTA_SCOSTAMENTO");
  await region
    .getByLabel("Motivazione audit", { exact: true })
    .fill("Scostamento esterno verificato nella prova sintetica");
  const resolved = page.waitForResponse(
    (r) =>
      r
        .url()
        .endsWith(`/api/fse/riconciliazioni/${headerId}/righe/${row.id}`) &&
      r.request().method() === "PATCH",
  );
  await region.getByRole("button", { name: "Applica", exact: true }).click();
  const accepted = await json(await resolved, 200);
  expect(accepted.exact).toBe(false);
  expect(accepted.blocking).toBe(false);
}

test("D01/D18: preserved legacy source is calculated and resolved from the UI without enabling its writer", async ({
  page,
}) => {
  await login(page);
  const c = await context(page);
  const target = new URL(process.env.DATABASE_URL!);
  expect(process.env.M64_DISPOSABLE_DB).toBe("verified");
  expect(target.hostname).toBe("127.0.0.1");
  expect(["58641/m64_browser", "58631/m63_m64"]).toContain(
    `${target.port}${target.pathname}`,
  );
  const { Client } = createRequire(
    new URL("../../../lib/db/package.json", import.meta.url),
  )("pg");
  const client = new Client({ connectionString: target.toString() });
  let importId: number;
  await client.connect();
  try {
    const {
      rows: [actor],
    } = await client.query("SELECT id FROM utenti WHERE username=$1", [
      process.env.E2E_USERNAME,
    ]);
    expect(actor).toBeTruthy();
    const {
      rows: [legacy],
    } = await client.query(
      "INSERT INTO importazioni_agea (magazzino_id,nome_file,mime_type,dimensione_bytes,sha256_file,tracciato_codice,parser_version,sheet_name,data_riferimento,modalita,stato,creato_da) VALUES ($1,'synthetic-legacy.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100,$2,'SIFEAD_REGISTRO_XLSX_OSSERVATO_V1','2.0B-R2.0','Table1','2026-09-17','SOLO_ANALISI','CONFERMATA',$3) RETURNING id",
      [c.warehouse.id, "a".repeat(64), actor.id],
    );
    importId = legacy.id;
    await client.query(
      "INSERT INTO importazioni_agea_righe (importazione_id,numero_riga,raw_json,prodotto_raw,prodotto_normalizzato,tipo_movimento_esterno,identity_base_hash,identity_occurrence,identity_key,content_hash,stato_riga,fondo_normalizzato,data_documento,movimento_pezzi) VALUES ($1,2,'{}','Sintetico legacy','SINTETICO LEGACY','DISTRIBUZIONE',$2,1,$3,$4,'NUOVA','FSE_PLUS','2026-09-17',-2)",
      [importId, "b".repeat(64), "b".repeat(64) + ":1", "c".repeat(64)],
    );
  } finally {
    await client.end();
  }
  await page.goto(
    `/report/fse-plus?magazzinoId=${c.warehouse.id}&da=2026-09-01&a=2026-09-17`,
  );
  const region = panel(page);
  await region
    .getByRole("tab", { name: "Riconciliazioni", exact: true })
    .click();
  await region
    .getByLabel("Tipo fonte amministrativa", { exact: true })
    .selectOption("AGEA_LEGACY");
  await region
    .getByLabel("Importazione AGEA", { exact: true })
    .fill(String(importId!));
  const calculated = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/fse/riconciliazioni") &&
      r.request().method() === "POST",
  );
  await region
    .getByRole("button", { name: "Calcola riconciliazione", exact: true })
    .click();
  const header = await json(await calculated, 201);
  expect(header.sourceType).toBe("AGEA_LEGACY");
  expect(header.importazioneAgeaId).toBe(importId!);
  await acceptExternalRow(page, header.id);
  expect(
    await json(
      await page.request.get(
        `/api/giacenze?areaOperativaId=${c.area.id}&magazzinoId=${c.warehouse.id}`,
      ),
      200,
    ),
  ).toEqual([]);
});

test("D14/D17: saldo source is an administrative aggregate, never an automatic inventory load", async ({
  page,
}) => {
  await login(page);
  const c = await context(page),
    productName = `Saldo D64 ${randomUUID()}`;
  const product = await json(
    await page.request.post("/api/prodotti", {
      data: {
        nome: productName,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
        quantitaFrazionabile: false,
        lottoFisicoObbligatorio: false,
        gestioneScadenza: false,
      },
    }),
    201,
  );
  const acquired = await upload(
    page,
    c,
    registry(productName, randomUUID(), "17/09/2026", 1),
    { modalita: "SALDO_INIZIALE" },
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [
        "Denominazione OpN",
        "Denominazione OpC",
        "Denominazione OpT",
        "CodiceAccesso",
        "Fondo",
        "Prodotto",
        "Lotto",
        "PesoUnita",
        "UnitaMisuraPeso",
        "GiacenzaPesoVolume",
        "GiacenzaPezzi",
        "PezziPerCollo",
        "GiacenzaColli",
        "CheckModificaGiacenza",
        "Scadenza",
      ],
      [
        "Sintetico",
        "Sintetico",
        "Sintetico",
        "NOT-A-REAL-CODE",
        "FSE+",
        productName,
        "D64-LOT",
        null,
        null,
        null,
        20,
        null,
        0,
        false,
        null,
      ],
    ]),
    "Giacenze",
  );
  await upload(
    page,
    c,
    Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })),
    {
      modalita: "SALDO_INIZIALE",
      profilo: "GIACENZE",
      sessionId: String(acquired.sessionId),
      dataRiferimento: "2026-09-17",
    },
  );
  let session = await json(
    await page.request.get(
      `/api/fse-importazioni/sessioni/${acquired.sessionId}`,
    ),
    200,
  );
  await json(
    await page.request.post(
      `/api/fse-importazioni/sessioni/${session.id}/associa-prodotto`,
      {
        data: {
          versione: session.versione,
          descrizioneEsterna: productName,
          prodottoId: product.id,
          motivo: "Mapping saldo sintetico",
          accettaFallbackData: false,
        },
      },
    ),
    200,
  );
  session = await json(
    await page.request.get(`/api/fse-importazioni/sessioni/${session.id}`),
    200,
  );
  await page.goto(
    `/report/fse-plus?magazzinoId=${c.warehouse.id}&da=2026-09-01&a=2026-09-17`,
  );
  const region = panel(page);
  await region
    .getByRole("tab", { name: "Riconciliazioni", exact: true })
    .click();
  await region
    .getByLabel("Tipo fonte amministrativa", { exact: true })
    .selectOption("FSE_M3B");
  await region
    .getByLabel("Procedura FSE+ e versione", { exact: true })
    .selectOption(String(session.id));
  await region
    .getByRole("checkbox", {
      name: /Confermo fonte, versione, data e baseline/,
    })
    .check();
  const calculated = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/fse/riconciliazioni") &&
      r.request().method() === "POST",
  );
  await region
    .getByRole("button", { name: "Calcola riconciliazione", exact: true })
    .click();
  const header = await json(await calculated, 201);
  const rows = await json(
    await page.request.get(`/api/fse/riconciliazioni/${header.id}/righe`),
    200,
  );
  const balance = rows.rows.find(
    (r: { tipoRiga: string }) => r.tipoRiga === "SALDO_PARTITA",
  );
  expect(balance).toBeTruthy();
  expect(balance.observationId).toBeNull();
  expect(balance.importazioneAgeaRigaId).toBeNull();
  expect(balance.aggregateVersionId).toBe(header.administrativeVersionId);
  expect(balance.piecesExternal).toBe("20.00");
  expect(
    await json(
      await page.request.get(
        `/api/giacenze?areaOperativaId=${c.area.id}&magazzinoId=${c.warehouse.id}`,
      ),
      200,
    ),
  ).toEqual([]);
  await expect(
    region.getByText(`#${balance.id} · ${balance.businessKey}`, {
      exact: true,
    }),
  ).toBeVisible();
  await assertViewportSafe(page);
});

test("D64: M3B partial → confirmed source → immutable run, resolution and minimized export", async ({
  page,
}) => {
  await login(page);
  const c = await context(page),
    doc = randomUUID();
  const product = await json(
    await page.request.post("/api/prodotti", {
      data: {
        nome: `D64 prodotto ${doc}`,
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
        quantitaFrazionabile: false,
        lottoFisicoObbligatorio: false,
        gestioneScadenza: false,
      },
    }),
    201,
  );
  const acquired = await upload(page, c, registry(product.nome, doc));
  await json(
    await page.request.post(
      `/api/fse-importazioni/sessioni/${acquired.sessionId}/associa-prodotto`,
      {
        data: {
          versione: acquired.versione,
          descrizioneEsterna: product.nome,
          prodottoId: product.id,
          motivo: "Mapping browser sintetico",
          accettaFallbackData: false,
        },
      },
    ),
    200,
  );
  let session = await json(
    await page.request.get(
      `/api/fse-importazioni/sessioni/${acquired.sessionId}`,
    ),
    200,
  );
  const attached = await json(
    await page.request.post(
      `/api/fse-importazioni/sessioni/${session.id}/aggiungi-pratica`,
      {
        data: {
          versione: session.versione,
          rigaIds: session.rows.map((r: { id: number }) => r.id),
          idempotencyKey: randomUUID(),
        },
      },
    ),
    201,
  );
  const practice = await json(
    await page.request.get(`/api/carico-pratiche/${attached.practiceId}`),
    200,
  );
  await json(
    await page.request.post(
      `/api/carico-pratiche/${attached.practiceId}/registra`,
      {
        data: {
          versione: practice.versione,
          rigaIds: [practice.righe[0].id],
          idempotencyKey: randomUUID(),
        },
      },
    ),
    201,
  );
  session = await json(
    await page.request.get(
      `/api/fse-importazioni/sessioni/${acquired.sessionId}`,
    ),
    200,
  );
  await page.goto(
    `/report/fse-plus?magazzinoId=${c.warehouse.id}&da=2026-09-01&a=2026-09-17`,
  );
  const region = panel(page);
  await region
    .getByRole("tab", { name: "Riconciliazioni", exact: true })
    .click();
  await region
    .getByLabel("Tipo fonte amministrativa", { exact: true })
    .selectOption("FSE_M3B");
  await region
    .getByLabel("Procedura FSE+ e versione", { exact: true })
    .selectOption(String(session.id));
  await expect(
    region.getByText("Righe registrate in Magazzino", { exact: true }),
  ).toBeVisible();
  await region
    .getByRole("checkbox", {
      name: /Confermo fonte, versione, data e baseline/,
    })
    .check();
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/fse/riconciliazioni") &&
      r.request().method() === "POST",
  );
  await region
    .getByRole("button", { name: "Calcola riconciliazione", exact: true })
    .click();
  const header = await json(await created, 201);
  expect(header.sourceType).toBe("FSE_M3B");
  expect(header.importazioneAgeaId).toBeNull();
  await region
    .getByText("Fonte congelata e storico dei calcoli", { exact: true })
    .click();
  await expect(
    region.getByText('"claimState": "REGISTRATA"', { exact: false }),
  ).toBeVisible();
  await expect(
    region.getByText('"claimState": "RISERVATA"', { exact: false }),
  ).toBeVisible();
  await expect(
    region.getByText("D64_PRIVATE_NOTE", { exact: false }),
  ).toHaveCount(0);
  const source = await json(
    await page.request.get(`/api/fse/riconciliazioni/${header.id}/fonte`),
    200,
  );
  expect(source.runs).toHaveLength(1);
  await acceptExternalRow(page, header.id);
  const stock = await json(
    await page.request.get(
      `/api/giacenze?areaOperativaId=${c.area.id}&magazzinoId=${c.warehouse.id}`,
    ),
    200,
  );
  expect(
    stock.find((s: { prodottoId: number }) => s.prodottoId === product.id)
      ?.giacenzaFisica,
  ).toBe(10);
  const newer = await upload(
    page,
    c,
    registry(product.nome, doc, "18/09/2026", 1),
  );
  const next = await json(
    await page.request.post("/api/fse/riconciliazioni", {
      data: {
        sourceType: "FSE_M3B",
        magazzinoId: c.warehouse.id,
        sessionId: newer.sessionId,
        sessionVersion: newer.versione,
        dataRiferimento: "2026-09-18",
        baselineRunId: source.runs[0].id,
        commandKey: randomUUID(),
      },
    }),
    201,
  );
  expect(next.baselineRunId).toBe(source.runs[0].id);
  expect(
    await json(
      await page.request.get(`/api/fse/riconciliazioni/${header.id}/fonte`),
      200,
    ),
  ).toEqual(source);
  // An imported load is already an external administrative fact, not a new
  // distribution to export. Produce an actual OpC return through its command.
  const physical = await json(
    await page.request.get(
      `/api/lotti?magazzinoId=${c.warehouse.id}&prodottoId=${product.id}`,
    ),
    200,
  );
  expect(physical).toHaveLength(1);
  const returned = await json(
    await page.request.post("/api/fse/resi-opc", {
      data: {
        versione: 1,
        idempotencyKey: randomUUID(),
        magazzinoId: c.warehouse.id,
        dataReso: "2026-09-17",
        destinazioneOpc: "OpC sintetica D64",
        motivazione: "Prova reso amministrativo",
        modalitaSelezione: "PARTITA_ESATTA",
        righe: [
          { prodottoId: product.id, lottoId: physical[0].id, quantita: 1 },
        ],
      },
    }),
    201,
  );
  expect(returned.id).toBeGreaterThan(0);
  const generated = await json(
    await page.request.post("/api/fse/exportazioni", {
      data: {
        magazzinoId: c.warehouse.id,
        dataDa: "2026-09-01",
        dataA: "2026-09-17",
        dataAsOf: "2026-09-17",
        formatCode: "FSE_CANONICAL_AUDIT_XLSX_V1",
        includeArretrati: true,
      },
    }),
    201,
  );
  const download = await page.request.get(
    `/api/fse/exportazioni/${generated.id}/download`,
  );
  expect(download.status()).toBe(200);
  expect(download.headers()["x-fse-variant"]).toBe("FSE_MINIMIZED_V1");
  const denied = await page.request.post(
    `/api/fse/exportazioni/${generated.id}/originale`,
    { data: { motivo: "D64 denied without explicit capability" } },
  );
  expect(denied.status()).toBe(403);
  const roles = await json(await page.request.get("/api/ruoli"), 200);
  const admin = roles.find((r: { nome: string }) => r.nome === "SuperAdmin");
  expect(admin.permessi).not.toContain("magazzino.fse.export.original.view");
  try {
    await json(
      await page.request.patch(`/api/ruoli/${admin.id}`, {
        data: {
          permessi: [...admin.permessi, "magazzino.fse.export.original.view"],
        },
      }),
      200,
    );
    expect(
      (
        await page.request.post(
          `/api/fse/exportazioni/${generated.id}/originale`,
          { data: { motivo: "  " } },
        )
      ).status(),
    ).toBe(400);
    await page.goto(
      `/report/fse-plus?magazzinoId=${c.warehouse.id}&da=2026-09-01&a=2026-09-17`,
    );
    await region
      .getByRole("tab", { name: "Esportazioni", exact: true })
      .click();
    await region
      .getByRole("button", { name: "Seleziona", exact: true })
      .click();
    const reason = region.getByLabel("Motivazione audit", { exact: true });
    const action = region.getByRole("button", {
      name: "Consulta storico riservato",
      exact: true,
    });
    await action.click();
    await expect(reason).toBeFocused();
    await expect(reason).toHaveAttribute("aria-invalid", "true");
    await reason.fill("Verifica storico sintetico D64");
    const originalResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/fse/exportazioni/${generated.id}/originale`) &&
        r.request().method() === "POST",
    );
    const originalDownload = page.waitForEvent("download");
    await action.click();
    const original = await originalResponse;
    expect(original.status()).toBe(200);
    expect(original.headers()["x-fse-variant"]).toBe(
      "STORICO_RIGENERATO_NON_MINIMIZZATO",
    );
    expect(original.request().postDataJSON()).toEqual({
      motivo: "Verifica storico sintetico D64",
    });
    expect(original.url()).not.toContain("Verifica");
    expect((await originalDownload).suggestedFilename()).toBe(
      `fse-${generated.id}-storico-rigenerato.xlsx`,
    );
    const observed = await page.request.get(
      `/api/fse/exportazioni/${generated.id}/download?representation=SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1`,
    );
    expect(observed.status()).toBe(200);
    expect(observed.headers()["x-fse-variant"]).toBe("FSE_MINIMIZED_V1");
  } finally {
    await json(
      await page.request.patch(`/api/ruoli/${admin.id}`, {
        data: { permessi: admin.permessi },
      }),
      200,
    );
  }
  expect(
    (
      await page.request.post(
        `/api/fse/exportazioni/${generated.id}/originale`,
        { data: { motivo: "Dopo revoca della capacità" } },
      )
    ).status(),
  ).toBe(403);
  await region
    .getByLabel("Motivazione audit", { exact: true })
    .fill("Revoca con pagina già aperta");
  const revoked = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/fse/exportazioni/${generated.id}/originale`) &&
      r.request().method() === "POST",
  );
  await region
    .getByRole("button", { name: "Consulta storico riservato", exact: true })
    .click();
  expect((await revoked).status()).toBe(403);
  await expect(
    region.getByLabel("Motivazione audit", { exact: true }),
  ).toHaveValue("Revoca con pagina già aperta");
  const afterDownload = await json(
    await page.request.get(
      `/api/giacenze?areaOperativaId=${c.area.id}&magazzinoId=${c.warehouse.id}`,
    ),
    200,
  );
  expect(
    afterDownload.find(
      (s: { prodottoId: number }) => s.prodottoId === product.id,
    )?.giacenzaFisica,
  ).toBe(9);
  await assertViewportSafe(page);
});

test("D64/F26: authorized original source is selectable in administrative reconciliation", async ({
  page,
}) => {
  expect(
    process.env.FSE_REGISTRY_ORIGINAL_PATH,
    "Required authorized original",
  ).toBeTruthy();
  await login(page);
  const c = await context(page);
  const acquired = await upload(
    page,
    c,
    readFileSync(process.env.FSE_REGISTRY_ORIGINAL_PATH!),
  );
  await page.goto(
    `/report/fse-plus?magazzinoId=${c.warehouse.id}&da=2024-09-01&a=2026-09-17`,
  );
  const region = panel(page);
  await region
    .getByRole("tab", { name: "Riconciliazioni", exact: true })
    .click();
  await region
    .getByLabel("Tipo fonte amministrativa", { exact: true })
    .selectOption("FSE_M3B");
  await region
    .getByLabel("Procedura FSE+ e versione", { exact: true })
    .selectOption(String(acquired.sessionId));
  await region
    .getByRole("checkbox", {
      name: /Confermo fonte, versione, data e baseline/,
    })
    .check();
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/fse/riconciliazioni") &&
      r.request().method() === "POST",
  );
  await region
    .getByRole("button", { name: "Calcola riconciliazione", exact: true })
    .click();
  const header = await json(await response, 201);
  expect(header.sourceType).toBe("FSE_M3B");
  const observations = await json(
    await page.request.get(
      `/api/fse/riconciliazioni/${header.id}/osservazioni?pageSize=20`,
    ),
    200,
  );
  expect(observations.total).toBeGreaterThan(201);
  expect(observations.rows).toHaveLength(20);
});
