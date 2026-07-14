import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  auditConfigurazioniTable,
  centriAscoltoTable,
  cittaTable,
  db,
  lottiTable,
  magazziniTable,
  pool,
  prodottiTable,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import app from "../src/app";
import { runEnvironmentDataCli } from "../src/cli/environment-data";
import { initializeBaseData } from "../src/lib/baseData";
import {
  DEMO_LOT_CODES,
  DEMO_PRODUCT_CODES,
  DEMO_WAREHOUSE_CODES,
  resetDemoWarehouseData,
} from "../src/lib/environmentData";
import {
  ensureImpostazioniStampa,
  updateImpostazioniStampa,
} from "../src/lib/impostazioniStampa";
import { resolveSessionRuntimeConfig } from "../src/lib/sessionConfig";
import { EMPORIO_ROLE_NAME, seedRoles } from "../src/lib/seedRoles";

const suffix = Math.random().toString(36).slice(2, 9);
const adminUsername = `bugdb_admin_${suffix}`;
const superUsername = `bugdb_super_${suffix}`;
const password = "BugDb01-Test!";

let adminRoleId: number;
let adminUserId: number;
let superUserId: number;
let createdRoleId: number | undefined;
let createdCittaId: number | undefined;
let createdCentroId: number | undefined;
let adminAgent: ReturnType<typeof request.agent>;
let originalPrint: Awaited<ReturnType<typeof ensureImpostazioniStampa>>;

beforeAll(async () => {
  await initializeBaseData();
  originalPrint = await ensureImpostazioniStampa();

  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `BUG-DB-01 Admin ${suffix}`,
      aree: ["amministrazione"],
      isAdmin: true,
    })
    .returning({ id: ruoliTable.id });
  adminRoleId = role.id;

  const passwordHash = await bcrypt.hash(password, 4);
  const users = await db
    .insert(utentiTable)
    .values([
      {
        username: adminUsername,
        passwordHash,
        nome: "Admin",
        cognome: "BUG DB 01",
        ruoloId: adminRoleId,
        attivo: true,
        isSuperAdmin: false,
      },
      {
        username: superUsername,
        passwordHash,
        nome: "Super Admin",
        cognome: "BUG DB 01",
        ruoloId: adminRoleId,
        attivo: true,
        isSuperAdmin: true,
      },
    ])
    .returning({ id: utentiTable.id, username: utentiTable.username });
  adminUserId = users.find((row) => row.username === adminUsername)!.id;
  superUserId = users.find((row) => row.username === superUsername)!.id;

  adminAgent = request.agent(app);
  const login = await adminAgent
    .post("/api/auth/login")
    .send({ username: adminUsername, password });
  expect(login.status).toBe(200);
});

afterAll(async () => {
  try {
    await resetDemoWarehouseData(superUserId);
  } catch {
    // The test assertions below expose the actual reset failure. Cleanup remains
    // best effort so the original failure is not hidden by this hook.
  }
  if (originalPrint) {
    await updateImpostazioniStampa({
      templateBolla: originalPrint.templateBolla as
        | "standard"
        | "moderno"
        | "minimal",
      footerBolla: originalPrint.footerBolla,
    });
  }
  if (createdCentroId) {
    await db
      .delete(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, createdCentroId));
  }
  if (createdCittaId) {
    await db.delete(cittaTable).where(eq(cittaTable.id, createdCittaId));
  }
  await adminAgent?.post("/api/auth/logout");
  await db
    .delete(auditConfigurazioniTable)
    .where(
      inArray(auditConfigurazioniTable.utenteId, [adminUserId, superUserId]),
    );
  await db
    .delete(utentiTable)
    .where(inArray(utentiTable.id, [adminUserId, superUserId]));
  if (createdRoleId) {
    await db.delete(ruoliTable).where(eq(ruoliTable.id, createdRoleId));
  }
  await db.delete(ruoliTable).where(eq(ruoliTable.id, adminRoleId));
  await pool.end();
});

describe("BUG-DB-01 - DB vergine e autenticazione", () => {
  it("consente a un Admin autenticato di creare un ruolo", async () => {
    const response = await adminAgent.post("/api/ruoli").send({
      nome: `Ruolo API ${suffix}`,
      descrizione: "Ruolo sintetico di test",
      aree: ["generale"],
      isAdmin: false,
    });

    expect(response.status).toBe(201);
    expect(response.body.nome).toBe(`Ruolo API ${suffix}`);
    createdRoleId = response.body.id;
  });

  it("blocca la creazione ruolo senza sessione con messaggio esplicito", async () => {
    const response = await request(app)
      .post("/api/ruoli")
      .send({
        nome: `Ruolo non autenticato ${suffix}`,
        aree: [],
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Non autenticato");
  });

  it("crea un'area e un centro collegato, e consente un centro senza area", async () => {
    const area = await adminAgent.post("/api/citta").send({
      nome: `Area BUG-DB-01 ${suffix}`,
      provincia: "Demo",
      sigla: "de",
    });
    expect(area.status).toBe(201);
    expect(area.body.sigla).toBe("DE");
    createdCittaId = area.body.id;

    const centre = await adminAgent.post("/api/centri-ascolto").send({
      nome: `Centro BUG-DB-01 ${suffix}`,
      cittaId: createdCittaId,
    });
    expect(centre.status).toBe(201);
    expect(centre.body.cittaId).toBe(createdCittaId);
    createdCentroId = centre.body.id;

    const withoutArea = await adminAgent.post("/api/centri-ascolto").send({
      nome: `Centro senza area ${suffix}`,
      cittaId: null,
    });
    expect(withoutArea.status).toBe(201);
    await db
      .delete(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, withoutArea.body.id));
  });

  it("restituisce errori chiari per payload area e FK centro non validi", async () => {
    const invalidArea = await adminAgent.post("/api/citta").send({});
    expect(invalidArea.status).toBe(400);
    expect(invalidArea.body.error).toBe("Inserimento area non valido");

    const invalidCentre = await adminAgent.post("/api/centri-ascolto").send({
      nome: `Centro FK non valida ${suffix}`,
      cittaId: 2_147_483_000,
    });
    expect(invalidCentre.status).toBe(400);
    expect(invalidCentre.body.error).toBe("L'area selezionata non esiste");
  });
});

describe("BUG-DB-01 - seed, stampa e reset protetti", () => {
  it("mantiene seed base e ruolo Emporio idempotenti", async () => {
    await initializeBaseData();
    await initializeBaseData();
    await seedRoles();

    const roles = await db
      .select({ id: ruoliTable.id })
      .from(ruoliTable)
      .where(eq(ruoliTable.nome, EMPORIO_ROLE_NAME));
    expect(roles).toHaveLength(1);
  });

  it("salva e rilegge il template stampa dal backend", async () => {
    const update = await adminAgent.put("/api/impostazioni-stampa").send({
      templateBolla: "moderno",
      footerBolla: "Footer sintetico BUG-DB-01",
    });
    expect(update.status).toBe(200);

    const firstRead = await adminAgent.get("/api/impostazioni-stampa");
    const secondRead = await adminAgent.get("/api/impostazioni-stampa");
    expect(firstRead.body.templateBolla).toBe("moderno");
    expect(secondRead.body.templateBolla).toBe("moderno");
    expect(secondRead.body.footerBolla).toBe("Footer sintetico BUG-DB-01");
  });

  it("crea il magazzino demo una sola volta e lo resetta selettivamente", async () => {
    const first = await runEnvironmentDataCli([
      "seed-demo-magazzino",
      `--super-admin=${superUsername}`,
    ]);
    const second = await runEnvironmentDataCli([
      "seed-demo-magazzino",
      `--super-admin=${superUsername}`,
    ]);

    expect(first).toMatchObject({
      createdMagazzini: 2,
      createdProdotti: 8,
      createdLotti: 8,
      createdMovimenti: 8,
    });
    expect(second).toMatchObject({
      createdMagazzini: 0,
      createdProdotti: 0,
      createdLotti: 0,
      createdMovimenti: 0,
    });
    expect(
      await db
        .select({ id: magazziniTable.id })
        .from(magazziniTable)
        .where(inArray(magazziniTable.codice, [...DEMO_WAREHOUSE_CODES])),
    ).toHaveLength(2);
    expect(
      await db
        .select({ id: prodottiTable.id })
        .from(prodottiTable)
        .where(inArray(prodottiTable.codice, [...DEMO_PRODUCT_CODES])),
    ).toHaveLength(8);
    expect(
      await db
        .select({ id: lottiTable.id })
        .from(lottiTable)
        .where(inArray(lottiTable.codiceLotto, [...DEMO_LOT_CODES])),
    ).toHaveLength(8);

    const reset = await runEnvironmentDataCli([
      "reset-demo-magazzino",
      `--super-admin=${superUsername}`,
      "--confirm=RESET MAGAZZINO DEMO",
    ]);
    expect(reset).toMatchObject({
      deletedMagazzini: 2,
      deletedProdotti: 8,
      deletedLotti: 8,
    });
  });

  it("rifiuta reset e seed demo a un Admin che non è Super Admin", async () => {
    await expect(
      runEnvironmentDataCli([
        "reset-demo-magazzino",
        `--super-admin=${adminUsername}`,
        "--confirm=RESET MAGAZZINO DEMO",
      ]),
    ).rejects.toThrow("non ha privilegi Super Admin");
    await expect(
      runEnvironmentDataCli([
        "seed-demo-magazzino",
        `--super-admin=${adminUsername}`,
      ]),
    ).rejects.toThrow("non ha privilegi Super Admin");
  });

  it("richiede frase esatta e backup dichiarato per i reset totali", async () => {
    await expect(
      runEnvironmentDataCli([
        "reset-magazzino",
        `--super-admin=${superUsername}`,
        "--confirm=RESET MAGAZZINO",
      ]),
    ).rejects.toThrow("--backup-confirmed");
    await expect(
      runEnvironmentDataCli([
        "reset-ambiente",
        `--super-admin=${superUsername}`,
        "--backup-confirmed",
        "--confirm=reset ambiente",
      ]),
    ).rejects.toThrow("Conferma non valida");
  });
});

describe("BUG-DB-01 - configurazione cookie", () => {
  it("preferisce le opzioni esplicite alla rilevazione hosting", () => {
    const previous = {
      COOKIE_SECURE: process.env.COOKIE_SECURE,
      COOKIE_SAMESITE: process.env.COOKIE_SAMESITE,
      REPLIT_DOMAINS: process.env.REPLIT_DOMAINS,
    };
    process.env.COOKIE_SECURE = "false";
    process.env.COOKIE_SAMESITE = "lax";
    process.env.REPLIT_DOMAINS = "hosting-stale.example";
    try {
      expect(resolveSessionRuntimeConfig()).toMatchObject({
        cookieSecure: false,
        cookieSameSite: "lax",
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("rifiuta SameSite=None senza cookie Secure", () => {
    const previousSecure = process.env.COOKIE_SECURE;
    const previousSameSite = process.env.COOKIE_SAMESITE;
    process.env.COOKIE_SECURE = "false";
    process.env.COOKIE_SAMESITE = "none";
    try {
      expect(() => resolveSessionRuntimeConfig()).toThrow(
        "COOKIE_SAMESITE=none richiede COOKIE_SECURE=true",
      );
    } finally {
      if (previousSecure === undefined) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = previousSecure;
      if (previousSameSite === undefined) delete process.env.COOKIE_SAMESITE;
      else process.env.COOKIE_SAMESITE = previousSameSite;
    }
  });
});
