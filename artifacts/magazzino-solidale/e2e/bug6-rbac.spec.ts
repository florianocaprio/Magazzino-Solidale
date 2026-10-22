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
];
let admin: APIRequestContext;
let areaId: number;
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
    } finally {
      await account.dispose();
    }
  }
});
test.afterAll(async () => {
  if (!admin) return;
  for (const user of users.values())
    expect((await admin.delete(`/api/utenti/${user.id}`)).status()).toBe(204);
  for (const roleId of customRoles)
    expect((await admin.delete(`/api/ruoli/${roleId}`)).status()).toBe(204);
  if (areaId)
    expect((await admin.delete(`/api/aree-operative/${areaId}`)).status()).toBe(
      204,
    );
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
    const identity = await (await page.request.get("/api/auth/me")).json();
    expect(identity.isAdmin).toBe("admin" in profile);
    expect(identity.isSuperAdmin).toBe(profile.name === "SuperAdmin");
    if (!("admin" in profile)) expect(identity.areaOperativaId).toBe(areaId);
    for (const path of profile.routes) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("main")).not.toContainText(
        /non hai i permessi|accesso non autorizzato/i,
      );
    }
    expect(denied).toEqual([]);
    expect(errors).toEqual([]);
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
