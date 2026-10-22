import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// Prepared for the separate ##test campaign. Run only through quality-gates-run.
if (!process.env.QUALITY_TEST_IDENTITY || !process.env.E2E_PASSWORD)
  throw new Error("BUG6 browser tests require the attested disposable runner");
const password = process.env.E2E_PASSWORD;
const initialPassword = `B6-Initial-${randomUUID()}!`;
const finalPassword = `B6-Final-${randomUUID()}!`;
const suffix = randomUUID().slice(0, 8);
const profiles = [
  { name: "Amministratore", routes: ["/utenti", "/ruoli"], admin: true },
  { name: "SuperAdmin", routes: ["/super-admin/moduli"], admin: true },
  {
    name: "Operatore",
    routes: ["/beneficiari", "/consegne", "/turni", "/report/centro-ascolto"],
  },
  {
    name: "Operatore Magazzino",
    routes: ["/prodotti", "/carico-merce", "/richieste-magazzino"],
  },
  {
    name: "Operatore Logistica",
    routes: [
      "/fornitori",
      "/approvvigionamenti",
      "/turni",
      "/report/magazzino-logistica",
    ],
  },
  {
    name: "Operatore UDS",
    routes: ["/uds/anagrafica", "/uds/report-giornaliero"],
  },
  {
    name: "Emporio",
    routes: [
      "/emporio/accessi",
      "/emporio/crediti-saldo",
      "/emporio/cassa",
      "/emporio/spese",
    ],
  },
  {
    name: "Operatore Mensa",
    routes: [
      "postazione",
      "pasti",
      "abilitazioni",
      "trasferimenti",
      "consumi",
      "eccezioni",
      "report",
    ].map((view) => `/mensa/${view}`),
  },
  { name: "Volontario", routes: ["/turni", "/consegne", "/maps"] },
  {
    name: "BUG6 readonly",
    routes: ["/prodotti"],
    grants: ["magazzino.view"],
    areas: ["magazzino"],
  },
  {
    name: "BUG6 multi",
    routes: ["/turni", "/uds/report-giornaliero"],
    grants: ["logistica.turni.view", "uds.reports.view"],
    areas: ["logistica", "uds"],
  },
  {
    name: "BUG6 centro personalizzato",
    routes: ["/beneficiari", "/consegne", "/turni"],
    areas: ["generale", "magazzino", "sociale", "logistica", "analisi"],
    grants: ["beneficiari.view", "consegne.view", "logistica.turni.view", "credito.view", "emporio.access.view", "emporio.access.manage"],
  },
  {
    name: "BUG6 aggiunta esplicita",
    routes: ["/uds/anagrafica", "/emporio/crediti-saldo"],
    areas: ["uds"],
    grants: ["uds.directory.view", "credito.view"],
  },
];
// Independent expected destinations: ordinary workflow suites must not assume
// that every authenticated actor has permission to open the Dashboard.
const expectedHome: Record<string, string> = {
  Amministratore: "/",
  SuperAdmin: "/",
  Operatore: "/",
  "Operatore Magazzino": "/prodotti",
  "Operatore Logistica": "/turni",
  "Operatore UDS": "/uds/anagrafica",
  Emporio: "/emporio/cassa",
  "Operatore Mensa": "/mensa/postazione",
  Volontario: "/consegne",
  "BUG6 readonly": "/prodotti",
  "BUG6 multi": "/turni",
  "BUG6 centro personalizzato": "/",
  "BUG6 aggiunta esplicita": "/emporio/crediti-saldo",
};
let admin: APIRequestContext;
let areaId: number;
let secondAreaId: number;
let database: {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Array<Record<string, number>> }>;
  end: () => Promise<void>;
};
const fixture = {
  centres: [] as number[],
  warehouses: [] as number[],
  mense: [] as number[],
  mensaWarehouses: [] as number[],
  beneficiaries: [] as number[],
  deliveries: [] as number[],
  bolle: [] as number[],
  product: 0,
};
const users = new Map<string, { id: number; username: string }>();
const customRoles: number[] = [];

test.beforeAll(async ({ playwright, baseURL }) => {
  if (
    new URL(baseURL!).hostname !== "127.0.0.1" ||
    new URL(baseURL!).port !== "19672"
  )
    throw new Error("Unexpected BUG6 browser destination");
  admin = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL! },
  });
  expect(
    (
      await admin.post("/api/auth/login", {
        data: { username: "sadmin", password },
      })
    ).status(),
  ).toBe(200);
  const area = await admin.post("/api/aree-operative", {
    data: { nome: `BUG6 browser ${suffix}`, attivo: true },
  });
  expect(area.status()).toBe(201);
  areaId = (await area.json()).id;
  const catalog = (await (await admin.get("/api/ruoli")).json()) as Array<{
    id: number;
    nome: string;
  }>;
  for (const [index, profile] of profiles.entries()) {
    let roleId = catalog.find((row) => row.nome === profile.name)?.id;
    if ("grants" in profile) {
      const created = await admin.post("/api/ruoli", {
        data: {
          nome: `${profile.name} ${suffix}`,
          aree: profile.areas,
          permessi: profile.grants,
          isAdmin: false,
        },
      });
      expect(created.status()).toBe(201);
      roleId = (await created.json()).id;
      customRoles.push(roleId!);
    }
    expect(roleId, profile.name).toBeTruthy();
    const username = `bug6-${suffix}-${index}`;
    const created = await admin.post("/api/utenti", {
      data: {
        username,
        email: `${username}@example.test`,
        nome: "Sintetico",
        cognome: profile.name,
        password: initialPassword,
        ruoloId: roleId,
        areaOperativaId: "admin" in profile ? null : areaId,
        attivo: true,
      },
    });
    expect(created.status(), profile.name).toBe(201);
    users.set(profile.name, { id: (await created.json()).id, username });
    const account = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Origin: baseURL! },
    });
    try {
      expect(
        (
          await account.post("/api/auth/login", {
            data: { username, password: initialPassword },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await account.post("/api/auth/change-password", {
            data: { newPassword: finalPassword },
          })
        ).status(),
      ).toBe(204);
      if (profile.name === "Operatore Mensa") {
        // The empty Area is deliberately denied; ordinary page checks below
        // need an actual Mensa, not a race that leaves its request unfinished.
        const emptyScope = await account.get("/api/mensa/consumi");
        expect(emptyScope.status()).toBe(403);
        expect((await emptyScope.json()).error).toBe(
          "Nessuna Mensa disponibile nell'Area",
        );
      }
    } finally {
      await account.dispose();
    }
  }
  const dbUrl = new URL(process.env.E2E_DATABASE_URL!);
  if (
    dbUrl.hostname !== "127.0.0.1" ||
    dbUrl.port !== "58621" ||
    dbUrl.pathname !== "/m62c_r2_m4"
  )
    throw new Error("BUG6 fixture requires the runner's disposable database");
  const { Pool } = createRequire(
    new URL("../../../lib/db/package.json", import.meta.url),
  )("pg");
  database = new Pool({ connectionString: dbUrl.href });
  const second = await admin.post("/api/aree-operative", {
    data: { nome: `BUG6 second ${suffix}`, attivo: true },
  });
  expect(second.status()).toBe(201);
  secondAreaId = (await second.json()).id;
  const product = await database.query(
    "insert into prodotti(codice,nome,tipo_prodotto,unita_misura) values($1,'Prodotto trasporto sintetico','alimentare','pz') returning id",
    [`B6-${suffix}`],
  );
  fixture.product = product.rows[0].id;
  for (const [i, area] of [areaId, secondAreaId].entries()) {
    const centre = await database.query(
      "insert into centri_di_ascolto(nome,area_operativa_id) values($1,$2) returning id",
      [`Centro sintetico ${suffix}-${i}`, area],
    );
    fixture.centres.push(centre.rows[0].id);
    const warehouse = await database.query(
      "insert into magazzini(codice,nome,area_operativa_id,centro_ascolto_id,tipo_magazzino) values($1,$2,$3,$4,'misto') returning id",
      [
        `B6-${suffix}-${i}`,
        `Magazzino sintetico ${i}`,
        area,
        centre.rows[0].id,
      ],
    );
    fixture.warehouses.push(warehouse.rows[0].id);
    const mensa = await admin.post("/api/mensa/mense", {
      data: {
        codice: `BM-${suffix}-${i}`,
        nome: `Mensa sintetica ${suffix}-${i}`,
        areaOperativaId: area,
        centroAscoltoId: centre.rows[0].id,
      },
    });
    expect(mensa.status()).toBe(201);
    const createdMensa = await mensa.json();
    fixture.mense.push(createdMensa.id);
    fixture.mensaWarehouses.push(createdMensa.magazzinoId);
    const person = await database.query(
      "insert into beneficiari(codice,nome,cognome,area_operativa_id,centro_ascolto_id) values($1,'Persona','Sintetica',$2,$3) returning id",
      [`B6-${suffix}-${i}`, area, centre.rows[0].id],
    );
    fixture.beneficiaries.push(person.rows[0].id);
    const delivery = await database.query(
      "insert into consegne(codice,beneficiario_id,magazzino_id,tipo_consegna,data_prevista,indirizzo_consegna) values($1,$2,$3,'domicilio',CURRENT_DATE,'Via Sintetica 1') returning id",
      [`B6-${suffix}-${i}`, person.rows[0].id, warehouse.rows[0].id],
    );
    fixture.deliveries.push(delivery.rows[0].id);
    const bolla = await database.query(
      "insert into bolle(numero_bolla,data_bolla,beneficiario_id,consegna_id,magazzino_id,stato) values($1,CURRENT_DATE,$2,$3,$4,'confermato') returning id",
      [
        `B6-${suffix}-${i}`,
        person.rows[0].id,
        delivery.rows[0].id,
        warehouse.rows[0].id,
      ],
    );
    fixture.bolle.push(bolla.rows[0].id);
    await database.query(
      "insert into bolla_righe(bolla_id,prodotto_id,quantita,unita_misura) values($1,$2,2,'pz')",
      [bolla.rows[0].id, fixture.product],
    );
  }
});
test.afterAll(async () => {
  if (database) {
    await database.query(
      "delete from bolla_righe where bolla_id = any($1::int[])",
      [fixture.bolle],
    );
    await database.query("delete from bolle where id = any($1::int[])", [
      fixture.bolle,
    ]);
    await database.query("delete from consegne where id = any($1::int[])", [
      fixture.deliveries,
    ]);
    await database.query("delete from beneficiari where id = any($1::int[])", [
      fixture.beneficiaries,
    ]);
    await database.query("delete from mense where id = any($1::int[])", [
      fixture.mense,
    ]);
    await database.query("delete from magazzini where id = any($1::int[])", [
      fixture.mensaWarehouses,
    ]);
    await database.query("delete from magazzini where id = any($1::int[])", [
      fixture.warehouses,
    ]);
    await database.query(
      "delete from centri_di_ascolto where id = any($1::int[])",
      [fixture.centres],
    );
    if (fixture.product)
      await database.query("delete from prodotti where id=$1", [
        fixture.product,
      ]);
    await database.end();
  }
  if (!admin) return;
  for (const user of users.values())
    expect((await admin.delete(`/api/utenti/${user.id}`)).status()).toBe(204);
  // Accounts are deactivated by the normal API; their historical role links
  // remain valid until the runner destroys this entire disposable database.
  if (areaId)
    expect((await admin.delete(`/api/aree-operative/${areaId}`)).status()).toBe(
      204,
    );
  if (secondAreaId)
    expect(
      (await admin.delete(`/api/aree-operative/${secondAreaId}`)).status(),
    ).toBe(204);
  await admin.dispose();
});
async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(username);
  await page.getByLabel(/^password$/i).fill(finalPassword);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).not.toHaveURL(/\/login|change-password/);
}
for (const profile of profiles)
  test(`${profile.name}: ingresso, pagine e chiamate ordinarie senza privilegi aggiuntivi`, async ({
    page,
  }) => {
    const denied: string[] = [],
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() === 403)
        denied.push(new URL(response.url()).pathname);
    });
    await login(page, users.get(profile.name)!.username);
    await expect(page).toHaveURL(
      (url) => url.pathname === expectedHome[profile.name],
    );
    const identity = await (await page.request.get("/api/auth/me")).json();
    expect(identity.isAdmin).toBe("admin" in profile);
    expect(identity.isSuperAdmin).toBe(profile.name === "SuperAdmin");
    expect(identity.permessiSpeciali).toEqual(profile.name === "BUG6 aggiunta esplicita" ? ["credito.view"] : []);
    if (!("admin" in profile)) expect(identity.areaOperativaId).toBe(areaId);
    if (!("admin" in profile)) {
      const groups = await page.locator("[data-nav-group-icon]")
        .evaluateAll((icons) => icons.map((icon) => icon.getAttribute("data-nav-group-icon")));
      expect(groups.filter((group) => group !== "supporto").every((group) => identity.aree.includes(group))).toBe(true);
      if (!identity.aree.includes("emporio"))
        await expect(page.locator('[data-nav-group-icon="emporio"]')).toHaveCount(0);
    }
    for (const path of profile.routes) {
      const consumptionResponse =
        path === "/mensa/consumi"
          ? page.waitForResponse(
              (response) =>
                response.request().method() === "GET" &&
                new URL(response.url()).pathname === "/api/mensa/consumi",
            )
          : undefined;
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("main")).not.toContainText(
        /non hai i permessi|accesso non autorizzato|Usa il menu per accedere alle sezioni/i,
      );
      if (consumptionResponse)
        expect((await consumptionResponse).status()).toBe(200);
    }
    expect(denied).toEqual([]);
    expect(errors).toEqual([]);
    if (profile.name === "BUG6 aggiunta esplicita") {
      await page.goto("/profilo");
      await expect(page.getByRole("main")).toContainText("UTENTE SPECIALE");
    }
    if (profile.name === "BUG6 centro personalizzato") {
      for (const path of ["/emporio/crediti-saldo", "/emporio/accessi"]) {
        await page.goto(path);
        await expect(page.getByRole("main")).toContainText(/Usa il menu per accedere alle sezioni/i);
      }
    }
    if (profile.name === "Operatore Mensa") {
      const response = await page.request.get("/api/mensa/mense");
      expect(response.status()).toBe(200);
      const visible = (await response.json()).map(
        (mensa: { id: number }) => mensa.id,
      );
      expect(visible).toContain(fixture.mense[0]);
      expect(visible).not.toContain(fixture.mense[1]);
      expect(
        (
          await page.request.get(`/api/mensa/mense/${fixture.mense[1]}`)
        ).status(),
      ).toBe(403);
    }
    if (profile.name === "Volontario") {
      expect(
        (await page.request.post("/api/consegne", { data: {} })).status(),
      ).toBe(403);
      expect(
        (await page.request.put("/api/turni", { data: {} })).status(),
      ).toBe(403);
      expect((await page.request.get("/api/volontari")).status()).toBe(403);
    }
  });

test("Volontario: PDF reale della bolla, altra Area e tutti i comandi restano negati", async ({
  page,
}) => {
  await login(page, users.get("Volontario")!.username);
  await page.goto(`/consegne?consegnaId=${fixture.deliveries[0]}`);
  const button = page
    .getByRole("button", { name: "Scarica bolla trasporto", exact: true })
    .first();
  await expect(button).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await button.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`B6-${suffix}-0.pdf`);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
  expect(
    (
      await page.request.get(
        `/api/consegne/${fixture.deliveries[1]}/bolla-trasporto`,
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.patch(`/api/bolle/${fixture.bolle[0]}`, {
        data: { noteConsegna: "Vietato" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await page.request.get(`/api/bolle/${fixture.bolle[0]}`)).status(),
  ).toBe(403);
  await expect(
    page.getByRole("button", {
      name: /salva bolla|aggiungi prodotto|conferma bolla/i,
    }),
  ).toHaveCount(0);
});

test("Revoca da altra sessione: server immediato e interfaccia riallineata senza reload", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await login(page, users.get("BUG6 multi")!.username);
  await page.goto("/uds/report-giornaliero");
  const identity = await (await page.request.get("/api/auth/me")).json();
  const role = await (await admin.get(`/api/ruoli/${identity.ruoloId}`)).json();
  try {
    expect(
      (
        await admin.patch(`/api/ruoli/${role.id}`, {
          data: {
            permessi: role.permessi.filter(
              (grant: string) => grant !== "uds.reports.view",
            ),
          },
        })
      ).status(),
    ).toBe(200);
    expect((await page.request.get("/api/report/uds")).status()).toBe(403);
    await expect(page.getByRole("main")).toContainText(
      "Usa il menu per accedere alle sezioni",
      { timeout: 35_000 },
    );
  } finally {
    expect(
      (
        await admin.patch(`/api/ruoli/${role.id}`, {
          data: { permessi: role.permessi },
        })
      ).status(),
    ).toBe(200);
  }
});

test("Modulo UDS spento: API negata e UI aggiornata automaticamente", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await login(page, users.get("Operatore UDS")!.username);
  await page.goto("/uds/anagrafica");
  try {
    expect(
      (
        await admin.patch("/api/super-admin/moduli/UDS", {
          data: { attivo: false },
        })
      ).status(),
    ).toBe(200);
    expect((await page.request.get("/api/uds/directory")).status()).toBe(403);
    await expect(page.getByRole("main")).toContainText(
      "Modulo non attivo per questo ambiente",
      {
        timeout: 35_000,
      },
    );
  } finally {
    expect(
      (
        await admin.patch("/api/super-admin/moduli/UDS", {
          data: { attivo: true },
        })
      ).status(),
    ).toBe(200);
  }
});

test("Configurazione indisponibile: nessun dato privato resta nella pagina", async ({
  page,
}) => {
  await login(page, users.get("Volontario")!.username);
  await page.goto(`/consegne?consegnaId=${fixture.deliveries[0]}`);
  await expect(
    page.getByRole("button", { name: "Scarica bolla trasporto" }).first(),
  ).toBeVisible();
  await page.route("**/api/configurazione-ambiente", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Fault injection: configuration unavailable",
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Configurazione dei servizi non disponibile",
  );
  await expect(
    page.getByRole("button", { name: "Scarica bolla trasporto" }),
  ).toHaveCount(0);
  await page.unroute("**/api/configurazione-ambiente");
  await page.getByRole("button", { name: "Riprova", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Scarica bolla trasporto" }).first(),
  ).toBeVisible();
});
